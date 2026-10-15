---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0020 — 解锁 QA 与 SecOps 的 gate：在工作树上运行 gitleaks、经过校验的意见书，以及文本形式的 tool call

- 状态：已接受——验收标准已**闭合**，但使用本地模型时不具确定性（见专门的章节）
- 日期：2026-07-25
- 阶段：4a（关闭 PR gate 的偏差）

## 背景 {#contexto}

PR gate（ADR 0013）在纸面上是完整的——具有不可变顺序和修正上限的状态机、强制
`emit_qa_verdict` 的 QAAgent、确定性的 SecOpsAgent、在同一分支上的
`DevAgentServer.correct/3`、带时间线的 UI——但**从未运行过验收标准**。gate 没有演示：
`demo-dev-agent-real` 停在 PR 打开处。

与 ADR 0019 对 DevAgent 所做的相同：编写验收演示，用真实的 LLM 和扫描器运行，修复出问题
的地方。通过阅读进行的审计在第一次执行前就发现了四个缺陷，其中一个是致命的；随后的十次
执行又发现了六个，另外还有五个推理环境的问题。

验收标准：在一个带有 (a) 一条没有测试的规则和 (b) 一个硬编码机密的 task 中，QA 退回第一个，
dev 修正，SecOps 拦下第二个，dev 修正，PR 到达 `awaiting_user`，时间线上有 4 份意见书。
**已闭合**——真实的序列见后文。

这次会话中最引人注目的是：十次执行中，**没有一次**是因为状态机、gate 的强制执行或退回
流程中的缺陷而失败的。它们的失败原因是：扫描器扫错了对象、未经校验的 artifact、凭猜测给出
原因的诊断、被悄悄截断的上下文、闲置的 GPU，以及不会过期的植入指令。

## 决策 {#decisões}

### 1. gitleaks 扫描的是**历史**，而不是工作树（致命的发现） {#1-gitleaks-varria-o-histórico-não-a-árvore-de-trabalho-o-achado-fatal}

`Engine.Actions.GitleaksDetector.Live` 运行的是 `gitleaks detect --source
<worktree>`。在 gitleaks 8.x 中，`detect` 扫描的是 **commit 日志**。

在 gate 流程中的后果，在任何修复之前已在容器中证实：dev commit 了机密 → SecOps 否决 →
dev 在一个**新的** commit 中删除机密 → 机密仍留在分支的前一个 commit 中 → SecOps 再次
否决，每一轮如此，直到超出上限、task 变为 `blocked`。**任何机密修正都不可能：验收标准
无法达成。**

```
árvore de trabalho já limpa, segredo só no commit anterior:
  gitleaks detect --source  -> 2 commits scanned, leaks found: 1   (reprova pra sempre)
  gitleaks dir              -> no leaks found                      (aprova, correto)
```

改为 `gitleaks dir <worktree>`。记录下的后果有：

- `docker/engine/Dockerfile` 中的固定版本 `GITLEAKS_VERSION` 变得**举足轻重**：`dir` 从
  8.19 才开始存在。更旧的二进制会返回 `[0, 1]` 之外的退出码，这已经会落入
  `{:error, :scan_failed}`，gate 记录为“跳过”——降级而不崩溃。
- 开始扫描 worktree 的**整棵**树（diff 的超集）。基础分支中预先存在的机密会否决每一个 PR。
  这对 gate 来说是正确的行为，但比 ADR 0013 承诺的“针对 diff”更宽——diff↔发现的逐行关联
  仍不在范围内。
- `gitleaks dir` 报告**绝对**路径（`detect` 报告的是相对路径）；检测器现在会将其相对化，
  因为路径会进入用户阅读的意见书以及 dev 的修正 prompt。

### 2. 意见书不是经过校验的 artifact {#2-pareceres-não-eram-artefatos-validados}

需求写的是“将意见书记录为 **artifact**”，但两个 gate 都是**原样**写入 `session_event`
`artifact.qa_verdict`/`artifact.secops_verdict`，不经过 `Engine.Harness.ArtifactSchemas`——
与 ADR 0019 为 `task_blocked` 修正的偏差相同。

