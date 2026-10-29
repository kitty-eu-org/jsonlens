/**
 * 类型声明的「使用方」测试。
 *
 * 只写声明文件是不够的 —— 类型写错了只有真正 import 一遍才会暴露。
 * `npm run typecheck` 会用 tsc 检查这个文件。
 *
 * 注意：这个文件不会被打包，只用于校验。
 */
import { createExplorer, initWasm } from '@fagao-ai/jsonlens';
import type { Explorer, ExplorerEvents, LoadResult } from '@fagao-ai/jsonlens';
import { ChunkedDoc, CHUNK_THRESHOLD, Highlighter, JsonView } from '@fagao-ai/jsonlens/engines';
import { JsonExplorer } from '@fagao-ai/jsonlens-react';
import { JsonExplorerElement } from '@fagao-ai/jsonlens-element';
import { jsonExplorer } from '@fagao-ai/jsonlens-svelte';

const host = document.createElement('div');

/* ---- core ---- */
const api: Explorer = createExplorer(host, {
  theme: 'dark',
  expandDepth: 2,
  wasmUrl: { runtime: '/a.wasm', language: '/b.wasm' },
});

const off: (payload: LoadResult) => void = (r) => {
  console.log(r.parseMs + r.paintMs, r.tokens, r.cached);
};
api.on('load', off);
api.off('load', off);
api.on('stats', (s) => console.log(s.chars, s.mode, s.chunks?.total));
api.on('tabchange', (tab: 'json' | 'tree') => console.log(tab));
api.on('hover', (r) => console.log(r?.start));

async function use() {
  const r = await api.load('{}', { title: 'x.json' });
  if (r) console.log(r.totalMs);
  api.setTab('tree');
  api.setTheme('auto');
  api.expandTo(3);
  api.collapseAll();
  api.reveal({ start: 0, end: 2 });
  api.scrollToLine(10, { align: 'start' });
  const text: string = api.text;
  void text;
  api.destroy();
}
void use;

// @ts-expect-error 不存在的主题值应该报错
api.setTheme('blue');
// @ts-expect-error 不存在的事件名应该报错
api.on('wat', () => {});

void initWasm({ wasmUrl: '/wasm/' });

/* ---- engines ---- */
const doc = new ChunkedDoc('[1,2,3]', { parse: () => null });
const rows = doc.treesFor(0, 10);
console.log(CHUNK_THRESHOLD, rows.length, doc.rootNode.namedChildCount, doc.done);
const hl = new Highlighter(host, null, { contentPositioned: true });
hl.update('[1]', doc);
console.log(hl.render(0, 0, 600, true, 800).tokens, hl.lineCount, hl.maxLineLength());
const jv = new JsonView(host, { onSelect: (r) => console.log(r?.end) });
jv.setData(doc.rootNode, '[1,2,3]');
jv.reset();
jv.destroy();
doc.dispose();

/* ---- 框架封装 ---- */
const reactNode = (
  <JsonExplorer
    value="{}"
    theme="light"
    onStats={(s) => console.log(s.lines)}
    onError={(err) => console.log(err.message)}
  />
);
void reactNode;

const el = new JsonExplorerElement();
JsonExplorerElement.wasmUrl = '/wasm/';
el.on('stats', (s) => console.log(s.chars));
const un = el.on('load', (r) => console.log(r.totalMs));
un();
void el.stats;

const action = jsonExplorer(document.createElement('div'), {
  value: '{}',
  onReady: (a) => console.log(a.text),
  onError: (err) => console.log(err.message),
});
action.update({ theme: 'dark' });
action.destroy();
console.log(action.api.stats);

/* ---- 事件映射表本身也要能取到 ---- */
type Names = keyof ExplorerEvents;
const names: Names[] = ['load', 'repaint', 'stats', 'tabchange', 'hover', 'select', 'error'];
void names;
