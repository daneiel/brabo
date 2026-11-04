---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0148 — agent 的工件以文件形式投影到一个 `docs/` 目录

## 背景 {#context}

agent 产出的每一个工件——Criativo 的 brief、PO 的业务规则、Arquiteto 的 C4 图和模块路由、六个对话式 agent 的决策——都**只**存在于 event log 中。`Engine.Harness.Tools.EmitArtifact`（`apps/engine/lib/engine/harness/tools/emit_artifact.ex:3-5`）说得很明确：*"没有工件表"*。工件**就是** `artifact.<tipo>` 事件，不可变，带有作者和 `seq`。

对**来源**而言这是正确的决定，这里不动它。问题是另一个：**这份记忆不会到达任何一个人会打开的地方。** 它可以通过会话时间线阅读，在产品内部，一次一行。在编辑器中打开项目目录的人——代码将会在那里——找不到任何产生那些代码的推理。

随着**推迟 git** 的决定（推迟的仓库开通，在单独的 PR 中），这个缺口变大了：在项目创建与 Arquiteto 向 Dev Lead 的 handoff 之间，项目在没有任何仓库的情况下存在。在这段时间里，产品对项目积累的一切都在数据库的行中，而用户的目录是空的。

产品中有一个完全对应的先例可以解决这一问题，并且已经讨论并接受过：**Neo4j 图**（[ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md)/[ADR 0101](0101-memoria-relacional-como-projecao-do-event-log.md)），它被明确声明为由 event log **派生**的记忆——从不是来源，可以丢弃并重建。`GraphProjector`（`apps/api/src/application/graph-projection/graph-projector.ts`）在自己的 `aggregate_type` 下消费 `outbox_events`，写入一个外部目标，降级时绝不拖垮为它供数的一方。

本决策的问题不是*是否*应该有这个目录——产品所有者原话要求 *"暂时只创建一个名为 docs 的目录，里面放着每个 agent 的工件"*。问题是**用什么机制**，以及这迫使我们保证什么。

## 决策 {#decision}

**`docs/` 目录是 event log 的一个**投影**，严格意义与 ADR 0101 赋予图的相同。** 来源仍然是事件；目录可以整个删除并重建；而**产品中没有任何东西从它读取**来决定任何事情。它存在是为了被人打开。

其余一切都由此而来。

### 1. 机制就是 `GraphProjector` 的机制，逐个部件 {#1-o-mecanismo-é-o-do-graphprojector-peça-por-peça}

`ArtifactProjector`（`apps/api/src/application/artifact-projection/artifact-projector.ts`）照搬了已经解决过这个问题的形式：自己的轮询器（带 `.unref()` 的 `setInterval`，在 `onModuleDestroy` 中清理），公开且独立于定时器的 `drainOnce()`（它是测试的入口），防止周期重叠的 `draining` 标志，批量 50，以及**只在成功之后**才 `markProcessed`。

这不是代码复用，而是**设计**复用——两个投影器写入毫无共同点的目标。照搬形式，才能让了解其中一个的读者无需重读就理解另一个。

### 2. 自己的 `aggregate_type`：`artifact_projection` {#2-um-aggregate_type-próprio-artifact_projection}

`AppendSessionEventUseCase` 为 `ARTIFACT_PROJECTABLE_EVENT_TYPES` 中的类型，在**同一个**事务中写入**第三**条 outbox 行。`aggregate_type` 是新的，理由与图的相同（记录在 `domain/graph/graph-projection-events.ts:7-26`）：`Engine.Outbox.Drain.run_once/0` 只消费 `session`、`task` 和 `container`，而每个事件本来都有的那条 `'session'` 行会被它每约 2 秒标记 `processed_at`。读取同一个 `aggregate_type` 就等于与 engine 的消费者赛跑，并且几乎总是输。

与图相比有一个有意的差异：`aggregateId` 是**项目**，而不是会话。目录属于项目，而源事件只携带 `sessionId`——在这里写入 `projectId`，省去了投影器为每个工件都做一次查询，去找出用例早已掌握的东西。

### 3. **允许**列表，四种类型有意排除在外 {#3-lista-de-permitidos-e-quatro-tipos-deliberadamente-fora}

`ARTIFACT_PROJECTABLE_EVENT_TYPES`（`apps/api/src/domain/artifacts/artifact-projection-events.ts`）是允许列表，而不是排除列表：新的工件类型诞生时在投影**之外**，当有人决定它是文档时才加入——而不是自己出现在用户阅读的目录里。

排除在外的是 `qa_verdict`、`secops_verdict`、`task_blocked` 和 `infra_delegation_files`。它们是**运营结局**，不是产品文档：每个 task 一个 gate 裁决，在有几十个 task 的项目中，会让 `docs/qa-lead/` 塞满没人打开的文件，目录也会失去让它有用的那个性质——一眼就能看完。它们仍然在作为来源的 event log 中，仍然在时间线上。

### 4. 按 agent 组织，有版本的会覆盖 {#4-por-agente-e-o-versionado-sobrescreve}

布局是 `docs/<agente>/<arquivo>.md`。浏览目录就能回答 *"Arquiteto 产出了什么？"*，无需打开任何东西。

