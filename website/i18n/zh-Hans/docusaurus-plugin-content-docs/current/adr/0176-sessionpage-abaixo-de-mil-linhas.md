---
traducao_de: 6b761ce09ad165373334e6fd24e9f8f1b2d21f9c
---

# ADR 0176 — `SessionPage.tsx` 降到 1 000 行以下，分十个机械式 PR，之后才加锁

## 状态 {#status}

**已接受。** 2026-09-28（AT-138，`BRB-015`）。维护者的决定（2026-09-27）：**是，并且之后再加锁**——通过机械式 PR 把 `apps/web/src/routes/SessionPage.tsx` 分解到 1 000 行以下，然后才把上限变成 CI 锁。

引用（不编辑）[ADR 0122](0122-sessionpage-dividido-em-cinco-prs.md)（那五个机械式 PR 把文件从 3 807 行降到 2 661 行，并决定抽取出的同级文件直接导入 `SessionPage.module.css`）、[ADR 0124](0124-hook-do-canal-de-turno-do-sessionpage.md)（`useTurnoDoAgente` 中的轮次通道簇，本计划**不**触碰）以及 [ADR 0125](0125-projectsettingstab-dividido-por-secao.md)（同一把"导入者无需任何改动"的尺子，用在 `ProjectSettingsTab.tsx` 上）。

## 背景 {#contexto}

`SessionPage.tsx` 的债务条目于 2026-08-30 由 ADR 0122 和 0124 关闭，当时是 **2 479** 行。它是按一个**数字**关闭的，而此后没有任何东西去度量这个数字：2026-09-13 文件有 2 559 行（`architecture.md` 开始声明这一点，AT-031），而在今天的 `origin/dev`（`018b8cd24c`，用 `wc -l` 测得）上是 **2 637 行、122 379 字节**。没有人做错任何事——每一次新增都是正当的功能（适配过滤器、Infra 的 handoff 卡片、已关闭会话的拒绝、composer 中的 Infra Lead）——而回退正是因此发生的：没有锁，债务就会以一连串正确决定之和的形式回来。

本计划之前测得的文件情况：

- **一个约 2 400 行的组件。** `SessionPage` 的主体从第 237 行到第 2 637 行。主体之外只有 import、时间线函数的再导出和 `agruparNarracoesDoTurno`。
- **最大的块是一个 762 行的 `useMemo`**，即时间线的组装：每种事件类型一个 JSX 节点，等待晋升的一批故事（RN-126/RN-148），以及审批卡片（RN-155）。
- **返回的 JSX 约 625 行**，分三条独立的区域：顶部栏、滚动的会话流内容，以及底部区域（Infra 卡片、手动 handoff、composer）。
- **handler 约 500 行**，分三类：**轮次**的（`handleSend`、`handleCancel`、`handleReadiness`、`handleArchitectureReadiness`——ADR 0124 那个簇的入口）、故事**晋升**的，以及不属于轮次的 **handoff/执行**的。
- **28 个 `SessionPage.*.test.tsx` 文件**，173 个测试，全部使用**模块级**的 `vi.mock`（`../lib/api-client`、`../lib/hooks`、`../lib/session-channel`……）。模块 mock 对任何导入该模块的文件都生效，所以移到同级文件的代码依然被 mock——正是这一点让不编辑测试就移动代码成为可能。

## 决策 {#decisão}

**十个 PR，按顺序堆叠**（每个建立在前一个之上，`--base` 为前一个的分支），每一个都是**机械式**的：移动代码而不改变行为——不重构逻辑，不重命名组件的公开 API，不"顺手改进"。验收尺子与 ADR 0122 一字不差：**现有的 28 个测试文件不经编辑地通过**。需要编辑其中任何一个的 PR 就不是机械式的，要停下。

`SessionPage.tsx` 从 **2 637** 行降到 **834** 行（−1 803）：

