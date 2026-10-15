---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0014 — InfraAgent 与实时团队面板（Fase 4a 收尾）

- 状态：已接受
- 日期：2026-07-24
- 阶段：4a（第 4 次会话——收尾）

## 背景 {#contexto}

Fase 4a 的最后两项：**InfraAgent**（读取 module_map + Arquiteto 的基础设施 ADR，通过 PR 提议 Dockerfile/compose/CI——从不在环境中应用）以及**完整的团队面板**（所有 agent 都已实例化，通过 Phoenix 通道实时显示状态，不再是静态/统一的状态）。至此 Fase 4a 结束；Fase 4b（Psicólogo/Anamnese）留待以后。

验收标准：在试验项目中，InfraAgent 交付一个带有效 Dockerfile 的 PR，它通过各 gate（QA 语法 + SecOps 扫描），并且面板在一次真实执行期间以正确的状态显示整个团队。

## 决策 {#decisões}

### 1. Arquiteto→Infra 的 handoff——相同机制，新的提供点 {#1-handoff-arquitetoinfra--mesmo-mecanismo-novo-ponto-de-oferta}

InfraAgent 属于会话作用域 agent（Criativo/PO/Arquiteto）的**同一**家族——而不是 Dev/QA/SecOps 的项目作用域模式——因为它由显式 handoff 激活，而不是每个模块实例化一个。`ArquitetoServer` 增加 `handle_call(:offer_infra_handoff, ...)`（Criativo 的 `confirm_readiness` 的镜像）：运行一个收尾轮次并调用 `EngineApiClient.create_handoff(project_id, session_id, "arquiteto",
"infra", nil)`。专门的人工端点 `POST projects/:id/sessions/:id/agents/arquiteto/handoff-infra` → `OfferInfraHandoffUseCase`——**不**复用 Criativo 的 `readiness` 端点（流程中不同的 agent 和不同的时刻）。

`AcceptHandoffUseCase` 增加以 `toAgent === "infra"` 为条件的自主度 seed：`agent_autonomy (infra, open_infra_pr) =
auto_approve`（PR 的**提议**可以安全地自动批准——InfraAgent 从不在环境中应用任何东西）以及 `(infra, terminal) = deny`。`ArquitetoSupervisor`/`agent-activation.ts` 早已按 agent 名称通用——除了 `agent_command_controller.ex` 增加 `"infra"` 子句之外无需任何改动。

### 2. 终端限制是结构性的 + 策略性的，而不是新的 ActionType {#2-restrição-de-terminal-é-estrutural--policy-não-um-novo-actiontype}

`decide()` 依次评估 IAM → agent_autonomy → permissions.json，每个阶段只会**提高**宽松度——agent_autonomy 中的 `deny` 会在查询 permissions.json 之前**短路**。因此，"拒绝通用终端但放行 hadolint"无法（也不需要）在**同一个** ActionType `terminal` 中表达：InfraAgent 的 hadolint 校验（`ValidateInfraFile`，工具 `:direct`）作为通过 `Engine.Actions.HadolintDetector` 对 `System.cmd` 的直接调用运行，不经过任何 proposed_action——与 SecOps 的检测器同一模式。对通用 `terminal` 的拒绝是双重的：**结构性**（InfraAgent 的工具注册表——`[ValidateInfraFile.spec(),
ProposeInfraPr.spec()]`——从不包含 `Terminal`）和**策略性**（`agent_autonomy
(infra, terminal) = deny`，可通过 `decide()` 测试的纵深防御，但不是阻止误用的实际机制）。

### 3. `open_infra_pr` 把 `open_adr_pr` 推广到 N 个文件 {#3-open_infra_pr-generaliza-open_adr_pr-pra-n-arquivos}

新的 `ActionType`（`decide.ts`），量级与 `open_adr_pr` 相同（默认 maintainer/pending）。`domain/git/infra-pr-execution-result.ts` 镜像 `AdrPrExecutionResult`，但为 `paths: string[]`（一次提交包含多个文件）。`ExecuteInfraPrUseCase` 推广了 `ExecuteAdrPrUseCase`：`GitProvider.commitFiles` 本来就接受 `files: {path,content}[]`——只是使用者固定为 1 个文件。分支固定为 `feature/infra-setup`（每个会话一个，而不像 ADR 那样按 slug）。

