import type { Explorer, ExplorerStats, LoadResult, Range } from 'jsonlens';

/** 元素派发的事件及载荷 */
export interface JsonExplorerEventMap {
  hover: CustomEvent<Range | null>;
  select: CustomEvent<Range | null>;
  stats: CustomEvent<ExplorerStats>;
  load: CustomEvent<LoadResult>;
  tabchange: CustomEvent<'json' | 'tree'>;
  loaderror: CustomEvent<unknown>;
}

/**
 * `<json-explorer>` —— 只要页面能加载一个 ESM 文件就能用。
 *
 * ```html
 * <json-explorer src="/data.json" theme="dark" style="height:600px"></json-explorer>
 * <script type="module">
 *   import { JsonExplorerElement } from 'jsonlens-element';
 *   JsonExplorerElement.wasmUrl = '/wasm/';   // 不设也行，CDN 直连时默认值是对的
 * </script>
 * ```
 *
 * 事件都是冒泡的 `CustomEvent`，`detail` 里是载荷。
 * 属性：`src` `value` `theme` `tab` `title` `expand-depth`。
 */
export declare class JsonExplorerElement extends HTMLElement {
  /** 全局 wasm 地址，只影响之后新建的元素 */
  static wasmUrl: undefined | string | { runtime: string; language: string };

  /**
   * 类型安全的监听（返回取消监听的函数）。
   * 原生 `addEventListener('stats', e => …)` 也能用 —— 事件是冒泡的 ——
   * 只是 `detail` 的类型要自己断言。
   */
  on<K extends keyof JsonExplorerEventMap>(
    type: K,
    fn: (detail: JsonExplorerEventMap[K]['detail']) => void,
  ): () => void;

  /** 载入文本。元素还没挂载时调用会先暂存，挂载后再载入 */
  load(text: string, options?: { title?: string }): Promise<LoadResult | null>;
  expandTo(depth?: number): void;
  collapseAll(): void;
  setTab(tab: 'json' | 'tree'): void;
  setTheme(theme: 'light' | 'dark' | 'auto'): void;
  scrollToLine(line: number, options?: { align?: 'center' | 'start' }): void;

  readonly stats: ExplorerStats | null;
  /** 底层实例 */
  readonly explorer: Explorer | null;
}

declare global {
  interface HTMLElementTagNameMap {
    'json-explorer': JsonExplorerElement;
  }
}

export default JsonExplorerElement;
