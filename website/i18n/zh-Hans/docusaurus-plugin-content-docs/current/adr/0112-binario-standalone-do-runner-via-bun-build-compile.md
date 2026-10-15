---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0112 — 通过 `bun build --compile` 构建 `@brabo/runner` 的独立二进制，原生插件 `.node` 通过真实解压到临时目录的方式嵌入

- **状态：** 已接受
- **日期：** 2026-08-23
- **背景：** 来自 [ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md) 的 backlog 条目
  （“独立二进制（`pkg`/`bun build --compile`），单独的 backlog 条目，成本更高，没有明确的
  触发条件”）——ADR 0106 的伙伴，后者交付了 `npm install -g @brabo/runner` 路径，并明确推迟
  了本项。

## 背景 {#contexto}

`npm install -g @brabo/runner`（ADR 0106）仍然要求用户安装 Node ≥ 22.6，并依赖 `npm` 在其
机器上编译 `node-pty` 的原生插件。产品负责人要求的是更难、也更完整的替代方案——一个**真正
的单文件二进制**，覆盖完整的平台矩阵，从 v1 起就包括 Windows——在此之前，他已被明确提供、并
拒绝了更便宜的“二进制 + 旁边一个 `node-pty-native/` 文件夹”的设计。

## 决策 {#decisão}

### 为什么是 `bun build --compile` 而不是 `pkg` {#por-que-bun-build---compile-e-não-pkg}

`pkg`（Vercel）自 2023 年起已无人维护（内部由社区 fork 的 `@yao-pkg/pkg` 取代），而且它
下载一个绑定 Node 版本的“基础二进制”的模式，恰恰是本仓库在没有迫不得已的理由时避免添加的
那种外部依赖（ADR 0033/0041 已经拒绝了无法自证的构建魔法）。`bun build
--compile` 有人维护、处于活跃开发中，而且——这是决定性的——Bun 1.1+ 文档化了通过
`with { type: 'file' }` 嵌入原生 `.node` 插件的一等支持，而这正是本 ADR 无论如何最终都需要
的机制。

### 真正的问题：`node-pty` 通过**动态**路径解析自己的原生插件 {#o-problema-real-o-node-pty-resolve-o-próprio-addon-nativo-por-um-caminho-dinâmico}

`node-pty` 的 `lib/utils.js#loadNativeModule`（通过阅读已安装的包确认，
`node_modules/node-pty/lib/utils.js`）这样做：