四种**有版本**的类型（`module_map`、`module_routing`、`project_image`、`c4_diagram`——通过归约到最大 `version` 来读取的那些，见 `obter-container-do-projeto.use-case.ts:22-25`）总是写入**同一个文件**并覆盖：目录显示**当前**的，历史完整地保留在 event log 中。把它们按版本各投影为一个文件会产生 `c4-diagram-v1.md`、`c4-diagram-v2.md`，让打开的人不得不弄清哪个有效——这正是按 `version` 归约所要省去的工作。

其余的类型本质上是只追加的（一个决定不会替代前一个：两者都发生过），每一个都成为自己的文件，文件名中带有事件的 `seq`。`seq` 在每个会话内无间隙，并且本来就为 event log 排序，所以它是不需要新状态的打破平局方式——而**没有**它，同类型、同标题的两个工件会生成同一个文件，第二个会抹掉第一个：这是本投影丢失来源中已有信息的唯一途径。

### 5. 针对文件系统的两道屏障，第二道并不多余 {#5-duas-barreiras-contra-o-filesystem-e-a-segunda-não-é-redundante}

文件名派生自**模型写下的标题**——完全意义上不可信的输入。防御不是对传入内容转义，而是**从一个封闭字母表派生一个新名字**：`slugDeArquivo` 没有任何能让分隔符存活的返回路径，当什么都不剩时返回 `null`（空名字会与所有其他空名字冲突）。

`FsArtifactFileStore` 在打开文件之前用 `relative()` **再次**检查。这不是偏执：两者回答不同的问题——第一道是 *"我从这里派生出什么名字"*，第二道是 *"我实际上要打开的是什么"*。只信任第一道，会让这次写入的安全性依赖于将来对 slug 的任何改动都绝不放过一个分隔符，而这正是 [ADR 0130](0130-broker-de-container.md) 从原则上拒绝的那种约束：依赖于调用方正确的约束。

### 6. 在 `runner` 模式下，目录改到托管根目录 {#6-em-modo-runner-a-pasta-desvia-para-a-raiz-gerenciada}

`pastaDeArtefatosDoProjeto`（`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`）是 `permissionsFilePath` 的兄弟，并做**同样的偏转**，出于同样的物理原因：写入的是 api，从它的容器内部，而 `runner` 项目有意没有 bind-mount。runner 的通道（`exec`/`exec_result`）只传输**命令**——不存在向文件写内容的原语——所以即使委派写入，不发明新机制也解决不了。

### 7. 写入**不**经过 `proposed_action` {#7-a-escrita-não-passa-por-proposed_action}

这不是遗漏。`proposed_action` 是**agent 请求采取行动**时一切外部效果的起点。这里没有 agent 请求任何东西：当这个类运行时，工件已经被发出并已在 event log 中。之后发生的是**系统**在一个派生路径上，物化一份已成事实之物的可读副本。

让投影经过审批队列会产生与预期相反的效果：它会用例行决定塞满队列——每个工件一个——并恰恰侵蚀让点击在那些**确实**是外部效果的操作上有意义的上限。

## 后果 {#consequences}

用户在项目目录中会有一个按 agent 组织的 `docs/` 目录，其中是产生代码的推理。它在 git 存在之前就出现（推迟的开通），而那正是今天磁盘上什么都没有的那段时间。

**投影从不拖垮来源。** 没有任何 throw 会逃出 `drainOnce`：每一项单独失败、被记录日志，并保持 `processed_at IS NULL` 留待下一个周期。磁盘已满、权限被拒或目录无法访问，都不能阻止工件被**发出**。`outbox_events` 没有 `attempts`，也没有死信——重试是隐式且无限的，与图的完全一样。

**与 `GraphProjector` 的有意差异：** 这里没有能让整个批次停下的 `GraphUnavailableError` 等价物。写入失败通常属于**条目**（一个奇怪的名字、一个目录已消失的项目），而不是目标；因为一项而停下整个批次，会阻塞排在它后面的所有项。

**已从 event log 中消失的事件被标记为已处理，而不是永远重试**——重试已不存在的东西不会有任何效果，那一行会无限期留在队列中。

**声明的代价 1：在 `runner` 模式下，`docs/` 不在代码旁边。** 在自己机器上打开项目目录的人找不到它；它在 `<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>/docs/`。这在该模式下是**真实**的损失，因为这个目录存在的意义正是与代码一起被打开。它避免的是更糟的替代方案：投影干脆不发生，或者每个工件都静默失败。

**声明的代价 2：Markdown 是通用的。** 文件有一个文件头（类型、agent、时间、`seq`），payload 作为 JSON 块。没有按类型的渲染器——那会是十三个在 schema 变化时会过时的地方，而这个目录需要提供的是可读且可追溯的内容，而不是排版。按类型更丰富的格式是一个单独的决定，等到有真实阅读需求时再说。

**声明的代价 3：目录可能在两个周期之间与 event log 不一致**，在持续失败之后可能无限期不完整而没有任何警告。这与图已经接受的代价相同，出于同样的理由可以容忍：来源完好，投影可以重建。**今天不存在重新投影命令**——删除 `docs/` 不会重建它，因为 outbox 行已经被标记。这与 **BRB-018** 已经为图记录的缺口相同，现在多了第二个使用者。

**本 ADR 不触及的内容。** `decide.ts` 和绝对上限；`proposed_action` 作为 agent 一切外部效果的起点（见第 7 点——投影不是其中之一）；event log 的不可变性；engine 的工件 schema，它们完全不变；以及镜像关口（[ADR 0135](0135-portao-de-imagem-nos-tres-modos.md)）。
