import { Query } from 'web-tree-sitter';
import { initWasm } from '@jsonlens/core';
import {
  ChunkedDoc,
  CHUNK_THRESHOLD,
  Highlighter,
  JSON_QUERY,
  LINE_HEIGHT,
  JsonView,
  diffEdit,
  renderTree,
} from '@jsonlens/core/engines';
import { SAMPLES, buildBigSample } from './samples.js';

const BASE = import.meta.env.BASE_URL;

const codeEl = document.getElementById('code');
const hlEl = document.getElementById('highlight');
const treeEl = document.getElementById('tree');
const jsonEl = document.getElementById('jsonview');
const statsEl = document.getElementById('stats');
const statusEl = document.getElementById('status');
const bootEl = document.getElementById('boot');
const fileEl = document.getElementById('file');
const fileNameEl = document.getElementById('filename');
const editorPane = document.getElementById('editor');
const paneHint = document.getElementById('paneHint');
const jsonActions = document.getElementById('jsonActions');
const viewerEl = document.getElementById('viewer');
const vHlEl = document.getElementById('vhighlight');
const editBtn = document.getElementById('editBtn');
const modeBadge = document.getElementById('modeBadge');

/** @type {import('web-tree-sitter').Parser} */
let parser = null;
/** @type {Highlighter} */
let hl = null;
/** @type {JsonView} */
let jsonView = null;
/** @type {import('web-tree-sitter').Tree | null} */
let tree = null;
let prevSource = '';
let treeView = null;

let mode = 'edit';          // 'edit' | 'view'（view = 大文件只读预览，不经过 textarea）
let viewerHl = null;
let viewerSource = '';
let viewerMaxLen = 0;
let chWidth = 0;
/** @type {ChunkedDoc | null} 大文件的分块文档（按需解析） */
let chunked = null;

let activeTab = 'json';   // 'json' | 'tree'
let jsonDirty = true;
let treeDirty = true;
let jsonTimer = 0;

const BIG_FILE = 800_000;   // 超过这个字符数就跳过全量节点统计（遍历一遍要 1s+）
// 超过这个字符数改用只读预览：26MB 塞进 textarea 光排版就要 1.1s。
// 同时它也是「要不要分块懒解析」的分界线 —— 全量解析约 90ms/MB，
// 分块路径的固定开销约 30ms 且不随文件增长，两者在 300~400KB 附近交叉。
const VIEWER_FILE = CHUNK_THRESHOLD;

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */
async function boot() {
  // 1) wasm 运行时 + JSON 语法（两件事都在 core 里，这里只给它指路）
  //    demo 把 wasm 放在 public/，所以直接给 BASE_URL 当目录。
  const { parser: sharedParser, language } = await initWasm({ wasmUrl: BASE });

  parser = sharedParser;

  // 2) 一次 query 拿到所有 token 类型，比遍历语法树手写 switch 快
  const query = new Query(language, JSON_QUERY);
  hl = new Highlighter(hlEl, query);
  // 只读预览：窗口按内容坐标摆放，由外层滚动容器负责滚
  viewerHl = new Highlighter(vHlEl, query, { contentPositioned: true });

  // 3) 右侧面板：JSON 结构视图（默认）
  jsonView = new JsonView(jsonEl, {
    onHover: setRangeHighlight,
    onSelect: selectRange,
  });

  bootEl.classList.add('hidden');
  setSource(SAMPLES.basic, { name: 'source.json' });
  switchTab('json');
  bindEvents();
}

/* ------------------------------------------------------------------ */
/* 解析 + 渲染                                                         */
/* ------------------------------------------------------------------ */
function countNodes(root) {
  let count = 0;
  let errors = 0;
  let maxDepth = 0;
  const stack = [[root, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop();
    count++;
    if (depth > maxDepth) maxDepth = depth;
    if (node.type === 'ERROR' || node.isMissing) errors++;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) stack.push([child, depth + 1]);
    }
  }
  return { count, errors, maxDepth };
}

const activeHl = () => (mode === 'view' ? viewerHl : hl);
const scroller = () => (mode === 'view' ? viewerEl : codeEl);

