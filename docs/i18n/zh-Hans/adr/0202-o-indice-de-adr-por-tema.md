---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0202 — 按主题组织的 ADR 索引，主题放在 ADR 之外

## 状态 {#status}

**Accepted.** 2026-10-01（AT-137，故事 HS-014，史诗 EP-011，发现
`BRB-026`，第 36 轮；负责人 10月1日的决定：*"sim, reorganizar por tema,
com o tema FORA do ADR"*——在索引旁放一个 ADR → 主题的映射文件，由 `docs:check` 核对，不编辑任何已接受的 ADR）。**分类法**——15 个主题的列表以及 191 份 ADR 各自的主题——是本 lane 的**提议**，负责人在 PR 中审阅：更换某份 ADR 的主题或合并两个主题是对 `docs/adr/temas.yml` 的修改，而不是对本文的修改。

## Context {#context}

`docs/adr/index.md` 原本按**阶段**分组。当阶段是项目推进的方式时这有帮助；当阶段结束、工作开始从看板中诞生时，它就不再有帮助了：2026-10-01 测量，索引的 191 行中有 **148** 行位于同一个标题之下，`## Phase 12 — Post-dogfooding
operability`，从 0044 到 0197——原本作为“其余部分”的那一节变成了索引本身。想找“关于 broker 决定了什么”或“为什么机器密钥是这样的”的人，除了读那 148 行之外无从下手。

AT-027 完成了 `BRB-026` 中计数的那一半（索引写着 134，实际写了 156），并书面分出了这一半，附上卡住它的问题：主题会是每份 ADR frontmatter 中的 `tema:` 元数据——而给已接受的 ADR 添加 frontmatter 就是编辑它，这是索引约定毫无例外地禁止的。负责人的决定从另一侧解决了这个问题：主题放在 ADR **之外**。

已经存在并继续保留的：`verificarIndiceAdr`（`scripts/docs/generate.mjs`）会拒绝索引中没有链接的 ADR，`verificarContagensEmProsa` 核对索引 `description` 中的计数和 "the next one is **NNNN**"。两者对分组一无所知。

## Decision {#decision}

**1. 主题住在 `docs/adr/temas.yml` 中，就在索引旁边。** 两个键：
`temas:`——**封闭**列表，有序，每项有 `id`（kebab-case，即锚点
`{#tema-<id>}` 和映射的值）、`titulo`（索引中该节的标题，与索引一样用英语）和 `descricao`——以及 `adrs:`，映射 `"NNNN": <id>`。
每份 ADR 有**一个**主题，即主要主题：当两个都适用时，取人们最先会去找的那个。没有任何已接受的 ADR 被触碰。

**2. 索引是**核对**的，不是生成的。** 索引的每一行都是关于该 ADR 的一句精选语句，没有任何脚本写入它（`verificarIndiceAdr` 早已记录的理由）。生成索引需要把 191 句话移到 YAML 中——用一长串 YAML 字符串换掉可读的 Markdown，只为得到核对已经保证的排序。索引开始为每个主题设一节
`## <titulo> {#tema-<id>}`，按列表顺序，附上 `descricao` 的一行描述以及一贯的表格，按编号排序。

**3. `scripts/docs/temas-de-adr.mjs` 进行核对，`docs:check` 会拒绝**
（`verificarTemasDeAdr`，`verificarIndiceAdr` 的兄弟，紧随其后调用）：`docs/adr/` 中没有主题的 ADR；映射中不在列表里的主题；映射中针对不存在 ADR 的条目；列表中没有任何 ADR 的主题；列表中 id 或标题重复；在索引中，主题节缺失、重复、标题与列表不同、不按列表顺序或主题不存在；以及 ADR 行位于另一主题的节下、不在任何主题节中、重复或不按编号顺序。无法读取的 YAML、空的列表或映射、或没有任何主题节的索引是 `CEGO` 并被拒绝。每条规则都在 `scripts/docs/temas-de-adr.spec.ts` 中通过变异证明，与其他核对器一样。

**4. 提议的分类法有 15 个主题。** 它来自产品的**战线**——与组织 `CLAUDE.md` 和 `agent-areas.ts` 目录的相同——而不是来自阶段或代码目录：

| id | 主题 | ADR 数 |
|---|---|---|
| `git` | Git, repository and branch policy | 11 |
| `agentes` | Agent harness, turns and sessions | 11 |
| `time` | The agent team — roles, areas and handoffs | 26 |
| `gates` | Gates, QA and security review | 12 |
| `execucao` | Execution, terminal policy and approvals | 13 |
| `modos` | Where the code lives — execution modes | 9 |
| `container` | Project container and broker | 15 |
| `runner` | The local runner | 11 |
| `iam` | Auth, access and secrets | 13 |
| `llm` | LLM providers, models and spend | 16 |
| `conhecimento` | RAG, knowledge graph and artifacts | 11 |
| `web` | Web UI and design system | 12 |
| `operacao` | Operation, deploy and installation | 15 |
| `engenharia` | CI, release and supply chain | 10 |
| `docs` | Documentation | 7 |

