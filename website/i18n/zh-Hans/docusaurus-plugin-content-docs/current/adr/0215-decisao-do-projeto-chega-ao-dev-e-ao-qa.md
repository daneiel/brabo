---
traducao_de: 1f58364ef056b293fa60dc3aa0ddc5731b64f515
---

# ADR 0215 — 项目的决定传达到 dev 和 QA

## 状态 {#status}

**已接受。** 2026-10-14（AT-526；所有者于 10月14日的决定）。**修订** [ADR 0214](0214-pergunta-em-aberto-vira-pendencia.md) 的一部分：dev 上下文中“没有涉及该任务的 `afeta` 的决定不进入”这条规则。规则见 RN-870、RN-871 和 RN-872。

主题：`gates`。重要的效果在 QA 的 gate 上：它不再重复用户已经回答过的问题。

## 背景 {#context}

在 TP-01 中测得（第 15 轮，`viralabs-app-2026-10-11b`）：

- 用户在 15:45 回答了“código inexistente ou apagado responde 404?”。任务“listagem e exclusão de links”属于**另一个**故事，它的 QA 断言该问题仍未得到回答，给出 `needs_user_decision`，gate 搁置，而项目中并没有打开的问题——消息流中没有可以回答的东西。
- Criativo 写入的 `afeta.regras` 是规则的**标题**，而 ADR 0214 的过滤器（`afetaAlgum`）比较的是 **ID**：Criativo 的决定从来都匹配不上。即使用 ID，被引用的规则也不是该任务所在故事的规则。
- 裁决接受不存在或已回答问题的 `openQuestionId`，并会永远搁置。

## 决策 {#decision}

1. **裁决的 `openQuestionId` 会被核对**（RN-870）：在任何写入之前，它必须在项目中存在并且处于**打开**状态。不存在（或属于其他项目）返回 404 `pergunta_nao_encontrada`；已回答返回 409 `pergunta_ja_respondida`，正文中带有决定文本（`decisao`），不写入，也没有 `pr.gate_changed`——QA 读取决定而不是等待。
2. **`afeta.regras` 接受精确标题**（RN-871）：在事件漏斗中，项目某个 `artifact.business_rule` 的精确标题会转换为 id（标题重复时取最新的）；既不是 id 也不是精确标题的返回具名的 400。dev 上下文的读取也按故事规则的**标题**匹配，用于本规则之前写入的决定。
3. **项目的其他决定也会传达**（RN-872，所有者的选项 (a)）：`GET /internal/sessions/:sessionId/dev-context` 除了 `decisoes`（涉及该任务的）之外，还返回 `decisoesDoProjeto`——项目其余的 `decision_record`，放在一个**独立**的列表中，处于**同一个** 10 条上限之内：任务的决定排在前面并优先占用上限。这正是修订 ADR 0214 之处，其“没有 `afeta` 的决定不进入”一句对项目列表不再适用（对 `decisoes` 仍然适用）。

## 后果 {#consequences}

- 新字段是追加式的：在 engine 的 lane 在 dev 的 kickoff 和 QA 的片段中打印“Outras decisões do projeto”一节之前，engine 会忽略它（`context_builder.ex` 通过带具名键的 `Map.get` 读取上下文）。
- 10 条上限是**共享**的。在决定很多的项目中，不涉及该任务的旧决定会被排除——这是不扩大上下文的代价。
- `decisoesDoProjeto` 包括项目的所有 `decision_record`，而不只是由用户回答的问题产生的那些（Criativo 关于技术约束的决定也包括在内，RN-711）。
- 在规则版本之间重复的标题解析为最新的那个；不会因歧义而拒绝。
