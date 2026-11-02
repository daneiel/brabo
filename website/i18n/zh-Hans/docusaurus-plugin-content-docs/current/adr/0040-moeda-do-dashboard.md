---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0040 — 仪表盘的货币：暂用 USD，按 workspace 的手动汇率推迟

## 背景 {#contexto}

项目仪表盘对已批准原型（`design/SCREENS.md`、`design/COMPONENTS.md`）的还原，要求摘要行和卡片上紧凑的 `TokenMeter` 显示花费和余额——而 `compact` 的 `TokenMeter` 到目前为止根本没有这个（该变体只有进度条/百分比，没有任何费用页脚）。

基础原型在所有出现费用的地方都显示 `"R$ X · US$ Y"` 这一对——这是 `default`/`live` 的 `TokenMeter` 的模式，目前用于 `ProjectPage.tsx`（项目页头）和 `SessionPage.tsx`（聊天顶栏）。但系统中没有任何汇率来源：`costBRL` 在仪表盘一侧总是以 `0` 到达（`Dashboard.tsx` 中的 `ProjectCardContainer` 从未为它计算过真实值），领域中也没有任何地方有按 workspace 的货币偏好或可配置的汇率。出现的 “R$” 实际上永远是零——一个幽灵数据。

## 决策 {#decisão}

1. **仪表盘的摘要行和 `compact` 的 `TokenMeter` 新页脚只显示 USD。** 这是原始货币：`apps/api/src/domain/llm/` 中的模型价格（种子的 `MODEL_SEEDS`、表 `models`）本来就是微美元——不涉及任何换算，只是格式化（`apps/web/src/lib/currency.ts`，`usdFmt`）。
2. **分歧仅限于这个界面。** `default` 的 `TokenMeter`（项目页头）和 `live` 的（会话顶栏）继续完全按现在的样子显示 `"R$ X · US$ Y"`——没有被改动。货币的变化属于仪表盘卡片和摘要行的范围，不是整个组件的。
3. **按 workspace 的货币偏好及可编辑的手动汇率，予以记录并推迟。** 本次交付不实现。将来实现时，自然的设计是 `workspaces` 中的一个字段（或独立的表），带 `currency` + `manualExchangeRate`，在后端或客户端的格式化时解析——但在没有第二个用例推动设计之前就承诺这种形态，只是猜测。

## 后果 {#consequências}

- 仪表盘卡片上出现的幽灵 `"R$ 0,00"` 消失——剩下的值（USD）是系统今天真正知道如何计算的唯一值。
- 想看 R$ 费用的人在项目页头和聊天中（`default`/`live`）仍然能看到，只是在列表卡片和摘要中看不到。
- 按 workspace 的手动汇率是真实的工作，本 ADR 并未了结：当有人需要它时，起点是这份文档，而不是从零开始的新决定。
