---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0023 — 阶段 4b 的收尾（第 2 次会话）：能工作的目录、能区分谁拒绝的去重，以及能在一轮之后存活的队列

- 状态：已接受
- 日期：2026-07-26
- 阶段：4b（第 2 次会话的收尾——Anamnese 本身是 ADR 0016）

## 背景 {#contexto}

ADR 0016 交付了 Anamnese：按项目的调度器、带证据的 `proficiency_profiles`、从 `module_map`
推导的目录、作为带 LCS diff 的 `proposed_action` 的 `instruction_patch`、带向前回滚的
append-only 版本管理、闭合循环的队列，以及两个 UI 分区。这些都没有被撤销。

缺的是第 1 次会话在 ADR 0022 中得到的那一步：运行验收标准，关闭只有运行时才会出现的问题。对三个
应用的审计发现了约 28 处偏差——七处破坏了标准，需求中有一项从未实现，而且标准**从未被执行过**
（没有 `demo:anamnese`，也没有按需运行一轮的方式）。

## 决策 {#decisões}

### 1. 目录必须对复合技术栈做分词——卡住一切的正是这个 {#1-o-catálogo-tem-que-tokenizar-stack-composta--era-isto-que-travava-tudo}

`deriveCatalog` 把 `module_map` 的整个 `stack` 当作**一项**能力。但 `ModuleMapModule.stack` 是
Arquiteto（经由 LLM）写下的**一个**自由文本字符串，实际中会列出多种技术。对于
`stack: "NestJS + Drizzle + Postgres"`，目录得到的能力是 `"nestjs + drizzle + postgres"`，而
自然的输出（`"nestjs"`）落在外面——由于 `validateProficiencyBatch` 会拒绝**整个批次**，这一轮
什么画像都写不进去。

后果比“少一个画像”更糟：只有 `emit_proficiency` 会让 ToolLoop 停止，因此这一轮永远不会结束，
永远不会写入 `anamnese_runs`，时间窗会被无限期地重新处理。**Anamnese 在任何真实的项目中都无法
工作。** 现有测试只覆盖了理想化的单 token 情形（`deriveCatalog(['NestJS'])`），这恰恰是人会写、
而 LLM 不会写的。

`deriveCatalog` 改为按 `+`、`,`、`/` 和 `&` 切分，加入每个 token **以及**整个短语（写了
`"Node.js"`——一个带点的 token——的人不能失效）。1 个字符的 token 被丢弃：用噪声扩大目录正是
护栏不能做的事，并且有明确的测试证明分词**不会**放松对敏感属性的拒绝。

同一写入路径上的两个相邻缺陷：

- 能力被**原样**写入，而唯一约束是 `(project, user, competency)`——`"NestJS"` 和 `"nestjs "`
  会为同一件事创建两行。现在写入归一化后的值。
- 批次中同一个 `(userId, competency)` 的两个条目会撞上
  `ON CONFLICT DO UPDATE command cannot affect row a second time`（upsert 是单条命令），变成
  不透明的 500，而不是可修正的 tool-result。现在它是一条说明该怎么做的拒绝消息。

### 2. **策略**的拒绝不是用户的拒绝 {#2-negação-de-política-não-é-negação-do-usuário}

“拒绝会被记录，以免原样再次提议”说的是**用户**的决定。但去重只过滤 `status === 'denied'`，而
`ProposeActionUseCase` 在 `decide` 因角色低于 `maintainer` 或因 `permissions.json` 拒绝时，会
**在没有决策者的情况下**写入同样的状态。结果：一个被策略拦下的 patch 被永久判了死刑——人从未见过
这个 diff，即便修正了角色也无法再次提议。

改为要求 `decidedBy !== null`。只是一行，却是“用户说了不”与“系统连展示都不允许”之间的差别。

### 3. 消费队列是 patch 存在的结果 {#3-consumo-da-fila-é-consequência-do-patch-existir}

`emit_proficiency` 无条件地随画像一起发送 `consumedQueueIds: ctx.queued_ids`。一个读取了已接受
的假设却**没有**提议 patch 的轮次，会烧掉队列条目，而没有任何东西重新入队：“我接受一个假设，并
看到下一个 patch 引用它”这一标准会悄无声息地失败，并且永远无法恢复。

我们把责任倒了过来：engine 不再碰队列 id，而 `ProposeInstructionPatchUseCase` 在引用该条目的
patch **诞生**时、在同一个事务中把条目标记为已消费。被读取但未被使用的假设仍为下一轮保持待处理。

