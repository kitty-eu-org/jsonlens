/**
 * 库构建：ESM + CJS 双产物，两个 wasm 跟到 dist 根目录。
 *
 * 为什么 wasm 要跟着 JS 一起发：wasm 不参与 JS 打包，如果只发 JS，
 * 用户 import 之后运行时才发现 `tree-sitter.wasm` 404。
 * 这里把它拷到 dist/，`wasm.js` 里的 `new URL('./x.wasm', import.meta.url)` 就能直接命中。
 */
import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** 把 wasm/ 下的文件拷到 dist/ */
function copyWasm() {
  return {
    name: 'jsonlens:copy-wasm',
    apply: 'build',
    closeBundle() {
      const from = resolve(here, 'wasm');
      const to = resolve(here, 'dist');
      mkdirSync(to, { recursive: true });
      for (const f of readdirSync(from)) {
        if (f.endsWith('.wasm')) copyFileSync(resolve(from, f), resolve(to, f));
      }
    },
  };
}

export default defineConfig({
  plugins: [copyWasm()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    target: 'es2020',
    cssCodeSplit: false,
    lib: {
      entry: {
        index: resolve(here, 'src/index.js'),
        engines: resolve(here, 'src/engines/index.js'),
      },
      formats: ['es', 'cjs'],
      fileName: (fmt, name) => `${name}.${fmt === 'es' ? 'js' : 'cjs'}`,
      cssFileName: 'style',
    },
    rollupOptions: {
      // 由使用者安装，不进产物（它自己的 wasm 也要单独发）
      external: ['web-tree-sitter'],
      // CJS 产物里 import.meta 会变成 {}，我们已经在 wasm.js 里 try/catch 兜住了，
      // 这条警告对 CJS 使用者来说只是噪音
      onwarn(warning, warn) {
        if (warning.code === 'EMPTY_IMPORT_META' || warning.code === 'UNKNOWN_OPTION') return;
        warn(warning);
      },
    },
  },
});
