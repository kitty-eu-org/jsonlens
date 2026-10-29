# jsonlens-vue

[![npm version](https://img.shields.io/npm/v/jsonlens-vue.svg)](https://www.npmjs.com/package/jsonlens-vue)

Vue 3 binding for [jsonlens](https://github.com/kitty-eu-org/jsonlens), a JSON viewer built for very large documents.

## Install

```bash
npm install jsonlens-vue
```

`jsonlens` is installed as a dependency. Vue 3 is expected as a peer.

## Usage

```vue
<script setup>
import 'jsonlens-vue/style.css';
import { JsonExplorer } from 'jsonlens-vue';
import { ref } from 'vue';

const text = ref('');
</script>

<template>
  <JsonExplorer :value="text" theme="light" @stats="onStats" style="height: 600px" />
</template>
```

The host element needs a height.

## Props

`value` · `theme` · `defaultTab` · `title` · `expandDepth` · `chunkThreshold` · `wasmUrl` · `showTabs` · `showActions`

Same names and defaults as the `ExplorerOptions` of `jsonlens`. `wasmUrl`, `chunkThreshold` and `title` are read on mount only.

## Emits

`hover` · `select` · `stats` · `ready` · `error`

```vue
<JsonExplorer :value="text" @hover="onHover" @error="onError" />
```

## Template ref

`load` · `expandTo` · `collapseAll` · `setTab` · `setTheme` · `reveal` · `scrollToLine` · `destroy`, plus `stats`, `text` and `instance`.

```js
const viewer = ref(null);
viewer.value.expandTo(3);
```

## Notes

- **Import the stylesheet separately.** Vite's library mode extracts CSS out of the JS bundle, so importing the component does not bring styles with it.
- **`wasmUrl` in a bundler.** The default relies on `import.meta.url` and breaks once the package is inlined into an app bundle. Pass it explicitly:

  ```js
  import runtime from 'jsonlens/tree-sitter.wasm?url';
  import language from 'jsonlens/tree-sitter-json.wasm?url';
  ```

  ```vue
  <JsonExplorer :value="text" :wasm-url="{ runtime, language }" />
  ```

## License

MIT
