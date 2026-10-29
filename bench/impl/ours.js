/**
 * 本项目（web-tree-sitter 分块懒解析 + 窗口化高亮 + JSON 视图）。
 * 计时区间包含：解析（大文件只解首块）+ 首屏高亮 + JSON 树渲染。
 *
 * 另外把各阶段单独打点记到 window.__phases，方便定位到底哪一步慢。
 */
import { Parser, Language, Query } from 'web-tree-sitter';
import {
  ChunkedDoc,
  CHUNK_THRESHOLD,
  Highlighter,
  JSON_QUERY,
  LINE_HEIGHT,
  JsonView,
} from '@jsonlens/core/engines';

export const label = 'tree-sitter（本项目）';

let parser = null;
let query = null;

export async function init() {
  await Parser.init({ locateFile: (f) => `./${f}` });
  const lang = await Language.load('./tree-sitter-json.wasm');
  parser = new Parser();
  parser.setLanguage(lang);
  query = new Query(lang, JSON_QUERY);

  // 预热：第一次 parse 会触发 wasm 堆分配、query 的首次 captures 也会建缓存。
  // 这些是一次性开销，不该算进「打开一个文件要多久」——其他库的 import 同样不算。
  const warm = parser.parse('{"a":[1,2,3],"b":{"c":true}}');
  query.captures(warm.rootNode, {
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 1, column: 0 },
  });
  warm.delete();
}

export function mount(el, text) {
  const P = (window.__phases = {});
  let t = performance.now();
  const mark = (k) => {
    const now = performance.now();
    P[k] = Math.round(now - t);
    t = now;
  };

  el.innerHTML =
    '<div class="ours-split">' +
    '<div class="ours-code"><pre class="vhighlight"></pre></div>' +
    '<div class="ours-json"></div>' +
    '</div>';
  const codePane = el.querySelector('.ours-code');
  const pre = el.querySelector('.vhighlight');
  const jsonPane = el.querySelector('.ours-json');

  // 1) 解析：大文件走分块懒解析（只解首块），小文件整棵解
  let root;
  let doc = null;
  if (text.length > CHUNK_THRESHOLD) {
    doc = new ChunkedDoc(text, parser);
    if (doc.unsupported) {
      doc = null;
      root = parser.parse(text).rootNode;
      P.path = 'full-fallback';
    } else {
      doc.prime(1);
      root = doc.rootNode;
      P.path = 'chunked';
    }
  } else {
    root = parser.parse(text).rootNode;
    P.path = 'full';
  }
  mark('parse');

  // 2) 左侧代码高亮（只画首屏窗口）
  const hl = new Highlighter(pre, query, { contentPositioned: true });
  hl.update(text, doc ?? root);
  mark('hlUpdate');

  const ch = measureChWidth();
  hl.charWidth = ch;
  const maxLen = hl.maxLineLength();
  pre.style.height = `${hl.lineCount * LINE_HEIGHT + 16}px`;
  pre.style.width = `${Math.max(maxLen * ch + 60, codePane.clientWidth)}px`;
  mark('sizing');

  hl.render(0, 0, codePane.clientHeight, true, codePane.clientWidth);
  mark('hlRender');

  // 3) 右侧 JSON 视图
  const jv = new JsonView(jsonPane, {});
  jv.setData(root, text);
  mark('jsonView');

  // 只记 O(1) 的数字；DOM 计数挪到计时区间外（遍历 1.5 万节点本身就要几毫秒）
  P.jsonRows = jv.rows;
  P.codeLines = hl.lineCount;
  P.visibleCodeLines = Math.round(codePane.clientHeight / LINE_HEIGHT);
}

function measureChWidth() {
  const probe = document.createElement('span');
  probe.style.cssText =
    'position:absolute;visibility:hidden;white-space:pre;font:13px/20px ui-monospace,Menlo,monospace';
  probe.textContent = '0'.repeat(50);
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 50;
  probe.remove();
  return w;
}
