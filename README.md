# JSONLens

用 tree-sitter（Zed 编辑器里那套解析引擎）在前端查看超大 JSON：**可折叠 JSON 视图 + 语法高亮 + 语法树可视化 + 双轴虚拟滚动**，纯浏览器运行，零后端。

24 MB / 153 万行 / 410 万 token 的文件，**141 ms 打开**（解析 105 + 渲染 0.3 + 面板 34）。同一份数据上比第二快的主流实现还快 33%（101 vs 150 ms），堆只有它的 1/3（27 vs 75 MB），最长同步任务 88 ms —— 页面不会被冻住。

```
@jsonlens/core        零依赖 · 只认 DOM · 命令式 API + 事件
   ├── @jsonlens/react     <JsonExplorer value={text} />
   ├── @jsonlens/vue       <JsonExplorer :value="text" />
   ├── @jsonlens/element   <json-explorer src="…">  （一行标签，不挑构建工具）
   └── @jsonlens/svelte    use:jsonExplorer
```

---

## 0. 先回答那个问题：是不是该先封装成一个 JS 包？

是，而且**只封一个**。行业里的通行做法（Monaco、CodeMirror、Shoelace、TanStack Table 都是这个结构）：

1. **内核零框架依赖**，只暴露 `create(container, options)` + 一组方法 + 一组事件；
2. **框架封装是一层薄壳**，每个 60~150 行，只做「挂载 / 卸载 / 属性变化 → create/load/destroy」；
3. **样式收在自己的前缀下**，不污染宿主页面。

反过来做（先写 React 组件，再给 Vue 抄一份）的代价是：核心逻辑抄 N 份，性能优化要在 N 个地方同时改，行为必然分叉。而这个项目的价值恰好全在内核里（分块懒解析、双轴窗口化、无限滚动），框架层一行逻辑都没有。

所以目录是 `packages/*` + npm workspaces：

| 包 | 行数 | 作用 |
| --- | ---: | --- |
| `@jsonlens/core` | ~1200 | 查看器本体 + 引擎层 |
| `@jsonlens/react` | 113 | `forwardRef`，ref 拿命令式 API |
| `@jsonlens/vue` | 94 | render 函数，不需要 Vue 编译器 |
| `@jsonlens/element` | 160 | 自定义元素，事件转成冒泡的 `CustomEvent` |
| `@jsonlens/svelte` | 74 | action，**不 import svelte**，零运行时依赖 |

---

## 1. 上手

```bash
npm i @jsonlens/core web-tree-sitter
```

### 包还没发到 npm 的时候，怎么给别的项目用

现在这五个包都是 `0.1.0`、**尚未发布**。在这个阶段接入有三条路，都实测过：

**① 本地路径依赖**（自己另几个项目，最省事）

```jsonc
// 消费方的 package.json
"dependencies": {
  "@jsonlens/core": "file:../ts-json-demo/packages/core",
  "@jsonlens/react": "file:../ts-json-demo/packages/react"
}
```

`file:` 要指向**包目录**（里面那层有 `package.json` 的），不是仓库根目录。前提是包目录里已经有 `dist`，所以先跑一次 `npm run build`。

**② 打成 tarball**（要给别人、或要塞进 CI 缓存）

```bash
cd ts-json-demo
npm pack -w @jsonlens/core -w @jsonlens/react -w @jsonlens/element --pack-destination /tmp/pk
cd ../your-app && npm i /tmp/pk/jsonlens-core-0.1.0.tgz
```

`npm pack` 出来的就是 `npm publish` 的**同一份产物**（实测 138 kB，含 `dist/` + 两个 wasm + 两份 `.d.ts` + LICENSE + README），`npm run pack:check` 会校验这些文件在不在。

**③ 正式发 npm**：见 `RELEASING.md`，五个包按 core → 其余四个的顺序发。

> 无论哪条路，**wasm 都要显式配 `wasmUrl`**，下一节会说为什么。

### 原生 / 任意框架

```js
import '@jsonlens/core/style.css';
import { createExplorer } from '@jsonlens/core';

const viewer = createExplorer(document.getElementById('host'), {
  theme: 'light',
  expandDepth: 2,
});

viewer.on('stats', (s) => console.log(s.chars, s.mode, s.chunks));
await viewer.load(jsonText, { title: 'data.json' });
```

