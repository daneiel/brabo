---
traducao_de: f9a111fcc133a5fcd7195d7ccc74ab40ee414777
---

# ADR 0205 — Anamnese 观察到的 agent 偏差成为产品信号，不含个人数据

## 状态 {#status}

**已接受。** 2026-10-02（AT-356 第 2 部分，所有者于 10月2日的决定：*"Sim, sinal do produto"*）。补充（不编辑）[ADR 0196](0196-anamnese-religada-com-sujeito-e-fato-do-perfil.md)：Anamnese 继续维护**人**的画像；本 ADR 增加的是第二种记录，关于 **agent** 的。

## 背景 {#context}

在 10月2日的测试商店中（AT-376），Anamnese 把 agent 的失败读成了用户的特质：*"Não vi o handoff aparecer. Pode passar ao Arquiteto?"* 变成了“连续性驱动者”——其实是这个人在弥补 PO 的失败。陷入循环的 agent 和被用户取消的回合也是一样。这个信号有价值，但它属于改进**产品**的人，而不属于产生它的那个人的画像。

修改前在 `dev` 中测得：Anamnese 只有关于人的动词（`emit_proficiency`、`skip_proficiency`）以及关于指令/上限的动词（`propose_instruction_patch`、`propose_max_parallel`，它们会变成 `proposed_action`）。没有地方可以说“agent X 偏离了”，而不把这件事归到某个人身上。

## 决策 {#decision}

1. **专用的持久事件 `anamnese.agent_deviation`**，由新工具 `report_agent_deviation`（`:direct`，不结束本轮，参与者 `agent`/`anamnese`）写入本轮所在会话的事件日志。
2. **从构造上就不含个人数据。** payload 由 engine 按**允许清单**组装：`agente`、`tipo`（封闭词汇：`laco`、`cancelamento_pelo_usuario`、`reparo_pelo_usuario`）以及 `evidenceEventIds`（去重，上限 20）。没有自由文本字段——模型正是会在那里写下名字或特质。会话和项目来自事件的信封。模型臆造的额外字段会被丢弃。
3. **在用户的图之外。** `GraphEventTranslator` **不**翻译该类型：图是**人**的记忆（画像、已接受的事实），而这个信号不属于这个人。一个测试在 `EVENTOS_DO_LOG_PROJETAVEIS` 中固定了它的缺席。
4. **按事件读取，没有新界面。** 改进产品的人通过查询事件日志读取（`session_events` 中 `type = 'anamnese.agent_deviation'`）。Insights 标签页现在不增加读取：它是按项目的、面向决策者的，而这个信号的读者是产品的维护者。

## 后果 {#consequences}

- 用户画像不再吸收 agent 的失败：kickoff 要求把修补记录为偏差（RN-716/RN-717）。
- **声明的缺口：** api 不检查 `evidenceEventIds` 是否存在（内部 append 不校验此类型的 payload）；没有聚合，也没有界面；而对偏差的识别由模型完成——代码只保证形态和不含个人数据。
- 改变 `tipo` 的词汇就是改变本契约，需要 RN。
