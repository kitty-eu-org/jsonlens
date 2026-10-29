/**
 * 窗口化语法高亮。
 *
 * 关键点：不再为整个文档建 DOM，而是只渲染「可视区域 ± 缓冲行」。
 * 25MB 的 JSON 有 540 万个 token，全量建 span 必卡死；窗口化后
 * 每帧只处理 ~1 万个 token，滚动命中缓冲区时只挪 transform。
 *
 * DOM 结构：
 *   <pre class="highlight">        ← 不滚动，只当画布
 *     <div class="hl-window">      ← 只包含当前窗口的文本 + span
 *   </pre>
 *
 * ⚠️ 踩坑记录：`query.captures(node, { startIndex, endIndex })` 在这个 wasm 构建里
 * 不按 UTF-16 码元解释（实测区间会被对折），必须改用行列位置 { startPosition, endPosition }。
 */

export const LINE_HEIGHT = 20; // 必须和 CSS 里 textarea / pre 的 line-height 一致
const PAD_X = 14;              // 必须和 CSS 里 textarea 的左右 padding 一致
const PAD_Y = 12;              // 必须和 CSS 里 textarea 的上 padding 一致
const MARGIN_LINES = 12;       // 可视区上下各多渲染多少行
const MARGIN_CHARS = 140;      // 可视区左右各多高亮多少字符（横向缓冲）

/** 一次 query 拿到所有需要的 token，比遍历语法树手写 switch 快得多，也好维护 */
export const JSON_QUERY = `
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
(ERROR) @error
`;

const CLASS_OF = {
  key: 'tk-key',
  string: 'tk-string',
  number: 'tk-number',
  bool: 'tk-bool',
  null: 'tk-null',
  punct: 'tk-punct',
  error: 'tk-error',
};

function computeLineStarts(source) {
  // 用 indexOf 跳着找，比逐字符 charCodeAt 快一个数量级（26MB 只要 ~15ms）
  const starts = [0];
  let i = -1;
  while ((i = source.indexOf('\n', i + 1)) !== -1) starts.push(i + 1);
  return starts;
}

export class Highlighter {
  constructor(preEl, query, { contentPositioned = false } = {}) {
    this.pre = preEl;
    this.query = query;
    // true：窗口按「内容坐标」定位（外层滚动容器自己滚），用于只读预览
    this.contentPositioned = contentPositioned;

    this.source = '';
    this.root = null;
    this.doc = null;
    this.lineStarts = [0];
    this.version = 0;

    this.window = document.createElement('div');
    this.window.className = 'hl-window';
    this.pre.appendChild(this.window);

    this.spans = []; // 当前窗口内的 span，按 start 升序
    this.lit = [];
    this.activeRange = null;
    this.rendered = { first: -1, last: -1, version: -1, hBucket: -1 };
    this.stats = { tokens: 0, ms: 0, lines: 0 };

    // 横向窗口用：等宽字体的单字符宽度。0 = 关掉横向裁剪（老行为，整行全高亮）
    this.charWidth = 0;
  }

  get lineCount() {
    return this.lineStarts.length;
  }

  /**
   * @param {string} source 新全文
   * @param {import('web-tree-sitter').Node|import('./chunked.js').ChunkedDoc} root
   *        整棵语法树的根；或者分块文档（大文件按需解析，见 chunked.js）
   * @param {object|null} edit 增量编辑信息，有的话行索引只重算受影响的那几行
   */
  update(source, root, edit = null) {
    // 分块文档自己扫过一遍换行了，直接借用，别再算一次（26MB 那次是 1.4ms）
    const shared = root && typeof root.lineStarts?.length === 'number' ? root.lineStarts : null;
    if (edit && this.source) this.applyEdit(source, edit);
    else this.lineStarts = shared ?? computeLineStarts(source);

    this.source = source;
    // 分块文档带 treesFor()，走多树路径
    this.doc = root && typeof root.treesFor === 'function' ? root : null;
    this.root = this.doc ? null : root;
    this.version++;
    this.rendered = { first: -1, last: -1, version: -1, hBucket: -1 };
  }

