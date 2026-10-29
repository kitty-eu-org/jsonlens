/**
 * 框架无关的 JSON 查看器。
 *
 * 设计原则（也是「跨框架」的全部秘密）：
 *   - 只依赖 DOM，不认识任何框架；
 *   - 对外只有 **一个工厂函数 + 一组方法 + 一组事件**，没有 JSX、没有响应式、没有生命周期钩子；
 *   - 样式自带且全部收在 `.jl-` 前缀下，不污染宿主页面。
 *
 * 各框架的绑定层只需要做一件事：把「挂载/卸载/属性变化」映射到
 * `createExplorer()` / `load()` / `destroy()` —— 一个封装 60 行就够。
 */
import { Query } from 'web-tree-sitter';
import { Highlighter, JSON_QUERY, LINE_HEIGHT } from './engines/highlight.js';
import { JsonView } from './engines/jsonview.js';
import { renderTree } from './engines/treeview.js';
import { ChunkedDoc, CHUNK_THRESHOLD } from './engines/chunked.js';
import { initWasm } from './wasm.js';

/** Query 只跟「语言」绑定，不跟实例绑定 —— 多实例共享一份，省一次编译 */
let sharedQuery = null;

/**
 * 一个容器上只允许活一个实例。
 *
 * 同一个元素被 `createExplorer()` 两次（框架封装写错、热更新、手写代码重复调用）时，
 * 旧实例的 ResizeObserver / scroll 监听 / 定时器不会自己消失 —— `el.innerHTML = TEMPLATE`
 * 只是把旧 DOM 摘掉，监听和观察器还挂在已脱离文档的节点上对着一份死数据跑。
 * 这里直接收掉旧的，比留一个「运行但看不见」的实例好。
 */
const LIVE = new WeakMap();

const TEMPLATE = `
<div class="jl-split">
  <div class="jl-pane jl-source">
    <div class="jl-bar">
      <span class="jl-title" data-ref="title">source.json</span>
      <span class="jl-meta" data-ref="meta"></span>
    </div>
    <div class="jl-scroll" data-ref="scroll" tabindex="0">
      <pre class="jl-pre" data-ref="pre"></pre>
    </div>
  </div>
  <div class="jl-pane jl-panel">
    <div class="jl-bar">
      <div class="jl-tabs" data-ref="tabs">
        <button type="button" class="jl-tab is-active" data-tab="json">JSON 视图</button>
        <button type="button" class="jl-tab" data-tab="tree">语法树</button>
      </div>
      <div class="jl-actions">
        <button type="button" class="jl-btn" data-act="expand" title="展开到第 3 层">展开 3 层</button>
        <button type="button" class="jl-btn" data-act="collapse" title="全部折叠">全部折叠</button>
      </div>
      <span class="jl-hint">滚到底自动加载 · 点击跳转源码</span>
    </div>
    <div class="jl-body">
      <div class="jl-json" data-ref="json"></div>
      <div class="jl-tree" data-ref="tree"></div>
    </div>
  </div>
</div>`;

const DEFAULT_OPTIONS = {
  wasmUrl: undefined, // 见 wasm.js
  defaultTab: 'json', // 'json' | 'tree'
  chunkThreshold: CHUNK_THRESHOLD,
  showTabs: true,
  showActions: true,
  title: 'source.json',
  theme: 'light', // 'light' | 'dark' | 'auto'
  expandDepth: 0, // load 之后自动展开到第几层（0 = 只展开根）
};

/** 一个最小的订阅器，不引入任何依赖 */
class Emitter {
  constructor() {
    this.map = new Map();
  }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return this;
  }
  off(type, fn) {
    this.map.get(type)?.delete(fn);
    return this;
  }
  emit(type, payload) {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        // 一个监听器抛错不该拖垮整个组件
        console.error('[jsonlens] listener error:', err);
      }
    }
  }
}

/** 等宽字体的字符宽度（横向窗口化要用） */
function measureCharWidth(pre) {
  const probe = document.createElement('span');
  probe.style.cssText =
    'position:absolute;visibility:hidden;white-space:pre;font-size:13px;line-height:20px';
  probe.style.fontFamily = getComputedStyle(pre).fontFamily;
  probe.textContent = '0'.repeat(50);
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 50;
  probe.remove();
  return w > 0 ? w : 8;
}

/**
 * 创建查看器。
 *
 * @param {HTMLElement|string} container 容器元素或选择器
 * @param {Partial<typeof DEFAULT_OPTIONS>} options
 */
