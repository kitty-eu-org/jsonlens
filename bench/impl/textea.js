import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { JsonViewer } from '@textea/json-viewer';

export const label = '@textea/json-viewer 4.0（inspectDepth=2）';

export function mount(el, text) {
  const obj = JSON.parse(text);
  const root = createRoot(el);
  // flushSync 强制同步提交，否则 React 并发渲染会跨帧，测出来的时间不可比
  flushSync(() => {
    root.render(
      React.createElement(JsonViewer, {
        value: obj,
        defaultInspectDepth: 2,
        // 默认 groupArraysAfterLength=100，会把长数组自动折叠；关掉才能和其他库比同等行数
        groupArraysAfterLength: 1_000_000,
        displayDataTypes: false,
        enableClipboard: false,
      }),
    );
  });
}
