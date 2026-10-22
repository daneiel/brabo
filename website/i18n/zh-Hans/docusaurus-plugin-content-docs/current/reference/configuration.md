---
id: configuration
title: 配置
sidebar_position: 1
description: api、engine 和 web 的全部环境变量，附默认值以及取值错误时会坏掉什么。
keywords: [配置, 环境变量, env, 部署]
traducao_de: e34fb776731c09e64de832912893157dace42817
---

# 配置

所有配置都通过**环境变量**完成。应用没有配置文件——存在的是 `permissions.json`，它是项目的策略，而不是进程的配置。

有两个受版本控制的文件会在运行时被读取，它们不是配置，但很容易与配置混淆：上面的 `permissions.json`，以及 `docs/gates.yml`（[ADR 0054](../adr/0054-gates-como-registro-declarativo.md)），即 gate 的声明式注册表。两者都没有指向某个路径的环境变量——注册表是从 `__dirname` 向上查找得到的——并且在生产环境中编辑它们都不会改变行为：注册表**描述** gate，而不执行 gate。它随 api 镜像一起发布；参见 [runbook](../runbook.md#registro-de-gates)。

随镜像发布的是注册表，**而不是它所指向的任何东西**。`teste`/`ci` 类 gate 的 `evidencia` 指向 `apps/api/test/`、`scripts/ci/` 和 `.github/` 下的文件，而这些都不在镜像里。因此，核对这些目标是否存在是关于仓库的断言，由 CI 负责，而绝不由提供 `GET /gates` 的进程负责——所以 api 读取注册表时不会去找它们。它曾经去找过，结果在每个安装中都返回 `500`（[RN-070](../business-rules/custo.md#rn-070)）。

> **`up --wait` 只能证明有 healthcheck 的服务。** 在开发用的 compose 中，`api`、`engine` 和 `web` 原本都没有 healthcheck，所以 `docker compose up --wait` 在容器启动的那一刻就认为它们已就绪——早于进程开始监听。正因如此，容器可能在几秒后死掉，而命令仍在宣告成功。现在这三者都带有与生产镜像在 Dockerfile 中早已声明的相同检查（api 和 engine 上是会访问数据库的 `/health`；Vite 服务器上是 `/`）。容器 broker 在另一次变更中获得了自己的 healthcheck；`postgres` 和 `neo4j` 一直都有。这里没有任何环境变量——之所以写出来，是因为脚本依赖的正是 `--wait`，而没有 healthcheck 的服务会让它撒谎。

下面的默认值是从代码中提取的，而不是来自以前的文档。**出错时**一列是最省时间的部分：几乎每个变量都有一个在开发环境可用的默认值，以及一种在生产环境中特有的失败方式。

> **变量只有在 compose 映射了它时才会进入进程。** `docker compose` 不会把宿主机的环境传进容器：变量当且仅当写在该服务的 `environment:`（或某个 `env_file`）中时才会到达。这不是细节；正是这样，`ANAMNESE_ENABLED` 和 `PSYCHOLOGIST_ENABLED` 悄无声息地变得无法设置，而代码中有三处承诺 2026-08-10 的暂停可以通过 `X=true` 加一次重启来撤销。在运行中的 engine 容器内测量，它们的值为空，`runtime.exs` 落到了 `"false"`——没有任何地方报错。现在 engine 读取的每个布尔开关都映射在全部三个 compose 文件中（开发、生产和安装——安装用的那个自 AT-202 起），使用代码自身的默认值，只有生产和安装有意关闭的两个后台 agent 启动开关除外；`scripts/ci/flags-do-engine-no-compose.spec.ts` 会让下一个缺失的开关构建失败（[RN-540](../business-rules.md#rn-540)）。Kubernetes 有意不受此规则约束：Deployment/ConfigMap 不拦截任何东西，所以那里没有需要修复的断开的键。

> **开发环境的默认值是故意不安全的。** 像 `dev-master-key-change-me` 这样的值存在，是为了让 `pnpm dev` 不费周折地启动。在生产环境中必须替换它们——其中六个如果不替换，进程会**拒绝**启动（api 或 engine，标记为 🔒）。其中五个遵循 [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)/[RN-093](../business-rules/custo.md#rn-093) 的模式：缺失、等于公开的示例字面值或过短都会让启动失败。参见 [RN-114](../business-rules/custo.md#rn-114)，了解加入最初的 `GIT_OAUTH_STATE_SECRET` 的那四个。

## 安装用 compose（`docker-compose.install.yml`）

在**已安装**的机器上运行的 compose 从**必填变量**获取产品的五个镜像，没有默认值——由 `install.sh` 写入 `.env`：

| 变量 | 含义 |
|---|---|
| `BRABO_API_IMAGE` | api 镜像的完整引用；来源是 GHCR 时为 `ghcr.io/…@sha256:…`，本地构建时为 `brabo-api:prod` |
| `BRABO_ENGINE_IMAGE` | 同上，用于 engine |
| `BRABO_WEB_IMAGE` | 同上，用于 web |
| `BRABO_BACKUP_IMAGE` | 同上，用于备份 job（在 profile `backup` 下） |
| `BRABO_BROKER_IMAGE` | 同上，用于容器 broker（[ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)）。**无论** broker 是否开启都会写入：Compose 在按 profile 过滤之前会插值整个文件，所以关闭的服务中的 `${VAR:?…}` 仍然会让文件被拒绝（已测量） |

它们故意写成 `${VAR:?…}`。如果有默认值，缺失的变量会让一半的栈运行在没人选择过的镜像上，错误会表现为奇怪的行为，而不是拒绝。

它们**不在**下面生成的清单中：生成器扫描 `apps/`，而这些变量由 Compose 读取，不是由产品代码读取（[RN-527](../business-rules.md#rn-527)）。

自 [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md) 起，**broker** 在这个 compose 中，处于**关闭**状态，位于 profile `container-broker` 下，`install.sh` 只有在询问且回答为 "s" 时才开启它（[RN-575](../business-rules.md#rn-575)）。届时它会写入四行，要么全写，要么都不写：

| 变量 | `install.sh` 写入的内容 |
|---|---|
| `COMPOSE_PROFILES` | `container-broker`——由 Compose 从 `--env-file` 读取，所以 `up -d --wait` 无需参数即可启动 broker |
| `BROKER_URL` | `http://broker:8090`——api 一侧；没有它，api 永远不会调用 broker |
| `DOCKER_GID` | **从容器内部看到的** socket 的 gid，用 broker 自己的镜像测量；测量失败是有名称的拒绝，绝不使用默认的 `999` |
| `PROJECT_WORKSPACES_HOST_ROOT` | `<DockerRootDir>/volumes/brabo_project_workspaces/_data`，在启动前计算，并在启动后与卷的真实 `Mountpoint` 核对 |

`BRABO_PROJECTS_HOST_BASE` 不会被写入：compose 从 `BRABO_PROJECTS_BASE` 推导它，与验证用 compose 相同。之后开启或关闭的方法见 [runbook](../runbook.md#broker-na-instalacao)。

**本地模型**（Ollama，profile `llm`）紧接在 broker 之后询问（[RN-691](../business-rules.md#rn-691)）。回答 "s" 会先测量宿主机上的一个空闲端口，然后写入：

| 变量 | `install.sh` 写入的内容 |
|---|---|
| `OLLAMA_PORT` | `11434`，或者当已有东西（原生 Ollama）在那里监听时，取到 `11443` 为止的第一个空闲端口；整个范围都被占用时是有名称的拒绝，不写入任何内容 |
| `COMPOSE_PROFILES` | `llm`；**只有**两者都被接受时，才与 `container-broker` 写在同一行（`container-broker,llm`）——两行不会叠加，最后一行生效 |

没有它们，语义重复检查会被跳过。之后开启的方法见 [runbook](../runbook.md#modelos-locais-na-instalacao)。


## api

### 基本

| 变量 | 默认值 | 出错时 |
|---|---|---|
| `DATABASE_URL` | `postgres://brabo:brabo@localhost:5432/brabo` | 没有它，什么都起不来 |
| `PORT` | `3000` | — |
| `API_JSON_BODY_LIMIT` | `10mb` | api 接受的 JSON 请求体上限，作用于 `main.ts` 中注册的解析器，在任何路由之前生效。它的存在是为了让 engine 传输上限（`TRANSPORT_MAX_BODY_BYTES`，8 MiB）的变化不需要重新部署——默认值相对它留有余量。太小的话，一个大上下文的回合会返回 **413** |
| `NODE_ENV` | — | `production` 会开启严格 CORS 和密钥校验 |
| `API_PUBLIC_URL` | `http://localhost:3000` | 用于 git OAuth 回调；错误 = 回调失效 |
| `ENGINE_URL` | 代码中为 `http://localhost:4000`，Compose 中为 `http://engine:4000` | api→engine 的同步命令失败。**在 `.env` 中保持为空**：在那里定义的话，它会覆盖 Compose 的默认值，api 会从自己的容器内部尝试连接 `localhost:4000`——每次会话激活都以 `ECONNREFUSED` 告终，前端停滞不前。每个环境不写这一行就已经有正确的默认值 |
| `ENGINE_PUBLIC_URL` | 与 `ENGINE_URL` 相同 | 只用于组装 `POST .../runner-ticket`/`.../terminal-ticket` 返回的 `engineWsUrl`（WebSocket）——runner 和 web 可能在集群**外部**，所以内部地址（`http://engine:4000`）不可用；api→engine 的常规同步调用仍然使用 `ENGINE_URL`（RN-419） |
| `BRABO_VERSION` | `dev` | 成为 OpenTelemetry resource 中的 `service.version`——由此得知是哪个构建产生了某个 trace。发布镜像通过 `docker-bake.hcl` 的 `ARG` 注入 tag；发布之外保持 `dev`。它**不会**出现在 `/health` 中，后者有意不返回版本（参见该路由的 `description`） |
| `MIGRATIONS_FOLDER` | `./src/db/migrations` | — |

### 安全 🔒

| 变量 | 默认值 | 出错时 |
|---|---|---|
| `CREDENTIALS_MASTER_KEY` 🔒 | `dev-master-key-change-me`，**仅限非生产环境** | 包裹 DEK。**在生产环境中，如果它缺失、等于上面的默认值（公开的——在 `.env.example` 里）或少于 16 个字符，api 拒绝启动**（RN-114）。这只是**启动**时的检查：把它换成一个**有效但不同**的密钥而不重新包裹，仍会让所有凭据无法读取，且没有任何报错——失败出现在第一次使用时。参见[轮换](../runbook.md#rotacao-da-chave-mestra) |
| `CREDENTIALS_MASTER_KEY_PREVIOUS` | — | 仅在轮换期间使用。存在 = 当前密钥失败时 api 会尝试上一个密钥 |
| `GIT_OAUTH_STATE_SECRET` 🔒 | `dev-oauth-state-secret-change-me`，**仅限非生产环境** | 为 OAuth 的 `state` 签名；弱 = git 连接流程中的 CSRF。**在生产环境中，缺失、使用上面的默认值（公开的——在 `.env.example` 里）或少于 16 个字符时，api 拒绝启动。** 用 `openssl rand -base64 32` 生成。参见 [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) 和 [RN-093](../business-rules/custo.md#rn-093) |
| `WEB_ORIGIN` 🔒 | `http://localhost:${WEB_PORT}` | **在生产环境中，缺失或为 `*` 时 api 拒绝启动。** CORS 按环境严格限制。**端口是值的一部分**：`:5174` 上的 web 是另一个源，会被拦截——参见 [ADR 0037](../adr/0037-cors-do-engine-e-a-porta-como-contrato.md)。在各 compose 中，默认值**从 `WEB_PORT` 推导**，所以修改端口会连带修改 CORS；手动定义 `WEB_ORIGIN` 会覆盖推导，保持一致就成了你的责任 |
| `WEB_PORT` | `5173`（dev）· `8088`（prod） | web 在宿主机上发布的端口。没有服务读取它——它在各 compose 中**为 `WEB_ORIGIN` 的默认值提供输入**，这正是防止端口与 CORS 出现分歧的机制 |

### 第一方认证

认证位于 api 的领域中，自切换之后也是唯一的签发方。决策见 [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) 和 [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)。

| 变量 | 默认值 | 作用 |
|---|---|---|
| `AUTH_JWT_SECRET` 🔒 | `dev-auth-jwt-secret-change-me`，**仅限非生产环境** | 一个短语，access token 的 Ed25519 密钥对通过 scrypt 从它**派生**——没有任何私钥被提交。**在生产环境中，如果它缺失、等于上面的默认值（公开的——在 `.env.example` 里）或少于 16 个字符，api 拒绝启动**（RN-114） |
| `AUTH_JWT_SECRET_PREVIOUS` | — | 轮换期间**仅用于验证**；进入 JWKS，永远不签名 |
| `AUTH_TOKEN_PEPPER` 🔒 | `dev-auth-token-pepper-change-me`，**仅限非生产环境** | 不透明 token（refresh、账户关联、PAT）哈希以及锁定桶键所用的 HMAC 密钥。**独立的密钥——不再回退到 `AUTH_JWT_SECRET`**（[RN-613](../business-rules/autenticacao.md#rn-613)）。**在生产环境中，如果它缺失、等于本仓库中任何示例值或少于 16 个字符，api 拒绝启动。** 曾在没有它的情况下运行的安装，需要用**当前的** `AUTH_JWT_SECRET` 来定义它，否则所有人都会被登出——参见 [runbook](../runbook.md#rotacao-do-auth-jwt-secret) |
| `AUTH_ACCESS_TOKEN_TTL_MS` | `900000` | 15 分钟 |
| `AUTH_REFRESH_TOKEN_TTL_MS` | `1209600000` | 14 天 |
| `AUTH_REFRESH_ABSOLUTE_TTL_MS` | `2592000000` | token 家族的绝对上限，从登录时算起——没有它，轮换会授予永久会话 |
| `AUTH_REGISTRATION_ENABLED` | `true` | 任何不同于 `"false"` 的值都保持注册开放 |
| `AUTH_LOCKOUT_ENABLED` | `true` | 同样的约定 |
| `AUTH_LOCKOUT_WINDOW_MS` | `900000` | 计数的滑动窗口 |
| `AUTH_LOCKOUT_THRESHOLDS` | `5:30,8:300,12:900` | 按邮箱分桶的阶梯，`失败次数:秒数` |
| `AUTH_LOCKOUT_IP_THRESHOLDS` | `20:30,30:120` | 按 IP 分桶的阶梯，更宽松，上限更短 |
| `AUTH_EMAIL_TOKEN_TTL_MS` | `172800000` | 邮箱验证，48 小时 |
| `AUTH_RESET_TOKEN_TTL_MS` | `3600000` | 密码重置，1 小时 |
| `AUTH_SET_PASSWORD_TTL_MS` | `604800000` | 设置首个密码（迁移的用户），7 天——比重置更长，因为收件人并没有主动请求 |
| `AUTH_IP_ATTEMPT_THRESHOLD` | `60` | 认证路由上每个 IP 的尝试上限 |
| `AUTH_MAIL_LOG_TOKENS` | `false` | **仅限开发**：在日志中打印验证/重置 token |

> **按邮箱阶梯的上限故意等于窗口。** 使用滑动窗口时，坚持尝试的人会推动窗口，只要还在尝试就一直被锁定；停下来的人会在窗口清空后恢复。**大于**窗口的上限会造成窗口无法表示的锁定，需要一个持久化的 `locked_until` 列和解锁队列。不要只改其中一个。

> **轮换 `AUTH_TOKEN_PEPPER` 会让所有人登出**，并使待处理的验证和重置 token 失效。与密钥不同，pepper **没有** `_PREVIOUS`。参见 [runbook](../runbook.md)。

> **`_PREVIOUS` 变量能到达哪里。** `AUTH_JWT_SECRET_PREVIOUS`、`CREDENTIALS_MASTER_KEY_PREVIOUS` 和 `BRABO_SERVICE_TOKEN_PREVIOUS` 以 `${X:-}` 的形式映射在全部三个 compose（开发、生产和安装）的 `environment:` 中——api 接收这三个，engine 和 broker 接收 `BRABO_SERVICE_TOKEN_PREVIOUS`（[RN-595](../business-rules/autenticacao.md#rn-595)）。在每个读取方中，空值都等同于缺失，所以在轮换之外什么都不会变；轮换期间，只需在 `.env` 中定义它们并重建服务。在 RN-595 之前，它们哪里都没有映射，而 `docker compose` 不会传递宿主机的环境，于是一次轮换会悄无声息地变成直接替换。
> **在 Kubernetes 中，它们通过密钥保险库到达 Pod**（AT-220）：`ExternalSecret` 用 `dataFrom.extract` 拉取整个 `brabo` 对象，所以其中存在的 `_PREVIOUS` 会进入 `brabo-secrets`，不存在的就根本不在那里。代价是这个对象中的每个键都会成为 api、engine、migrations 和 backup 的环境变量——保险库中的这个对象不能存放其他任何东西。操作步骤见 [runbook](../runbook.md#rotacao-no-kubernetes)。

### 真实 SMTP（MailSender）

`MailSender` 只有在 `MAIL_TRANSPORT=smtp` 时才真正发送邮件——默认值是 `log`（链接/token 进入 api 日志，见上面的 `AUTH_MAIL_LOG_TOKENS`），生产环境中也是如此：发送邮件是运维人员的选择。决策见 [ADR 0096](../adr/0096-smtp-real-no-mailsender.md)。

| 变量 | 默认值 | 作用 |
|---|---|---|
| `MAIL_TRANSPORT` | `log` | `log`（默认）或 `smtp`。任何其他值都落到 `log` |
| `SMTP_HOST` 🔒 | — | SMTP 服务商的主机。**仅在 `MAIL_TRANSPORT=smtp` 时**：在生产环境中，如果它缺失、只有空白或是 `.env.example` 中发布的示例值，api 拒绝启动（RN-114） |
| `SMTP_PORT` | `587` | 服务商端口——`587` 是 STARTTLS，`465` 是隐式 TLS（`SMTP_SECURE=true`） |
| `SMTP_SECURE` | `false` | `true` 在连接上启用隐式 TLS（通常是 465 端口） |
| `SMTP_USER` 🔒 | — | SMTP 认证用户。生产环境中的要求与 `SMTP_HOST` 相同 |
| `SMTP_PASSWORD` 🔒 | — | SMTP 认证的密码/token。生产环境中的要求与 `SMTP_HOST` 相同——**永远不会出现在日志中** |
| `SMTP_FROM` | — | 发件人，格式为 `"Nome <email@dominio>"`（或只写邮箱）。生产环境中的要求与 `SMTP_HOST` 相同，另加格式校验 |

> 邮件正文是**纯文本**，没有 HTML——`MailSender` 端口不携带富文本正文的结构，而模板引擎会是一个毫无收益的注入面。链接使用 `WEB_ORIGIN`（见上文）。

### 开发种子数据

由 `pnpm --filter api seed` 使用，而不是运行中的 api。没有外部 IdP，登录本地 web 和 smoke 所需的凭据就来自这里。

| 变量 | 默认值 | 作用 |
|---|---|---|
| `BRABO_SEED_PASSWORD` | `brabo12345678` | 种子用户（`owner@brabo.dev`、`dev@brabo.dev`）的密码，创建时邮箱**已验证** |
| `BRABO_FORCE_SEED` | — | 在 `NODE_ENV=production` 下解锁种子，默认情况下种子在那里**拒绝运行**。不要在真实环境中定义它：账户会带着已知且已验证的密码被创建 |

> 种子是幂等的，**不会改动**已存在用户的密码。在有人修改自己的密码后再次运行它，不会把密码改回去。

### 速率限制

基于 Postgres 的滑动窗口——没有 Redis（[ADR 0027](../adr/0027-fase5-backup-hardening-release.md)）。

| 变量 | 默认值 | 作用 |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | 任何不同于 `"false"` 的值都保持开启 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | 窗口大小 |
| `RATE_LIMIT_USER` | `300` | 每个用户每个窗口的请求数 |
| `RATE_LIMIT_IP` | `600` | 每个 IP 每个窗口的请求数 |

> 如果速率限制表不可用，请求会**放行**。这个 guard 防范的是滥用，而不是未授权访问——那是认证 guard 的工作，它在前面运行。

### 内部流量 🔒

认证 api ↔ engine 的共享密钥。**两边是同一个变量**——每一方发送当前值并接受两个值，正是这一点使轮换无需停机成为可能（[RN-035](../business-rules/autenticacao.md#rn-035)）。

| 变量 | 默认值 | 作用 |
|---|---|---|
| `BRABO_SERVICE_TOKEN` 🔒 | `dev-service-token-change-me`，**仅限非生产环境** | 放在 `X-Brabo-Service-Token` 头中，`EngineServiceGuard` 以常数时间比较它。**在生产环境中，如果它缺失、等于上面的默认值（公开的——在 `.env.example` 里）或少于 16 个字符，api 拒绝启动**（RN-114） |
| `BRABO_SERVICE_TOKEN_PREVIOUS` | — | 轮换期间**仅用于验证**。定义后，它与当前 token 遵循**同样**的规则：去掉首尾空白，在生产环境中如果它是公开默认值或少于 16 个字符，api 拒绝启动。与当前 token 不同，它从不是必填的（[RN-598](../business-rules/autenticacao.md#rn-598)） |

> 只在一边定义**新**值（不走 `_PREVIOUS` 的流程）不会让任何一方启动失败：症状是 `/internal/*` 上的 `403` 和 api 调用 engine 时的 `401`。操作步骤见 [runbook](../runbook.md#rotacao-das-chaves-do-auth)。上面的**启动**检查（RN-114）是另一回事：它只在公开默认值或变量缺失/过短时失败，而不是在两边不一致时。

### Git

| 变量 | 默认值 | 说明 |
|---|---|---|
| `GIT_LOCAL_REPOS_ROOT` | `/tmp/brabo-git-repos` | 本地 provider。在 `/tmp` 中，仓库会在重启后消失 |
| `PROJECT_WORKSPACES_ROOT` | `/tmp/brabo-project-workspaces` | **Container** 模式下项目 agent 的 worktree。**在 engine 中必须是相同路径**，并且是同一个卷 |
| `BRABO_PROJECTS_BASE` | 空 | 宿主机上唯一的文件夹，**Mounted** 模式的项目都位于其下，以同一路径挂载到 `api` 和 `engine`。空是**正常**状态：api 报告 `projectsBase: null`，项目向导根本不会提供 Mounted 模式 |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | 空 | 空 = 与 GitHub 的 OAuth 连接不可用（PAT 仍然可用） |
| `GITLAB_OAUTH_CLIENT_ID` / `_SECRET` | 空 | 同上 |

#### Mounted 模式的项目：一个基础目录，按同一路径挂载

自 [ADR 0072](../adr/0072-projeto-local-ou-container.md) 起，项目可以以 **Mounted** 模式创建（即以前的 `local`，由 [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md) 改名）——代码位于用户的文件夹中，`PROJECT_WORKSPACES_ROOT` **不参与**其根目录。

项目的路径是项目的数据（`projects.workspace_path`），在创建时选定，从来不是环境变量。**环境**提供的是这些文件夹所在的**基础目录**——`BRABO_PROJECTS_BASE`，每个安装一个（[ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md)，[RN-500](../business-rules.md#rn-500)）：

```bash
# .env — ABSOLUTO. `~` não é expandido pelo Compose.
BRABO_PROJECTS_BASE=/home/voce/projetos-brabo
```

你不需要手写这一行。自 [ADR 0146](../adr/0146-base-consentida-no-bootstrap.md) 起，`pnpm bootstrap` → **Docker › Base de projetos** 会运行 `scripts/dev/consentir-base.mjs`，它建议 `$HOME/projetos-brabo`，拒绝与 Brabo 检出目录或 `PROJECT_WORKSPACES_HOST_DIR` 重叠的路径（两个所有者相反的根目录——共用一个文件夹会让名为 `loja` 的 Mounted 项目落到 `workspace_dir_name` 同样是 `loja` 的 Container 项目头上），在 macOS 和 Windows 上通过实际挂载来**证明** Docker 确实能看到这个文件夹，然后才写入变量。

证明靠的是一次挂载，而绝不是读取 Docker Desktop 的 `settings.json`：那个文件没有文档，随版本和平台变化，描述的是用户配置了什么，而不是 daemon 会做什么——这与产品对 LLM provider 采用的规则相同：capability 只有在经执行证明后才会声明。它有**三种**结果，且互不合并：已证明、已拒绝（变量不写入）以及*无法证明*——没有可挂载的本地镜像——这种情况会写入变量，并明确说明证明没有运行。

通过菜单运行时，它只**报告**：bootstrap 菜单的每一项都故意以 `/dev/null` 作为 stdin 运行，所以它无法提问。要自己选择，请在你自己的终端中运行 `node scripts/dev/consentir-base.mjs`。

```yaml
# docker/docker-compose.yml — em `api` E `engine`, já escrito
    volumes:
      - ${BRABO_PROJECTS_BASE:-brabo_projects_base}:${BRABO_PROJECTS_BASE:-/data/brabo-projects-base}
```

运维人员只需定义**一次**并重启 `api` + `engine`；永远不需要按项目编辑任何东西。在此之前，每个挂载的项目都需要在两个服务中手写一行 bind-mount 并重启一次——这会杀死安装中所有进行中的 agent 回合、终端 socket 和 LLM 调用。

挂载是**按同一路径**的（`$X:$X`）：在宿主机和两个容器中是同一个绝对路径。正是这一点让用户输入、界面回显的字符串保持真实，也正因如此，`projectScopeRoot`（api）和 `Engine.Actions.Workspace.workspace_dir/2`（engine）不需要转换层。

**它不是 `PROJECT_WORKSPACES_HOST_DIR`，也绝不能指向同一个文件夹。** 托管的 workspace 以 `workspace_dir_name`（UNIQUE）命名，而挂载的项目由用户命名，所以 `<base>/loja` 和文件夹名为 `loja` 的 container 项目会冲突，仓库的 bootstrap 会在别人的项目里运行 `git init`。ADR 中有另外两个理由。

变量**未定义**时，不提供 Mounted 模式——绝不提供安装无法兑现的模式。并且当基础目录与 Brabo 检出目录在任一方向上重叠时，`pnpm dev` **拒绝启动**；这项检查放在 preflight 中，因为它在宿主机上运行，而 api 只能与 `process.cwd()`（自己容器内的 `/workspace`）比较。参见 [runbook](../runbook.md#projeto-no-modo-local)。

### LLM

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | — |
| `OLLAMA_REQUEST_TIMEOUT_MS` | `300000` | Ollama socket 的**不活动**上限，而不是总时长上限。本地模型到第一个 token 的延迟高出一个数量级，因此有独立的变量；参见[推理环境](../runbook.md#ambiente-de-inferencia) |
| `LLM_REQUEST_TIMEOUT_MS` | `300000` | API 类 provider（OpenAI 及兼容者、Anthropic）的同一不活动上限。适用于"连响应头都没发"以及"在流的中途停止发送数据块"——参见 [LLM provider](llm-providers.md#inactivity-ceiling) |
| `HUGGINGFACE_API_TOKEN` | *（未定义）* | 用于模型搜索（`GET /workspaces/:workspaceId/huggingface/models`）的 Hugging Face Hub **可选** token。存在时，以 `Authorization: Bearer …` 发送，并提高 Hub 的速率限制；缺失时，干脆不发送这个头——Hub 接受无凭据的公开搜索，token 缺失从来不是错误 |
| `HUGGINGFACE_HUB_URL` | `https://huggingface.co` | 搜索所访问的 Hub 基础 URL。用于测试的覆盖（临时端口上的一个假 HTTP 服务器）；在生产环境中保持未定义 |
| `HUGGINGFACE_REQUEST_TIMEOUT_MS` | `15000` | 发往 Hub 的搜索请求的**不活动**上限，语义与 `LLM_REQUEST_TIMEOUT_MS` 相同（名称是在一个常量中拼接的，所以下面生成的清单看不到它） |

> **TODO(humano):** 没有任何 compose 文件在 `api` 服务的 `environment:` 中映射这三个 `HUGGINGFACE_*` 变量，而该服务没有 `env_file`，所以在 Compose 下于 `.env` 中定义它们不起作用——`HUGGINGFACE_API_TOKEN` 是否应该被传递（至少在生产和安装中）？

### 知识图谱（ADR 0099）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NEO4J_URI` | — | 例如 `bolt://neo4j:7687`。**这就是开关**：为空 = 图谱**关闭**，依赖它的路由会降级（`GraphUnavailableError`/503）——没有人需要为了跑测试套件而准备一个本地 Neo4j。在生产环境中，三者中任何一个缺失都会让启动失败。在开发中开启图谱只需在 `.env` 中加这一行并重启 api；直到 2026-09-04 这样做都没有任何效果，因为开发用 compose 没有把这三个变量传给 `api` 服务，而该服务没有 `env_file`——`docker-compose.prod.yml` 从第一天起就提供了它们，所以只有开发环境受影响 |
| `NEO4J_USER` | `neo4j`（dev） | 以 `neo4j` 服务用于 `NEO4J_AUTH` 的同一默认值到达容器，所以只在需要**更换**用户时才定义它——在那里更换会一次性更换两边。两个独立的默认值会让 api 用服务器已不存在的凭据去认证 |
| `NEO4J_PASSWORD` 🔒 | `dev-neo4j-password-change-me`（仅 dev） | 与 `NEO4J_USER` 相同的配对规则。**生产环境中故意没有公开默认值**——数据库密码不存在合理的"示例值"，`docker-compose.prod.yml` 让 `NEO4J_AUTH` 保持为空，使官方镜像的 entrypoint 自己拒绝启动，而不是以一个可猜测的密码启动 |
| `GRAPH_PROJECTOR_INTERVAL_MS` | `2000` | 轮询器的周期，它清空 outbox 的 `graph_projection` 队列，并把 handoff/假设/画像/交互写入图谱（RN-416） |
| `ARTIFACT_PROJECTOR_INTERVAL_MS` | `2000` | 轮询器的周期，它清空 outbox 的 `artifact_projection` 队列，并把每个 agent 的产物以 Markdown 形式写入项目的 `docs/` 文件夹（[RN-523](../business-rules.md#rn-523)）。**派生**投影：event log 仍是来源，该文件夹可以删除并重建 |

### 可观测性

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | **缺失会关闭导出，而不是关闭插桩**（ADR 0035）。span 仍会被创建，`trace_id` 仍会出现在日志中——这就是开发中无需收集器也能关联的方式。没有它，span 会在最后被丢弃，而不是离开进程 |
| `OTEL_SERVICE_NAME` | `brabo-api` | — |
| `OTEL_DIAG_LOG` | — | `1` 开启 OTel 自身的诊断日志 |
| `LOG_LEVEL` | 生产环境为 `info`，其他为 `debug` | 与 `NODE_ENV` 一起也决定**格式**：非生产环境中日志是可读的（进程内 pino-pretty，带分层树）；生产环境中每个事件一行 JSON |
| `METRICS_GAUGE_INTERVAL_MS` | `15000` | 领域 gauge 的采集周期 |

---

## engine

### 基本

| 变量 | 默认值 | 出错时 |
|---|---|---|
| `DATABASE_URL` | `ecto://brabo:brabo@localhost:5432/brabo` | 注意是 `ecto://` 协议，而不是 `postgres://` |
| `POSTGRES_HOST` / `_USER` / `_PASSWORD` | `localhost` / `brabo` / `brabo` | 未组装 `DATABASE_URL` 时使用 |
| `POOL_SIZE` | — | 连接池耗尽会卡住 Oban，队列不再被消费 |
| `PORT` | `4000` | — |
| `PHX_HOST` / `PHX_SERVER` | — | `PHX_SERVER=true` 才会让 release 提供 HTTP 服务 |
| `SECRET_KEY_BASE` 🔒 | — | release 中必填（`runtime.exs`，`:prod` 块，Phoenix 标准的 `raise`）。在 RN-114 之前，`docker-compose.prod.yml` 提供了一个公开字面值作为回退，掩盖了这个 `raise`——变量总是以**已定义**的状态到达。`raise` 本身没有变 |
| `API_URL` | `http://localhost:3000` | engine 通过这里回调 api |
| `ECTO_IPV6` | — | — |
| `SKIP_MIGRATIONS` | — | 由 migration Job 使用 |

### 集群与关闭

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DNS_CLUSTER_QUERY` | — | 组成 Erlang 集群的 headless Service。**没有它，每个副本都是孤岛**，每次 rollout 都会排空一切 |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | `45000` | `preStop` 的窗口。与 `terminationGracePeriodSeconds` **一起**调高，绝不单独调 |
| `SESSION_HEARTBEAT_TIMEOUT_MS` | `30000` | 会话在询问 api 是否有待处理工作之前，等待标签页心跳的时长 |
| `SESSION_CONVERSATION_IDLE_TIMEOUT_MS` | `28800000`（8 小时） | **空闲对话**的上限：等待用户的对话 agent 会在心跳之外保持会话这么长时间，从它的回合结束时算起；超过之后，会话以 `closed` 关闭，原因是 `conversation_idle_timeout`（[RN-581](../business-rules.md#rn-581)）。在三个 compose（开发、生产、安装）中都以同一默认值映射到 engine；**故意没有**写在 `deploy/k8s/` 中——那里没有任何东西拦截环境，所以缺失即默认，修改它是在 overlay 的 engine 补丁里加一个 `env:` 项 |
| `RELEASE_NAME` / `RELEASE_NODE` | — | 节点在分布式中的身份 |

### Harness

| 变量 | 默认值 | 说明 |
|---|---|---|
| `TOOL_LOOP_MAX_ITERATIONS` | `8` | **对话类** agent 循环的轮数上限。耗尽后，agent 以一个阻塞产物结束 |
| `TOOL_LOOP_MAX_ITERATIONS_EXECUCAO` | `60` | **dev agent** 的上限。更高，是因为它们在写之前要探索仓库——也因为 `task_budget_micros` 从底部兜住花费 |
| `TOOL_LOOP_MAX_ITERATIONS_GATE` | `60` | **QA** 子 agent 的上限，理由相同 |
| `DEFAULT_CONTEXT_WINDOW` | `128000` | 模型未声明窗口时使用（对话类 agent 从不声明）；在 RN-702 之前是 `8192` |
| `CONTEXT_COMPACTION_THRESHOLD` | `0.7` | 触发压缩的窗口比例 |
| `LLM_TURN_TIMEOUT_MS` | `300000` | 每个回合 5 分钟 |
| `TOOL_ROUTER_TIMEOUT_MS` | `2000` | 对 Jev 工具路由器**一次**调用的上限，单位毫秒（[ADR 0179](../adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md)，[RN-625](../business-rules.md#rn-625)）。由 **api** 读取，而不是 engine。超过上限后，该步骤回退到完整的工具目录，`motivoDaQueda: timeout`；回合永远不会因为 Jev 而失败。测得的 328 次请求中 0 次超过 2 000 ms。开关按 workspace 设置（`PUT workspaces/:id/tool-router`），不是环境变量 |
| `TERMINAL_ACTION_TIMEOUT_MS` | `120000` | 终端命令的上限（自 [RN-757](../business-rules.md#rn-757) 起为 2 分钟：一个简单的 `npm install` 在旧的 15 秒里放不下）。engine 在 `container-exec` 中等待该值 + 90 秒，在 `terminal` 动作的 `propose_action` 中等待 + 120 秒；超过约 180 秒，外层等待会超过 api 调用 `/internal/actions/execute` 时所用 Node `fetch` 的 300 秒响应头限制 |
| `TERMINAL_OUTPUT_MAX_BYTES` | `32768` | 命令输出的**字节**上限（[RN-074](../business-rules/custo.md#rn-074)）。输出留在循环历史中，并随之后的每个回合传输；没有上限的话，在大目录树上执行一次 `find` 就会因 provider 的 `413` 让整个执行失败 |
| `READ_FILE_MAX_BYTES` | `32768` | `read_file` 读取内容的**字节**上限（[RN-141](../business-rules/autenticacao.md#rn-141)）——与 RN-074 同类的溢出，只是从 `read_file` 而不是终端进入；独立变量，数值相同只是上下文巧合 |
| `SEARCH_WORKSPACE_MAX_BYTES` | `32768` | `search_workspace` 最终文本的**字节**上限（[RN-150](../business-rules/autenticacao.md#rn-150)）——与 RN-074/RN-141 同类的溢出，从搜索入口进入；独立变量 |
| `SEARCH_WORKSPACE_MAX_HITS` | `500` | `search_workspace` 在组装响应前收集的命中**数量**上限（[RN-150](../business-rules/autenticacao.md#rn-150)）——一旦达到上限就停止扫描/读取内容，避免在命中过多的目录树上付出 I/O 代价、之后又按字节截断 |
| `SECOPS_SCAN_TIMEOUT_MS` | `180000` | SecOps 扫描器 3 分钟 |
| `TRANSPORT_MAX_BODY_BYTES` | `8388608`（8 MiB） | 上下文压缩在模型窗口之上还要遵守的**传输**上限（[RN-412](../business-rules.md#rn-412)）——有效窗口是 `min(context_window, 该上限换算成的 token 数)`，所以压缩会在请求体超过 api 的 HTTP 限制**之前**触发，而不只是在模型会"遗忘"时 |
| `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` | `false` | 开启 `InstructionFiles` 的 `:graph` 来源——目前只有 ux-designer 的身份会在内联文本之前解析图谱中的模板（RN-413）。是**独立**的名字，不是下面的 `GRAPH_TEMPLATES_ENABLED`——如果共用一个开关，两者会因相反的默认值而冲突 |

### 心理学家

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PSYCHOLOGIST_ENABLED` | `false` | **全局**暂停**新的**轮次（自动和按需）——这是用户在 2026-08-10 做出的产品决策，不是 bug，开关形式与下面的 `ANAMNESE_ENABLED` 相同（后者已在 [RN-680](../business-rules.md#rn-680) 中重新开启；这个没有）。不会删除已有的任何东西。开启它需要重启 engine（[RN-117](../business-rules/autenticacao.md#rn-117)）。没有与之配对的启动开关：心理学家的自动触发是会话关闭，而不是定时 tick |
| `PSYCHOLOGIST_TRIAGE_THRESHOLD` | `20` | 区分**轻量**与**重量**分析的会话事件数 |
| `PSYCHOLOGIST_MAX_ITERATIONS_LEVE` / `_PESADA` | `4` / `8` | — |
| `PSYCHOLOGIST_BUDGET_MICROS_LEVE` / `_PESADA` | `50000` / `300000` | 每次分析 USD 0.05 和 USD 0.30 |
| `PSYCHOLOGIST_MAX_PROMPT_EVENTS_LEVE` / `_PESADA` | `50` / `400` | 进入 prompt 的事件数 |
| `PSYCHOLOGIST_MAX_PAYLOAD_CHARS` | `600` | 每个事件 payload 的截断长度 |
| `PSYCHOLOGIST_RAG_TOP_K` | `3` | 进入上下文的 `rag_search` 相关片段数，从上面的近期事件上限中扣除（[RN-417](../business-rules.md#rn-417)） |
| `GRAPH_TEMPLATES_ENABLED` | `false` | 开启把 `psychologist-kickoff`/`anamnese-kickoff`/`context-manager-summarize` 解析为图谱模板——这是心理学家、Anamnese 和 `ContextManager` 摘要 prompt **共享**的开关（[RN-417](../business-rules.md#rn-417)），不要与上面的 `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` 混淆。关闭（默认）意味着根本不调用图谱 API；开启时，任何失败都会回退到内联文本且不报错 |

### Anamnese

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ANAMNESE_ENABLED` | `true` | 产品开关：是否可以发生**新的**轮次（周期性的和按需的）。`false` 是不删除任何东西的**全局**暂停（[RN-115](../business-rules/autenticacao.md#rn-115)）；修改它需要重启 engine。它从 2026-08-10（用户的暂停）到负责人在 2026-10-01 带着修正重新开启 Anamnese 期间一直是 `false`（[RN-680](../business-rules.md#rn-680)）：没有合格对象——在窗口内有自己交互的项目有效成员——的轮次不会调用 LLM。**单靠它不足以运行周期性轮次**：`START_ANAMNESE`（启动开关，见下）也必须为 `true`，两者回答的是不同的问题 |
| `ANAMNESE_INTERVAL_SECONDS` | `900` | 轮次之间间隔 15 分钟 |
| `ANAMNESE_MIN_EVENTS` | `10` | 低于此数不运行——避免基于噪声描绘画像 |
| `ANAMNESE_INITIAL_WINDOW_DAYS` | `30` | 第一轮的窗口 |
| `ANAMNESE_MAX_ITERATIONS` | `6` | — |
| `ANAMNESE_BUDGET_MICROS` | `200000` | 每轮 USD 0.20 |
| `ANAMNESE_MAX_PROMPT_EVENTS` | `500` | — |
| `ANAMNESE_MAX_PAYLOAD_CHARS` | `600` | — |

### 负载保护

| 变量 | 默认值 | 说明 |
|---|---|---|
| `START_OUTBOX_DRAIN` | `true` | outbox 排空（`Engine.Workers.OutboxDrainWorker`，每 2 秒一次）的启动开关——它是 api 写入 outbox 的 `session`/`task`/`container` 事件的**唯一**消费者——另外还负责清理孤立 worktree 和接管孤立会话。关闭后没有人投递这些事件：api 已关闭的会话仍保留着进程和运行中的对话 agent（[RN-581](../business-rules.md#rn-581)），等待动作决策、gate、自己的 PR 或容器进入 `running` 的 dev agent 永远不会被唤醒。它**不会**开启心理学家：只有在 `PSYCHOLOGIST_ENABLED=true` 时排空才会把它加入队列。**只**在生产 compose（`docker-compose.prod.yml`）中故意设为 `false`；安装用 compose 自 AT-219 起使用代码中的 `true` |
| `START_ANAMNESE` | `true` | 测试/开发的**负载**保护：阻止启动时调用 `kickoff/0`，但不决定任何产品行为——不要与 `ANAMNESE_ENABLED`（产品：**全局**暂停，无论本变量取何值都有效）混淆。关闭它会阻止**新的**入队，**不会清空队列**。积累的 job 会在下次启动时运行——队列需要被清除。参见[推理环境](../runbook.md#ambiente-de-inferencia) |
| `START_MODEL_SYNC` | `true` | 模型目录同步的周期性 tick。关闭它不会冻结任何东西：设置页面上的"更新目录"按钮调用同一个用例（[RN-043](../business-rules/custo.md#rn-043)） |
| `MODEL_SYNC_INTERVAL_SECONDS` | `21600`（6 小时） | provider 的目录以天为尺度变化，每一轮每个 provider 要花一次 API 调用——所以默认值很宽松 |
| `START_GATE_RESCUE` | `true` | gate 周期救援（`Engine.Gates.GateRescuer`，[RN-140](../business-rules.md#rn-140)）的周期性 tick。关闭它不改变启动：救援在启动时无论如何都会运行一次 |
| `GATE_RESCUE_INTERVAL_SECONDS` | `300`（5 分钟） | 卡住的 gate 会阻塞用户的整个 PR——间隔比 Anamnese/模型同步短得多，每次 tick 只花一次几乎总是空的查询 |
| `GATE_RESCUE_STALE_AFTER_SECONDS` | `900`（15 分钟） | 故意宽松：QA 子 agent 的 ToolLoop 可以合法地运行到 `TOOL_LOOP_MAX_ITERATIONS_GATE`（60）次迭代，过短的阈值会救援——并重复——一个只是慢的周期 |

### 内部流量与可观测性

| 变量 | 默认值 |
|---|---|
| `BRABO_SERVICE_TOKEN` 🔒 | `dev-service-token-change-me`，**仅限非生产环境**——**与 api 的值相同**。首尾空白会被去掉，只含空白的值视为缺失。在 `:prod` release 中，如果它缺失、是上面的公开默认值或少于 16 个字符，engine 拒绝启动并指出变量名——与 api 的规则相同（[RN-601](../business-rules/autenticacao.md#rn-601)） |
| `BRABO_SERVICE_TOKEN_PREVIOUS` 🔒 | ——轮换期间仅用于验证。去除空白；在 `:prod` release 中，如果它是公开默认值或少于 16 个字符，engine 拒绝启动。从不是必填的，与当前值相同意味着没有在轮换（[RN-601](../business-rules/autenticacao.md#rn-601)） |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ——Elixir 导出器使用 **4318 端口上的 HTTP/protobuf**，而不是 4317 端口上的 gRPC。缺失只关闭导出（`traces_exporter: :none`），不关闭插桩——参见 ADR 0035 |
| `WEB_ORIGIN` | ——**与 api 是同一个变量**，在这里它为**两样**东西提供输入：Phoenix socket 的 `check_origin`（实时团队面板）以及健康检查路由的 HTTP CORS，浏览器读取 `/health` 需要后者（[ADR 0037](../adr/0037-cors-do-engine-e-a-porta-como-contrato.md)）。生产环境中缺失会关闭 CORS，并让 `check_origin` 保持 Phoenix 严格的默认值——与 api 不同，engine **照样启动** |
| `PROJECT_WORKSPACES_ROOT` | `/tmp/brabo-project-workspaces`——**与 api 相同，在同一个卷上** |

> `SOME_APP_SSL_CERT_PATH`、`SOME_APP_SSL_KEY_PATH` 和 `MIX_TEST_PARTITION` 是 Phoenix 脚手架和测试配置的残留。不要配置它们。

---

## web

web 是静态的，由 nginx 提供服务。它从**两个**来源读取配置，这个区别很重要：

| 来源 | 何时 | 方式 |
|---|---|---|
| `import.meta.env.VITE_*` | **构建时** | 嵌入 bundle。修改需要重新构建 |
| `window.__BRABO_CONFIG__` | **运行时** | 由 `/config.js` 提供，该文件由容器的 entrypoint 生成 |

所以同一个镜像可以服务所有环境：`/config.js` 在启动时被重写。`VITE_*` 是开发环境的回退。

| 变量 | 用途 |
|---|---|
| `VITE_API_URL` | api 地址 |
| `VITE_ENGINE_URL` | engine 地址（Phoenix 通道） |
| `VITE_LOG_LEVEL` | 浏览器 JSON logger 的级别（默认 `info`）。在集群中以 `brabo-config` 的 `WEB_LOG_LEVEL` 键为准，由 entrypoint 写入 `/config.js`——`VITE_*` 只在本地构建中起作用 |
| `VITE_BRABO_VERSION` | 显示在认证页面页脚的版本（默认 `dev`）。**唯一一个出于选择而非限制在构建时确定的变量**——见下文 |

部署后页面空白，几乎总是 `/config.js` 指向了 `localhost`——部署的 smoke 检查的正是这一点。

### 为什么版本不经过 `/config.js`

URL 属于**环境**：同一个镜像需要与 staging 的 api 和生产的 api 通信，这正是 `/config.js` 存在的意义（ADR 0024）。版本属于**产物**——镜像 `brabo-web:1.1.2` 不应该能报告别的东西。如果来自 `/config.js`，页脚就会变成一个可编辑字段而不是身份标识，一个错误的 ConfigMap 就会让界面对正在运行的构建撒谎。

从提交到界面的完整路径：`release.yml` 计算 `versao=${TAG#v}` → 作为 `VERSION` 传给 `docker buildx bake` → `docker-bake.hcl` 的 `web` 目标把它转换为 `VITE_BRABO_VERSION` → `docker/web/Dockerfile.prod` 的 `ARG`/`ENV` 把它暴露给 `pnpm build` → Vite 把它嵌入 `import.meta.env` → `runtime-config.ts` 读取它 → `AuthLayout` 显示它。同一个 `VERSION` 也为 api 镜像的 `BRABO_VERSION` 提供输入（ADR 0036）。

---

## 备份

由备份镜像使用，而不是由应用使用——在 Kubernetes 中作为 CronJob，在 compose 安装中作为 `docker compose run --rm backup …`。详情见[恢复](../runbook.md#restore)；理由见 [ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md)。

**目的地是两者之一，由 `BACKUP_DIR` 选择。** 定义它，备份写入磁盘；留空，备份写入 S3，这正是 Kubernetes 的 CronJob 的做法。五个 `BACKUP_S3_*` 变量不再无条件必填：它们是*某一个*目的地的配置，在能够迁移之前就要求一个 bucket，就是要求一种单机安装从未需要过的基础设施。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BACKUP_DIR` | —（S3） | 目标**目录**。已定义 ⇒ 磁盘；为空 ⇒ S3。在 compose 服务中默认值是 `/backups` |
| `BRABO_BACKUP_HOST_DIR` | `backup_local`（命名卷） | 挂载到 `/backups` 的宿主机路径。命名卷的默认值适合验证备份；作为迁移目的地则是**错误**的，因为 `docker compose down -v` 会把它与它本应保存的东西一起删除 |
| `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` | — | 兼容 S3 的目的地；只有在 `BACKUP_DIR` 为空时才必填 |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | bucket 的凭据 |
| `BACKUP_KEEP_DAILY` | `7` | 按**数量**保留，而不是按时间 |
| `BACKUP_KEEP_WEEKLY` | `4` | — |
| `GIT_REPOS_DIR` | `/data/git-repos` | `local` provider 项目的 bare 仓库。缺失 ⇒ 该步骤**被跳过并说明**（Kubernetes 的 CronJob 不挂载这个卷） |
| `RESTORE_DB` | — | 恢复的目标数据库名 |
| `RESTORE_PREFIX` | `daily/` | 从每周副本恢复时用 `weekly/` |
| `RESTORE_GIT_PREFIX` | `git-daily/` | bare 仓库的每周副本用 `git-weekly/` |
| `RESTORE_GIT_FORCE` | — | `1` 允许在已有 bare 仓库**之上**解压。默认关闭：叠加两个仓库状态会产生一种任何 `git` 都不会抱怨的混合物 |
| `RESTORE_ADMIN_URL` | — | 具有 `CREATEDB` 权限的连接；在生产环境中与 `DATABASE_URL` 分开 |

四个前缀，而不是两个：`daily/` 和 `weekly/` 存放 Postgres 的 dump，`git-daily/` 和 `git-weekly/` 存放 bare 仓库的归档。它们分开是因为保留是按**数量**的——同一前缀下的两种文件会让"保留 7 份"变成三个半备份。

## 本地推理（容器）

这些不由我们的代码读取——它们属于 `ollama` 容器，列在这里是因为它们是 agent 行为异常最常见的原因。症状表见[推理环境](../runbook.md#ambiente-de-inferencia)。

| 变量 | 原因 |
|---|---|
| `OLLAMA_CONTEXT_LENGTH` | 默认的 4096 会**悄无声息地**截断为 128k 组装的 prompt |
| `OLLAMA_MAX_LOADED_MODELS` | `OLLAMA_KEEP_ALIVE` 较高时，模型会不断累积直到内存耗尽 |
| `OLLAMA_KEEP_ALIVE` | 模型常驻的时长 |
| `DEMO_QA_MODEL` | 把 QA gate 指向一个 API 模型——按 agent 的 binding 优先于项目的 |

> **`ollama` 镜像的版本不是变量——是 digest。** 与 `docker/` 中所有第三方镜像一样，它被固定为 `ollama/ollama:0.40.6@sha256:…`（[ADR 0159](../adr/0159-imagem-de-terceiro-por-digest.md)，自 [ADR 0178](../adr/0178-tag-inline-na-imagem-de-terceiro.md) 起 tag 内联），`ci.yml`/`golden-set-rag.yml` 使用同一个 digest，因为 RAG golden-set 的下限按模型而不是按环境区分（[ADR 0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md)）。因此，两次 `docker compose pull` 之间推理行为发生变化不再是可能的原因：除非有人编辑 digest，否则什么都不会变。升级版本是[一个 runbook 流程](../runbook.md#subindo-imagem-de-terceiro)，`scripts/ci/imagens-pinadas.ts` 会拒绝只覆盖了 tag 出现位置之一部分的升级。

---

## 本地可观测性（容器）

同样不由我们的代码读取：它们是 overlay `docker/docker-compose.observability.yml` 的端口，该 overlay 在开发栈旁边启动 Prometheus、Loki 和 Grafana（`pnpm dev:obs`）。机制见[本地可观测性](../runbook.md#observabilidade-local)。

| 变量 | 默认值 | 原因 |
|---|---|---|
| `GRAFANA_PORT` | `3001` | 与集群的 Grafana 使用同一端口；两者**不能共存**，原因与 `pnpm dev` 和 `make deploy-local` 不能共存相同 |
| `PROMETHEUS_PORT` | `9090` | runbook 在集群的 `kubectl port-forward` 中已经使用的端口 |
| `LOKI_PORT` | `3100` | 仅用于直接查询；正常途径是通过 Grafana |

overlay **没有**定义 `OTEL_EXPORTER_OTLP_ENDPOINT`：中间没有 Collector，把应用指向一个不存在的地址只会在每个回合产生一次导出错误（[ADR 0035](../adr/0035-observabilidade-legivel-e-trace-sem-coletor.md) 正是为此把插桩和导出分开）。指标和日志不需要它就能工作；trace 仍然需要集群。

---

## 容器 broker

broker（[ADR 0130](../adr/0130-broker-de-container.md)）是产品中唯一与服务器上 Docker daemon 通信的进程，也是唯一挂载了 `/var/run/docker.sock` 的服务。**在本地它随 `pnpm dev` 启动；在生产环境中它位于 `profiles: ["container-broker"]` 之下。** 两个 compose 文件故意不同（[ADR 0146](../adr/0146-base-consentida-no-bootstrap.md)，第 3 点）——不要把它们统一。

它曾经在两者中都默认关闭，理由是还没有任何东西调用它。这个前提已经不成立：它有四个真实调用方，[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md) 让 **Mounted** 模式通过 broker 启动容器——所以在 profile 关闭时，默认的本地模式以 `BrokerIndisponivelError` 告终。支撑这种不对称的是 socket 在两边的含义：运行 `pnpm dev` 的人已经拥有它（他在运行 `docker compose`），而在生产环境中它是一道真实的权限边界，运维人员也不是开发者。

这改变的是 broker **何时**运行，绝不改变它**接受什么**：五层隔离都完好无损，它仍然接收一个 `projectId`
外加五种操作之一，任何地方都没有可以写入 `privileged` 或任意 `-v` 的参数。

默认启动暴露了一个以前从未要紧过的缺陷：本地镜像在**启动**时安装依赖，而 broker 唯一的网络是 `internal: true`，所以无法访问任何 registry——容器以 `getaddrinfo EAI_AGAIN registry.npmjs.org` 死掉，而由于没有 healthcheck，`up --wait` 仍然打印 `Healthy`。现在依赖在**构建**时安装，服务也有了 healthcheck；网络没有改动，也不应改动。运维细节见 [runbook](../runbook.md#broker-de-container)。

在生产环境中，显式启动它：

```bash
docker compose -f docker/docker-compose.prod.yml \
  --profile container-broker up -d broker
```

| 变量 | 默认值 | 出错时 |
|---|---|---|
| `BROKER_URL` | **开发** compose 中为 `http://broker:8090`；生产和安装中为空（由 **api** 读取） | 为空是**正常**状态：读取容器观测状态的地方会说"未观测"，而不是沿用登记的状态（[RN-486](../business-rules.md#rn-486)），api 返回 `brokerConfigurado: false`，于是创建项目时只提供 `runner`（[RN-573](../business-rules.md#rn-573)）。在本地 broker 默认启动，所以开发 compose 默认把它指向自己启动的服务（[RN-599](../business-rules.md#rn-599)）——`.env` 中的值仍然优先。生产和安装用的 compose 故意没有默认值：在那里 broker 位于 profile 之下，开启它的人写入 URL |
| `BROKER_PORT` | `8090` | broker 监听的端口。它**不**在宿主机上发布任何东西——只有 api 能通过 compose 的 `internal: true` 网络访问它 |
| `BRABO_SERVICE_TOKEN` 🔒 | 开发中为 `dev-service-token-change-me` | 与 api ↔ engine **相同**的密钥，放在同一个头里。当 `NODE_ENV=production` 时，如果它为空、是仓库中的公开字面值或少于 16 个字符，broker 拒绝启动——这是 RN-114 的规则，在这里守护的是一个与宿主机 Docker 通信的进程。`BRABO_SERVICE_TOKEN_PREVIOUS` 定义后遵循同样的规则，只是不是必填：去除空白，在生产环境中如果它是公开字面值或少于 16 个字符，broker 拒绝启动（[RN-601](../business-rules/autenticacao.md#rn-601)） |
| `API_URL` | `http://api:3000` | broker 从这里**读取**架构师的决定。它不接收容器规格；而是主动来取（[RN-485](../business-rules.md#rn-485)） |
| `PROJECT_WORKSPACES_HOST_ROOT` | — | 项目文件夹在**宿主机上**的根目录，而不是任何容器内部的。没有它，`start` 会拒绝并指出这个变量，其他四种操作照常工作。不要把它与 `PROJECT_WORKSPACES_ROOT` 混淆，后者是容器内的路径：`-v` 由 **daemon** 针对宿主机文件系统解析，使用 api 内部的路径会让它创建并挂载一个**空**文件夹 |
| `DOCKER_GID` | `999`（compose） | 宿主机 `docker` 组的 gid（`getent group docker \| cut -d: -f3`）。socket 是 `root:docker`，而 broker 以非 root 运行，所以 compose 使用 `group_add`。默认值是最常见的，但在多个发行版上是错的。自 [ADR 0146](../adr/0146-base-consentida-no-bootstrap.md) 起，这在**每台**开发机上都很重要，而不仅是有人开启了 profile 的地方——设错不会让启动失败，而是让使用失败：每个操作都会因 socket 上的 "permission denied" 而失败，而这只有在有人提议 `container_start` 时才会出现。`pnpm dev` 每次运行都会报告这个变量的状态（[RN-512](../business-rules.md#rn-512)），在没有 `docker` 组的机器上会说"不适用"，而不是指责它 |

`PROJECT_WORKSPACES_HOST_ROOT` 无法从托管的 Docker 卷推导出来。在**开发** compose 中，它从 `PROJECT_WORKSPACES_HOST_DIR`（见上文）推导——所以不定义后者（刚复制的 `.env.example` 的状态）会让 broker 没有根目录，让 `container` 模式没有容器：栈健康地启动，而 `container_start` 以拒绝告终。`pnpm dev` 每次运行都会报告这一点，方式与 `DOCKER_GID` 相同，并且从不拒绝启动（[RN-599](../business-rules.md#rn-599)）。它也会报告 `~` 的情况：Compose 会在 `api`/`engine` 使用的 bind-mount 来源中展开 `~`，但**不会**在 broker 接收的变量中展开（用 `docker compose config` 测得），所以请写入**已展开**的路径。显式设置且与 `api`/`engine` 所挂载文件夹不同的 `PROJECT_WORKSPACES_HOST_ROOT` 会被报告为不一致——容器会收到一个 agent 从未写入过的文件夹。把托管卷换成宿主机文件夹不会迁移 `project_workspaces` 卷中已有的内容：数据留在那里，只是不再是 `api` 和 `engine` 看到的东西。

`BRABO_PROJECTS_HOST_BASE` 是 broker 的**第二个**根目录——**Mounted** 项目的基础目录，同样位于宿主机上（[ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md)，[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)）。与上面那个不同，它不需要填写：compose 从 `BRABO_PROJECTS_BASE` 推导它，后者按定义就是宿主机路径（是 `api` 和 `engine` 按同一路径挂载的东西）。只有当 Docker daemon 通过另一条路径访问该文件夹时，才显式定义它。

正是它让 **Mounted** 项目可以拥有容器（[RN-503](../business-rules.md#rn-503)）：api 发送一个带判别字段的定位符（`localizacao.tipo`——`gerenciada` 或 `montada`）以及相对路径段，broker 针对相应的根目录解析它。两个根目录永远不会互相替代。缺少它会让 `mounted` 项目的 `start` 以 **503** 拒绝，并**指出**变量名，不触碰任何容器——回退到 `PROJECT_WORKSPACES_HOST_ROOT` 会挂载另一个项目的文件夹，因为托管根目录以 `workspace_dir_name` 命名，而基础目录由用户命名。


---

## 开发容器的用户（构建时） {#dev-container-user-build-time}

同样不由我们的代码读取，甚至也不是*运行时*环境变量：它们是三个开发镜像（`docker/api/Dockerfile`、`docker/web/Dockerfile`、`docker/engine/Dockerfile`）的 Docker `build.args`，在 `docker compose build` 时读取一次，并嵌入每个容器运行所用的 `USER`。它们的存在是为了让容器以**与你宿主机用户相同的 UID/GID** 运行，而不是 root——写入 bind mount 的一切（`apps/api/dist`、`mounted` 执行模式下的项目 workspace）本来就属于你，之后不需要 `sudo chown`。

| 变量 | 默认值 | 原因 |
|---|---|---|
| `DEV_UID` | `1000` | 你的 `id -u`。**不**从 shell 的 `${UID}` 读取——它在 bash 中是只读的，默认不导出到环境，所以 compose 文件总是看到它为空 |
| `DEV_GID` | `1000` | 你的 `id -g`，道理相同 |

`1000`/`1000` 与单个开发者最常见的 Linux 配置一致，也与 `node:26-alpine`（`api`/`web` 的基础镜像）自带的 `node` 用户一致——当你的组合匹配时，Dockerfile 会复用这个用户而不是新建一个。已经有在此变更之前以 root 运行的容器的环境，需要对命名卷 `node_modules`/`_build`/`deps`/`.mix`/`.hex` 做一次 `chown`（或执行 `docker compose down -v` 让它们被重建）——参见[快速开始](../getting-started.md)中的说明。

生产和安装用的 compose 不同：engine 从生产镜像以固定用户 `engine`（uid/gid `1000`，没有 `DEV_UID`）运行，带有 `read_only: true` 和挂载在 `/home/engine` 的 tmpfs。这个 tmpfs 声明为 `uid=1000,gid=1000,mode=0700`——不是变量——因为 semgrep（SecOps 的 gate）会在那里写 `~/.semgrep`；如果以 root 创建，扫描不返回任何结果，gate 会在没有静态分析的情况下通过（[RN-707](../business-rules.md#rn-707)，runbook [O gate de SecOps está preso em "SAST não rodou"](../runbook.md#semgrep-do-gate)）。

两个 engine 镜像都用构建参数 `SEMGREP_VERSION` 固定 semgrep（`1.171.0`，在 `docker/engine/Dockerfile` 和 `Dockerfile.prod` 中相同，由 `scripts/ci/semgrep-do-engine.spec.ts` 保持一致）。它是构建参数，不是运行时变量——`.env` 中什么都不用写。没有固定时，pip 取到了 1.179.0，而它不发布 `musllinux` wheel：在 Alpine 镜像中，包来自不含 `semgrep-core` 的 sdist，所有扫描都失败了。升级版本就是选择一个在 PyPI 上有 `musllinux` wheel 的 release，并在同一个 PR 中修改两个 Dockerfile。

engine 镜像运行于 Alpine 3.24 上的 **Elixir 1.20.4 / OTP 29.1.1**（builder `hexpm/elixir:1.20.4-erlang-29.1.1-alpine-3.24.2`，runtime `alpine:3.24.2`，两者都按 digest——[ADR 0209](../adr/0209-engine-em-otp-29.md)）。低于 29.1 的 OTP 在 CPU 带有 AMX 的宿主机上、在 Alpine 3.24 的 musl 1.2.6 下启动时会中止（`sys_sigaltstack(): Internal error`）；不要在不降级 musl 的情况下降级 OTP。`.env` 中什么都不用写。

六个 Dockerfile 都不使用 corepack（Node 25+ 不再附带它，AT-360）：构建从 registry 的 tarball 安装 pnpm，并与写在 Dockerfile 中的 sha512 核对——构建参数 `PNPM_VERSION`（`11.3.0`，与 `package.json` 中 `packageManager` 相同，这样 pnpm 永远不会在运行时尝试下载另一个版本）和 `PNPM_SHA512`。它们是构建参数，不是运行时变量，`.env` 中没有要定义的东西：升级 pnpm 就是在同一个 PR 中修改 `packageManager`、各 workflow 的 `PNPM_VERSION` 以及六个 Dockerfile 中的两个参数——参见 runbook 中关于 broker 镜像的一节。

---

## 工具变量（非产品）

上面的一切都是**产品**：运维安装的人在部署的 `.env` 中定义的东西。下面的是**工具**——只由 CI 和开发 Brabo 的人读取。这些都不属于运维人员的 `.env`，这个区别正是下面的清单为每个来源做标记的原因。

### 演示与种子脚本——`apps/api/scripts/`

它们驱动真实的 agent 对接本地 Ollama，所以接收的是**模型名**和**时限**。全部都有默认值，没有一个是必填的。

| 变量 | 默认值 | 改变什么 |
|---|---|---|
| `DEMO_MODEL` | `qwen2.5-coder:7b` | 所有演示脚本使用的模型，除非下面某个变量为特定角色覆盖它 |
| `DEMO_QA_MODEL` | `DEMO_MODEL` | 仅 QA agent，在 PR gate 的演示中——用不同于写代码的模型来评判 |
| `DEMO_WORKFLOWS_MODEL` | `DEMO_MODEL` | 仅 GitHub workflow 演示中的 Infra agent |
| `DEMO_MODEL_LEVE` | `qwen2.5-coder:7b` | 心理学家的**轻量**模型（廉价那一轮使用的） |
| `DEMO_MODEL_PESADO` | `qwen-psicologo-pesado:latest` | 心理学家的**重量**模型。它是本地 `Modelfile` 变体，不是已发布的 tag——因此有下面那个变量 |
| `DEMO_OLLAMA_COPY_FROM` | `qwen2.5-coder:7b` | 演示需要在本地 Ollama 中创建重量模型时复制的基础模型 |
| `DEMO_TIMEOUT_MS` | `1800000`（30 分钟）；dev agent 演示中为 `900000` | 脚本放弃之前等待执行结束的时长 |
| `DEMO_ANAMNESE_TIMEOUT_MS` | `900000`（15 分钟） | 同样的时限，用于 Anamnese 演示 |
| `DEMO_PSICOLOGO_TIMEOUT_MS` | `600000`（10 分钟） | 同样的时限，用于心理学家演示 |
| `GOLDEN_SET_QA_MODEL` | `qwen2.5-coder:latest` | `seed-golden-set-qa.ts` 登记为 QA golden-set 评判者的模型（[ADR 0123](../adr/0123-golden-set-regressao-qa-automacao.md)） |

下面的清单在此来源下列出的 `NOME` **不是变量**：它是 `demo-pr-gates.ts` 中一个 prompt 字符串里的字面值 `process.env.NOME`，教 agent 替换代码中写死的密钥。清单按模式提取，无法区分提及和读取——它列在这里而不是在来源处被过滤，因为逐个名字的忽略列表是又一个需要保持更新的地方。

### 浏览器 E2E——`e2e/`

`e2e/` 不是 workspace 成员（[ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md)），它针对**生产 compose** 运行，所以它的地址是发布的端口而不是开发端口。凭据是种子账户的——与 `docker/smoke.sh` 创建的相同。清单扫描 `e2e/` 下的所有 `.ts`，**包括 Playwright 的 spec**——在那里 spec 就是读取环境的代码，而不是旁边的单元测试（AT-124）。

| 变量 | 默认值 | 改变什么 |
|---|---|---|
| `E2E_API_URL` | `http://localhost:3000` | 套件的 HTTP 支持代码访问 api 的地址 |
| `E2E_WEB_URL` | `http://localhost:8088` | Playwright 打开的 `baseURL`，也是 CSRF 断言所依赖的源 |
| `E2E_USER` | `owner@brabo.dev` | 套件登录用的账户 |
| `E2E_PASSWORD` | 固定在 `e2e/suporte/api.ts` 中的种子密码 | 该账户的密码。它是**本地种子**的密码，绝不是真实密码——这里不重复写出，以便唯一的副本仍是代码中的那一份 |


### 本地集群与定期证明——`deploy/k8s/`

bootstrap（`make deploy-local`）以及 `.github/workflows/propriedades.yml` 每周运行的属性证明从环境中读取这些变量。全部都有默认值；没有一个属于安装的 `.env`。清单扫描所有 `deploy/k8s/*.sh`，只匹配带默认值的展开（`${X:-…}`），这是 shell 脚本读取外部变量的方式（AT-212）。

| 变量 | 默认值 | 改变什么 |
|---|---|---|
| `BRABO_CLUSTER_NAME` | `brabo` | bootstrap 创建或复用的 k3d/kind 集群名 |
| `BRABO_CLUSTER_TOOL` | `k3d` | `kind` 让 bootstrap 改用 kind——它会悄无声息地忽略 NetworkPolicy，因此默认使用 k3d |
| `BRABO_KEEP_CLUSTER` | 未定义 | `1` 复用已有的同名集群，而不是删除并重建 |
| `BRABO_SKIP_BUILD` | 未定义 | `1` 跳过生产镜像的构建，使用 Docker daemon 中已有的镜像 |
| `BRABO_SKIP_OBSERVABILITY` | 未定义 | `1` 跳过 Tempo、Loki、Collector、Alloy 和 Grafana（Prometheus 和 adapter 保留：engine 的 HPA 读取它们）。只有 `propriedades.yml` 定义它（AT-177） |
| `TAG` | 未定义 | 一个 release tag（`vX.Y.Z-qa.N`），让 bootstrap 检出并部署它而不是工作树；要求工作树干净 |
| `BRABO_NAMESPACE` | `brabo` | 所有证明脚本通信的 namespace |
| `API_URL` / `ENGINE_URL` / `WEB_URL` | `http://localhost:3000` / `:4000` / `:8088` | 证明脚本访问集群服务的地址——k3d 负载均衡器发布的端口。与上面产品变量同名，但读取方不同：这里它们只是脚本的目标 |
| `SMOKE_USER` | `owner@brabo.dev` | smoke 和各项证明登录用的账户 |
| `BRABO_SMOKE_PASSWORD` | 本地种子密码，固定在脚本中 | 该账户的密码——也是 bootstrap 作为 `BRABO_SEED_PASSWORD` 传给种子 pod 的值 |
| `HPA_JOBS` | `60` | `make hpa-test` 为让 engine 扩容而入队的探测 job 数 |
| `HPA_TIMEOUT` | `240` | `make hpa-test` 等待扩容的秒数 |
| `ROLLOUT_SESSIONS` | `5` | `make rollout-test` 在 rollout 之前打开的会话数 |
| `ROLLOUT_CONVERGENCE_SECONDS` | `120` | rollout 之后每个会话被接管或排空的上限。不要为了让红色的一轮变绿而调高它（参见 `CLAUDE.md` 中孤立会话的缺口） |
| `ROLLOUT_EVIDENCE_DIR` | 一个 `mktemp -d` | `make rollout-test` 写入证据（pod 日志、事件、副本采样）的位置；`propriedades.yml` 定义它并上传该文件夹 |
| `EVIDENCIA_INTERVALO` | `2` | 证据收集器两次采样之间的秒数；spec 会缩短它（AT-174） |
| `RESTORE_MUTACAO` | 未定义 | `tabela-faltando` 把 `make test-restore` 变成 `make test-restore-mutacao`，即它必须捕获的故意破坏（AT-126） |
| `RESTORE_KEEP_JOB` | 未定义 | `1` 在 `make test-restore` 之后保留备份/恢复 Job，以便检查 |
| `PROJECT_WORKSPACES_ROOT_NO_POD` | `/data/project-workspaces` | `make test-reprojecao-artefatos-k8s` 在 api pod 内寻找产物文件夹的位置 |
| `KUBE_VERSION` | `1.31.0` | `make k8s-validate` 校验渲染后 overlay 所针对的 Kubernetes 版本 |

---

## 完整清单

上面的表格解释**每个变量做什么**。本节是**清单**：每次 `pnpm docs:generate` 时从代码中提取，它的存在是为了让新变量不会在任何地方都没有文档而无人察觉。

<!-- BEGIN:GENERATED:env-inventario -->

> ⚠️ 此区块由 `pnpm docs:generate` 生成。请勿手动编辑——下次构建会覆盖它。

从代码中提取的清单：运行时读取 **181 个变量**。全部都在上方表格中有描述。

每个来源都标记为 **产品**——运维安装的人在部署 `.env` 中设置的内容——或 **工具**，仅由 CI 和开发产品的人读取。工具变量绝不应出现在运维人员的 `.env` 中。

**api** — 66 个变量 · 产品

- `API_JSON_BODY_LIMIT` <sub>(apps/api/src/main.ts)</sub>
- `API_PUBLIC_URL` <sub>(apps/api/src/application/use-cases/auth/start-social-login.use-case.ts)</sub>
- `ARTIFACT_PROJECTOR_INTERVAL_MS` <sub>(apps/api/src/application/artifact-projection/artifact-projector.ts)</sub>
- `AUTH_ACCESS_TOKEN_TTL_MS` <sub>(apps/api/src/infrastructure/security/ed25519-access-token-issuer.ts)</sub>
- `AUTH_EMAIL_TOKEN_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_IP_ATTEMPT_THRESHOLD` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_JWT_SECRET` <sub>(apps/api/src/infrastructure/security/auth-key-material.ts)</sub>
- `AUTH_JWT_SECRET_PREVIOUS` <sub>(apps/api/src/infrastructure/security/auth-key-material.ts)</sub>
- `AUTH_LOCKOUT_ENABLED` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_LOCKOUT_IP_THRESHOLDS` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_LOCKOUT_THRESHOLDS` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_LOCKOUT_WINDOW_MS` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_MAIL_LOG_TOKENS` <sub>(apps/api/src/infrastructure/mail/log-mail-sender.ts)</sub>
- `AUTH_REFRESH_ABSOLUTE_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_REFRESH_TOKEN_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_REGISTRATION_ENABLED` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_RESET_TOKEN_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_SET_PASSWORD_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_TOKEN_PEPPER` <sub>(apps/api/src/infrastructure/security/auth-key-material.ts)</sub>
- `BRABO_FORCE_SEED` <sub>(apps/api/src/scripts/provisionar-usuario.ts)</sub>
- `BRABO_PROJECTS_BASE` <sub>(apps/api/src/infrastructure/filesystem/project-workspaces-root.ts)</sub>
- `BRABO_SEED_PASSWORD` <sub>(apps/api/src/db/seed.ts)</sub>
- `BRABO_SERVICE_TOKEN` <sub>(apps/api/src/infrastructure/security/service-token.ts)</sub>
- `BRABO_SERVICE_TOKEN_PREVIOUS` <sub>(apps/api/src/infrastructure/security/service-token.ts)</sub>
- `BRABO_VERSION` <sub>(apps/api/src/tracing.ts)</sub>
- `BROKER_URL` <sub>(apps/api/src/infrastructure/http-clients/container-broker.client.ts)</sub>
- `CREDENTIALS_MASTER_KEY` <sub>(apps/api/src/infrastructure/security/envelope-encryption.service.ts)</sub>
- `CREDENTIALS_MASTER_KEY_PREVIOUS` <sub>(apps/api/src/infrastructure/security/envelope-encryption.service.ts)</sub>
- `DATABASE_URL` <sub>(apps/api/src/db/migrate.ts)</sub>
- `ENGINE_PUBLIC_URL` <sub>(apps/api/src/application/use-cases/runner/request-runner-ticket.use-case.ts)</sub>
- `ENGINE_URL` <sub>(apps/api/src/application/use-cases/runner/request-runner-ticket.use-case.ts)</sub>
- `GIT_LOCAL_REPOS_ROOT` <sub>(apps/api/src/infrastructure/git/local-git-provider.ts)</sub>
- `GIT_OAUTH_STATE_SECRET` <sub>(apps/api/src/infrastructure/security/oauth-state-secret.ts)</sub>
- `GITHUB_OAUTH_CLIENT_ID` <sub>(apps/api/src/infrastructure/git/github-oauth-client.ts)</sub>
- `GITHUB_OAUTH_CLIENT_SECRET` <sub>(apps/api/src/infrastructure/git/github-oauth-client.ts)</sub>
- `GITLAB_OAUTH_CLIENT_ID` <sub>(apps/api/src/infrastructure/git/gitlab-oauth-client.ts)</sub>
- `GITLAB_OAUTH_CLIENT_SECRET` <sub>(apps/api/src/infrastructure/git/gitlab-oauth-client.ts)</sub>
- `GRAPH_PROJECTOR_INTERVAL_MS` <sub>(apps/api/src/application/graph-projection/graph-projector.ts)</sub>
- `HUGGINGFACE_API_TOKEN` <sub>(apps/api/src/infrastructure/huggingface/huggingface-client.ts)</sub>
- `HUGGINGFACE_HUB_URL` <sub>(apps/api/src/infrastructure/huggingface/huggingface-client.ts)</sub>
- `LOG_LEVEL` <sub>(apps/api/src/infrastructure/observability/logger.config.ts)</sub>
- `MAIL_TRANSPORT` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `METRICS_GAUGE_INTERVAL_MS` <sub>(apps/api/src/infrastructure/observability/domain-gauges.collector.ts)</sub>
- `MIGRATIONS_FOLDER` <sub>(apps/api/src/db/migrate.ts)</sub>
- `NEO4J_PASSWORD` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NEO4J_URI` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NEO4J_USER` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NINE_ROUTER_BASE_URL` <sub>(apps/api/src/infrastructure/llm/nine-router-provider.ts)</sub>
- `NODE_ENV` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `OLLAMA_HOST` <sub>(apps/api/src/infrastructure/llm/ollama-provider.ts)</sub>
- `OTEL_DIAG_LOG` <sub>(apps/api/src/tracing.ts)</sub>
- `OTEL_EXPORTER_OTLP_ENDPOINT` <sub>(apps/api/src/tracing.ts)</sub>
- `OTEL_SERVICE_NAME` <sub>(apps/api/src/tracing.ts)</sub>
- `PORT` <sub>(apps/api/src/main.ts)</sub>
- `PROJECT_WORKSPACES_ROOT` <sub>(apps/api/src/infrastructure/filesystem/project-workspaces-root.ts)</sub>
- `RATE_LIMIT_ENABLED` <sub>(apps/api/src/interfaces/http/shared/rate-limit.guard.ts)</sub>
- `RATE_LIMIT_IP` <sub>(apps/api/src/interfaces/http/shared/rate-limit.guard.ts)</sub>
- `RATE_LIMIT_USER` <sub>(apps/api/src/interfaces/http/shared/rate-limit.guard.ts)</sub>
- `RATE_LIMIT_WINDOW_MS` <sub>(apps/api/src/infrastructure/observability/domain-gauges.collector.ts)</sub>
- `SMTP_FROM` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_HOST` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_PASSWORD` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_PORT` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_SECURE` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_USER` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `WEB_ORIGIN` <sub>(apps/api/src/infrastructure/mail/smtp-mail-sender.ts)</sub>

**engine** — 63 个变量 · 产品

- `ANAMNESE_BUDGET_MICROS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_INITIAL_WINDOW_DAYS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_INTERVAL_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MAX_ITERATIONS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MAX_PAYLOAD_CHARS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MAX_PROMPT_EVENTS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MIN_EVENTS` <sub>(apps/engine/config/runtime.exs)</sub>
- `API_URL` <sub>(apps/engine/config/runtime.exs)</sub>
- `BRABO_SERVICE_TOKEN` <sub>(apps/engine/config/runtime.exs)</sub>
- `BRABO_SERVICE_TOKEN_PREVIOUS` <sub>(apps/engine/config/runtime.exs)</sub>
- `CONTEXT_COMPACTION_THRESHOLD` <sub>(apps/engine/config/runtime.exs)</sub>
- `DATABASE_URL` <sub>(apps/engine/config/dev.exs)</sub>
- `DEFAULT_CONTEXT_WINDOW` <sub>(apps/engine/config/runtime.exs)</sub>
- `DNS_CLUSTER_QUERY` <sub>(apps/engine/config/runtime.exs)</sub>
- `ECTO_IPV6` <sub>(apps/engine/config/runtime.exs)</sub>
- `GATE_RESCUE_INTERVAL_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `GATE_RESCUE_STALE_AFTER_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `GRAPH_TEMPLATES_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `LLM_TURN_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `MIX_TEST_PARTITION` <sub>(apps/engine/config/test.exs)</sub>
- `MODEL_SYNC_INTERVAL_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `OTEL_EXPORTER_OTLP_ENDPOINT` <sub>(apps/engine/config/runtime.exs)</sub>
- `PHX_HOST` <sub>(apps/engine/config/runtime.exs)</sub>
- `PHX_SERVER` <sub>(apps/engine/config/runtime.exs)</sub>
- `POOL_SIZE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PORT` <sub>(apps/engine/config/runtime.exs)</sub>
- `POSTGRES_HOST` <sub>(apps/engine/config/test.exs)</sub>
- `POSTGRES_PASSWORD` <sub>(apps/engine/config/test.exs)</sub>
- `POSTGRES_USER` <sub>(apps/engine/config/test.exs)</sub>
- `PROJECT_WORKSPACES_ROOT` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_BUDGET_MICROS_LEVE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_BUDGET_MICROS_PESADA` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_ITERATIONS_LEVE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_ITERATIONS_PESADA` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_PAYLOAD_CHARS` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_PROMPT_EVENTS_LEVE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_PROMPT_EVENTS_PESADA` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_RAG_TOP_K` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_TRIAGE_THRESHOLD` <sub>(apps/engine/config/runtime.exs)</sub>
- `READ_FILE_MAX_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `SEARCH_WORKSPACE_MAX_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `SEARCH_WORKSPACE_MAX_HITS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SECOPS_SCAN_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SECRET_KEY_BASE` <sub>(apps/engine/config/runtime.exs)</sub>
- `SESSION_CONVERSATION_IDLE_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SESSION_HEARTBEAT_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SHUTDOWN_DRAIN_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SOME_APP_SSL_CERT_PATH` <sub>(apps/engine/config/runtime.exs)</sub>
- `SOME_APP_SSL_KEY_PATH` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_ANAMNESE` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_GATE_RESCUE` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_MODEL_SYNC` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_OUTBOX_DRAIN` <sub>(apps/engine/config/runtime.exs)</sub>
- `TERMINAL_ACTION_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `TERMINAL_OUTPUT_MAX_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `TOOL_LOOP_MAX_ITERATIONS` <sub>(apps/engine/config/runtime.exs)</sub>
- `TOOL_LOOP_MAX_ITERATIONS_EXECUCAO` <sub>(apps/engine/config/runtime.exs)</sub>
- `TOOL_LOOP_MAX_ITERATIONS_GATE` <sub>(apps/engine/config/runtime.exs)</sub>
- `TRANSPORT_MAX_BODY_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `WEB_ORIGIN` <sub>(apps/engine/config/runtime.exs)</sub>

**web** — 4 个变量 · 产品

- `VITE_API_URL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_BRABO_VERSION` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_ENGINE_URL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_LOG_LEVEL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>

**broker** — 7 个变量 · 产品

- `API_URL` <sub>(apps/broker/src/config.ts)</sub>
- `BRABO_PROJECTS_HOST_BASE` <sub>(apps/broker/src/config.ts)</sub>
- `BRABO_SERVICE_TOKEN` <sub>(apps/broker/src/config.ts)</sub>
- `BRABO_SERVICE_TOKEN_PREVIOUS` <sub>(apps/broker/src/config.ts)</sub>
- `BROKER_PORT` <sub>(apps/broker/src/config.ts)</sub>
- `NODE_ENV` <sub>(apps/broker/src/config.ts)</sub>
- `PROJECT_WORKSPACES_HOST_ROOT` <sub>(apps/broker/src/config.ts)</sub>

**api/scripts** — 15 个变量 · 工具

- `DATABASE_URL` <sub>(apps/api/scripts/demo-repo-bootstrap.ts)</sub>
- `DEMO_ANAMNESE_TIMEOUT_MS` <sub>(apps/api/scripts/demo-anamnese.ts)</sub>
- `DEMO_MODEL` <sub>(apps/api/scripts/demo-anamnese.ts)</sub>
- `DEMO_MODEL_LEVE` <sub>(apps/api/scripts/demo-psicologo.ts)</sub>
- `DEMO_MODEL_PESADO` <sub>(apps/api/scripts/demo-psicologo.ts)</sub>
- `DEMO_OLLAMA_COPY_FROM` <sub>(apps/api/scripts/demo-psicologo.ts)</sub>
- `DEMO_PSICOLOGO_TIMEOUT_MS` <sub>(apps/api/scripts/demo-psicologo.ts)</sub>
- `DEMO_QA_MODEL` <sub>(apps/api/scripts/demo-pr-gates-area-qa.ts)</sub>
- `DEMO_TIMEOUT_MS` <sub>(apps/api/scripts/demo-dev-agent-real.ts)</sub>
- `DEMO_WORKFLOWS_MODEL` <sub>(apps/api/scripts/demo-infra-workflows-github.ts)</sub>
- `GIT_LOCAL_REPOS_ROOT` <sub>(apps/api/scripts/demo-repo-bootstrap.ts)</sub>
- `GOLDEN_SET_QA_MODEL` <sub>(apps/api/scripts/seed-golden-set-qa.ts)</sub>
- `NOME` <sub>(apps/api/scripts/demo-pr-gates.ts)</sub>
- `OLLAMA_HOST` <sub>(apps/api/scripts/demo-psicologo.ts)</sub>
- `RATE_LIMIT_WINDOW_MS` <sub>(apps/api/scripts/relatorio-seguranca-runtime.ts)</sub>

**e2e** — 4 个变量 · 工具

- `E2E_API_URL` <sub>(e2e/suporte/api.ts)</sub>
- `E2E_PASSWORD` <sub>(e2e/suporte/api.ts)</sub>
- `E2E_USER` <sub>(e2e/suporte/api.ts)</sub>
- `E2E_WEB_URL` <sub>(e2e/playwright.config.ts)</sub>

**deploy/k8s** — 22 个变量 · 工具

- `API_URL` <sub>(deploy/k8s/rollout-test.sh)</sub>
- `BRABO_CLUSTER_NAME` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `BRABO_CLUSTER_TOOL` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `BRABO_KEEP_CLUSTER` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `BRABO_NAMESPACE` <sub>(deploy/k8s/hpa-test.sh)</sub>
- `BRABO_SKIP_BUILD` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `BRABO_SKIP_OBSERVABILITY` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `BRABO_SMOKE_PASSWORD` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `ENGINE_URL` <sub>(deploy/k8s/smoke.sh)</sub>
- `EVIDENCIA_INTERVALO` <sub>(deploy/k8s/rollout-evidencia.sh)</sub>
- `HPA_JOBS` <sub>(deploy/k8s/hpa-test.sh)</sub>
- `HPA_TIMEOUT` <sub>(deploy/k8s/hpa-test.sh)</sub>
- `KUBE_VERSION` <sub>(deploy/k8s/validate.sh)</sub>
- `PROJECT_WORKSPACES_ROOT_NO_POD` <sub>(deploy/k8s/test-reprojecao-artefatos.sh)</sub>
- `RESTORE_KEEP_JOB` <sub>(deploy/k8s/test-restore.sh)</sub>
- `RESTORE_MUTACAO` <sub>(deploy/k8s/test-restore.sh)</sub>
- `ROLLOUT_CONVERGENCE_SECONDS` <sub>(deploy/k8s/rollout-test.sh)</sub>
- `ROLLOUT_EVIDENCE_DIR` <sub>(deploy/k8s/rollout-test.sh)</sub>
- `ROLLOUT_SESSIONS` <sub>(deploy/k8s/rollout-test.sh)</sub>
- `SMOKE_USER` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `TAG` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `WEB_URL` <sub>(deploy/k8s/smoke.sh)</sub>
<!-- END:GENERATED:env-inventario -->

---

> **TODO(humano):** 启动时没有对变量做 schema 校验（例如 api 中的 `zod`/`envalid` 或 engine 中的 `NimbleOptions`）。目前无效的数值会悄无声息地变成 `NaN`，变量名的拼写错误会在没有警告的情况下落到默认值。唯一的例外是标记为 🔒 的那些，它们在生产环境中会显式失败。
