---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0026 — 阶段 5（第 3 次会话）：优雅关闭、OpenTelemetry、指标、日志与仪表盘

- 状态：已接受
- 日期：2026-07-26
- 阶段：5（第 3 次会话——范围第 4 和第 5 项）
- 继承：[ADR 0025](0025-fase5-deploy-kubernetes-kustomize.md)，其限制 1（“关闭时没有会话排空”）在这里
  得到解决。

## 背景 {#contexto}

第 1 和第 2 次会话交付了生产镜像、CI，以及按队列深度为 engine 配置 HPA 的 Kubernetes 部署。被明确留到
以后的，是优雅关闭和可观测性。

本次会话交付这两者。验收标准是双重且可执行的：在有活跃会话时进行一次 rollout 而没有任何孤儿；在本地
Grafana 中从根 trace 一路追踪一个会话到某个具体的 tool call，并在仪表盘上看到它的成本。

**大工作量不是写埋点——而是发现自上一次会话起扩展 engine 就是坏的。** 出现了六个缺陷，没有一个让测试
失败：其中五个在构造上就是无声的。

## 决策 {#decisões}

### 1. 一个会话在集群中只有**一个**属主：`:global` 注册 {#1-uma-sessão-tem-um-dono-no-cluster-registro-global}

`Engine.Sessions.SessionServer` 注册在一个**节点本地**的 `Registry` 中，而
`Engine.Sessions.Rehydrator` 在启动时为 `engine.session_states` 的每一行重建一个进程——而那是一张
全局表。有 N 个副本时，每个会话会存在 N 次；浏览器的 websocket 只到达**其中一个**（Service 做负载
均衡），其余 N−1 份副本收不到 `ping`，会超出 30s 的心跳，并让 api 结束**另一个 pod 上一个活着的会话**。

也就是说：扩展 engine 会在 30 秒内杀死用户的会话，而第 2 次会话中通过的 `make hpa-test` 会扩展到 3。

名称改用 `:global`。这在节点之间去重，并且顺带让 `heartbeat/1` 无论属主在哪里都能到达它——以前当
websocket 落到“错误”的 pod 上时，通道的 `join` 会失败。`Registry` 留在树中，因为 agent 的服务器
（`po:`、`criativo:`、`arquiteto:`、`infra:`）以带前缀的键使用它。

### 2. `:global` 通过**杀死**一个进程来解决名称冲突——这解释了一切 {#2-global-resolve-conflito-de-nome-matando-um-processo--e-isso-explicava-tudo}

这是本次会话最难的缺陷，值得记录方法，因为证据在好几轮里都指向了错误的地方。

症状：手动调用时 drain 工作得很完美（`5 sessões, 5
com node_shutdown`），而**在真正的 rollout 中什么都没排空**——`preStop` 报告 `total: 0`，api 把会话
记为 `killed`。

原因：在一次 rollout（`maxSurge: 1`）中，新 pod 在旧 pod 仍承载会话时启动。它在 `:global`**同步名称表**
之前就进行了重新水合，`whereis_name` 对存在于另一个节点上的名称返回 `:undefined`，于是它为每个会话
创建了第二份副本。当同步完成时，`:global` 用默认的解决器 `random_exit_name` 解决冲突，后者**以
`exit(pid, :kill)` 杀死两个进程之一**。抽签杀掉了旧 pod 上的那份副本，于是旧 pod 到达 `preStop` 时，
本地已经没有东西可排空。

非空的 `Node.list()` 表示**已连接**，而不是“表已交换”。缺的是 `:global.sync()`，是它关闭了这个窗口。
`Rehydrator` 改为在重新水合之前等待集群并同步——并且只在有会话需要重新水合时才这样做，以免在表为空时
拖慢启动。

### 3. 在 `preStop` 中主动排空，而不是 `terminate/2` {#3-drain-proativo-no-prestop-não-terminate2}

当 supervisor 关闭时，每个 `SessionServer` 收到 `exit(:shutdown)` 并立即死去——它们不捕获 exit，也
没有 `terminate/2`。加上 `trap_exit` 只能解决一半：supervisor 给每个子进程 5s，而 drain 需要网络
（api 中的事件，交接给另一个节点）。

因此 `preStop` 在整个 BEAM 仍在运行时调用 `Engine.Shutdown.drain()`。对每个本地会话：发出
`session.draining`，释放全局名称，并通过 `:erpc` 把会话提供给一个对等节点。**未被接管**的会话变为
`active → closing`（原因 `node_shutdown`），然后变为 `closed_abnormally`。

被接管的会话保持 `active`，从不变成 `closing`——状态机不允许从 `closing` 回到 `active`，因此对所有
会话都宣布 `closing` 会让接管变得不可能。这就是对需求中“closing/node_shutdown **或**重新水合”的回答：
两半都有，按会话决定。

`drain/0` 返回一个摘要（`%{total:, adopted:, terminated:}`）而不是 `:ok`，因为 hook 的 stdout 是 pod
消失后唯一剩下的记录——正是这个摘要让决策 2 得以诊断。

