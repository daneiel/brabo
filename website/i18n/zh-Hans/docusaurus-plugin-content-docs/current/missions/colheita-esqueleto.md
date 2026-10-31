---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 收获的骨架（10c）

工作材料。**本文件不是报告**——它是报告的模子。

当 10b 运行完毕后，填写标记，撰写散文，并把结果**移动**到 `docs/explanation/primeiro-dogfooding.md`，那是一个发布的页面，因此需要 frontmatter（`id`、`title`、`sidebar_label`、`sidebar_position`、`description`、`keywords`，按 `docs/explanation/documentation-workflow.md` 的规范）以及 `website/sidebars.ts` 中的条目。本文件位于 `docs/missions/`，被排除在构建之外，正是为了让骨架不在什么都没说的时候上线。

**如何填写。** 每个数字都以 `<!-- query: nome -->` 的形式出现。名字对应 `docs/missions/colheita-queries.sql` 中的块。运行：

```bash
pnpm --filter api db:migrate     # obrigatório: as queries de custo usam colunas da Fase 9
docker exec -i brabo-dev-postgres-1 psql -U brabo -d brabo \
  -f - < docs/missions/colheita-queries.sql
```

**比期限更重要的规则：** 没有能产生它的查询，任何数字都不能进入。没能闭合的作为"未测量"进入——绝不作为估计（任务的原则 6）。

---

## 1. 答案 {#1-a-resposta}

> 本阶段存在所要回答的问题：**每个 provider 在金钱和人的注意力上花了多少——Brabo 值得吗？**

在任何表格之前，按这个顺序用三段话回答。一年后读到这里的人想要的是结论，而不是核算过程。

| provider | 会话 | LLM 调用 | 成本（USD） | 耗费的点击 |
|---|---|---|---|---|
| Bitbucket | <!-- query: a-pergunta-da-fase --> | | | |
| Generic | <!-- query: a-pergunta-da-fase --> | | | |

**值得吗？** 不要用孤立的成本来回答。诚实的比较是与同样的工作在 Brabo 之外要花多少相比——而没人会去测量的数字是最右一列：一个人有多少次不得不停下手头的事去做决定。

> ⚠️ 如果 Arquiteto 没有在 `module_map` 中把两个 provider 分到不同的模块，这张表也分不开它们。这是发现——在 §8 中记录，而不是编造分摊。

---

## 2. 按会话汇总 {#2-consolidação-por-sessão}

复制任务中填好的表格（第 4.1 部分），并与数据库对照。

| # | 会话 | task | 点击 | 干预 | 重启 | 成本 | gate | 备注 |
|---|---|---|---|---|---|---|---|---|
| | | | <!-- query: cliques-por-sessao --> | | | <!-- query: custo-por-agente --> | <!-- query: voltas-de-gate --> | |

**笔记与数据库之间的分歧是关于可观测性的发现，不是你的错误。** 当它们分歧时，把两列并排记录，并在 §8 中解释。开始之前就已知的两个分歧来源：

- 点击计数**不在 event log 中**（发现 #17）——来源是 `proposed_actions.decided_at`；
- `restarts do engine` 在系统中没有任何记录。它只是你的笔记。如果你没记，它就丢了。

---

## 3. 人的注意力花在了哪里 {#3-onde-a-atenção-humana-foi-gasta}

<!-- query: cliques-por-tipo -->

| 操作类型 | 点击 | 无需点击通过 | 需要人的比例 |
|---|---|---|---|

值得关注的解读：**哪种操作类型集中了疲劳。** 如果单独一种类型占了大部分点击，那里就是放宽策略的自然候选——而本阶段恰恰测量了*没有*放宽任何东西的代价。

---

## 4. 成本 {#4-custo}

### 按 agent {#por-agente}

<!-- query: custo-por-agente -->

| agent | 调用 | 输入 token | 输出 token | USD | 估计计数 |
|---|---|---|---|---|---|

**估计计数**一列很重要：那是 provider 没有报告 `usage`、数字来自本地分词器的调用（RN-041）。估计很多的成本可信度更低，说出这一点比四舍五入更诚实。

### 按 LLM provider {#por-provider-de-llm}

<!-- query: custo-por-provider-de-llm -->

| 入口 provider | 实际提供方 | 模型 | 调用 | USD |
|---|---|---|---|---|

### 成本可复现吗？ {#o-custo-é-reproduzível}

<!-- query: custo-reproduzivel -->

预期：**`nao_fecha` 类别中没有任何行**。`sem_preco_gravado` 中的行早于 Fase 9 的迁移，不是缺陷。

如果出现 `nao_fecha`，那就与 RN-044 相矛盾，成为关于计量的 P1 发现——比本节的任何数字都重要，因为它让所有其他数字都受到质疑。

---

## 5. gate {#5-gates}

### 修正轮次 {#voltas-de-correção}

<!-- query: voltas-de-gate -->

| task | gate | 轮次 | 已阻塞 | 来源 |
|---|---|---|---|---|

`blocked_origin` 已填写的被阻塞 task 耗尽了 K 周期（上限 3，除非在激活时另行配置）。**来源就是数据**：`infra` 和 `modelo` 关于产品说的是相反的事——前者是环境，后者是 agent 力不从心。

### QA 区域起作用了吗？ {#a-área-de-qa-funcionou}

<!-- query: delegacoes-e-dispensas -->

| 区域 | lead | 子 agent | 状态 | 数量 | 失败的 |
|---|---|---|---|---|---|

要用散文回答的三个问题：

