/**
 * 示例站点的构建配置：一个入口一个页面，方便直接对比四种接法。
 *
 * 单独一个 config 的原因：示例的 root 是 examples/，构建产物也不该混进 demo 的 dist/。
 */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  server: { port: 5181 },
  build: {
    outDir: resolve(here, '../dist-examples'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(here, 'index.html'),
        vanilla: resolve(here, 'vanilla.html'),
        react: resolve(here, 'react.html'),
        vue: resolve(here, 'vue.html'),
        element: resolve(here, 'element.html'),
      },
    },
  },
});
