---
traducao_de: 54df79826307229989b14a56d4e2eb6da04478e5
---

# ADR 0142 — 挂载 workspace 的验证推迟到实体化时进行

## Context {#context}

[ADR 0141](0141-base-unica-dos-projetos-montados.md) 决定了 `mounted` 项目住在**哪里**——在 `BRABO_PROJECTS_BASE` 之内，一个以同一路径挂载到 `api` 和 `engine` 的单一基础目录——并明确把另一半留给下一个 PR：这个文件夹**何时**开始存在，以及谁来验证它可用。

迫使提出这个问题的需求来自产品负责人，并且是字面意义上的：

> se for `Pasta montada`, o bind-mount deve ser criado **APÓS a decisão do
> arquiteto**.

今天的代码让这不可能。`validarCaminhoDeWorkspaceLocal`
（`project-workspaces-root.ts`）在项目**创建**时运行，提出三个磁盘问题——文件夹存在吗？是目录吗？进程能写入吗？——任何一个失败就以 400 拒绝（RN-170/RN-422）。项目创建是流程的**第一个**界面；Arquiteto 的决定（`project_image`、
`module_map`、`module_routing`）在许多会话之后才发生。在创建时要求文件夹就绪，就是在任何决定存在之前要求它。

而且这个问题既不是假设性的，也不是美观问题。它正是区分 `mounted` 能否成为一等选择的东西：创建向导会建议
`<base>/<slug do nome>`，而由我们建议的文件夹，按构造就是一个尚不存在的文件夹。

`runner` 模式早已解决了恰好这一张力，并且解决得很好（RN-423，ADR
0104）：它在创建时只验证**词法**——绝对路径、没有 `..`、不在系统文件夹下、不与 Brabo 的 checkout 重叠——并把磁盘留给对它有权威的一方，即在用户机器上连接的 CLI。两种模式之间的差别从来不是*什么算有效路径*；而是**何时以及谁**确认磁盘部分。

## Decision {#decision}

**`mounted` 在创建时只验证**词法**加基础目录，文件夹在某个对磁盘有权威的一方需要它时被**实体化**。**

### 在创建和转换时：词法 + 基础目录，零 I/O {#na-criação-e-na-conversão-léxico--base-zero-io}

`validarExecutionModeEWorkspacePath` 在 `mounted` 分支中不再触碰磁盘。它开始要求的是两件事：

1. 与 `runner` 相同的词法谓词（`caminhoDeWorkspaceLocalValido`），它永远有效，因此也在每次读取时运行；
2. 位于 `BRABO_PROJECTS_BASE` 之内（`dentroDaBaseDeProjetos`，ADR 0141）。

第二点不是额外的严格：基础目录是计算机上 api 和 engine 容器唯一能看到的文件夹，因此它之外的路径恰恰会产生之后卡住的项目——而这正是创建时的验证存在所要防止的缺陷。没有配置基础目录时，该模式**在此安装中不可用**，拒绝会这样说，而不是假装是路径错了。

项目像 `runner` 一样以 `workspaceVerifiedAt: null` 诞生。

### `materializarWorkspaceMontado`，以及调用它的两个地方 {#materializarworkspacemontado-e-os-dois-lugares-que-a-chamam}

被推迟的验证重新发生在一个函数中：`mkdir -p` 加上一贯的三个磁盘问题，并在 `mkdir` **之前**先拒绝位于基础目录之外的情况——否则一个在产品之外写入的路径会让 api 在它能到达的任何地方创建文件夹。

**1. `ExecuteContainerStartUseCase`**——正常的地方。当 Infra 为一个 `mounted` 项目启动容器时，文件夹被创建、被证明可写，`workspace_verified_at` 经由 `ConfirmProjectWorkspaceUseCase` 使用的同一路径被盖章。正是在这里，“在 Arquiteto 的决定之后”这一要求被字面兑现：`container_start` 只在镜像已决定之后才存在。

在这里失败是**带名称**的 `failed`，绝不 throw，绝不 500——与同一文件中 `BrokerIndisponivelError`/`RunnerNaoConectadoError` 已遵循的纪律相同——生命周期**不会**被标记为 `provisioning`。先标记 `provisioning` 然后才发现无法写入，会让 `project_containers` 的那一行声称一个从未存在过的状态。

**2. `ConvertProjectExecutionModeUseCase`**——例外，并且是被声明的。把项目转换为 `mounted` 没有可以挂靠这项工作的容器步骤：它是一个孤立的动作，紧接着它会把 `permissions.json` **移动**到 `permissionsFilePath(localNova)`，在 `mounted` 中这就是 `projectScopeRoot`，也就是用户的文件夹。把文件移动到一个不存在的文件夹会失败。因此转换在决定时实体化——在事务之前，这样拒绝不会留下打开的事务——并以带教学性消息的 400 返回。

