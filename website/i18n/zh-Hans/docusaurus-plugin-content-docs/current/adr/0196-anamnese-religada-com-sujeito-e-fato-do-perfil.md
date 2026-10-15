---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0196 — 重新启用的 Anamnese：没有主体就不运行，被接受的假设成为画像事实

## 状态 {#status}

**已接受。** 2026-10-01（AT-277，故事 HS-072，史诗 EP-030，第 36 轮；所有者于 10月1日的决定：*"religar a Anamnese com correções"*——合格主体的守卫，以及被**接受**的假设成为图中的画像事实，并进入与此人对话的 agent 的上下文；被拒绝的只做记录）。只为 Anamnese 结束 2026-08-10 的暂停——Psicólogo 仍然暂停（`PSYCHOLOGIST_ENABLED=false`）。按 [ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md) 设计的方式使用图（从事件日志**派生**的记忆），并使用语言的临时指引路径（RN-622），两者都不编辑。

## 背景 {#context}

修改之前，在 `dev` 的代码中以及 2026-09-29 真实使用的报告中测得：

- **六轮，六个由**模型**写下的 `anamnese.run_skipped`**，原因相同，“nenhum membro elegível”（会话 `be70`、`67f3`、`d7e9` ×2、`5d66` ×2），6 次调用花费 8 933 微美元。`anamnese_runs` = 0，`proficiency_profiles` = 0。
- **主体从哪里来：** `GetAnamneseContextUseCase` 读取 `ProjectRepository.listMembers`，它**只有** `project_members`。创建项目不会在那里写入行（`CreateProjectUseCase`），而授权通过 `projectRole ?? workspaceRole`（RN-471）把 workspace 的所有者视为项目成员。在一个人的项目中，列表总是空的。
- **worker 不看这个列表：** `AnamneseWorker.maybe_analyze/3` 只询问分诊（窗口的量、假设队列），而队列中的假设会**强制**一轮。prompt 写着“(nenhum membro elegível)”，模型被付费去得出这个结论。
- **被接受的假设实际上没有使用者：** `AcceptHypothesisUseCase` 把它放入 `anamnese_queue`（真实使用中 3 行），唯一的使用是某一轮的 `propose_instruction_patch`——在 `5d66` seq 17 中，它回答“não há arquivo de instrução de agente disponível no contexto”。图没有投影 `psychologist.hypothesis_accepted`。
- **图的读取路径没有使用者：** `QueryUserContextUseCase` 存在（按用户和项目的假设、画像、handoff），却没有任何代码调用它。
- 自 RN-540 起，`ANAMNESE_ENABLED` 在 `runtime.exs` 和三个 compose 中默认 `false`；报告记录真实使用中的 engine 是通过环境把该标志设为 `true` 的。

## 决策 {#decision}

1. **没有合格主体，轮次就不运行。** `Engine.Anamnese.Elegibilidade` 在分诊**之前**决定，没有例外（假设队列也不能越过它）：主体是项目的**有效**成员，不在退出名单中，在 prompt 显示的内容中有**自己**的交互——窗口中他的 `actor_kind: "user"` 事件，或他的决定。没有主体：不调用 LLM，不在 RAG 中搜索，在 engine 日志中写明原因（`sem_sujeito_elegivel`，带 `nenhum_membro` 或 `nenhuma_interacao_propria` 以及数字），并且只有在手动请求的轮次（`origem: "manual"`）中，才有持久的 `anamnese.run_skipped`。prompt 开始只列出主体。
2. **项目成员是**有效**成员。** `ProjectRepository` 获得 `listEffectiveMembers`（`membrosEfetivos`，RN-471 的尺子：项目行在两个方向上覆盖 workspace 行），由 Anamnese 的三个用例使用。`listMembers` 仍然只是 `project_members`，也就是成员界面所编辑的。
3. **被接受的假设成为画像**事实**，从事件日志派生。** `psychologist.hypothesis_accepted` 开始携带 `projectId`、`sujeito`（被分析会话的作者）、`hipotese`、`sugestao` 和 `fatoDoPerfil`。`GraphEventTranslator`——与投影器和 `grafo:reprojetar` **同一个**——把它翻译为 `(:FatoDoPerfil {hypothesisId})-[:SOBRE]->(:Usuario)` 和 `-[:NO_PROJETO]->(:Projeto)`（`RecordProfileFactUseCase`，按假设 `MERGE`，新的唯一约束）。事件是自给自足的：重新投影不读取 `psychologist_hypotheses`。
4. **事实只来自主体本人的点击。** 当接受者**就是**会话作者时，`fatoDoPerfil` 为 `true`。第三方的接受对其他一切仍然有效（状态、Anamnese 的队列），并在 payload 中说明为什么没有成为事实（`motivoSemFato`）。被拒绝的不变：只做记录。
5. **事实进入与此人对话的 agent 的上下文。** `SendAgentMessageUseCase` 通过 `QueryUserContextUseCase` 读取消息**作者**的事实——限定在项目内，最近 5 条，旁边附总数——并以 `perfilDoAutor` 发给 engine，文本由 `textoDoPerfilDoAutor` 组装（最多 2 000 个字符，说明截断）。engine 通过与语言**相同**的路径把它们放进回合：控制器把两者合并成一个 map，`IdiomaDaResposta.com_idioma_do_autor/2` 识别它，门面 `EngineApiClient` 在语言指引之前把文本作为**临时**的 `system` 消息追加（`Engine.Harness.PerfilDoAutor`）。没有任何 agent 服务器改变。图宕机时变成日志，回合在没有事实的情况下继续。
6. **重新启用。** `ANAMNESE_ENABLED` 的默认值在 `runtime.exs` 和三个 compose 中回到 `true`（`flags-do-engine-no-compose.spec.ts` 的尺子继续：compose 重复代码）。`START_ANAMNESE` 在任何地方都不变：代码、开发和安装中为 `true`；生产 compose 中为 `false`，这一分歧已声明。`PSYCHOLOGIST_ENABLED` 不变。

## 后果 {#consequences}

- 9月29日的真实使用不再花钱：没有主体的项目到不了 LLM。而在没有自己行的项目中，workspace 的所有者开始**成为**主体——重新启用的 Anamnese 在最常见的情况下开始做点事情，而不是什么都不做。
- **声明的代价：** Anamnese 现在会为只通过 workspace 成为成员的人建立画像。从未在项目中交互过的 workspace 成员不会被建立画像（不是主体），退出名单仍然有效。
- **声明的代价：** 给对话式 agent 的每条消息都会在图中多一次读取（`QueryUserContextUseCase` 的四个查询）。没有配置 Neo4j 时，是立即的 `GraphUnavailableError` 加一条日志。
- **声明的代价：** 事实会到达作者的**每个**回合，包括不是假设目标的 agent——标签说明它面向谁，按 agent 过滤是悬而未决的决定。
- **范围之外，已声明：** 真实使用中的三次接受是在本次修改之前写入的，没有事实的字段，在重新投影中**不会**成为事实。它们仍在 Anamnese 的队列中，在下一次**有**主体的轮次中被读取。没有作者的回合（kickoff、dev agent、gate）不接收事实。Staff 仍然没有自动触发：Anamnese 在代码中从未触发过它。
- 没有主体的 tick 轮次不会变成事件（那会是每个项目每 15 分钟一个提示）；只有手动请求的才会叙述。
