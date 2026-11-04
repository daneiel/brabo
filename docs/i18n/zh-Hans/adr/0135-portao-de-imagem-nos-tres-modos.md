---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0135 — Arquiteto 的镜像关口（RN-105）开始在三种执行模式下生效

## Context {#context}

自 FASE 25（ADR 0065/RN-105）起，只要还没有人决定项目运行哪个容器镜像，项目的 Code 标签页就返回 409——
`artifact.project_image`，由 Arquiteto 发出（`choose_project_image`），并且自 ADR 0133（RN-491）起，也由 Infra 在 Arquiteto 自身路由的候选项中选择时发出。顺序是用户定的：容器是在那里阅读代码有意义的原因，而在存在可执行之处之前就放开阅读，会教人以为这个关口只是装饰。

ADR 0072（RN-169），经 ADR 0104（RN-421）修订，为 `mounted`/`runner` 项目免除了这个关口：由于这两种模式不启动**自己的**容器——代码住在用户的文件夹中，挂载到已有的容器里（`mounted`），或由一个在容器之外运行的 CLI 确认（`runner`）——原规则会在一个 Arquiteto 的决定永远不会发生的项目上永远返回 409。这一豁免避免了作为副作用关闭标签页。

本次交付的原计划（“在真实容器中执行”，第 1 部分）把这一豁免声明为要重新打开的决策 #5，在本 PR 存在之前就已被接受：*"Portão RN-105 passa a valer nos TRÊS modos, container e aba Code.
Custo aceito: exp001/exp002 perdem a aba Code até o Arquiteto decidir."* 本 ADR 执行该决策，并记录它的代价以及它**不**改变的东西。

原来的豁免混淆了两个问题，ADR 0130（容器 broker）和 ADR 0133（Infra 的选择）把它们分开了，而 api 并没有跟上：“这个项目在**服务器**上启动容器吗？”（在 `mounted`/`runner` 中不——关于**机制**的问题）以及“在打开代码阅读之前要求有人决定了项目的镜像，这有意义吗？”（是，在三种模式下都是——关于**策略**的问题）。豁免用第一个问题的答案回答了第二个问题。

## Decision {#decision}

**三种执行模式（`container`/`mounted`/`runner`）都开始要求在 Code 标签页打开之前已决定 `artifact.project_image`。**
`ReadProjectCodeUseCase.portaoDoContainer` 不再检查 `executionMode`——关口变成无条件的，就像它在 `container` 模式内部早已是无条件的那样。`ProjectCodeTab`（web）不再把 `mounted`/`runner` 当作特例：三种模式都遵循同一个 `useQuery` 的加载/错误/`sem_decisao`/已决定流程，这**简化**了组件——`modoLocal` 分支和按模式条件的 `enabled` 都消失了。

**接受的代价，白纸黑字**：每一个**现有**的、没有已决定 `artifact.project_image` 的 `mounted`/`runner` 项目——包括本仓库真实的 dogfooding 项目 `exp001` 和 `exp002`——在本 PR 部署的那一刻**失去**对 Code 标签页的访问，直到 Arquiteto（或 Infra）为它决定一个镜像。这是部署**之后**需要的**操作员动作**，而不是用户察觉不到的透明修正——因此分支以 `breaking/` 而不是 `bugfix/` 诞生，即使内容是对缺口的修正：仓库约定（CLAUDE.md）明确规定，当变更需要操作员动作时，内容不决定前缀。版本升 MAJOR 是 `scripts/ci/version.ts` 的机械后果，而不是手动决定——事后不修改数字。

**容器生命周期（`project_containers`）也不再按模式拒绝，但原因更窄。**
`RegistrarTransicaoDeContainerUseCase` 曾对 `container` 模式之外的任何项目返回 400——这项检查实际上属于 broker（它已经以一个**自己的**、更具体的原因拒绝），而不属于这个用例。400 被移除；该表开始可以为三种模式登记行，经由早已读取镜像决定的**同一个** `provisioning` 漏斗（现在对 `mounted`/`runner` 也要求镜像决定）。

