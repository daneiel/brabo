---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-runner
title: 'Regras de negócio — Runner'
sidebar_label: Runner
description: 'As RNs hospedadas na raiz runner.'
keywords: [regras de negócio, runner]
---

# Runner

## ADR 0104 第 1 波——`execution_mode` 三个值，工作区由 runner 验证

### RN-423 — runner **确认**路径；没有确认，命令被拒绝——永远不落入容器 {#rn-423}

runner 是 `runner` 项目路径的**事实来源**，而不是向导中输入的内容。Phoenix 频道一连接上
（`terminal:<projectId>`，角色 `:runner`），`apps/runner/src/index.ts`
就推送带有它从命令行收到的 `--dir` 的 `workspace_confirm`。engine 把它转发（`Engine.Sessions.EngineApiClient.confirm_workspace/4`）到 `POST /internal/projects/:projectId/workspace-verification`
（`ConfirmProjectWorkspaceUseCase`），后者：

1. 如果项目不在 `runner` 模式，以 `400` 拒绝；
2. 用与创建时**相同**的词法谓词重新校验路径
   （[RN-422](api.md#rn-422)）——即使来自 runner，系统根目录和与 Brabo 的重叠仍然被禁止；
3. 用规范化后的路径**覆盖** `workspacePath`，并写入
   `workspaceVerifiedAt = now()`——不要求与创建时输入的内容相同：runner 说了算；
4. 是**幂等**的——重新连接时报告**相同**路径不会重写任何东西
   （`changed: false`）；**不同**的路径会重写，因为每次重连时 runner 仍然是事实来源；
5. 项目中还没有会话时（`ProjectSession.latest_id/1` 返回
   `nil`）：`UPDATE` 照样发生，只是事件
   `project.workspace_verified`（以及 `workspace-verificado` gate 的证据）缺失——与
   `pty_open`/`pty_close` 已经接受的降级**相同**（RN-108/RN-420）。被接受并声明的缺口，不是静默的。

`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` 有**四个**出口，而不是两个：`runner` 且 `workspace_verified_at: nil` 拒绝
（`:recusar_nao_verificado`）；`runner` 已验证但没有已连接的 runner 拒绝（`:recusar_runner_desconectado`）；`runner` 已验证且已连接则路由（`:rotear_runner`）；任何其他模式走一贯的路径
（`:caminho_de_sempre`）。两种拒绝**永远不会**落入 `System.cmd`——`runner` 项目没有 bind-mount，“落回一贯的路径”就是在一个 engine 进程看不到的文件夹里盲目执行。同样的拒绝也适用于竞态（`run/3` 开始时 `Registry` 说已连接，但 runner 在分派回应之前掉线了）。

- **位置：** `apps/api/src/application/use-cases/iam/confirm-project-workspace.use-case.ts`、
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
  （`POST :projectId/workspace-verification`）、
  `apps/engine/lib/engine/actions/terminal_executor.ex`
  （`decisao_de_execucao/1`）、`apps/engine/lib/engine_web/channels/terminal_channel.ex`
  （`handle_in("workspace_confirm", ...)`）、`apps/engine/lib/engine/sessions/engine_api_client.ex`
  （`confirm_workspace/4`）、`apps/runner/src/channel.ts`
  （`enviarWorkspaceConfirm`）、`apps/runner/src/index.ts`
- **测试：** `apps/api/test/application/use-cases/iam/confirm-project-workspace.use-case.spec.ts`、
  `apps/engine/test/engine/actions/terminal_executor_test.exs`
  （describe "roteamento pro runner local"）、
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  （describe "workspace_confirm"）、`apps/runner/src/channel.spec.ts`
  （join 之后的 `enviarWorkspaceConfirm`）
- **边界情况：** `docs/gates.yml` 把 `workspace-verificado` 记录为
  `severidade: warn`——真正阻断的是 engine 的显式拒绝，gate 只是记录/证据。
- **架构决策：**
  [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
- **来源：** ADR 0104 的调和，经与产品负责人确认的决定（runner 是事实来源；没有会话时 UPDATE 照样发生；没有验证/连接时命令被明确拒绝）

---

### RN-429 — 本地文件夹浏览是经由 Runner 的纯中继，从不是 api 枚举容器 {#rn-429}

`terminal:<projectId>` 频道获得两个事件，采用与 PTY **相同**的中继设计：`fs_list_dir`/`fs_home_dir`（`:web` 请求，engine **直接**中继给已注册 runner 的 pid，没有已连接 runner 时立即报错——从不等待一个不会来的响应）和
`fs_list_dir_reply`/`fs_home_dir_reply`（`:runner` 响应，广播仅过滤给 `:web`，按客户端生成的 `ref` 关联）。api **不**获得任何新路由——它仍然不枚举文件系统，ADR 0072 早已确立的反对文件夹选择器的论点仍然成立。`apps/runner/src/guard.ts`（把已批准命令的 `cwd` 限制在项目根目录内）有意**不**适用于浏览——列出目录是在用户机器上以他已有的权限自由读取，无权限的条目会被跳过，而不是中止整个列表。

声明的缺口：频道的 ticket 是**按已存在的项目**签发的——在项目创建屏幕（`NewProjectWizard.tsx`）中，项目只在确认时才诞生，因此 `FolderBrowserModal` 在那里收到 `projectId: null`，并显示已声明的状态，而不是尝试一个不可能的连接；自由文本字段仍然是手动路径，与以前一样。

- **位置：** `apps/engine/lib/engine_web/channels/terminal_channel.ex`；
  `apps/runner/src/fs-browser.ts`、`apps/runner/src/channel.ts`、
  `apps/runner/src/index.ts`；`apps/web/src/lib/fs-browser-channel.ts`、
  `apps/web/src/components/FolderBrowserModal.tsx`、
  `apps/web/src/components/RunnerOnboardingPanel.tsx`、
  `apps/web/src/routes/NewProjectWizard.tsx`、
  `apps/web/src/routes/code/TerminalPanel.tsx`
- **测试：** `terminal_channel_test.exs`（web↔runner 纯中继、没有 runner 时立即报错、错误角色被忽略）；`fs-browser.spec.ts`
  （排序、空/不存在的文件夹/文件、按条目的权限）；
  `FolderBrowserModal.test.tsx`（projectId 为空、导航、选择、没有 runner）；`NewProjectWizard.test.tsx`（“Procurar pasta...”按钮）
- **ADR：** [0107](../adr/0107-navegacao-de-pasta-local-via-o-runner.md)，修订
  [0072](../adr/0072-projeto-local-ou-container.md) 而不编辑它
- **来源：** 产品负责人的请求——“não consegui linkar com uma
  pasta do usuário”

---

## 本地 runner 的终端永远卡在“Abrindo terminal...”（RN-433）

### RN-434 — 在 Linux 上，本地 runner 的 `--dir` 只在用户的 `$HOME` 之内才被接受 {#rn-434}

CLI `brabo-runner`（`runner` 模式，ADR 0103/0104）只校验
`--dir` 存在且是文件夹——对该文件夹可以位于文件系统中的**何处**没有任何限制。`lerArgumentos()`
（`apps/runner/src/index.ts`）在存在性检查之后立即调用
`validarDirDentroDoHomeNoLinux(dir, process.platform, homedir())`
（`apps/runner/src/guard.ts`）：在 Linux 上（`process.platform === 'linux'`），`--dir` 只在
`os.homedir()` 之内才被接受——`$HOME` 本身或它的任何子文件夹；这棵树之外的路径（`/etc`、`/root`、`/`，甚至 `/home` 中的另一个账户）以 `process.exit(2)` 被拒绝，消息说明原因并显示期望的 home。在 Linux 之外（macOS、Windows）行为不变——限制只针对 Linux。

该检查复用 `dentroDoEscopo`/`semBarraFinal`，即同一模块中 `validarCwdDentroDaRaiz` 已在使用的路径比较原语，但有意比它更简单：没有 `realpath`，也不防护 TOCTOU/符号链接，因为它不防御**恶意**服务器（那是 `validarCwdDentroDaRaiz` 的角色，在每次
`exec` 时执行）——它是本地 CLI 自身的**启动**检查，引导在启动 runner 时输错路径的用户。

- **位置：** `apps/runner/src/guard.ts`
  （`DirForaDoHomeError`/`validarDirDentroDoHomeNoLinux`）、
  `apps/runner/src/index.ts`（`lerArgumentos`）
- **测试：** `apps/runner/src/guard.spec.ts`
  （`describe('validarDirDentroDoHomeNoLinux', …)`——在 Linux 上接受 home 本身及其子文件夹，在 Linux 上拒绝 home 之外的路径和 `/home` 内的另一个账户，并确认该限制在 Linux 之外**不**适用）
- **ADR：** [0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  （附加扩展——runner 早已被声明为“路径的事实来源”；这条规则只是收窄了它在 Linux 上接受为 `--dir` 的东西）
- **来源：** 产品负责人在一次真实的项目创建测试中的明确请求（尝试把 `--dir` 指向 home 之外的路径 `/home/dev/exp001`，而该路径在机器上不存在——由此决定在 Linux 上锁定 `$HOME` 之外的路径）

---

### RN-435 — 本地 runner 不存在的 `--dir` 会被创建，而不是被拒绝 {#rn-435}

CLI `brabo-runner`（`runner` 模式，ADR 0103/0104）过去会以
`process.exit(2)` 拒绝任何尚不存在于磁盘上的 `--dir`——必须在启动 CLI 之前手动创建项目文件夹。`garantirDiretorio()`（`apps/runner/src/guard.ts`）改为在文件夹不存在时自动创建它（`mkdirSync(dir, { recursive: true })`），`lerArgumentos()`（`apps/runner/src/index.ts`）在 `validarDirDentroDoHomeNoLinux`（RN-434）**之后立即**调用这个函数——**顺序**就是规则：`$HOME` 检查对尚不存在的路径也有效（只有 `resolve()`，不触碰磁盘），因此它先运行，并在任何创建尝试**之前**继续拒绝 Linux 上 home 之外的 `--dir`，即使它尚不存在——先创建会重新打开 RN-434 刚刚关闭的漏洞。指向一个已存在**文件**的 `--dir` 仍然是真正的错误（`DirNaoEUmaPastaError`、`process.exit(2)`，不尝试创建任何东西）——这个 CLI 从不悄悄覆盖文件。创建本身失败（权限被拒、磁盘已满等）也会拒绝（`NaoConsegiuCriarDiretorioError`），并嵌入原始错误的消息。

- **位置：** `apps/runner/src/guard.ts`
  （`garantirDiretorio`/`DirNaoEUmaPastaError`/`NaoConsegiuCriarDiretorioError`）、
  `apps/runner/src/index.ts`（`lerArgumentos`）
- **测试：** `apps/runner/src/guard.spec.ts`
  （`describe('garantirDiretorio', …)`——文件夹已存在时什么都不做，不存在时递归创建，路径已存在且是文件时不创建而拒绝，并把 `mkdir` 的失败包装为
  `NaoConsegiuCriarDiretorioError`；以及在
  `describe('validarDirDentroDoHomeNoLinux', …)` 中多加一个用例，证明 home 之外且**尚不存在**的 `--dir` 仍被拒绝，确认两项检查的顺序不会打开漏洞）
- **ADR：** [0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  （附加扩展——不改变 runner 作为路径事实来源的设计，只降低启动新项目的摩擦）
- **来源：** 产品负责人的请求，他注意到 `runner` 模式下一个新项目的文件夹在机器上不存在，需要在运行 CLI 之前手动创建——与促成 RN-434 的场景相同（不存在的 `/home/dev/exp001`），现在通过创建文件夹而不只是拒绝来解决

---

## Runner 的文件夹浏览器变成三列，`runner` 项目的创建不再等待最后一步（RN-436/436）

### RN-452 — `node-pty` 通过注入解析，而不是静态导入——由此在 npm 冒烟测试中打开的缺口在同一个 commit 中关闭 {#rn-452}

`pty.ts` 不再在模块顶部静态地 `import * as nodePty from 'node-pty'`——改为在 `GerenciadorDePty` 的构造函数中通过注入接收已解析的模块，在 `main()`（`src/index.ts`）中经由 `native-pty-loader.ts#carregarNodePty()` 解析一次。这一变化是为独立二进制（ADR 0112）而存在的：编译后的路径需要在解析
`node-pty` **之前**把嵌入的文件解压到一个真实目录，这需要一次异步调用——与被提升的静态 `import` 不兼容。在编译后的二进制之外，行为与之前完全相同（`await import('node-pty')`，从安装该包的人的 `node_modules` 解析）。

**这一变化打开的缺口，在**同一个** commit 中关闭**：ADR 0106 早已记录，`node-pty` 的静态 `import` 因为在任何参数解析之前被提升，使得 `smoke-dist.mjs` 仅通过**导入** `dist/index.cjs` 就证明了原生绑定能加载——即使在 `uso()` 路径（零参数）上，它从未到达 `main()`。把解析移进 `main()` 悄悄破坏了这种保证，因为 `smoke-dist.mjs` 只走 `uso()` 路径。`smoke-dist.mjs` 增加了第三项检查——用有效参数运行 CLI（但另一端没有真实的 api/engine），在杀掉进程之前等待 stdout 中出现 `node-pty carregado com
sucesso` 这一行——关闭了这一变化本身打开的缺口，而不是让它成为静默的覆盖率损失。

- **位置：** `apps/runner/src/pty.ts`（`GerenciadorDePty`，注入
  `NodePtyModule`）；`apps/runner/src/native-pty-loader.ts`
  （`carregarNodePty`）；`apps/runner/src/index.ts`（`main`，解析一次）；
  `apps/runner/scripts/smoke-dist.mjs`（第三项检查，
  `verificarNodePtyCarrega`）
- **测试：** `apps/runner/scripts/smoke-dist.mjs`（npm/tsup 路径）和
  `apps/runner/scripts/smoke-bin.mjs`（二进制路径，RN-451）——仅有的两个真正运行打包制品的地方，没有单元测试可以替代
- **ADR：** [0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)
- **来源：** 独立二进制的技术需要；npm 冒烟测试中的缺口是通过对这次变更的自我审计发现的，而不是通过报告失败的真实运行

## 通过浏览器配置 runner（RN-464..466，ADR 0118）

### RN-466 — 当文件夹中有浏览器写入的本地配置时，`brabo-runner` 无需 `--project`/`--dir`/`--token` 即可运行 {#rn-466}

> **由 [RN-687](web.md#rn-687)（[ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md)，10月1日）修订：**
> 浏览器不再写入这些文件——该流程已退役。**读取**完整保留：在 ADR 0203 之前配置的文件夹继续工作，而机器 unit 也正是通过指向
> `$XDG_CONFIG_HOME/brabo/` 的 `--dir` 找到在终端中创建的密钥（RN-551）。

`apps/runner/src/device-key.ts`（**新**模块，有意与 `auth.ts` 分开）从当前 `cwd()` 读取——从不写入——`brabo-runner.config.json`
（`{projectId, apiUrl}`）和 `brabo-runner-device-key.jwk.json`；两者任一缺失都返回 `null`，从不抛出，因为对于仍在使用显式标志的人来说，这种缺失是**正常**情况。在 `lerArgumentos`（`apps/runner/src/index.ts`）中，规则重复三次且**相同**——显式标志总是胜过本地文件：`--project` 胜过
`configLocal.projectId`；有本地配置时，缺少 `--dir` 会落到 `.`（命令运行所在的文件夹本身），而不是以前的用法错误；两者都存在时，`--token`/`BRABO_ACCOUNT_TOKEN` 胜过本地设备密钥。**没有任何**凭据（既没有令牌也没有本地密钥）时，CLI 继续以用法消息拒绝——这里没有任何东西使认证变为可选，只是决定使用两种形式中的哪一种。

- **位置：** `apps/runner/src/device-key.ts`（`lerConfigLocal`、
  `lerChaveDeDispositivo`）、`apps/runner/src/index.ts:95-206`
  （`lerArgumentos`）
- **测试：** `apps/runner/src/device-key.spec.ts`（每种读取的正常路径；文件缺失/JSON 无效/缺字段时返回 `null` 而不抛出；遵守收到的 `cwd`；模块不导入
  `writeFileSync`/`mkdirSync`）
- **ADR：** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
- **来源：** 产品负责人的请求

## 对话型智能体的决策制品（RN-505）

### RN-507 — Docker 成为 `runner` 模式的真正前提：**三种**执行模式要求**相同**的谓词 {#rn-507}

在此之前，`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` 为把终端路由到 `execution_mode: runner` 项目只检查**两个**前提——工作区**已确认**和 runner 此刻**已连接**——两者一满足就无条件路由，不检查是否有**记录**为 `running` 的容器（`Engine.Containers.ProjectContainerLifecycle.running?/1`），而 `container`/`mounted` 自 RN-502（ADR 0143）起就已要求这个谓词。另一边的 runner 自行决定命令是在它启动的容器内运行（ADR 0137）还是落到纯**宿主机**——而当用户机器上没有运行 Docker 时，它总是悄悄落到宿主机：ADR 0134 试图为 `container` 建立的隔离从未对 `runner` 生效。

**修正把三种模式统一在**同一个**问题之下。** `runner` 获得**第三个**前提，与另外两个按同样的顺序：已验证 → 已连接 → 容器 `running`。三种具名拒绝（工作区未验证、runner 未连接、没有容器）如今位于
`Engine.Runners.RunnerReadiness`——之所以提取出来，是因为在同一个 PR 中诞生了**第二个**消费者（`Engine.Actions.Workspace.RunnerGit`，见下文）：“这不是两个推导，而是这个函数有两个消费者”，与 `ProjectContainerLifecycle` 的 moduledoc 相同的推理。

**dev agent 工作树的物化改变的是机制，而不是结果。** `Engine.Actions.Workspace.ensure!/4` 即使在 `runner` 模式下，也尝试针对**宿主机**路径执行本地的 `File.mkdir_p!`/
`System.cmd("git", ...)`——这是 RN-478 记录并有意保持**开放**的缺口（“o
working tree do dev agent não tem onde nascer”，因为 engine 进程对一个位于用户机器上的文件夹没有任何 bind-mount）。修正不是再次“改进错误消息”：`ensure!/4` 改为按 `execution_mode` 分叉——对 `container`/`mounted` 走**本地**（不变：自 ADR 0141 起，`mounted` 已通过 `BRABO_PROJECTS_BASE` 看到自己的文件夹，在 engine 中按身份 bind-mount），对 `runner` 经由 `Engine.Actions.Workspace.
RunnerGit`。`RunnerGit` 把 `git init`/`remote add`/`fetch`/
`checkout`（以及 `Engine.Dev.WorktreeManager` 需要的 `File.dir?`/`ls`/`rm_rf` 等价操作）作为**普通**的 shell 命令执行，经由早已执行已批准终端命令的**同一个** Phoenix 频道（`Engine.Runners.RunnerRouter.exec/5`）投递——从不是新机制，并且总是在 `RunnerReadiness.verificar/1` 确认三个前提**之后**（在尝试任何 I/O 之前就以具名消息抛出，从不盲目 `exec`）。`Engine.Dev.WorktreeManager`（`create/3`、`remove/2`、`list/1`、
`cleanup_orphans/2`）按同一标准分叉。

**周期性清理任务**静默跳过**，从不失败。**
`Engine.Dev.WorktreeCleanup.run/0` 过去扫描 `File.dir?(work_dir)` 来决定是否修剪——对 `runner` 总是 `false`（路径属于**宿主机**，engine 看不到它），所以 `runner` 从未被真正修剪，也从未通过这条路径被测试。门槛改为按**模式**：`container`/`mounted` 继续用 `File.dir?`；对 `runner`，由 `RunnerReadiness.pronto?/1` 决定——此刻没有已连接的 runner 或没有 `running` 容器时，该项目在**本轮**被跳过（`"não dá pra
saber agora"`，从不是错误，也从不把工作树误当作孤立的），`Enum.each/2` 继续处理后续项目，没有任何异常穿出。

**`exec`/`exec_result` 协议获得一个**新**字段：`env`（ADR 0056）。** `RunnerGit` 的带认证 `git fetch` 需要提供方的凭据——它只能在子进程的**环境**中传递（从不在 argv 中，从不在 `.git/config` 中，与本地 `Engine.Actions.GitAuth` 相同的纪律）。由于子进程现在诞生在用户的机器上，`env` 字段（可选，`Record<string,string>`）进入 `RunnerRouter.exec/5` 分派的 payload——只在确实有凭据时出现（`local` 提供方从不携带它）。在 runner 一侧：`apps/runner/src/exec.ts` 在 `spawn` 之前把 `opts.env` **合并**（从不替换）到 `process.env` 之上——定义 `env` 而不合并会丢掉 PATH，破坏 `git`/`sh` 二进制本身的解析。`apps/runner/src/index.ts` 只为**宿主机**路径（`executarComando`）传递 `msg.env`——容器（`docker exec`，经由 `packages/docker-port`）没有获得 `env` 支持（不在本次交付范围内：端口的 `exec` 操作有意继续不带这个字段，ADR 0130）。runner 的任何日志在任何地方都不打印 `env`——经 grep 审计，`console.log`/`console.warn`/`console.error` 仍只引用
`ref`/`command`/`cwd`/`exitCode`。

- **位置：** `apps/engine/lib/engine/actions/terminal_executor.ex`
  （`decisao_de_execucao/1`）；`apps/engine/lib/engine/runners/
  runner_readiness.ex`（新）；`apps/engine/lib/engine/actions/workspace.ex`
  （`ensure!/4`）；`apps/engine/lib/engine/actions/workspace/runner_git.ex`
  （新）；`apps/engine/lib/engine/dev/worktree_manager.ex`；
  `apps/engine/lib/engine/dev/worktree_cleanup.ex`；
  `apps/engine/lib/engine/projects/project.ex`（`all_workspace_dirs/0` 获得
  `execution_mode`）；`apps/engine/lib/engine/runners/runner_router.ex`
  （`exec/5`）；`apps/engine/lib/engine_web/channels/terminal_channel.ex`；
  `apps/runner/src/channel.ts`（`ExecMessage.env`）；`apps/runner/src/exec.ts`；
  `apps/runner/src/index.ts`
- **测试：** `apps/engine/test/engine/actions/terminal_executor_test.exs`、
  `apps/engine/test/engine/actions/workspace_runner_test.exs`、
  `apps/engine/test/engine/dev/worktree_manager_test.exs`、
  `apps/engine/test/engine/dev/worktree_cleanup_test.exs`、
  `apps/runner/src/channel.spec.ts`
- **ADR：** [0145](../adr/0145-docker-pre-requisito-do-runner.md)
- **来源：** 产品负责人的决定——Docker 成为 `runner` 模式的真正前提，不回退到宿主机

## 镜像把工作复制到用户的文件夹（RN-516）

### RN-516 — 镜像目标随 join 的「授予」传递，镜像只按单一方向复制 git 的列表且绝不删除，触发点是一个具名时刻——绝不是 watcher {#rn-516}

FASE 28 第 6 次会话的 B 半部：`espelho` 能力（[RN-514](engine.md#rn-514)，[ADR 0147](../adr/0147-agente-local-com-capacidades.md)）开始「存在」。[RN-515](api.md#rn-515) 决定了**目标放在哪里**，没有复制任何文件；本规则决定**它如何到达本地代理、复制什么以及何时复制**。

**目标随 `join` 的授予传递，绝不在 runner 的配置中。** 对 `:runner` 角色而言，频道 `terminal:<projectId>` 的 `join` 回应不再为空：当项目声明了目标（`projects.mirror_path`）**并且**授予了 `espelho` 能力时，它携带 `%{espelho: %{destino: "<caminho>"}}`。runner 将其保存在 `estado.destinoDoEspelho` 中，随连接一同消亡，并且**对那条连接中未授予它的目标拒绝 `mirror_sync`**（ADR 0147，第 4 点）。绝不是环境变量，绝不是本地文件：全局目标会让项目 B 的产物落进项目 A 的文件夹，而用户会**通过内容、而非通过错误**发现这一点。

已声明的后果，也是代价：**在 runner 已连接时更换目标需要重新连接它。** 授予属于 join，从另一扇门到来的新目标恰恰就是规则所拒绝的全局配置。

**非空的 `mirror_path` 开始「要求」该能力。** 它不进入按 `execution_mode` 的映射——要求它的是项目的一项「数据」，而不是模式（`mounted` 和 `runner` 可以有目标，而 `container` 不能）。这是 RN-514 留下的、已实现但从未触发的拒绝机制的**第一个真实案例**：早于此版本的 `brabo-runner` 连接到有目标的项目时**将无法再连接**，并收到点名的拒绝（`JoinRecusadoError`，致命且不重试）。这是 **opt-in**——只在有人配置了目标的地方发生——其代价已在 ADR 0147 中声明。

**守卫的「三种」拒绝，`realpath` 那一遍并不多余。** `apps/runner/src/espelho-guard.ts` 是 **`guard.ts` 的兄弟，而不是它的扩展**：复用 `semBarraFinal`/`dentroDoEscopo`/`realpathMaisProximo` 以及 `validarCwdDentroDaRaiz` 的「先词法再 `realpath`」双遍检查，并以书面形式继承同样的 **TOCTOU** 保留意见——它是尽力而为，不是安全边界。它拒绝 (1) 逃出目标的 symlink，(2) **包含** workspace 的目标，以及 (3) 位于 workspace **之内**的目标；(2) 和 (3) 是方向相反的同一个环，而在 [ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md) 的按身份绑定下，把镜像写进源头会让镜像复制镜像自身。api 已经拒绝了**词法**的一半（[RN-515](api.md#rn-515)），并在代码中说明那只是词法——它没有可以解析用户计算机上 symlink 的磁盘。`destino/atalho -> /caminho/do/projeto` 在那边会被放过，而这里会解析它。

实现时发现的一处机制差异：`realpathMaisProximo` 会落到第一个存在的祖先，而镜像目标几乎从不存在（是本轮的 `mkdir -p` 创建它）。把两边都折叠到祖先会让 `/base-outra` 和 `/base` 都变成 `/`，守卫就会拒绝所有兄弟文件夹。因此第二遍解析祖先并**重新接上后缀**——symlink 只能存在于存在的段中，所以剩下的部分绝不会藏着任何链接。拒绝 (1) 还有第二半，**按文件**进行（`caminhoNoDestino`）：一个指向 `/etc` 的 `destino/sub` 链接会让 `sub/passwd` 的复制写到外面，而目标本身却完全合法。

**单一方向，且「绝不」删除。** Workspace → 目标。绝不 `--delete`，绝不 `unlink`，绝不 `rm`。**在 workspace 中删除的文件会留在目标中**，这是决定，不是疏忽：用户的文件夹不是副本，而是累积——因为另一边的一次 `git clean` 而去删除某人个人文件夹中文件的代理，正是产品存在就是为了不制造的意外。覆盖已改变的文件是预期的；删除从来不是。ADR 中声明的代价：目标只增不减，没有任何自动机制清理它。

**复制的是「git 的列表」，别无其他。** **已跟踪**的文件（`git ls-files`）加上**未被忽略的未跟踪**文件（`git ls-files --others --exclude-standard`），带 `-z`（没有它，git 会给含空格或重音的路径加引号并转义）。这恰好就是「工作」：跳过 `node_modules`、`dist`、构建产物以及 `.git` 本身，**无需维护任何排除列表**——那种列表会随每个新技术栈而过时——项目的 `.gitignore` 已经是这份列表，由维护项目的人维护。workspace **从构造上**就是 git 仓库（产品在其中配置 Gitflow，并用 `git init`/`fetch`/`checkout` 将其实体化），所以这一前置条件属于「产品」，不是对机器的假设。git 失败或文件夹不是仓库时，**以点名的原因失败**——绝不以 `cp -r` 全部内容作为 B 计划，那样整个 `node_modules` 就会落进某人的个人文件夹。

两个已验证且已声明、不加隐藏的属性：**嵌套**的 git 仓库作为「一个」目录条目返回，不会深入——每个 dev agent 的 worktree（`<workspace>/.worktrees/<agent_id>`）就是这样一个，所以镜像显示的是**主检出**，绝不是仍隔离在 worktree 中的工作；而**源头中的 symlink 被跳过**，因为跟随链接会把项目之外的内容带进个人文件夹。被排除的东西会被「计数」（`pulados`/`recusados`），绝不被吞掉。也没有「变了吗？」的启发式：总是复制会花掉相同字节的代价，而按大小+mtime 跳过则会让镜像静默地不复制一个已经改变的文件。

**「自己的」谓词，镜像不要求 Docker。**
`Engine.Runners.RunnerReadiness` **逐字节保持原样**（ADR 0147，第 3 点）——`Engine.Runners.Espelho` 不调用它、不扩展它，也不从它接收任何东西。镜像有「两个」前置条件：workspace 已确认、runner 已连接，没有 [RN-507](#rn-507) 加上的第三个（已「登记」为 `running` 的容器）。带有「跳过容器」标志的 `RunnerReadiness`，恰恰就是第三个前置条件在未来某次重构中意外地对 `exec` 失效的机制，而 [ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md) 的存在就是为了不让它失效。而镜像确实不需要它：第三个前置条件之所以存在，是因为原本有两种可能的执行，而错误的那种看不见；在用户机器上复制文件，没有可以掉落的容器。它也不询问 `execution_mode`——做出这一决定的已经是 api，在写入目标时（[RN-515](api.md#rn-515) 拒绝 `container`），重复这一决定就是同一规则的第二个来源。

**由「具名时刻」触发，绝不是 watcher。** engine 从代码中一个有名字的点推送 `mirror_sync`——目前是**成功的提交**（`EngineWeb.ActionCommandController`，`git_commit`）。绝不用 `fs.watch`：watcher 是由任何事情触发的无限工作——一次依赖安装、一次构建，更糟的是镜像自身的写入，那就是环——并会在用户机器上持续运行而无人要求，这与「本地代理」应有的含义相反。该推送是 **fire-and-forget**：没有 `from`、没有 `pending_execs`、也没有 `mirror_sync_result`，因为触发者正在做别的事，而同步的遥测是 ADR 的第 7 点，属于另一次会话。镜像失败会变成本地日志，绝不是让 runner 崩溃的异常，也绝不是沉默。

**它「不是」`proposed_action`，也不应变成。** 镜像的写入是用户声明的配置，不是代理请求行动——ADR 0147 对此明确，而通过终端命令同步会落入 [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) 的范围，变成例行审批的队列，侵蚀那道赋予点击意义的上限。

- **位置：** `apps/runner/src/espelho-guard.ts`（三种拒绝、保留后缀的双遍检查、继承的 TOCTOU 保留意见）；
  `apps/runner/src/espelho.ts`（git 的列表、单向复制、只在守卫「之后」才 `mkdir -p`）；`apps/runner/src/guard.ts`（三个辅助函数改为导出——路径比较只有一个来源）；
  `apps/runner/src/channel.ts`（`CAPACIDADES_DO_RUNNER` 加入 `espelho`、
  `MirrorSyncMessage`、`EspelhoConcedido`、`espelhoConcedidoDaResposta`）；
  `apps/runner/src/index.ts`（`EstadoDoRunner.destinoDoEspelho`、
  `tratarMirrorSync`——对未授予目标的拒绝）；
  `apps/engine/lib/engine/runners/capacidades.ex`（`exigidas/2`/`conceder/3`
  以及 `destino?/1`——要求能力的是目标，不是模式）；
  `apps/engine/lib/engine/runners/espelho.ex`（自己的谓词、join 的 `destino/1` 以及 fire-and-forget 的 `sincronizar/2`）；
  `apps/engine/lib/engine/projects/project.ex`（读取 schema 中的 `mirror_path`）；`apps/engine/lib/engine_web/channels/terminal_channel.ex`（join 回应中的授予以及 `dispatch_mirror_sync`）；
  `apps/engine/lib/engine_web/controllers/action_command_controller.ex`（提交触发点）
- **测试：** `apps/runner/src/espelho-guard.spec.ts`（目标在内、目标包含、在 `tmp` 中真实的 symlink 通过目标本身和中间某段逃逸、`/base-outra` 与 `/base`、按文件的目标、`lstat` 与 `stat`）；`apps/runner/src/espelho.spec.ts`（真实的 git 仓库：已跟踪 + 未跟踪未忽略、被忽略的排除在外、**源头删除的文件留在目标中**、嵌套仓库被跳过、源头 symlink 被跳过、目标 symlink 被拒绝、守卫在 `mkdir` 之前、没有 git 的文件夹以点名方式失败）；
  `apps/runner/src/channel.spec.ts`（目标随 join 回应到来、声明的三项能力、`mirror_sync` 到达处理器）；
  `apps/runner/src/index-handlers.spec.ts`（`describe "tratarMirrorSync"`——未授予的目标被拒绝、没有授予的连接、不抛出的失败，以及频道没有任何回推）；
  `apps/engine/test/engine/runners/capacidades_test.exs`（目标要求该能力、遗留二进制被拒绝、`destino?/1`）；
  `apps/engine/test/engine/runners/espelho_test.exs`（「两个」前置条件以及第三个的「缺席」——没有登记任何容器也是 `:pronto`）；
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  （`describe "o destino do espelho na concessão do join"`——授予、两种拒绝以及 `mirror_sync` 的推送）；
  `apps/engine/test/engine_web/controllers/action_command_controller_test.exs`
  （触发点：成功的提交会触发，失败的提交不会）
- **ADR：** [0147](../adr/0147-agente-local-com-capacidades.md)，第 2、3、4 和 8 点
- **来源：** FASE 28，第 6 次会话（B 半部）。第 8 点的第二个具名时刻「代理回合结束」已声明但**未**接上：engine 中有两个同名但互不相交的东西，没有一个是无歧义的挂钩——`Engine.Agents.TurnoAssincrono.finalizar/1` 结束六个对话型代理的回合，而它们在 workspace 中没有写入工具，并且它在崩溃和取消时也会触发；`Engine.Dev.AgentIo.finish_task/3` 不是空闲边界（它在同一次调用中认领下一个 task），而 dev agent 写的东西位于 worktree 中，镜像有意不深入其中。选择其中之一就等于在 ADR 只点名了时刻而没有点名函数的地方发明产品

---

## 本地代理成为「用户」服务，`status` 不坍缩状态（RN-518）

### RN-518 — `brabo-runner service install|uninstall|status` 以「用户」级别安装，绝不用 root；`uninstall` 清理「unit」所登记的文件夹；`status` 回答四种状态且不坍缩任何一种；Windows 是点名的拒绝 {#rn-518}

FASE 28 的第 7 次会话，以及 [ADR 0147](../adr/0147-agente-local-com-capacidades.md) 的**第 5 点**。在此之前，本地代理**只能在前台运行**：一个由 SIGINT/SIGTERM 结束的进程，随终端一同死去，也不会随用户会话回来。没有任何先例——`apps/runner/` 中没有任何地方提到 `systemd`、`launchd` 或 `LaunchAgent`。

**用户级别，「始终」如此——root 是「拒绝」，不是警告。** Linux 上是 `systemd --user`，macOS 上是 `LaunchAgent`。这不是打包偏好：`apps/runner/src/guard.ts:9-31` 的 docblock 声明 *"o runner roda NA máquina do usuário, com os privilégios DELE"*，这是产品三道真实边界（认证、审批流水线、同意）所依托的前提——而 `cwd` 守卫**明文写着**是尽力而为，正因为撑住任何东西的都不是它。以 root 运行的系统服务会打破这一不变量，让尽力而为的守卫成为已批准命令与机器磁盘之间唯一的东西。因此 `uid` 为 0 时的 `install` **会拒绝并点明原因**，不写任何文件，也不运行任何命令：安装后再警告会让错误的安装留在原地，而警告只会被读一次。

**Windows「不在范围内」，拒绝是点名的。** 构建矩阵已经产出 Windows 二进制（[ADR 0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)），但那里的用户服务是**第三种机制**（以用户账户运行的操作系统服务，或登录时的任务计划程序）——不是前两种的变体。三个子命令的回答都会点名平台，说明这是已声明的决定，并指出仍然可行的途径（在前台运行）。绝不是沉默的失败，绝不是什么都没装的「已安装」。任何其他平台也落入同样的拒绝。

**每个项目一个 unit，以 `projectId` 命名**——`brabo-runner-<id>.service`
/ `dev.brabo.runner.<id>`——因为服务器**已经强制每个项目一个 runner**：同一个 `terminal:<projectId>` 上的第二次 `join` 会被 `Engine.Runners.Registry` 拒绝。按「文件夹」命名会允许安装两个永远不可能同时运行的 unit，而第二个会表现为连接失败，而不是安装错误。从另一个文件夹再次安装会**覆盖**。`uninstall` 和 `status` 能准确找到同一个 unit，因为它们从「同一个」`projectId` 推导名称，按与一直以来的 CLI 相同的顺序、由「同样」的两个来源解析（`--project`，否则 `brabo-runner.config.json`），而文件夹取自 `guard.ts` 的 `resolverDir`——绝不是第二把尺子。在 Linux 上，文件放到 systemd **会去找**的地方，按它的优先级：变量设置时为 `$XDG_CONFIG_HOME/systemd/user`，未设置时为 `~/.config/systemd/user`——只选后者会让 unit 诞生在管理器从不查看的地方，而失败会以 `enable` 时的 *"unit file does not exist"* 出现，看得见，但原因是错的。

**`projectId` 会变成「文件名」，所以在这里校验它。** 它来自两个不是服务器的来源（一个输入的标志和文件夹中的一个文件），而 `--project ../../etc/systemd` 会写到 unit 目录之外。只允许字母、数字、`.`、`-` 和 `_`，最多 64 个字符——UUID，即产品中每个项目的真实格式，可以完整通过。runner 的路径和含双引号或换行的文件夹同样是点名的拒绝：unit 文件中的换行是指令注入，不是边界情况。

**服务以「设备密钥」认证，绝不用令牌。** `install` 要求文件夹中有有效的 `brabo-runner-device-key.jwk.json`，没有就拒绝，并有意忽略 `--token`/`BRABO_ACCOUNT_TOKEN`：把账户令牌写进 unit 文件会让它留在磁盘上，可被用户的任何进程读取，并在导出它的 shell 结束后继续存在——而这个 CLI **从未把凭据写到磁盘**（`auth.ts` 的 docblock 有一个专门防止这种情况的测试锁）。[RN-434](#rn-434) 照样运行，通过「同一个」函数：在 Linux 上指向 `$HOME` 之外的服务会被拒绝，因为用 unit 做 CLI 拒绝用标志做的事，就是从后门绕过规则。

**`Restart=on-abnormal`，绝不用 `on-failure`**（在 plist 中是带 `Crashed` 的 `KeepAlive`，绝不用 `SuccessfulExit`）。当 join 被**「拒绝」**时——票据无效、项目中已有另一个 runner、缺少能力（[RN-514](engine.md#rn-514)）——或者耗尽了自己的重试上限时，runner 以 1 退出，而这两种情况都是「停下来，叫一个人」。`on-failure` 会在循环中重启一个致命的拒绝，而这恰恰是 CLI 拒绝自行去做的事。信号、OOM 和 watchdog——`on-abnormal` 所覆盖的——是重启唯一能修复的失败。`PATH` 被**冻结**在 unit 中，其代价在文件本身中已声明：两个管理器都只给服务一个最小 PATH，而 runner 会调用 `git`（镜像，[RN-516](#rn-516)）和 `docker`（[ADR 0137](../adr/0137-o-runner-sobe-o-container-do-projeto.md)）；没有它，服务会完美启动，而这两个功能会以「未找到」失败。这是一张快照，只有重新安装才会改变。

**unit 文件的「两半」语法「不」相同，`WorkingDirectory=` 「不」加引号。** `ExecStart=` 会经过*去引号*和分词解析——因此每个参数都加引号——，而 `WorkingDirectory=` **不会**：systemd 把这一行剩余的全部作为路径。把两者当作一样处理付出了一整个版本的代价：加了引号后值不再以 `/` 开头，unit 在加载时被拒绝（`Loaded: bad-setting`，`WorkingDirectory= path is not absolute`），并且**从不启动**——两种类型都是，任何安装都是。测试套件一直是绿的，因为每条断言要回来的恰恰是错误的形式：因此现在的证明是针对真正的校验器 `systemd-analyze --user verify` 进行的，而不是针对文本。「剩下」需要转义的只有**一个**字符，而且不是空格（整行都被采用，所以 `/home/eu/pasta com espaço` 按字面工作）：是 `%`，因为该指令会经过**说明符展开**——`/home/dan/50%off` 会毫无错误地变成 `/home/dan/50<id-do-os-release>ff`，服务在错误的文件夹中启动。`%%` 是表示字面 `%` 的方式。回读接受**两种**形式，这是对磁盘上已有损坏 unit 的人的有意负债：`status` 和 `uninstall` 需要继续能找到它的文件夹。处于这种状态的人通过**重新安装**来修复——`install` 会覆盖整个文件。

**同一文件中还有「第三种」语法：`Environment=`（AT-095）。** 它是以空格分隔的赋值「列表」，带*去引号*和 C 风格转义，也会展开说明符。原样写入——就像「机器」unit 的 `XDG_CONFIG_HOME` 以及两种类型的 `PATH` 之前那样——，`Environment=XDG_CONFIG_HOME=/home/dan/50%off com espaco` 到达服务时变成 `/home/dan/50popff`：`%o` 被展开，`com`/`espaco` 被分词丢弃。unit 能加载，`verify` 通过，服务启动——而代理在一个不存在的文件夹中寻找基目录和密钥，悄无声息。因此「整个」赋值放在引号中（`Environment="VAR=valor"`），`\` 和 `"` 用反斜杠转义，`%` 写作 `%%`；`$` 在那里不转义（`Environment=` 不展开变量）。`ExecStart=` 的 `--dir` 属于同一类问题，一并处理：每个参数仍加引号，现在 `\` 变成 `\\`，`%` 变成 `%%`，`$` 变成 `$$`（`ExecStart=` 的变量替换）。`PATH`/`XDG_CONFIG_HOME` 中的换行在写入前就被「拒绝」——在 unit 文件中它是新指令，不是值。这些都不改变回读：它只读 `WorkingDirectory=`，两个环境变量值都不会从磁盘读取。证明的是「有效值」，而不是 `verify`（它会通过损坏的形式）：`systemd --test --user --unit=<u>` 本身，在一个临时的 unit 文件夹上，会转储解析后的配置，测试比较 systemd「理解」的内容与写入的内容。

**激活失败「不」删除文件，也不说「已安装」。** 写 unit 和激活它是两步，而管理器可能不在（`systemctl` 不在 PATH 中、`launchd` 拒绝）。文件**保留**——那是人手动完成所需要的——回答是第三种结果，点名待执行的命令和原因。删除文件会把「我没能激活」变成「什么都没发生」，而这是假的。

**`uninstall` 删除「三样」东西，文件夹取自「unit」——绝不取自 `cwd`。** ADR 明确：unit 文件、`brabo-runner.config.json` 和
`brabo-runner-device-key.jwk.json`。后两者位于 runner 的文件夹中，而要紧的文件夹是**被安装**的那个，不是人碰巧输入命令时所在的那个——因此 `WorkingDirectory` 是从 unit 文件本身读回的，它就是安装内容的记录。**没有 unit 就没有记录**：这两个文件只有在显式给出 `--dir` 时才被删除，消息会说明原因。按 `cwd` 猜测会删掉一个没人要求删除的项目的密钥。停用失败会变成**警告**，文件照样删除——一个管理器已不再识别的 unit，不是留下文件的理由。

**并且 `uninstall` 「说出」它没做的事：密钥离开的是磁盘，不是服务器。** 对应的公钥仍在 `runner_device_keys` 中，吊销它是另一回事（`DELETE /projects/:projectId/runner-device-keys/:deviceKeyId`，
[ADR 0147](../adr/0147-agente-local-com-capacidades.md) 第 6 点）。一个让人以为已吊销的「已删除」比什么都不删更糟。LaunchAgent 的日志也**不**删除：它是用户关于发生了什么的记录，删除它并未被要求。

**`status` 回答「四种」状态，它们不会坍缩**（[RN-088](web.md#rn-088)）：*未安装*、*已安装且运行中*、*已安装且已停止*，以及*已安装但无法询问*。第一个答案来自**「磁盘」**——有 unit 文件吗？——正因如此，在管理器不存在的机器上它依然正确；之后才去问管理器。失败的 `spawn`（PATH 中没有二进制）**绝不**变成「管理器说不」：它们是不同的答案，在源头就分开，而这个 CLI 不知如何解释的词也落入「无法询问」，而不是靠猜变成「已停止」。每种状态都有**自己的语句**和**自己的退出码**（0 / 3 / 4 / 5，不用 1 和 2，因为在这个 CLI 中它们已表示一般失败和用法错误）：对三种「未在运行」使用同一个 `exit(1)`，会在退出码上坍缩语句所区分的东西。

**这里没有任何东西是 `proposed_action`。** 这是用户在自己的机器上、对自己的服务运行命令——不是代理请求行动。`service` 在 `lerArgumentos` **之前**分派，因为三个子命令都不连接任何东西，而最重要的那个（`status`）需要在配置已损坏的文件夹中工作，而那恰恰是有人会问的时候。

- **位置：** `apps/runner/src/servico.ts`（新增——词汇表、作为对「同样」五个问题之回答的两个平台、拒绝、四种状态以及 `CODIGO_POR_ESTADO`）；`apps/runner/src/servico-sistema.ts`（新增——磁盘以及 `systemctl`/`launchctl` 的真实适配器，单独分开，以便「`servico.ts` 不碰 `node:fs`/`node:child_process`」这一保证仍可验证）；`apps/runner/src/index.ts`（`comandoDoRunnerParaServico`、
  `rodarSubcomandoDeServico`、在 `main()` 中先于 `lerArgumentos` 分派 `service`，以及 `uso()` 中的新行）
- **测试：** `apps/runner/src/servico.spec.ts`（新增——两个平台的正常路径，带有 unit/plist 的真实内容；root 被拒绝且什么都不写；Windows 被点名；没有设备密钥；会变成路径的 `projectId`；缺少 `systemctl` 时保留文件并说明未激活；RN-434 的透传；`uninstall` 读取 unit 的文件夹而不是 `cwd`，没有 unit 且没有 `--dir` 时不碰任何文件，以及失败的 `disable` 变成警告；`status` 的「四种」状态加上未知词以及 `launchctl` 的三种结果；以及四个不同的退出码）；
  `apps/runner/src/index.spec.ts`
  （`describe "brabo-runner service é despachado antes de exigir credencial"`——在没有任何凭据的文件夹中的「真实」进程：`status` 回答 4 而不是用法块，未知子命令落入 `service` 的用法）；
  `apps/runner/src/servico-systemd.spec.ts`（「生成」的 unit 交给真实的 `systemd-analyze --user verify` 检查，两种类型都是，文件夹含空格和含 `%`——再加上「旧」形式（带引号）被同一校验器「否决」；机器上没有 systemd 时该文件「跳过」并点明原因，绝不静默通过，也不因环境而失败）——以及自 AT-095 起，`describe "o valor EFETIVO de Environment= é o valor
  gravado"` 和 `describe "o --dir do ExecStart= e o WorkingDirectory= também
  chegam intactos"`，它们向 `systemd --test --user` 的转储询问 `XDG_CONFIG_HOME`、`PATH`、`WorkingDirectory` 以及带 `%`、空格、引号、反斜杠和 `$` 的 `--dir` 的「解析后」的值，并把 `Environment=` 的旧形式固定为交付「另一个」值；`servico.spec.ts` 增加了两个换行拒绝以及没有 `XDG_CONFIG_HOME` 的项目 unit
- **ADR：** [0147](../adr/0147-agente-local-com-capacidades.md)，第 5 点
- **来源：** FASE 28，第 7 次会话。已声明且「未」做：**BRB-031**（[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md) 流程中手动的 `chmod +x`）**不**在这里终结——运行 `brabo-runner service install` 的人为了走到这个命令，已经必须让二进制可执行，而 ADR 0147 把这一副作用与「安装来自 [ADR 0146](../adr/0146-base-consentida-no-bootstrap.md) 的版本化引导」绑定在一起，本次交付不涉及它。同样不在范围内：任何 `start`/`stop`/`restart` 子命令（管理生命周期的是操作系统的服务管理器，在 CLI 中重复它会产生关于状态的第二个真相来源），以及上面提到的 Windows

---

## 启用代理的标志必须「到达」进程（RN-540）

### RN-529 — `brabo-runner` 诞生时带有本地「基目录」，每个项目是它的一个子文件夹，而基目录「绝不」使 `--dir` 失效 {#rn-529}

本地代理原本没有基目录的概念。唯一的根是 `--dir`，由 `resolverDir` 相对于 `INIT_CWD ?? process.cwd()` 解析；没有该标志时，根就是 `cwd` 本身。`estado.dir` 是**一个**路径，单数——那条连接所属项目的路径——，没有任何常量、变量或字段说明项目在那台机器上住在哪里。「基目录」这个词只出现在注释中。

**基目录是「本地」的，绝不经由网络到来。** 这是把 broker 的设计（[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)）应用到本地代理：拥有根的是执行者，穿过网络的是**相对段**。不存在来自服务器的基目录字段，`resolverPastaDoProjetoNaBase` 按词法拒绝「绝对」段——绝不「接受后重新解释」。

**两个来源，标志优先。** 命令行上的 `--base <caminho>`，以及 `$XDG_CONFIG_HOME/brabo/runner.json`（否则为 `~/.config/brabo/runner.json`），安装程序（[ADR 0150](../adr/0150-instalador-de-uma-linha.md)）就把它写在那里。该文件有意属于「用户」而不属于项目：基目录是 N 个项目共用的**一个**，把它存在 `brabo-runner.config.json` 中——那是按项目的、位于项目文件夹「之内」、由「浏览器」写入的——会产生同一值的 N 份副本，有 N 次分歧的机会。环境变量因两个原因被拒绝：`BRABO_PROJECTS_BASE` 已经存在，是「服务器」一侧 `mounted` 项目的基目录（[RN-500](api.md#rn-500)），这是 [ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md) 明文拒绝的命名空间冲突；而且在 `systemd --user`/LaunchAgent（[RN-518](#rn-518)）下，环境是 unit 的，不是安装者 shell 的。只用标志也不够：基目录会进入每个 unit 的 `ExecStart`，更换它就得重写所有 unit。

**`--dir` 的含义与一直以来完全相同，基目录「不」进入它的校验。** 这是把 api 的禁令移植过来：`project-workspaces-root.ts` 明文禁止基目录规则下沉到 `caminhoDeWorkspaceLocalValido`，因为那个谓词在每次「读取」时运行，一个位于基目录之外的遗留项目在被读取时就会炸掉——*"a base é regra de
CRIAÇÃO e CONVERSÃO; o léxico é para sempre"*（[RN-501](api.md#rn-501)）。这一侧同样适用：`--dir` 仍由 `validarDirDentroDoHomeNoLinux` + `garantirDiretorio`（[RN-434](#rn-434)/[RN-435](#rn-435)）校验，位于基目录「之外」不会使它失效。否则基目录会成为没有收益的 `breaking/`，违背 [RN-514](engine.md#rn-514) 的遗留二进制。基目录**只**决定「新」项目文件夹在哪里诞生。

**守卫复用尺子；不会诞生第四份拷贝。** `base-guard.ts` 是 `guard.ts` 的「第三个」兄弟，与 `espelho-guard.ts` 并列：导入 `semBarraFinal`、`dentroDoEscopo` 和 `realpathMaisProximo`——这三个辅助函数正是为此不再私有（[RN-516](#rn-516)）——，重复 `validarCwdDentroDaRaiz` 的「先词法再 `realpath`」**双遍**检查，并「整个」复用 `validarDirDentroDoHomeNoLinux` 来要求 Linux 上基目录位于 `$HOME` 之内（基目录在 `$HOME` 之内意味着每个子文件夹都在其中，所以两项检查仍然一致）。从 `espelho-guard.ts` 的环拒绝中复用的是尺子——`dentroDoEscopo`，按「段」比较，绝不是原始的 `startsWith`，这样 `/base-outra` 不会算作在 `/base` 之内——而**不是** `recusarLaco` 函数，它抛出 `DestinoDeEspelhoInvalidoError`，会把格式错误的基目录报告为镜像问题。与 [RN-515](api.md#rn-515) 相同的教训：复用的是尺子，不是消息。

**这里的环是「不对称」的，这就是发现。** 在镜像中两个方向都是缺陷。这里项目文件夹位于基目录「之内」是「正常」的安排——这正是「每个项目是它的一个子文件夹」字面上的意思。反方向才是环：基目录位于本项目的根之内（或等于它），会让每个新项目都诞生在这个项目之内，本项目的 git 和镜像开始扫描其他项目。只拒绝这一个方向。

**拒绝按「来源」有不同的处置，没有一种是静默的。** 没有基目录是「正常」状态（`null`，遗留完好）。来自「标志」且未通过守卫的基目录以代码 2 退出——这是现在输入的、不可能满足的明确请求，与被拒绝的 `--dir` 处置相同。来自「文件」且未通过的基目录会在 `stderr` 中说明，点名失去的东西（"não terá onde criar a pasta de um projeto novo"），runner **在没有基目录的情况下继续运行**：因为一个它还没用到的配置而拖垮正在服务某个项目的本地代理，是不相称的。存在但未声明 `base` 的文件是缺席，不是拒绝——这是「没有」同意基目录的配置，不是损坏的配置。启动行在「两种」状态下都说明基目录，因为省略「无」会让人去找文件夹为什么没出现。

**这是「尽力而为」，TOCTOU 保留意见以书面形式继承**自 `guard.ts` 和 `espelho-guard.ts`：在检查「之后」、`mkdir` 「之前」创建的 symlink 不在覆盖范围内，目标尚不存在的链接也不在。安全边界仍然是认证 + 审批流水线 + 运行 CLI 者的同意。

这里没有任何东西「创建」文件夹：基目录的校验不要求它存在（创建它的是安装程序，这与 [ADR 0142](../adr/0142-validacao-de-workspace-montado-adiada.md) 的推理相同——在只有词法可知的地方校验磁盘，会阻止在基目录存在之前就同意它）。唯一的磁盘问题是永远不会有歧义的那个：一个「已经」存在且不是文件夹的路径永远不会变成文件夹。

- **位置：** `apps/runner/src/base.ts:69`（`caminhoDoArquivoDeBase`，`servico.ts` 的 XDG 优先级）、`:106`（`lerBaseConsentida`，四种结果）和 `:181`（`resolverBaseConsentida`，来源顺序和拒绝的来源）；`apps/runner/src/base-guard.ts:128`
  （`validarBaseDeProjetos`）、`:209`（`recusarLacoComARaiz`，不对称的环）和 `:296`（`resolverPastaDoProjetoNaBase`，子文件夹和双遍检查）；
  `apps/runner/src/index.ts:321`（`lerArgumentos` 中的解析，在 `garantirDiretorio` 「之后」且不触碰 `--dir` 的校验）和 `:452`
  （`EstadoDoRunner.base`）
- **测试：** `apps/runner/src/base-guard.spec.ts`（基目录尚不存在时的正常路径；有共同前缀但「不」被混淆的兄弟；`..`、`/`、文件、Linux 上的 `$HOME`；两个方向的环，包括由「真实」symlink 构造的环；绝对段、带 `..` 的段、指向基目录本身的段以及通过中间链接逃逸的段）；
  `apps/runner/src/base.spec.ts`（XDG 优先级、读取的四种结果、标志胜过文件，以及携带「来源」的拒绝）
- **ADR：** [0151](../adr/0151-base-consentida-no-runner.md) 第 1 和第 2 点
- **来源：** FASE 29。在这里被声明为未做的 `workspace_create`/`workspace_create_result` 对以及 `workspace` 能力（ADR 的第 3 至 6 点）已在 [RN-532](#rn-532) 中「关闭」——基目录有了消费者。仍声明且「未」做：`install.sh`，它将负责写入该文件
---

## 本地代理的基目录有了消费者：项目文件夹经由频道诞生（RN-532）

### RN-532 — `workspace_create` 在「本地」基目录下创建文件夹，负责「写入」的仍然是已有的 `workspace_confirm` {#rn-532}

[RN-529](#rn-529) 给了 `brabo-runner` 一个「基目录」并校验了它，并明文声明**没有任何东西消费它**。这就是消费者：`workspace_create`/`workspace_create_result` 对、`workspace` 能力以及 engine 中自己的谓词。

**这一对是「请求-响应」式的，无法建模在 `workspace_confirm` 上。** 后者是「单向」的：`handle_in("workspace_confirm",
…)` 回应 `{:noreply, socket}`，不推送任何东西回去。请求创建文件夹的一方需要知道它是否出现了、路径是什么——所以模板是 `exec`/`exec_result` 的（`despachar_pedido` + `pending_execs` +
`responder_pedido_pendente/3`），与三个容器对相同。精确性说明，因为这个名字曾流传过：**`workspace.verified` 不存在**于本仓库——存在的是事件 `project.workspace_verified` 和列 `workspace_verified_at`。

**只有「段」穿过网络。** 基目录是本地的，绝不来自服务器（RN-529）；engine 发送 `projectId` 和「相对」段，由 `resolverPastaDoProjetoNaBase`——在拥有根的 runner 一侧——把它们拼接起来。这是把 [ADR 0130](../adr/0130-broker-de-container.md)/
[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md) 的不变量应用到本地代理：拥有根的是执行者。「绝对」段按「词法」被拒绝，绝不被接受后重新解释。

**确认「复用」`workspace_confirm`，这省下了一整条战线。** 创建文件夹后，runner 推送自 [RN-423](#rn-423) 起就存在的 `workspace_confirm`——由它沿已建好的路径写入：频道 → engine → 内部 HTTP → `ConfirmProjectWorkspaceUseCase`，它重新校验词法、是幂等的，并盖上 `workspace_verified_at` 时间戳。**不会诞生任何新的写入路由**，engine 仍然不写这张表，盖时间戳的路径仍然只有一条。「顺序」是机制，不是美观：两次推送按顺序到达「同一个」频道进程，而 `workspace_confirm` 的处理器是同步的——在结果「之前」发送它，正是保证请求方从 `receive` 解除阻塞时时间戳已经存在的东西。

**`workspace` 能力在代码进入的那次会话中进入词汇表**，两边都是（[ADR 0151](../adr/0151-base-consentida-no-runner.md) 第 4 点）。[RN-514](engine.md#rn-514) 对 `espelho` 做了相反的押注——服务器上有名字而另一边没有代码——它之所以得到回报，只是因为有人追究了；重复它就是重复协商机制存在就是为了防止的那个静默缺陷。

**它是四项能力中唯一一个其声明取决于那次执行的「状态」、而不是二进制版本的。** runner 只在有已同意的基目录时声明它（`capacidadesDoRunner`），而服务器正是通过这一行——别无其他——「知道」存在基目录：engine 不读用户的磁盘，也没有基目录表。没有人在 join 中「要求」它，这是决定：在 `runner` 中要求它会让每个没有基目录的二进制都无法连接，这是 `breaking/` 和 MAJOR，为了一个那个项目也许永远用不上的功能。它从另一端 opt-in——有基目录的声明，只有声明了的才收到消息。

**「自己的」谓词，`RunnerReadiness` 逐字节不变。**
`Engine.Runners.PastaDoProjeto` 有「两个」前置条件——runner 已连接、已同意基目录——ADR 字面采纳了 `Engine.Runners.Espelho` 已经写下的拒绝：带「跳过容器」标志的共享函数，恰恰就是第三个前置条件在未来某次重构中「意外」对 `exec` 失效的路径（[RN-507](#rn-507)/[ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md) 的存在就是为了不让它失效）。而在这里第三个前置条件不只是不必要，更糟：它是**循环的**——`runner` 项目只有在 runner 自己把容器启动之后才会有「登记」为 `running` 的容器，而容器是在这条消息存在就是为了创建的那个文件夹上启动的。

它也「不」询问 `workspace_verified_at`（与镜像相反：这里它是「结果」，要求它会让消息恰好在它被设计用于的情况下无法到达），也不询问 `execution_mode`（同一规则的第二个来源——有已同意基目录的是本地代理，而本地代理只存在于它存在的地方）。

**每个前置条件在哪里被回答，以及为什么两者不在同一个地方。** 「runner 已连接」属于 `Registry`，模块可以自己回答。「已同意基目录」是那条「连接」的属性：它存在于 `socket.assigns`，**绝不在表中**（[ADR 0147](../adr/0147-agente-local-com-capacidades.md) 的尺子），所以回答它的是分派——频道在推送「之前」拒绝，并通过「同一个」`ref` 以模块已期待的格式返回 `motivo: "sem-base"`，正如 `dispatch_exec` 对 126 所做的那样。绝不是超时，那正是静默缺陷会呈现的样子。两个原因、两条消息以及它们的适用顺序都住在模块中，别无他处。

**「点名」的错误，以及五个不坍缩的原因。** `sem-base`、`segmento`、
`nao-e-pasta`、`mkdir` 和 `git` 作为 `motivo` 随 `erro` 的文本一起传递——有意分开：文本是给人读的，原因是让另一边「做决定」的，把它们坍缩在一起会迫使 engine 匹配 pt-BR 子串。只有 `sem-base` 在 engine 中成为自己的原子（`:sem_base`），因为只有它有自己的修复办法；其他四个是带 runner 消息的 `:recusado`。失败的 `init`/克隆是点名的错误，**绝不是 B 计划**：没有 `.git` 的文件夹会在远离原因的地方弄坏 dev agent 的 worktree、镜像以及用户自己的版本管理。

**幂等，三种结果不坍缩。** `mkdir -p` 本来就是幂等的；需要做决定的是仓库——「已经」是仓库的文件夹以「成功」返回，模式为 `ja-era-repositorio`，绝不在上面再 `init`（那会对发生的事撒谎），也不克隆（那会因文件夹非空而失败，把「早已就绪」变成错误）。这与 `ConfirmProjectWorkspaceUseCase` 的处置相同，原因也相同：消息可能到达两次。

**`estado.dir` 「不」变。** 创建的文件夹是从「服务器」视角看的项目文件夹——由 `workspace_confirm` 把它写到那里。`guard.ts` 用来约束已批准命令的根仍然是这次执行的根：在运行时更换它会因为一条网络消息而移动一道约束边界，而这个 CLI 从不这样做。

**这「不是」`proposed_action`，也没有任何上限获得例外。** 创建用户刚刚请求的项目文件夹是「已同意」的配置，不是代理请求行动——与镜像已经确立的界线相同（[RN-516](#rn-516)）。通过终端命令来做会落入 [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) 的范围，变成例行审批的队列，侵蚀那道赋予点击意义的上限。

- **位置：** `apps/runner/src/pasta-do-projeto.ts:132`（`criarPastaDoProjeto`——守卫→磁盘→版本管理的顺序以及五个原因）；
  `apps/runner/src/channel.ts:173`（`WorkspaceCreateMessage`）、`:194`
  （`WorkspaceCreateResultMessage`）、`:476`（`CAPACIDADE_DE_WORKSPACE` 和
  `capacidadesDoRunner`）；`apps/runner/src/index.ts:1027`
  （`tratarWorkspaceCreate`——`workspace_confirm` 在结果之前的顺序）；
  `apps/engine/lib/engine/runners/pasta_do_projeto.ex:107`（`verificar/1`）和
  `:134`（`criar/3`）；`apps/engine/lib/engine/runners/runner_router.ex:181`
  （`create_workspace/3`）；`apps/engine/lib/engine/runners/capacidades.ex:95`
  （词汇表中的 `workspace`，且不在遗留中）；
  `apps/engine/lib/engine_web/channels/terminal_channel.ex:666`
  （`handle_info({:dispatch_workspace_create, …})`，点名的拒绝）和 `:380`
  （`handle_in("workspace_create_result", …)`）
- **测试：** `apps/runner/src/pasta-do-projeto.spec.ts`（使用 `init` 和使用克隆的正常路径；用「真实」版本管理二进制证明的幂等性；五个原因，文本各不相同，以及「不会」在基目录之外诞生的文件夹）；`apps/runner/src/index-handlers.spec.ts`（`workspace_confirm` → `workspace_create_result` 的「顺序」；没有基目录就没有 confirm；断开的连接不推送任何东西）；`apps/runner/src/channel.spec.ts`
  （`workspace` 只在有基目录时声明；丢弃没有 `segmento`/`projectId` 的 payload；格式错误的 `env` 变成 `undefined`）；
  `apps/engine/test/engine/runners/pasta_do_projeto_test.exs`（两个前置条件「不」用数据库——断言是纯 `ExUnit.Case`——、精确的 payload、四个原因以及没有路径的成功不会变成成功）；
  `apps/engine/test/engine/runners/runner_router_test.exs`（往返和超时）；`apps/engine/test/engine/runners/capacidades_test.exs`
  （`workspace` 可声明、绝不在遗留中、绝不被要求）；
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`（通过同一个 `ref` 的点名拒绝，且没有任何东西推送给 runner）
- **ADR：** [0151](../adr/0151-base-consentida-no-runner.md) 第 3 至 6 点
- **来源：** FASE 29，第 8 次会话。已声明且「未」做：谁「调用」`PastaDoProjeto.criar/3`——web→api→engine 的路径属于第 9 次会话——，以及写入基目录文件的 `install.sh`，它属于另一条战线

---

## 本地代理打开 N 条连接，每个项目一条（RN-544，FASE 30）

### RN-544 — 本地代理打开 N 条连接，路由发现的每个项目一条——重试上限和 join 拒绝不再属于「进程」 {#rn-544}

[RN-543](produto.md#rn-543) 开放了 `GET runner/projects`，却没有调用方。`brabo-runner` 仍然要求 `--project`：`index.ts` 中有 `if (!projectId) uso()`，不存在没有项目的执行。本 RN 就是消费者——也是 [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md) 证明其发现的那一半：*"um único processo que abra N conexões — uma por
projeto que ele atende — satisfaz os itens 1, 2 e 3 byte a byte"*。**engine 中没有任何变化**：主题 `terminal:<projectId>`、socket id 和票据描述的是一条「连接」，N 条连接仍然是 N 条连接。对同一项目中第二个 runner 的拒绝保持不变，这是真实的保证，不是偶然。

**两种模式，旧的逐字节不变。** 使用项目凭据的 `--project`/`--dir`——包括浏览器流程（[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)，[RN-464](api.md#rn-464)）——是一直以来的路径：「一条」连接，它的结果仍然是进程的结果。新模式要求「两样」东西，原因各不相同：「机器」凭据，因为路由接受的是它；以及**已同意的基目录**（[RN-529](#rn-529)），因为没有它就无从推导每个项目的文件夹，而捏造一个就是往用户磁盘上写一个他没有同意的路径。没有基目录时，不带 `--project` 运行仍然落入 `uso()`，说明缺的是两者中的哪一个。

**runner 不知道自己密钥的种类，这是决定。** 在磁盘上，机器密钥和项目密钥是「同一种」文件：一个带 `kid` 的私有 JWK（[RN-475](web.md#rn-475)）。知道的是「服务器」，它通过这个 `kid` 找到公钥。所以 CLI 去询问，`PatAuthGuard` 点名的 403 变成 `CredencialNaoEDeMaquinaError`，带有 api 的原话和修复办法（`--project`）——绝不是笼统的「连接失败」。本地猜测会成为关于同一件事的第二个真相来源，而本地的那个会是错的。这次调用的 JWT **不带** `projectId` 声明，因为守卫比较 `payload.projectId !== request.params.projectId`，而在没有项目的路由上两者都必须是 `undefined`。

**N 条连接需要 N 个状态。** `EstadoDoRunner` 的四个字段是按项目的——`dir`、`canalAtual`、`containerAtivo`、`destinoDoEspelho`——再加上由 `dir` 产生的 `gerenciadorPty`。共享状态会让一个项目的 `docker exec` 在「另一个」项目的容器中运行，让一个项目的 PTY 在另一个项目的文件夹中打开。`docker` 和 `base` 属于「机器」，作为「同一个」值进入所有状态，绝不是可能分歧的拷贝。类型没有变，处理器（`tratarExec`、`tratarMirrorSync`、`tratarWorkspaceCreate`…）一行都没变：镜像（[RN-516](#rn-516)）和 `workspace_create`（[RN-532](#rn-532)）本来就是按项目的，并且本来就随那条连接的 `join` 授予传递，这正是让它们在 N 条连接下也正确的东西。

**上限和拒绝变成「项目」的。** 它们原本属于进程：join 被拒绝会导致 `process.exit(1)`，`TETO_DE_TENTATIVAS_SEGUIDAS` 耗尽也是。有 N 条连接时，因为一条而杀掉全部，会让代理在所有正常工作的项目中都倒下。所以每个项目有自己的循环和计数器；被拒绝或耗尽的项目**单独结束，并「点名」**，其余继续——只有当一个都不剩时，进程才以 1 退出，并附上说明每个项目结果的摘要。循环的每条日志都以项目名为前缀：在 N 个交错的循环中，没有归属的「连接失败」就是有 N 个东西时沉默所呈现的样子。在 `projeto` 模式中旧的处置完全相同，出于相反的同一推理：只有「一条」连接时，就没有剩下要服务的东西。

**列表在启动时只查询「一次」。** 定期重新查询被考虑过并拒绝：为一个罕见事件付出周期性调用的代价，而真正的代价不是流量——而是一个变「短」的列表是有歧义的（项目被删除、模式被转换、角色被吊销，或一个伪装成这三者的瞬时 500），因为这种歧义断开「活动」连接，会把一个确定的状态换成一个猜测。进程在启动时**说明**这一点，而获取新项目的动作是重新连接代理——一条命令，借助 [RN-518](#rn-518) 的用户服务。

**「空」列表是正常状态，以 0 退出。** 这是每台刚安装的机器的状态：安装程序在任何项目存在之前就启动代理（[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)）。这不是错误，所以不是错误码——而 `Restart=on-abnormal`（[RN-518](#rn-518)）不会重新拉起它，这是对的：没有要拉起的东西。以零条连接保持运行，就是一个什么都不做的「活动」服务，unit 的 `status` 就会开始撒谎。

**每个项目的文件夹是 `<base>/<workspaceDirName>`，经过已有的守卫。** `resolverPastaDoProjetoNaBase`（`workspace_create` 使用的「同一个」，原因也相同：名称来自网络），再加上 `validarDirDentroDoHomeNoLinux`（[RN-434](#rn-434)）和 `garantirDiretorio`（[RN-435](#rn-435)）——不会诞生第四份尺子拷贝。创建文件夹是把 RN-435 应用到一个「推导」的而不是输入的路径；这里「不」发生的是 `git init`/克隆，那仍然属于 `workspace_create`（[RN-532](#rn-532)）。文件夹被拒绝的项目被点名移出计划，不会拖垮其他项目。在机器模式下 `OpcoesDaBase.raizDoProjeto` 接受 `null`：没有 `--project` 就没有 `--dir`，环拒绝**失去了主体**（每个根都由基目录推导，所以「基目录在某个项目的根之内」无从构造），而在那里传入基目录本身会更糟——`dentroDoEscopo(base, base)` 为真，每个基目录都会被拒绝。

- **代码：** `apps/runner/src/index.ts`（`lerArgumentos` 中的入口、
  `lerArgumentosDeMaquina`、`manterConexaoDoProjeto`、`criarEstado`、
  `rodarComoAgenteDeMaquina`）；`apps/runner/src/projetos.ts`
  （`listarProjetosDoRunner`、`planejarConexoes`、
  `CredencialNaoEDeMaquinaError`）；`apps/runner/src/auth.ts`
  （`assinarDescobertaComChaveDeDispositivo`——没有 `projectId` 声明的 JWT）；
  `apps/runner/src/base-guard.ts`（为空的 `OpcoesDaBase.raizDoProjeto`）
- **测试：** `apps/runner/src/projetos.spec.ts`——路由和计划的正常路径、403 变成「自己的」错误、不符合契约的回应，以及逃出基目录的段被拒绝而「不」拖垮邻居（包括通过 symlink，在第二遍中）；`apps/runner/src/index.spec.ts`——真实进程中的「入口」（没有基目录时，`uso()` 附原因；有基目录时，拒绝改由凭据给出）；`apps/runner/src/base-guard.spec.ts`——为空的 `raizDoProjeto` 不会放宽任何其他拒绝
- **已「声明」的缺口，之后由 [RN-552](api.md#rn-552)「关闭」：** 本 RN 关闭时，没有人「创建」机器密钥（那是 `install.sh`，ADR 0155 第 4 点），所以新模式只能用手工登记的密钥来演练——这是 RN-543 已经声明的那一半。机器模式下的 `apiUrl` 来自 `--api-url`/`BRABO_API_URL`/默认值，**而不是** `brabo-runner.config.json`，后者是按「项目」的：一个端口或
  主机不同的安装需要在 `ExecStart` 中带上该标志，写入它的是按机器的 unit，那是本阶段的第 4 次会话。而 unit 仍然是按「项目」的——这个 PR 改变的是「进程」，不是服务
- **ADR：** [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **来源：** FASE 30，第 3 次会话——
  [阶段的范围划定](../explanation/fase-30-runner-por-maquina.md)

## 「机器」unit，与按项目的 unit 共存（RN-545）

### RN-545 — `service install --machine` 为机器安装「一个」unit，两个种类不会重叠 {#rn-545}

[RN-544](#rn-544) 让机器代理作为「进程」存在——N 条连接，路由发现的每个项目一条——并以书面形式声明了缺少的东西：*"a unit continua sendo POR PROJETO; este PR muda o PROCESSO, não o serviço"*。本 RN 是另一半，也是 [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md) 测量的五个耦合中的第五个也是最后一个（`apps/runner/src/servico.ts:264,391`）。其他四个已经关闭或被声明为不可触碰：第 1、2、3 项描述的是一条「连接」，N 条连接逐字节满足它们，第 4 项在 [RN-543](produto.md#rn-543) 中关闭。

**机器 unit 的名称不能与任何 `projectId` 冲突，而它按构造就不冲突。** `brabo-runner.service` / `dev.brabo.runner`，没有后缀，对比 `brabo-runner-<projectId>.service` /
`dev.brabo.runner.<projectId>`。`PROJECT_ID_VALIDO` 要求**至少一个字符**，所以项目名在机器名结束的地方总有一个 `-`（或者在 launchd 中一个分隔用的 `.`）——两者永远不会产生同一个字符串。这由测试锁定，而不是靠阅读正则。

**平台层改为按「种类」而不是按 `projectId` 为键。** `PlataformaDeServico` 的八个成员中有六个接收 `projectId: string`；它们改为接收 `AlvoDaUnidade`，一个可辨识的类型（`{especie:'projeto', projectId}` | `{especie:'maquina'}`）——绝不用 `projectId: string | null`，因为有了 null，每个成员都会自行决定如何处理它，而编译器不会要求任何一个。`PlanoDeInstalacao` 出于同样的原因变成联合：项目计划的三个字段在机器上失去意义，那里没有项目、没有 `--dir`（每个根都来自基目录），api 也不能来自一个按项目的文件。`caminhoDaUnidade` 从成员「下沉」为函数，因为两个平台回答的是同一件事——文件夹加名称——，维持两份相同的实现，就是在第二个种类到来时让它们分歧的机会。

**区分依据是 `--machine` 标志，「绝不」是缺少 `--project`。** ADR 0154 第 5 点写道 *"`service install` sem `--project` instala a unit de
máquina"*，这在本次会话中经测量后**无法**按字面实现：`resolverProjeto` 有「两个」来源，而今天的正常路径是在浏览器配置好的文件夹中不带任何标志运行 `install`——由 `brabo-runner.config.json` 来回答。把「没有 `--project`」当作「机器」，会静默转换已在使用产品的人的安装，而这恰恰是同一 ADR 第 5 点承诺不做的。所以新种类是**显式 opt-in**，两个项目来源逐字节保持不变，`--machine` 与 `--project` 同时出现是点名的拒绝，而不是捏造的优先级。

**`install --machine` 比项目那一半拒绝得更多，两种自己的拒绝都经过测量。** 第一种：文件夹中不能有 `brabo-runner.config.json`。`lerArgumentos` 在缺少 `--project` 时通过这个文件解析 `projectId`，而机器模式恰恰是「没有 `projectId`」——一个 `WorkingDirectory` 中有这个文件的机器 unit 会静默地以「项目」模式启动进程，服务「一个」项目却自称机器代理。第二种：没有**已同意的基目录**（[RN-529](#rn-529)），机器代理在第一次启动时就会落入 `uso()`（[RN-544](#rn-544)），写入一个永远起不来的服务，就是本模块处处拒绝的「错误的安装留在原地」——基目录以「注入」方式进入（`DependenciasDeInstalacao.resolverBase`），与其他四个依赖一样，这样 `servico.ts` 仍然不会自行读取磁盘或环境。

**unit 冻结 `XDG_CONFIG_HOME`，绝不冻结基目录的「值」。** 这与 [RN-518](#rn-518) 中 `PATH` 的决定相同，后果更大：正是这个变量决定基目录文件住在「哪里」（`base.ts`），而 `systemd --user` 不传递安装者 shell 的环境——没有它，一个把该变量指向 `~/.config` 之外的用户，服务会读到错误的基目录，或者读不到。基目录的值有意不放进去：更换它仍然是编辑文件并重启，绝不是重新安装，这正是 `base.ts` 的 docblock 在拒绝「只用 `--base` 标志」时已经主张的。

**机器 unit 的 `apiUrl` 读取 `BRABO_API_URL`，项目 unit 不读。** 「项目」计划的优先级逐字节不变（`--api-url` › 那个文件夹的配置 › 默认值），因为那里有一个文件在回答。在机器计划中，这个文件是按项目的，用不上，所以没有这个变量的话，`--api-url` 唯一的替代就是默认的 `localhost`——在设置了 `BRABO_API_URL` 的 shell 中安装会静默生成一个指向错误地方的 unit。它进入 `ContextoDoServico`（`apiUrlDoAmbiente`），绝不直接从 `process.env` 读取。

**当另一个种类已安装时，`install` 会「拒绝」，且什么都不删除。** 机器代理服务其密钥所有者在 `runner` 模式下的「每个」项目；在它之上再加一个按项目的 unit（或反过来），会让两个进程争夺同一个 `terminal:<projectId>`，服务器会拒绝其中一个——很可能是人刚刚安装的那个，这是发现问题最糟糕的顺序。这一拒绝与该文件中已有的 root 拒绝采用「同一」标准：*"instalar e avisar deixaria a instalação errada de pé, e a
mensagem seria lida uma vez só"*。已存在的 unit 保持完好，消息点名每个的 `uninstall`，并且**没有 `--force`**——一个能推倒症状沉默的守卫的标志，会把沉默的症状带回来。这「不」违背 ADR 第 5 点：它保证的是已安装的按项目 unit 继续工作，而它确实逐字节继续工作；被拒绝的是「现在」制造重叠。

**`status` 回答所询问的种类，四种状态不会变成八种。** 退出码仍然是「被询问」unit 的（[RN-088](web.md#rn-088)）——把两者相加会抹掉是哪一个在请求关注，就像把五个决策队列相加会抹掉哪个队列是哪个一样。共存以「文字」显示，并且是来自**磁盘**的回答：另一个种类的 unit 按名称列出，不向管理器询问各自的状态，输出会「说明」它没有询问。这就是 ADR 0154 第 5 点的兑现——*"deixar seis processos disputando três projetos em silêncio"* 正是这一块存在就是为了防止的缺陷。没有 `--machine` 且没有可解析的项目时，主体是**机器** unit（唯一一个名称不需要参数的），输出为想要另一个的人点名 `--project`；在本 RN 之前，同样的输入回答的是「需要知道是哪个项目」，对于拥有安装程序恰好产生的那种安装的人来说，这是一个问题而不是答案。

**`uninstall` 「不」继承这个默认值，这种不对称是有意的。** 读错种类的代价是一行错误；删错种类的代价是一个服务和一把设备密钥。没有 `--machine` 且没有可解析的项目时它会「拒绝」，列出磁盘上存在的东西以及各自的确切命令——绝不两者都删，那会删得比所要求的更多。

**`Restart=on-abnormal` 逐字节保持，两个种类都是。** exit 1 是致命的 join 拒绝或耗尽的重试上限，重启就是 CLI 拒绝自行进入的循环（[RN-514](engine.md#rn-514)）。此外：RN-544 让**空列表以 0 退出**，恰恰是为了让 `on-abnormal` 不在新安装中重新拉起服务——那里没有要服务的东西——，换成 `on-failure` 会一次推翻这两个决定。

- **代码：** `apps/runner/src/servico.ts`（`AlvoDaUnidade`、`ALVO_DE_MAQUINA`、
  `alvoDeProjeto`、`resolverEspecie`、作为联合的 `PlanoDeInstalacao`、
  `caminhoDaUnidade`/`projetosInstalados`/`maquinaInstalada`、
  `prepararPlanoDeProjeto`/`prepararPlanoDeMaquina`、`recusaDeSobreposicao`、
  `linhasDoQueExiste`/`linhasDeCoexistencia`、
  `ContextoDoServico.apiUrlDoAmbiente`、
  `DependenciasDeInstalacao.resolverBase`、`SistemaDeServico.listarPasta`）；
  `apps/runner/src/servico-sistema.ts`（基于 `readdirSync` 的 `listarPasta`）；
  `apps/runner/src/index.ts`（基于 `resolverBaseConsentida` 的 `resolverBase` 适配器、`apiUrlDoAmbiente`、用法文本）
- **测试：** `apps/runner/src/servico.spec.ts`——`service install --machine`（没有 `--project`/`--dir` 的 unit、名称不冲突、冻结 `XDG_CONFIG_HOME` 而不冻结基目录值、launchd 的 Label 和日志、`BRABO_API_URL`）以及五种自己的拒绝（文件夹中有项目配置、没有基目录、基目录无效、没有密钥、`--machine` 与 `--project` 同时出现）；以及两个种类不重叠（在「两个」方向上拒绝且什么都不删除、每一侧的 `status` 都说明另一侧而不相加退出码也不询问管理器、不带参数的 `status` 落到机器、`uninstall --machine` 让项目 unit 保持完好，以及不指定种类的 `uninstall` 拒绝并列出两者）
- **已「声明」的缺口：** `install --machine` **不知道**那个文件夹的密钥是否真的是机器密钥——在磁盘上两个种类是同一种文件，一个带 `kid` 的 JWK（[RN-475](web.md#rn-475)），知道的是「服务器」（[RN-544](#rn-544)）。一个带「项目」密钥的文件夹会毫无错误地安装 unit，拒绝只在第一次启动时以 `CredencialNaoEDeMaquinaError` 出现。在 `install` 中核实需要在一个今天不做任何网络调用的子命令中进行网络调用，而捏造本地猜测会产生 RN-544 拒绝过的第二个真相来源。并且，在本 RN 那时，没有人「创建」机器密钥：登记它的是 `install.sh`（[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 4 点），在第 6 次会话——本次会话交付它将调用的子命令，而它调用的路由在 [RN-552](api.md#rn-552) 中到来
- **ADR：** [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **来源：** FASE 30，第 4 次会话——

---

## 机器代理等待第一个项目，密钥在终端中诞生（RN-550/551，FASE 30）

### RN-550 — 连接数为零时本地代理「不」退出：它等待并重新查询列表；有活动连接时查询仍然只在启动时进行 {#rn-550}

[FASE 30](../explanation/fase-30-runner-por-maquina.md) 的第 8 次会话。[RN-544](#rn-544) 让空列表成为「正常」状态，进程以 **0** 退出，并说 *"crie um projeto em modo Runner e suba o agente de novo — a lista é
consultada só no start"*。这与 [ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 5 点白纸黑字地矛盾——*"ele
**espera**… quando a pessoa criar o primeiro projeto na web, o agente já está
lá"*——并恰恰破坏了本阶段所追求的情况：新安装，即项目数为零的安装。安装程序启动代理，代理发现什么都没有就离开了，而几分钟后创建第一个项目的人会回到终端，却从未被告知这一点。

**规则是「不对称」的，不对称就是设计：**

```
conexões > 0  →  a lista é consultada SÓ no start   (a RN-544 fica byte a byte)
conexões = 0  →  reconsulta, com cadência declarada
```

**它「不」推翻 RN-544 的决定。** 那次会话的论点完整保留：一个变「短」的列表是有歧义的——项目被删除、模式被转换、角色被吊销，或一个伪装成这三者的瞬时 500——，因为这种歧义断开「活动」连接，会把一个确定的状态换成一个猜测。连接数为**零**时没有可断开的东西，也没有任何歧义：出现的任何项目都是纯收益，不会对消失的东西做出任何决定。重新查询在第一个非空列表到达的那一刻**停止**，此后的行为逐字节与今天相同——只要进程活着，等待模块就不会再被调用。

**`exit 0` 的论点不成立，因为它的前提不成立了。** RN-544 写道 *"ficar de pé com zero conexões seria um serviço 'ativo' que não faz nada, e
o `status` da unit passaria a mentir"*——而这依赖于进程什么都不做。本 RN 移除的正是这个前提：它以声明的节奏重新查询，并「说明」自己在这样做。`active (running)` 变为真实，撒谎的是以 0 退出，它恰恰在人要创建第一个项目的那一分钟让新安装没有代理。

**节奏逐级递增并「稳定」：15 秒、30 秒、60 秒，最后一个永远重复。** 两个短档存在，是因为要照顾的情况是有人「现在」正在创建第一个项目；以分钟计的上限会让代理在人放弃观看之后才出现。60 秒的平台是常态下的代价——一次安装每分钟「一个」请求，针对一个返回凭据所有者自己列表的路由。再增长就是节省没人在付费的流量，而让等待唯一交付的东西变差。

**有上限，而它是「失败」的上限，绝不是等待的上限。** 等待没有限制——等待是新安装的正常状态，可能持续数天。有上限的是查询的**连续**失败：十次，之后进程以 1 退出并「点名」这个数字，就像连接循环对 `TETO_DE_TENTATIVAS_SEGUIDAS` 已经做的那样，原因也相同（问题不是暂时的时候，不永远捶打 api）。一次「有回应」的查询会把计数器清零——包括回应为「空」时，这是成功，因为空列表就是正确答案。这个常量有意「分开」，值相同：一个计数「连接」的失败，另一个计数「列出」的失败，把它们绑在一起会让连接节奏的改动在没人要求的情况下改变新安装放弃前等待的时间。`CredencialNaoEDeMaquinaError`（按密钥种类的 403，[RN-544](#rn-544)）**不**计入上限：它当场就是致命的，因为项目密钥不会因为多等一分钟就变成机器密钥。

**静默地保持运行比退出更糟。** 对读 `journalctl` 的人来说，「等待中」和「卡住了」是同一幅画面，所以进程在进入等待时说明节奏，在第一个项目出现时说明，并每 30 次查询（在平台期是半小时）打一次「心跳」，告知已经查询了**多少**次。也有意不让每次查询都变成一行：每分钟一条日志、永远持续，正是会埋没重要行的噪音。

**`Restart=on-abnormal` 逐字节保持，在「两个」unit 种类中都是（[RN-545](#rn-545)），它们中没有任何改变。** 已测量：`on-abnormal` 因「信号」、watchdog 或超时而重新拉起——绝不因退出码，无论 0 还是 1。以 0 退出从来不是阻止服务被重新拉起的原因；阻止它的是 `on-abnormal` 不看任何退出码。这一变化的真实效果与所担心的相反：运行这种模式的「机器」unit 开始真正保持 `active (running)`，而不是在启动几秒后以 `inactive (dead)` 结束——在新安装中，`service status --machine` 开始回答 `rodando` (0)，而之前回答 `parado` (3)。按「项目」的 unit 一行都不受影响：它运行 `projeto` 模式，永远到不了这里。

**一个已声明的例外：所有项目都被拒绝的「非空」列表仍然以 1 退出。** 这也是零条连接，但仍然不等待——因为那里每个拒绝都点名了一个具体的本地缺陷（逃出基目录的段、是文件的文件夹），有自己的修复办法，而重新查询会无限重复同样的拒绝，把说明该修什么的那一行埋进日志。等待是为了 *"ainda não existe projeto"*，绝不是为了 *"existe e eu não consigo atendê-lo"*。

- **代码：** `apps/runner/src/espera-de-projetos.ts:127`
  （`esperarPrimeiroProjeto`）、`:60`（`CADENCIA_DA_ESPERA_MS`）、`:75`
  （`TETO_DE_FALHAS_DE_CONSULTA`）、`:88`（`CONSULTAS_POR_BATIMENTO`）；
  `apps/runner/src/index.ts:1465`（`rodarComoAgenteDeMaquina` 中的等待，以及紧随其下的被拒绝项目的例外）
- **测试：** `apps/runner/src/espera-de-projetos.spec.ts`——正常路径（等待、重新查询、返回第一个非空列表并在那里「停止」）、稳定下来的节奏、每 N 次查询一次心跳、带数字的消息的连续失败上限、中途的回应把计数器「清零」、种类 403 原样上抛，以及 SIGTERM 返回 `parado`；
  `apps/runner/src/index.spec.ts`——真实「进程」中的衔接，针对一个返回 `[]` 的假 api：进程「说明」自己保持运行并且**不终止**，而这正是之前的缺陷
- **ADR：** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 5 点
- **来源：** FASE 30，第 8 次会话——
  [阶段的范围划定](../explanation/fase-30-runner-por-maquina.md)

### RN-551 — `brabo-runner device-key create`/`finish`：Ed25519 密钥对在「机器上」诞生，私钥从不传输，runner 读取的文件绝不会在没有 `kid` 的情况下存在 {#rn-551}

[FASE 30](../explanation/fase-30-runner-por-maquina.md) 的第 8 次会话，另一半。在此之前，**只有浏览器**生成设备密钥对（`apps/web/src/lib/runner-bootstrap.ts`，[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)，[RN-464](api.md#rn-464)）；CLI 只会**读取**别人放在文件夹里的东西（`device-key.ts`）。[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 4 点要求另一边：*"o par é gerado **na máquina**; a privada nunca
viaja… mantém verdadeira a frase que a RN-519 usa para recusar a visão de
`maintainer`: 'a privada de uma chave de dispositivo nunca sai do navegador' —
passa a ser 'nunca sai da máquina'"*。没有它，[RN-543](produto.md#rn-543)、[RN-544](#rn-544) 和 [RN-545](#rn-545) 都带着同一个已声明的缺口：**没有人创建机器密钥**。

**这是「两」步，原因在于 `kid`。** 写在私有 JWK 之内的 `kid` 「就是」服务器上登记的 id（[RN-475](web.md#rn-475)）——整条链只是「转交」它（runner 读取 `jwk.kid`，JWT 把它放在头部，`PatAuthGuard` 凭它找到公钥），没有人从别的东西推导它。它只在公钥登记**之后**才存在，在那之前写入的私钥生来就无用，这正是 RN-475 花了一番追查才找到的那个缺陷。浏览器的解决方式是在登记与写入之间把密钥对保存在「内存」中；CLI 的解决方式是一个**不完整（PARCIAL）**文件：

```sh
PUB=$(brabo-runner device-key create)          # gera aqui, imprime a PÚBLICA
ID=$(… registra PUB na api …  | jq -r .id)     # quem registra é o instalador
brabo-runner device-key finish --id "$ID"      # carimba o kid e grava
```

**任何时刻都不存在没有 `kid` 的 `brabo-runner-device-key.jwk.json`。** `create` 写入 `…jwk.json.parcial`，这是 `lerChaveDeDispositivo` 不会查找的名字；`finish` 盖上 kid 并写入真正的名字。runner「读取」的文件要么完整，要么不存在，两步之间的中断会留下一个 runner 「忽略」、下一次 `create` 会「点名」的 `.parcial`——说明那次尝试的登记可能已成为「孤儿」，它是惰性的，并出现在 [RN-519](api.md#rn-519) 的列表中。

**CLI 「不」和 api 对话，原因在于「密钥」，而非技术。** 登记机器密钥的是安装程序，由它刚刚生成的 `BRABO_SERVICE_TOKEN` 认证（[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 1 点）。让 `brabo-runner` 调用该路由，就需要把这个令牌交到它手上——一个「安装」级的密钥，能打开内部路由，交给一个今天只看到设备凭据、并且永远在用户机器上运行的进程。切分正好相反：**每一边恰好保管一个密钥，谁也看不到对方的**。穿过两者之间边界的是「公钥」JWK 和 id——没有任何需要保护的东西。

**默认目标是机器的配置文件夹，优先级是「复用」的。** `$XDG_CONFIG_HOME/brabo/`（否则为 `~/.config/brabo/`），紧挨着 [RN-529](#rn-529) 的 `runner.json`，原因相同——这是「机器」的配置，而机器密钥没有可以住的项目文件夹。`pastaDeConfiguracaoDoBrabo` 在获得第二个消费者时从 `caminhoDoArquivoDeBase` 中「抽取」出来，绝不是复制。这**不会**重新打开 [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md) 第 2 波所关闭的那扇门（全局且「隐式」路径中的凭据）：`device-key.ts` 仍然只从调用方传入的 `cwd` 读取，而指向这个文件夹的是机器 unit 的 `--dir`（[RN-545](#rn-545)），显式地写在服务中。`--dir` 存在并服务于
项目文件夹——在磁盘上两个种类是同一种文件，知道区别的是「服务器」（[RN-544](#rn-544)）：这个命令不断言任何种类。

**私钥以模式 600 写入，显式设置，绝不交给 `umask`。** 当文件夹由「本」命令创建时，它以 700 诞生；已经存在的文件夹属于用户（可能是浏览器配置的那个），不会被重新收紧。`--dir` 经过 [RN-434](#rn-434) 的「同一个」`validarDirDentroDoHomeNoLinux`，完整复用：写入的是用户的密钥，而位于其 `$HOME` 之外的文件夹不是他的 `systemd --user` 会去找的地方。

**stdout 携带「一个」值，占一行，其余全部是 stderr。** 这是 `install.sh` 所依赖的契约（`PUB=$(…)`）：把两者混在一起会迫使脚本过滤给人看的输出，而契约就是这样在无人察觉中被打破的。在 `create` 中 stdout 是公钥 JWK；在 `finish` 中是文件的「路径」——下一步（`service install --machine
--dir <pasta>`）需要的值。

**覆盖完整的密钥会被「拒绝」，没有 `--force`。** 替换一台已配对机器的密钥，会静默地替换一个「现在」可能正在运行的代理的身份：公钥仍然登记着，而进程会开始用一把没人知道的密钥签名。拒绝点名动作（吊销、删除、重建），而一个能推倒症状沉默的守卫的标志，会把沉默的症状带回来。

- **代码：** `apps/runner/src/criar-chave-de-dispositivo.ts:202`
  （`criarChaveDeDispositivo`）、`:275`（`finalizarChaveDeDispositivo`）、`:82`
  （`SUFIXO_PARCIAL`）、`:177`（`resolverDestino`）；`apps/runner/src/base.ts:85`
  （`pastaDeConfiguracaoDoBrabo`，抽取而来）；
  `apps/runner/src/index.ts:1280`（在 `lerArgumentos` 之前的分派，以及 stdout/stderr 的分离）
- **测试：** `apps/runner/src/criar-chave-de-dispositivo.spec.ts`——端到端的正常路径（stdout 中的公钥、600 的 parcial、`finish` 盖上 kid，以及得到的密钥被 `lerChaveDeDispositivo` 读取并「签署」一个真正的票据 JWT）、`--dir`，以及拒绝：没有 `create` 的 `finish`、没有 `--id`、`--id` 粘贴了整个 JSON、完整密钥已在原处（两个命令都是）、不是 JWK 的 parcial、未知子命令以及孤儿警告；`apps/runner/src/index.spec.ts`——真实进程中的「衔接」：`device-key create` 在一个「没有」任何凭据的文件夹中运行，stdout 只包含公钥 JWK
- **已「声明」的缺口，两半都已「关闭」：** 本 RN 关闭时，本仓库中不存在「登记」公钥的一方——路由在 [RN-552](api.md#rn-552) 中到来，串联两个命令的 `install.sh` 在 [RN-547](produto.md#rn-547) 中到来。这个命令所假定的契约就是「项目」密钥路由已有的契约（`{ name, publicKeyJwk }`，其中 `publicKeyJwk` 是 Ed25519 公钥 JWK 的 JSON——`kty` "OKP"、`crv` "Ed25519"、`x`——回应带 `id`），而这正是 `create` 的 stdout 所产生的：一行这种格式的内容。该命令也有意**不**选择设备的 `name`——它是登记的字段，命名的是登记的一方
- **ADR：** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 4 点
- **来源：** FASE 30，第 8 次会话——
  [阶段的范围划定](../explanation/fase-30-runner-por-maquina.md)

---

## 穿不过本地代理容器的凭据（RN-558）

### RN-558 — 容器处于活动状态时，`exec` 中的凭据被 runner「拒绝」，结果被点名，来源为 `politica` {#rn-558}

在关闭 [RN-507](#rn-507)/[RN-508](api.md#rn-508)（[ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md)）时以书面形式声明的缺口，在这里写下任何一行之前被逐环重新测量。

**链条，已测量。** `Engine.Runners.RunnerReadiness.verificar/1`（`runner_readiness.ex:52`）在 `Engine.Actions.Workspace.RunnerGit` 的「任何」操作之前都要求有已「登记」为 `running` 的容器——包括初始的带认证 `git fetch`，它出自 `fetch!/3`（`runner_git.ex:226`，经由 `:288` 处的 `exec/4`）。在 `runner` 项目中，这条登记存在的「唯一」方式，是「同一个」runner 启动了自己的容器（[ADR 0137](../adr/0137-o-runner-sobe-o-container-do-projeto.md)），而正是这次成功在它那里标记了 `estado.containerAtivo`（`apps/runner/src/index.ts:822`，在 `tratarContainerStart` 中）。设置了 `containerAtivo` 后，`tratarExec` 把命令路由到容器内部（`index.ts:728`–`730`，以及 `:693` 处的新拒绝），而 `packages/docker-port` 的 `exec` 操作**没有 `env` 字段**——这是有意的（[ADR 0130](../adr/0130-broker-de-container.md)：没有任何自由的 `-e`）。RN-507 加到 `exec`/`exec_result` 对上的 `env` 字段（`RunnerRouter.exec/5`，`runner_router.ex:50`；`ExecMessage.env`，`apps/runner/src/channel.ts:62`）只在「宿主机」路径上应用，在那里 `apps/runner/src/exec.ts:94` 把它「合并」到 `process.env` 之上。

结果：在 RN-507 让带认证的 `fetch` 运行的那一刻，容器几乎总是已经在「同一个」runner 中运行——而正是在那里，凭据（[ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md)，`GitAuth.env_de_auth/1`）被丢弃，**悄无声息，没有错误**。`git` 在用 `-c` 安装的临时 helper 和两个「空」变量下运行，以认证失败退出——与令牌无效、权限错误或网络中断无法区分。人在追查错误的东西，而产品什么都没说。

**修复是「点名」的结果，而不是交付凭据。** `docker
exec` 仍然没有 `env` 字段——改动它就是改变约束端口，属于 ADR 的决定，而不是取舍（见下面声明的缺口）。改变的是：(`env` 存在、容器活动) 这一组合不再被执行，而是被**拒绝**，带有标记、消息和来源。

**拒绝的是「RUNNER」，也只有它能。** 它是唯一同时知道两半的进程：命令携带凭据，以及它将进入容器内部。engine 不知道后一半，这一点已被「测量」：`estado.containerAtivo` 在 runner 每次执行时都初始为 `null`（`index.ts:1449`），只由 `tratarContainerStart` 设置，所以一个容器
在数据库中被「登记」为 `running`，**并不意味着**容器在那个进程中是活动的——一个在容器运行时重启的 runner 会路由到「宿主机」，凭据在那里正常到达。把检查上移到 `RunnerReadiness` 或 `RunnerGit` 会拒绝一条可行的路径。而 `RunnerReadiness` 「逐字节」保持原样：它不获得标志，也不获得第四个前置条件——这与 [RN-516](#rn-516) 已经阐明的「不给它挂一个『跳过容器』标志」是同一条规则。

**「标记」是「协议」常量，不是消息细节。**
`MARCA_DE_CREDENCIAL_NAO_ENTREGUE`（`index.ts`）和 `@marca`（`credencial_de_git.ex`）携带「同一个」令牌，engine 正是凭借它——而不是语句——在拒绝穿过一个 `rescue` 并变成散落的字符串之后识别出它。只改一边不会让任何东西编译失败：拒绝照样发生，只是「分类」重新出错，这恰恰就是本 RN 所关闭缺陷的形态。两个测试套件都到达不了另一种语言（ExUnit 不读 TypeScript，runner 的 vitest 不读 Elixir），所以守卫住在 `scripts/ci/` 中，和其他把整个仓库当作文本读取的测试在一起。

**来源是 `politica`，这一选择指向「行动」。** [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) 的四种来源不分配责任，它们说明该做什么。这不是没人写的子句（`codigo`），也不是断掉的网络（`infra`）：这是 ADR 0130 的约束按设计运作，面对一个它没有预见的情况。读到 `politica` 的人知道没有 bug 要追——有一个待定的产品决定。`Engine.Runners.CredencialDeGit.desfecho/1` 增加「一个」情况，不重新分类任何其他情况：任何其他 worktree 失败在「两个」dev agent（真实的那个，以及 Noop——它的存在是为了演练「这条」路径而不是它的拷贝）中都逐字节保持 `{"falha ao preparar o worktree", "codigo"}`。

**「约束」拒绝优先，顺序是决定。** 它位于 `validarCwdDentroDaRaiz`（`guard.ts`）「之后」：指向根之外的命令需要听到**那个**，因为那里拒绝的是一道约束边界，而这里缺的是一项能力。把两者坍缩会让一个越界命令看起来像凭据问题——同样的诊断缺陷，只是信号不同。

**`env` 绝不出现在拒绝中——只有「计数」。** RN-507 的不变量是 `msg.env` 不进入任何日志，而这个输出会进入产品的 event log：拒绝说的是「2 variável(is) de ambiente」，绝不是名称或值。这个数字已经说明了那里需要知道的东西。

**「不」受影响的，经阅读确认：** `local` 仓库（没有令牌的 provider）——`GitAuth.env_de_auth/1` 返回 `[]`，`fetch!/3` 把它转换为 `nil`，该字段甚至不进入 payload，拒绝不会触发；`container` 和 `mounted` 模式——从不经过 `RunnerGit`（`Workspace.ensure!/4` 按 `execution_mode` 分叉，只有 `runner` 会去那里），它们的容器通过 broker 在网络另一端启动；以及普通的终端命令，它从不携带 `env`。`workspace_create` 也携带 `env`，同样不受影响：它在「宿主机」上运行（`criarPastaDoProjeto`），而不是在容器中。

- **代码：** `apps/runner/src/index.ts`（`MARCA_DE_CREDENCIAL_NAO_ENTREGUE` 以及 `tratarExec` 中的拒绝，位于 `cwd` 校验之后），`apps/runner/src/channel.ts`
  （`ExecMessage.env` 的 docblock，它曾承诺「roda só sem a credencial」），
  `apps/engine/lib/engine/runners/credencial_de_git.ex`（新增——标记、
  `recusada?/1`、`mensagem/2` 和 `desfecho/1`），
  `apps/engine/lib/engine/actions/workspace/runner_git.ex`（`fetch!/3` 中的新子句，位于通用子句之前，以及 moduledoc），
  `apps/engine/lib/engine/dev/dev_agent_server.ex` 和
  `apps/engine/lib/engine/dev/noop_dev_agent_server.ex`（创建 worktree 时 `{:error, reason}` 的结果）
- **测试：** `apps/runner/src/index-handlers.spec.ts`，块 *"a credencial não
  atravessa o docker exec (RN-558)"*——正常路径（没有容器，`env` 到达宿主机，什么都不拒绝）、失败用例（有容器，点名的拒绝，且「不」调用 `docker.exec`）、变量的名称和值不在输出中泄露的否定证明、空 `env` 不变成拒绝，以及 `cwd` 位于根之外时 `guard.ts` 的约束拒绝优先于本拒绝；
  `apps/engine/test/engine/actions/workspace_runner_test.exs`（两个 `RN-558` 测试：变成来源为 `politica` 的点名消息的拒绝，以及保留一贯消息、来源为 `codigo` 的「真实」fetch 失败——证明新子句没有劫持旧子句的否定对）；
  `apps/engine/test/engine_web/channels/credencial_no_runner_test.exs`（AT-111，经由真实 `TerminalChannel` 的完整「链条」：`env` 只在 `fetch` 中到达频道，runner 的回应是 fixture
  `apps/runner/fixtures/exec-result-recusa-de-credencial.json`——runner 的 spec 把它与 `tratarExec` 的真实输出逐字节比较——，`RunnerGit` 返回点名的消息，`DevAgentServer` 以来源 `politica` 写入 `dev.blocked`；再加上没有活动容器的分支，其中 `fetch` 回应 0，以及仍为 `codigo` 的真实失败。它「不」通过执行证明跨语言的桥梁：ExUnit 中不会启动任何 `node` 进程，闭合它的是共同的 fixture。经变异验证：在频道中、在 `RunnerGit` 中切掉 `env`，或者切掉拒绝的识别、`desfecho/1` 或 dev agent 对它的使用，都会让测试失败；关闭 `tratarExec` 中的拒绝会让 runner 的 spec 失败）；
  `scripts/ci/marca-de-credencial-do-runner.spec.ts`（两边相同的标记）。经变异验证：使 `fetch!/3` 的子句失效会让 engine 的测试失败，并显露旧消息
- **已「声明」的缺口，即仍然开放的那「一半」——由 [RN-676](#rn-676)「关闭」（[ADR 0193](../adr/0193-git-credenciado-no-host-do-runner.md)，负责人 10月1日 的决定）：** 带凭据的 fetch 由 engine「标记」后发出，即使容器处于活动状态，也在 runner 的宿主机上运行；本拒绝缩小为「不带」标记的 `env`（实践中是 ADR 0193 之前的 runner）。下面的文字是它关闭沉默那一半时的文字：凭据仍然**穿不过** `docker exec`。在 `runner` 模式下、容器运行时，带「认证」的远程仓库克隆/fetch 仍然不可能——变化的是，现在它失败时会「说明」这一点，而不是看起来像令牌错误。关闭它需要决定带凭据的操作「如何」与一个没有 `env` 字段的 `docker
  exec` 对话，而已知的选项都会触动 ADR 0130 的约束端口（给操作一个 `env`；挂载后删除的凭据文件；即使容器活动也在宿主机上运行 `fetch`，那会打破「工作发生在容器内」的不变量）。这是 ADR，绝不是顺手的修正。本次交付也声明了的「相邻」问题——拒绝发生在 `init_from_bare!/5` 已经执行 `git init` 「之后」，而 `ensure!/5` 的 `git_dir?/2` 会在下一次尝试中因找到 `.git` 而把 workspace 标记为就绪，于是第二次尝试会在后面的 `worktree add` 处失败，而不是重复拒绝——**已在 AT-112 中关闭**：失败的初始化（任何一步，不只是带凭据的 `fetch`）会「撤销」它自己创建的 `.git`（`Engine.Actions.Workspace` 和 `RunnerGit` 中的 `inicializar_ou_desfazer!`）并重新抛出原始异常，于是下一次尝试会重复「同一个」原因。撤销只在原本「没有」`.git` 的分支中运行——「标记之前的 workspace」那一支（有 `.git` 且不重新初始化）保持不变，所以不会删除任何人的工作。在 `runner` 一侧，`rm -rf` 是尽力而为（runner 可能已经掉线，这正是失败的原因之一）。考虑过并拒绝的信号：「进行中」标记（又一个要维护的文件，若进程在两步之间死去就会成为孤儿）以及检查预期的 ref（空仓库没有 `origin/<branch>`，这是「合法」状态，却会被当作失败）
- **ADR：** 没有新的——本次交付不移动任何边界。它「消费」[0130](../adr/0130-broker-de-container.md)（没有 `env` 的端口）、[0137](../adr/0137-o-runner-sobe-o-container-do-projeto.md)（用户机器上的容器）、[0145](../adr/0145-docker-pre-requisito-do-runner.md)（前置条件和 `env` 字段）以及 [0020](../adr/0020-destravar-gates-qa-secops.md)（四种来源）
- **来源：** `AT-053`——ADR 0145 以书面形式留下声明的缺口

---

## 带凭据的 git 在 runner 的宿主机上运行（RN-676）

### RN-676 — 容器活动时，带凭据的 `git fetch`（属于 `RunnerGit`）在 runner 的「宿主机」上运行，由 engine 标记；代码仍在容器中 {#rn-676}

负责人的决定（10月1日），记录于 [ADR 0193](../adr/0193-git-credenciado-no-host-do-runner.md)：「带凭据」的 git 操作在 runner 的宿主机上运行，代码在容器中运行。它关闭了 [RN-558](#rn-558) 留下的另一半——`runner` 模式下容器运行时的认证 fetch，这是常见路径，过去总是以命名的拒绝结束。

1. **由 engine 标记，且只在一个地方。** `RunnerGit.fetch!/3` 通过 `RunnerRouter.exec_git_credenciado/5` 派发带凭据的 fetch，它放入 `gitCredenciado: true`，在 `exec` payload 中，并以守卫要求 `env` 非空。dev agent 的终端命令经过 `RunnerRouter.exec/4`，从不带标记。没有凭据时（provider `local`），fetch 不带标记。
2. **runner 只在「同时满足」时在宿主机上运行**：字面的 `true` 标记 **和** 非空的 `env`。此时命令交给 `executarComando`（`env` 合并到 `process.env` 之上），即使容器是活动的。文件夹相同：`estado.dir` 是 `/work` 的 bind-mount。
3. **没有标记的 `env` 不会得到宿主机。** 容器活动时，这一组合仍以 RN-558 的标记和 `politica` 来源被「拒绝」。目前 engine 没有任何调用方会产生它；实践中它来自 ADR 0193 之前的 `brabo-runner`，后者不读取标记——engine 的消息会提示更新它。没有 `env` 的标记也不改变任何东西：命令交给容器。
4. **隔离不变**：`DockerPort.exec` 仍没有 `env`（ADR 0130），`RunnerReadiness`（RN-507）逐字节不变——标记决定 runner 在「哪里」执行，绝不决定 engine「是否」派发。
5. **日志绝不包含 `env` 中变量的名称或值**：拒绝给出计数，宿主机路径的日志只追加 `[git credenciado, no host]`。

- **代码：** `apps/runner/src/index.ts:694`（`gitCredenciadoNoHost`），`:659`
  （`tratarExec`）；`apps/runner/src/channel.ts:71`（`gitCredenciado`），`:627`
  （`gitCredenciado`）；`apps/engine/lib/engine/runners/runner_router.ex:93`
  （`exec_git_credenciado`），`:98`（`despachar_exec`）；
  `apps/engine/lib/engine/actions/workspace/runner_git.ex:338`（`exec`），`:426`
  （`despachar`）；`apps/engine/lib/engine_web/channels/terminal_channel.ex:609`
  （`git_credenciado`）；`apps/engine/lib/engine/runners/credencial_de_git.ex:93`
  （`mensagem`）
- **测试：** `apps/runner/src/index-handlers.spec.ts:366`（`git` 的真实 helper 在容器活动时于宿主机上收到凭据——正常路径），
  `:391`（真实的 `git fetch origin` 在宿主机上成功），`:430`（没有标记的 `env` 仍被拒绝——失败情形）；`apps/runner/src/channel.spec.ts:208`；
  `apps/engine/test/engine/actions/workspace_runner_test.exs:451`，`:466`，
  `:476`；`apps/engine/test/engine_web/channels/credencial_no_runner_test.exs:149`
  （AT-111：经过真实 `TerminalChannel` 的链路以 `{:ok, _}` 结束），`:177`。
  ExUnit 测试没有在此次交付的环境中运行（`repo.hex.pm` 403）；由 CI 证明。
- **来源：** AT-116（证明：AT-111），负责人 10月1日的决定

## 重新启用的 Anamnese：合格的对象与档案事实（RN-680）

### RN-688 — runner 的二进制在 Bun 下用自己的读取器读取 PTY，自检证明「第二次」读取 {#rn-688}

在 Bun 下（`bun build --compile` 的二进制，[ADR 0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)），`tty.ReadStream`（`node-pty` 用它读取 PTY 主端）是一个 `fs.ReadStream`，非阻塞 fd 上第一次没有数据的读取会以 `EAGAIN` 「抛出」：流自我销毁，关闭 fd，此后不再有任何 `onData`（oven-sh/bun#25822）。二进制的交互式终端在「三个」Unix 平台上都在第一段输出后停止；Linux 能通过测试只是因为第一次读取已经同时带回了回显和回答。

**规则：** 在 Bun 下且不在 Windows 上，`spawn`（属于 `node-pty`）运行时会把 `tty.ReadStream` 换成一个自己的读取器，它用 `fs.read` 读取「同一个」fd，遇到 `EAGAIN` 时「等待」并重试（从 4 ms 开始，翻倍直到 32 ms，每次有数据就回到最小值）；`EIO` 或零字节表示结束。替换只在 `spawn`「期间」有效，即使它抛出也会恢复；在 Node 下模块保持「原样」。fd 和子进程仍是真实的——不模拟任何输出。并且 `--self-test-pty` 做「两」轮，第二轮在一段无可读内容的停顿之后：正是这段停顿迫使读取经过一次 `EAGAIN`，也正因此旧读取器在 Linux 上同样不通过。不通过时，自检会说明原因（数据段、子进程的输出、在第二个 PTY 上的探测以及流的事件）——裁决不变。

正是探测测得了 Windows 的情况：在那里读取端是 ConPTY 的命名管道，由 `node-pty` 作为 `net.Socket` 打开，没有读取器可以接管的 fd，而管道在第一段之后就结束了——因此 `win32-x64` 被移出了矩阵（[ADR 0187](../adr/0187-runner-sem-binario-win32-x64.md)），而不是加一个变通方案。

- **位置：** `apps/runner/src/leitor-de-pty.ts:60`（`precisaDoLeitorProprio`），
  `:70`（`LeitorDeFdNaoBloqueante`），`:115`（`agendar`），`:152`
  （`comLeitorDePtyProprio`）；`apps/runner/src/native-pty-loader.ts:114`
  （`comLeitorDePtyProprio`）；`apps/runner/src/index.ts:1268`
  （`PAUSA_ENTRE_VOLTAS_MS`），`:1291`（`sondarPty`），`:1346`
  （`rodarAutoTestePty`）
- **测试：** `apps/runner/src/leitor-de-pty.spec.ts:14`（只在 Bun 下且不在 Windows 上），`:23`（在此之外，是「同一个」模块），`:28`（只在 `spawn` 期间替换，它抛出时会恢复——失败情形），`:48`（真实 `cat` 的两轮，中间有 `EAGAIN`）；端到端的证明是矩阵中的 `smoke:bin`，在 `darwin-arm64`、`linux-x64` 和 `linux-arm64` 上为绿，演练 `36779817686`
- **ADR：** [0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)，
  [0187](../adr/0187-runner-sem-binario-win32-x64.md)
- **来源：** AT-342，AT-343