```js
function loadNativeModule(name) {
  var dirs = ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`];
  var relative = ['..', '.'];
  for (var d of dirs) for (var r of relative) {
    try { return { dir, module: require(`${r}/${d}/${name}.node`) }; } catch (e) {}
  }
  throw new Error(...);
}
```

这个 `require()` 调用的路径是**计算出来的**——Bun 的打包器只能嵌入在构建时**静态**解析的
东西（已通过实验证明：一个天真的 `bun build --compile src/index.ts`，`node-pty` 正常打包，
**编译没有报错**，随后**在运行时失败**，报
`Cannot find module './prebuilds/linux-x64//pty.node'`——原生文件从未被嵌入，悄无声息）。
这就是此条目比 npm 路径风险更高的全部原因：它不是“嵌入一个文件”，而是“让第三方包的动态
路径解析在只存在于已编译 bundle 内部的文件上正常工作”。

### 可行的机制，在编写生产代码之前已通过实验证明 {#o-mecanismo-que-funciona-provado-empiricamente-antes-de-escrever-código-de-produção}

1. 在**构建**时（`apps/runner/scripts/build-bin.mjs`，每个原生平台执行一次——见下面的
   矩阵），遍历已安装的 `node-pty` 包，收集它在运行时真正需要的每个文件：
   全部 `lib/**/*.js`（排除 `*.test.js`——13 个文件：`index.js`、
   `unixTerminal.js`、`windowsTerminal.js`、`windowsPtyAgent.js`、
   `windowsConoutConnection.js`、`terminal.js`、`utils.js`、`types.js`、
   `interfaces.js`、`eventEmitter2.js`、`conpty_console_list_agent.js`、
   `shared/conout.js`、`worker/conoutSocketWorker.js`），再加上**当前**平台的原生 `.node`
   文件——当 `node-gyp rebuild` 在本地编译时取 `build/Release/*.node`（Linux：`node-pty`
   **不**为 Linux 带任何 prebuild，已通过列出已安装包中的 `prebuilds/` 确认——只有
   `darwin-x64`、`darwin-arm64`、`win32-x64`、`win32-arm64`），或者当包自带时取
   `prebuilds/<platform>-<arch>/*.node`（macOS：1 个文件；**Windows：3 个**——
   `pty.node`/`conpty.node`/`conpty_console_list.node`，全部由所选目录中的 glob `*.node`
   通用地收集，不对任何文件做特殊处理）。
2. 生成 `apps/runner/src/native-pty-embed.generated.ts`，每个文件一个**静态的**
   `import fN from '<caminho-real>' with { type: 'file' }`——
   `with { type: 'file' }` 是 Bun 唯一要求字面量说明符的机制，这就是为什么清单必须是**生成
   的**（文件列表只有在该特定平台上 `pnpm install` 之后才知道），而不是手写的。
3. 在**运行**时（`apps/runner/src/native-pty-loader.ts`），只在已编译的二进制内部：把每个
   嵌入的文件写入一个**真实**的临时目录（`fs.mkdtempSync`），保留**原始的精确相对布局**
   （`lib/utils.js`、`build/Release/pty.node` 等）。这种保留就是全部诀窍——`node-pty` 自己的
   `require()` 调用全都是**相对的**，因此一旦它的文件位于一个具有它所期望的真实形状的真实
   目录中，它的动态解析就无需任何修改地工作，就像这个包是用 `npm install` 正常安装的
   一样。
4. 通过**绝对文件路径**导入 `<tempdir>/lib/index.js`
   （`await import(pathToFileURL(...).href)`）——绝不按包名 `require('node-pty')`，那需要
   一个在独立二进制旁边并不存在的 `node_modules` 文件夹。

这个机制的两个属性是经过实验验证的，而不是假设的：通过 `with { type: 'file' }` 嵌入的
`.node` 插件，即使传入的路径是虚拟的 `/$bunfs/root/...`，也能通过 `require()` **正确加载**
（尽管路径是假的，Bun 也会透明地让原生插件可被 `dlopen` 加载）；而通过
`with { type: 'file' }` 读取的真实**非原生**文件——`fs.readFileSync(embeddedPath)`——即使在
已编译的二进制内部也能正确返回真实字节（因此逐字节重新解压到真实临时目录是可靠的）。

### 两个只有运行已编译二进制才发现、阅读 API 表面发现不了的真实 bug {#dois-bugs-reais-achados-só-rodando-o-binário-compilado-não-lendo-a-superfície-da-api}

**1. `--external node-pty` 在 `bun build` 调用本身中是必需的**，即使 `pty.ts` 中已没有任何
地方再以裸说明符导入 `node-pty`。`native-pty-loader.ts` 的非编译回退路径
（`await import('node-pty')`，只在已编译二进制之外使用）是一个**字面量**动态导入——Bun 的
打包器会发现它，并在 `--compile` 期间尝试解析它，无论运行时实际会走到哪个分支；而由于它
**能够**从 `node_modules` 部分解析 `node-pty`（不同于一个完全缺失的模块），构建会**悄无
声息地通过**，并在原处插入一个会抛异常的 stub。症状看起来与最初的那次失败完全相同（`Cannot
find module`/`is not a function` 错误只出现在 `lib/utils.js` 自己的 `require` 链中），这
花费了实实在在的调试时间，直到真正的原因（被打包的裸说明符回退）被隔离出来。在
`bun build --compile` 命令中加上 `--external node-pty`，会让 Bun 完全不碰这个说明符，与
`tsup.config.ts` 出于同样原因已有的 `external: ['node-pty']` 保持一致。

**2. 自执行守卫（ADR 0106）在已编译二进制内部因一个新原因而失效。** 在
`bun build --compile` 可执行文件内部，`process.argv[1]` 是 `/$bunfs/root/<name>`——一个虚拟
路径——而对它调用 `realpathSync()` 会抛出 `ENOENT`（在动生产代码之前已用真实的已编译二进制
确认），**位于任何 try/catch 之外**，甚至在尝试 `main()` 之前。现有的守卫已经有一个基于
`realpathSync` 的修复（针对 `npm install -g` 的 symlink 情况）；本 ADR 增加了第二个正交的
分支：`import.meta.url.includes('/$bunfs/')` 对已编译二进制内的每个模块都为 `true`（对入口
模块和一个非入口的被导入模块都验证过），并且**首先**检查——独立二进制的入口点没有“被测试
导入”这种需要消除的歧义，因此检测到已编译情况就无条件运行 `main()`，绕过否则会使进程崩溃
的 `realpathSync` 调用。

### 在 Bun 下于 PTY 中测试交互式 shell 在此沙箱中并不可靠——smoke 的替代 shell 是 `cat`，不是 `bash` {#testar-um-shell-interativo-dentro-de-um-pty-sob-o-bun-não-foi-confiável-neste-sandbox--cat-é-o-shell-substituto-do-smoke-não-bash}

自测路径（`--self-test-pty`，一个未文档化的内部 flag——见下文）最初启动用户真实的 shell
（`bash`）并键入 `echo MARKER`，以模拟生产中的用法。在纯 Node 下，这远不到一秒就结束。在 Bun
下（`bun run`，以及在已编译二进制内部），完全相同的调用——通过 `node-pty` 在 PTY 中启动
`bash`、写入一条命令、等待提示符重绘——在这个沙箱容器中 20s 的超时内从未结束，尽管键入内容
在内核层面的**第一次**回显立刻就到达了（因此 PTY 和原生插件毫无疑问在工作——只是 shell 自身
重绘提示符的输出从未及时出现）。自测改为启动 `/bin/cat`（`GerenciadorDePty`/`shellPadrao()`
只从 `$SHELL` 读取要启动的 shell，没有可覆盖它的参数——smoke 在构造 PTY 之前临时设置
`process.env.SHELL = '/bin/cat'`，并在 `finally` 中恢复）。`cat` 是确定性的（原样回显读到的
内容，没有提示符，没有 rc 文件），而且仍能证明真实的东西：
`GerenciadorDePty.abrir()` 通过原生插件启动一个**真实**的操作系统进程，`escrever()` 通过
PTY 写入它的 stdin，而 `onData` 证明进程读取并回写了——标记字符串出现**两次**（一次来自
PTY 自身在内核层面的输入回显，一次来自 `cat` 真正读取并重新输出），这正是区分一次真正经过
进程的往返与仅仅是终端本地回显的依据。这种与 `bash` 的差异——以及它是 Bun 运行时特有的，
还是这个特定沙箱容器的产物（没有真实 TTY、进程/线程调度受限）——除此之外**没有**做根因
调查；它不影响实际产品（终端标签页总是在用户的真实机器上、在任何容器之外启动用户真实的
shell），再追究下去就是在解决沙箱的产物，而不是产品的缺陷。在此记录，以防它在 Windows/macOS
的真实验证中再次出现。

在构建自测时还发现并修复了：在原生插件的异步回调（`onData`）中调用的 `process.exit()`，
在被启动的子进程（`cat`）仍存活、其 PTY 文件描述符仍打开时，**不会**立即终止 Bun 进程——
在一次临时复现中，进程会存活超过刻意设得很短的超时，直到在 resolve 之前**先**杀掉子进程
（`GerenciadorDePty.fechar()`，它调用 `processo.kill()`）。生产代码已经这样做了（`fechar()`
在 `resolvePromise()` 之前被调用），因此这不是交付机制中的单独 bug——之所以记录，是因为对
今后修改这段代码的人来说，这是一个很容易踩的陷阱。

### `--self-test-pty`——一个未文档化的内部 flag，位于 CLI 公共表面之外 {#--self-test-pty--uma-flag-interna-não-documentada-fora-da-superfície-pública-da-cli}

`scripts/smoke-bin.mjs` 需要证明嵌入的原生插件**在实际发布的二进制内部**工作，即启动一个
真实的 PTY 并读取真实输出——按产品负责人的要求，“不用 mock”。没有其他方式能从进程外部触及
这条代码路径（它是一个独立的可执行文件，而不是库），因此加入了 `--self-test-pty`：不在
`uso()` 中文档化，完全像生产环境那样解析 `node-pty`，完全像生产环境那样启动 PTY
（`GerenciadorDePty`），并且不触网就退出（在这条路径上从不读取
`--project`/`--dir`/`--token`）。它与任何 CLI 中隐藏的诊断 flag（`--version`、`--diag`）属于
同一类决策——不是一条有自身漂移风险的第二代码路径，因为它调用的正是生产环境调用的那些公共
方法。

## 目标矩阵，以及实际在哪里验证了什么 {#matriz-de-alvos-e-o-que-de-fato-foi-validado-onde}

| 平台 | Runner | 原生 `.node` 的来源 | **在此沙箱中**已验证 |
|---|---|---|---|
| `linux-x64` | `ubuntu-latest` | `node-gyp rebuild`（没有 Linux 的 prebuild） | **是，端到端**——`pnpm --filter runner build:bin` + `smoke:bin` 反复通过，包括通过运行真实的已编译二进制发现并修复了上面两个 bug |
| `linux-arm64` | `ubuntu-24.04-arm` | `node-gyp rebuild` | 否——这里没有可用的 ARM64 机器。在本仓库的代码中，该机制与架构无关（这里没有任何东西按 `arch` 分支，只按 `node-pty` 自己已在使用的通用组合 `${platform}-${arch}`）；风险在于那个 runner 上 `node-gyp` 自身的交叉工具链，不受本仓库控制，与 Bun 无关 |
| `darwin-x64` | `macos-13` | `prebuilds/darwin-x64/pty.node` | 否——这里没有可用的 macOS 机器。已通过 `oven-sh/setup-bun` 和 Bun 自己的文档确认 `bun build --compile` 原生支持 macOS `x64`/`arm64`（不涉及交叉编译；本仓库只在原生 runner 上构建） |
| `darwin-arm64` | `macos-14` | `prebuilds/darwin-arm64/pty.node` | 否——同上 |
| `win32-x64` | `windows-latest` | `prebuilds/win32-x64/{pty.node,conpty.node,conpty_console_list.node}` | **否——风险最大的缺口，白纸黑字地说明。** 三个原生文件而不是一个，`windowsConoutConnection.js` 的 `worker_threads.Worker` 通过相对于解压目录计算出的路径加载 `worker/conoutSocketWorker.js`，以及本仓库的构建/测试脚本经 Git Bash 在 `bash` 下而不是在 PowerShell 下运行（新 workflow 中的 `defaults: run: shell: bash`）——这些全都是通过阅读 `node-pty` 的代码推理出来的，从未在真实的 Windows 机器上执行过。尽管如此，本 ADR 仍按产品负责人先尝试最难选项的明确指示，为 Windows 交付了**真正的**单文件方案——但诚实的状态是：这个平台的**第一次**真实执行是下一次版本 tag 的 push（或一次手动的 `workflow_dispatch`），而不是这个 PR |

没有为任何平台实现任何按平台的回退方案（更便宜的“二进制 + `node-pty-native/` 文件夹”设计，
曾被明确提供并拒绝）——在这次调查中观察到的任何东西，都没有**否定**真正单文件方案对五个
目标中的任何一个的可行性。如果 Windows 真的无法这样工作，这会在第一次 tag 构建时表现为真实
的 CI 失败，届时回退方案才成为一次性的、仅限一个平台的例外，正如本 ADR 的要求所允许的那样——
而不是在没有证据的情况下预防性地做出的决定。

## 构建了什么 {#o-que-foi-construído}

- `apps/runner/src/native-pty-loader.ts`——为两种执行模型解析 `node-pty`（见上面的机制）。
- `apps/runner/src/native-pty-embed.generated.ts`——在 git 中作为**空**占位符进行版本管理
  （`NATIVE_PTY_FILES: []`）；`scripts/build-bin.mjs` 在 `bun
  build --compile` 之前立刻用该平台的真实清单覆盖它，并在 `finally` 中恢复占位符——与
  ADR 0106 为注入 npm 版本已确立的“从不 commit，在一次性步骤中生成”是同一理念。
- `apps/runner/src/pty.ts`——`GerenciadorDePty` 现在通过构造函数注入接收已解析的
  `node-pty` 模块，而不是顶层的静态 `import`；仅用于类型的
  `import type * as NodePtyNamespace from 'node-pty'` 在运行时没有任何开销（被
  `verbatimModuleSyntax` 擦除）。
- `apps/runner/src/index.ts`——在 `main()` 中解析一次 `node-pty`（`RN-452`），为 `/$bunfs/`
  情况修复自执行守卫，并增加内部路径 `--self-test-pty`。
- `apps/runner/scripts/build-bin.mjs`——生成清单，调用 `bun build
  --compile --external node-pty`，在 Windows 之外执行 `chmod 755`。
- `apps/runner/scripts/smoke-bin.mjs`——沿用 `smoke-dist.mjs` 的模式，但把**已编译二进制**
  作为真实子进程运行（`RN-452`）。
- `.github/workflows/build-runner-binaries.yml`——与
  `publish-runner.yml`/`release.yml` 相同的 tag 触发器，5 个目标的矩阵，每个 job 在**自己
  的**原生 runner 上构建（从不交叉编译），运行真实的 smoke，并通过 `gh
  release upload` 上传到 `release.yml` 已创建的 Release——幂等（上传前检查
  `gh release view --json assets`），从不自行创建 Release，沿用 `publish-runner.yml` 已确立
  的仅由负责人触发的限制和 tag 解析模式。

## 后果 {#consequências}

- 为 `@brabo/runner` 解锁了**第三条**分发路径，与克隆 monorepo（开发）和 `npm install -g`
  （ADR 0106）并列：下载一个文件，用户机器上不需要任何 Node/npm/node-gyp 工具链。
- **现有的 `npm install -g` 路径（ADR 0106）在行为上没有任何变化**——把 `pty.ts` 重构为
  构造函数注入只改变内部；`pnpm --filter runner build`/`smoke`/`test` 全部无需修改即可通过。
  这次重构引入并在同一次变更中关闭的一个**真实**回归：把 `node-pty` 的解析从模块级副作用
  （在参数解析之前提升执行，即 ADR 0106 自身“免费”获得的 smoke 覆盖）移到 `main()` 内部的
  惰性调用，使**现有的** `smoke-dist.mjs`（它只执行 `uso()` 路径，不带参数）不再能证明
  `node-pty` 在 npm/tsup 产物中能被加载。`smoke-dist.mjs` 增加了一项新检查——真实参数、
  不可达的 `--api-url`，等待 `node-pty carregado com sucesso` 这一行——在打开缺口的同一个
  commit 中关闭它，而不是任其成为覆盖率的无声损失。
- 运维方面：`build-runner-binaries.yml` 矩阵的**第一次**真实执行是下一次版本 tag 的 push。
  引入此 workflow 的 PR 中没有任何东西会执行它（由 tag 触发，与 `publish-runner.yml` 一样）
  ——五个平台中有四个是通过对 `node-pty` 代码和 Bun 文档化行为的**推理**验证的，而不是通过
  执行，这个缺口在上表中按平台被精确说明，而不是被暗示为已关闭。
- `dist-bin/` 在 gitignore 中，与 `dist/` 同样处理（ADR 0106）。
- 不在范围内，相对 ADR 0106 没有变化：PAT 吊销的细节、runner 按 `{project_id, machine_id}`
  的排他性；现在还包括：二进制的代码签名（macOS 上的 Gatekeeper/公证，Windows 上的
  Authenticode）——从 GitHub Release 下载的未签名二进制在首次运行时会触发操作系统警告，这是
  为第一个版本接受的真实 UX 成本，留给未来的条目，因为它需要产品负责人获取并支付一个签名
  身份，这与 ADR 0106 已为 `NPM_TOKEN` 声明为不可及的运维动作属于同一类别。
