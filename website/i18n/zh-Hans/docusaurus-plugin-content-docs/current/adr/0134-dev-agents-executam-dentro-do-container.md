---
traducao_de: eb32fa72c74cb4f32985f16a3c1440e93357c0b9
---

# ADR 0134 — dev agent 在项目的真实容器**内部**执行，终端在其中获得一个自动批准的下限

## 背景 {#context}

ADR 0133（PR 1.5）端到端地关闭了 `container_start` 路径（`proposed_action` → 批准 → broker →
`project_containers`），并白纸黑字地声明：“os dev agents AINDA não trabalham dentro do container que sobe
[...] o que roda dentro do container, por enquanto, é só o que o broker sobe — sem consumidor ainda.”本 PR 就是
提供这个消费者的 PR。

如今，即使有一个真实的容器在运行，`Engine.Actions.TerminalExecutor` 仍然在 engine 自己的进程**内部**通过
`System.cmd` 运行 dev agent 的**所有**终端命令，针对共享文件夹（`PROJECT_WORKSPACES_ROOT`）——与一贯的做法
完全一样。容器处于空闲：其中从来没有任何东西被 `docker exec`。

## 决策 {#decision}

**当项目处于 `execution_mode: container` 并且在 `project_containers` 中有一行登记为 `running` 时，dev
agent 的终端命令改为在容器内部运行，通过（经由 broker 的）`docker exec`——不再通过本地 `System.cmd`。**

### `decisao_de_execucao/1` 的第五个出口 {#a-quinta-saída-de-decisao_de_execucao1}

`Engine.Actions.TerminalExecutor` 原本已有**四个**出口（RN-423、ADR 0104，即路由到本地 runner）。它获得第五个
`:executar_no_container`，条件是 `execution_mode == "container"` **且**
`Engine.Containers.ProjectContainerLifecycle.running?/1`——一个新的只读读取，直接读 `project_containers` 表
（与 `Engine.Projects.Project` 读取 `projects` 的模式相同：engine 读取 api 写入的列，不重复推导）。

`mounted` **永远**不会落入这个出口：broker 拒绝为这种模式启动容器（`ModoDeExecucaoNaoSuportadoError`，在
PR 1.7 重新审视三种模式之前的有意策略），因此这个问题对它甚至没有意义。

### 新的一段：engine → api → broker.exec {#a-nova-perna-engine--api--brokerexec}

`ContainerBrokerPort.exec`（ADR 0130）已经存在，broker 一侧有完整的作用域校验（`/work` 之外为
`DiretorioForaDoEscopoError`）——但它有**零**个调用者。这样闭合：

1. 新的内部路由 `POST internal/projects/:projectId/container-exec`，放在 `InternalProjectsController` 中
   （而不是 `InternalContainersController`——见下文“为什么不放在 broker 的 controller 中”）——一贯的
   `EngineServiceGuard`，由 **engine** 调用，而不是由 broker 调用。
2. `ExecutarComandoNoContainerUseCase`：调用 `ContainerBrokerPort.exec`，并处理
   `BrokerRecusouError`/`BrokerIndisponivelError`，返回**类型化**的失败结果（`{ sucesso: false, motivo }`）——
   从不让异常经由 HTTP 路由泄漏。任何**其他**错误（真正的缺陷）继续向上传播——不会被伪装成命令失败。
3. `Engine.Sessions.EngineApiClient.executar_comando_no_container/4`——一贯的清单（callback + delegator + 实现
   `Req.post` + 测试用 fake），调用新路由。
4. `Engine.Actions.TerminalExecutor` 获得 `run_no_container/4`（模子：`run_via_runner/4`），它调用上面的客户端，
   并把结果映射到 `build_result`/`failed_result`。

**broker.exec 的失败绝不会变成崩溃，也不会无声地回退到容器外的 `System.cmd`。** `sucesso: false`（broker 拒绝
或没有响应）以及 engine→api 的传输失败都会变成普通的 `failed_result`——清晰的消息，`exit_code: nil`，与任何其他
失败的命令完全一样。在登记的 `running` 与调用时刻之间被外部杀死或删除的容器（RN-486：登记与观察永不合并）**就是**
这种情况——不是 bug，是“登记”从来不是保证的代价。回退到容器外的 `System.cmd`，会重新打开本 PR 存在要关闭的那个
隔离逃逸向量。

### 为什么不放在 broker 的 controller 中 {#por-que-não-no-controller-do-broker}