function run({ full = false } = {}) {
  const src = mode === 'view' ? viewerSource : codeEl.value;

  // ---- 分块文档：根本没有「整棵树」，高亮器按窗口自己去对应的块里取 ----
  if (chunked) {
    prevSource = src;
    const h = activeHl();
    const sc = scroller();
    h.update(src, chunked);
    if (mode === 'view') layoutViewer();
    const r = h.render(sc.scrollTop, sc.scrollLeft, sc.clientHeight, true, sc.clientWidth);

    treeDirty = true;
    jsonDirty = true;
    refreshActivePanel();
    renderStats({
      renderMs: r.ms,
      tokens: r.tokens,
      lines: h.lineCount,
      bytes: src.length,
      chunks: { parsed: chunked.parsedChunks, total: chunked.chunks.length },
    });
    return { parseMs: 0, renderMs: r.ms };
  }

  const canIncremental = !full && tree !== null;

  // ---- 解析 ----
  const tParse = performance.now();
  let next;
  let edit = null;
  if (canIncremental) {
    edit = diffEdit(prevSource, src);
    if (!edit) return;
    tree.edit(edit);
    next = parser.parse(src, tree);
  } else {
    next = parser.parse(src);
  }
  const parseMs = performance.now() - tParse;
  if (!next) return;

  tree = next;
  prevSource = src;

  // ---- 高亮（只画可视窗口；有 edit 时行索引也只重算局部）----
  const h = activeHl();
  const sc = scroller();
  h.update(src, tree.rootNode, edit);
  if (mode === 'view') layoutViewer();
  const r = h.render(sc.scrollTop, sc.scrollLeft, sc.clientHeight, true, sc.clientWidth);

  // ---- 右侧面板 ----
  treeDirty = true;
  jsonDirty = true;
  refreshActivePanel();

  // ---- 统计 ----
  const big = src.length > BIG_FILE;
  const info = big ? null : countNodes(tree.rootNode);
  if (import.meta.env.DEV) {
    window.__ts = window.__ts ?? {};
    window.__ts.lastRun = { parseMs, renderMs: r.ms, tokens: r.tokens, mode: canIncremental ? 'incremental' : 'full' };
  }
  renderStats({
    parseMs,
    renderMs: r.ms,
    tokens: r.tokens,
    mode: canIncremental ? '增量' : '全量',
    lines: h.lineCount,
    nodes: info ? info.count : null,
    depth: info ? info.maxDepth : null,
    errors: info ? info.errors : null,
    bytes: src.length,
    hasError: tree.rootNode.hasError,
  });

  return { parseMs, renderMs: r.ms };
}

/* ------------------------------------------------------------------ */
/* 统计栏                                                              */
/* ------------------------------------------------------------------ */
const fmt = (n) => n.toLocaleString('en-US');
const ms = (v) => (v < 10 ? v.toFixed(2) : v < 1000 ? v.toFixed(0) : (v / 1000).toFixed(2) + 's');

function renderStats({
  parseMs,
  renderMs,
  tokens,
  mode,
  lines,
  nodes,
  depth,
  errors,
  bytes,
  hasError,
  chunks,
}) {
  const parts = [];

  if (chunks) {
    const all = chunks.parsed >= chunks.total;
    parts.push(
      `<span class="chip ${all ? 'ok' : ''}" data-chunks="1" title="顶层按元素边界切成小块，只解析看得到的块，空闲时后台补其余">` +
        (all
          ? `全文 <b>${chunks.total}</b> 块已解析 ✓`
          : `<b>${chunks.parsed}</b>/${chunks.total} 块 · 按需解析`) +
        `</span>`,
    );
  } else {
    parts.push(`<span class="chip"><b>${ms(parseMs)}</b> 解析 · ${mode}</span>`);
  }

  parts.push(`<span class="chip ${renderMs > 40 ? 'warn' : ''}"><b>${ms(renderMs)}</b> 渲染 · ${fmt(tokens)} token</span>`);
  parts.push(`<span class="chip">行 <b>${fmt(lines)}</b></span>`);

  if (chunks) {
    // 分块模式下不做全量节点统计（要遍历 634 万节点）
  } else if (nodes !== null) {
    parts.push(`<span class="chip">节点 <b>${fmt(nodes)}</b></span>`);
    parts.push(`<span class="chip">深度 <b>${depth}</b></span>`);
  } else {
    parts.push(`<span class="chip" title="文件超过 ${fmt(BIG_FILE)} 字符，遍历一遍要 1s 以上，已跳过">节点 <b>—</b> 略</span>`);
  }

  if (!chunks) {
    parts.push(
      `<span class="chip ${hasError ? 'bad' : 'ok'}">${
        hasError ? `语法错误${errors !== null ? ` <b>${errors}</b>` : ''}` : '语法合法 ✓'
      }</span>`,
    );
  }

  statsEl.innerHTML = parts.join('');
  statusEl.textContent = `${fmt(bytes)} 字符`;
}

