import type { Explorer, ExplorerOptions, ExplorerStats, Range } from 'jsonlens';

export interface JsonExplorerActionParams
  extends Pick<
    ExplorerOptions,
    | 'theme'
    | 'defaultTab'
    | 'title'
    | 'chunkThreshold'
    | 'wasmUrl'
    | 'expandDepth'
    | 'showTabs'
    | 'showActions'
  > {
  /** JSON 文本，变了就重新载入 */
  value?: string | null;
  onHover?: (range: Range | null) => void;
  onSelect?: (range: Range | null) => void;
  onStats?: (stats: ExplorerStats) => void;
  onReady?: (api: Explorer) => void;
  /** wasm 初始化失败（路径写错 / 离线） */
  onError?: (error: Error) => void;
}

export interface JsonExplorerActionReturn {
  update(params?: JsonExplorerActionParams): void;
  destroy(): void;
  /** 底层命令式实例 */
  readonly api: Explorer;
}

/**
 * Svelte action：`<div use:jsonExplorer={{ value: text }} style="height:600px">`
 *
 * 零运行时依赖 —— 这个包不 import 'svelte'，类型上也不依赖它
 * （`use:` 接受任何 `(node, params) => { update?, destroy? }` 形状的函数）。
 */
export declare function jsonExplorer(
  node: HTMLElement,
  params?: JsonExplorerActionParams,
): JsonExplorerActionReturn;

export default jsonExplorer;
