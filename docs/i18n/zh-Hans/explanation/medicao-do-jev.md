---
id: medicao-do-jev
title: Jev 工具路由器的测量
description: "针对本地 event log 中已记录的每一个智能体步骤，询问 Jev 它本会提供哪个工具的回放——它在 2026-09-29 得出的一致率、置信度曲线、延迟和成本；第二轮把标尺、输入和智能体自身节奏在距 90% 差距中的份额分开，并给出样本量和回放看不到的东西；以及 AT-239 的有/无实时对比——在任何执行之前写下的工具、协议、决策规则和成本估算，以及 2026-10-01 的执行（40 次执行，US$ 0,52）——限制：路由器在 Haiku 上划算，在 DeepSeek 上亏损，因为它打破了后者的提示词缓存。"
traducao_de: ecdb4939d75fa1e38739b157f898f47ca33c247a
---

# Jev 工具路由器的测量 {#measuring-the-jev-tool-router}

> AT-237（EP-029，HS-063）。一次**产品之外的测量**：`apps/` 中没有任何代码
> 导入这里的代码，数据库中不写入任何东西，这里也不声称任何产品收益——那属于
> AT-239，它比较有路由器和没有路由器的轮次。被测量的路由器是 AT-235 所规定的；
> 它所依赖的决定来自 AT-236。
>
> 于 2026-09-29 针对本地 dev 实例（compose 项目 `brabo-dev`）测量，仓库处于
> `d48f99f8ec`。**第二轮**——`state` 的变体、等价类、拟合/验证划分、top-2 以及
> 按原因划分的差距——在[下文](#second-round-2026-09-29-where-the-gap-is)。

## 现有内容 {#what-exists}

全部位于 `scripts/jev/`，用仓库的 Node 运行（type stripping，无构建步骤，
**无新依赖**）。

| 文件 | 作用 |
|---|---|
| `catalogo.exs` | 从 engine 自身代码中导出每个智能体的工具目录（每个工具的 `spec/0`：名称和描述）以及身份（`Engine.Harness.Agents.identity/1`） |
| `catalogo.json` | 导出结果，纳入版本控制——目录变化时重新生成（命令在 `.exs` 的文件头中） |
| `passos.ts` | 纯函数：event log → **步骤**，以及每个步骤的 `state` |
| `jev.ts` | 纯函数：对 Decisions API 的请求和对响应的读取 |
| `medicao.ts` | 纯函数：一致率、Wilson 区间、置信度曲线、延迟、成本、Markdown 报告 |
| `replay.ts` | 第一轮的 CLI：三个 `SELECT`，每个步骤一次请求，一个位于检出目录之外的 JSONL |
| `dados.ts` | 第二轮：原始数据（事件、用量行、任务、用户故事、模块映射、动作结果）以及快照缓存 |
| `equivalencia.ts` | 第二轮：等价类 E1–E3，在运行前固定，以及终端命令的分类器 |
| `kickoff.ts` | 第二轮：dev agents 和 gates 循环的第一条消息，从 engine 的 Elixir 移植而来（一个 spec 将固定文本与 `.ex` 文件核对） |
| `variantes.ts` | 第二轮：`state` 的变体和执行边界；每个字段都注明它在 engine 中的来源 |
| `divisao.ts` | 第二轮：拟合/验证划分，按执行划分 |
| `cliente.ts`、`medicao2.ts`、`analise.ts` | 第二轮：调用（保存概率）、top-k / 级联 / 按原因的表格，以及 CLI `jev:analise` |

### 步骤，而不是工具调用 {#step-not-tool-call}

路由器**在每次调用聊天模型时咨询一次**，在 `provider.chat` 之前（AT-235）。一个
步骤可以携带多个工具调用——Criativo 的一次响应里有十个 `emit_artifact`，dev 的
一次响应里有 `terminal` + `read_file`——因此对每个 `tool.call` 询问一次 Jev，会提出
产品从不提出的问题，而且所用的 `state` 已经包含同一步骤中的兄弟调用。

event log 没有步骤标记（AT-235，缺口 1），所以边界来自 `token_usage`：api 在
engine 写入该响应的 `tool.call` **之前**为每次 LLM 调用写入一行。同一会话、同一
执行者在两条连续行之间的所有 `tool.call` 属于同一个步骤。由此得出三种标签：

- 只有**一个**工具的步骤（对它的一次或多次调用）：标签 = 该工具；
- **异构**步骤（两个不同的工具）：命中 = Jev 的选择是其中之一——但把菜单限制为
  一个工具会砍掉其余的；
- 在其行之后**没有** `tool.call` 的步骤：模型以文本作答（或失败）。这是
  `responder_sem_ferramenta` 用这种方法唯一能得到的标签——brief 预期一个都没有；
  步骤边界给出了七个。

时刻作为固定宽度、带微秒的 UTC **文本**进行比较：用量行和一个步骤的第一个
`tool.call` 有时落在同一毫秒。

### 发送的 `state` {#the-state-sent}

AT-235 的格式，从步骤**之前**已存在的内容中截取：`agente`；`pedido`——对会话型
智能体，是**用户**写的最后一条 `chat.message`；对 dev agents 和任务 gates，是
`dev.working` 中任务的标题；`contexto`——智能体的身份加上项目的
`agent_instructions` 行（如果存在）（系统提示词的两层，而不是组装后的完整提示词）；
`passos_recentes`——该执行者在该会话中的最后 6 次调用，参数和结果截断为 500 个
字符。问题是一个 `choice`，其 `criteria` 是目录的 `{name: description}` 加上保留的
`responder_sem_ferramenta`。

请求发往 `POST https://openrouter.ai/api/alpha/decisions`，模型为
`typesafe/jev-1.13`。对 AT-235 的一处更正，经过测量：**`questions` 是一个按问题
id 索引的对象**，不是列表——列表形式会收到
`400 expected record, received array`。响应是
`answers.<id>.{choice, probabilities, confidence}`、`usage.{input_tokens,
output_tokens, cost}`、一个 `id`（`gen-dec-…`），以及 `model` 中一个带日期的快照
（本次执行的每个响应中都是 `typesafe/jev-1.13-20260917`）。

## 样本 {#the-sample}

| | |
|---|---|
| 实例 | 本地 dev（`brabo-dev`），项目 `test`，4 个有步骤的会话（第五个会话 `core-api` 一个都没有） |
| 时段 | 2026-09-29 06:19:11 → 07:57:22 UTC |
| 读取 | 879 个事件（502 个 `tool.call`），307 行智能体的 `token_usage` |
| 步骤 | 目录中智能体的 305 个；**询问了 302 个**（Psicólogo 的 3 个只有单工具目录，永远不会被路由——AT-235，条件 c） |
| 标签 | 295 个有工具的步骤（36 个异构），7 个没有 |
| 可疑标签 | 295 个步骤中有 157 个含有一次结果显示失败的调用（`ok: false`、以 `falhou`/`erro` 开头的文本、`exit` ≠ 0）或从未收到结果的调用——被调用的工具可能选错了 |

做了两次完整执行（报告的是第二次；数据库在两次之间多了一个 Anamnese 的步骤）。
在两次执行共有的 301 个步骤中，Jev **在 283 个（94%）中给出了相同选择**；平均
|Δ 置信度| 为 0,029，最大 0,16。样本是一个小项目、一天、一个聊天模型
（`~deepseek/deepseek-flash-latest`）；下面每个比率都带有其 95% Wilson 区间，
而大多数按智能体的区间太宽，无法对智能体排序。

## 按智能体的一致率 {#agreement-by-agent}

"一致" = Jev 的选择是模型在该步骤中调用的某个工具。
"重复上一个"是免费的基线：提供同一执行者在上一步使用的最后一个工具。

| 智能体 | 选项 | 有工具的步骤 | 异构 | 一致率（95% CI） | 无可疑 | 当 Jev 选择了工具时 | 基线"重复上一个" | 无工具的步骤 |
|---|---|---|---|---|---|---|---|---|
| anamnese | 5 | 8 | 0 | 3/8 = 38% (14–69%) | 3/8 | 3/3 | 4/4 | — |
| appsec | 6 | 6 | 2 | 0/6 = 0% (0–39%) | 0/6 | 0/1 | 0/5 | — |
| arquiteto | 9 | 5 | 2 | 1/5 = 20% (4–62%) | 1/5 | 1/2 | 1/4 | 3/3 |
| criativo | 3 | 5 | 0 | 3/5 = 60% (23–88%) | 3/5 | 3/4 | 1/4 | 2/2 |
| dev-board-engine | 9 | 24 | 3 | 12/24 = 50% (31–69%) | 1/3 | 12/24 | 20/23 | — |
| dev-game-session | 9 | 38 | 2 | 20/38 = 53% (37–68%) | 5/14 | 20/38 | 25/37 | — |
| dev-input-keyboard | 9 | 25 | 3 | 12/25 = 48% (30–67%) | 5/10 | 12/25 | 18/24 | — |
| dev-lead | 4 | 1 | 1 | 0/1 | — | — | — | — |
| dev-persistence | 9 | 34 | 3 | 24/34 = 71% (54–83%) | 4/12 | 24/34 | 26/33 | — |
| dev-piece-catalog | 9 | 37 | 5 | 21/37 = 57% (41–71%) | 4/11 | 21/37 | 31/36 | — |
| dev-retro-renderer | 9 | 26 | 0 | 13/26 = 50% (32–68%) | 5/14 | 13/26 | 19/25 | — |
| dev-scoring | 9 | 38 | 1 | 19/38 = 50% (35–65%) | 4/15 | 19/38 | 29/37 | — |
| infra | 5 | 2 | 1 | 0/2 | 0/1 | — | 1/1 | 0/1 |
| infra-workflows | 3 | 2 | 0 | 0/2 | 0/2 | — | 0/1 | — |
| po | 10 | 8 | 2 | 6/8 = 75% (41–93%) | 6/8 | 6/6 | 0/7 | 1/1 |
| qa-automacao | 7 | 20 | 5 | 4/20 = 20% (8–42%) | 2/9 | 4/20 | 14/19 | — |
| qa-estrategia | 6 | 16 | 6 | 0/16 = 0% (0–19%) | 0/15 | — | 7/15 | — |
| **全部** | | **295** | **36** | **138/295 = 47% (41–52%)** | 43/138 = 31% (24–39%) | 138/258 = 53% (47–59%) | **196/275 = 71% (66–76%)** | 6/7 = 86% (49–97%) |

## 在既定规则下的置信度曲线 {#the-confidence-curve-under-the-decided-rule}

AT-236 决定（答复 7 和 12）路由器**只限制**菜单，且 `responder_sem_ferramenta`
——无论置信度多少——在 v1 中发送**完整**目录。因此一个步骤只有在置信度达到或
超过阈值**且**选择是一个工具时才被*限制*；其余一切行为与今天相同。代价高的错误
是限制到**错误的**工具。

| 阈值 | 菜单限制为 1 | 回落到完整目录 | 被限制者中正确的（95% CI） | 被限制到错误工具 | 被砍掉的异构步骤 |
|---|---|---|---|---|---|
| 0.00 | 258 | 37 | 138/258 = 53% (47–59%) | 120 | 18 |
| 0.30 | 191 | 104 | 110/191 = 58% (51–64%) | 81 | 13 |
| 0.40 | 126 | 169 | 76/126 = 60% (52–68%) | 50 | 10 |
| 0.50 | 73 | 222 | 50/73 = 68% (57–78%) | 23 | 5 |
| 0.60 | 43 | 252 | 29/43 = 67% (53–80%) | 14 | 4 |
| 0.70 | 17 | 278 | 14/17 = 82% (59–94%) | 3 | 2 |
| 0.80 | 7 | 288 | 7/7 = 100% (65–100%) | 0 | 0 |
| 0.90 | 2 | 293 | 2/2 = 100% (34–100%) | 0 | 0 |

报告按组打印同样的曲线（dev agents、会话型智能体、gates 以及 `ToolLoop` 的其他
智能体）。dev agents 与上表一致（0.70：11/14；0.80：6/6）。会话型智能体在 Jev 以
任意置信度选择了工具时，在 10/12 个步骤中命中；在它们有工具的 21 个步骤中，Jev
有 9 个选择了 `responder_sem_ferramenta`，根据答复 12，这是无害的。

**阈值。** 网格中没有任何阈值的区间下限达到 90% 或以上，无论总体还是任何组。
唯一没有错误限制的点是 **0.80**，而在那里路由器只作用于 295 个步骤中的 7 个
（2%）——下限为 65%。这个样本不支撑一个阈值；如果要据此固定一个，0.80 是它指向
的值，覆盖率就是这样。AT-236 的答复 4 要求每种错误的成本，而这个回放无法为其
定价。

## 延迟与成本 {#latency-and-cost}

| | |
|---|---|
| 延迟（302 个请求，顺序执行，来自维护者的机器） | p50 306 ms，p95 410 ms，最大 550 ms；**0 个超过 2 000 ms**（第一次执行：286 / 409 / 512） |
| 每个请求的输入 token | 538 到 3 220，中位数 1 710 |
| 按 `usage.cost` 的成本 | 302 个步骤 US$ 0,021964——**每步 US$ 0,0000727** |
| 实际计费 | 对 302 个 id 逐个 `GET /api/v1/generation`：`total_cost` 合计同样的 US$ 0,021964（比率 1,000） |

每次执行前后 `GET /api/v1/key` 的差值**没有**吻合：第一次执行 +US$ 0,0349 对比
声明的 0,0219，第二次 +0,0185 对比 0,0220。这把密钥是共享的，其计数器有延迟：
在 AT-237 的整个会话中，它的 `usage` 从 US$ 1,830 升到 US$ 2,052（+0,222），而本
回放的生成计费为 US$ 0,044，因此同时有其他工作在同一把密钥上花钱。差值不是一次
执行的度量；按生成的记录才是。AT-237 的总花费（两次执行加上格式探测）：约
US$ 0,044，上限为 US$ 2,00。

## 回放看不到的东西 {#what-the-replay-cannot-see}

- **循环的第一条消息。** `ToolLoop` 智能体（dev agents、gates、Anamnese、
  Infra-Workflows）从一条在代码中组装的用户消息开始——任务、用户故事、模块映射
  ——它从不进入 event log。回放对 dev agents 和任务 gates 只有任务标题，对
  `qa-estrategia`、`appsec`、`anamnese` 和 `infra-workflows` 什么都没有。产品的
  `state` 会携带这条消息。`qa-estrategia` 的 0/16（Jev 每次都回答
  `responder_sem_ferramenta`）测量的既是 Jev 也是回放的盲区；这些行是下限，不应
  决定任何事。
- **系统提示词的其余部分。** `contexto` 是身份和项目指令行，不是组装后的提示词
  （业务规则、任务状态、文件）。
- **标签是否正确。** 选择工具的模型不是基准真相；157 个步骤被标为可疑并单独报告
  （"无可疑"）。干净步骤上的一致率（31%）低于总体（47%）：可疑步骤大多是 dev
  agents 失败的 `terminal` 调用，Jev 也倾向于选择它——因此标错的步骤不能解释
  分歧。
- **效果。** 受限的菜单会改变模型接下来的行为；回放只是把一个选择与记录下来的
  选择比较。轮次是否变得更短、更快或更便宜，是 AT-239 的事。

## 数字之外的两个发现 {#two-findings-outside-the-numbers}

- **异构步骤很常见：** 295 个中有 36 个（12%）。把菜单限制为一个工具会把每个这样
  的步骤变成至少两个步骤——AT-235 的缺口 1，现在有了计数。
- **AT-235 中目录同步的风险（缺口 3）是真实的，只是换了个名字：**
  `GET /api/v1/models` 不列出 `typesafe/jev-1.13`，但列出了
  `typesafe/jev-router`——一个聊天路由器，价格为 `-1`。模型同步会把它当作聊天
  模型（非活动）导入。在此记录，未作修改。

## 第二轮（2026-09-29）：差距在哪里 {#second-round-2026-09-29-where-the-gap-is}

> 在第一轮之后由负责人提出：重复测量，尝试达到**至少 90%**，并准确说出差距在
> 哪里。**未达到。** 在验证步骤上，Jev 的 top-1 **按等价为 73%（95% CI 66–79%，
> n = 160），严格为 66%（58–73%）**；它的 top-2 达到 90%（84–94%）。本节其余部分
> 是协议、数字，以及对剩余 43 个 top-1 错误的人工阅读。同一实例，与第一轮相同的
> 保留：一个小项目、一天、一个聊天模型；不声称任何产品收益（那是 AT-239）。仓库
> 处于 `bc7f4c0738`，分支 `test/replay-do-jev-v2`。

### 协议（在任何执行之前写下） {#protocol-written-before-any-run}

- **只用产品在运行时、在步骤之前能产生的东西。** 目标步骤的任何内容都不进入
  `state`：既不包括它调用的工具，也不包括参数、结果，也不包括模型在同一步骤中写的
  文本（`Passo.texto` 只从*之前的*步骤读取；`variantes.spec.ts` 对每个变体断言
  目标步骤的调用、参数、结果和文本都不存在）。每个新字段都有其在 engine 中的来源，
  引用在 `scripts/jev/variantes.ts` 的文件头中。
- **等价类在运行前固定于 `scripts/jev/equivalencia.ts`**，依据工具的语义，并与
  严格规则（第一轮的规则，使 47% 仍可比较）并列报告。三层累积：
  **E1** 命令只读取/列出/搜索的 `terminal`（`ls`、`find`、`cat`、`pwd`、`grep`、
  `head`、`git status/log/diff`……——复合命令按最强的片段计，执行 > 写入 > 读取）≡
  `read_file`/`search_workspace`；**E2** `read_file` ≡ `search_workspace`；
  **E3** 写文件的 `terminal`（重定向、heredoc、`tee`、`sed -i`、`cp`、`mv`、
  `touch`）≡ `write_file`。故意不对称：Jev 选择 `terminal` 只对 `terminal` 调用
  有效，而一个*执行*的命令（`npm`、`node`、`rm`、`mkdir`、`git commit`……）除了
  `terminal` 不等价于任何东西。**标题数字是完整规则（E1+E2+E3），严格规则并列。**
  看到结果后没有重新分类任何东西；这些类仍然判错的 3 个错误在下文照此计数。
- **拟合 × 验证按执行划分，而不是按步骤。** 一组是一次 `ToolLoop` 执行（dev agent
  的一个任务、一轮 gate），对会话型智能体则是该智能体的整个会话。各组按名称的哈希
  排序，每组进入到目前为止步骤较少的那一半——确定性的，且对任何结果不可见。
  328 个合格步骤：**167 个拟合，161 个验证**（下面的 n 计的是有工具的步骤：161 和
  160）。变体只在拟合上迭代；验证在之后、每个变体问一次。**一个已声明的事件：**
  在最初几次拟合执行后，我发现 Anamnese 的 `skip_proficiency` /
  `emit_proficiency` 也会结束循环，于是把它们加入了用于*组装 state* 的执行边界
  列表。若用更正后的列表做划分，也会把 167 个拟合步骤中的 154 个移到验证，因此
  划分保留了第一次请求之前的列表（`FERRAMENTAS_DE_FIM_DA_DIVISAO`），只有 state
  使用更正后的列表。依赖边界的四个 state 变体在拟合上重新问了一遍（US$ 0,075，
  在花费记录中以 `.descartado` 保存）。
- **冻结的快照。** dev 数据库在会话期间继续接收来自其他工作的步骤（结束时 335 行
  用量对比开始时 333 行）；分析运行在 333 行的快照上，事件截止到相同的序号
  （`--dados-cache`）。自第一轮以来新增的 26 个步骤（302 个已回答 → 328 个合格）
  全部是拟合那一半中 **Anamnese** 的步骤。
- **花费上限** US$ 1,00，针对 `usage.cost` 之和，在每次请求前与输出目录的累计
  总额（`.jsonl` 和 `.descartado`）核对。花费：**US$ 0,414**，共 4 604 次请求
  （见"延迟与成本"）。

### 样本 {#the-sample-1}

| | 拟合 | 验证 |
|---|---|---|
| 步骤（有工具 / 无） | 167 (161 / 6) | 161 (160 / 1) |
| dev agents（`ToolLoop`） | `dev-piece-catalog` 37, `dev-retro-renderer` 26, `dev-input-keyboard` 25 | `dev-game-session` 38, `dev-scoring` 38, `dev-persistence` 34, `dev-board-engine` 24 |
| gates 和其他 `ToolLoop` | `anamnese` 32, `qa-automacao` 20, `appsec` 3 | `qa-estrategia` 16, `appsec` 3, `infra-workflows` 2, `anamnese` 2 |
| 会话型 | `po` 8, `criativo` 5, `arquiteto` 5 | `infra` 2, `dev-lead` 1 |

验证由 dev agents（160 个有工具步骤中的 134 个）和一个 gate（`qa-estrategia`，16）
主导。拟合那一半带有 32 个 Anamnese 步骤，当智能体使用 `skip_proficiency` 时
（32 个中的 30 个），Jev 回答 `responder_sem_ferramenta`：去掉它们，拟合按等价为
94/129 = 73%，与验证相同。

### 尝试过的变体（全部） {#variants-tried-all-of-them}

`tokens` 是输入的中位大小；延迟单位为 ms（p50 / 最大），从维护者机器顺序请求。
只计有工具的步骤。

| 变体 | 相对上一个增加了什么 | 拟合 严格 → 等价（top-2） | 验证 严格 → 等价（top-2） | tokens | 延迟 |
|---|---|---|---|---|---|
| `original` | 无——第一轮的 `state` | 39% → 48% (83%) | 49% → 58% (82%) | 1 687 | 322 / 780 |
| `kickoff` | `pedido` = 循环的第一条消息，从 engine 代码重建 | 55% → 58% (89%) | 65% → 73% (91%) | 1 867 | 318 / 612 |
| **`escopo`** | 只取当前执行的近期步骤（`ctx.messages` 在每次 `ToolLoop.run` 时重新开始） | **57% → 59% (89%)** | **66% → 73% (90%)** | 1 867 | 312 / 814 |
| `resultados` | 结果/参数最多 2 000 个字符 | 53% → 55% (91%) | 62% → 69% (88%) | 2 011 | 314 / 699 |
| `texto` | 之前步骤中模型的文本 | 53% → 55% (91%) | 64% → 73% (93%) | 2 090 | 315 / 685 |
| `progresso` | 派生的计数（到目前为止的步骤、按工具的调用、最后一个工具、已运行的测试……） | 55% → 57% (91%) | 65% → 70% (93%) | 2 224 | 309 / 817 |
| `trilha` | `escopo` + 本次执行的完整工具序列（仅名称） | 53% → 57% (91%) | 64% → 71% (89%) | 1 936 | 310 / 614 |
| `fluxo` | `trilha` + 一个说明智能体以爆发方式工作的问题 | 49% → 55% (92%) | 64% → 75% (93%) | 2 014 | 309 / 586 |
| `enxuto` | `trilha`，只保留最后 2 次调用 | 50% → 54% (89%) | 63% → 74% (91%) | 1 429 | 307 / 920 |
| `so_trilha` | `trilha`，不含任何近期调用 | 39% → 44% (80%) | 33% → 56% (83%) | 1 168 | 307 / 480 |
| `acoes` | `escopo` + 等待过审批的命令的结果（从动作结果重建） | 50% → 53% (91%) | 53% → 61% (89%) | 2 333 | 348 / 1 352 |
| `acoes_completo` | `acoes` + 2 000 个字符 + 文本 + 进度 | 47% → 51% (92%) | 51% → 58% (92%) | 3 360 | 326 / 845 |

从 `original` 到 `progresso` 的六行（下面的级联）是在第一次请求之前写下的。另外
六行是之后写的，作为对拟合结果的回应，是在拟合那一半上的普通搜索：`trilha`、
`fluxo`、`enxuto` 和 `so_trilha` 尝试以更易读的形式给 Jev 执行的模式；`acoes` 和
`acoes_completo` 来自看到许多近期步骤读到 `(sem resultado gravado)`（等待过审批
的命令）。

**胜出者是 `escopo`**，在拟合上选出（最好的 top-1，严格和按等价都是）；没有用验证
来选择。表中有两点值得读：`kickoff` … `progresso` 之间的差异都在置信区间之内
（±7 个百分点），因此在第一步之后无法表明"更多输入"有害或有益；`fluxo` 有最好的
验证数字（75%），但在拟合上低于胜出者（55% 对 59%），这就是它没有胜出的原因
——现在选它就等于按验证来选。

每个新字段在 engine 中的来源（`apps/engine/lib/engine/…`）：

| 字段 | 来源 |
|---|---|
| `pedido`（dev） | `initial_message/2`，`dev/dev_agent_server.ex:484`；任务和用户故事的标题来自 `tasks`/`stories` |
| `pedido`（`qa-automacao`） | `initial_message/2`，`gates/qa_automacao_agent.ex:108`；最后一个 `dev.awaiting_gate` 的任务、用户故事的需求 |
| `pedido`（`qa-estrategia`、`appsec`） | `gates/qa_estrategia_agent.ex:93`、`gates/appsec_agent.ex:79`；**用户故事无法从日志恢复**，所以消息说明这一点并携带模块映射 |
| 按执行的近期步骤 | `ToolLoop.Default.init/1` 和 `loop/1`（`harness/tool_loop.ex`）：`messages` 由 `run` 组装 |
| 完整结果、`texto` | `loop/1` 追加的 `tool` 和 `assistant` 消息（`concluir_despacho/5`、`append(ctx, message)`）；日志把结果截断在 2 000 |
| 已批准命令的结果（`acoes`） | `texto_do_desfecho/1`，`dev/dev_agent_server.ex:460`；日志中没有它们的 `tool.result`，只有 `proposed_actions.execution_result` |
| `progresso`、`trilha` | 对同一 `messages` 中本次执行之前调用的计数 |

未移植的，在 `kickoff.ts` 中说明：Anamnese（它的消息由日志的一个窗口和成员列表
组装，而日志不保存这些）、`infra-workflows`（上下文映射），以及会话型智能体（它们
的 `pedido` 仍是用户的最后一条消息）。

### 级联（验证，有工具的步骤） {#the-cascade-validation-steps-with-a-tool}

每一行都是上一行再加一块，在同样的 160 个步骤上。

| 步骤 | n | top-1（95% CI） | top-2（95% CI） |
|---|---|---|---|
| 第一轮的输入，严格规则 | 160 | 78/160 = 49% (41–56%) | 118/160 = 74% (66–80%) |
| + E1 终端读取 ≡ 读取 | 160 | 92/160 = 57% (50–65%) | 125/160 = 78% (71–84%) |
| + E2 `read_file` ≡ `search_workspace` | 160 | 93/160 = 58% (50–65%) | 131/160 = 82% (75–87%) |
| + E3 写入的终端 ≡ `write_file` | 160 | 93/160 = 58% (50–65%) | 131/160 = 82% (75–87%) |
| + `pedido` = 循环的第一条消息 | 160 | 116/160 = 73% (65–79%) | 145/160 = 91% (85–94%) |
| + 只取当前执行的近期步骤 | 160 | 117/160 = 73% (66–79%) | 144/160 = 90% (84–94%) |
| + 结果最多 2 000 个字符 | 160 | 110/160 = 69% (61–75%) | 141/160 = 88% (82–92%) |
| + 之前步骤中模型的文本 | 160 | 116/160 = 73% (65–79%) | 149/160 = 93% (88–96%) |
| + 派生的计数 | 160 | 112/160 = 70% (62–77%) | 148/160 = 93% (87–96%) |

两行承载了全部变化：等价（+9 个百分点）和循环的第一条消息（+15）。`escopo` 之后
没有任何东西让 top-1 移出区间，而为已批准命令重建的结果（`acoes`）反而让它下降。
第一轮的 47%，在同一输入上，在声明的等价下是 58%。

### 标题数字 {#the-headline}

变体 `escopo`，验证，160 个有工具的步骤（另有 1 个无工具的，Jev 判错）：

| | |
|---|---|
| **top-1，等价规则** | **117/160 = 73% (66–79%)** |
| top-1，严格规则（可与 47% 比较） | 105/160 = 66% (58–73%) |
| top-2（菜单限制为 2），等价 / 严格 | 144/160 = 90% (84–94%) / 134/160 = 84% (77–89%) |
| top-3，等价 | 148/160 = 93% (87–96%) |
| 基线"重复上一个工具"（免费），等价 / 严格 | 122/149 = 82% (75–87%) / 108/149 = 72% (65–79%) |
| 无第二次调用的 2 项菜单，{Jev 的选择, 上一个工具}，等价 / 严格 | 140/160 = 88% (81–92%) / 125/160 = 78% (71–84%) |
| 不含 Anamnese（kickoff 未重建；在产品中已暂停） | 115/158 = 73% (65–79%) |

**Jev 没有胜过免费基线。** 在相同的验证步骤上，"重复上一个工具"达到 82%（严格
72%），高于 Jev 的 73%（66%）。它唯一的优势出现在并集中：同时提供 Jev 的选择*和*
上一个工具达到 88%（严格 78%），比单独的 Jev 高 15 个百分点，且无额外调用。没有
任何配置在 top-1 上达到 90%，也没有任何配置的下限达到 90%。

按智能体（验证，等价）：`dev-board-engine` 23/24 = 96% (80–99%)，
`dev-persistence` 28/34 = 82% (66–92%)，`dev-scoring` 31/38 = 82% (67–91%)，
`dev-game-session` 28/38 = 74% (58–85%)，**`qa-estrategia` 4/16 = 25% (10–49%)**，
`appsec` 1/3，`infra` 0/2，`infra-workflows` 0/2，`dev-lead` 0/1（`qa-estrategia`
和 `appsec` 的第一条消息已重建但不含用户故事；另外三个完全没有重建）。

置信度仍然无法区分对错：

| 阈值 | 菜单限制为 1 | 被限制者中正确的（95% CI） |
|---|---|---|
| 0.00 | 155/160 | 117/155 = 75% (68–82%) |
| 0.40 | 123/160 | 95/123 = 77% (69–84%) |
| 0.60 | 55/160 | 44/55 = 80% (68–88%) |
| 0.70 | 32/160 | 23/32 = 72% (55–84%) |
| 0.80 | 16/160 | 8/16 = 50% (28–72%) |
| 0.90 | 10/160 | 4/10 = 40% (17–69%) |

高于 0,7 时准确率*下降*：高置信度的错误就是下面描述的那些（Jev 确信写完测试之后
就是运行它们）。

### 按原因的差距 {#the-gap-by-cause}

按第一轮规则的 82 个验证错误，以及级联中每一块对它们做了什么（有工具的步骤，
n = 160）：

| 原因 | 步骤 | 百分点 | 占差距的份额 |
|---|---|---|---|
| **标尺**——Jev 的选择是等价的（E1–E3，事先声明） | 15 | 9.4 | |
| **标尺**——剩余：这些类仍漏掉一种情况（3 个步骤，见下） | 3 | 1.9 | 22%（18 个步骤） |
| **输入**——循环的第一条消息（`kickoff`） | 23 | 14.4 | |
| **输入**——`escopo` | 1 | 0.6 | |
| **输入**——剩余：未重建的第一条消息，或日志之外的结果（7） | 7 | 4.4 | 38%（31 个步骤） |
| **智能体的节奏**，而不是 state 的某个字段（见下） | 29 | 18.1 | |
| **Jev 在 state 不能解释的情况下产生分歧**（4） | 4 | 2.5 | 40%（33 个步骤） |
| 合计 | 82 | 51.3 | |

在最后一块恢复之后剩下的 43 个错误被逐一阅读（不是抽样）：发送的 state、调用的
工具、模型自己在该步骤中的文本（Jev 从未看到），以及 Jev 的选择和置信度。结果：

- **标尺，3 个。** `dev-board-engine` `terminal`→`search_workspace`：智能体的
  命令是 `find … | sort; ls; for f in docs/*; do …cat`——只读，但 `for` 循环不在
  只读列表中，因此按执行计分。另外两个 `read_file`→`terminal`，其中智能体一直通过
  `terminal` 读取：在任何解读下都等价，但这些类故意不对称，并且没有重新计分。
- **输入，7 个。** `infra`（2 个步骤）、`infra-workflows`（2）和 `dev-lead`（1）
  的全部错误——移植没有重建其第一条消息的五个步骤——再加上两个
  `report_done`→`terminal`，其中最后一个命令的结果（"exit 0, a suíte passou"）
  不在日志中。变体 `acoes` 重建了这些结果，而总体上让 Jev *更差*（61%）：面对一个
  失败的沙箱，它说 `report_blocked`，而智能体继续尝试。
- **智能体的节奏，29 个。** Jev 说出流程的*下一阶段*，而智能体在当前阶段多停留
  一步：14 × `write_file`→`terminal`（Jev："测试已写好，运行它们"，其中 8 个置信度
  ≥ 0,6，最高 0,98；智能体之前又写了两三个文件），12 × `qa-estrategia`
  `read/search`→`emit_plano_de_teste`（Jev 以 0,25–0,56 的置信度跳到 kickoff 的
  最终工具；智能体在发出之前探索了约 15 步），2 × `appsec` 同样，1 ×
  `terminal`→`report_blocked`（在一个被拒绝的动作之后）。在所有这些中，Jev 的
  选择都是日志读者会称之为自然下一步的东西。决定"再多几个文件、再多几次读取"的是
  模型的计划，而它不在产品能交给路由器的任何字段中——它只存在一次，就在正在被预测
  的那一步本身的文本里。
- **Jev 产生分歧，4 个。** `write_file`→`search_workspace` 两次，置信度
  0,25–0,26；`rag_search`→`terminal` 两次（0,24、0,59）。这是 state 无法解释
  选择的唯一步骤：2,5% 的步骤。

所以：在第一轮的 49% 与 100% 之间 51 个百分点的差距中，大约**五分之一是标尺，
大约五分之二是回放缺少的输入**（其中可恢复的部分已经恢复），**五分之二是智能体的
节奏**，而 **5% 的步骤是 Jev 的纯粹错误**。输入剩下的最多 4 个百分点，并不是把
73% 与 90% 分开的东西。

### 达到 90% 需要什么，以及每一块值多少 {#what-would-be-needed-for-90-and-what-each-piece-is-worth}

验证步骤，43 个错误；90% 是 144/160，即还需要 27 个命中。

| 一块 | 最多步骤 | 说明 |
|---|---|---|
| 完成输入的移植（Anamnese、`infra-workflows`、会话型智能体的第一条消息；`qa-estrategia` 的用户故事） | 最多 +7 → 79% | 一个上限：输入完整时 Jev 在这里并没有更好，而重建结果反而让它变差 |
| 收紧这些类（`for` 循环，反方向的终端即读取） | +3 → 75% | 这是标尺，不是准确率；在看到错误之后再决定这一点正是协议所禁止的，因此不在标题数字中 |
| 智能体的节奏 | 最多 +29 | 不是 state 的字段；唯一的入口是**包含上一个工具的 2 项菜单**（实测：88%，81–92%）或 top-2（90%，84–94%） |

作为产品决策来读（这属于 AT-239）：一个必须*选出一个*工具的路由器停留在约四分之三，
并低于免费基线；一个*把菜单限制为两个*的路由器达到十分之九，而上一个工具作为第二
个名字，与 Jev 自己的第二选择一样好。本节不声称这两种收益中的任何一种。

### 延迟与成本（变体 `escopo`） {#latency-and-cost-variant-escopo}

| | |
|---|---|
| 每个请求的输入 token | p50 1 866，p95 2 557，最大 3 220（第一轮：中位数 1 710，最大 3 220） |
| 延迟（328 个请求，顺序） | p50 317 ms，p95 449 ms，最大 814 ms；**0 个超过 2 000 ms** |
| 成本 | 每步 US$ 0,0000769（328 步 US$ 0,025233），对 328 个 id 逐个 `GET /api/v1/generation` 合计同样的 US$ 0,025233（比率 1,000） |
| 本轮全部 | 按 `usage.cost` 为 US$ 0,414——12 个变体，其中 3 个在拟合那一半的部分上跑了两次——上限为 US$ 1,00 |

更丰富的变体消耗更多输入（`acoes_completo`：中位数 3 360 token，每步约
US$ 0,00014 对比 0,00008），却什么也换不来；胜出的 state 也是便宜的那个。
AT-236 的 2 000 ms 上限有两倍的余量。

### 本轮仍然看不到的东西 {#what-this-round-still-cannot-see}

- 在任何代码之前运行的两个 gates（`qa-estrategia`、`appsec`）的**用户故事**：启动
  它们的请求是内部的，不进入日志。
- **Anamnese**、`infra-workflows` 和会话型智能体的第一条消息；以及 `contexto`
  背后的系统提示词。
- **基准真相。** 标签仍然是聊天模型调用的工具，而 29 个节奏错误中的大多数是人类
  读者会认为合理的选择，这就是为什么 top-2 和并集比 top-1 说明更多。
- **效果。** 受限的菜单会改变模型接下来的行为；AT-239。

## 2 项菜单（2026-09-29）：限制而不是挑选 {#menu-of-2-options-2026-09-29-restrict-instead-of-pick}

> 在第二轮之后由负责人提出，那一轮中 Jev 的 top-1（73%）低于 90%，但两项菜单
> （{Jev 的选择, 上一个工具}）和 Jev 的 top-2 看起来不错：**测试 2 项菜单**。只有
> **95% 区间下限至少为 90%** 的结果才是明确的"是"。**不是：没有任何策略达到。**
> 最好的 2 项策略 P3 覆盖了验证步骤的 **91%（85–94%）**，即正确的工具在菜单之内；
> 下限为 85%，比界线低五个百分点。而这是*覆盖率*，是端到端准确率的上限（见
> "上限"），不是准确率本身。同一实例，与前几轮相同的保留；这里的任何东西都不改变
> 产品（那是 AT-239）。用 `pnpm --filter @brabo/scripts jev:menu` 复现。

### 策略（运行前写在 `scripts/jev/menu.ts` 中） {#policies-written-before-running-in-scriptsjevmenuts}

一个策略把 Jev 的回答变成受限菜单。负责人的决定处处适用：Jev 只**限制**菜单，当它
回答 `responder_sem_ferramenta` 时保留**完整**目录（AT-236）；上限 2 000 ms（第二轮
328 个请求中 0 个超过）。看到结果后没有重新分类任何东西；`menu.spec.ts` 固定了每个
策略返回什么。

| 策略 | 菜单 |
|---|---|
| P0 | 完整目录（锚点：100% 覆盖，不限制任何东西） |
| P1 | Jev 最可能的两个工具 |
| P2 | {Jev 的选择, 同一执行中的上一个工具} |
| P3 | P2，但如果 Jev 说 `responder_sem_ferramenta`（或没有上一个工具），菜单为完整目录 |
| P4 | {选择, 上一个工具, Jev 的第二选择}（最多 3 个；仅作参考） |

所有策略共同的规则：失败的回答（超时、错误、选项之外的选择）保留完整目录；不在
智能体目录中的上一个工具被忽略；本会为空的菜单就是完整目录。

**覆盖率** = 在有工具的步骤中，智能体实际调用的工具位于菜单*之内*的比例——严格
（同名）和按等价（第二轮的 E1–E3 类，因此含 `read_file` 的菜单覆盖一个只读的
`terminal`）。**限制率** = 菜单小于智能体目录的步骤比例：几乎从不限制的策略会平凡
地"100%"且毫无用处，因此也给出*被限制步骤中*的覆盖率。变体 `escopo`（第二轮的
胜出者），验证那一半，160 个有工具的步骤（另有 1 个无工具）。

### 数字（验证） {#the-numbers-validation}

| 策略 | 覆盖率，等价（95% CI） | 严格 | 限制 | 被限制者中的覆盖率 | 暴露的工具，之前 → 之后 | 每次调用的定义 token，之前 → 之后 |
|---|---|---|---|---|---|---|
| P0 | 160/160 = 100% (98–100%) | 100% | 0/160 = 0% | — | 7.4 → 7.4 | 746 → 746 |
| P1 | 144/160 = 90% (84–94%) | 134/160 = 84% (77–89%) | 158/160 = 99% | 142/158 = 90% (84–94%) | 7.4 → 2.0 | 746 → 150 |
| P2 | 143/160 = 89% (84–93%) | 128/160 = 80% (73–85%) | 157/160 = 98% | 140/157 = 89% (83–93%) | 7.4 → 1.3 | 746 → 102 |
| **P3** | **145/160 = 91% (85–94%)** | 132/160 = 83% (76–88%) | 147/160 = 92% (87–95%) | 132/147 = 90% (84–94%) | 7.4 → 1.6 | 746 → 138 |
| P4 | 149/160 = 93% (88–96%) | 142/160 = 89% (83–93%) | 158/160 = 99% | 147/158 = 93% (88–96%) | 7.4 → 2.2 | 746 → 166 |

**哪个最好。** 重要的是 P3：它是 2 项策略中覆盖率最高的，遵守负责人的规则，并限制
了 92% 的步骤。**它的下限是 85,1%；P1 是 84,4%，P2 83,6%，P4 88,1%。** P4 最接近
界线，但最多 3 项的菜单不是所提出的问题。所有策略都没有得到"明确的是"；P1 和 P3 的
点估计正*落在* 90%，与第二轮 top-2 已有的"90% (84–94%)"相同——上一个工具相对 Jev
自己的第二猜测没有为覆盖率增加任何东西，它只是让菜单更小（1,6 个工具对 2,0）。

**表格隐藏的两件事。**

- **P3 在 160 个步骤中有 98 个只提供一个工具。** 当 Jev 的选择*就是*上一个工具时，
  菜单只有一个名字（P2：160 中的 108）。这些菜单覆盖 98 中的 89（91%）。其余 49 个
  被限制的步骤菜单有两项，覆盖 43（88%）。"2 项菜单"在大多数时候是一个不给智能体
  留任何选择的 1 项菜单：它是被强制的。
- **区间是乐观的。** Wilson 把 160 个步骤当作独立的，而它们并不独立：验证是
  **10 次执行**（四个 dev agents 的任务，gates `qa-estrategia`、`appsec` 和
  `infra-workflows`，以及 Anamnese、Infra 和 Dev Lead），一次执行中的连续步骤共享
  请求、文件和结果。簇这么少，诚实的区间比打印出来的更宽。这不改变答案（"否"不会
  变好），但"是"也不会靠 160 个步骤赢得。

### 拟合与新步骤 {#tuning-and-the-new-steps}

| 策略 | 拟合（161 步）覆盖率，等价 | 限制 | 新步骤（36）覆盖率 |
|---|---|---|---|
| P1 | 144/161 = 89% (84–93%) | 156/161 = 97% | 36/36 |
| P2 | 143/161 = 89% (83–93%) | 127/161 = 79% | 36/36 (restringe 0) |
| P3 | 147/161 = 91% (86–95%) | 115/161 = 71% | 36/36 (restringe 0) |
| P4 | 148/161 = 92% (87–95%) | 156/161 = 97% | 36/36 |

拟合与验证说的一样（P3 91%，下限 86%），正如预期，因为没有任何策略被调整过。它
带有 32 个 Anamnese 步骤，对这些步骤 Jev 说 `responder_sem_ferramenta`，因此 P3
保留完整目录：限制率 71% 而不是 92%。**36 个新步骤**（快照之后 dev 数据库从 333
行用量增加到 369 行）**全部来自 Anamnese**，一个在产品中已暂停的智能体：Jev 回答
"无工具"，P2/P3 打开完整目录，所以"36/36"是平凡的真，对菜单什么也没说。全部步骤
合在一起且不含 Anamnese（287 个有工具；拟合那一半已经选择了变体，所以这*不是*干净
的验证）：P1 89% (84–92%)，P2 88% (84–91%)，**P3 90% (86–93%)**，P4 92%
(88–94%)。更多步骤会收窄区间，但下限停在 86%；真实覆盖率接近 91% 时，大约需要
三千个步骤下限才会超过 90%，而有帮助的是更好的路由器，不是更大的样本。

敏感性，而非选择：用十二个 `state` 变体中的任何一个，P2 覆盖验证步骤的 88–91%，P3
覆盖 89–92%，因此结果不依赖于 `escopo`（P1 依赖：原始输入时 82%，`texto` 或
`fluxo` 时 93%）。也没有任何变体的下限达到 90%——最高的是 P1 配 `texto`（88%）和
P3 配 `enxuto`（87%）——而在看到这些之后再选一个，正是协议所禁止的。

### 覆盖在哪里失败 {#where-coverage-fails}

P3，验证，菜单之外的 15 个步骤：菜单为 `terminal` 时使用了 `write_file`（4），
`terminal` 时使用 `read_file`（2），`terminal` 时使用 `report_done`（2），
{`search_workspace`, `terminal`} 时使用 `write_file`（2），以及 gates 和会话型智能体
之间的五个零散情况（提供了 `emit_plano_de_teste` 而不是 `rag_search` 或
`search_workspace`，以及相反）。这是从另一面看到的第二轮的节奏差距：Jev 说出下一
阶段，智能体在当前阶段多走一步——而菜单为 `terminal` 的智能体无法用专门的工具写
文件。按智能体（P3，等价）：`dev-board-engine` 23/24 = 96% (80–99%)，
`dev-scoring` 35/38 = 92% (79–97%)，`dev-persistence` 31/34 = 91% (77–97%)，
`qa-estrategia` 14/16 = 88% (64–97%)，`dev-game-session` 32/38 = 84% (70–93%)；
其余的少于四个步骤。

### 上限：覆盖率没有说的 {#the-ceiling-what-coverage-does-not-say}

**覆盖率是端到端准确率的上限，不是准确率。** 菜单包含正确的工具；智能体的模型仍需
在选项中选中它。标签（"聊天模型调用的工具"）是智能体*从完整目录中*做出的选择，因此
完整菜单按构造就是 100%，而受限菜单只会损失。不借助产品可以说的，对验证上的 P3，
把 160 个步骤分开：

- **99（62%，54–69%）**：菜单中的每个工具都正确，因此智能体的任何选择都正确——
  下限。
- **46 个是"有争议的"**：恰好一个选项正确，由智能体自己决定——28 个只有上一个工具
  正确，18 个只有 Jev 的选择正确。总是选上一个工具的智能体结果为 127/160 = 79%；
  总是选 Jev 选择的，117/160 = 73%（又是第二轮的基线）；抛硬币的，76%。一个比两者
  选得都好的智能体——这正是全部赌注——落在 79% 与上限 91% 之间。
- 其余 15 个在菜单之外：无论智能体做什么都丢失。

所以端到端的范围是 62% 到 91%，落在哪里取决于智能体的模型对*情境*的理解程度，而
回放看不到这一点。**只有实时测试（AT-239）能回答。**

### 工具定义上的节省 {#savings-in-tool-definitions}

目录原本有每个工具的*描述*（`catalogo.json`），现在还有 `definicoes`：每个工具完整
`spec/0`（名称、描述和参数 schema）的字节大小，由 engine 序列化（`catalogo.exs`，
重新运行；文件其余部分没有变化）。token 是字节除以 4，这是整个回放使用的近似值。
在验证上，P3 从**每次调用 746 个定义 token 降到 138——少 608 个 token，减少
81%**：一个 dev agent 的八个工具重 3 068 字节，一个两项菜单约重 500。P1 节省 596，
P2 节省 644（对该一半步骤的平均值；拟合那一半节省较少，因为 Anamnese 保留完整
目录）。

这值多少是另一个问题。对 Jev 的调用本身读取约 1 870 个 token（US$ 0,0000769），
所用模型比智能体的模型便宜得多；定义上的节省是每次调用智能体模型的 608 个 token。
平衡点是每百万 token US$ 0,126 的输入价格（0,0000769 / 608）：高于它，节省就能支付
对 Jev 的调用，不考虑缓存。**缓存是陷阱**：provider 会缓存请求的前缀，工具定义在
最前面，而一个逐步变化的菜单会改变前缀——节省可能在缓存未命中中被吐回去。这需要
实时测量，也是下面的测试记录缓存 token 比率的原因。

### 实时测试（未执行）：设计 {#the-live-test-not-run-design}

- **问题。** 在智能体面前放上 P3，智能体的工作是否变差，又便宜了多少？不是"工具在
  菜单里"（那是本节）。
- **阶段 1，影子（便宜，在任何用户看到菜单之前）。** 对保留样本中的每个步骤，就同一
  个 state 两次询问*智能体自己的模型*，一次用完整目录，一次用 P3 的菜单，并按等价
  规则比较它选择的工具。指标：两者之间的一致率，以及 95% 区间的下限。要显示真实
  一致率 94% 且下限在 90%（检验力 80%）：约 **390 个步骤**，取自**至少 40 次不同的
  执行**和**不止一个项目**（本样本是一个项目中的 21 次执行），按簇（执行）而不是按
  步骤计算区间。
- **阶段 2，实时 A/B，仅当阶段 1 通过。** 两组：对照（完整目录）和 P3，**按执行**
  抽签，绝不按步骤（一个步骤的菜单塑造下一个步骤）。主要指标：执行在无返工的情况下
  到达 gate，非劣效界值 5 个百分点；完成率 80%、单侧 5%、检验力 80% 时，约**每组
  790 次执行**（10 个百分点的界值需要约 200）。以本项目的量（整个样本中 7 次 dev
  执行），这需要很多项目或数周。次要指标：每次执行的步骤、输入 token *包括缓存
  token 比率*、每次执行的成本、Jev 增加的延迟（p50/p95，上限 2 000 ms），以及 Jev
  保留完整目录的步骤份额。
- **防护。** 每个项目一个关闭开关；在 Jev 任何失败或超过延迟上限时回落到完整目录
  （所有策略已如此）；当菜单没有智能体需要的东西时，让智能体能请求完整目录（单项
  菜单会强制工具，这里是 61% 的步骤）；每 100 次执行做一次中期查看，若主要指标下降
  超过界值则停止；Anamnese 不进入样本（已暂停）；每个步骤都记录菜单和选择，使分析
  成为一次查询而不是一段回忆。

### 本节仍然看不到的东西 {#what-this-section-still-cannot-see}

- **智能体在菜单内的选择**：这就是它是上限的原因。
- **步骤之间的依赖**：验证中有 10 个簇；区间是按步骤的。
- **提示词缓存**和**智能体循环中的延迟**：未测量（对 Jev 的调用测了，p50 317 ms；
  它在循环中的影响没有）。
- **标签**：仍然是聊天模型调用的工具，而受限菜单会改变它接下来的行为。

### 本测试的成本 {#cost-of-this-test}

一次调用，针对 36 个新步骤：按 `usage.cost` 为 **US$ 0,001275**（任务上限
US$ 0,30）。策略在已在磁盘上的回答之上离线运行。输出目录的累计花费从 US$ 0,4136
变为 US$ 0,4149。

## 实时对比（AT-239，2026-10-01）：限制，Haiku 开启，DeepSeek 关闭 {#live-comparison-at-239-2026-10-01-restrict-on-for-haiku-and-off-for-deepseek}

> AT-239（EP-029，HS-063）提出了之前每一节都悬而未决的问题：**开启路由器时，轮次
> 是否更短、更快或更便宜，而工作仍然完成？** 同样的任务，在同一个 OpenRouter 模型
> 上，[ADR 0179](../adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md) 的路由开启
> 和关闭，在两个速度不同的聊天模型上。
>
> **2026-10-01 的状态：在第三次尝试中测得**（见下）。**第一次尝试：未测得。**
> 构建该工具的会话（分支 `test/jev-com-e-sem`，基于 `dev` 的 `d070b000d7`）有一把
> 付费密钥和 US$ 5,00 的上限，但它的出站代理按组织策略拒绝了对 `openrouter.ai:443`
> 的 `CONNECT`，对 `repo.hex.pm` 和 `builds.hex.pm` 也是，因此连 engine 都无法编译。
> 没有任何聊天调用、也没有任何 Jev 调用离开机器：**花费 US$ 0,00**。下面是在任何
> 执行**之前**写下的工具、协议和决策规则，无需网络就能测得的数字，然后是第三次
> 尝试的实时表格。
>
> **第二次尝试，同一天：仍未测得，原因不同。** 负责人在会话的出站中放行了
> `openrouter.ai`（一个 `GET` 返回 200），协议的两个模型都被列为支持工具
> （`deepseek/deepseek-v4.1-flash` 每百万输入/输出 US$ 0,03/0,50，
> `anthropic/claude-haiku-4.5` US$ 1,00/5,00）。第一个聊天调用返回
> `HTTP 403 Key limit exceeded (total limit)`：测试密钥的限额为 US$ 10,00，已用
> US$ 10,05 且没有重置（`GET /api/v1/key`）。一个单任务的 smoke，在协议之外、在
> 单独的目录中，花费 **US$ 0,00**；没有记录任何协议执行。运行它需要负责人提高密钥
> 限额（或提供另一把密钥）——按下面的估算约 US$ 1,28，按 DeepSeek 的现价更少。
> smoke 还发现了两件假网络永远不会发现的事，都已在工具中修正或记录：
>
> - **账户或网络故障被记录为已测量的执行。** smoke 的两次执行都在步骤 0 以
>   `HTTP 403` 结束为 `erro`，在输出中被记录为"任务未完成"，而恢复永远不会重做它们：
>   用一把失效的密钥，全部 40 次执行都会进入表格。`falhaDeInfra`（`resumo.ts`）现在把
>   HTTP 401/402/403/407/429 的聊天错误或传输错误归类为测量没有发生；`vivo.ts` 不记录
>   该执行，带着原因停止执行，恢复时重做它。200 响应体中的 provider 错误、5xx 和
>   Jev 的回落仍是该组的结果，与 engine 中一样。
> - **Node 的 `fetch` 忽略 `HTTPS_PROXY`。** 在代理之后，用
>   `NODE_USE_ENV_PROXY=1` 运行（Node ≥ 22.21）；没有它，调用会直连，出站返回 403，
>   且响应体不是 JSON。
>
> **第三次尝试，同一天：已测得。** 负责人把密钥限额提高到 US$ 20,00（执行前剩余
> US$ 9,95）并放行了 US$ 4,50 的上限。下面的协议完全按写的那样运行——两个模型、五个
> 任务、两轮、40 次执行、`jev:vivo` 的默认值——在提交 `0eab0cb0e9` 上，没有任何账户
> 或网络故障，也没有被中断的执行。**花费：US$ 0,5195**，按输出中 `usage.cost` 之和
> （DeepSeek US$ 0,0424，Haiku US$ 0,4771）；密钥的 `usage` 走了同样的 US$ 0,5195
> （US$ 10,0545 → US$ 10,5739，在执行后约十分钟读取——执行刚结束时的读数仍显示
> US$ 0,4597，计费相对响应有延迟）。表格和结论在下面的"实时表格"和"建议"中；数字
> 到来之后，协议、规则和估算都没有改动。

### 工具运行什么，什么是移植 {#what-the-instrument-runs-and-what-is-a-port}

`pnpm --filter @brabo/scripts jev:vivo`（文件在 `scripts/jev/vivo/`）在五个小任务上
运行一个 dev agent 的循环，一次开启路由器、一次关闭，并直接调用 OpenRouter——不涉及
api、engine 和数据库，与 AT-167 的付费语言验证一样。

| 文件 | 作用 | 产品还是移植 |
|---|---|---|
| `roteador.ts` | `recortarEstado`、`montarPedidoAoJev`、`lerRespostaDoJev`、`menuP3`、`state` 的上限 | **产品代码**，从 `apps/api/src/domain/llm/tool-router.ts` 重新导出 |
| `laco.ts` | 循环：迭代上限、恢复以文本写出的工具调用、在被接受的 `report_done`/`report_blocked` 处停止、当受限菜单收到无工具回答时用完整目录的唯一一次重试 | `ToolLoop`、`EngineApiClient.llm_turn/5` 和 `DecidirFerramentaDoPassoUseCase` 的移植 |
| `recuperacao.ts` | 哪些步骤经过了 `tool_call_recovery.ex` | 移植；它的 spec 运行 `tool_call_recovery_test.exs` 的用例并固定 `.ex` 的锚定行 |
| `rede.ts` | 聊天调用（线上的消息与 api 写的一样）和 Jev 调用（上限 2 000 ms，同样命名的回落） | `toWireMessage`/`toWireTool` 和 `JevToolRouter` 的移植；锚定行已固定 |
| `ferramentas-dev.exs` → `ferramentas-dev.json` | `Engine.Dev.Tools.registry/0` 九个工具的**完整** `spec/0`（名称、描述、参数 schema） | 用纯 `elixir` 从 engine 源码读取，无需编译 engine；注册表或描述漂移时一个 spec 失败 |
| `tarefas.ts` | 一个无依赖 Node 项目上的五个任务，每个都在循环**之后**运行一次检查（恢复原始测试，追加隐藏测试）："任务完成" | 工具自身的 |
| `executor.ts` | 临时沙箱中的工具，在 engine 文本于代码中固定的地方返回这些文本 | 工具自身的 |
| `resumo.ts`、`vivo.ts` | 表格、决策规则、成本估算、CLI | 工具自身的 |

工具之外、两组相同且已声明的：审批管道（`terminal` 和 `write_file` 直接运行，与
自动模式一样）、上下文压缩、在每次调用末尾追加的语言引导和作者画像、RAG（空索引）、
模块契约（未声明任何）、以及真实系统提示词的其余部分（指令文件、业务规则、任务状态）。
系统提示词是 engine 的 dev 身份加两行项目上下文；第一条用户消息是 engine 自己的
kickoff（`scripts/jev/kickoff.ts`）。每次调用的成本是响应的 `usage.cost`，即 RN-665
（[ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)）放进
metering 的数字；不涉及产品的 `token_usage`。

### 协议（在任何执行之前写下） {#protocol-written-before-any-run-1}

- **模型**：`deepseek/deepseek-v4.1-flash`（较慢，推理型）和
  `anthropic/claude-haiku-4.5`（较快），AT-167 的验证已在这把密钥上带着工具定义
  调用过的两个模型。
- **任务**：`T1-media`（实现一个函数）、`T2-moeda`（修复一个格式化 bug）、
  `T3-limite`（原因在另一个文件：`config/`）、`T4-slug`（创建一个模块及其测试；
  隐藏测试对其核对）、`T5-renomear`（在两个文件中重命名；`src/` 中不得留下旧名称
  的任何残余）。每个任务的初始状态在检查中失败，而参考解通过（spec）。
- **样本**：2 轮 → 每个模型每组 10 次执行，共 40 次。两组的顺序按任务和轮次交替，
  使没有哪一组总是赶上 provider 最慢的那一分钟。迭代上限 30（产品的 dev 上限是 60；
  这里它限制花费）。
- **每次执行**：步骤；调用以**文本**形式到来并经过恢复的步骤；咨询了路由器的步骤、
  应用了更小菜单的步骤、无回落地保留完整目录的步骤（没有上一个工具，或 Jev 说
  `responder_sem_ferramenta`），或**回落**的步骤（带原因和 RN-059 来源）；用完整目录
  的重试；步骤菜单之外的调用；整个执行（Jev + 聊天 + 工具）和 LLM 部分的挂钟延迟；
  聊天和 Jev 的成本；如何结束；任务是否完成。
- **决策规则**（`resumo.ts` 中的 `comparar`），按模型，开启对关闭：质量——*开启*的
  "任务完成"率不比*关闭*低超过 **10 个百分点**；成本——*开启*每个完成任务的平均成本
  （聊天 + Jev）不高于*关闭*；延迟——*开启*的中位执行不高于*关闭*的 **1,2×**。三条在
  每个模型上都成立则**默认保持开启**；质量在每个模型上都失败或没有模型三条全过则
  **关闭**；否则**限制**到通过的模型。每组少于 10 次执行是 `amostra_insuficiente`，
  绝不是结论。

### 成本估算（无网络） {#cost-estimate-no-network}

`--estimar` 使用可从以前记录测得的价格：DeepSeek 输入每百万 US$ 0,30，Haiku
US$ 1,00（两者都由[语言启发式的测量](medicao-do-idioma.md#incremental-cost-of-the-orientation)
中报告的成对输入成本推导）；DeepSeek 的输出 US$ 1,20 是一个**假设**（任何地方都
没有记录），Haiku 的 US$ 5,00 是标价。假设每次执行 12 个步骤，每步追加 400 个
历史 token，150 个输出 token，无缓存：

| 模型 | 每次执行 | 两组，2 轮 |
|---|---|---|
| `deepseek/deepseek-v4.1-flash` | ~US$ 0,015 | ~US$ 0,29 |
| `anthropic/claude-haiku-4.5` | ~US$ 0,049 | ~US$ 0,99 |
| **合计** | | **~US$ 1,28** |

一旦输出目录的累计 `usage.cost` 达到 `--teto-usd`（默认 4.50），执行就在任何调用
之前停止，并且在剩余少于 `--reserva-usd`（0.10）时不开始新的执行。

### 离线能测得的（2026-10-01） {#what-could-be-measured-offline-2026-10-01}

自回放以来 dev 目录已经增长：`listar_contratos_de_modulos`（RN-684）是第九个工具，
而 `catalogo.json`（八个）对它来说已经过时——回放的 746 → 138 个 token 已不再描述
当前目录。在线上（`toWireTool` 的形式，`ferramentas-dev.json`）：

| | 字符 | ≈ token（÷ 4） |
|---|---|---|
| 完整 dev 目录，9 个工具 | 3 816 | 954 |
| 2 个工具的菜单，所有组合的中位数（最小 501，最大 1 464） | 850 | 213 |
| P3 限制菜单时每次调用的节省 | | **≈ 741** |

Jev 每步花费 US$ 0,0000727（AT-237），因此在输入价格超过**每百万 token US$ 0,098**
（0,0000727 ÷ 741）的聊天模型上，定义上的节省就能付清它——按标价，协议的两个模型都
是如此。陷阱与"工具定义上的节省"中写的一样：工具定义是缓存前缀的开头，逐步变化的
菜单会打破缓存，而在 AT-167 中 DeepSeek 大部分输入都来自缓存。节省能否在此之后
幸存，以及循环中额外的串行调用在延迟上花多少（每步 p50 306 ms，在循环外测得），
正是实时表格要回答的。

### 实时表格（2026-10-01，提交 `0eab0cb0e9`） {#the-live-table-2026-10-01-commit-0eab0cb0e9}

由 `jev:vivo --relatorio` 在协议执行的 40 次执行上生成（全部日期为 2026-10-01，全部
在 `0eab0cb0e9`）。方括号是"任务完成"率的 95% 区间。

| 模型 | Jev | 执行 | 任务完成 | 步骤（中位数 · 平均） | 经 `tool_call_recovery` 的步骤 | 执行 p50 · p95 | LLM（聊天 + Jev）p50 | 成本/执行（聊天 + Jev） | 其中 Jev | 每个完成任务的成本 | Jev：应用 · 无限制 · 回落 | 用完整目录的重试 | 菜单之外 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | 开启 | 10 | 10/10 = 100% (72%–100%) | 5 · 6.5 | 0/65 | 4.8 s · 16.3 s | 4.4 s | US$ 0.0029 | US$ 0.0004 | US$ 0.0029 | 55/65 · 10 · 0 | 0 | 3 |
| `deepseek/deepseek-v4.1-flash` | 关闭 | 10 | 10/10 = 100% (72%–100%) | 6 · 6.1 | 0/61 | 3.3 s · 25.4 s | 2.9 s | US$ 0.0013 | — | US$ 0.0013 | — | — | — |
| `anthropic/claude-haiku-4.5` | 开启 | 10 | 10/10 = 100% (72%–100%) | 6 · 6.4 | 0/64 | 12.7 s · 20.2 s | 12.2 s | US$ 0.0194 | US$ 0.0004 | US$ 0.0194 | 54/64 · 10 · 0 | 0 | 4 |
| `anthropic/claude-haiku-4.5` | 关闭 | 10 | 9/10 = 90% (60%–98%) | 7 · 7.1 | 0/71 | 13.3 s · 21.6 s | 12.9 s | US$ 0.0283 | — | US$ 0.0314 | — | — | — |

每次执行都以一个被接受的 `report_done` 结束；唯一未完成的任务（Haiku，关闭，
`T4-slug` 第 0 轮）在 12 步后报告完成，而隐藏测试失败。任何一组的任何步骤都不需要
`tool_call_recovery`，Jev 从未回落（129 次调用中没有超时、没有 HTTP 错误、没有无效
响应），也没有受限菜单收到无工具回答。每组 10 个"无限制"步骤是每次执行的第一步，
那时还没有上一个工具。

规则（`comparar`），按模型，开启对关闭：

| 模型 | 质量：Δ "完成" | 每个完成任务的成本，开启 ÷ 关闭 | 中位执行，开启 ÷ 关闭 | 通过 |
|---|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | 0 个百分点（在 10 之内） | **×2.21**（高于 1） | **×1.45**（高于 1.2） | 否 |
| `anthropic/claude-haiku-4.5` | 有利于开启 10 个百分点（在 10 之内） | ×0.62 | ×0.95 | 是 |

**规则的结论：限制**——Haiku 三个条件全过，DeepSeek 在成本和延迟上失败。质量在
两个模型上都没有失败。

两个模型为何分开，依据同一输出中按步骤的记录（提示词 token 以及 provider 报告的缓存
token）：

| 模型 | Jev | 提示词 token（所有步骤） | 其中来自缓存 | 聊天成本 | Jev 成本 |
|---|---|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | 关闭 | 131 983 | 111 104 (84%) | US$ 0.0132 | — |
| `deepseek/deepseek-v4.1-flash` | 开启 | 97 070 | 43 520 (45%) | US$ 0.0248 | US$ 0.0044 |
| `anthropic/claude-haiku-4.5` | 关闭 | 228 886 | 0 | US$ 0.2827 | — |
| `anthropic/claude-haiku-4.5` | 开启 | 137 059 | 0 | US$ 0.1901 | US$ 0.0043 |

- **执行前写下的缓存保留，正是在 DeepSeek 上发生的事。** 菜单削减了提示词（token
  −26%），但逐步变化，于是缓存前缀被打破：来自缓存的份额从 84% 降到 45%，而聊天账单
  在发送更少 token 的情况下*上升*了 ×1,9。在此之上，Jev（每次执行 US$ 0,0004）是
  一整次关闭执行成本的三分之一。
- **在 Haiku 上任何一组都没有缓存**（工具不发送 `cache_control`，它所移植的产品线上
  形式也不发送），因此提示词 token 的 −40% 直接进入账单：每次执行 −31%，Jev 占其 2%。
- **延迟跟随聊天的速度，正如 AT-239 所预期。** 对 Jev 的调用是串行的（DeepSeek 执行
  中每次调用 p50 232 ms / p95 358 ms，Haiku 中 217 / 319 ms）：在 13 s 的 Haiku 执行
  中它被少一个步骤所吸收；在 3 s 的 DeepSeek 执行中它给中位数增加 1,5 s。
- **质量**：Haiku 上相差一次执行，区间重叠（60%–98% 对 72%–100%）——在这五个小任务
  上，既没有证据表明路由器有助于质量，也没有证据表明它有害。

### 建议（已测量——由负责人决定） {#recommendation-measured--the-owner-decides}

**限制**，按执行前写下的规则：在聊天模型没有生效的提示词缓存、且慢到额外一次串行调用
微不足道的地方保持路由器开启（Haiku 类，每百万 US$ 1,00/5,00），在 provider 的大部分
输入来自缓存且聊天很快的地方关闭（DeepSeek 类）。支持这一点的数字就是上面规则中的
行：Haiku 成本 ×0,62、延迟 ×0,95，无质量损失；DeepSeek 成本 ×2,21、延迟 ×1,45，无
质量收益。

这**不**涵盖什么，以及限制需要什么：

- **只测量了 dev agents（`ToolLoop`）。** 之前的解读——对七个会话型智能体没有证据
  ——仍然成立；这里的任何东西都不延伸到它们。
- **区分是按模型的，而产品的开关是按 workspace 的**
  （`PUT workspaces/:workspaceId/tool-router`）。按模型（或按"缓存生效"）的限制并不
  存在；创建它是一个新决定和一项新改动，这里没有做。在那之前，按 workspace 测得的选择
  是：如果它的智能体运行在没有缓存的 Haiku 类模型上就开启，如果运行在有缓存的
  DeepSeek 类模型上就关闭。
- **样本和任务都很小**（每组 10 次执行，五个 4 到 16 步的任务）。成本和延迟的比率
  宽到足以读出；一次执行的质量差异则不然。
- **缓存的效果取决于 provider 的缓存**，不只是速度：开启了提示词缓存的 Haiku
  workspace 很可能会向 DeepSeek 那一行移动。未测量。

执行之前这里的临时建议（限制：dev agents 开启，会话型智能体关闭）被上面规则的结论
取代，正如那一段所说的那样。

## 复现 {#reproducing}

```bash
# the catalog, when a tool or an identity changed (inside the dev engine container)
docker cp scripts/jev/catalogo.exs brabo-dev-engine-1:/tmp/catalogo.exs
docker exec brabo-dev-engine-1 mix run --no-start --no-compile --no-deps-check /tmp/catalogo.exs \
  > scripts/jev/catalogo.json

# count the steps and estimate the cost, without calling the network
pnpm --filter @brabo/scripts jev:replay -- --container brabo-dev-postgres-1 --estimar

# the run (resumes: a step already answered in the output is not asked again)
pnpm --filter @brabo/scripts jev:replay -- --container brabo-dev-postgres-1 \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env --teto-usd 2

# the report again, and the billed cost per generation
pnpm --filter @brabo/scripts jev:replay -- --so-relatorio
pnpm --filter @brabo/scripts jev:replay -- --conferir-custo --arquivo-de-chave ~/.config/brabo/openrouter-test.env
```

输出（`$XDG_CACHE_HOME/brabo/replay-jev/respostas.jsonl`，否则为 `~/.cache/…`，
模式 600）带有会话 id，位于检出目录之外——脚本拒绝其中的目标。打印的报告只有计数和
智能体 id。密钥从环境（`OPENROUTER_TEST_KEY`）或给定的文件读取，从不打印也不写入。

第二轮有自己的命令，读取数据库的冻结快照（`--dados-cache`，在检出目录之外），并为
每个变体写一个文件：

```bash
# the snapshot, once (the dev database keeps moving; every later run reads this file)
pnpm --filter @brabo/scripts jev:analise -- --container brabo-dev-postgres-1 \
  --dados-cache ~/.cache/brabo/replay-jev/dados.json --variante original --estimar

# one variant, tuning half first; validation only when the choice is made
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json \
  --variante escopo --metade tuning --arquivo-de-chave ~/.config/brabo/openrouter-test.env
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json \
  --variante escopo --metade validacao --arquivo-de-chave ~/.config/brabo/openrouter-test.env

# the tables of this section, and the wrong steps for reading by hand
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json --relatorio --final escopo
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json \
  --variante escopo --metade validacao --dump-erros ~/.cache/brabo/replay-jev/v2/erros.txt
```

本轮的快照取自 2026-09-29 14:27 UTC 时的数据库，加上同一会话的
`proposed_action.created` 事件和 `proposed_actions` 的结果；新快照会有更多步骤和不同
的划分。上限针对输出目录的**累计**花费（`--teto-usd`，默认 US$ 1,00），而不是一次
调用。

菜单测试在这些回答上离线运行；只有快照之后产生的 36 个步骤会调用网络：

```bash
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados-d.json \
  --variante escopo --metade ambas --arquivo-de-chave ~/.config/brabo/openrouter-test.env

# --dados-base is the snapshot that fixed the split; what it did not know is "new"
pnpm --filter @brabo/scripts jev:menu -- --dados-cache ~/.cache/brabo/replay-jev/dados-d.json \
  --dados-base ~/.cache/brabo/replay-jev/dados-c.json --sensibilidade
```

AT-239 的实时对比（需要能访问 `openrouter.ai`；输出目录默认为
`$XDG_CACHE_HOME/brabo/jev-vivo/`，位于检出目录之外，脚本拒绝其中的目录）：

```bash
# the dev tool definitions, when a dev tool changed (plain elixir, no compiled engine)
elixir scripts/jev/vivo/ferramentas-dev.exs > scripts/jev/vivo/ferramentas-dev.json

# the estimate, without the network
pnpm --filter @brabo/scripts jev:vivo -- --estimar \
  --preco deepseek/deepseek-v4.1-flash=0.3/1.2 --preco anthropic/claude-haiku-4.5=1/5

# the run (resumes; stops before any call at the ceiling, and on an account or
# network failure without recording it), then the table and the verdict;
# behind a proxy, prefix NODE_USE_ENV_PROXY=1 (Node's fetch ignores HTTPS_PROXY)
pnpm --filter @brabo/scripts jev:vivo -- --rodadas 2 --teto-usd 4.5 \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env
pnpm --filter @brabo/scripts jev:vivo -- --relatorio
```
