/**
 * 计算两次文本之间的最小差异，转成 tree-sitter 的 Edit 描述。
 * 有了它才能走「增量解析」：tree.edit(...) + parser.parse(newText, oldTree)
 */

/** 把字符偏移换算成 {row, column}（web 端 index 都是 UTF-16 code unit） */
export function pointAt(text, index) {
  let row = 0;
  let column = 0;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      row++;
      column = 0;
    } else {
      column++;
    }
  }
  return { row, column };
}

/**
 * 从已知的 (row, column) 继续往前走，算到 `to` 处的行列。
 * 用来代替「再从头 pointAt 一遍」。
 */
function advance(from, text, start, to) {
  let row = from.row;
  let column = from.column;
  for (let i = start; i < to; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      row++;
      column = 0;
    } else {
      column++;
    }
  }
  return { row, column };
}

/**
 * @returns {null | {startIndex, oldEndIndex, newEndIndex, startPosition, oldEndPosition, newEndPosition}}
 */
export function diffEdit(oldText, newText) {
  if (oldText === newText) return null;

  const max = Math.min(oldText.length, newText.length);

  // 1. 公共前缀
  let start = 0;
  while (start < max && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;

  // 2. 公共后缀
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)
  ) {
    oldEnd--;
    newEnd--;
  }

  // 三个位置一次扫出来。
  //
  // 原来是 `pointAt(oldText, start)` + `pointAt(oldText, oldEnd)` + `pointAt(newText, newEnd)`，
  // 每个都从 0 开始数 —— 编辑落在文件尾部（最常见）时等于把 24MB 走了三遍。
  // 关键观察：**[0, start) 在两边完全相同**，所以 start 处的行列算一次就够，
  // 后两个位置从它继续往前走即可。
  const atStart = pointAt(oldText, start);

  return {
    startIndex: start,
    oldEndIndex: oldEnd,
    newEndIndex: newEnd,
    startPosition: atStart,
    oldEndPosition: advance(atStart, oldText, start, oldEnd),
    newEndPosition: advance(atStart, newText, start, newEnd),
  };
}
