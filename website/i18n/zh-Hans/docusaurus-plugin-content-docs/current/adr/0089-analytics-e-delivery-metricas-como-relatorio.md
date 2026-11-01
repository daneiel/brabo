---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0089 — `analytics` 和 `delivery-metricas` 成为报表脚本

- **状态：** 已接受
- **日期：** 2026-08-16
- **背景：** 产品负责人决定提前实现目标模型（`docs/fluxo.yml`）中的两个角色，而不等待自然触发
- **姊妹文档：** [ADR 0085](0085-fluxo-como-registro-declarativo.md)
  （`docs/fluxo.yml`）；**形式**上的直接先例：
  `apps/api/scripts/medir-execucao.ts`（第 13b 阶段）

## 背景 {#contexto}

`docs/fluxo.yml` 早已把目标模型的两个角色描述为
`status: proposto`，每个都已写好变为 `active` 所缺的分离标准：

- `analytics`（Analytics Engineer，**产品**指标）——“被 `medicao` 吸收（它只覆盖**执行**指标）”，标准为“`metricas-de-produto` 成为 PO 必需输入的那一天”；
- `delivery-metricas`（Delivery Manager，流程——DORA）——“被 `medicao`（部分）吸收”，标准为“永远不会成为 agent；成为 `medicao` 的**报表**（从 event log + `gates.yml` 提取的 lead time、deployment frequency、MTTR、change failure rate）”。

两个触发都没有自然发生。产品负责人仍然决定提前构建：会话 → commit → PR → merge 的漏斗以及一片真实的 DORA（lead time、deployment frequency）已经可以从产品早已记录的数据中提取——dev agent 产生的三种 git 动作的 `proposed_actions.execution_result`
（`apps/api/src/domain/git/git-action-execution-result.ts`）以及 `backmerge` gate 的 `docs/gates.yml`。等待自然触发会推迟一个早已可行的报表。

## 决策 {#decisão}

两个角色在 `docs/fluxo.yml` 中变为 `status: active`，实现它们的是**一个**脚本——`apps/api/scripts/analise-funil.ts`
（`pnpm --filter api analise:funil -- --projeto <uuid> [--json]`）——与 `apps/api/scripts/medir-execucao.ts` **相同**的格式：
`NestFactory.createApplicationContext(AppModule)`、必需参数 `--projeto <uuid>`、经由 Drizzle 的纯读取、对数据库零写入、默认输出 Markdown、`--json` 供程序化使用。

这不是一个新的产品功能：这是 `docs/fluxo.yml` 本身早已为这两个角色规定的形式，只是在预期触发之前构建。没有 GenServer，没有 LLM agent，没有新的 HTTP 路由。

### 脚本**真正**测量的 {#o-que-o-script-mede-de-verdade}

- **真实漏斗**（`calcularFunil`）：有多少会话产生了至少一个 `executed` 的 `git_commit`、一个 `pr_open` 和一个 `git_merge`，以及相邻阶段之间的转化率。计数的是**会话**，不是动作。
- **真实 lead time**（`calcularLeadTimes`）：从同一会话第一个 `executed` 的 `git_commit` 到第一个 `executed` 的 `git_merge`，使用 `updated_at`——即 `ExecuteGitActionUseCase` 真正写入 `execution_result` 的时刻，而不是动作被提出的时刻。
- **真实 deployment frequency**（`deploymentFrequencyPorDia`）：`targetBranch` 位于 `PROTECTED_BRANCHES` 中的 `executed` `git_merge`，按天分组。通过**引用**与 `backmerge` gate（`docs/gates.yml`）交叉——它的证据是 CI（`.release/gate.json`），超出只读数据库的脚本的范围，因此没有任何数据连接，只是同一个分支切分。

### 脚本**声明**缺失的，以及为什么这不是“缺少的数据” {#o-que-o-script-declara-ausente-e-por-quê-isso-não-é-dado-que-falta}

