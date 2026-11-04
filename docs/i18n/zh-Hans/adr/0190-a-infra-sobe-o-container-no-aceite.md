---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0190 — Infra 在接受 handoff 时启动容器，由服务器执行这一步并预置自主度，并由它交接给 Dev Lead

## 状态 {#status}

**已接受。** 2026-10-01（AT-260，故事 HS-065，史诗 EP-030，第 35 轮；所有者 10月1日的决定：*"`container_start` 在接受 Infra 的 handoff 时预置为 `auto_approve`，当存在 `module_routing` 时由服务器自行触发启动，不依赖模型"*）。修订 [ADR 0133](0133-infra-elege-imagem-do-roteamento.md)（RN-491）中 *"从不预置为自动批准"* 这句话，并依托 [ADR 0136](0136-pagina-global-de-containers.md) 的容器页面，两者都不编辑：它们设立的选举路径、上限和拒绝继续有效；改变的是**谁**触发第一次启动，以及它是否等待一次点击。

在同一轮中，出于 10月1日的同一决定（AT-262，RN-672）：*"Dev Lead 由 Infra 提供，只在容器 `running` 时；Arquiteto 的双重 handoff 退出"*。这改变了 [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) 设定（Dev Lead 由 Arquiteto 产生）并由 [ADR 0085](0085-fluxo-como-registro-declarativo.md) 记录在 `docs/fluxo.yml` 中的角色关系，但不编辑它们——见下面的决策 7。

## 背景 {#context}

2026-10-01 在 `dev` 的代码中、改动之前测得：

- 在 9月29日的真实使用中（会话 `be70`），Infra 写道它会与基础设施 PR "并行"启动容器（seq 282），却没有调用 `propose_container_start`；唯一的尝试是 `container_start_via_runner`（seq 280），因模式（`mounted`）被拒绝。容器直到 06:47:53 才启动，由一个人在 `/containers` 上完成。
- 启动完全依赖模型：Infra Lead 的 kickoff（`build_kickoff`）在第 4 步要求选举，如果模型不做，代码中没有任何东西会去做。AT-264（RN-668）已经关闭了**沉默**的两半——回答的整批内容在 PR 的 HALT 之前被派发，而当启动**没有**被提议时，轮次的收尾用服务器的语句说明——但它留下声明：作为服务器步骤的启动是本活动。RN-668 承诺的（"没有被提议"）是真的，但那是常见的结局。
- 卡片的文字说 kickoff 让启动成为可选（"之前、之后，或者永不"，`infra_lead_server.ex:955-961`）。**这一点不再复现**：RN-668 重写了第 4 步（"只有在它**之前**或在**同一个**回答中被调用时才会发生"）。其余部分复现。
- 接受 Infra 的 handoff 时会预置**两项**自主度（`accept-handoff.use-case.ts` 中的 `INFRA_AUTONOMY_SEEDS`）：`open_infra_pr: auto_approve` 和 `terminal: deny`。`container_start` 默认是 `require_approval`——`decide.ts` 中的 `maintainer`，位于绝对上限块**之外**，并且已**证明**能够通过 `agent_autonomy` 到达 `auto_approve`（`decide.spec.ts`，"agent_autonomy auto_approve CONSEGUE chegar a auto_approve"）——而 `ProposeActionUseCase` 早已在 `auto_approved` 路径中执行启动（这个分支是为配置了 `permissions.json` 的人而存在的）。也就是说：整个机制早已存在，缺的是预置和触发。
- `/containers`（ADR 0136，RN-521）以**人**的身份提议（`actor.kind:
  'user'`），而 `agent_autonomy` 只在操作者是 agent 时才被读取。为 Infra 预置不会改变该页面的任何东西。

## 决策 {#decision}

1. **预置。** 接受指向 `infra` 的 handoff 时预置**第三**项自主度：`container_start: auto_approve`，与一贯的两项并列。只有这一项：`container_start_via_runner` 和 `container_stop` 仍然可配置、从不预置，而 `container_remove` 仍在 `decide.ts` 的绝对上限中（RN-495），任何自主度都穿不过去。
2. **触发是**服务器**的一步，不是新工具。** 在 Infra Lead 的 kickoff 中——由已接受的 handoff 产生的轮次——在第一次调用模型**之前**，服务器读取基础设施上下文（一次读取，与 kickoff 文本所用的相同），如果存在**当前**路由（`artifact.module_routing`，`status: roteado`，且至少有一个候选）并且项目经由 broker 启动（`container`/`mounted`），就通过与工具**相同**的路径（`propor_container_start/2`）提议 `container_start`：先是按模式和状态的本地拒绝（RN-566、RN-610），然后是 `propose_action`，api 在那里因没有 broker 而拒绝（RN-591）、解析自主度，并且——`auto_approved` 时——执行 `ExecuteContainerStartUseCase`，后者通过 `DecidirImagemDoProjetoUseCase` 以 `decidedBy: 'infra-lead'` 选举镜像（RN-491）。没有诞生任何平行的选举路径。
3. **服务器的选举是确定性的。** 选覆盖路由中**最多**模块的候选；平局时，选最先出现的那个。网络 `none` 和默认资源——与工具相同的默认值。`rationale` 说明是服务器做的以及原因（"Arquiteto 为 M 个模块中的 N 个给出的候选"）。它总是候选之一，api 会拒绝任何其他的。
4. **痕迹是工具的痕迹，不对调用者撒谎。** 这一步写入持久的 `tool.call`（带 `origem: "servidor"`）和 `tool.result`，并且**不**在模型历史中放入 `role: "tool"` 消息：模型没有发出调用，而没有调用的工具回应会被 provider 拒绝。模型通过 kickoff 的**文本**得知启动，该文本改为说明**已经**发生了什么（提议及返回的状态，或拒绝及原因），而不是请求选举。
5. **`runner` 保持原样。** `container_start_via_runner` 路径（在用户机器上启动已决定的镜像）不获得服务器步骤也不获得预置：所有者的决定没有触及它。`runner` 项目的 kickoff 继续使用一贯的步骤，启动仍由模型提议、由人决定。
6. **RN-668 依然一致。** 服务器步骤通过与工具**相同**的 `registrar_subida/3` 标记轮次：由服务器提议的启动在收尾中不会得到"没有被提议"这句话；服务器的启动被**拒绝**（且没有被模型纠正）会得到拒绝的语句，那是真的。在启动不属于服务器的情况下（没有路由、`runner`）且模型没有提议时，收尾继续说话。

