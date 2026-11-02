---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0124 — 轮次通道的状态分组抽取到 `useTurnoDoAgente`

- **状态：** 已接受
- **日期：** 2026-08-30
- **参考（不编辑）：** [ADR 0122](0122-sessionpage-dividido-em-cinco-prs.md)
  （本 ADR 就是 0122 的后果一节所点名并推迟的"自己的、之后的、编号独立的 ADR"）；本次抽取所依托的机械式去重 PR（`refactor(web): termina a deduplicação do
  arme de turno no SessionPage.tsx`，在本 ADR 之前合并，没有自己的 ADR——在此作为前置条件引用，与 0122 引用 [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md) 而不编辑它的方式相同）。

## 背景 {#contexto}

ADR 0122 有意把轮次通道的状态分组排除在它对 `SessionPage.tsx` 的五个 PR 的机械分解之外，称其为"交织在一起的控制流，[...] 是关于轮次生命周期状态应放在哪里的设计决策，而不是机械搬迁"，并点名 `turnoViaCanal`、`statusAgent`、`pensandoVisivel`、`atividadeDoTurno` 被"四个不同的轮次入口 handler（`handleSend`、`handleReadiness`、`handleArchitectureReadiness`、`handleAcceptHandoff`）读**和**写"。这就是那项被推迟的工作。

为界定范围而逐行重读文件，发现 ADR 0122 自己的计数少于实际：它点名了四个轮次入口 handler，但这个分组中实际有**七**个写入入口。它点名的三个加上 `handleAcceptHandoff` 是四个；另外三个是通道本身的 effect（`connectSessionHeartbeat` 的 `onAgentDelta`/`onToolCall`/`onAgentDone`/`onAgentStatus`/`onEvent` handler——一个单独的 `useEffect`，但其写入面与任何 handler 一样真实）、`StructuredQuestionCard` 的回调（`onTurnoIniciado`/`onTurnoTerminado`，连接到 `AnswerStructuredQuestionUseCase`）以及 `handleReturnStory`（RN-174，`ReturnStoryUseCase` → `po_server` 中的 `reviseStory`）——ADR 0122 从未提及它，尽管它当时已经正确地调用了 `iniciarTurnoDoAgente`/`finalizarTurnoDoAgente`。

先于本 ADR 的机械式去重 PR（已合并）关闭了同一轮中发现的第二个缺口：`iniciarTurnoDoAgente`/`finalizarTurnoDoAgente` 早已作为一对完整的 `useCallback` 存在，但七个入口中只有两个调用它们——`handleSend`、`handleReadiness` 和 `handleArchitectureReadiness` 各自内联复制了同样五行的"武装"代码，而不是调用已有函数。那个 PR 把三处重复换成对 `iniciarTurnoDoAgente` 的调用（它在那里获得了 `{ comStatus }` 参数——见下文的决策），并引入了 `cancelarTurnoOtimista`。本 ADR 的 PR 是后一半：把已去重的状态、通道 effect 以及三个生命周期函数从 `SessionPage.tsx` 移到一个 hook 中。

## 决策 {#decisão}

新模块 `apps/web/src/lib/session-turno.ts`，导出一个 hook：

```ts
function useTurnoDoAgente(
  projectId: string,
  sessionId: string,
  sessionStatus: string | undefined,
  queryClient: QueryClient,
) {
  return {
    // reads
    streaming, streamingText, streamingAgent, turnoViaCanal, statusAgent,
    pensandoVisivel, atividadeDoTurno, optimisticUser,
    // imperative API
    iniciarTurnoDoAgente, finalizarTurnoDoAgente, cancelarTurnoOtimista,
    // raw setters/ref — two call sites, and only two
    setStreaming, setStreamingText, setOptimisticUser,
    setTurnoViaCanal, turnoAgentRef,
  };
}
```

一个对象，而不是元组——13 个字段；按位置解构会难以阅读，并且对重新排序很脆弱。`SessionPage.tsx` 调用它一次，紧跟在它依赖以取得 `sessionStatus` 的 `session` 查询之后，并以原有的同名解构每个字段——JSX 中每个读取点、每个 handler 主体以及 `useSessionEvents` 的 `refetchInterval` gate（它读取 `streaming`）都无需改动继续工作。

在本代码库中，此前没有一个同时拥有状态和命令式 API 的 hook 先例：`useAutoCollapseSidebar`（`lib/sidebar-state.ts`）返回 `void`——它只是一个注册的 effect。`useSessionReadiness`（`lib/session-readiness.ts`，ADR 0122 PR 5）是一个两参数的纯函数，没有自己的 `useState`/effect。两者都不是本 hook 遵循的模型；这里明确说出来，而不是暗示为"既有模式"。

**为什么通道 effect 整体移动。** 调用 `connectSessionHeartbeat` 的 `useEffect` 是上面点名的第七个写入入口，并已逐行核对为 100% 属于轮次生命周期机制——就连 `onEvent` 的提前 refetch 也读取 `streamingRef`（同一分组的一部分）来决定是否触发。effect 中没有任何东西触及分组之外，所以它连同完整的依赖数组原样移动。

**为什么 `cancelarTurnoOtimista` 只覆盖本文件撤销"武装"的五种方式中的两种。** handler 中散布着五个不同的失败重置块，有三种不同的形式，而不是一种形式重复五次：

