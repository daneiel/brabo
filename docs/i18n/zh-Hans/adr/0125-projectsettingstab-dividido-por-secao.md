---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0125 — 把 `ProjectSettingsTab.tsx` 拆分为每个分区一个文件，置于一个 barrel 之后

- **状态：** 已接受
- **日期：** 2026-08-30
- **参考（不作编辑）：**
  [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md)（最近的兄弟——一次基于 barrel 的拆分，其
  验收尺子是“导入方什么都不改”；本 ADR 在 web 一侧复用这一形式），
  [ADR 0122](0122-sessionpage-dividido-em-cinco-prs.md) 和
  [ADR 0124](0124-hook-do-canal-de-turno-do-sessionpage.md)（两者都点名了这个文件，并都明确推迟了它——
  “一个完全独立、仍然悬而未决的范围决策”；本 ADR 就是那个决策，已经做出）。

## 背景 {#contexto}

`apps/web/src/routes/ProjectSettingsTab.tsx` 有 2 532 行、89,9 KiB。它是 `docs/architecture.md` 和
`docs/explanation/backlog.md` 中技术债那一行里**最后**仍然开放的一半：

> Decompose `SessionPage.tsx` / `ProjectSettingsTab.tsx` | G |
> `SessionPage.tsx` was 169 KiB with 25 test files importing it;
> `ProjectSettingsTab.tsx` is 90 KiB

`SessionPage.tsx` 那一半在七个 PR 和两个 ADR（0122、0124）中关闭了。两个 ADR 都在“不在范围内”的章节中
点名了 `ProjectSettingsTab.tsx`，而不是悄悄缩窄那一行——这正是它还留在这里的原因，也是关闭它需要一个
独立编号、而不是顺手重构的原因。

**这个文件在结构上比 `SessionPage.tsx` 任何时候都干净得多**，而这一差别就是它是一个 PR 而不是五个的全部
原因：

1. **父组件什么都不保存。** `ProjectSettingsTab`（本次变更之前的第 217–239 行）是 17 个 JSX 子元素和
   一个 props 接口。没有 hook，没有 `useQuery`，没有 `useQueryClient`，没有 `useTranslation`，没有角色
   检查，没有 `useState`——没有任何东西需要分发，也没有任何东西需要与 React 的渲染周期协调。
2. **没有任何分区接收多于 `{ projectId: string }` 的东西**，有两个（`MatrixSection`、
   `CredentialsSection`）根本不接收 props。没有数据的 prop-drilling，没有 context，没有共享的
   `useState`，也没有向下传递的回调。每个分区调用自己的 hook，拥有自己的查询。
3. **17 个分区中有 11 个已经被导出**——测试套件已经画出了大部分边界，这与 ADR 0122 为 `SessionPage` 的
   五个时间线 helper 所做的论证相同。

分区之间的重复是**有意的，并且保留**：`useTranslation('settings')` 出现约 14 次，
`useQueryClient()` 11 次，`useToast()` 10 次，`useCurrentWorkspaceWithRole()` 5 次，
`useQuery({ queryKey: ['project', projectId] })` 7 次。React Query 在运行时对这些调用去重——正是这让该
模式安全，也让每个分区能独立挂载。把它们提升到一个共享的父组件或 context 中，会是一次打扮成清理的行为
变更，这里不这样做。

## 决策 {#decisão}

在 `apps/web/src/routes/settings/` 中每个分区一个文件，外加一个共享的 helper 模块——18 个新文件——并且
**`ProjectSettingsTab.tsx` 留在当前路径上，作为入口点和 barrel**。

### barrel 是结构性的，不是装饰性的 {#o-barrel-é-estrutural-não-decorativo}

有三个测试文件依赖于路径或导出的名称，三者都必须**不经编辑**就通过——这就是本 PR 的全部验收尺子：

- `apps/web/src/routes/ProjectSettingsTab.test.tsx`（1 356 行，62 个 `it`）从 `./ProjectSettingsTab`
  导入 **11 个具名导出**。
- `apps/web/src/routes/ProjectPage.test.tsx` 和
  `apps/web/src/routes/project-tabs.test.tsx` 都**按路径**执行 `vi.mock('./ProjectSettingsTab', …)`——
  移动或重命名该文件会悄无声息地弄坏这两个 mock。
- `apps/web/src/routes/ProficiencySection.test.tsx` 导入 `ProjectSettingsTab` 本身并渲染它，这让它成为
  唯一一个一次挂载全部 17 个分区的测试——证明 barrel 以正确的顺序、带正确的 props 接好线的端到端证据。

与 ADR 0121 的 `db/schema.ts` 同样的道理：旧路径继续工作，因此下游什么都不变。0121 使用 `export *` 的
地方，这个 barrel 显式地点名每个导出，因为一个设置分区是带有特定 props 形状的 React 组件，而不是一张表——
显式列表能让编译器抓住一个不再与调用点匹配的分区。新分区**按主题的位置**进入 barrel，**绝不追加到末尾**——
与 0121 固定的规则相同，而这里的位置是字面意义上的：barrel 的导入列表、重新导出列表以及 JSX 都遵循渲染
顺序。

