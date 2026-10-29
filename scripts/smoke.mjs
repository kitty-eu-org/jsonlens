/**
 * 打包产物的冒烟测试。
 *
 * 目标不是测功能，而是测「发布出去的东西还能不能跑」—— 这类问题只有把
 * 构建产物真正在浏览器里跑一遍才暴露得出来（wasm 404、CSS 没抽出来、
 * exports 路径写错、CJS/ESM 混用……）。
 *
 *   node scripts/smoke.mjs
 *
 * 服务 dist-examples/ 和 dist/（即四个框架示例 + playground），逐页打开，
 * 断言：有渲染出来的行、没有 console error、没有 pageerror。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 5186;
const BASE = `http://localhost:${PORT}`;

const EXEC = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(ROOT, url);
    if (url.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        // wasm 要能走 instantiateStreaming
        'cache-control': 'no-store',
      });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/** 页面级断言：等行数出现 */
async function expectRows(page, selector, label) {
  try {
    await page.waitForFunction(
      (sel) => document.querySelectorAll(sel).length > 2,
      selector,
      { timeout: 8000 },
    );
  } catch {
    const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, selector);
    throw new Error(`${label}: 没渲染出行（${selector} 命中 ${n} 个）`);
  }
  return page.evaluate((sel) => document.querySelectorAll(sel).length, selector);
}

const pages = [
  { url: '/dist-examples/index.html', label: 'examples 首页', check: null },
  { url: '/dist-examples/vanilla.html', label: '原生', check: '.jl-json .jrow' },
  { url: '/dist-examples/react.html', label: 'React', check: '.jl-json .jrow' },
  { url: '/dist-examples/vue.html', label: 'Vue', check: '.jl-json .jrow' },
  { url: '/dist-examples/element.html', label: 'Web Component', check: '.jl-json .jrow' },
  { url: '/dist/index.html', label: 'playground', check: '#jsonview .jrow' },
];

const server = await serve();
const browser = await chromium.launch({ executablePath: EXEC });
const results = [];
let failed = 0;

for (const p of pages) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    // 「Failed to load resource」不带 URL，重复且没信息量；具体路径由下面的 response 监听给出
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
      errors.push(`console: ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });

  const started = Date.now();
  try {
    await page.goto(BASE + p.url, { waitUntil: 'load', timeout: 15000 });
    let rows = 0;
    if (p.check) rows = await expectRows(page, p.check, p.label);
    const ms = Date.now() - started;
    results.push({ label: p.label, rows, ms, errors, ok: errors.length === 0 });
    if (errors.length) failed++;
  } catch (err) {
    results.push({ label: p.label, error: String(err.message || err), errors, ok: false });
    failed++;
  } finally {
    await ctx.close().catch(() => {});
  }
}

/* ---- 大文件：只在原生页点一次 24 MB，确认分块路径在产物里也能跑 ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  try {
    await page.goto(`${BASE}/dist-examples/vanilla.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.jl-json .jrow').length > 2, null, {
      timeout: 10000,
    });
    const t0 = Date.now();
    await page.click('#huge');
    // 断言 #out.dataset.loadedMs 而不是那行文字：空闲补解析会不停发 stats，
    // 文字会被刷掉（测试就成了看运气），data-* 不会被刷。
    await page.waitForFunction(() => document.getElementById('out').dataset.loadedMs != null, null, {
      timeout: 60000,
    });
    const text = await page.textContent('#out');
    const ms = await page.evaluate(() => Number(document.getElementById('out').dataset.loadedMs));
    const rows = await page.evaluate(() => document.querySelectorAll('.jl-json .jrow').length);
    results.push({
      label: '原生 · 24 MB',
      rows,
      ms: Date.now() - t0,
      note: `载入 ${ms}ms · ${text.slice(0, 80)}`,
      errors,
      ok: !errors.length,
    });
    if (errors.length) failed++;
  } catch (err) {
    results.push({ label: '原生 · 24 MB', error: String(err.message || err), errors, ok: false });
    failed++;
  } finally {
    await ctx.close().catch(() => {});
  }
}

