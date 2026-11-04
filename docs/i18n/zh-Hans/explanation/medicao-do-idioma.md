---
id: medicao-do-idioma
title: 语言启发式的测量
description: 针对一个带标签的语料库测量 AT-080 语言检测启发式的工具、它在合成语料库上产生的数字，以及语言引导及其成本的付费验证（AT-167，2026-09-29）。
traducao_de: 929963d24eb727bd64875486f2f1889172f3084a
---

# 语言启发式的测量 {#measuring-the-language-heuristic}

> AT-160（EP-028，HS-053）。被测量的启发式是 AT-080 的规范所提出的（"A — heurística própria, sem
> dependência"）。自 AT-163（[RN-624](../business-rules.md#rn-624)）起产品运行它：api 用它检测作者的语言，
> 并在任何东西改变之前**询问**。产品的阈值是**临时的**——见[产品的临时阈值](#the-products-provisional-thresholds)。

## 现有内容 {#what-exists}

工具位于 `scripts/idioma/`，用仓库的 Node 运行（type stripping，无构建步骤）。**没有新依赖**：启发式是标记
列表和正则表达式，提取通过数据库容器内的 `psql` 与 Postgres 对话。

启发式本身位于 **api**——`apps/api/src/domain/iam/heuristica-de-idioma.ts`——而 `scripts/idioma/heuristica.ts`
只是重新导出它，因此工具测量的恰好是产品运行的代码。这个方向是被迫的：api 无法在没有构建步骤的情况下触及
`scripts/` 或任何运行时包，而 `packages/shared` 只有类型。该文件没有 import，因此 Node 通过 type stripping
从 `scripts/` 运行它（`idioma:*` 命令会静默随之而来的 "typeless package" 警告），`scripts/idioma/` 有自己的
`tsconfig.json`——唯一的区别是关闭 `verbatimModuleSyntax`，它会拒绝像 api 那样的 CommonJS 模块的每个
`export`。最先尝试的是 `.mts` 文件：它通过了两次类型检查和构建，却破坏了 api 的每个 `ts-node` 脚本。*什么算
证据*的规则（`evidenciasDoAutor`）随启发式一起搬走了，真实语料库的提取使用同一条规则。

| 文件 | 作用 |
|---|---|
| `heuristica.ts` | 重新导出 api 的启发式：清理、对比打分、候选参数和临时参数、10 条消息的样本、迟滞以及证据规则 |
| `corpus-sintetico.jsonl` | **版本化**的合成语料库——每一行都是为工具手写的，`origem: "sintetico"` |
| `sequencias-sinteticas.json` | 用于样本和迟滞路径的合成对话 |
| `medicao.ts` / `medir.ts` | 工具及其 CLI |
| `extrair.ts` | 从本地 event log 提取**真实**语料库，写到 git 之外的文件中 |
| `rotular.ts` | 在终端中辅助标注真实语料库 |

## 两个语料库，以及各自存放在哪里 {#the-two-corpora-and-where-each-one-lives}

维护者的决定（AT-168，答复 5）是**真实 + 合成**。它们的存储规则相反：

- **合成**——版本化，像代码一样审阅。覆盖 AT-080 的九种必需情况（拼写错误、合法的西班牙语、英语、混合文本、
  "ok"、代码、日志、其他语言的引文），外加满是英语行话的葡萄牙语、内联标识符，以及三种之外的语言（法语、
  意大利语、德语、加利西亚语、加泰罗尼亚语、荷兰语）——语言列表是开放的（AT-168，答复 2）。
- **真实**——用户自己在**本地** event log 中的消息。它从不进入 git、fixture、CI 日志或 PR 正文。`extrair.ts`
  和 `corpus.ts` 拒绝检出目录内的任何目标，文件以模式 600 写入 `$XDG_CACHE_HOME/brabo/corpus-idioma/`（否则
  `~/.cache/…`）。报告从不打印条目的文本——只有 id、标签和计数——因此它的输出可以粘贴到 PR 中。

提取所采纳的证据遵循 AT-080 的清理：只有执行者是**用户**的事件（智能体的回答从不是证据，因此模型的一个
西班牙语回答不能反馈到检测中），并且在结构化表单中，只有**回答**——api 紧随其后写入的拼接的 `chat.message`，
其标签是智能体的文本，被跳过。

标注助手**不**预填启发式的猜测：用 ENTER 接受它会把标签锚定在标签本来要测量的东西上。ENTER 接受负责人用
`--padrao` 声明的语言。

标签：一个 BCP-47 代码（`pt-BR`、`es`、`fr`……）、`und`（无可判断："ok"、只有代码、只有日志）或 `mul`（混合，
没有主导语言）。打分：`pt`/`es`/`en` 必须得到自己的语言；`und`、`mul` 和任何其他语言必须得到
`indeterminado`——一个三语言启发式对它们能给出的唯一正确答案。可判断条目上的 `indeterminado` 是**丢失的覆盖**
（已知偏好保持不变）；错误的语言是**错误**，而 `falso es` 单独计数，因为它是这个史诗要消除的缺陷。

## 如何运行 {#running-it}

```bash
# synthetic corpus (the default)
pnpm --filter @brabo/scripts idioma:medir

# the owner's real corpus, on the owner's machine
pnpm --filter @brabo/scripts idioma:extrair --container brabo-dev-postgres-1
pnpm --filter @brabo/scripts idioma:rotular --padrao pt-BR
pnpm --filter @brabo/scripts idioma:medir --real
```

`--container` 在该容器内运行 `psql`，对 `session_events` 执行单个只读 `SELECT`（`--usuario`/`--banco` 默认是
compose 的 `brabo`/`brabo`）；`--database-url <url>` 改用宿主的 `psql`。再次运行提取会保留已有标签，并追加
没有标签的新消息。

## 合成语料库上的数字（2026-09-28） {#numbers-on-the-synthetic-corpus-2026-09-28}

123 个带标签的条目，7 个序列，AT-080 的候选参数（最少 20 个词，阈值 0,8，差距 0,3，10 条消息 / 2.000 个字符，
迟滞 2）。两个标记列表：`at080` 是规范中的列表，按字面；`ampliada` 是本工具在对语料库运行**之前**写下的一个
更大的列表（另外两种语言中没有的常见功能词）。同一个语料库，因此 `ampliada` 并没有被这些数字验证——能说明的
是真实语料库。

按消息，候选参数：

| 标签 | n | `at080` 正确 | `at080` 不确定 | `ampliada` 正确 | `ampliada` 不确定 |
|---|---|---|---|---|---|
| pt | 56 | 26 (46,4%) | 30 | 30 (53,6%) | 26 |
| es | 20 | 6 (30,0%) | 14 | 7 (35,0%) | 13 |
| en | 14 | 6 (42,9%) | 8 | 6 (42,9%) | 8 |
| und | 15 | 15 (100%) | 0 | 15 (100%) | 0 |
| mul | 5 | 5 (100%) | 0 | 5 (100%) | 0 |
| 其他语言 | 13 | 10 | 0 | 9 | 0 |

语言错误的裁决：在两个列表中，**`pt`/`es`/`en` 条目上一个都没有**。全部都在三种之外的语言中——`at080`：法语
→ pt（*arrêté* 的 `ê`）、**加利西亚语 → es**（唯一的 `falso es`）、荷兰语 → en；`ampliada`：法语 → es、德语
→ pt 和 → en、荷兰语 → en。

清理在**零**个可判断条目中删除了超过一半的词。

七个合成序列在两个列表中都以预期的结果结束，切换次数不超过允许值——包括带一段很长的西班牙语引文的葡萄牙语、
葡萄牙语中间一整条西班牙语消息，以及满是英语行话的葡萄牙语。

本机 CPU：`at080` 每条消息 11,7 µs，每次评估 10 条消息的样本 49 µs；`ampliada` 16,8 µs 和 60 µs。随机器而变；
重要的是数量级。

## 数字说明了什么 {#what-the-numbers-say}

- **用 `at080` 列表时，阈值和差距从不起作用。** 67 个有得分的条目中有 66 个只为一种语言得分（置信度 = 1,0），
  因此把阈值从 0,5 扫到 1,0 什么也不改变。最少词数是唯一起作用的旋钮：按消息，可判断条目在 20 个词时有
  42,2% 到达自己的语言，10 个词时 58,9%，没有最小值时 66,7%——在 20 时它丢掉了每条短的、有拼写错误的消息和
  大部分技术性消息。
- **去掉最小值会让混合文本作出判断。** 没有最小值时，`at080` 把五条混合消息中的三条变成 `en` 或 `pt`，
  `ampliada` 也把两个 `und` 条目判为 `en`——没有围栏的代码（`const total = itens.reduce(…)`）和 pnpm 的输出
  （`ELIFECYCLE  Test failed. See above for more details.`）通过了清理，而清理只认识有围栏的代码和 AT-080
  列出的日志格式。
- **0,3 的差距与 0,8 的阈值是冗余的**，在任何列表中：有三种语言时，≥ 0,8 的胜者至少比第二名高 0,6。
- **重要的单位是样本，而不是消息**——在序列中，10 条消息的窗口能用单独看来会是 `indeterminado` 的消息到达
  语言。葡萄牙语窗口中的一条西班牙语消息，只要还在窗口中，就让样本成为 `indeterminado`（序列 `q03`）：没有
  切换，但也没有确认。
- **开放的语言列表正是错误所在。** 只有三种语言时，一个加利西亚语或法语用户可能被告知他写的是西班牙语或
  葡萄牙语。按 AT-168 的规则检测只会*询问*，用户确认，因此代价是一个错误的问题——但这仍是启发式在这里唯一的
  失败模式。

这些是合成的数字：语料库由编写启发式的同一只手写成。AT-163 的阈值应该来自真实语料库。

## 产品的临时阈值 {#the-products-provisional-thresholds}

AT-163 必须在真实语料库存在之前带着*某个*数字发布，因此 api 读取 `PARAMETROS_PROVISORIOS`——**临时的，未经
校准**，并在 [RN-624](../business-rules.md#rn-624) 中如此声明：

| 参数 | 临时值 | AT-080 的候选值 | 原因 |
|---|---|---|---|
| 标记列表 | `at080` | — | `ampliada` 在 pt 上多 4 个百分点，并两次判错德语；两者都没有被真实数据验证 |
| 最少词数（针对样本） | **10** | 20 | 可判断条目的覆盖率 42,2% → 58,9%，**相同的**三个错误裁决（法语、加利西亚语、荷兰语——三种之外的语言）；低于 10 时，混合文本开始作出判断 |
| 阈值 / 差距 | 0,8 / 0,3 | 0,8 / 0,3 | 在合成语料库上从不起作用，因此还没有更好的数字可选 |
| 样本 | 10 条消息 / 2.000 个字符 | 相同 | — |
| 迟滞 | 2 | 2 | — |

迟滞是**重新计算的，从不保存**：api 读取最后 11 条证据，并询问样本的最后两次评估是否一致。本机 CPU，合成
语料库：清理并分类一条消息 11,6 µs，每次检测 110 µs（11 条消息，两次评估）。读取由 `session_events` 上的一个
部分索引提供：0,056 ms 对比顺序扫描的 13,5 ms，在 200.000 个事件上测量。

要重新校准：运行真实语料库（`idioma:medir --real`），然后在 api 中改 `PARAMETROS_PROVISORIOS`——这是产品读取
它们的唯一地方，工具导入的也是同一个文件（它的报告继续扫描 AT-080 的候选值）。

## 语言引导的付费验证（AT-167，2026-09-29） {#paid-validation-of-the-language-orientation-at-167-2026-09-29}

> 协议是 AT-082 的，带有 AT-169 的决定：预算 US$ 5，每个用例和组 5 轮，验收阈值"在处理组中，在期望 pt-BR 的
> 地方**零**个西班牙语回答，并且 C01–C04 和 C06–C15 中语言正确 **≥ 95%**"，被测模型
> `deepseek/deepseek-v4.1-flash`，对照模型 `anthropic/claude-haiku-4.5`，增量成本上限为每次调用 50 个输入
> token。代码在 `d48f99f8e`（2026-09-29 的 `dev`）。

### 在哪里运行，以及什么是（什么不是）产品 {#where-it-runs-and-what-is-and-is-not-the-product}

一个产品之外的脚本 `scripts/idioma/validar.ts`（纯的部分——矩阵、判定、报告——在 `validacao.ts` 中，由
`validacao.spec.ts` 测试）。它**直接**调用 OpenRouter，不向数据库写入任何东西。产品发送给模型的内容**在每次
执行时从产品的文件中读取**，从不复制——如果某个文件改变了形式，读取会抛出异常并点名它没找到的东西：

- 引导（RN-622/623）：`apps/engine/lib/engine/harness/idioma_da_resposta.ex` 中的 `@textos`、通用句、工件子句、
  `@forma_curta` 和 `@ferramentas_de_artefato`，作为**最后**一条消息、`role: "system"` 发送，在处理组轮次的每次
  调用中（包括工具迭代），且从不保留在历史中；
- `apps/engine/lib/engine/harness/context_manager.ex` 中的摘要提示词及其语言句（RN-621）；
- Criativo 的人设（`CRIATIVO_INSTRUCTIONS`）、它带真实描述的两个工具，以及产品返回的工具结果。

与产品之间已声明的差异：系统提示词只有人设（没有 `ContextBuilder` 的各层）；压缩在 C04 的第五个轮次之前被
**强制**进行（保留最后两条消息，即产品的 `keep_recent`），由被测模型充当摘要器；恢复（C15）是以文本重建的历史，
即 `Engine.Agents.Reidratacao` 的形式；每个轮次最多 4 次模型调用（Criativo 允许 12 次）；`max_tokens` 上限为
4000（产品不发送任何值）。上游 provider **没有**固定——按调用记录为混杂因素。基线 = RN-621/622 之前的代码：
没有引导**并且**使用旧的摘要提示词（AT-169 答复 4：验证测量的是整体，没有旧摘要的单独基线）。

每条消息的作者的已解析语言是用例的一部分：Ana 为 `pt-BR`（C01–C05、C07–C11、C13–C15），Bob 为 `en`（C06 是
检测到并确认的 `en`，C12 是写葡萄牙语的显式 `en` 偏好）；项目语言 `pt-BR`。C05 期望 **pt-BR**：按 AT-168 的
答复 4，检测只会*询问*，因此作者的已解析语言在确认之前仍是 pt-BR。

`max_tokens` 为 1000 的第零步第一次执行被**丢弃**：DeepSeek 的推理在 7 次调用中用完了整个上限，回答返回为空
（两个摘要变成了产品的回退文本）。它的记录单独放在输出目录中；空回答现在计为 `falha`，从不计为
`indeterminado`。

### 第零步：未复现 {#step-zero-not-reproduced}

只有基线，`deepseek/deepseek-v4.1-flash`，C01–C04，5 轮：**35 个被判定的回答中 0 个西班牙语**（35 pt，0 个
不确定）。9月13日的报告（从葡萄牙语输入得到西班牙语）**没有复现**，因此*那个*缺陷上的任何改善都不能归功于处理。
执行继续进行，因为 AT-169 的阈值在处理组中是绝对的，而其他用例（C05、C06、C12、C16、C17）确实显示基线以错误的
语言回答。

### 按用例 × 组 × 模型的结果 {#results-by-case--arm--model}

第一个判定者：针对散文的本地分类器（`ampliada` 列表，候选参数）。"ok" = 期望的语言；"错误 (es)" = 另一种语言
（其中西班牙语若干）；"不确定" = indeterminado。n 是被判定的回答数（5 轮 × 被判定的轮次）。

| 用例 | DeepSeek 基线 | DeepSeek 处理 | Haiku 基线 | Haiku 处理 |
|---|---|---|---|---|
| C01 (n=5) | 5 ok | 5 ok | 5 ok | 5 ok |
| C02 (n=5) | 5 ok | 5 ok | 5 ok | 5 ok |
| C03 (n=15) | 15 ok | 15 ok | 15 ok | 15 ok |
| C04 (n=10) | 10 ok | 10 ok | 10 ok | 10 ok |
| C05 (n=5，不在 95% 列表中) | 1 ok，4 错误（4 es） | 5 ok | 0 ok，5 错误（5 es） | 2 ok，3 错误（3 es） |
| C06 (n=5) | 2 ok，2 错误，1 不确定 | 3 ok，2 不确定 | 4 ok，1 错误 | 5 ok |
| C07–C10（各 n=5） | 全部 ok | 全部 ok | 全部 ok | 全部 ok |
| C11 (n=10) | 6 ok，4 错误 | 5 ok，5 错误 | 5 ok，1 错误，4 不确定 | 6 ok，4 错误 |
| C12 (n=10) | 0 ok，10 错误 | 4 ok，6 不确定 | 0 ok，10 错误 | **0 ok，10 错误** |
| C13 (n=5) | 5 ok | 5 ok | 5 ok | 5 ok |
| C14、C15（各 n=5） | 全部 ok | 全部 ok | 全部 ok | 全部 ok |
| C16 (n=20，不在列表中) | 10 ok，10 错误 | 19 ok，1 不确定 | 10 ok，10 错误 | 18 ok，2 错误 |
| C17 (n=20，不在列表中) | 12 ok，8 错误 | 20 ok | 16 ok，4 错误 | 20 ok |

C13 在 20 次对话中的 20 次调用了 `emit_artifact`。没有调用失败。

### 对照阈值 {#against-the-threshold}

| 模型 | 期望 pt-BR 处的西班牙语（处理组） | C01–C04、C06–C15 中正确（严格，分类器） | 按分类器的裁决 |
|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | 0 | 82/95 (86,3%)，8 个不确定 | **不通过** |
| `anthropic/claude-haiku-4.5` | 3（全部在 C05） | 81/95 (85,3%)，0 个不确定 | **不通过** |

DeepSeek 的 13 个失败分为两组。下面的解读是智能体的，在审阅**之前**作出；审阅（[下一节](#human-review-and-the-haiku-diagnosis-at-167-follow-up)）
更正了它——8 个不确定的并不都是英语散文：

- 8 个不确定的（C06 ×2，C12 ×6）看起来是英语散文——`ampliada` 列表对英语打分很差（"Great starting point — …"）；
- C11 的 5 个失败以**葡萄牙语框架中的英语翻译**回应翻译请求，而这是引导所允许的（"a menos que o usuário peça
  explicitamente … nesta mensagem" 涵盖翻译，不涵盖框架）。协议中的 "tradução em en" 没有说明两者哪个是对的。

如果审阅接受这两组，DeepSeek 达到 95/95 并**通过**；如果拒绝 C11，则是 90/95（94,7%），差一个回答而失败。Haiku
**无论如何都失败**：在显式 `en` 偏好和葡萄牙语消息（C12）下，它在 10 个处理组回答中有 10 个用葡萄牙语回答，并对
5 条西班牙语消息中的 3 条用西班牙语回答（C05）。一个未测量的假设：对 Anthropic 的模型，OpenRouter 把末尾的
`system` 消息提升到顶部的系统提示词中，在那里它失去了在列表末尾时的近因效应。（之后测量了，**未得到证实**：见
下面的诊断。）

需要审阅的回答（每个不确定或分歧的、C11 的每个翻译，以及一致者中 10 取 1 的确定性样本）是 560 个中的 146 个，
列在输出目录的 `revisao.md` 中。

### 引导的增量成本 {#incremental-cost-of-the-orientation}

每次对话**第一次**调用的成对 `prompt_tokens`（两组的输入相同，除了引导），取自 OpenRouter 的 `usage`，从不
估计：

| 模型 | 引导 | 对数 | 输入 token 的 Δ |
|---|---|---|---|
| DeepSeek | pt-BR（108 个字符） | 75 | 32（每对） |
| DeepSeek | en + 工件子句（128 个字符） | 15 | 27 |
| Haiku | pt-BR | 75 | 30 |
| Haiku | en + 工件子句 | 15 | 27 |

全部低于 50 token 的上限。按目录的输入价格，这在 DeepSeek 上约为每次调用 US$ 0,0000096，在 Haiku 上 US$ 0,00003
——这是上限，因为 DeepSeek 的大部分输入来自缓存（缓存 token 会被返回；带缓存的每次调用成本包含在 `usage.cost`
中，而不是按消息分开）。引导在一个轮次的每次调用中都会发送，因此带工具迭代的轮次每次迭代都要付一次。

### 花费 {#spend}

验证的成本是每个回答的 `usage.cost` 之和，按调用保存在 `chamadas.jsonl` 中：总计 **US$ 2,3071**——计入的执行中
US$ 2,2629（DeepSeek 基线 0,1526 + 处理 0,2133；Haiku 0,9526 + 0,9443；865 次调用），丢弃的第零步 US$ 0,0281，
一个单用例 smoke US$ 0,0162。同一期间 `GET /api/v1/key` 的计数器从 1,8301 变为 4,1578（Δ 2,3277），但这把密钥
与同时运行的其他付费 lane 共享，且计数器有延迟，因此这个差值是背景，而不是本次验证的花费。生成 id 没有被记录，
因此每次调用的成本没有对照 `GET /api/v1/generation` 核对。产品自身的 metering（`token_usage`）没有参与：脚本
绕过了 api。

### 如何复现 {#reproducing}

```bash
# the key file holds OPENROUTER_TEST_KEY=…; the key is never printed
pnpm --filter @brabo/scripts idioma:validar --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --modelos deepseek/deepseek-v4.1-flash --bracos baseline --casos C01,C02,C03,C04   # step zero
pnpm --filter @brabo/scripts idioma:validar --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --pular-existentes --teto-usd 2.5                                                 # everything else
pnpm --filter @brabo/scripts idioma:validar --relatorio                             # report only
```

输出写到 `$XDG_CACHE_HOME/brabo/validacao-idioma/<date>/`（否则 `~/.cache/…`），模式 600，脚本拒绝检出目录内的
目录。`--teto-usd` 按 `usage.cost` 的累计和，在会超过它的调用之前停止。

未测量的：缓存节省本身、产品完整的系统提示词、真实的压缩（由阈值触发）、真实 engine 的重启、葡萄牙语工件子句的
分词器计数，以及任何固定的上游。

146 个回答经过了手工审阅；结果，以及仍属于负责人的唯一决定，在下一节中。

## 人工审阅与 Haiku 的诊断（AT-167 的后续） {#human-review-and-the-haiku-diagnosis-at-167-follow-up}

付费验证的两个离线或廉价的后续，都基于同一次执行（`respostas.jsonl`，560 个被判定的回答）：对分类器标记的 146 个
回答的人工审阅（A 部分，无花费），以及对 Haiku 的假设"OpenRouter 把末尾的 `system` 消息提升上去"的测试（B 部分，
US$ 0,1485）。两者都不改变产品。

### A 部分——对 146 个的审阅 {#part-a--the-review-of-the-146}

`revisao.md` 中 146 个回答的每一个都被编写本节的智能体逐一阅读（不是第二个人类；标签文件被保存，供想要反驳的人
使用）。对每一个：用户所读文本的**真实**语言、它对该用例是否正确，以及一行原因。文件与回答一起位于 git 之外——
`~/.cache/brabo/validacao-idioma/2026-09-29/revisao-feita.md`（146 个）和 `amostra-lida.md`（下面的样本）。
`pnpm --filter @brabo/scripts
idioma:revisar` 读取它们并打印本节的每张表；标签是数据，算术是代码（`scripts/idioma/revisao.ts`，已测试）。

标签有四个，因为阅读发现了一个分类器看不到的事实：

- `sim` / `nao`：回答在 / 不在期望的语言中；
- `formulario`：**散文**在期望的语言中，但结构化表单（`ask_structured_questions`，第一个回答的实质内容）的问题
  对一个语言为 `en` 的作者以葡萄牙语给出；
- `c11`：葡萄牙语框架中的英语翻译——负责人的决定，见下文。

| 146 个中 | 正确 | 不正确 | 散文正确，表单为葡萄牙语 | C11（负责人的决定） |
|---|---|---|---|---|
| 全部 | 42 | 81 | 8 | 15 |
| 基线组（89） | 18 | 64 | 1 | 6 |
| 处理组（57） | 24 | 17 | 7 | 9 |

分类器称为**不确定**的 14 个回答，读过之后是：3 个英语回答（Haiku 对 C11 的简单翻译）、2 个不正确的（DeepSeek
C12，散文中葡萄牙语和英语句子交错）、8 个英语散文带葡萄牙语表单，以及 1 个 C11。所以智能体之前的那句话——"8 个
不确定的看起来是英语散文"——对了一半：散文是英语，而表单在 8 个中有 6 个**不是**。

**分类器的错误，经过测量。** 在读过的 146 个回答中的 118 个确定裁决（`pt`/`es`/`en`）中，阅读反驳了 **0** 个。
分类器从未把一个错误的回答称为正确，也从未把正确的称为错误；它唯一的失败是那 3 个其实是简单英语的"不确定"。
对**没有**被标记的 414 个回答（全部与预期一致），读了一个样本：在按 `respostas.jsonl` 顺序排列的回答上用
`random.Random(20260929).sample(range(414), 60)` 抽取 60 个，加上抽样没抽到的、期望为 `en` 的 14 个未标记
C06/C12 回答（它们决定阈值，所以被完整阅读）——读了 74 个，**0 个分歧**（95% Wilson 上限：4,9%）。加上 10 取 1
的哈希已经标记、也被阅读的 39 个一致回答，随机部分是 99 个中 0 个（上限 3,7%）：414 个中最多约 15 个可能是错的，
而样本表明一个都没有。样本中看到的两个小失误是单个词的插入（`"What falta for us…"`、
`"reminders automáticos"`），它们不改变回答的语言。

分类器**看不到**的是表单：英语回答上的 `clf=en` 并没有说明它的问题是葡萄牙语的（只有在混合严重时，它才把这些
回答标记为不确定）。这就是样本完整阅读 C06/C12 回答的原因，也是下面存在两种解读的原因。

### 用审阅后的标签重新计算阈值 {#the-threshold-recomputed-with-the-reviewed-labels}

处理组，C01–C04 和 C06–C15（n = 95），西班牙语按每个期望 pt-BR 的处理组回答的**真实**语言计算（包括 C05）。95%
Wilson 区间。两个独立的解读：**C11**（负责人的，未决）和**表单**（散文正确，表单为葡萄牙语——智能体把它作为
关于用户所读内容的事实来解决，并展示另一面以便被反驳）。

| 模型 | C11 计入 | 表单计入 | 命中 | 比率 | 95% 区间 | 西班牙语（期望 pt） | 裁决 |
|---|---|---|---|---|---|---|---|
| DeepSeek | 是 | 是 | 93/95 | 97,9% | 92,6–99,4% | 0 | 通过 |
| DeepSeek | **是** | **否** | 87/95 | 91,6% | 84,3–95,7% | 0 | 不通过 |
| DeepSeek | 否 | 是 | 88/95 | 92,6% | 85,6–96,4% | 0 | 不通过 |
| DeepSeek | 否 | 否 | 82/95 | 86,3% | 78,0–91,8% | 0 | 不通过 |
| Haiku | 是 | （任意） | 85/95 | 89,5% | 81,7–94,2% | 3（C05） | 不通过 |
| Haiku | 否 | （任意） | 81/95 | 85,3% | 76,8–91,0% | 3（C05） | 不通过 |

通过的阈值是 95 中命中 91（94,7% 不通过）。解读这张表：

- **Haiku 在每种解读中都失败**：C05 中 3 个西班牙语回答（仅零西班牙语这一条就足够了），全部接受时为 85/95。
- **DeepSeek 恰好在一个单元格中通过**：C11 被接受**并且**带葡萄牙语表单的英语散文被接受。拒绝两者中任何一个它就
  失败——如果表单被拒绝，差 4 个回答（需要 91 个中的 87 个），如果是 C11，差 3 个（88）。两者都拒绝，就是分类器
  的数字 82。
- 因此 C11 的决定只在表单被接受时才重要。表单计为失败时，无论 C11 如何 DeepSeek 都失败，而需要采取行动的发现不是
  C11 而是表单：在处理组中，DeepSeek 的 15 个 C06+C12 回答中有 8 个在英语回答中带有葡萄牙语文本（6 个只在表单中，
  2 个交错），而 7 个是干净的英语，包括表单。模型能用英语写表单——它大约一半的时候这样做。
  **它从哪里来（AT-282，[RN-667](../business-rules.md#rn-667)）：** 工具本身的描述告诉模型 `label` 是
  "o texto da pergunta, **em pt-BR**"——第二条固定的语言指令，在门面之外，在每次调用中与末尾的引导竞争。现在它说
  "no idioma da sua resposta"，不点名任何语言；引导本身没有改变。改动之后的测量**没有运行**（做改动的机器上没有
  OpenRouter 的密钥），由负责人待办——C06 和 C12，处理组，5 轮，在 RN 的预算上限内。

C11 在数据中是什么。DeepSeek 的 5 个处理组失败：3 个在葡萄牙语框架中引用了英语翻译（"Registrei a regra… A
tradução que você pediu: > …"），2 个**在记录的文本中没有翻译**——执行只保存一个轮次的最后一条消息，而这些轮次
先调用了 `emit_artifact`，因此翻译在同一轮次的前一条消息中（5 次对话 10 次调用，每次对话两次），所以翻译推测在
同一轮次的前一条消息中，没有被保存。这两个被计为仅框架，也就是在"C11 计入"中算作命中。Haiku 的 4 个处理组失败
是带葡萄牙语注释或周围有葡萄牙语备选的英语翻译。

> **TODO(humano):** Uma tradução para o inglês dentro de uma moldura em português
> conta como correta no C11? Ela decide o eixo C11 da tabela acima:
> **aceita** → DeepSeek 93/95 e passa (se a prosa em inglês com formulário em
> português também for aceita; 87/95 se não); **recusada** → DeepSeek 88/95 (ou
> 82/95) e falha. O Haiku falha de qualquer jeito. Recomendação, em uma frase:
> aceitar — a exceção da orientação cobre só a tradução pedida e a moldura fica
> no idioma do autor, então recusá-la penalizaria exatamente o comportamento que
> a orientação existe para produzir. (A segunda pergunta, o formulário em
> português, é de escopo de produto e está enunciada como achado acima; não foi
> levada ao dono porque o agente a resolveu como fato — o que o usuário lê.)

### B 部分——是引导的位置吗？（AT-279） {#part-b--is-it-the-position-of-the-orientation-at-279}

假设：对 Anthropic 的模型，OpenRouter 把末尾的 `system` 消息提升到顶部的系统提示词，使它失去近因效应。测试：
C12（作者偏好 `en`，pt-BR 消息），`anthropic/claude-haiku-4.5`，第一个轮次，每个位置 5 轮，引导文本**从产品读取**
（是 `Respond in English (en), unless the user explicitly asks for another language
in this message. Write project artifacts in pt-BR.`），只改变位置：

1. `ultima-system`——与今天一样（`idioma_da_resposta.ex:231`，末尾的一个 `role: "system"`）；
2. `system-fundido`——追加到第一个 `system` 中（人设 + 引导）；
3. `sufixo-user`——最后一条 `user` 消息的后缀，**不**追加 `system`；
4. `ultima-system-e-sufixo-user`——末尾的 `system` **加上**同一句话作为后缀。

| 位置 | 分类器命中 | 阅读 |
|---|---|---|
| 1 `ultima-system`（与今天一样） | 0/5 | 5 个葡萄牙语，包括表单 |
| 2 `system-fundido` | 0/5 | 5 个葡萄牙语 |
| 3 `sufixo-user` | 0/5 | 5 个葡萄牙语 |
| 4 `ultima-system-e-sufixo-user` | 0/5 | 5 个葡萄牙语 |
| 对照：1，不带工件子句 | 0/5 | 5 个葡萄牙语 |
| 对照：3，不带工件子句 | 0/5 | 5 个葡萄牙语 |

四个位置被完整阅读，两个对照部分阅读，30 个回答还都被检查了英语功能词（一个都没有）：30 个都是葡萄牙语，散文和
表单都是。位置 1 的缺陷被**复现**（0/5，与付费执行的 0/10 一样），而**没有任何位置纠正它**——即使是引导就在用户
最后一条消息内部、末尾没有 `system` 的那个。假设**未得到证实**。提示词 token 计数显示文本在每个位置都到达了模型
（2 426、2 427、2 427 和 2 454 个输入 token：两个简单放置 +1，双重放置 +28），所以不是消息被丢弃。对照也排除了
第二个可疑句子：工件子句（"Write project artifacts in pt-BR."，RN-623）也不是原因（没有它时 0/10）。

这没有排除、也没有测量的：第二个轮次（出于预算只运行了第一个——付费执行中第二个轮次也是 5/5 错误）；更强的措辞
（句子说 "unless the user explicitly asks"，葡萄牙语输入可能被这样理解）；人设本身的语言（`CRIATIVO_INSTRUCTIONS`
是葡萄牙语的）；以及上游（30 次调用都由 Amazon Bedrock 提供，因此无法分离上游的效应）。DeepSeek 在同一用例中遵循
同样的引导——它的处理组 C12 回答 10 个中有 8 个是英语散文——这指向模型，而不是放置位置。

**提议的改动：关于位置，没有。** 如果有帮助的话，唯一会改变位置的地方是
`Engine.Harness.IdiomaDaResposta.anexar/4`（`apps/engine/lib/engine/harness/idioma_da_resposta.ex:231`，即
`messages ++
[%{"role" => "system", …}]`），由 `apps/engine/lib/engine/sessions/engine_api_client.ex:609` 和 `:661` 的两条
`llm_turn` 路径调用。它保持原样。如果负责人希望 Haiku 在葡萄牙语输入面前遵守 `en`，下一项活动是用这同一个脚本
测试措辞和人设的语言（上面的列表）。

**花费**（每个回答的 `usage.cost` 之和，从不是 `/key` 的计数器）：四个位置 US$ 0,0980（20 次调用），两个对照
US$ 0,0505（10 次调用）——US$ 0,20 的上限中用了 **US$ 0,1485**，30 次调用，没有失败。

复现 B 部分（密钥文件保存 `OPENROUTER_TEST_KEY=…`；它从不被打印；输出写到检出目录之外）：

```bash
pnpm --filter @brabo/scripts idioma:diagnosticar \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --turnos 1 --rodadas 5 --teto-usd 0.13 --concorrencia 4          # the four positions
pnpm --filter @brabo/scripts idioma:diagnosticar \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --turnos 1 --rodadas 5 --posicoes ultima-system,sufixo-user --sem-clausula \
  --saida ~/.cache/brabo/validacao-idioma/<date>-diagnostico-haiku-sem-clausula \
  --teto-usd 0.06 --concorrencia 4                                  # the controls
pnpm --filter @brabo/scripts idioma:revisar                          # Part A tables
```

`--turnos N` 和 `--sem-clausula` 只为这次诊断而存在；产品从不把引导放在末尾以外的地方，`validacao.ts` 中的
`posicionar` 不被它使用。
