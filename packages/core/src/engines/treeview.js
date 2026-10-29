/**
 * 语法树可视化：把 tree-sitter 的节点树渲染成可折叠的 DOM。
 * 每个节点行可以 hover 回传区间，用来在编辑器里高亮对应源码。
 *
 * 事件用委托：4000 行 × 3~4 个监听是 1.4 万个闭包，构建时全落在首屏那几百毫秒里。
 * 改成在容器上挂 3 个（hover / 离开 / 点击），行上的信息从 dataset 读。
 * 容器会被反复复用（换文件时只 replaceChildren），所以用 WeakMap 存上一轮的
 * AbortController，重建时先 abort，避免监听叠加。
 */

const MAX_ROWS = 4000; // 防止超大 JSON 把 DOM 撑爆
/**
 * 递归深度上限。build() 是**真递归**且一上来就把树全部展开，
 * 所以一份 5000 层嵌套的 JSON（构造出来的、或者机器生成的）会在建 DOM 时把调用栈
 * 打爆 —— RangeError 之后整个面板是空白，比截断难受得多。
 * 256 层已经远超任何正常数据结构。
 */
const MAX_DEPTH = 256;

/** 每个容器上一轮委托监听的 AbortController */
const TREE_LISTENERS = new WeakMap();

export function renderTree(container, root, source, handlers = {}) {
  container.replaceChildren();

  // 先把上一轮挂在同一个容器上的监听摘掉
  TREE_LISTENERS.get(container)?.abort();
  const ac = new AbortController();
  TREE_LISTENERS.set(container, ac);

  let created = 0;
  let truncated = false;
  let depthCapped = false;
  let hoverRow = null;
  let activeRow = null;

  function preview(node) {
    if (node.childCount > 0) return '';
    const raw = source.slice(node.startIndex, node.endIndex).replace(/\s+/g, ' ');
    return raw.length > 28 ? raw.slice(0, 28) + '…' : raw;
  }

  function build(node, depth, fieldName) {
    if (created >= MAX_ROWS) {
      truncated = true;
      return null;
    }
    created++;

    const row = document.createElement('div');
    row.className = 'row';
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.dataset.start = String(node.startIndex);
    row.dataset.end = String(node.endIndex);

    const hasChildren = node.childCount > 0;
    // 到底了就不再往下递归（见 MAX_DEPTH 的说明）：箭头画成叶子，别给一个
    // 点了展开不出东西的「假折叠」
    const tooDeep = hasChildren && depth >= MAX_DEPTH;
    if (tooDeep) depthCapped = true;
    const twist = document.createElement('span');
    twist.className = 'twist';
    twist.textContent = hasChildren && !tooDeep ? '▾' : '';
    row.appendChild(twist);

    if (fieldName) {
      const f = document.createElement('span');
      f.className = 'field';
      f.textContent = `${fieldName}:`;
      row.appendChild(f);
    }

    const type = document.createElement('span');
    type.className = 'type';
    if (node.type === 'ERROR') {
      type.classList.add('err');
      type.textContent = 'ERROR';
    } else if (node.isMissing) {
      type.classList.add('err');
      type.textContent = `MISSING ${node.type}`;
    } else {
      if (!node.isNamed) type.classList.add('anon');
      type.textContent = node.type;
    }
    row.appendChild(type);

    const pv = preview(node);
    if (pv) {
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = pv;
      row.appendChild(sub);
    }

    const range = document.createElement('span');
    range.className = 'range';
    range.textContent = `${node.startPosition.row + 1}:${node.startPosition.column + 1} · ${node.endIndex - node.startIndex}`;
    row.appendChild(range);

    const frag = document.createDocumentFragment();
    frag.appendChild(row);

    if (hasChildren && !tooDeep) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'children';
      frag.appendChild(childrenEl);

      for (let i = 0; i < node.childCount; i++) {
        // 先判断预算再取子节点：分块文档里 child(i) 可能触发一次块解析，
        // 不能等 build() 内部去拦（那样会把整份大文件都解析出来）
        if (created >= MAX_ROWS) {
          truncated = true;
          break;
        }
        const child = node.child(i);
        if (!child) continue;
        const built = build(child, depth + 1, node.fieldNameForChild(i));
        if (built) childrenEl.appendChild(built);
      }
    }

    // 监听统一交给容器上的委托（见函数末尾），这里一行都不挂
    return frag;
  }

  const treeFrag = build(root, 0, null);
  if (treeFrag) container.appendChild(treeFrag);

  if (truncated || depthCapped) {
    const note = document.createElement('div');
    note.className = 'row';
    note.style.color = '#9aa3ad';
    note.style.paddingLeft = '8px';
    note.textContent = depthCapped
      ? `… 嵌套超过 ${MAX_DEPTH} 层，再深的部分不展开（高亮仍覆盖全文）`
      : `… 节点过多，仅渲染前 ${MAX_ROWS} 个（高亮仍覆盖全文）`;
    container.appendChild(note);
  }

  /* ---------------- 事件委托 ---------------- */

  const rowOf = (t) => (t instanceof Element ? t.closest('.row') : null);

  container.addEventListener(
    'mouseover',
    (e) => {
      const row = rowOf(e.target);
      if (!row || row === hoverRow) return; // 行内移动不重复触发
      hoverRow = row;
      handlers.onHover?.({ start: +row.dataset.start, end: +row.dataset.end });
    },
    { signal: ac.signal },
  );

  // 用容器级 mouseleave 而不是逐行 mouseleave：跨行时不会闪一下「清除高亮」
  container.addEventListener(
    'mouseleave',
    () => {
      hoverRow = null;
      handlers.onHover?.(null);
    },
    { signal: ac.signal },
  );

  container.addEventListener(
    'click',
    (e) => {
      const row = rowOf(e.target);
      if (!row) return;
      const tw = e.target instanceof Element ? e.target.closest('.twist') : null;
      if (tw) {
        // childrenEl 是 row 的下一个兄弟（build() 里 frag 的顺序：row → children）
        const kids = row.nextElementSibling;
        if (!kids || !kids.classList.contains('children')) return;
        const collapsed = kids.classList.toggle('collapsed');
        tw.textContent = collapsed ? '▸' : '▾';
        return;
      }
      handlers.onSelect?.({ start: +row.dataset.start, end: +row.dataset.end });
    },
    { signal: ac.signal },
  );

  return {
    /**
     * 在树里标记某个区间对应的行。
     *
     * 这里**故意**用 querySelector 而不是在 build() 里顺手建一张 `区间 → 行` 的 Map。
     * 量过：属性选择器在 4001 行里找一行是 15 µs（一帧的 0.09%），而建那张表要 1.8 ms
     * （4001 次字符串拼接 + Map.set）。除非一次会话里悬停超过 120 次，否则建表是净亏。
     * 语法树是调试视图，打开但一次都不悬停才是常态 —— 所以让成本跟着使用发生。
     *
     * 唯一保留的优化是 activeRow 引用：摘掉上一个高亮不用再 querySelectorAll 扫一遍。
     */
    setActive(range) {
      activeRow?.classList.remove('active');
      activeRow = null;
      if (!range) return;
      const hit = container.querySelector(
        `.row[data-start="${range.start}"][data-end="${range.end}"]`,
      );
      if (hit) {
        hit.classList.add('active');
        hit.scrollIntoView({ block: 'nearest' });
        activeRow = hit;
      }
    },
    collapseAll() {
      container.querySelectorAll('.children').forEach((el) => el.classList.add('collapsed'));
      container.querySelectorAll('.twist').forEach((el) => {
        if (el.textContent === '▾') el.textContent = '▸';
      });
    },
  };
}
