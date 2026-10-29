# 怎么发包

**是 5 个包，各自发，有先后顺序。** 不是「发 core，再补一个包」——四个框架封装各自独立发布，
因为使用者只该装自己要用的那个：用 Vue 的人不需要把 React 封装拉下来。

```
jsonlens      必须最先发（另外四个依赖它）
   ├── jsonlens-react     只依赖 core + peer react
   ├── jsonlens-vue       只依赖 core + peer vue
   ├── jsonlens-element   只依赖 core
   └── jsonlens-svelte    只依赖 core
```

为什么必须分开发而不是打成一个包：如果用 `peerDependencies` 把 react/vue/svelte 都标成可选依赖塞进一个包，
安装时会有一堆「未安装 peer」警告，而且每个使用者都要下载另外三个框架的适配代码。
分包是生态惯例（Monaco 是 `monaco-editor` + `@monaco-editor/react`，CodeMirror 6 是
`@codemirror/state|view` + 各框架包），`npm i` 只会拉 core 需要的 `web-tree-sitter`。

> 如果只想发一个？那就只发 `@fagao-ai/jsonlens` —— 它是零依赖的，
> 在任何框架里都能直接 `createExplorer(el, opts)`，封装包只是省掉十几行样板。

---

## 0. 放上 GitHub（已完成，换机器时照抄）

5 个 `packages/*/package.json` 里的 `repository` / `homepage` / `bugs` 已经指向
`github.com/kitty-eu-org/jsonlens`，不再有 `your-name` 占位符。当时的步骤：

```bash
# 1) 初始化并提交。.gitignore 已排除 node_modules / 所有 dist / 27 MB bench 数据
git init -b main
git add -A && git commit -m "feat: JSONLens 初始版本"

# 2) 建公开仓库，顺便把本地 main 推上去（gh 需要 repo scope）
gh repo create kitty-eu-org/jsonlens --public --source=. --remote=origin --push

# 3) 补描述和话题 —— 决定别人在 GitHub 上搜不搜得到
gh repo edit --description "web-tree-sitter 驱动的超大 JSON 查看器，25 MB 秒开" \
  --add-topic json,json-viewer,tree-sitter,wasm,virtual-scroll,large-file
```

**推之前一定要确认体积。** 仓库里不该有 25 MB 的 `bench/public/data/big.json`：

```bash
git ls-files | xargs du -ch | tail -1    # 正常约 1.3 MB
git count-objects -vH                    # 看 size-pack
```

