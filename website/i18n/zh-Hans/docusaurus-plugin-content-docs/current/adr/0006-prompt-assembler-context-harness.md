---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0006 — agent 的 harness：确定性的上下文组装

## 背景 {#contexto}

Fase 3a 在任何产品 agent **之前**，先在 `apps/engine`（Elixir/OTP）中组装 agent 的 harness。CLAUDE.md 列出了 5 个 behaviour；这第一次会话明确是**没有 LLM** 的——只有确定性的上下文组装——实现其中 3 个：**PromptAssembler**、**InstructionFiles** 和 **Hooks**。ToolLoop 和 ContextManager（它们经由 api 接触 LLM）留给后续会话。

engine 之前没有任何关于 prompt/agent/指令的东西：没有表，没有工作区文件读取器，没有 tokenizer，没有钩子结构。本 ADR 记录这一基础的形态决定。

## 决策 {#decisões}

### 层模型 + 确定性截断（PromptAssembler） {#modelo-de-camadas--corte-determinístico-promptassembler}

prompt 由 5 个**有序**的层组装（identidade → instruction_files → contexto_projeto → regras_negocio → estado_tarefa），每层有一个 token 预算。`PromptAssembler` 是一个**纯**函数，与数据来源无关（收集数据的是 `ContextBuilder`）——这让算法，也就是验收标准的核心，可以单独测试。

每层声明一种截断策略，在超出预算时应用——始终是**确定性**的并有文档说明：

- `:drop_whole_units`（单元层，例如业务规则）——从列表头部丢弃**整个**单元直到放得下。**绝不在单元中间截断。** 列表按丢弃顺序排列：业务规则，最旧的优先；instruction files，优先级最低的优先。单独一个就超过预算的单元会被整个丢弃（该层可能变空），绝不拆分。
- `:truncate_tail`（blob，例如项目上下文）——保留一个按预算确定大小的前缀（尊重 UTF-8）+ 标记 `[… truncado …]`。
- `:keep_or_drop`（blob，例如身份）——全有或全无：放得下就保留，放不下就丢弃整层（半个身份是无用的）。

拒绝：按字符截断任何层（会失去“绝不拆分业务规则”的保证）。也拒绝：单一的全局截断模式——各层性质不同（列表 vs blob vs 身份），值得不同的策略，而且都是显式的。

### token 估算（Tokenizer） {#estimativa-de-tokens-tokenizer}

没有 LLM，也没有新库（遵守“não instalar libs sem justificar”）：计数是一个按 `bytes/4` 向上取整的本地**估算**——与 `Engine.Actions.TerminalExecutor` 中已经使用的启发式相同（`@bytes_per_token 4`）。每个结果在层和报告中都标记为 `estimated: true`。`Engine.Harness.Tokenizer` 是一个可通过 `Application.get_env(:engine, :tokenizer, ...Approximate)` 替换的 behaviour——之后可以接入真正的 tokenizer 而不触碰 assembler。

### InstructionFiles：优先级与缓存 {#instructionfiles-precedência-e-cache}

来源：项目工作区根目录的 `AGENTS.md` + 每个子目录的 `AGENTS.md`（递归遍历，跳过 `.git`）+ 数据库中该 agent 的文件（`agent_instructions`）。**有文档的优先级：数据库 > 目录 > 根**——并且在目录之间，最深（最具体）的胜过根。来源按优先级**递增**的顺序返回（根在前，数据库在最后）：数据库最后读取并在冲突时胜出（“last wins”），截断用的也是同样的顺序（先丢弃权威性最低的，即根）。

通过**简单失效**重新加载，**不监视文件系统**（目前）。ETS 中的缓存：一个最小的受监督进程（`InstructionFiles.Cache`）只负责创建并持有公开的命名表；文件系统+数据库的 IO 发生在 `load/2` 的**调用者**进程中——这样缓存不碰数据库，也不会在测试中与 Ecto 沙箱冲突。`invalidate/2` = `:ets.delete`。这是 **engine 中第一次使用 ETS**：理由是它是 Elixir 的标准缓存原语，并且避免了一个在沙箱下读取数据库的 GenServer 的麻烦。

### Hooks：纯函数式的注册 {#hooks-registro-funcional-puro}

`Engine.Harness.Hooks` 是一个**值**（阶段 → 按注册顺序排列的处理器列表的 map），而不是进程——确定性的，无需可变的全局状态即可测试，符合代码库的偏好（除了进程身份的注册表之外没有全局注册表）。阶段：`pre_tool_use`、`post_tool_use`、`session_start`、`session_end`。`run/3` 按注册顺序运行处理器（`reduce_while`）；返回 `{:halt, reason}` 的处理器会中断链条。这是动作管道和终端执行器在未来会话中作为处理器接入的基础——每次调用都各自构建并运行钩子的值。

### `agent_instructions` 的所有权 {#ownership-de-agent_instructions}

该表引用 `projects`（api 的领域数据）→ 它由 **apps/api 中的 Drizzle 迁移**创建（schema `public`），engine 只通过一个 Ecto schema `@schema_prefix "public"`（`Engine.AgentInstructions.Instruction`）**读取**，绝不用自己的迁移——engine 的迁移只存在于 schema `engine` 中。与 `Engine.Projects.ProjectRepository`/`SessionEvents` 的模式相同。在 engine 的测试中（数据库 `engine_test`，与 api 的数据库隔离），该表通过 `test_helper.exs` 中的原始 fixture 存在，与 `outbox_events`/`session_events`/`project_repositories` 一样。

## 后果 {#consequências}

- `:regras_negocio` 和 `:estado_tarefa` 层在本次会话中为**空**——还没有来源（business_rule 由 Criativo 在 Fase 3b 中发出；任务状态来自 ToolLoop/agent）。截断算法已经处理它们（空 = 0 个 token），并在测试中用合成单元演练。为它们编造表会是 3b 的范围。
- agent 的身份是一个最小的静态映射（`Engine.Harness.Agents`），名册中每个 slug 一行——这不是“实现一个 agent”（没有行为，没有 LLM），只是让该层存在的内容。
- 验收标准由 `Engine.Harness.Debug.print/2` 满足（可从 IEx 调用的调试函数，没有 Mix.Task——engine 中没有先例），它打印每一层及其（估算的）token 数和组装好的 prompt。
- 各层的预算是带合理默认值的模块常量，可以通过 `opts[:budgets]` 覆盖。还没有 LLM 时，它们用于演练截断并在调试中提供可见性；将在 ToolLoop 加入时校准。
