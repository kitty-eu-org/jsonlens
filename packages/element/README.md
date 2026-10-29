# jsonlens-element

`<json-explorer>` 自定义元素 —— 只要页面能加载一个 ESM 文件就能用，
不挑框架、不挑构建工具（PHP / Rails / Django / Thymeleaf 模板都能直接写标签）。

```bash
npm i jsonlens-element
```

```html
<json-explorer src="/data.json" theme="dark" expand-depth="2" style="height: 600px"></json-explorer>

<script type="module">
  import { JsonExplorerElement } from 'jsonlens-element';
  JsonExplorerElement.wasmUrl = '/wasm/';
  JsonExplorerElement; // 导入即注册 <json-explorer>

  document.addEventListener('select', (e) => console.log(e.detail));
</script>
```

## 属性

| 属性 | 说明 |
| --- | --- |
| `src` | 组件自己去 fetch 这个地址 |
| `value` | 内联 JSON 文本（**别放大段文本**，HTML 属性有转义和长度问题） |
| `theme` | `light` / `dark` / `auto` |
| `tab` | `json` / `tree` |
| `title` | 左上角文件名 |
| `expand-depth` | 载入后展开到第几层 |

## 方法 / 事件

方法：`load(text)` `expandTo(n)` `collapseAll()` `setTab()` `setTheme()` `scrollToLine()`，
以及 `stats` / `explorer` 属性。

事件（冒泡的 `CustomEvent`）：`hover` `select` `stats` `load` `tabchange` `loaderror`。
用 `el.on('stats', (s) => …)` 可以直接拿到 `detail`，或用原生 `addEventListener`。
`loaderror` 覆盖两种情况：`src` 下载失败，以及 wasm 初始化失败（`detail` 是原始错误）。

## 四个必须知道的点

1. **自定义元素没有默认高度**，宿主必须给（`style="height:600px"` 或 CSS）。
2. **样式**：打包器里 `import 'jsonlens-element/style.css'`；
   no-bundler 场景用 `<link rel="stylesheet" href="…/dist/style.css">`。
3. **不要给 `value` 属性塞大 JSON** —— 用 `src` 或 `el.load(text)`。
4. **组件创建是延后一个宏任务的**，所以 `JsonExplorerElement.wasmUrl = …` 写在 import 之后
   （哪怕中间还夹着 `await`）都来得及 —— 页面里已经写好的标签会等这一轮配置。代价是标签
   插进 DOM 之后要过一拍才出现内容；需要拿到实例就 `await customElements.whenDefined(...)`
   再等一拍，或者直接用 `el.explorer`。

MIT
