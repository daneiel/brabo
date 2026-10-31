---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0013 — PR 的 gate：QAAgent 和 SecOpsAgent

- 状态：已接受
- 日期：2026-07-24
- 阶段：4a（会话 3——QA 和 SecOps 的 gate）

## 背景 {#contexto}

真实的 DevAgent（上一次会话）实现任务并打开 PR，但 PR 不经过任何自动审查——直接进入 `in_review`。本次会话增加缺少的两个 gate：**QA**（运行测试套件，组装规则→测试矩阵，指出没有覆盖的规则）和 **SecOps**（运行 semgrep/gitleaks，与安全 ADR 交叉对照）——每个都把意见记录为构件 + PR 上的评论，失败时在**同一个**分支上退回给 dev，并在变为 `blocked` 之前有一个纠正次数上限。

验收标准：一个带有（a）一条没有测试的规则和（b）一个硬编码密钥的任务 → QA 退回前者，dev 修正，SecOps 拦下后者，dev 修正，PR 到达 `awaiting_user`，时间线上有 4 个意见。

## 决策 {#decisões}

### 1. gate 的状态机作为纯上限 {#1-máquina-de-estados-do-gate-como-teto-puro}

`domain/execution/pr-gate-state-machine.ts`（与 `action-state-machine.ts`/`story-state-machine.ts` 相同的模式）：`PrGateStatus =
'awaiting_qa' | 'awaiting_secops' | 'awaiting_user'`。`nextGateStatus` 接收**当前**的 gate + 裁决，返回下一个状态（或者在纠正上限被突破时返回 `'blocked'`）——每个 gate 只能作用于**它自己**的状态（如果 QA 试图对 `awaiting_secops` 作决定，或者反之，则 `InvalidGateActionError`），保证不可变的**顺序**（批准 QA 绝不会直接跳到 `awaiting_user`）。`tasks` 获得 `gate_status`/`gate_correction_count`（迁移 `0015`）——没有存意见的新表：它们是 `session_events` `artifact.qa_verdict`/`artifact.secops_verdict`，与 `EmitArtifact` 相同的模式。

`RecordGateVerdictUseCase` 是**唯一**应用状态机的地方，它在 PR 上发评论（`GitProvider.commentOnPullRequest`，契约的第 10 个操作——尽力而为，绝不阻碍 gate 的决定），并把下一个动作（`correct`/`run_secops`/`done`/`blocked`）返回给 engine——一贯的原则：api 决定，engine 执行。

### 2. **不**复用对话式 handoff {#2-handoff-conversacional-não-reaproveitado}

`domain/sessions/handoff.entity.ts` 是为**对话式** agent 的激活（`offered/accepted`）建模的，没有分支/worktree/任务的概念——强行套用会比开辟新路径更糟。“QA/SecOps 失败 → 在**同一个**分支上退回给 dev”是一次 engine→engine 的直接调用：`DevAgentServer.correct/3`（不同于认领**新**任务的 `work/2`）复用已保存的 `state.worktree`/`state.branch`/`state.task_id`——**绝不**再次调用 `worktree_manager().create/3`。在纠正的 `report_done` 中，只有 `propose_commit`/`propose_push`（PR 已经存在，同一个分支）——绝不再次 `propose_pr`。

### 3. QA 使用 ToolLoop/LLM；SecOps 是确定性的——有意的不对称 {#3-qa-usa-toolloopllm-secops-é-determinístico--assimetria-intencional}

把业务规则的描述与测试的名称/内容对照，是**语义**判断——`QaAgentServer` 使用真实的 `ToolLoop`（与 DevAgent 相同的 harness），`Engine.Gates.Tools.EmitQaVerdict` 被**强制**执行，与 `ReportDone` 完全一样：只有当历史中最后一个 `terminal` 以 `exit 0` 退出时，才接受 `veredito: "approved"`。