```html
<!-- 宿主必须给高度，组件不会替你猜 -->
<div id="host" style="height: 600px"></div>
```

### React

```jsx
import '@jsonlens/react/style.css';
import { JsonExplorer } from '@jsonlens/react';

<JsonExplorer value={text} theme="light" expandDepth={2} onStats={setStats} ref={ref} />
// ref.current.expandTo(3) / .collapseAll() / .reveal(range) / .instance
```

### Vue 3

```vue
<script setup>
import '@jsonlens/vue/style.css';
import { JsonExplorer } from '@jsonlens/vue';
const text = ref('');
</script>

<template>
  <JsonExplorer :value="text" theme="light" @stats="onStats" style="height: 600px" />
</template>
```

### Svelte

```svelte
<script>
  import '@jsonlens/svelte/style.css';
  import { jsonExplorer } from '@jsonlens/svelte';
  let text = '';
</script>

<div use:jsonExplorer={{ value: text, theme: 'light' }} style="height: 600px"></div>
```

### Web Component（后端模板也能用）

```html
<json-explorer src="/data.json" theme="dark" expand-depth="2" style="height: 600px"></json-explorer>
<script type="module">
  import { JsonExplorerElement } from '@jsonlens/element';
  JsonExplorerElement.wasmUrl = '/wasm/';   // 见下节
  document.addEventListener('select', (e) => console.log(e.detail));
</script>
```

### 完全没有构建工具（后端模板 / 老项目）

把两个包的 `dist` 和 `web-tree-sitter` 一起拷进静态目录，用 importmap 指过去就行 —— 不用 Node、不用打包：

```html
<link rel="stylesheet" href="/vendor/@jsonlens/core/dist/style.css">
<div id="host" style="height: 600px"></div>

<script type="importmap">
{ "imports": {
    "web-tree-sitter": "/vendor/web-tree-sitter/tree-sitter.js",
    "@jsonlens/core": "/vendor/@jsonlens/core/dist/index.js"
} }
</script>
<script type="module">
  import { createExplorer } from '@jsonlens/core';
  const api = createExplorer('#host', {
    // 这种场景必须显式给：两个 wasm 就在 dist 里
    wasmUrl: '/vendor/@jsonlens/core/dist/',
  });
  await api.load(await (await fetch('/data.json')).text());
</script>
```

要拷的东西：`@jsonlens/core/dist/`（整个目录，含两个 `.wasm` 和 `style.css`）+ `web-tree-sitter/tree-sitter.js`。实测这条路径在纯静态服务器上能跑（行渲染、关键词/字符串高亮都正常）。

只要一个标签、不写 JS 的话，换成 `@jsonlens/element` 的 `dist`、importmap 里加一条 `@jsonlens/element`，然后直接写 `<json-explorer src="/data.json">`。

---

## 2. wasm 怎么给（最容易踩的一步）
需要**两个** wasm：运行时 `tree-sitter.wasm` + 语法 `tree-sitter-json.wasm`。它们不参与 JS 打包，必须能被浏览器按 URL 取到。三种给法：

```js
// ① 目录（最省事，推荐配合构建工具的资源拷贝）
createExplorer(el, { wasmUrl: '/wasm/' });

// ② 两个完整 URL（打包器环境的最佳实践）
import runtime from '@jsonlens/core/tree-sitter.wasm?url';
import language from '@jsonlens/core/tree-sitter-json.wasm?url';
createExplorer(el, { wasmUrl: { runtime, language } });

// ③ 不传 —— 从包目录推断（靠 import.meta.url）
createExplorer(el);
```

### 为什么第 ③ 种在打包后可能失效

默认值用 `import.meta.url` 推断「本模块同目录」，这在 CDN 直连 `<script type="module">` 时完全正确。但一旦 Vite/webpack 把包**编进 app bundle**，模块被搬到 `assets/` 或 `.vite/deps/`，`import.meta.url` 就指向别处了 —— 而 wasm 不会跟着搬。

实测（Vite 8 生产构建，同一份代码只换 `wasmUrl`）：

