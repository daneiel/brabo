---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0091 — `secops-runtime` 作为基于 `rate_limit_hits` 的报告脚本

- **状态：** 已接受
- **日期：** 2026-08-16
- **背景：** 决定提前 `secops-runtime` 角色（`docs/fluxo.yml`，`camada_seguranca`）

## 背景 {#contexto}

`docs/fluxo.yml`（ADR 0085）把 `secops-runtime` 声明为安全层的 `proposto` 角色，带 `papel_de_mercado: detecção e resposta` 和 `criterio_de_separacao: produção com tráfego real (pós DEPLOY_ENABLED +
platform ativo)`。这个触发条件是真实的：自动的事故检测、事故响应和安全事后复盘都需要持续的生产流量才有意义——一个针对零真实流量校准的告警要么因噪声触发，要么永不触发，而没有事故的事后复盘是虚构。

产品所有者决定在触发条件尚未触发的情况下提前部分角色：RateLimitGuard（ADR 0027）已经为每个被计数的请求在 `rate_limit_hits`（`apps/api/src/interfaces/http/shared/rate-limit.guard.ts`）中写入一行，即使在开发/CI 流量下也是——真实的数据，今天就在收集，却没有任何关于它的报告。`apps/api/scripts/medir-execucao.ts`（FASE 13b）已经为这类工具确立了模式：`NestFactory.createApplicationContext`、通过 Drizzle 的纯读取、抽出来并且不启动 Nest 就能测试的函数。

## 决策 {#decisão}

`secops-runtime` 以**脚本**形式进入——`pnpm --filter api
relatorio:seguranca-runtime`——而不是 LLM agent 或 `GenServer`。对这些数据没有需要作出的决定，只有聚合：按命中数排名的桶（`bucket_key` = `user:<uuid>` 或 `ip:<endereço>`，`RateLimitGuard` 写入的仅有的两种格式），以及按固定时间片的时间分布，以揭示尝试的峰值。

脚本明确**不做**的事情，以及原因：

- **自动事故检测**——需要针对真实流量校准的阈值；针对开发/CI 流量校准会得出一个与生产滥用无关的数字。
- **事故响应**——没有真实的事故需要响应。
- **安全事后复盘**——没有真实的事故需要调查。

这三者依赖于 `docs/fluxo.yml` 早已声明的**同一个**触发条件（有真实流量的生产，`DEPLOY_ENABLED` + `platform` 激活之后），仍在范围之外。报告把它们列在一个“não medido”小节中——绝不模拟一个示例事故，绝不编造一个检测数字——与 ADR 0041/0042/0077 已经应用于产品尚未具备的其他能力的原则相同：声明缺口，而不是假装它不存在。

数据窗口很短，报告会说明这一点：`DomainGaugesCollector.
pruneRateLimit` 每隔 `METRICS_GAUGE_INTERVAL_MS`（默认 15s）删除早于 `2 × RATE_LIMIT_WINDOW_MS`（默认 240s）的命中。报告打印**配置的**窗口（修剪的理论上限）和**观察到的**窗口（数据实际覆盖的范围），并且绝不让后者冒充比实际更长的历史——如果两者一致，说明更早的命中被修剪掉了，而不是它们不存在。

`docs/fluxo.yml` 在 `secops-runtime` 块中从 `status: proposto` 改为 `status: active`，用 `entregaveis` 取代 `entregaveis_alvo`：`deteccao` 项变为真实的（`via: script`），而 `resposta-a-incidente`/`postmortem-de-seguranca` 保持为 `status: lacuna`——这个字段不会消失，它开始精确地指向缺少的东西。

## 后果 {#consequências}

- 真实收益：一个命令（`pnpm --filter api relatorio:seguranca-runtime`）今天就能显示谁对 rate limit 打得最多以及何时，无需等待生产——即使在开发/CI 中也有用，可以注意到格式错误的测试模式或本地滥用。
- 报告的好坏取决于 `rate_limit_hits` 保存的数据：没有路由、方法或阻止原因，排名无法区分“一个客户端猛敲 `/auth/login`”和“一个客户端猛敲任意路由”。增加路由列需要改变 `RateLimitGuard` 写入的内容——超出了这一小片的范围，它只读取已经存在的东西。
- 保留窗口（分钟，而不是天）限制了排名对已经过去的事故的价值：**今天**运行脚本只能看到最近 `2 × RATE_LIMIT_WINDOW_MS` 内发生的事情。扩大保留期会是一项独立的产品决定（在一张没有外键的表中不断增长的存储成本，ADR 0027），没有在此作出。
- `secops-runtime` 仍然没有自动检测、事故响应和事后复盘——该市场角色的完整承诺仍然依赖原来的触发条件（`DEPLOY_ENABLED` + `platform` 激活）。这个决定没有提前那一天；它只是避免在那之前让 `rate_limit_hits` 没有任何使用者。
