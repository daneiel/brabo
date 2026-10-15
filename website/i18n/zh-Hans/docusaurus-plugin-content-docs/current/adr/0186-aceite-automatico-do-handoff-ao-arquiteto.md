---
traducao_de: 6aea992eb40df66f9d66e187efea4051efe796d3
---

# ADR 0186 — 当 backlog 已覆盖且仓库为本地时，PO 给 Arquiteto 的 handoff 无需点击即被接受

## 状态 {#status}

**已接受。** 2026-09-30（AT-314，故事 HS-079，第 32 轮；所有者于 9月30日的决定：*"Handoff oferecido pelo PO (LLM) pode provisionar o repositório local sem clique?"*——**可以**）。基于 [ADR 0165](0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md)，它把仓库的诞生放在给 Arquiteto 的 handoff 被接受时，并且隐含的前提是这次接受总是某个人的点击。不编辑它：**为同一次接受增加第二个作者**，带有封闭的条件，并把开通的位置完全留在 0165 放置的地方。

## 背景 {#context}

2026-09-30 在 `dev` 的代码中测得（AT-309 的调查）：

- PO 完成 backlog 后调用 `offer_handoff(to_agent: "arquiteto")`（`po_server.ex`，kickoff：*"Cubra TODAS as regras com ao menos uma história.
  Quando o backlog estiver pronto, ofereça um handoff ao arquiteto"*）。提议以 `offered` 诞生，并等待“Aceitar handoff e iniciar Arquiteto”的点击。
- 这次点击就是开通仓库的东西（`AcceptHandoffUseCase`，RN-582）。对于 `local` 仓库——接受时唯一会创建的，因为它是唯一不需要凭据的 provider——点击不做任何选择：没有要决定的托管，也没有要解决的密钥。它是一条没有替代方案的路径上的确认步骤。
- backlog 的覆盖率在产品中已经有**一种**算法，`computeCoverage`（`domain/backlog/coverage.ts`），由 Backlog 标签页（`GetCoverageUseCase`）和 PO 的读取工具（`ListBusinessRulesUseCase`，RN-164）使用：当至少有一个故事在 `businessRuleIds` 中引用某条规则时，该规则被覆盖。
- 调查的表格统计了从 brief 到执行约 11 次决策点击（+N 次晋升）；这是其中只保护自己的一次。

## 决策 {#decision}

1. **何时。** `po → arquiteto` 的提议由系统接受，在 engine 创建它的**同一个**请求中（`POST /internal/sessions/:id/handoffs`），在提议的事务之后、绝不在其中，当且仅当：
   - 提议处于 `offered`；
   - **backlog 已覆盖**——客观定义，基于 PO 写入的内容测量：项目有**至少一条**业务规则（`artifact.business_rule`），并且**没有**任何规则缺少在 `businessRuleIds` 中引用它的故事，按 Backlog 标签页的**同一个** `computeCoverage`。零条规则不算覆盖：“没有可覆盖的”不能证明 PO 干过活；
   - 接受所涉及的仓库是**本地且没有凭据**的：项目没有仓库（接受时会开通 `local`），或者已有的是 `local`，并且项目在 `project_git_connections` 中没有登记 git（OAuth）连接；
   - 打开会话的人在项目中仍然拥有人工接受路由所要求的角色（`developer`，RN-471 的有效角色）。
   决定是纯谓词 `decidirAceiteAutomatico`（`domain/sessions/aceite-automatico-do-handoff.ts`）；每个“否”都有具名的原因，而对 engine 的响应返回的正是它。
2. **接受者仍然是 `AcceptHandoffUseCase`。** 新用例（`AceitarHandoffAutomaticamenteUseCase`）只**读取**和**决定**；为“是”时，它调用一贯的接受，后者在 `activateAgent` **之前**开通仓库（RN-582，ADR 0165）。没有第二条开通路径。
3. **可审计。** 自动接受的 `handoff.accepted` 以**系统**参与者 `{kind: 'system', id: 'handoff-auto-accept'}` 写入，payload 带 `automatico: true`、`emNomeDe`（打开会话的人——仓库正是以其名义开通的，`provisionedBy`）以及 `criterio`（`regras`、`cobertas`、`repositorio`）。随后的 `agent.activated` 带**同一个**参与者。人工接受不变：参与者 `user`，没有这些字段。
4. **失败不向上抛。** 自动接受运行时，提议已经提交，engine 在等待它的响应；那里的异常会变成对一个确实存在的提议的“falha ao oferecer handoff”。所以失败变成**新**事件 `handoff.auto_accept_failed`（系统参与者，`origem: 'infra'`，`error`），响应写 `falhou`。当接受没能标记为 `accepted` 时，提议卡片仍然在那里。
5. **模型会得到通知。** 内部路由的响应获得 `aceiteAutomatico: {aceito, criterio?, motivo?}`，并且在 `aceito: true` 时为 `status: 'accepted'`；engine 的 `offer_handoff` 告诉 PO Arquiteto 已被激活，不应再次提议（再次提议会得到 `409 agente_ja_ativo`，ADR 0182）。

## 后果 {#consequences}

- 常见路径（新项目、本地仓库、覆盖了规则的 PO）少了一次点击；消息流显示带标准的接受（“o backlog cobre as N regras de negócio e o repositório é local”）。
- **远程或带凭据的仓库仍然需要点击**，按所有者的要求。手动 handoff（ADR 0109）也是：它不经过内部路由。
- 由 LLM 提出的 handoff 开始在没有人工点击的情况下产生 git 效果（`local` provider 的 `git init --bare` 以及 Gitflow bootstrap）。这是声明的代价，也是所有者批准的；绝对上限（push、PR、部署、受保护分支上的合并——RN-418）不动，因为这些都不会在本地开通中发生。
- 指向其他目的地的提议，以及由其他 agent 提给 Arquiteto 的提议，**不**获得自动接受。扩展到另一对需要新的 ADR。
- 对 engine 的响应耗时等于本地开通和 `startAgent` 的耗时，在 `Req` 默认的 `receive_timeout` 之内。本次会话未在真实安装中测量。
- 未测量：本次会话没有编译或测试 engine（环境中没有 Elixir）；`offer_handoff` 的新子句及其 ExUnit 测试已经写好，留给 CI。
