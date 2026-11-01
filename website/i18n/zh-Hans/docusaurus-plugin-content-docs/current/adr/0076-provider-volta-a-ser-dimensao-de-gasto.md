---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0076 — `provider` 重新成为花费维度，约束改由类型承担

- **状态：** 已接受
- **日期：** 2026-08-14
- **修订：** [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md)（同一笔花费的两种受众），它刻意把 `provider` 排除在维度之外
- **先前背景：** [RN-058](../business-rules/custo.md#rn-058)（agent 花费的密钥是 owner 的）、[RN-060](../business-rules/custo.md#rn-060)（密钥的花费属于 owner，只有他能看）以及
  [RN-101](../business-rules/custo.md#rn-101)（两种受众）

## 背景 {#contexto}

[ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) 以一句毫无折中的话把 `provider` 排除在 `sumGroupedBy` 的维度之外：*"a ausência é
estrutural, não um esquecimento: quebrar gasto por provider é quebrar por
CREDENCIAL, e é assim que a visão do membro fica impedida de ganhar esse eixo
por descuido — não há argumento a passar"*。类型在注释中带有同样的提醒：*"Os cinco recortes do relatório de gasto. Nenhum deles é
provider."*

产品负责人决定**重新开放这个维度**，并清楚其后果。本 ADR 的存在不是为了说 0063 错了——它的论据依然正确，而正因如此，重新开放必须附带写明的约束。

2026-08-09 的决定没有区分、而使用中需要的东西：

- **owner 无法在滑动窗口中看到钱从哪里流出。**
  `credential-spend` 按 provider 回答，但以**日历月**计，并绑定到今天存在的凭据。要问“这 30 天里 OpenRouter 花了多少、Anthropic 花了多少”，需要阅读两个窗口不同的报表并手工相加；
- **人和 agent 出现在同一个排名中。** `porAtor` 列表混合了两者，只靠一个字段区分，而设计 handoff 要求两个区块。

## 决策 {#decisão}

**`provider` 重新成为 `SpendDimension`，owner 的报表获得
`porProvider`**（[RN-186](../business-rules/custo.md#rn-186)）。这个维度住在一条本就要求 `owner` 的路由上——与 RN-060 同一把尺子——成员没有获得任何字段。`credential-spend` 保持**不动**：它按月回答账单，并与今天存在的密钥关联（`temCredencial`），而新维度回答的是窗口**内**按 provider 的花费，与模型、项目和参与者并列。两者互不是对方的切片，依据的正是 0063 用来区分两种受众的同一标准。

**隐私约束改变的是形式而不是强度：现在承担约束的是**类型**（[RN-187](../business-rules/custo.md#rn-187)）。`sumGroupedBy` 有两个重载，区分它们的是作用域：

```ts
abstract sumGroupedBy(d: SpendDimensionDoAtor, e: SpendScopeDeAtor): Promise<SpendBucket[]>;
abstract sumGroupedBy(d: SpendDimension,       e: SpendScopeAmplo): Promise<SpendBucket[]>;

export type SpendDimensionDoAtor = Exclude<SpendDimension, 'provider'>;
```

携带 `actor` 的作用域——成员的视图，也是它唯一的作用域——只接受 `SpendDimensionDoAtor`。`sumGroupedBy('provider', escopoComAtor)`
**无法编译**。两个作用域按构造互斥（`SpendScopeAmplo` 声明 `actor?: undefined`），因此无需任何人指明，正确的重载就会被选中。

**没有任何针对这一组合的 `if`**，无论在仓储还是用例中，这种缺席是刻意的：运行时检查会给人一种保证是动态的印象，而支撑它的其实是编译器——而 `if` 正是下一次重构会在不让任何测试变红的情况下删掉的东西。这与 RN-153/154 的推理相同，“自动模式”的解析住在仓储中，`decide.ts` 没有增加一行：按构造的保证胜过按监督的保证。

**用 `Exclude` 而不是第二份手写列表。** 新维度诞生时对两种受众都可达，把它从成员的范围中移除成为**在那个位置上**的显式行为——绝不是另一个文件中的遗忘。备选方案（两份独立列表）有一个已知的失败模式：受限列表会默默过时。

**人和 agent 变成两个区块，是推导出来的而不是查询出来的**
（[RN-188](../business-rules/custo.md#rn-188)）。`porOwner` 和 `porAgente` 是 `porAtor` 按 `actor_kind` 的划分，在用例中完成；`porAtor` 对已经使用它的人保持完整。0063 测得这些查询的成本随 `token_usage` 的大小而不是随请求的大小增长——为了把内存中已经分开的东西分开而再扫描窗口两次，代价高昂且理由错误。

**`token_usage(created_at)` 上的索引现在加入**（迁移 `0044`）。0063 已经测量并记录：52.5 万行时，*seq scan* 为 55 ms 和 38 ms，带索引为 32 ms 和 19 ms。只差一个迁移名额。

**`model` 维度不变。** 两个 provider 服务同一个模型名时继续落在同一行。现在旁边有了按 provider 的列表；交叉两个维度会让排名的行数倍增，却回答不了两份分开的列表回答不了的问题。

## 后果 {#consequências}

**0063 最强硬的那句话不再成立，诚实地说出是哪一句。** “没有可传入的参数”是 API 表面的保证：没有任何签名接受 `provider` 这个词。今天有一个签名接受它，而保证取决于成员一侧的调用者是否以 `SpendScopeDeAtor` 类型化。它是——`GetMySpendUseCase` 正是出于这个原因显式声明类型而不是推断——但差别是真实的：我们从“不可能表达”变成了“不可能编译”。后者比前者弱，这是产品负责人的决定所接受的代价。

**支撑这一代价的是两道独立屏障。** 成员的路由**没有维度参数**（`projectId` 和 `dias`，别无其他），因此 `?dimensao=provider` 在 handler 存在之前就被 Nest 丢弃。第一道屏障本已足够；第二道的存在是为了让第一道在下一次改动之后依然足够。两者都有测试，类型的那个是 `@ts-expect-error`——如果屏障倒下，`tsc` 会因**未使用**的指令而拒绝这一行，而不是让测试变成什么都没测。

**谁能看到凭据没有变化。** 两条讲 provider 的路由上是 `owner`；不讲 provider 的成员路由上是 `viewer`。`docs/security-surface.md` 中的分类相同——没有路由诞生，没有路由改变角色——这正是新维度不会放松暴露面的原因。

**“Por owner”是 handoff 的标签，而这个区块是**人**的。** `porOwner` 带来所有 `actor_kind = 'user'` 的行，不仅是 workspace 所有者的；这个标签之所以站得住，是因为按 RN-058，他们花的都是 owner 的密钥。谁是所有者仍由字段 `ownerId` 决定。如果某天有了按人的凭据，这个区块需要新名字——整个 RN-101 也是如此，正如 0063 已经预见的。

**既不是人也不是 agent 的 `actor_kind` 不在两个区块中。** 今天只有 `system`，它继续出现在 `porAtor` 和总数中。开出第三个区块会说产品有一种它并没有的受众；把它从总数中隐藏则是在花费上撒谎。

**排除在外，已声明：** **界面**。这一改动只涉及后端——`porProvider`、`porOwner` 和 `porAgente` 通过 `apps/web/src/lib` 的类型到达客户端，目前还没有组件绘制它们。沿袭自 0063、仍在范围之外的：货币和汇率、按区域的花费以及任何导出。
