---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0111 — 转换已有项目的 `execution_mode`：dev agent 活动时拒绝，迁移 `permissions.json`，退役容器行

- **状态：** 已接受
- **日期：** 2026-08-23
- **背景：** 关闭 backlog 条目"转换一个**已有**项目的 `execution_mode`"（runner/execution_mode 批次的 Onda 2，`docs/explanation/backlog.md`），修正 ADR 0104 的第 4 项
- **修订（不编辑）：** [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)（第 4 项的论断）、[ADR 0072](0072-projeto-local-ou-container.md)、[ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

## 背景 {#context}

ADR 0104（同一批次的 Onda 1）在项目**创建**时引入了三值的 `execution_mode`（`container`/`mounted`/`runner`），并在第 4 项中作为*后果*——而不是它所设计的东西——断言在已有项目上于三种模式之间转换"不再需要重建项目"。这句话是在有人追查过什么东西实际指向旧作用域之前写下的。Onda 1 的实现本身发现它是错的，并把修正记录在 `backlog.md` 中，而不是编辑已接受的 ADR：`UpdateProjectDto` 继续有意排除 `executionMode`/`workspacePath`（`apps/api/src/interfaces/http/iam/dto/update-project.dto.ts`），因为有三样东西指向旧的（模式，路径）对，而它们都不会跟随一次单纯的列 `UPDATE`：

- `permissions.json`，物理写入在 `projectScopeRoot(project)`——每种模式在文件系统中的位置都不同（`fs-permissions-file-store.ts`）；
- `project_containers`（ADR 0081），其唯一有效的状态机假定 `execution_mode = 'container'`——否则 `RegistrarTransicaoDeContainerUseCase` 拒绝（400）触碰该行；
- 一个运行中的 `Engine.Dev.DevAgentServer`，它在创建 worktree 时**一次性**把 `workspace_root` 捕获到 GenServer 的状态中（`Engine.Actions.Workspace.ensure_remoto/2` → `workspace_dir/1,2` → `Engine.Projects.Project.workspace_dir_name/1`）——engine 中 `projectScopeRoot` 的孪生兄弟。在一个活着的 agent 底下翻转数据库列不会移动它；只有**下一个** worktree 会按新位置解析。

本 ADR 设计 Onda 1 推迟的转换，并关闭 `backlog.md` 中记录的修正——ADR 0104 第 4 项的论断通过下面的机制重新变为**真实**，而不是通过编辑已接受的文本。

## 决策 {#decision}

### 1. 专门的路由，而不是放宽的 `UpdateProjectDto` {#1-a-dedicated-route-not-a-loosened-updateprojectdto}

`PUT /projects/:projectId/execution-mode`（角色 `maintainer`——与 CLAUDE.md 已赋予修改 `max_parallel`/区域预算的严重度相同："修改上限就是不经询问地决定产品花多少钱"），由 `ConvertProjectExecutionModeUseCase` 支撑。`UpdateProjectDto` 继续排除这两个字段，它的注释现在指向这里，而不只是描述缺口。通用的 `PATCH` 是一次列写入；转换是一次**编排**——校验新的（模式，路径），dev agent 活动时拒绝，迁移 `permissions.json`，离开 `container` 时退役容器生命周期行，然后才写入列——把这些混进通用 DTO，会让简单情况（重命名项目）背负罕见情况的复杂性。

### 2. RN-447——只要项目的任何 dev agent 不是空闲的就拒绝（409）；绝不排空/迁移 {#2-rn-447-refuse-409-while-any-dev-agent-of-the-project-is-non-idle-never-drainmigrate}

并发风险是真实的，不是理论上的：`DevAgentServer` 不会重新解析 worktree 的位置，所以在一个活着的 agent 底下转换，会让它继续写入一个 `permissions.json` 和终端路径策略（ADR 0055）已经离开的作用域。检查直接读取 `engine.dev_agent_states`——跨 schema，在同一个物理数据库中，与 RN-409 的 `onlineAgentCount` 同一先例——在项目的**所有**会话中查找 `status <> 'idle'`（而不是在某一个会话的 event log 中，不同于 `GetSessionPendingWorkUseCase`，后者以会话为作用域，需要查询项目曾经有过的每一个会话）。`idle_tripped` 有意算作活动，这与 RN-409 的在线计数不同：熔断器打开的 agent 仍然持有一个已捕获的 `workspace_root`，需要人来解锁它，即使按 RN-409 的定义它不是"在线"——这两个问题（"有人在看这个 agent 工作吗"vs."有人持有一个会过时的作用域指针吗"）是不同的，RN-409 对 `idle_tripped` 的排除不适用于这里。

决定是**拒绝**并解释，绝不排空或强制迁移一个活着的 agent——与 RN-088/RN-422 磁盘校验消息的"拒绝并教导"模式相同。为进行中的 agent 构建迁移路径，意味着要么在任务中途杀掉它的进程（丢失尚未提交的内容），要么教它实时重新解析作用域，而产品的其他部分也都不这样做。

### 3. RN-448——`permissions.json` 被**迁移**，内容从不改变 {#3-rn-448-permissionsjson-is-relocated-its-content-never-changes}

`PermissionsFileStore` 增加了 `move(from, to)`：在**旧的** `projectScopeRoot` 读取文件，把**相同**的内容写到**新的**位置，然后尽力删除旧文件。内容（`allow`/`deny`/`ask` 模式）内部不带路径也不带 execution_mode——它是纯粹的策略历史（"这条确切的命令被始终批准"），所以没有需要重写的东西，只有物理文件存放的位置。通过端到端追查 `projectScopeRoot`（`project-workspaces-root.ts`）核实：对于 `mounted`/`runner`，它返回 `workspacePath` 本身，被当作 API 自身**容器**文件系统内的路径——对 `runner` 而言，即使没有转换，今天也已是如此，因为没有 bind-mount；文件物理上位于一个仅在**字符串**上与用户真实目录一致、与之断开的路径。转换不改变这一既有性质，只是以与之一致的方式迁移文件——除了像对任何其他组合一样使用 `move()` 之外，对 `runner` 没有特殊处理。

### 4. RN-449——离开 `container` 会在列翻转之前退役 `project_containers` 行 {#4-rn-449-leaving-container-retires-the-project_containers-row-before-the-column-flips}

如果今天 `execution_mode` 是 `container` 而目标不是，`RegistrarTransicaoDeContainerUseCase` 会把容器生命周期行（若存在）带到 `removed`——当它处于 `running` 时先经过 `stopped`，因为 `container-lifecycle.ts` 的状态机没有 `running -> removed` 的直接边——在项目的 `execution_mode` 列改变**之前**。顺序很重要：`RegistrarTransicaoDeContainerUseCase` 本身会拒绝（400）在今天不是 `execution_mode = 'container'` 的项目上进行任何转换，所以在翻转之后调用它总会失败。**从** `mounted`/`runner` 进入 `container` 则什么都不做：没有自动开通——Arquiteto 的镜像关口（RN-105）和正常的容器生命周期从那时起生效，与任何 `container` 项目完全一样，绝不是因为项目"已经在某处有过代码"就跳过关口的捷径。

### 5. RN-450——每次真实转换都把 `workspaceVerifiedAt` 重置为 `null` {#5-rn-450-workspaceverifiedat-resets-to-null-on-every-real-conversion}

它只对 `runner` 有意义（RN-423）：一个证明已连接的 runner 在真实主机上确认了路径的戳记。任何转换——包括回到 `runner` 并带着看似相同的路径——都会强制一次**新**的确认，因为旧戳记证明的是在一个**不同**的（模式，路径）对下发生的路径检查；把它带过去，就是在声称一次从未针对新状态发生过的确认。

### 6. 与今天相同的（模式，路径）是空操作——出于设计，而非偶然 {#6-same-mode-path-as-today-is-a-no-op-by-design-not-by-accident}

如果请求的组合恰好解析为项目已有的组合，用例原样返回项目：不检查 dev agent，不 `move` `permissions.json`，不重置 `workspaceVerifiedAt`。重新提交同一表单不应付出扫描活动 agent 的代价，也不应悄悄地让一个已确认的 `runner` 项目变为未验证。

## 后果 {#consequences}

**本 ADR 不移动的东西：已经在磁盘上的代码。** 转换从不在旧作用域根与新作用域根之间复制文件。这有意不是一个实现试图掩饰的缺口——它是 engine 早已如何派生 workspace 的结果（`Engine.Actions.Workspace.ensure!/4`，`apps/engine/lib/engine/actions/workspace.ex`）：一个尚未标记为就绪的 workspace 目录，会在下一次创建 worktree 时，从项目的 **bare** 仓库（真正的事实来源）`git init` + `fetch`，无论列现在指向哪个（模式，路径）。已提交的工作是安全的——它位于 bare 仓库中，并会在新位置重新 checkout。**被遗弃的旧 worktree 中未提交的改动既不迁移也不删除——它们原地成为孤儿**，仍然物理存在于磁盘上旧的作用域根中（可以手动恢复，绝不会自动恢复），但从转换那一刻起对产品不可见。RN-447 的守卫降低了这一风险（agent 正在 `working` 时不进行转换），但不能消除它：一个在任务之间处于 `idle` 的 dev agent 仍可能持有未提交的 diff，而这里没有任何东西在允许转换之前检查工作区是否干净。

**本 ADR 不构建的东西：** 一种把**同一个**项目转换到它已经完全等价的模式而不触发"已改变"标记的方式——不需要，见决策 6。它不触碰 `UpdateProjectDto`，不增加迁移（自 ADR 0104/RN-423 的 `ConfirmProjectWorkspaceUseCase` 起，`ProjectRepository.update` 就已接受这三列），也不改变终端的路径作用域策略（ADR 0055）或镜像关口（RN-105），除了决策 4 已经说明的内容。
