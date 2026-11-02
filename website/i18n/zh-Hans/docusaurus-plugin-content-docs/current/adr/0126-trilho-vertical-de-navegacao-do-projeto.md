---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0126 — 项目页面通过垂直轨道导航，代码标签页不再自行折叠侧边栏

- **状态：** 已接受
- **日期：** 2026-08-30
- **参考（不作编辑）：**
  [ADR 0078](0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
  （界面外框与标签页注册表——它把标签条的间距移到了原语 `Tabs` 中，本 ADR 现在让项目页面不再使用它）、
  [ADR 0074](0074-tema-alcancavel-e-o-boot-sob-csp.md)（让计数器徽章保持实色而不是着色的对比度债务）、
  [ADR 0125](0125-projectsettingstab-dividido-por-secao.md)（同一个已接受的 8 个 PR 工作中的 PR 0，本
  ADR 是其中的 PR 1）。
- **修订：** [RN-201](../business-rules/autenticacao.md#rn-201)——自动折叠的那一半被移除；
  `brabo.project`/`brabo.tab` 的持久化那一半保持不变。

## 背景 {#contexto}

项目页面有 **12 个标签页，分为 3 组外加 3 个独立标签页**（`apps/web/src/routes/project-tabs.ts`），由一个
两级的横向标签条渲染（基于原语 `Tabs` 的 `components/ui/GroupedTabs.tsx`）。一次对产品 UI 的设计审查把
“用轨道替换标签条”排在了第一位。

**该审查的三条理由中有两条在事实上是错的，记录在此以免有人再争论：**

1. *“第二级在内容之上展开。”* 错误。它是顶层行下方的一行内联内容——`GroupedTabs.tsx:143`，同一个列容器中
   的一个兄弟 `<div>`。从来没有任何东西覆盖过任何东西。
2. *“组关闭时计数器会消失。”* 错误。关闭的组会把子项的计数器相加并显示总数——`somarContagens`，
   `GroupedTabs.tsx:33`，由 `GroupedTabs.test.tsx:141` 覆盖。

**站得住的论证就是这次变更的唯一理由：横条上放 12 个项目无法扩展。** 标签条是为 handoff 中约 6 个标签页
设计的；分组换来的空间，是把 12 个中的 9 个藏在一次点击之后，这是压缩，而不是放得下。在窄窗口中，顶层行
已经会横向滚动（`Tabs.module.css`，`overflow-x: auto`）。

审查的第三个主张——五个计数器应该相加为组总数——**在这里被拒绝，正如以前被拒绝过一样**：五个队列（洞察、
PR、审批、backlog、架构）保持分开，因为相加会隐藏是**哪个**队列在要求关注。这是一项现行的产品决策，已经
写在 `ContagensDeAba` 的文档注释和 `ProjectPage.tsx` 中。

## 决策 {#decisão}

`GroupedTabs` 被 `apps/web/src/routes/ProjectRail.tsx` 取代，这是项目页头与标签页面板之间的一条垂直轨道。

### 三个组同时展开 {#os-três-grupos-ficam-abertos-ao-mesmo-tempo}

这正是这次变更换来的东西，也是组标题不再是可选中的按钮、而变成**标题**的原因。不再有“展开的组”这种状态，
因此也不再有“每个组最后访问的子项”的记忆（`ultimaFilhaPorGrupo`）——指向组内标签页的直接链接现在不需要任何
管道来显示它，因为它从未被隐藏过。

组标题复用已有的 i18n 键 `groups.*.label`，标签页标签复用 `tabs.*.label`，两者都在 `nav` 命名空间中。
**`project-tabs.ts` 不变**：它本来就是结构的单一来源，轨道消费的是与标签条相同的 `GRUPOS_DO_PROJETO`。
（它已知的不对称——注册键 `arquitetura` 映射到 i18n 键 `tabs.architecture.label`——完全保持原样。）

### 几何借自 `CodeShell` 的轨道，而不是 `Shell` 的 {#geometria-emprestada-do-trilho-do-codeshell-não-do-shell}

`routes/code/CodeShell.module.css`（`.rail`/`.railItem`/`.railItemAtivo`）是**仓库中唯一画出了激活状态的
轨道**：一条带右侧分隔线的 `--surface-1` 条带，32px 高、`--radius-sm` 的条目，激活条目以
`color-mix(in srgb, var(--accent) 12%, transparent)` 着色，文字为 `--accent`。侧边栏的 `.trilha`
（`Shell.tsx:444-477`）不能作为模型：它没有激活条目，也没有键盘导航，因此回答不了这个组件必须回答的两个
问题中的任何一个。

**一处已声明的偏离：**宽度。`CodeShell` 的轨道是 48px，因为它只有图标。这一条是 180px，因为它承载标签页的
*标签*和组的*标题*——这正是三个组同时展开的全部机制。其他一切（条带表面、分隔线、条目高度、圆角、激活
着色、hover、`:focus-visible` 的焦点环）都是同样的处理。

计数器徽章保持**实色** `--accent`/`--on-accent`，而不是 handoff 的 18% 着色。这一偏离是有意的，并已记录在
`design/SCREENS.md` 中：着色的颜色对落入对比度债务（3,88:1），而这是 10px 的文字。

### 键盘契约被移植，而不是被放弃 {#o-contrato-de-teclado-é-portado-não-abandonado}

`GroupedTabs.onKeyDownDaLinha`（`GroupedTabs.tsx:49-71`）处理 `ArrowRight`/`ArrowLeft`/`Home`/`End` 并会
循环回到开头，其七个测试用例中有两个覆盖了它（`GroupedTabs.test.tsx:102,124`）。删除经过测试的无障碍功能
而不替换，是回归，不是重构，因此同一个契约在轨道上重新出现，只是换了轴：
`ArrowDown`/`ArrowUp`/`Home`/`End`，带循环，移动时即选中（自动激活，与之前相同）。

实现比它所取代的更好。`GroupedTabs` **按位置**关联，在 DOM 中查询 `[role="tab"]`，因为原语 `Tabs` 不暴露
ref。轨道拥有自己的按钮，因此一个以标签页键为键的 ref `Map` 无需查询文档就能给出关联。方向键遍历整个展平
后的列表，跨越组的边界——在轨道中没有需要区分的“外层行”和“内层行”。

ARIA：轨道是带 `aria-orientation="vertical"` 的 `role="tablist"`；组的容器和它们的标题是
`role="presentation"`，这让 12 个标签页保持为 tablist 直接拥有的元素，同时在视觉上对它们分组。

### `GroupedTabs` 被删除；`Tabs` 保留 {#groupedtabs-é-apagado-tabs-fica}

两者都只有一处使用——`GroupedTabs` 只被 `ProjectPage` 使用，`Tabs` 只被 `GroupedTabs` 使用——但它们不是
同一类东西，起决定作用的证据是 `ds-bundle/`，即**从这个应用**生成的设计系统
（`.ds-build-meta.json`：`source: web@0.1.0`，66 个组件，命名空间 `BraboDS`）：

- **`Tabs` 在其中**，作为 `components/primitivas/Tabs`——`_ds_sync.json` 中有三个条目（`.jsx`、
  `.d.ts`、`.prompt.md`），`.stories-map.json` 中有一个 story。删除它会让设计系统因一个界面的布局变更而
  顺带缩小。一个当前没有消费者的通用原语是库存，不是死代码。它保留，附一条说明原因的注释。
- **`GroupedTabs` 不在其中**——整个 `ds-bundle/` 中零次出现。它是项目页面在原语之上的特定组合，只有一个
  调用者，它与其样式表和 `GroupedTabs.test.tsx` 一起被移除。

## 后果 {#consequências}

### RN-201 失去了自动折叠的那一半 {#a-rn-201-perde-a-metade-do-recolhimento-automático}

代码标签页通过 `AutoCollapseContext` / `useAutoCollapseSidebar`（`apps/web/src/lib/sidebar-state.ts`）
强制折叠 Shell 的侧边栏，由 `ProjectCodeTab.tsx`——唯一的调用者——注册，并在 `Shell.tsx:369-371,412` 中
与 Shell 的折叠做“或”组合。**这一切都被移除**：context、hook、`autoColapsado` 状态、包在 `<Outlet />`
外的 `Provider`、只为保护自动路径而存在的折叠按钮的 `disabled` 状态，以及两种语言中的字符串
`sidebar.collapseButton.autoCollapsed`。

理由是结构性的：有一条始终存在的项目轨道时，保留自动折叠会把 Shell 的图标轨道 `.trilha` 直接放在新的项目
轨道旁边——在产品最重的标签页上，永久地出现两条相邻的垂直轨道。

**代价是真实的，并且在写下这些之前已经被审查和接受。** 在浏览器中测量，而不是估算：代码标签页现在渲染时，
Shell 的侧边栏是**展开的**（264px）+ 项目轨道（180px）+ `CodeShell` 自己的轨道（48px）= **在第一个代码
字符之前有 492px 的外框，而之前约为 110px**（折叠的侧边栏 62px + 代码轨道 48px）。这是编辑器宽度的损失，
是付出的代价。

换来的是：自动折叠是*系统*替用户做决定；手动折叠是*用户*做决定。移除系统的决定、尊重用户的决定，这就是
这笔交换。手动折叠仍然可用，并继续持久化在 `brabo.sidebar.collapsed` 中。

**双轨道并没有消失——它被重新安置到了一个由用户选择的状态。** 手动折叠仍会在项目轨道旁产生 Shell 的图标
轨道。区别在于是谁选择的。说成相反的样子就是在假装。

RN-201 被原地改写，保留编号和锚点 `{#rn-201}`（锚点就是契约）。`brabo.project`/`brabo.tab` 的持久化那一半
保持不变。

### 标签页导航现在存在于两个地方——而且本来就存在 {#a-navegação-por-abas-agora-existe-em-dois-lugares--e-já-existia}

`Shell.tsx` 在侧边栏中渲染自己的按项目标签页列表（`LinhaDeAba`，RN-196），读取同一个 `ABAS_DO_PROJETO`。
有了轨道，项目页面会在右边几百像素处第二次显示这同样的 12 个标签页。**这是早已存在的，不是在这里引入的**——
横向标签条以完全相同的方式重复了侧边栏的列表——但轨道让这种重复在视觉上变得并列（同样 12 个标签的两个垂直
列表），而之前是一行对一列。协调这两者是一项单独的产品决策，这里不做。

### 测试 {#testes}

- `GroupedTabs.test.tsx`（7 个用例）随组件一起删除。两个键盘用例在轨道中以五个用例重新出现
  （`ProjectRail.test.tsx`，17 个用例：组同时展开、tablist 的垂直方向和被拥有的 12 个标签页、激活标记、
  直接链接、五个分开且不做组求和的计数器、没有计数器的标签页没有徽章，以及双向循环的
  ArrowDown/ArrowUp/Home/End）。
- **`apps/web/src/routes/project-tabs.test.tsx` 中有两个用例被改写而不是保留**，这是本次变更编辑一个本应
  存活的测试的唯一地方。两者通过 `ProjectPage` 断言的是*正在消亡的组件*的契约，而不是注册表：
  - `'a régua de TOPO mostra os grupos e as abas soltas … nunca as 12 chaves
    achatadas'` 断言**恰好 6 个**元素有 `role="tab"`。轨道的全部目的就是让 12 个都有。改写为断言同样声明
    的顺序（展平后），外加三个组标题存在且没有一个是标签页。
  - `'o selo do GRUPO é a SOMA dos selos das filhas'` 断言一个求和的组徽章。不再有可以汇总的关闭的组，而
    求和恰恰是这个产品有意不做的。改写为断言每个队列保留自己的徽章，且没有任何组标题带数字。

  该文件中所有其他用例，以及 `ProjectPage.test.tsx` 的四个用例、整个 `Shell.test.tsx` 和
  `sidebar-state.test.ts` 中的 describe `'projeto e aba ativos'`，都**无需编辑**即可通过。
  `sidebar-state.test.ts` 中的 describe `useAutoCollapseSidebar` 被删除，因为 hook 被删除了。
- 整个 web 测试套件通过：142 个文件，1 540 个测试。

## 被放弃的替代方案 {#alternativas-descartadas}

- **一条只有图标的 48px 轨道，字面照搬 `CodeShell`。** 被拒绝：12 个标签页需要 12 个并不存在的不同图标，
  而三个组标题——让同时展开的组变得可读的机制——根本没有图标形式。结果会是一排没有标签、每个都需要
  tooltip 的方块，比它所取代的标签条更糟。
- **保留 `GroupedTabs` 并把它变成垂直的。** 被拒绝：会留下来的是顶层/第二级的划分，而这个划分恰恰是正在
  被移除的东西。剩下的代码——基于 DOM 位置的键盘处理器、`somarContagens`、`ultimaFilhaPorGrupo`——全都是
  用来隐藏子项的机器。
- **保留自动折叠，让两条轨道相邻。** 被拒绝：它在水平空间最重要的标签页上，交给用户一条由系统强加的永久
  双轨道，而用户无法撤销它（折叠按钮恰恰在自动折叠开启时是禁用的）。
- **既然 `Tabs` 现在没有调用者，也把它删掉。** 按证据被拒绝：它是设计系统已发布的原语，一个界面的布局
  变更不是改变 DS 库存的理由。
