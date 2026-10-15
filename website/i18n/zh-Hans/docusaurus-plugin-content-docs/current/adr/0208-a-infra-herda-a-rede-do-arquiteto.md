---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0208 — Infra 继承 Arquiteto 声明的网络

## 状态 {#status}

**已接受。** 2026-10-02（AT-392；所有者于 10月2日的决定，“直接 egress”）。修订（不编辑）[ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) 第 3 点（服务器以字面量 `network: "none"` 启动），并偏离 [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) 的 §4——后者要求 `egress` 需经用户授权。

## 背景 {#context}

10月2日实测（项目 `loja-teste-2`）：Arquiteto 决定了 `artifact.project_image` v1，`network: "egress"`（“Egress necessário para npm install…”）。在 Infra 的 handoff 被接受时，服务器的自动启动（`subir_no_aceite/2`，`infra_lead_server.ex`）以 `none` 提议了 `container_start`，而 `ExecuteContainerStartUseCase` 以 `none` 写入了 v2（`infra-lead`），覆盖了 Arquiteto 的决定。Node 容器在无网络的情况下启动，`npm install` 无法运行。

## 决策 {#decision}

1. Infra 的选择**继承** Arquiteto（`actor_id: "arquiteto"`）在项目任意会话中发出的最新 `artifact.project_image` 的网络——由 engine 在本地读取（`Event.rede_do_arquiteto/1`，同一个 Postgres，循环中没有 HTTP）。适用于接受时的服务器启动，以及模型未传 `network` 时的 tool `propose_container_start`。
2. 没有 Arquiteto 的决定（或值不在 `none`/`egress` 之内）时，仍为 `none`，与之前一样。
3. 启动仍然是自动的：ADR 0190 的种子 `container_start: auto_approve` 不变，所以 `egress` 无需点击即可启动。

## 后果 {#consequences}

- 代价是**声明的**，而非付出的：`egress` 网络可以到达机器上已发布的端口（ADR 0189，边界情况 5），而 `external-effect.ts` 中“没有网络，`curl | sh` 什么也到不了”的推理，对每个 Arquiteto 声明了 `egress` 的项目不再成立。ADR 0065 §4 要求的用户同意，按所有者的决定退出了这条路径。
- Infra 写入的版本改为重复 Arquiteto 的网络，而不是降级它；构件的历史保持一致。
- 规则：[RN-723](../business-rules.md#rn-723)。
