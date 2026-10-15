---
traducao_de: 7bfeee6425479907d175deb72a8730fc2fdc22c5
---

# 0181 — 深色主题变为中性黑，对比度债务结束

## 状态 {#status}

**已接受。** 2026-09-30（AT-283 和 AT-284，故事 HS-073，史诗 EP-031，第 29 轮）。基于 [ADR 0074](0074-tema-alcancavel-e-o-boot-sob-csp.md)（可达的主题、两种主题下的测量、八个语法角色）和 [ADR 0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md)（“handoff 确立意图，测量确立数字”这把尺子）。不编辑它们：0074 的**机制**完整保留——通过文件启动、两种主题都被测量、派生的一致性、八个 `--syntax-*`——改变的是几乎每个颜色 token 的**数字**，随之改变的还有 0074 关于深色主题断言的三件事。

## 背景 {#context}

深色主题原先是饱和的石油蓝（`--surface-0` `#061b24`，色相 198°，饱和度约 71%），配奶油色文字和鲜艳的赤陶色强调色（`#d6633a`）。所有者于 2026-09-30 的决定：产品改用市场上的**中性黑**深色主题，沉静，配**柔和**的赤陶色强调（身份留在强调色上，而不在表面上），浅色主题变成同一家族的中性色，取代沙色纸张。

更换之前有三个测得的事实：

1. **深色主题自 FASE 16 起就背负对比度债务。** 五个在用的配对低于 4,5:1——`--text-muted` 在 `--surface-1`（3,89）和 `--surface-2`（3,10）上，`--accent` 和 `--danger` 在 `--surface-1` 上（3,88），以及 `--success` 在 `--surface-2` 上（4,41）。0074 按数字锁定了它们，四个界面换了 token 来绕开（`.hint`、`.link`、环境状态区块、Shell 的错误导航）。
2. **主按钮有一个“已知例外”。** `--on-accent`（奶油色）在 `--accent` 上在深色中给出 3,20:1；ADR 0036 拒绝修复它，因为它“muda a marca em toda a UI”。同样的奶油色在 `Button` 中的 `--success` 上给出 2,07:1。
3. **token 之外的颜色。** 三个用运行时库绘制的地方（Mermaid、xterm、小地图的 canvas）有 27 个手写的回退 hex，用的是之前的石油色，而 C4 的“person”使用**原始**调色板 `--teal-400/600`。三种 agent 颜色是 `lib/agents.ts` 中零散的 hex，只针对深色校准。`Modal` 的遮罩是 `rgba` 的石油色。还有两个在用的 token 并不存在：`--surface-3` 和 `--radius-pill`。

## 决策 {#decision}

**1. 语义值改变；名称不变。** 没有任何模块需要更换引用：`--surface-*`、`--text-*`、`--accent*`、`--on-accent`、状态、`--violet`、边框、`--code-bg`、`--diff-*` 和八个 `--syntax-*` 保持相同的名称。进入一个原始刻度 **`--neutro-*`**（`000`…`950`，无色相的锌色），两种主题的表面、次要文字和边框都引用它；四个旧的原始矩阵保留（UI 中没人用它们，移除它们也换不来什么）。

**2. 数字来自测量，而不是草稿。** 所有者的草稿是起点；在它不合格的地方，数字被调整直到达到下限：

| token（深色） | 草稿 | 最终 | 原因 |
|---|---|---|---|
| `--text-muted` | `#71717a` | `#86868f` | 草稿重复了债务（在卡片和页头上为 3,80 / 3,51）；最终测得 5,38 / 5,10 / 4,70，并且仍低于 `--text-secondary` |
| `--on-accent` | （浅色） | `--neutro-900` | `#c8744f` 上的白色会给出 3,46，悬停时 2,68；中性黑测得 5,61 / 7,25，在 `--success` 上 7,65，在 `--danger` 上 5,24 |

| token（浅色） | 草稿 | 最终 | 原因 |
|---|---|---|---|
| `--text-muted` | `#71717a` | `#696972` | 草稿在 `--surface-2` 上给出 4,40，而自 0074 起浅色主题对文字以 4,5 收口 |

草稿的其余部分原样通过：表面 `#0d0d0f/#141417/#1c1c21`，边框 `#2a2a30/#3a3a42`，文字 `#ececef/#a1a1aa`，强调色 `#c8744f`，状态 `#3fb68b/#d4a13a/#e5534b`，`--code-bg` `#0a0a0c`；浅色中 `#ffffff/#fafafa/
#f4f4f5`，文字 `#18181b/#52525b` 以及加深的赤陶色 `#a4502c`（对 `--code-bg` 为 5,08，与按钮的白色为 5,58）。八个 `--syntax-*` 针对两个新的 `--code-bg` 重新计算，在两种主题下都达到 4,5:1（最低的是浅色的 `--syntax-type`，4,85）。强调色仍是赤陶色：色相在两种主题中都保持在约 18°，这由测试追讨。

**3. 深色主题的债务结束，原先锁定的数字变成**下限**。** 债务中的五个配对在两种主题下都达到 4,5:1，测试现在追讨下限，而不是“继续在 3,89”。`design-contraste.test.ts` 中两条**颠倒**的断言（“muted reprova sobre card”、“accent reprova sobre card”）被改写为下限，使用者也被重新审视：`.link`（AuthLayout）回到原型一直要求的 `--accent`；`.hint`（Input）留在 `--text-secondary`，现在是出于层级而不是对比度。主按钮的例外不复存在，而修复并没有改变品牌——改变的是它上面的**文字**。

**4. token 之外的颜色进入 token（AT-284）。**

- `apps/web/src/lib/tokens-padrao.ts` 为 Mermaid、xterm 和小地图保存主主题值的**一份**副本，`tokens-padrao.test.ts` 在它与 `:root` 分歧时失败。C4 的“person”改为 `--surface-1` 上的 `--accent`。
- `--agent-leve`、`--agent-frontend` 和 `--agent-secops` 诞生时带按主题的值，在三个表面上以 3:1 测量；`lib/agents.ts` 只剩 `var(--token)`，有测试拒绝 hex。
- `--overlay` 是 `Modal` 的遮罩，按主题。
- `--surface-3` 和 `--radius-pill` **不**诞生：两处用法落到它们本来就渲染的东西上（`--surface-1`/`--surface-2` 和 `--r-pill`），`design-tokens-existentes.test.ts` 会拒绝下一个既没有在 CSS 中声明、也没有在运行时写入的 `var(--x)`。

## 后果 {#consequences}

- `CLAUDE.md` 中“dívida de contraste do tema ESCURO travada por número (ADR 0074)”这一缺口关闭。绝不放松下限的尺子继续有效，现在没有登记的例外。
- 模块中的 111 个 `color-mix()`（AT-285）在这里**没有**被重新审视：它们混合 token，仍然有效，但每一个的视觉结果都会随新的底色而改变，审视属于独立的 lane。
- 好几个 CSS 模块的注释引用了债务的旧数字（`Shell.module.css`、`SinaisDoAmbiente.module.css`、`ProjectCard.module.css`、`ProjectRail.module.css`、`TurnActivityStrip.module.css`、placeholder 中的 `Input.module.css`）。它们所解释的选择仍然有效；引用的数字是历史性的。更新它们属于模块的审视。
- 文档站点（`website/src/css/custom.css`）有自己的调色板，没有被触碰。
- 依赖对比度的 `.design-sync` 预览在下一次视觉验证之前无效（那里的 NOTES.md 本身就这么说）。
