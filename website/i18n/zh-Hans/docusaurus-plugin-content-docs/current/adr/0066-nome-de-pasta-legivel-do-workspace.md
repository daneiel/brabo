---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0066 — 可读的 workspace 文件夹名称

## 状态 {#status}

已接受。

本 ADR **修订 [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)**，后者仍然被接受且不被编辑。0055 引入了 `projectScopeRoot`，作为推导 `<PROJECT_WORKSPACES_ROOT>/<projectId>` 的**唯一**函数——之所以共享，是因为 `permissions.json` 和终端范围（RN-075）必须就项目文件夹在哪里达成一致。本文档改变的是放在 `<projectId>` 位置上的**内容**，同时保留两种推导（api 和 engine）继续一致的保证。

## 背景 {#contexto}

每个项目在磁盘上的物理文件夹以纯 UUID 命名
（`<raiz>/3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e/`）——与标识数据库中该行的 `projectId` 相同。通过 Finder/Explorer 浏览文件夹时（`docs/getting-started.md` 开始允许这样做，把
`PROJECT_WORKSPACES_HOST_DIR` 指向磁盘上的真实路径），用户看到的是一串 UUID，不逐个打开就无法知道哪个文件夹是哪个项目。

需求：**可读**的文件夹名称，基于项目的 slug，同时保留唯一 id。考虑过两种机制（见“考虑过的备选方案”）；用户明确选择了**重命名物理文件夹**，而不是一个指向原封不动的 UUID 文件夹的 symlink。

`PROJECT_WORKSPACES_ROOT` 是整个实例的**一个**根，在所有 workspace 之间**共享**——两个 workspace 可以各有一个 slug 为 `api` 的项目。单独的 slug 不是全局唯一的，这正是让“唯一 id 与可读名称并存”成为真实需求而非任性的原因。

## 决策 {#decisão}

### 1. `projects.workspace_dir_name` 是文件夹名称，记录在数据库中 {#1-projectsworkspace_dir_name-é-o-nome-de-pasta-gravado-no-banco}

`projects` 中新增列 `workspace_dir_name`（`text`、`NOT NULL`、`UNIQUE`）。`projectScopeRoot`（ADR 0055）开始接收这个值，**再也不**接收原始 `projectId`——该函数保护的两个消费者（`permissions.json` 和终端范围）继续推导出**相同**的根，因为它们继续调用同一个函数，只是参数正确了。

### 2. 新项目以 `<slug>-<id 的 8 个字符>` 诞生；旧项目保留 UUID {#2-projeto-novo-nasce-com-slug-8-chars-do-id-projeto-antigo-mantém-o-uuid}

`workspaceDirNameFor(id, slug)`（纯函数，在
`project-workspaces-root.ts` 中）组合名称——与 `apps/web/src/lib/session-label.ts` 用于会话标签的同一个 8 字符约定。`CreateProjectUseCase` 开始在**代码**中生成 id
（`crypto.randomUUID()`，不再是 Postgres 的 `defaultRandom()`）：文件夹名称在 `INSERT` **之前**就需要 id，而获得它只有两种方式——在数据库之外生成 id，或者往返两次（插入、读取生成的 id、`UPDATE`）。前者更简单，并且在代码中已有先例
（`token-factory.ts`、`emitir-sessao.use-case.ts`）。

本次迁移**之前**创建的项目保留它已有的物理文件夹：迁移对每个现有行执行 `workspace_dir_name = id`——与磁盘上已经成立的值相同——并且**从不重命名任何目录**。重命名一个可能被活跃 agent 打开的工作树是毫无必要的真实风险：旧项目继续与原来完全一样地工作。

### 3. 名称在创建时**冻结**，从不重新计算 {#3-o-nome-é-congelado-na-criação-nunca-recalculado}

`UpdateProjectUseCase` 允许之后编辑 `slug`——这不会触及
`workspace_dir_name`。备选方案（slug 变化时重新计算名称）需要移动一个带有工作树和可能正在使用的 agent worktree 的目录，而“冻结”的价值恰恰在于不必处理这种情况：物理文件夹一次决定、永远不变。

### 4. `BEFORE INSERT` 触发器是安全网，而不是主路径 {#4-um-trigger-before-insert-é-a-rede-de-segurança-não-o-caminho-principal}

`CreateProjectUseCase` 总是在 `INSERT` **之前**显式写入 `workspace_dir_name`——这才是真正的路径。一个触发器
（`projects_workspace_dir_name_default_trg`）对任何没有带该字段到达的 `INSERT` 应用**相同**的回退（`id::text`）。添加触发器的决定——产品整个 migration 历史中的第一个——并不在原始需求中，值得记下原因：api 的五十多个测试 spec 直接对数据库插入 `projects`，而不知道（也不需要知道）文件夹名称这个概念。没有触发器，让该列 `NOT NULL` 会把它们全部打破，而备选方案——编辑五十个文件，在每个文件中编造一个合理的 `workspace_dir_name`，还要照顾它们之间的**全局**唯一性——会用一笔更大的债换掉另一笔，而对功能本身什么也证明不了更多。触发器从不覆盖非空值：显式写入者继续掌控。

