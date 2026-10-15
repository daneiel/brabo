---
traducao_de: 89cbb17db55cf80033647930d80fa91cf9fecfd6
---

# ADR 0192 — 测试计划在 dev 交付之后诞生，gate `implementavel` 改为基于故事和 `module_map` 进行判断

## 状态 {#status}

**已接受。** 2026-10-01（AT-269，故事 HS-069，史诗 EP-030，第 35 轮；所有者 10月1日的决定：*"QA 只在 dev 交付之后"*——活动的出路 (b)，在知道它与 ADR 0090 相矛盾的情况下选择）。修订 [ADR 0090](0090-qa-estrategia-e-appsec-segundo-momento.md) 的一部分而不编辑它：QA 策略仍然是 `qa-lead` 在第二个**时刻**进行，没有新 agent，但这个时刻换了位置——离开设计阶段（PRE-DEV），移到交付审查周期的开头。appsec，即 0090 的另一半，**不**变。

## 背景 {#context}

### 症状 {#o-sintoma}

9月29日的真实使用（分析 `analise-uso-real.md`，A23 项）：两轮 `toolloop.limit_reached` 8/8，紧接着来源为 `modelo` 的 `agent.error`，"limite de iterações atingido sem emit_plano_de_teste"（会话 `be70`，seq 373/374 和 463/464）。循环把八次迭代花在读文档、一个空的 RAG 和目录上（seq 375–463），而 seq 454 用文字说出了原因：*"O código ainda não existe"*。Dev Lead 从未得到意见。

### 代码原来做了什么（在 `dev` 中测得，2026-10-01） {#o-que-o-código-fazia-medido-em-dev-2026-10-01}

- **谁打开 gate。** `implementavel`（`docs/gates.yml`）属于 `dev-lead`，`fluxo: pre-dev`，`severidade: warn`，`aprovacao_humana: true`，证据在 event log 中（按 `actionType: assess_implementability` 过滤的 `proposed_action.*`）。打开它的是工具 `assess_implementability`（`Engine.Agents.DevLeadTools.run_assessment/2`），Dev Lead 的 kickoff 把它介绍为**可选**的（"use o julgamento"）。
- **它判断什么。** `run_assessment/2` 读取会话尾部；没有该 story 的 `artifact.plano_de_teste` 时，调用 `Dispatcher.run_qa_estrategia/3` → `QaLeadServer.run_design/3` → `QaEstrategiaAgent.run/4` 并返回 `{:error, "chame de novo em
  instantes"}`；有计划时，提出意见（`implementavel`/`inviavel` + 理由），把 `planoDeTeste` 和 `criteriosExecutaveis` 嵌入 payload。输入是计划；**判断**本来就属于 Dev Lead。
- **QA 策略的上下文。** `QaEstrategiaContext.fetch/3` 提供 story + `module_map`，没有 worktree；`ReadFile`/`SearchWorkspace` 落到项目的共享 checkout 上。`EmitPlanoDeTeste` 只在一次读取之后才接受——所以，没有代码可读，模型就一直搜索到上限。
- **上限。** `"qa-estrategia"` 有意落到 `Engine.Harness.Iteracoes` 的默认值 `:conversacional`（8）（ADR 0090：底下没有 `token_budget_micros`，提高上限会成倍放大最坏情况）。
- **谁依赖裁决。** 代码中没有任何人。api 的用例和 engine 的模块都不读取 `assess_implementability` 的决定：执行的激活不查询它，没有其他 gate 把它作为 `entrada`，唯一的使用者是界面（`apps/web/src/lib/aprovacoes.ts` 中的句子）。该 gate 是 `warn`：通过是证据，不是锁。
- **之后的 gate。** `qa-verificada`（`block`，所有者 `area-qa`）在 dev 的 worktree 上于 `QaLeadServer.run/2` 中运行：`ContextBuilder.fetch/3`、委派（Automação 总是，Performance/Segurança 按非功能需求）以及**一个**汇总的 `qa_verdict`。Automação 按 story 的规则（RF + RNF）构建 `coverageMatrix`，只有在测试套件为绿且每条规则都被覆盖时才批准。

