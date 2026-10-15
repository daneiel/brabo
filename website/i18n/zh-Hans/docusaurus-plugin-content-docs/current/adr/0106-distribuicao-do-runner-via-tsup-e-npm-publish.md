---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0106 — 通过 `tsup` 和 `npm publish` 分发 `@brabo/runner`，版本只在 CI 中注入

- **状态：** 已接受
- **日期：** 2026-08-22
- **背景：** [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md) 的 backlog（"distribuição do runner via `tsup` → pacote único + `npm publish
  @brabo/runner`"），由 [ADR 0105](0105-personal-access-token-do-runner-escopado-por-construcao.md)（PAT——"没有剩余依赖"）解除阻塞

## 背景 {#contexto}

`apps/runner/package.json` 曾是 `"private": true`，`bin` 指向原始的 `.ts`（`./src/index.ts`）——只能通过克隆整个 monorepo、依赖开发时所用的 Node 24 原生类型剥离来访问。backlog 早已逐字点明了出路：`tsup` 产出单一的 `dist/index.cjs`，作为 `@brabo/runner` 发布。

这是本仓库**第一次**向外部 registry 发布东西——开始前通过穷尽的 grep 确认：整个代码中对 `NPM_TOKEN`、`NODE_AUTH_TOKEN`、`registry.npmjs.org` 或 `provenance` 的提及为零。

## 决策 {#decisão}

**`tsup` 把 `src/index.ts` 打包成单一的 `dist/index.cjs`**（`apps/runner/tsup.config.ts`），`format: cjs`，`target: node18`（`package.json` 的 `engines.node` 所承诺的运行时——与 `tsconfig.json` 的 `ES2023` 是不同的轴，后者只服务于开发时的 `tsc --noEmit`）。`node-pty` 是唯一的 `external`：它是**原生**绑定（在 postinstall 中通过 node-gyp 编译，与 VS Code 使用的是同一个绑定——`pnpm-workspace.yaml` 早已在 `allowBuilds` 中明确允许它），无法嵌入 JS 文件——在运行时继续 `require('node-pty')`，由安装该包者的 `node_modules` 解析。`phoenix`（纯 JS）因为不在 `external` 中而被自动嵌入，因此它从 `dependencies` 移到了 `devDependencies`——使用者不再需要单独安装它。`dist/index.cjs` 这个名字由 `format: ['cjs']` + `"type": "module"`（`package.json` 中已有）免费得到——tsup 就是这样决定扩展名的，不需要 `outExtension`。工件的 shebang（`#!/usr/bin/env node`）和执行位（755）由 tsup 自动处理，它在入口检测到 shebang 并复制到输出。

### 真正的发现：自动运行的守卫在本波要启用的情形下是坏的 {#o-achado-real-a-guarda-de-auto-run-estava-quebrada-pro-caso-que-esta-onda-existe-pra-habilitar}

`apps/runner/src/index.ts` 通过比较 `process.argv[1]?.endsWith('index.ts') || .endsWith('brabo-runner')` 来决定是否运行 `main()`——一个按**文件名后缀**的测试，打包导致的任何重命名都会让它失效。显而易见的修正（`import.meta.url === pathToFileURL(process.argv[1]).href`，ESM 中"我是入口模块吗？"的标准惯用法）在进入代码之前已用真实的 Node 进程和一个符号链接**实证测试**过——而它同样是坏的，原因与预期相反：

`process.argv[1]` **从不**被 Node 用 realpath 解析——它是操作系统用来调用的字面路径，只是被变成了绝对路径。`import.meta.url`（以及 tsup 在 cjs 构建中基于 `__filename` 为 `import.meta.url` 生成的 shim）**总是**被模块加载器用 realpath 解析。`npm install -g` 恰好造成这种不对称：在 `node_modules/.bin/brabo-runner` 中有一个符号链接，指向 `node_modules/@brabo/runner/` 内真实的 `dist/index.cjs`。通过已安装的 `bin` 运行 CLI——本波整体存在所要启用的**主要路径**——会让比较总是返回 `false`，`main()` 永远不会被调用。一个静默的 bug：任何只直接运行 `node dist/index.cjs`（不经过符号链接）的冒烟测试都抓不到它。

最终的修正在比较之前对 `process.argv[1]` 应用 `realpathSync`：

```ts
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const invocadoDiretamente =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
```

（用真实的 Node 进程）在四种情况下核实：开发（`node src/index.ts`）、直接 `node dist/index.cjs`、通过符号链接（原本坏掉的情况），以及被测试 `import` 时永不触发。在 Windows 上，npm 的 `.cmd`/`.ps1` shim 本来就以 `node <caminho real>` 调用，没有任何符号链接——`realpathSync` 在那里是空操作，没有回退。

### 版本：只在 CI 中注入，从不提交 {#versão-injetada-só-em-ci-nunca-commitada}

整个仓库的版本是计算出来的，只存在于 git tag 中（`vX.Y.Z`，Fase 6）——从不在 `package.json` 中。然而 `npm publish` **要求** `package.json` 携带正在发布的版本。出路：`npm pkg set version=<versão-da-tag>` 在发布 workflow 的**一次性** checkout 中运行，从不提交回仓库——同样的"tag 是唯一事实来源"理念，只是满足 `npm publish` 本身的一项机械要求。

### npm 的 `latest` 可能倒退——在发生之前就已缓解 {#o-latest-do-npm-pode-retroceder--mitigado-antes-de-acontecer}

