/**
 * wasm 堆增长量化：反复解析同一份大文件，看 RSS 涨不涨。
 *
 *   node scripts/check-memory.mjs          # 默认 4 轮
 *   node scripts/check-memory.mjs 6        # 有 dispose 的轮数
 *
 * 为什么用 RSS 而不是 arrayBuffers：
 *   `process.memoryUsage().arrayBuffers` 统计的是 ArrayBuffer / Buffer，
 *   实测 wasm 的 WebAssembly.Memory **不计入**（Parser.init 前后都是 0.4 MB），
 *   只有 RSS 能反映 wasm 线性内存。24.89 MB 那份 JSON 的语法树约占 450 MB
 *   （410 万节点，每节点几十字节）。
 *
 * 三组实验：
 *   1. 有 dispose —— 每轮末尾释放全部块的 Tree（当前实现）
 *   2. 只解不释放 —— 保留引用，等价于把 dispose() 那几行删掉（修复前的行为）
 *   3. 轮 2 起 RSS 回落/持平 = 内存被复用，单调 +450 = 泄漏
 *
 * 注意 web-tree-sitter 的 wasm 上限是 32768 页 = 2 GB（见 tree-sitter.js
 * 里 `maximum: 32768`）。所以「不释放」那组跑到第 3~4 轮就会 Aborted()，
 * 这本身就是结论：浏览器里连续打开 4 次 24 MB 文件就会白屏。
 */
import { Parser, Language } from 'web-tree-sitter';
import { readFileSync } from 'node:fs';
import { ChunkedDoc } from '../packages/core/src/engines/chunked.js';

const ROUNDS = Number(process.argv[2]) || 4;
const dir = new URL('../bench/public/', import.meta.url).pathname;
const mb = (n) => Math.round(n / 1048576);
const rss = () => mb(process.memoryUsage().rss);

await Parser.init({ locateFile: () => dir + 'tree-sitter.wasm' });
const lang = await Language.load(dir + 'tree-sitter-json.wasm');
const parser = new Parser();
parser.setLanguage(lang);

const text = readFileSync(dir + 'data/big.json', 'utf8');
const base = rss();
console.log(`数据 ${(text.length / 1048576).toFixed(2)} MB · 基线 RSS ${base} MB · wasm 上限 2048 MB\n`);
console.log('模式            轮次   RSS   相对基线   本轮增量   解析耗时');

const table = [];
const keep = []; // 「不释放」那组要留住 doc，否则 V8 回收句柄后连释放的机会都没有

function run(leak) {
  let prev = base;
  for (let i = 1; i <= ROUNDS; i++) {
    const doc = new ChunkedDoc(text, parser);
    const t0 = performance.now();
    try {
      doc.parseAll(); // 87 块全解，模拟「一路滚到底」
    } catch (e) {
      console.log(
        `${(leak ? '只解不释放' : '有 dispose').padEnd(14)} ${String(i).padStart(3)}   ` +
          `✗ ${String(e.message || e).slice(0, 40)}（撞上 wasm 2 GB 上限）`,
      );
      return { crashed: i };
    }
    const ms = Math.round(performance.now() - t0);
    if (!leak) doc.dispose();
    else keep.push(doc);

    // 先把 JS 侧的临时对象（行索引、items 数组这些）回收掉再测 —— 否则量到的是
    // 还没被 V8 复用的堆，不是 wasm 里的树。没有 --expose-gc 时跳过。
    globalThis.gc?.();

    const now = rss();
    const row = { leak, round: i, rss: now, delta: now - base, step: now - prev, ms };
    table.push(row);
    prev = now;
    console.log(
      `${(leak ? '只解不释放' : '有 dispose').padEnd(14)} ${String(i).padStart(3)}   ` +
        `${String(now).padStart(4)}   ${(row.delta >= 0 ? '+' : '') + row.delta} MB`.padEnd(12) +
        `   ${(row.step >= 0 ? '+' : '') + row.step} MB`.padEnd(10) +
        `  ${ms} ms`,
    );
  }
  return {};
}

run(false);
console.log('');
const crashed = run(true);

const ok = table.filter((r) => !r.leak);
const leakRows = table.filter((r) => r.leak);

/*
 * 判定只看「第一份文档之后还涨不涨」。
 *
 * 两组都要为第一份付一次约 +400 MB 的成本，所以最终 RSS 的绝对值不是信号 ——
 * 真正的信号是它之后每多开一次是不是又多一整份。
 *
 * 不要用绝对阈值（原来写的是 `delta > 800`）：同一份代码连跑两次，RSS 能差 200 MB 以上
 * （V8 的堆复用、OS 回收、wasm memory.grow 的取整都不确定），阈值卡死了就会误报。
 */
const dispGrowth = ok.length > 1 ? ok.at(-1).delta - ok[0].delta : 0;
const dispDrift =
  ok.length > 1 ? Math.max(...ok.slice(1).map((r) => Math.abs(r.delta - ok[0].delta))) : 0;
const leakGrowth = leakRows.length > 1 ? leakRows.at(-1).delta - leakRows[0].delta : 0;
const extraRounds = Math.max(1, leakRows.length - 1);

console.log('\n结论');
if (!ok.length) {
  console.log('  有 dispose：没有取到有效读数');
} else {
  console.log(
    `  有 dispose：第 1 轮抬到 +${ok[0].delta} MB 后**不再增长**` +
      `（各轮相对它的偏移 ≤ ${dispDrift} MB，第 1 轮之后净变化 ${dispGrowth >= 0 ? '+' : ''}${dispGrowth} MB）`,
  );
}
if (crashed.crashed) {
  console.log(`  只解不释放：第 ${crashed.crashed} 轮撞上 wasm 2 GB 上限（Aborted）`);
} else if (leakRows.length > 1) {
  console.log(
    `  只解不释放：第 1 轮之后又涨了 +${leakGrowth} MB，` +
      `平均每多开一次 +${Math.round(leakGrowth / extraRounds)} MB`,
  );
}

const pass = Boolean(crashed.crashed) || (dispGrowth < 60 && leakGrowth > 150);
console.log(
  pass
    ? '  ✓ dispose 生效：第一份之后不再增长，与「不释放」是两种曲线'
    : '  ✗ dispose 没生效（要么有 dispose 也在涨，要么不释放的没体现出增长）',
);
process.exit(pass ? 0 : 1);