`InternalContainersController`（路由 `container-spec`）有一条明确的注释：“sem `@Post` aqui, e isso não é
esquecimento”——因为**写入**容器生命周期的是 `RegistrarTransicaoDeContainer`，而在那里给 **broker** 写入权会
混淆由谁决定状态。新路由在那条注释所保护的两个维度上都不同：**调用者**是 engine（而不是从 api 读取的 broker），
它做的事也不是写 `project_containers`——而是运行一条命令并返回结果。因此它放在 `InternalProjectsController` 中，
与 `confirm-workspace-verification`（另一条由 engine、而不是 broker 调用的路由）并列。

### dev agent 的 worktree **已经**出现在 `/work` 中——无需改动 `Workspace.ensure!/4` {#o-worktree-do-dev-agent-já-aparece-em-work--sem-mudar-workspaceensure4}

已验证的假设：**确认成立。** `apps/broker/src/operacoes.ts` 中的 `especificacaoDoProjeto/2` 把 `raizDoProjeto`
组成为 `${PROJECT_WORKSPACES_HOST_ROOT}/${workspaceDirName}`——与
`Engine.Actions.Workspace.workspace_dir/2` 在 engine 进程内部解析
`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>` 时已在使用的**同一个**根（`workspace_dir_name`，RN-109）。
`packages/docker-port/src/docker-cli.ts` 把这个 `raizDoProjeto` 挂载为**唯一**的 bind
（`${spec.raizDoProjeto}:${PONTO_DE_MONTAGEM}:rw`，`PONTO_DE_MONTAGEM = '/work'`）。也就是说：**这是同一个
物理目录**，只是通过两条路径到达——从 engine 内部，经由 `PROJECT_WORKSPACES_ROOT`（engine 一侧的 bind/卷）；
从刚启动的容器内部，经由 `/work`（由 daemon 针对**宿主机**上的 `PROJECT_WORKSPACES_HOST_ROOT` 解析的 bind）。
dev agent 如今已在使用的 worktree——以一贯的方式创建，`Workspace.ensure!/4` 在 engine 进程内运行
`System.cmd("git", ...)`，写入共享卷——已经出现在容器**内部**的 `/work` 中，而
`Workspace.ensure!/4`/`ensure_remoto/2` **什么**都不用改。容器只是同一目录的又一个观察者。

这依赖于 `PROJECT_WORKSPACES_HOST_ROOT` 被正确配置，指向**宿主机**上与 `PROJECT_WORKSPACES_ROOT` 在 engine 容器
内部解析到的**同一个**物理文件夹的路径——这是运维者的责任（已在 `docker-compose.yml` 的注释中记录），并且仍然
如此：这里什么都不变。

### `cwd`：从宿主机转换到 `/work` {#cwd-tradução-de-host-pra-work}

`opts[:cwd]` 以**宿主机绝对**路径到达 `TerminalExecutor.run/3`（位于 `project_workspaces_root` 之内——共享根，
或某个 dev agent 的 `.worktrees/<agent_id>` 子目录，经由 `Engine.Dev.WorktreeManager`）。`run_no_container/4`
在发送给 broker **之前**把这个路径转换到 `/work` 之内：把前缀 `<project_workspaces_root>/<workspace_dir_name>`
替换为 `/work`，保留后缀。缺失的 `cwd`（在 workspace 根运行）变为 `nil`——broker 默认使用 `/work`。不在该根之内
的 `cwd`（对 `execution_mode: container` 不应发生）按原样发送，不尝试猜测——如果它不在 `/work` 之内，broker 会以
`DiretorioForaDoEscopoError` 拒绝，这是纵深防御，而不是悄悄伪造一个路径。

### 决策 3：容器内的自主 {#decisão-3-autonomia-dentro-do-container}

**作用域是真实容器内部项目文件夹的终端命令会自动批准——但这是一个下限，不是新的上限，`decide.ts` 的五个
绝对上限逐字节保持原样。**

机制：`ProposeActionUseCase.execute` 查询执行所使用的**同一个** `ObterCicloDeVidaDoContainerUseCase`（只在
`actionType === 'terminal' && project.executionMode === 'container'` 时——其余情况都省掉这次查询），并在
`DecideContext` 中组装 `containerExecutionActive`。在 `decide()`（仍然是**纯**的——零 IO）中，`current` 的
**初始**值不再总是 `{ policy:
'require_approval', reason: 'default' }`，而在 `action.actionType === 'terminal' &&
ctx.containerExecutionActive` 时变为 `{ policy: 'auto_approve', ... }`。

