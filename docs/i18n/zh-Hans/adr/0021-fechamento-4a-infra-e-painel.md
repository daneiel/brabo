---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0021 — 阶段 4a 的收尾：真正做校验的 infra gate，以及说真话的面板

- 状态：已接受——验收标准**未**闭合（见专门的章节）
- 日期：2026-07-25
- 阶段：4a（收尾——对 ADR 0014 的审计）

## 背景 {#contexto}

ADR 0014 交付了 InfraAgent、infra 的 PR gate 以及团队面板。与 ADR 0019 和 0020 一样，**验收标准从未
运行过**：没有 infra 的演示（在四个演示脚本中 `grep` `InfraAgent|open_infra_pr|handoff-infra`，每个都
返回 0）。

通过阅读进行的审计发现，验收标准的**两**侧都受到了损害——QA gate 什么都不校验，而面板对大多数 agent
显示的状态是错的。

正确且未被改动的部分：对 InfraAgent 的终端拒绝（通过工具注册表 + 策略 `agent_autonomy deny` 在结构上
实现，短路在 `decide.spec.ts` 中证明，完整路径在 `propose-action.use-case.spec.ts` 中证明）、共享的
gate 机制、不开新 PR 的修正循环，以及对 `docker build --check` 的拒绝（engine 的容器没有 `docker` CLI，
也没有挂载 socket——经检查确认）。

## 决策 {#decisões}

### 1. infra 的 QA gate 会批准**任何** Dockerfile（核心发现） {#1-o-gate-de-qa-de-infra-aprovava-qualquer-dockerfile-o-achado-central}

`hadolint` **没有安装在 engine 的容器中**。而 `InfraGateRunner.lint_dockerfiles/1` 把缺失视为优雅降级：
返回 `{[], ["hadolint indisponível, pulado"]}` → `findings == []` → `veredito = "approved"`。

验收标准（“带有效 Dockerfile 并通过 gate 的 PR”）会在什么都没验证的情况下通过。与 ADR 0020 的 gitleaks
属于同一类：gate 看起来是绿的，恰恰因为它什么都不检查，而优雅降级——出于正当理由而存在——把这一点掩盖了。

`hadolint` 进入了 Dockerfile，与 gitleaks 放在**同一个**块中，以便在虚拟包组中的 `curl` 被移除之前
利用它。

### 2. compose 和 CI 没有经过任何校验 {#2-compose-e-ci-não-passavam-por-validação-nenhuma}

`lint_dockerfiles/1` 按 `dockerfile?/1` 过滤，甚至有一个测试固定了“文件中没有 Dockerfile 时，不运行
hadolint 就批准”。但 InfraAgent **还**会提议一个 `docker-compose.yml` 和一个
`.github/workflows/ci.yml`，而需求要求对 infra 的 PR 进行“语法校验”。

`Engine.Actions.YamlLintDetector`（新增）是 `HadolintDetector` 的镜像——用内容而不是路径，
`available?/0` + `lint/1`，`.Live`/`.Fake`，同样的降级。它通过 pip 使用 `yamllint`，利用 semgrep 已经
带来的 python3：Elixir 的依赖中没有 YAML 解析器，而本项目做校验的惯例是带可选检测的外部工具，而不是
新依赖。

### 3. 严重程度：只有 `error` 会否决——否则 gate 毫无用处 {#3-severidade-só-error-reprova--senão-o-gate-é-inútil}

这是在写代码之前测试二进制时发现的，它决定了 gate 是否可用：

- 一个完全合理的 Dockerfile（`FROM node:24-alpine` +
  `RUN apk add --no-cache git`）就已经会收获 `warning` DL3018（“pin versions in apk add”）。如果
  `warning` 会否决，**没有任何由 LLM 生成的 Dockerfile 能通过**，InfraAgent 会一直绕圈直到超出修正
  上限——这正是卡住 ADR 0020 验收的那个循环。