| PR | 移出的内容 | 去向 | 之后的 `SessionPage.tsx` |
|---|---|---|---|
| — | ADR 0176（本文档） | `docs/adr/` | 2 637 |
| 1 | `agruparNarracoesDoTurno`、`FIO_RECENTES_ABERTAS`、`useMemo` `timelineAgrupada`（按 agent 折叠，RN-138）和 `fio`（按来源切分，RN-177）的主体 | `routes/session-fio.tsx` (`agruparTimelinePorAgente`, `dividirFio`) | 2 445 (−192) |
| 2 | `useMemo` `timeline` 的主体（762 行） | `routes/session-timeline-montagem.tsx` (`montarTimeline`) | 1 718 (−727) |
| 3 | 顶部栏 | `routes/SessionTopbar.tsx` | 1 561 (−157) |
| 4 | 会话流内容（邀请、历史、最近、乐观更新、流式气泡） | `routes/SessionFio.tsx` | 1 390 (−171) |
| 5 | 底部区域（Infra 卡片、手动 handoff、composer） | `routes/SessionComposer.tsx` | 1 225 (−165) |
| 6 | `activeFor`、`offeredHandoff`、`handoffDaInfraOferecido` 以及三个"已声明" | `lib/session-handoffs.ts` (`derivarHandoffsDaSessao`) | 1 163 (−62) |
| 7 | 四个 ref、四个滚动 effect，以及 `rolarParaOFim` | `lib/session-rolagem.ts` (`useRolagemDoFio`) | 1 094 (−69) |
| 8 | 故事晋升的五个状态和三个 handler，以及退回模态框 | `lib/session-promocao.ts` (`usePromocaoDeHistorias`) + `routes/DevolverHistoriaModal.tsx` | 982 (−112) |
| 9 | 不属于轮次的 handoff/执行的四个状态和五个 handler（RN-406、RN-440、RN-161、RN-137、RN-153） | `lib/session-acoes-de-handoff.ts` (`useAcoesDeHandoff`) | 834 (−148) |
| 10 | **锁** | `routes/SessionPage.teto.test.ts` | 834 |

**顺序从风险最低到最高**，与 ADR 0122 一样：先是纯函数或近乎纯的（PR 1–2），然后是无状态的 JSX（PR 3–5），然后是纯派生（PR 6），最后是 **hook**（PR 7–9），只有它们会改动组件中 hook 的顺序。

**"机械式"在每一种切分中的含义**，在这里一次性决定，免得在十次审查中反复争论：

1. **`useMemo` 的主体变成在同一个 `useMemo` **内部**调用的函数，依赖列表**相同、逐字节一致**——包括它没有列出的那些。时间线组装闭包捕获了从未出现在依赖中的 handler（`handlePromoteStory`、`handleAcceptHandoff`……）、`t` 和 `semRepositorio`；补全列表会改变时间线**何时**重建，而那就是行为。`oxlint` 继续警告（`exhaustive-deps` 是 `warn`）它之前就警告的内容。
2. **JSX 块变成组件，其 props 与该块从 `SessionPage` 作用域读取的名字**相同**。** 组件调用自己的 `useTranslation('sessionPage')`。有多个兄弟节点的块变成 fragment。模态框的 `{recusandoStory && …}` 一并移入组件内部。
3. **纯派生变成纯函数**，返回相同的名字，像原来一样在每次渲染时计算。
4. **状态 + handler 变成 hook**，在 effect 原来所在的**同一**位置调用（PR 7），或者在 handler 依赖 `useTurnoDoAgente` 时紧随其后调用（PR 8–9）。`useState` 在 hook 顺序中的位置会改变，但这不可观察：React 只要求一次渲染与下一次渲染之间顺序相同。handler 仍是每次渲染都重新创建的函数，与组件中原来的 `async function` 一样。
5. **不含 JSX 的放进 `lib/*.ts`；含 JSX 的留在 `routes/*.tsx`**，并直接导入 `SessionPage.module.css`——这是 ADR 0122 对 CSS 问题的回答，直接复用、不再重开。`lib/` 依然没有 `.tsx` 代码文件。
6. **注释随代码一起移动**，包括那些说"这里"或"就在下面"的——新文件在顶部说明它们来自哪里。顺手改写注释，就是本计划所禁止的"顺手改进"。
7. **`SessionPage.tsx` 再导出测试从它导入的内容**：`agruparNarracoesDoTurno` 移到了 `session-fio.tsx` 并继续被再导出，原因与 ADR 0122 的四个时间线函数相同。