为什么是**这份**列表，以及那些不显而易见的边界：

- **`agentes` × `time`。** `agentes` 是 agent **如何**运行（上下文、工具循环、轮次、会话、消息队列、回复语言）；`time` 是**哪些** agent 存在以及它们把什么交给谁（角色、区域、委派、handoff、Psicólogo 和 Anamnese）。合在一起会有 37 份 ADR——一个较小的“Phase 12”。对话型 Infra Lead（0175）归入 `agentes`，因为它决定了自己的轮次；Dev Lead（0053）归入 `time`，因为它决定了角色。
- **`modos` × `container` × `runner`。** 自 0104 以来在每份 ADR 中相互触碰的三条战线，因此按**问题**分开：文件夹住在哪里（`modos`）、谁启动容器以及带何种约束（`container`）、用户机器上的 CLI（`runner`）。runner 启动容器（0137）属于 `container`；runner 宿主机上带凭据的 `git`（0193）属于 `runner`。
- **`execucao` × `gates`。** `execucao` 是约束**行动**中的 agent 的策略（`proposed_action`、路径范围、自动模式、绝对上限）；`gates` 是对已完成之事的裁定。
- **`operacao` 合并部署和安装。** 两者都回答“产品如何在不是开发者的机器上运行”，并共享备份和安装用 compose；分开的话，安装将只有 7 份 ADR，并成为第 16 个主题。
- **`engenharia` 承载属于**仓库**而非产品的东西：** 流水线、发布的镜像、签名、Trivy、按 digest 固定、测试层级以及按聚合拆分 schema（0121）——api 唯一的结构性重构，在任何其他主题下都不会有人去找。`SessionPage.tsx`/`ProjectSettingsTab.tsx` 的拆分留在 `web`，改动这些文件的人会去那里找。
- **语言不是主题**（只有 0177 对它做出决定，它在 `agentes` 中）；**安全不是主题**——它贯穿 `iam`（CSP、CORS、信封加密）、`execucao`（上限）、`container`（broker 的约束）和 `engenharia`（供应链），一个“安全”主题会掏空四个来填满一个。

十到十五是被要求的区间：少于十会合并 `modos`/`container`/
`runner` 或 `agentes`/`time`，而这正是按阶段的索引失败的地方；多于十五会让主题变成目录。

**5. 谁决定新 ADR 的主题：** 写它的人，在同一个 PR 中——`adrs:` 中一行，以及索引中主题节里的一行，按编号排序。审阅 PR 的人确认。**新**主题是对 `temas.yml` 中列表的修改，在创建它的 PR 中说明理由；超过 15 个需要一份修订本 ADR 的 ADR。

## Consequences {#consequences}

- 索引不再有按阶段的节，每个阶段的开头语句也随之移除。按阶段的叙述继续保留在它一直完整存在的地方，`docs/explanation/historico-de-fases.md`；ADR 0020/0021 关于验收标准仍开放的提醒随它们一起移到 `gates`。
- 新 ADR 多花一行（`temas.yml`），忘记它会让 `docs:check` **失败**——与 `verificarIndiceAdr` 相同的代价和相同的理由。
- 主题是一种**分类**，许多 ADR 同时适用于两个主题。索引只在主要主题中显示每份一次；按另一个主题查找的人在那里找不到它。这是“每份 ADR 一个主题”的代价，备选方案（次要主题）经过考虑但没有采纳：它会复制精选的那一行，或者让它留在两个分别老化的地方。
- 并行的 ADR：映射覆盖 2026-10-01 时 `origin/dev` 上已存在的 ADR（从 0001 到 0197，外加本份）。集成在另一分支上诞生的 ADR 的人要加上它的那一行——`docs:check` 会指出缺了哪一行。
- 索引的 pt-BR 翻译（`website/i18n/pt-BR/.../adr/index.md`）仍按**阶段**组织，并且已经落后（191 行中的 103 行）；这里不对它重新组织。docmap 的 `traducao-pt-br` 规则一如既往地以 `warn` 提醒。

## 本 ADR 不做的 {#o-que-este-adr-não-faz}

- 不编辑任何 ADR，即使是为了修正标题。
- 不生成索引：语句继续手工精选。
- 不创建 RN：这是文档规则，就像 runbook 流程的规则一样。
