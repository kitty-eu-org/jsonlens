# jsonlens-react

[![npm version](https://img.shields.io/npm/v/jsonlens-react.svg)](https://www.npmjs.com/package/jsonlens-react)

React binding for [jsonlens](https://github.com/kitty-eu-org/jsonlens), a JSON viewer built for very large documents.

## Install

```bash
npm install jsonlens-react
```

`jsonlens` is installed as a dependency. React 17 or newer is expected as a peer.

## Usage

```jsx
import 'jsonlens-react/style.css';
import { JsonExplorer } from 'jsonlens-react';

<JsonExplorer
  value={text}
  theme="light"
  expandDepth={2}
  onStats={setStats}
  style={{ height: 600 }}
/>
```

The host element needs a height. `style` and `className` are forwarded to it.

## Props

| Prop | Default | Description |
| --- | --- | --- |
| `value` | — | JSON text. Re-loads when it changes. |
| `theme` | `'light'` | `'light' \| 'dark' \| 'auto'` |
| `defaultTab` | `'json'` | `'json' \| 'tree'` |
| `title` | `'source.json'` | file name in the header |
| `expandDepth` | `0` | auto-expand depth |
| `chunkThreshold` | `64000` | characters above which chunked parsing is used |
| `wasmUrl` | — | pass explicitly in production, see below |
| `showTabs` / `showActions` | `true` | hide the built-in toolbar |
| `onHover` / `onSelect` | — | `(range: { start, end } \| null) => void` |
| `onStats` | — | `(stats) => void` |
| `onReady` | — | `(explorer) => void` |
| `onError` | — | `(err: Error) => void`, fired when wasm fails to load |

`wasmUrl`, `chunkThreshold` and `title` are read on mount only.

## Ref

| Member | Description |
| --- | --- |
| `expandTo(depth)` / `collapseAll()` | expand / collapse |
| `setTab(tab)` / `setTheme(theme)` | switch panel or theme |
| `reveal(range)` / `scrollToLine(line, opts)` | scroll to a source range or line |
| `load(text, opts)` / `destroy()` | imperative load / teardown |
| `stats` / `text` | current state |
| `instance` | the underlying `Explorer` from `jsonlens` |

## Notes

- **Import the stylesheet separately.** Vite's library mode extracts CSS out of the JS bundle, so importing the component does not bring styles with it.
- **`wasmUrl` in a bundler.** The default relies on `import.meta.url` and breaks once the package is inlined into an app bundle. Pass it explicitly:

  ```js
  import runtime from 'jsonlens/tree-sitter.wasm?url';
  import language from 'jsonlens/tree-sitter-json.wasm?url';

  <JsonExplorer value={text} wasmUrl={{ runtime, language }} />
  ```

## License

[Apache License 2.0](./LICENSE)

Copyright 2026 JSONLens contributors
