# JSONLens

**English** | [简体中文](./README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/@fagao-ai/jsonlens.svg)](https://www.npmjs.com/package/@fagao-ai/jsonlens)
[![npm downloads](https://img.shields.io/npm/dm/@fagao-ai/jsonlens.svg)](https://www.npmjs.com/package/@fagao-ai/jsonlens)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fagao-ai/jsonlens.svg)](https://bundlephobia.com/package/@fagao-ai/jsonlens)
[![license](https://img.shields.io/npm/l/@fagao-ai/jsonlens.svg)](./LICENSE)
[![stars](https://img.shields.io/github/stars/kitty-eu-org/jsonlens.svg)](https://github.com/kitty-eu-org/jsonlens)

A JSON viewer for documents that are too large to render directly.

24 MB / 1.53 M lines / 4.1 M tokens opens in about 140 ms in the browser. Only the slice on screen is parsed and painted. Highlighting comes from tree-sitter — the parser used by Zed and GitHub — compiled to WebAssembly, so tokens are grammar-accurate rather than regex-matched.

## Features

- **Chunked lazy parsing.** Top-level array and object elements are syntactically independent, so each range is wrapped and parsed on its own. The first screen parses one chunk; the rest parse as you scroll.
- **Two-axis virtualization.** Both rows and columns are clipped. A 2,200-character line costs ~170 spans on a 1,440 px viewport instead of 15,000.
- **Collapsible tree view** with lazy row construction and infinite scroll.
- **Syntax tree panel** — inspect the tree-sitter parse tree and jump to the matching source range.
- **Framework-agnostic core**, no runtime dependencies, plain DOM API plus events.
- **Thin wrappers** for React, Vue, Svelte and Web Components (80–210 lines each).

## Packages

| Package | Description |
| --- | --- |
| [`@fagao-ai/jsonlens`](packages/core) | Core viewer and engine layer. Zero dependencies. |
| [`@fagao-ai/jsonlens-react`](packages/react) | `<JsonExplorer value={text} />` |
| [`@fagao-ai/jsonlens-vue`](packages/vue) | `<JsonExplorer :value="text" />` |
| [`@fagao-ai/jsonlens-svelte`](packages/svelte) | `use:jsonExplorer` action |
| [`@fagao-ai/jsonlens-element`](packages/element) | `<json-explorer>` custom element |

## Install

```bash
npm install @fagao-ai/jsonlens
```

`web-tree-sitter` is a regular dependency and is installed with it. The two `.wasm` files ship inside the package.

## Quick start

### Vanilla JS

```js
import '@fagao-ai/jsonlens/style.css';
import { createExplorer } from '@fagao-ai/jsonlens';

const viewer = createExplorer(document.getElementById('host'), {
  theme: 'light',
  expandDepth: 2,
});

viewer.on('stats', (s) => console.log(s.chars, s.mode, s.chunks));
await viewer.load(jsonText, { title: 'data.json' });
```

```html
<!-- The host must have a height. The viewer does not guess one. -->
<div id="host" style="height: 600px"></div>
```

### React

```jsx
import '@fagao-ai/jsonlens-react/style.css';
import { JsonExplorer } from '@fagao-ai/jsonlens-react';

const ref = useRef(null);

<JsonExplorer
  value={text}
  theme="light"
  expandDepth={2}
  onStats={setStats}
  onSelect={(range) => console.log(range)}
  ref={ref}
/>

// ref.current.expandTo(3) / .collapseAll() / .reveal(range) / .scrollToLine(120)
// ref.current.instance -> underlying Explorer
```

### Vue 3

```vue
<script setup>
import '@fagao-ai/jsonlens-vue/style.css';
import { JsonExplorer } from '@fagao-ai/jsonlens-vue';
import { ref } from 'vue';

const text = ref('');
</script>

<template>
  <JsonExplorer :value="text" theme="light" @stats="onStats" style="height: 600px" />
</template>
```

### Svelte

```svelte
<script>
  import '@fagao-ai/jsonlens-svelte/style.css';
  import { jsonExplorer } from '@fagao-ai/jsonlens-svelte';

  let text = '';
</script>

<div
  use:jsonExplorer={{ value: text, theme: 'light', onSelect: (r) => console.log(r) }}
  style="height: 600px"
></div>
```

### Web Component

```html
<json-explorer src="/data.json" theme="dark" expand-depth="2" style="height: 600px"></json-explorer>

<script type="module">
  import { JsonExplorerElement } from '@fagao-ai/jsonlens-element';
  JsonExplorerElement.wasmUrl = '/wasm/';
  document.addEventListener('select', (e) => console.log(e.detail));
</script>
```

### Without a bundler

Copy `@fagao-ai/jsonlens/dist/` (the whole directory, including both `.wasm` files and `style.css`) and `web-tree-sitter/tree-sitter.js` into a static folder, then map them with an import map:

```html
<link rel="stylesheet" href="/vendor/jsonlens/dist/style.css">
<div id="host" style="height: 600px"></div>

<script type="importmap">
{
  "imports": {
    "web-tree-sitter": "/vendor/web-tree-sitter/tree-sitter.js",
    "@fagao-ai/jsonlens": "/vendor/jsonlens/dist/index.js"
  }
}
</script>

<script type="module">
  import { createExplorer } from '@fagao-ai/jsonlens';

  const api = createExplorer('#host', { wasmUrl: '/vendor/jsonlens/dist/' });
  const res = await fetch('/data.json');
  await api.load(await res.text());
</script>
```

## WASM files

Two files are required: the runtime (`tree-sitter.wasm`) and the JSON grammar (`tree-sitter-json.wasm`). They are not part of the JS bundle and must be reachable by URL.

```js
// 1. Directory. The trailing slash is added if missing.
createExplorer(el, { wasmUrl: '/wasm/' });

// 2. Explicit URLs. Recommended with a bundler.
import runtime from '@fagao-ai/jsonlens/tree-sitter.wasm?url';
import language from '@fagao-ai/jsonlens/tree-sitter-json.wasm?url';
createExplorer(el, { wasmUrl: { runtime, language } });

// 3. Omitted. Resolved relative to the module via import.meta.url.
createExplorer(el);
```

Option 3 only works when the module is served as-is. Once Vite or webpack inlines the package into an app bundle, the default resolves to `/assets/tree-sitter.wasm` while the bundler has already renamed the file to something like `tree-sitter-qKYAACSa.wasm`, producing a 404. Pass `wasmUrl` explicitly in production.

Note that Vite's library mode extracts CSS out of the JS bundle, so the stylesheet is a separate import:

```js
import '@fagao-ai/jsonlens/style.css';
```

## API

### `createExplorer(container, options)`

`container` is an element or a selector. The element's contents are replaced.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `wasmUrl` | `string \| { runtime, language }` | inferred | Location of the wasm files. See above. |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'light'` | Initial theme. |
| `defaultTab` | `'json' \| 'tree'` | `'json'` | Initial right-hand panel. |
| `title` | `string` | `'source.json'` | File name shown in the header. |
| `expandDepth` | `number` | `0` | Auto-expand depth after load. |
| `chunkThreshold` | `number` | `64000` | Character count above which chunked parsing is used. |
| `showTabs` | `boolean` | `true` | Render the JSON / syntax tree switch. |
| `showActions` | `boolean` | `true` | Render the expand / collapse buttons. |

`wasmUrl`, `chunkThreshold` and `title` are read once, at creation. `theme`, `defaultTab` and the document are mutable through the API.

### Methods

| Method | Description |
| --- | --- |
| `load(text, { title })` | Load a document. Resolves with a timing breakdown. |
| `clear()` | Reset the view, keeping the DOM structure. |
| `setTab(tab)` | Switch panels: `'json'` or `'tree'`. |
| `setTheme(theme)` | `'light'`, `'dark'` or `'auto'`. |
| `expandTo(depth)` | Expand to a depth. At most 200 children per container. |
| `collapseAll()` | Collapse everything. |
| `reveal(range)` | Scroll a source range into view and highlight it. |
| `scrollToLine(line, { align })` | Scroll to a line (0-based). `align` is `'start'` or `'center'`. |
| `destroy()` | Remove listeners, disconnect observers, free the wasm trees. |

### Properties

| Property | Type | Description |
| --- | --- | --- |
| `ready` | `Promise<Explorer>` | Resolves when wasm is initialised. Shared across instances. |
| `el` | `HTMLElement` | The container, with `.jl-root` applied. |
| `text` | `string` | Current document. |
| `stats` | `ExplorerStats \| null` | Character count, lines, mode, chunk progress. |
| `chunked` | `object \| null` | Chunked document, or `null` when parsed as a whole. |

### Events

`api.on(type, handler)` and `api.off(type, handler)`.

| Event | Payload |
| --- | --- |
| `load` | `LoadResult` |
| `repaint` | `LoadResult` |
| `stats` | `ExplorerStats` |
| `tabchange` | `'json' \| 'tree'` |
| `hover` | `{ start, end } \| null` |
| `select` | `{ start, end } \| null` |
| `error` | `Error` |

`load` and `repaint` carry the timing breakdown:

```ts
{ parseMs, updateMs, layoutMs, paintMs, panelMs, totalMs, tokens, lines, cached }
```

`hover` and `select` fire from both panels; the payload is a half-open source range. Calling `api.reveal(range)` programmatically does not re-emit them.

`error` fires when wasm initialisation fails — a wrong path, an offline CDN, a blocked request. Handling it keeps an unhandled rejection off the console; `ready` still rejects, so `try/catch` works too. Because the component fetches both files itself, the error message contains the failing URL.

```js
api.on('error', (err) => console.warn('wasm failed to load:', err.message));
```

## Engines

`@fagao-ai/jsonlens/engines` exports the parts without any UI, for building a custom viewer.

| Export | Description |
| --- | --- |
| `ChunkedDoc` | Splits a document at top-level elements; parses chunks on demand. |
| `Highlighter` | Windowed highlighting on both axes. |
| `JsonView` | Collapsible JSON view with lazy rows. |
| `renderTree` | Syntax tree view. |
| `scanTopLevel` | Locates top-level element boundaries. |
| `diffEdit`, `pointAt` | Text diff to tree-sitter `Edit`, for incremental parsing. |

```js
const doc = new ChunkedDoc(text, parser);
doc.prime(1);

const hl = new Highlighter(pre, query, { contentPositioned: true });
hl.update(text, doc);
hl.render(scrollTop, scrollLeft, clientHeight, false, clientWidth);

const tree = new JsonView(panel, { onSelect: (r) => reveal(r) });
tree.setData(doc.rootNode, text);
```

## Performance

Measured with Playwright, one browser process per combination, three runs per cell, median reported. `paint` is time from `load()` to the first painted frame.

| Implementation | 0.12 MB | 1.25 MB | 24.9 MB | DOM nodes (24.9 MB) | Heap (24.9 MB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| **jsonlens** | **33** | **33** | **101** | **2,790** | **27 MB** |
| @textea/json-viewer 4.0 | 118 | 133 | 150 | 2,219 | 75 MB |
| json-formatter-js 2.5 | **33** | 67 | 300 | 91,617 | 54 MB |
| jsoneditor 10.4 | **33** | 50 | 417 | 1,633 | 411 MB |
| @uiw/react-json-view 2.0 | 34 | 205 | 903 | 136,222 | 211 MB |
| vue-json-pretty 2.6 | 83 | 4,400 | did not finish | — | — |

On the 24.9 MB document, responsiveness separates the implementations more clearly than paint time:

| Implementation | paint | heap | longest task | total blocking |
| --- | ---: | ---: | ---: | ---: |
| **jsonlens** | **101 ms** | **27 MB** | **88 ms** | **38 ms** |
| @textea/json-viewer | 150 ms | 75 MB | 139 ms | 89 ms |
| json-formatter-js | 300 ms | 54 MB | 283 ms | 233 ms |
| jsoneditor | 417 ms | 411 MB | 413 ms | 363 ms |
| @uiw/react-json-view | 903 ms | 211 MB | 692 ms | 783 ms |

At 0.12 MB every virtualized implementation lands on 33 ms because the measurement is quantized to frames. The difference there is time to mount: 2 ms for json-formatter-js, 7 ms for jsoneditor, 16 ms for jsonlens, which also builds 2,157 highlight spans on the first screen.

Reproduce:

```bash
npx vite build --config bench/vite.config.js
python3 -m http.server 5184 --directory bench/dist &
node bench/run.mjs --r=3
```

Expansion semantics differ between libraries, so the comparison picks the closest matching depth per library. The `dom` column is the objective part.

## How it works

**Chunked parsing.** A single linear pass finds every depth-1 comma, skipping string contents with `indexOf('"')` — 25 MB scans in about 28 ms. Each element range is wrapped in `[ ]` and parsed as a standalone document; positions map back by adding the chunk offset. The virtual root implements the tree-sitter `Node` interface through duck typing, so the view layers are unaware of chunking.

**The 64 KB threshold** is the measured crossover between parsing the whole document (~10 ms per 100 KB) and paying the fixed chunking cost (1.1 ms per MB scan + 5 ms for the first chunk), which does not grow with file size.

**No textarea.** Assigning a 24 MB string to a visible `<textarea>` costs 0.9–1.2 s in layout alone. Large documents render into a read-only positioned container with computed scroll dimensions, so the browser lays out roughly 40 rows regardless of file size.

**Wasm memory.** `Tree` objects live on the wasm heap and web-tree-sitter 0.25 does not register finalizers, so `destroy()` deletes them explicitly. Parsing a 24 MB document end to end allocates about 450 MB; the ceiling is 2 GB. Always call `destroy()` when discarding an instance.

## Limitations

- **Chunking needs many top-level elements.** A document like `{"code":0,"data":{"total":N,"items":[...]}}` has three top-level keys, so it falls back to parsing the whole tree: about 2.2 s for 24 MB.
- **The host must set a height.** Do not add `height: 100%` to `.jl-root`; it overrides a height set on the same element and collapses the scroll container.
- **20 px rows, monospace font.** Horizontal clipping converts columns to pixel offsets using character width. Proportional fonts break the mapping; pass `charWidth: 0` to disable horizontal clipping instead.
- **`expandTo` caps at 200 children per container.** Without the cap, expanding a 24,000-element array eagerly builds every row.
- **Syntax only.** tree-sitter reports grammar errors. Duplicate keys and numeric overflow need `JSON.parse` or a schema on top.
- **The wasm heap never shrinks.** A 24 MB document scrolled to the bottom holds ~450 MB. Several such instances can exhaust the 2 GB limit.

## Development

```bash
npm install
npm run dev            # playground, http://localhost:5180
npm run dev:examples   # framework examples, http://localhost:5181

npm run build          # all packages plus both demo sites
npm run smoke          # 11 Playwright checks against the built output
npm run typecheck      # tsc against every .d.ts, consumed by types/typecheck.tsx
npm run check:edit     # fuzz the incremental row index against a full rescan
npm run check:mem      # wasm heap growth, with and without destroy()
npm run pack:check     # tarball contents for all five packages
npm run check          # all of the above except smoke
npm run bench -- --r=3 # comparison run; start the bench server first
```

Publishing is documented in [RELEASING.md](RELEASING.md).

```
packages/core/src/
  explorer.js         viewer: template, layout, event delegation, public API
  wasm.js             wasm resolution and initialisation
  style.css           all classes prefixed .jl-
  engines/
    chunked.js        chunked parsing and the virtual root node
    highlight.js      two-axis windowed highlighting
    jsonview.js       collapsible tree view
    treeview.js       syntax tree view
    diff.js           text diff to tree-sitter Edit
packages/{react,vue,svelte,element}/src/index.js   wrappers
scripts/              build, smoke tests, memory and tarball checks
examples/             vanilla, React, Vue and Web Component demos
src/                  playground (editable source, incremental parsing)
bench/                comparison against other libraries
```

## License

[Apache License 2.0](./LICENSE)

Copyright 2026 JSONLens contributors

Includes a patent grant. Redistributions must retain the license and state any modified files.
