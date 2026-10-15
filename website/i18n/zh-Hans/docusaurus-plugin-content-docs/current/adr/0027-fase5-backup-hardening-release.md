---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# 0027 — 备份/还原、api 加固、暴露面与发布

## 背景 {#contexto}

Fase 5 的第 1–3 次会话（ADR [0024](0024-fase5-imagens-producao-ci.md)、[0025](0025-fase5-deploy-kubernetes-kustomize.md) 和 [0026](0026-fase5-observabilidade-e-graceful-shutdown.md)）交付了生产镜像、CI、Kubernetes 部署和可观测性。范围中还剩第 **6** 项（带有经过测试的 runbook 的备份与还原）和第 **7** 项（api 加固）。

本次会话完成这两项，并补上称系统"可用于生产"所缺的东西：运维 runbook、暴露面审查以及版本管理。

## 决策 {#decisões}

### 1. 备份按**数量**保留，而不是按时间 {#1-retenção-do-backup-por-contagem-não-por-idade}

按时间删除（`--older-than 7d`，或 bucket 上的生命周期规则）会在 CronJob 几天没有运行时删除好的备份——而那恰恰是它最重要的时候。保留最近的 N 个则能平稳降级：没有新的运行，就什么也不删除。`BACKUP_KEEP_DAILY=7`，`BACKUP_KEEP_WEEKLY=4`。

### 1b. 备份镜像：Alpine + apk 的 `aws-cli`，而不是 `postgres:16-alpine` + `mc` {#1b-imagem-de-backup-alpine--aws-cli-do-apk-não-postgres16-alpine--mc}

第一个版本使用 `postgres:16-alpine` 加 `mc`（MinIO 客户端），理由是它是单一的静态二进制，不会拖入 Python 运行时。CI 的 trivy 以 **48 个可修复的 HIGH/CRITICAL 发现**判定失败，而没有一个是我们能修复的：

- 33 个来自 `mc` 二进制：静态 Go，内嵌标准库的 CVE。mc 的最后一个 release 是 2025 年 9 月——项目停止了，没有新 release 就没有补丁；
- 15 个来自 `gosu`，`postgres` 镜像带着它用于在 entrypoint 中切换用户——这个镜像根本不用的功能，因为它直接以非 root 运行。

两种情况本可以放进 `.trivyignore.yaml`，但那个文件的约定要求 `expired_at`，正是为了让债务重新出现并被偿还。在这里它**永远无法被偿还**：结果会是一个在携带整个数据库读取凭据的镜像上永远为红的 gate。

我们换成了 `alpine` + `postgresql16-client` + `aws-cli` + `jq`，全部来自 apk，因此每次重建时由 `apk upgrade` 更新。**测得：48 → 0。** 作为反对 aws-cli 理由的 Python 运行时只多几 MB；扫描表明真正的代价在另一边。

基础镜像的 tag 固定在 Postgres 的 MAJOR 版本（`postgresql16-client` 存在于 Alpine 3.20）：只升其中一个而不升另一个，会重新引入决策 4 中的"server version mismatch"。

### 2. 备份指标来自一张**表**，而不是 Pushgateway {#2-métrica-de-backup-vem-de-uma-tabela-não-de-um-pushgateway}

CronJob 把结果写入 `backup_runs`，而 api 的 `DomainGaugesCollector`——它本来就在定时器上运行并被抓取——发布 `brabo_backup_{last_success_timestamp_seconds,age_seconds,last_status,size_bytes}`。

Pushgateway 会是多一个组件、第二个事实来源，并且是一个指标**比它描述的事实活得更久**的地方（job 消失后序列仍在发布）。表还提供了可查询的历史，这正是还原 runbook 用来回答"最后一次好的备份是什么时候"的东西。

后果：用 `-1` 表示"从未有过备份"，以区别于"1970 年的备份"——否则年龄告警会在任何新环境的第一天就触发。

### 3. 在进程**内部**重试，而不是重建 pod {#3-retentativa-dentro-do-processo-não-recriando-o-pod}

