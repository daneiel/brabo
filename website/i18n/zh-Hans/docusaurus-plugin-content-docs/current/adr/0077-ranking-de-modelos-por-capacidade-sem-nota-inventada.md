---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0077 — 按能力的模型排名，不编造评分

- **状态：** 已接受
- **日期：** 2026-08-15
- **背景：** PROGRAMA 28，Onda 2，frente H2——设计 handoff，Configurações 第 5 项（“Melhores modelos por capacidade”）和第 6 项（“Modelos por agente”，带“ideal”徽章的下拉框）
- **扩展：** [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)（能力只在被证明时才声明）、[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)（策展始终是手动的）、[ADR 0051](0051-facetas-de-capability-e-curadoria-por-uso.md)（`uses` 作为 workspace 的策展，而不是能力——[RN-057](../business-rules/custo.md#rn-057)）

## 背景 {#contexto}

handoff（`design_handoff_brabo/README.md`，第 7 节）要求了设置界面原先没有的两样东西：

1. 一张**排名**表——“Melhores modelos por capacidade”——列为能力、推荐、替代、**评分**和“被谁使用”。原型的示例显示的数字如“código → claude-sonnet-4 / qwen2.5-coder:14b
   (9.4)”。
2. `ModelPicker` 下拉框中的绿色 **ideal** 徽章，“quando o modelo cobre TODAS as capacidades exigidas pelo agente”。

两者都要求产品所没有的同一类数据，而编码之前的调查通过**两条**独立的路径确认了这一点。

### 评分是虚构的 {#o-score-é-fictício}

“9.4”、“9.1”、“8.7”……是**原型**中的数字，与任何 provider 的目录或产品计算的任何指标都不对应。没有 provider 发布“代码质量”，产品也不测量命中率、满意度或任何类似的代理指标。把原型的数字搬到生产中，就是把编造的数据当作测得的展示——这正是 [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) 对**模型**能力所禁止的那种“穿着数据外衣的猜测”，现在是关于质量。

### “agent 所需的能力”在领域中不存在 {#capacidades-exigidas-pelo-agente-não-existe-no-domínio}

在代码（web 和 api）中的搜索没有找到**任何**把 `AgentKey` 与一组所需能力绑定的结构。不仅如此：`ModelsSection`（`ProjectSettingsTab.tsx`）本身在这条战线之前就已经作出了决定——设计中的列是“Agente · capacidades”，代码把它改名为只有“Agente”，注释写着“as capacidades exigidas por agente não existem no domínio, e prometer uma coluna que não tem conteúdo é pior que não prometer”。现在编造一张 `AgentKey → UsoDeModelo[]` 的表，即使像 `agents.ts` 中的 `color`/`icon`/`initials` 那样手工“声明”，也会在不撤销那个决定的情况下与之矛盾——而这正是 CLAUDE.md 留给用户明确决定、并需要 ADR 的那种产品分类。

还有第二道结构性屏障，即使第一道不存在也能结束这个问题：用于把模型绑定到 agent 的 `ModelPicker` 读取 `GET /projects/:projectId/models`（角色 `viewer`），它返回**纯** `Model`。策展（`uses`，ADR 0051）只存在于 `ModelComCuradoria` 中，由 `GET /workspaces/:workspaceId/models/catalog` 提供——它要求 `maintainer`。在这个选择器中绘制一个依赖 `uses` 的徽章，需要要么（a）把 agent 选择器的访问级别提高到 `maintainer`（没人要求的 RBAC 倒退），要么（b）开一条新路由，在更低的级别泄露 `uses`——两者都是访问边界的改变，本身就是产品决定。

## 决策 {#decisão}

**不构建“ideal”徽章。** 它被记录在 `apps/web/src/components/ModelPicker.tsx` 中 handoff 要求它的位置，附上上述两个理由。这不是回归：徽章从未存在过。它是声明的待办，就像 FASE 26 在 26b 之前为 blame/PR 留下的那些。

**构建“Melhores modelos por capacidade”区块，用两个**真实**信号，不用任何评分：**

| handoff 的列 | 界面现在显示的 | 来源 |
| --- | --- | --- |
| 评分 | *（移除）* | 没有数据——见上文 |
| 推荐 / 替代 | 在策展（`uses`）为该能力标记的模型中，排在前两位的 | `workspace_models.uses`（ADR 0051），绝不是计算出来的 |
| 被谁使用 | **本**项目中当前绑定解析到该模型的 agent 数量 | 与 `ModelsSection` 已经读取的相同的级联（按 agent 的 `getAgentModelBinding`） |

候选之间的平局按**成本**打破（`inputPricePerMillionMicros` 升序）——真实的，来自目录，绝不是质量的代理。优先**顺序**是真实使用在先（项目中已有多少 agent 解析到该模型），成本其次：“团队已经选择了什么”是不编造评分时可用的最诚实的信号。没有任何已策展模型的能力显示“sem cobertura curada”——这一行绝不消失，与 `ModelsSection` 中的 `fallbackDe`/来源列同样的模式。

该区块（`MelhoresModelosPorCapacidadeSection`，`apps/web/src/routes/ProjectSettingsTab.tsx`）读取 `GET /workspaces/:workspaceId/models/catalog`——与 `ModelCatalogSection` 同一条路由，因此继承**相同**的可见性（`maintainer`）：它不是带自己访问规则的新界面，而是用另一种方式回答同一个问题（“这个 workspace 是如何策展目录的？”）。

## 后果 {#consequências}

- 不是 workspace `maintainer` 的人看不到这个区块——与已经存在的 `CatalogoDeModelos` 一样。不是新规则。
- 当团队更换模型（真实使用）或 owner 手动重新定价（`manualPricing`）时，“推荐”会改变——绝不会自行改变：没有任何作业在重新计算，它是在读取时派生的。
- 如果有一天产品获得真正的质量指标（例如按模型的 proposed_action 成功率），它作为**新列**进入，不替换“被谁使用”/成本——两个问题（“团队用什么”和“什么效果最好”）是不同的，与 [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) 不把不同问题合并为一个指标的论点相同。
- “ideal”徽章只有在用户决定“agent 所需的能力”值得作为数据存在时，才会留在 `docs/explanation/backlog.md` 的等价物中——那是产品决定，而不是这条战线自动恢复的东西。