- 在 yamllint 中，按级别过滤还不够：在 `relaxed` 配置下，它把 `new-line-at-end-of-file` 归为
  `[error]`，而 LLM 生成的 YAML 很少以换行结尾。出路是用**空规则**运行（`-d "{rules: {}}"`）：没有任何
  激活的规则时，yamllint 只报告**解析**失败，这正是“语法校验”的意思。已验证：没有末尾换行的合法 YAML
  干净通过，未闭合的 `ports: [` 输出 `[error] syntax error (syntax)`。

非阻塞的发现仍作为信息留在意见书中——摘要区分“N 个发现”和“N 个非阻塞警告”，以免意见书暗示一个风格上
的小问题拦下了 PR。

### 4. `agent.status` 从未被持久化——4 个 agent 卡在“空闲” {#4-agentstatus-nunca-era-persistido--4-agentes-presos-em-ocioso}

在 engine 中，`agent.status` 只作为 `EngineWeb.Endpoint.broadcast` 存在。但 `deriveAgentRoster` 从通过
HTTP 获取的 event log 中读取 `agent.status`——于是 Criativo、PO、Arquiteto 和 Infra **永远显示为“空闲”**，
即使在回合进行中。更糟的是：web 的 `onAgentStatus` 处理器会使一个查询失效，而这个查询在构造上永远不会
包含 push 刚刚带来的数据。

`Engine.Sessions.LiveBroadcast.agent_status/4`（新增）既广播**又**持久化。四个服务器改为通过
`broadcast/3` 的一个子句路由，而不是修改 20 个调用点。先广播（那是实时路径，不应等待 HTTP 往返）；追加
失败不会搞垮回合——状态是叙述，而不是决策。

### 5. 面板读取的是会话的**前** 200 个事件 {#5-o-painel-lia-os-200-primeiros-eventos-da-sessão}

`listPaginated` 以 `asc(seq)` 加 `limit` 排序。团队面板、执行分区和活动动态一旦会话超过 200 个事件——
真实执行轻松就能做到——就会永远从会话的**开头**推导状态。仅这一点，就使“在真实执行期间状态正确”失效。

`ListPaginatedOptions.latest`（选择性启用）通过数据库从末尾取，并在内存中反转，以升序返回，不改变消费者
的读取方式。`nextCursor` 是 `null`：不存在比最后一页更新的页——遍历整个会话的人继续使用 `afterSeq`，
`latest` 会忽略它。

### 6. 从不说真话的状态启发式 {#6-heurísticas-de-status-que-nunca-diziam-a-verdade}

- `devStatus` 对任何不是阻塞的情况都返回 `trabalhando`，即使日志中有 `dev.idle`，甚至**没有该 agent
  的任何事件**：一个停住的 dev 会永远显示为工作中。现在 `dev.idle` 和完全的沉默都表示 `ocioso`。
- **没有任何路径产生 `aguardando`**——页头的计数器总是 0。现在，有待处理 `proposed_action` 的 agent 会
  进入 `aguardando`，这是它在面板上所能有的最有信息量的状态。`falhou` 仍然优先：被阻塞的 task 是用户
  首先需要看到的。

### 7. AgentCard 不显示自主程度、task 或 token {#7-o-agentcard-não-mostrava-autonomia-task-nem-tokens}

- 自主程度的开关**从未渲染**：`AgentCard` 要求 `autonomy && onAutonomyChange`，而
  `ProjectOverviewTab` 从未传入处理器。`setAgentAutonomy` 自阶段 4a 起就作为**死代码**存在于
  `api-client.ts` 中。此外 `autonomyActionTypeFor` 只映射了 `infra` 和 `dev-*`——
  criativo/po/arquiteto/qa/secops 根本收不到这个 prop。
- task 和 token 既没有 prop 也没有位置。task 已经由 `deriveExecutionProgress` 推导出来，但只供给
  `ExecutionSection`：同一个 `dev-<modulo>` 在界面上出现两次，一次有数据，一次没有。
