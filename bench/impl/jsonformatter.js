import JSONFormatter from 'json-formatter-js';

export const label = 'json-formatter-js 2.5（openDepth=1）';

export function mount(el, text) {
  const obj = JSON.parse(text);
  const fmt = new JSONFormatter(obj, 2, { theme: 'light' });
  el.appendChild(fmt.render());
}