### 5. engine 读取**同一**列，从不重新计算名称 {#5-a-engine-lê-a-mesma-coluna-nunca-recomputa-o-nome}

`Engine.Projects.Project.workspace_dir_name/1` 直接查询该列。`Engine.Actions.Workspace.workspace_dir/1`（之前是
`Path.join(root, project_id)`，一个纯函数）开始通过这个查询解析名称，当查询找不到行、`project_id` 不具有 UUID 形式，或查询因任何原因失败时，回退到原始 `project_id`（宽泛的 `rescue`/`catch`——降级总是好过把**路径**解析失败传播给只想要一个目录的调用者）。

这正是保证 ADR 0055 的不变式在变更后依然成立的那一点：api 和 engine 不是实现两个碰巧需要一致的公式——两者读取**同一**数据库的**同一**行。如果有一天它们分歧，那会是因为其中一方不再查询，而不是因为公式只在一侧改变了。

`workspace_dir/1` **不是热路径**：dev agent 的工具循环
（`search_workspace`、`write_file`、`read_file`）已经接收到**现成**的
`ctx[:workspace_root]`——在 `Engine.Dev.WorktreeManager.create/3` 组装 agent 的 worktree 时解析一次——只有对今天不经过这个 `ctx` 的调用者（`worktree_manager` 内部、
`instruction_files`、经由 `ensure_remoto` 的 `TerminalExecutor`）才作为回退落入 `workspace_dir/1`。这些都不是每次工具调用都运行的。

`Engine.Dev.WorktreeCleanup`（孤立 worktree 的周期修剪）是需要自己设计的例外：在 RN-109 之前，文件夹名称**就是**
`project_id`，扫描磁盘（`File.ls(root)`）并把每个条目当作 id 是有效的读取。有了可读的文件夹名称，文件夹不再是 id，不查询就无法从一个回到另一个。修正改变了迭代的来源：不再扫描磁盘，而是查询
`Project.all_workspace_dirs/0`（一次查询得到所有 `{id, workspace_dir_name}`）并直接使用解析出的 `work_dir`——这个函数和 `WorktreeManager` 都不会为了再次找出名称而对每个项目做第二次查询。

## 后果 {#consequências}

**接受的。** 一个新列、一个新触发器（产品中的第一个——见第 4 项）、两个纯函数（api 中的 `workspaceDirNameFor`、engine 中的 `workspace_dir_name/1`），以及把 `Workspace.workspace_dir` 从纯函数扩展为带回退的数据库感知函数。`WorktreeCleanup` 把迭代来源从磁盘换成了数据库——同样是**一次**查询的成本，绝不按项目。

**超出范围的。** 把现有项目的文件夹重命名为可读格式没有实现，也没有被要求：这需要移动一个可能被活跃 agent 打开的工作树，而可读名称的价值是外观上的，不值得冒险。想要可读文件夹的人创建一个新项目。

**不变的。** RN-075（终端范围）和 RN-092（代码读取，Code 标签页）继续指向 engine 真正使用的**同一个**文件夹——两个 ADR 保护的是这种一致，而不是名称的形式。

## 考虑过的备选方案 {#alternativas-consideradas}

- **指向原封不动的 UUID 文件夹的 symlink**——风险更小（物理工作树从不移动位置，只是在旁边多一个可读的快捷方式）。这是最初的建议。用户明确选择了另一个选项：真正重命名文件夹，磁盘上每个项目不出现两个条目。
- **每次 slug 变化都重新计算名称**——被拒绝：会为了外观上的收益移动一个可能正在使用的目录。“创建时冻结”避免了整类 bug。
- **没有触发器的 `NOT NULL` 列，并编辑五十个测试 spec**——因成本/风险被拒绝：手工编辑五十个文件来编造合理的名称，还要额外照顾它们之间的**全局**唯一性，对功能证明的东西并不比触发器用三个测试已经证明的更多。

## 参考 {#referências}

- [RN-109](../business-rules/autenticacao.md#rn-109)——文件夹名称在创建时冻结，旧项目保留 UUID。
- [RN-075](../business-rules/custo.md#rn-075)——终端策略中的路径范围（本 ADR 所保留的）。
- [RN-092](../business-rules/custo.md#rn-092)——代码读取中的路径约束（同上）。
- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)——被修订的文档。
