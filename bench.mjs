/**
 * 纯解析基准测试（不含 DOM），用来区分「解析」和「渲染」谁才是瓶颈。
 *
 *   node bench.mjs /path/to/large.json
 */
import { readFileSync } from 'node:fs';
import { Parser, Language, Query } from 'web-tree-sitter';

const dir = new URL('.', import.meta.url).pathname;
const file = process.argv[2] ?? new URL('./package.json', import.meta.url).pathname;

await Parser.init({ locateFile: () => dir + 'public/tree-sitter.wasm' });
const lang = await Language.load(dir + 'public/tree-sitter-json.wasm');

const src = readFileSync(file, 'utf8');
console.log(`文件: ${file}\n大小: ${(src.length / 1024 / 1024).toFixed(1)} M 字符`);

const parser = new Parser();
parser.setLanguage(lang);

// 1) 全量解析
let tree;
let best = Infinity;
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  tree = parser.parse(src);
  const ms = performance.now() - t0;
  best = Math.min(best, ms);
  console.log(`  全量解析 #${i + 1}: ${ms.toFixed(0)} ms`);
}
console.log(`→ 全量最快: ${best.toFixed(0)} ms`);

// 2) 节点统计
let t0 = performance.now();
let count = 0;
let depth = 0;
const stack = [[tree.rootNode, 0]];
while (stack.length) {
  const [n, d] = stack.pop();
  count++;
  if (d > depth) depth = d;
  for (let i = 0; i < n.childCount; i++) stack.push([n.child(i), d + 1]);
}
console.log(
  `节点: ${count.toLocaleString()}  深度: ${depth}  遍历耗时: ${(performance.now() - t0).toFixed(0)} ms`,
);
console.log(`语法合法: ${!tree.rootNode.hasError}`);

// 3) 增量解析（中间插一个字符）
const idx = Math.floor(src.length / 2);
const src2 = src.slice(0, idx) + ' ' + src.slice(idx);
t0 = performance.now();
tree.edit({
  startIndex: idx,
  oldEndIndex: idx,
  newEndIndex: idx + 1,
  startPosition: { row: 0, column: 0 },
  oldEndPosition: { row: 0, column: 0 },
  newEndPosition: { row: 0, column: 0 },
});
const tree2 = parser.parse(src2, tree);
console.log(`增量解析（中间插 1 字符）: ${(performance.now() - t0).toFixed(1)} ms`);

// 4) 取一个可视窗口的 token（窗口化渲染的成本）
const query = new Query(
  lang,
  `
(pair key: (string) @key)
(string) @string
(number) @number
(true) @bool
(false) @bool
(null) @null
"," @punct
":" @punct
"{" @punct
"}" @punct
"[" @punct
"]" @punct
`,
);
let lines = 1;
for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) lines++;
const mid = Math.floor(lines / 2);
t0 = performance.now();
const caps = query.captures(tree2.rootNode, {
  startPosition: { row: mid, column: 0 },
  endPosition: { row: mid + 40, column: 0 },
});
console.log(
  `取 40 行可视窗口: ${caps.length.toLocaleString()} 个 capture, ${(performance.now() - t0).toFixed(1)} ms`,
);