### 17 个文件，按渲染顺序 {#os-17-arquivos-em-ordem-de-render}

| 文件 | 行数 | 是否由 barrel 导出 |
|---|---|---|
| `settings/RepositorySection.tsx` | 80 | 否 |
| `settings/ExecutionSection.tsx` | 88 | 是 |
| `settings/ExecutionModeSection.tsx` | 174 | 是 |
| `settings/ParallelismSection.tsx` | 121 | 是 |
| `settings/BudgetSection.tsx` | 132 | 是 |
| `settings/PromotionSection.tsx` | 85 | 是 |
| `settings/MelhoresModelosPorCapacidadeSection.tsx` | 194 | 是 |
| `settings/ModelsSection.tsx` | 334 | 是 |
| `settings/AreaModelsSection.tsx` | 143 | 是 |
| `settings/CatalogoDeModelos.tsx` | 17 | 否 |
| `settings/MembersSection.tsx` | 184 | 否 |
| `settings/PersonalAccessTokensSection.tsx` | 284 | 是 |
| `settings/ProficiencySection.tsx` | 256 | 是 |
| `settings/InstructionVersionsSection.tsx` | 161 | 否 |
| `settings/MatrixSection.tsx` | 65 | 否 |
| `settings/CredentialsSection.tsx` | 269 | 是 |
| `settings/GastoDasChaves.tsx` | 22 | 否 |
| `settings/shared.ts` | 30 | — |

一个子文件夹，而不是 `routes/` 中的 18 个兄弟：先例是 `routes/code/`，而一个标签页 17 个文件，恰好是
文件夹值得存在的规模。这与 ADR 0122 的第 2–4 个 PR 不同，那些把抽出的组件单独放在 `SessionPage.tsx`
旁边——一两个兄弟不值得建文件夹；十七个值得。

### 由文件本身导出，对 barrel 私有 {#exportado-pelo-próprio-arquivo-privado-ao-barrel}

如今私有的 6 个分区（`RepositorySection`、`CatalogoDeModelos`、`MembersSection`、
`InstructionVersionsSection`、`MatrixSection`、`GastoDasChaves`）各自在**自己的模块中**获得一个
`export`——这是这次变更机械的结果，而不是决定：barrel 无法组合一个它无法导入的函数。

它们**不**由 barrel 重新导出。这一部分**是**决定，理由是 barrel 的导出列表是这个标签页的公共表面，而
一次机械的变更不应该扩大它。让 barrel 对全部 17 个保持一致也说得过去，但那意味着本 PR 在声称什么都不改的
同时改变了可观察的东西——模块的导出集合。之后真正需要这 6 个之一的 PR，可以从其文件本身导入它，这在现在
可行，而以前不行。

### 共享 helper：只放多于一个分区调用的 {#helpers-compartilhados-só-o-que-mais-de-uma-seção-chama}

十二个模块作用域的 helper 被移动了。所应用的规则是机械的：**只被恰好一个分区使用的 helper 进入该分区的
文件；被两个或更多使用的进入 `settings/shared.ts`。** 通过 grep 核对，而不是假设——而这次核对纠正了一个
预期：`iniciaisDe`、`PARES_DE_GRADIENTE` 和 `gradienteDe` **只**被 `MembersSection` 调用，从不被
`ProficiencySection` 调用。

- `settings/shared.ts`（2 个 helper）：`ORIGIN_TONE`（`ModelsSection` +
  `AreaModelsSection`）和 `formatarCustoMicros`（`ModelsSection` +
  `BudgetSection`）。
- 在唯一调用者的文件中（10 个）：`USO_TONE` →
  `MelhoresModelosPorCapacidadeSection`；`MATRIX_ROWS` → `MatrixSection`；
  `iniciaisDe`、`PARES_DE_GRADIENTE`、`gradienteDe` → `MembersSection`；
  `siglaDoConector`、`COR_DO_CONECTOR` → `CredentialsSection`；`LEVEL_TONE`
  和 `identidadeDe` → `ProficiencySection`；
  `DEFAULT_MAX_CONSECUTIVE_BLOCKED` → `ExecutionSection`；
  `MODOS_DE_EXECUCAO` → `ExecutionModeSection`。

只有两个符号的 `shared.ts` 是有意做小的。替代方案——一个装着全部十二个的共享模块——会让十个 helper 离它们
唯一的读者多一层间接，毫无好处，还会让下一个人去猜某个常量是否是共享的。`shared.ts` 中的两个符号的意思
正如其所言：这两个、且只有这两个，是真正共享的。

### CSS 模块保持唯一且共享 {#o-módulo-css-fica-único-e-compartilhado}