/* ---- 交互：折叠 / 展开 / 语法树 twist / hover 高亮 ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
      errors.push(`console: ${m.text()}`);
    }
  });

  // 折叠只是把 .jchildren 设成 display:none，DOM 不会减少 —— 所以要数「可见行」
  const visible = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('.jl-json .jrow')].filter((el) => el.offsetParent !== null)
          .length,
    );

  try {
    await page.goto(`${BASE}/dist-examples/vanilla.html`, { waitUntil: 'load' });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.jl-json .jrow')].filter((el) => el.offsetParent !== null)
          .length > 2,
      null,
      { timeout: 10000 },
    );
    const r0 = await visible();

    await page.evaluate(() => document.getElementById('expand').click());
    await page.waitForFunction(
      (n) =>
        [...document.querySelectorAll('.jl-json .jrow')].filter((el) => el.offsetParent !== null)
          .length > n,
      r0 + 2,
      { timeout: 10000 },
    );
    const rExpanded = await visible();

    await page.evaluate(() => document.querySelector('.jl-json .jrow .jtwist').click());
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.jl-json .jrow')].filter((el) => el.offsetParent !== null)
          .length === 1,
      null,
      { timeout: 10000 },
    );
    const rCollapsed = await visible();

    await page.evaluate(() => document.querySelector('.jl-json .jrow .jtwist').click());
    await page.waitForFunction(
      (n) =>
        [...document.querySelectorAll('.jl-json .jrow')].filter((el) => el.offsetParent !== null)
          .length >= n,
      rExpanded,
      { timeout: 10000 },
    );
    const rReopened = await visible();

    // 语法树 tab：twist 走的是容器委托，点一下必须真的把 .children 藏起来
    await page.evaluate(() => document.querySelector('[data-tab="tree"]').click());
    await page.waitForFunction(() => document.querySelectorAll('.jl-tree .row').length > 2, null, {
      timeout: 10000,
    });
    await page.evaluate(() => {
      const tw = [...document.querySelectorAll('.jl-tree .twist')].find(
        (t) => t.textContent === '▾',
      );
      tw.click();
    });
    const treeDisplay = await page.evaluate(() => {
      const el = document.querySelector('.jl-tree .children.collapsed');
      return el ? getComputedStyle(el).display : 'missing';
    });

    // hover 一行 → 左侧源码要有 .hl span（同样是委托）
    await page.evaluate(() => {
      document
        .querySelectorAll('.jl-tree .row')[3]
        ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await page.waitForTimeout(150);
    const hl = await page.evaluate(() => document.querySelectorAll('.jl-pre .hl').length);

    const ok =
      rExpanded > r0 && rCollapsed === 1 && rReopened >= rExpanded && treeDisplay === 'none' && hl > 0;
    results.push({
      label: '交互 · 折叠展开',
      rows: rExpanded,
      ms: 0,
      note:
        `可见行 ${r0}→${rExpanded}→${rCollapsed}→${rReopened} · ` +
        `语法树折叠 ${treeDisplay}${treeDisplay === 'none' ? ' ✓' : ' ✗'} · hover 高亮 ${hl} span`,
      errors,
      ok: ok && !errors.length,
    });
    if (!results.at(-1).ok) failed++;
  } catch (err) {
    results.push({
      label: '交互 · 折叠展开',
      error: String(err.message || err),
      errors,
      ok: false,
    });
    failed++;
  } finally {
    await ctx.close().catch(() => {});
  }
}

/* ---- 故障注入：wasm 路径写错时，必须给出 error 事件而不是「未处理的拒绝」 ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // 用一个虚拟页面，直接 import dist 产物（顺带验证「裸浏览器 + importmap 能不能跑」）
  const html = `<!doctype html><meta charset="utf-8">
<div id="host" style="height:300px"></div>
<script type="importmap">
{"imports":{"web-tree-sitter":"/node_modules/web-tree-sitter/tree-sitter.js"}}
</script>
<script type="module">
window.__log = [];
addEventListener('unhandledrejection', (e) => {
  window.__log.push('unhandledrejection: ' + ((e.reason && e.reason.message) || e.reason));
});
const { createExplorer } = await import('/node_modules/@fagao-ai/jsonlens/dist/index.js');
const api = createExplorer(document.getElementById('host'), {
  wasmUrl: { runtime: '/__missing-runtime.wasm', language: '/__missing-json.wasm' },
});
api.on('error', (e) => window.__log.push('error: ' + ((e && e.message) || e)));
window.__log.push(await api.load('[1,2,3]').then(
  () => 'load-resolved',
  (e) => 'load-rejected: ' + ((e && e.message) || e),
));
</script>`;

  await page.route(`${BASE}/__fixture/error.html`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );

  try {
    await page.goto(`${BASE}/__fixture/error.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window.__log || []).length >= 2, null, { timeout: 15000 });
    const log = await page.evaluate(() => window.__log);
    const hasError = log.some((l) => l.startsWith('error: '));
    const hasReject = log.some((l) => l.startsWith('load-rejected: '));
    const unhandled = log.filter((l) => l.startsWith('unhandledrejection:'));
    results.push({
      label: '故障注入 · wasm 404',
      rows: 0,
      ms: 0,
      note:
        `error 事件${hasError ? '✓' : '✗'} / load 拒绝${hasReject ? '✓' : '✗'} / ` +
        `未处理拒绝${unhandled.length ? `✗ ${unhandled[0]}` : '无 ✓'}`,
      errors,
      ok: hasError && hasReject && !unhandled.length && !errors.length,
    });
    if (!results.at(-1).ok) failed++;
  } catch (err) {
    results.push({ label: '故障注入 · wasm 404', error: String(err.message || err), errors, ok: false });
    failed++;
  } finally {
    await ctx.close().catch(() => {});
  }
}

/* ---- 事件契约：index.d.ts 里 ExplorerEvents 声明的事件，必须真的收得到 ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/node_modules/@fagao-ai/jsonlens/dist/style.css">
<div id="host" style="height:400px"></div>
<script type="importmap">
{"imports":{"web-tree-sitter":"/node_modules/web-tree-sitter/tree-sitter.js"}}
</script>
<script type="module">
window.__log = [];
const { createExplorer } = await import('/node_modules/@fagao-ai/jsonlens/dist/index.js');
const api = createExplorer(document.getElementById('host'));
window.__api = api;
for (const t of ['load','hover','select','tabchange']) {
  api.on(t, (p) => window.__log.push(t + ':' + (p && typeof p === 'object' ? (p.start ?? JSON.stringify(p).slice(0,40)) : String(p))));
}
await api.load('{"a":{"b":[1,2,3]},"c":"x"}');
window.__log.push('ready');
</script>`;

  await page.route(`${BASE}/__fixture/events.html`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );

  try {
    await page.goto(`${BASE}/__fixture/events.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window.__log || []).includes('ready'), null, { timeout: 15000 });

    // 悬停一个 JSON 行 → hover
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.jl-json .jrow')][1];
      row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    // 点标量行的正文（不是 twist）→ select
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.jl-json .jrow')].find((r) =>
        r.querySelector('.jstr'),
      );
      row?.querySelector('.jstr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.evaluate(() => window.__api.setTab('tree'));
    await page.waitForTimeout(200);

    const log = await page.evaluate(() => window.__log);
    const names = ['load', 'hover', 'select', 'tabchange'];
    const hit = (t) => log.some((l) => l.startsWith(t + ':'));
    results.push({
      label: '事件契约 · 4 个',
      rows: 0,
      ms: 0,
      note: names.map((t) => `${t}${hit(t) ? '✓' : '✗'}`).join(' ') +
        (names.every(hit) ? '' : ` · 实际收到 ${log.join(' | ').slice(0, 90)}`),
      errors,
      ok: names.every(hit) && !errors.length,
    });
    if (!results.at(-1).ok) failed++;
  } catch (err) {
    results.push({ label: '事件契约 · 4 个', error: String(err.message || err), errors, ok: false });
    failed++;
  } finally {
    await ctx.close().catch(() => {});
  }
}

/* ---- element 的失败路径：value 属性 + wasm 404，不能甩出未处理的拒绝 ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // 这个用例同时钉两件事：
  //   1. 标签写在 HTML 里 + `await import()` 之后才写 wasmUrl —— 组件必须读到这份配置
  //      （原来用 queueMicrotask 延后，模块求值结束时微任务就被清空了，配置根本没生效）；
  //   2. 失败之后只能有 loaderror，不能有「未处理的 Promise 拒绝」。
  const html = `<!doctype html><meta charset="utf-8">
<json-explorer value='{"a":1}' style="height:300px"></json-explorer>
<script type="importmap">
{"imports":{
  "web-tree-sitter":"/node_modules/web-tree-sitter/tree-sitter.js",
  "@fagao-ai/jsonlens":"/node_modules/@fagao-ai/jsonlens/dist/index.js"
}}
</script>
<script type="module">
window.__log = [];
addEventListener('unhandledrejection', (e) => {
  window.__log.push('unhandledrejection: ' + ((e.reason && e.reason.message) || e.reason));
});
document.addEventListener('loaderror', (e) =>
  window.__log.push('loaderror: ' + ((e.detail && e.detail.message) || e.detail)));
const { JsonExplorerElement } = await import('/node_modules/@fagao-ai/jsonlens-element/dist/index.js');
// 故意在 import 之后才配：这就是 README 里教的写法
JsonExplorerElement.wasmUrl = { runtime: '/__nope-runtime.wasm', language: '/__nope-json.wasm' };
await new Promise((r) => setTimeout(r, 800));
window.__log.push('done');
</script>`;

  await page.route(`${BASE}/__fixture/el-error.html`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );

  try {
    await page.goto(`${BASE}/__fixture/el-error.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window.__log || []).includes('done'), null, { timeout: 15000 });
    const log = await page.evaluate(() => window.__log);
    const unhandled = log.filter((l) => l.startsWith('unhandledrejection:'));
    const seen = log.filter((l) => l.startsWith('loaderror:'));
    results.push({
      label: '故障注入 · element',
      rows: 0,
      ms: 0,
      note: `loaderror${seen.length ? '✓' : '✗'} / 未处理拒绝${unhandled.length ? `✗ ${unhandled[0].slice(0, 70)}` : '无 ✓'}`,
      errors,
      ok: seen.length > 0 && !unhandled.length && !errors.length,
    });
    if (!results.at(-1).ok) failed++;
  } catch (err) {
    results.push({ label: '故障注入 · element', error: String(err.message || err), errors, ok: false });
    failed++;
  } finally {
    await ctx.close().catch(() => {});
  }
}

await browser.close();
server.close();


/* ---- 报告 ---- */
console.log('');
for (const r of results) {
  const mark = r.ok ? '✓' : '✗';
  const detail = r.error ? r.error : `${r.rows} 行 · ${r.ms}ms${r.note ? ` · ${r.note}` : ''}`;
  console.log(`${mark} ${r.label.padEnd(16, ' ')} ${detail}`);
  for (const e of r.errors || []) console.log(`    ${e}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