- 这两种类型进入 `@schemas`，但在 `@tool_emittable` **之外**：它们由服务器发出（SecOps
  甚至没有 LLM；QA 的意见书来自工具 `emit_qa_verdict`，另行强制）。
- 意见书的**主体**不是固定的必填键：dev 的 gate 使用 `taskId`，`InfraGateRunner` 使用
  `prActionId`，在**同一**种 artifact 类型中。`check_extra/2` 恰好要求二者之一——绝不两个
  都有，绝不一个都没有。UI 已经在结构上处理了这两种（`GateSubject`）。
- `veredito` 根据 api 状态机的取值进行校验：`approved`/`changes_requested` 之外的裁决会让
  `RecordGateVerdictUseCase` 崩溃，所以最好拒绝该 artifact。
- `Engine.Harness.ArtifactEmitter`（新增）集中了“先校验，才写入 + 广播”。
  `AgentIo.emit_artifact/3` 改为委托给它；三个服务器端的发出者（dev、dev 的 gate、infra 的
  gate）走同一条路径。

### 3. 扫描器可能挂住 gate {#3-scanner-podia-pendurar-o-gate}

`run_scanner/3`——在 `SecOpsAgentServer` 和 `InfraGateRunner` 之间逐字节重复——在
`handle_cast` **内部同步**调用 `System.cmd`，没有超时。一个卡在网络上的
`semgrep --config auto` 会冻结整个项目的 gate，且没有任何诊断。

`Engine.Gates.Scanner`（新增）统一了两者，并采用
`Engine.Actions.TerminalExecutor.execute/3` 的惯用法：`Task.async` + `Task.yield` +
`Task.shutdown(:brutal_kill)`，上限为 `SECOPS_SCAN_TIMEOUT_MS`（默认 180s，比终端宽松得多，
因为 semgrep 要扫描整棵树并从网络获取规则）。超时复用已有的“跳过”路径。

**超时测试发现了修复本身引入的一个回归：** `Task.async` 会把 task **链接**到调用者，因此
抛出异常的检测器会搞垮 gate 的 GenServer——比原来的同步调用更糟。对检测器的调用被包在 task
**内部**的 `try/rescue/catch` 中，转为返回值。

semgrep 还加上了 `--metrics=off` 以及对 `node_modules`/`.git` 的排除。`--config auto` 仍然
依赖网络；没有网络时 gate 记录“跳过”——验收只依赖 gitleaks。

### 4. QA 没有 token 上限，并且会烧掉修正上限的轮次 {#4-qa-sem-teto-de-tokens-e-queimando-volta-do-teto-de-correções}

- `QaAgentServer` 没有把 `token_budget_micros` 传给 ToolLoop（DevAgent 会传）。gate 在**每次**
  修正时都会重新运行，因此成本会无上限地成倍增长。现在它使用与 dev 相同的
  `task_budget_micros`，后者已经通过与 `max_gate_corrections` 相同的路径从数据库读取。
- 一个没能得出意见书的 QA（迭代上限、预算、模型停止）会变成 `changes_requested`。这会
  **退回给 dev——而 dev 没有什么可修的——并烧掉 K 次修正中的一次**；如果反复倒霉，一个坏掉的
  QA 会阻塞一个完美的 task，而记录下的意见书还会归咎于 dev。现在它直接阻塞 task，给出真实
  原因且不消耗修正次数，并区分这三种结果（使用 `ctx.last_error` 区分“模型停了”和“provider
  失败了”，就像 ADR 0019 为 dev 所做的那样）。

### 5. 本地模型以**文本**形式发出 tool call（执行中的发现） {#5-modelo-local-emite-tool-call-como-texto-o-achado-da-execução}

