/**
 * 临时校验：Highlighter.applyEdit 维护的行索引，必须和「整份重扫」完全一致。
 *
 * 这段逻辑是纯字符串运算，不需要 DOM —— 只要拼出一个带 source / lineStarts /
 * lineOf 的假对象，直接调原型方法即可。随机 fuzz 若干次编辑，逐次比对。
 */
import { Highlighter } from '../packages/core/src/engines/highlight.js';
import { diffEdit, pointAt } from '../packages/core/src/engines/diff.js';

function computeLineStarts(text) {
  const starts = [0];
  let i = -1;
  while ((i = text.indexOf('\n', i + 1)) !== -1) starts.push(i + 1);
  return starts;
}

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

let seed = 1234567;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (n) => Math.floor(rnd() * n);

/** 生成一段带换行的随机文本，行数在 1..12 之间 */
function makeText() {
  const lines = 1 + pick(12);
  let out = '';
  for (let i = 0; i < lines; i++) {
    const len = pick(9);
    for (let j = 0; j < len; j++) out += 'abc{}[]",: 0123'[pick(16)];
    if (i < lines - 1) out += '\n';
  }
  return out;
}

/** 随机做一次编辑，返回 [oldText, newText] */
function makeEdit(text) {
  const a = pick(text.length + 1);
  const b = Math.min(text.length, a + pick(5));
  let ins = '';
  const n = pick(4);
  for (let i = 0; i < n; i++) ins += '\n\nxyz'[pick(5)];
  return [text, text.slice(0, a) + ins + text.slice(b)];
}

let fails = 0;
let cases = 0;
// diffEdit 的三个 Position 是「只扫一遍前缀、后两个接着往前数」算出来的。
// applyEdit 只看 index，位置算错也发现不了 —— 这里单独拿 pointAt 从头数一遍对拍。
let posFails = 0;

for (let round = 0; round < 4000; round++) {
  const [oldText, newText] = makeEdit(makeText());
  const edit = diffEdit(oldText, newText);
  if (!edit) continue;
  cases++;

  const wantStart = pointAt(oldText, edit.startIndex);
  const wantOldEnd = pointAt(oldText, edit.oldEndIndex);
  const wantNewEnd = pointAt(newText, edit.newEndIndex);
  const same = (a, b) => a.row === b.row && a.column === b.column;
  if (
    !same(edit.startPosition, wantStart) ||
    !same(edit.oldEndPosition, wantOldEnd) ||
    !same(edit.newEndPosition, wantNewEnd)
  ) {
    posFails++;
    if (posFails <= 3) {
      console.log('--- Position 不一致 ---');
      console.log('old :', JSON.stringify(oldText));
      console.log('new :', JSON.stringify(newText));
      console.log('got :', JSON.stringify([edit.startPosition, edit.oldEndPosition, edit.newEndPosition]));
      console.log('want:', JSON.stringify([wantStart, wantOldEnd, wantNewEnd]));
    }
  }

  const fake = {
    source: oldText,
    lineStarts: computeLineStarts(oldText),
    lineOf: Highlighter.prototype.lineOf,
  };
  Highlighter.prototype.applyEdit.call(fake, newText, edit);

  const expect = computeLineStarts(newText);
  if (!eq(fake.lineStarts, expect)) {
    fails++;
    if (fails <= 3) {
      console.log('--- 不一致 ---');
      console.log('old :', JSON.stringify(oldText));
      console.log('new :', JSON.stringify(newText));
      console.log('edit:', JSON.stringify(edit));
      console.log('got :', JSON.stringify(fake.lineStarts));
      console.log('want:', JSON.stringify(expect));
    }
  }
}

console.log(`\napplyEdit fuzz: ${cases} 例，失败 ${fails} 例`);
console.log(`diffEdit Position 对拍: ${cases} 例，失败 ${posFails} 例`);

/* ---- 连续编辑：单次对不代表连起来对，漂移是一点点攒出来的 ---- */
let chainFails = 0;
let chainSteps = 0;
for (let chain = 0; chain < 300; chain++) {
  let text = makeText();
  const fake = { source: text, lineStarts: computeLineStarts(text), lineOf: Highlighter.prototype.lineOf };
  for (let step = 0; step < 15; step++) {
    const [, next] = makeEdit(text);
    const edit = diffEdit(text, next);
    if (!edit) continue;
    Highlighter.prototype.applyEdit.call(fake, next, edit);
    // 关键：真实调用链里 update() 会在 applyEdit 之后把 this.source 一起更新，
    // 这里必须同步，否则「尾部没有后续行」那条分支会拿着旧长度去算扫描窗口。
    fake.source = next;
    text = next;
    chainSteps++;
    if (!eq(fake.lineStarts, computeLineStarts(text))) {
      chainFails++;
      break;
    }
  }
}
console.log(`applyEdit 连续编辑: ${chainSteps} 步，失败 ${chainFails} 例\n`);

process.exit(fails || chainFails || posFails ? 1 : 0);