k3s 在 pod 获得 IP **之后**才编排 NetworkPolicy 规则。一个在第一条指令就发起通信的 Job，会从一条一秒后才会存在的规则那里收到 `connection refused`（REJECT，不是超时）。重建 pod 会重建这个窗口——在弄清这一点之前，连续六次尝试以完全相同的方式失败。

备份、还原以及引导中创建 bucket，都在同一个容器内部重试。这在生产中同样有用：对象存储有暂时的不可用，一个在第一次网络错误时就放弃的每日备份，就会变成没有备份的一天。

### 4. 在 CloudNativePG 中固定 PostgreSQL 16 {#4-postgresql-16-pinado-no-cloudnativepg}

本地集群启动的是 operator 的默认 major 版本（17.4），而 CLAUDE.md 决定的是 PostgreSQL 16，compose 使用 `pgvector/pgvector:pg16`。这一分歧在备份之前都是看不见的：`pg_dump` 16 会以"server version mismatch"拒绝 17 的服务器，在一个环境中生成的 dump 无法在另一个环境中还原。

`imageName: ghcr.io/cloudnative-pg/postgresql:16.10`，minor 版本也固定——让它浮动会在 operator 更改默认值那天重新引入问题。

### 5. 在 Postgres 中用滑动窗口限流 {#5-rate-limit-com-janela-deslizante-no-postgres}

CLAUDE.md 禁止 Redis（队列放在 Postgres 中，通过 Oban）。窗口存放在 `rate_limit_hits` 中，通过 CTE 在同一条语句中完成 INSERT 和计数。

**承担的代价：每个被计数的请求一次 INSERT。** Redis 能更好地解决；`RATE_LIMIT_ENABLED=false` 可以关闭。清理放进已有的收集器定时器中，而不是单独的 CronJob。

一个只在边界才出现的细节：在 Postgres 中，写入型 CTE 插入的行对同一语句的其余部分**不可见**。只对表计数会返回本次之前的命中数，限额会比配置的多一个。因此有了显式加上的 `(select count(*) from novo)`。

豁免：`@Public()` 路由（掐住 `/health` 会让 kubelet 重启 pod，把峰值变成宕机）以及 `engine-service` 客户端（engine 在每个 agent 事件时都调用 api；限制它就是系统自己掐住自己）。

数据库故障时**放行**请求：这个 guard 防的是滥用，不是越权访问——负责授权的是 `JwtAuthGuard`，它已经运行过了。

### 6. 生产中 CORS 失败即关闭 {#6-cors-falha-fechado-em-produção}

`WEB_ORIGIN` 开始接受逗号分隔的列表。没有它，或者是 `*`，在 `NODE_ENV=production` 下**启动失败**。以前静默的默认值是 `http://localhost:5173`：在部署中忘记这个变量不会破坏任何可见的东西，只会让 api 变得宽松。启动时的错误是响亮且可逆的；宽松的 api 是静默且不可逆的。

### 7. api 上用 helmet，CSP 只在 web 上 {#7-helmet-na-api-csp-só-na-web}

api 原本不发出任何安全头。`helmet` 以 `contentSecurityPolicy: false` 加入：它提供的是 JSON，CSP 属于 web，在 web 上自第 1 次会话起就已存在且更具体（按环境组装的 `connect-src`）。`crossOriginResourcePolicy: false`，因为 web 是另一个源——默认的 `same-origin` 会拦截整个应用，症状容易与 CORS 混淆。

### 8. 在 `mix hex.audit` 之外加上 `mix_audit` {#8-mix_audit-além-do-mix-hexaudit}

`mix hex.audit` 报告的是**已退役**的包，而不是漏洞。单靠它，engine 的 gate 会是装饰性的：没有任何 CVE 会让构建失败。`mix_audit` 读取 Elixir 的安全公告库，才是真正检测 CVE 的东西。两者都运行；它们回答的是不同的问题。gate 设在 **critical**，如范围所要求——在这样一棵依赖树的 monorepo 中在 `moderate` 上失败会变成永久阻塞，而反应会是把整个 gate 关掉。

