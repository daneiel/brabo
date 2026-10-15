---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0092 — `platform` 以按需报告脚本的形式诞生，而不是 agent

## 状态 {#status}

已接受。不改变 `docs/fluxo.yml`（ADR 0085）中 `platform` 角色的 `status: planned` 和 `gate_saida`——它的激活仍与 `DEPLOY_ENABLED` 同步，而后者并不存在。本文档只交付背后已有真实数据的那一半。

## 背景 {#contexto}

`docs/fluxo.yml`（`camada_plataforma`）把 `platform` 描述为“SRE /
Platform — dono do loop de retorno”：它会从 Infra 领域接收 `pipeline-verde`，从 Arquiteto 接收 `nfrs-mensuraveis`，并返回 `slo + dashboard + runbook`、`telemetria-consolidada` 和 `postmortem`。`status` 是 `planned`，`ativacao` 写的是“sincronizada com `DEPLOY_ENABLED`”——一个今天产品中不存在的标志。没有带真实流量的生产环境，任何地方都没有定义数值 SLO，也没有真实的事故可供任何事后复盘分析。

产品所有者有意识地决定提前这一角色的一部分——不是作为 LLM agent，也不是作为受监督的进程（`GenServer`），那会在一个尚未闭合的循环上编造权力，而是作为今天已经可以诚实做到的东西：一个读取**脚本**，与 `apps/api/scripts/medir-execucao.ts`（FASE 13b）和 `apps/api/scripts/validacao-gates.ts`（FASE 15）同一模子。

数据已经存在。`DomainGaugesCollector`（`apps/api/src/infrastructure/observability/domain-gauges.collector.ts`）每隔 `METRICS_GAUGE_INTERVAL_MS` 运行一次，维护三个 Prometheus gauge：按项目的活动/closing 会话、按项目的被阻塞任务，以及最后一次备份的状态（`backup_runs`——年龄、状态、大小，始终是**全局**的，因为产品备份整个数据库，而不是按项目）。缺的不是指标：而是一种**现在**、针对特定项目、不用打开 Grafana 就能看这张快照的方式。

## 决策 {#decisão}

**`apps/api/scripts/relatorio-telemetria.ts`**，通过 `pnpm --filter api relatorio:telemetria [--projeto <uuid>] [--json]` 调用。它提出与 `DomainGaugesCollector` **相同**的三个问题——但作为一次性的、独立的读取，由请求者触发，打印后结束。它不是第二个收集器：不注册任何 gauge，不在 `setInterval` 中运行。

**SQL 查询是复制的，而不是导入的。** 收集器的方法（`collectSessions`/`collectBlockedTasks`/`collectBackup`）是私有的，并以写入 `this.metrics.*.set(...)` 结束——不存在一个可以抽取的“只有查询”的纯粹部分，而不让一个独立脚本耦合到一个只在模块内部才有意义的 NestJS `@Injectable` 的生命周期。复制一个**读取**查询（相同的表、相同的过滤条件）比打开这一依赖更便宜。

**报告绝不编造它没有的东西。** 每次输出都有两个固定小节：

- **“Onde ver mais”**——指向已经存在且版本化的东西的链接：`deploy/k8s/observability/dashboards/*.json` 中的三个仪表盘、`deploy/k8s/observability/alerts/brabo-alerts.yaml` 中的告警、`docs/runbook.md#observabilidade`，以及用于启动本地可观测性的 `pnpm dev:obs`。脚本**链接**，绝不复制这些文件的内容。
- **“Não medido”**——三个具名的缺口：正式的数值 SLO（产品中任何地方都没有定义——在这里编造一个，就是 ADR 0042 对模型评分、ADR 0077 对代码质量已经拒绝的同一个错误）；事后复盘（依赖真实事故）；以**闭环**回到产品的遥测（这个脚本观察并打印——它不自行决定或行动；正是这一点会让 `platform` 变为 `active`，而触发条件仍然缺失）。

**`docs/fluxo.yml` 获得一条注记，而不是新状态。** `platform` 角色的 `status: planned` **不**变，`gate_saida: { id: operavel, status:
planned }` 也不变。输出 `telemetria-consolidada` 获得一个 `nota` 字段，说明**手动**/按需的版本已经是真实的（这个脚本），而**自动**/闭环的版本仍待 `DEPLOY_ENABLED`——这与 ADR 0077 已经对“recomendado”与“nota inventada”应用的纪律相同：存在的东西按存在来说，不存在的东西继续按不存在来说。

## 后果 {#consequências}

**开始存在的东西。** 一种回答“这个项目现在怎么样”（会话、被阻塞的任务、备份）的方式，无需打开 Grafana，也无需等待下一次抓取——之所以有用，恰恰是因为 `DomainGaugesCollector` 已经把这些数据发布给 Prometheus，但以前没有人按需读取它。

**保持原样的东西。** `platform` 仍然是 `planned`。没有新的 agent，没有 `GenServer`，没有数值 SLO，没有模拟的事后复盘。脚本不做决定也不行动——它只打印数据库中已有的内容。

**查询的重复是一种选择，而不是疏忽。** 相同的表（`sessions`、`tasks`/`stories`、`backup_runs`）通过两条不同的路径被读取两次——周期性的收集器和这个按需的脚本——如果其中一个改变而另一个没有跟进，两个查询可能随时间产生分歧。接受的代价小于为了复用私有代码而把一个 CLI 脚本耦合到 NestJS `@Injectable` 生命周期的代价。

## 参考 {#referências}

- [ADR 0085](0085-fluxo-como-registro-declarativo.md)——把 `platform` 角色声明为 `planned`；本文档不提升它。
- [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)、[ADR 0077](0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md)——同样的纪律：没有真实数据绝不编造数字/评分。
- [RN-385](../business-rules.md#rn-385)、[RN-386](../business-rules.md#rn-386)。
- `apps/api/scripts/relatorio-telemetria.ts`、`apps/api/src/infrastructure/observability/domain-gauges.collector.ts`、`docs/fluxo.yml`（`camada_plataforma › platform`）。
