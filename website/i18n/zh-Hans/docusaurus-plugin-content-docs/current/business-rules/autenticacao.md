---
id: autenticacao
title: '业务规则——认证'
sidebar_label: 认证
description: 'first-party 认证的 RN：带轮换的 refresh、cookie 中的会话、PAT、OAuth 和设备密钥。'
keywords: [业务规则, 认证, refresh, cookie, PAT, OAuth]
traducao_de: 35a0dc07ccbd159e749036b48dc8d249d4e3b8f8
---

# 认证

> 这些 RN 从 [`business-rules.md`](../business-rules.md) 中拆出，内容一字未改：单页已超过 640 KB，
> 仅这两个部分就占了一半。锚点 `#rn-NNN` 保持不变——只是承载它们的文件变了。

first-party 认证的规则。它们都在 api 的领域中生效，而自 7.2 起 api 也是访问 token 的**签发者**——Keycloak 在一次原子切换中退出，没有共存期。
决策见 [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
和 [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)。

### RN-030 — 重新出示已使用过的 refresh 会吊销整个家族 {#rn-030}

每次 refresh 都会消耗所出示的 token，并签发一个具有**相同** `family_id` 和相同 `family_started_at` 的子 token。出示一个已被消耗的 token 是盗用的特征——有人在使用副本——回应是吊销该家族所有存活的 token，并产生安全事件。

合法用户也会一并被登出。这是正确的行为，而不是缺陷：在服务器一侧，客户端的重复提交与窃贼的重放是完全相同的。

- **位置：** `apps/api/src/domain/auth/refresh-token.ts:50` +
  `application/use-cases/auth/refresh.use-case.ts:98`
- **测试：** `test/application/use-cases/auth/rotacao-e-reuso.spec.ts`
- **边界情况：** 出示**已被吊销**家族的 token 的人是下游受害者，而不是新的盗用：记录 `refresh_revoked`，**不**触发第二次级联。没有这个区分，在事件期间合法用户的每个标签页都会产生一次误报。
- **来源：** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-031 — 登录失败按邮箱和按 IP 计数，锁定逐级升级 {#rn-031}

Postgres 中 15 分钟的滑动窗口，不用 Redis。每次尝试两个桶，更严格的胜出：邮箱（5 次失败 → 30s，8 → 5min，12 →
15min）和 IP（20 → 30s，30 → 2min）。成功登录会清空邮箱的桶；IP 的桶只随时间排空。

桶的键是**规范化后的邮箱**，绝不是用户 id。用 id 的话，桶只有在找到账户之后才会存在，锁定本身就会成为账户存在性的预言机。

- **位置：** `apps/api/src/domain/auth/lockout-policy.ts:97` +
  `infrastructure/persistence/drizzle/drizzle-login-throttle.ts:74`
- **测试：** `test/application/use-cases/auth/lockout.spec.ts`
- **边界情况：** 处于锁定期间，尝试**不**被记录。如果被记录，攻击者只要不断尝试就能让受害者的账户永远被锁住——锁定会变成针对它所保护之人的拒绝服务。
- **原因：** IP 的桶不能在成功时清空；拥有一个有效账户的人可以随意把窗口清零，无限制地喷洒猜测。
- **来源：** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-032 — 没有任何响应能区分账户存在与否 {#rn-032}

任何不同于统一失败的响应，都只有在一次成功的密码校验**之后**才可能得到。在登录中，不存在的邮箱、错误的密码和被锁定的账户返回相同的 401，耗费相同的时间——没有账户的分支会对照一个用与真实哈希**相同参数**生成的虚拟哈希进行校验。在注册和重置请求中，已知和未知的地址都返回 202。

- **位置：** `apps/api/src/application/use-cases/auth/login.use-case.ts:79` +
  `register.use-case.ts:74`
- **测试：** `test/application/use-cases/auth/enumeracao.spec.ts`
- **边界情况：** 按邮箱的锁定检查在 argon2 **之后**运行，而不是之前。提前退出是任何审阅者都会建议的优化，而它恰恰就是泄漏——如果有人引入它，测试会变红。
- **边界情况：** 从 Keycloak *迁移*来的用户（存在于 `users` 中，在 `auth_credentials` 中没有行）同样收到统一的 401——并且"设置密码"的链接会被静默发出。响应 `password_pending` 会确认该地址存在**并且**是遗留账户。这就是为什么 `findByEmail` 是单次查询中的 LEFT JOIN：两次串联的查询会让这个分支多付一次数据库往返，时钟就会泄露响应体所隐藏的东西。
- **原因：** 所断言的是"没有任何分支跳过昂贵的工作，也没有任何分支产生可区分的响应"，**而不是**常数时间。后果见 ADR。
- **来源：** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)，
  迁移用户的边界情况见
  [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-033 — 验证和重置 token 只能使用一次 {#rn-033}

通过带 `returning` 的条件 UPDATE 消耗：UPDATE 本身就是防护。零行涵盖不存在、用途不同、已消耗、已作废和已过期——都给出相同的响应。请求新链接会作废之前的链接。完成重置会吊销用户的**所有**会话，并且不签发 token。

- **位置：** `apps/api/src/infrastructure/persistence/drizzle/account-token.repository.ts:76`
- **测试：** `test/application/use-cases/auth/tokens-de-conta.spec.ts`
- **边界情况：** 两次同时提交不会都通过。竞争是**正常**情形，而不是例外：企业邮件扫描器会打开每封邮件中的每个链接，因此机器人通常在人点击之前就消耗了 token。
- **原因：** 重置刻意不签发会话——直接通过邮件收到的链接登录，会让攻破邮箱等同于接管账户，而没有第二步。
- **来源：** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-034 — web 会话存在于带 CSRF 的 httpOnly cookie 中 {#rn-034}

refresh token 放在 cookie `brabo_refresh` 中（`httpOnly`、`SameSite=Strict`、
`Path=/auth`，生产环境中 `Secure`），并且**不**出现在任何响应体中。15 分钟的 access token 保存在客户端内存中，通过
`Authorization: Bearer` 传输。

`/auth/refresh` 和 `/auth/logout` 要求 `X-CSRF-Token` 等于 cookie
`brabo_csrf`，以常数时间比较。

- **位置：** `apps/api/src/interfaces/http/auth/session-cookies.ts:53` +
  `interfaces/http/auth/auth.controller.ts`
- **测试：** `test/interfaces/session-cookies.spec.ts`
- **边界情况：** CSRF 失败是 **403**，不是 401。如果是 401，客户端会尝试续期会话并陷入循环——凭据是好的，错的是请求。
- **原因：** 在响应体中也返回 refresh 会抵消 `httpOnly`——一个 XSS 读取登录响应就够了，它会带走长期会话，而不是 access 的 15 分钟。
- **来源：** [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-035 — engine ↔ api 的内部流量要求服务密钥 {#rn-035}

32 条 `/internal/*` 路由都是 `@ServiceRoute()`：它们位于用户 JWT 之外，也位于速率限制之外。认证的是 `EngineServiceGuard`，以常数时间比较
`X-Brabo-Service-Token` 与 `BRABO_SERVICE_TOKEN`。同一个秘密在两个方向上都有效，`BRABO_SERVICE_TOKEN_PREVIOUS` 只在校验时被接受，使轮换没有不可用的窗口。

- **位置：** `apps/api/src/interfaces/http/auth/engine-service.guard.ts:44` +
  `infrastructure/security/service-token.ts` +
  `apps/engine/lib/engine_web/plugs/verify_service_token.ex`
- **测试：** `apps/engine/test/engine_web/plugs/verify_service_token_test.exs`、
  `test/interfaces/route-surface.spec.ts`，以及针对 api 一侧的轮换（之前的值只在校验时被接受，调用方发送当前值，移除之前的值后旧值失效）的 `test/infrastructure/security/service-token.spec.ts`
  （describe "rotação do BRABO_SERVICE_TOKEN"）和
  `test/interfaces/engine-service.guard.spec.ts`（[RN-597](#rn-597)）
- **边界情况：** 速率限制的豁免来自路由的*元数据*，而不是 guard。`RateLimitGuard` 是 `APP_GUARD`，在任何 controller 的 guard 之前运行——它作出决定时，`EngineServiceGuard` 还没有运行。
- **来源：** [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-597 — 更换 pepper 等于全局登出 {#rn-597}

为不透明 token 的 HMAC 提供密钥的 pepper 没有 `_PREVIOUS`，更换它会带来后果，而不是一个流程：每个流通中的 refresh token、每个未完成的邮箱验证和密码重置链接，以及每个个人访问 token（PAT）都不再能被找到，因为用新 pepper 重新计算的哈希与已存储的不匹配。被拒绝的 refresh 记录 `refresh_unknown`（而不是 `refresh_reuse_detected`），链接显示 "Link inválido
ou expirado"，锁定桶的键会改变——被锁的账户解锁。*密码*不受影响（argon2id，每条记录有 salt，没有 pepper）：更换 pepper 的代价是一次登录，绝不是一个账户，api 用新值正常启动。

在 [RN-613](#rn-613) 之前，没有自己值的 pepper 会落到
`AUTH_JWT_SECRET` 上，JWT 的轮换也就是 pepper 的轮换，带有上面所有的后果。自那以后，pepper 在生产环境中是必需的，绝不从 JWT 借用。

- **位置：** `apps/api/src/infrastructure/security/auth-key-material.ts:212`
  (`pepper`), `:228` (`hashDeToken`), `:247` (`baldeDeEmail`);
  `apps/api/src/interfaces/http/auth/pat-auth.guard.ts:142`
- **测试：** `test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`，
  针对测试用 Postgres
- **边界情况：** "更换"的*目标*包括这样一种错误：把 pepper 与 JWT 分开的人生成了一个新值，而不是复制当前值——这是同一种更换，以同样的方式登出（在同一个 spec 中锁定，"a ordem errada"）。
- **来源：** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)，
  AT-196

### RN-613 — `AUTH_TOKEN_PEPPER` 是必需的且独立的；迁移者用当前的 `AUTH_JWT_SECRET` 定义它 {#rn-613}

不透明 token（refresh、账户链接、PAT、锁定桶）的 HMAC pepper 不再回落到 `AUTH_JWT_SECRET`。静默回退（`AUTH_TOKEN_PEPPER ?? passphraseAtual()`）让 JWT 的每一次"零停机"轮换都成为 pepper 的更换，而那是*常见*路径：生产和安装的 compose 甚至没有传递这个变量。在生产环境中，没有它 api *拒绝*启动，拒绝信息会说明修正方法——*"defina com o valor ATUAL de
AUTH_JWT_SECRET para não deslogar ninguém"*——，因为显而易见的修正（生成一个随机值）正是会让所有人登出的那个。pepper 等于旧 JWT 时，哈希与之前逐字节相同，refresh token 和 PAT 继续有效，此后 JWT 可以独自轮换。等于 JWT 的 pepper *不会*被拒绝：它是每个迁移过的安装的正当状态。JWT 的尺子（RN-114）同样适用：空白、仓库的两个示例字面量以及少于 16 个字符都会让启动失败。在生产环境之外，使用*独立*的开发默认值（`dev-auth-token-pepper-change-me`），绝不是 JWT 的那个。

`install.sh` 负责迁移：*全新*安装生成随机 pepper；如果文件夹中有之前的 `.env`，它会在被覆盖之前被*读取*（绝不执行），并保留其中的 pepper——或者，没有 pepper 时，以其中的 `AUTH_JWT_SECRET` 生成。终端会说明值来自哪里，绝不说出值本身。

- **位置：** `apps/api/src/infrastructure/security/auth-key-material.ts:168`
  （`pepperAtual`），`:212`（`pepper`）；`apps/api/src/main.ts:46`（启动检查）；`install.sh:702`（`valor_no_env_anterior`），`:734`（`gerar_segredos`），
  `:831`（`dizer_a_origem_do_pepper`）；三个 compose 中的变量
  （`docker/docker-compose.yml`、`docker-compose.prod.yml`、
  `docker-compose.install.yml`），`docker/smoke.sh` 中以及 `.env.example` 中
- **测试：** `test/infrastructure/security/auth-key-material.spec.ts`
  （describe "pepperAtual (RN-613)"：即使有 JWT 也拒绝没有 pepper、消息、示例值、下限、接受等于 JWT 的值、开发默认值）；
  `test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`（describe "a
  migração do RN-613"：用*旧*公式写入的 refresh 在 pepper 等于旧 JWT 时仍然有效，并能挺过 JWT 的更换；`AUTH_JWT_SECRET` 的 describe：生产之外没有 pepper 时，更换 JWT 不会登出）；
  `scripts/dev/install-env.spec.ts`（describe "o AUTH_TOKEN_PEPPER do
  instalador (RN-613)"，针对 `docker compose config`，完整的值）
- **边界情况：** 安装程序只能看到它运行所在文件夹的 `.env`。`.env` 位于别处的安装、自有 compose 以及使用 `ExternalSecret` 的 Kubernetes 需要按 runbook 手工迁移——在 Kubernetes 中，`AUTH_TOKEN_PEPPER` 属性已经存在于 `ExternalSecret` 和 `bootstrap.sh` 中，没有它的提供方本来就会让同步失败。而安装程序的迁移会删除卷（ADR 0150）：refresh 只对恢复 Postgres dump 的人存活，而这正是重要的情形。
- **来源：** AT-210（AT-196 的发现），维护者的决定：用当前值迁移

### RN-595 — 服务读取的每个 `_PREVIOUS` 都通过三个 compose 到达它，默认为空 {#rn-595}

三种零停机轮换（`AUTH_JWT_SECRET`、`BRABO_SERVICE_TOKEN`、
`CREDENTIALS_MASTER_KEY`）依赖于进程在窗口期间通过 `_PREVIOUS` 变量看到旧值。Compose 不传递主机的环境，而三者都不在任何 compose 的 `environment:` 中：在 `.env` 中定义 `_PREVIOUS` 没有效果，按 runbook 操作的人不知不觉地做了一次轮换本来要避免的硬切换。现在 api 接收这三个，engine 和 broker 接收 `BRABO_SERVICE_TOKEN_PREVIOUS`，在开发、生产和安装的 compose 中都是，默认值总是*空*——定义了就是轮换进行中，而填充了的默认值会让安装永远处于轮换中途。在三个读取方中，空与缺失等同。

- **位置：** `docker/docker-compose.yml`、`docker/docker-compose.prod.yml` 和
  `docker/docker-compose.install.yml`（`api`、`engine` 和 `broker` 服务）；
  读取方是 `apps/api/src/infrastructure/security/auth-key-material.ts:136`
  （`passphraseAnterior`），`apps/api/src/infrastructure/security/service-token.ts:92`
  （`tokenDeServicoAnterior`），`apps/api/src/infrastructure/security/envelope-encryption.service.ts:93`,
  `apps/engine/config/runtime.exs:70` 和 `apps/broker/src/config.ts:85`
- **测试：** `scripts/ci/previous-nos-composes.spec.ts`——从三个服务的代码中*推导*所读取的 `_PREVIOUS` 列表，在三个 compose 中任何一个缺失或带非空默认值时失败；"ExternalSecret
  do k8s" 块拒绝没有 `dataFrom.extract` 的 `ExternalSecret`、`data:` 中的 `_PREVIOUS`，以及没有 `envFrom: brabo-secrets` 的 api/engine Deployment
- **Kubernetes（AT-220，维护者的决定）：** Pod 读取
  `envFrom: brabo-secrets`，而 `ExternalSecret`
  （`deploy/k8s/base/common/externalsecrets.yaml`）通过 `dataFrom.extract` 从 store 拉取*整个* `brabo` 对象——`_PREVIOUS` 存在时进入，被移除时在下一次同步中退出。它不能列在 `data:` 中：ESO 没有可选键，缺失的属性（正常状态）会让整个 Secret 的同步失败。声明的代价：对象的*每个*键都会成为 api、engine、迁移和备份的变量，而缺失的*必需*键不再让同步失败——指出问题的是消费者。通过真实 ESO 的同步在一次性的 k3d 中手工演练过，不在 CI 中
- **来源：** AT-201（AT-196 的发现），与 RN-540 同类；Kubernetes 一半在 AT-220

### RN-598 — *之前*的服务 token 经过与当前 token 相同的尺子 {#rn-598}

在轮换期间，`BRABO_SERVICE_TOKEN_PREVIOUS` 和当前 token 一样能打开 `/internal/*`。它经过*一把*尺子，与当前 token 的相同（`exigirTokenDeProducao`），没有任何副本。周围的空格被丢弃，只由空格组成的值视为缺失。在生产环境中，公开的开发字面量（`dev-service-token-change-me`）以及 trim 后少于 16 个字符的值会让 api 启动*失败*，消息中点名
`BRABO_SERVICE_TOKEN_PREVIOUS`。在此之前，变量被原样比较：使用示例值的之前 token 会向任何读过这个仓库的人打开内部大门，而且不报任何错误。必需性是当前规则中唯一*不*被复制的部分，因为在轮换之外，之前值缺失是正常状态。等于当前值（trim 后）的之前值仍然不算轮换。

- **位置：** `apps/api/src/infrastructure/security/service-token.ts:63`
  （`exigirTokenDeProducao`），`:92`（`tokenDeServicoAnterior`）；
  `apps/api/src/main.ts:50`（`tokenDeServicoAnterior`），它在启动时与当前值并列运行
- **测试：** `test/infrastructure/security/service-token.spec.ts`（describe
  "tokenDeServicoAnterior (RN-598)"）
- **边界情况：** 这条 RN 是 api 一侧。engine 和 broker 自 [RN-601](#rn-601) 起应用同一把尺子。
- **来源：** AT-205（AT-196 的发现）

### RN-601 — engine 和 broker 对两个服务 token 应用 api 的尺子 {#rn-601}

比较服务 token 的三个进程都使用 [RN-598](#rn-598) 的同一把尺子，各用自己的语言。周围的空格被丢弃，只由空格组成的值视为缺失。在生产环境中，`BRABO_SERVICE_TOKEN` 缺失、公开的开发字面量（`dev-service-token-change-me`）或 trim 后少于 16 个字符的值会让启动*失败*，消息中点名该变量。后两种拒绝在 `BRABO_SERVICE_TOKEN_PREVIOUS` 被定义时也适用于它。等于当前值的之前值不算轮换。在生产环境之外只应用 trim，空的当前值落到开发默认值。

以前，engine 在 `config/runtime.exs` 中原样读取两者：没有 trim，没有下限，在生产环境中变量缺失时以公开默认值启动（compose 传空值时则以空字符串启动）。只有 api 拒绝启动才保护了安装。broker 已经对当前值应用这把尺子，但对之前值只做 trim。

形式上的两处分歧，已声明。在 engine 中，"生产"是
`config_env() == :prod`（release），而不是它不读取的 `NODE_ENV`；生产镜像总是 `:prod` release。并且尺子内联在 `runtime.exs` 中，而不在 `lib/` 的某个模块中，因为在 release 中这个文件在应用代码加载之前就在 config provider 中运行。

后果：在 `:prod` release 中评估这个 `runtime.exs` 的每个进程都需要 token，包括迁移（`bin/engine eval
Engine.Release.migrate()`）。因此，生产和安装 compose 中的 `migrate-engine` 服务开始接收 `BRABO_SERVICE_TOKEN` 和
`BRABO_SERVICE_TOKEN_PREVIOUS`，没有默认值。CI 的 smoke 显示了这一点：没有它们，迁移会在迁移之前就死掉。Kubernetes 的迁移 Job 本来就通过 `brabo-secrets` 的 `envFrom` 接收它们。

- **位置：** `apps/engine/config/runtime.exs:85`
  （`exigir_token_de_servico_de_producao`），`:105`（`service_token`），`:121`
  （`service_token_previous`）；`apps/broker/src/config.ts:89`（`anterior`），
  `:125`（`exigirTokenDeProducao`）
- **测试：** `apps/engine/test/engine/runtime_service_token_test.exs`（通过 `Config.Reader.read!/2` 真正评估 `runtime.exs`，带 `env: :prod` 和
  `:dev`）；`apps/broker/src/config.spec.ts`（describe "lerConfiguracao —
  produção, o token ANTERIOR (RN-601)"）
- **边界情况：** 尺子在三个进程中是复制的，而不是共享的：它们是三种语言或运行时，没有测试核对三份副本是否保持一致。下限计算字符数（Elixir 中是 `String.length`，TS 中是 `.length`），这只对非 ASCII 的 token 有区别。
- **来源：** AT-216（AT-205 的发现）

### RN-128 — `sessionId`/`projectId`/`agent`/`agentId` 在成为发往 engine 的内部请求 URL 段*之前*被校验 {#rn-128}

`HttpApiToEngineClient` 在模板字符串中插入这些值来构造 `/internal/*` 的 URL——中间没有 DTO/`class-validator`，与 [RN-127](../business-rules/custo.md#rn-127) 一样：它们来自 `@Param`/会话查找，在链条中某处没有校验管道，插入之前没有任何东西保证它们的形式。恶意值可能注入额外的路径段或破坏所构造 URL 的字符——`EngineServiceGuard` 认证的是*调用方*（RN-035），而不*核对*调用方在 URL 中发送了什么。

`garantirSegmentoDeUrlInterna` 复用与 `NOME_DE_PASTA_VALIDO`（RN-092/109）相同的宽度——十六进制、连字符和下划线，1 到 64 个字符——并在*两个*地方被调用，覆盖*所有*在 URL 中插入 id 的方法，而不只是 CodeQL 报告的那些：

- 在 `postCommand` 内部，大多数方法已经在使用它
  （`startAgent`、`sendAgentMessage`、`confirmReadiness`、`cancelAgentTurn`、
  `offerInfraHandoff`、`invalidateInstructions`、
  `startExecution`、`acceptParallelization`、`rearmDevAgent`、
  `reviseStory`）——调用者列出已经插入到 `path` 中的 `(nome, valor)` 元组，`postCommand` 在构造请求之前校验*全部*；
- 直接在 `reanalyzeSession`/`runAnamnese` 中，它们不经过
  `postCommand`（需要区分 503 与传输失败），因此是 CodeQL 能触及的仅有两个点。

正常路径不变：`sessionId`/`projectId` 总是来自数据库的 UUID，`agent`/`agentId` 总是短 slug。

- **位置：** `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  （`garantirSegmentoDeUrlInterna`、`postCommand`）
- **测试：** `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  （格式错误的 id 在接触网络*之前*被拒绝——通过把 `ENGINE_URL` 指向一个没有监听的端口来证明——而正常路径会真正发出请求）
- **来源：** CodeQL 的*严重*警报（用未校验的值构造的内部请求 URL），阻塞了 qa→main 的晋升，在 PR #256 期间发现；与 [RN-092](../business-rules/custo.md#rn-092) 同一模式

### RN-105 — 没有 Arquiteto 决定的镜像，容器不启动，代码标签页不打开 {#rn-105}

代码标签页（`GET /projects/:id/code/*`，[ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md)）在项目处于 `sem_decisao`——每个项目的初始状态——时响应 **409**。只有当 Arquiteto 通过 `choose_project_image` 工具发出 `artifact.project_image`，带有显式 tag 的 OCI 镜像（拒绝 `latest`）、`rationale` 和网络姿态时，`sem_decisao` 才变为 `decidido`。

检查位于与 [RN-095](../business-rules/custo.md#rn-095) 的路径约束*相同*的漏斗中（`ReadProjectCodeUseCase.alvo`），而不是在七条路由中的每一条中（目录树、文件、搜索、PR diff、[blame](#rn-110)、[PR 列表](#rn-111)和[详细分支](#rn-112)，FASE 26b）——在七个调用者中重复的检查，就是有一天会在其中一个中分歧的检查（[ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)）。在此更正计数：这条记录自 FASE 26 起写着"四条路由"，当 FASE 26b 把最后三条加入同一漏斗而没有人修订这个数字时，它就过时了。

工件没有表：它就是事件日志中的事件本身，带版本（每次发出 `version` 递增，现行的是 `version` 最大的），与 `artifact.module_map` 方式相同。修订镜像就是发出一个新版本，绝不覆盖之前的。

- **位置：** `apps/api/src/domain/containers/project-container.ts`,
  `apps/api/src/application/use-cases/containers/decidir-imagem-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/containers/obter-container-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`（方法
  `portaoDoContainer`），`apps/engine/lib/engine/harness/tools/choose_project_image.ex`
- **测试：**
  `apps/api/test/domain/containers/project-container.spec.ts`,
  `apps/api/test/application/use-cases/containers/container-do-projeto.use-case.spec.ts`,
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  （"o portão do container" 块）
- **边界情况：** 409 而不是 403——请求者及其权限都没有任何问题；资源在*这个状态*下还不存在。也不是 404：标签页存在，只是尚未开放。消息说明缺少什么，让界面显示原因而不是一个无声的错误（RN-088）。
- **来源：** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-106 — `git push`、PR 和部署不能通过终端发出——即使在项目范围之内 {#rn-106}

**由 [RN-418](../business-rules.md#rn-418) 修订（ADR 0102，产品所有者的*全局*决定）**：本记录描述的 `deny` 成为了*绝对上限*（无条件的 `require_approval`）——本条目的其余部分是历史，忠实于修订之前的有效内容。

在项目的容器内，agent 是自由的（ADR 0065）：[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) 的动词允许列表不收敛（发现 Z 和 AD——动词、形式和调用是不同的空间），出路是墙，而不是更长的列表。但有三种效果会穿过墙到达外部世界，而用户的决定原文是：*"agente livre
para o que quiser desde que não seja comandos de git ligado ao deploy e ao PR —
estas ações ainda devem ser humanas"*。

`decide()` 按 token *前缀*识别 `git push`、`git remote add/set-url`、`git merge`、提供方的 CLI（`gh pr create`、`gh pr merge`、`glab mr create/merge`、release 和 workflow dispatch）以及常见的部署命令（`kubectl apply`、`helm
upgrade`、`terraform apply`、`docker push`、`npm publish`、……），忽略中间的全局标志（`git -C /tmp push` 匹配）。复合命令中任何匹配的段都是 **`deny`**——而不是 `require_approval`："始终允许"会把模式写入 `allow`，一次点击就足以让第二扇门永远敞开。`deny` 在任何阶段都胜过 `allow`，并在 `decide()` 中任何宽松阶段*之前*应用。

拒绝并不剥夺 agent 的能力：消息会重定向到*类型化*动作（`git_push`、`git_merge`、`pr_open`）——它以 `proposed_action` 诞生，有自己的最低角色，并在事件日志中记录推送了什么、推送到哪里。这是 dev agent 已经在用的路径（`agent_io.ex` 提议 `git_push`）；变化在于现在由 `deny` 保证，而不只是约定俗成。

- **位置：** `apps/api/src/domain/actions/external-effect.ts`,
  `apps/api/src/domain/actions/decide.ts`（"FRONTEIRA DO CONTAINER" 块）
- **测试：** `apps/api/test/domain/actions/external-effect.spec.ts`,
  `apps/api/test/domain/actions/decide.spec.ts`（describe "a fronteira do
  container"）
- **边界情况：** 边界*不*覆盖受保护分支上的合并锁（RN-014，总是手动），也不覆盖路径范围（RN-095/ADR 0055）——三条规则共存，各自出于不同原因否决。
- **来源：** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-107 — 代码标签页有*第四*种状态：因待定决定而被阻塞 {#rn-107}

[RN-088](../business-rules.md#rn-088) 的三种状态（加载中/错误/空）无法描述
`sem_decisao`（[RN-105](#rn-105)）：它不是加载中（api 已经响应了），不是错误（它*正确地*响应了），也不是空（缺的不是数据——缺的是一个*决定*，那是另一回事）。把 `sem_decisao` 当作"空"会显示一个没有文件的编辑器，引人认为仓库是空的；当作"错误"会让界面建议"重试"一件只有 Arquiteto 能解决的事。

标签页在尝试读取代码*之前*询问容器的状态（`GET /projects/:id/container`），而不是等第一个目录树或文件返回 409——这与 api 已经在 `ReadProjectCodeUseCase` 的漏斗中做的检查（RN-105）相同，只是先问，让第四种状态以自己的消息诞生，而不是作为通用错误的页脚。被阻塞期间，界面每 15s 自行重新查询——镜像一旦决定，没有新的人工操作就不会改变，持续重新查询一个稳定状态，就是 PÓS-FASE 15 那一族的不必要流量。

第四种状态的呈现被*提取*到 `ContainerImageGateNotice`
（`apps/web/src/components/ContainerImageGate.tsx`）——使用中的发现：PR 标签页（`apps/web/src/routes/code/PrListAndDiff.tsx`，由
`ProjectPrsTab.tsx` 和 `CodeDiffPanel.tsx` 使用）调用 `getCodePullRequests`/
`getCodeDiff`，它们经过*同一个*漏斗（RN-105），可能返回*同一个* 409——但与这个标签页不同，它不事先询问。它把这个 409 显示在带"重试"的通用错误横幅中，对一个只有 Arquiteto 能解决的状态来说，这是错误的可供性。`isContainerImageGateError`
（`apps/web/src/lib/api-client.ts`）通过 `status === 409` 识别原因——这是 `ReadProjectCodeUseCase.alvo` 中 `ConflictException` 的唯一原因——，`PrListAndDiff` 在匹配时用 `ContainerImageGateNotice` 替换横幅，没有自己的预检（它对本来就要运行的查询的 409 作出反应）。

- **位置：** `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/web/src/routes/ProjectCodeTab.module.css`,
  `apps/web/src/components/ContainerImageGate.tsx`（共享的呈现），`apps/web/src/routes/code/PrListAndDiff.tsx`（对 409 作出反应的消费者），`apps/web/src/lib/api-client.ts`
  （`isContainerImageGateError`）
- **测试：** `apps/web/src/routes/ProjectCodeTab.test.tsx`（"o gate"），
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`,
  `apps/web/src/routes/ProjectPrsTab.test.tsx`（"o gate do container não é
  erro genérico"）
- **边界情况：** 前端的检查*不*取代 api 的检查——它是 UX 上的便利。如果 api 在 gate 查询与真正读取之间改变了状态，读取路由仍以 409 拒绝（RN-105）；前端只是避免了短暂显示空编辑器的常见情形。PR 标签页不做预检：它在查询已经失败时才发现阻塞，因为那里没有任何目录树/文件会出现代码标签页的预检所避免的那个"空"的瞬间。
- **来源：** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-110 — `blame` 是 `GitProviderContract` 的第 13 个操作，与其他读取使用相同的缺失词汇 {#rn-110}

FASE 26 中声明的 blame 待办事项的基础（还没有界面使用它——在下一波中到来）。`blame(ref, path)` 返回 `GitBlame | null`，`null` 的含义与在 `getFileContent`/
`listTree` 中完全相同：该 ref 中文件缺失，或 ref 不存在。同一个标签页有两种"不存在"的词汇，会让界面以两种方式处理同一种情形——这与之前两个操作已经适用的理由相同。

每个提供方用*自己*的手段计算，因为没有公共端点：GitHub 的 REST 中没有 blame（只有 GraphQL——这是该提供方唯一使用 GraphQL 的操作），GitLab 有 `repository/files/:path/blame`，本地则来自 `git blame --porcelain`，这是三者中唯一在本次会话中针对真实仓库测试过的（另外两个只针对契约测试的假后端——环境中没有 `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN`，针对真实 API 的证明由手动 smoke 完成）。`GIT_BLAME_LINE_LIMIT`（2000）截断真正巨大的文件——在内容路由中已经按字节截断，但 `blame` 在决定之前会从提供方读取整个文件。

- **位置：** `packages/shared/src/index.ts`（`BlameInput`、`GitBlame`、
  `GitBlameLine`、能力 `blame`），
  `apps/api/src/infrastructure/git/{github,gitlab,local}-provider.ts`,
  `apps/api/src/domain/git/git-read-limits.ts`（`GIT_BLAME_LINE_LIMIT`），
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  （方法 `blame`），`apps/api/src/interfaces/http/git/code.controller.ts`
  （`GET /projects/:id/code/blame`）
- **测试：** `apps/api/test/contract/git-provider.contract.ts`（"blame" 块），
  由三个提供方 spec 运行——`local` 的那个针对真实 git——以及 `read-project-code.use-case.spec.ts`（"blame" 块）
- **来源：** FASE 26b（FASE 26/
  [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md) 声明的待办事项的基础）

### RN-111 — `listPullRequests` 是 `GitProviderContract` 的第 14 个操作；可浏览列表按 id 打开同一个 diff {#rn-111}

`CodeDiffPanel.tsx` 在一个可点击的列表中使用 `listPullRequests(state?)`
（id/编号/标题/作者/状态/分支，带按状态的过滤）；点击一项会复用已经存在的*同一个*按 id 的 diff 流程——没有新的读取路径，只是让人*到达* id 而不必记住它。已经知道 id 的人（例如从审批页来的）仍然可以直接粘贴。

`listPullRequests(state?)` 为每个 PR 返回一个*摘要*
（`GitPullRequestSummary`：id、编号、标题、作者、状态、分支、
`updatedAt`）——而不是 `GitPullRequest`，后者是*写入*（打开/合并）的类型，从未有过标题或作者，因为两个操作都不需要。独立的类型避免写入获得只有读取才使用的字段。

`local` *有* PR——Fase 4a 的 sidecar 存储已经是来源，而题述中的假设（"纯本地仓库的概念中不存在 PR"）站不住：自那以后 dev agent 的自包含模式一直在创建本地 PR。三个能力都是 `true`。`GIT_PR_LIST_LIMIT`（100）只有一页，没有后续分页——这是供人浏览的，而不是历史同步。

- **位置：** `packages/shared/src/index.ts`（`ListPullRequestsInput`、
  `GitPullRequestSummary`、`GitPullRequestList`、能力
  `pullRequestsList`），`apps/api/src/infrastructure/git/{github,gitlab,
  local}-provider.ts`，`apps/api/src/domain/git/git-read-limits.ts`
  （`GIT_PR_LIST_LIMIT`），`read-project-code.use-case.ts`（方法
  `pullRequests`），`code.controller.ts`（`GET /projects/:id/code/pull-requests`），
  `apps/web/src/routes/code/CodeDiffPanel.tsx`（可点击列表、按状态过滤、复用按 id 的 diff 流程）
- **测试：** `git-provider.contract.ts`（"listPullRequests" 块），
  `read-project-code.use-case.spec.ts`（"lista de PRs" 块），
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`
- **来源：** FASE 26b

### RN-112 — `listBranchesDetailed` 是*独立*的操作，与 `listBranches` 分开 {#rn-112}

丰富下拉菜单的基础，现在由 `CodeBranchPicker.tsx` 使用
（`ahead`/`behind`、PR 徽章——FASE 26b 之后的那一波关闭了 `CodeShell.tsx` 声明的待办事项）。决定是*不*扩展 `listBranches`——最初的第 13 个操作，Gitflow 的 bootstrap 调用它，而不需要这些：丰富信息的代价是*每个分支*多一次对提供方的调用（GitLab 中是两次，它没有一次调用就返回比较两侧的端点，不像 GitHub 的 `compareCommitsWithBasehead` 和本地的 `git
rev-list --left-right --count`）。把这个代价附加到每次分支的采纳/创建上，会把 bootstrap 变成一次昂贵的扫描。两个操作在契约中共存：`listBranches` 给 bootstrap，`listBranchesDetailed`（第 15 个）给代码标签页——`GitBranchDetail` 只在*形式*上扩展 `GitBranch`，从不在调用者的*契约*上扩展。

`ahead`/`behind` 总是相对于仓库的*默认*分支
（`ListBranchesDetailedInput.defaultBranch`，调用者已经知道——再向提供方要一次，就是为了重新发现已经有的东西而多调用一次）。当提供方无法计算时（孤儿分支、无关的历史），两者都为 `null`，这是诚实的降级，绝不是编造的数字。`GIT_BRANCH_DETAIL_LIMIT`（30）出于 FASE 26 第 34 项同样的流量原因进行截断——没有它，一个有数百个分支的仓库每次打开下拉菜单就会变成数百次调用。

- **位置：** `packages/shared/src/index.ts`（`ListBranchesDetailedInput`、
  `GitBranchDetail`、`GitBranchDetailList`、`GitBranchPullRequestRef`、
  能力 `branchesDetailed`），`apps/api/src/infrastructure/git/{github,
  gitlab,local}-provider.ts`，`git-read-limits.ts`
  （`GIT_BRANCH_DETAIL_LIMIT`），`read-project-code.use-case.ts`（方法
  `branches`），`code.controller.ts`（`GET /projects/:id/code/branches`）；
  在 web 中，`apps/web/src/lib/api-client.ts`（`getCodeBranches`）和
  `apps/web/src/routes/code/CodeBranchPicker.tsx`——下拉菜单本身，从 `CodeShell.tsx` 打开
- **测试：** `git-provider.contract.ts`（"listBranchesDetailed" 块），
  `read-project-code.use-case.spec.ts`（"branches detalhadas" 块），
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`
- **边界情况：** `branches()` 方法位于与其他六个读取*相同*的用例中（`ReadProjectCodeUseCase`），而不是靠近 bootstrap——它是代码标签页的*读取*，具有与其他读取相同的凭据解析和相同的容器闸门（RN-105）；把它当作 bootstrap 的操作会把两者都重复一遍。分支列表之外的 ref（tag 或 sha）仍然可达——下拉菜单的页脚有一个手动输入框，因为 `listBranchesDetailed` 不枚举这两样东西。
- **来源：** FASE 26b（基础）；下一波关闭了 UI

### RN-113 — 编辑器中的 blame 是*按需*的注释——一个开关，绝不嵌入文件读取 {#rn-113}

使用 [RN-110](#rn-110) 基础的 UI 在这里登场：代码标签页的编辑器（`CodeEditor.tsx`）只有在用户打开 "Blame" 开关时才调用 `getCodeBlame`——绝不与文件读取一起调用，后者在打开标签时就会自行触发。原因与组合读取的预算相同（ADR 0060）：blame 是每个打开的文件对提供方的*第二次*调用，接近上限（`GIT_BLAME_LINE_LIMIT`，2000 行）的文件已经昂贵到不应该在每次浏览时免费支付。`truncated`（RN-110 已经暴露）成为可见的提示，与 `fileQuery.data.truncated` 的提示同一模式。

*同一*提交的连续行只在块的*第一*行显示作者和短 sha——在数十行的块中的每一行重复相同的文本是噪音，而不是注释；该行只是从文本中消失，从不从注释中消失（元素的 `title` 在块的任何一行中都保留完整日期和提交摘要）。

- **位置：** `apps/web/src/routes/code/CodeEditor.tsx`,
  `apps/web/src/routes/code/CodeEditor.module.css`
- **测试：** `apps/web/src/routes/code/CodeEditor.test.tsx`
- **来源：** FASE 26b 的 UI 波（blame——丰富的分支下拉菜单和 PR 列表是另外两个 agent 的 UI，没有冲突风险）
