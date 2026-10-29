/**
 * Web Component：一行标签就能用，不挑构建工具。
 *
 * 这段 JS 只做两件事：注册 <json-explorer>、告诉它 wasm 在哪。
 * 之后页面里写标签就行 —— 后端模板（PHP / Rails / Django / Thymeleaf）也能直接上。
 */
import { JsonExplorerElement } from '@fagao-ai/jsonlens-element';
// ⚠️ 这一行不能省。Vite 的 lib 模式会把 CSS 抽成独立文件、JS 里**不留引用**，
// 所以 `import '@fagao-ai/jsonlens-element'` 不会自动带样式。
// 走 no-bundler 路线（CDN / <script type="module">）时，等价写法是
//   <link rel="stylesheet" href=".../jsonlens-element/dist/style.css">
import '@fagao-ai/jsonlens-element/style.css';
import runtimeWasm from '@fagao-ai/jsonlens/tree-sitter.wasm?url';
import languageWasm from '@fagao-ai/jsonlens/tree-sitter-json.wasm?url';
import { hugeSample } from './sample.js';
import './shared.css';

// 纯 HTML 没法传对象，wasm 地址在类上配一次
JsonExplorerElement.wasmUrl = { runtime: runtimeWasm, language: languageWasm };

const el = document.getElementById('viewer');
const out = document.getElementById('out');

// 所有事件都是冒泡的 CustomEvent，document 上就能监听
// timingSuffix 同理：空闲补解析会不停发 stats，不带上就把它自己那行数字顶掉了
let timingSuffix = '';
document.addEventListener('stats', (e) => {
  const s = e.detail;
  const mode = s.mode === 'chunked' ? `分块 ${s.chunks.parsed}/${s.chunks.total}` : '整棵';
  out.textContent = `${(s.chars / 1048576).toFixed(2)} MB · ${s.lines} 行 · ${mode}${timingSuffix}`;
});

document.getElementById('huge').onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = '生成 24 MB…';
  await new Promise((r) => setTimeout(r, 0));
  const t0 = performance.now();
  await el.load(hugeSample(24), { title: 'huge.json' });
  const ms = Math.round(performance.now() - t0);
  timingSuffix = ` · 载入 ${ms}ms`;
  out.dataset.loadedMs = String(ms);
  out.textContent = `24 MB · 载入 ${ms}ms`;
  btn.disabled = false;
  btn.textContent = '载入 24 MB';
};

document.getElementById('theme').onclick = () => {
  const dark = el.getAttribute('theme') !== 'dark';
  el.setAttribute('theme', dark ? 'dark' : 'light');
  document.body.dataset.theme = dark ? 'dark' : 'light';
};
