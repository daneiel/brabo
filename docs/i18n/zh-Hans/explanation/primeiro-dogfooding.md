---
id: primeiro-dogfooding
title: 第一次 dogfooding 教会了什么
sidebar_label: 第一次 dogfooding
sidebar_position: 4
description: Fase 10 的收获——Brabo 第一次构建 Brabo 自身时的十七项发现，哪些被度量了，哪些因为没有记录而丢失了。
keywords: [dogfooding, 收获, Fase 10, 发现, 可操作性]
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 第一次 dogfooding 教会了什么

在 Fase 10 中，Brabo 构建了 Brabo 自身的一部分：对 Bitbucket 的支持和 `GenericGitProvider` 由产品的 agent 在一个 fork 中交付，一个人扮演用户的角色。这是第一次脱离演示的真实执行。

本文档是那次运行的**收获**。它之所以存在，是因为 `CLAUDE.md` 从 Fase 10 起就引用它，而它从未被写出来——这一缺失值得记录，它本身也是发现之一。

:::warning 丢失了什么

任务的观察表（`docs/missions/dogfooding-mission.md:488-490`）**只填了一行**：第 1 行，手工 seed，在第一次会话开始之前记下。没有统计任何一次运行。

仓库中不存在 engine 重启次数、人工干预次数、审批点击次数或每次会话的成本。任务本身就提醒过（`colheita-esqueleto.md:63-68`）`restarts do engine` **在系统中没有任何记录**——只是人工笔记，如果不在现场记下，就会消失。

因此这里所有的定量内容都显示为 **`não medido`**，绝不作为估计。这是收获本身的规则：没有能产生它的查询，任何数字都不能进入（`colheita-esqueleto.md:22-24`）。

:::

## 被记录下来、并且真实的内容 {#o-que-ficou-registrado-e-é-real}

存留下来的是**定性**部分，而且很密集：十七项带有文件和行号的发现，在运行期间于代码中核实。整个 Fase 12 都由它而来。

### 第一次会话之前：手工 seed {#antes-da-primeira-sessão-o-seed-manual}

运行以一次不在计划中的干预开始。实验针对一个 fork 运行，`project_repositories` 和 `repo_bootstraps` 的行被**手工插入**，标记为已收敛，以免产品尝试恢复一次引导（`dogfooding-mission.md:104-134`）。

原因是发现 #1：产品只会**创建**仓库。`createRepo` 是无条件的，而 `getRepo` 自 Fase 2 起存在却没有任何调用方。

> 这是实验的第一次人工干预，而且它发生在**实验开始之前**（`:130-133`）。

### 期间：批次 {#durante-as-tandas}

运行的第二个结构性事实是发现 #10：**一个 dev agent 处理一个 task 就停下**。`:work` 只在激活和接受并行化时触发；没有任何东西把 agent 从已打开的 PR 带回"可以认领"状态。

运营上的后果描述在 `:393-416`：该阶段按**批次**运行。每个后续 task 都需要重启 engine——dev agent 是 `restart: :temporary`，死了就不再回来——并重新激活执行。只重新激活而不重启解决不了问题：supervisor 返回已有的 agent 而不触发 `:work`，还会创建一个孤儿会话（发现 #11）。

重启次数**未测量**。可以确定的是这一性质：按照当时的设计，**每交付一个 task 重启一次**是下限，而不是观测到的平均值。

### 第三项：没有人工步骤的晋升 {#o-terceiro-a-promoção-sem-passo-humano}

发现 #13 在最初的分类中是 P2，后来被提升为 P1。`draft → ready` 的转换**在创建时自动发生**；`TransitionStoryUseCase` 会校验并发出事件，但没有连接到任何路由——死代码。Backlog 标签页是只读的。

也就是说：PO，一个 LLM agent，独自决定什么进入 dev agent 的工作队列，而这个产品声明的原则是用户拥有最终权威。

## 十七项发现 {#os-dezessete-achados}

按任务原文保留，带有当时获得的优先级。Fase 12 关闭的已标出。

### 第一次会话之前的调查 {#do-levantamento-anterior-à-primeira-sessão}

