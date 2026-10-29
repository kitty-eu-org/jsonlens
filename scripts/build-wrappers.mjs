/**
 * 构建四个框架封装层。
 *
 * 为什么不给每个包配一个 vite.config.js：它们全是「薄壳」，
 * 配置除了 external 列表以外一模一样，抄四份只会让以后改配置时漏掉某个包。
 *
 * 产物：packages/<name>/dist/index.js + index.cjs，框架本身和 core 都 external。
 *
 * 用法：
 *   node scripts/build-wrappers.mjs            # 全部
 *   node scripts/build-wrappers.mjs react vue  # 只构建指定的（publish 前的 prepublishOnly 用）
 */
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGES = [
  { dir: 'react', external: ['react', 'react-dom', 'react/jsx-runtime'] },
  { dir: 'vue', external: ['vue'] },
  { dir: 'element', external: [] },
  { dir: 'svelte', external: [] },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = only.length ? PACKAGES.filter((p) => only.includes(p.dir)) : PACKAGES;
if (!targets.length) {
  console.error(`没有匹配的包：${only.join(', ')}（可选：${PACKAGES.map((p) => p.dir).join(', ')}）`);
  process.exit(1);
}

for (const { dir, external } of targets) {
  const here = resolve(root, 'packages', dir);
  await build({
    root: here,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      minify: false,
      target: 'es2020',
      lib: {
        entry: resolve(here, 'src/index.js'),
        formats: ['es', 'cjs'],
        fileName: (fmt) => `index.${fmt === 'es' ? 'js' : 'cjs'}`,
        // 每个包里都会带一份 style.css（core 那份的拷贝）。看着像重复，
        // 但 Vite 的 lib 模式会把 CSS 抽成独立文件、JS 里**不留引用**，
        // 所以只能让使用者显式 `import '@jsonlens/react/style.css'`。
        // 各包自带一份，好处是版本对齐 —— 升级包时样式跟着走。
        cssFileName: 'style',
      },
      rollupOptions: {
        external: [...external, '@jsonlens/core'],
        output: { exports: 'named' },
      },
    },
  });
  console.log(`✓ @jsonlens/${dir}`);
}