  /** 增量维护行索引：只重扫受影响的区间，其余整体平移 delta */
  applyEdit(newSource, edit) {
    const { startIndex, oldEndIndex, newEndIndex } = edit;
    const delta = newEndIndex - oldEndIndex;
    const starts = this.lineStarts;

    const firstLine = this.lineOf(startIndex);
    const lastLine = this.lineOf(oldEndIndex);

    const regionStart = starts[firstLine];
    const hasTail = lastLine + 1 < starts.length;
    // 只扫到「受影响最后一行末尾的换行符之前」：
    // 那个换行符之后的下一行行首由 tail 统一平移 delta，否则会重复记一行
    const scanEnd = hasTail ? starts[lastLine + 1] - 1 : this.source.length;
    const scanEndNew = scanEnd + delta;

    const merged = starts.slice(0, firstLine);
    merged.push(regionStart);
    for (let i = regionStart; i < scanEndNew; i++) {
      if (newSource.charCodeAt(i) === 10) merged.push(i + 1);
    }
    if (hasTail) {
      for (let i = lastLine + 1; i < starts.length; i++) merged.push(starts[i] + delta);
    }

    this.lineStarts = merged;
  }

  /** 最长一行的字符数（只读预览算横向滚动宽度用） */
  maxLineLength() {
    const { lineStarts, source } = this;
    let max = 0;
    for (let i = 0; i < lineStarts.length; i++) {
      const end = i + 1 < lineStarts.length ? lineStarts[i + 1] - 1 : source.length;
      const len = end - lineStarts[i];
      if (len > max) max = len;
    }
    return max;
  }

  /** 字符偏移 → 行号 */
  lineOf(index) {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * 渲染可视窗口。滚动时调用，命中缓冲就只更新 transform。
   *
   * @param {number} viewportW 可视宽度（px，不含 padding）。给了就顺便做**横向**裁剪：
   *        一行 2200 个字符的 JSON（GitHub Archive 那种）整行切 span 会产生 270 个节点，
   *        但 1440px 屏只显示得下 170 个字符。屏外的 token 不建 span、留作纯文本，
   *        字符一个不少，所以对齐和横向滚动都不受影响。
   * @returns {{tokens: number, ms: number, cached: boolean}}
   */
  render(scrollTop, scrollLeft, viewportH, force = false, viewportW = 0) {
    const firstVisible = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT));
    const lastVisible = Math.min(
      this.lineCount - 1,
      Math.ceil((scrollTop + viewportH) / LINE_HEIGHT),
    );

    // 横向按 3/4 屏宽量化：横向滚动每跨过一个桶才重建，不会每像素重建一次
    const bandStep = viewportW > 0 && this.charWidth > 0 ? viewportW * 0.75 : 0;
    const hBucket = bandStep ? Math.round(scrollLeft / bandStep) : 0;

    const r = this.rendered;
    // 可视区还在已渲染的缓冲范围内 → 只挪 transform，不重建 DOM
    const cached =
      !force &&
      r.version === this.version &&
      r.hBucket === hBucket &&
      r.first >= 0 &&
      firstVisible >= r.first &&
      lastVisible <= r.last;

    if (cached) {
      this.position(r.first, scrollTop, scrollLeft);
      return { tokens: this.stats.tokens, ms: 0, cached: true };
    }

    let colFirst = 0;
    let colLast = Infinity;
    if (bandStep) {
      const cw = this.charWidth;
      colFirst = Math.max(0, Math.floor(scrollLeft / cw) - MARGIN_CHARS);
      colLast = Math.ceil((scrollLeft + viewportW) / cw) + MARGIN_CHARS;
    }

    const first = Math.max(0, firstVisible - MARGIN_LINES);
    const last = Math.min(this.lineCount - 1, lastVisible + MARGIN_LINES);
    const t0 = performance.now();
    const { source, lineStarts } = this;
    const startIndex = lineStarts[first];
    const endIndex = last + 1 < lineStarts.length ? lineStarts[last + 1] : source.length;