| # | 发现 | 位置 | 优先级 | 状态 |
|---|---|---|---|---|
| 1 | 产品不会把项目指向已有仓库。`createRepo` 是无条件的；`getRepo` 存在但没有任何用例调用；DTO 没有 `externalId` 字段 | `provision-repository.use-case.ts:144` | **P1** | **已关闭** — [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md) |
| 2 | GitHub 上的 `protectBranch` 在已有保护之上施加 `enforce_admins: true` + 1 名审查者，而不读取当前状态——可能锁住所有者的手动合并 | `github-provider.ts:170-175` | **P1** | **已关闭** — 成为产品规则（[RN-045](../business-rules/custo.md#rn-045)） |
| 3 | 引导会创建并保护一个 Brabo 分支策略（Fase 6）并不使用的 `rc` 分支 | `bootstrap-steps.ts:94,195` | P2 | **已关闭** — [RN-029](../business-rules.md#rn-029) |
| 4 | `agent_areas`/`agent_area_members` 不存在；区域、lead 和成员硬编码在两个可能分歧的地方 | `schema.ts:781-786` | P2 | Fase 8 记录在案的切分 |
| 5 | Fase 9b 的六个 LLM provider 没有进入，而 CLAUDE.md 把 Fase 9 描述得好像它们已经进入 | ADR 0042:147-156 | P2 | 在 Fase 11 关闭 |
| 6 | `git-providers.md` 声称 Bitbucket 和 Generic "不在范围内"；CLAUDE.md 把两者标为进行中的阶段 | `docs/reference/git-providers.md:170-174` | P2 | 在 Fase 10 本身关闭 |
| 7 | `git-errors.ts` 的注释说"8 个操作"；契约有 10 个 | `git-errors.ts:3` | P3 | **已关闭** — 并且计数成了测试 |
| 8 | 契约套件的文件头说只有 Local 运行它；GitHub 和 GitLab 自 Fase 2 起就在运行它 | `git-provider.contract.ts:12-18` | P3 | **已关闭** — 并且调用方列表成了测试 |

### 运行过程中的调查 {#do-levantamento-da-condução}

| # | 发现 | 位置 | 优先级 | 状态 |
|---|---|---|---|---|
| 9 | **Criativo 无法被省掉。** 认领要求故事处于 `ready`；`ready` 要求 ≥1 条业务规则；id 要对照真实事件校验；而只有 Criativo 有 `emit_artifact` | `story-readiness.ts:46`, `po_server.ex:18` | **P1** | 开放 |
| 10 | **一个 dev agent 处理一个 task 就停下。** `:work` 只在激活和接受并行化时触发 | `dev_agent_server.ex:76-91,306-327` | **P1** | **已关闭** — [ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md) |
| 11 | 重新激活执行不会重新触发 `:work`，还会多创建一个没有绑定 agent 的会话 | `dev_agent_supervisor.ex:33-52` | P2 | **已关闭** — [RN-053](../business-rules/custo.md#rn-053) |
| 12 | 不存在向任选 agent 的手动 handoff，而 ADR 0038 的目标校验从未实现 | `SessionPage.tsx:403-407` | P2 | **关闭一半** — 目标校验见 [RN-054](../business-rules.md#rn-054)；手动 handoff 仍开放 |
| 13 | 不存在"晋升为 ready"：晋升在创建时自动发生。`TransitionStoryUseCase` 没有连接到任何路由——是死代码 | `create-story.use-case.ts:75-78` | P2 → **P1** | **已关闭** — [ADR 0046](../adr/0046-promocao-de-story-com-autoridade-do-usuario.md) |
| 14 | 不存在退回给 PO——没有状态、事件或按钮 | — | P2 | 与 #13 一起**关闭** |
| 15 | 团队面板和 Psicólogo 的假设共用同一个标签页，而它是项目的默认标签页 | `ProjectOverviewTab.tsx:227-263` | P2 | **已关闭** — 独立的 Insights 标签页，带计数器 |
| 16 | 没有界面按会话汇总审批；按需的 Anamnese 没有按钮 | `hooks.ts:153-160` | P3 | **部分关闭** — 见下方注释 |
| 17 | **本阶段的主要指标不在 event log 中。** `proposed_action.approved`/`.denied` 只进入 outbox | `approve-action.use-case.ts:98` | **P1** | **已关闭** — [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md) |

:::note 发现 #16 有一半是错的

关闭它时，核查表明第二个论断——"按需的 Anamnese 没有按钮"——**在发现被写下时就已经是错的**：路由 `POST /projects/:projectId/anamnese/run` 存在（`anamnese.controller.ts:71`），"Rodar agora"按钮位于"设置 › 熟练度"（`ProjectSettingsTab.tsx:777`），并由 `ProficiencySection.test.tsx` 覆盖。

前一半是真实的，并已关闭：会话标签页开始汇总**每个会话**的提议操作，区分你点击的（`decidedBy`）和策略自动批准的（`resolvedPolicy`）。之前一切都来自 `usePendingActions`，它要求一个 `sessionId`，而三个调用方传的都是最近一个会话的——在更早会话中被遗忘的决定会永远不可见。

这一记录保留下来，因为**收获不通过删除来修正**：一项部分错误的发现，本身就是关于运行如何进行的信息。

:::

有两项作为**记录而非缺陷**进入，以免收获把它们与缺口混淆：**在产品之外的合并**（`awaiting_user` 有意是终态，[RN-014](../business-rules.md#rn-014)——engine 甚至不认识 `git_merge`），以及非功能需求中**按关键词省掉 QA**（`qa_lead.ex:20-28`），那是声明过的启发式，不是 NLP。

## 没有测量的内容 {#o-que-não-foi-medido}

明确列出，以免看起来像是遗忘：

| 什么 | 为什么 |
|---|---|
| 每个 task 的 engine 重启次数 | 系统中没有记录；依赖现场的人工笔记 |
| 人工干预及其原因 | 同上——观察表从第 2 行起留空 |
| 每个会话的审批点击次数 | 发现 #17 解释了：`proposed_action.approved` 没有进入 `session_events`；持久的来源是 `proposed_actions.decided_at`，而这次运行没有汇总它。后来由 [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md) 关闭——从此以后这个指标存在，但不会追溯到这次运行 |
| 按 agent 和按 provider 的 token 成本 | `token_usage` 有数据，但没有运行任何查询，那次执行的数据库也没有保留 |
| gate 中的修正轮次 | 同上 |

发现 #17 是这一组中代价最高的，教训关乎埋点：**一个实验的主要指标必须在实验开始之前就进入持久日志。** 它没有，所以收获的定量那一半并不存在。它后来由 [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md) 关闭，而这对**下一个**实验有效：没有任何修正能重建没有被写下的数据。

## Fase 12 对此做了什么 {#o-que-a-fase-12-fez-com-isto}

三项**可操作性** P1 发现——#1、#10 和 #13——在 Fase 12 中关闭，它们在一次执行中消亡的证明见 [Fase 12 的验证](./validacao-fase-12.md)。

第四项 P1，#17，后来由 [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md) 关闭，连同 ADR 0045 留下记录的 D5。

其余的仍然开放，列在上面，没有一项被顺手修正：在处理它的阶段之外修正一项发现，正是任务所禁止的（原则 3）。
