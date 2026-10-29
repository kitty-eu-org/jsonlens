/**
 * 大文件「按需分块解析」。
 *
 * 为什么需要它：25MB / 634 万节点的一次全量解析是不可分割的 ~1.8s 主线程长任务，
 * 无论怎么优化都绕不过去。但只要顶层是数组/对象，每个顶层元素在语法上是**独立**的
 * （逗号分隔，互不依赖前文），所以可以：
 *
 *   1. 一次线性扫描找到所有「深度 1 的逗号」→ 天然的元素边界 + 元素总数
 *   2. 按 ~300KB 分块，每块单独 parse（包一层 [ ] 或 { } 让它成为合法文档）
 *   3. 首屏只解析第 0、1 块（~20ms），其余滚到哪解析哪 / 空闲时后台补
 *
 * 代价是每块的行号和字符索引都相对块内，所以要维护映射：
 *   docIndex = wrappedIndex + (chunk.from - 1)   // 包里多了一个 '[' 占位
 *   docRow   = wrappedRow   + chunk.firstRow     // '[' 和前一个元素同一行
 *
 * 对外的虚拟根节点用「鸭子类型」实现 tree-sitter 的 Node 接口，
 * 这样 jsonview.js / treeview.js 一行都不用改。
 */

const TARGET_CHUNK = 300_000; // 单块目标字节数，实测解析约 20ms

/**
 * 首块的切分规则：**同时**满足「行数」和「元素个数」两个下限。
 *
 * 两个消费者要的东西不一样：
 *   - 高亮器要行：窗口是 [可视行 ± 12 行]，首屏 43 行就得盖到第 55 行左右；
 *   - JSON 视图要元素：首屏一批 60 个元素。
 *
 * 只按字节切（原来固定 300KB）会两头不讨好：
 *   - GitHub Archive 那种一行 2200 字符的，300KB 只有 136 行，屏幕一高就跨块，
 *     渲染时现场解析第二块，白等 20ms；
 *   - 缩进格式的（一个元素占 26 行），80 行只装得下 3 个元素，JSON 视图要 60 个，
 *     于是现场解析 20 个块，实测白等 32ms。
 *
 * 所以首块的边界取「行数和元素个数**都**满足」的那个点（代码里是 `&&`，不是「谁先
 * 满足就用谁」——两个消费者都得喂饱），再用 TARGET_CHUNK 兜住上限。
 */
const FIRST_CHUNK_ROWS = 80;
const FIRST_CHUNK_ITEMS = 80;
const MIN_FIRST_CHUNK = 16_000; // 但首块也别比这更小

/**
 * 超过这个字符数就该走分块懒解析。
 *
 * 实测两条曲线的交叉点：「整棵解析」约 10ms/100KB（tree-sitter 在 wasm 里大概 10MB/s，
 * 二次解析同样是 11ms，不是堆增长，压不下去）；「分块」的固定开销 = 扫描 1.1ms/MB +
 * 首块 5ms，且**不随文件增长**。两者在 50~60KB 交叉，取 64KB。
 *
 * 这个数也顺便当「要不要默认进只读预览」的分界线：两条路径只在只读模式下才都成立
 * （可编辑模式必须有一棵完整树，见 README 第八章第 3 条）。
 */
export const CHUNK_THRESHOLD = 64_000;

/** 用 indexOf 跳着找换行，26MB 约 1.4ms */
function computeLineStarts(text) {
  const starts = [0];
  let i = -1;
  while ((i = text.indexOf('\n', i + 1)) !== -1) starts.push(i + 1);
  return starts;
}

// 空白符 + BOM。BOM（U+FEFF）必须算进来：Windows 上导出的 JSON 十有八九带它，
// 不跳过就会判定「顶层不是 [ 或 {」直接退回整棵解析 —— 一个 24MB 的文件白等 2 秒。
const WS = new Set([32, 9, 10, 13, 0xfeff]);

/**
 * 扫描顶层结构。
 * @returns {{isArray:boolean, openIndex:number, closeIndex:number, items:number[]}|null}
 *          items 是每个顶层元素的起始偏移
 */