在验收的第一次执行中，`qwen2.5-coder:7b` 产出了**完全正确的工作**——两个 `write_file` 和
正确的 `terminal`，植入了机密、缺少测试——但它把一切都作为 `content` 中的一个 ```json 代码块
发出，而不是使用原生的 tool calling 协议。`ToolLoop` 看到 `toolCalls` 为空，以 `{:ok, ctx}`
结束，task 死于“停止了，既没有完成也没有报告阻塞”。gate 从未打开。

`Engine.Harness.ToolCallRecovery`（新增）**只在 `toolCalls` 为空时**才会被查询——真正做
tool call 的模型永远不会经过那里。它从文本中提取顶层 JSON 对象（通过计数花括号扫描，能识别
字符串和转义：模型会在**同一个**代码块中发出多个拼接的对象，那不是一个有效的 JSON 文档）。

什么算作 tool call 的过滤条件**在执行过程中被收紧了**：第一版接受任何带 `name` +
`arguments` 的对象，而一个真实的 QA 发出了 `{"name": "enviar(payload)", "parameters": {...}}`
——幻觉出了对它正在审查的**业务**函数的调用。现在 `name` 必须在循环的工具注册表
（`ctx.tool_specs`）中。名称被锚定之后，`parameters` 就可以作为 `arguments` 的同义词被接受，
而不会为任意 JSON 开门。这不是自然语言解析器：如果模型只是在聊天，结果就是 `[]`，循环照旧
结束。

### 6. 响应**正文中**的 provider 错误变成了“模型停了” {#6-erro-de-provider-no-corpo-da-resposta-virava-o-modelo-parou}

ADR 0019 让 `ToolLoop` 在 `llm_turn` 返回 `{:error, _}` 时保存 `ctx.last_error`。但当
provider 失败时，api 返回的是**正文中带 `error` 的 200**——只有传输层故障才会变成
`{:error, _}`。在这条路径上 `last_error` 一直是 `nil`，而消费 `{:ok, ctx}` 的一方会把一次
基础设施故障诊断为“模型没有发出信号就停了”。

以最糟糕的方式发现的：QA 的 gate 在 Ollama 上死于 `fetch failed`，而记录在 event log 中的
诊断说“模型停了，没有调用 `emit_qa_verdict`”——系统把 provider 宕机归咎于模型。`loop/1`
现在也会记录正文中的 `error`。

### 7. 把 QA 的 prompt 写成明确的协议 {#7-prompt-do-qa-como-protocolo-explícito}

QA 的 `initial_message` 原本是一段松散的段落，而 DevAgent 有仓库的 AGENTS.md 指引每一步。
它被改成了编号的脚本：逐条列出 story 的规则、每一步使用哪个工具、每条规则一行
`coverageMatrix`、明确写出 `approved` 的标准，以及永远不要调用被审查代码中的函数的指示。

### 8. Ollama provider 中的 `fetch` 没有可配置的超时 {#8-fetch-sem-timeout-configurável-no-provider-ollama}

`ollama-provider.ts` 使用 `fetch`，其在 undici 中的 `headersTimeout` **固定**为 300s——
只能通过传入自定义 `dispatcher` 来配置，而那需要 `undici` 依赖。实际上，engine 的
`LLM_TURN_TIMEOUT_MS` 毫无作用：api 会先放弃，报一个不透明的 `fetch failed`，而 agent 记录
“模型停了”，针对的却是一个从未得到响应的请求。

改用 `node:http`（没有新依赖），并加入 `OLLAMA_REQUEST_TIMEOUT_MS`（默认 300000，行为不变）。
语义也一并改善：这是 socket **不活动**的上限，而不是总时长——一个合理的回合可能要花几分钟
处理 prompt，但永远不会安静太久。这个 provider 原本没有任何测试；现在有了一个使用真正的
假 Ollama（`node:http`）的测试，覆盖了在 chunk 之间被切断的 NDJSON 流行、沉默的服务器、
状态 500 以及连接被拒。

它必须 `>=` engine 的 `LLM_TURN_TIMEOUT_MS`，否则先放弃的是 api，engine 的上限仍只是装饰。

### 9. gate 的意见书优先于 task 的需求描述 {#9-parecer-de-gate-prevalece-sobre-o-enunciado-da-task}

在修正期间，原始 task 仍留在上下文中（是它定义了要实现什么），而 `correction_message`
给意见书的权重与之相同。当 gate 与需求描述矛盾时——典型情况是 SecOps 要求移除 task 要求
加入的机密——agent 会服从 task，重新放回问题。prompt 现在明确说明意见书**优先**。

坦白说：**闭合验收的并不是这个**（见验收标准的章节）。这是正确的说法，也继续有效，但真正
解决问题的是把矛盾的指令从那里拿掉。

### 10. `--metrics=off` 让 semgrep 彻底坏掉了 {#10---metricsoff-quebrou-o-semgrep-por-inteiro}

由决策 3 引入的回归：`--config auto` **要求**开启遥测
（"Cannot create auto config when metrics are off"），于是每次扫描都以错误退出，gate 记录
“semgrep 失败，跳过”——按设计优雅降级，也正因如此在连续四次验收执行中都没被注意到。

改为**具名**规则集（`p/security-audit`），它在关闭指标时也能运行。为了运行安全 gate 而把
用户代码的画像发送给 semgrep.dev，不是可接受的交换。规则仍会在第一次执行时通过网络从
registry 获取；没有网络时 gate 继续记录“跳过”。

## 验收标准的状态：已闭合，但**不具确定性** {#estado-do-critério-de-aceite-fechado-mas-não-determinístico}

在第 10 次执行时闭合，使用本地 `qwen2.5-coder:7b`，完全按需求描述的顺序
（`pnpm --filter api demo:pr-gates`，exit 0）：

```
dev    → PR aberta
qa     → changes_requested: regras da story sem teste
dev    → corrige (MESMA branch, sem PR nova)
qa     → approved                        → awaiting_secops
secops → changes_requested: [gitleaks] src/credenciais.js:2 — GitHub PAT
dev    → corrige (MESMA branch)
secops → approved                        → awaiting_user
```

**紧接着的第 11 次执行没有闭合**——QA 正确地指出了没有测试的规则，dev 做了修正，而在第二轮
QA 没有调用 `emit_qa_verdict` 就结束了循环。这与修复无关：是模型的方差。使用本地
`qwen2.5-coder:7b` 时，验收中的**语义**步骤（在同一个 PR 中连续两次把业务规则与测试交叉
比对）并不可靠。

这意味着什么、不意味着什么：

- **gate 机制已经验证。** 完整的序列是由真实 agent 针对真实扫描器产生的：不可变顺序、在同一
  分支上退回、修正上限、作为 artifact 的意见书、终态 `awaiting_user`。这在各次执行之间不会
  退化——变化的是模型的判断。
- **只要依赖本地 7B，这个演示就不能作为自动化回归测试。** 它作为可执行的验收标准，需要有意
  地运行。要让它可靠，请把 `DEMO_QA_MODEL` 指向一个 API 模型：语义 gate 是最不适合小模型的
  角色，而按 agent 的 binding（作用域 `agent`，优先于 `project`）正是为此而存在的。

在闭合那次之前的九次执行中，没有一次是因为 gate 的缺陷而失败——它们失败于推理环境，以及
演示本身的一个设计错误。值得记录，因为它们都不在领域代码中：

### 推理环境（现在全部暴露在 `docker-compose.yml` 中） {#ambiente-de-inferência-tudo-exposto-agora-no-docker-composeyml}

| 变量 | 哪里出了错 |
|---|---|
| GPU | `ollama` 服务没有预留设备：RTX 4060 处于**闲置**，而一个 5,9GB 的模型 100% 在 CPU 上运行。QA 约 7.000 token 的 prompt 光是读入就要约 50s。它变成了可选启用的 override `docker-compose.gpu.yml`（`pnpm dev:gpu`），放在主 compose 之外，因为宿主机上没有 `nvidia-container-toolkit` 时，这个预留**会**让服务启动失败。在 GPU 上：`100% GPU`，5,5GB 在显存中 |
| `OLLAMA_CONTEXT_LENGTH` | 默认 4096，**悄无声息地**截断一个为 128k 组装的 prompt——agent 丢掉了自己的指令，开始模仿工具的 schema，那是上下文末尾仅剩的东西 |
| `OLLAMA_MAX_LOADED_MODELS` | `OLLAMA_KEEP_ALIVE` 较高时模型会**累积**：在一台 15GB 的机器上常驻 15,2GB 的权重，agent 因内存不足而返回空响应 |
| `OLLAMA_REQUEST_TIMEOUT_MS` | 见决策 8 |
| `START_OUTBOX_DRAIN` / `START_ANAMNESE` | Psicólogo 和 Anamnese 与执行 agent 并行消耗 LLM 回合，在周期中途拖垮了 dev 的连接。**注意：这些守卫只阻止新的入队**——曾经累积了来自之前执行的 20 个处于 `executing` 的 `AnamneseWorker`，它们会在下一次启动时运行，与守卫无关。队列需要清空，而不只是关掉守卫 |

### 演示的设计错误：不会过期的植入指令 {#erro-de-desenho-do-demo-instrução-de-plantio-que-não-expira}

机密的植入方式是在 **task 描述**中让 dev 写下 `const TOKEN = "ghp_..."`。但描述在**每一轮**
修正中都固定在上下文里：SecOps 否决之后，dev 会照抄需求描述中的字面量重新生成文件——连续
四次，直到耗尽上限。event log 中的 `write_file` 显示 token 每一轮都原样重现。

没有任何 prompt 文字能胜过 task 中的一段字面代码（决策 9 尝试过，但不够）。植入被移到了仓库
的**骨架**中（`src/credenciais.js`，commit 在基础分支上）：dev 从未收到写入机密的命令，而
改为 `process.env` 也不与任何东西矛盾。这之所以可行，只是因为 SecOps 扫描工作树而不只是
diff——决策 1 被接受的后果，在这里变成了需求。

## 后果 {#consequências}

- 测试：`gitleaks_detector_test` 运行**真实**的二进制（tag `:gitleaks`，在其不存在时自动
  排除），并固定了第 1 条的回归；`scanner_test` 覆盖干净/有发现/缺失/挂起/崩溃；
  `artifact_schemas_test` 覆盖两种主体和无效裁决；`tool_call_recovery_test` 使用卡住演示的
  **真实**文本，以及**不是**工具的名称；`tool_loop_test` 覆盖响应正文中的错误；
  `qa_agent_server_test` 覆盖不烧掉修正次数的阻塞。Engine 227。
- `apps/api/scripts/demo-pr-gates.ts`（`pnpm --filter api demo:pr-gates`）是可执行的验收
  标准：未闭合时以非 0 代码退出，并打印意见书的时间线以供诊断。

## 范围与假设 {#escopo--assunções}

植入的缺陷来自 **task 的描述**，而不是模型的运气：它要求实现 story 的两条规则但只测试第一条，
并在代码中声明字面 token。这是刻意人为的——被测试的是 gate，而不是 dev 的勤勉。机密是一个
合成的 GitHub PAT，因为 gitleaks 的默认规则按格式 + 熵捕获 `ghp_`，而没有那个妨碍 AWS 密钥
（`AKIA...EXAMPLE`）的示例值 allowlist。

验收的语义步骤（QA 把功能需求与测试交叉比对）依赖模型的判断；`DEMO_MODEL` 和
`DEMO_QA_MODEL` 允许按 agent 更换模型。`awaiting_user` 仍是终态：合并始终由用户手动完成。

两条超出这些 gate 的教训：

- **推理环境是系统的一部分，而不是背景。** 这次会话中有三个问题不在任何一行 Elixir 或
  TypeScript 中：它们在于上下文大小、模型常驻以及 agent 之间的并发。全都表现为 agent
  “自己停下”——代码把这个症状归咎于模型。
- **靠猜的诊断比没有诊断更糟。** 这次会话中系统两次把基础设施故障归咎于模型（第 6 条），而
  QA gate 的修正（第 4 条）之所以存在，是因为 gate 把 QA 自身的故障归咎于 **dev**。每个 agent
  的结果都应该带着故障来自**哪里**，而不只是说出了故障。
