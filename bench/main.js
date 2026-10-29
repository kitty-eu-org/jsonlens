/**
 * Benchmark 调度器。
 *
 * URL: ?v=<impl>&d=<small|mid|big>
 *
 * 计时口径（尽量公平）：
 *   t0 —— 数据已经拿到、库已经加载完、页面已静置两帧之后
 *   t1 —— mount() 返回且 DOM 已提交
 *   mountMs = t1 - t0   ← 主要指标：从「拿到文本」到「树渲染出来」
 *   paintMs —— 再过一帧，确保真的画到屏幕上
 *
 * 关于 initMs：本项目的 wasm 初始化放在 t0 之前，和其他库的 import 同一阶段，
 * 不计入 mountMs；但会单独给出 initMs，读者可以自己算「总耗时 = initMs + mountMs」。
 *
 * 关于 parseMs：为了看清时间到底花在哪，这里在 mount 期间临时包一层 JSON.parse
 * 记下它的累计耗时。本项目的实现根本不调 JSON.parse，所以在它是 0——
 * 这恰好是「25 MB 为什么能秒开」的答案。
 */

const q = new URLSearchParams(location.search);
const implName = q.get('v') || 'ours';
const dataName = q.get('d') || 'small';
const bar = document.getElementById('bar');
const root = document.getElementById('root');

const longTasks = [];
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push(Math.round(e.duration));
  }).observe({ entryTypes: ['longtask'] });
} catch {
  /* 不支持就算了 */
}

bar.textContent = `${implName} · ${dataName} · 加载数据…`;

const res = await fetch(`./data/${dataName}.json`);
const text = await res.text();
const bytes = text.length;
bar.textContent = `${implName} · ${dataName} · ${(bytes / 1024 / 1024).toFixed(2)} MB · 加载库…`;

const impl = await (async () => {
  const mods = import.meta.glob('./impl/*.js');
  const load = mods[`./impl/${implName}.js`];
  if (!load) throw new Error(`未知的实现：${implName}`);
  return load();
})();

let initMs = 0;
if (impl.init) {
  const ti = performance.now();
  await impl.init();
  initMs = Math.round(performance.now() - ti);
}

// 让浏览器把首帧画出来、GC 稳定一下，再开始计时
await new Promise((r) => requestAnimationFrame(r));
await new Promise((r) => requestAnimationFrame(r));
longTasks.length = 0; // 前面的噪声不计入

bar.textContent = `${implName} · ${dataName} · 渲染中…`;

// ---- 给 JSON.parse 打点 ----
let parseMs = 0;
let parseCalls = 0;
const rawParse = JSON.parse;
JSON.parse = function patched(source, reviver) {
  const t = performance.now();
  try {
    return rawParse.call(this, source, reviver);
  } finally {
    parseMs += performance.now() - t;
    parseCalls++;
  }
};

const t0 = performance.now();
let err = null;
try {
  await impl.mount(root, text);
} catch (e) {
  err = String((e && e.message) || e);
} finally {
  JSON.parse = rawParse;
}
const mountMs = performance.now() - t0;

// 双 rAF：第二个 rAF 被调用时，说明第一帧已经真的画到屏幕上了。
// 只等一个 rAF 是不够的——它在绘制之前就回调，会低估「DOM 多到排版爆炸」那类库的代价。
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const paintMs = performance.now() - t0;

// 给 PerformanceObserver 的 longtask 回调一点派发时间，否则读到的是空数组
await new Promise((r) => setTimeout(r, 80));

const domNodes = root.querySelectorAll('*').length;
const visibleText = root.textContent.length;
// 分治看一下 DOM 花在哪（代码区 vs JSON 区）；放在计时之后，遍历本身不计入
const domCode = root.querySelector('.vhighlight')?.querySelectorAll('*').length ?? 0;
const domJson = root.querySelector('.ours-json')?.querySelectorAll('*').length ?? 0;

// 强制回收一次再读内存，否则测到的是没来得及回收的垃圾
if (typeof window.gc === 'function') {
  try {
    window.gc();
  } catch {
    /* 忽略 */
  }
}
const heap = performance.memory ? performance.memory.usedJSHeapSize : null;

window.__result = {
  impl: implName,
  label: impl.label || implName,
  data: dataName,
  bytes,
  initMs,
  parseMs: Math.round(parseMs),
  parseCalls,
  renderMs: Math.round(mountMs - parseMs),
  mountMs: Math.round(mountMs),
  paintMs: Math.round(paintMs),
  domNodes,
  domCode,
  domJson,
  visibleText,
  heapMB: heap ? Math.round(heap / 1024 / 1024) : null,
  longTasks,
  maxLongTask: longTasks.length ? Math.max(...longTasks) : 0,
  totalBlocking: longTasks.reduce((a, b) => a + Math.max(0, b - 50), 0),
  phases: window.__phases ?? null,
  err,
};

bar.textContent = `${impl.label || implName} · ${dataName} · ${window.__result.mountMs}ms · ${domNodes} DOM`;
