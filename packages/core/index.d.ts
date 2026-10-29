/**
 * jsonlens 类型声明。
 *
 * 用手写 .d.ts 而不是从 JSDoc 生成：这个包的公开面很小（一个工厂函数 + 一组方法），
 * 手写能把「哪些是可选的、哪些有副作用」写清楚；引擎层类型另见 engines.d.ts。
 */

/** 源码里的一段区间（字符偏移，半开区间 [start, end)） */
export interface Range {
  start: number;
  end: number;
}

/** wasm 地址。给字符串时当作目录（会自动补 `/` 并拼上两个文件名） */
export type WasmUrl =
  | string
  | {
      /** `tree-sitter.wasm` 的完整 URL */
      runtime: string;
      /** `tree-sitter-json.wasm` 的完整 URL */
      language: string;
    };

export interface ExplorerOptions {
  /**
   * wasm 的位置。**生产环境建议显式传**：
   * 默认值靠 `import.meta.url` 推断，在 Vite/webpack 把包装进 app bundle 之后就失效了。
   */
  wasmUrl?: WasmUrl;
  /** 右侧默认面板，默认 `'json'` */
  defaultTab?: 'json' | 'tree';
  /** 超过多少字符走「分块懒解析」，默认 64000（实测的交叉点，见 README） */
  chunkThreshold?: number;
  /** 是否显示「JSON 视图 / 语法树」切换，默认 true */
  showTabs?: boolean;
  /** 是否显示「展开 3 层 / 全部折叠」按钮，默认 true */
  showActions?: boolean;
  /** 左上角文件名，默认 `'source.json'` */
  title?: string;
  /** 主题，默认 `'light'`；`'auto'` 跟随系统 */
  theme?: 'light' | 'dark' | 'auto';
  /** load 之后自动展开到第几层，默认 0（只展开根） */
  expandDepth?: number;
}

/** `load()` 的返回值，也是 `load` / `repaint` 事件携带的数据 */
export interface LoadResult {
  /** 建文档 + 首块解析（或整棵解析） */
  parseMs: number;
  /** 建行索引 */
  updateMs: number;
  /** 算内容尺寸（滚动条长度） */
  layoutMs: number;
  /** 首屏高亮 + span 构建 */
  paintMs: number;
  /** 右侧面板首屏渲染 */
  panelMs: number;
  /** 以上相加（不含调用方读文件的时间） */
  totalMs: number;
  /** 本次窗口里的 span 数 */
  tokens: number;
  /** 首屏行数 */
  lines: number;
  /** 命中缓存时 paint 不重画 */
  cached: boolean;
}

export interface ExplorerStats {
  chars: number;
  lines: number;
  /** 只有分块模式下才非 null */
  chunks: { parsed: number; total: number } | null;
  mode: 'chunked' | 'full';
  /** 最近一次 load 的计时 */
  parseMs?: number;
  paintMs?: number;
  tokens?: number;
  [key: string]: unknown;
}

/** 事件名 → 载荷。`on/off` 是类型安全的 */
export interface ExplorerEvents {
  /** 载入完成（首屏可见） */
  load: LoadResult;
  /** 滚动重绘（只在真的重画时触发，缓存命中不触发） */
  repaint: LoadResult;
  /** 统计信息变化（载入、空闲补解析的每一步都会发） */
  stats: ExplorerStats;
  /** 右侧面板切换 */
  tabchange: 'json' | 'tree';
  /** 悬停到某段源码 */
  hover: Range | null;
  /** 点击了 JSON 视图里的某个节点 */
  select: Range | null;
  /**
   * wasm 初始化失败（路径写错 / 离线 / CDN 挂掉）。接了这个事件就不会再有
   * 「未处理的 Promise 拒绝」噪音；`ready` 本身仍然会 reject，想用 try/catch 也行。
   */
  error: Error;
}

export interface Explorer {
  /** 容器元素（就是传进来的那个，会被加上 `.jl-root`） */
  readonly el: HTMLElement;
  /** wasm 就绪。第一个实例要等它，之后的实例直接复用 */
  readonly ready: Promise<Explorer>;

  on<K extends keyof ExplorerEvents>(type: K, fn: (payload: ExplorerEvents[K]) => void): this;
  off<K extends keyof ExplorerEvents>(type: K, fn: (payload: ExplorerEvents[K]) => void): this;

  /**
   * 载入一份 JSON 文本。
   * 解析失败（JSON 非法）不会抛错 —— tree-sitter 是容错的，错误处会标红。
   */
  load(text: string, options?: { title?: string }): Promise<LoadResult | null>;
  /** 清空（保留 DOM 结构） */
  clear(): void;

  setTab(tab: 'json' | 'tree'): void;
  setTheme(theme: 'light' | 'dark' | 'auto'): void;
  /** 展开到第 depth 层 */
  expandTo(depth?: number): void;
  collapseAll(): void;
  /** 把某段源码滚到可视区并高亮 */
  reveal(range: Range | null): void;
  /** 滚到第 line 行（0 起） */
  scrollToLine(line: number, options?: { align?: 'center' | 'start' }): void;

  readonly text: string;
  readonly stats: ExplorerStats | null;
  /** 分块文档；整棵解析时为 null（引擎层可用来做自己的懒加载） */
  readonly chunked: unknown | null;

  /** 卸载：断开监听、清空 DOM。之后这个实例不可再用 */
  destroy(): void;
}

export function createExplorer(
  container: HTMLElement | string,
  options?: ExplorerOptions,
): Explorer;

/**
 * 预加载 wasm。可选 —— `createExplorer` 内部会自己调。
 * 想在首屏之前先热身（比如路由跳转前）就用它。
 */
export function initWasm(options?: {
  wasmUrl?: WasmUrl;
}): Promise<{ parser: unknown; language: unknown }>;

export const VERSION: string;