| 给法 | 结果 |
| --- | --- |
| ② `?url` 导入 | ✅ 产物里是 `/assets/tree-sitter-qKYAACSa.wasm` 这种带 hash 的地址，正常加载 |
| ① `wasmUrl: '/wasm/'` + 把两个文件放进 `public/wasm/` | ✅ 正常加载 |
| ③ 不传 | ❌ `HTTP 404 — /assets/tree-sitter.wasm` |

第 ③ 种失败的**具体原因**不是「模块被搬走了」，而是：`import.meta.url` 指向 `assets/` 之后，拼出来的文件名还是**原名** `tree-sitter.wasm`，而打包器早就把它改名成了 `tree-sitter-qKYAACSa.wasm`。名字对不上，必然 404。

**生产环境请显式传 `wasmUrl`**（用 ①②）。⚠️ 不要只传 `wasmUrl: '/wasm/'` 却忘了把两个文件拷进去，报错会是 `both async and sync fetching of the wasm failed`。

### 两个打包器的坑

**坑 1：Vite 的 lib 模式会把 CSS 抽成独立文件，JS 里不留引用。** 所以 `import '@jsonlens/react'` 不会自动带样式，必须另外 `import '@jsonlens/react/style.css'`（或 `@jsonlens/core/style.css`）。

**坑 2：不要把 wasm 的 URL 写成 `new URL(\`./${name}\`, import.meta.url)`。** 第一参数只要是模板字面量，Vite 就会把它当成「目录动态资源」，去 glob 整个目录生成映射表 —— 构建不报错，运行时拿到错误 URL。本包里用变量接住 `import.meta` 绕开静态分析，注释在 `packages/core/src/wasm.js`。

---

## 3. API

### `createExplorer(container, options)`

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `wasmUrl` | — | 见上节 |
| `theme` | `'light'` | `'light' \| 'dark' \| 'auto'` |
| `defaultTab` | `'json'` | `'json' \| 'tree'` |
| `title` | `'source.json'` | 左上角文件名 |
| `expandDepth` | `0` | load 后自动展开到第几层 |
| `chunkThreshold` | `64000` | 超过多少字符走分块懒解析（实测交叉点） |
| `showTabs` / `showActions` | `true` | 藏掉自带的 tab / 按钮，自己搭工具栏 |

### 方法

| 方法 | 说明 |
| --- | --- |
| `load(text, {title})` | 载入，返回分阶段计时（见下） |
| `clear()` | 清空 |
| `setTab('json'\|'tree')` / `setTheme(t)` | 切换 |
| `expandTo(depth)` / `collapseAll()` | 展开深度 / 全折叠 |
| `reveal(range)` | 把某段源码滚进视区并高亮 |
| `scrollToLine(n, {align})` | 滚到第 n 行 |
| `destroy()` | 卸载：摘监听、断观察器、**释放 wasm 里的语法树**、清空容器 |
| `ready` | `Promise`，wasm 就绪 |
| `text` / `stats` / `chunked` | 只读属性 |

> `createExplorer` 会**清空容器原有内容**（它要往里塞自己的模板），别把别的组件挂在同一个节点里。
> `destroy()` 之后这个实例就废了，同一个容器要重建只能重新 `createExplorer`。

### 事件

`load` · `repaint` · `stats` · `tabchange` · `hover` · `select` · `error`，全部 `api.on(type, fn)` / `off`。`load` 和 `repaint` 的载荷就是计时对象：

```js
{ parseMs, updateMs, layoutMs, paintMs, panelMs, totalMs, tokens, lines, cached }
```

这几个数字不是装饰：它就是「慢在哪」的答案，也是本 README 后面所有优化的依据。

`hover` / `select` 在两个面板里都会发：JSON 视图的悬停/点击，以及语法树的悬停/点击（载荷是 `{ start, end }` 源码区间）。
它们和 `api.reveal(range)` 是两条路 —— `reveal()` 是编程式调用，**不会**反过来触发 `hover` 事件。
四个框架封装都在这两个事件上做转发（React 的 `onHover`/`onSelect`、Vue 的 `@hover`/`@select`、Svelte action 的同名参数、element 的冒泡 `CustomEvent`）。

`error` 只在 wasm 初始化失败时触发（路径写错、离线、CDN 挂掉）—— 这是接入期最常见的坑。
接住它就不会在控制台看到「未处理的 Promise 拒绝」；`ready` 本身仍然会 reject，用 `try/catch` 也行。