`ProjectSettingsTab.module.css` 保持当前路径，由使用它的 15 个分区文件导入（`CatalogoDeModelos` 和
`GastoDasChaves` 只渲染一个委托的组件，不引用任何类）。一个样式表，十五个导入者，而以前只有一个。

这与 ADR 0122 对 `SessionPage.module.css` 给出的回答相同，理由也相同：从来没有第二份副本，所以没有可以
分歧的东西。按分区拆分文件，会为每个分区都同样渲染的 `.section`/`.sectionHead`/`.title`/`.eyebrow`
外框创造十五次分歧的机会，换来的是什么都没有。

## 后果 {#consequências}

- **`ProjectSettingsTab.tsx` 从 2 532 行 / 89,9 KiB 变为 77 行 / 4,1 KiB。** 17 个分区加上
  `shared.ts` 在 18 个文件中共 2 639 行，最大的是 `ModelsSection.tsx`，334 行。相对原文件的增长
  （2 532 → 2 716，包括 barrel）完全是导入头部和 barrel 本身；分区主体没有任何一行改变。
- **这关闭了 `docs/architecture.md` 中声明的最后一个开放的技术债条目。** 点名 `SessionPage.tsx` 和
  `ProjectSettingsTab.tsx` 的那一行两半都关闭了；那张表中剩下的行是别的债（四个文件的 api↔engine 契约、
  `TerminalExecutor` 的沙箱、阶段 4a 未闭合的标准），不是这个。
- **验收尺子是零可观察行为变化**，由整个 web 测试套件证明——142 个文件、1 537 个测试——在**零个测试文件
  被编辑**的情况下通过，包括约束路径和导出名称的那三个。一次机械核对支撑了审查：每个新文件的每个块都与
  从 `git show dev:…` 取出的变更前文件逐字比较过，原文件从导入头部往下的每个非空行都被确认落入了某个分区
  文件或 barrel。变更所做的编辑只有上面列出的新增 `export` 关键字以及每个文件的导入头部。
- **两个人现在可以编辑两个设置分区而不碰同一个文件**——与 ADR 0121 为 schema 声称的好处相同，单元数是 17
  而不是 16。
- **四项 UI 改进会在同一工作的后续 PR 中来到这些文件**（已被接受的 8 个 PR 计划，本 PR 是其中的 PR 0）：
  标签页的带锚点目录、在以不同方式书写继承值的四个地方统一措辞、只对
  `ParallelismSection`/`BudgetSection`/`CredentialsSection` 按分区保存的粒度（三个自动保存的分区有意
  保留自动保存），以及在 `ModelsSection`/`AreaModelsSection` 中可读的模型来源链。**它们都不在本 PR 中。**
  先做这次变更，才让这四项中的每一项成为在一个具名文件中的小 diff，而不是在一个 2 500 行文件中的大
  diff——这就是计划把它放在第一位的原因。
- **重复保留，并且是有意保留的。** 十四个 `useTranslation('settings')` 调用现在分散在十四个文件中，而不是
  集中在一个里，这让该模式**更**显眼，而不是更不显眼。这不是之后要修的缺陷：各分区之所以能独立挂载，正是
  因为没有一个依赖于父组件先调用过某个 hook。

## 被放弃的替代方案 {#alternativas-descartadas}

- **像 ADR 0122 对 `SessionPage.tsx` 那样拆成五个 PR。** 被拒绝：0122 的五个 PR 的形式是由活跃的变动
  （50 个 commit、25 个依赖的测试文件、交织的控制流）以及第 5 个 PR 不是文件变更所决定的。这里每个分区
  已经是独立的，父组件不保存状态，每个文件都是逐字节相同的连续块——变动的论证不适用，五个 PR 会是对同一个
  琐碎 diff 的五次审查。
- **删除 `ProjectSettingsTab.tsx`，让 `project-tabs.ts` 指向一个 `settings/index.tsx`。** 按证据而不是
  按喜好被拒绝：两个测试文件按路径对该模块执行 `vi.mock`，第三个从它导入 11 个名称。路由会继续工作；三个
  测试文件会因一次毫无收益的重命名而出问题。
- **把共享的查询（`['project', projectId]`、`useToast`、`useTranslation`）提升到父组件并把结果向下
  传。** 被拒绝：它把 17 个自给自足的组件变成 17 个带父组件契约的组件，这是设计的变更，而不是位置的变更——
  而 React Query 已经对获取去重，所以“重复”在运行时没有任何开销。它还会让每个分区无法单独挂载，而这正是
  `ProjectSettingsTab.test.tsx` 如今测试其中 11 个的方式。
- **把十二个模块作用域的 helper 放进 `shared.ts`。** 被拒绝：十二个中有十个恰好只有一个调用者，一个装着
  私有 helper 的共享模块就不再回答它存在要回答的那个问题。