为什么在**提议**时而不是批准时消费：当假设变成一个人可以评估的 patch 时，它就完成了自己的作用。
如果用户拒绝该 patch，阻止重复的是去重（决策 2）——重新入队会导致永远提议同一个 patch。

契约上的后果：`consumedQueueIds` 从内部 DTO 中移除，`markConsumed(ids)` 变为
`markConsumedByHypothesis(projectId, hypothesisId)`。过滤条件中的 `projectId` 顺带堵住了一个
跨租户漏洞：旧版本是没有作用域的 `inArray(id, ids)`，因此一次调用可能把另一个项目的队列标记为
已消费。

### 4. `hypothesisId` 在两端都经过校验 {#4-hypothesisid-é-validado-nas-duas-pontas}

engine（对照本轮的假设）和 api（对照项目）都没有校验这个 id。一个幻觉出来的 id 会一直穿透到
`agent_instruction_versions.source_hypothesis_id`，而假设→patch→版本的可追溯性指向虚无。

engine 拒绝不在 `ctx.queued_hypothesis_ids` 中的 `hypothesisId`，并把消息送回给模型在下一个回合
修正（与 Psicólogo 拒绝证据的惯用法相同）；api 再次校验该假设存在且属于该项目。注意 ctx 现在
携带的是**假设**的 id，而不是队列行的 id——prompt 提供给模型的东西与 patch 需要携带的东西是同一
样东西。

### 5. “批准/拒绝的命令”进入时间窗——撤销 0016 的推迟 {#5-comandos-que-aprovanega-entra-na-janela--revertendo-o-deferimento-do-0016}

需求的第 1 项列出了四个信号：语言、对 agent 的修正、**批准/拒绝的命令**，以及问题的水平。前三个
在 event log 中；第四个位于 `proposed_actions.decided_at`，而 ADR 0016:170-174 推迟了对它的读取
（“上下文的自然演进”）。四个信号中有一个被按设计排除在外。

新的 `listDecidedInWindow(projectId, from, to)`——只包含有人类决策者的决定，与 engine 读取日志
使用相同的时间窗——为上下文中的 `decisions[]` 字段供数，prompt 获得了带 `rejectionReason` 的
专门一节。**拒绝的原因是时间窗中最丰富的信号**：它用这个人自己的话说出了他觉得哪里不对
（“nunca use push --force, gere migration” 比十条聊天消息更有价值）。

`Triage.should_run?` 改为把决定与事件一起计数：一个用户只做了批准和拒绝的时间窗**是**素材，
而它原本被当作空的丢弃。

### 6. 画像的证据是**项目**作用域的——UI 需要解析出会话 {#6-evidência-de-perfil-é-de-escopo-de-projeto--a-ui-precisava-resolver-a-sessão}

证据 chip 总是导航到 `useLatestSession(projectId)`。但 Anamnese 的时间窗跨越多个会话（ADR 0016
决策 10），因此任何来自旧会话的证据都会落到“evento não encontrado nesta sessão”。这与 ADR 0022
决策 1 为 Psicólogo 关闭的是**同一个**缺陷，在这里重复出现——而 `ProficiencyProfile` 没有
`sessionId` 可以在客户端修正。

新的 `GET /projects/:projectId/events/:eventId`，基于 `GetProjectEventUseCase`：与第 1 次会话
的按会话端点不同，这里会话是**响应**，而不是校验。chip 先解析再导航。`SessionPage` 中被固定的
事件标签不再写“citado pela hipótese”——现在它有两个来源。

### 7. 隐私：每个人看自己的；管理者看团队的 {#7-privacidade-cada-um-vê-o-seu-quem-administra-vê-o-time}

`GET /proficiency` 是 `viewer`，并返回**所有**成员的画像（能力、水平、理由、证据）。更糟的是：
删除要求 `developer`，于是一个 `viewer` 被建立了画像，却在**删除自己的画像时得到 403**——打破了
“全部画像对用户可见且可删除”。

能力画像是关于人的数据，所以默认是本人看自己的：`owner`/`maintainer` 得到聚合视图（对分配工作
有用），任何其他角色只得到自己的，通过原本存在却是死代码的 `listByUser`。删除和 opt-in 改为只
要求 `viewer`——即成为成员。我们放弃了“谁都看不到谁的”：那会让管理者看到空屏，而在一个本人选择
加入的项目内部，并没有带来真正的隐私收益。