export function scanTopLevel(text) {
  const n = text.length;
  let i = 0;
  while (i < n && WS.has(text.charCodeAt(i))) i++;
  if (i >= n) return null;

  const open = text.charCodeAt(i);
  if (open !== 91 && open !== 123) return null; // 不是 [ 或 {

  const openIndex = i;
  const isArray = open === 91;
  const raw = [i + 1];
  const close = isArray ? 93 : 125; // ] 或 }
  let depth = 0;
  let closeIndex = -1;

  for (let j = i; j < n; j++) {
    const c = text.charCodeAt(j);

    if (c === 34) {
      // 整个字符串跳过去：JSON 里绝大多数字符都在引号内，逐字扫太浪费
      let q = j + 1;
      for (;;) {
        q = text.indexOf('"', q);
        if (q === -1) {
          q = n;
          break;
        }
        let bs = 0;
        let p = q - 1;
        while (p >= 0 && text.charCodeAt(p) === 92) {
          bs++;
          p--;
        }
        if (bs % 2 === 0) break; // 偶数个反斜杠 → 这个引号是真的收尾
        q++;
      }
      j = q;
      continue;
    }

    if (c === 123 || c === 91) {
      depth++;
      continue;
    }
    if (c === 125 || c === 93) {
      depth--;
      if (depth === 0) {
        if (c === close) closeIndex = j;
        break;
      }
      continue;
    }
    if (c === 44 && depth === 1) raw.push(j + 1);
  }

  if (closeIndex < 0) return null; // 顶层括号没闭合，交给完整解析

  // 过滤空条目（比如 "[]" / "{}" 会留下一个全是空白的假元素）。
  // 原地压缩而不是新建 items 数组：153 万顶元素时一个数字数组就是 ~12 MB，
  // 再开一个纯粹是为了那一个空条目多花一倍峰值内存。
  //
  // 判定「这段是不是空白」用逐字符早退，不用 `text.slice().trim()`：
  // 那样会在扫描阶段凭空造出 153 万个临时字符串，纯粹是 GC 压力。
  let w = 0;
  for (let k = 0; k < raw.length; k++) {
    const start = raw[k];
    const end = k + 1 < raw.length ? raw[k + 1] - 1 : closeIndex;
    let q = start;
    while (q < end && WS.has(text.charCodeAt(q))) q++;
    if (q < end) raw[w++] = start;
  }
  // 截断后 V8 会把尾部释放掉（不会一直保留 1.5M 的容量）
  raw.length = w;
  if (!w) return null;

  return { isArray, openIndex, closeIndex, items: raw };
}

/** 把真实 tree-sitter 节点包一层，索引/行号换算回文档坐标 */
class OffsetNode {
  constructor(node, delta, rowOffset) {
    this.n = node;
    this.d = delta;
    this.r = rowOffset;
  }
  get type() {
    return this.n.type;
  }
  get startIndex() {
    return this.n.startIndex + this.d;
  }
  get endIndex() {
    return this.n.endIndex + this.d;
  }
  get isNamed() {
    return this.n.isNamed;
  }
  get isMissing() {
    return this.n.isMissing;
  }
  get hasError() {
    return this.n.hasError;
  }
  get childCount() {
    return this.n.childCount;
  }
  get namedChildCount() {
    return this.n.namedChildCount;
  }
  child(i) {
    const c = this.n.child(i);
    return c ? new OffsetNode(c, this.d, this.r) : null;
  }
  namedChild(i) {
    const c = this.n.namedChild(i);
    return c ? new OffsetNode(c, this.d, this.r) : null;
  }
  childForFieldName(name) {
    const c = this.n.childForFieldName(name);
    return c ? new OffsetNode(c, this.d, this.r) : null;
  }
  fieldNameForChild(i) {
    return this.n.fieldNameForChild(i);
  }
  get startPosition() {
    const p = this.n.startPosition;
    // 包在最前面的 '[' 占了第 0 行的一个字符，列号要减 1
    const col = p.row === 0 ? Math.max(0, p.column - 1) : p.column;
    return { row: p.row + this.r, column: col };
  }
  get endPosition() {
    const p = this.n.endPosition;
    const col = p.row === 0 ? Math.max(0, p.column - 1) : p.column;
    return { row: p.row + this.r, column: col };
  }
}

export class ChunkedDoc {
  /**
   * @param {string} text 全文
   * @param {import('web-tree-sitter').Parser} parser
   */
  constructor(text, parser) {
    this.text = text;
    this.parser = parser;
    this.lineStarts = computeLineStarts(text);

    const s = scanTopLevel(text);
    if (!s) {
      this.unsupported = true;
      this.chunks = [];
      this.count = 0;
      return;
    }
    this.unsupported = false;
    this.isArray = s.isArray;
    this.openIndex = s.openIndex;
    this.closeIndex = s.closeIndex;
    this.items = s.items;
    this.count = s.items.length;

    // 按目标大小把连续元素打成一块；首块例外，按行切，保证首屏窗口只落一块
    const chunks = [];
    let k = 0;
    while (k < this.items.length) {
      const from = this.items[k];
      let j = k + 1;
      if (chunks.length === 0) {
        const fromRow = this.rowOf(from);
        while (j < this.items.length) {
          if (this.items[j] - from >= TARGET_CHUNK) break;
          if (
            this.items[j] - from >= MIN_FIRST_CHUNK &&
            j - k >= FIRST_CHUNK_ITEMS &&
            this.rowOf(this.items[j]) - fromRow >= FIRST_CHUNK_ROWS
          ) {
            break;
          }
          j++;
        }
      } else {
        while (j < this.items.length && this.items[j] - from < TARGET_CHUNK) j++;
      }
      const to = j < this.items.length ? this.items[j] - 1 : this.closeIndex;
      chunks.push({
        from,
        to,
        firstItem: k,
        count: j - k,
        firstRow: this.rowOf(from),
        lastRow: this.rowOf(to),
        delta: from - 1,
        tree: null,
      });
      k = j;
    }
    this.chunks = chunks;
    this.parsedChunks = 0;
    this._root = null;
  }

