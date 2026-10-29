# 怎么发包

**是 5 个包，各自发，有先后顺序。** 不是「发 core，再补一个包」——四个框架封装各自独立发布，
因为使用者只该装自己要用的那个：用 Vue 的人不需要把 React 封装拉下来。

```
@jsonlens/core      必须最先发（另外四个依赖它）
   ├── @jsonlens/react     只依赖 core + peer react
   ├── @jsonlens/vue       只依赖 core + peer vue
   ├── @jsonlens/element   只依赖 core
   └── @jsonlens/svelte    只依赖 core
```

为什么必须分开发而不是打成一个包：如果用 `peerDependencies` 把 react/vue/svelte 都标成可选依赖塞进一个包，
安装时会有一堆「未安装 peer」警告，而且每个使用者都要下载另外三个框架的适配代码。
分包是生态惯例（Monaco 是 `monaco-editor` + `@monaco-editor/react`，CodeMirror 6 是
`@codemirror/state|view` + 各框架包），`npm i` 只会拉 core 需要的 `web-tree-sitter`。

> 如果只想发一个？那就只发 `@jsonlens/core` —— 它是零依赖的，
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

1. **scope 归属**：`@jsonlens` 是 npm 上的**组织名**，得先在 [npmjs.com/org/create](https://www.npmjs.com/org/create)
   免费建一个叫 `jsonlens` 的 org，并把自己加进去（公开包免费）。
   不想建就换成自己的用户名 scope，这时 5 个包名要一起改。
   > 已确认：`jsonlens`、`@jsonlens/*` 这些名字目前在 npm 上都还没被占用。
   > 建 org 时如果提示名字已被注册，说明 `jsonlens` 这个用户名被人占了 —— 只能换名。
2. **登录 + 开 2FA**：`npm login`，然后在 npm 账号设置里开 two-factor（发布时会要求输验证码）。
3. **确认 scope 已经是 public**：已经写进 `publishConfig.access`，所以不需要每次加 `--access public`。
4. **⚠️ registry 陷阱（本机必看）**：这台机器的 `~/.npmrc` 指向内网 Verdaccio：

   ```
   registry=http://100.64.0.1:4873/          # ← 直接 npm publish 会发到这里，公网收不到
   ```

   所以发布前先验证登录的是公网账号：

   ```bash
   npm whoami --registry=https://registry.npmjs.org
   ```

   发布时显式指定 registry（`-w` 和 `--registry` 可以同时用）：

   ```bash
   npm publish -w @jsonlens/core --registry=https://registry.npmjs.org
   ```

   也可以在本项目根目录放一个 `.npmrc` 只覆盖本项目（不影响你其它项目）：

   ```
   registry=https://registry.npmjs.org/
   ```

   认证 token 不要写进项目 `.npmrc`，`npm login --registry=https://registry.npmjs.org` 会存到 `~/.npmrc`。

---

## 1. 版本号与依赖联动

这是多包发布唯一容易出错的地方：core 升了版本，四个封装里 `"@jsonlens/core": "^0.1.0"` 的范围也要跟上，
**否则用户装到的封装会锁死在旧 core 上**（`^0.1.0` 允许 0.1.x，所以升 patch 不用改；
升到 `0.2.0` 就必须改，因为 `^0.1.0` 不覆盖 `0.2.0`）。

手动（一次小版本）：

```bash
# 升 core 到 0.1.1（同时改 package.json 和打 git tag）
npm version patch -w @jsonlens/core
# 四个封装一起升，并把对 core 的依赖改成新的范围
npm version patch -w @jsonlens/react -w @jsonlens/vue -w @jsonlens/element -w @jsonlens/svelte
npm pkg set 'dependencies.@jsonlens/core=^0.1.1' -w @jsonlens/react -w @jsonlens/vue -w @jsonlens/element -w @jsonlens/svelte
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

npm publish -w @jsonlens/core
npm publish -w @jsonlens/react
npm publish -w @jsonlens/vue
npm publish -w @jsonlens/element
npm publish -w @jsonlens/svelte
```

`-w` 会把 `prepublishOnly` 里的构建跑一遍（core 跑 `vite build`，封装跑各自的
`build-wrappers.mjs <name>`），所以**忘了 build 也不会发旧产物**——这一步是专门为此加的。

core 没发出去就发封装，会直接报 `404 Not Found - GET registry/.../@jsonlens%2fcore` —— 因为
npm 在发布时要校验 `dependencies` 里每个包是否已存在于 registry。

---

## 3. 发完自检

```bash
npm view @jsonlens/core version dist.tarball
npm view @jsonlens/core dist.unpackedSize

# 最靠谱的一步：装到临时目录，跑一遍
mkdir /tmp/fresh && cd /tmp/fresh && npm init -y
npm i @jsonlens/core @jsonlens/react react react-dom
node -e "console.log(Object.keys(require('@jsonlens/react')))"     # CJS 产物
node --input-type=module -e "import('@jsonlens/react').then(m => console.log(Object.keys(m)))"  # ESM
ls node_modules/@jsonlens/core/dist/*.wasm                          # wasm 必须在
```

`pack:check` 检查的内容（缺一个就红）：

| 检查项 | 为什么 |
| --- | --- |
| `README.md` / `LICENSE` | npm 页面会空白；MIT 要求随包分发许可证 |
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
| 用户 import 后没样式 | 必须 `import '@jsonlens/react/style.css'`（lib 模式的 CSS 抽离） |

---

## 5. 预发布与回滚

```bash
# 预发布版本：发到 next 标签，用户 npm i @jsonlens/core@next 才装到
npm publish -w @jsonlens/core --tag next        # 版本号要写成 0.2.0-beta.0 之类

# 把 latest 指回旧版本（不需要重新发布）
npm dist-tag add @jsonlens/core@0.1.0 latest
npm dist-tag ls @jsonlens/core

# 废弃某个版本（推荐，unpublish 有 72 小时限制且会破坏别人的 lockfile）
npm deprecate @jsonlens/core@0.1.1 "wasm 路径有 bug，请用 0.1.2"
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
      - run: npm publish -w @jsonlens/core
        env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
      - run: npm publish -w @jsonlens/react --provenance
        env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
      # vue / element / svelte 同理
```

（`--provenance` 会让 npm 页面上出现「Built and signed on GitHub Actions」的徽章，
需要 `id-token: write`。）

---

## 附：这几个数字值得记住

| 包 | 压缩后 | 解开后 | 主要内容 |
| --- | ---: | ---: | --- |
| `@jsonlens/core` | 126 kB | 343 kB | 205 kB 是 `tree-sitter.wasm` 运行时（压缩后约 40 kB） |
| 四个封装 | 6–8 kB | 16 kB | 薄壳 + 一份 style.css 拷贝 |