同一护栏上的两个小漏洞：证据没有按项目限定作用域（`findById` 不检查项目，而消息承诺“deste
projeto”），以及 `delete` + `opt-out` 是两个松散的 await——两者之间的崩溃会留下一个已删除且可
重新推导的画像，也就是说删除一样只是表面功夫。现在它是一个事务。

### 8. 按需运行一轮，因为 15 分钟无法测试 {#8-rodada-sob-demanda-porque-15-minutos-não-é-testável}

一轮发生的唯一方式是调度器的 tick。`POST
/projects/:projectId/anamnese/run`（engine + api，`maintainer`，理由与 Psicólogo 的重新分析
相同：它运行 ToolLoop 并消耗预算）消除了这种不对称，也正是它让验收标准变得可执行。没有会话的项目
返回 409——没有日志可分析，也没有地方叙述，与周期性路径一样。

### 9. 与第 1 次会话所加固之处保持一致 {#9-paridade-com-o-que-a-sessão-1-endureceu}

Anamnese 逐条拥有 ADR 0022 在 Psicólogo 中关闭的那些缺陷：

- `perform` 在上下文失败时返回 `:ok`，注释说这是让 Oban 重试——`:ok` 会标记为 `completed`，于是
  项目的这一轮悄无声息地消失，`max_attempts: 3` 成了无用的摆设。
- `reason_for({:ok, ctx})` 忽略了 `ctx.last_error`。它是四个调用点（QA、Dev、Psicólogo、
  Anamnese）中**唯一**不合规范的：provider 宕机变成了“结束了却没有发出画像”。
- 时间窗被放在一条 `:pinned` 消息中（`ContextManager` 有意不能压缩它——证据的 event id 必须保留
  下来），有 500 个事件以及没有截断的 `inspect(payload)`，对着一个固定的 `context_window`。它
  获得了可配置的事件上限、截断的 payload，以及对模型**可见**的省略说明（它只能引用它看得到的
  id）。顺带地，原本被收集又被丢弃的 `created_at` 进入了事件行：“问题的水平”是趋势分析，而趋势
  需要时间。
- 所有上限都是模块属性。它们被移到 `runtime.exs` 和 compose 中，以当前值作为默认值。
- `ActionPipeline` 注册在 `:pre_tool_use` 上，却永远是 no-op（Anamnese 的工具没有一个是
  `terminal`/`write_file`）。

### 10. 一个 diff，一种外观 {#10-um-diff-uma-aparência}

`--diff-add`/`--diff-del` 在 `design/COMPONENTS.md:127` 中有规定，却**不存在**于
`design/tokens.css` 中。`ApprovalCard` 使用 `var(--diff-add, #0e2e24)`，因此总是落到硬编码的
hex 上；后来写的版本历史则发明了**文字**颜色而不是背景色。同一个 patch 根据你在哪里看，会有两种
外观。这些 token 在两种主题中都定义了（规范中的配对是为深色校准的），两个地方改为使用同一种
惯用法。

另外：删除画像获得了通过已有的 `ui/Modal` 进行的确认（它是不可逆的，单纯一次点击太过草率），
回滚和 opt-in 获得了 pending 状态（双击会创建两个版本），opt-in 改为使查询失效，patch 卡片渲染
所有文件——而不只是 `files[0]`，而旁边 `git_commit` 的分支一直都是循环渲染的。

## 已执行的验证 {#verificação-executada}

`pnpm --filter api demo:anamnese`——脚本明确区分确定性的部分（分词后的目录、护栏、只有在有
patch 时才消费的队列、patch→批准→带 `sourceHypothesisId` 的版本→通过创建另一个版本来恢复内容的
回滚、按人类决定的去重、阻止重新推导的 opt-out）与依赖模型的部分（这一轮写入带可解析证据的画像并
提议 patch）。它以代码 1 退出，并列出失败的项。

测试套件：engine 250、api 500、web 105——全部通过。补上的测试包括 Anamnese 第一批 web 测试（第 1
次会话在 ADR 0022 中得到了自己的；这次一个都没有），以及两个守护着没有覆盖的保证的测试：
`decide.ts` 中“`instruction_patch` 永远不能自动批准”的上限——与合并锁同一类，后者有四个测试——
以及 `ExecuteInstructionPatchUseCase`，唯一没有 spec 的执行器，在相邻测试中被当作
`undefined as never` 传入。

### 时间窗被截断到秒——这一轮被悄无声息地跳过 {#a-janela-era-truncada-pra-segundo--e-a-rodada-era-pulada-em-silêncio}

