/**
 * jsonlens-element —— `<json-explorer>` 自定义元素
 *
 * 这条路解决的是「构建工具链五花八门」的问题：只要页面能加载一个 ESM 文件，
 * 不管是 PHP、Rails、Django 模板、还是 Vue/React/Svelte 里直接写标签，都能用。
 *
 * 用法：
 *   <json-explorer src="/data/big.json" theme="dark" style="height: 600px"></json-explorer>
 *   el.load(jsonText)        // 或者直接喂文本
 *   el.addEventListener('select', e => console.log(e.detail))
 *
 * 注意：`value` 属性不要放大段 JSON —— HTML 属性有转义和长度问题。
 * 大文本请用 `src` 让组件自己 fetch，或者 JS 里调 `.load()`。
 */
import { createExplorer } from '@fagao-ai/jsonlens';
import '@fagao-ai/jsonlens/style.css';

const ATTRS = ['src', 'value', 'theme', 'tab', 'title', 'expand-depth'];

const stylesApplied = new WeakSet();

export class JsonExplorerElement extends HTMLElement {
  static get observedAttributes() {
    return ATTRS;
  }

  /**
   * 全局 wasm 地址（只影响此后新建的元素）。
   * 纯 HTML 页面没法给组件传对象，就在这里配一次：
   *   JsonExplorerElement.wasmUrl = { runtime: '/wasm/tree-sitter.wasm', language: '/wasm/tree-sitter-json.wasm' };
   * 不配就走默认（从包目录取），CDN 直连场景下默认值是对的。
   */
  static wasmUrl = undefined;

  constructor() {
    super();
    this._api = null;
    this._loadToken = 0;
  }

  connectedCallback() {
    if (this._api || this._scheduled) return;
    // 延后再真正创建。原因：`customElements.define()` 会**同步** upgrade 页面里已有的标签，
    // 而调用方通常要先 import、再写静态配置：
    //   const { JsonExplorerElement } = await import('@fagao-ai/jsonlens-element');
    //   JsonExplorerElement.wasmUrl = {...};
    // 不延后就会拿着「还没设置的配置」去初始化，wasm 直接 404。
    //
    // 这里必须是**宏任务**（setTimeout）而不是 queueMicrotask：模块求值是一个独立任务，
    // 它结束时浏览器会把微任务清空 —— 也就是说 `await import()` 的调用方还没机会跑，
    // 微任务版的初始化就已经发生了（实测就是这样：静默用了默认 wasm 地址）。
    // 宏任务排在调用方之后，两种写法才都能读到配置。
    this._scheduled = true;
    setTimeout(() => {
      this._scheduled = false;
      if (this._api || !this.isConnected) return;
      this._create();
    }, 0);
  }

