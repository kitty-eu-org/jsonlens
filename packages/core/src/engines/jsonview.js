/**
 * JSON 结构视图（JSONViewer 风格）：按数据结构折叠，而不是按语法树。
 *
 * 数据来源仍是 tree-sitter 的语法树 —— 好处是哪怕 JSON 有语法错误，
 * 已经能识别的部分照样能展开查看，而且每个节点都带着源码区间，
 * 可以直接跳回编辑器。
 *
 * 大文件策略：
 *   - 默认只展开根节点
 *   - 子节点「按需构建」：折叠状态下完全不建 DOM
 *   - 数组/对象一次最多渲染 CHUNK 条，尾部放一个哨兵，滚到就自动续（无限滚动，不用点按钮）
 *   - 全局行数预算 ROW_BUDGET，超出就停止展开并提示
 */

const ROW_H = 20; // 必须和 CSS 里 .jrow 的行高一致

/**
 * 首屏一批要刚好铺满一屏再多一点：太小的话哨兵一进视口就触发补加载，等于把成本
 * 从「上屏前」挪到「上屏后」，白忙；太大就是白白多建 DOM。按屏幕高度算，别写死——
 * 800px 的笔记本和 1440px 的大显示器差快一倍。
 *
 * 注意这里**不能在模块顶层读 window**：这个文件会被 SSR（Next/Nuxt）在 Node 里 import，
 * 顶层访问 window 会直接抛 `window is not defined`，整个包都用不了。
 */
function batchSize() {
  const h = typeof window !== 'undefined' ? window.innerHeight || 900 : 900;
  return Math.max(50, Math.round(h / ROW_H) + 14);
}

// 无限滚动是按需长的，正常滚动不会一次铺满；这里只兜底「展开 3 层」这种暴力操作。
// 20000 行足够把 25MB 那个 11351 项的数组一路滚到底。
const ROW_BUDGET = 20000;
const MAX_SCALAR = 160;
/** expandAll 的递归深度上限：见 expandAll() 里的说明 */
const MAX_EXPAND_DEPTH = 200;

const span = (cls, text) => {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
};

/** 把 "name" 这种带引号的 key 转成 JSONPath 片段 */
function pathKey(raw) {
  const k = raw.replace(/^"|"$/g, '');
  return /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
}

const SCALAR_CLASS = {
  string: 'jstr',
  number: 'jnum',
  true: 'jbool',
  false: 'jbool',
  null: 'jnull',
  ERROR: 'jerr',
};

