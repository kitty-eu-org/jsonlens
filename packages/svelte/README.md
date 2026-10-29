# jsonlens-svelte

[`jsonlens`](https://www.npmjs.com/package/jsonlens) 的 Svelte action，50 行。
**零运行时依赖** —— 这个包不 import `svelte`，也不需要 Svelte 的预处理器。

```bash
npm i jsonlens-svelte
```

```svelte
<script>
  import 'jsonlens-svelte/style.css';
  import { jsonExplorer } from 'jsonlens-svelte';

  let text = '';
  let stats;
</script>

<div
  use:jsonExplorer={{ value: text, theme: 'light', expandDepth: 2, onStats: (s) => (stats = s) }}
  style="height: 600px"
></div>
```

## 参数

`value` `theme` `defaultTab` `title` `expandDepth` `chunkThreshold` `wasmUrl` `showTabs` `showActions`
`onHover` `onSelect` `onStats` `onReady` `onError`

`value` 变化会重新 `load()`，`theme` / `defaultTab` 变化会调对应的 imperative API。
`wasmUrl` / `chunkThreshold` / `title` 只在创建时生效（改它们等于重建实例，代价太大）。
需要命令式 API（`expandTo` / `reveal` / `stats`）时，action 的返回值上就有：

```js
const action = jsonExplorer(node, { value });
action.api.expandTo(3);
```

## 两个必须知道的点

1. **样式要显式引入**：`import 'jsonlens-svelte/style.css'`（lib 模式 CSS 被抽走，JS 里不留引用）。
2. **宿主必须给高度**，组件不猜。

MIT