1. 汇总的意见说了**有用**的东西，还是子意见的拼贴？
2. 豁免是否以**可核查**的方式给出了理由？
3. Performance/Segurança 子专业真的运行了吗？如果只有豁免，可能的原因是没有任何 story 的非功能需求包含 QA Lead 识别的关键词之一——那是关于启发式的发现，不是关于 QA 的。

---

## 6. Psicólogo → Anamnese 的回路 {#6-o-loop-psicólogo--anamnese}

**现在成批阅读假设——不要更早。** 如果你在阶段期间读过，在这里说出来：它会污染解读，记录下来是诚实的。

<!-- query: hipoteses-e-decisoes -->

| 目标 agent | 状态 | 数量 | 平均置信度 | 每个假设的证据 |
|---|---|---|---|---|

<!-- query: hipotese-para-patch -->

| 假设 | 决定 | 变成补丁了吗？ | 版本 | 补丁的决定 |
|---|---|---|---|---|

表格需要证明的：

- **被接受却没有变成补丁的假设**（`patch_id` 为空）——回路没有闭合，这是发现；
- **被拒绝后又被重新提出的补丁**——与 RN-026 相矛盾，是大发现；
- 如果你按任务要求（2.3）有意拒绝了至少一个，说明之后发生了什么。

---

## 7. PR 的时间线 {#7-linha-do-tempo-das-prs}

<!-- query: linha-do-tempo-das-prs -->

| 时间 | 谁打开 | 标题 | 分支 | 停在哪里 |
|---|---|---|---|---|

记住 `awaiting_user` **有意**是终态：合并发生在 git provider 中，在产品之外。停在那里的 PR 不是卡住了——而是按设计在等你。

---

## 8. 承诺 × 现实 {#8-promessa--realidade}

最重要的一节，也是唯一不来自查询的一节。诚实的散文。

### 没有按承诺工作的 {#o-que-não-funcionou-como-prometido}

任务的发现 #1–#17 已经列出，**无需重新发现**——引用它们。这一节补充的是只有执行才能揭示的：产品真正卡住的地方、卡了多少次，以及绕过它花了多少。

### agent 做得**比预期更好**的 {#o-que-os-agentes-fizeram-melhor-que-o-esperado}

必填的一节，抵制出于谦虚或偏见而让它空着的冲动：只列失败的报告与只列成功的报告一样没用。有助于找到材料的问题：

- 有没有某个 QA 意见抓到了**你**会放过的东西？
- 有没有某个 agent 不需要提问就解决了 backlog 中的歧义？
- 确定性的 SecOps 发现了真东西，还是只有噪音？
- Psicólogo 的某个假设是否以令你吃惊的方式是**对的**？
- Arquiteto 的 ADR 是否比你用同样时间写出来的更好？

### 改变了看法的 {#o-que-mudou-de-opinião}

如果本阶段让你改变了对之前某个架构决定的看法，这里就是地方。这是文档中最有价值、也最容易被省略的一段。

---

## 9. ADR 的提纲 {#9-roteiro-do-adr}

ADR 在**这里**、在收获时诞生，使用当时下一个可用的编号——不要更早。ADR 是决策记录，而决策来自数据；一个空着创建的 ADR 会烧掉编号，并且注定要被重写，这违反了已接受的 ADR 永不编辑的规则。

建议标题：**"primeiro dogfooding"**。三节，仅此三节（背景、决策、后果），与仓库中每个 ADR 一样。

**背景**——本阶段打算测量什么，实际测量了什么。

**决策**——**结构性**的收获，而不是 bug 列表。本阶段关于产品设计教会了什么值得改变的东西。准备阶段已经提示的候选，要用数据确认或驳斥：

- 每个 agent 一个 task 的瓶颈是设计的局限还是实现的局限？
- 本阶段的核心指标不在 event log 中，是偶然，还是 event log 服务于别的目的的症状？
- 硬编码的区域解决得够好吗，还是 ADR 0038 的表是必需的？

**后果**——排好优先级的 backlog。格式：

| # | 条目 | 优先级 | 理由 |
|---|---|---|---|
| | | P1/P2/P3 | 为什么是这个优先级，附上支撑它的数据 |

**P1** = 阻止产品做到它所承诺的。**P2** = 在注意力或金钱上代价高昂，但有绕行办法。**P3** = 烦扰或清晰度上的债务。

**不内嵌任何修复。** ADR 记录决定要做什么；它不去做。

---

## 10. 技术交付 {#10-entrega-técnica}

状态核实于 **2026-08-01**，在 10b 运行之前。在收获时重新核对。

| 标准 | 状态 | 证据 |
|---|---|---|
| 5 个 provider 的契约套件全绿 | ⛔ **3** — local, github, gitlab | 5 次调用 `runGitProviderContract`，3 个不同的 provider |
| 向导带 Bitbucket 和 Generic | ⛔ 缺失 | `apps/web/src/routes/NewProjectWizard.tsx:34-36` |
| Generic 的降级经过测试 | ⛔ 不存在 | `apps/` 中没有任何 `*generic-git*` 文件 |
| 移除"UI 中没有 Bitbucket"的分歧 | ⛔ 被测试锁住 | `apps/web/src/components/ProjectCard.test.tsx:69` 断言"só github, gitlab ou local — sem Bitbucket"；`design/COMPONENTS.md:222` 要求**带** Bitbucket 的 2x2 网格 |
| docmap / CHANGELOG / docs 全绿 | ✅ | `pnpm docs:check` 和 `pnpm docs:build` 通过 |

关于第四项：这一分歧**不是遗忘**——它被一个断言只存在三个 provider 的测试锁住。实现 Bitbucket 会让这个测试失败，而这就是机制在起作用。在收获时，记录 agent 是自己理解了这一点，还是需要干预。
