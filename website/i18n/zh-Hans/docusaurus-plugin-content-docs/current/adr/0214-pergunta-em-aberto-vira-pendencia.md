---
traducao_de: 9c7537aa5bade6f0ca4b80237a1928a72b654a38
---

# 0214 — 悬而未决的问题成为待解决的待办

## 状态 {#status}

**已接受。** 2026-10-11（AT-521；所有者于 10月11日的决定）。扩展 [ADR 0207](0207-ciclo-de-gate-velho-estaciona.md)（gate 周期的搁置），并**修订** [ADR 0212](0212-historia-arquivada.md) 的一部分（故事的更正）。规则见 RN-858、RN-859、RN-860 和 RN-861。

主题：`gates`。真正改变行为的机制是 QA 的新裁决，它不消耗周期，并通过 ADR 0207 的机制搁置；登记和队列的存在，是为了让这个裁决有人可问。

## 背景 {#context}

在 TP-01 中测得（第 14 轮）：

- Criativo 只在回答的**文本**中给用户留下了**四个问题**。没有一个成为记录；在消息流滚动之后，界面上没有任何东西列出它们。
- QA 以“não confirmado pelo usuário”为由拒绝 `GET /:codigo`，直到**耗尽**纠正周期（RN-762）——**两次**。第二次发生在所有者已经在聊天中回答**之后**：故事已经是 `ready`，ADR 0212 只允许更正 `draft` 的故事，而 QA 读取的是故事的 DoR，它仍然写着“não confirmado”。dev 没有可以修正的东西：决定属于用户，而 `changes_requested` 每轮都消耗一个周期。

缺三样东西：带状态的问题**记录**、一个说“这取决于用户”而不惩罚 dev 的**裁决**，以及让**答案**到达工作者的路径（dev 的上下文、QA 的片段、故事本身）。

## 决策 {#decision}

### 1. 登记 {#1-o-registro}

- `artifact.open_question`（追加式，在它诞生的会话日志中）：`{ questionId, pergunta (≤ 500), sugestao (≤ 300, opcional),
  afeta: { regras, historias, tarefas }, autor, sessionId }`。
- 以 `open_question.answered` `{ questionId, resposta, aceitouSugestao, decisionEventId, respondidaPor }` 关闭。**状态**来自日志（打开 = 没有 `answered`），绝不来自表。
- 回答会写入一个 `decision_record`（参与者：用户），`context` = 问题，`choice` = 答案，`consequences` = 它所影响的东西，以及 `questionId`。它与 RN-505 是同一个通用构件。

### 2. 来源只有工具 {#2-a-origem-é-só-a-ferramenta}

`declare_open_question`（Criativo、PO、Arquiteto、Dev Lead），带**一句**中央指令，不按服务器重复：“Toda dúvida que você deixar
para o usuário vira `declare_open_question`, com a sua sugestão e o que ela
afeta; não termine o turno com pergunta só no texto.”

### 3. 谁来回答 {#3-quem-responde}

只有问题所诞生的会话的**作者**。对于 QA 的问题，是执行会话的作者（激活执行的人）。其他成员看到问题时控件不可用，并以文字说明原因（ADR 0064）。

### 4. 路由 {#4-as-rotas}

- `GET /projects/:projectId/open-questions?status=open|answered|all`——`viewer`，`limit` 50，附总数（RN-180）。
- `POST /projects/:projectId/open-questions/:questionId/answer`——正文 `{ resposta }` 或 `{ aceitarSugestao: true }`；403 `so_o_autor_da_sessao`，409 `pergunta_ja_respondida`，属于其他项目的问题返回 404。

### 5. 就绪会提醒并继续 {#5-a-prontidão-avisa-e-segue}

“Estou pronto”（Criativo）和“Confirmar arquitetura pronta”显示“N perguntas seguem abertas — responder”，带通往队列的快捷方式。它们不阻塞。

### 6. 裁决 `needs_user_decision` {#6-o-veredito-needs_user_decision}