1. `handleSend` 的预检（`startAgent('criativo')` 在 agent 尚未确定之前就失败）：2 个字段（`streaming`、`optimisticUser`）——其余的从未被武装。它在 `SessionPage.tsx` 中保留为两次原始的 `setState` 调用，使用 hook 正是为此暴露的 `setStreaming`/`setOptimisticUser`。
2. `handleSend` 的 agent 分支：完整武装的 4 个字段加上 `optimisticUser`，后者武装本身从不触碰（它在 `handleSend` 顶部、agent 尚未解析之前就被无条件设置）。变成 `cancelarTurnoOtimista(); setOptimisticUser(null);`——两次调用，而不是一个更大的函数，因为 `optimisticUser` 的生命周期属于 `handleSend`，而不属于武装/解除这一对。
3. `handleReadiness`：4 个字段（`streaming`、`turnoAgentRef`、`statusAgent`、`turnoViaCanal`）——恰好是 `cancelarTurnoOtimista` 所覆盖的。
4. `handleArchitectureReadiness`：与 `handleReadiness` **完全相同**的块——同样的覆盖。
5. `handleAcceptHandoff`：2 个字段（`turnoAgentRef`、`turnoViaCanal`）——它一开始就从不武装 `streaming`/`statusAgent`，因为它的 kickoff 是 engine 中的异步 `GenServer.cast`（发现 B）：在点击的时刻，handler 还不知道真正的轮次将会开始，只知道谁会回应。在这里调用 `cancelarTurnoOtimista` 会把一个从未碰过 `streaming`/`statusAgent` 的 handler 悄悄耦合到一个名字承诺撤销这两者的函数上——这正是 ADR 0122 已经为整个分组指出的陷阱。这个块像一直以来那样内联保留在 `handleAcceptHandoff` 中，使用 hook 为这唯一调用点暴露的 `setTurnoViaCanal`/`turnoAgentRef`。

`cancelarTurnoOtimista` 正是为覆盖第 3 和第 4 种——两个完全相同的块——而设计的，别无其他。曾考虑过再加第六个函数来覆盖第 5 种并被拒绝：它只为一个调用方而存在，重复了两个原始操作已经直接表达的东西。

**为什么是两个 PR，而不是一个。** 机械式去重（三处重复的武装换成对已有 `iniciarTurnoDoAgente` 的调用，两个相同的失败块换成新的 `cancelarTurnoOtimista`）和模块抽取（状态、通道 effect 和三个函数迁移到 `lib/session-turno.ts`）是不同类型的风险。前者是"这在逐个调用上与它替换的五行相同"，在 diff 中几分钟就能审完。后者是"对 `queryClient`/`projectId`/`sessionId` 的闭包以及 effect 的依赖数组在模块作用域变化后依然成立"，需要单独核对，而不必与"这个版本的武装和那个版本有细微差别"争夺注意力。第一个 PR 在第二个开始之前就已合并。

## 后果 {#consequências}

- `SessionPage.tsx` 从 2 681 行变为 2 479 行（`wc -l`）——状态声明、带 JSDoc 文档的 `iniciarTurnoDoAgente`/`finalizarTurnoDoAgente`/`cancelarTurnoOtimista`、通道 effect，以及武装/解除 `pensandoVisivel` 的 effect，全部移到 `lib/session-turno.ts`（341 行，含注释——与被替换内容的密度相同，因为证明每个字段和每个分支合理性的推理随代码一起移动了，而不只是代码）。
- **这具体关闭了 ADR 0122 的"明确不在范围之内"一节所推迟的轮次通道分组条目。** `ProjectSettingsTab.tsx`——与 `SessionPage.tsx` 在同一条技术债务中被点名的另一个文件——不受本 ADR 影响，仍是一个完全独立、仍然开放、没有日期的范围决策；这里没有任何东西改变它的状态。
- 被点名为该分组回归覆盖的九个测试（`SessionPage.pista-e-status`、`.cancelar-turno`、`.turno-preso`、`.readiness-turno-preso`、`.handoff-devlead-e-colapso`、`.ideacao-automatica`、`.arquiteto-modelo-icone`、`.agente-mais-recente`、`.promocao-inline-e-volta`——最后一个是唯一覆盖 `handleReturnStory`/RN-174 的文件，ADR 0122 从未点名它）全部不经编辑地通过，连同整个 `SessionPage.*.test.tsx` 套件，证明这次改动没有改变任何可观察的行为。
- 上面关于五种形式的发现（决策，"为什么 `cancelarTurnoOtimista` 只覆盖五种中的两种"）现在在这里写下一次，而不再只存在于代码注释中——将来对五个重置块中任何一个的改动，都可以把本 ADR 当作它们今天为什么不是同一个函数的参考。

## 被放弃的替代方案 {#alternativas-descartadas}

- **用第六个函数覆盖 `handleAcceptHandoff` 的 2 字段重置（上面的第 5 块）**，让每个 handler 都调用一个具名函数，而不是两个原始操作。被拒绝：它恰好只有一个调用方，而它要包装的两行（`turnoAgentRef.current = null;
  setTurnoViaCanal(false);`）已经说明了自己在做什么，不需要一个中间名字去查找。
- **扩大 `cancelarTurnoOtimista`，让它也重置 `atividadeDoTurno`**，理论是失败的轮次应当总是清空活动条。被拒绝：三个依赖 `await` 的失败路径（`handleReadiness`、`handleArchitectureReadiness`、`handleSend` 的 agent 分支）今天都不重置 `atividadeDoTurno`，尽管调用可能长达 120 秒，而通道的 delta/tool-call 在此期间可能已经喂给了 reducer。这是本 ADR 之前代码中已被接受的缺口，不是本次抽取被要求修正的东西——在这里新增一个 `dispatchAtividade({ tipo: 'reset' })` 会是在一个本不应有任何行为变化的改动上搭车的静默行为变化。
- **一个 PR 而不是两个。** 出于上文决策中给出的理由被拒绝：去重和模块移动是不同类型的风险，把它们混在一起会让审查中更难隔离其中任何一个的回归。
