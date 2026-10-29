/**
 * @jsonlens/svelte —— 一个 Svelte action
 *
 * Svelte 不需要组件封装，action 就是最自然的形态，而且**零运行时依赖**：
 * 这个包除了 @jsonlens/core 什么都不依赖，也不 import 'svelte'。
 *
 * 用法：
 *   <script>
 *     import { jsonExplorer } from '@jsonlens/svelte';
 *     let text = '';
 *   </script>
 *   <div use:jsonExplorer={{ value: text, theme: 'light', onSelect: (r) => console.log(r) }}
 *        style="height: 600px"></div>
 */
import { createExplorer } from '@jsonlens/core';
import '@jsonlens/core/style.css';

export function jsonExplorer(node, params = {}) {
  const {
    value,
    onHover,
    onSelect,
    onStats,
    onReady,
    onError,
    theme = 'light',
    defaultTab = 'json',
    title,
    ...rest
  } = params;

  // Svelte 每次更新都传新对象、新闭包，所以绑稳定代理 + 可变引用
  const cb = { onHover, onSelect, onStats, onReady, onError };
  let last = { value, theme, defaultTab };

  const api = createExplorer(node, { theme, defaultTab, title, ...rest });
  api.on('hover', (r) => cb.onHover?.(r));
  api.on('select', (r) => cb.onSelect?.(r));
  api.on('stats', (s) => cb.onStats?.(s));
  api.on('error', (err) => cb.onError?.(err));
  // 失败要接住，否则 .then 会派生出一个新的被拒绝 Promise（=未处理拒绝）
  api.ready.then(
    () => cb.onReady?.(api),
    () => {},
  );

  if (value != null) api.load(value);

  return {
    update(next = {}) {
      cb.onHover = next.onHover ?? cb.onHover;
      cb.onSelect = next.onSelect ?? cb.onSelect;
      cb.onStats = next.onStats ?? cb.onStats;
      cb.onReady = next.onReady ?? cb.onReady;
      cb.onError = next.onError ?? cb.onError;

      if (next.value !== last.value) {
        last.value = next.value;
        if (next.value != null) api.load(next.value);
      }
      if (next.theme !== last.theme) {
        last.theme = next.theme;
        api.setTheme(next.theme ?? 'light');
      }
      if (next.defaultTab !== last.defaultTab) {
        last.defaultTab = next.defaultTab;
        api.setTab(next.defaultTab ?? 'json');
      }
    },
    destroy() {
      api.destroy();
    },
    /** 拿到底层实例：const inst = jsonExplorer(node, p); node.__jsonlens */
    get api() {
      return api;
    },
  };
}

export default jsonExplorer;