两个 wasm 是**组件自己 fetch 的**（再以 `wasmBinary` / `Uint8Array` 交给 tree-sitter），所以失败时你拿到的是
`HTTP 404 … — /wasm/tree-sitter.wasm` 或 `ENOENT …` 这种能直接定位的错误，而不是 emscripten 那句
`Aborted(both async and sync fetching of the wasm failed)`。顺带的好处：初始化失败后 emscripten 没有被 abort，
**改对配置重试是真的能成功**（缓存会清掉）。这条有专门的故障注入用例守着（`npm run smoke` 里第 9 条）。

```js
api.on('error', (err) => showToast(`wasm 加载失败：${err.message}`));
```

---

## 4. 引擎层（想自己搭 UI 就用这个）

`@jsonlens/core/engines` 不建任何 DOM，只给零件：

| 导出 | 作用 |
| --- | --- |
| `ChunkedDoc` | 把大文件按顶层元素切块，用到哪块解析哪块；鸭子类型实现 `Node` 接口 |
| `Highlighter` | 纵向 + 横向窗口化高亮，`render()` 成本与文件大小脱钩 |
| `JsonView` | 可折叠 JSON 视图（懒建行 + 滚到自动加载） |
| `renderTree` | 语法树视图（调试用） |
| `scanTopLevel` / `CHUNK_THRESHOLD` / `LINE_HEIGHT` | 扫描器 / 阈值 / 行高 |
| `diffEdit` / `pointAt` | 文本 diff → tree-sitter `Edit`（增量解析） |

```js
const doc = new ChunkedDoc(text, parser);
doc.prime(1);                       // 只解第一块
const hl = new Highlighter(pre, query, { contentPositioned: true });
hl.update(text, doc);
hl.render(scrollTop, scrollLeft, clientHeight, false, clientWidth);
const jv = new JsonView(panel, { onSelect: (r) => reveal(r) });
jv.setData(doc.rootNode, text);
```

---

## 5. 性能：24 MB 怎么做到 141 ms

```
读盘/生成 71ms（示例里是同步造字符串）→ 扫描 + 首块 105ms → 高亮 0.3ms → 右侧面板 34ms
```

四个关键决定，每个都对应一个测出来的具体瓶颈。

### 5.1 只解析看得见的部分

JSON 顶层是数组/对象时，每个顶层元素在语法上是**独立**的（逗号分隔，不依赖前文），所以不需要一次解析完：

1. 一次线性扫描找「深度 1 的逗号」→ 元素边界 + 元素总数
2. 每块包一层 `[ ]` 单独 `parse()`，块内就是一个合法文档
3. 首屏只解析第 0 块（13 ms），其余滚到哪解哪 + `requestIdleCallback` 后台补

扫描为什么只要 28 ms（25 MB）：用 `indexOf('"')` **整段跳过字符串内容**，只数前面有几个连续反斜杠判断转义。JSON 里绝大多数字符都在引号内。

块内坐标映射回文档：

```js
docIndex = wrappedIndex + (chunk.from - 1)   // 包里多了一个 '[' 占位
docRow   = wrappedRow   + chunk.firstRow
```

映射不侵入上层：虚拟根节点用**鸭子类型**实现 tree-sitter 的 `Node` 接口，所以 `JsonView` / `renderTree` 一行都不用改。

**首块不能按字节切**，要同时喂饱两个消费者：高亮要「行」（可视行 ±12），JSON 视图要「元素」（首屏 60 项）。实测踩过两头：一行 2200 字符的 JSON 按 300 KB 切只有 136 行；缩进格式按行切 80 行只有 3 个元素，JSON 视图要 60 个 → 现场解析 20 个块，白等 32 ms。所以首块条件是 `80 行 && 80 项 && ≥16 KB`，其余按 300 KB。

### 5.2 分块阈值 64 KB 是怎么定的

实测「整棵解析」约 10 ms/100 KB；「分块」的固定开销 = 扫描 1.1 ms/MB + 首块 5 ms，且**不随文件增长**。两条线在 50~60 KB 交叉，取 64 KB。

这个数字原来是 1.5 MB，1.25 MB 那档因此还在整棵解析，`paint` 掉了 134 ms。

