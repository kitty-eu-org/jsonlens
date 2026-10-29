# @fagao-ai/jsonlens-svelte

[![npm version](https://img.shields.io/npm/v/@fagao-ai/jsonlens-svelte.svg)](https://www.npmjs.com/package/@fagao-ai/jsonlens-svelte)

Svelte action for [jsonlens](https://github.com/kitty-eu-org/jsonlens), a JSON viewer built for very large documents.

This package does not import `svelte`. It is a plain action with no runtime dependency beyond `@fagao-ai/jsonlens`.

## Install

```bash
npm install @fagao-ai/jsonlens-svelte
```

## Usage

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

The host element needs a height.

## Parameters

| Parameter | Description |
| --- | --- |
| `value` | JSON text. Re-loads when it changes. |
| `theme` | `'light' \| 'dark' \| 'auto'`, default `'light'` |
| `defaultTab` | `'json' \| 'tree'`, default `'json'` |
| `title` | file name in the header |
| `onHover` / `onSelect` | `(range: { start, end } \| null) => void` |
| `onStats` | `(stats) => void` |
| `onReady` | `(explorer) => void` |
| `onError` | `(err: Error) => void`, fired when wasm fails to load |

Any other `ExplorerOptions` field (`expandDepth`, `chunkThreshold`, `wasmUrl`, `showTabs`, `showActions`) is forwarded to the underlying viewer and read on creation.

## Imperative API

The action returns an object whose `api` member is the `Explorer` instance:

```js
const action = jsonExplorer(node, { value: text });
action.api.expandTo(3);
action.api.reveal({ start: 1024, end: 1088 });
```

## Notes

- **Import the stylesheet separately.** Vite's library mode extracts CSS out of the JS bundle, so the action does not bring styles with it.
- **`wasmUrl` in a bundler.** The default relies on `import.meta.url` and breaks once the package is inlined into an app bundle. Pass it explicitly:

  ```js
  import runtime from '@fagao-ai/jsonlens/tree-sitter.wasm?url';
  import language from '@fagao-ai/jsonlens/tree-sitter-json.wasm?url';
  ```

## License

[Apache License 2.0](./LICENSE)

Copyright 2026 JSONLens contributors
