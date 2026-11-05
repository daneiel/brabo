---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-produto
title: 'Regras de negócio — Produto'
sidebar_label: Produto
description: 'As RNs hospedadas na raiz produto.'
keywords: [regras de negócio, produto]
---

# Produto

## Backlog

### RN-012 — 从 `module_map` 中移除的模块会使用户故事降级 {#rn-012}

关联到一个已不存在的模块的用户故事会回到 `draft`，并产生一个
`backlog.story_demoted` 事件。

- **位置：** `apps/api/src/domain/architecture/module-resolution.ts`；事件在
  `application/use-cases/architecture/create-module-map.use-case.ts:73` 中发出
- **测试：** `test/domain/architecture/module-resolution.spec.ts`

## 项目面板

### RN-096 — 每个决定都用葡萄牙语说明会发生什么；原始 payload 生来折叠 {#rn-096}

每种 `proposed_action` 都有一句描述批准效果的**葡萄牙语句子**，它是卡片上第一眼可见的东西——在任何细节之前，在需要做出决定的三个屏幕上（审批队列、会话聊天中的卡片和 Insights 标签页）。原始 payload 仍然可以访问，**放在一个生来关闭的折叠区内**，永远不会被倾倒在屏幕上。

**过去存在的是一次倾倒。** 每种没有自己视觉主体的类型都落入一个
`Object.entries(payload).map(([k, v]) => k + ': ' + JSON.stringify(v))`，总是展开。打开队列的人读到的是 `worktree: /workspaces/dev-api`、
`coAuthor: Brabo User <user@brabo.dev>` 和 `proposto: 4`——还得自己推断点击批准会发生什么。需要推断的审批就是会被自动放行的审批，而整个产品都依赖于用户是最终权威。

**句子会降级，正是这一点让它可信。** 没有一句假设 payload 中的某个键存在：payload 为空时，句子仍然是一句真实的句子，只是不那么具体（"Registra um commit no repositório do
projeto."）。payload 来自 engine 和十个不同的用例，没有一个承诺格式——只在正确的测试夹具下才成立的句子，会在第一次真实审批时崩溃。

**web 尚不认识的类型不是理论情况。** web 的 `ActionType` 联合类型已经两次落后：第一次是 Gitflow 引导的三种类型，又一次是 FASE
14d 引入的 `parallelize`/`raise_max_parallel`。编译器发现不了：规范列表在 `apps/api` 中，web 不导入它。因此同时做两件事——卡片**降级**（中性动词 + “查看详情”，payload 折叠，而不是在图标映射中得到 `undefined` 从而搞垮整个 React 树），并且**测试读取后端的 `decide.ts`**，在某个类型没有句子就进入时失败。

**展开/关闭的默认值是推导的，而不是配置的。** 规则只有一条——展开仍在等待当前观看者做决定的内容：在聊天中，是 `pending` 的操作；在队列中，从不展开（有 N 张卡片，N 个展开的细节就是同一堵文字墙）；在 Insights 中，是 `proposed` 的假设。而原始 payload 在任何变体中都不展开。设计上的结果是 `ApprovalCard` **没有获得新的必填 prop**：默认值来自本已存在的 `variant` 和 `status`。

**动词和句子出自同一个模块**，由三个屏幕消费。Psicólogo 的假设逐字使用 `instruction_patch` 的动词，而不是一套平行词汇——它的句子说的是 accept 实际做的事（排入 Anamnese 队列，后者**可能**提出调整，而调整仍需审批），永远不是“指令将被修改”。

**`write_file` 有句子，但没有主体。** 它生于
`COM_CORPO_PROPRIO` 之外：句子只显示 `path`，细节落入本 RN 要避免的那种折叠的原始 JSON 倾倒——于是一个真正需要审批的写入（不在 `dev-` 前缀下，或路径超出智能体范围）需要多点一次才能看到 `content`。它以自己的主体进入了 `COM_CORPO_PROPRIO`：`path` 和 `content` 的预览（最多 25 行/4,000 个字符，带截断提示——从不是整个文件，与原始 payload 规则相同），在聊天中待处理时默认展开，与 `terminal` 一样。

**空 payload 不是缺失的 payload。** `command`（terminal）或
`path`/`content`（write_file）以空字符串到达——模型生成的畸形工具调用，而不是渲染缺陷——过去会降级为一个
`$ ` 提示符或空白预览，用户把它读成屏幕的缺陷。两个主体现在区分这两种情况，并显示“模型没有为此操作生成有效的 X”而不是一片空白。

- **位置：** `apps/web/src/lib/aprovacoes.ts`（`VERBO_DA_ACAO`、`fraseDaAcao`、
  `descreverAcao`、`descreverHipotese`），由
  `apps/web/src/components/ApprovalCard.tsx`（审批 + 会话聊天，
  `COM_CORPO_PROPRIO`、用于 `write_file` 的 `content` 的 `previewConteudo`）和
  `apps/web/src/components/HypothesisCard.tsx`（Insights）消费；折叠通过
  `apps/web/src/components/ui/Disclosure.tsx` 的 `Disclosure` 实现
- **测试：** `apps/web/src/lib/aprovacoes.test.ts`（读取
  `apps/api/src/domain/actions/decide.ts` 的 `ACTION_TYPES`，要求每种类型都有动词 + 句子，payload 为空）；`apps/web/src/components/ApprovalCard.test.tsx`
  （`frase e colapso`——两种变体中 payload 都折叠，展开时 JSON 可读，未知类型不会搞垮屏幕，`write_file` 有自己的主体且默认展开、预览截断，`command`/`path`/`content`
  为空时显示后备消息）；
  `apps/web/src/components/HypothesisCard.test.tsx`（`frase e colapso`）
- **来源：** 16–26 计划的 FASE 19，源于在数据库重置后的第一次真实浏览中提出的“hoje está muito difícil a
  leitura”请求

---

## 仪表盘上的“N 个智能体在线”——**实时**状态，从不是历史在场（RN-409，ADR 0097）

之前 backlog 中的一项。事先调查（`docs/explanation/backlog.md`）确认不存在任何活跃度聚合——无论按项目还是按工作区：存在的只有**历史**在场
（`RosterFacts`——“曾在会话中出现过”），而**真正**的实时状态只在客户端，从事件日志推导，并且只在项目**打开**时才有（`deriveAgentRoster`）。仪表盘卡片过去强制使用
`() => 'ocioso'`，因为它不绘制任何状态——这就是本 RN 替换的硬编码。

### RN-409 — “N 在线”以**同一个**标准汇总两种机制：非空闲、非卡死 {#rn-409}

