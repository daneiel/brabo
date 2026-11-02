---
traducao_de: 929963d24eb727bd64875486f2f1889172f3084a
sidebar_position: 13
---

# 审计：fluxo.yml × 代码（v3，ADR 0085） {#audit-fluxoyml--code-v3-adr-0085}

一次隔离的审计会话——**只读**。它把 `docs/fluxo.yml`（ADR 0085 声明的目标模型）与真实代码
交叉比对，以回答两个问题：代码要兑现流程中声明为 `active` 的一切还缺什么，以及在
`modelo-de-time.md` 的[激活表](modelo-de-time.md#activation-trigger-table)中，每个触发条件
背后真正分级排队的是什么。本次会话中没有修改任何一行生产代码；三个模型文档（`fluxo.yml`、
`gates.yml`、`agent-areas.ts`）都没有被编辑——在它们之间发现的每一处分歧都被视为**发现**，而
不是顺手修正的许可。

> ADR 0085 的原则：`proposto` 角色要声明今天由谁吸收它，以及拆分的客观标准——目标组织图是
> 激活的顺序，从来不是愿景。本审计不提前实现任何 `proposto`/`planned` 角色；凡是发现超出应有
> 范围的东西，都被明确标记为发现。

## 如何阅读本文档 {#how-to-read-this-document}

- **A 节——分歧。** 流程声明 X，代码（或同级的 `gates.yml`）做的是 Y。这是来源之间的冲突，
  需要产品负责人决策——这里一条都没有修正。
- **B 节——活跃角色的缺口。** 针对今天已在运行的角色所声明（从来不是“proposto”）的工作——
  现在就可以实现，不必等待任何触发条件。
- **C 节——按触发条件分级。** 激活表的每个触发条件会解锁什么，附范围估计，以及它是否已经触发。
- **D 节——波次计划。** 排序建议，从最便宜、可用脚本验证的 gate，到最昂贵的（需要 ADR 和产品
  决策的）。

---

## A. 分歧 {#a-divergences}

| # | 严重度 | 条目 | 证据 |
|---|---|---|---|
| A1 | **严重** | `dev-lead` 的 `gate_saida: paralelismo-autorizado`——`docs/fluxo.yml`（角色 `dev-lead`）声明 `status: ativo`；`docs/gates.yml:239-248` 声明 `status: planned`，注释为 “FASE 14d — entra active quando ela fechar”。FASE 14d 于 2026-08-07 关闭（与创建了 `gates.yml` 的 FASE 15 同一天），此后该机制一直处于激活、经过测试、在生产中运行的状态——`gates.yml` 之后从未更新。 | 真实机制：`apps/api/src/application/use-cases/execution/request-parallelization.use-case.ts:35-78`（超过上限时创建类型为 `parallelize` 的 `proposed_action`）；在 `apps/api/src/domain/actions/decide.ts:266-276` 中防止自动批准（`parallelize`/`raise_max_parallel` 永远不会离开 `require_approval`）；测试：`apps/api/test/application/use-cases/execution/request-parallelization.use-case.spec.ts:97`、`apps/api/test/domain/actions/decide.spec.ts:273-303`。`docs/fluxo.yml` 本身已把这个 gate 记为 `ativo`——分歧是 `gates.yml` ×（fluxo.yml + 代码），而不是 fluxo.yml × 代码。 |
| A2 | 高 | `dev-lead` 的输出 `plano-de-paralelismo`，声明为 `via: proposed_action`（RN-083/154）。代码产生的是简单事件 `execution.plan_proposed`（`apps/engine/lib/engine/agents/dev_lead_tools.ex:14-18,60-77`），**没有**审批流水线——这是有意的决策，记录在代码自身的注释中（“transformar a proposta em ação a decidir faria o usuário decidir duas vezes”）。真正存在的类型为 `parallelize` 的 `proposed_action`（与 A1 是同一部件）是由**用户在 UI 中的操作**触发的，即请求超过上限的增援（`apps/web/src/routes/ProjectOverviewTab.tsx:361` → `POST /sessions/:sessionId/execution/parallelize`），而不是由 dev-lead 计划的初始输出触发。`fluxo.yml` 把两个不同的机制合并成了一个输出。 | `apps/engine/lib/engine/agents/dev_lead_tools.ex:14-18,60-77`；`apps/web/src/routes/ProjectOverviewTab.tsx:361`；`apps/engine/lib/engine_web/router.ex:57`。 |
| A3 | 中 | `dev` 的状态机——`fluxo.yml:134` 声明了 4 个状态（`working\|awaiting_gate\|idle\|idle_tripped`）；真实代码有 **5** 个：增加了 `:awaiting_approval`（阶段 12e，ADR 0052），一个有自身转换的持久化状态，而不是瞬时的。 | `apps/engine/lib/engine/dev/dev_agent_server.ex:17-18,300-333,622-654`。 |
| A4 | 低 | RN-160 的引用被附在 Arquiteto 的输入 `backlog-promovido`（来源 `po`）上。真实的 RN-160 处理的是**输出**侧（Arquiteto → Dev Lead）的 “Confirmar arquitetura pronta” gate，而不是 PO → Arquiteto 的输入。 | `docs/business-rules.md:5606-5622` 对比 `docs/fluxo.yml`（角色 `arquiteto`，输入）。 |
| A5 | 低 | RN-161 的引用被附在 Arquiteto 的输出 `handoff-duplo` 上。真实的 RN-161（ADR 0069）处理的是**下一**步——接受交给 Dev Lead 的 handoff 会串联执行的激活——而不是双重 handoff 本身。 | `docs/business-rules.md:5624-5644` 对比 `docs/fluxo.yml`（角色 `arquiteto`，输出）。 |
| A6 | 低 | “Confirmar arquitetura pronta” gate（RN-160，≥1 个已晋升的故事）只在**客户端**得到保证（`SessionPage.tsx`，`hasPromotedStory`）；后端（`OfferInfraHandoffUseCase`）不重新校验。不经过 UI、直接调用内部路由会忽略这条规则。这不是 `fluxo.yml` 中声明的分歧——而是审计的额外发现。 | `apps/api/src/application/use-cases/agents/offer-infra-handoff.use-case.ts:19-38`。 |
| A7 | 信息性 | Criativo 的输出 artifact 在代码中是 `artifact.product_brief`，而不是字面上的 `necessidade-de-negocio`——是同一概念、不同的事件名；术语上的不精确，而非结构上的。 | `apps/engine/lib/engine/agents/criativo_server.ex:396-420`。 |
| A8 | 低 | `dev` 的输入 `worktree-por-agente` 标注为 “origem: harness”；`WorktreeManager` 位于 `Engine.Dev` 中，不是为 `harness` 角色列出的 4 个组件之一（`PromptAssembler`、`ToolLoop`、`ContextManager`、`Hooks`，`fluxo.yml:244`）。 | `apps/engine/lib/engine/dev/worktree_manager.ex:19-49` 对比 `docs/fluxo.yml`（角色 `harness`，组件）。 |
| A9 | 细节（非分歧） | `dev` 的输出 `pr-remota` 声明同时的目的地 `[area-qa, secops]`；真实机制是按状态机排序的顺序执行——QA 总在 SecOps 之前，从不并行。这并不与 fluxo.yml 矛盾（两者确实都是最终目的地），但可能诱导出同时扇出的解读。 | `apps/api/src/domain/execution/pr-gate-state-machine.ts:21-30`。 |

**经验证后丢弃的 sub-agent 发现。** 一次初步探索把标签 `achado_aberto: AE`（`fluxo.yml:158`，
角色 `area-qa`）指为“孤立引用”。验证：**这是真实且有文档记录的引用**——
`docs/explanation/achados-execucao-real.md:618`（`### AE. O agente de QA
tenta consertar o código que julga (P2)`）以及 `docs/explanation/backlog.md:40`。这里没有分歧；
记录下来是为了不再重复这次搜索。

---

## B. 活跃角色的缺口（现在就可实现的工作） {#b-gaps-in-active-roles-already-implementable-work}

下面所有条目都针对 `status: active` 的角色——没有一条依赖某个 `proposto`/`planned` 角色先存在。

| # | 缺口 | 在模型中的位置 | 具体缺什么 |
|---|---|---|---|
| B1 | **Dev Lead → dev 的委派**（ADR 0053 第 5 项） | `fluxo.yml`，`dev-lead` 的输出 `delegacao`，`status: lacuna` | 已确认缺失：`dev_lead_server.ex` 只注册了 `DevLeadTools.spec()`（`apps/engine/lib/engine/agents/dev_lead_server.ex:75`）；`delegations` 表已经接受通用的 `area: text`（`apps/api/src/db/schema.ts:1051-1091`），但 `RecordDelegationUseCase` 唯一的调用者是 `qa_lead_server.ex` 和 `infra_lead_server.ex`——没有一个使用 `area = 'dev'`。可照抄的模式已经存在两次（QA 和 Infra）；缺的是在 Dev Lead 中复现它。 |
| B2 | **`necessidade-validada` gate**（Criativo → PO） | `modelo-de-time.md`，“Estado da malha”——“gate novo = ADR” | 在 `gates.yml` 中不存在，在代码中也不存在。`modelo-de-time.md` 已经列出一个悬而未决的提议（“Anti-padrão do Criativo como validação real do gate”）——缺的是对客观标准的决策、ADR 以及在 `gates.yml` 中的登记（可以以 `warn` 诞生，像 `implementavel`/`operavel` 那样）。 |
| B3 | **`implementavel` gate**（dev-lead 的 gate_futuro） | `docs/gates.yml:250-259`，`status: planned`，负责人 `dev-lead` | dev-lead 已经是活跃角色；这个 gate 不依赖 `qa-estrategia`/`appsec` 存在——恰恰相反：是**创建**这个 gate 激活了它们（见 C1）。缺的是“可实现”的标准（例如：故事有最低限度的验收标准，没有阻塞性依赖）以及在 `gates.yml` 中的登记。 |
| B4 | **产品指标 → PO** | `fluxo.yml`，`po` 的输入 `metricas-de-produto`，`status: lacuna`；`analytics`（proposto）的 saída_alvo | `po_server.ex` 没有任何产品指标工具（`apps/engine/lib/engine/agents/po_server.ex:86-99`）。`modelo-de-time.md:21-25` 已经记录了原则：“analytics nasce como saída nova do `medicao` antes de ser papel”——也就是说，这**不**需要等 `analytics` 角色拆分出来；它是 `medicao`（已活跃，`sumGroupedBy` 已在生产中）的扩展，一旦存在，本身就是跨越“产品指标成为 PO 的输入”这一触发条件的行为（见 C2）。 |
| B5 | **`docs/gates.yml` 过时**（同 A1 发现） | — | 把 `paralelismo-autorizado` 的 `status: planned` 改为 `active`，证据为按 `actionType: parallelize` 过滤的 `event_log`/`proposed_action.created`，`onde: request-parallelization.use-case.ts`。这是元数据修正，可由 `pnpm --filter api validacao:gates` 即时验证——脚本已经会有真实证据可引用。 |
| B6 | **RN-160 在后端没有重新校验**（发现 A6） | — | 可选的加固：`OfferInfraHandoffUseCase` 在发出双重 handoff 之前要求 ≥1 个已晋升的故事，如今只有 UI 拦住按钮。 |
| B7 | **经由 `medicao` 的 DORA 报告** | `fluxo.yml`，角色 `delivery-metricas`（proposto，在触发表中 `status: — (nunca)`——“vira RELATÓRIO do medicao, nunca agente”） | 由于这个角色永远不会成为 agent，这一项不在任何触发条件之后——它是今天就可在已活跃的 `medicao` 上进行的工作：从 event log + `gates.yml` 提取 lead time、deployment frequency、MTTR 和 change failure rate，与 `medir:execucao`/`sumGroupedBy` 同样的模式。 |

---

## C. 按触发条件分级 {#c-staged-behind-a-trigger}

激活表（`modelo-de-time.md:52-62`），每一行附上本次审计验证的真实状态。

| 触发条件 | 激活的角色 | 已触发？ | 若跨越，估计范围 |
|---|---|---|---|
| 创建 `implementavel` gate | `qa-estrategia` + `appsec`——**现有** agent 的“第二时刻”（`qa-lead`/`secops` 获得“design”模式，没有新 agent） | **否。** `implementavel` 仍是 `planned`，没有任何路由/用例消费它（穷举搜索：`gates.yml` 之外零出现） | **M。** 依赖 B3 先关闭。之后：`dev-lead` 在提议并行之前以“design”模式调用 `qa-lead`/`secops`（测试计划、威胁模型）——复用 agent，没有新表，也没有新 worker。 |
| 产品指标成为 PO 的必需输入 | `analytics` 从 `medicao` 中拆分出来 | **否**——但跨越它的工作就是 B4，今天已触手可及 | 产出指标（B4）为 **S/M**；`analytics` 角色本身的拆分处在另一个主观标准之后（“当它成为必需输入时”，在 `modelo-de-time.md` 中仍是悬而未决的提议）——是产品决策，而不是额外的技术范围。 |
| `DEPLOY_ENABLED` 翻转 | `platform` 激活 → 然后 `secops-runtime` | **否。** 应用代码中没有任何对 `DEPLOY_ENABLED` 的真实读取——只在注释/文档中被提及；`tag-release.yml` 明确记录了没有隐藏的部署 job | **L。** 独立的项目群：真实的部署环境、GitHub Environments、被 `platform` 消费的绿色流水线、SLO/仪表盘/runbook——然后才是 `secops-runtime`（基于真实流量的检测）。流程 backlog 中最大的一项。 |
| Anamnese 结束细化 | `staff` 的触发条件重新有了负责人 | **否——而且走向了相反的方向。** 自 2026-08-10 起 `ANAMNESE_ENABLED=false`，用户的明确决定（“hoje ele não está trazendo dados de muito valor”，RN-115，`docs/business-rules.md:4597-4655`） | `fluxo.yml:263` 中引用的待办 “autor-da-proposta-de-teto (RN-086)” **已在代码中实现并经过测试**（`ProposeMaxParallelUseCase`，操作者硬编码为 `anamnese`；`apps/engine/lib/engine/workers/anamnese_worker.ex:270-286`；测试在 `anamnese_worker_test.exs:387-411`）——只是**被 flag 休眠**。这不是工程缺口；是暂停的产品决策，等待“对 Anamnese 所推导内容的未来细化”（`docs/explanation/backlog.md:349`）。 |
| 带自有 UI 的托管项目 | `ux-designer` 从 Criativo 中拆分出来 | **否。** 搜索交付给客户项目的原型/设计 artifact（在属于 Brabo 自身的 `design_handoff_brabo/` 之外）：零出现 | **L。** 依赖于代码标签页获得 UI 编辑/设计能力——如今它被明确声明为只读（FASE 26）。 |
| 真实的数据量 | `dbre` 从 Dev Lead/Platform 中拆分出来 | **否。** 代码中没有引用任何真实生产负载/数据量的指标 | **L。** 依赖于有规模的真实生产运营，如今不在团队的控制范围内。 |
| —（永不） | `delivery-metricas` 成为报告，而不是 agent | 按设计不适用 | 见 B7——报告本身不需要等待触发条件。 |

---

## D. 建议的波次计划 {#d-proposed-wave-plan}

从最便宜、可用脚本验证的 gate（纯元数据，没有新逻辑），排到最昂贵的（需要 ADR 和产品决策）。
每个波次是未来的一次会话，有唯一的交付物——**本次会话中一个都没有开始**。

| 波次 | 唯一交付物 | 条目 | 成本 | 验证 |
|---|---|---|---|---|
| **1** | `fluxo.yml`/`gates.yml` 更新到最新 | A1/B5（`paralelismo-autorizado` gate 的状态）、A3–A5、A8（修正 RN 引用以及 `dev` 的状态机） | S | `pnpm docs:check` 通过；`pnpm --filter api validacao:gates` 为 `paralelismo-autorizado` 引用真实证据 |
| **2** | Dev Lead 委派给 dev；“架构就绪”在后端得到证明 | B1（dev-lead 中的私有委派工具，与 `qa_lead_server.ex`/`infra_lead_server.ex` 同样的模式）、B6（在 `OfferInfraHandoffUseCase` 中重新校验 RN-160） | M | 证明 `delegations` 以 `area='dev'` 写入的测试；证明内部路由在没有已晋升故事时拒绝双重 handoff 的测试 |
| **3** | `medicao` 谈论产品 | B7（DORA 报告）、B4（产品指标作为 PO 的输入——跨越触发条件 C2） | M | 脚本从已知 fixture 中提取 4 个 DORA 指标；证明 PO 在 `metricas-de-produto` 存在时读取它的测试 |
| **4** | `implementavel` gate 诞生 | B3（dev-lead 中“可实现”的标准，在 `gates.yml` 中登记——可以以 `warn` 诞生） | M，含 ADR | ADR 已接受；`validacao:gates` 覆盖新证据 |
| **5** | QA 和 SecOps 获得第二时刻 | C1（`qa-lead`/`secops` 处于“design”模式：测试计划、威胁模型）——依赖第 4 波关闭 | M | 证明 dev-lead 在提议并行之前收到测试计划和威胁模型的测试 |
| **6** | `necessidade-validada` gate | B2（需求验证的客观标准、ADR、在 `gates.yml` 中登记） | M，含 ADR 与事先决策 | ADR 已接受；`validacao:gates` 覆盖新证据 |

**波次之外**（已登记的 backlog，没有会话估计——依赖真实规模/基础设施的决策，或依赖产品负责人
重新开启某样东西，而不是可排期的工程）：`DEPLOY_ENABLED`/`platform`/`secops-runtime`（C3，L，
独立项目群）、重新激活 Anamnese/`staff` 的触发条件（C4，用户的决策）、`ux-designer`（C5，依赖
代码标签页获得编辑能力——被 FASE 26 冻结为只读）、`dbre`（C6，依赖生产中的真实数据量）。

---

## 文档基础设施说明（不在本次审计范围内） {#documentation-infrastructure-note-out-of-scope-for-this-audit}

`docs/explanation/modelo-de-time.md` 存在且完整，但**没有列在 `website/sidebars.ts` 中**——
只能通过直接链接到达，无法通过站点菜单到达。这不是 `fluxo.yml` × 代码的发现；而是一个先前
就存在的发布缺口，在这里标出以免遗失，本次会话中不作修正（超出声明的范围：“没有任何代码
变更”）。

---

## 摘要 {#summary}

- **9 处分歧**（A1–A9）：1 处严重（在一个已经以 `active` 运行的文档中被错误标记为 `planned`
  的 gate），1 处高（并行计划的审批机制与声明不符），2 处中，4 处低，1 处信息性，1 处没有真正
  矛盾的细节。
- **7 个活跃角色的缺口**（B1–B7），全部无需等待触发条件即可实现。
- **激活表中的 7 个触发条件**，没有一个已触发——其中一个（Anamnese）自上次阅读 fluxo.yml 以来
  走向了相反的方向。
- **零个提前实现 `proposto`/`planned` 角色的代码发现**——在所有被审计的角色中，声明的缺口都
  确实是空的。