**为什么这在不重复已有上限机制的情况下是安全的：** 随后的每个阶段（`agent_autonomy`、`permissions.json`）在
有明确意见时都已经会**替换** `current`——正是这样，一贯的默认 `require_approval` 已经可以被显式的 `deny` 降级，
或被 `ask` 保持。改变**初始**值不会改变这一属性：显式的 `agent_autonomy: deny`，或匹配该命令的带 `ask`/`deny`
的 `permissions.json`，会像以前降级默认 `require_approval` 一样降级容器的下限——这不是新路径，是同一个
`current`，只是起点不同。而绝对上限（作用域、git push/特权命令、受保护合并、instruction_patch、并行）仍然在
**之后**运行，作用于 `current.policy ===
'auto_approve'`——包括当这个 `auto_approve` 来自容器下限、而不是显式规则时。

**安全理由是边界的交换，而不是边界的缺失。** 在容器之外，终端作用域（`ADR 0055`）的边界是**词法的**：
`terminalNoEscopo` 把 `cwd`/`command` 与 `ctx.projectScopeRoot`（一个宿主机路径）比较——正是这项检查让如今按
`permissions.json allow` 自动批准变得安全。在真实容器内部，Docker 的 mount namespace 是**更强**的边界：运行
命令的进程在物理上看不到 `/work` 之外的任何东西（关闭了 `path-scope.ts` 的注释为 `mounted`/`runner` 记录为开放
的 symlink 向量，发现 U——那里根本没有 mount namespace，这里有）。broker 已经做的 `/work` 校验
（`DiretorioForaDoEscopoError`，`apps/broker/src/operacoes.ts`）是作用于已转换 `cwd` 的**第二**层。**词法作用域
上限（`terminalNoEscopo`）继续在下限之上运行，没有任何例外**——它作用于一贯的**宿主机**路径（到达 `decide()`
的 `cwd`/`command` **从不**被转换为 `/work`；这一转换只在之后、在 engine 中组装对 broker 的调用时才发生）——这是
纵深防御，而不是替代：一个今天 `decide()` 会标为超出作用域的命令，在下限开启时仍会被标为超出作用域，并重新需要
人的决定。

**为什么是下限而不是预置的 `agent_autonomy` 规则：** 一条预置规则（像 `open_adr_pr` 的 auto mode 那样）
需要在每次容器启动/停止时写入/删除，并会在容器被外部停掉的那一刻与 `project_containers` 中的**登记**值产生分歧——
这正是 ADR 0130 通过永不合并登记与观察（RN-486）已经避免的双事实来源问题。在决策时查询生命周期，就是执行在执行
时查询的**同一个**来源——两者之间零同步。

## 后果 {#consequences}

**`ContainerBrokerPort.exec` 获得了第一个真实调用者**——ADR 0128/0130 五种操作中最后一个没有调用者的。
`stop`/`remove` 仍然没有自己的 `proposed_action`，本 PR 不改变这一点。

**`mounted`/`runner` 仍然没有任何容器**——RN-421/RN-423 保持原样；对这两种模式，`join` 的结构性约束闸门仍然
缺失（ADR 0072 的发现，这里没有关闭）。

**“多少个模块，一个容器”这个问题保持原样**——`project_containers` 中的 `project_id UNIQUE`，本次交付没有变化。

**词法终端作用域（ADR 0055）没有失去任何消费者。** 它仍然是 `mounted`/`runner`（没有任何 mount namespace 保护）
唯一的边界，并继续作为第二层在容器下限**之上**运行——在任何地方都没有被替代。

**考虑过并被放弃的替代方案：在 `decide()` 内部也转换 `cwd`，以便与 `/work` 比较。** 这会让作用域上限作用于
**最终**路径，表面上更“正确”——但它会把一个**基础设施**决定（broker 把卷挂载在哪里）搬进一个文件其余部分有意
保持纯净、对任何容器一无所知的函数中，并会在两个必须永远一致的地方（`decide.ts` 和 `TerminalExecutor`）重复
`cwd` 的转换。被放弃：作用域上限作用于它一直作用的宿主机路径时仍然有用——它与容器内部的 mount namespace 是
**冗余**的，而不是被它取代，而不需要同步的冗余，正是本 ADR 所追求的纵深防御。