`Engine.Sessions.Adopter` 覆盖 `preStop` 够不着的情况：`kill -9`、OOMKill、节点被驱逐。没有它，
“零孤儿”只对有礼貌的关闭成立。

### 4. api↔engine 边界上的四个阻碍 {#4-quatro-bloqueios-na-fronteira-apiengine}

- 内部 DTO 拒绝 `to: "closing"`（`@IsIn(['closed','closed_abnormally'])`）；唯一接受 `closing` 的
  路由是给人用的那条，位于用户 RBAC 之后。
- `termination_reason` 只在终态时持久化，因此原因 `node_shutdown` 恰恰会在 Psicólogo 的
  `TerminationClassifier` 要读取它的地方被丢弃。
- 分类器不认识 `node_shutdown`。它被放在 `closed_abnormally` 的兜底**之前**，否则 drain 会显示为
  `:crash`，Psicólogo 会针对一个不存在的缺陷提出假设。
- 假设的 DTO 会拒绝这个新原因，而失败模式很糟：400 作为工具结果回到模型，ToolLoop 会一直转到超出
  `max_iterations`，消耗预算却什么都不记录。

### 5. `force_ssl` 对所有 `/internal/*` 返回 301 {#5-force_ssl-respondia-301-em-todo-internal}

`Plug.SSL` 的排除匹配**确切路径**（`conn.path_info in paths`），因此 `paths: ["/health", ...]` 永远
覆盖不了 `/internal` 的二十多条路由。api 不发送 `x-forwarded-proto: https`，engine 也没有 HTTPS
监听——TLS 在 ingress 终止。结果：**api→engine 自第 2 次会话起就是坏的**。

而没有任何 smoke 看到它，因为**创建会话不调用 engine——激活会话才调用**。两个 smoke 都改为执行激活，
那个声称证明了这条路径的注释也不再是假的。排除的决定变成了一个函数
（`EngineWeb.ForceSslExclusions`），因为一份确切路径的列表会在第一个新端点出现时就过时。

### 6. trace 模型：会话是根，并被持久化 {#6-modelo-de-trace-a-sessão-é-a-raiz-persistida}

一个会话持续几分钟到几小时，而 OTel 的 span 只有在**结束**时才到达后端：一个一直开着的根在会话进行时
恰恰在 Tempo 中不可见，而如果会话从未正常结束——这正是第 4 项处理的情形——它会彻底消失。

因此根是短的（`session.create`），它的 `traceparent` 被持久化到 `sessions.trace_parent`。之后所有的
工作都把它用作**远程父级**，共享 `trace_id`，整个会话可以通过一个 id 找回。

三条路径上的传播，每条都在单一位置：

| 路径 | 注入点 |
|---|---|
| api → engine | `buildHeaders()`——以前是四个相同的内联代码块 |
| engine → api | `post_returning/3`，engine 每个 POST 的漏斗 |
| outbox → Oban | `DrizzleOutboxRepository.append()` 读取活动上下文；**18 个调用点都没有改变** |

`outbox_events` 增加了 `metadata jsonb` 列，而不是 `payload` 中的一个键：engine 按事件类型反序列化
payload，把传输与领域混在一起会毒害所有生产者。engine 在 `engine.session_states` 中保存自己的一份
traceparent——是副本而不是 join，因为在每个 agent 回合读取 api 的表去取一个不可变的值，是用一次写入换
N 次读取。

OTel 的上下文存放在进程字典中，而 engine 通过 `cast` 和 `Task` 派发工作。`Span.capture/0` 和
`Span.attach/1` 手动携带上下文——没有这一对，trace 恰恰会在最有意思的地方断开。

### 7. 速率用计数器，状态用 gauge {#7-contador-para-taxa-gauge-para-estado}

- “tokens/min” 和 “custo/hora” 是**速率**：单调计数器，用 `rate()` 推导窗口。仪表盘按分钟要，告警按
  小时要，都不需要自己的指标；`rate()` 也处理了进程重启。
- “sessões ativas” 和 “tasks bloqueadas” 是**状态**：不存在能在重启后存活的“不再活跃”事件。定期查询
  数据库，重写之前先 `reset()`——没有 reset，序列会黏住，面板会显示已经结束的工作。

两个会改变查询的领域细节：“tasks blocked” 是**布尔**列 `tasks.blocked`（被阻塞的 task 会回到
`todo`），而 `tasks` 没有 `project_id`——路径是 `story_id → stories`。批准率是在决定时计数的计数器，
而不是 `count(status='approved')`：一个被批准并执行的动作会变成 `executed`。

api 的 `/metrics` 需要 `@Public()`：`JwtAuthGuard` 是全局的，没有它，抓取会收到 401，症状是一个
`down` 的 target，而其他一切都是绿的。

### 8. JSON 日志：通过 `mixin` 的 `trace_id`，名称就是契约 {#8-logs-json-trace_id-por-mixin-e-o-nome-é-contrato}

在 api 中，pino 的 `mixin` 在每一行时求值，读取那一刻的活动上下文——正是它让 tool call 内部发出的一行
日志带上那个 tool call 的 trace，而不需要任何日志点传递 id。