export class JsonView {
  constructor(el, handlers = {}) {
    this.el = el;
    this.handlers = handlers;
    this.batch = batchSize(); // 每批建多少行，按实例创建时的屏高算
    this.expanded = new Set(['$']); // 记住展开的 JSON 路径；根默认展开
    this.root = null;
    this.source = '';
    this.rows = 0;

    // 无限滚动：尾部哨兵进入视口附近就自动续下一批，不用点「显示更多」。
    // 两条触发路径：IntersectionObserver 负责「不滚动也在视口里」的情况（比如刚展开
    // 一个矮容器），scroll 事件负责滚动 —— 只靠 IO 实测会丢通知，滚到底有时不续。
    this.sentinels = new Set();
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) e.target.__fill?.();
        }
      },
      { root: this.el, rootMargin: '240px 0px' },
    );

    let raf = 0;
    this._raf = 0;
    // 所有监听挂在一个 AbortController 上，destroy() 一次全摘掉。
    // 之前是匿名函数直接挂，元素被复用时旧监听摘不掉，跑一整晚就是每帧多调几次 fillVisible。
    this._ac = new AbortController();
    const signal = this._ac.signal;
    this.el.addEventListener(
      'scroll',
      () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          this._raf = 0;
          this.fillVisible();
        });
        this._raf = raf;
      },
      { passive: true, signal },
    );

    // 悬停进/出 + 点击全部委托到根节点。原来是每一行挂 3 个监听（悬停进、悬停出、点击），
    // 60 行就是 180 个闭包，实测占掉首屏构建 6ms 里的一大半；「展开 3 层」是几万行，更撑不住。
    // 行上的 dataset.start / dataset.end 本来就有，委托时直接读，不用额外存。
    this._hoverRow = null;
    this.el.addEventListener(
      'mouseover',
      (e) => {
        const row = e.target instanceof Element ? e.target.closest('.jrow') : null;
        if (!row || row === this._hoverRow) return;
        this._hoverRow = row;
        this.handlers.onHover?.({ start: +row.dataset.start, end: +row.dataset.end });
      },
      { signal },
    );
    this.el.addEventListener(
      'mouseleave',
      () => {
        this._hoverRow = null;
        this.handlers.onHover?.(null);
      },
      { signal },
    );
    this.el.addEventListener(
      'click',
      (e) => {
        const row = e.target instanceof Element ? e.target.closest('.jrow') : null;
        if (!row) return;
        if (row.__toggle) row.__toggle();
        else this.handlers.onSelect?.({ start: +row.dataset.start, end: +row.dataset.end });
      },
      { signal },
    );
  }

  /**
   * 丢掉当前文档，但保留实例（监听器、观察器都还在）。
   * 上层换文件 / 清空时用：原本只清 DOM，`this.root` 还指着上一个文档的节点 ——
   * 那可能是已经被 `tree.delete()` 释放掉的 wasm 对象，再碰就是读野指针。
   */
  reset() {
    this.io.disconnect();
    this.sentinels.clear();
    this.root = null;
    this.source = '';
    this.rows = 0;
    this.expanded = new Set(['$']);
    this.el.replaceChildren();
  }

  /** 卸载：断开观察器和所有监听，清空 DOM 引用 */
  destroy() {
    this._ac?.abort();
    this._ac = null;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    this.io.disconnect();
    this.reset();
    this.handlers = {};
  }

  /** 把视口附近（下沿 240px 内）的哨兵都触发一次 */
  fillVisible() {
    if (!this.sentinels.size) return;
    const box = this.el.getBoundingClientRect();
    for (const s of [...this.sentinels]) {
      if (!s.isConnected) {
        this.sentinels.delete(s);
        continue;
      }
      if (s.getBoundingClientRect().top <= box.bottom + 240) s.__fill?.();
    }
  }

  /** 换了新文档时重置展开状态（根保持展开） */
  resetExpansion() {
    this.expanded = new Set(['$']);
  }

  setData(root, source) {
    this.root = root;
    this.source = source;
    this.render();
  }

  render() {
    this.io.disconnect(); // 旧的哨兵随 DOM 一起没了
    this.sentinels.clear();
    this.rows = 0;
    this.el.replaceChildren();

    // document 可能有多个子节点（JSON 有语法错误时，尾巴会变成 ERROR 兄弟节点），
    // 全部都要渲染，否则坏掉的那段会被静默藏掉
    const tops = [];
    if (this.root?.type === 'document') {
      for (let i = 0; i < this.root.namedChildCount; i++) {
        const child = this.root.namedChild(i);
        if (child) tops.push(child);
      }
    } else if (this.root) {
      tops.push(this.root);
    }

    if (!tops.length) {
      this.el.appendChild(span('jempty', '（空文档）'));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const value of tops) {
      this.rows++;
      if (value.type === 'ERROR') frag.appendChild(this.buildError(value, 0));
      else if (value.type === 'object' || value.type === 'array') {
        frag.appendChild(this.buildContainer(value, null, '$', 0));
      } else {
        frag.appendChild(this.buildScalar(value, null, '$', 0));
      }
    }
    this.el.appendChild(frag);

    if (this.rows >= ROW_BUDGET) {
      this.el.appendChild(
        span('jmore jbudget', `已达渲染上限（${ROW_BUDGET} 行），继续展开请先折叠部分节点`),
      );
    }
  }

  /**
   * 节点是否展开。
   *
   * 只查自己，不扫「有没有后代在 expanded 里」。原来的实现是
   * `for (const p of this.expanded) if (p.startsWith(path + '.'))` —— 每个容器
   * 一次、每次 O(expanded)，展开得深时是上千 × 上千的字符串前缀比较。
   *
   * 换成直接查之后为什么还等价：那条分支本来就不可达。三条写入路径都保证
   * 「父一定先于子进 expanded」：
   *   1. 点 twist 只能点到可见行，而可见的前提就是父已展开；
   *   2. expandAll() 是自顶向下 walk，先 add 父再递归子；
   *   3. 折叠走 closePath()，会把整棵子树从 expanded 里删掉，不留孤儿。
   * 所以「自己没展开但后代展开了」这个状态在正常流程里不存在。
   * 万一将来真有（比如新加一个按路径直接展开的 API），表现也只是那个节点显示成
   * 折叠、点一下就好，不会崩。
   */
  isOpen(path) {
    return this.expanded.has(path);
  }

  closePath(path) {
    this.expanded.delete(path);
    // 不用先 `[...this.expanded]` 拷一份：Set 的迭代器是活的，
    // 「边迭代边删除」在规范里是明确定义的安全操作（删掉的元素之后不会再被访问）。
    // 展开 3 层之后 expanded 可能上万条，每次折叠都拷一个数组纯属白烧。
    for (const p of this.expanded) {
      if (p.startsWith(path + '.') || p.startsWith(path + '[')) this.expanded.delete(p);
    }
  }

  /** key 或数组下标，二选一 */
  appendLabel(row, keyText, idx) {
    if (keyText !== null) {
      row.appendChild(span('jkey', keyText));
      row.appendChild(span('jcolon', ':'));
    } else if (idx !== null && idx !== undefined) {
      row.appendChild(span('jidx', `${idx}:`));
    }
  }

  /** 对象 / 数组：一行摘要 +（懒加载的）子节点 */
  buildContainer(node, keyText, path, depth, idx = null) {
    const isArr = node.type === 'array';
    const total = node.namedChildCount;
    let open = this.isOpen(path);

    const wrap = document.createDocumentFragment();
    const row = document.createElement('div');
    row.className = 'jrow';
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.title = path;
    row.dataset.start = String(node.startIndex);
    row.dataset.end = String(node.endIndex);

    const twist = span('jtwist', open ? '▾' : '▸');
    twist.dataset.toggle = '1';
    row.appendChild(twist);

    this.appendLabel(row, keyText, idx);
    row.appendChild(span('jbrace', isArr ? '[' : '{'));
    row.appendChild(span('jcount', String(total)));
    row.appendChild(span('jbrace', isArr ? ']' : '}'));

    const kids = document.createElement('div');
    kids.className = 'jchildren';

    let builtTo = 0;

    // 懒创建：折叠状态下既不建哨兵、也不建那四个闭包。
    // 一棵 25MB 的树里有上万个「永远折叠」的容器，每个都建哨兵 + 闭包纯属白扔。
    let sentinel = null;
    let loadBatch = null;
    let syncSentinel = null;

    const ensureLazy = () => {
      if (loadBatch) return;

      // 尾部哨兵：滚到视口附近自动续下一批，不再有「显示更多」按钮
      sentinel = document.createElement('div');
      sentinel.className = 'jmore';
      sentinel.style.paddingLeft = `${8 + (depth + 1) * 14}px`;

      /** 追加一批；返回「后面还有没有」 */
      loadBatch = () => {
        if (builtTo >= total || this.rows >= ROW_BUDGET) return false;
        const to = Math.min(total, builtTo + this.batch);
        const frag = document.createDocumentFragment();
        let i = builtTo;
        for (; i < to; i++) {
          if (this.rows >= ROW_BUDGET) break;
          const child = node.namedChild(i);
          if (!child) continue;
          this.rows++;
          frag.appendChild(
            isArr
              ? this.buildValue(child, null, `${path}[${i}]`, depth + 1, i)
              : this.buildPair(child, path, depth + 1, i),
          );
        }
        builtTo = i;
        kids.insertBefore(frag, sentinel); // 哨兵始终留在最后
        syncSentinel();
        return builtTo < total && this.rows < ROW_BUDGET;
      };

      /** 更新哨兵位置和文案：还有就继续观察，没了就撤掉 */
      syncSentinel = () => {
        if (builtTo >= total) {
          this.io.unobserve(sentinel);
          this.sentinels.delete(sentinel);
          sentinel.remove();
          return;
        }
        if (this.rows >= ROW_BUDGET) {
          this.io.unobserve(sentinel);
          this.sentinels.delete(sentinel);
          sentinel.classList.add('jbudget');
          sentinel.textContent = `已达渲染上限（${ROW_BUDGET} 行），先折叠一些节点`;
          if (!sentinel.isConnected) kids.appendChild(sentinel);
          return;
        }
        sentinel.classList.remove('jbudget');
        sentinel.textContent = `向下滚动继续 · 还剩 ${(total - builtTo).toLocaleString('en-US')} 项`;
        if (!sentinel.isConnected) kids.appendChild(sentinel);
        this.sentinels.add(sentinel);
        this.io.observe(sentinel);
      };

      // 哨兵进入可视区附近时触发；内容撑不满一屏就继续补，直到推出视口
      sentinel.__fill = () => {
        const box = this.el.getBoundingClientRect();
        for (let guard = 0; guard < 4; guard++) {
          if (!sentinel.isConnected) return;
          if (sentinel.getBoundingClientRect().top > box.bottom + 240) return;
          if (!loadBatch()) return;
        }
      };
    };

    const expand = () => {
      ensureLazy();
      if (!sentinel.isConnected) kids.appendChild(sentinel);
      if (builtTo === 0 && total > 0) loadBatch();
      else syncSentinel(); // total 为 0 时这里会把哨兵撤掉
      kids.style.display = '';
      twist.textContent = '▾';
    };

    if (open) expand();
    else kids.style.display = 'none';

    // 容器行的「切换」逻辑直接挂在 row 上，由根节点的委托点击调用。
    // 原来是给每个 twist 单独加 addEventListener 再 `row.__toggle = () => twist.click()`：
    // 一行 1 个监听 + 1 个闭包，而且 `twist.click()` 是**合成**一个新事件再冒泡上来，
    // 全靠 twist 里的 stopPropagation 才没打死循环 —— 太脆。现在一行 0 个监听。
    row.__toggle = () => {
      const nowOpen = kids.style.display === 'none';
      if (nowOpen) {
        this.expanded.add(path);
        expand();
      } else {
        this.closePath(path);
        kids.style.display = 'none';
        twist.textContent = '▸';
      }
    };

    wrap.appendChild(row);
    wrap.appendChild(kids);
    return wrap;
  }

  /** pair（对象里的一项）：key 直接拼到 value 的行上 */
  buildPair(pair, parentPath, depth, index) {
    if (pair.type === 'ERROR') return this.buildError(pair, depth);

    const keyNode = pair.childForFieldName('key');
    const valueNode = pair.childForFieldName('value');
    const rawKey = keyNode ? this.source.slice(keyNode.startIndex, keyNode.endIndex) : `#${index}`;
    const keyPath = parentPath + pathKey(rawKey);

    if (!valueNode) {
      return this.buildMissing(pair, rawKey, depth);
    }
    return this.buildValue(valueNode, rawKey, keyPath, depth);
  }

  buildValue(node, keyText, path, depth, idx = null) {
    if (node.type === 'ERROR') return this.buildError(node, depth);
    if (node.type === 'object' || node.type === 'array') {
      return this.buildContainer(node, keyText, path, depth, idx);
    }
    return this.buildScalar(node, keyText, path, depth, idx);
  }

  /** 无法解析的一段：整段标红，让人知道这里坏了，而不是假装没有 */
  buildError(node, depth) {
    const row = document.createElement('div');
    row.className = 'jrow';
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.dataset.start = String(node.startIndex);
    row.dataset.end = String(node.endIndex);
    row.title = '这段无法解析，可切到「语法树」查看 ERROR 节点';

    row.appendChild(span('jtwist', ''));
    const raw = this.source.slice(node.startIndex, node.endIndex).replace(/\s+/g, ' ').trim();
    row.appendChild(span('jerr', `⚠ 语法错误：${raw.length > 60 ? raw.slice(0, 60) + '…' : raw}`));
    return row;
  }

  buildScalar(node, keyText, path, depth, idx = null) {
    const row = document.createElement('div');
    row.className = 'jrow';
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.title = path;
    row.dataset.start = String(node.startIndex);
    row.dataset.end = String(node.endIndex);

    row.appendChild(span('jtwist', ''));

    this.appendLabel(row, keyText, idx);

    let text = this.source.slice(node.startIndex, node.endIndex);
    let cls = SCALAR_CLASS[node.type] ?? 'jother';

    if (node.type === 'ERROR' || node.isMissing) {
      cls = 'jerr';
      text = `⚠ 无法解析：${text.slice(0, 40) || '（缺失）'}`;
    } else if (text.length > MAX_SCALAR) {
      text = `${text.slice(0, MAX_SCALAR)}…`;
    }

    row.appendChild(span(cls, text));

    return row;
  }

  buildMissing(pair, rawKey, depth) {
    const row = document.createElement('div');
    row.className = 'jrow';
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.appendChild(span('jtwist', ''));
    row.appendChild(span('jkey', rawKey));
    row.appendChild(span('jcolon', ':'));
    row.appendChild(span('jerr', '⚠ 缺少值'));
    row.dataset.start = String(pair.startIndex);
    row.dataset.end = String(pair.endIndex);
    return row;
  }

  /** 展开到指定深度（默认 3 层），受 ROW_BUDGET 限制 */
  expandAll(maxDepth = 3) {
    let visited = 0;
    // 递归深度上限。`expandTo(1e9)` 这种调用（或者一份 5000 层嵌套的恶意 JSON）
    // 会让 render() 的递归直接把栈打爆 —— RangeError 之后整个面板是白的，
    // 比「只展开 200 层」糟得多。200 层已经远超任何正常数据。
    maxDepth = Math.min(maxDepth, MAX_EXPAND_DEPTH);
    // 自动展开时每个容器最多往下展开这么多孩子。
    // 没有这个上限，对一个 2.4 万元素的数组做「展开 2 层」会把它所有子节点都
    // 建出来 —— 屏幕上也就能看到 40 行，剩下全是白干；分块文档更惨：
    // 每个孩子都要触发所在块的解析，等于把 24 MB 全解一遍（实测 2.1 秒）。
    const CHILD_CAP = 200;
    const walk = (node, path, depth) => {
      if (depth >= maxDepth) return;
      if (node.type !== 'object' && node.type !== 'array') return;
      if (++visited > CHILD_CAP * 40) return;
      this.expanded.add(path);
      const count = Math.min(node.namedChildCount, CHILD_CAP);
      for (let i = 0; i < count; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        if (node.type === 'array') {
          walk(child, `${path}[${i}]`, depth + 1);
        } else {
          const valueNode = child.childForFieldName('value');
          const keyNode = child.childForFieldName('key');
          if (!valueNode || !keyNode) continue;
          const rawKey = this.source.slice(keyNode.startIndex, keyNode.endIndex);
          walk(valueNode, path + pathKey(rawKey), depth + 1);
        }
      }
    };
    const value = this.root?.type === 'document' ? this.root.namedChild(0) : this.root;
    if (value) walk(value, '$', 0);
    this.render();
  }

  collapseAll() {
    this.expanded.clear();
    this.render();
  }
}