/* ------------------------------------------------------------------ */
/* 交互                                                                */
/* ------------------------------------------------------------------ */
function ensureVisible(range) {
  const h = activeHl();
  const el = scroller();
  const top = h.lineOf(range.start) * LINE_HEIGHT;
  const { scrollTop, clientHeight } = el;
  if (top < scrollTop + 10 || top > scrollTop + clientHeight - 40) {
    el.scrollTop = Math.max(0, top - clientHeight / 2);
  }
}

function setRangeHighlight(range) {
  const h = activeHl();
  const el = scroller();
  if (!range) {
    h.setActive(null);
    return;
  }
  ensureVisible(range);
  // 滚动到窗口外了就先重画，再上高亮
  h.render(el.scrollTop, el.scrollLeft, el.clientHeight, false, el.clientWidth);
  h.setActive(range);
}

function onTreeHover(range) {
  setRangeHighlight(range);
}

/** 点击树/JSON 视图里的节点 → 在编辑器里选中对应源码 */
function selectRange(range) {
  if (mode === 'view') {
    // 只读预览没有光标，就定位 + 高亮
    setRangeHighlight(range);
    return;
  }
  codeEl.focus();
  codeEl.setSelectionRange(range.start, range.end);
  ensureVisible(range);
  hl.setActive(null);
}

/* ------------------------------------------------------------------ */
/* 右侧面板：懒渲染（只画当前 tab）                                     */
/* ------------------------------------------------------------------ */
/** 右侧面板要的根节点：普通模式是语法树根，分块模式是鸭子类型的虚拟根 */
const panelRoot = () => (chunked ? chunked.rootNode : (tree?.rootNode ?? null));

function ensureTree() {
  const root = panelRoot();
  if (!root || !treeDirty) return;
  treeView = renderTree(treeEl, root, prevSource, {
    onHover: onTreeHover,
    onSelect: selectRange,
  });
  treeDirty = false;
}

function ensureJson() {
  const root = panelRoot();
  if (!root || !jsonDirty) return;
  jsonView.setData(root, prevSource);
  jsonDirty = false;
}

function refreshActivePanel({ immediate = false } = {}) {
  clearTimeout(jsonTimer);
  if (activeTab === 'tree') {
    ensureTree();
  } else if (immediate) {
    ensureJson();
  } else {
    // 打字时别每一帧都重建，压一压
    jsonTimer = setTimeout(ensureJson, 120);
  }
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  jsonEl.classList.toggle('active', tab === 'json');
  treeEl.classList.toggle('active', tab === 'tree');
  jsonActions.hidden = tab !== 'json';
  paneHint.textContent =
    tab === 'json' ? '滚到底自动加载 · 点击跳转源码' : '悬停高亮 · 点击选中节点 · 点箭头折叠';
  refreshActivePanel({ immediate: true });
}

function nodeAtCaret() {
  if (!tree) return null;
  const pos = codeEl.selectionStart;
  let node = tree.rootNode.descendantForIndex(pos, pos);
  while (node && !node.isNamed && node.parent) node = node.parent;
  return node;
}

function syncCaretSelection() {
  const node = nodeAtCaret();
  if (!node) return;
  const range = { start: node.startIndex, end: node.endIndex };
  setRangeHighlight(range);
  treeView?.setActive(range);
}