**不开新 PR 的修正周期**：一个会话只产生**一个**基础设施 PR 周期——`changes_requested` 之后的修正复用**同一个**分支/PR，而不是另开一个。`ExecuteInfraPrUseCase` 通过 `InfraArtifactRepository.findBySessionId`（新增）检测这一点：如果该会话已有工件，就把调用视为修正——只有 `commitFiles`，没有 `createBranch`/`openPullRequest`，也不在 `infra_artifacts` 中新增行（复用**原始**执行的 `pullRequestUrl`/`pullRequestId`，通过 `listByProjectAndType` 读回）。`InfraAgentServer` 增加 `handle_cast({:correct, findings}, state)`（`DevAgentServer.correct/3` 的镜像）：指示模型修正并再次调用 `propose_infra_pr`——**同一个**工具，对修正情况没有特殊分支（区分完全在 api 中完成）。

### 4. 基础设施的 gate：轻量的并行表，相同的状态机 {#4-gates-de-infra-tabela-paralela-leve-mesma-máquina-de-estados}

基础设施 PR 背后没有 task/story/worktree（文件以直接内容诞生，与 ADR 一样——从不触及 worktree）。没有强行塞进 `tasks`，而是新建表 `infra_artifacts`（迁移 0016），带有与 `tasks` **相同**的 gate 列（`gate_status`、`gate_correction_count`、`blocked`、`blocked_reason`）+ `pr_action_id`（proposed_action `open_infra_pr` 的 id——engine 唯一能回认的 id）。与 `tasks`（在 PR **之前**就存在，之后通过 `OpenGateUseCase` 打开 gate）不同，基础设施工件只在 PR 已经打开时才诞生——`gate_status` 一到就是 `'awaiting_qa'`。

`RecordInfraGateVerdictUseCase` 针对 `InfraArtifactRepository` 而不是 `TaskRepository` 复用**同一个** `nextGateStatus`（纯领域，早已与 Task 无关）——按 `prActionId` 而不是 `taskId` 键控（`findByPrActionId`）。PR 上的评论通过 `listByProjectAndType`（而不是 `findInSessionForUpdate`，后者专用于带锁的事务内部）。

`Engine.Infra.InfraGateRunner`（新增）端到端是**确定性**的（没有自己的 GenServer，没有 LLM）——`run_qa/3` 对 PR payload 中的每个 Dockerfile 运行 `hadolint`（通过新的 `GetInfraPrFilesUseCase` + 端点 `GET .../infra-artifacts/:prActionId/files` 获取，因为没有 worktree 可供检测器指向）；`run_secops/3` 针对一个当场写入 payload 文件的**临时**目录运行 `gitleaks`+`semgrep`（与 dev 的 SecOps 相同的检测器）（在 `try` 的 `after` 中删除）。通过 `Engine.Gates.Dispatcher.run_infra_qa/3`/`run_infra_secops/3` 触发（与 Dev↔Gates 相同的可测试间接层，但使用 `Task.start`——发出即不管——而不是自己的 GenServer，因为 runner 在调用之间不需要状态）。

### 5. 实时团队面板——在既有的发出点广播 {#5-painel-do-time-ao-vivo--broadcast-nos-pontos-de-emissão-existentes}

没有新的 outbox 中继（更大的改动，验收标准不需要）：`Engine.Sessions.LiveBroadcast.event_appended/4`（新增，很小）在**所有**只写事件而不广播的项目作用域 GenServer（`DevAgentServer`、`QaAgentServer`、`SecOpsAgentServer`、`InfraAgentServer`、`InfraGateRunner`）中，紧挨着 `EngineApiClient.append_event` 被调用——在通道 `session:<id>` 上广播事件 `event.appended`。对话式 agent（Criativo/PO/Arquiteto/Infra）在既有的轮次边界（每个运行 `run_turn` 的 `handle_cast`/`handle_call` 的开始/结束）获得 `agent.status`（`working`/`idle`）。

