# jsonlens

框架无关的高性能 JSON 查看器：**tree-sitter 分块懒解析 + 双轴窗口化渲染**。
24 MB / 153 万行的文件 141 ms 打开，DOM 只有 2 790 个节点。

```bash
npm i jsonlens web-tree-sitter
```

```js
import 'jsonlens/style.css';
import { createExplorer } from 'jsonlens';

const viewer = createExplorer(document.getElementById('host'), { theme: 'light' });
await viewer.load(jsonText, { title: 'data.json' });
```

```html
<div id="host" style="height: 600px"></div>
```

## wasm

需要两个文件：`tree-sitter.wasm`（运行时）+ `tree-sitter-json.wasm`（语法）。
它们不参与 JS 打包，**生产环境请显式指定位置**：

```js
// 目录
createExplorer(el, { wasmUrl: '/wasm/' });

// 或者打包器的资源导入（Vite / webpack5）
import runtime from 'jsonlens/tree-sitter.wasm?url';
import language from 'jsonlens/tree-sitter-json.wasm?url';
createExplorer(el, { wasmUrl: { runtime, language } });
```

不传会从包目录推断（`import.meta.url`），只在 CDN 直连 `<script type="module">` 时可靠。

两个 wasm 由组件自己 `fetch` 后以 `wasmBinary` 交给 tree-sitter，所以路径写错时你会看到
`HTTP 404 … — /wasm/tree-sitter.wasm`，而不是 emscripten 那句没人看得懂的
`Aborted(both async and sync fetching of the wasm failed)`；改对配置后重试也是真的能成功。
想先接住错误就监听 `api.on('error', fn)`。

> 如果用 Vite 的 lib 模式自己再打包，CSS 会被抽成独立文件、JS 里不留引用，
> 记得让使用者 `import 'jsonlens/style.css'`。

## API

```ts
createExplorer(el, {
  wasmUrl?, theme?, defaultTab?, title?, expandDepth?,
  chunkThreshold?,   // 默认 64000，超过走分块
  showTabs?, showActions?
})
```

方法：`load(text)` `clear()` `setTab()` `setTheme()` `expandTo(n)` `collapseAll()`
`reveal(range)` `scrollToLine(n)` `destroy()`；属性 `ready` `text` `stats` `chunked`。

事件：`load` `repaint` `stats` `tabchange` `hover` `select` `error`。
`load` 的载荷是分阶段计时（`parseMs` / `updateMs` / `layoutMs` / `paintMs` / `panelMs` / `totalMs`）。
`error` 只在 wasm 初始化失败时触发，接住它就不会有「未处理的 Promise 拒绝」噪音。

## 引擎层

想自己搭 UI 就用 `jsonlens/engines`：

```js
import { ChunkedDoc, Highlighter, JsonView, CHUNK_THRESHOLD } from 'jsonlens/engines';
```

`ChunkedDoc`（分块 + 鸭子类型虚拟树）、`Highlighter`（双轴窗口化）、
`JsonView`（懒建行的可折叠视图）、`renderTree`（语法树）、`diffEdit`（增量解析）。

## 其他框架

| 包 | 用法 |
| --- | --- |
| `jsonlens-react` | `<JsonExplorer value={text} />` |
| `jsonlens-vue` | `<JsonExplorer :value="text" />` |
| `jsonlens-element` | `<json-explorer src="…">` |
| `jsonlens-svelte` | `use:jsonExplorer` |

完整文档（性能博弈、和主流库的对比、已知限制）见仓库 README。

## 注意

- **宿主必须给高度**，组件不猜。
- 挂了组件之后容器内容会被清空；`destroy()` 之后实例不可复用。
- 行高固定 20 px、必须等宽字体（横向裁剪依赖字符宽度）。
- 顶层是数组时最快（分块生效）；`{"data":{"items":[…]}}` 这种深层大数组切不开，会退化成整棵解析。

MIT