7. **Dev Lead 由 Infra 提供，在容器 `running` 时（RN-672）。** "确认架构就绪"改为只向 Infra 提供：`offerDevHandoff`、engine 的 `offer-dev-handoff` 路由以及 Arquiteto 的 `:offer_dev_handoff`/`handoff_dev_pendente` 被移除。当项目容器**登记**为 `running` 时，Infra Lead 的服务器提供 `infra → dev-lead`（`if_absent` 模式，ADR 0182），在它的每个轮次结束时以及 outbox 的 `container.running` 到达时询问——该事件的第二个使用者，与 dev agent 的唤醒并列（RN-502）。向 Dev Lead 接受时仓库的第二道门（RN-582）继续存在：接受是相同的，只是提供者变了。

## 后果 {#consequences}

- **在常见情况下，承诺由构造变为真实。** 有路由的 `container`/`mounted` 项目会在模型说任何话之前就提议启动——并且有了预置，就被执行。
- **"从不预置"不再成立，这是**唯一**改变的规则。** 最低角色仍是 `maintainer`，读作打开会话者的**有效**角色（`resolveEffectiveRole.forProject(session.createdBy)`）：由 `developer` 打开的会话得到 `deny`，与以前一样，kickoff 会说明拒绝。`permissions.json` 的 `deny` 仍然胜过自主度。
- **关闭它需要改动**具体**规则。** agent 卡片的手动/自动开关写入通配规则（`*`，RN-153），而具体规则胜过通配规则：把 Infra 设为"手动"**不**会关闭这一预置——与自 Fase 4a 起 `open_infra_pr` 早已存在的情况相同。想要启动需要点击的人，必须更换 Infra 的 `container_start` 规则。已声明，这里不解决。
- **重新接受 Infra 会重新预置。** 接受执行 `upsert`，与之前两项预置一样：在新会话中向 Infra 发出的新 handoff 会重新放入 `auto_approve`。与既有预置的行为相同。
- **kickoff 可能需要等待启动。** 自动批准执行的容器 `propose_action` 在 broker 的 `start` 之后才响应（engine 中的上限 225 秒，RN-605），而这一步在第一次调用模型之前运行：kickoff 的轮次在这段时间里处于 `working`，在一个 Task 中，"停止"一如既往地被响应。超出拉取上限（RN-605）的大镜像以 `failed` 到达，kickoff 会把这一点告诉模型。
- **失败的基础设施上下文不会启动任何东西。** 没有上下文读取就没有可选举的路由；kickoff 像以前一样降级，那个轮次中的启动重新依赖模型。服务器的启动也只发生在 kickoff 中：gate 修正和 composer 消息不会重复它。
- **没有容器就不再能接受 Dev Lead。** 链条变成 Arquiteto → Infra →（容器 `running`）→ Dev Lead → 执行，`docs/fluxo.yml` 也这样说：Arquiteto 的 `handoff-duplo` 输出变成一个只给 Infra 的 handoff，而 Infra 获得两个通往 Dev Lead 的输出（容器和 handoff）。容器从未启动的项目无法通过这条路径到达 Dev Lead；向任选 agent 的手动 handoff（ADR 0109）继续存在。
- **outbox 的通知是至多一次的**，与 `Engine.Dev.Wake` 一样：当 `container.running` 到达时如果没有运行中的 Infra Lead（会话已关闭、engine 正在重启），提供会等到 Infra 下一个轮次结束。`runner` 项目依赖这一通知，因为它的启动从不发生在 Infra 的轮次之内。
- **`decide.ts` 中说** *"未在 `INFRA_AUTONOMY_SEEDS` 中预置"* **的注释**在这次改动中变得过时，因为该文件属于同一轮中另一条进行中的工作线；规则本身（`container_start` 在上限之外，能够到达 `auto_approve`）没有改变。