### 5.3 纵向窗口化之外，还要横向

窗口化只裁了「哪些行」，没裁「哪些列」。一行 2200 字符的 JSON，一屏 43 行就是 15,027 个 span，而 1440 px 屏只显示得下约 170 个字符 —— 92% 的 span 建出来没人看得见，纯粹给样式计算和排版交税。

```js
const col = t.s - rowStart;                     // token 在第几列（行号指针单调前移，不用二分）
if (col + (t.e - t.s) < colFirst || col > colLast) continue;   // 屏外不建 span，留作纯文本
```

关键：**字符一个都不少**。跳过的 token 由游标填充的 text 节点原样带出，对齐、横向滚动、复制不受影响。验证方式是「横向滚动前后窗口文本长度必须相同」—— 135,433 → 135,433。

效果：15,027 span → 2,157，25 MB 首屏 148 → 100 ms。横向滚动按 3/4 屏宽量化，跨桶才重建。

### 5.4 大文件不经过 textarea

一开始「打开」要 3.0 s，分段计时后才发现元凶不是解析：

| 环节 | 耗时 |
| --- | --- |
| `file.text()` | 62 ms |
| `textarea.value = 26MB` | **932–1171 ms** |
| tree-sitter 全量解析 | 1600–1824 ms |

`display:none` 时赋值只要 18 ms，`display:block` 触发排版 1120 ms —— 也就是说 18 ms 塞字符串、1120 ms 是浏览器排版这个 textarea。只要这段文本最终要显示成可编辑的 textarea，这一秒就跑不掉（隐藏、`content-visibility`、缩字号都试过）。

所以大文件走**只读预览**：没有 textarea，总高 227,056 px、总宽 461,071 px 都是算出来的（行数 × 行高、最长行 × 单字符宽），浏览器实际只排 40 行。

---

## 6. 和主流 JSON viewer 比速度

三档数据、六个库、同一套外壳 CSS、每个组合独占一个浏览器进程、每档跑三次取中位数。

| 实现 | 渲染方式 | 0.12 MB | 1.25 MB | 24.89 MB | big DOM | big 堆 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| **本项目** | 分块懒解析 + 双轴窗口化 | **33** | **33** | **101** | **2 790** | **27 MB** |
| @textea/json-viewer 4.0 | 虚拟滚动 | 118 | 133 | 150 | 2 219 | 75 MB |
| json-formatter-js 2.5 | 一次性建 DOM | **33** | 67 | 300 | 91 617 | 54 MB |
| jsoneditor 10.4 | 懒展开 | **33** | 50 | 417 | 1 633 | 411 MB |
| @uiw/react-json-view 2.0 | 一次性建 DOM | 34 | 205 | 903 | 136 222 | 211 MB |
| vue-json-pretty 2.6 | 递归建 DOM | 83 | 4 400 | 💀 卡死 | – | – |

（单位 ms，指标是 `paint`：到第一帧真的画出来为止。）

**三档都是第一或并列第一，但含金量不一样：**

- **0.12 MB 是「并列」不是「最快」。** 双 rAF 至少跨两帧，16 ms 内做完的实现在这个指标上都是 33 —— 这是帧量化下限，不是谁慢。要比这一档得看 `mount`：jsonformatter 2 ms、jsoneditor 7 ms、uiw 12 ms、本项目 16 ms（它还多做了语法高亮 + 首屏 2,157 个 token）。
- **1.25 MB 拉开的 17 ms，是「要不要 `JSON.parse`」的差别。** 本项目的 `解析` 列恒为 0 —— 整条路径上根本没有 `JSON.parse`。这一档 DOM 数是 610 vs 24 010（uiw），两个数量级。
- **24.89 MB 能活下来的只有两种思路**：虚拟化（本项目 101、textea 150），或一次性全量建 DOM（300 / 417 / 903，函数很快返回了，但浏览器要排完十几万节点才画得出第一帧）。既不虚拟化又递归建 DOM 的，11,351 项直接卡死。

big 档的「能不能用」比 paint 更能说明问题：

