/**
 * jsonlens-vue
 *
 * 和 React 版同一个套路，只是换成 Vue 的生命周期和 h()。
 * 用 render function 而不是 SFC，这样包不需要 Vue 的编译插件，纯 ESM 就能用。
 */
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createExplorer } from '@fagao-ai/jsonlens';
import '@fagao-ai/jsonlens/style.css';

export const JsonExplorer = defineComponent({
  name: 'JsonExplorer',
  props: {
    value: { type: String, default: '' },
    theme: { type: String, default: 'light' },
    defaultTab: { type: String, default: 'json' },
    title: { type: String, default: 'source.json' },
    chunkThreshold: { type: Number, default: undefined },
    wasmUrl: { type: [String, Object], default: undefined },
    expandDepth: { type: Number, default: undefined },
    showTabs: { type: Boolean, default: true },
    showActions: { type: Boolean, default: true },
  },
  emits: ['hover', 'select', 'stats', 'ready', 'error'],
  setup(props, { emit, expose }) {
    const host = ref(null);
    let api = null;

    onMounted(() => {
      api = createExplorer(host.value, {
        theme: props.theme,
        defaultTab: props.defaultTab,
        title: props.title,
        chunkThreshold: props.chunkThreshold,
        wasmUrl: props.wasmUrl,
        expandDepth: props.expandDepth,
        showTabs: props.showTabs,
        showActions: props.showActions,
      });
      // 用 emit 走 Vue 的声明式事件，父组件直接 @hover / @select / @stats
      api.on('hover', (r) => emit('hover', r));
      api.on('select', (r) => emit('select', r));
      api.on('stats', (s) => emit('stats', s));
      api.on('error', (err) => emit('error', err));
      // 失败要接住，否则 .then 会派生出一个新的被拒绝 Promise（=未处理拒绝）
      api.ready.then(
        () => emit('ready', api),
        () => {},
      );
      if (props.value) api.load(props.value);
    });

    watch(
      () => props.value,
      (v) => {
        if (v) api?.load(v);
      },
    );
    watch(
      () => props.theme,
      (v) => api?.setTheme(v),
    );
    watch(
      () => props.defaultTab,
      (v) => api?.setTab(v),
    );

    onBeforeUnmount(() => {
      api?.destroy();
      api = null;
    });

    // 父组件拿 ref 就能调命令式 API
    expose({
      load: (t, o) => api?.load(t, o),
      expandTo: (d) => api?.expandTo(d),
      collapseAll: () => api?.collapseAll(),
      setTab: (t) => api?.setTab(t),
      setTheme: (t) => api?.setTheme(t),
      reveal: (r) => api?.reveal(r),
      scrollToLine: (l, o) => api?.scrollToLine(l, o),
      destroy: () => api?.destroy(),
      get stats() {
        return api?.stats ?? null;
      },
      get text() {
        return api?.text ?? '';
      },
      get instance() {
        return api;
      },
    });

    return () => h('div', { ref: host, style: { width: '100%', height: '100%', minHeight: 0 } });
  },
});

export default JsonExplorer;
