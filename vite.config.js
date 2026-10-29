import { defineConfig } from 'vite';

export default defineConfig({
  // 用相对路径，打包后可以直接丢到任意静态目录/子路径下
  base: './',
  server: {
    port: 5180,
    open: false,
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
