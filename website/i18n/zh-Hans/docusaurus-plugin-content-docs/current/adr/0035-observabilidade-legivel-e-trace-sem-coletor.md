---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0035 — 没有 collector 的 trace，以及日志中跨层的路径

## 背景 {#contexto}

[ADR 0026](0026-fase5-observabilidade-e-graceful-shutdown.md) 设计了端到端的关联：一个会话是一条根 trace，
`traceparent` 经过三个注入点传递，三个服务都以同一个 `trace_id` 记录 JSON 日志。这些都没有错。问题在于，
**在开发中，这些都不存在**——而开发正是用眼睛读日志的地方。

那个 ADR 的决策 9 把埋点以 `OTEL_EXPORTER_OTLP_ENDPOINT` 为条件，理由是一个往不存在的地方投递的 exporter 会用
连接失败塞满日志。这个理由是真的。实现混淆了两件不同的事：**创建**遥测和**投递**遥测。

在 api 中，没有该变量时不会构造 `NodeSDK`。没有 `start()` 就不会注册 context manager 和传播器，于是：

- `currentTraceId()` 返回 `undefined`，pino 的 `mixin` 不会在任何一行上盖上 `trace_id`；
- web 在**每个**请求中发送的 `traceparent` 被悄无声息地丢弃；
- `injectTraceHeaders` 对发往 engine 的调用什么都不注入。

在 engine 中，这个守卫更糟：**颠倒了**。项目中不存在（也从未存在过）`:opentelemetry` 配置，所以 SDK 以
`otel_configuration` 的默认值启动，即指向 `localhost:4318` 的 `{opentelemetry_exporter, %{}}`。engine 在开发中
**以及在 `mix test` 中**为一个注定失败的批次付出代价——这恰恰是守卫声称要避免的成本。而守卫关掉的是
`OpentelemetryBandit.setup()`，即对到达的 `traceparent` 的**提取**：唯一能让 engine 的 span 成为 api span
子级的部件。`Engine.Telemetry.Span` 的 moduledoc 声称没有 collector 时一切都变成 no-op；这是假的，旁边的测试
现在证明了相反的情况。

调查时出现了三个关联漏洞，全都是无声的：

1. `Engine.Outbox.Event` 没有声明 `metadata` 列。struct 中没有这个键，`Drain.traceparent/1` 的第一个子句是
   **不可达的**，每个 Oban job 诞生时都是 `traceparent: nil`。自阶段 5 起 api 就正确写入这一列。没有任何
   worker 读取该参数，所以只修 schema 会让数据保持惰性。
2. engine→api 的 `traceparent` 在 `post_returning/3` 中注入，那只是 POST 的漏斗。六个 `Req.get` 和
   `llm_turn_stream` 都不带 trace——服务之间对话的整个读取一半都显示为孤立的 trace。
3. `chat-stream.ts` 绕过了 `api-client.ts`，不发送 `traceparent`。这是 web 唯一没有 trace 的路径，而且是最糟
   的那个：LLM 回合。

此外还有引出这项工作的原始请求：日志对人来说难读，不说明这一行来自哪里，也不显示用户的操作在各层之间经过了
哪里。

## 决策 {#decisão}

**1. 埋点和导出是分开的决定。** 两个服务中 SDK 都总是启动。`OTEL_EXPORTER_OTLP_ENDPOINT` 改为只控制目的地：

| | 有端点 | 没有端点 |
|---|---|---|
| api | OTLP `traceExporter` | `spanProcessors: [NoopSpanProcessor]` |
| engine | `opentelemetry_exporter` 的默认值 | `traces_exporter: :none` |
| 上下文与传播 | 已注册 | **已注册** |

api 中显式的 `spanProcessors` 不是装饰：没有它，SDK 会落到 `getSpanProcessorsFromEnv()`，在
`OTEL_TRACES_EXPORTER` 为空时组装一个指向 `localhost:4318` 的 exporter——正是守卫试图避免的那个缺陷。而且
列表至少需要一个元素，因为 `sdk.start()` 只有在 `spanProcessors.length > 0` 时才注册全局 tracer provider；没有
provider，span 诞生时就是无效的，传播器什么都不注入。

