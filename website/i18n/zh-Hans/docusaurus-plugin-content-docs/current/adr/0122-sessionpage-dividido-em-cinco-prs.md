---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0122 — `SessionPage.tsx` 拆分为五个机械式 PR，并事先声明

- **状态：** 已接受
- **日期：** 2026-08-29
- **参考（不编辑）：** [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md)
  （推理方式与本 ADR 相同——一个共享文件增长到"只是绕过去"已经比划一条边界更昂贵的地步——但执行方式不同：0121 是一个零 diff 的提交，本 ADR 是依次进行的五个 PR，因为该文件正处于活跃的功能开发中，一个单独的 PR 要么冻结代码，要么与其他所有改动赛跑）。

## 背景 {#contexto}

`apps/web/src/routes/SessionPage.tsx` 有 3 807 行、169 KiB——`docs/explanation/backlog.md` 的技术债务审查里已经有一行写它：

> Decompose `SessionPage.tsx` / `ProjectSettingsTab.tsx` | G | `SessionPage.tsx`
> is 169 KiB with 25 test files importing it; `ProjectSettingsTab.tsx` is
> 90 KiB | already informally called a "disputed file" in
> historico-de-fases.md, but never promoted to a tracked debt item; per the
> standing rule this is its own phase, never a drive-by refactor

三项具体成本让这不只是对体积的抱怨：

1. **25 个测试文件依赖它**（`SessionPage.*.test.tsx` 加上 `SessionPage.ponto.test.ts`）——任何结构性改动都有大范围波及的风险，而文件的体积让人难以事先知道某个改动可能触及这 25 个中的哪些。
2. **该文件处于活跃修改中，不是遗留代码。** 有 50 个提交触及过它；最近的 15 个几乎全是 `feat` 新增（结构化问题、handoff、轮次活动条、RN-172 的轮次/结局排序……），其中没有一个是抽取——这是该文件历史上第一次尝试划出内部边界。这排除了一次性重写：为一个大 PR 冻结文件，会阻塞所有落在它上面的其他功能，或者迫使人们反复进行痛苦的 rebase。
3. **测试套件已经划出了部分边界。** 在本 PR 之前，`SessionPage.ordenacao-e-avisos.test.tsx` 从 `./SessionPage` **按名字直接**导入 `aberturasDeTurno`、`turnoDoSeq`、`afundarDesfechos`、`ordemDaAcaoNaTimeline` 和 `agruparNarracoesDoTurno`（`await import('./SessionPage')`，解构），`SessionPage.ponto.test.ts` 对 `pontoDaSessao` 也是如此——不是渲染组件，而是作为普通函数调用。测试已经认定这五个（加上 `agruparNarracoesDoTurno`）是独立单元；本 ADR 把这条既有边界提升为真正的模块边界，而不是发明一条新的。

鉴于活跃修改与波及范围，`CLAUDE.md` 的长期规则适用——"不是顺手重构"——所以这是一个独立阶段，规划为一系列可独立合并、行为中立的 PR，每一个都由同样的 25 个测试文件**不经编辑**通过来证明。

## 决策 {#decisão}

五个 PR，逐个执行、逐个合并（绝不并行——每个都在下一个开始前进入 `dev`），顺序如下：

1. **时间线/轮次的纯辅助函数 → `apps/web/src/lib/session-timeline.ts`**（本 PR）。`aberturasDeTurno`、`turnoDoSeq`、`afundarDesfechos`、`pontoDaSessao`、`ordemDaAcaoNaTimeline` 以及它们共享的类型 `TimelineEntry`。这五个已确认是纯的——没有 JSX，没有引用 `styles`/CSS module，没有对组件状态的闭包——这使它成为风险最低、最适合打头的一片：一次机械的 `.ts` 改动，与 React 的渲染周期无需任何调和。`agruparNarracoesDoTurno` 有意留在 `SessionPage.tsx`，尽管它位于同一区域、测试方式也相同：它返回 JSX（`<Disclosure>`），并从 `SessionPage.module.css` 读取三个 `styles.narracoes*` 类名。移动它意味着决定 `lib/` 接受它的第一个 `.tsx` 文件——如今它只有 `.ts` 源文件（有一些 `.tsx` **测试**，但 `.tsx` **源**文件为零）——而这个先例属于真正处理 JSX 子组件的 PR（PR 2），而不属于一个本应只是移动纯函数的 PR。

