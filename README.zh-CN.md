# JSONLens

[English](./README.md) | **简体中文**

[![npm version](https://img.shields.io/npm/v/@fagao-ai/jsonlens.svg)](https://www.npmjs.com/package/@fagao-ai/jsonlens)
[![npm downloads](https://img.shields.io/npm/dm/@fagao-ai/jsonlens.svg)](https://www.npmjs.com/package/@fagao-ai/jsonlens)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fagao-ai/jsonlens.svg)](https://bundlephobia.com/package/@fagao-ai/jsonlens)
[![license](https://img.shields.io/npm/l/@fagao-ai/jsonlens.svg)](./LICENSE)
[![stars](https://img.shields.io/github/stars/kitty-eu-org/jsonlens.svg)](https://github.com/kitty-eu-org/jsonlens)

一个用于打开超大 JSON 文件的浏览器端查看器。

24 MB / 153 万行 / 410 万 token，约 140 ms 可交互。只有屏幕上那一屏会被解析和渲染。高亮由 tree-sitter（Zed、GitHub 使用的解析引擎）编译成 WebAssembly 提供，token 来自语法树而非正则匹配。

## 特性

- **分块懒解析。** 顶层数组和对象的每个元素在语法上互相独立，可以各自包一层括号单独解析。首屏只解析一块，其余滚到哪解析到哪。
- **双轴虚拟滚动。** 行和列都做裁剪。一行 2200 字符的 JSON，在 1440 px 视口上只建约 170 个 span，而不是 15000 个。
- **可折叠树视图**，行按需创建，滚动到底自动加载。
- **语法树面板**，查看 tree-sitter 的解析结果并跳转到对应源码。
- **内核与框架无关**，零运行时依赖，只有纯 DOM API 和事件。
- **薄封装**，React / Vue / Svelte / Web Component 各 80–210 行。

## 包

| 包 | 说明 |
| --- | --- |
| [`@fagao-ai/jsonlens`](packages/core) | 查看器本体和引擎层，零依赖 |
| [`@fagao-ai/jsonlens-react`](packages/react) | `<JsonExplorer value={text} />` |
| [`@fagao-ai/jsonlens-vue`](packages/vue) | `<JsonExplorer :value="text" />` |
| [`@fagao-ai/jsonlens-svelte`](packages/svelte) | `use:jsonExplorer` action |
| [`@fagao-ai/jsonlens-element`](packages/element) | `<json-explorer>` 自定义元素 |

## 安装

```bash
npm install @fagao-ai/jsonlens
```

`web-tree-sitter` 是普通依赖，会一起装上。两个 `.wasm` 文件随包分发。

## 快速开始

### 原生 JS

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
<!-- 宿主必须给高度，组件不会自己猜 -->
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
// ref.current.instance 是底层的 Explorer 实例
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

支持属性：`src`、`value`、`theme`、`tab`、`title`、`expand-depth`。

### 没有构建工具

把 `@fagao-ai/jsonlens/dist/`（整个目录，含两个 `.wasm` 和 `style.css`）和 `web-tree-sitter/tree-sitter.js` 拷进静态目录，用 import map 指过去：

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

## wasm 文件

需要两个文件：运行时 `tree-sitter.wasm` 和 JSON 语法 `tree-sitter-json.wasm`。它们不参与 JS 打包，必须能被浏览器按 URL 取到。

```js
// 1. 给目录，结尾的斜杠会自动补
createExplorer(el, { wasmUrl: '/wasm/' });

// 2. 给两个完整 URL，配合打包器时推荐
import runtime from '@fagao-ai/jsonlens/tree-sitter.wasm?url';
import language from '@fagao-ai/jsonlens/tree-sitter-json.wasm?url';
createExplorer(el, { wasmUrl: { runtime, language } });

// 3. 不传，按 import.meta.url 从模块所在目录推断
createExplorer(el);
```

第 3 种只在模块被原样加载时成立。一旦 Vite 或 webpack 把包内联进 app bundle，默认值会指向 `/assets/tree-sitter.wasm`，而打包器早已把文件改名成 `tree-sitter-qKYAACSa.wasm` 之类，结果就是 404。**生产环境请显式传 `wasmUrl`。**

另外 Vite 的 lib 模式会把 CSS 抽成独立文件，样式需要单独引入：

```js
import '@fagao-ai/jsonlens/style.css';
```

## API

### `createExplorer(container, options)`

`container` 是元素或选择器，元素原有内容会被替换。

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `wasmUrl` | `string \| { runtime, language }` | 自动推断 | wasm 位置，见上一节 |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'light'` | 初始主题 |
| `defaultTab` | `'json' \| 'tree'` | `'json'` | 初始右侧面板 |
| `title` | `string` | `'source.json'` | 左上角文件名 |
| `expandDepth` | `number` | `0` | 载入后自动展开的层数 |
| `chunkThreshold` | `number` | `64000` | 超过多少字符走分块解析 |
| `showTabs` | `boolean` | `true` | 是否显示面板切换 |
| `showActions` | `boolean` | `true` | 是否显示展开 / 折叠按钮 |

`wasmUrl`、`chunkThreshold`、`title` 只在创建时读取一次。`theme`、`defaultTab` 和文档内容可以通过 API 修改。

### 方法

| 方法 | 说明 |
| --- | --- |
| `load(text, { title })` | 载入文档，返回分阶段计时 |
| `clear()` | 清空视图，保留 DOM 结构 |
| `setTab(tab)` | 切换面板：`'json'` 或 `'tree'` |
| `setTheme(theme)` | `'light'`、`'dark'` 或 `'auto'` |
| `expandTo(depth)` | 展开到第几层，每个容器最多 200 个子节点 |
| `collapseAll()` | 全部折叠 |
| `reveal(range)` | 把某段源码滚进视区并高亮 |
| `scrollToLine(line, { align })` | 滚到第几行（0 起），`align` 为 `'start'` 或 `'center'` |
| `destroy()` | 摘监听、断观察器、释放 wasm 里的语法树 |

### 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `ready` | `Promise<Explorer>` | wasm 就绪，多个实例之间共享 |
| `el` | `HTMLElement` | 容器元素，已加上 `.jl-root` |
| `text` | `string` | 当前文档 |
| `stats` | `ExplorerStats \| null` | 字符数、行数、解析模式、分块进度 |
| `chunked` | `object \| null` | 分块文档；整棵解析时为 `null` |

### 事件

`api.on(type, handler)` 和 `api.off(type, handler)`。

| 事件 | 载荷 |
| --- | --- |
| `load` | `LoadResult` |
| `repaint` | `LoadResult` |
| `stats` | `ExplorerStats` |
| `tabchange` | `'json' \| 'tree'` |
| `hover` | `{ start, end } \| null` |
| `select` | `{ start, end } \| null` |
| `error` | `Error` |

`load` 和 `repaint` 携带分阶段计时：

```ts
{ parseMs, updateMs, layoutMs, paintMs, panelMs, totalMs, tokens, lines, cached }
```

`hover` 和 `select` 在两个面板里都会触发，载荷是半开源码区间。程序化调用 `api.reveal(range)` 不会反过来触发它们。

`error` 只在 wasm 初始化失败时触发，比如路径写错、离线、CDN 被墙。接住它可以避免控制台出现未处理的 Promise 拒绝；`ready` 本身仍会 reject，用 `try/catch` 也可以。两个文件由组件自己 fetch，所以错误信息里带失败的具体 URL。

```js
api.on('error', (err) => console.warn('wasm 加载失败:', err.message));
```

## 引擎层

`@fagao-ai/jsonlens/engines` 只导出零件，不建任何 DOM，用于自己搭 UI。

| 导出 | 说明 |
| --- | --- |
| `ChunkedDoc` | 按顶层元素切块，按需解析 |
| `Highlighter` | 双轴窗口化高亮 |
| `JsonView` | 可折叠 JSON 视图，行按需创建 |
| `renderTree` | 语法树视图 |
| `scanTopLevel` | 定位顶层元素边界 |
| `diffEdit`、`pointAt` | 文本 diff 转 tree-sitter `Edit`，用于增量解析 |

```js
const doc = new ChunkedDoc(text, parser);
doc.prime(1);

const hl = new Highlighter(pre, query, { contentPositioned: true });
hl.update(text, doc);
hl.render(scrollTop, scrollLeft, clientHeight, false, clientWidth);

const tree = new JsonView(panel, { onSelect: (r) => reveal(r) });
tree.setData(doc.rootNode, text);
```

## 性能

Playwright 测量，每个组合独占一个浏览器进程，每档跑三次取中位数。`paint` 指从 `load()` 到画出第一帧。

| 实现 | 0.12 MB | 1.25 MB | 24.9 MB | DOM 节点数（24.9 MB） | 堆（24.9 MB） |
| --- | ---: | ---: | ---: | ---: | ---: |
| **jsonlens** | **33** | **33** | **101** | **2790** | **27 MB** |
| @textea/json-viewer 4.0 | 118 | 133 | 150 | 2219 | 75 MB |
| json-formatter-js 2.5 | **33** | 67 | 300 | 91617 | 54 MB |
| jsoneditor 10.4 | **33** | 50 | 417 | 1633 | 411 MB |
| @uiw/react-json-view 2.0 | 34 | 205 | 903 | 136222 | 211 MB |
| vue-json-pretty 2.6 | 83 | 4400 | 未完成 | — | — |

在 24.9 MB 这一档，「能不能用」比 paint 更能说明问题：

| 实现 | paint | 堆 | 最长同步任务 | 总阻塞 |
| --- | ---: | ---: | ---: | ---: |
| **jsonlens** | **101 ms** | **27 MB** | **88 ms** | **38 ms** |
| @textea/json-viewer | 150 ms | 75 MB | 139 ms | 89 ms |
| json-formatter-js | 300 ms | 54 MB | 283 ms | 233 ms |
| jsoneditor | 417 ms | 411 MB | 413 ms | 363 ms |
| @uiw/react-json-view | 903 ms | 211 MB | 692 ms | 783 ms |

0.12 MB 这一档所有虚拟化实现的读数都是 33 ms，因为指标被帧量化了，差别要看挂载耗时：json-formatter-js 2 ms、jsoneditor 7 ms、jsonlens 16 ms（首屏还额外建了 2157 个高亮 span）。

复现：

```bash
npx vite build --config bench/vite.config.js
python3 -m http.server 5184 --directory bench/dist &
node bench/run.mjs --r=3
```

各库的展开深度语义不同，对比时按「DOM 数量级最接近」取档，`dom` 列是最客观的一项。

## 实现要点

**分块解析。** 一次线性扫描找出所有深度为 1 的逗号，用 `indexOf('"')` 整段跳过字符串内容，25 MB 约 28 ms。每个元素区间包一层 `[ ]` 后当作独立文档解析，位置通过加上块偏移映射回原文。虚拟根节点用鸭子类型实现 tree-sitter 的 `Node` 接口，所以上层的视图代码不用感知分块。

**64 KB 阈值**是实测的交叉点：整棵解析约 10 ms/100 KB，分块的固定开销是扫描 1.1 ms/MB 加首块 5 ms，且不随文件增长。

**不走 textarea。** 把 24 MB 字符串赋给可见的 `<textarea>`，仅排版就要 0.9–1.2 s。大文档渲染进只读定位容器，滚动尺寸靠计算得出，浏览器实际只排 40 行左右。

**wasm 内存。** `Tree` 是 wasm 堆上的对象，web-tree-sitter 0.25 没有注册终结器，必须由 `destroy()` 显式 delete。24 MB 文档从头解析到尾约占 450 MB，上限 2 GB。丢弃实例时一定要 `destroy()`。

## 限制

- **分块依赖足够多的顶层元素。** 像 `{"code":0,"data":{"total":N,"items":[...]}}` 这种结构顶层只有 3 个 key，会退化成整棵解析，24 MB 约需 2.2 s。
- **宿主必须给高度。** 不要给 `.jl-root` 加 `height: 100%`，它会把同一个元素上的高度覆盖掉，滚动容器的 `clientHeight` 变成几万像素，虚拟滚动退化成全量渲染。
- **行高 20 px 且使用等宽字体。** 横向裁剪要按字符宽换算列号，比例字体会让换算失效；可以传 `charWidth: 0` 关掉横向裁剪。
- **`expandTo` 每个容器最多展开 200 个子节点。** 没有这个上限时，对 24000 元素的数组展开两层会把所有行都建出来。
- **只做语法层面的事。** tree-sitter 只能报告语法错误，重复 key、数字溢出需要再套 `JSON.parse` 或 schema。
- **wasm 堆只增不减。** 24 MB 文档滚到底约占 450 MB，同时开几个实例就会撞上 2 GB 上限。

## 开发

```bash
npm install
npm run dev            # playground，http://localhost:5180
npm run dev:examples   # 四框架示例，http://localhost:5181

npm run build          # 五个包加两个 demo 站点
npm run smoke          # 11 条 Playwright 用例，跑的是构建产物
npm run typecheck      # 用 tsc 校验所有 .d.ts，types/typecheck.tsx 是使用方
npm run check:edit     # 增量行索引和整份重扫的对拍
npm run check:mem      # wasm 堆增长，destroy 开关两组对比
npm run pack:check     # 五个包的 tarball 自检
npm run check          # 以上除 smoke 外的全部
npm run bench -- --r=3 # 横向对比，需先起 bench 静态服务
```

发布流程见 [RELEASING.md](RELEASING.md)。

```
packages/core/src/
  explorer.js         查看器：模板、布局、事件委托、对外 API
  wasm.js             两个 wasm 的定位与初始化
  style.css           全部收在 .jl- 前缀下
  engines/
    chunked.js        分块解析与虚拟根节点
    highlight.js      双轴窗口化高亮
    jsonview.js       可折叠 JSON 视图
    treeview.js       语法树视图
    diff.js           文本 diff 转 tree-sitter Edit
packages/{react,vue,svelte,element}/src/index.js   薄封装
scripts/              构建、冒烟测试、内存与 tarball 检查
examples/             原生 / React / Vue / Web Component 示例
src/                  playground（可编辑源码，增量解析）
bench/                与主流库的横向对比
```

## 许可证

[Apache License 2.0](./LICENSE)

Copyright 2026 JSONLens contributors

含专利授权。再分发时需保留许可证副本，修改过的文件需要注明。