发现硬编码的密钥或漏洞是对扫描器输出的**结构化**检查——一个**确定性**的 SecOps（没有 LLM）比一个总结安全发现的模型更可靠（在本应是二元的检查中有幻觉/遗漏的风险）。`SecOpsAgentServer` 运行 `gitleaks`+`semgrep`（`Engine.Actions.
GitleaksDetector`/`SemgrepDetector`，与 `RtkDetector` 的可选检测模式相同——`System.find_executable/1`，绝不假定已安装），并列出 `securityRelevant` 的 ADR（`open_adr_pr` 的 payload 中新的可选字段——信息性清单，没有逐行的深度关联）。零发现 → `approved`；任何发现 → `changes_requested`。

**两个扫描器都在 engine 的真实 Dockerfile（Alpine）中测试过，安装和运行都没有问题**（`gitleaks` 通过 GitHub release 的静态二进制；`semgrep` 通过 pip）——最初对 musl/Alpine 上不稳定的担忧在本次会话中没有得到证实。可选检测作为纵深防御保留（没有这些二进制的环境不会破坏 gate）。

### 4. QA/SecOps 共享 dev 的 worktree {#4-qasecops-compartilham-o-worktree-do-dev}

两者都不创建自己的 worktree——它们通过 `DevAgentState.find_by_task_id/2`（新查询）找到 dev 的——因为它们只读取/运行命令，从不写代码。`Engine.Gates.Diff.compute/2` 计算 `git diff <default_branch>...HEAD`（在此之前 engine 中完全没有 diff 计算）——用于意见的摘要（被修改文件的数量），而不是作为扫描器发现的逐行过滤器（有文档的简化：可靠地关联扫描器路径 ↔ diff 足够脆弱，在本次会话中不值得付出这份努力）。

### 5. 触发的间接层（Dispatcher）——可测试性 {#5-indireção-de-disparo-dispatcher--testabilidade}

`Engine.Gates.Dispatcher`（`.run_qa/2`、`.run_secops/2`）是 `DevAgentServer`/`QaAgentServer` 触发**下一个** gate 的唯一点——在测试中可替换（`Engine.Gates.FakeGateDispatcher`），理由与 `worktree_manager()` 相同：没有这个间接层，`DevAgentServer` 的测试会在测试进程的 Ecto 沙箱之外启动一个**真实**的 `QaAgentServer`（在运行测试套件时发现——GenServer 在尝试 `DevAgentState.
find_by_task_id` 时因没有连接所有者而崩溃）。gate→dev 的退回（`DevAgentServer.correct/3`）**不**经过这个间接层——它是通过 `:via`/`Registry` 的 `GenServer.
cast`，按 OTP 的本质就是即发即忘（进程不存在时静默，绝不拖垮调用者）。

## 后果 {#consequências}

- UI：`ProjectApprovalsTab` 获得“PRs em revisão”一节——每个打开了 gate 的任务一个水平步进器 dev→qa→secops→você（`PrGateTimeline`，新组件），意见可展开，QA 的 `coverageMatrix` 用 `ui/Table` 渲染。`activity.ts` 叙述 `pr.gate_changed`/`artifact.qa_verdict`/`artifact.secops_verdict`。
- 测试：状态机（不可变的顺序、纠正上限）、`RecordGateVerdictUseCase`（尽力而为的评论，超过 K 则阻塞）、`DevAgentServer.correct/3`（同一分支/worktree，没有新 PR）、`QaAgentServer`（`emit_qa_verdict` 的强制）、`SecOpsAgentServer`（植入的密钥 → changes_requested；扫描器缺失 → 跳过而不破坏）。

## 范围与假设 {#escopo--assunções}

QA/SecOps 只针对 DevAgent 的 PR——Infra 以及经由 Phoenix 通道的完整团队面板仍然在外。ADR 中的 `securityRelevant` 只是信息性标志（Fase 3b 的 Arquiteto 除了接受这个可选字段之外不变）。没有 diff↔扫描器发现的深度关联。`in_review →
done`（用户的最终批准）仍不在本次会话之内——gate 在 `awaiting_user` 结束，而合并的人工动作本来就总是手动的。
