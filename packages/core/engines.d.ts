/**
 * jsonlens/engines 类型声明 —— 引擎层。
 *
 * 这一层给「想自己搭 UI」的人用：不帮你建 DOM，只提供
 * 分块懒解析（ChunkedDoc）、双轴窗口化高亮（Highlighter）、
 * JSON 视图（JsonView）、语法树视图（renderTree）和增量 diff。
 *
 * 想看现成的查看器，用 `jsonlens` 的 `createExplorer`。
 */

/**
 * 节点。真 tree-sitter 节点和本包的虚拟节点（分块 / 偏移）都满足这个形状，
 * 所以这里只声明用到的那部分，避免和 web-tree-sitter 的类型互相拉扯。
 */
export interface JsonNode {
  type: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: { row: number; column: number };
  readonly endPosition: { row: number; column: number };
  readonly namedChildCount: number;
  readonly childCount: number;
  readonly isNamed: boolean;
  readonly hasError: boolean;
  namedChild(i: number): JsonNode | null;
  child(i: number): JsonNode | null;
  childForFieldName(name: string): JsonNode | null;
  fieldNameForChild(i: number): string | null;
}

/** 一行的像素高度。样式里的 `.jrow` / `.jl-pre` 必须和它一致 */
export const LINE_HEIGHT: 20;

/** 分块的交叉点：超过这个字符数才值得分块（整棵解析约 10ms/100KB） */
export const CHUNK_THRESHOLD: 64000;

/** JSON 的 tree-sitter query 源码（高亮用） */
export const JSON_QUERY: string;

/** 顶层扫描结果 */
export interface TopLevelScan {
  isArray: boolean;
  openIndex: number;
  closeIndex: number;
  /** 每个顶层元素的起始偏移 */
  items: number[];
}

/**
 * 扫一遍顶层结构，找出每个元素的边界。
 * 字符串用 `indexOf('"')` 整段跳过，所以 25 MB 只要 ~30ms。
 * 不是 `[` / `{` 开头（比如裸标量）返回 null。
 */
export function scanTopLevel(text: string): TopLevelScan | null;

/**
 * 分块文档：把大文件按顶层元素切成若干块，每块单独 parse，
 * 用到哪块才解析哪块。对外表现得像一棵正常的语法树（鸭子类型）。
 */
export class ChunkedDoc {
  constructor(text: string, parser: { parse(s: string): JsonNode | null });

  readonly text: string;
  readonly isArray: boolean;
  readonly openIndex: number;
  readonly closeIndex: number;
  /** 顶层元素个数 */
  readonly count: number;
  readonly lineStarts: number[];
  readonly chunks: Array<{
    from: number;
    to: number;
    firstRow: number;
    lastRow: number;
    firstItem: number;
    delta: number;
    tree: JsonNode | null;
  }>;
  /** 已解析的块数 */
  parsedChunks: number;
  /** 扫描失败（不是合法的 JSON 容器）时为 true */
  readonly unsupported: boolean;
  /** 所有块都解析完了 */
  readonly done: boolean;
  /** 虚拟的 document 根节点，可直接交给 JsonView / renderTree */
  readonly rootNode: JsonNode;

  /** 字符偏移 → 行号 */
  rowOf(index: number): number;
  /** 解析前 n 块（首屏） */
  prime(n?: number): void;
  /** 从当前位置往后继续解析 n 块（空闲时用） */
  primeNext(n?: number): number;
  /** 确保某块已解析 */
  ensure(chunk: ChunkedDoc['chunks'][number]): JsonNode | null;
  /** 全量解析（一般别用，那是分块想避开的事） */
  parseAll(): void;
  /** 覆盖 [firstRow, lastRow] 的块（顺便解析掉） */
  treesFor(
    firstRow: number,
    lastRow: number,
  ): Array<{ tree: JsonNode; rowOffset: number; delta: number; lastRow: number }>;
  /** 顶层第 i 个元素（惰性解析所在块） */
  itemNode(i: number): JsonNode | null;
  /**
   * 释放所有块的语法树。**必须显式调**：`Tree` 是 wasm 里的对象，
   * 没有 FinalizationRegistry 兜底，不 delete 就一直占着 wasm 堆。
   */
  dispose(): void;
}

export interface HighlighterOptions {
  /**
   * true：窗口按「内容坐标」定位，由外层滚动容器负责滚。
   * 查看器用这个；自己接管滚动时可以设 false。
   */
  contentPositioned?: boolean;
}

export interface RenderResult {
  tokens: number;
  ms: number;
  lines: number;
  cached: boolean;
}

/**
 * 窗口化高亮器。
 *
 * 只对可视窗口跑 query、只给可视列建 span —— 这是「和文件大小脱钩」的关键：
 * 25 MB 和 25 KB 首屏的 span 数是一个量级。
 */
export class Highlighter {
  constructor(preEl: HTMLElement, query: unknown, options?: HighlighterOptions);

  /** 等宽字体单字符宽度（px）。横向裁剪要靠它，0 = 关掉横向裁剪 */
  charWidth: number;
  readonly lineCount: number;

  /**
   * @param root 整棵语法树的根，或 ChunkedDoc
   * @param edit 增量编辑信息，给了就只重算受影响的行
   */
  update(source: string, root: JsonNode | ChunkedDoc | null, edit?: unknown): void;

  /** 渲染可视窗口。viewportW 给了就顺便做横向裁剪 */
  render(
    scrollTop: number,
    scrollLeft: number,
    viewportH: number,
    force?: boolean,
    viewportW?: number,
  ): RenderResult;

  maxLineLength(): number;
  lineOf(index: number): number;
  /** 高亮某段源码（传 null 清除） */
  setActive(range: { start: number; end: number } | null): void;
}

export interface JsonViewHandlers {
  onHover?: (range: { start: number; end: number } | null) => void;
  onSelect?: (range: { start: number; end: number } | null) => void;
}

/**
 * JSON 结构视图：按语法树折叠，滚到哪加载到哪。
 * 行是懒创建的，所以 24 MB 也只有可视区那几十个 DOM。
 */
export class JsonView {
  constructor(el: HTMLElement, handlers?: JsonViewHandlers);

  resetExpansion(): void;
  setData(root: JsonNode | null, source: string): void;
  render(): void;
  /** 触发视口附近的懒加载 */
  fillVisible(): void;
  /** 展开到第 maxDepth 层 */
  expandAll(maxDepth?: number): void;
  collapseAll(): void;
  /** 丢掉当前文档但保留实例（换文件时用，避免攥着已释放的节点） */
  reset(): void;
  /** 卸载：摘监听、断观察器、清 DOM */
  destroy(): void;
}

/** 语法树视图（调试用）。超过 4000 行会截断 */
export function renderTree(
  container: HTMLElement,
  root: JsonNode | null,
  source: string,
  handlers?: JsonViewHandlers,
): void;

/** 字符偏移 → tree-sitter 的 {row, column} */
export function pointAt(text: string, index: number): { row: number; column: number };

/** 两次文本之间的最小差异，转成 tree-sitter 的 Edit；相同则返回 null */
export function diffEdit(
  oldText: string,
  newText: string,
): {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: { row: number; column: number };
  oldEndPosition: { row: number; column: number };
  newEndPosition: { row: number; column: number };
} | null;
