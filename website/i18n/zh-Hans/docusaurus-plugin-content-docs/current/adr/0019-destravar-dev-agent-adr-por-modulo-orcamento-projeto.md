---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0019 — 解锁真实的 DevAgent：写入、终端、按模块的 ADR 和按项目的预算

- 状态：已接受
- 日期：2026-07-25
- 阶段：4a（结束真实 DevAgent 的偏差）

## 背景 {#contexto}

真实的 DevAgent（ADR 0012）在纸面上是完整的——worktree 中的 ToolLoop、要求测试套件为绿的 `ReportDone`、带诊断的阻塞、按任务的预算——但**从未用真正的 LLM 运行过验收标准**。尝试时，审计找到了原因：它**什么都实现不了**。

## 决策 {#decisões}

### 1. DevAgent 卡在**两个**地方（核心发现） {#1-o-devagent-estava-travado-em-dois-pontos-o-achado-central}

- `dev-*` 的 `write_file` 不在 `WriteFilePolicy` 的白名单中（默认只有 `echo`），于是它变成 `proposed_action`——而 `write_file` 在 api 中**没有执行器**，也就是说，即使被批准也不会写入。
- `terminal` 没有任何规则：`decide()` 落到 `require_approval`，动作以待处理状态诞生。

由于 `ReportDone` 只在历史中有一个 `exit 0` 的 `terminal` 之后才放行 PR，绿色的测试套件是**无法达到**的：每个任务都因迭代上限而以阻塞告终。结束纪律的执行是对的；缺的是 agent 能够行动。

**修正：**
- `WriteFilePolicy` 获得 agent 前缀（`:write_file_agent_prefixes`，默认 `["dev-"]`）：dev 可以写入其根目录中的任何路径。这是安全的，因为它的根**就是** worktree，而 `WorkspaceFiles.write_file/3` 已经阻止路径穿越——**沙箱是 worktree，而不是路径前缀列表**。
- `DEV_TERMINAL_ALLOW_PATTERNS`（api 领域）在激活时播种到 `permissions.json` 中。**狭窄**的测试/构建模式（`Terminal(pnpm test)`、`Terminal(npm test)`、`Terminal(mix test)`……），可在 DTO 中覆盖。有意**不**为 `terminal` 使用 `agent_autonomy auto_approve`：那会放行任何命令。作为文件规则，`deny` 仍然胜出，`BUILTIN_DENY_PATTERNS` 仍然有效，复合命令要求每个片段都匹配。

### 2. 按模块过滤的 ADR {#2-adrs-filtrados-por-módulo}
`open_adr_pr` 获得 `modules?: string[]`（Arquiteto 的工具会填写它）。`GetDevTaskContextUseCase` 按 dev 的模块过滤；**没有** `modules` 的 ADR 是横切的，总是进入——这包括该字段之前的所有存量，无需数据迁移。没有提供模块时不过滤，保留了复用同一上下文的 QA/SecOps gate。

### 3. prompt 的丢弃优先级是颠倒的 {#3-prioridade-de-descarte-do-prompt-estava-invertida}
`estado_tarefa` 原来是 `[story, task | adrs]`，而 `PromptAssembler.fit_units/3` **从头部**丢弃：在上下文压力下，故事（RF/RNF/DoD）被牺牲而 ADR 存活——与对实现者有用的恰好相反。现在是 `adrs ++ [story, task]`。

### 4. 按任务的预算持久化在项目中 {#4-orçamento-por-task-persistido-no-projeto}
它原来只是激活的参数，存在于 `engine.dev_agent_states` 中：重新激活时不再传入，就会静默地回到默认值。新列 `projects.task_budget_micros`；解析顺序为**参数 → 项目 → 默认**，参数中给出时会持久化。

### 5. 构件 `task_blocked` {#5-artefato-task_blocked}
阻塞原来只发出事件 + 数据库中的标志。现在还发出 `artifact.task_blocked`，由 `ArtifactSchemas` 验证——由服务器发出，绝不通过工具调用（模型不选择宣布自己放弃）。

### 6. 可诊断性：LLM 错误不能变成空的诊断 {#6-diagnosticabilidade-erro-de-llm-não-pode-virar-diagnóstico-vazio}
`ToolLoop` 在模型没有发出信号就停止时，以及对 provider 的调用**失败**时，都返回 `{:ok, ctx}`——而 `DevAgentServer` 以诊断 `""` 阻塞任务。ctx 开始携带 `:last_error`，诊断区分这两种情况。这不是理论上的：第一次真实演示死于一个看不见的 `Req.TransportError{reason: :timeout}`。

### 7. LLM 回合的超时 {#7-timeout-de-turno-de-llm}
`llm_turn` 使用 Req 的默认值。对于本地模型，**第一个**回合在第一个 token 之前还要加载几 GB 的权重，因而超时。新的 `llm_turn_timeout_ms`（默认 300s，环境变量 `LLM_TURN_TIMEOUT_MS`）。

### 8. engine 镜像中的 Node {#8-node-na-imagem-do-engine}
被管理项目的测试套件在 **engine 的容器内部**运行（`terminal` 在那里、在 worktree 中执行）。没有工具链，`npm test` 永远不会给出 exit 0。**已知限制：** 这无法扩展到任意的技术栈——真正的出路是按项目的沙箱，不在 Fase 4a 的范围内。

## 后果 {#consequências}

- 新测试：`write_file_policy`（dev 在根目录写入；路径穿越被阻止）、dev 的 `context_builder`（RF/RNF/DoD + 模块的 ADR + AGENTS.md 确实进入 prompt；ADR 先于故事被丢弃）、测试套件一直红到上限并在诊断中带有测试输出、构件 `task_blocked`、按模块的 ADR 过滤、`activate-execution`（预算的顺序、终端模式、绝不 `git_merge`），以及 web 中的 `lib/execution.ts`。
- UI：面板中的任务标题（以前只有分支 `task-<8hex>`）、通过通道使 backlog 失效（实时的 blocked）以及解除阻塞按钮。

## Resultado do critério de aceite (honesto) {#resultado-do-critério-de-aceite-honesto}

整条链用本地 LLM 端到端地演练过：原子认领、隔离的 worktree、组装的上下文、LLM 回合，以及带诊断和构件的阻塞结局。**没有达成的是 2 个绿色 PR**——原因是模型，而不是平台：`qwen2.5-coder:7b` 在 Ollama 的模板中没有实现工具调用。直接对 `/api/chat` 验证，使用 `stream: false` 和正确的 `tools` payload，响应带回 `tool_calls: null`，调用以 JSON 写在 `content` 中。对 `OllamaProvider` 的任何调整都无法修正这一点。

达成该标准需要一个真正带工具模板的模型（`llama3.1:8b` 或更大）或付费的 provider。这是用户的决定——平台对两者都已就绪。
