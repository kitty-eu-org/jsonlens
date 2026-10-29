import JSONEditor from 'jsoneditor';
import 'jsoneditor/dist/jsoneditor.css';

export const label = 'jsoneditor 10.4（tree 模式）';

export function mount(el, text) {
  const obj = JSON.parse(text);
  const ed = new JSONEditor(el, {
    mode: 'tree',
    search: false,
    history: false,
    navigationBar: false,
    statusBar: false,
    mainMenuBar: false,
  });
  ed.set(obj);
}
