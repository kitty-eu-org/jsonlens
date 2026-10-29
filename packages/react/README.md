# @jsonlens/react

[`@jsonlens/core`](https://www.npmjs.com/package/@jsonlens/core) 的 React 封装，83 行。
用 tree-sitter 分块懒解析 + 双轴窗口化渲染，24 MB JSON 141 ms 打开。

> 渲染、虚拟滚动、懒解析全在 core 里，这个包只做「挂载 / 卸载 / 属性变化」的桥接。

```bash
npm i @jsonlens/react
```

```jsx
import '@jsonlens/react/style.css';
import { JsonExplorer } from '@jsonlens/react';

function App() {
  const ref = useRef(null);
  const [stats, setStats] = useState(null);

  return (
    <>
      <button onClick={() => ref.current?.expandTo(3)}>展开 3 层</button>
      <div style={{ height: 600 }}>
        <JsonExplorer ref={ref} value={text} theme="light" expandDepth={2} onStats={setStats} />
      </div>
    </>
  );
}
```

## props

| prop | 默认 | 说明 |
| --- | --- | --- |
| `value` | — | JSON 文本，变了就重新载入 |
| `theme` | `'light'` | `'light' \| 'dark' \| 'auto'` |
| `defaultTab` | `'json'` | `'json' \| 'tree'` |
| `title` | `'source.json'` | 左上角文件名 |
| `expandDepth` | `0` | 载入后展开到第几层 |
| `chunkThreshold` | `64000` | 超过多少字符走分块 |
| `wasmUrl` | — | **生产环境请显式传**，见下 |
| `showTabs` / `showActions` | `true` | 藏掉自带工具栏 |
| `onHover` / `onSelect` | — | `(range: {start,end} \| null)` |
| `onStats` / `onReady` | — | 统计 / 拿到命令式实例 |
| `onError` | — | wasm 初始化失败时回调（不传也不会产生未处理的拒绝） |

`ref` 上是：`load` `expandTo` `collapseAll` `setTab` `setTheme` `reveal` `scrollToLine` `destroy`，
以及 `stats` / `text` / `instance`。

## 两个必须知道的点

1. **样式要显式引入**：`import '@jsonlens/react/style.css'`。Vite 的 lib 模式会把 CSS 抽成独立文件、JS 里不留引用，所以 import 组件不会自动带样式。
2. **宿主必须给高度**，组件不猜。`wasmUrl` 在打包环境里建议用
   `import rt from '@jsonlens/core/tree-sitter.wasm?url'` 的方式传入，详见 core 的 README。

MIT
