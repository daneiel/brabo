---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0049 — 按 workspace 的模型策展

## 背景 {#contexto}

[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) 把这个问题写得一清二楚，却没有解决它：

> **Catálogo por workspace.** Hoje a curadoria é global e o `:workspaceId` da
> rota é só âncora de RBAC — um owner do workspace A ativando um modelo o ativa
> para o B.

这不是理论。`models.is_active` 是**整个安装共用的一列**。策展的路由本来就是 `/workspaces/:workspaceId/models/*`——但 `:workspaceId` 从未进入查询；它只是让 `RolesGuard` 有地方取得有效角色。在某个界面上点击“激活”的人，就是在为安装中的所有 workspace 做决定，而界面没有给出任何迹象。

三个后果，按严重程度排序：

1. **一个 workspace 为邻居打开一个昂贵的模型。** 另一个 workspace 的选择器开始提供它，而花费出现在什么都没决定的人的预算中。
2. **关闭同样会传染。** 一个 owner 把自己不信任的模型从选择器中拿掉，也就把它从依赖它的人那里拿掉了。
3. **无从得知是谁做的决定。** `is_active` 是一个没有作者、也没有自己日期的布尔值。

## 决策 {#decisão}

**目录仍然是全局的；策展改为按 workspace。**

这种分离是对“这个数据属于谁？”这一问题的回答：

| 数据 | 所有者 | 位置 |
| --- | --- | --- |
| 名称、价格、窗口、能力 | **provider** | `models`（全局） |
| `availability` | **provider**，由同步观察 | `models`（全局） |
| `is_active`——是否出现在选择器中？ | **workspace** | `workspace_models` |

`workspace_models` 以 `(workspace_id, model_id)` 为主键，另有 `is_active` 和 `curated_by`。

### 为什么**不**按 workspace 复制 `models` {#por-que-não-duplicar-models-por-workspace}

显而易见的替代方案——每个 workspace 一行 `models`——被否决：

- 它会产生**关于同一个模型的 N 个事实**。`gpt-4o` 的价格对所有人都一样；把它保存在 N 行中保证它们会分歧。
- 它会把 `token_usage.model_id` 和 `model_bindings.model_id` 一分为二：成本历史指向 `models` 的一行，复制它就需要重写过去——这正是 [RN-044](../business-rules/custo.md#rn-044) 禁止的。
- 目录同步会开始写 N 次今天只写一次的东西。

### 没有行**就是**关闭 {#ausência-de-linha-é-o-desligado}

不存在与“关闭”分开的第三种“从未决定”状态。同步发现的模型在 `workspace_models` 中干脆**没有行**，读取会把它当作未激活。

这保留了 [RN-043](../business-rules/custo.md#rn-043)（“modelo descoberto entra desligado”），**而 `models` 中没有任何可供同步践踏的列**——同步的 upsert 中不再有任何策展字段。规则从“同步写入 `false`”变成了“同步够不到这个决定”，这更强。

不过，关闭是 `UPDATE` 而不是 `DELETE`：删除该行会连同是谁、何时做的决定一起删除。读取把两种情况都视为未激活；记录是为审计的人而存在的。

### 选择器的路由挂在**项目**上 {#a-rota-do-seletor-pende-do-projeto}

`GET /models` 变成了 `GET /projects/:projectId/models`，而不是 `/workspaces/:workspaceId/models`。消费这个列表的三个界面（概览、设置和会话）都在一个项目内，**没有一个手头有 workspace**；`RolesGuard` 从 `:projectId` 解析角色同样好用。workspace 在用例内从项目中得出——在一个地方翻译，而不是散布在 UI 中。

### `isActive` 离开了实体 `Model` {#isactive-saiu-da-entidade-model}

`Model` 不再有 `isActive`；需要它的人使用 `ModelComCuradoria`，这个类型**只在手头有 workspace 时才存在**。线上格式也一样：`ModelResponseDto`（选择器）和 `ModelComCuradoriaResponseDto`（策展）。

没有 workspace 的版本无法编译是有意的：正是策展的全局读取的存在产生了缺陷，而类型比一条要求小心的注释更可靠。

## 后果 {#consequências}

- **在 `DROP` 之前迁移数据。** `0034` 做 `workspaces × models WHERE is_active` 的笛卡尔积，然后才删除该列：每个现有的 workspace 恰好得到它之前看到的东西。这些行中的 `curated_by` 为空——决定来自一个从未记录所有者的全局策展，空值比把它归到 workspace 创建者身上更诚实。
- **HTTP 契约破坏。** `GET /models` 不再存在。它是唯一被移动的路由，作为不兼容变更记录在 CHANGELOG 中。
- **种子开始做策展。** 没有显式的激活调用，模型会存在于目录中而选择器为空——而同一个种子中紧接着的 workspace 绑定会以“modelo desativado”被拒绝。
- **`agent` 和 `session` 范围不检查策展。** 两者都没有 workspace 锚点：agent 的绑定按全局 SLUG（路由的 `:projectId` 今天被明确忽略）。`assertModelIsBindable` 在这些情况下接收 `null`，只检查可用性。这个缺口由来已久，它被**显式**化，而不是用一个猜出来的 workspace 去填补。

## 留待以后的事项 {#o-que-fica-para-depois}

- **按项目的 agent 绑定。** 只要 `agent` 范围是全局 slug，策展就够不到它。解决这一点是改变绑定的语义，而不是策展的语义——值得一个独立的决定。
- **策展的继承。** 新的 workspace 诞生时没有任何已打开的模型，今天需要有人逐个打开它们。安装默认值，或者从第一个 workspace 复制，可以解决——但这是产品政策，不是这一决定的技术后果。
- **与策展绑定的按 workspace 预算。** 打开一个昂贵的模型仍然是一个没有自己上限的决定；真正的上限仍然是项目、会话和任务。