export function createExplorer(container, options = {}) {
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  if (!el) throw new Error('[jsonlens] container not found');

  LIVE.get(el)?.destroy();

  // 注意不要直接 {...DEFAULT_OPTIONS, ...options}：
  // 框架封装层通常把「所有 props」都传进来，没传的就是 undefined，
  // 直接展开会把 showTabs/showActions 这类默认 true 的项覆盖成 undefined（=关闭）。
  const opts = { ...DEFAULT_OPTIONS };
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) opts[key] = value;
  }

  el.classList.add('jl-root');
  if (opts.theme === 'dark') el.dataset.jlTheme = 'dark';
  else if (opts.theme === 'auto') el.dataset.jlTheme = 'auto';
  el.innerHTML = TEMPLATE;

  const ref = {};
  for (const node of el.querySelectorAll('[data-ref]')) ref[node.dataset.ref] = node;
  if (!opts.showTabs) ref.tabs.style.display = 'none';
  if (!opts.showActions) el.querySelector('.jl-actions').style.display = 'none';
  ref.title.textContent = opts.title;

  const emitter = new Emitter();

  /** @type {import('./engines/chunked.js').ChunkedDoc|null} */
  let doc = null;
  /** @type {import('web-tree-sitter').Tree|null} */
  let tree = null;
  let source = '';
  let root = null;
  let parser = null;
  let hl = null;
  let jsonView = null;
  /** 语法树面板的句柄（renderTree 的返回值：setActive / collapseAll） */
  let treeView = null;
  let tab = opts.defaultTab;
  let dirty = { json: true, tree: true };
  let charWidth = 0;
  let destroyed = false;
  let fillHandle = 0;
  let filling = false;
  let stats = null;

  const scroller = ref.scroll;
  const jsonEl = ref.json;
  const treeEl = ref.tree;

  /* ---------------- 渲染 ---------------- */

  function layout() {
    const maxLen = hl.maxLineLength();
    ref.pre.style.height = `${hl.lineCount * LINE_HEIGHT + 16}px`;
    ref.pre.style.width = `${Math.max(maxLen * charWidth + 60, scroller.clientWidth)}px`;
  }

  function paint(force) {
    return hl.render(scroller.scrollTop, scroller.scrollLeft, scroller.clientHeight, force, scroller.clientWidth);
  }

  function panelRoot() {
    return doc ? doc.rootNode : (tree?.rootNode ?? null);
  }

  function syncPanel(immediate) {
    const r = panelRoot();
    if (!r) {
      jsonEl.replaceChildren();
      treeEl.replaceChildren();
      return;
    }
    if (tab === 'json') {
      if (dirty.json || immediate) {
        jsonView.setData(r, source);
        dirty.json = false;
      }
    } else if (dirty.tree || immediate) {
      treeView = renderTree(treeEl, r, source, { onHover, onSelect });
      dirty.tree = false;
    }
  }

  function setTab(next) {
    if (next !== 'json' && next !== 'tree') return;
    tab = next;
    for (const b of ref.tabs.querySelectorAll('[data-tab]')) {
      b.classList.toggle('is-active', b.dataset.tab === next);
    }
    jsonEl.classList.toggle('is-active', next === 'json');
    treeEl.classList.toggle('is-active', next === 'tree');
    syncPanel(false);
    emitter.emit('tabchange', next);
  }

  /* ---------------- 交互：hover / select ---------------- */

  /** 把某段源码滚到可视区并高亮 */
  function reveal(range) {
    if (!range) {
      hl.setActive(null);
      treeView?.setActive(null);
      return;
    }
    const top = hl.lineOf(range.start) * LINE_HEIGHT;
    const { scrollTop, clientHeight } = scroller;
    if (top < scrollTop + 10 || top > scrollTop + clientHeight - 40) {
      scroller.scrollTop = Math.max(0, top - clientHeight / 2);
    }
    paint(false); // 滚到窗口外了就先重画，再上高亮
    hl.setActive(range);
    // 语法树面板自己也有个「当前行」；只在自己可见时同步，否则 scrollIntoView
    // 会和上面那段源码的滚动打架
    if (tab === 'tree') treeView?.setActive(range);
  }

  /*
   * 面板里的悬停 / 点击 → 高亮源码 **并对外发事件**。
   *
   * 之前这里只是 `onHover: reveal`，于是 `index.d.ts` 里声明的 `hover` / `select`
   * 事件一次都没发出来 —— 四个封装全都订阅了它们（React 的 onHover/onSelect、
   * Vue 的 @hover/@select、Svelte action 的 onHover/onSelect、element 的 DOM 事件），
   * 结果全是「类型上有、运行时永远不响」。
   *
   * 事件挂在这里而不是挂进 `reveal()` 里：`api.reveal(range)` 是编程式调用，
   * 不应该反过来触发一个用户悬停事件。
   */
  const onHover = (range) => {
    reveal(range);
    emitter.emit('hover', range);
  };
  const onSelect = (range) => {
    reveal(range);
    emitter.emit('select', range);
  };

  /* ---------------- 空闲后台补解析 ---------------- */

  /**
   * 释放上一份文档占的 wasm 内存。
   *
   * tree-sitter 的 `Tree` 是 wasm 里的对象，JS 的 GC 管不到它 —— 0.25 也没有
   * FinalizationRegistry，不 `delete()` 就一直占着堆。表现是「反复打开文件，
   * 内存只涨不降」，一个 24MB 分块文档就是 87 棵树。
   */
  function releaseDoc() {
    if (doc) {
      doc.dispose();
      doc = null;
    }
    if (tree) {
      tree.delete();
      tree = null;
    }
    root = null;
    // JsonView 里还存着上一份文档的根节点。整棵解析模式下那是个**真的** wasm Node，
    // tree.delete() 之后它就成了野指针 —— 此时再点「展开 3 层」会去读已释放的内存
    // （wasm 里直接 trap）。所以必须把引用一起丢掉。
    jsonView?.reset();
  }

  const idle =
    typeof requestIdleCallback === 'function'
      ? (cb) => requestIdleCallback(cb, { timeout: 800 })
      : (cb) => setTimeout(() => cb({ timeRemaining: () => 8 }), 40);
  const cancelIdle =
    typeof cancelIdleCallback === 'function' ? (h) => cancelIdleCallback(h) : (h) => clearTimeout(h);

  function stopFill() {
    filling = false;
    if (fillHandle) {
      cancelIdle(fillHandle);
      fillHandle = 0;
    }
  }

  function startFill() {
    if (filling) return;
    filling = true;
    const step = () => {
      if (!filling || destroyed) return;
      if (!doc || doc.done) {
        filling = false;
        fillHandle = 0;
        emitStats();
        return;
      }
      doc.primeNext(1);
      emitStats();
      fillHandle = idle(step);
    };
    fillHandle = idle(step);
  }

  function emitStats(extra) {
    stats = {
      chars: source.length,
      lines: hl ? hl.lineCount : 0,
      chunks: doc ? { parsed: doc.parsedChunks, total: doc.chunks.length } : null,
      mode: doc ? 'chunked' : 'full',
      ...extra,
    };
    emitter.emit('stats', stats);
  }

  /* ---------------- 事件绑定 ---------------- */

  let scrollRaf = 0;
  const onScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!hl || destroyed) return;
      const r = paint(false);
      if (r.ms) emitter.emit('repaint', r);
    });
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });

  const onTabs = (e) => {
    const b = e.target.closest?.('[data-tab]');
    if (b) setTab(b.dataset.tab);
  };
  ref.tabs.addEventListener('click', onTabs);

  const onActs = (e) => {
    const b = e.target.closest?.('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'expand') api.expandTo(3);
    else api.collapseAll();
  };
  el.addEventListener('click', onActs);

  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    if (destroyed || !hl) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // 定时器可能排在 destroy() 之后才轮到执行，那时 hl 已经是 null 了
      if (destroyed || !hl) return;
      charWidth = measureCharWidth(ref.pre);
      hl.charWidth = charWidth;
      layout();
      paint(true);
    }, 80);
  });
  ro.observe(scroller);

  /* ---------------- 对外 API ---------------- */

  const ready = (async () => {
    const { parser: p, language } = await initWasm({ wasmUrl: opts.wasmUrl });
    // 等 wasm 的这段时间里实例可能已经被 destroy() 了（路由切走、React StrictMode
    // 的双次挂载都会这样）。此时再建 Highlighter/JsonView 等于往已清空的容器上挂东西，
    // 而且会一直攥着 wasm 里的对象不放。
    if (destroyed) return api;
    parser = p;
    if (!sharedQuery) sharedQuery = new Query(language, JSON_QUERY);
    charWidth = measureCharWidth(ref.pre);
    hl = new Highlighter(ref.pre, sharedQuery, { contentPositioned: true });
    hl.charWidth = charWidth;
    jsonView = new JsonView(jsonEl, { onHover, onSelect });
    jsonEl.classList.add('is-active');
    return api;
  })();

  // wasm 加载失败（路径写错、离线、CDN 挂掉）是**最常见**的接入问题。
  // 不接住的话宿主控制台只有一句 `Uncaught (in promise) TypeError: Failed to fetch`，
  // 连是哪个库报的都看不出来；这里转成一个 error 事件，谁用谁去接。
  ready.catch((err) => emitter.emit('error', err));

  const api = {
    el,
    ready,
    on: (type, fn) => (emitter.on(type, fn), api),
    off: (type, fn) => (emitter.off(type, fn), api),

    /** 载入一份 JSON 文本 */
    async load(text, { title } = {}) {
      await ready;
      if (destroyed) return null;
      if (typeof text !== 'string') throw new TypeError('[jsonlens] load() 需要字符串');

      stopFill();
      // 先放掉上一份文档：树不 delete 就会一直占 wasm 堆
      releaseDoc();
      source = text;
      dirty = { json: true, tree: true };
      jsonView.resetExpansion();
      hl.setActive(null); // 不清的话，上一个文件的选中区间会「高亮」到新文件的同偏移处
      if (title) ref.title.textContent = title;

      const t0 = performance.now();
      if (text.length > opts.chunkThreshold) {
        const d = new ChunkedDoc(text, parser);
        if (!d.unsupported) {
          d.prime(1);
          doc = d;
          root = d.rootNode;
        } else {
          d.dispose();
        }
      }
      if (!doc) {
        tree = parser.parse(text);
        root = tree?.rootNode ?? null;
      }
      const parseMs = performance.now() - t0;

      const t1 = performance.now();
      hl.update(text, doc ?? root);
      const updateMs = performance.now() - t1;

      const t2 = performance.now();
      layout();
      const layoutMs = performance.now() - t2;

      const t3 = performance.now();
      const r = paint(true);
      const paintMs = performance.now() - t3;

      // 顺序有讲究：expandAll() 要用 JsonView 里的 root，所以先把数据递进去。
      // 另外即使当前停在「语法树」tab，也要喂一次 —— 否则切回 JSON 时展开深度全丢了。
      const t4 = performance.now();
      jsonView.setData(root, source);
      dirty.json = false;
      if (opts.expandDepth > 0) jsonView.expandAll(opts.expandDepth);
      if (tab !== 'json') syncPanel(true);
      const panelMs = performance.now() - t4;

      const round = Math.round;
      const timing = {
        parseMs: round(parseMs),
        updateMs: round(updateMs),
        layoutMs: round(layoutMs),
        paintMs: round(paintMs),
        panelMs: round(panelMs),
        totalMs: round(performance.now() - t0),
      };
      const out = { ...timing, ...r };
      emitStats({ ...timing, tokens: r.tokens });
      if (doc && !doc.done) startFill();
      emitter.emit('load', out);
      return out;
    },

    clear() {
      stopFill();
      releaseDoc();
      source = '';
      if (hl) {
        hl.update('', null);
        hl.render(0, 0, 0, true);
      }
      jsonEl.replaceChildren();
      treeEl.replaceChildren();
      emitStats();
    },

    setTab,
    expandTo: (depth = 3) => jsonView?.expandAll(depth),
    collapseAll: () => {
      jsonView?.collapseAll();
      // 语法树面板是懒渲染的，上次渲染的句柄还在；两个面板一起折才对得上
      // 「全部折叠」这个按钮的字面意思（之前只折了 JSON 视图）
      treeView?.collapseAll();
    },
    /** 高亮某段源码。wasm 还没就绪时静默忽略（不会抛） */
    reveal: (range) => {
      if (!hl) return;
      reveal(range);
    },

    /** 切换主题：'light' | 'dark' | 'auto' */
    setTheme(next) {
      if (next === 'dark' || next === 'auto') el.dataset.jlTheme = next;
      else delete el.dataset.jlTheme;
    },

    /** 滚到第 n 行（0 起） */
    scrollToLine(line, { align = 'center' } = {}) {
      const top = line * LINE_HEIGHT;
      scroller.scrollTop =
        align === 'center' ? Math.max(0, top - scroller.clientHeight / 2) : Math.max(0, top);
      if (hl) paint(true); // wasm 没好时滚动位置已经设了，重画等 load 之后自然会做
    },

    get text() {
      return source;
    },
    get stats() {
      return stats;
    },
    get chunked() {
      return doc;
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopFill();
      clearTimeout(resizeTimer);
      if (scrollRaf) {
        cancelAnimationFrame(scrollRaf);
        scrollRaf = 0;
      }
      ro.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      ref.tabs.removeEventListener('click', onTabs);
      el.removeEventListener('click', onActs);
      // 释放 wasm 里的语法树，并摘掉 JsonView 挂在内部节点上的监听 / IntersectionObserver
      releaseDoc();
      jsonView?.destroy();
      jsonView = null;
      hl = null;
      el.classList.remove('jl-root');
      delete el.dataset.jlTheme;
      el.innerHTML = '';
      emitter.map.clear();
      if (LIVE.get(el) === api) LIVE.delete(el);
    },
  };

  LIVE.set(el, api);
  return api;
}