function showBoot(text) {
  bootEl.innerHTML = `<span class="spinner"></span>${text}`;
  bootEl.classList.remove('hidden');
}
function hideBoot() {
  bootEl.classList.add('hidden');
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** 等宽字体的单字符宽度。既用来撑横向滚动宽度，也喂给高亮器做横向裁剪 */
function measureChWidth() {
  if (chWidth) return chWidth;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:13px;line-height:20px';
  probe.style.fontFamily = getComputedStyle(codeEl).fontFamily;
  probe.textContent = '0'.repeat(50);
  document.body.appendChild(probe);
  chWidth = probe.getBoundingClientRect().width / 50;
  probe.remove();
  // 只有字符宽度真的变了才需要重新测，所以在这里同步一次就够
  if (hl) hl.charWidth = chWidth;
  if (viewerHl) viewerHl.charWidth = chWidth;
  return chWidth;
}

/** 撑出滚动条：预览层的总高 / 总宽 */
function layoutViewer() {
  const lines = viewerHl.lineCount;
  const w = Math.max(viewerMaxLen * measureChWidth() + 60, viewerEl.clientWidth);
  vHlEl.style.height = `${lines * LINE_HEIGHT + 16}px`;
  vHlEl.style.width = `${w}px`;
}

/**
 * 只读预览：不把全文塞进 textarea（26MB 光排版就要 1.1s），
 * 而是自己画可视窗口。root 可以是一棵完整的树，也可以是分块文档。
 */
function enterView(text, root = null) {
  mode = 'view';
  viewerSource = text;
  prevSource = text;

  document.getElementById('editor').hidden = true;
  viewerEl.hidden = false;
  modeBadge.hidden = false;
  editBtn.hidden = false;

  viewerHl.update(text, root);
  viewerMaxLen = viewerHl.maxLineLength();
  chWidth = 0;
  layoutViewer();
  viewerEl.scrollTop = 0;
  viewerEl.scrollLeft = 0;
  viewerHl.render(0, 0, viewerEl.clientHeight, true, viewerEl.clientWidth);
  statusEl.textContent = `${fmt(text.length)} 字符`;
  return viewerHl.stats;
}

/** 回到可编辑模式（这一步要把全文放进 textarea，大文件会卡一下） */
function enterEdit(text) {
  mode = 'edit';
  document.getElementById('editor').hidden = false;
  viewerEl.hidden = true;
  modeBadge.hidden = true;
  editBtn.hidden = true;

  const t = performance.now();
  codeEl.value = text;
  prevSource = text;
  hl.update(text, tree?.rootNode ?? null);
  hl.render(0, 0, codeEl.clientHeight, true, codeEl.clientWidth);
  if (import.meta.env.DEV) {
    window.__ts = window.__ts ?? {};
    window.__ts.lastAssign = Math.round(performance.now() - t);
  }
}

/* ------------------------------------------------------------------ */
/* 空闲后台补解析                                                       */
/* ------------------------------------------------------------------ */
const idle = (cb) =>
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback(cb, { timeout: 800 })
    : setTimeout(() => cb({ timeRemaining: () => 8 }), 40);
const cancelIdle = (h) =>
  typeof cancelIdleCallback === 'function' ? cancelIdleCallback(h) : clearTimeout(h);

let fillHandle = 0;
let filling = false;

/**
 * 首屏已经出来了，剩下的块在浏览器空闲时慢慢补。
 *
 * 试过「滚动时暂停补解析」，结果更差：块没预解析，滚动到新区域时要现场解，
 * 反而在滚动中插入 22ms 的解析停顿。让它在后台一直跑，滚动时块是热的，更顺。
 */
function startFill() {
  if (filling) return;
  filling = true;
  const step = () => {
    if (!filling) return;
    if (!chunked || chunked.done) {
      filling = false;
      fillHandle = 0;
      updateProgressChip();
      return;
    }
    chunked.primeNext(1);
    updateProgressChip();
    fillHandle = idle(step);
  };
  fillHandle = idle(step);
}

function stopFill() {
  filling = false;
  if (fillHandle) {
    cancelIdle(fillHandle);
    fillHandle = 0;
  }
}

function updateProgressChip() {
  const el = statsEl.querySelector('[data-chunks]');
  if (!el || !chunked) return;
  const all = chunked.parsedChunks >= chunked.chunks.length;
  el.classList.toggle('ok', all);
  el.innerHTML = all
    ? `全文 <b>${chunked.chunks.length}</b> 块已解析 ✓`
    : `<b>${chunked.parsedChunks}</b>/${chunked.chunks.length} 块 · 按需解析`;
}

/** 载入一份新文本（示例 / 本地文件） */
async function loadText(text, name = 'source.json', { readMs = 0 } = {}) {
  const t0 = performance.now();
  const T = { readMs: Math.round(readMs) };

  fileNameEl.textContent = name;
  showBoot(`正在打开 ${name}（${(text.length / 1024 / 1024).toFixed(1)} MB）…`);
  await nextFrame();
  T.overlayMs = Math.round(performance.now() - t0);

  const useViewer = text.length > VIEWER_FILE;
  tree = null; // 丢掉旧树
  chunked = null;
  prevSource = '';
  jsonView?.resetExpansion();
  stopFill();

  const tEnter = performance.now();
  let firstRender = null;
  if (useViewer) {
    // 只扫描顶层结构 + 解析首屏那两块，通常 30~60ms 就能上屏
    const tScan = performance.now();
    chunked = new ChunkedDoc(text, parser);
    T.scanMs = Math.round(performance.now() - tScan);
    if (chunked.unsupported) {
      // 顶层不是数组/对象、或括号没闭合 → 退回整棵解析
      chunked = null;
      firstRender = enterView(text, null);
    } else {
      T.chunks = chunked.chunks.length;
      const tPrime = performance.now();
      chunked.prime(1); // 一块约 300KB / 130 行，够铺满任何屏幕了
      T.primeMs = Math.round(performance.now() - tPrime);
      firstRender = enterView(text, chunked);
      T.parsedAtFirstPaint = chunked.parsedChunks;
    }
  } else {
    enterEdit(text);
  }
  T.enterMs = Math.round(performance.now() - tEnter);

  try {
    if (chunked) {
      treeDirty = true;
      jsonDirty = true;
      const tView = performance.now();
      refreshActivePanel({ immediate: true });
      T.viewMs = Math.round(performance.now() - tView);
      renderStats({
        renderMs: firstRender?.ms ?? 0,
        tokens: firstRender?.tokens ?? 0,
        lines: viewerHl.lineCount,
        bytes: text.length,
        chunks: { parsed: chunked.parsedChunks, total: chunked.chunks.length },
      });
    } else {
      showBoot(`正在解析 ${name}（${(text.length / 1024 / 1024).toFixed(1)} MB）…`);
      await nextFrame();
      const tRun = performance.now();
      const r = run({ full: true });
      T.parseMs = Math.round(r?.parseMs ?? 0);
      T.highlightMs = Math.round(r?.renderMs ?? 0);
      T.runMs = Math.round(performance.now() - tRun);

      const tView = performance.now();
      refreshActivePanel({ immediate: true });
      T.viewMs = Math.round(performance.now() - tView);
    }
  } finally {
    await nextFrame();
    hideBoot();
    T.totalMs = Math.round(performance.now() - t0);
    T.mode = mode;
    T.chunked = chunked
      ? { total: chunked.chunks.length, parsed: chunked.parsedChunks, unsupported: chunked.unsupported }
      : null;
    if (import.meta.env.DEV) {
      window.__ts = window.__ts ?? {};
      window.__ts.lastLoad = T;
      console.log('[load]', T);
    }
    // 首屏已经能看了，剩下的块后台补
    if (chunked && !chunked.done) startFill();
  }
}

function setSource(text, opts) {
  // 同步版本，供 boot() 首次调用
  fileNameEl.textContent = opts?.name ?? 'source.json';
  tree = null;
  chunked = null;
  prevSource = '';
  jsonView?.resetExpansion();
  if (text.length > VIEWER_FILE) enterView(text, null);
  else enterEdit(text);
  run({ full: true });
}

function bindEvents() {
  // 输入 → 增量解析
  let scheduled = false;
  codeEl.addEventListener('input', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      run({ full: false });
    });
  });

  // 滚动 → 只重画窗口（命中缓冲就只挪 transform）
  let scrollRaf = 0;
  codeEl.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      hl.render(codeEl.scrollTop, codeEl.scrollLeft, codeEl.clientHeight, false, codeEl.clientWidth);
    });
  });

  // 只读预览层的滚动
  let vScrollRaf = 0;
  viewerEl.addEventListener('scroll', () => {
    if (vScrollRaf) return;
    vScrollRaf = requestAnimationFrame(() => {
      vScrollRaf = 0;
      if (mode !== 'view') return;
      viewerHl.render(viewerEl.scrollTop, viewerEl.scrollLeft, viewerEl.clientHeight, false, viewerEl.clientWidth);
    });
  });

  // 大文件：按需加载进编辑器（这一步才真正要付 textarea 排版 + 全量解析的钱）
  editBtn.addEventListener('click', async () => {
    const text = viewerSource;
    showBoot('正在放进编辑器（排版 ~1s + 全量解析 ~2s）…');
    await nextFrame();
    stopFill();
    chunked = null;
    tree = null;
    enterEdit(text);
    await nextFrame();
    showBoot('正在全量解析…');
    await nextFrame();
    run({ full: true });
    await nextFrame();
    hideBoot();
  });

  // 光标 → 选中所在语法节点，树面板同步
  codeEl.addEventListener('click', syncCaretSelection);
  codeEl.addEventListener('keyup', (e) => {
    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') syncCaretSelection();
  });

  // Tab 缩进
  codeEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const { selectionStart: s, selectionEnd: en } = codeEl;
    codeEl.setRangeText('  ', s, en, 'end');
    run({ full: false });
  });

  // 右侧面板：tab 切换 + 展开/折叠
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.getElementById('expandAll').addEventListener('click', async () => {
    if (chunked && !chunked.done) {
      // 展开到底要摸到每一个元素，只能先把没解析的块补齐
      showBoot('正在解析全文（唯一需要全量解析的操作）…');
      await nextFrame();
      stopFill();
      chunked.parseAll();
      updateProgressChip();
      await nextFrame();
      hideBoot();
    }
    jsonDirty = true;
    ensureJson();
    jsonView.expandAll(3);
  });
  document.getElementById('collapseAll').addEventListener('click', () => jsonView.collapseAll());

  // 示例按钮
  document.querySelectorAll('[data-sample]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      hideBoot();
      const key = btn.dataset.sample;
      if (key === 'big') await loadText(buildBigSample(5000), 'generated-5000.json');
      else await loadText(SAMPLES[key], `${key}.json`);
    });
  });

  // 打开本地文件
  document.getElementById('openFile').addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', async () => {
    const f = fileEl.files?.[0];
    if (!f) return;
    const tRead = performance.now();
    const text = await f.text();
    await loadText(text, f.name, { readMs: performance.now() - tRead });
    fileEl.value = '';
  });

  // 拖拽文件到编辑器
  editorPane.addEventListener('dragover', (e) => {
    e.preventDefault();
    editorPane.classList.add('dragging');
  });
  editorPane.addEventListener('dragleave', () => editorPane.classList.remove('dragging'));
  editorPane.addEventListener('drop', async (e) => {
    e.preventDefault();
    editorPane.classList.remove('dragging');
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    const tRead = performance.now();
    const text = await f.text();
    await loadText(text, f.name, { readMs: performance.now() - tRead });
  });

  // 窗口尺寸变化 → 重算窗口
  window.addEventListener('resize', () => {
    if (mode === 'view') {
      layoutViewer();
      viewerHl.render(viewerEl.scrollTop, viewerEl.scrollLeft, viewerEl.clientHeight, true, viewerEl.clientWidth);
    } else {
      hl.render(codeEl.scrollTop, codeEl.scrollLeft, codeEl.clientHeight, true, codeEl.clientWidth);
    }
  });
}

boot().catch((err) => {
  bootEl.innerHTML = `<span style="color:#c62828">WASM 加载失败：${err.message}</span>`;
  console.error(err);
});

// 开发期调试用：控制台可以直接 __ts.hl / __ts.tree
if (import.meta.env.DEV) {
  window.__ts = {
    get hl() { return hl; },
    get tree() { return tree; },
    get parser() { return parser; },
  };
}
