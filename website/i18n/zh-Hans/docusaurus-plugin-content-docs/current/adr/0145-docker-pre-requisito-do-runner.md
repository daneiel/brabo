---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0145 — Docker 成为 `runner` 模式的真正前提

## Context {#context}

`runner` 模式（ADR 0104）为住在用户文件夹中、**没有**到服务器的 bind-mount、并由在其机器上运行的 CLI（`brabo-runner`）确认的代码而存在。自 ADR 0137（RN-497）起，同一个 CLI 也会启动**用户机器上**的 Docker 容器，而 `Engine.Actions.TerminalExecutor` 只要 workspace 已**验证**且 runner 已**连接**，就会把每一个已批准的终端命令路由到 runner——而不检查是否有任何 `running` 容器。宿主机还是容器的选择完全在 runner **内部**（`EstadoDoRunner.containerAtivo`）：有容器运行时，它通过 `docker exec` 运行；没有时，它静默地落到纯**宿主机**上，在任何隔离之外执行命令。

这让 `runner` 与 `container`/`mounted` 不一致，后两者自 ADR 0143（RN-502）起就已**拒绝**在没有已登记 `running` 容器的情况下运行终端——绝不降级为本地 `System.cmd`。对 `runner` 而言，“本地”就是用户自己的宿主机：ADR 0143 为另外两种模式关闭的同一静默回退，在这里——服务器之外——仍然开着。

第二个缺陷，自 RN-478 起就已声明却从未修正：dev agent 工作树的实体化
（`Engine.Actions.Workspace.ensure!/4`）试图在 engine 进程内**本地**执行 `File.mkdir_p!`/
`System.cmd("git", ...)`，针对的是一个只在用户机器上物理存在的路径——engine 进程没有任何通往那里的 bind-mount。之前的修正只是改进了一个不可避免的失败的**消息**；dev agent 仍然没有地方工作。

第三点，在调查中发现：`container_start`（真正启动容器的动作，ADR 0130/0133）也服务于 `runner`，但它的 payload（`imagem`/`network`/`resources`/`rationale`——Infra 从 Arquiteto 的路由中**选择**一个候选项）对这条路径从来没有意义：broker 永远到达不了 `runner` 项目的文件夹，因此没有可以据以选择的路由，启动的镜像就是早已决定的那个。

## Decision {#decision}

**Docker 成为 `runner` 模式的真正前提，没有回退到宿主机。** `runner` 要让任何命令到达用户机器所需的三个前置条件——workspace 已**确认**、runner 已**连接**、容器已**登记**为 `running`（`ProjectContainerLifecycle.running?/1`，与 `container`/`mounted` **相同**的谓词）——住在一个函数中，
`Engine.Runners.RunnerReadiness`，有两个消费者：`TerminalExecutor`（它早已检查前两个）以及下面的新模块。

**工作树的实体化改为在项目真实的容器**内部**、在用户机器上进行——经由早已执行终端的**同一个**通道。**
`Engine.Actions.Workspace.ensure!/4` 按 `execution_mode` 分叉：对 `container`/`mounted` 本地进行（不变），对 `runner` 经由 `Engine.Actions.Workspace.RunnerGit`（新增）。`RunnerGit` 执行 `git init`/`remote add`/`fetch`/
`checkout`，以及 `Engine.Dev.WorktreeManager` 所需的 `File.dir?`/`ls`/`rm_rf` 的等价操作，作为普通 shell 命令，经由 `Engine.Runners.RunnerRouter.exec/5` 传递——绝不是新机制，总是在 `RunnerReadiness.verificar/1` 确认三个前置条件之后。`WorktreeManager`（`create/3`、`remove/2`、`list/1`、
`cleanup_orphans/2`）按同一标准分叉，周期任务
`Engine.Dev.WorktreeCleanup` 开始**跳过**（而不是失败）此刻没有就绪 runner 的 `runner` 项目，对其他项目照常继续。

**`exec`/`exec_result` 协议增加一个可选的 `env` 字段。** 带认证的 `git
fetch` 需要 provider 的凭据（ADR 0056），而它只能在子进程的环境中传递——绝不在 argv 中，绝不在文件中。由于这个子进程现在诞生在用户机器上，`env`（一个
`Record<string,string>`）进入 engine 分派的 payload；runner 在 `spawn` 之前把这个 `env` **合并**到 `process.env` 之上（绝不替换——会丢失 PATH），并且绝不把它传给 `docker exec` 路径（`packages/docker-port` 中刻意不支持 `env`——见 Consequences），也不在任何日志中打印它。

**`container_start` 整体迁移为 `container`/`mounted` 专属（两者都经由 broker，RN-503）。诞生 `container_start_via_runner`，一种新的动作类型，`runner` 专属。** 与 `container_start` 同一量级（`maintainer`，默认 `require_approval`，可在 `permissions.json` 中配置）——但 schema 只有可选的 `rationale`：它不选择任何候选项，启动的是早已**决定**的镜像
（`ObterSpecDeContainerUseCase`）。`Engine.Infra.Tools.
ProposeContainerStartViaRunner`，Infra Lead 的新工具，在调用 `propose_action` **之前**被 `InfraLeadServer` 拦截——它**本地**查询（`Project.get/1` + `Engine.Runners.Registry.connected?/1`，没有 HTTP，在同一个 BEAM 进程中）`execution_mode` 以及是否有已连接的 runner，以有名称的原因拒绝，而不是盲目提出。

## Consequences {#consequences}

- **没有 `running` 容器的 `runner` 项目会失去终端和 dev agent 的工作树，直到有人提出并批准 `container_start_via_runner`。** 被接受的代价，并对照真实先例**测量**过：`container`/`mounted` 的姊妹改动（ADR 0143，RN-502）早已具有同样的形式——“开始要求以前不要求的东西”——并以 `feature/`、MINOR 发布，没有 `breaking/` 分支。在本次交付之前，没有任何现有的 `runner` 项目有保证的隔离（静默回退到宿主机恰恰是被关闭的东西），因此没有任何先前正确的行为被拿走——只是一个不安全的行为不再存在。
- **只有当 runner 选择**宿主机**路径时，`env` 才会到达 `git fetch`。** 如果 runner 已经有活跃容器（`EstadoDoRunner.containerAtivo`），`tratarExec` 会把**每个** `exec`——包括 `RunnerGit` 的——经由 `docker
  exec` 路由，而它没有 `env` 字段（ADR 0130 经测量的决定：保持 Docker port 为封闭类型，没有自由的 `-e`）。在这种状态下分派的 `git fetch` 对私有仓库会静默丢失凭据。本次交付中未解决——扩展 `packages/docker-port` 以接受 `env` 会触及它的**两个**消费者（runner 和 broker），不在范围内；声明在此，待带私有仓库的 `runner` 项目数量证明有必要时处理。
- **`RunnerReadiness.verificar/1` 在每次 `RunnerGit` 调用时都会再运行一次**（每次 git/worktree 操作多一次查询）——可以接受，因为这个模块中没有任何函数位于热路径上（与本次交付之前对 `Engine.Actions.Workspace.ensure!/4` 早已适用的同一把尺子）。
- **RN-494 为 `propose_container_start` 声明的缺口**（它和 `GetInfraContextUseCase` 都不按 `executionMode` 限制——Infra Lead 可以盲目提出）**对那个工具保持原样。** **新**工具（`container_start_via_runner`）诞生时没有这个缺口，因为它诞生时就知道拒绝——但这不会追溯：`propose_container_start` 仍然不会区分模式，这是单独的决定，不在 API/领域的范围内。