2. **`StorySlide` → `apps/web/src/routes/StorySlide.tsx`。** 第一个被移动的 JSX 子组件，也是最简单的：一个单独的叶子组件（晋升轮播的幻灯片，RN-148），没有同样需要移动的子组件。正是这个 PR 决定 `SessionPage.module.css` 的共享问题，见下文。

3. **`StructuredQuestionCard` + `permiteOutra` → `apps/web/src/routes/StructuredQuestionCard.tsx`。** 另一个自包含的 JSX 子组件（RN-162/RN-171 的结构化问题表单），加上它私下依赖的唯一纯辅助函数——一起移动，因为把一个组件与只有它调用的唯一辅助函数分开，只会多一个文件，对任何读者都无益。

4. **backlog 树的辅助函数 + `ItemDeBacklog` + `ContextAside` → `apps/web/src/lib/session-backlog-tree.ts` + `apps/web/src/routes/ContextAside.tsx`。** 最大的一片：组装树的纯辅助函数（它们的自然归宿是 `lib/`，与 PR 1 同理）与渲染它们的 JSX（`ItemDeBacklog`、`ContextAside`——自然归宿是 `routes/`，与 PR 2–3 同理）放在一起。它排在更简单的单组件移动之后，正因为它是两个文件、两种类型的抽取，并且受益于 PR 2–3 已经回答过一次 CSS 共享的问题。

5. **就绪标志 → `apps/web/src/lib/session-readiness.ts`，一个 `useSessionReadiness` hook。** 最后一个，也是这组中唯一**不是**文件移动的 PR：就绪标志（Arquiteto/PO 按钮上 RN-160/RN-161 的关口）是由位于 `SessionPage.tsx` 的状态和 props 内联计算的，所以抽取它们意味着编写一个具有明确输入/输出契约的新 hook，而不是挪动一个现有的独立函数或组件。它排在最后，因为它是五个中风险最高的——hook 边界可能改变某个东西*何时*被重新计算，即使公式不变——而到 PR 5 时，其他四个已经把文件缩小到足以单独审查这一风险。

### `SessionPage.module.css` 的共享问题，一次性回答 {#a-questão-do-compartilhamento-de-sessionpagemodulecss-respondida-uma-vez}

`SessionPage.module.css` 如今恰好只有一个导入者——`SessionPage.tsx` 本身（已核实：在 `apps/web/src` 中、测试文件之外 `grep` 该说明符，只返回一个结果）。这意味着 PR 2–4 可以让新抽取出的同级文件（`StorySlide.tsx`、`StructuredQuestionCard.tsx`、`ContextAside.tsx`）直接导入 `../routes/SessionPage.module.css`，与 `SessionPage.tsx` 今天的做法一样——不拆分 CSS，不新建共享样式表，也不存在两份副本分叉的风险，因为从来就没有第二份。这是一个值得在这里写一次的决定，而不必在三次独立的 PR 审查中反复讨论。

### 明确不在整个五 PR 工作范围之内 {#explicitamente-fora-do-escopo-de-todo-o-esforço-de-cinco-prs}

有两样东西本 ADR 和这五个 PR 都不触碰：