## 决策 {#decision}

1. **测试计划是 `qa-verificada` 周期的第一步。** `QaLeadServer.run_area/3` 在 `ContextBuilder.fetch/3` 之后、委派之前，获取**交付**的计划：
   - 在会话尾部（恢复的上限，RN-580）中重新找到**同一个** `taskId` 的 `artifact.plano_de_teste`——修正轮次（RN-015）不必再为另一轮循环付费；
   - 如果没有，就在自身进程中同步运行 `QaEstrategiaAgent.run/6`（该 agent 从不挂起），使用子专业所接收的 `dev_state`/`dev_context`：`workspace_root` = dev 的 worktree，业务规则单元，以及交付所触及的文件列表（`Engine.Gates.Diff`，`git diff dev...HEAD`，最多 40 个名字），放在第一条消息中。失败的 diff 变成文字（"não consegui listar: motivo"），绝不是空列表。

   计划作为 `:plano_de_teste` 进入 `dev_context`，Automação 在其消息**末尾**收到它，作为第 2 步（"哪个测试覆盖每条规则"）的输入。**裁决的尺子不变**：story 的每条规则在 `coverageMatrix` 中一行，`approved` 只在测试套件为绿且每条规则都被覆盖时成立。对外契约仍然是每个周期**一个** `qa_verdict`。

2. **失败的计划不会拖住审查。** QA 策略本来就会带来源记录 `agent.error`（RN-059）；Lead 在没有计划的情况下继续，Automação 的消息与以前逐字节相同。让计划的失败阻塞 task，会因为一个新的输入而在 `block` gate 上加一把新锁——这没有被决定，而所有者的决定是关于计划**何时**诞生，而不是关于它让交付失败。

3. **`implementavel` 基于故事和 `module_map` 进行判断。** `assess_implementability` 既不读取也不触发计划：输入变成 Dev Lead 在轮次上下文中**已经**拥有的东西——他的 kickoff 列出当前 `module_map` 的模块和 backlog 的故事（RF、RNF、DoD）——而判断写在 `justificativa` 中。意见在**第一次**调用时给出；payload 失去 `planoDeTeste`/`criteriosExecutaveis`。gate 继续存在，所有者、严重度、人工审批和证据都相同——只有 `entrada` 变了（`[story-ready, module_map]`）。没有新 gate。

4. **移除的内容。** `QaLeadServer.run_design/3`、`Dispatcher.run_qa_estrategia/3`（以及回调）和 `QaEstrategiaContext`——在第 3 项之后没有调用方，它们会为一个已被所有者决定淘汰的时刻保持可触发。

5. **工件改变形式。** `artifact.plano_de_teste` 开始要求 `taskId`（`Engine.Harness.ArtifactSchemas`）：它是**一次**交付的计划，Lead 正是凭它重新找到计划。

6. **上限**仍然**是 8。** `"qa-estrategia"` 不在 `Iteracoes.tipo/1` 中获得子句。缺的是输入，不是余量：代码存在、交付的文件在消息中，两三次读取就够了。在开销一侧变化的是现在有了 task，agent 开始在子专业共享的 `task_budget_micros` 之下运行（RN-036）——RN-085 的标准甚至允许在底下有这个预算时使用 gate 的上限，而决定是**不**用这扇门让计划通过。

7. **`docs/gates.yml` 和 `docs/fluxo.yml` 改变，是因为谁向谁交付什么变了**：`qa-verificada` 在 `entrada` 中增加 `plano-de-teste`；`implementavel` 把 `plano-de-teste` 换成 `module_map`；在 `fluxo.yml` 中，`qa-estrategia` 开始接收 `dev` 的交付并交付给 `area-qa`，`gate_saida` 为 `qa-verificada`（输入，不是自己的裁决），而 `dev-lead` 不再接收测试计划。

## 后果 {#consequences}

**有利**

