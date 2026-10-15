---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0165 — 仓库在接受给 Arquiteto 的 handoff 时诞生，没有它执行就不会开始

## 状态 {#status}

**已接受。** 由维护者于 2026-09-18 决定（AT-092）。修订 [RN-522](../business-rules.md#rn-522) 的**触发条件**，它诞生是为了兑现 [RN-541](../business-rules.md#rn-541) 的承诺（"引导推迟到 Arquiteto 的 handoff"）。两者都不来自 ADR——两者都诞生于产品所有者的直接要求，只存在于 `docs/business-rules.md` 中——因此这是关于仓库诞生时刻的第一份结构性记录。开通**机制**不变：仍是同一个 `ProvisionRepositoryUseCase`，自 [ADR 0005](0005-repo-bootstrap-idempotent-steps.md) 起按设计就是幂等的，由同一个 `AcceptHandoffUseCase` 调用。[ADR 0038](0038-hierarquia-de-agentes.md) 的 handoff 目标规则（外部 handoff 只指向区域 lead 或无区域的 agent）以及 [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) 的 Arquiteto → Dev Lead 链条保持不变。

## 背景 {#context}

2026-09-14，v6.1.0 的一次真实安装在一个新项目的 event log 中产生了如下序列：

- 02:40:54 — Arquiteto 三次提议 `open_adr_pr`。仓库尚不存在，工具三次都失败。
- 02:43:53 — 向 `infra` 和 `dev-lead` 发出 `handoff.offered`（确认架构就绪会同时提供两者，`OfferInfraHandoffUseCase`）。
- 只有给 `infra` 的被接受。给 `dev-lead` 的停留在 `offered`。
- 03:02:34 — `POST /projects/:id/execution/activate` 返回 **201**。
- `project_repositories`、`project_git_connections` 和 `repo_bootstraps` 都是空的。项目永远没有仓库。

两个缺陷相互独立，而 RN-522 同时背负着两者：

1. **触发条件位于需要仓库者之后。** Arquiteto 是第一个拥有**写入**仓库工具（`open_adr_pr`）的 agent，而由 Arquiteto → Infra handoff 激活的 Infra Lead 是第二个（`open_infra_pr`）。两者都在接受给 Dev Lead 的 handoff **之前**工作。RN-541 说"仓库在开发开始时诞生"，而按 agent 所做之事衡量，开发从 Arquiteto 开始。
2. **唯一的触发条件可以被**跳过**。** 激活执行不要求已接受的给 Dev Lead 的 handoff——它要求当前的 `module_map`，别无其他。从总览（或者从 handoff 卡片本身的"Ativar execução"快捷方式，RN-137）激活的人会跳过接受，也就跳过了开通。路径上没有任何东西拒绝。

**谁交接给 Arquiteto，已测量。** Arquiteto 只有在存在一个指向它的 `accepted` handoff 时才能被激活（`canActivateAgent`，`domain/sessions/agent-activation.ts`）——例外只有 Criativo。handoff 通过两扇门诞生，两者都通过**同一个** `CreateHandoffUseCase` 写入：PO 在完成 backlog 时以 `offer_handoff(to_agent: "arquiteto")` 发出（`po_server.ex` 中的 kickoff 指令要求如此），或者用户通过手动 handoff 发出（`RequestManualHandoffUseCase`，ADR 0109）。而接受只有一个：`AcceptHandoffUseCase`，早已承载 RN-522 触发条件的同一个。不存在 Arquiteto 不经过这次接受就工作的路径。

## 决策 {#decision}

**1. 触发条件改为接受指向 `arquiteto` 的 handoff。** 在 `AcceptHandoffUseCase` 中，调用 `provisionarRepositorio` 的分支改为在 `toAgent === 'arquiteto'` 时触发，在 `activateAgent` **之前**——与 RN-522 早已使用的顺序相同，理由也相同：Arquiteto 醒来时项目已经有了工作的地方，第一次 `open_adr_pr` 就能找到仓库。分支中的其余一切逐字节不变：总是 `local`（唯一不需要凭据的 provider），失败变成带来源的 `repository.provision_failed`，绝不拖垮接受，**已采用**的仓库会提前退出且不算失败。

**2. 旧的触发条件**保留**，作为第二道幂等的门。** 对 `dev-lead` 的接受继续调用同一个开通。三个理由，按分量排序：

- **它是已损坏项目的出路。** 在本次改动**之前**经过了 Arquiteto 的项目（AT-092 的 `exp001` 正是如此：在旧规则下接受了给 Arquiteto 的 handoff，给 Dev Lead 的 handoff 仍为 `offered`）有一个待处理的 handoff，接受它就会开通。没有这扇门，唯一的出路会是手动开通页面，而没有任何界面从会话中提供它。
- **它是失败的自然恢复。** 如果开通在接受给 Arquiteto 时失败，事件留在日志中，而用户无论如何都会走的下一步——接受 Dev Lead——会再试一次，无需任何人知道存在一条开通路由。
- **代价按构造为零。** 当 `created` 的仓库已经存在时，`ProvisionRepositoryUseCase` 不调用 `createRepo`，不创建会话也不创建引导，runner 把所有步骤报告为已满足（ADR 0005）。这早已在该用例连续三轮中得到证明；本 ADR 增加的是**通过两扇门**的证明：先接受 Arquiteto 再接受 Dev Lead，针对真实的 Postgres 和 `LocalGitProvider`，结果是**一次** `createRepo`、`project_repositories` 中**一**行、`repo_bootstraps` 中**一**行，没有任何 `repository.provision_failed`。

移除第二扇门被考虑过并被拒绝：它没有代价，而替代方案会让 `exp001` 无法从用户所在的界面脱困。

**3. 没有仓库的 `execution/activate` 以 409 **拒绝**。** 在 `ActivateExecutionUseCase` 中，紧接 `module_map` 检查之后、任何效果（持久化预算、播种 `permissions.json`、创建会话）**之前**，用例查询 `ProvisionedRepositoryRepository.findByProjectId`。没有行时，抛出带**具名**原因的 `ConflictException`，原因由一个纯领域函数根据项目 handoff 的状态（`HandoffRepository.findByProject`，新增的只读读取）选择：

- 存在给 Arquiteto 的 `offered` handoff → "接受给 Arquiteto 的 handoff"；
- 否则，存在给 Dev Lead 的 `offered` handoff → "接受给 Dev Lead 的 handoff"（第二扇门）；
- 否则，两者之一已被接受 → 自动开通运行过却没有留下仓库（`repository.provision_failed` 说明原因），路径是项目的开通页面；
- 否则 → 没有任何给 Arquiteto 的 handoff 被接受，仓库在那时诞生。

**已采用**的仓库也算仓库。用 409 而不是 400，因为请求本身是对的：是项目的**状态**尚不允许。在**有**仓库时，重新激活一个已在运行的执行仍然不算冲突；在没有仓库时激活过的 `exp001`，重新激活时也开始收到 409——这正是想要的，因为它的 dev agent 从来没有过工作的地方。

**4. 界面不在没有仓库时提供激活，并用文字说明一次原因。** 总览的执行一节读取 `GET .../git/repository`（与 `ProjectPage`、`CodeShell` 和设置早已使用的同一个 `queryKey` `['repository', projectId]`——实际上没有新请求），在**确认**响应为 `null` 时，让按钮在原处变为惰性，并写出原因，附上开通页面的链接。加载中或出错时，按钮保持原样："不知道"不会变成"没有"，而后端无论如何都会拒绝。在会话内给 Dev Lead 的 handoff 卡片上，只要仓库不存在，"Ativar execução"快捷方式就会消失，卡片说明接受 handoff 会开通它——接受按钮就在旁边。这是 RN-102 和 ADR 0064 的尺子：拿走控件，绝不拿走信息。

## 后果 {#consequences}

- **RN-522 改变的是触发条件，不是机制。** RN-582 记录新规则；RN-522 和 RN-541 增加指向它的注释，创建向导的注释不再说"Dev Lead"。
- **在 Dev Lead 之前出现 Arquiteto → Infra 的情况不复存在。** Infra Lead 由 Arquiteto 的 handoff 激活，而按构造它只在接受给 Arquiteto 的 handoff 之后才存在——所以当它醒来时，仓库已经诞生。
- **`open_adr_pr`/`open_infra_pr` 的本地拒绝（AT-088）仍然必要**，并且是互补的：它覆盖开通**失败**的情况以及遗留项目，这些本 ADR 无法阻止其存在。
- **在代码中测得并接受的后果：`git-bootstrap` 会话开始在 Arquiteto 阶段的**中途**诞生。** `ProvisionRepositoryUseCase` 为引导日志打开自己的会话，而总览和 workspace 摘要按 `createdAt` 选择"最新"的会话。在 RN-522 下，这个会话诞生于接受给 Dev Lead 的 handoff，很快就被执行会话超过；现在它在与 Arquiteto 的整个对话期间都是项目"最新"的会话，直到下一个会话诞生。聊天会话不受影响（它的界面读取自己的 id）。修正需要决定引导日志是否值得拥有自己的会话，或者"最新"是否应忽略系统会话——两者都涉及另一条工作线的规则（RN-139，ADR 0005），这里不作决定。
- **完全没有给 Arquiteto 的 handoff、`module_map` 在流程之外写入的项目**，落入拒绝的第四个原因，通过开通页面脱困。它没有自动路径，也不需要有。
- **被拒绝的：** 在创建项目时开通（会推翻 RN-541，那是产品所有者的要求）；在 `execution/activate` **内部**开通（激活会带上隐藏的 git 效果，而它之前的 agent 仍然没有仓库——缺陷 1 原封不动）；以及移动触发条件而不保留旧门（会让 `exp001` 无法从会话中脱困）。
