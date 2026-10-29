# @jsonlens/vue

[`@jsonlens/core`](https://www.npmjs.com/package/@jsonlens/core) 的 Vue 3 封装，78 行。
用 tree-sitter 分块懒解析 + 双轴窗口化渲染，24 MB JSON 141 ms 打开。

用 render 函数实现，**不需要 Vue 的 SFC 编译插件**，纯 ESM 即可。

```bash
npm i @jsonlens/vue
```

```vue
<script setup>
import '@jsonlens/vue/style.css';
import { JsonExplorer } from '@jsonlens/vue';
import { ref } from 'vue';

const text = ref('');
const viewer = ref(null);
const stats = ref(null);
</script>

<template>
  <button @click="viewer?.expandTo(3)">展开 3 层</button>
  <JsonExplorer
    ref="viewer"
    :value="text"
    theme="light"
    :expand-depth="2"
    style="height: 600px"
    @stats="stats = $event"
  />
</template>
```

## props / emits

props：`value` `theme` `defaultTab` `title` `expandDepth` `chunkThreshold` `wasmUrl` `showTabs` `showActions`

emits：`hover` `select` `stats` `ready` `error` —— 用 `@stats="fn"` 这类声明式写法监听。

组件 `ref` 上是：`load` `expandTo` `collapseAll` `setTab` `setTheme` `reveal` `scrollToLine` `destroy`，
以及 `stats` / `text` / `instance`。

## 两个必须知道的点

1. **样式要显式引入**：`import '@jsonlens/vue/style.css'`。Vite 的 lib 模式会把 CSS 抽成独立文件、JS 里不留引用。
2. **宿主必须给高度**，组件不猜。`wasmUrl` 在打包环境里建议显式传，详见 core 的 README。

MIT