- 真实使用中的症状不再有原因：计划不再在 agent 需要读的东西还不存在的时刻被索要。
- Dev Lead 在第一次调用时就得到意见，没有 ADR 0090 声明为代价的那个无回调异步窗口（它依赖于**模型**决定再调用一次）。
- 计划开始基于真实代码、带着 worktree 和 diff 编写，并由负责核查的一方——`qa-verificada`——在同一个进程、同一个周期中使用。零路由、零表、零新 GenServer；少了三个部件。
- 计划开始在底下有预算（task 的预算）。

**不利**

- **`implementavel` 变浅了。** 以前在花 token 写代码之前，有对 story 的第二双眼睛（QA）；现在意见只来自 Dev Lead，基于故事和 `module_map`。这是所有者决定的直接代价，而且该 gate 是 `warn` 且可选的——但 ADR 0090 买下的 QA "左移"对 QA 不复存在（appsec 仍在设计阶段）。
- **每次交付多一轮 LLM 循环**，位于审查的关键路径上：Automação 只在计划之后才开始。按 task 计，不按轮次计（按 `taskId` 复用）；在很长的会话中，计划可能已经离开 200 个事件的窗口而被重新编写——是成本，绝不是错误的数据。
- **计划与审查争用 task 的同一份预算**：一次昂贵的交付可能以更少的余量到达 Automação。
- **计划是输入，不是尺子。** 计划的可执行标准是否应变成 `coverageMatrix` 的必需行（从而让交付失败）是产品决策，本 ADR **不**作出。
- **上限 8 在大型交付中仍可能被突破**；此时结局是被叙述的 `agent.error`，审查在没有计划的情况下继续。在下一次真实使用中测量这一点，才能说明 8 是否足够。
- `docs/fluxo.yml` 的 pt-BR 译本（`website/i18n/…`）在本次改动之前就已落后于原文，现在仍然落后（AT-209）。

## 考虑过的替代方案 {#alternatives-considered}

**出路 (a)：把计划保留在设计阶段，基于故事、规则和 `module_map`，不探索代码，并提早要求 `emit_plano_de_teste`。** 它不与 0090 矛盾，是对症状最便宜的修正。被所有者拒绝（10月1日），选择了 (b)。

**把 `qa-estrategia` 的上限提高到 60。** 被活动和本 ADR 拒绝：那等于靠多花钱让计划通过，而在那个时刻并没有可读的东西。

**在交付之后为计划设一个新 gate（`plano-de-teste-pronto`）。** 被拒绝：新 gate 是需要自己 ADR 的产品决策，它会改变对外契约（每个 PR 多一个裁决），而计划本身没有可否决的东西——覆盖的裁决本来就属于 `qa-verificada`。

**在交付时异步触发 QA 策略（`DevAgentServer` 的 `cast`），与审查并行。** 被拒绝：Automação 会在计划存在之前就开始，这正是本设计要避免的竞争；而结果又会依赖于一个没人等待的事件。

**淘汰 `implementavel`。** 被拒绝：没人要求；该 gate 仍有可判断的东西（故事和 `module_map`），并且仍是有人在写代码之前思考过 story 的可度量记录。

## 参考 {#references}

- [ADR 0090](0090-qa-estrategia-e-appsec-segundo-momento.md) — `qa-lead` 和 secops 的第二个时刻；本 ADR 改变前者的时刻
- [ADR 0054](0054-gates-como-registro-declarativo.md) — gate 的对外契约
- [ADR 0085](0085-fluxo-como-registro-declarativo.md) — `docs/fluxo.yml`
- RN-674（`docs/business-rules.md`）、RN-340/341（由它修订）、RN-085、RN-036、RN-163、RN-580
- `apps/engine/lib/engine/gates/qa_lead_server.ex`、`qa_estrategia_agent.ex`、`qa_automacao_agent.ex`、`dispatcher.ex`；`apps/engine/lib/engine/agents/dev_lead_tools.ex`；`apps/engine/lib/engine/harness/artifact_schemas.ex`