`ProjectCardSummary.onlineAgentCount`（`GET /workspaces/:workspaceId/
projects-summary`）是此刻**在线**的智能体数量——正在工作或有等待决定的待处理项——从不是团队规模。把实际上是“曾经出现过”的数字称为“在线”会产生误导（与 [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/
[0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)/
[0077](../adr/0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md) 反对伪造数据的原则相同）。

两个**来源**，一个标准：

- **Dev agent**——`engine.dev_agent_states.status`，按
  `project_id` 批量聚合（`status NOT IN ('idle', 'idle_tripped')`）。`working`、
  `awaiting_gate` 和 `awaiting_approval` 计入（RN-047/ADR 0052——dev 状态机的五种状态）；`idle`/`idle_tripped` 不计入。`dev-<modulo>` 和
  `dev-<modulo>-2` 是**不同**的键（表中的 `agent_id`），所以无需任何努力就能分开计数——主键本身就已分开。
- **对话型智能体**（criativo/po/arquiteto/dev-lead/ux-designer/
  staff/infra）——项目**最近**会话中每个 `actor_id` 的最后一个 `agent.status` 事件（与 `RosterFacts` 其余部分使用的会话范围相同，RN-090）。`agent.status` 只有三个可能的值
  （`Engine.Sessions.LiveBroadcast.agent_status/4` 拒绝任何其他值）：
  `working`/`awaiting_approval` 计入，`idle` 不计入。

**QA/SecOps 从不计入**——这不是筛选，而是数据**缺失**：两者都不发出 `agent.status`（每次调用运行一次判定，在调用之间没有“空闲”的概念——它们的状态来自 `pr.gate_changed`/
`infra.gate_changed`，一个 `deriveAgentRoster` 早已单独处理的独立机制）。不需要显式排除：查询只汇总具有正确事件类型的东西。

这个标准与项目打开时 `deriveAgentRoster` 本来就会应用的**相同**（客户端的 `'trabalhando'`/`'aguardando'` ≅ 后端的 `working`/
`awaiting_gate`/`awaiting_approval`）——**两条**路径从同一个最终状态（事件日志/持久化的状态表）计算“在线”，只是通过不同的**机制**（后端的 SQL 聚合，客户端对已获取事件的折叠），与
`infraActive`/`uxDesignerActive`/`staffActive` 的精神相同（RN-090/RN-287：两个来源，一个标准）。`apps/api` 和 `apps/web` 之间没有为此共享的函数——两者在 `RosterFacts` 的其余部分本来就在语言/运行时上分道扬镳，仅为一个计数引入共享包，代价会比问题本身更大。

**针对 api 不迁移的 schema 的新查询。** `engine.dev_agent_states`
是 **ENGINE** 的表（Ecto，Postgres schema `"engine"`），同一个物理数据库，同一个连接——不是第二个数据源，而是同一个 Postgres 中的第二个**命名空间**。先例早已存在：`apps/api/scripts/medir-execucao.ts`
已经通过同样的路径（经由 Drizzle 的原始 SQL）读取 `engine.oban_peers`，只是作为手动**脚本**，从未被测试。这条 RN 把这一模式提升为经过测试的**生产**代码——关于**不**把它作为 engine 中的内部 HTTP 路由暴露的决定，见 [ADR 0097](../adr/0097-leitura-direta-do-schema-do-engine-para-online-agent-count.md)。

**成本是测量的，不是假装免费的。** 两个新查询使读模型的总数从**十二**增加到**十四**（RN-090 仍然有效——十四是**恒定**的，由 `projects-summary.repository.spec.ts` 在 2 个和 20 个项目下统计数据库往返次数来证明）。两者都没有按时间的 `WHERE`——`agent.status` 的那个扫描的是 `lastEvents`/`marcos` 在旁边已经扫描的最近会话的相同 `session_events`，因此边际成本是在一个本来就会发生的查询计划上多一个 `type` 筛选，而不是从零扫描一张新表。**声明**的缺口：没有近期的、具有生产量级的真实运行（dogfooding）来对照第 22 阶段的标准（52.5 万行，`EXPLAIN ANALYZE`）测量真正的 `ms`——两个新查询没有测量数字，只有上面的结构性论证。

- **位置：** `apps/api/src/application/ports/projects-summary-repository.port.ts`、
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`、
  `apps/api/src/interfaces/http/iam/dto/iam.response.dto.ts`、
  `apps/web/src/lib/api-types.ts`、`apps/web/src/components/ProjectCard.tsx`、
  `apps/web/src/routes/Dashboard.tsx`
- **测试：** `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  （`describe('onlineAgentCount (RN-409)')`——dev agent working/idle/
  idle_tripped、awaiting_gate/awaiting_approval、同一基础智能体的两个实例、对话型智能体 working/idle/awaiting_approval、只有**最后一个** `agent.status` 计入、QA/SecOps 从不计入、两个来源之间的求和、项目之间的隔离）；
  `apps/api/test/support/global-setup.ts`（`ensureEngineFixture`——engine 的表作为**最小**且已声明的测试夹具创建，只为让上面的测试得以存在）；
  `apps/web/src/components/ProjectCard.test.tsx`（徽章“N online”在
  `0`/`undefined` 时消失，在 `onlineAgentCount > 0` 时出现）
- **来源：** `docs/explanation/backlog.md`（继承自 FASE 13c/dogfooding 收获的项）；数字必须是真正的活跃度而不是历史在场，这一产品决定记录在委托这次修正的提示词中

---

## Runner 的文件夹浏览器变成三列，`runner` 项目的创建不再等待最后一步（RN-436/436）

### RN-451 — 独立二进制的冒烟测试运行真实的**子进程**，从不模拟 {#rn-451}

`smoke-dist.mjs`（ADR 0106）已经应用于发布到 npm 的
`dist/index.cjs` 的同一纪律，现在也适用于
`dist-bin/brabo-runner-<platform>-<arch>[.exe]`（ADR 0112）：没有任何测试套件能通过阅读源代码来证明一个**打包**后的制品可以工作——只能真正执行该制品，作为子进程，并观察真实输出。`scripts/smoke-bin.mjs` 运行**编译后**的二进制（从不是
`node src/index.ts` 或任何未编译的形式），带上 `--self-test-pty`
——一个内部标志，没有在 `uso()` 中记录——它完全按生产方式解析 `node-pty`，并通过 `GerenciadorDePty` 派生一个真实的 PTY，向其写入并从中读取。只有真实进程 stdout 中的 `node-pty carregado com sucesso` 这一行 +
`SELF_TEST_PTY_OK:` 才算证明；对这个特定测试，模拟 `node-pty` 或 `child_process` 都是不可接受的，因为它存在的目的恰恰是证明嵌入的原生 `.node`（`with { type: 'file' }`，`native-pty-embed.generated.ts`）在二进制**内部**加载并工作——模拟路径上的任何部件都会抹掉测试唯一需要证明的东西。

- **位置：** `apps/runner/scripts/smoke-bin.mjs`；`apps/runner/src/index.ts`
  （`rodarAutoTestePty`，`--self-test-pty` 的实现）
- **测试：** `smoke-bin.mjs` 本身——有意没有替代它的单元测试（与 `smoke-dist.mjs` 的设计相同，后者也没有对应的单元测试）
- **ADR：** [0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)
- **来源：** 产品负责人对这个 backlog 项的明确要求（“no mocking”）

---

## 本地 runner 的终端永远卡在“Abrindo terminal...”（RN-433）

### RN-453 — 本地 runner 的相对 `--dir` 针对 `INIT_CWD` 解析，而不是针对 pnpm 重设的 cwd {#rn-453}

`lerArgumentos()` 中的 `resolve(dirBruto)` 过去针对
`process.cwd()` 解析相对的 `--dir`——当 CLI 直接运行时（独立二进制，`npm install -g @brabo/runner`）是正确的，但在如今没有真正发布到 npm 时唯一存在的调用路径上是**错误**的（真实发现，ADR 0106/backlog）：`pnpm --filter runner start` 把 `process.cwd()` **重设**为**包**的文件夹（`apps/runner`），而不是用户输入命令所在的文件夹。从 `~/dev/brabo` 运行的
`pnpm --filter runner start -- --dir ../exp001` 会创建 `~/dev/brabo/apps/exp001` 而不是 `~/dev/exp001`——悄无声息，没有错误，因为 RN-435 已经让不存在的 `--dir` 被创建而不是被拒绝。

`resolverDir()`（`apps/runner/src/guard.ts`）在存在时针对 `INIT_CWD` 解析——npm/pnpm **总是**用原始调用文件夹设置的变量，只在进程由 `package.json` 的脚本产生时才存在——不存在时回落到 `process.cwd()`（直接运行二进制，那里本来就是正确的文件夹）。当 `dirBruto` 是绝对路径时，Node 的 `resolve()` 本就忽略基准，所以绝对路径（README 中记录的情况）的行为不变。

- **位置：** `apps/runner/src/guard.ts`（`resolverDir`）、`apps/runner/src/index.ts`（`lerArgumentos`）
- **测试：** `apps/runner/src/guard.spec.ts`（`describe('resolverDir', …)`
  ——存在 `INIT_CWD` 时相对路径针对它解析，不存在时回落到进程的 cwd，绝对路径忽略两种基准）
- **ADR：** [0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  （附加扩展，与 RN-435 同类——降低调用摩擦，不改变 runner 作为路径事实来源的地位）
- **来源：** 在真实使用中发现，从单仓库检出内部运行 `pnpm --filter runner start --
  dir ../exp001`——这是如今唯一可用的调用路径，因为 `@brabo/runner` 还没有真正发布到 npm（`NPM_TOKEN` 待定，见 ADR 0106 的 backlog）

---

## RAG 检索留下痕迹，痕迹冻结权重（RN-479..481）

### RN-481 — `rag.search`/`rag.feedback` 是时间线的**叙述**，只在有会话时存在 {#rn-481}

这两个事件**只在智能体路径中**进入事件日志——标签页中的检索属于项目，没有可以叙述的会话。这是声明的不对称，不是缺口：**表是测量的来源，事件是叙述**。按事件日志测量会丢失一半的检索，而且恰好是有人工判断的那一半。

叙述失败既不让检索失败也不让投票失败：表中的行已经写入，测量读取的就是它。失败变成来源为 `infra` 的日志，从不是沉默。

`'rag'` 在同一个 commit 中加入 `PREFIXOS_DE_EVENTO`（`scripts/docs/generate.mjs`）——没有它，生成的 `docs/reference/events.md` 清单看不到这两种类型，而 `pnpm docs:check` 会在一个不完整的列表上保持绿色：一份撒谎却通过的文档比一份失败的文档更糟。

- **位置：** `apps/api/src/domain/rag/rag-telemetry.ts`
  （`EVENTO_RAG_SEARCH`/`EVENTO_RAG_FEEDBACK`）、
  `apps/api/src/application/use-cases/rag/hybrid-search.use-case.ts`、
  `apps/api/src/application/use-cases/rag/record-rag-feedback.use-case.ts`、
  `scripts/docs/generate.mjs`（`PREFIXOS_DE_EVENTO`）
- **测试：**
  `apps/api/test/application/use-cases/rag/hybrid-search.use-case.spec.ts`
  （有会话时叙述；没有会话时**不**叙述）、
  `apps/api/test/application/use-cases/rag/record-rag-feedback.use-case.spec.ts`
  （投票的同一对用例）
- **ADR：** [0129](../adr/0129-telemetria-de-busca-do-rag-como-tabela.md)
- **来源：** 产品负责人的计划，第 2 部分 / 第 1 步

### RN-485 — 容器 broker 不接受规格：它接收一个项目并**组装** {#rn-485}

broker（`apps/broker`）是产品中唯一能访问服务器上 Docker 守护进程的进程。让它不随意的规则不是允许列表：而是**输入的形状**。

**它接收 `projectId` 和五种操作之一——仅此而已。** 这五种是
[ADR 0128](../adr/0128-porta-de-docker-e-a-prova-de-empacotamento.md) 的 `DockerPort` 的操作
（`start`、`stop`、`remove`、`inspect`、`exec`），第六种是带 ADR 的产品决定，永远不是多一个参数。`start`、`stop` 和 `remove` 的请求体为**空**；`exec` 带命令和 `cwd`，别无其他。

**规格从 api 读取并在这里**组装**。** broker 调用
`GET /internal/projects/:projectId/container-spec`，它返回项目身份、执行模式和 Arquiteto 当前的镜像决定。镜像、网络、资源和唯一的挂载都出自那里。不存在可以写入 `privileged`、`cap_add`、`network: host` 或自由 `-v` 的字段——因为根本没有字段。如果规格随请求体传递，一个在宿主机上等同 root 的进程的约束就会依赖于**调用方**是否正确，而依赖调用方的约束不是约束。

**它重新校验 api 返回的内容，两种校验并不相同。**
`validarDecisaoDeImagem`（api）问的是“这个架构决定可审阅吗？”——要求 `rationale`，拒绝 `latest`，应用 `RECURSOS_MAXIMOS`，并通过工具结果把拒绝返回给**模型**（RN-061）。`especificacaoValidada`（broker）问的是“我能把这个交给守护进程吗？”——它是把不可信 JSON **解析**进封闭类型。这里的上限是 **broker** 的，即它无论请求来自哪里都绝不越过的最后防线；如今这些数字有意与 api 的一致，若有一天出现分歧，较小者胜出而不会破坏任何东西，因为两者都不声称自己是对方。有一项检查只存在于这一侧：以 `-` 开头的镜像引用会被 CLI 读作**标志**，而不带 shell 的 `execFile` 解决的是**命令**注入，而不是**参数**注入。

**api 不发送任何路径。** `docker run` 的 `-v` 由**守护进程**针对**宿主机**的文件系统解析——api 容器内的路径会让守护进程创建并挂载一个**空**文件夹，dev agent 在没有代码的目录中工作，而没有任何迹象表明原因。broker 用**它自己的**配置 `PROJECT_WORKSPACES_HOST_ROOT` 加上创建时冻结的 `workspaceDirName`（RN-109）组装路径。没有这个变量，`start` 会**拒绝**并点名它；另外四个操作继续工作。拒绝是规则：猜测会静默地产生空挂载。

**`mounted`/`runner` 项目以 409 拒绝**，因为它们的文件夹位于用户的机器上，broker 的宿主机看不到它——在那里启动容器的是 runner。这与 `RegistrarTransicaoDeContainerUseCase` 在 api 中已经应用的策略相同，在 broker 能说出它的地方说出来。

**没有任何东西触发启动。** 没有循环，没有队列，没有 `container_start` 的 `proposed_action`：broker 在被调用时才行动，而如今存在的唯一调用方只做**读取**。外部效果仍然需要审批。

- **位置：** `apps/broker/src/operacoes.ts`（五种操作，以及在
  `especificacaoDoProjeto` 中的组装）、`apps/broker/src/servidor.ts`（封闭的路由列表和状态表）、
  `packages/docker-port/src/spec-de-container.ts`（解析和上限）、
  `apps/api/src/application/use-cases/containers/obter-spec-de-container.use-case.ts`
  （api 返回的内容，以及它不返回的路径）、
  `apps/api/src/interfaces/http/internal/internal-containers.controller.ts`
- **测试：** `apps/broker/src/servidor.spec.ts`（请求体中发送的镜像、网络、资源和挂载被**忽略**；镜像以 `-` 开头的制品是 422，什么都不触碰；第六种操作是 404；`/work` 之外的 `cwd` 被拒绝，包括 `/workspace`；没有 `PROJECT_WORKSPACES_HOST_ROOT` 时 `start` 拒绝并说出缺少哪个变量）、
  `packages/docker-port/src/spec-de-container.spec.ts`（逐字段解析）、
  `apps/api/test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts`
  （api 不返回任何路径，也不返回 `rationale`）、
  `apps/api/test/infrastructure/http-clients/container-broker.client.spec.ts`
  （`start` 发送空请求体）
- **ADR：** [0130](../adr/0130-broker-de-container.md)

### RN-497 — `brabo-runner` 在**用户的机器上**、用**用户的** Docker 启动项目的容器 {#rn-497}

关闭 RN-494（ADR 0135）声明的那一半：`mounted`/`runner` 开始**要求**已决定的镜像（RN-105 的门槛在三种模式下都有效），却仍然不启动**任何**容器——只有 `execution_mode: container` 有一个能真正调用 Docker 的角色（broker，`apps/broker`）。`container_start`/`container_stop`/`container_remove`（RN-491/495）现在有了**第二**条执行路径，在 `ExecuteContainerStartUseCase`/`ExecuteContainerStopUseCase`/
`ExecuteContainerRemoveUseCase` 内部按项目的 `executionMode` 分支——从不在操作的**提议**或**批准**中分支，它们仍与模式无关（`decide.ts` 不变）。

**`container` 继续经由 broker，没有任何变化。** `mounted`/`runner`
请求 **ENGINE**（`ApiToEngineClient.startContainerViaRunner`/
`stopContainerViaRunner`/`removeContainerViaRunner`，与
`executeTerminalAction` 一样同步）转交给已连接的 **RUNNER**——早已维持 `terminal:<projectId>` 频道的 CLI（ADR 0103/0104）获得**三**对新事件，`container_start`/`_result`、`container_stop`/`_result`、
`container_remove`/`_result`（`apps/runner/src/channel.ts`），与
`exec`/`exec_result` **相同**的模子：`Engine.Runners.RunnerRouter` 把它分派到按 `ref` 关联的频道并阻塞在 `receive` 上，runner 用**用户的 Docker**——而不是服务器的——调用 `DockerViaCli.start/stop/remove`（`@brabo/docker-port`，ADR 0128）并回应。`EngineWeb.
ContainerCommandController`（路由 `POST internal/projects/:projectId/
containers/{start,stop,remove}`）是唯一的调用方；engine 一侧没有其他路径能到达这三个操作。

**启动的镜像不会被**再次**选出**——与 `container` 路径相反，后者复用 `DecidirImagemDoProjetoUseCase` 来写入新版本的 `artifact.project_image`。`mounted`/`runner` 路径只**读取**当前的决定（`ObterSpecDeContainerUseCase`，即早已为 broker 组装 `GET .../container-spec` 的**同一个**用例——直接调用，不经 HTTP，因为两者都在 api 进程中运行）并把它发给 runner；没有已决定的镜像（RN-105）时，在询问 engine **之前**就失败。

**“没有已连接的 runner”是**普通失败**，从不是通用异常**——与 `container` 路径中 `BrokerIndisponivelError`/`BrokerRecusouError` 相同的纪律。`RunnerNaoConectadoError`（没有 runner，或超时）和
`RunnerRecusouContainerError`（runner 回应了并**拒绝**——用户机器上 Docker 不可用、规格无效）是 `HttpApiToEngineClient` 抛出的两个类；三个用例捕获它们并以原因写入 `failed`，从不让它们传播。在 engine 一侧，响应**总是** 200——正文中 `sucesso: false`，只有当 engine **甚至没有**询问 runner 时（`RunnerRouter` 返回了 `{:error, _}`）才带 `motivoCodigo`（"not_connected"/"timeout"），对于命令的普通失败从不使用错误 HTTP 状态。

**`Engine.Actions.TerminalExecutor` **没有**获得新出口。** “在宿主机上运行命令，还是在这个 runner 启动的容器内运行”的决定是 runner **内部**的——`decisao_de_execucao/1` 早已把已连接 `runner` 项目的每个命令**无条件**路由到 `RunnerRouter.exec/4`（RN-423）。改变的只有 `apps/runner/src/index.ts`：`EstadoDoRunner` 获得
`containerAtivo`（**这个** runner 启动的容器的**名称**，或 `null`），`tratarExec` 在有活动容器时改为路由到 `DockerViaCli.exec`（经由 `docker exec`），没有时走一贯的路径（直接在宿主机上 `executarComando`）——`cwd` 已经由
`validarCwdDentroDaRaiz` 针对项目根目录校验，通过**前缀**替换（`cwdParaContainer`，`guard.ts`）转换到 `/work` 内，与 engine 一侧 `cwd_para_container/2` 的推理相同（RN-492）。

**`guard.ts`（Linux 上 `$HOME` 内的约束，RN-434）开始也覆盖挂载的路径，**无需任何**新校验。** 容器的 bind-mount **就是**
`estado.dir`——`validarDirDentroDoHomeNoLinux` 在 CLI 启动时、任何容器启动之前就已校验过的同一个根。不存在第二项“挂载路径有效”的检查，因为不需要存在：挂载**就是**已确认的根，仅此而已。

- **位置：** `apps/runner/src/channel.ts`、`apps/runner/src/index.ts`
  （`EstadoDoRunner.containerAtivo`、`tratarContainerStart/Stop/Remove`、
  `tratarExec`）、`apps/runner/src/guard.ts`（`cwdParaContainer`）、
  `apps/engine/lib/engine/runners/runner_router.ex`
  （`start_container/stop_container/remove_container`）、
  `apps/engine/lib/engine_web/channels/terminal_channel.ex`、
  `apps/engine/lib/engine_web/controllers/container_command_controller.ex`、
  `apps/engine/lib/engine_web/router.ex`、
  `apps/api/src/application/ports/api-to-engine-client.port.ts`
  （`RunnerNaoConectadoError`、`RunnerRecusouContainerError`）、
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`、
  `apps/api/src/application/use-cases/actions/execute-container-start.use-case.ts`、
  `apps/api/src/application/use-cases/actions/execute-container-stop.use-case.ts`、
  `apps/api/src/application/use-cases/actions/execute-container-remove.use-case.ts`
- **测试：**
  `apps/runner/src/channel.spec.ts`（三对新事件的往返）、
  `apps/runner/src/index-handlers.spec.ts`（`tratarExec` 在宿主机与容器之间路由；`tratarContainerStart/Stop/Remove` 从不抛出）、
  `apps/runner/src/guard.spec.ts`（`cwdParaContainer`）、
  `apps/engine/test/engine/runners/runner_router_test.exs`、
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`、
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`、
  `apps/api/test/application/use-cases/actions/execute-container-start.use-case.spec.ts`、
  `apps/api/test/application/use-cases/actions/execute-container-stop.use-case.spec.ts`、
  `apps/api/test/application/use-cases/actions/execute-container-remove.use-case.spec.ts`
  （三者都有 describe "mounted/runner (ADR 0137)"）
- **架构决策：** [ADR 0137](../adr/0137-o-runner-sobe-o-container-do-projeto.md)
- **来源：** 产品负责人的计划，第 1 部分 / PR 1.3

## FASE 29 — 一行安装：为所发布的东西签名

### RN-525 — 二进制代理对照同一发布的清单核对哈希，无法核对时拒绝，并「说明」这是完整性而不是来源 {#rn-525}

`GET /runner-releases/binary` 是 `@Public()`，没有认证，是通过浏览器配置流程的第 4 步（[RN-473](web.md#rn-473)，[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)）。直到 FASE 29 的第 3 次会话，它只校验「输入」（`platform` 对照封闭的允许列表），并把 GitHub 的字节直接传给客户端，**什么都不校验**——它就是 [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md) 点名、[RN-524](ci.md#rn-524) 留待处理的那个消费者。

现在它在回应任何东西之前**对照「同一」发布的 `checksums.txt` 核对字节的 sha256**，`Content-Digest` 头（RFC 9530）重复核对过的哈希，让接收方可以重新计算。

**这项校验「不」做什么，写在执行它的地方。** 它**不校验**清单的签名（`checksums.txt.bundle`）。这是**对照清单的完整性，不是来源**：能改写 Release 的人可以改写两个文件并通过。关闭这一点的两种方式在本次会话中都被「测量」过，两者都被拒绝：

| 路径 | 测量结果 | 为什么不 |
|---|---|---|
| api 镜像中的 `cosign` | **155 MB**（`cosign-linux-amd64` v2.6.1） | 几乎让运行时镜像（Alpine + Node）翻倍，该镜像按 digest 发布在 GHCR 上（[ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)），只为校验一个可选的下载 |
| `@sigstore/verify` + `@sigstore/tuf` | **2.5 MB，12 个包** | 大小不是代价。`getTrustedRoot()` 会对照 `tuf-repo-cdn.sigstore.dev` 刷新 TUF 元数据（包的 `seeds.json` 只播种 `root.json`），所以一个今天依赖「一个」第三方主机的公开路由将依赖两个。而且，按 ADR [0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) 的尺子——能力只有在**被证明**时才声明——，今天无法证明这条路径：**没有任何 Release 有 `checksums.txt.bundle`**，因为 `checksums` 作业在第 2 次会话中诞生，只在正式 tag 中运行，这一缺口 [RN-524](ci.md#rn-524) 本身已在签名一侧声明 |

校验「签名」的是 `install.sh`（第 4/7 次会话），它有真正的 `cosign`，并以 `sha256sum -c` 固定方式下载它（ADR 0149 的决定 4）。**对于这条路由的来源一半，BRB-005 仍然开放**，[登记表](../reference/brb.md)说明了这一点——这不是脚注，而是这条路由所能证明之事的边界。

**没有 `checksums.txt` 的 Release 就「拒绝」，绝不是「带警告地提供」。** 点一下就能接受的警告，就是不存在的校验（ADR 0149，决定 3）——而且这会是最廉价的降级：删除 Release 中 400 个字节就能关掉所有人的核对。代价已测量且很小：v5.0.0 中有两个二进制（`linux-x64`、`linux-arm64`），没有清单，而二进制这一步在浏览器流程中是**尽力而为**的（[RN-473](web.md#rn-473)，第 4 步）——它会落到 `npm install -g @brabo/runner`，后者不依赖任何发布。ADR 0149 之后第一个 tag 之前的每个发布，按构造都落入这条路径。

**六种 502 结果不坍缩。** 仅凭状态码无法区分它们，而它们要求调用方采取不同的行动，所以拒绝在正文中携带一个 `motivo`——`plataforma_nao_publicada`、`release_sem_manifesto`、
`manifesto_nao_cobre_a_plataforma`、`manifesto_ilegivel`、`download_falhou`、
`hash_divergente`。这是 [RN-470](web.md#rn-470) 的尺子用在 api 回应上：「该平台还没发布」让人等下一个发布，「发布没有清单」让人用 npm，「哈希不一致」是事件。尤其是，「清单未在发布中列出」和「清单已列出但下载失败」是「不同」的结果——混淆它们会因为一次瞬时网络故障而让人改用 npm 安装。

**核对哈希需要读取所有字节，而这要经过磁盘。** 把二进制的约 79 MB 缓冲在内存中，在公开路由上会是轻而易举的耗尽（api 的 pod 有 `limits.memory: 512Mi`），而缓存字节会更糟——五个平台 × 79 MB。字节以**流**的方式写入 `/tmp` 中的临时文件（一个 `emptyDir`，之所以挂载正是因为 api 的根文件系统是只读的），哈希在途中计算，文件**只在**哈希匹配之后才以流的方式重新读给客户端：内存恒定，没有任何未经核对的字节到达客户端。256 MiB 的上限会在填满 `/tmp` 之前中止荒谬的回应。现有的缓存（URL，5 分钟）**保留**，并开始同时保存已解析的清单——几百字节的「文本」，绝不是二进制字节——放在「同一个」条目中，绝不放在自己的缓存中：在不同的窗口里，中途发布的一个版本会让新哈希被拿去对照旧二进制，结果会是一个看起来像篡改的 `hash_divergente`。

- **位置：** `apps/api/src/interfaces/http/runner/runner-releases.controller.ts`
  （校验、字节上限、临时文件以及 `Content-Digest`），
  `apps/api/src/interfaces/http/runner/checksums.ts`（清单的纯读取以及 `MotivoDaRecusa` 联合类型），
  `apps/web/src/lib/runner-bootstrap.ts`（`baixarBinario` 开始从正文读取 `message` 和 `motivo`，这句话到达 `falhaDoBinario`）
- **测试：** `apps/api/test/interfaces/runner-releases.controller.spec.ts`
  （带 `Content-Digest` 的正常路径；哈希不一致时正文中「没有」任何字节或头；没有清单的发布在下载二进制之前拒绝；不覆盖该平台的清单；不可读的清单；下载失败；以及把发布和清单一起保存的缓存）以及同一文件的 `describe('parsearChecksums')`；`apps/web/src/lib/runner-bootstrap.test.ts`（api 的语句和 `motivo` 到达调用方，非 JSON 正文不会变成第二个异常）
- **来源：** FASE 29，第 3 次会话。[ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md)，决定 3 表格中的第三个消费者——就 api 今天能证明的那「一半」而言，另一半被点名而不是假装
| `BACKUP_DIR` 指向一个存在但「不」接受写入的目录 | 备份在 `pg_dump` 「之前」拒绝，说明问题在于「写入」——只读目标会通过存在性测试，之后才失败，诊断会指向错误的地方（RN-528） |
| 并发的 `git gc` 在裸仓库 `tar` 中途删除了一个 packfile | 该次执行在 `backup_runs` 中变为 **`failed`**，点名 `tar` 的状态——绝不是宣称自己完好的不完整归档，因为只有失败会变成告警（RN-528） |
| `git_local_repos` 卷未挂载在备份容器中（k8s 的 CronJob） | 该步骤被**跳过并在日志中说明**——「未挂载」绝不与「已挂载且为空」坍缩，后者是没有 `local` 项目的安装的正常状态（RN-528） |
| 卷中有裸仓库，而 `git-daily/` 前缀中「没有」任何归档 | `brabo-restore-git` **否决**，说明这个卷没有覆盖——不存在且为空是另一种结果，以成功退出（RN-528） |
| 裸仓库的归档被截断 | 在「读取」时否决（`tar -tzf`），绝不按大小：截断的 tar 字节还绰绰有余。这是 git 一侧的 `pg_restore --list`（RN-528） |
| 在已有裸仓库的卷上运行 `brabo-restore-git --restaurar` | 拒绝：叠加两种仓库状态不会报任何错误，只会在某次历史错误的 `fetch` 中显现。真想这么做的人用 `RESTORE_GIT_FORCE=1`（RN-528） |
| 无法写入卷时运行 `brabo-restore-git --restaurar`（uid 70 × api 的所有者） | 在 `tar` 「之前」拒绝，点名 `--user 0:0`——在解压途中才发现会让卷只完成一半。而以 root 解压的内容会交还给「目录」的所有者（RN-528） |

### RN-526 — 安装程序校验自身的来源，在提问之前「点名」它发现的东西，绝不删除用户文件夹 {#rn-526}

`install.sh`（仓库根目录，版本化并作为 Release 的资产发布）是唯一的安装入口。四项保证，每一项都针对一个具体缺陷：

**调用方式保留 stdin 并留下一个「文件」。** 文档化的形式是 `curl -fsSLO …/install.sh && bash install.sh`——下载一个文件并用 `bash` 运行——，**绝不是** `curl … | sh`：脚本经由管道到达时，进程的 `stdin` 「就是」下载内容，任何 `read` 都会读到脚本自身的字节或遇到 EOF。一个无法提问的安装程序会自行选择在别人电脑上的哪里创建文件夹——与 RN-511 已经应用于基目录同意的尺子相反。直到 AT-083，文档化的形式都是 `sh -c "$(curl -fsSL …)"`，而它**从未奏效**：对自身来源的校验（下一段）计算 `$0` 的哈希，而在 `X -c "…"` 中 `$0` 是 shell 的名字，不是文件；当 `sh` 是 `dash` 时，脚本更早就死在 `set -o pipefail` 上。维护者的决定（9月18日）是改「文档」并保留按 `$0` 的校验，**没有**跳过的后门（ADR 0150）。错误的形式变成了**点名的拒绝**，在第一次下载之前，并打印正确的形式：在不是 bash 的 shell 下运行（顶部的 POSIX 块，在 `set -o pipefail` 之前），以及在没有文件的情况下运行（`exigir_o_proprio_arquivo`，它要求顶层的 `BASH_SOURCE` **以及**可读的 `$0`——`/bin/bash -c` 会留下 `$0=/bin/bash`，它确实存在，没有前一半的话，它的哈希会被送去对照清单，人会读到篡改的那句话）。这种形式是「一个」常量（`COMO_RODAR`），由拒绝和无 TTY 的报告使用。

**它在行动前校验自身的来源**，链条有两环：Release 中 `checksums.txt` 的签名（RN-524），以及已校验清单中**本文件**的哈希。执行校验的 `cosign` 本身也按版本固定，并对照脚本中写下的值核对哈希——信任 `install.sh` 到足以执行它的人，也信任它携带的哈希，链条不会比起始的那一环更脆弱。任何一环失败都是**点名的拒绝，绝不是警告**。

**计算哈希只有「一个」函数和「两种」可接受的工具**——`sha256sum` 或 `shasum -a 256`——，在**第一次下载之前**解析，绝不在校验中途：没有东西可用来核对的机器，就不应该拿到需要核对的东西。两者都缺是**「自己的」拒绝**，点名两种工具，说明各自在哪里，并断言什么都没有下载——绝不是哈希不一致的拒绝，那是**事件**的拒绝（*"pare e investigue"*）。这种区分不是风格：脚本原本在五个校验点直接调用 `sha256sum`，macOS 不带它，`command not found` 以篡改指控的形式传达给安装者——阻断了脚本自身支持的平台上的所有安装（其中固定了 `darwin-*` 的 `cosign`），并教人在那句话为真的那天忽略它。`--print-plan` 在两者都没有的情况下运行，并声明脚本接受哪个（`conferir-hash`）。自 AT-083 起还有「第三种」拒绝：工具存在但**无法读取文件**。没有它，`hash_sha256` 会从命令替换内部返回空值（`errexit` 到不了子 shell），随后的比较会以调用方的事件文本失败——经由另一条路的 AT-091 篡改指控。现在是 `falha_ao_calcular_hash`，它点名文件并说明没有可比较的东西。

**检测会点名它发现的东西。** 有标记（`$XDG_STATE_HOME/brabo/install-state.json`）时依据标记；没有时依据信号（compose 项目 `brabo*`、unit `brabo-runner-*`、PATH 中的二进制）——列表在任何提问**之前**打印。不存在这样的路径
「我发现了某样东西并自行决定」。没有 TTY 时，脚本**报告并以 0 退出**，就像 `consentir-base.mjs` 已经做的那样。

**它绝不删除用户文件夹。** 项目基目录和镜像文件夹不在任何确认的范围之内——与镜像相同的尺子（RN-516）：用户文件夹是累积，不是产品状态。具名卷只有在确认后才删除，并在提问之前逐一列出。

标记存放在 `$XDG_STATE_HOME` 中，**而不是** `~/.brabo/`，后者是 runner 存放按「项目」的东西的地方：安装状态和项目配置是不同的生命，把它们放在一起会让删除其中一个时抹掉另一个。

**位置：** `install.sh`（根目录）。
**测试：** `scripts/dev/install.spec.ts`——`--print-state` 和 `--print-plan` 模式在没有 TTY、没有网络、没有副作用的情况下证明「决定」，仿照 `bootstrap.spec.ts`；而 *"o hash num PATH sem sha256sum"* 块在真实的 shell 中运行哈希函数，`PATH` 逐个工具地组装，核对「两种」拒绝（工具缺失 × 哈希不一致），以及前者绝不使用后者的措辞；
`scripts/dev/install-invocacao.spec.ts` 以错误的形式运行脚本（`bash -c`、`/bin/bash -c`、管道、`dash -c`、`dash install.sh`），要求在任何下载之前给出带正确形式的点名拒绝、第三种哈希拒绝，以及 runbook、bootstrap 和文件头教的是「同一种」形式。
**来源：** FASE 29，第 3 次会话（[ADR 0150](../adr/0150-instalador-de-uma-linha.md)）。在本次会话中脚本**什么都不安装**——启动 compose、生成密钥和安装 runner 是第 4 和第 7 次会话，它在输出中**说明这一点**，而不是悄无声息地结束。

### RN-531 — 安装程序为两边同意「一个」基目录，并安装已可执行的本地代理 {#rn-531}

**一个基目录，同意一次。** `install.sh` 询问项目将住在哪里，并把同一路径写入「两个」地方：`.env` 中的 `BRABO_PROJECTS_BASE`（服务器，[ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md)）以及 `runner.json` 的 `base` 字段（本地代理，[RN-529](runner.md#rn-529)）。`mounted` 与 `runner` 之间的差别是**谁来执行**，而不是代码住在哪里——同一文件夹的两个不同基目录，就是 ADR 0141 明文拒绝的命名空间冲突。

基目录在不是绝对路径、位于 Brabo 检出**之内**以及**包含**检出时被拒绝——两个方向都检查，就像 `preflight.mjs` 在服务器一侧已经做的那样。`~` 有意不展开：值会写进配置文件，而写在那里的 `~` 会被按字面读取。

**本地代理以已可执行的状态安装。** 二进制被下载，对照脚本为核对自身而已经校验过的**同一个**签名 `checksums.txt` 核对（RN-524）——下载两次会有两次拿到不同清单的机会，而第二次不会被校验——并用 `install -m 0755` 安装，它在复制的同一动作中设置执行位。

**这关闭了 BRB-031。** 手动的 `chmod +x` 在 FASE 28 中幸存下来，因为作为服务的安装并非来自一个版本化的产物：走到运行 `brabo-runner service install` 的人，为了到达这个命令，已经必须让二进制可执行。来自安装程序时，这一步消失了——浏览器的 File System Access API 不保留该位，脚本保留。

没有该平台二进制的 Release **不会中断安装**：其余部分已经运行起来，消息指向 `npm install -g @brabo/runner`。这与通过浏览器配置时二进制那一步的处置相同（RN-473），原因也相同——本地代理是最后一步，不是前置条件。

**位置：** `install.sh`、`consentir_base` 和 `instalar_o_runner`。
**测试：** `scripts/dev/install.spec.ts`——存在 `install -m 0755`，不存在面向用户的 `chmod` 指令，以及点名的对照已签名清单的核对。
**来源：** FASE 29，第 7 次会话（[ADR 0150](../adr/0150-instalador-de-uma-linha.md)，
[ADR 0151](../adr/0151-base-consentida-no-runner.md)）。

### RN-534 — 安装程序进入已签名的清单，并在一台干净的机器上得到演练 {#rn-534}

同一保证的两半。

**`install.sh` 进入 `checksums.txt` 和 Release。** 没有这一点，它对自身的校验（RN-526）就是一纸空文：它对照已签名的清单核对自己的哈希，而清单却不覆盖它。该文件来自 **tag 的检出**，而不是下载——这与在同一作业中被签名的所有其他东西出自同一个提交。

**它在一台干净的机器上得到演练**，这就是 Actions 的临时 runner：新创建的主机，没有 Brabo、没有 `.env`、没有标记。E2E 按这个顺序证明：**计划**没有停止承诺它绝不删除的东西；干净机器上的**状态**不捏造标记或信号；**没有 TTY** 时安装程序报告、以 0 退出且**不写入**；而在真正的 TTY 下（不是管道——管道恰恰会扼杀同意），完整安装会校验签名、核对自身哈希、写入标记，并让 `.env` 处于模式 **600**。

**更正（AT-083）：** 本段曾断言的「由 `script -qec` 模拟的 TTY」**对安装程序而言从来不是 TTY**。该步骤运行的是
`script -qec "… ./install.sh … < respostas"`，`<` 位于 `script` 的命令「之内」：安装程序的 stdin 是那个文件，`[ -t 0 ]` 永远为假，交互流程从未被演练。如今运行安装程序的是一个 Python 写的 PTY 驱动（`python3 -I`，没有新依赖），它把安装程序放在 pty 的从端，并在回答之前「等待」每个问题——对于两个密码问题，它等待回显「关闭」，这证明了 RN-547 的「无回显」，并防止密码出现在输出中。E2E 还以 runbook 规定的「同一种」形式下载并运行安装程序（`curl -fsSLO` + `bash install.sh`，RN-526），如果安装程序说出「Sem terminal interativo」，就立即否决。由于该工作流仍不在 PR 中运行，驱动被从中抽出，并在 `scripts/dev/install-e2e.spec.ts` 中针对一个假的安装程序进行演练（看到终端、按顺序回答、密码不出现在输出中，以及两个点名的停止点），旧形式被固定为「不」提供终端的那种。

**它不在 `pull_request` 中运行**，原因与签名相同：已签名的清单只在正式 tag 之后才存在。让脚本在 PR 中运行，就需要给它一个「跳过」校验的后门——ADR 0150 拒绝的那扇门，一旦打开就对任何人有效，而不只是 CI。这是 RAG 的 golden-set 出于同样推理早已做出的决定（[ADR 0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md)）：无法在 PR 中演练的东西按自己的节奏运行，工作流会**说明原因**，而不是假装有覆盖。

**位置：** `.github/workflows/install-e2e.yml`；
`.github/workflows/build-runner-binaries.yml`，作业 `checksums`。
**测试：** 工作流本身——`scripts/dev/install.spec.ts` 继续在无网络的情况下覆盖决定；`scripts/dev/install-e2e.spec.ts`（*"o TTY
do E2E é um TTY para o INSTALADOR"* 块）在 PR 中演练 PTY 驱动。
**来源：** FASE 29，第 10 次会话（[ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md)，
[ADR 0150](../adr/0150-instalador-de-uma-linha.md)）。

> **TODO(humano):** 以上 RN 提取自代码和测试。还需要确认是否存在**未实现**、却应该列在这里的业务规则——已商定但尚未编码的东西不会出现在这次扫描中。

---

## 代理的产物变成文件，放在 `docs/` 中（RN-523）

### RN-542 — 安装程序比较已安装的版本与将要安装的版本，提供的选项按关系而定 {#rn-542}

`install.sh` 自 [RN-530](infra.md#rn-530) 起就能检测之前的安装，并提供带有经证明备份的迁移。它**不**知道的是那里装的是**哪个**版本：标记（`$XDG_STATE_HOME/brabo/install-state.json`）记录了 `schemaVersion`、`instaladoEm`、平台、来源、digest 和路径——却没有任何说明 5.0.0 的东西。*"migrar esta instalação?"* 这个问题两边都是盲的，回答的人无从知道那是升级、降级还是重复。

这个信息一直触手可及却被忽略：Release 的 `images.json` 带有
`"versao"`，与 `commit` 和 `publicadoEm` 并列，而 `resolver_imagens_do_ghcr` 只读取 `repositorio` 和 `digest`。在另一端，`--source=local` 已经要求工作树**干净且位于 tag 上**——所以在那里 `git describe` 是可信的版本，凭借之前已经发生的两种拒绝。

**顺序就是决定。** 镜像改为在检测**之前**解析：知道要装进来的是什么，是询问现有的是否要移除的前提。标记升级为 `schemaVersion: 2`，并写入 `versao` 和 `commit`——两者一起，因为缺少该字段的新标记会被当成旧的。

手里有了两个版本，提供的选项就不再是一个问题，而是四个，每种关系一个：

| 关系 | 提供的选项 | 默认 |
|---|---|---|
| 更高 | `Atualizar 5.0.0 → 5.1.0?` | **是**——这是人来要做的事，而经证明的备份让它可逆 |
| 相同 | `Já é a 5.0.0. Reinstalar do zero mesmo assim?` | 否——没有可提供的收益 |
| 更低 | 点名**降级**，警告数据库迁移不会倒退 | 否——可能无法回头 |
| 未知 | schema 1 的标记没有版本：说明这一点，**不猜测** | 否 |

`maior` 分支是**唯一**默认为是的，也是唯一可以这样的：这一步可以通过刚刚证明过的备份撤销。其他三个要求键入 `s`。

**在任何分支中，安装都会被删除并从零重建**，绝不在上面覆盖启动——产品负责人的决定，与 RN-530 的理由相同：在另一版本的卷上执行 `up` 是不会提前告警的破坏，半次迁移比没有更糟。备份 → **证明** → 询问 → 删除 → 安装 → 恢复的链条在任何分支中都不变。

`comparar_versoes` 是手工实现的，**不**用 `sort -V`：macOS 的 BSD `sort` 很晚才有 `-V`，而这个脚本运行在别人的机器上——这正是已经让 `sha_do_cosign` 因 bash 3.2 而拒绝关联数组的那种纪律。它回显裁决而不是返回退出码，因为在 `set -e` 下一个合法的 `return 1` 会杀死脚本。

在 `pnpm bootstrap` 的菜单中，*Docker › Instalar (install.sh)* **报告**计划而不安装——这是机制，不是偏好：菜单项以 stdin 为 `/dev/null` 运行，以便菜单继续从同一终端读取按键，而这个安装程序的存在就是为了「提问」（这就是 [ADR 0150](../adr/0150-instalador-de-uma-linha.md) 拒绝 `curl | sh` 的原因）。这与 *Base de projetos* 菜单项（[RN-511](infra.md#rn-511)）的设计相同，菜单项的说明带有真正执行安装的命令。

- **代码：** `install.sh`（`comparar_versoes`、`campo_do_marcador`、
  `resolver_imagens_do_ghcr`、`resolver_imagens_locais`、`main`）；
  `scripts/dev/bootstrap.sh`（菜单项 `1.7`）
- **测试：** `scripts/dev/install.spec.ts`——*"a comparação de versões"* 和
  *"o marcador registra a versão"*；函数从脚本中提取出来由 `bash` 运行，绝不在 TS 中重新实现（拷贝在 shell 坏掉之后仍会通过）
- **运行时而非阅读时发现：** 对一个**没有点**的字符串执行 `cut -d.` 会返回整行，而不是空——所以 `5.0.0` 对 `5` 回答 `menor`。已在末尾补 `.0.0` 进行规范化，并有回归测试。
- **ADR：** [0150](../adr/0150-instalador-de-uma-linha.md)
- **来源：** 产品负责人的要求——*"o sh deve ser inteligente de
  entender que já há uma versão e verificar se será uma nova versão a ser
  executada ou não... caso seja uma nova ou escolhido isso pelo usuário deverá
  deletar a anterior e instalar do zero para evitar possíveis erros"*

## 设备密钥可以属于「机器」（RN-543，FASE 30）

### RN-543 — `runner_device_keys.project_id` 为空即「机器」密钥：对其「所有者」的项目有效，针对所请求的项目解析 {#rn-543}

本地代理的身份原本是按「项目」的。一台有三个 `runner` 模式项目的机器有三把密钥、三个带 `brabo-runner-device-key.jwk.json` 的文件夹和三个服务 unit——人要把同一个浏览器流程（[RN-464](api.md#rn-464)..[466](runner.md#rn-466)，[RN-475](web.md#rn-475)）走三遍，来描述**一台**机器。这是 [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md) 测量的五个耦合中的第 4 项；第 1、2、3 项（主题、socket id、票据）描述的是一条**连接**，N 条连接逐字节满足它们，所以**这里 engine 中没有任何变化**。

**一张表，两个种类。** `project_id` 有值 = 一直以来的「项目」密钥。`project_id` 为 NULL = 「机器」密钥。ADR 中考虑过并拒绝了姊妹表：`PatAuthGuard` 通过 `kid` 找到公钥，不需要知道种类，而两张表就要两次查找——第二次恰好会被遗忘一次。用 NULL 而不是哨兵值：FK 是真实的，`project_id = '00000000-…'` 会要求 `projects` 中有一行假数据。`user_id` 仍然是 `NOT NULL`——ADR 拒绝跨用户的密钥，因为凭据描述的是**谁**在行动。

**决定一切的点只有一个。** `PatAuthGuard.autorizarPapel` 原本在凭据的项目与路由的项目不同时拒绝。这项比较**没有**被删除：它正是阻止项目 A 的密钥服务项目 B 的东西，它**只**对空的 `project_id` 消失，因为那时没有可比较的东西。角色改为针对**所请求**的项目解析，这正是 ADR 0154 第 2 点的字面意思——*"a autorização continua sendo a de sempre, resolvida contra o
projeto pedido"*。**没有新的上限，也没有放宽任何上限**：机器密钥不会给 runner 任何其「所有者」本来没有的东西，在所请求项目中角色不足仍然是 403。PAT 分支不变——`personal_access_tokens.project_id` 仍然是 `NOT NULL`。

**代理「询问」它服务哪些项目。** `GET runner/projects` 返回处于 `execution_mode: 'runner'`、且凭据所有者至少达到 `developer` 的项目——与 `runner-ticket` 的「同一」最低角色，因为列出一个票据会被拒绝的项目，就是承诺下一个路由会否认的东西。它询问而不是扫描磁盘：机器的基目录属于用户，可能有不属于任何项目的文件夹，按文件夹名猜测是 [ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md) 拒绝过的那类错误。传输的是「段」（`workspaceDirName`，[RN-109](api.md#rn-109)），绝不是绝对路径——与 broker 相同的不变量。

这是**第一个路径中没有 `:projectId` 的 `@RequirePatAuth()` 路由**，两个后果都由测试锁定：只有「机器」凭据能进入（项目凭据只描述一个项目，没有可发现的东西——以「自己的」消息返回 403，绝不用「项目错误」的那条，那会对原因撒谎），也没有 `@RequireRole`，因为没有可以针对它解析的项目。最低角色按「行」应用，使用产品「唯一」的尺子（`ResolveEffectiveRoleUseCase.forProject`，`projectRole ?? workspaceRole`——[RN-471](web.md#rn-471)）；SQL 中的候选查询是 `alcança`，绝不是 `tem
papel`，在那里重写 `??` 就是第二把尺子。因此 `route-surface.spec.ts` 将其归类为 `jwt`——分类器读取 `@RequireRole`，看不到机制——而 `docs/security-surface.md` 在文字中纠正这一解读，正如它对 `runner-ticket` 已经做的那样。

**[RN-519](api.md#rn-519) 的列表开始说明「种类」。** 机器密钥服务所有者的每个项目，所以它进入所有项目的列表——带标记（`especie: 'maquina'`，`projectId: null`）。两半都是必需的：不进入列表，它会在每个界面上不可见且永久存在，这正是 RN-519 关闭的缺陷在新种类中重生；没有标记，同一行会出现在 N 个项目中，看起来像 N 把不同的密钥。种类在「一个」地方从 `project_id` 派生——没有它的列，也不应该有。

**吊销的目标变成「复数」。** [RN-520](api.md#rn-520) 断开 `{projeto, usuário}` 的活动连接，而机器密钥不点名任何项目。不断开会重新打开 RN-520 恰恰关闭的东西——密钥对「新」票据失效，而活动连接继续执行已批准的命令——，现在是 N 条连接而不是一条。所以吊销机器密钥会对所有者能到达的、处于 `runner` 模式的**每个项目**请求一次 `disconnectRunnerOfUser`。这是 ADR 事先声明的后果（*"revogar passará a derrubar
todos os projetos daquela máquina"*），而且它**无需触碰 engine** 就能实现：`{projeto, usuário}` 签名逐字节不变，只是被调用 N 次。列表来自「候选」，没有角色过滤，这是有意的——断开连接不是授权决定，漏掉一个项目会让吊销存在就是为了杀掉的东西继续运行。

- **代码：** `apps/api/src/db/schema/auth.ts`（`runnerDeviceKeys.projectId`，没有 `.notNull()`）；`apps/api/src/db/migrations/0058_public_war_machine.sql`；
  `apps/api/src/interfaces/http/auth/pat-auth.guard.ts`（`autorizarPapel`）；
  `apps/api/src/interfaces/http/runner/runner-projects.controller.ts`；
  `apps/api/src/application/use-cases/runner/list-runner-projects.use-case.ts`；
  `apps/api/src/infrastructure/persistence/drizzle/project.repository.ts`
  （`listRunnerModeReachableBy`）；
  `apps/api/src/infrastructure/persistence/drizzle/runner-device-key.repository.ts`；
  `apps/api/src/application/use-cases/auth/revoke-runner-device-key.use-case.ts`
- **测试：** `apps/api/test/interfaces/pat-auth.guard.spec.ts`——*"chave de
  MÁQUINA"*，「两个」方向都锁定（机器密钥在任何项目中有效；「项目」密钥在不同项目中仍被拒绝）以及没有 `:projectId` 的路由；`apps/api/test/application/use-cases/runner/list-runner-projects.use-case.spec.ts`
  （低于 `developer` 的角色被排除）；
  `apps/api/test/infrastructure/persistence/drizzle/runner-device-key.repository.spec.ts`
  和 `.../project-runner-mode.repository.spec.ts`（针对 Postgres——改变的是一个 `NOT NULL` 和一个 `WHERE`，没有任何假实现能证明其中任何一个）；`apps/api/test/application/use-cases/auth/revoke-runner-device-key.use-case.spec.ts`
  （*"o alvo da desconexão vira PLURAL"*）；
  `apps/api/test/interfaces/http/runner/runner-projects.controller.spec.ts`
- **已「声明」的缺口，由 [RN-552](api.md#rn-552)「关闭」：** 本 RN 关闭时，api 中没有任何路由**创建**机器密钥——该路由会在拥有第一个真实调用方的 PR 中诞生，即 `install.sh`（[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 4 点），绝不提前。事实正是如此：`POST /internal/machine-device-keys`。端口的类型已经是「列」的类型（`projectId: string | null`），这样未来的消费者在那里没有需要改的东西。而 web 仍然没有可以列出或吊销设备密钥的界面（RN-519 开放的一半）：新种类让缺口变得更大，它保持已声明，而不在这里关闭。**之后由 [RN-561](web.md#rn-561)「关闭」**，它就是那个界面——而这里创建的种类标记正是它用来不对吊销范围撒谎的东西。
- **ADR：** [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **来源：** FASE 30，第 2 次会话——
  [阶段的范围划定](../explanation/fase-30-runner-por-maquina.md)

## 安装的第一个账户在终端中诞生（RN-546）

### RN-546 — 内部路由创建「第一个」账户，已验证，并在存在任何用户时拒绝 {#rn-546}

[FASE 30](../explanation/fase-30-runner-por-maquina.md) 的第 5 次会话，由 [ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 决定。这是完成一行安装那一步的 api 一半；消费这条路由的 `install.sh` 是第 6 次会话，它已在 [RN-547](#rn-547) 中到来。

**漏洞，已测量。** 在新安装中没有人能进入。安装程序生成的 `.env` **没有任何**电子邮件变量，`MAIL_TRANSPORT` 落入默认值 `log`（`docker/docker-compose.install.yml`），而正常注册要求验证电子邮件——通过一个关闭的通道无法完成。安装以「Pronto」结束，唯一的出路是从 `docker compose logs api` 中捞出链接。

**路由。** `POST /internal/first-account`，`engine-service`——由 `BRABO_SERVICE_TOKEN` 认证，与其他内部路由使用同一个请求头和同样的常数时间比较。请求体 `{ email, senha, nome? }`，回应 `{ userId, email, workspaceId }`，`201`。

**为什么是内部的，绝不公开。** 一个公开的「创建第一个 owner」路由，是安装者与端口扫描者之间的赛跑，输掉赛跑的人就输掉了安装：第一个 workspace 的 `owner` 不是能通过 HTTP 找回的角色。service token 在正确的地方关闭了这场赛跑——它由 `install.sh` 本身生成，并以模式 `600` 写入 `.env`，所以出示它证明的是对**机器**的控制，而这正是这一步真正想要的凭据。

**账户诞生时即已「验证」，这是这条路由唯一放宽的东西。** 电子邮件验证证明的是*"esta pessoa controla esta caixa"*；运行安装程序的人已经证明了更强的东西——机器、带有五个密钥的 `.env` 以及 Docker 守护进程。通过安装知道已关闭的通道向她索要更弱的证明，是表演。**正常注册逐字节保持不变**：ADR 为一个点名的情况创建了一条路径，不碰另一条。

**拒绝针对的是「安装」，而不是电子邮件。**
`UserRepository.existeAlgumUsuario()`（`SELECT 1 … LIMIT 1`，绝不用 `count(*)`），存在任何用户时返回 `409`。问题针对 `users` 而不是 `auth_credentials`，因为通过社交登录配置的账户（[RN-278](api.md#rn-278)）诞生时没有凭据，询问凭据会在一个有人的安装中回答「没有任何人」。继承 `provisionarUsuario` 按电子邮件的幂等性，会把这条路由变成一个名不副实的账户创建器——只要换个地址就行。在迁移中（[RN-530](infra.md#rn-530)），用户随恢复而来，这一步按同一标准保持沉默。

**个人 workspace 在「同一」事务中**（[RN-410](api.md#rn-410)）。这是「第三个」账户创建点，它不获得自己的名称/slug 规则：调用与另外两个相同的 `nomeESlugDoWorkspacePessoal`。没有它，安装会以一个能通过的登录和一个「新项目」无处可建的 dashboard 结束——这是本阶段要填补的漏洞的一半，而不是另一半。

**抽取，以及为什么不用 `BRABO_FORCE_SEED`。** `provisionarUsuario` 拒绝在 `NODE_ENV=production` 下运行，而安装程序恰恰运行在生产环境。拒绝所保护的东西写在它的 docblock 中：**无人工交互**创建的**已知**密码。这条路由是另一类——密码由人在 TTY 中选择，无回显读取并经确认，位于 service token 之后，并且只在没有任何用户时。所以核心（让账户以已验证状态诞生的三次写入）变成了 `ProvisionarUsuarioUseCase`，而**拒绝留在脚本中**，那才是它所保护的。让安装程序把自己声明为「强制 seed」，会让它越过一条从未谈论过它的规则，并恰恰在拒绝有效的地方放宽它。

**一把密码尺子，而不是两把。** 领域的 `exigirSenhaValida`，由注册所调用的「同一」代码调用——因此这条路由的 DTO **不**重复一个 `@MinLength`：这次调用覆盖策略的「五种」拒绝，而不只是长度。`@MaxLength` 保留，因为它不是策略：它是对 argon2id 的保护，后者在派生之前会复制输入。`PoliticaDeSenhaError` 是领域 `Error`，没有全局过滤器，所以用例把它**转换**为 `400`——否则安装程序会把正确答案「选另一个密码」读成「服务器错误」。在那里转换不触及正常注册。

**认证轨迹中有「自己的」kind。** `first_account_created`，而不是 `register_created`：账户在没有发送任何电子邮件的情况下以已验证状态诞生，事后审计的人需要看到这一点被写下来，而不是凭旁边缺少 `email_verified` 来推断。TypeScript 中是封闭联合，数据库中是 `text` 列——新的 kind 不需要迁移。

**没有 `GET`。** 「存在任何用户吗？」是没有人需要从外部提出的问题：`POST` 回应 `201` 或 `409`，`409` 本身就是答案。一个读取路由会以多一个暴露面的方式发布同一事实，而它的回应正是扫描器想要的那个信号。

**新的暴露面是已声明的，而不是隐藏的。** 开始存在第二条在「生产」中有效的用户创建路径。它在三个独立的维度上都很窄（第一个账户、内部路由、service token），一旦安装有了人就消失。它写在 [`security-surface.md`](../security-surface.md)、ADR 的 Consequences 以及这里。

**一个已声明、未关闭的窗口。** 「存在任何用户」的检查在事务「之内」运行，但 `READ COMMITTED` 并不阻止两个电子邮件不同的并发调用同时通过。关闭它需要针对「行不存在」的咨询锁，而这不是约束所在之处：能到达这条路由的人已经拥有 service token，也就是说已经控制了整个安装。这个条件阻止的是这条路由「成为」永久的账户创建暴露面，而这一点它做到了。

**依 ADR 决定「未」纳入的：** 公开的第一个 owner 路由；由代码生成或默认的密码（密码绝不被记录——不在 `.env` 中，不在标记中，也不在日志中）；自行开启的 SMTP（`MAIL_TRANSPORT=log` 仍是已声明的默认值）；LLM 凭据（属于要花钱的人，[RN-058](api.md#rn-058)）；以及对正常注册的任何改动。

- **代码：** `apps/api/src/application/use-cases/auth/criar-primeira-conta.use-case.ts`
  （对有人安装的拒绝、密码尺子、个人 workspace 以及事件），`apps/api/src/application/use-cases/auth/provisionar-usuario.use-case.ts`
  （抽取出的核心，没有生产拒绝），
  `apps/api/src/scripts/provisionar-usuario.ts`（只有拒绝，加上委托），`apps/api/src/interfaces/http/internal/internal-first-account.controller.ts`，
  `apps/api/src/interfaces/http/internal/dto/first-account-internal.dto.ts` 和
  `…/first-account-internal.response.dto.ts`，
  `apps/api/src/application/ports/user-repository.port.ts` 和
  `apps/api/src/infrastructure/persistence/drizzle/user.repository.ts`
  （`existeAlgumUsuario`），`apps/api/src/domain/auth/auth-event.ts`
  （`first_account_created`），
  `apps/api/src/domain/auth/password-policy.ts`（「未改动」——这是复用的尺子）
- **测试：** `apps/api/test/application/use-cases/auth/criar-primeira-conta.use-case.spec.ts`
  （已验证账户和个人 workspace 的正常路径、自己的 kind、有人安装时的 `409`、因长度的 `400` 和因「非」长度原因的 `400`，以及名称的回退）；
  `apps/api/test/interfaces/http/internal/internal-first-account.controller.spec.ts`
  （转交给用例、缺失的 `nome` 变成 `null`，以及守卫的三种拒绝：缺少请求头、令牌错误、令牌正确）；
  `apps/api/test/scripts/provisionar-usuario.spec.ts`（生产拒绝「留在」脚本中，以及委托）；
  `apps/api/test/interfaces/route-surface.spec.ts`（路由的分类）
- **ADR：** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)，它依赖 [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)

## `install.sh` 完成安装（RN-547，FASE 30）

### RN-547 — 安装程序创建第一个账户、登记本机的密钥并把代理作为服务启动——中途失败的东西会被「报告」，绝不撤销，也绝不吞掉 {#rn-547}

[FASE 30](../explanation/fase-30-runner-por-maquina.md) 的第 6 次会话，由 [ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 决定。这次会话会同时触及三个 workspace，因此被**分成三次**：代理和 api 的两块已经关闭（[RN-546](#rn-546)、[RN-551](runner.md#rn-551)、[RN-552](api.md#rn-552)，基于 [RN-545](runner.md#rn-545) 的 unit），这里剩下的是作为**编排者、仅此而已**的 `install.sh`——`apps/` 中没有改动任何一行，也没有诞生任何路由。

**它填补的漏洞。** 一个新安装以「Pronto」结束，带着一个「没有人」能通过的登录：生成的 `.env` 没有任何电子邮件变量，`MAIL_TRANSPORT` 落入默认值 `log`，而正常注册要求验证电子邮件。唯一的出路是从 `docker compose logs api` 中捞出链接。而本地代理在没有凭据的情况下被安装，等待有人回到浏览器去配对一个文件夹。

**链条，每一环都已存在。** `POST /internal/first-account`（[RN-546](#rn-546)）→ `brabo-runner device-key create`（[RN-551](runner.md#rn-551)）→
`POST /internal/machine-device-keys`（[RN-552](api.md#rn-552)）→ `device-key finish
--id <id>` → `brabo-runner service install --machine`（[RN-545](runner.md#rn-545)）。api 在登记中返回的 `id` 就是成为私钥 `kid` 的那个，整条链只是「转交」它——没有人从别的东西推导它（[RN-475](web.md#rn-475)）。服务的 `--dir` 取自 `finish` 打印的「路径」，而不是脚本对配置文件夹位置的第二次计算。

**中间某一环失败时会发生什么：什么都不撤销，一切都被「报告」，脚本总是以 0 退出。** 这是本次交付的决定，论点是已完成的环节本身就有用——账户创建了，人就能进入；密钥登记了，机器就配对了；而服务是她唯一需要用脚本打印的一条命令手动重复的步骤。撤销需要删除账户和吊销密钥，而没有这样的路由，也不应该有一个安装程序会自行调用的路由。代价是一次安装可能只完成一半；它绝不会做的是「静默地」只完成一半——每个失败都变成最后的 **「O que ficou pendente」** 块中点名的一行，就在安装者还在看的地方。因为最后一步而推倒整个安装，就是用零个安装换半个。

**幂等性就是 HTTP 状态码，`409` 不是失败。** 当安装已有人时，两个路由都回应 `409`——第二次执行，或一次其恢复带回了用户的迁移（[RN-530](infra.md#rn-530)）。这是「预期」的结果：这一步说明原因后保持沉默，**不**进入待办。任何其他状态码都是失败，并附上状态码和 api 的回应。`000`——没能和 api 对话的 curl——出于同样原因有自己的处理：把它与回应码坍缩，会把「api 没起来」读成「api 拒绝了」。而代理那一步只在「本次」执行创建了账户时运行：已有用户时，登记机器密钥就会为一个在这一轮中什么都没要求的人铸造持久凭据。

**密码不碰磁盘也不碰 `argv`。** 在 TTY 中无回显读取（`stty -echo`，终端模式在结束时恢复），经确认后通过 `curl` 的 **STDIN** 发送给 api——绝不通过命令行上的 `--data`，`/proc/<pid>/cmdline` 会把它公开给机器上的任何用户，也绝不通过文件。带有 `BRABO_SERVICE_TOKEN` 的请求头放在模式为 600 的 `--config` 中，随后删除：它也是密钥，而这个密钥已经以同样的模式住在磁盘上的 `.env` 中。机器上没有 `stty` 时这一步会被**拒绝**，绝不降级为带回显的询问——承诺无回显却交付有回显，比不问更糟。密码不进入 `.env`、不进入标记、也不进入任何日志；标记获得的是**电子邮件**，它用于识别而不是秘密，`MARCADOR_SCHEMA` 随该字段升到 **3**，与它获得 `versao` 时升到 2 的尺子相同。

**密码拒绝可以重复，上限是 3。** 策略是领域的（[RN-546](#rn-546)），与正常注册相同，只有在 POST 「之后」才知道。在那里中止安装会让某人的 compose 处于运行状态，而第二次执行落入迁移路径——所以循环是「询问+回答」这一对的，耗尽上限变成点名的待办而不是拒绝。与确认不一致的密码根本不会离开机器。输入中的制表符会被**拒绝**，绝不静默删除：一个改写密码的安装程序会产生一个密码不是本人所输入的账户。

**`service install --machine` 的拒绝在开发者机器上是「常见」情况，它会带着自己的原话到来。** 当安装了按「项目」的 unit 时，`install --machine` 拒绝，没有 `--force`（[RN-545](runner.md#rn-545)：*"instalar e avisar deixaria a instalação errada de pé"*）。安装程序「完整」转发 CLI 的输出而不是概括它——正是它点名了找到的每个 unit 的 `uninstall`，那就是要做的动作——而待办携带之后重复的确切命令。

**密钥的 `name` 是 `hostname`，这是本脚本的选择。** [RN-551](runner.md#rn-551) 以书面形式声明 CLI **不**命名：`name` 是登记的字段，命名的是登记的一方。打开设备密钥列表的人需要知道要去「哪台」机器，而 hostname 是人已经用来称呼自己机器的名字——就是 shell 提示符显示的那个。它不是秘密，不唯一，api 不从它推导任何东西。引号和反斜杠被去掉（它们会在 JSON 中错位），截断为 80（DTO 的 `@MaxLength(80)`，在这里应用，免得拒绝来自 api），完全没有 `hostname` 和 `uname` 时返回一个固定名称——空值会在账户已经存在之后因 `@MinLength(1)` 变成 `400`。

**登记未完成时剩下的 `.parcial` 「留在」原处，并被点名。** `create` 把私钥写入一个带 `.parcial` 后缀的文件，runner 按构造会忽略它（[RN-551](runner.md#rn-551)），如果登记失败，它就会剩下。删除它就是安装程序认定自己知道某件它并不知道的事：api 写入之后的超时与之前的超时无法区分，而这个文件可能是一把已登记密钥私有一半的唯一副本。它是惰性的，下一次 `device-key create` 会点名并替换它，消息说明这两点。

**这个脚本「不」做的事，现在说对了。** 输出的最后一行在这些函数存在数月之后仍宣布它 *"não pareia o agente
local"*，密钥 *"continua vindo da tela do projeto"*。文字已重写：SMTP 仍出于决定保持关闭（`MAIL_TRANSPORT=log`，这里和生产一样——而创建的账户正因如此以已验证状态诞生），LLM 凭据仍属于要花钱的人（[RN-058](api.md#rn-058)），而通过项目界面配对（[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)）仍为想要的人存在——变化在于它不再是必需的。`--help` 在一个没有任何测试到达的地方也有同样的缺陷（它打印的是「文件头」，那是注释，而禁止谈论「阶段会话」的规则只读取代码行）：它说 *"ESTA VERSÃO NÃO
INSTALA NADA"*。已更正，静默截断它的固定行区间改为「直到第一个非注释行」。

**「未」纳入的：** 任何种类的新路由（这次会话是编排——如果另一边缺了什么，该做的是停下并报告）；SMTP；LLM 凭据；在任何地方写入密码；以及任何没有 TTY 就创建账户的路径——没有交互终端时，脚本在已有的那一步、在任何写入之前报告并**以 0 退出**。

- **代码：** `install.sh:1664`（`fechar_a_instalacao`，串联以及「总是 0」）、`:1463`（`perguntar_e_criar_a_conta`，同意、循环和上限）、`:1563`（`parear_esta_maquina`，`id` 变成 `--id`）、`:1640`
  （`subir_o_agente_como_servico`，完整转发的拒绝）、`:1366`
  （`post_interno`，通过 stdin 的请求体和通过 600 `--config` 的请求头）、
  `:1385`（`criar_primeira_conta`）和 `:1426`（`registrar_chave_de_maquina`）——两个路由的裁决——、`:1441`（`ler_sem_eco`）、`:1345`
  （`nome_da_maquina`）、`:1586`（`avisar_chave_parcial`）、`:1208`/`:1215`
  （`escapar_json`/`sem_controle`）、`:108`（`MARCADOR_SCHEMA=3`）、`:1871`（调用，位于 runner 之后、标记之前）、`:1882`（`ownerEmail`）。行号在 9月18日（AT-096）、9月27日（AT-065，在 `instalar_o_runner` 中加入了 Mac Intel 分支）和 10月1日（AT-122）按符号重新读取；`:966`/`:682` 在 9月17日就已对不上
- **测试：** `scripts/dev/install-fechamento.spec.ts`——「真正」运行的 shell 函数（整个脚本以 `source` 加载，只去掉 `main` 的调用），针对真实的 `node:http` 服务器和一个替身 `brabo-runner`：账户的正常路径（请求体、service token 和密码到达）、`409`/`400`/
  `500`/无回应各有「不同」裁决、密码循环和 3 次上限、`create → registrar → finish → service install` 的顺序且 `--id` 是 api 的 `id`、`service install` 的拒绝带着原话被转发、登记失败时留下的 `.parcial`、拒绝且什么都没登记的 `create`，以及没有代理二进制时的收尾；`scripts/dev/install.spec.ts`
  （可打印的计划，以及不再撒谎的 `--help`）
- **已「声明」的缺口：** 在干净机器上的端到端安装——真实的 compose、真实的 api、真实的 runner 二进制、写入的 unit 以及等待第一个项目的代理——是本阶段第 8 次会话的 **E2E**，只有它能证明。这里 `brabo-runner` 是 shell 替身，api 是测试服务器；证明的是「串联」，绝不是集成。而 `install.sh` 的主流程（对照已签名的 `checksums.txt` 校验自身来源）仍没有覆盖，原因是 `install.spec.ts` 已经记录的：在下一个正式 tag 之前，没有任何 Release 有这个资产
- **ADR：** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)
- **来源：** FASE 30，第 6 次会话——
  [阶段的范围划定](../explanation/fase-30-runner-por-maquina.md)

## WORKSPACE upsert 中的自我变动上限，以及被关闭的自我提升（RN-557）

### RN-557 — 在两个关联路由中、两个方向上改变「自己」的角色都以 403 被拒绝 {#rn-557}

> **由 [RN-615](api.md#rn-615) 扩展（ADR 0173）：** 下文说不存在的 workspace 成员移除路由开始存在，带有「同一个」上限（移除自己是 403）——正是这一条款在不计数的情况下守住最后一个 owner。下面关于上限 1 的推理仍然有效。

由 [RN-472](api.md#rn-472) 开启、[RN-556](api.md#rn-556) 延续的这条线上的第三道也是最后一道门。[ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md) 以书面形式声明了它——*"`POST workspaces/:workspaceId/members` continua um
upsert sem teto nenhum — mesma classe de defeito, escopo acima"*——[ADR 0156](../adr/0156-teto-de-auto-rebaixamento-na-remocao.md) 将其重申为「不同的范围，单独的决定」。这是 `BRB-002`，安全 P1。

**缺陷，已测量。** `AddWorkspaceMemberUseCase.execute` 接收 `(workspaceId, userId, role)` 并调用 `workspaces.addMember`——**不接收执行者**——，而 controller（`@Post(':workspaceId/members')`，`@RequireRole('owner')`）以纯请求体调用，没有 `@CurrentUser()`。根本没有可以用来施加任何上限的东西。

**为什么在上一层范围更严重。** 项目中存在的两样东西这里不存在：(a) **没有更高的层级来接住下落**——在项目中，自我降级会把有效角色降到 workspace 角色，而它常常能接住；在 workspace 中角色就是角色，一个把自己写成 `viewer` 的 `owner` 会失去整个 workspace，连同所有项目以及邀请能恢复它的人的能力；(b) **不存在成员移除路由**——`WorkspacesController` 没有成员的 `@Delete`（已测量，ADR 0156 已用过这一事实）。撤销就是这同一个路由，而它要求刚刚放弃的 `owner`。

**自我「提升」曾是漏洞，现在关闭。** ADR 0127 在 Consequences 中记录了它会保留：*"Um `maintainer` pode se gravar como `owner` do projeto (…) os
tetos são sobre descer"*。本 RN **修订**这句话。两半是同一个动作——一个人独自决定自己拥有什么权威——而向上的那一半是唯一**升级权限**的：ADR 0127 可以说它的上限不是关于升级的（「没有人获得原本没有的角色」），而对提升而言这是假的。

| 动作 | 结果 |
|---|---|
| 在「项目」中改变自己的角色，向下 | **403**——[RN-472](api.md#rn-472)，不变 |
| 在「项目」中改变自己的角色，向上 | **403**——原本允许，这就是变化之处 |
| 在「WORKSPACE」中改变自己的角色，任何方向 | **403**——新的那道门 |
| 用「相同」的值重写自己的角色 | 通过——幂等的 upsert 不是变动 |
| 一个 `owner` 在 workspace 中降级「另一个」`owner` | 通过——这是撤销所有权的唯一方式 |
| 在任何范围内关联/降级「另一个人」 | 通过——一直以来的正当能力 |
| 通过「移除」项目行实现自我提升 | 通过——受 ADR 0156 第 3 点保护 |

**上限「不」计数 owner。** 只在调用者是最后一个所有者时才拒绝，这一做法被考虑过，并按 ADR 0127 的字面标准被拒绝：*"se enuncia numa
cláusula, não tem número para envelhecer"*。计数会增加一次可能与写入不同步的读取，必须判断一个不活跃的第二所有者算不算，还会让同一请求体的同一调用今天通过、明天被拒绝，而调用者能控制的东西一样都没变。而该条款**已经产生了计数本该保证的不变量**：workspace 永远不会没有 `owner`，因为移除最后一个需要他自己来做。

**上限 1 在这个范围内没有对应项，这是考虑后的结果，不是照搬。** 与移除（[RN-556](api.md#rn-556)）不同，这里这个动作「存在」——一个 `owner` 可以降级另一个。拒绝的原因在于上限 1 是关于**层级倒置**的规则：在项目中，项目行覆盖 workspace 的行（[RN-471](web.md#rn-471)），一个 `maintainer` 能够到比他「更高」的人；在 workspace 中，`@RequireRole('owner')` 已经保证没有人能够到比自己更大的人——前提条件不存在。加上对应项，再加上没有移除路由，会让 `owner` 成为一个**吸收态**：没有人能通过 HTTP 离开它，离职、所有权轮换以及纠正错误邀请都会变得需要直接写数据库——这正是 ADR 0127 生来要消除的那类状态，只是符号反了。

**尺子不被复制：比较变成「一个」分类器。**
`autoMovimentoDoProprioPapel` 返回「方向」（`'rebaixamento' | 'promocao' | null`）而不是布尔值，因为调用方需要它来选择消息。`ehAutoRebaixamento` 继续作为分类器的一种「读取」存在，这是出于行为原因而不是兼容性：`remocaoEhAutoRebaixamento` 委托给它，而放宽它会让「移除」也拒绝自我提升——移除限制着某人的自己那一行，恰恰是撤销上限 1 阻止创建的那种限制的方式，这一动作被 ADR 0156 以书面形式保护。

**四条消息，按「方向」和「范围」各一条。** 试图提升自己的人不会收到降级的语句（那不是他做的事），碰到 workspace 上限的人也不会被告知去找 `maintainer`——在那里能撤销的角色是 `owner`。与 [RN-556](api.md#rn-556) 第 5 点以及 [RN-470](web.md#rn-470) 相同的纪律。

**执行者的角色来自仓储，而不是 `ResolveEffectiveRoleUseCase`**——与 RN-556 的选择相反，原因与它给出的相同：在项目用例中引入另一个，是为了不让执行者的角色变成手写的第二个 `projectRole ?? workspaceRole` 组合；在 workspace 中没有需要保护的组合（`forWorkspace` 「就是」`workspaces.findMemberRole`），而这个用例手里已经有仓储。

**workspace 中「提升」那一半通过 HTTP 无法到达，但照样施加。** 在 `@RequireRole('owner')` 下，执行者已在顶端，无处可升。它被加入并测试，原因与上限 2 一直不设阈值的原因相同：用例不假设守卫的存在，路由改变最低角色的那天，正确的就是它。与 [RN-514](engine.md#rn-514) 按能力的拒绝相同的设计，在有触发之前就已实现。

**web 一行都不变，这不是遗漏：** `POST /workspaces/:workspaceId/members` 在 `apps/web` 中没有调用方——已测量；唯一的出现是 `api-types.generated.ts` 中生成的类型。没有要调整的 toast，也没有要关闭的 `Select`。

- **代码：** `apps/api/src/domain/iam/tetos-de-rebaixamento.ts`
  （`autoMovimentoDoProprioPapel`、类型 `SentidoDoAutoMovimento`、三条新消息，以及成为分类器读取的 `ehAutoRebaixamento`），
  `apps/api/src/application/use-cases/iam/add-workspace-member.use-case.ts`
  （带 `atorId` 的签名、执行者角色的读取以及两个 403），
  `apps/api/src/application/use-cases/iam/add-project-member.use-case.ts`
  （把 `ehAutoRebaixamento` 换成分类器，这正是关闭那里自我提升的东西），
  `apps/api/src/interfaces/http/iam/workspaces.controller.ts`
  （`@CurrentUser()`、`@ApiForbiddenResponse` 以及描述），
  `apps/api/src/interfaces/http/iam/dto/add-member.dto.ts` 和
  `apps/api/src/interfaces/http/iam/projects.controller.ts`（曾承诺「sem teto nenhum」和「downgrading yourself」的描述），
  `apps/api/src/db/seed.ts`（以 `owner.id` 作为执行者），
  `apps/api/src/application/use-cases/iam/resolve-effective-role.use-case.ts`
  （「未改动」，连续第三个 ADR）
- **测试：** `apps/api/test/application/use-cases/iam/tetos-de-rebaixamento.use-case.spec.ts`，
  块 *"Teto de auto-movimento no WORKSPACE — a quarta porta"*（存在另一所有者时的拒绝、唯一所有者的拒绝、无法到达的提升、按范围的消息、幂等 upsert、`owner` 降级另一个 `owner` 以及第三方的关联），以及上限 2 块中的三个用例——自我提升的测试「反转」过来、名称保留来源，每个方向有自己语句的断言，以及项目中的幂等 upsert
- **ADR：** [0157](../adr/0157-teto-de-auto-movimento-no-upsert-de-workspace.md)，它引用 [0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md) 和 [0156](../adr/0156-teto-de-auto-rebaixamento-na-remocao.md)，并修订前者关于自我提升的那句话
- **来源：** `BRB-002`，维护者登记表中的安全 P1——前两个 ADR 留下声明的最后一个动作

---

## 设备密钥获得界面，界面说明吊销的范围（RN-561）

### RN-570 — 安装程序只用 Release 签过名的文件来启动安装，并在询问或写入任何东西之前核对它们 {#rn-570}

[RN-549](ci.md#rn-549) 在安装程序第一次于干净机器上运行时测得，已发布的 `install.sh` **无法独自启动任何东西**：它调用 `docker compose -f docker/docker-compose.install.yml`，这是相对于其运行目录的「相对」路径，而这个文件不是 Release 的资产，不进入已签名的 `checksums.txt`，也不在任何地方被下载。按 runbook 的一行命令操作的人，会在脚本写入带密钥的 `.env` 「之后」死于 *"no such file or directory"*。维护者于 2026-09-13 决定了出路——签名的资产，而不是克隆（[ADR 0160](../adr/0160-o-compose-do-instalador-viaja-assinado.md)）。

**规则：**

1. **四个文件随安装程序一起传输，在「同一个」清单中。** 安装 compose 以及安装通过相对路径使用的三个文件——compose bind-mount 的 `postgres/init.sql` 和 `ollama/pull-models.sh`，以及迁移（[RN-530](infra.md#rn-530)）执行的 `backup/test-restore-compose.sh`——由 `checksums` 作业作为 `brabo-install-*` 资产发布，并进入生成已签名 `checksums.txt` 的 `sha256sum`。第四个不在 E2E 的变通办法中，是在实现时发现的：在没有检出的文件夹中，迁移会死在那里。作业在附加之前对照文件核对清单的每一行（`sha256sum -c --strict`）。
2. **表有两面和一个守卫。** 发布方读取 `scripts/ci/assets-do-instalador.ts`；下载方读取 `install.sh` 中 `destino_do_asset_do_instalador` 的 `case`（bash 3.2，没有 Node）。spec 在两者分歧时失败，「并且」从 compose 推导出每个不在表中的 `./…` bind-mount——这正是缺陷诞生的方式。
3. **校验紧随自身来源之后，并先于一切。** 安装程序下载这四个文件，并以名称「完全」相等的方式，对照 `verificar_a_si_mesmo` 已校验过的 `checksums.txt`（绝不是第二次下载）比较每个 sha256。三种拒绝各不相同——资产未发布、清单不覆盖它、哈希不匹配——并且都在机器未被触碰的情况下发生。
4. **绝不落回相对路径。** `COMPOSE_DE_INSTALACAO` 初始为「空」，只有当已校验的副本被放到安装文件夹下时——在首次需要它们的那一刻（迁移或启动）——才获得绝对路径。已经在那里的东西会被「替换」，绝不读取——在 `cp` 之前先 `rm`，这样 symlink 就不会把写入带到外面。

**本规则「不」关闭的：** 端到端的证明只在合并后的第一个正式 tag 中发生——`install-e2e.yml` 不在 PR 中运行（ADR 0150）——，已发布的 Release 也不会获得这些资产：它们继续使用旧安装程序，以及在 tag 的检出中运行它的变通办法。ADR 0160 声明的相邻问题——`test-restore-compose.sh` 调用 Compose 时不带 `--env-file`，而 Compose 在 compose 的文件夹中查找 `.env`——在 AT-102 中关闭：安装程序传入 `BRABO_ENV_FILE`（`--env-file`，而不是 `--project-directory`，后者还会改变项目名和相对路径的基准），安装 compose 声明了 `backup` 服务引用的 `backup_local` 卷，它的缺失会在开启 profile 时拒绝整个文件。由 `scripts/dev/prova-de-restauracao-env.spec.ts` 覆盖。

- **代码：** `install.sh:128`（实体化之前为空的 `COMPOSE_DE_INSTALACAO`）、
  `:587`（`ASSETS_DO_INSTALADOR`）、`:589`（`destino_do_asset_do_instalador`，下载方的表）、`:614`（`baixar_e_verificar_os_arquivos_da_instalacao`）、
  `:607`/`:615`/`:617`（三种拒绝）、`:648`
  （`materializar_os_arquivos_da_instalacao`）、`:1573`（迁移在备份之前实体化）、`:1677`（紧随自身来源之后的校验）、
  `:1831`（启动在 `up` 之前实体化）；
  `scripts/ci/assets-do-instalador.ts:55`（发布方的表）、`:93`
  （`problemasDoMapeamento`）、`:135`（`prepararAssets`）；
  `.github/workflows/build-runner-binaries.yml:468`（从 tag 的检出准备的资产）、`:494`（在同一个 `sha256sum` 中）、`:520`（`--strict` 核对）、`:527`（与清单一起附加）
- **测试：** `scripts/dev/install-arquivos-da-instalacao.spec.ts:144`（针对假 Release 的正常路径）、`:162`（资产缺失，`.env` 从未写入——失败用例）、`:179`（哈希不匹配——失败用例）、`:191`
  （不覆盖的清单）、`:202`（相似的名称不算覆盖）、`:217`
  （未校验就实体化是拒绝）、`:225`（已有的被替换，symlink 不会把写入带到外面）、`:258`/`:273`/`:280`（`main` 和迁移中的顺序）；`scripts/ci/assets-do-instalador.spec.ts:89`（每个相对 bind-mount 都是资产）、`:114`（shell 的 `case` 就是 TypeScript 的表）、`:148`/`:152`/`:161`（流水线签名、核对并附加）；
  `scripts/dev/install-e2e.spec.ts:247`（手工变通办法不会回来，E2E 断言安装程序下载了它们）、`:295`（下载清单的令牌不在安装程序的环境中）
- **来源：** AT-026——AT-008 的发现（RN-549），由维护者于 2026-09-13 决定

## 安装中的容器 broker，经同意开启（RN-575）

### RN-575 — 安装程序只在键入「s」后才开启容器 broker，从容器内部测量 socket 的组，四行要么一起写入要么都不写 {#rn-575}

在通过 Release 的安装中，`container` 或 `mounted` 项目从未执行过：启动这两种模式容器的是 broker（[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)），而安装中没有这个服务，因为镜像未发布（ADR 0150，决定 7）。[ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md) 将该镜像作为第五个发布，并把服务放进安装 compose，默认「关闭」；本规则决定它何时开启，因为开启意味着把机器的 Docker socket 交给安装中的一个服务。

**规则：**

1. **只有键入的「s」/「sim」才会开启。** 问题出现在基目录之后（broker 的第二个根由它推导）、`.env` 之前，并以文字「说明」它授予了什么——这台机器的 Docker socket，以及控制 broker 的人就控制了 Docker——以及是什么约束着它。回车、任何其他回答以及没有终端都会保持关闭，而没有终端这一点会被「说明」，绝不静默决定。在回答不是「是」之前，Docker 不会被触碰。
2. **socket 的组是从容器「内部」测量的**，使用 broker 自己的镜像，没有网络，根文件系统只读，socket 通过 `--mount type=bind` 挂载——它会拒绝不存在的源，而不是像 `-v` 那样在宿主机上创建一个文件夹。`group_add` 需要的是从内部看到的 gid（在 Docker Desktop 中宿主机的 gid 说明不了任何东西）。测量失败、路径不是 socket 或 gid 不是数字，都是点名的「拒绝」，并指导以回答「否」重新运行——绝不使用 compose 默认值中的 `999`。
3. **四行一起写入，否则都不写：** `COMPOSE_PROFILES=container-broker`、
   `BROKER_URL=http://broker:8090`、`DOCKER_GID` 和 `PROJECT_WORKSPACES_HOST_ROOT`。有 profile 没有 URL 会启动一个没人调用的 broker；有 URL 没有 profile 会让 api 指向一个不会启动的服务。`escrever_env` 拒绝在没有测量到 gid 的情况下写入这一块——这是脚本的缺陷，不是机器的。`BRABO_BROKER_IMAGE` 「总是」写入，无论是否开启：Compose 在按 profile 过滤之前会插值整个文件。
4. **托管文件夹的根先「计算」再「核对」。** 启动前为 `<DockerRootDir>/volumes/brabo_project_workspaces/_data`；之后与卷的 `Mountpoint` 比较。不一致，或 api 无法通过内部网络到达 broker，会在最后变成点名的「待办」——绝不是拒绝，那会因为一个编辑 `.env` 就能修复的步骤而推倒一个已在运行的安装。
5. **决定出现在最终摘要中**，两个方向都有，而说明安装程序「不」做什么的语句不再说只有挂载文件夹没有容器：`container` 也没有。

**本规则「不」关闭的：** `DOCKER_GID` 和计算出的根没有在 macOS 的 Docker Desktop 上测量过，tag 的 E2E 只在 Linux 上运行交互式那一半。Rootless 或远程 Docker 的 socket 不在 `/var/run/docker.sock`，而那是 compose 挂载的路径，会落入第 2 项的拒绝——在那里开启 broker 不通过其他路径提供。

- **代码：** `install.sh:1050`（`consentir_broker`）、`:1002`
  （`medir_gid_do_socket`）、`:1037`（`calcular_raiz_gerenciada`）、`:1034`
  （`conferir_o_broker`）、`:792`（`escrever_env_do_broker`）、`:855`（清单中的 broker）、`:1812`（顺序：基目录之后、`.env` 之前）；
  `docker/docker-compose.install.yml`（`broker` 服务和 `broker` 网络）
- **测试：** `scripts/dev/install-broker.spec.ts:158`（没有终端：关闭、说明、Docker 未被触碰——失败用例）、`:169`（回车）、`:179`（`n`）、`:187`
  （`s` 开启，带 `--mount` 且没有网络）、`:208`/`:221`/`:229`（三种拒绝）、
  `:237`（作为待办的根）、`:248`（最终语句）；
  `scripts/dev/install-env.spec.ts:250`/`:259`（四行一起或都没有）、`:270`（gid 的守卫）、`:291`/`:307`（`.env` 对照 Compose 的解析器：broker 不带标志就启动，带令牌、两个根和 gid，api 指向它——或者这些都没有）；`scripts/dev/composes-em-conformidade.spec.ts:114`
  （传输的文件中的 ADR 0130 各层）
- **ADR：** [0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)
- **来源：** AT-097——由维护者于 2026-09-18 决定

---

## 安装程序提供本地模型，并且不把 dev 环境误认为一次安装（RN-691，RN-692）

### RN-691 — `install.sh`「询问」是否开启本地模型（profile `llm`），在写入前测量 Ollama 的端口，并组成「一行」`COMPOSE_PROFILES` {#rn-691}

在 v7.0.0 的一次真实安装中测得（AT-351）：每条业务规则都写入 `backlog.semantic_duplicate_check_skipped`，带 `getaddrinfo EAI_AGAIN ollama`，因为通过 Release 的安装启动时没有 profile `llm`，而安装程序从不询问；手动开启它会在 11434 上遇到 `address already in use`，那是宿主机上「原生」Ollama 的端口。

**规则：** 在 broker 的问题（[RN-575](#rn-575)）之后，安装程序说明「成本」（镜像和 `ollama-model-loader` 下载的模型所占磁盘、加载模型时的 RAM）以及没有它会「失去」什么（[RN-681](api.md#rn-681) 的语义重复检查和供 agent 使用的本地模型），只有输入「s」才开启；没有终端时保持关闭并「说明」这一点。开启会在写入任何东西之前「测量」宿主机端口——11434，或直到 11443 的第一个空闲端口，通过 bash 自身的 `/dev/tcp`（包括 3.2）——整个范围都被占用时是「命名」的拒绝，不写入任何东西，绝不是启动时的 `address already in use`。`.env` 获得 `OLLAMA_PORT` 和 profile `llm`；同意的 profiles 放在「唯一一行」`COMPOSE_PROFILES` 中（`container-broker,llm`），因为两行不会相加——最后一行会胜出，broker 会静默消失。

已声明排除在外的：会话「一次」说明语义检查被跳过（api 那一侧，另一条战线）；tag 的 E2E 回答「否」（开启会下载数 GB 的模型），因此带 profile `llm` 的启动没有端到端证明。

- **位置：** `install.sh:1128`（`consentir_llm`），`:1113`
  （`escolher_porta_do_ollama`），`:1103`（`porta_em_uso`），`:800`
  （`escrever_env_do_llm`），`:821`（`escrever_env_dos_profiles`）
- **测试：** `scripts/dev/install-llm.spec.ts`（没有终端时保持关闭并说明成本；11434 被占用时选择下一个；整个范围被占用时失败——失败情形；一个正在监听的服务器被测为已占用；broker 和模型在同一行）；`scripts/dev/install-e2e.spec.ts`（新问题的回答在 TTY 驱动的列表中，顺序正确）
- **来源：** AT-351

### RN-692 — 只有 compose 项目 `brabo` 才是之前的安装，迁移在备份得到证明后提供「从零」重新安装 {#rn-692}

`detectar_por_sinais` 匹配 `"Name":"brabo[^"]*"`，于是 DEV 的 compose（`brabo-dev`，ADR 0170）被算作之前的安装——安装程序会提议迁移开发环境。现在只匹配「精确」名称 `brabo`。

迁移的确认增加了第三种回答：`z` 「从零」重新安装。ADR 0150 的顺序不变——备份、「证明」、询问、删除、安装——但旧数据「不」恢复：经证明的备份留在文件夹中，之后恢复它是 runbook 的 `#restore`。`s` 仍是恢复，Enter 仍不删除任何东西。

同时，收尾不再说通过项目界面配对文件夹「continua existindo (ADR 0118)」：该流程已在 ADR 0203 中移除（[RN-687](web.md#rn-687)）。

- **位置：** `install.sh:370`（`detectar_por_sinais`），`:1694`
  （`migrar_instalacao_anterior`）
- **测试：** `scripts/dev/install-llm.spec.ts`（`brabo-dev` 不算而 `brabo` 算；`z` 在证明之后删除并让 `MIGRAR_DE` 为空；Enter 不删除——失败情形；ADR 0118 的句子不再回来）
- **来源：** AT-358
