import type { DefineComponent } from 'vue';
import type { Explorer, ExplorerStats, LoadResult, Range } from '@jsonlens/core';

export interface JsonExplorerVueHandle {
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
  readonly instance: Explorer | null;
}

export declare const JsonExplorer: DefineComponent<
  {
    /** JSON 文本，变了就重新载入 */
    value?: string;
    theme?: 'light' | 'dark' | 'auto';
    defaultTab?: 'json' | 'tree';
    title?: string;
    chunkThreshold?: number;
    wasmUrl?: string | { runtime: string; language: string };
    expandDepth?: number;
    showTabs?: boolean;
    showActions?: boolean;
  },
  {},
  {},
  {},
  {},
  {},
  {},
  {
    hover: (range: Range | null) => void;
    select: (range: Range | null) => void;
    stats: (stats: ExplorerStats) => void;
    ready: (api: Explorer) => void;
    /** wasm 初始化失败（路径写错 / 离线） */
    error: (error: Error) => void;
  }
>;

export default JsonExplorer;
