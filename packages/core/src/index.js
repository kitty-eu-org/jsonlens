/**
 * jsonlens —— 框架无关的高性能 JSON 查看器
 *
 * 两层导出，别混用：
 *   - `.`        公共 API：createExplorer（一个工厂函数 + 一组方法 + 事件）
 *   - `./engines` 底层引擎：ChunkedDoc / Highlighter / JsonView / renderTree
 *                 给「想自己搭 UI」的人，例如本仓库的 playground（它需要一个可编辑的 textarea）
 */
import './style.css';

export { createExplorer } from './explorer.js';
export { initWasm } from './wasm.js';
export const VERSION = '0.1.0';