  /**
   * 释放所有块的语法树。
   *
   * ⚠️ 必须显式调：web-tree-sitter 的 `Tree` 是 wasm 里的对象，0.25 没有
   * FinalizationRegistry，不 `delete()` 就一直占着 wasm 堆（一个 24MB 文件分 87 块，
   * 就是 87 棵树）。反复打开文件的场景下这是纯泄漏，JS 的 GC 救不了。
   */
  dispose() {
    for (const c of this.chunks) {
      if (c.tree) {
        c.tree.delete();
        c.tree = null;
      }
    }
    this.chunks = [];
    this._root = null;
  }

  rowOf(index) {
    const st = this.lineStarts;
    let lo = 0;
    let hi = st.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (st[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  get done() {
    return this.parsedChunks >= this.chunks.length;
  }

  /** 解析还没解析过的前面 N 块（首屏用） */
  prime(n = 2) {
    for (let i = 0; i < n && i < this.chunks.length; i++) this.ensure(this.chunks[i]);
  }

  /** 从当前位置继续解析若干块（空闲补解析用） */
  primeNext(n = 1) {
    let done = 0;
    for (const c of this.chunks) {
      if (done >= n) break;
      if (c.tree) continue;
      this.ensure(c);
      done++;
    }
    return done;
  }

  ensure(chunk) {
    if (chunk.tree) return chunk.tree;
    // 包一层括号，让这一块单独成为合法文档
    const body = this.text.slice(chunk.from, chunk.to);
    const wrapped = (this.isArray ? '[' : '{') + body + (this.isArray ? ']' : '}');
    const t = this.parser.parse(wrapped);
    chunk.tree = t;
    this.parsedChunks++;
    return t;
  }

  parseAll() {
    for (const c of this.chunks) this.ensure(c);
  }

  /**
   * 高亮器用：找出覆盖 [firstRow, lastRow] 的块（顺便把它们解析掉）。
   * @returns {{tree:any, rowOffset:number, delta:number, lastRow:number}[]}
   */
  treesFor(firstRow, lastRow) {
    const out = [];
    for (const c of this.chunks) {
      if (c.lastRow < firstRow || c.firstRow > lastRow) continue;
      this.ensure(c);
      out.push({ tree: c.tree, rowOffset: c.firstRow, delta: c.delta, lastRow: c.lastRow });
    }
    return out;
  }

  /** 顶层第 i 个元素对应的真实节点（惰性解析所在块） */
  itemNode(i) {
    let lo = 0;
    let hi = this.chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.chunks[mid].firstItem <= i) lo = mid;
      else hi = mid - 1;
    }
    const c = this.chunks[lo];
    if (!c) return null;
    this.ensure(c);
    const arr = c.tree.rootNode.namedChild(0);
    if (!arr) return null;
    const real = arr.namedChild(i - c.firstItem);
    return real ? new OffsetNode(real, c.delta, c.firstRow) : null;
  }

  /** 鸭子类型的 document 根节点，jsonview / treeview 直接当 tree.rootNode 用 */
  get rootNode() {
    if (this._root) return this._root;
    const doc = this;
    const varray = {
      type: this.isArray ? 'array' : 'object',
      get startIndex() {
        return doc.openIndex;
      },
      get endIndex() {
        return doc.closeIndex + 1;
      },
      get namedChildCount() {
        return doc.count;
      },
      get childCount() {
        return doc.count;
      },
      isNamed: true,
      isMissing: false,
      hasError: false,
      namedChild: (i) => this.itemNode(i),
      child: (i) => this.itemNode(i),
      childForFieldName: () => null,
      fieldNameForChild: () => null,
      get startPosition() {
        return { row: doc.rowOf(doc.openIndex), column: 0 };
      },
      get endPosition() {
        return { row: doc.rowOf(doc.closeIndex), column: 0 };
      },
    };
    this._vroot = {
      type: 'document',
      get startIndex() {
        return doc.openIndex;
      },
      get endIndex() {
        return doc.closeIndex + 1;
      },
      namedChildCount: 1,
      childCount: 1,
      isNamed: true,
      isMissing: false,
      hasError: false,
      namedChild: (i) => (i === 0 ? varray : null),
      child: (i) => (i === 0 ? varray : null),
      childForFieldName: () => null,
      fieldNameForChild: () => null,
      get startPosition() {
        return { row: doc.rowOf(doc.openIndex), column: 0 };
      },
      get endPosition() {
        return { row: doc.rowOf(doc.closeIndex), column: 0 };
      },
    };
    this._root = this._vroot;
    return this._root;
  }
}