### 不变的，也是这里最容易造成的回归 {#o-que-não-muda-e-é-a-regressão-mais-fácil-de-causar-aqui}

基础目录规则**不进入** `caminhoDeWorkspaceLocalValido`。该谓词通过 `projectScopeRoot` 在**每次读取**时运行，处于热路径上：终端范围（ADR 0055）、`permissions.json`、Code 标签页。一个**遗留**的 `mounted` 项目——在 bind-mount 还是每个项目一行 compose 时创建，因此在基础目录之外——将会在仅仅被**读取**时就以
`LocalizacaoDeProjetoInvalidaError` 崩溃，而没有任何人碰过它。

基础目录是**创建和转换**的规则，在那里屏幕前有人还能选择另一个路径。**词法则是永远的。** 对此有非回归测试，函数本身也有一条注释说明原因。

### 没有 migration，数据库的 CHECK 保持不变 {#sem-migration-e-o-check-do-banco-fica-intacto}

`mounted` 继续写入**非空**的 `workspace_path`——组合出的建议
`<base>/<slug>`——因此
`(execution_mode <> 'container') = (workspace_path IS NOT NULL)` 逐字节保持满足。**推迟**验证**从不触及**配对**不变式**：它们是不同的问题，混淆它们会是通往一个本 ADR 不需要的 migration 的最短路径。

## Consequences {#consequences}

**变好的。** 产品负责人的需求变得可执行：`mounted` 项目的文件夹在容器启动时创建，而不是之前。创建向导可以建议一个路径——这正是让 `mounted` 成为一等选择的意义所在——而不会因为建议的路径不存在而被拒绝。两种使用用户文件夹的模式在创建时有了**相同**的纪律，这让它们之间的差别（谁确认磁盘）比一个碰磁盘、另一个不碰时更容易解释。

**创建与实体化之间的窗口是真实的，并被接受。** 在项目创建与容器启动之间，`workspace_path` 指向一个可能不存在的文件夹。没有任何东西因此坏掉——`projectScopeRoot` 是词法的，`permissions.json` 降级为 `EMPTY_PERMISSIONS_FILE`（对一切都是 `require_approval`，安全的一侧）——但界面需要**说出来**，这正是容器就绪 PR 中“文件夹在容器启动时创建”这一说明所做的。一个显示路径却不说它尚不存在的界面，是在断言它并不知道的东西。

**错误到来得更晚，因此需要更明确。** 创建时的验证有一个优点：拒绝发生在做出决定的界面上。现在它可能发生在数小时后被批准的 `container_start` 中，因此 `failed` 会**点名**变量（`BRABO_PROJECTS_BASE=<valor>`）、路径、可能的原因（宿主机上文件夹的所有者——镜像以非 root 运行，ADR 0024）以及下一步该做什么（“再次批准 `container_start`”）。在这里一个笼统的 `failed` 会比旧的验证更糟。

**旧消息被刻意**删除**。** `comoMontar` 曾教人往 `docker-compose.yml` 的 `api` 和 `engine` 服务中添加 `- <caminho>:<caminho>`。这个补救办法的代价是每个项目重启这两个服务一次——安装中所有进行中的 agent 轮次、终端 socket 和 LLM 调用——而 ADR 0141 用一次性配置的基础目录取代了它。继续教授旧的补救办法会让用户为了解决基础目录已经解决的问题而推倒安装。对**不存在**那段文本有测试断言。

**`workspaceVerifiedAt` 开始有两个写入者。** 以前只有 `runner`（RN-423）。现在 `mounted` 也在实体化时盖章。该字段的含义完全不变——*有权威的一方曾在磁盘上确认过这个路径，一次*——并且仍然**不是**心跳：重新连接不会重写，界面继续说“pasta confirmada em `<data>`”，绝不说“在运行”（RN-468）。改变的是 OpenAPI 描述，它原来说
"`container`/`mounted` never fill this field in"，现在开始描述代码。

**本 ADR 不决定的。** 它不改变 `ExecuteContainerStartUseCase` 在 broker 与 runner 之间的分支——通过 **broker** 为 `mounted` 模式提供容器是另一个 PR，本 PR 触及该文件只是为了在现有分支之上加入上述实体化。它不改动
`caminhoDeWorkspaceLocalValido`，不改动 `CHECK`，没有 migration，也不触碰 `Engine.Actions.Workspace.ensure!/4`——engine 在 `runner` 模式下的缺口仍在 `CLAUDE.md` 中声明并保持开放。