万一已经把大文件推上去了，**别用 `git rm` + 重新提交**——文件永远留在历史里，克隆体积一点不会变小。
只能删库重建，或者用 [`git filter-repo`](https://github.com/newren/git-filter-repo) 洗历史。

> 换账号 / 换组织：改 5 个 `packages/*/package.json` + 根 `package.json` 里的
> `kitty-eu-org`，再 `git remote set-url origin <新地址>`。

---

## 0.5 npm 侧一次性准备

1. **包名已经定了，不用再纠结。** 5 个包挂在账号 `@fagao-ai` 的 scope 下：

   | 目录 | npm 包名 | 安装命令 |
   | --- | --- | --- |
   | `packages/core` | `@fagao-ai/jsonlens` | `npm i @fagao-ai/jsonlens` |
   | `packages/react` | `@fagao-ai/jsonlens-react` | `npm i @fagao-ai/jsonlens-react` |
   | `packages/vue` | `@fagao-ai/jsonlens-vue` | `npm i @fagao-ai/jsonlens-vue` |
   | `packages/svelte` | `@fagao-ai/jsonlens-svelte` | `npm i @fagao-ai/jsonlens-svelte` |
   | `packages/element` | `@fagao-ai/jsonlens-element` | `npm i @fagao-ai/jsonlens-element` |

   > 用这个 scope 是因为另外两条路都被 npm 掐死了，按尝试顺序记录（不要重复尝试）：
   >
   > | 尝试过的方案 | 结果 |
   > | --- | --- |
   > | `@jsonlens/core` 等 scoped 名 | ❌ 建 org 时报 `The organization name 'jsonlens' is not available`。npm 上有个叫 `jsonlens` 的**用户名**（0 个包，纯占位），scope 名和用户名共用一套命名空间 |
   > | `jsonlens` / `jsonlens-react` 等无 scope 扁平名 | ❌ 发 `jsonlens` 时报 403：`Package name too similar to existing package json-lens`。npm 的反抢注检查把 `jsonlens` 判定为与已有的 `json-lens`（0.0.1，JSON Pointer 库）过于相似 |
   > | `@fagao-ai/jsonlens*` | ✅ scope 属于账号本身，且带 scope 的包不受重名相似性检查限制 |
   >
   > **查「这个名字能不能用」，光看 registry 返回 404 是不够的。** 404 只说明没有同名包，
   > 还有两种挡法：(a) 同名 npm 用户名会让同名 org 建不出来；(b) 与已有包过于相似会在 publish 时被 403。
   > 用户名要用 `https://www.npmjs.com/~<name>` 查 —— curl 会被 Cloudflare 挡（403），得在浏览器里看。
   >
   > 目录名 → 包名的映射只有两处代码关心：`scripts/pack-check.mjs` 的 `pkgName()`，
   > 以及 `packages/*/package.json` 的 `name` 字段。换名时改这两处即可。

2. **登录用浏览器授权的方式**（本机已登录，换机器时这样重来）：

   ```bash
   npm login --auth-type=web        # 会打印一个 npmjs.com/login 链接
   ```

   浏览器打开那个链接，用**安全密钥 / 指纹**确认（这个账号开了 2FA）。token 由 npm 自己写进
   `~/.npmrc`，不需要手工复制。

   注意这个账号保护得比较严：**每次 `npm publish` 都会重新挑战一次 2FA**。授权页面上有个
   「Do not challenge npm publish from this IP for the next 5 minutes」勾选框，
   一次连发多个包时务必勾上，否则每个包都要按一次指纹。

   > npm 正在收紧「绕过 2FA 的 token」：2026 年 8 月起限制账号变更，2027 年 1 月起限制直接发布。
   > 所以别图省事去建 automation token，那条路以后会被关掉。
3. **⚠️ registry 陷阱（本机必看）**：这台机器的 `~/.npmrc` 指向内网 Verdaccio：

   ```
   registry=http://100.64.0.1:4873/          # ← 直接 npm publish 会发到这里，公网收不到
   ```

   项目根目录的 `.npmrc` 已经写了 `registry=https://registry.npmjs.org/`，**只影响本项目**，
   在里面执行 `npm config get registry` 应该看到公网地址。发布前再确认一次登录状态：

   ```bash
   npm whoami                       # 在项目目录里跑，走 .npmrc 的公网源
   npm whoami --registry=https://registry.npmjs.org   # 或者显式指定
   ```

   认证 token 不要写进项目 `.npmrc`，`npm login` 会存到 `~/.npmrc`。

---

## 1. 版本号与依赖联动

这是多包发布唯一容易出错的地方：core 升了版本，四个封装里 `"@fagao-ai/jsonlens": "^0.1.0"` 的范围也要跟上，
**否则用户装到的封装会锁死在旧 core 上**（`^0.1.0` 允许 0.1.x，所以升 patch 不用改；
升到 `0.2.0` 就必须改，因为 `^0.1.0` 不覆盖 `0.2.0`）。

手动（一次小版本）：

```bash
# 升 core 到 0.1.1（同时改 package.json 和打 git tag）
npm version patch -w @fagao-ai/jsonlens
# 四个封装一起升，并把对 core 的依赖改成新的范围
npm version patch -w @fagao-ai/jsonlens-react -w @fagao-ai/jsonlens-vue -w @fagao-ai/jsonlens-element -w @fagao-ai/jsonlens-svelte
npm pkg set 'dependencies.jsonlens=^0.1.1' -w @fagao-ai/jsonlens-react -w @fagao-ai/jsonlens-vue -w @fagao-ai/jsonlens-element -w @fagao-ai/jsonlens-svelte
```

推荐用 [changesets](https://github.com/changesets/changesets)（发了两次以上就会想要它）：
它会根据改动自动算版本、生成 CHANGELOG、**按依赖顺序**发布，还能一次性提交所有包。

```bash
npx changeset            # 交互式选包 + 选 major/minor/patch
npx changeset version    # 改版本号、联动依赖范围
npx changeset publish    # 按顺序发，已发过的跳过
```

---

## 2. 发布（顺序不能反）

```bash
npm run build            # core + 四个封装，产物进各自的 dist/
npm run pack:check       # 5 个 tarball 自检：README / LICENSE / dist / wasm / types

npm publish -w @fagao-ai/jsonlens
npm publish -w @fagao-ai/jsonlens-react
npm publish -w @fagao-ai/jsonlens-vue
npm publish -w @fagao-ai/jsonlens-element
npm publish -w @fagao-ai/jsonlens-svelte
```

`-w` 会把 `prepublishOnly` 里的构建跑一遍（core 跑 `vite build`，封装跑各自的
`build-wrappers.mjs <name>`），所以**忘了 build 也不会发旧产物**——这一步是专门为此加的。

core 没发出去就发封装，会直接报 `404 Not Found - GET registry/.../jsonlens` —— 因为
npm 在发布时要校验 `dependencies` 里每个包是否已存在于 registry。

---

## 3. 发完自检

```bash
npm view @fagao-ai/jsonlens version dist.tarball
npm view @fagao-ai/jsonlens dist.unpackedSize

# 最靠谱的一步：装到临时目录，跑一遍
mkdir /tmp/fresh && cd /tmp/fresh && npm init -y
npm i @fagao-ai/jsonlens @fagao-ai/jsonlens-react react react-dom
node -e "console.log(Object.keys(require('@fagao-ai/jsonlens-react')))"     # CJS 产物
node --input-type=module -e "import('@fagao-ai/jsonlens-react').then(m => console.log(Object.keys(m)))"  # ESM
ls node_modules/jsonlens/dist/*.wasm                          # wasm 必须在
```

`pack:check` 检查的内容（缺一个就红）：

| 检查项 | 为什么 |
| --- | --- |
| `README.md` / `LICENSE` | npm 页面会空白；Apache 2.0 第 4 条要求随包分发许可证副本 |
| `dist/index.js` + `index.cjs` | 双产物，ESM / CJS 各一份 |
| `dist/*.wasm`（core） | 不带上就是「装上即 404」 |
| `index.d.ts` | `types` 字段指向的文件必须真的在包里 |
| `dist/style.css` | lib 模式把 CSS 抽走了，用户要显式 import |

---

## 4. 常见报错对照

| 报错 | 原因 / 处理 |
| --- | --- |
| `E402 Payment Required` | scope 包默认私有，需要 public。已用 `publishConfig.access` 解决 |
| `E403 Forbidden` | 包名被占 / 不属于你 / 2FA 没通过。先 `npm view` 看这个包存不存在 |
| `EPUBLISHCONFLICT` | 该版本已存在，**不能覆盖**，只能升版本重发 |
| `404` 且发生在发布时 | 依赖的包还没发（core 没先发） |
| 装下来 404 / wasm 加载失败 | `files` 字段漏了 wasm，或用户没显式传 `wasmUrl`（见 README 第 2 节） |
| 用户 import 后没样式 | 必须 `import '@fagao-ai/jsonlens-react/style.css'`（lib 模式的 CSS 抽离） |

---

## 5. 预发布与回滚

```bash
# 预发布版本：发到 next 标签，用户 npm i @fagao-ai/jsonlens@next 才装到
npm publish -w @fagao-ai/jsonlens --tag next        # 版本号要写成 0.2.0-beta.0 之类

# 把 latest 指回旧版本（不需要重新发布）
npm dist-tag add jsonlens@0.1.0 latest
npm dist-tag ls jsonlens

# 废弃某个版本（推荐，unpublish 有 72 小时限制且会破坏别人的 lockfile）
npm deprecate jsonlens@0.1.1 "wasm 路径有 bug，请用 0.1.2"
```

---

## 6. 用 CI 自动发

不想每次手敲五条命令，就上 GitHub Actions（`NPM_TOKEN` 用 **automation token**，
在 npm 里建 Automation 类型的 token，才能绕过 2FA）：

```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, registry-url: 'https://registry.npmjs.org' }
      - run: npm ci
      - run: npm run build && npm run typecheck && npm run smoke
      - run: npm publish -w @fagao-ai/jsonlens
        env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
      - run: npm publish -w @fagao-ai/jsonlens-react --provenance
        env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
      # vue / element / svelte 同理
```

（`--provenance` 会让 npm 页面上出现「Built and signed on GitHub Actions」的徽章，
需要 `id-token: write`。）

---

## 附：这几个数字值得记住

| 包 | 压缩后 | 解开后 | 主要内容 |
| --- | ---: | ---: | --- |
| `@fagao-ai/jsonlens` | 126 kB | 343 kB | 205 kB 是 `tree-sitter.wasm` 运行时（压缩后约 40 kB） |
| 四个封装 | 6–8 kB | 16 kB | 薄壳 + 一份 style.css 拷贝 |