本仓库已经有**六个孤儿正式 tag**（`v0.2.0`、`v0.3.0`、`v0.3.1`、`v1.0.0`、`v1.0.1`、`v1.1.0`——从未发布，记录在 `docs/reference/rulesets.md` 中），而手动重新发布的 `workflow_dispatch` 正是为修补这类漏洞而存在（与 `release.yml` 同一模式）。默认情况下，`npm publish` 会把 dist-tag `latest` 移到刚发布的版本，**不**检查 semver 顺序——在更新的版本已发布之后重新发布一个旧的孤儿 tag，会悄悄把 `latest` 往回移，`npm install -g @brabo/runner` 就会开始安装旧代码。`publish-runner.yml` 在发布之前把目标版本与 `npm view @brabo/runner version` 比较：如果 `>=` 当前的 `latest`，正常发布；否则以自己的 dist-tag（`--tag antiga-<versão>`）发布，从不触碰 `latest`。

### 独立的 workflow，而不是在 `release.yml` 中多加一步 {#workflow-próprio-não-um-passo-a-mais-em-releaseyml}

`publish-runner.yml` 由与 `release.yml` **相同**的事件（`push: tags: 'v[0-9]+.[0-9]+.[0-9]+'`）触发，但它是一个单独的文件——与 ADR 0030 为 `tag-release.yml` 已记录的纪律相同："由 tag 触发的**独立** workflow……这里没有什么需要重新连接"。发布 Docker 镜像和发布 npm 包是同一事件的两个独立产品，各有自己的失败方式；把它塞进 `release.yml` 会让 npm 的失败拖垮（或掩盖）GitHub Release，反之亦然。两者**并行**运行，没有 `needs:`——它们之间没有真实的依赖。

**不只靠 `NODE_AUTH_TOKEN`。** 只有当步骤收到 `registry-url`（和 `scope`）时，`actions/setup-node` 才会写入让 `NODE_AUTH_TOKEN` 真正生效的 `~/.npmrc`——本仓库的 workflow 从未需要过这个，所以也没有一个这样做过。没有配置 `NPM_TOKEN` 密钥时，workflow **警告**（`::warning::`）并**跳过**——从不失败——与 `tag-release.yml`/`release.yml` 中已使用的 `TEM_PAT` 模式相同（`secrets.*` 不能直接放进 `if:`）。

## 关闭 `ci.yml` 中的覆盖漏洞 {#fechamento-do-buraco-de-cobertura-em-ciyml}

`apps/runner` 从未在 `Testes TS (api + web)` job 中运行过任何测试（通过完整阅读该文件确认）——一个早已存在的漏洞，现在这段代码要分发给第三方，它变得更严重了。在那里新增四个步骤（`test`、`typecheck`、`build`、`smoke`），不重命名 job——job 的名字**就是** GitHub 中必需检查的身份（`docs/reference/rulesets.md` 明确记录了这一点），重命名它会抹掉一个从此再也不会运行的必需检查。

`apps/runner/scripts/smoke-dist.mjs` 是唯一端到端演练**打包后工件**的测试——单元测试只调用 `src/` 导出的函数，从不调用发布的 `dist/index.cjs`。它核对存在性 + 执行位，并以**两种**方式运行二进制：直接 exec（真正演练 shebang——单独的 `node dist/index.cjs` **永远**测不到这一点），以及通过显式的 `node dist/index.cjs`。一个值得记录的副作用：由于 `pty.ts` 在模块顶部导入 `node-pty`（被提升到任何参数解析之前），这个冒烟测试也证明了原生绑定在 CI 环境中能被解析和加载——它不只是打包测试，而是对原生插件的真实冒烟测试。被 `ci.yml` 复用（每个 PR，在合并**之前**捕获打包回退）以及被 `publish-runner.yml` 复用（就在发布之前，腰带加背带——绝不信任旧 PR 的构建）。

## 后果 {#consequências}

- 解锁 `npm install -g @brabo/runner` 作为真实的分发路径——关闭 ADR 0104 backlog 最后一项待办的条目。
- **运维待办，超出本 PR 的范围**：产品所有者需要在 npmjs.com 上创建/确认 `@brabo` 作用域，生成 npm Automation Token，并在仓库中配置密钥 `NPM_TOKEN`。在此之前，`publish-runner.yml` 会运行并警告，而不真正发布，也不让 workflow 失败——与 `release.yml` 中缺少 `BRABO_BOT_TOKEN` 时的模式相同。
- 交付分支是 `breaking/`——而不是 `feature/`——因为真正的发布需要运维人员先做这个操作才能端到端工作，与社交登录（ADR 0084）同一模式，也与 CLAUDE.md 中已记录的关于一个必需 OAuth 密钥（错误地）诞生在 `bugfix/` 中的教训相同。这会让整个仓库的版本提升 MAJOR（策略是全仓库的，不是按 workspace 的）——有意识接受的后果。
- `docs/business-rules.md` 中没有新的 RN——这是分发基础设施，不是产品的业务规则。`docs/gates.yml` 中没有新条目——它不是产品的决策 gate，而是 CI 机制。两者的缺席都是声明过的决定。
- `docs/reference/rulesets.md` 不变——"Checks obrigatórios"表的作用域限于由 `pull_request` 触发的 workflow 检查，而 `publish-runner.yml` 只在正式 tag 推送/`workflow_dispatch` 时触发。
- 按声明的决定不在范围内：独立二进制（`pkg`/`bun build --compile`，backlog 中的另一个条目，成本更高，没有确定的触发条件）；按 `{project_id, machine_id}` 的 runner 排他性（推迟）；由 `maintainer` 吊销其他用户的 PAT（自 ADR 0105 起不在范围内）；尽力而为的 `guard.ts`（重申的不变量，不是缺口）。
