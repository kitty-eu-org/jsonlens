# jsonlens

[![npm version](https://img.shields.io/npm/v/jsonlens.svg)](https://www.npmjs.com/package/jsonlens)

A JSON viewer for documents that are too large to render directly. 24 MB / 1.53 M lines opens in about 140 ms in the browser.

Framework-agnostic, zero runtime dependencies. Highlighting comes from tree-sitter compiled to WebAssembly.

Full documentation, benchmarks and limitations: [github.com/kitty-eu-org/jsonlens](https://github.com/kitty-eu-org/jsonlens)

## Install

```bash
npm install jsonlens
```

`web-tree-sitter` is installed along with it. The two `.wasm` files ship inside the package.

## Quick start

```js
import 'jsonlens/style.css';
import { createExplorer } from 'jsonlens';

const viewer = createExplorer(document.getElementById('host'), {
  theme: 'light',
  expandDepth: 2,
});

await viewer.load(jsonText, { title: 'data.json' });
```

```html
<!-- The host must have a height -->
<div id="host" style="height: 600px"></div>
```

## wasm files

Two files are required: `tree-sitter.wasm` (runtime) and `tree-sitter-json.wasm` (JSON grammar). They are not bundled into the JS and must be reachable by URL.

```js
// Directory
createExplorer(el, { wasmUrl: '/wasm/' });

// Or explicit URLs, recommended with a bundler
import runtime from 'jsonlens/tree-sitter.wasm?url';
import language from 'jsonlens/tree-sitter-json.wasm?url';
createExplorer(el, { wasmUrl: { runtime, language } });
```

Omitting `wasmUrl` resolves both files relative to the module. That works only when the module is served as-is: after Vite or webpack inlines the package, the default points at `/assets/tree-sitter.wasm` while the bundler has renamed the file to a hashed name, producing a 404. Pass `wasmUrl` explicitly in production.

The component fetches both files itself and hands the bytes to tree-sitter, so a bad path reports `HTTP 404 ... /wasm/tree-sitter.wasm` instead of emscripten's `both async and sync fetching of the wasm failed`.

## API

### `createExplorer(container, options)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `wasmUrl` | `string \| { runtime, language }` | inferred | wasm location |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'light'` | initial theme |
| `defaultTab` | `'json' \| 'tree'` | `'json'` | initial panel |
| `title` | `string` | `'source.json'` | file name in the header |
| `expandDepth` | `number` | `0` | auto-expand depth |
| `chunkThreshold` | `number` | `64000` | characters above which chunked parsing is used |
| `showTabs` | `boolean` | `true` | render the panel switch |
| `showActions` | `boolean` | `true` | render the expand / collapse buttons |

### Methods

`load(text, { title })` · `clear()` · `setTab(tab)` · `setTheme(theme)` · `expandTo(depth)` · `collapseAll()` · `reveal(range)` · `scrollToLine(line, { align })` · `destroy()`

### Properties

`ready` (`Promise<Explorer>`) · `el` · `text` · `stats` · `chunked`

### Events

`api.on(type, handler)` and `api.off(type, handler)`.

| Event | Payload |
| --- | --- |
| `load` | `{ parseMs, updateMs, layoutMs, paintMs, panelMs, totalMs, tokens, lines, cached }` |
| `repaint` | same as `load` |
| `stats` | `{ chars, lines, chunks, mode, ... }` |
| `tabchange` | `'json' \| 'tree'` |
| `hover` | `{ start, end } \| null` |
| `select` | `{ start, end } \| null` |
| `error` | `Error` — wasm initialisation failed |

## Engines

`jsonlens/engines` exposes the internals without any UI, for building a custom viewer:

`ChunkedDoc` · `Highlighter` · `JsonView` · `renderTree` · `scanTopLevel` · `diffEdit` · `pointAt`

```js
import { ChunkedDoc, Highlighter, JsonView } from 'jsonlens/engines';

const doc = new ChunkedDoc(text, parser);
doc.prime(1);

const hl = new Highlighter(pre, query, { contentPositioned: true });
hl.update(text, doc);
hl.render(scrollTop, scrollLeft, clientHeight, false, clientWidth);
```

## Other frameworks

| Package | Usage |
| --- | --- |
| `jsonlens-react` | `<JsonExplorer value={text} />` |
| `jsonlens-vue` | `<JsonExplorer :value="text" />` |
| `jsonlens-svelte` | `use:jsonExplorer` |
| `jsonlens-element` | `<json-explorer>` |

## Notes

- The host element must have a height. Do not set `height: 100%` on `.jl-root`, it overrides a height set on the same element.
- Vite's library mode extracts CSS from the JS bundle, so `import 'jsonlens/style.css'` is required.
- Rows are 20 px and expect a monospace font. Pass `charWidth: 0` to disable horizontal clipping.
- `destroy()` releases the wasm trees. A 24 MB document scrolled to the bottom holds about 450 MB of wasm heap; the ceiling is 2 GB.

## License

MIT
