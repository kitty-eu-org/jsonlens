/**
 * jsonlens-react
 *
 * 整个封装只有一件事：把 React 的挂载/卸载/属性变化，映射到
 * createExplorer() / load() / destroy()。核心组件不知道自己被 React 用着。
 *
 * 三个容易踩的点，这里都处理了：
 *   1. 回调函数每次渲染都是新引用 —— 不能直接 on('hover', props.onHover)，
 *      否则永远绑的是第一次的闭包。用 ref 存最新的，绑一个稳定的代理。
 *   2. ref 转发不能返回 apiRef.current（首次渲染还是 null），
 *      要返回一个稳定的句柄对象，方法内部再去取当前实例。
 *   3. options 只在挂载时读一次（主题/标签页这类可变项走 imperative API），
 *      否则会不停销毁重建。
 */
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createExplorer } from '@fagao-ai/jsonlens';
import '@fagao-ai/jsonlens/style.css';

const HOST_STYLE = { width: '100%', height: '100%', minHeight: 0 };

export const JsonExplorer = forwardRef(function JsonExplorer(props, ref) {
  const {
    value,
    onHover,
    onSelect,
    onStats,
    onReady,
    onError,
    style,
    className,
    theme = 'light',
    defaultTab = 'json',
    title = 'source.json',
    chunkThreshold,
    wasmUrl,
    expandDepth,
    showTabs,
    showActions,
  } = props;

  const hostRef = useRef(null);
  const apiRef = useRef(null);
  // 最新一次渲染的回调，避免闭包陈旧
  const cb = useRef({});
  cb.current = { onHover, onSelect, onStats, onReady, onError };

  useEffect(() => {
    const api = createExplorer(hostRef.current, {
      theme,
      defaultTab,
      title,
      chunkThreshold,
      wasmUrl,
      expandDepth,
      showTabs,
      showActions,
    });
    apiRef.current = api;

    // 稳定代理：永远转发到最新的回调
    api.on('hover', (r) => cb.current.onHover?.(r));
    api.on('select', (r) => cb.current.onSelect?.(r));
    api.on('stats', (s) => cb.current.onStats?.(s));
    api.on('error', (err) => cb.current.onError?.(err));
    // 第二个参数接住失败：只写 .then(ok) 的话，失败会派生出**另一个**被拒绝的 Promise，
    // 照样是「未处理的拒绝」。真正的错误已经通过上面的 'error' 事件给出去了。
    api.ready.then(
      () => cb.current.onReady?.(api),
      () => {},
    );

    return () => {
      api.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 文本变化 → 重新载入
  useEffect(() => {
    if (value == null) return;
    apiRef.current?.load(value);
  }, [value]);

  useEffect(() => {
    apiRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    apiRef.current?.setTab(defaultTab);
  }, [defaultTab]);

  useImperativeHandle(
    ref,
    () => ({
      load: (t, o) => apiRef.current?.load(t, o),
      expandTo: (d) => apiRef.current?.expandTo(d),
      collapseAll: () => apiRef.current?.collapseAll(),
      setTab: (t) => apiRef.current?.setTab(t),
      setTheme: (t) => apiRef.current?.setTheme(t),
      reveal: (r) => apiRef.current?.reveal(r),
      scrollToLine: (l, o) => apiRef.current?.scrollToLine(l, o),
      destroy: () => apiRef.current?.destroy(),
      get stats() {
        return apiRef.current?.stats ?? null;
      },
      get text() {
        return apiRef.current?.text ?? '';
      },
      get instance() {
        return apiRef.current;
      },
    }),
    [],
  );

  return createElement('div', { ref: hostRef, className, style: { ...HOST_STYLE, ...style } });
});

export default JsonExplorer;
