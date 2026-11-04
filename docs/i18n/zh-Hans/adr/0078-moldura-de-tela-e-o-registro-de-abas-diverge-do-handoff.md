---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0078 — 界面框架，以及标签页注册表刻意偏离 handoff

- **状态：** 已接受
- **日期：** 2026-08-15
- **先前背景：** [RN-048](../business-rules/custo.md#rn-048)
  （待晋升的故事）、[RN-104](../business-rules.md#rn-104)（Chat 和 Criativo 作为位置，键为 `sessions`）、[RN-121](../business-rules.md#rn-121)
  （Executores 标签页，dev agent 和 QA 不在混合的“Time de agentes”中）、
  [ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md)（`LLMProvider` 合约中的 embedding——没有消费的基础）

## 背景 {#contexto}

设计 handoff 中的“界面框架”检查清单（`design_handoff_brabo/CHECKLIST-CONFRONTO.md`，第 2 节）描述了包裹每个项目界面的那条带：60px 的 header、紧随其下的标签栏、带有 `box-shadow: inset 0 -2px 0
var(--accent)` 的活动标签页、窄屏下的水平滚动，以及最大宽度 960–1040px 的内容容器。`ProjectPage.tsx` 的代码有全部四个缺陷：header 使用可变 padding 而不是固定高度，活动标签页使用 `border-bottom`（而不是 `box-shadow`），没有声明水平滚动，内容容器也没有宽度上限。

修正这四点是本 ADR 的主体，但需要决策——而不仅仅是 CSS——的是另一件事：**handoff 列出了 7 个标签页**（Visão geral、Criativo、Código、Chat RAG、Gastos、Aprovações、Configurações），而**注册表
（`apps/web/src/routes/project-tabs.ts`）有 10 个**。多出的三个是 `executores`、`backlog` 和 `insights`。

handoff 来自 PROGRAMA 16–26 更早的一批。从设计它的那一批到今天，发生了三件它无法预见的事：

1. **Executores** 诞生于 FASE 27（RN-121），当时 agent 网格从 Visão geral 移到了一个专属标签页——真实数据（实时状态、绑定的模型、自主权开关），而不是样机。
2. **Backlog** 自第 12c 阶段起就有自己的计数器，统计等待用户晋升的故事（RN-048）——另一个决策队列，有业务规则和测试覆盖它何时以及为何提醒。
3. **Insights** 显示等待接受/驳回的 Psicólogo 假设——项目的第三个决策队列，在 handoff 写成之前就已存在。

这三个都不与 handoff 的 7 个重复，也都不是装饰：它们都有真实数据、由查询派生的计数器，以及至少一条带测试的专属 RN。为了与 handoff“对上”而删掉它们，会摧毁产品早已知道如何展示的信息。

## 决策 {#decisão}

**10 个标签页保留。handoff 是**视觉**忠实度的参照——颜色、字体、间距、框架的样式——而不是产品可以有多少个标签页的上限**（RN-203）。它规定每个界面应该**看起来**如何；不会把功能清单冻结在它被写下的那一天。这条规则早已隐含生效（FASE 26 登记 Código 标签页时，handoff 并没有预见“Executores”或“Insights”作为单独的标签页，也没有人因此考虑移除它们）——本 ADR 只是让它变得明确，并配有测试，在有人不读本决策就按 handoff“整理”注册表时让其失败。

**键 `sessions` 继续标为“Chat”，绝不是“Chat RAG”**（RN-202）。handoff 在最新的界面中把这个标签页称为“Chat RAG”
（`designs/Brabo Chat.dc.html`），显而易见的诱惑就是只换掉标签字符串。拒绝是字面的：“Chat RAG”描述的是一种**功能**——基于已索引仓库的 embedding 查询，并带来源引用——而产品没有这种功能。ADR 0075 把 `embed` 放进了 `LLMProvider` 合约（capability 只在 Ollama 上被证明），但目前还没有任何东西**消费**这个操作：没有索引流水线，没有按项目的向量索引，没有引用 UI。今天的 `sessions` 标签页是普通的**咨询型** Chat（RN-104）——一个以会话上下文回答的 agent，与 Criativo 一样，只是不产出 backlog。今天把它标为“Chat RAG”，就是 ADR 0042 对目录模型所拒绝的同一种谎言：只因为名字已在设计中预留，就在能力存在之前宣布它。

**框架的四项字面修正，没有声明任何例外：**

1. **header 作为下限，而不是上限。** `.headerTop`（项目的身份 header——provider 图标、名称、仓库标签、分支/已采纳——以及紧凑的 `TokenMeter`）获得了 `min-height: var(--header-h)`（60px），而不是 `height`。这条带的内容比 handoff 在 6 个内部界面中绘制的通用 header（18/600 标题 + mono 副标题 + 标签 + 指示器）更丰富：`TokenMeter` 卡片单独加上自身的内部 padding，就已约 70px。强制 60px 会切掉预算提醒——而 RN-088 早已确立，失败/状态绝不变得不可见；为美观切掉预算，是换了个名字的同一类错误。`min-height` 把这个 token 当作**下限**——当内容更简单时（例如加载中没有 `TokenMeter`），这条带接近 60px；不简单时，它会增长，并且可见。
2. **活动标签页使用 `box-shadow: inset 0 -2px 0 var(--accent)`**，而不是 `Tabs.module.css` 中的 `border-bottom`。两者的视觉差异很小，但 `border-bottom` 会在状态切换时让布局移动 2px（实现不当时，即使透明对实色，边框也会占据空间），而 handoff 对该属性有明确要求。原先作为 `ProjectPage.module.css` 中后代 CSS 覆盖存在的间距值（`gap: 2px`、`padding: 11px 13px`）——自 FASE 16 起就声明的待办（“quando ela puder mudar, o lugar disto é lá”）——迁移到了原语中，因为这一波给了两个文件同一个所有者。
3. **水平滚动**（`.list` 中的 `overflow-x: auto`，`.tab` 中的 `flex-shrink: 0` 和
   `white-space: nowrap`）——之前不存在；在窄屏上标签栏会换行或挤压标签。
4. **内容容器的最大宽度**——`.body` 获得了
   `max-width: 1040px; margin: 0 auto`，用于文档形式的标签页（Backlog、Aprovações、Insights、Gastos、Configurações、Criativo、Chat）。在 `semRespiro` 标签页（Visão geral、Código）中仍然没有上限：前者有自己的侧轨，后者用 handoff 自己的话说是“a aba mais custosa do
   programa”——两者都刻意使用整个屏幕。

**标签“Code”改为“Código”。** 代码中没有其他地方按标签**字符串**做比较（已用 grep 确认）；注册和深层链接的**键**仍然是 `code`，未被触碰。

## 后果 {#consequências}

**标签页注册表刻意保持比 handoff 原意更大——每多出的一项都有本 ADR 指出的专属 RN 和测试。** 只读 handoff 并与代码比较的人会看到分歧；读了本 ADR 的人会明白那是被选择的，而不是被遗忘的。

**导出的**形态**没有任何改变。** `AbaDoProjeto` 继续拥有相同的字段（`key`、`label`、`component`、`count?`、`ordem`、`semRespiro?`），`ABAS_DO_PROJETO` 继续是有序数组，被其他消费者（导航 shell 的 Frente B，在同一波中并行）读取以在侧边栏中列出项目的标签页——只有 `code` 标签的**值**变了，键的列表既没有减少也没有增加。

**“Chat RAG”被保留，而不是被取消。** 当索引流水线和引用 UI 存在时，本注册表中的 `sessions` 标签页就是这一功能落地之处——名字在那一天改变，背后有数据支撑。提前改名就是 ADR 0042 早已为模型点名的同一类错误：在没有能力的情况下“启用”能力的外观。

**不在范围内，已声明：** Código 标签页丰富的分支下拉菜单、blame UI 和 PR 列表（FASE 26b）不被本 ADR 触碰——框架关乎界面的**轮廓**，而不是每个界面的内部内容。
