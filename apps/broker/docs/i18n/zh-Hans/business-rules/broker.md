---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-broker
title: 'Regras de negócio — Broker'
sidebar_label: Broker
description: 'As RNs hospedadas na raiz broker.'
keywords: [regras de negócio, broker]
---

# Broker

## RAG 检索留下痕迹，痕迹冻结权重（RN-479..481）

### RN-494 — 镜像门槛（RN-105）在**三种**执行模式下都有效 {#rn-494}

**修订 [RN-169](api.md#rn-169)（第 1 项）和
[RN-421](api.md#rn-421)**：对 `mounted`/
`runner` 项目豁免 RN-105 门槛——“这些模式不启动自己的容器，所以 Arquiteto 的决定永远不会发生”——已被**撤销**。`ReadProjectCodeUseCase
.portaoDoContainer` 不再检查 `executionMode`：**三种**模式现在都要求在开放 Code 标签页的七个读取路由之前已决定 `artifact.project_image`（由 Arquiteto 通过 `choose_project_image`，或由 Infra 选出一个候选，通过 `container_start`——ADR 0133/RN-491）。

最初的豁免混淆了两个问题：“这个项目在**服务器**上启动容器吗？”（在 `mounted`/`runner` 中不，这里也不变）和“在开放代码读取之前要求**某人**已经决定了项目的镜像，有意义吗？”（是，在三种模式下都是——决定关乎项目**执行**什么，而不是物理容器在哪里启动）。保留豁免会让 `mounted`/`runner` 的 Code 标签页在没有任何人考虑过项目镜像的情况下打开；统一的规则关闭了这个缺口。

**被接受的代价，明明白白地说**：每个**现有**的、没有已决定 `artifact.project_image` 的 `mounted`/`runner` 项目——包括 `exp001`/`exp002` 这样的真实 dogfooding 项目——在这个 PR 部署的那一刻就**失去** Code 标签页的访问，直到 Arquiteto（或 Infra）为它决定一个镜像。这是部署之后需要的**运维操作**，而不是透明的修正——因此分支以 `breaking/` 诞生，版本升 MAJOR。

**生命周期（`project_containers`）也不再按模式拒绝**：
`RegistrarTransicaoDeContainerUseCase` 不再对
`mounted`/`runner` 返回 400——表可以为三种模式记录行，同一个 `provisioning` 漏斗（它已经读取镜像决定，现在对它们也是必需的）。对 `mounted`/`runner` 仍然**不可能**的是**真正**到达 `running`：这只在一个地方施加，即 `ContainerBrokerPort.start()`，它会拒绝
（`ModoDeExecucaoNaoSuportadoError`，有意的策略——服务器上的 broker 看不到 `mounted`/
`runner` 代码所在的用户文件夹）——而 `ExecuteContainerStartUseCase` 早已把这种拒绝当作普通失败处理（`container.start_failed`，具名原因），从不崩溃，从不沉默。实际上，通过正常路径（批准 `container_start`），这两种模式在 `project_containers` 中**一行都不会**诞生，因为 broker 在调用任何转换**之前**就拒绝了。在 `propose-action.use-case.ts` 或 `ExecuteContainerStartUseCase` 中重复这项模式检查被考虑过并被**放弃**：broker 已经大声且具名地失败，重复的检查只会产生第二个与第一个分歧的地方——与 `ModoDeExecucaoNaoSuportadoError` 的注释（`apps/broker/src/operacoes.ts`）相同的推理，它早已指向这个 PR。

web 一侧不再把 `mounted`/`runner` 当作特例：
`ProjectCodeTab` 过去会询问项目的模式，当模式不是 `container` 时直接打开 shell，甚至不调用 `GET /projects/:id/container`。这**简化**了组件——三种模式现在走同一条 `useQuery`/状态路径（加载中、错误、`sem_decisao`、已决定），没有 `modoLocal`，也没有按模式的条件 `enabled`。

- **位置：** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  （`portaoDoContainer`，豁免已移除）、
  `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
  （按模式的 400 已移除）、`apps/api/src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
  （修正了顺序注释）、`apps/web/src/routes/ProjectCodeTab.tsx`
  （统一门槛，`modoLocal` 已移除）
- **测试：**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  （"o portão do container" 块：`mounted`/`runner` 没有决定时返回 409，已决定时正常读取）、
  `apps/api/test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  （`mounted`/`runner` 记录 `provisioning` 而不是 400）、
  `apps/web/src/routes/ProjectCodeTab.test.tsx`（三种模式同等对待）
- **架构决策：** [ADR 0135](../adr/0135-portao-de-imagem-nos-tres-modos.md)
- **来源：** 产品负责人的计划，第 1 部分 / PR 1.7——原计划的第 5 号决定（“Portão RN-105 passa a valer nos TRÊS modos”），在这个 PR 存在之前就已被接受
