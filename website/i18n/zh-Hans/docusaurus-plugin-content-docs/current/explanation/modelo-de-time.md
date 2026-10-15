---
traducao_de: 929963d24eb727bd64875486f2f1889172f3084a
---

# 团队模型与交付物流程 {#team-model-and-deliverable-flow}

> 团队模型设计会话（2026 年 8 月）的综合背景，已对照产品的真实状态进行审计。正式规格在 [`docs/fluxo.yml`](../../../../../../docs/fluxo.yml) 中；本文档解释其中的决定。结构性决定：ADR 0085。姊妹部件：`docs/gates.yml`（ADR 0054）和 `agent-areas.ts`（目录，FASE 18）。

## 起源 {#origin}

该模型把一个高绩效交付团队的职业映射（Arquiteto、Tech Lead、PO/PM、Staff、SRE/Platform、DevOps/Infra、QA/SDET、AppSec、Data/Analytics Engineer、UX、Delivery、DBA）转化为 Brabo 的 agent，依据两条标准：

1. 只有当存在不同的交付物**并且**不同的 gate 时，才设立单独的角色。按组织结构图拆分只会产生没有收益的 handoff。
2. 角色之间的每次转换都是一个声明的 gate，通过脚本验证——绝不靠人工标注（Fase 10/13 的教训）。

从拆分中浮现的原则：**几乎所有的分离首先是**交付物**和**时机**上的，然后才（也许）是 agent 上的**——QA 和 AppSec 在保持一个 agent 的同时获得了设计时机；analytics 在成为角色之前，先作为 medicao 的一个新输出诞生。角色只在其构件已经在流转时才成形，绝不提前——除非产品所有者决定**提前**构建，而不等待自然的触发条件，就像对 `analytics`/`delivery-metricas` 所做的那样（ADR 0089）：两者都以报告**脚本**（`analise:funil`）的形式变为 `status: active`，绝不是 agent——这正是分离标准早已规定的形式。

## 产品所有者的决定 {#product-owners-decisions}

- **Engineering Manager：移除。** agent 之间没有人员管理。
- **Criativo 是入口**——把自由对话转化为业务需求。它吸收了 UX 的 discovery。
- **Psicólogo 和 Anamnese：em-refinamento。** 代码处于活动状态，在交付物重新定义之前不在正式流程中。由此产生的待办：提高 `max_parallel` 的提议（RN-086）没有了作者，Staff 的激活触发条件成为孤儿。
- **Delivery 被吸收**到 Harness（编排）+ 测量中（**部分** DORA 以报告形式交付——真实漏斗、真实前置时间、真实部署频率；MTTR 和变更失败率仍为 `status: lacuna`，依赖真实的事故信号——ADR 0089）；**DBA 被吸收**到 Dev Lead（迁移）和 Platform（调优）中。

## 流程不变量 {#flow-invariants}

1. 没有任何构件没有声明的接收方。
2. 没有任何角色在输入不完整时开始——缺失会导致带原因的退回，绝不是静默的假设。
3. 每次转换都是声明式登记中的 gate（ADR 0054）。
4. 返回循环是强制的：遥测 → Arquiteto 和产品指标 → PO 都是有接收方的构件。
5. Arquiteto × Dev Lead 的边界：能放进一个可回滚 PR 的决定属于 Dev Lead；不可逆的决定属于 Arquiteto。

## 激活触发条件表 {#activation-trigger-table}

| 产品中的触发条件 | 它激活/分离的角色 |
|---|---|
| 创建了 gate `implementavel` | `qa-estrategia` + `appsec`（现有 agent 的第二个时机） |
| 按产品所有者的决定提前（ADR 0089/0091） | `analytics`/`delivery-metricas` 以及 `secops-runtime` 关于 `rate_limit_hits` 的报告，在自然触发之前就以脚本形式变为 `active` |
| **完整的**产品指标成为 PO 的输入 | `analytics` 的其余部分（ADR 0089 没有完成的） |
| `DEPLOY_ENABLED` 翻转 | `platform` 激活 → 然后是 `secops-runtime` 的其余部分（自动检测、事故响应、事后复盘） |
| Anamnese 结束细化 | `staff` 的触发条件重新有了所有者 |
| 有自己 UI 的受管项目 | `ux-designer` 从 Criativo 中分离 |
| 真实的数据量 | `dbre` 从 Dev Lead/Platform 中分离 |
| —（永不） | `delivery-metricas` 成为报告，而不是 agent（ADR 0089，已交付） |

## 网格状态（已审计） {#mesh-state-audited}

**下行几乎完整；缺的是上行。** 缺口：

| 缺口 | 位置 | 参考 |
|---|---|---|
| `deployavel`/`operavel` | Infra/Platform | planned，DEPLOY_ENABLED |

“产品指标 → PO”的循环已经闭合：`listar_metricas_de_produto`（RN-407）让 PO 能够在回合内读取与 `analise:funil`（ADR 0089）相同的报告——这曾是本表的最后一行（fluxo.yml × 代码审计的 B4 项）。

## 待决定的提案 {#proposals-pending-decision}

- [ ] 在 Anamnese 处于细化期间，由谁继承 Staff 的触发条件和上限提案——或者两者都等待，予以声明。
