---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0070 — 本地 Compose 中的可观测性：指标和日志，没有 trace

- **状态：** 已接受
- **日期：** 2026-08-14
- **扩展：** [ADR 0026](0026-fase5-observabilidade-e-graceful-shutdown.md)、[ADR 0035](0035-observabilidade-legivel-e-trace-sem-coletor.md)

## 背景 {#contexto}

ADR 0026 搭建了完整的可观测性——Prometheus、Loki、Tempo、Alloy、OpenTelemetry Collector 和 Grafana——**只针对 Kubernetes**。那次会话的验收标准说的是“no Grafana local”，而那里的“local”指的是 k3d 集群，而不是 Docker Compose。

实际后果：用 `pnpm dev` 开发的人拥有完整运行的插桩——api 在 `/metrics` 上暴露 102 个序列，engine 暴露 `oban_queue_depth` 和 `brabo_engine_sessions_hosted`，三个服务都在日志中打上 `trace_id`——而**这一切都不可观测**。要看一个面板就得启动一个集群，而按设计它不能与 `pnpm dev` 共存（两者发布在相同的端口上，ADR 0025）。

## 决策 {#decisão}

### 1. 一个可选的 overlay，不是 `pnpm dev` 的一部分 {#1-um-overlay-opt-in-não-parte-do-pnpm-dev}

`docker/docker-compose.observability.yml` 启动 Prometheus、Loki、Alloy 和 Grafana。它不进入 `pnpm dev`，因为在一台已经运行 Postgres、Ollama 和三个应用的机器上，这是多出的四个容器：没在调查任何东西的人不应为它们付出代价。

### 2. 指标和日志。trace 留在外面，这是决定 {#2-métrica-e-log-trace-fica-de-fora-e-isso-é-decisão}

ADR 0026（决策 9）确立了 trace 经过 OpenTelemetry Collector，而指标和日志**不**经过——指标是抓取，日志从 stdout 读取。这个 overlay 实现了不需要收集器的那两者。

trace 需要 Collector + Tempo，而 ADR 0035 已经把插桩和导出分开，正是为了让开发中没有端点成为正常状态。因此 overlay **不**定义 `OTEL_EXPORTER_OTLP_ENDPOINT`：指向一个不存在的地址会在每个回合产生导出错误，这比不导出更糟。

`trace_id` 继续留在日志中，并继续是关联 api 和 engine 的东西。

### 3. 工件与集群的**相同**，不是副本 {#3-os-artefatos-são-os-mesmos-do-cluster-não-uma-cópia}

Compose 直接挂载 `deploy/k8s/observability/dashboards/`，数据源的 UID（`brabo-prometheus`、`brabo-loki`）与 `grafana-values.yaml` 中的完全相同。仪表盘按 UID 引用数据源：在这里分歧会迫使多一份 JSON 副本，而仪表盘副本会在有人只在一边修正的第一个面板上产生分歧。

出于同样的原因，Prometheus 的抓取发出集群仪表盘用来分组的标签 `app` 和 `pod`，日志收集器发出集群的 Alloy 从 `app.kubernetes.io/name` 派生的标签 `app`（`api`/`engine`/`web`）。

本次交付的新仪表盘——**Brabo — logs**，带服务和级别选择器——诞生在同一个目录中，因此在两个环境中都有效。

### 4. 日志的解析用正则表达式，而不是 `stage.json` {#4-o-parsing-do-log-é-por-regex-e-não-por-stagejson}

在集群中，Alloy 做 `stage.json`，因为在生产中 pino 每个事件写一行 JSON。在开发中，`pino-pretty` 绘制可读的层级树，engine 使用 `PrettyLogFormatter`——一个刻意的、好的决定，不会为了迎合收集器而更换。

所以是收集器去适应：清除 ANSI，从两种格式（pino 和 Elixir）中提取级别并规范大小写。**不**改变的是标签，它们是与仪表盘的契约。

### 5. 只有三个应用进入 Loki {#5-só-as-três-aplicações-vão-para-o-loki}

`api`、`engine` 和 `web`。Postgres 和 Ollama 是日志量大的第三方基础设施，需要它们的人有 `docker compose logs`。

可观测性栈本身出于一个更硬的理由被排除在外：它运行在**同一个** Compose 项目中，所以没有过滤器的话，Loki 会摄入它自己的日志——以及这次摄入的日志——形成一个自我供养的循环。

### 6. `trace_id` 是结构化元数据，绝不是标签 {#6-trace_id-é-metadado-estruturado-nunca-rótulo}

与集群相同的决定，理由是基数：每个 trace 一个标签会让 Loki 的索引爆炸。这需要 `allow_structured_metadata: true` 和 schema `v13`，镜像的默认配置没有——因此有自己的 `docker/observability/loki.yml`。

## 后果 {#consequências}

- 指标和日志无需集群即可观测，同一个仪表盘服务两个环境。
- **本地 Grafana 和集群的 Grafana 争夺端口 3001。** 这与 `pnpm dev` 和 `make deploy-local` 之间已经存在的不兼容是同一个，原因相同，不能通过更改其中一个的端口来解决——要靠不同时运行两者来解决。
- Alloy 读取 Docker 的 socket。它以只读方式挂载，而且只用于开发。
- 在没有流量的数据库中，成本/token 面板以空状态诞生：那些指标有标签，而在 `prom-client` 中，带标签的指标在第一次观测之前不会发出序列。这已记录在 runbook 中，以免被怀疑是面板坏了。

## 三种耗费了时间、最终变成代码注释的静默故障模式 {#três-modos-de-falha-silenciosa-que-custaram-tempo-e-viraram-comentário-no-código}

值得记录，因为三者的特征相同——**配置有效，日志中零错误，面板上的数据是错的**：

1. **没有捕获组的 `stage.replace`。** 它替换的是组，而不是匹配到的片段。没有括号时正则能匹配但什么都不发生，ANSI 泄漏到面板上。
2. **River 字符串中 `\x1b` 的转义。** River 在正则编译之前处理转义，所以要写多少个反斜杠变成了猜谜。POSIX 类 `[[:cntrl:]]` 不依赖这一层。
3. **键缺失的 Go 模板**会渲染字面文本 `<NO VALUE>`，它变成了仪表盘选择器中的一个级别值。显式的 `else`（`OUTRO`）关闭了基数。

## 舍弃的替代方案 {#alternativas-descartadas}

- **把这四个服务放进 `docker-compose.yml`**：始终开启，所有人付出代价，只有在调查的人受益。
- **把仪表盘复制到 `docker/observability/`**：两份副本会在只修正一边的第一个面板上产生分歧。
- **让开发日志变成 JSON**，以复用集群的 `stage.json`：会用收集器的便利交换开发者日常的可读性。是收集器去适应。
- **同时启动 Tempo 和 Collector**：独立的范围，而且 ADR 0035 已经确立不导出是开发中的正常状态。