- **轮次通道的状态分组**：`turnoViaCanal`、`statusAgent`、`pensandoVisivel`、`atividadeDoTurno`。这四个状态被四个不同的轮次入口 handler（`handleSend`、`handleReadiness`、`handleArchitectureReadiness`、`handleAcceptHandoff`）读**和**写，并被 `finalizarTurnoDoAgente` 以闭包捕获，代码中的注释称其为"o ÚNICO lugar que finaliza um turno"——这四个 handler 每一个都会打开 `turnoViaCanal`，而只有 `finalizarTurnoDoAgente` 会关闭它。它不是一棵连续的 JSX 子树，也不是一组纯函数；它是交织在一起的控制流，移动它是关于轮次生命周期状态应放在哪里的设计决策，而不是机械搬迁。当这项工作被界定时，它会有自己的、之后的、编号独立的 ADR。
- **`apps/web/src/routes/ProjectSettingsTab.tsx`**（约 90 KiB，backlog 同一行中提到的另一个文件）。它更小，已经有自己的第一步在进行（文件内的具名函数，尚未抽取到模块），并且是一个独立的范围决策——本 ADR 只覆盖 `SessionPage.tsx`。

## 后果 {#consequências}

- **五个 PR 合入后，两个人可以在 `SessionPage.tsx` 的不同角落工作，重叠更少**——与 ADR 0121 为 schema 拆分描述的收益相同，只是规模更小（抽取五个单元，而不是十六个文件）。
- **这一组中每个 PR 的验收标准都相同：可观察行为零变化**，由同样的 25 个 `SessionPage.*.test.tsx` 文件在每个 PR 之后**不经编辑**通过来证明。这一组中如果某个 PR 需要编辑这 25 个文件之一才能通过，它实际上就不是机械的，应当停下来，而不是去"修"测试。
- **轮次通道分组和 `ProjectSettingsTab.tsx` 仍与之前一样有争议。** 本 ADR 不降低它们的风险，也不声称降低——在这里点名它们，才让切分保持为声明的，而不是被悄悄收窄。将来触及轮次通道分组的 PR 需要一个自己的、新编号的 ADR 并引用本 ADR；它不修补本 ADR，依据已接受的 ADR 永不编辑这一长期规则。
- **`lib/` 得到它的第一批带有类似 `TimelineEntry` 形式的 JSX 邻近类型的文件**（PR 1 的 `TimelineEntry` 有一个 `ReactNode` 字段），**却没有得到它的第一个 `.tsx` 源文件**——正是 `agruparNarracoesDoTurno` 留在 `SessionPage.tsx` 中，才在 PR 1 中保住了这一性质。PR 2 才是有意地、一次性地、经过自己的审查用掉这个先例的那一个。
- **`SessionPage.tsx` 分五个可见的步骤缩小**（3 807 → 每个 PR 更小），而不是一个大 diff——更容易审查，但也意味着该文件在四个 PR 的时间里处于部分分解的状态，这在此被接受为不冻结活跃功能工作的代价。

## 被放弃的替代方案 {#alternativas-descartadas}

- **一个大 PR 一次性移动所有内容。** 被拒绝：该文件处于活跃修改中（50 个提交，最后 15 个大多是功能新增），所以单个 PR 要么冻结 `SessionPage.tsx` 上的所有其他工作直到合并，要么积累合并冲突的速度快过它能被审查的速度。拆成五个可独立合并的 PR，让正常的功能工作可以在它们之间继续。
- **在 PR 1 中把 `agruparNarracoesDoTurno` 与其他五个一起移动**，因为它位于源码的同一区域（第 281–345 行）且测试方式相同。被拒绝：它返回 JSX 并读取 `styles.narracoes*`，所以移动它会悄悄决定 `lib/` 接受 `.tsx` 源文件——一个值得单独审查的真实先例，而不是一个被描述为"纯函数移动"的 PR 的副作用。
- **把轮次通道分组的抽取作为同一计划的一部分**，因为它是文件中另一大块状态。直接被拒绝：它是四个 handler 之间耦合的控制流，不是测试套件已经划出的边界，而且代码中的注释已经把它点名为唯一需要保持同步的地方——这正是本 ADR"机械的、可证明行为中立"的验收标准无法诚实声称覆盖的那类改动。