- **按 agent 的 token 在后端不存在。** `token_usage` 有 `session_id`/`actor_id`/`cost_micros`，但端口
  只暴露了 `sumBySessionAndActorIds`，只被 Psicólogo 的成本消费，而且没有路由。新增：
  `sumBySessionGroupedByActor`、`GetSessionTokenUsageUseCase` 以及
  `GET projects/:id/sessions/:id/token-usage`。没有新的埋点——`RecordLlmUsageUseCase` 已经为任何
  agent 记录。

### 8. tool call 恢复对对话型 agent 不起作用 {#8-recuperação-de-tool-call-não-valia-pros-agentes-conversacionais}

在执行验收标准时发现。InfraAgent 写出了**正确**的 `propose_infra_pr`，但它是一个文本块而不是原生的
tool call——回合以空响应结束，agent 进入空闲，什么都没提议。`Engine.Harness.ToolCallRecovery` 自
ADR 0020 起就存在，恰好解决这个问题，但它位于 `ToolLoop` 内部，而四个对话型 agent
（Criativo/PO/Arquiteto/Infra）有**自己的循环**——它们被排除在修正之外而无人察觉，因为从那以后它们没有一个
针对本地模型运行过。

四者的 `tool_calls/2` 现在在 `toolCalls` 为空时查询恢复机制，锚定在 agent 自己的 `tool_specs` 上
（与 ToolLoop 同样的精度：只恢复真正注册为工具的名称）。

### 9. QA gate 会批准**不含任何**合法文件的 infra PR {#9-o-gate-de-qa-aprovava-pr-de-infra-sem-nenhum-arquivo-válido}

第二种空批准的形式，同样只有在运行时才出现：模型产出了畸形的 `files`——`path` 是 JSON 片段——因此没有
任何 Dockerfile 或 YAML 被识别，`lint_dockerfiles/1` 和 `lint_yamls/1` 返回空列表，裁决成了
**`approved`**，摘要逐字写着 “nenhum Dockerfile encontrado na PR nenhum YAML encontrado na PR”。该 PR
在不包含任何一个 infra 产物的情况下到达了 `awaiting_user`。

演示的断言抓住了它（要求有一个 Dockerfile）；**gate** 没有。现在，一个没有任何可识别文件的 infra PR 会
是 `changes_requested`，附带一条解释 `path`/`content` 期望格式的条目。**无法校验不等于有效**——而原有的
测试（`"sem Dockerfile entre os arquivos, aprova sem rodar hadolint"`）恰恰是在固定这个缺陷。

### 10. 动态没有叙述执行阶段 {#10-o-feed-não-narrava-a-fase-de-execução}

`classifyEvent` 覆盖了意见书、gate 和 infra，但需求中逐一点名的事件落入了通用分支：

- `backlog.task_claimed` → “atualizou o backlog”，没有说是**哪个** task
- **dev 的 PR** → api 记录 `action.pr_open`，它落入 `action.*` 分支，被叙述为 “executou um comando”，
  与任何终端操作混在一起
- `backlog.task_blocked`/`task_unblocked`/`task_status_changed` → 通用

### 11. 绝对路径搞垮了 PR，而孤立的分支卡住了会话 {#11-caminho-absoluto-derrubava-a-pr-e-a-branch-órfã-travava-a-sessão}

两个串联的缺陷，都是我们自己的，在执行中发现：

- 模型选择了 `path: "/api/Dockerfile"`。本地 provider 的 `commitFiles` 把路径直接传给
  `git update-index --cacheinfo`，后者拒绝绝对路径——整个 PR 死于一个不透明的 `Command failed: git ...
  update-index`。`normalizeInfraPath`（新增，纯函数，经过测试）去掉开头的斜杠（明确表示“仓库根目录”
  的意图），并以清晰的消息**拒绝**路径穿越（`..`）：来自 LLM 的内容从来没有正当理由写到仓库之外。
