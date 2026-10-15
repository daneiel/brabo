---
traducao_de: 4069e0dabf04a99d889663c95b89b6daba1a5904
---

# 0211 — 只有一种导航：侧边栏吸收项目轨道

## 状态 {#status}

**已接受。** 2026-10-03（AT-404；所有者于 10月3日的决定：“A barra navegável à esquerda que pode ser expandida passa a ser a ÚNICA; retire a outra barra de navegação, mas contemple nesta todos os itens da barra excluída”）。修订 [ADR 0126](0126-trilho-vertical-de-navegacao-do-projeto.md)——它仍然有效且不被编辑——以及 [RN-201](../business-rules/autenticacao.md#rn-201)。

## 背景 {#context}

自 ADR 0126 起，项目的标签页存在于**两个**地方：180px 的垂直轨道（`ProjectRail.tsx`，挂载在 `ProjectPage.tsx` 中）和侧边栏中按项目的列表（`LinhaDeAba`，[RN-196](../business-rules/autenticacao.md#rn-196)）。CLAUDE.md 把这声明为缺口（“reconciliar é decisão de produto à parte”），连同框架的代价：代码标签页上 492px（侧边栏 264 + 轨道 180 + `CodeShell` 48）。

修改前测得只有轨道才有的东西：带标题的三个**分组**；被标记的**当前**标签页（`aria-selected`）；五个计数器（Insights、PRs、审批、Backlog、架构），各自在自己的标签页上，从不相加——侧边栏只显示来自仪表盘摘要的审批数；键盘（`ArrowDown`/`ArrowUp`/`Home`/`End`，循环，跨越分组）；当前标签页滚动到可见区域；垂直的 `role="tablist"`；以及在手机上（[RN-643](../business-rules.md#rn-643)）面板上方可滚动的水平栏。侧边栏有而轨道没有的：62px 收起轨道中的项目、手机上的抽屉，以及在浏览器另一个窗口打开的链接。

## 决策 {#decision}

1. **侧边栏是项目唯一的导航。** `ProjectRail.tsx`、它的 CSS 以及在 `ProjectPage.tsx` 中的挂载都移除。侧边栏中的项目列表变成 `AbasDoProjeto`（`apps/web/src/routes/AbasDoProjeto.tsx`），拥有轨道的一切：`GRUPOS_DO_PROJETO` 的分组、当前标签页、每个标签页的计数器、键盘、以项目命名的垂直 `tablist`、roving tabindex，以及把当前标签页滚动进来。每个标签页是指向 `/projects/<id>?tab=<chave>` 的链接。
2. **五个计数器来自**同一个**来源，没有新请求。** 五个队列改为由一个 hook `useContagensDoProjeto`（`apps/web/src/lib/contagens-do-projeto.ts`）读取，框架用它驱动“precisa de você”面板（[RN-467](../business-rules.md#rn-467)），侧边栏用它显示数字。相同的 `queryKey`，去重。侧边栏只在项目框架**已挂载**时开启它——轨道也只存在于那里；在项目的其他界面（例如会话）以及已关闭的项目上，保留来自摘要的审批数，和以前一样。`*.orcamento.test.tsx` 的预算在不改变任何上限的情况下通过。
3. **当前标签页来自框架。** `ProjectPage` 发布它所显示的标签页（`publicarAbaAtiva`）——URL 不够，因为“precisa de você”面板切换标签页时不经过 router。侧边栏向框架**请求**被点击的标签页（`pedirAba`，是事件而不是状态，以免两个框架互相拉扯），并以 `?tab=` 导航。不带 `?tab=` 的项目链接回到默认标签页。
4. **收起时，一个浮出菜单。** 在 62px 的轨道中，**已打开**项目的方块会打开一个带同样标签页的浮出菜单（按 Esc、选择后以及第二次点击时关闭），不展开侧边栏。其他项目仍然是展开。
5. **在手机上，抽屉。** RN-643 的水平栏移除；标签页位于抽屉中，选择一个后抽屉关闭。
6. **`CodeShell` 的 48px 轨道保留：** 它是编辑器的活动栏，不是项目导航。

## 后果 {#consequences}

- 代码标签页的框架在侧边栏展开时从 492px 降到 **312px**（264 + 48），收起时降到 **110px**（62 + 48）。
- “标签页存在于两个地方”这一缺口关闭。
- 切换标签页需要展开的侧边栏、浮出菜单或抽屉。原先收起侧边栏并通过轨道导航的人，改用浮出菜单。
- 侧边栏列表的每个标签页不再用 router 的 `<Link>`：它是拦截点击并调用 `navigate` 的 `<a>`。中键/Ctrl 仍在另一个窗口打开。
- `rail.ariaLabel` 从两种语言中移除；列表以 `sidebar.projects.tabsAriaLabel`（“Abas de {{name}}”）命名。
