/**
 * React：`<JsonExplorer value={text} />`
 *
 * 组件只做三件事：挂载时 createExplorer、value 变了就 load、卸载时 destroy。
 * 想拿命令式 API（expandTo / reveal / stats）就传 ref。
 */
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'jsonlens/style.css';
import { JsonExplorer } from 'jsonlens-react';
import runtimeWasm from 'jsonlens/tree-sitter.wasm?url';
import languageWasm from 'jsonlens/tree-sitter-json.wasm?url';
import { hugeSample, smallSample } from './sample.js';
import './shared.css';

const WASM = { runtime: runtimeWasm, language: languageWasm };

function App() {
  const [text, setText] = useState(() => smallSample());
  const [dark, setDark] = useState(false);
  const [stats, setStats] = useState(null);
  const ref = useRef(null);

  return (
    <React.Fragment>
      <header>
        <h1>React</h1>
        <span className="sub">
          <code>{'<JsonExplorer value={text} onStats={...} ref={...} />'}</code>
        </span>
      </header>

      <div className="toolbar">
        <button onClick={() => setText(smallSample())}>小文件</button>
        <button
          className="primary"
          onClick={async () => {
            // 24 MB 的字符串生成要几百毫秒，先让按钮状态刷出来
            await new Promise((r) => setTimeout(r, 0));
            setText(hugeSample(24));
          }}
        >
          24 MB
        </button>
        <button onClick={() => ref.current?.expandTo(3)}>展开 3 层</button>
        <button onClick={() => ref.current?.collapseAll()}>全部折叠</button>
        <button
          onClick={() => {
            setDark((d) => !d);
            document.body.dataset.theme = dark ? 'light' : 'dark';
          }}
        >
          主题
        </button>
        <output>
          {stats
            ? `${(stats.chars / 1048576).toFixed(2)} MB · ${stats.lines} 行 · ${
                stats.mode === 'chunked' ? `分块 ${stats.chunks.parsed}/${stats.chunks.total}` : '整棵'
              }`
            : ''}
        </output>
      </div>

      <div className="host">
        <JsonExplorer
          ref={ref}
          value={text}
          theme={dark ? 'dark' : 'light'}
          title="sample.json"
          expandDepth={1}
          wasmUrl={WASM}
          onStats={setStats}
        />
      </div>

      <p className="hint">
        React 这层只有 ~80 行：<code>useEffect</code> 挂载/卸载 + 一个 <code>value</code> 的 effect。
        渲染、虚拟滚动、懒解析全在 core 里，跟框架无关。
      </p>
    </React.Fragment>
  );
}

createRoot(document.getElementById('root')).render(<App />);
