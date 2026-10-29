import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
import type {
  Explorer,
  ExplorerOptions,
  ExplorerStats,
  LoadResult,
  Range,
} from '@fagao-ai/jsonlens';

export interface JsonExplorerHandle {
  load(text: string, options?: { title?: string }): Promise<LoadResult | null> | undefined;
  expandTo(depth?: number): void;
  collapseAll(): void;
  setTab(tab: 'json' | 'tree'): void;
  setTheme(theme: 'light' | 'dark' | 'auto'): void;
  reveal(range: Range | null): void;
  scrollToLine(line: number, options?: { align?: 'center' | 'start' }): void;
  destroy(): void;
  readonly stats: ExplorerStats | null;
  readonly text: string;
  /** 底层的命令式实例，需要什么没被包到的能力时用它 */
  readonly instance: Explorer | null;
}

export interface JsonExplorerProps
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
  /** JSON 文本。变了就重新载入；传 null/undefined 表示「先别载」 */
  value?: string | null;
  className?: string;
  /** 宿主必须给高度（默认 width:100%; height:100%） */
  style?: CSSProperties;
  onHover?: (range: Range | null) => void;
  onSelect?: (range: Range | null) => void;
  onStats?: (stats: ExplorerStats) => void;
  /** wasm 就绪后回调，拿到命令式实例 */
  onReady?: (api: Explorer) => void;
  /** wasm 初始化失败（路径写错 / 离线）。不传也不会产生未处理的拒绝 */
  onError?: (error: Error) => void;
}

export declare const JsonExplorer: ForwardRefExoticComponent<
  JsonExplorerProps & RefAttributes<JsonExplorerHandle>
>;

export default JsonExplorer;