| 实现 | paint | 堆 | 最长同步任务 | 总阻塞 |
| --- | ---: | ---: | ---: | ---: |
| **本项目** | **101** | **27 MB** | **88 ms** | **38 ms** |
| textea | 150 | 75 MB | 139 ms | 89 ms |
| jsonformatter | 300 | 54 MB | 283 ms | 233 ms |
| jsoneditor | 417 | 411 MB | 413 ms | 363 ms |
| uiw | 903 | 211 MB | 692 ms | 783 ms |

最长同步任务 88 ms 意味着打开文件时页面**没被冻住**（超过 100 ms 用户就开始觉得卡）；uiw 是 692 ms + 783 ms 累计阻塞，等于一次明显卡顿。

big 档连跑两遍验证稳定性：本项目 100 / 101 ms，textea 150 / 151，jsonformatter 300 / 300，jsoneditor 417 / 467，uiw 903 / 922 —— 排序完全不变，波动 ≤ 5%（jsoneditor 那次偏高是 GC 时机差异）。

### wasm 堆会不会漏？实测曲线

`Tree` 是 wasm 里的对象，**0.25 版的 web-tree-sitter 没有 FinalizationRegistry**，不显式 `delete()` 就永远占着 wasm 堆。同一份 24.89 MB 文件反复解析（87 块全解，模拟「一路滚到底」），`npm run check:mem` 的结果：

| 轮次 | 有 `dispose()` | 不释放 |
| ---: | ---: | ---: |
| 1 | +434 MB | +414 MB |
| 2 | +435 MB | +870 MB |
| 3 | +381 MB | +1 218 MB |
| 4 | +381 MB | +1 050 MB |
| 5 | +365 MB | 💥 `Aborted()` |
| 8 | +365 MB | – |

有 `dispose()` 时第 5 轮起**一动不动**（每次只 +0 MB，解析耗时也稳定在 1.4 s），因为 tree-sitter 的分配器复用了刚 free 的块；不释放则每轮 +300~450 MB，第 5 轮就把 wasm 的 2 GB 上限（`tree-sitter.js` 里 `maximum: 32768` 页）撞满，抛 `Aborted()`。

> 顺带一个期望管理：24 MB 文件**滚到底本身就要 ~450 MB wasm 堆**。分块懒解析买的是「首屏 100 ms」，不是「省内存」—— 要省内存得让虚拟树支持「卸载看不见的子树」，那是另一件事（见第 7 节）。

复现：

```bash
npx vite build --config bench/vite.config.js
python3 -m http.server 5184 --directory bench/dist &
node bench/run.mjs --r=3              # 6 个库 × 3 档 × 3 次
node bench/run.mjs big --v=ours       # 只跑某一个
```

口径说明在 [`bench/run.mjs`](bench/run.mjs) 顶部和原 `result.json` 里。**比较是有局限的**：各库的展开深度语义不同（`openDepth` / `defaultInspectDepth` / `collapsed`），这里统一取「DOM 数量级最接近」那档，`dom` 列留给读者自己判断。

---

## 7. 已知限制

这几条都是设计取舍，不是待修 bug：

1. **顶层切不开就退化。** 分块依赖「顶层是数组/对象、元素语法独立」。典型反例是 `{"code":0,"data":{"total":N,"items":[…]}}` —— 顶层只有 3 个 key，2.4 万条数据全在深层数组里，切不动 → 退化成整棵解析，24 MB 约 **2.2 s**（实测；首屏渲染仍只要 0.3 ms）。顶层数组则是 105 ms。要彻底解决得做「容器感知分块」，代价是虚拟树要能表达「祖先路径 + 深层容器」，工作量不小。
2. **宿主必须给高度。** 组件不猜高度。也**不要**给 `.jl-root` 写 `height:100%`（样式里已经删掉了）：宿主最常见是把 height 设在同一个元素上，再写 100% 会把它盖掉，结果组件按内容撑开，滚动容器 `clientHeight` 变成几万像素，「虚拟滚动」退化成全量渲染 —— 我自己踩过，表现是 24 MB 卡 5 秒。
3. **行高必须是 20 px 且等宽字体。** 高亮器按「行 × 行高」算坐标，横向裁剪按「字符宽 × 列」算，比例字体会让列号换算失效（可设 `charWidth = 0` 关掉横向裁剪）。
4. **`expandTo(n)` 每个容器最多展开 200 个子节点。** 屏幕上也就能看到 40 行，多展开是白干；没有这个上限时，对 2.4 万元素的数组做「展开 2 层」会把所有子节点建出来，分块文档等于全量解析一遍（实测 2.1 s）。
5. **tree-sitter 只管语法。** 重复 key、数字溢出得再套 `JSON.parse` 或 schema。
6. **`(ERROR)` 的 capture 会被子节点吃掉**：`captures()` 返回顺序里 ERROR 排在子节点之后，按「重叠就跳过」会被整体丢弃。解法是按 `(start, ERROR 优先, -end)` 排序再走游标填充。
7. **`wasmUrl` / `chunkThreshold` / `title` 只在创建时读一次。** 改成动态的会触发「销毁 + 重建」，wasm 就绪、展开状态、滚动位置全丢，为一个配置项付这个代价不值得。`theme` / `tab` / `value` 是可变的，走命令式 API。React 的 `useEffect` 依赖列表里也故意只放了这几个。
8. **wasm 堆上限 2 GB，且只增不减。** 一份 24 MB 文件滚到底约 450 MB（实测，见第 6 节），同时养 3~4 个这种实例就会撞上限抛 `Aborted()`。用完记得 `destroy()` —— 它会 `delete()` 掉所有树，内存可以被下一个文件复用（8 轮反复打开零增长）。