这只有在真正运行 `demo:anamnese` 时才出现，而它才是我曾归因于本地 7B 不稳定的“画像没出来”的
**真正**原因。`anamnese` 操作者的 `token_usage` 为**零**：模型从未被调用。

`session_events.created_at` 在 Ecto schema 中声明为 `:utc_datetime`（**秒**精度），而列是
`timestamptz(6)`。Ecto 在比较时会截断参数，于是 `created_at < window_to` 变成了
`< 15:39:32` 而不是 `< 15:39:32.931`，**丢弃了当前这一秒内发生的一切**。在数据库中测得：截断后
的时间窗中 0 个事件，不截断时 9 个，第一个事件在 `15:39:32.363`。

由于脚本在不到一秒内完成所有事情，时间窗**总是**空的。在生产中，15 分钟的 tick 几乎总能避开
（事件已经属于之前的秒），这就是它能通过审计的原因——审计甚至把它记为“次要的，有保留”。它并不
次要。

两处改动：

- 字段改为 `:utc_datetime_usec`，与列对齐。回归测试（`event_window_test.exs`——按项目的时间窗
  原本一个都没有）经验证在没有修复时会**失败**：一个无论如何都会通过的测试什么也证明不了。
- 被跳过的一轮改为留下痕迹（带计数和阈值的 `Logger.info`）。它有意**不是**日志中的事件：每个
  项目每 15 分钟一次 tick 会变成噪声。但正是彻底的沉默掩盖了这个问题——一轮什么也不做、什么也不
  说，是无法诊断的。

修复之后，`demo:anamnese` **完整**通过：`critério de aceite da Fase 4b
(sessão 2) ATENDIDO`。

### 视觉检查发现了三件任何测试都抓不到的事 {#a-passada-visual-achou-três-coisas-que-teste-nenhum-pegaria}

`demo:*` 证明的是数据；它不能证明界面显示了数据。在试验项目中打开 UI：

1. **指令历史对实际存在的 agent 是不可见的。** 该分区在 `AGENT_LIST`（静态名册，带
   `dev-backend`/`dev-frontend`）上做扇出，但阶段 4a **按模块**实例化 dev agent（`dev-api`、
   `dev-web`）。数据库中有 3 个 `dev-api` 的版本，界面却写着
   “Nenhum agente teve a instrução alterada ainda”——也就是说，需求的第 5 项（带 diff 和回滚的
   历史）恰恰对 Anamnese 打 patch 的那些 agent 是死的。新的 `GET
   /projects/:projectId/instruction-versions` 返回**有**历史的那些，UI 不再猜 slug。
2. **patch 和回滚的叙述丢了版本号。** `payloadField` 只返回 `string`，而
   `toVersion`/`restoredFrom` 以数字到达——于是动态写着 “instrução de dev-api atualizada”
   （没有版本）和 “revertida para a **v?**”。改为接受数字。
3. **“Sempre permitir” 出现在 `instruction_patch` 上。** `decide.ts` 的上限总是强制
   `require_approval`，因此把规则写进 `permissions.json` 什么也不会改变：这个按钮承诺了一个不存在
   的效果。对这个类型隐藏了它。

此外在界面上验证了：画像的水平/理由/chip；解析到**正确**会话的证据 chip（去了包含该事件的会话，
而不是最新的那个），事件固定在日志顶部；版本上和审批卡片上的 badge `hipótese <id>`；两处都使用
新 token 的 diff；以及——关闭 ADR 0022 未经验证就断言的事——Psicólogo 的分析条带上成本确实出现
差异（重型 US$ 0,0068 对轻型 US$
0,0001），以及一个指向 `agent.response`（动态会隐藏的类型）的证据 chip 能到达该事件。

## 范围与假设 {#escopo--assunções}

不在本次收尾范围内：把 web 的 `ActionType` 联合类型与后端的 12 种类型同步（先前就有的债务，
ADR 0016）；在运行中的对话式 GenServer 中重建 prompt；为按项目的时间窗在 `session_events` 上
建索引；通过 UI 手动编辑指令；`source_hypothesis_id` 上的索引以及反向查询（假设 → 版本），目前
还没人需要。

patch 的 `apply` 仍在更新动作的事务之外运行（`ExecuteInstructionPatchUseCase`）：恰好在两者之间
崩溃，会留下已打 patch 的指令而动作处于 `approved`。记录在此，因为它是真实的，但修复需要重新
思考**所有**执行器的事务边界（infra 和 git 的执行器有同样的形态），只在这里做会在兄弟之间造成
不一致。