- 当第一次尝试在 `createBranch` **之后**、artifact 被写入**之前**失败（它只在成功时诞生）时，之后的每次
  尝试都会再次落入 `createBranch`，并死于“分支已存在”——会话**永久**无法打开 infra PR。日志中连续五次
  这样的尝试。`createBranch` 现在容忍已存在的分支。

`ExecuteInfraPrUseCase` 原本没有任何测试；它获得了六个。

## 验收标准的状态：**未**闭合 {#estado-do-critério-de-aceite-não-fechado}

四次执行，没有一次完成。前三次失败于**我们自己的缺陷**（第 8、9、11 项）——这正是坚持下去有价值的原因：
每次执行都付出了一个任何阅读都没找到的真实缺陷。

第四次失败于**模型的局限**：`qwen2.5-coder:7b` 产出的 `propose_infra_pr` 带有畸形的 JSON（引号不配对）
和毫无意义的内容（以 `node_modules/@express·require` 作为 Dockerfile 的内容）。tool call 恢复正确地返回
了空——它拒绝对坏掉的 JSON 进行猜测，而这种拒绝是正确的行为。

InfraAgent 的任务比 DevAgent 的更难：三类产物（每个模块的 Dockerfile + compose + CI），带真实内容，在
单次带嵌套 payload 的工具调用中完成。一个本地 7B 无法可靠地支撑这一点。

**还缺什么**：把 infra 演示的 `DEMO_MODEL` 指向一个 API 模型。与 ADR 0020 关于 QA 语义 gate 的结论相同，
而按 agent 的 binding 已经为此而存在。

尽管如此，在真实执行中**已经**验证的有：

- 持久化的 `agent.status`（event log 中的 `working`/`idle`——第 4 项）
- 对话型 agent 中正在工作的 tool call 恢复（第 8 项）：在其中一次执行中，InfraAgent 提议了 PR，两个
  gate 一直运行到 `awaiting_user`
- infra 的 gate 按顺序触发，并以 `prActionId` 记录意见书
- gate 拒绝没有合法产物的 PR（第 9 项），hadolint/yamllint 已安装并在容器中响应

## 后果 {#consequências}

- 测试套件：engine 237、api 445、web 72（基线 227/433/47）。
- 测试：`hadolint_detector_test` 和 `yamllint_detector_test` 针对**真实**二进制（tag
  `:hadolint`/`:yamllint`，缺失时自动排除——与 `:gitleaks` 同样的机制），固定了坏掉的语法会被否决而风格
  小问题不会；`session-event-latest.repository`（前 × 后）；`token-usage.repository`（按操作者聚合）；
  `agent-status.test.ts` 和 `activity.test.ts`——**`deriveAgentRoster` 和 `classifyEvent` 原本连一个
  测试都没有**，而它们正是需求的第 3 和第 4 项；`AgentCard.test.tsx`（五个字段 + 开关）。
- `apps/api/scripts/demo-infra-agent.ts`（`pnpm --filter api demo:infra-agent`）是可执行的验收标准。
  如果意见书的摘要写着 “hadolint indisponível” 或 “yamllint indisponível”，它会明确失败——一个不校验就
  批准的 gate 不算批准。

## 范围与假设 {#escopo--assunções}

`docker build --check` 仍不在范围内（engine 容器中没有 `docker` CLI，也没有 socket）——需求以“在容器中
可用时”容纳了这一点。

Phoenix 通道仍然是重新获取的**触发器**，而不是数据来源：`event.appended` 的 payload 被丢弃，更新界面的是
查询的失效。由于 `agent.status` 现在被持久化，push 所宣告的数据确实存在于日志中——那正是断掉的那一环。
直接使用 payload 的转发仍不在范围内。

dev/qa/secops 的状态仍是基于 event log 的启发式（尽力而为，从不被 gate 的决定使用）。演示不具确定性：
InfraAgent 通过 LLM 生成文件，所要求的是带 Dockerfile 的 PR 和两份意见书——而不是模型写出某个特定的
Dockerfile。