---

## 8. 开发

```bash
npm install                 # 内网源有问题就加 --registry=https://registry.npmjs.org
npm run dev                 # playground → http://localhost:5180
npm run dev:examples        # 四框架示例 → http://localhost:5181

npm run build               # core + 四个封装 + demo + 示例
npm run build:core          # 只构建 @jsonlens/core（→ packages/core/dist）
npm run smoke               # 用 Playwright 打开所有产物页面：11 条用例（渲染 / 24 MB 分块 / 折叠展开 / 事件契约 / 故障注入）
npm run typecheck           # 用 tsc 校验所有 .d.ts（types/typecheck.tsx 是使用方）
npm run check:edit          # 增量行索引 vs 整份重扫的对拍（fuzz 约 8000 例）
npm run check:mem           # wasm 堆增长：dispose 开/关两组的 RSS 曲线（约 40 s）
npm run pack:check          # 五个包的 tarball 自检（README / LICENSE / dist / wasm / types）
npm run check               # 上面四个一起跑（发版前就这个）
npm run bench -- --r=3      # 横向对比（需先起 bench 静态服务，见第 6 节）
```

发包流程（五个包、顺序、版本联动、CI）见 [`RELEASING.md`](RELEASING.md)。

```
packages/core/src/
  explorer.js         查看器：模板 + 布局 + 事件委托 + 对外 API（框架无关）
  wasm.js             两个 wasm 的定位与初始化（含那个打包器坑）
  style.css           全部收在 .jl- 前缀下
  engines/
    chunked.js        分块懒解析 + 虚拟根节点（鸭子类型）
    highlight.js      双轴窗口化高亮
    jsonview.js       可折叠 JSON 视图（懒建行 + 哨兵无限滚动）
    treeview.js       语法树视图
    diff.js           文本 diff → tree-sitter Edit
packages/{react,vue,element,svelte}/src/index.js   薄壳，各 60~160 行
scripts/build-wrappers.mjs   一次构建四个封装（配置只差 external 列表）
scripts/smoke.mjs            产物级冒烟测试
examples/                    原生 / React / Vue / Web Component 四个示例
src/                          playground（demo，可直接编辑 + 增量解析）
bench/                        和主流库的横向对比
```

playground 走的是**引擎层**（它要一个可编辑 textarea + 语法树 tab），查看器走 `createExplorer`。两条路径共用同一套引擎，所以行为和性能一致。

---

## 9. 还能再压吗

141 ms 里，扫描 28 ms、首块解析 13 ms、渲染 0.3 ms 都已经是十几毫秒量级。再往上要动架构：**Web Worker 化**。但 `Tree` 不能跨线程传（`tree.copy()` 只是同线程复制，不是 transferable），worker 化意味着 JSON 视图要改成「按路径向 worker 请求子节点」的异步模型 —— 收益有限，代价不小。

另一条是把扫描和解析都做成流式：`Response.body` 边下边扫，首块更早出现。对本地文件没意义，对「从接口拉一个 200 MB 的 JSON」有意义。