这两种选择在内存上都是安全的，而且是由构造保证的：`NoopSpanProcessor` 在 `onEnd` 中不保留任何东西，而 Erlang
的 `otel_batch_processor` 在 exporter 为 `none` 时调用 `disable/1`，之后返回 `dropped` 而不碰 ETS。替代方案则
不安全——带着死 exporter 的 `BatchSpanProcessor` 会保留 2048 个 span 并不断重试，而 `InMemorySpanExporter` 会
无限增长。

**2. `tracing.ts` 导出函数，副作用放在 `tracing-boot.ts` 中。** `startTracing()` 作为函数，让 spec 可以导入该
模块而不注册全局状态——否则会弄坏有意断言相反情况的 `trace-context.spec.ts`。但这个调用不能留在 `main.ts` 的
主体中：TypeScript 和 SWC 会把所有 `require` 提升到顶部，因此 import 之间的一行会在 `pg` 和 `express` 加载
**之后**才运行，而 monkey-patch 对已加载的模块不起作用。一个单独的模块能解决，因为 `require` 是同步的。

**3. 跨层的路径来自 `AsyncLocalStorage`，而不是 span。** 边界上的装饰器 `@Traced('<camada>')` 在每个请求的
上下文中记录类、方法、层和耗时；一个全局拦截器在结束时输出**一**行。span 也会打开，但路径不依赖它——这就是让
功能在没有 collector 时也能工作的东西。

这个模式与 `drizzle-context.ts` 相同，后者已经通过调用栈携带活动事务。上下文有**64 步的上限**：没有它，一个
在循环中调用仓库的用例会让数组在请求的整个生命周期中增长，然后把一切序列化到一行日志中。

步骤在方法的**入口**记录，而不是出口。在出口记录会得到结束的顺序——最内层的调用最先结束，路径会从内向外。

**4. `@Traced` 在 `apps/api/src/interfaces/http/**` 之下被禁止。** 这是硬规则，原因是安全。Nest 的装饰器
（`SetMetadata` 及其派生）把元数据写在方法的**函数对象**上；legacy 装饰器自下而上地应用，因此替换
`descriptor.value` 会丢弃写在下面的元数据。在 controller 中，这就是一个消失的 `@RequireRole`——能编译，能通过
测试套件，却是一个授权漏洞。

装饰 controller 得不到任何好处：拦截器免费覆盖了 HTTP 边界，读取 `ExecutionContext.getClass()` 和
`getHandler()`。不在 30 个文件中产生 diff 的选项也是安全的选项。（装饰器无论如何都会把元数据复制过去，作为
双保险。）

出于同样的技术原因有两项排除：**任何返回 `Observable` 或是生成器的东西**。“是 thenable 吗？”这一启发式会把两者
都归为同步，并在流产出之前就关闭 span。`traced-llm-provider.chat` 是异步生成器，被排除在外；`@Sse` 处理器交给
拦截器，它使用 `finalize`。

**5. 对已经自行管理 span 的东西使用 `ownSpan: true`。**
`CreateSessionUseCase.execute` 打开 `session.create`，ADR 0026 指定它为会话 trace 的根，
`docs/reference/events.md` 也把它记录为根。包裹它会让装饰器的 span 成为根：`trace_id` 仍然正确，而文档会在
什么都没坏的情况下变成假的。使用 `ownSpan` 时，路径的这一步会被记录，而不会打开新的 span。

**6. 开发中美化输出，生产中一行 JSON。** 在生产中 `transport` 缺失，pino 对每个事件写一个 `JSON.stringify`——
这是要求，不是审美：Alloy 逐行读取 pod 的 stdout。

在开发中，`pino-pretty` **在进程内**作为流运行，而不是经由 `transport`。原因是具体的：`transport` 在 worker
thread 中执行，选项要经过 structured clone，因此**作为函数**的 `messageFormat` 和 `customPrettifiers` 无法传入——
而正是它们绘制各层的树。`require` 被包在 try/catch 中，因为 `pino-pretty` 是 devDependency，在生产镜像中不
存在；回退是 JSON，这对 logger 来说是正确的失败模式。

在 engine 中，`Engine.Telemetry.LogFields` 成为字段的唯一来源，`JsonLogFormatter` 只做序列化，新的
`PrettyLogFormatter` 覆盖开发——那里 `dev.exs` 丢掉了时间戳和全部元数据，让 `trace_id`、`session_id` 和 `mfa`
不可见。

