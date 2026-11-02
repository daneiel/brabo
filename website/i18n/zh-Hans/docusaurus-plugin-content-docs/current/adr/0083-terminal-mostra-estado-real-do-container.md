---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0083 — 终端标签页获得生命周期的真实使用者，而不是终端

## 状态 {#status}

已接受。修订 [ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md) 中“Nenhuma rota HTTP nova”一节，该节有意把这条路由推迟到出现真实使用者为止。不修订——也不能修订——[ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) 以及 FASE 25b（CLAUDE.md），它们继续声明交互式终端已被砍掉：本文档不立起容器的物理墙，只是从墙外读取登记的状态。

## 背景 {#contexto}

这条战线（PROGRAMA 28，Onda 5，frente F2）原来的计划是“交互式终端”，假定到这个时候按项目的容器已经有了真实的生命周期——真正的开通，agent 的 worktree 生活在容器内。这并没有发生。Onda 4/frente F1（ADR 0081）交付了 `project_containers`——一张状态**表**（`provisioning/running/stopped/failed/removed`）以及两个写入和读取这张表的用例——但没有任何对 Docker 的真实调用：没有服务挂载 `/var/run/docker.sock`，没有服务以 `privileged` 运行，而 `RegistrarTransicaoDeContainerUseCase` 除了它自己的测试之外没有任何调用方。不存在一个正在运行的真实容器可以在其**内部**打开终端。

实现一个假装执行命令的终端，或者在 Brabo monorepo 的**同一个**容器中执行——ADR 0055 已经把这笔债描述为政策而不是隔离——会编造一个不存在的能力。这与 ADR 0041/0042 已经拒绝的错误相同：没有证明的 LLM provider、没有策展的目录模型——能力只在被证明时才声明。

ADR 0081 已经把这条战线点名为缺少的使用者：

> Nada na Onda 4 consome esta tabela por HTTP ainda — o terminal interativo
> (25b/Onda 5) é o candidato óbvio, e decidir a forma da rota antes de saber
> exatamente o que ele precisa ler seria adivinhar um contrato.
> — ADR 0081

## 决策 {#decisão}

**终端标签页不获得终端。** 它获得 ADR 0081 所期待的真实使用者：`GET /projects/:projectId/container/lifecycle`（RN-267），一个只读路由，`role:viewer`，镜像 `ObterCicloDeVidaDoContainerUseCase` 而不增加逻辑——项目从未被开通时为 `null`（这是今天的常见情况，因为生产中没有任何东西转换这张表），否则为登记的状态（`status`/`imageVersion`/`resources`/`failureReason`/`statusChangedAt`）。

在自 FASE 26b 起就存在于 `CodeBottomPanel.tsx` 中的说明文字（“o terminal interativo ainda não existe — FASE 25b”）之下，该标签页开始显示这一状态，带有翻译成 pt-BR 的 `Badge` 以及存在时的失败原因。只有在终端标签页打开时才会请求（`enabled: aba === 'terminal'`），没有后台轮询——与 RN-107 已经对镜像闸门应用的流量纪律相同。

FASE 25b 的说明文字**没有被移除或削弱**：生命周期状态是额外的信息，而不是对终端本身为何不存在的解释的替代。一个项目能显示 `running`，并不意味着那里有可执行的东西——只意味着某人（今天是一个测试或一次手动调用）在表中登记了这次转换。

## 后果 {#consequências}

**开始存在的东西。** 容器生命周期的第一次 HTTP 暴露，以及产品中第一个读取 `project_containers` 的界面——在此之前，这张表只对直接查询数据库或测试的人可见。

**保持原样的东西。** 交互式终端。FASE 25b 仍被砍掉并已声明——本 ADR 没有任何一行启动编排器、挂载 Docker socket 或把终端命令路由进容器。发现 Z 和 AD（动词允许清单不收敛）出于与 ADR 0081 相同的原因仍然未关闭：关闭它们需要物理墙，而不是一个读取状态表的界面。

**按构造保持诚实的东西。** 由于今天生产中没有任何东西转换 `project_containers`，新路由最常见的响应是 `null`，标签页如实显示这一点（“ainda não foi provisionado”），而不是编造一个状态。等到真正的编排器存在并开始真实地转换这张表的那一天，同一个界面无需改变就会反映那个状态——它读取的已经是表所说的，而绝不是我们希望它说的。

## 参考 {#referências}

- [ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)——本文档最终通过 HTTP 暴露的那张表和两个用例。
- [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)——FASE 25b，仍被砍掉；本文档不重新打开它。
- [RN-105](../business-rules/autenticacao.md#rn-105)、[RN-107](../business-rules/autenticacao.md#rn-107)、[RN-243](../business-rules.md#rn-243)、[RN-267](../business-rules.md#rn-267)、[RN-268](../business-rules.md#rn-268)。
- `apps/api/src/interfaces/http/containers/containers.controller.ts`、`apps/web/src/routes/code/CodeBottomPanel.tsx`。