三个指标位于输出的“Não medido, de propósito”一节中，只要以下前提不变，保持这种状态的决定就是永久的——不是下一轮要填补的缺口：

1. **完整的产品漏斗（构思 → commit）。** `sessions` 没有 `storyId`——[RN-230](../business-rules/autenticacao.md#rn-230) 已在 Criativo 标签页（`apps/web/src/routes/ProjectSessionsTab.tsx`）中声明了这一缺口。关闭它需要新 schema（新列，可能是 `sessions` 中的迁移或一张关联表），按原则不在本战线范围内：**本轮没有迁移**。
2. **按功能的采用证据。** 与第一项不同，这不是缺少**收集**的数据：这是产品今天**没有任何路径**可以拥有的能力。Brabo 不对它所**构建**的项目做埋点——没有从生成代码流出的使用遥测流水线，也没有关于它将如何存在的产品决定。在这里声明“缺失”遵循与 ADR 0042 对模型评分以及 ADR 0077（RN-210）对“理想”排名相同的原则：绝不以一个看起来真实的数字来近似。
3. **MTTR 和 change failure rate。** 两者都需要真实生产事件的信号，这与 `docs/fluxo.yml` 已为 `secops-runtime`/`platform` 角色（`status: proposto`/
   `planned`，启用与 `DEPLOY_ENABLED` 同步）记录的依赖相同。这是另一条战线的工作，不是本战线的。

## 后果 {#consequências}

- `docs/fluxo.yml`：`analytics` 和 `delivery-metricas` 从
  `status: proposto` 变为 `status: active`，`saidas_alvo` 被改写为 `saidas`（今天真实的东西），外加一个显式的 `lacunas` 字段（仍为 `status: lacuna` 的东西，不删除声明）。
- `apps/api/package.json`：新条目 `"analise:funil"`。
- 没有迁移，没有新的 HTTP 路由，没有新界面。
- `docs/business-rules.md` 中的 RN-320..322 覆盖脚本的形式（RN-320）、漏斗和 lead time 的语义（RN-321），以及 deployment frequency 加上三项声明的缺失（RN-322）。

## 考虑过的备选方案 {#alternativas-consideradas}

**等待每个角色的自然触发。** 这是 `docs/fluxo.yml` 的默认计划，并且对其他 `proposto` 角色仍是团队模型的默认行为。在这里被拒绝只是因为产品负责人明确决定提前——这不是在没有同等决定的情况下提前其他 `proposto` 角色的先例。

**一个读取数据库并叙述漏斗的 LLM `analytics` agent。** 被拒绝，依据的正是 `docs/fluxo.yml` 已为 `delivery-metricas` 声明（“永远不会成为 agent”）、本决定扩展到 `analytics` 的分离标准：报表是确定性的——求和、分组、按状态过滤——不需要模型来解读。这里的 agent 将是没有信息收益的 LLM 成本。

**用代理指标近似这三个缺失的指标**（例如把 `chat.message` 计为“使用”的代理，或把到下一个 commit 的时间当作 MTTR 的代理）。被拒绝：一个看起来像真实指标却不是它的代理，正是 ADR 0042 早已为模型评分点名的错误——带有书面原因的“—”胜过一个教错的数字。

## 参考 {#referências}

- `docs/fluxo.yml`（块 `id: analytics`、`id: delivery-metricas`）
- `apps/api/scripts/analise-funil.ts` / `apps/api/scripts/medir-execucao.ts`
  （形式先例，第 13b 阶段）
- `apps/api/src/domain/git/git-action-execution-result.ts`
- `docs/gates.yml`（gate `backmerge`）
- [RN-230](../business-rules/autenticacao.md#rn-230)——构思 → commit 的缺口，已在 Criativo 标签页中声明
- [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)——绝不伪造不存在的数据的原则
- [ADR 0077](0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md)——同样的拒绝应用于“理想模型”
