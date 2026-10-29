/**
 * Vue 3：`<JsonExplorer :value="text" @stats="onStats" />`
 *
 * 封装层用 render 函数而不是 SFC，好处是使用者不需要 Vue 编译器插件，
 * 一个纯 JS 包就能用。
 */
import { createApp, h, ref, onMounted } from 'vue';
import '@fagao-ai/jsonlens/style.css';
import { JsonExplorer } from '@fagao-ai/jsonlens-vue';
import runtimeWasm from '@fagao-ai/jsonlens/tree-sitter.wasm?url';
import languageWasm from '@fagao-ai/jsonlens/tree-sitter-json.wasm?url';
import { hugeSample, smallSample } from './sample.js';
import './shared.css';

const WASM = { runtime: runtimeWasm, language: languageWasm };

const App = {
  setup() {
    const text = ref(smallSample());
    const dark = ref(false);
    const stats = ref(null);
    const viewer = ref(null);

    onMounted(() => {
      // 需要命令式操作时用组件 ref
      void viewer.value;
    });

    function loadHuge() {
      // 同步生成 24MB 字符串会阻塞一帧，先让按钮状态生效
      setTimeout(() => {
        text.value = hugeSample(24);
      }, 0);
    }

    function toggleTheme() {
      dark.value = !dark.value;
      document.body.dataset.theme = dark.value ? 'dark' : 'light';
    }

    return () =>
      h('div', [
        h('header', [h('h1', 'Vue 3'), h('span', { class: 'sub' }, 'h(JsonExplorer, { value, onStats })')]),
        h('div', { class: 'toolbar' }, [
          h('button', { onClick: () => (text.value = smallSample()) }, '小文件'),
          h('button', { class: 'primary', onClick: loadHuge }, '24 MB'),
          h('button', { onClick: () => viewer.value?.expandTo(3) }, '展开 3 层'),
          h('button', { onClick: () => viewer.value?.collapseAll() }, '全部折叠'),
          h('button', { onClick: toggleTheme }, '主题'),
          h(
            'output',
            stats.value
              ? `${(stats.value.chars / 1048576).toFixed(2)} MB · ${stats.value.lines} 行 · ${
                  stats.value.mode === 'chunked'
                    ? `分块 ${stats.value.chunks.parsed}/${stats.value.chunks.total}`
                    : '整棵'
                }`
              : ''
          ),
        ]),
        h(
          'div',
          { class: 'host' },
          h(JsonExplorer, {
            ref: viewer,
            value: text.value,
            theme: dark.value ? 'dark' : 'light',
            title: 'sample.json',
            expandDepth: 2,
            wasmUrl: WASM,
            onStats: (s) => (stats.value = s),
          })
        ),
        h('p', { class: 'hint' }, 'Vue 这层把 props/emits 映射到 api.load / api.on，组件内部同样是 createExplorer。'),
      ]);
  },
};

createApp(App).mount('#root');