`emit_qa_verdict` 获得 `needs_user_decision`，带 `{ pergunta, sugestao }`（或一个已存在的 `openQuestionId`）。api **不**增加纠正计数（RN-762），写入 `open_question`（作者 `qa-agent`，影响该任务），周期通过 ADR 0207 的机制被**搁置**（`gate.rescue_parked`）。任务显示为“esperando você”。回答问题会通过 `GateRescuer.retomar_estacionado/3`（RN-724 的路径）重新接通 gate，QA 在上下文中带着决定作出判断。在 QA Lead 的汇总中，某个子专业的 `needs_user_decision` 胜过 `approved`。QA 片段的尺子：标为“não confirmado pelo usuário”（或与当前决定相矛盾）的需求 → `needs_user_decision`，绝不 `changes_requested`。

这**扩展**了 ADR 0207：那里周期因停滞时间而搁置；这里也因待处理的用户决定而搁置。恢复的操作是同一个机制，由回答触发。

### 7. 决定到达工作者 {#7-a-decisão-chega-a-quem-trabalha}

`GET .../dev-context` 返回 `decisoes`——通过 `afeta` 与故事/任务关联的那些，上限 10 条和 1 500 个字符。dev 的 kickoff 和 QA 的片段显示“Decisões do usuário — vencem RF/DoR quando conflitam”。

### 8. PO 根据用户的回答更正 `ready` 的故事（修订 ADR 0212） {#8-o-po-corrige-história-ready-por-resposta-do-usuário-revisa-o-adr-0212}

ADR 0212 中**改变**的：当更正请求引用一个**已回答**的 `questionId` 时，`recusaDeCorrecaoDeHistoria` 开始接受 `ready` 的故事；PO 收到答案并更正 RF/DoR。**不**改变的：带 `in_review`（以及 `in_progress`）任务时的拒绝继续；归档仍然只针对 `draft`；没有已回答 `questionId` 的 `ready` 更正仍被拒绝；用户在 Backlog 标签页中的编辑遵循 0212 的尺子。

### 9. 界面 {#9-a-tela}

聊天待办区块中的“Perguntas em aberto”队列，有自己的标题和计数（绝不与其他队列相加，RN-467）：问题、提问者、它影响什么、带“Aceitar sugestão”的建议，以及一个带“Responder”的短字段——两者都只给会话作者。“N perguntas em aberto”的提示紧挨着“Estou pronto”和“Confirmar arquitetura pronta”。

## 后果 {#consequences}

- token 成本：每个对话回合约 60 个 token（中央句子和工具描述），当有关联的决定时，QA 片段 / dev kickoff 中最多约 400 个（上限 10 条和 1 500 个字符）。
- 纠正周期不再被花在 dev 无法解决的事情上。
- 问题有主人：会话作者。不是作者的成员无法解锁——声明的代价（见替代方案）。
- **不**改变的：绝对上限（RN-418）、受保护分支上的手动合并、纠正周期的上限（只是不再计入这个裁决）、ADR 0212 的归档尺子，以及 ADR 0207 按时间的搁置。

## 考虑过的替代方案 {#alternatives-considered}

- **在有未决问题时阻塞就绪。** 拒绝：问题可能是不妨碍 PO 继续的细节；阻塞会把遗忘换成卡死。带快捷方式的提醒解决了遗忘。
- **在 agent 的文本中检测问题。** 拒绝：针对散文的启发式在两个方向上都会出错，并会产生没人声明的待办。来源是工具，而中央指令是让 agent 使用它的东西。
- **QA 按 agent 的建议继续。** 拒绝：基于猜测批准会隐藏用户的决定，而这正是 QA 存在要阻止的“não confirmado”需求。
- **任何 `developer` 成员都能回答。** 按所有者的决定拒绝：问题关乎主导会话的人的意图；另一个成员回答，会在主人不知情的情况下替换掉主人的决定。
