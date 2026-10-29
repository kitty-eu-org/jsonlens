/**
 * WASM 初始化。
 *
 * 这是把 web-tree-sitter 打包成库最麻烦的一步：它需要**两个** wasm，
 * 一个是运行时（`tree-sitter.wasm`，web-tree-sitter 自带），一个是语法（`tree-sitter-json.wasm`）。
 * 而 wasm 不参与 JS 打包，必须由使用方的构建工具正确地「发成静态资源」。
 *
 * 三种给法，按优先级：
 *   1. `wasmUrl: { runtime, language }` —— 两个完整 URL，最明确，任何构建工具都不会搞错
 *   2. `wasmUrl: '/assets/'` —— 一个目录，拼上文件名
 *   3. 不传 —— 从本包自己的 `dist/` 目录取（`new URL(..., import.meta.url)`，
 *      Vite / webpack5 / Rollup 都认这个写法，构建时会跟着 JS 一起搬过去）
 *
 * Parser.init() 全局只能初始化一次，所以这里把 Promise 缓存起来，
 * 多个实例共享同一份 wasm 和同一个 Parser 语言。
 */
import { Parser, Language } from 'web-tree-sitter';

const RUNTIME_FILE = 'tree-sitter.wasm';
const LANGUAGE_FILE = 'tree-sitter-json.wasm';

let cache = null;

/**
 * 本模块所在目录（以 `/` 结尾）。
 *
 * ⚠️ 这里**故意**不写 `new URL(`./${name}`, import.meta.url)`。
 * 那种写法看起来最标准，但只要 url 的第一参数是字符串/模板字面量，
 * Vite 就会把它认成「目录动态资源」，去 glob 整个 src 目录生成 `__import_glob__` 映射表，
 * 构建不报错、运行时拿到的是错的 URL —— 我在本包里就被这个坑了一次。
 * 用变量接住 `import.meta` 之后静态分析失效，URL 原样留到运行时拼。
 */
const HERE = (() => {
  try {
    const meta = import.meta;
    return meta && meta.url ? new URL('.', meta.url).href : '';
  } catch {
    return '';
  }
})();

function resolveUrls(wasmUrl) {
  if (wasmUrl && typeof wasmUrl === 'object') {
    return { runtime: wasmUrl.runtime, language: wasmUrl.language };
  }
  if (typeof wasmUrl === 'string' && wasmUrl) {
    const base = wasmUrl.endsWith('/') ? wasmUrl : `${wasmUrl}/`;
    return { runtime: base + RUNTIME_FILE, language: base + LANGUAGE_FILE };
  }
  if (!HERE) {
    throw new Error(
      '[jsonlens] 拿不到 import.meta.url（常见于 CJS 打包环境）。请显式传入 wasmUrl，' +
        '例如 initWasm({ wasmUrl: "/wasm/" })'
    );
  }
  // 默认：和本模块同级（构建产物会把两个 wasm 拷到 dist/ 根）
  return { runtime: HERE + RUNTIME_FILE, language: HERE + LANGUAGE_FILE };
}

/**
 * 读 wasm 字节。
 *
 * 为什么自己取而不让 emscripten 去 fetch：它的 wasm 加载失败时会 `abort()` 整个
 * Module，并从内部某个没人接的 Promise 里再抛一次 —— 宿主控制台看到的是
 * `Uncaught (in promise) Aborted(both async and sync fetching of the wasm failed)`，
 * 完全看不出是哪一步错了；而且 Module 此时已经废掉，改对配置重试也救不回来。
 *
 * 自己取字节，失败就是一句能看懂的 Error，并且根本没初始化 emscripten，能干净重试。
 * 请求次数不变（emscripten 本来也要取这两个文件），而且是并发取。
 */
async function readWasm(url) {
  // 判断依据是「有没有 DOM」而不是「URL 是不是 http」：浏览器里 wasmUrl 完全可能是
  // 相对路径（`/assets/x.wasm`、`./public/x.wasm`，交给 fetch 按页面地址解析），
  // 按协议判断会把这两种都误判成 Node 分支。
  const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (hasDom || /^https?:/i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  // file:// 或本地绝对路径（Node / Electron 主进程 / 单测）。用变量接住模块名，
  // 避免打包器在浏览器构建里静态分析 node: 前缀 —— 这条分支浏览器走不到。
  const fsSpec = 'node:fs/promises';
  const urlSpec = 'node:url';
  const [fs, nodeUrl] = await Promise.all([
    import(/* @vite-ignore */ fsSpec),
    import(/* @vite-ignore */ urlSpec),
  ]);
  let p = url;
  try {
    p = nodeUrl.fileURLToPath(url);
  } catch {
    /* 已经是普通路径 */
  }
  return new Uint8Array(await fs.readFile(p));
}

/**
 * @param {object} [options]
 * @param {string|{runtime?:string,language?:string}} [options.wasmUrl]
 * @returns {Promise<{parser: import('web-tree-sitter').Parser, language: any}>}
 */
export function initWasm(options = {}) {
  if (!cache) {
    cache = (async () => {
      // 放在 async 里面：resolveUrls 会同步抛（比如 CJS 环境拿不到 import.meta.url），
      // 放在外面抛的话调用方 `initWasm().catch()` 接不住，只能靠 try/catch —— 很反直觉。
      const urls = resolveUrls(options.wasmUrl);
      const [runtimeBin, languageBin] = await Promise.all([
        readWasm(urls.runtime),
        readWasm(urls.language),
      ]);

      await Parser.init({ locateFile: () => urls.runtime, wasmBinary: runtimeBin });
      const language = await Language.load(languageBin);
      const parser = new Parser();
      parser.setLanguage(language);

      // 预热：第一次 parse 会触发 wasm 堆分配，首次 captures 也会建缓存。
      // 这些是一次性成本，不该算在「打开第一个文件」头上。
      const warm = parser.parse('{"a":[1,2,3],"b":{"c":true}}');
      if (warm) warm.delete();
      return { parser, language };
    })().catch((err) => {
      cache = null; // 失败了要能重试（比如 URL 写错后改配置）
      throw new Error(
        `[jsonlens] wasm 初始化失败：${err.message}\n` +
          '检查 wasmUrl 是否指向真实存在的 tree-sitter.wasm 与 tree-sitter-json.wasm（见 README「wasm 怎么给」）',
        { cause: err },
      );
    });
  }
  return cache;
}
