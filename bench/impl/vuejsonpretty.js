import { createApp, h } from 'vue';
import JsonPretty from 'vue-json-pretty';
import 'vue-json-pretty/lib/styles.css';

export const label = 'vue-json-pretty 2.6（deep=1）';

export function mount(el, text) {
  const obj = JSON.parse(text);
  const app = createApp({
    render: () => h(JsonPretty, { data: obj, deep: 1, showLength: true }),
  });
  app.mount(el);
}