    // 只对窗口范围跑 query —— 这是全流程里唯一和「文件大小」脱钩的一步
    // root 为空（还没解析完）时返回空，先渲染纯文本。
    // 分块文档：按窗口覆盖到的块各查一次，把块内索引加回文档偏移。
    const raw = [];
    if (this.doc) {
      for (const part of this.doc.treesFor(first, last)) {
        const from = Math.max(0, first - part.rowOffset);
        const to = Math.max(0, last + 1 - part.rowOffset);
        if (to <= 0 || from > part.lastRow - part.rowOffset) continue;
        const caps = this.query.captures(part.tree.rootNode, {
          startPosition: { row: from, column: 0 },
          endPosition: { row: to, column: 0 },
        });
        for (const cap of caps) {
          raw.push({
            name: cap.name,
            s: cap.node.startIndex + part.delta,
            e: cap.node.endIndex + part.delta,
          });
        }
      }
    } else if (this.root) {
      const caps = this.query.captures(this.root, {
        startPosition: { row: first, column: 0 },
        endPosition: { row: last + 1, column: 0 },
      });
      for (const cap of caps) {
        raw.push({ name: cap.name, s: cap.node.startIndex, e: cap.node.endIndex });
      }
    }

    // 归一化：裁剪越界、给 ERROR 更高优先级（它必须盖住内部子节点）
    const items = [];
    for (const cap of raw) {
      const cls = CLASS_OF[cap.name];
      if (!cls) continue;
      let s = cap.s;
      let e = cap.e;
      if (e <= startIndex || s >= endIndex) continue;
      if (s < startIndex) s = startIndex;
      if (e > endIndex) e = endIndex;
      items.push({ s, e, cls, prio: cls === 'tk-error' ? 0 : 1 });
    }
    items.sort((a, b) => a.s - b.s || a.prio - b.prio || b.e - a.e);

    const frag = document.createDocumentFragment();
    const spans = [];
    let cursor = startIndex;
    // 横向裁剪时要知道 token 在第几列：token 已按 start 升序，行号指针单调前移即可，
    // 不用每个 token 都二分一次（1.5 万个 token 一次窗口，那会很贵）
    let row = first;
    let rowStart = lineStarts[first];

    for (const t of items) {
      if (t.s < cursor) continue; // 被前一个 token（或 ERROR）覆盖

      if (bandStep) {
        while (row + 1 < lineStarts.length && lineStarts[row + 1] <= t.s) {
          row++;
          rowStart = lineStarts[row];
        }
        const col = t.s - rowStart;
        // 整段都在可视列之外 → 不建 span。字符不会被丢：下一段 text 节点会原样带出来
        if (col + (t.e - t.s) < colFirst || col > colLast) continue;
      }

      if (t.s > cursor) frag.appendChild(document.createTextNode(source.slice(cursor, t.s)));

      const span = document.createElement('span');
      span.className = t.cls;
      span.textContent = source.slice(t.s, t.e);
      frag.appendChild(span);
      spans.push({ start: t.s, end: t.e, el: span });
      cursor = t.e;
    }

    if (cursor < endIndex) frag.appendChild(document.createTextNode(source.slice(cursor, endIndex)));

    this.window.replaceChildren(frag);
    this.spans = spans;
    this.rendered = { first, last, version: this.version, hBucket };
    this.position(first, scrollTop, scrollLeft);
    // 上一批点亮的 span 已经随窗口一起被替换掉了，引用必须先丢掉：
    // applyActive() 会把命中的 span 再追加进来，不清就会在「悬停住一个节点 + 一直滚」
    // 的场景下无限累积已经脱离文档的元素引用。
    this.lit = [];
    this.applyActive();

    this.stats = { tokens: spans.length, ms: performance.now() - t0, lines: last - first + 1 };
    return { ...this.stats, cached: false };
  }

  /** 窗口在画布里的位置：只挪 transform，不重排 */
  position(first, scrollTop, scrollLeft) {
    const y = this.contentPositioned
      ? PAD_Y + first * LINE_HEIGHT            // 内容坐标：外层容器滚动
      : PAD_Y + first * LINE_HEIGHT - scrollTop; // 视口坐标：自己贴住 textarea
    this.window.style.transform = `translate(${PAD_X - scrollLeft}px, ${y}px)`;
  }

  /** 高亮某个源码区间（语法树节点 hover / 光标所在节点） */
  setActive(range) {
    for (const el of this.lit) el.classList.remove('hl');
    this.lit = [];
    this.activeRange = range;
    this.applyActive();
  }

  applyActive() {
    const range = this.activeRange;
    if (!range) return;
    let lo = 0;
    let hi = this.spans.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.spans[mid].end <= range.start) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.spans.length && this.spans[i].start < range.end; i++) {
      this.spans[i].el.classList.add('hl');
      this.lit.push(this.spans[i].el);
    }
  }
}
