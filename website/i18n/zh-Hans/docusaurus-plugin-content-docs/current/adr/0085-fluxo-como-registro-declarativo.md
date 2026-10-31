---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0085 — 角色流作为声明式登记（fluxo.yml）

## 状态 {#status}
已提议

## 背景 {#contexto}
产品关于 agent 团队的三类事实散落在三个地方：目录（`agent-areas.ts`，单一来源，FASE 18）、控制（`docs/gates.yml`，ADR 0054），以及**关系**——谁把什么交给谁——而关系只隐式存在于 prompt、用例和 ADR 历史中。隐式的关系既不可审计，也不可度量。2026 年 8 月设计的团队模型（市场职业 → agent 的映射）产出了这第三块，却没有安放之处；而与产品对照的审计正是因为缺了它，在四个点上出现了分歧。

## 决策 {#decisão}
版本化的 `docs/fluxo.yml`，按层分隔，按角色给出契约：使命、带类型的输入/输出（构件 + 来源/去向 + 途径）、引用 gates.yml 的出口 gate、状态（`active|planned|proposto|em-refinamento`）以及声明的吸收关系。规则：
- `proposto` 角色要**声明**今天由谁吸收它，以及拆分的客观标准——目标组织图变成激活顺序，而不是愿景。
- 引用 gates.yml 中不存在的 gate 的角色在测试中失败；没有所属角色的活动 gate 也失败。
- `em-refinamento` 角色保持代码不动，并退出正式流程；暂停所造成的待办项在文件本身中声明。
- 状态为 `lacuna` 的关系是可追踪的待办，绝不是承诺。

## 考虑过的替代方案 {#alternativas-consideradas}
- 保持隐式：否决——正是缺了这一块，审计才与产品产生分歧。
- 与 gates.yml 合并：否决——控制和关系因不同原因而变化（ADR 0054 声明的是闸门；本 ADR 声明的是契约）。
- 只登记活动角色：否决——没有带标准的 `proposto`，每项新能力都要从零重新发现模型。

## 后果 {#consequências}
- Staff/Platform 以及提议中的 gate（necessidade-validada、adr-aprovado、implementavel、prototipo-validado）的激活，变成数据变更 + 各自的 ADR。
- 处于细化中的 Psicólogo/Anamnese 带着可见的待办项（RN-086 上限提案的作者；Staff 的触发条件）。
- modelo-de-time.md 中的触发条件表是未来批次的路线图：每个触发条件触发相应角色的拆分。

## 参考 {#referências}
ADR 0038、0053、0054；RN-083/086/087；FASE 15/18。