### 9. 暴露面文档是测试的**来源** {#9-o-documento-de-superfície-é-a-fonte-do-teste}

`docs/security-surface.md` 列出 110 条路由及其分类。`route-surface.spec.ts` 启动 `AppModule`，枚举**运行时注册的**路由（通过 `DiscoveryService`，而不是 grep），并与从 markdown 解析出的表比较：没有对应行的路由失败，分类不一致失败，孤立的行也失败。

在 engine 中，测试是**行为性**的：每条注册的路由都会收到一个不带 token 的请求，断言的是客户端会看到什么（除四个例外之外一律 401）。第一个版本读取 `pipe_through`，因两个原因被弃用——这个版本 Phoenix 的 `__routes__/0` 不暴露 pipeline，而且即使暴露，它断言的也是**注解**：一个被误清空的 `:internal` pipeline 仍会是"正确的"。

### 10. 主密钥轮换需要修改服务 {#10-rotação-da-chave-mestra-exigiu-mudar-o-serviço}

`EnvelopeEncryptionService` 只派生**一个**密钥，没有任何一行记录是哪个密钥包装了它。更换变量会让所有现有凭据变得不可读，而启动时没有错误——失败只在第一次使用时出现。关于这一点写 runbook 将是虚构。

决定：`CREDENTIALS_MASTER_KEY_PREVIOUS`，在当前密钥失败时尝试，再加上 `src/scripts/rewrap-deks.ts` 重新包装存量数据。脚本放在 `src/` 中（而不是位于 `.dockerignore` 中的 `apps/api/scripts/`），因为它需要在生产镜像里。只有信封改变；秘密的密文逐字节保持不变，所以中途中断也会让存量数据保持一致。

### 11. 按 tag 发布，用自有脚本生成 changelog {#11-release-por-tag-changelog-por-script-próprio}

`.github/workflows/release.yml` 在 `v*` 时触发，并校验四个 manifest 都声明了 tag 的版本——在 `package.json` 为 `0.1.0` 时打 `v0.2.0` 的 tag，会产出标着代码并未声明的版本的镜像。

`scripts/changelog.mjs`（约 140 行）而不是 `standard-version`/`changesets`：后两者对版本递增、提交和 tag 带有自己的主张——这三件事在这里都是用户的决定。脚本只生成文本。

## 后果 {#consequências}

**接受的：**

- 已认证路径上每个请求一次 INSERT（决策 5）。
- 多一个需要维护的镜像（`brabo-backup`），接受与其他镜像相同的 gate：非 root、trivy 和 hadolint。
- 本地 overlay 中的 MinIO——开发集群中多一个组件，换来 S3 路径在每个环境而不仅是在生产中得到演练。
- 轮换窗口期间接受两个主密钥，会让泄露密钥的暴露面翻倍。在此期间 api 每次启动都会在日志中警告。
- 为还原测试在**本地**集群中执行 `ALTER ROLE brabo CREATEDB`。生产中不这样做：还原通过 `RESTORE_ADMIN_URL` 使用自己的管理凭据。

**记录在案、不在范围内的：**

- **把镜像发布到 registry。** 生产 overlay 仍指向 `ghcr.io/OWNER/*`。发布 workflow 会构建并打 tag，但不发布。
- **创建 tag `v0.1.0`**——这是用户的动作，与 CLAUDE.md 关于受保护分支的规则一致。
- **PITR。** 粒度是最后一次 dump。CloudNativePG 中的 WAL 归档可以解决，但没有做。
- **Keycloak 和 PVC 的备份。** 范围要求的是 Postgres。
- **`GET /`**，NestJS 脚手架的"Hello World!"，仍然注册并需要认证。记录为移除候选；删除它是产品决策。
- **告警仍是 Grafana 的规则**，而不是 Prometheus 的——这是 ADR 0026 已经记录的偏差，在这里为两条新的备份告警继续保留。
