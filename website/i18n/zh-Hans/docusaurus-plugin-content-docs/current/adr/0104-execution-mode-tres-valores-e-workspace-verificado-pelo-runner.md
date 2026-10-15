---
traducao_de: b0a0b069960bcdc9bc59daf649a8cda2df7727f9
---

# ADR 0104 — `execution_mode` 取三个值，由 runner 负责验证时 workspace 以 `unverified` 诞生

- **状态：** 已接受
- **日期：** 2026-08-22
- **背景：** ADR 0072 与 ADR 0103 从未相互协调
- **修订（不弱化）以下 ADR 的领域：** [ADR 0072](0072-projeto-local-ou-container.md)、[ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md)

## 背景 {#contexto}

本产品的两份 ADR 在**同一个**字段名下描述了物理上互不兼容的两种执行方式，而在此之前没有人协调过两者。

[ADR 0072](0072-projeto-local-ou-container.md) 创建了
`projects.workspace_mode`（`'container'|'local'`）+ `workspace_path`。在
`local` 模式下，[RN-170](../business-rules/autenticacao.md#rn-170) 在**创建**时验证该文件夹是否已通过 **bind-mount 挂载**到 api 与 engine 的容器中——`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
（`validarCaminhoDeWorkspaceLocal`）**在 api 容器的进程内**执行 `access(W_OK|X_OK)`，找不到时以 400 拒绝。web 向导
（`apps/web/src/routes/NewProjectWizard.tsx:71,462-468`）只教用户在 `docker/docker-compose.yml` 中添加一行 bind-mount——没有其他说明。

[ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md) 创建了
`apps/runner`：一个运行在用户**机器**上的 CLI，**完全没有 bind-mount**，通过 Phoenix 通道（`/runner`，主题
`terminal:<projectId>`）连接 engine，并以 engine 自己签发的一次性 ticket 认证。它执行已经过常规流水线批准的 agent 命令，并打开真正的交互式 PTY 终端——Terminal 标签页
（`apps/web/src/routes/code/TerminalPanel.tsx`）为此已经真正使用 `@xterm/xterm`。[RN-420](../business-rules.md#rn-420) 决定何时把命令路由到 runner 而不是一贯的 `System.cmd`，它复用了**同一个**条件 `workspace_mode == "local"`（外加 runner 已连接）——ADR 0103 从未为该字段创建第三个值。

实际结果：今天，为了**使用** runner——它存在的意义恰恰是免去 bind-mount——用户仍然必须仅仅为了创建项目而通过 ADR 0072 的 bind-mount 验证。产品的两半引用同一个两值枚举，来描述物理上毫无共同点的两种执行：一个挂载在两个容器中的文件夹，和一个只存在于用户机器上的文件夹。通过直接阅读代码确认：`apps/api/src/db/schema.ts:238-240`
（`projectWorkspaceModeEnum = pgEnum('project_workspace_mode', ['container',
'local'])`）以及 `apps/api/src/domain/iam/project.entity.ts`
（`PROJECT_WORKSPACE_MODES = ['container', 'local']`，其现有注释已经提醒将这个同名值与 `GitProviderName` 的
`'local'` 混淆的风险——本 ADR 继承了这一风险，并在重命名字段时必须保留这一提醒）。

这一发现源自对“产品要真正访问 Docker 范围之外的用户文件夹和终端还缺什么”的调查——在本次会话之前，它从未在任何地方被记录为正式的分歧。

## 决策 {#decisão}

1. **`execution_mode` 取代 `workspace_mode`，取三个值：**
   `container`（默认，一贯的行为——一切都在 Docker 内）、
   `mounted`（原来的 `local`——bind-mount，RN-170 继续有效，现在以该值为条件）和 `runner`（文件夹只存在于用户机器上，完全没有 bind-mount）。改名是因为 `local` 本已带有与 `GitProviderName` 的歧义，而且将不得不在同一标签下承载**两种**互不兼容的物理语义（已挂载 vs. 未挂载）——`execution_mode` 命名的是该字段真正决定的维度（命令在**哪里**执行），而不再是“代码住在哪里”，两种新模式对后者的回答方式无法共享验证。

2. **RN-170 改为以 `execution_mode = 'mounted'` 为条件。** 对于
   `execution_mode = 'runner'`，创建时仍验证路径的**词法**部分（绝对路径、任何段都没有 `..`、不在根目录和系统文件夹下、在两个方向上都不与 Brabo 的 checkout 重叠）——这些都不依赖容器 I/O，并且继续有效，因为它与授权 agent 终端的是同一个范围
   （[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)）。改变的是**磁盘**部分（存在、是文件夹、可写）：对 `mounted`，它继续像今天一样在创建时于 api 容器内运行；对 `runner`，这项验证被**推迟**——api 无法确认只存在于用户机器上的东西。有权执行这次 `access()` 的是 runner，它运行在真正的宿主机上。

3. **`execution_mode = 'runner'` 的项目以 `workspace:
   unverified` 诞生，当第一个 runner 连接并在宿主机上确认路径时提升为 `verified`。** 与 `docs/gates.yml` 已用于 gate `status:
   planned` + `evidencia: event_log` 的“带事件证据的待定状态”同一精神——声明的文件夹被立即接受（创建不会卡在等待一个尚不存在的 runner），但在有证据表明有人在正确的机器上确认之前，产品不会断言“路径有效”。确切的**机制**——事件名称、runner 调用以确认的路由、状态存储在哪里——留给实现会话：本 ADR 声明状态的**存在**和提升的**标准**，而非机制。

4. **后果，而非单独的请求：在三个值之间转换 `execution_mode` 不再需要重建项目。** 今天模式只在创建时选择（ADR 0072，第 1 项）——当值之间的差异缩减为一列（外加第 3 项的验证状态）时，这就不再是结构性限制。**所有转换方向都被允许**，此处不声明额外限制——`container ⇄ mounted ⇄ runner`，任意方向。每次转换的机制（切换时 worktree/状态如何处理、每个方向是否有自己的确认）留给实现会话；本 ADR 只声明转换在任意方向上都被允许。

### 后续事项的交付顺序 {#ordem-de-entrega-do-que-fica-para-depois}

本决策（上面第 1–3 项）是 **P1**：没有它，runner 虽然存在，但没有人能在不先挂载它本应免去的文件夹的情况下用上它。后续事项按产品负责人已定义的顺序进行（完整细节见
[backlog.md](../explanation/backlog.md#backlog-of-the-runnerexecution_mode-adr-0104)）：

- **runner 的分发**（`tsup` → 单一包 + `npm publish
  @brabo/runner`）——今天它是 `"private": true`，`bin` 指向一个原始 `.ts`，只能通过克隆整个 monorepo 获得。
- **长期账户令牌（PAT）**，取代 `apps/runner/src/auth.ts` 的登录重放——必须在分发**之前**到来，因为今天发布就等于分发一个把密码+cookie 保存在磁盘上的流程。
- **runner 按 `{project_id, machine_id}` 独占**，而不只是
  `project_id`——**推迟**到存在真实的启用标准（同一项目上确实有第二位同时工作的开发者）。
- **`guard.ts` 尽力而为**——不是要填补的缺口，见“后果”。

## 后果 {#consequências}

**令人痛苦且本 ADR 不解决的：** `ALTER TYPE ... ADD VALUE`
在多个 PostgreSQL 版本中有事务限制（不能在引用新值的同一事务中使用）。引入枚举第三个值的 migration 必须显式处理这一点（分两步，或重建类型）——此处作为实现会话的技术风险登记，本文档不解决。

**被声明为不变式而非缺口的：**
`apps/runner/src/guard.ts` 现在是、将来也仍是一个尽力而为的**词法**检查——易受 TOCTOU 和检查之后创建的 symlink 攻击，没有 sandbox，没有独立用户，没有真正的技术边界。这在 ADR 0103 中已经声明；本 ADR 明确**重申**，因为 `execution_mode = 'runner'` 不再是有条件的附加项（`local` 模式 + 碰巧连接的 runner），而成为项目创建中的**一等**路径——而一等路径有被没跟进 ADR 0103 的人误读为从未存在过的隔离承诺的风险。runner 真正的安全边界仍然只有：认证（CLI 以用户账户的令牌标识自己）+ 一贯的审批流水线（每个 agent 命令都以 `proposed_action` 诞生，包括 ADR 0102 的绝对上限）+ 用户同意在自己的机器上运行该二进制文件。

**本 ADR 不做的：**

- 不实现任何代码、migration、路由或 UI——这是已登记的决策，实现会话在 `origin/dev` 上执行。
- 不设计 `unverified`/`verified` 状态的确切机制（事件、路由、存储位置）——只声明它存在以及提升标准。
- 不实现 `execution_mode` 值之间的任何转换——只声明所有方向都被允许。
- 不改变外部效果的边界（RN-106/RN-418）：`git push`、开 PR 和部署继续是无条件的 `require_approval`，无论在范围内外、无论何种 `execution_mode`。
- 不改变路径范围策略，也不改变终端的 allowlist
  （ADR 0055）——改变的只是创建项目时在哪里/何时验证磁盘。