  _create() {
    // 高度由宿主决定（`style="height:600px"` 或 CSS），
    // 这里只保证它是个能撑开的块级容器 —— 不要写 display:block，
    // 那会盖掉 .jl-root 的 flex 布局，滚动容器就会被内容撑到几万像素。
    if (!stylesApplied.has(this)) {
      this.style.display = 'flex';
      this.style.flexDirection = 'column';
      stylesApplied.add(this);
    }

    const api = createExplorer(this, {
      theme: this.getAttribute('theme') || 'light',
      defaultTab: this.getAttribute('tab') || 'json',
      title: this.getAttribute('title') || 'source.json',
      expandDepth: Number(this.getAttribute('expand-depth')) || 0,
      wasmUrl: JsonExplorerElement.wasmUrl,
    });
    this._api = api;

    // 转发成 DOM 事件，任何框架/原生都能监听
    for (const type of ['hover', 'select', 'stats', 'load', 'tabchange']) {
      api.on(type, (detail) =>
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })),
      );
    }
    // wasm 初始化失败（路径配错最常见）也归到 loaderror：对使用者来说都是
    // 「这个组件没能把数据加载起来」，没必要分两种事件去接。
    api.on('error', (err) =>
      this.dispatchEvent(
        new CustomEvent('loaderror', { detail: err, bubbles: true, composed: true }),
      ),
    );

    this._syncSource();
    if (this._pending) {
      const { text, options } = this._pending;
      this._pending = null;
      api.load(text, options);
    }
  }

  disconnectedCallback() {
    // 不能在断开的瞬间就 destroy：DOM 搬家（弹窗挂载、列表虚拟化、`appendChild`
    // 换个父节点）会先 disconnect 再 connect，立刻销毁等于把滚动位置、展开状态全丢，
    // 有 `src` 的话还要重新 fetch 一遍。延到宏任务，确认真的没再挂上来再收。
    setTimeout(() => {
      if (this.isConnected || !this._api) return;
      this._api.destroy();
      this._api = null;
    }, 0);
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._api || oldVal === newVal) return;
    if (name === 'theme') this._api.setTheme(newVal || 'light');
    else if (name === 'tab') this._api.setTab(newVal || 'json');
    else if (name === 'expand-depth') this._api.expandTo(Number(newVal) || 0);
    else if (name === 'src' || name === 'value') this._syncSource();
  }

  /** value 优先，其次 src，都没有就等外部调 load() */
  async _syncSource() {
    // token 必须在分支之前自增，两个来源共用同一个序号。
    // 原来只在 src 分支自增，于是「先 src（fetch 在飞）→ 再 set value」时，
    // 慢到的 fetch 发现 token 没变，会把刚载入的 value 直接覆盖掉。
    const token = ++this._loadToken;

    // try 必须包住 **两个** 分支。原来只包了 src：`value` 分支上
    // `await this._api.load(...)` 的拒绝会直接逃出 _syncSource —— 而两个调用方
    // （_create / attributeChangedCallback）都不可能去 await 它，于是变成
    // 「未处理的 Promise 拒绝」。wasm 路径配错时就是这条路径在宿主控制台甩红字。
    try {
      const value = this.getAttribute('value');
      if (value) {
        await this._api?.load(value, { title: this.getAttribute('title') || 'inline.json' });
        return;
      }
      const src = this.getAttribute('src');
      if (!src) return;

      this.classList.add('jl-loading');
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      if (token !== this._loadToken) return; // 期间换了来源（src 或 value），丢掉这次结果
      await this._api?.load(text, {
        title: this.getAttribute('title') || src.split('/').pop(),
      });
    } catch (err) {
      if (token !== this._loadToken) return; // 已经换成别的来源了，这个错不值得报
      console.error('[json-explorer] 加载失败:', err);
      this.dispatchEvent(
        // 不叫 'error'：那个名字和浏览器内置的 error 事件撞车，
        // 类型上也没法在 HTMLElementEventMap 里共存
        new CustomEvent('loaderror', { detail: err, bubbles: true, composed: true }),
      );
    } finally {
      if (token === this._loadToken) this.classList.remove('jl-loading');
    }
  }

  /* ---- 对外 API（和 createExplorer 保持一致） ---- */

  /**
   * 类型安全的监听。
   * 原生 `addEventListener('stats', e => e.detail)` 也能用（事件是冒泡的），
   * 只是 detail 的类型需要自己断言 —— 所以这里给一个直接拿 detail 的版本。
   * @returns 取消监听的函数
   */
  on(type, fn) {
    const handler = (e) => fn(e.detail);
    this.addEventListener(type, handler);
    return () => this.removeEventListener(type, handler);
  }

  load(text, options) {
    if (!this._api) {
      // 元素还没插进 DOM：先记下来，等 connectedCallback 再载入。
      // 不能塞进 value 属性 —— 大 JSON 放 HTML attribute 会被转义和长度限制坑死。
      this._pending = { text, options };
      return Promise.resolve(null);
    }
    return this._api.load(text, options);
  }
  expandTo(depth) {
    this._api?.expandTo(depth);
  }
  collapseAll() {
    this._api?.collapseAll();
  }
  setTab(tab) {
    this._api?.setTab(tab);
  }
  setTheme(theme) {
    this._api?.setTheme(theme);
  }
  scrollToLine(line, opts) {
    this._api?.scrollToLine(line, opts);
  }
  get stats() {
    return this._api?.stats ?? null;
  }
  get explorer() {
    return this._api;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('json-explorer')) {
  customElements.define('json-explorer', JsonExplorerElement);
}

export default JsonExplorerElement;
