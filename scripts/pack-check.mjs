/**
 * 发布前自检：把五个包各打一次「假包」，检查 tarball 里到底有什么。
 *
 *   npm run pack:check
 *
 * 这一步能抓到的都是「发出去了才发现」的问题：
 *   - README / LICENSE 没进包（npm 页面空白、法务上不完整）
 *   - dist 没重新构建，发的是上个版本
 *   - wasm 没被 files 字段带上 → 用户装上就 404
 *   - CJS/ESM 少一边，或者 types 指向不存在的文件
 */
import { execFileSync } from 'node:child_process';

const PACKAGES = ['core', 'react', 'vue', 'element', 'svelte'];

/** 目录名 → npm 包名。core 不带后缀，四个封装是 jsonlens-<框架>，统一挂在 @fagao-ai scope 下。 */
const pkgName = (dir) => (dir === 'core' ? '@fagao-ai/jsonlens' : `@fagao-ai/jsonlens-${dir}`);

/** 每个包必须有的文件 */
const REQUIRED = {
  core: ['dist/index.js', 'dist/index.cjs', 'dist/engines.js', 'dist/engines.cjs', 'dist/style.css',
    'dist/tree-sitter.wasm', 'dist/tree-sitter-json.wasm', 'index.d.ts', 'engines.d.ts'],
  react: ['dist/index.js', 'dist/index.cjs', 'dist/style.css', 'index.d.ts'],
  vue: ['dist/index.js', 'dist/index.cjs', 'dist/style.css', 'index.d.ts'],
  element: ['dist/index.js', 'dist/index.cjs', 'dist/style.css', 'index.d.ts'],
  svelte: ['dist/index.js', 'dist/index.cjs', 'dist/style.css', 'index.d.ts'],
};

let failed = 0;
const rows = [];

for (const name of PACKAGES) {
  const out = execFileSync(
    'npm',
    ['pack', '-w', pkgName(name), '--dry-run', '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const [info] = JSON.parse(out);
  const files = info.files.map((f) => f.path);
  const problems = [];

  for (const need of REQUIRED[name]) {
    if (!files.includes(need)) problems.push(`缺少 ${need}`);
  }
  if (!files.includes('README.md')) problems.push('缺少 README.md（npm 页面会是空的）');
  if (!files.includes('LICENSE')) problems.push('缺少 LICENSE');

  // types 指向的声明文件必须真的在包里
  const pkg = JSON.parse(
    execFileSync('node', ['-p', `JSON.stringify(require("./packages/${name}/package.json"))`], {
      encoding: 'utf8',
    }),
  );
  const typesFile = pkg.types?.replace('./', '');
  if (typesFile && !files.includes(typesFile)) problems.push(`types 指向的 ${typesFile} 不在包里`);

  rows.push({
    name: pkg.name,
    version: pkg.version,
    files: files.length,
    size: `${(info.size / 1024).toFixed(1)} kB`,
    problems,
  });
  if (problems.length) failed++;
}

const w = (s, n) => String(s).padEnd(n);
console.log(`\n${w('包', 22)}${w('版本', 9)}${w('文件数', 8)}${w('压缩后', 11)}状态`);
console.log('-'.repeat(64));
for (const r of rows) {
  console.log(
    `${w(r.name, 22)}${w(r.version, 9)}${w(r.files, 8)}${w(r.size, 11)}${r.problems.length ? '✗' : '✓'}`,
  );
  for (const p of r.problems) console.log(`    - ${p}`);
}
console.log(`\n${rows.length - failed}/${rows.length} 通过`);
process.exit(failed ? 1 : 0);