Web：`session-channel.ts` 增加 `onEvent`/`onAgentStatus`——收到时执行 `queryClient.invalidateQueries(['session-events', ...])`（复用轮询已有的解析/缓存，只是把 refetch 提前）。`ProjectOverviewTab` 打开它**自己的**通道（`connectSessionHeartbeat`），独立于 `SessionPage` 已经打开的那个，因为它们是在不同时刻挂载的不同路由/标签页。

`lib/agent-status.ts`（新增）——`deriveAgentRoster(events, moduleMap,
executionActivated, handoffs)` 构建**真实**的名册：criativo/po/arquiteto 总是在；执行被激活时，按 module_map 的每个模块一个 `dev-<modulo>`（复用通用"dev-backend"的图标/颜色合成一个 `AgentDef`，因为动态 id 没有固定条目）；qa/secops 在任何 gate（dev **或** infra）曾经打开过时出现；infra 在 handoff 被接受时出现。状态：对话式 agent 取最后一个 `agent.status`；dev 通过对自身最近事件（`dev.*`/`backlog.task_blocked`）的启发式；qa/secops 通过最近一次意见的 `gateStatus`（`awaiting_qa`/`awaiting_secops` 说明球在两者中谁手里——它们是每个项目的单例，串行处理）。`ProjectOverviewTab` 的"Time de agentes"开始使用它，`model`/`autonomy`（`AgentCard` 早已接受这些 props）通过 `getAgentModelBinding`/`listAgentAutonomy` 在每次页面加载时解析一次。

### 6. 活动流与审批标签页 {#6-feed-de-atividade-e-tab-aprovações}

`activity.ts` 增加分支 `infra.gate_changed`、`infra.pr_opened`/`infra.pr_failed`、`infra.artifact_blocked` 和 `architecture.readiness_confirmed`（既有 `pr.gate_changed`/`adr.*` 分支的镜像，文字明确写着"PR de infra"）。`artifact.qa_verdict`/`secops_verdict`（既有分支，dev **和** infra 都复用）检查 payload 中的 `prActionId` 来区分文字，而不复制分支。

新的人工端点 `GET projects/:id/infra-artifacts`（`ListInfraArtifactsUseCase`）+ hook `useInfraArtifacts`。`PrGateTimeline`（既有组件，被 dev 的 PR 使用）的 prop `task: Task` 收窄为结构化接口 `GateSubject { title, blocked, blockedReason,
gateStatus }`——`Task` 和 `InfraArtifact` 在结构上都满足它，而不把组件耦合到 backlog 领域。审批标签页中新增"PRs de infra em revisão"一节，使用同一组件。

## 后果 {#consequências}

- 测试：`decide.spec.ts` 证明短路（agent_autonomy 中的 deny 永远不会去查询 permissions.json，即使有宽泛的 allow）；`ProposeActionUseCase` 集成测试（InfraAgent 提议 `terminal` 变成 `denied`）；`RecordInfraGateVerdictUseCase`（task gate 测试的完整镜像，包括已被阻塞的工件拒绝新的意见）。Engine：`ValidateInfraFile`（缺少 hadolint 不会破坏轮次）、`InfraAgentServer`（N 个文件的正常流程、修正、delta + `agent.status`、恢复）、`InfraGateRunner`（带发现的 lint、批准触发下一个 gate、缺少扫描器时跳过而不破坏）。
- `docker build --check` 不在范围内——它需要把主机 socket 挂载到 engine 容器中（Alpine，今天没有 docker CLI/守护进程），这是一个未经明确要求不承担的真实风险。只有 hadolint（`Engine.Actions.HadolintDetector`，可选二进制，与其他检测器同一模式）。
- "实时"面板通过在既有发出点广播实现——没有新的通用 api→engine→Phoenix outbox 中继。
- Fase 4b（Psicólogo/Anamnese）仍不在范围内。

## 范围与假设 {#escopo--assunções}

一个会话产生**一个**基础设施 PR 周期（修正复用同一个分支/PR——绝不会有第二个并发 PR）。diff↔扫描器发现之间没有深度关联（与 ADR 0013 相同的简化）。面板中 dev/qa/secops 的状态是启发式的（基于 event log 的尽力而为，不是事务性的事实来源）——对面板足够，不被任何 gate 决策使用。