该字段在**三个**服务中都是带下划线的 `trace_id`，因为这是 Alloy 的 `stage.json` 提取、Loki 的
`derivedFields` 查找的东西。重命名能编译、能通过测试套件，却会摧毁可点击的关联。

在 engine 中，是手写的 formatter（约 30 行）而不是库：可选的库带有面向三家云的格式化器和自有的配置
模式，而且无论如何都没有一个能在不写胶水代码的情况下注入 OTel 上下文。它**永不抛出**——那里的异常会
发生在 logger 内部，丢掉这一行，并可能在试图记录失败时陷入递归。

在 web 中，没有浏览器 SDK：`@opentelemetry/sdk-trace-web` 约 90 kB，并要求 collector 上的 CORS 和
CSP 中的条目。web 为每个请求**生成**一个 `traceparent`，api 把它采纳为父级（这是标准传播器），并以同一
`trace_id` 记录日志。大约 20 行，以后换成 SDK 就是替换一个函数。`ApiError` 开始携带 `traceId`，于是
“出错了”变成了可操作的报告。

原本不存在的全局钩子：`QueryCache`/`MutationCache` 的 `onError` 以及
`window.error`/`unhandledrejection`——没有它们，渲染异常就是一块没有记录的白屏。

### 9. 中间放一个 Collector，以及**不**经过它的东西 {#9-collector-no-meio-e-o-que-não-passa-por-ele}

`OTEL_EXPORTER_OTLP_ENDPOINT` 指向 OpenTelemetry Collector，而不是 Tempo：三个应用只知道一个端点，
更换后端、采样或过滤属性都变成流水线的变更。

指标和日志**不**经过它：指标是抓取（拉模型，能在 collector 重启后存活），日志由 Alloy 从 pod 的 stdout
读取。让这三样东西走同一条路，会让 collector 成为整个可观测性的单点故障。

**NetworkPolicy `allow-otlp-egress` 是必需的**：`brabo` namespace 的 egress `default-deny`
（ADR 0025）会阻止发往 `monitoring` 的 OTLP，而失败模式是最糟的那种——应用启动、span 被创建、发送
失败，而其他一切都是绿的，Tempo 是空的。

### 10. Grafana 的告警，而不是 Prometheus 的——记录在案的偏离 {#10-alertas-do-grafana-não-do-prometheus--desvio-registrado}

需求要求“Prometheus 告警”。它们被实现为**Grafana 的统一规则**，以代码方式提供，这是用户的明确选择。
被接受的代价：如果 Grafana 宕机它们就不再被评估，而由 Prometheus 加载的规则不会这样。没有
Alertmanager 也没有 receiver——路由是运维的决定。

## 后果 {#consequências}

- engine **真正**支持了多于一个副本，一次 rollout 会保留用户的会话而不是杀死它们。
- 一个会话可以端到端追踪：api 中的 `session.create`，engine 中的 `agent.turn`、`tool.call`、
  `llm.turn` 和 `gate.scanner`，全都在一个 `trace_id` 中。
- 三个服务的日志都是带同一个 `trace_id` 的 JSON，可以从 Tempo 点击到 Loki，再点回来。
- `pnpm-workspace.yaml` 开始声明 `protobufjs: false`：它作为 OTLP exporter 的传递依赖进入，而我们
  使用的 exporter 是 HTTP/JSON 的——不运行传递依赖的 postinstall，与本阶段其余部分的固定版本和
  checksum 是同一种纪律。

## 已知限制（已记录，未解决） {#limitações-conhecidas-registradas-não-resolvidas}

1. **agent 的服务器仍然是节点本地的。** `po:`、`criativo:`、`arquiteto:` 和 `infra:` 仍在本地的
   `Registry` 中，与决策 1 的缺陷形态相同：一个落到“错误” pod 上的 agent 命令找不到进程。它没有出现在
   本次会话的验收标准中，但它是下一个要迁移到 `:global` 的部件。
2. **`Adopter` 有分区窗口。** 它在接管前会同步 `:global`，但在 1 个副本时 `Node.list()` 合理地为空，
   无法区分“因为是单副本而独自一个”与“因为分区而独自一个”。在真实的分区中，两边可能会接管同一个会话。
3. **真实 agent 的 `tool.call` 没有被端到端执行。** 验证直接使用了 span 机制（经由 `rpc` 的
   `Span.with_session`），因为运行真正的 agent 需要 LLM——Ollama 或 API key——而环境中一个都没有。
   代码路径是相同的；没有被观察到的是一个真实 agent 回合产生出这棵树。
4. **chart `grafana/grafana` 在上游仓库中被标记为已弃用**，唯一的替代品是 `grafana-operator`
   （CRD，不同的提供模型）。
5. **阶段 5 的第 6 和第 7 项仍然开放**：带计划 `pg_dump` 和经过测试的 runbook 的备份/恢复；限流、安全
   header、严格的 CORS 以及 CI 中的依赖审计。
6. **把镜像发布到 registry** 自第 2 次会话起仍未完成，它是 staging/prod overlay 的前提。