**锁在最后一个 PR 中诞生，而不是之前。** 它是 web 的一个测试（`SessionPage.teto.test.ts`），当 `SessionPage.tsx` 达到 **1 000 行或以上**时判定失败，计数方式与 `wc -l` 相同，并在两个边界上证明自己的计数（999 通过，1 000 失败）——还通过变异测试度量过，给真实文件加 166 行。它放在 web 中而不是 `scripts/ci/` 中，因为它在每个触及该文件的 PR 本来就会运行的套件中运行。

### 有意不在范围内 {#fora-de-escopo-de-propósito}

- **轮次 handler**（`handleSend`、`handleCancel`、`handleReadiness`、`handleArchitectureReadiness`、`avisarSessaoEncerrada`）和会话生命周期的 handler（`handleActivate`、`handleClose`、`handleRename`、`handleStartIdeation`）留在 `SessionPage` 中。轮次的那些是 ADR 0124 移到 `useTurnoDoAgente` 并让其从**这里**被调用的那个簇的入口；把它们移走就是重新决定轮次放在哪里，那不是机械的。不动它们也达到了上限。
- **`useTurnoDoAgente`、`useSessionReadiness`、`ContextAside`、`StructuredQuestionCard`、`StorySlide`**——已经抽取过，不变。
- **没有任何依赖列表被"修正"**，没有 handler 变成 `useCallback`，没有 prop 或函数的名字改变。其中每一项都会是行为或 API 的改变，而每一项如果值得做，都是一个不自称机械式的独立 PR。

## 后果 {#consequências}

- **文件从 2 637 行降到 834 行**，离锁还有 166 行的余量。余量是有意的：上限不能成为下一个功能撞上的东西。需要超过 999 的人去切出一块——上面列出了候选——而绝不提高数字。提高上限需要一个新的 ADR 并引用本 ADR。
- **总行数是增加的**：十个新文件共 2 574 行，而移出的是 1 803 行，因为每个文件都有了自己的 import、一个 props 或上下文块，以及一个说明来源的文件头。这是显式边界的代价，与 ADR 0125 接受的相同。
- **最大的新文件有 861 行**（`session-timeline-montagem.tsx`，几乎就是原来的整个 `useMemo`）。它在这里**不**加锁：声明的债务是 `SessionPage.tsx` 的，给刚诞生的文件加锁正是 AT-031 指出的错误。如果它增长，下一个自然的切分是按事件族每族一个文件。
- **`docs/business-rules.md` 和 `docs/business-rules/autenticacao.md` 中指向 `SessionPage.tsx` 的 `arquivo:linha` 引用移位了**——其中许多在本计划之前就已过时。它们在 PR 10 中统一更新一次，那时行号不再移动；在 PR 1–9 中由 `verificarRefsComSimbolo`（`warn`）发出警告。
- **`BRB-015` 在 PR 10 中不再复现**，`architecture.md` 中声明该回退的那一行随之关闭，并指向锁。
- **堆叠的 PR 按顺序合并。** 在两个 PR 之间触及 `SessionPage.tsx` 的功能 PR 要在切分之上 rebase——这是 ADR 0122 为了不冻结文件早已接受的代价。

## 被放弃的替代方案 {#alternativas-descartadas}

- **先加锁再分解**，上限设在今天的数字，每个 PR 往下降。被维护者拒绝：跟随下降的上限是一个在计划中每个 PR 都要编辑的数字，而高于文件的固定上限什么都挡不住。锁只有作为"又变大了"的**否决**才有价值，而那只有在到达之后才存在。
- **只用一个 PR。** 与 ADR 0122 同理被拒：一个 diff 里移动 1 800 行是无法审查的，而文件还在不断接收功能。
- **把轮次 handler 一起带走**以走得更远。被拒绝：那是 ADR 0124 决定的簇，而上限并不需要它。
- **在 PR 2 中就按事件类型每类一个文件。** 本计划拒绝了：把 `useMemo` 拆成按事件的函数，需要决定每个函数的签名（晋升批次和循环的 `continue` 跨越多种类型），那就不再是移动了。先整体移动主体，才能让那次切分（如果到来）被单独审查。