**仍然**不可能**、并且是刻意决定的，是 `mounted`/`runner` **真正**到达 `running`。** 这在一个地方执行——
`ContainerBrokerPort.start()` 以 `ModoDeExecucaoNaoSuportadoError` 拒绝
（`apps/broker/src/operacoes.ts`）：broker 在**服务器**上运行，看不到 `mounted`/`runner` 代码所在的用户文件夹，因此在那里组装容器就是从空文件夹组装。本 PR **不**改变这一策略——该错误类的注释早已指向本 ADR（“o PR do portão nos três modos (1.7) revisita as duas ao mesmo tempo”），而修订确认它保持原样是对的。

经调查并决定，无需代码改动：`ExecuteContainerStartUseCase`
在任何 `RegistrarTransicaoDeContainerUseCase.execute(..., 'provisioning')` **之前**调用 `ContainerBrokerPort.start()`——如果 broker 拒绝（对 `mounted`/`runner` 这是正常情况），失败就变成带有点名原因的 `container.start_failed`（`BrokerRecusouError`，**绝不**是崩溃或静默回退），生命周期转换根本不会被调用。也就是说：通过真实的审批路径（`container_start`），即使移除了按模式的 400，也不会为 `mounted`/`runner` 产生任何 `project_containers` 行——broker 早已是实际的关口，比旧的 400 更精确（它知道**能否**组装容器；用例只知道**模式**）。因此本 PR **不**在 `propose-action.use-case.ts` 或
`ExecuteContainerStartUseCase` 中加入第二次模式检查：重复会创造第二个与第一个产生分歧的地方——broker 自己的注释早已记录了这一教训。

同样经过调查：无论是 `propose_container_start`（Infra Lead 的工具，`apps/engine/lib/engine/infra/tools/propose_container_start.ex`）还是 `GetInfraContextUseCase`，今天都不按 `executionMode` 限制——Infra Lead **可以**为 `mounted`/`runner` 项目提出 `container_start`，而这个提议只有在有人批准、broker 拒绝时才失败。这是一个**既有**缺口（不是本 PR 引入的），会在一个注定失败的动作上浪费一轮人工审批——但失败是清晰的、有名称的，绝不沉默。修复它需要触碰 engine 中 Infra Lead 的 prompt/指令，超出本切片（API/领域）的范围；在下文声明，不顺手修正。

## Consequences {#consequences}

**`exp001`/`exp002` 以及任何其他没有已决定镜像的 `mounted`/`runner` 项目会失去 Code 标签页，直到有人为它们运行 Arquiteto（或 Infra 的选择）。** 这是原计划决策 #5 所接受的代价，而不是事后发现的副作用。

**阻止 `mounted`/`runner` 在服务器上启动容器的真正约束没有变化。** 它仍然是 broker（`ModoDeExecucaoNaoSuportadoError`），而不是 api 的 400——实际上它变得**更**精确了，因为现在只有一个地方做这个决定，而不是两个。

**`project_containers` 理论上可以为 `mounted`/`runner` 登记 `provisioning` 行**——但今天没有任何生产路径在不先经过 broker（它会拒绝）的情况下为这些模式调用
`RegistrarTransicaoDeContainerUseCase.execute(..., 'provisioning')`。如果某天有新路径绕过 `ExecuteContainerStartUseCase`（直接调用该用例），它会继承同样的保护：`obterImagem.execute` 继续要求决定，此外这里没有任何改变。

**Infra Lead 可以明知会失败地为 `mounted`/
`runner` 项目提出 `container_start`**——既有缺口，本 PR 既未引入也未关闭，在 CLAUDE.md（“Estado atual e aberto”）中声明以免遗失。

**考虑过并放弃的备选方案：在 `propose-action.use-case.ts` 或 `ExecuteContainerStartUseCase` 中加入模式检查，在调用 broker **之前**拒绝 `mounted`/`runner` 的 `container_start`。** 它会避免上面提到的被浪费的审批轮次——但会把关于**谁**能组装容器的知识（今天只有 broker 通过 `PROJECT_WORKSPACES_HOST_ROOT` 知道）搬进 api，而 api 没有这个上下文，并会复制一条在别处已存在的规则。暂时放弃：代价是一轮可避免的审批，而不是不正确——失败消息已经点明原因。若无效提议的数量证明有必要，作为 UX 候选登记，而不是作为 bug 修复。