**7. `trace_id` 仍然是契约，它没有任何变化。** 新字段（`path`、`duration_ms`、`layer_count`、`layer`、
`class`、`fn`）作为平级兄弟加入。Alloy 的 `stage.json` 通过表达式选择而不是枚举，因此新的兄弟键会被忽略，Loki
的 `derivedFields` 照常工作。`layers` 数组**不**进入生产：作为字符串 `path` 约 150 字节，作为数组是 5-10 倍，
而 Loki 按字节收费。

**8. 三个漏洞一并关闭。** outbox schema 中的 `field :metadata`，再加上两个 worker 中的
`Span.with_session(args["traceparent"], …)` 和 `Logger.metadata(session_id:)`——engine 中任何地方都没有调用过
`Logger.metadata/1`，这就是 formatter 的 `session_id` 字段总是缺失的原因。`EngineApiClient` 中的一个漏斗
`headers/0`，覆盖 8 个调用点。以及 `chat-stream.ts` 中的 `traceparent`。

## 后果 {#consequências}

- 在**零 collector** 的情况下，`pnpm dev` 产生三条带同一个 `trace_id`（在浏览器中生成）的日志流。这就是能否追踪
  一次用户操作穿越各个进程的区别。
- 每个请求一行，显示跨层的路径以及每一步的耗时。在开发中是缩进的树；在生产中是 `path` 字段。
- agent 的异步工作真正变得可关联：由会话关闭触发的 Psicólogo job 带着产生它的会话的 `trace_id`。以前每个 job
  都是 `traceparent: nil`。
- engine→api 对话的读取一半摆脱了孤立状态，包括 `llm_turn_stream`。
- engine 不再在开发和测试套件中浪费一个注定失败的导出批次。
- api 的日志获得了原本不存在的形状测试：生产中一行、`trace_id` 位于顶层，以及作为契约的 `redact` 列表。这个
  列表加入了原本**未**被脱敏的 api↔engine 服务 token。
- CORS 的 `allowedHeaders` 变为显式。以前整个关联都依赖于 `cors` 包的默认值，它会回显 preflight 中请求的
  header——库的隐式行为，没有测试覆盖。
- engine 开始有访问日志（以前一个都没有），服务 token 的拒绝不再是无声的。
- 在 k8s 中接上了 `WEB_LOG_LEVEL`：在每个已发布的环境中 `logger.debug` 都是死代码。
- 两段声称与行为相反的文字被修正：`Engine.Telemetry.Span` 的 moduledoc，以及 runbook 中“没有 trace 时”的原因 1——
  后者在本次变更之前对 engine 就已经是假的了。

## 已知限制 {#limitações-conhecidas}

1. **guard 在拦截器之前运行。** `JwtAuthGuard`、`RateLimitGuard` 和 `RolesGuard` 不在路径中（约 1-3ms，已在
   Tempo 中以 `pg` span 可见）。升级路径是增量的：只把 `runWithRequestContext` 移到一个 middleware 中，保留
   拦截器负责播种和输出。
2. **并发下的 `depth` 是近似的。** 被装饰调用的 `Promise.all` 会交错深度，树会歪掉。关键路径是顺序的。
3. **SSE 的那一行在流关闭时才到达**，经由 `finalize`——可能在请求开始几分钟之后。这与 pino-http 的 `res` 行
   一致，后者也要等响应结束。
4. **`genReqId` 没有被触及。** 它会是没有任何东西消费的第二个关联键，与 ADR 0026 称为契约的字段并列。关联按
   `trace_id` 进行。
5. **web 的日志到达不了 Loki。** Alloy 只读取 pod 的 stdout。浏览器的 `trace_id` 用于让人把控制台的那一行与
   服务器的 span 对上——ADR 0026 记录的内容依然成立。
6. **`@Traced` 只应用在关键路径上**（会话、动作、认证以及 api↔engine 的桥接）。其余的仓库仍未覆盖，这是范围上
   的选择，不是障碍。
7. **没有创建任何 RN。** 业务规则位于 `apps/api/src/domain/`，那里是纯的；可观测性不是业务规则。记录在此，以免
   看起来像是遗忘。
8. **web 没有获得 error boundary**，在认证和聊天路径之外，约 20 个静默的 `catch {}` 仍然静默。boundary 是 UI
   的决定，而其余的转换是机械性的——两者都值得单独的变更。
