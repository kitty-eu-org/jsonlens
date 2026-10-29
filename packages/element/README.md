# @fagao-ai/jsonlens-element

[![npm version](https://img.shields.io/npm/v/@fagao-ai/jsonlens-element.svg)](https://www.npmjs.com/package/@fagao-ai/jsonlens-element)

`<json-explorer>` custom element for [jsonlens](https://github.com/kitty-eu-org/jsonlens), a JSON viewer built for very large documents.

Usable from plain HTML with no framework and no build step.

## Install

```bash
npm install @fagao-ai/jsonlens-element
```

## Usage

```html
<json-explorer src="/data.json" theme="dark" expand-depth="2" style="height: 600px"></json-explorer>

<script type="module">
  import '@fagao-ai/jsonlens-element/style.css';
  import { JsonExplorerElement } from '@fagao-ai/jsonlens-element';

  JsonExplorerElement.wasmUrl = '/wasm/';

  document.addEventListener('select', (e) => console.log(e.detail));
</script>
```

## Attributes

| Attribute | Description |
| --- | --- |
| `src` | URL to fetch the JSON from |
| `value` | Inline JSON text. Takes precedence over `src`. |
| `theme` | `light` (default) · `dark` · `auto` |
| `tab` | `json` (default) · `tree` |
| `title` | file name in the header |
| `expand-depth` | auto-expand depth |

`src`, `theme`, `tab`, `title` and `expand-depth` are live: changing them updates the instance.

## Methods and properties

`load(text)` · `expandTo(n)` · `collapseAll()` · `setTab(tab)` · `setTheme(theme)` · `scrollToLine(line, opts)`

Properties: `stats` · `explorer` (the underlying `Explorer`).

## Events

Bubbling `CustomEvent`s: `hover` · `select` · `stats` · `load` · `tabchange` · `loaderror`

Listen with `addEventListener`, or with `el.on(type, fn)` which unwraps `detail` for you.

`loaderror` covers two cases: the `src` request failed, and wasm initialisation failed. `detail` is the original error.

## Four things to know

1. **No default height.** Set `style="height: 600px"` or a CSS rule.
2. **Import the stylesheet.** `import '@fagao-ai/jsonlens-element/style.css'` when bundling, or a `<link>` to `dist/style.css` when not.
3. **Do not put large JSON in the `value` attribute.** Use `src` or `el.load(text)` — the attribute is serialized into the DOM.
4. **Element creation is deferred by one macrotask.** Setting `JsonExplorerElement.wasmUrl` after the import (even after an `await`) still applies to elements already in the markup. The trade-off is that content appears one tick after insertion. To get the instance, await `customElements.whenDefined('json-explorer')` and then a tick, or read `el.explorer`.

## License

[Apache License 2.0](./LICENSE)

Copyright 2026 JSONLens contributors
