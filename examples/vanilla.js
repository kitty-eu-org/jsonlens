/**
 * 原生 JS（或任意框架里都能用）：拿到一个 DOM 元素，直接 createExplorer。
 *
 * 这里演示的是「最贴近真实项目」的 wasm 给法：
 * 用打包器的 `?url` 把两个 wasm 变成 URL，打包时它们会被当资源发出去。
 * 这样 JS 和 wasm 的路径关系由构建工具保证，不用手工拷 public/。
 */
import 'jsonlens/style.css';
import { createExplorer } from 'jsonlens';
import runtimeWasm from 'jsonlens/tree-sitter.wasm?url';
import languageWasm from 'jsonlens/tree-sitter-json.wasm?url';
import { brokenSample, hugeSample, smallSample } from './sample.js';
import './shared.css';

const host = document.getElementById('host');
const out = document.getElementById('out');
const themeBtn = document.getElementById('theme');

const explorer = createExplorer(host, {
  wasmUrl: { runtime: runtimeWasm, language: languageWasm },
  title: 'sample.json',
  expandDepth: 2,
  chunkThreshold: 64_000,
});

// 事件是纯回调，不需要框架的更新机制
// 注意 timingSuffix：空闲补解析会不停发 stats，如果把「载入 XXXms」直接写进 textContent，
// 几十毫秒后就被下一批 stats 刷掉了 —— 这行字正是这个 demo 想给人看的数字，得留住。
let timingSuffix = '';
explorer.on('stats', (s) => {
  const size = (s.chars / 1048576).toFixed(2);
  const mode = s.mode === 'chunked' ? `分块 ${s.chunks.parsed}/${s.chunks.total}` : '整棵';
  const timing = s.paintMs != null ? ` · 解析 ${s.parseMs}ms 渲染 ${s.paintMs}ms` : '';
  out.textContent = `${size} MB · ${s.lines} 行 · ${mode}${timing}${timingSuffix}`;
});

document.getElementById('small').onclick = () => {
  timingSuffix = '';
  delete out.dataset.loadedMs;
  explorer.load(smallSample(), { title: 'small.json' });
};
document.getElementById('broken').onclick = () => {
  timingSuffix = '';
  delete out.dataset.loadedMs;
  explorer.load(brokenSample(), { title: 'broken.json' });
};
document.getElementById('huge').onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = '生成 24 MB…';
  delete out.dataset.loadedMs;
  // 让浏览器先画一帧，否则按钮文案不会更新
  await new Promise((r) => setTimeout(r, 0));
  const text = hugeSample(24);
  const t0 = performance.now();
  const r = await explorer.load(text, { title: 'huge.json' });
  // 这里量的是「点击到首屏可见」的墙钟时间，包含生成字符串
  const ms = Math.round(performance.now() - t0);
  const detail = `24 MB · 载入 ${ms}ms（解析 ${r.parseMs}ms / 渲染 ${r.paintMs}ms）`;
  // data-* 是给冒烟测试用的：文字会被后续 stats 覆盖，属性不会
  out.dataset.loadedMs = String(ms);
  timingSuffix = ` · ${detail}`;
  out.textContent = detail;
  btn.disabled = false;
  btn.textContent = '载入 24 MB';
};
document.getElementById('expand').onclick = () => explorer.expandTo(3);
document.getElementById('collapse').onclick = () => explorer.collapseAll();

let dark = false;
themeBtn.onclick = () => {
  dark = !dark;
  document.body.dataset.theme = dark ? 'dark' : 'light';
  explorer.setTheme(dark ? 'dark' : 'light');
};

await explorer.load(smallSample(), { title: 'small.json' });
