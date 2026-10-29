import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import JsonView from '@uiw/react-json-view';
import { lightTheme } from '@uiw/react-json-view/light';

export const label = '@uiw/react-json-view 2.0（collapsed=1）';

export function mount(el, text) {
  const obj = JSON.parse(text);
  const root = createRoot(el);
  flushSync(() => {
    root.render(
      React.createElement(JsonView, {
        value: obj,
        collapsed: 1,
        displayDataTypes: false,
        enableClipboard: false,
        style: lightTheme,
      }),
    );
  });
}
