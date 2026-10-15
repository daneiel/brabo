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

### RN-115 — Anamnese 可以被全局暂停；暂停属于*产品*，从不删除数据 {#rn-115}

`ANAMNESE_ENABLED`（engine 的环境变量，布尔，自这条规则起默认 `false`）决定 Anamnese 的*新*一轮是否可以发生——周期性的（`AnamneseSchedulerWorker`）或按需的（`AnamneseCommandController`）。这是用户在 2026-08-10 作出的*产品*决定（"hoje ele não está trazendo
dados de muito valor"），不是 bug——见 docs/explanation/backlog.md。停用时，*没有*任何现有数据被触碰：已经写入的假设、熟练度档案和指令补丁保持完好且可见，*按成员*的退出（RN-025）仍然是一个独立的概念——暂停属于*系统*，而不是个人画像。

`AnamneseSchedulerWorker.kickoff/0`（在启动时调用一次）在停用时*不*安排周期性 job，而不是安排后让 `perform/1` 在每个 tick 空转——更便宜（Oban 队列不会每隔 `ANAMNESE_INTERVAL_SECONDS` 收到一个只为什么都不做的 job），对检查队列的人也更清楚。**2026-08-10 的更正**（执行中的真实发现，而非假设）：这条规则的原始版本刻意让 `perform/1` 无条件执行，使轮次之间的链条不携带开启/关闭的决定——但这意味着在 flag 存在*之前*（或在有人停用它之前）已经安排好的链条会永远自我重新安排，在 flag 为 `false` 的情况下真正运行 Anamnese。这正是在一个比原始 PR 更老的开发 Postgres 中发生的事，通过手动取消已安排的 job 得到补救。`perform/1` 现在在每个 tick 都检查 `enabled?/0`，与 `kickoff/0` 一样：停用时，既不执行 `enqueue_projects/0` 也不重新安排，链条就此终止——这也能*自愈*仍会触发一次的旧 job 的情形，无需人工干预。

`AnamneseCommandController.run/2`（按需路由，设置中的"立即重新分析"）在停用时响应 **503**，正文为 `{"error": "anamnese_desativada"}`——刻意区别于已有的表示"项目没有会话"的空 409（两者在纯 409 中很容易混淆，而它们是截然不同的原因）。api 一侧的 `RunAnamneseUseCase` 把 engine 的 503 转换为正文中带 `reason: "anamnese_disabled"` 的 `ServiceUnavailableException`——绝不是通用的 500，也不是复用的 409。web（`ProjectSettingsTab.tsx`）在第一次点击"立即运行"时发现这个状态（目前没有对全局状态的预先读取），从那以后禁用按钮并在界面上保持解释*可见*——而不只是一个会消失的 toast（RN-088：绝不是无声或令人困惑的失败）。

- **位置：** `apps/engine/lib/engine/workers/anamnese_scheduler_worker.ex`
  （`enabled?/0`、`kickoff/0`），
  `apps/engine/lib/engine_web/controllers/anamnese_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/anamnese/anamnese-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  （`runAnamnese`），`apps/api/src/application/use-cases/anamnese/run-anamnese.use-case.ts`,
  `apps/web/src/routes/settings/ProficiencySection.tsx`
- **测试：**
  `apps/engine/test/engine/workers/anamnese_scheduler_worker_test.exs`
  （停用时 `kickoff/0` 不安排，启用时安排，默认关闭；在链条中途停用时 `perform/1` 不扇出也不重新安排），
  `apps/engine/test/engine_web/controllers/anamnese_command_controller_test.exs`
  （503 区别于 409，有会话和没有会话），
  `apps/api/test/application/use-cases/anamnese/run-anamnese.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`（`ProficiencySection`）
- **边界情况：** flag 是*全局*的（所有项目/workspace），而不是按项目——与并行上限（RN-083）或按区域可继承的模型（RN-102）这些按范围的决定不同。重新开启是
  `ANAMNESE_ENABLED=true` 并重启 engine；UI 中没有这个按钮（这是运维操作，而不是项目偏好）。
- **来源：** 没有 ADR——可逆的产品决定，不是结构性的架构变更。见 docs/explanation/backlog.md。

### RN-117 — Psicólogo 可以被全局暂停；暂停属于*产品*，从不删除数据 {#rn-117}

`PSYCHOLOGIST_ENABLED`（engine 的环境变量，布尔，默认 `false`）决定 Psicólogo 的*新*一轮是否可以发生——自动的（会话关闭，由 `Engine.Outbox.Drain` 路由）或按需的
（`PsychologistCommandController.reanalyze/2`）。这与用户在 2026-08-10 已经应用于 Anamnese 的*产品*决定相同（RN-115，"hoje ele não está
trazendo dados de muito valor"）——不是 bug，见 docs/explanation/backlog.md。停用时，*没有*任何现有数据被触碰：已经发出的分析和假设保持完好且可见。

与 Anamnese 不同（其自动触发器是由 flag 自己决定是否重新安排的周期性 *TICK*），Psicólogo 的自动触发器是会话关闭——`Engine.Outbox.Drain` 只在 `PsychologistWorker.enabled?/0` 为 true 时（`Drain.handlers_for/1`）才把
`session.closed`/`session.closed_abnormally` 路由给 `PsychologistWorker`；停用时只运行 `SessionLifecycleWorker`，Psicólogo 的 job 根本不会诞生。`PsychologistWorker.perform/1` 刻意保持无条件——但它*不再*是与 `AnamneseSchedulerWorker` "相同的模式"（见上面 RN-115 中 2026-08-10 的更正）：在那里 `perform/1` 开始检查 flag，是因为它*自己*在每个 tick 重新安排链条，而一个无条件触发的旧 job 会在 flag 关闭时重新打开 Anamnese。Psicólogo 没有任何会自我重新安排的链条——每个 job 都诞生于*一个*事件（`session.closed`），作决定的是 `Drain` 在*接收*事件的时刻，而不是 worker 在*运行*的时刻；在关闭 flag 之前已经入队的 Psicólogo job 至多是最后一轮待处理的，绝不是无限的链条。这就是为什么 `PsychologistWorker` 已有的测试套件（直接调用 `perform/1`）不需要改动。

`PsychologistCommandController.reanalyze/2`（按需路由，洞察标签页中的"重新分析"）在停用时响应 **503**，正文为
`{"error": "psicologo_desativado"}`，甚至不创建 job。api 一侧的 `ReanalyzeSessionUseCase` 把 engine 的 503 转换为正文中带 `reason: "psychologist_disabled"` 的 `ServiceUnavailableException`——绝不是通用的 500。这在已经存在可重新处理的分析时发现暂停；*没有任何*假设的界面有自己的预先读取，这里原来没有——见 [RN-454](../business-rules.md#rn-454)。

- **位置：** `apps/engine/lib/engine/workers/psychologist_worker.ex`
  （`enabled?/0`），`apps/engine/lib/engine/outbox/drain.ex`
  （`handlers_for/1`），
  `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/psychologist/psychologist-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  （`reanalyzeSession`），
  `apps/api/src/application/use-cases/execution/reanalyze-session.use-case.ts`,
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **测试：**
  `apps/engine/test/engine/outbox/drain_test.exs`（`session.closed` 只在启用时把 Psicólogo 入队），
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  （503 且不创建 job，启用时 202 并有入队的 job），
  `apps/api/test/application/use-cases/execution/reanalyze-session.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **边界情况：** flag 是*全局*的（所有项目/workspace），与 Anamnese 的一样。重新开启是 `PSYCHOLOGIST_ENABLED=true` 并重启 engine；UI 中没有这个按钮。
- **来源：** 没有 ADR——可逆的产品决定，不是结构性的架构变更。见 docs/explanation/backlog.md。

### RN-108 — 会话 socket 要求一次性的不透明 ticket，而不是复用 JWT {#rn-108}

`EngineWeb.SessionSocket.connect/3` 原来只要求 `session_id`（UUID）存在于 Registry 中就允许连接——发现了 UUID 的人就能进入 `session:<id>` 通道，接收该会话的所有实时广播。关闭这一点是自 Fase 3 起就记录在模块本身中的刻意限制。

`POST /projects/:projectId/sessions/:sessionId/socket-ticket`（`scope:
"heartbeat"|"terminal"`）签发一个不透明 ticket（32 字节 CSPRNG，
`TokenFactory`），TTL **30 秒**，一次性。`scope: "heartbeat"` 要求角色 `viewer`；`scope: "terminal"` 要求 `developer`——与 `domain/actions/decide.ts` 中 `MIN_ROLE_FOR_ACTION_TYPE.terminal` 相同的最低角色（目前没有任何路径真正请求 `terminal`；这个值为 FASE 25 的交互式终端正确地诞生）。api 只持久化*哈希*（**纯** SHA-256，而不是 `hashDeToken`/HMAC——engine 没有 api 的 pepper，而一个 256 位的 CSPRNG token 不需要 pepper 来防御字典攻击，与 `hashDeToken` 自己记录的推理相同），从不持久化原始 token。

消耗属于 *ENGINE*，它直接读取 `session_socket_tickets`（与 `Engine.Outbox.Event` 对 `outbox_events` 的模式相同——绝不是 changeset/insert，只有一次性所需的窄写入），分*两*步：
`SocketTicket.validar/1`（窥视，不标记任何东西——由 `connect/3` 调用，它还不知道将请求哪个 `session_id`）和
`SocketTicket.consumir/2`（条件 `UPDATE`，要求主题的 `session_id` 与该行一致——由 `SessionChannel.join/3` 调用，它还会对照会话的 `project_id` 检查 ticket 的 `project_id`，纵深防御，防止一个项目的 ticket 打开另一个项目的通道）。没有 ticket，或 ticket 无效：整个连接被拒绝（`{:error, %{reason:
"unauthorized"}}`），而不只是通道的 join。

web（`session-channel.ts`）在*每次* `socket.connect()` 之前都获取一个*新* ticket——包括自动重连，它确实存在。`Phoenix.Socket` 的原生重连会复用构造时的同一个 `params`（旧 ticket，已经过期或被消耗），因此它被中和（`reconnectAfterMs` 几乎永不触发），重连完全变为手动，每次尝试都获取新的 ticket。

这种中和适用于 socket 的*每个*客户端，而不只是 web 的——包括 `/runner` socket，它的 ticket（`POST .../runner-ticket`）是同一口径。它在仓库四个 `Socket` 构造器中的*两个*里失败了，代价在真实执行中被测量：`apps/runner/src/
channel.ts` 构造 socket 时没有这个选项——而模块的 docblock 却*声称*重连"因此被中和"——自动重连每 **~5.13s**（phoenix.js 内部退避的上限）重复同一个已被消耗的 ticket，几个小时内产生 **61 次 `REFUSED CONNECTION TO
EngineWeb.RunnerSocket`**。再加上 runner *自己*的策略（`index.ts`，这个是正确的），结果是**一分钟 530 个请求**，而 `RATE_LIMIT_USER` 的上限是 300——由于限制是按*用户*的，429 出现在账户所有者的*浏览器*中。两个后果，第二个比 429 更糟：处于这个循环中时 runner *没有*连接，因此 `RunnerReadiness`（RN-507）会拒绝，项目看起来"没有本地 agent"。`apps/web/src/lib/fs-browser-channel.ts` 有*同样*的缺陷行（同样的一次性 ticket，且没有自己的重连策略——它的 `onClose` 说"关闭再重新打开"），一并修正。

阻止第三个实例的是*机制*，而不是注释：在 runner 中，`Socket` 的选项变成了一个 `reconnectAfterMs` *必填*的类型（`channel.ts` 中的 `OpcoesDoSocket`），两侧都增加了断言*传给*构造函数的*选项*的测试——一个只检查"能连上"的测试在缺陷存在时也会通过，而且确实通过了。同时，`conectarERodar`（`index.ts`）开始显式*丢弃*掉线的连接（`conexao.desconectar()`）：没有这一点，上一轮的 `Socket` 会在下一轮创建后继续存活，每次掉线都会多留下一个用失效 ticket 尝试的存活对象。

- **位置：** `apps/api/src/db/schema/sessions.ts`（`sessionSocketTickets`），
  `apps/api/src/domain/sessions/socket-ticket-scope.ts`,
  `apps/api/src/application/use-cases/sessions/create-socket-ticket.use-case.ts`,
  `apps/api/src/interfaces/http/sessions/sessions.controller.ts`（路由
  `socket-ticket`），`apps/engine/lib/engine/sessions/socket_ticket.ex`,
  `apps/engine/lib/engine_web/channels/session_socket.ex`,
  `apps/engine/lib/engine_web/channels/session_channel.ex`,
  `apps/web/src/lib/session-channel.ts`,
  `apps/web/src/lib/fs-browser-channel.ts`,
  `apps/runner/src/channel.ts`（`OpcoesDoSocket`、
  `NUNCA_RECONECTAR_SOZINHO_MS`），`apps/runner/src/index.ts`
  （`conectarERodar`，掉线连接的丢弃）
- **测试：**
  `apps/api/test/application/use-cases/sessions/create-socket-ticket.use-case.spec.ts`,
  `apps/api/test/domain/sessions/socket-ticket-scope.spec.ts`,
  `apps/api/test/infrastructure/persistence/session-socket-ticket.repository.spec.ts`,
  `apps/engine/test/engine/sessions/socket_ticket_test.exs`（复用失败、session_id 错误失败、并发竞争只有一个胜出），
  `apps/engine/test/engine_web/channels/session_socket_test.exs`（没有 ticket 时连接被拒绝），
  `apps/engine/test/engine_web/channels/session_channel_test.exs`（另一个项目的 ticket：join 失败），`apps/web/src/lib/session-channel.test.ts`,
  `apps/runner/src/channel.spec.ts`（"neutraliza o auto-reconnect do
  Phoenix.Socket — ticket de uso único nunca é repetido"；断言传给构造函数的*选项*，没有它则失败），
  `apps/web/src/lib/fs-browser-channel.test.ts`（同样的断言，用于文件夹浏览器经由 runner 的传输）
- **边界情况：** ticket *不是*复用的 JWT——短 TTL、一次性、封闭的范围，并且诞生于一条已经检查有效角色的专门路由，而不是解码现有的 access token。
- **来源：** 没有 ADR——单点的提取/加固，不是结构性变更。

### RN-109 — workspace 的文件夹名在创建时冻结，旧项目保留 UUID {#rn-109}

项目在 `PROJECT_WORKSPACES_ROOT` 中的物理文件夹原来是纯 UUID——在磁盘上打开时无法辨认。`projects.workspace_dir_name`（NOT NULL，UNIQUE）开始保存真正的名称：*新*项目为 `<slug>-<id 的 8 个字符>`（`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts` 中的 `workspaceDirNameFor`），在代码中生成——id 来自 `CreateProjectUseCase` 中的 `crypto.randomUUID()`，而不是 Postgres 的 `defaultRandom()`，因为文件夹名在插入*之前*就需要 id。8 个字符遵循与会话标签相同的约定（`apps/web/src/lib/session-label.ts`）。

名称在创建时*冻结*，从不重新计算：`UpdateProjectUseCase` 允许之后编辑 `slug`，而这*不*触碰 `workspace_dir_name`——重新安排物理文件夹（其中可能有打开的工作树和 agent 的 worktree）是真实的风险，这个决定在构造上避免了它，而不是靠调用者的自律。

在这次迁移（0042）*之前*创建的项目保留它已有的物理文件夹：回填为每个现有行写入 `workspace_dir_name = id`——与磁盘上本来就为真的值相同——并且*从不*重命名任何目录。一个 `BEFORE INSERT` 触发器（`projects_workspace_dir_name_default_trg`）对任何不带该字段的插入应用*相同*的回退（`id::text`）——这是给忘记写入它的人的安全网（绝不是主路径，主路径总是显式写入），也是让几十个不知道这个概念的现有测试 fixture 无需逐个重写就能继续工作的原因。

从名称推导路径（`projectScopeRoot`，RN-092/RN-075）开始接收 `workspace_dir_name`，而不是原始的 `projectId`——同样的字符集校验，同样的纯粹性。engine 读取*同一*列（`Engine.Projects.Project.workspace_dir_name/1`）来解析
`Engine.Actions.Workspace.workspace_dir/1`，从不根据 id 重新计算名称：两种推导（api 和 engine）实际上是针对同一数据库的同一读取——这保证了 RN-075（终端范围）和 RN-092（代码读取）继续指向 engine 真正使用的*同一个*文件夹。

- **位置：** `apps/api/src/db/schema/iam.ts`（`projects.workspaceDirName`），
  `apps/api/src/db/migrations/0042_tough_captain_midlands.sql`,
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  （`workspaceDirNameFor`、`projectScopeRoot`），
  `apps/api/src/application/use-cases/iam/create-project.use-case.ts`,
  `apps/engine/lib/engine/projects/project.ex`
  （`workspace_dir_name/1`、`all_workspace_dirs/0`），
  `apps/engine/lib/engine/actions/workspace.ex`（`workspace_dir/1,2`），
  `apps/engine/lib/engine/dev/worktree_cleanup.ex`
- **测试：**
  `apps/api/test/db/workspace-dir-name-migration.spec.ts`（触发器、等价回填、唯一性），
  `apps/api/test/application/use-cases/iam/create-project-semeia-areas.spec.ts`
  （`workspaceDirName` 以 `<slug>-<8 chars>` 诞生，不同 workspace 中 slug 相同的两个项目文件夹不冲突），
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **边界情况：** 并行上限和合并 gate 不变——RN-109 只是文件夹的*名称*，绝不是策略。创建后重命名 slug 不会重命名文件夹；文件夹只通过已写入的 `workspace_dir_name` 读取。
- **来源：** ADR 0066（修订 ADR 0055）。

### RN-129 — ToolLoop 从不写入空的 `agent.response`；传输失败成为持久的 `agent.error` {#rn-129}

[RN-059](../business-rules/custo.md#rn-059) 为四个对话型 agent 堵住了空气泡，但它们不经过 `Engine.Harness.ToolLoop`——每个都在自己的模块中调用 `EngineApiClient.llm_turn_stream/6`。`ToolLoop`（由 dev agent、QA Automação/Performance-Segurança、Infra-Workflows、Anamnese 和 Psicólogo 使用）在另一条路径上有*同样*的缺陷：它在每次迭代时发出 `agent.response`，即使模型只调用了工具而没有文本，或者结束回合而什么都没产生——而传输失败（提供方宕机、超时）会变成缺少 `content` 的 `agent.response`，同样与成功无法区分。

在一次真实执行会话（dev agent）中实时发现：两个带有 RN-059 兼容文本（"resposta vazia — evento anterior..."）的气泡出现在几分钟前创建的会话中——它们不是旧事件，而是同一缺陷再次发生，只是在执行标签页中。

两项修正，位于每个 `ToolLoop` 消费者共有的*结构性*位置，而不是逐个模块：

1. **空内容绝不会变成 `agent.response`。** 只调用了工具的迭代已经由 `tool.call`/`tool.result` 叙述；什么都没产生的迭代（既没有文本也没有工具调用）把结果留给调用循环的人决定——`ctx.last_error`/`{:ok, ctx}` 携带信息，消费者（例如 `DevAgentServer.handle_outcome/4`）已经写入*自己*领域的持久事件（`dev.blocked`，带 `origem`）。
2. **传输失败成为持久的 `agent.error`**，带 `origem`（`Engine.Agents.FalhaDeTurno.origem/1`——四个对话型 agent 使用的*同一个*辅助函数，不重复分类）和葡萄牙语的 `mensagem`——再也不会有缺少 `content` 的 `agent.response`。

- **位置：** `apps/engine/lib/engine/harness/tool_loop.ex`（`loop/1`、
  `emit_falha/2`）
- **测试：** `apps/engine/test/engine/harness/tool_loop_test.exs`
  （"iteração só com tool call (sem texto) não grava agent.response vazio"、
  "modelo termina o turno sem texto e sem tool call..."、"falha de
  transporte... grava agent.error durável com origem"）
- **来源：** RN-059（本规则扩展的规则）——在有 dev agent 的真实执行会话中实时发现

### RN-139 — 执行者标签页读取*现行*的执行会话，绝不是项目最近的会话 {#rn-139}

`ProjectExecutorsTab` 原来按 `useLatestSession` 返回的会话获取 dev agent/QA 的事件——项目中 `createdAt` 最新的会话，不按 `kind` 过滤，也不要求 `execution.activated`。它之所以能工作只是**巧合**：执行会话通常是最新的。一旦有任何会话在它之后诞生——一次新的构思、一次咨询性聊天——标签页就会悄无声息地开始查看这个没有执行事件的新会话：界面上没有任何线索说明显示的是哪个会话。

正确的读取在后端已经存在：`findActiveExecutionSession`
（`SessionRepository`）——带有 `execution.activated` 的最近 `active` 会话——但它只在内部被 `ActivateExecutionUseCase` 用来决定是重新激活还是创建。修正通过 HTTP 暴露*同一*标准，而不是在前端重复它：

- **`GET /projects/:projectId/execution/session`**（`role:viewer`）返回现行会话或 `null`——从不根据最新的去推断；
- `ProjectExecutorsTab` 把 `useLatestSession` 换成 `useActiveExecutionSession`
  （基于上述路由的新 hook），作为整个标签页读取的会话来源；
- 标签页头部总是显示正在显示*哪个*会话——它的标签（hashtag + 名称）链接到 `SessionPage`，或在 `null` 时显示"没有活跃的执行"——再也不是隐含的。[RN-088](../business-rules.md#rn-088) 的三种状态适用于会话本身的获取：加载中、错误（带 `trace_id`）和空（`null`）是三种不同的渲染，绝不是把它们合并的 `if (!sessão) return null`。

- **位置：**
  `apps/api/src/application/use-cases/execution/get-active-execution-session.use-case.ts`,
  `apps/api/src/interfaces/http/execution/execution.controller.ts`（`getSession`），
  `apps/web/src/lib/hooks.ts`（`useActiveExecutionSession`），
  `apps/web/src/routes/ProjectExecutorsTab.tsx`
- **测试：**
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx`——即使项目中存在更新的会话也显示执行会话，显式的"没有活跃的执行"状态，以及网络错误得到处理（不是空白）
- **来源：** 代码调查中的发现 + 实时测试——与 RN-088 为 429 关闭的同一类缺陷，现在针对的是"界面在看哪个会话"

### RN-141 — `read_file` 读取的内容同样有字节上限 {#rn-141}

[RN-074](../business-rules/custo.md#rn-074) 让*终端*的输出免于
`{413, "request entity too large"}`，却通过 `read_file` 留下了同一扇门：它读取*整个*文件，没有上限，这些内容进入循环的历史并在之后的每个回合中传输。一个带有大文件（lockfile、bundle、生成的文件）的 PR 就足以卡住 dev agent *和* Performance/Segurança 的 QA——后者只有 `ReadFile`/`SearchWorkspace`（刻意没有 `Terminal`）来调查 PR，因此当文件太大时它没有任何出路。

内容在成为工具结果之前被截断到 `READ_FILE_MAX_BYTES`（默认 32 KiB，与 RN-074 的值相同是出于上下文的巧合，而不是耦合——两个变量是独立的），并带有说明文件和两个大小的标记：

```
[arquivo package-lock.json truncado: mostrando 32768 de 1048576 bytes. Use
search_workspace para localizar um trecho específico em vez de reler o
arquivo inteiro.]
```

与 RN-074 相同的三个性质（上限是 `>` 而不是 `>=`；截断不切开多字节字符；标记是写给模型的，说明该怎么做）。截断位于*工具*中（`Engine.Harness.Tools.ReadFile`），而不在
`Engine.Harness.WorkspaceFiles.read_file/2` 中——后者是通用的文件访问基础，由 `write_file`/`search_workspace` 共享，在那里截断会切掉不需要这个上限的调用者的内容。

`search_workspace` 没有得到同样的处理：它只返回匹配的*路径*（`matched_content` 是布尔值），从不返回文件内容——促成这条 RN 的溢出向量不适用于它。

- **位置：** `apps/engine/lib/engine/harness/tools/read_file.ex`
  （`truncate/2`），上限在 `apps/engine/config/runtime.exs`
  （`read_file_max_bytes`）
- **测试：** `apps/engine/test/engine/harness/tools/read_file_test.exs`
  （describe `teto de bytes do conteúdo`）
- **来源：** 在一次真实执行的事件日志中实时发现——一个项目的 4 个 dev agent 和 Automação/Performance-Segurança 的 QA 都被 `{413, "request entity too large"}` 阻塞，与 RN-074 同一根因，不同的门

### RN-144 — Criativo 标签页不列出现行的执行会话 {#rn-144}

接收 `execution.activated` 和 dev agent 工具调用事件的会话必须以 `kind: 'criativa'` 诞生——这是结构性规则（RN-097，
`garantirQuePodeAtivarExecucao`），否则事件会被拒绝。由于 `ProjectSessionsTab`（Criativo 标签页，RN-104）列出会话时只按 `session.kind === 'criativa'` 过滤，执行会话会*混在*列表中，与真正的构思并列——在 `SessionPage.tsx` 中打开它会显示一整条 dev agent 工具调用的时间线，在用户看来就像"dev 在 Criativo 的聊天里写东西"。已实时确认：一个带有 35 个以上 dev agent 事件的真实会话正常出现在列表中，与真实的构思会话并列。

修正复用 [RN-139](#rn-139) 已经暴露的信号——
`useActiveExecutionSession`/`GET /projects/:projectId/execution/session`——而不是让后端为每个会话计算一个新字段（`hasExecutionActivated` 或类似的）。Criativo 标签页获取现行会话，并将其从渲染的列表中排除：

- 获取只在 Criativo 标签页运行（在 `kind !==
  'criativa'` 时 `enabled` 关闭）——聊天标签页从未做过这个调用，现在也不做；
- 过滤按 `id` 进行，位于已有的按 `kind` 过滤之后——它不改变列表*是*什么，只改变它*排除*什么。

**刻意的范围决定：** 这只覆盖*现行*的执行，而不覆盖已经结束的*旧*执行（在今天处于 `closed` 的会话中写入的 `execution.activated`）。计算这一点需要后端为每个会话标注是否写入了该事件——仓储和列表端点的变更，针对一个残余情形：*旧*执行会话带着 `closed` 徽章出现，这已经以比现行会话（原来显示为 `active`，与进行中的构思无法区分）少得多的歧义表明"这不是活跃的构思"。如果这在实践中再次造成困惑，出路是列表端点为每个会话返回该信号——而不是在前端为旧会话再加一个 `filter`。

- **位置：** `apps/web/src/routes/ProjectSessionsTab.tsx`
  （`ProjectSessionsTab`）
- **测试：** `apps/web/src/routes/ProjectSessionsTab.test.tsx`——现行会话从 Criativo 列表中消失而正常会话仍在旁边，聊天标签页不调用现行执行的获取，没有现行执行（`null`）时列表完整显示
- **来源：** 代码调查中的发现 + 实时测试——带有活跃执行的真实会话混在 Criativo 标签页中

### RN-145 — Arquiteto 也有就绪按钮，*同一次*确认同时提供给 Infra 和 Dev Lead {#rn-145}

`OfferInfraHandoffUseCase`（`POST .../agents/arquiteto/handoff-infra`）自 Fase 4a 起就已存在——写入 `architecture.readiness_confirmed` 并调用 engine，后者向 Infra 提供 handoff，并在*同一次*确认中向 Dev Lead 提供（FASE 14d/ADR 0053）。缺少的是到达它的途径：前端没有任何地方调用这个端点。"确认架构就绪"按钮对 Criativo 来说一直都有（"我准备好产出了"，
[RN-131](../business-rules.md#rn-131)/[RN-142](../business-rules.md#rn-142)）——Arquiteto 没有任何等价物，没有这次点击 handoff 就永远不会诞生：消息流中卡片优先级的修正（[RN-125](../business-rules.md#rn-125)）没有实际效果，因为没有东西可以显示。

`arquitetoActive` 对应 `criativoActive`（此会话中存在 Arquiteto 的 `agent.activated`），`arquiteturaJaDeclarada` 对应
`prontidaoJaDeclarada`（存在*任何*从 Arquiteto 发出的 handoff——确认已经发生的证据，因为 `OfferInfraHandoffUseCase` 在同一次调用中至少创建给 Infra 的那个）。按钮只在前者为真、后者为假时出现在输入框中——点击后消失，理由与 Criativo 的按钮在就绪后消失相同。

与 Criativo 不同，Arquiteto *没有*在缺少 `module_map` 时阻止确认的服务器护栏——`ArquitetoServer.offer_infra_handoff` 不拒绝任何东西，这与 `CriativoServer.confirm_readiness`（[RN-142](../business-rules.md#rn-142)）不同。按钮只在 `streaming` 期间禁用；不在这里复制概览页的 `disabled={!hasModuleMap}` 是刻意的决定，理由与 Dev Lead 卡片上的"激活执行"（[RN-137](../business-rules.md#rn-137)）已经适用的相同——当这张卡片存在时，Arquiteto 已经决定了架构。

- **位置：** `apps/api/src/interfaces/http/agents/agents.controller.ts`
  （`handoffInfra`，已有路由），`apps/web/src/lib/api-client.ts`
  （`confirmArchitectureReadiness`），`apps/web/src/routes/SessionPage.tsx`
  （`arquitetoActive`、`arquiteturaJaDeclarada`、`handleArchitectureReadiness`、
  "确认架构就绪"按钮）
- **测试：**
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`，describe
  "problema 1"——没有活跃 Arquiteto 时没有按钮，正常路径调用专用端点，失败时显示错误 toast，架构已声明后按钮消失
- **来源：** 代码调查——端点和 engine 的逻辑自 Fase 4a/14d 起就存在，却*没有任何* UI 路径通往它们

### RN-146 — `agent.response` 携带生成该响应的模型名称 {#rn-146}

模型名称原来只存在于 `token_usage` 中，与它所产生的具体 `agent.response` 事件没有关联——`SessionPage.tsx` 在 agent 名称旁显示*固定*字符串 `"modelo"`，从不显示真实名称。

变更贯穿三层，都使用*同一个*字段名（`modelName`），因此无需在它们之间转换：

1. **api**——`StreamLlmTurnUseCase`/`RunLlmTurnUseCase` 本来就为调用提供方而解析模型（`resolveModelBinding` → `models.findById`）；`final` 帧/`RunLlmTurnResult` 新增 `modelName: string |
   null`。只有当回合在解析出模型*之前*失败时（没有 binding，或 binding 指向不存在的模型）才为 `null`——其他情况下，包括预算超支，binding 已经解析完成，名称即使在错误帧中也会传输。
2. **engine**——四个对话型 agent（`criativo_server.ex`、
   `po_server.ex`、`arquiteto_server.ex`、`dev_lead_server.ex`）从 `final` 帧中提取 `Map.get(frame, "modelName")`，并把它放进
   `emit_response`/`agent.response` 的 payload（`%{content: content, modelName:
   model_name}`）。
3. **web**——`SessionPage.tsx` 读取 `event.payload.modelName`。在这次变更之前*写入*的事件没有这个键（`undefined`），而 api 没有解析出任何模型的回合会写入 `null`——两者都降级为通用标签 `"modelo"`，绝不会在界面上显示 `undefined`/`null`；与 `text === ''` 已经用于 RN-059 之前的响应的模式相同。

- **位置：** `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`
  （`LlmTurnStreamEvent`），`apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
  （`RunLlmTurnResult`），`apps/api/src/interfaces/http/internal/dto/internal.response.dto.ts`
  （`LlmTurnResponseDto`/`LlmTurnStreamEventResponseDto`），
  `apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  （`emit_response/3`），`apps/web/src/routes/SessionPage.tsx`（时间线的
  `agent.response` 块）
- **测试：** `apps/api/test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `apps/api/test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`
  （正常路径、提供方错误和没有 binding 时的 `modelName`），
  `apps/engine/test/engine/agents/{criativo,po,arquiteto,dev_lead}_server_test.exs`
  （`agent.response` 携带模型名称；没有该键的帧这一边界情况），
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`，describe
  "problema 2"——真实名称、没有该键的旧事件、`modelName: null`
- **来源：** 代码调查——确认数据已经存在于 `token_usage` 中，却从未到达事件的 payload

### RN-147 — 折叠分组的头部显示 agent 的图标，而不只是名称 {#rn-147}

`timelineAgrupada`（[RN-138](../business-rules.md#rn-138)）的 `Disclosure` 在 `titulo` 中只接收名称*字符串*——每条展开的消息都已经有头像（`.avatar` + 图标），而折叠的头部恰恰在最有助于扫视消息流的地方丢失了这个视觉线索。

`AvatarDoAgente` 复用与展开消息*相同*的 `.avatar` 框，但选择的图标是*名册*中的（`AGENTS[id].icon`）——与已经在流式指示器中识别"谁在说话"的同一来源（`agenteExibido.icon`，
[RN-131](../business-rules.md#rn-131)）——而不是每个展开条目使用的按事件*类型*的图标（`agent.response` 中的 `ModelIcon`、`backlog.*_created` 中的 `StackIcon`、`agent.error` 中的 `AlertCircleIcon`）。一个折叠分组可能混合同一 agent 的这些类型的条目；头部代表的是 *AGENT*，而不是它的最后一个条目，只有名册图标对此是稳定的。没有 `id`，或者 agent 不在名册中时，降级为 `ModelIcon`——绝不是空框。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`AvatarDoAgente`、
  `timelineAgrupada`），`apps/web/src/routes/SessionPage.module.css`
  （`.agentGroupTitulo`）
- **测试：** `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`，
  describe "problema 3"——折叠的头部带有 PO 图标（`UserIcon`）的 PATH，而不只是一个通用的装饰性 SVG
- **来源：** 代码调查——`Disclosure` 本来就在 `titulo` 中接受 `ReactNode`；缺的是把头像与名称一起传入

### RN-148 — 同时待晋升的故事变成轮播，而不是 N 张卡片 {#rn-148}

PO 一个接一个地创建故事，每个 `backlog.story_promotion_proposed`
（[RN-126](../business-rules.md#rn-126)）都会在时间线上变成一张单独的卡片——在一批多个故事中，这会堆叠 N 张相同的卡片争夺同一空间，与其余叙述混在一起。

一**批**是会话中*仍然待定*的晋升提议的集合，在每次渲染时评估——而不是"连续不间断地创建的"。标准与每张单独卡片本来就独自用来决定自己是变成可操作卡片还是分隔线的*相同*（之后没有相同 `storyId` 的 `backlog.story_transitioned`/`backlog.story_promotion_returned`），只是对整个会话一次性地查看：

- **0 或 1 个待定：** 什么都不变——一如既往的单独卡片（降级是刻意的：只有一张幻灯片的轮播变成轮播毫无收益）。
- **同时 2 个以上待定：** 变成*一个* `Carousel`（设计系统中的新组件，`apps/web/src/components/ui/Carousel.tsx`），插在*第一个*仍待定提议的位置；其余的作为单独卡片消失——每一个都成为它的一张*幻灯片*。每张幻灯片显示与单独卡片相同的句子（"故事……已就绪，等待你的晋升"），payload 带有时显示摘要/RF（目前没有——见下文），以及该特定故事的晋升/退回按钮，调用一如既往的*同一个*
  `promoteStories`/`returnStory`。
- 轮播头部的**"全部批准"**在一次调用中用*所有*待定项的 id 调用 `promoteStories`——端点本来就是批量的
  （`promoteStories(projectId, storyIds[])`，RN-048），因此契约没有任何变化，只是改变了由谁组装列表。
- 在轮播打开时被解决（晋升或退回）的故事会在下一次渲染时离开这一批（两个动作都会使事件查询失效）——如果只剩 1 个待定，轮播会自行解散，卡片恢复为单独卡片。

幻灯片中的 `resumo`/RF 是*已就绪*但未被使用的字段：`CreateStoryUseCase` 目前只在 `backlog.story_promotion_proposed` 的 payload 中写入 `storyId`/`epicId`/`title`——没有描述，也没有功能需求。幻灯片已经知道在 payload 有一天携带 `description`/`rf` 时显示它们（在那之前降级为只显示标题）；扩展 payload 不在本次交付之内，因为没有人要求。

- **位置：** `apps/web/src/components/ui/Carousel.tsx`（新组件，通用导航），`apps/web/src/routes/SessionPage.tsx`
  （`promocoesPendentes`、`ehLevaDeHistorias`、`StorySlide`、
  `handlePromoteAll`），`apps/web/src/routes/SessionPage.module.css`
  （`.storySlide`）
- **测试：** `apps/web/src/components/ui/Carousel.test.tsx`（导航、ARIA、只挂载当前幻灯片、列表缩短时索引被钳制），
  `apps/web/src/routes/SessionPage.carrossel-historias.test.tsx`（3 个以上待定变成轮播；"全部批准"发送整批；从导航到的幻灯片进行单个晋升和退回仍然有效；1 个待定降级为简单卡片；被解决的故事离开这一批，轮播重新计算数量）
- **来源：** 用户的请求——PO 批量产出的故事在消息流中很难一个一个地决定

### RN-149 — C4 图的 Container 层级从 module_map 推导，绝不由模型重新键入 {#rn-149}

`create_c4_diagram`（Arquiteto 的新工具）生成 C4 图的两种 Mermaid 语法（Context + Container，Simon Brown 的模型）。工具调用只携带 `system_name`/`system_description`/`actors`——Container 层级的模块和依赖*不*属于输入：用例获取项目的*现行* `module_map`（`ModuleMapRepository.findCurrent`，与 `GetArchitectureUseCase` 相同的读取），并从中推导 Container 层级，使用 `create_module_map` 已经校验为无环的*相同*名称和依赖。

显而易见的替代方案——让模型在图的工具调用中再次描述模块，就像它已经为 `create_module_map` 做的那样——被刻意否决：模型写下"模块是 X、Y、Z"的第二个地方，就是这个列表可能与第一个分歧的第二个地方，而分歧会是*无声*的——没有任何东西会拒绝一张带有真实映射中已不存在的模块的图。从仓储推导在构造上关闭了这种分歧：如果 `module_map` 之后发生变化，图可能*过时*（重新发出就是重新生成，没有锁——见 ADR 0068），但它永远不会就生成时存在的东西*撒谎*。

没有现行 `module_map` 时，`create_c4_diagram` 以 400 被拒绝——没有模块可画就没有 Container 层级，错误消息会指示 Arquiteto 先调用 `create_module_map`（RN-061：拒绝通过工具结果返回，带着完整的原因）。

`artifact.c4_diagram` 工件在事件日志中带版本，没有自己的表——与 `artifact.project_image`（ADR 0065）的设计相同：现行的是 `version` 最大的，修订就是重新生成，绝不覆盖。

- **位置：** `apps/api/src/domain/architecture/c4-diagram.ts`
  （`gerarDiagramaContexto`/`gerarDiagramaContainer`，纯函数），
  `apps/api/src/application/use-cases/architecture/create-c4-diagram.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/get-c4-diagram.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_c4_diagram.ex`,
  `apps/web/src/components/C4DiagramView.tsx`（渲染，三种状态——
  RN-088），`apps/web/src/lib/mermaid-render.ts`（`mermaid` 被隔离在这里，动态 `import()`）
- **测试：** `apps/api/test/domain/architecture/c4-diagram.spec.ts`（从示例 `module_map` 生成有效的 Mermaid 语法，忽略悬空边，id 去重），
  `apps/api/test/application/use-cases/architecture/create-c4-diagram.use-case.spec.ts`
  （没有 module_map 时以 400 拒绝且不写入任何东西；Container 反映真实的模块/依赖；重新发出时版本化），
  `apps/engine/test/engine/harness/tools/create_c4_diagram_test.exs`,
  `apps/web/src/components/C4DiagramView.test.tsx`（成功变成 SVG，语法错误变成可读的 Alert 而不破坏界面，空图不尝试渲染）
- **来源：** 用户的请求——在项目概览中显示 Arquiteto 的 C4 图（ADR 0068）

### RN-150 — `search_workspace` 有命中*数量*上限和*字节*上限，各自带有标记 {#rn-150}

在一次 PR 审查中发现：`search_workspace`（dev agent 以及两个 QA/gate agent，`qa_tools.ex` 和 `qa_performance_seguranca_agent.ex`——后者只有 `read_file`/`search_workspace`，刻意没有 `Terminal`）返回*全部*搜索结果，没有任何上限——与发现 S（`Engine.Actions.TerminalExecutor.truncate/2`）以及 `read_file` 的修正（`Engine.Harness.Tools.ReadFile.truncate/2`）同类：结果留在循环的历史中并在之后的每个回合中传输，一棵大目录树就足以触发提供方的 `{413, "request entity too large"}`。

两个独立的上限，因为搜索会以两种不同方式溢出：

1. **命中数量**——一棵有数千个文件匹配搜索词的树会产生数千行 `- caminho`，即使没有任何单个文件很大。只在最后按*字节*截断，仍然要付出扫描并读取每个文件内容然后再组装字符串的代价。因此数量上限（`SEARCH_WORKSPACE_MAX_HITS`，默认 500）位于 `WorkspaceFiles.search/3` 中，它一旦找到足够的命中就*停止*消费搜索——流水线运行在 `Stream` 上，`Enum.take(stream, max_hits + 1)` 只从源头读取产生前 `max_hits + 1` 个结果所需的东西。"+1"使得可以说明*还有*更多，而不必继续扫描其余部分来计算准确总数——计算总数会再次付出上限要避免的 I/O，因此标记说"显示前 N 个"，从不编造总数。
2. **最终文本的字节数**——即使命中受限，非常长的路径也可能产生大字符串。字节上限（`SEARCH_WORKSPACE_MAX_BYTES`，默认 32,768），与 `terminal_output_max_bytes`/`read_file_max_bytes` 同一模式——*独立*的变量，不复用另外两个：同一类溢出，改动其中一个不应该需要触碰其他的。

截断标记是写给*模型*的，而不是给人的：它说明截断了什么（命中和/或字节），并指示细化搜索词——与 `TerminalExecutor`/`ReadFile` 标记的精神相同。

- **位置：** `apps/engine/lib/engine/harness/workspace_files.ex`
  （`search/3`、`take_capped/2`），
  `apps/engine/lib/engine/harness/tools/search_workspace.ex`
  （`truncate/3`、`marca_de_truncagem/5`），
  `apps/engine/config/runtime.exs`（`search_workspace_max_hits`、
  `search_workspace_max_bytes`）
- **测试：** `apps/engine/test/engine/harness/workspace_files_test.exs`
  （带 `max_hits` 的 `search/3` 截断*数量*，只有在多于上限时才标记截断），
  `apps/engine/test/engine/harness/search_workspace_test.exs`（结果少的搜索不被改变；命中多于上限的搜索被截断并给出清楚的提示；大于字节上限的最终文本也被截断）
- **来源：** PR 审查中的发现——审查中 413 的第二个真实原因，在 `read_file` 修正之后

---

### RN-151 — 侧边栏中的项目徽章是待批准数，而不是未读活动 {#rn-151}

`Shell.tsx` 中每个项目名称旁边的数字原来来自 `useProjectsUnread`——`latestSeq`（会话中已写入的最新 `seq`）减去浏览器在 `read-state.ts` 中保存的"上次查看"游标。这计算的是*任何*新事件——`tool.call`、`agent.response`、聊天——而不只是待定的决定。一个测试项目在侧边栏中显示"392"（一次真实执行累积的活动），而*同一*项目的审批标签页显示"8"（真实的计数）。一个点击后与任何可操作之事都对应不上的数字，比没有数字更糟。

仪表板的读模型（`ProjectsSummaryRepository.summarizeForWorkspace`，
RN-090）新增了 `pendingApprovalsCount`：对 `status = 'pending'` 的 `proposed_actions` 执行 `COUNT(*)`，按 `project_id` 聚合，作为已有 `Promise.all` 中多出的一次查询——与 `storiesAwaitingPromotion`（RN-048）相同的形式，不增加每个项目访问数据库的次数。汇总的是*整个*项目的所有会话——刻意与审批标签页（`ProjectApprovalsTab.tsx`）不同，后者只显示*最近*会话的待定项：徽章是按*项目*的，而不是按会话，旧会话中的待定项仍然是待定项。

`Shell.tsx` 不再导入 `useProjectsUnread`——它在那里唯一的消费者就是这个徽章。`Dashboard.tsx`/`ProjectCard.tsx` 获得了同样的连线：`ProjectCard` 的 `unreadCount` prop 从未有调用者（`ProjectCardContainer` 没有传它），它变成了 `pendingApprovalsCount`，值与侧边栏相同——两个界面，一个数字，一个来源。

- **位置：** `apps/api/src/application/ports/projects-summary-repository.port.ts`
  （`ProjectCardSummary.pendingApprovalsCount`），
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  （`summarizeForWorkspace`，对 `proposed_actions` 的聚合查询），
  `apps/web/src/routes/Shell.tsx`，`apps/web/src/routes/Dashboard.tsx`,
  `apps/web/src/components/ProjectCard.tsx`
- **测试：**
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  （`pendingApprovalsCount soma o projeto INTEIRO...`，只计算 `pending`，不在项目之间泄漏，查询次数保持恒定），
  `apps/web/src/routes/Shell.test.tsx`（待批准徽章）
- **来源：** 用户浏览应用时的发现——侧边栏徽章显示"392"，而同一项目的审批标签页中真实数字是"8"

---

### RN-152 — 任务的分支在代码标签页的下拉菜单中说明它属于哪个 dev agent 和模块 {#rn-152}

`CodeBranchPicker` 本来就列出仓库的每个分支，包括 dev agent 的分支（`feature/task-XXXXXXXX`，`Engine.Dev.AgentIo`），但没有任何关于谁创建了它的线索——只有原始名称。`ReadProjectCodeUseCase.branches` 无需对 git 提供方多做调用就解决了这个问题：`feature/task-` 之后的 8 个字符正好是任务 uuid 的第一个连字符分组（`"feature/task-" <> String.slice(to_string(row.task_id), 0, 8)`，而不是任意的子串），因此可以与 `TaskRepository
.findByProjectAndIdPrefix` 匹配（按*项目*连接，使 8 字符前缀永远不会泄漏另一个项目的任务）。任务的 `assignedTo` 是 agent_id（`dev-<modulo>`/`dev-<modulo>-2`，RN-087）；模块通过与项目*现行* `module_map` 比较来解析，使用生成它的*同一*函数（`activate-execution.use-case.ts` 中的 `devAgentId`/`extraDevAgentId`）——绝不用反向正则，那会对带特殊字符的模块名退化为歧义。

`producedBy: { agentId, moduleId } | null` 是诚实的降级，与 `ahead`/`behind` 本来的方式相同：对不符合模式的分支（用户手动创建的，或 `main`/`dev`/`qa`）为 `null`，当模式匹配但任务/模块不再可解析（任务已删除、模块从现行映射中移除）时也是如此——绝不是编造的值。在下拉菜单中，每个由 dev 产生的分支获得该 agent 的图标和颜色（`AGENTS`/`agents.ts`，RN-087），复用 `apps/web/src/lib/agent-status.ts` 已经为实时名册使用的*同一*降级：在 `AGENTS` 中没有固定键的模块继承 `dev-backend` 的图标/颜色。

- **位置：** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  （`branches`/`producedBy`/`moduloDoAgente`），
  `apps/api/src/application/ports/backlog-repository.port.ts`
  （`TaskRepository.findByProjectAndIdPrefix`），
  `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts`,
  `apps/api/src/interfaces/http/git/dto/code.response.dto.ts`
  （`CodeBranchProducedByResponseDto`），`apps/web/src/lib/api-types.ts`
  （`CodeBranchProducedBy`），`apps/web/src/routes/code/CodeBranchPicker.tsx`
  （`IconeDoAgenteProdutor`/`defDoAgenteProdutor`）
- **测试：**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  （describe "producedBy da branch de task"——带模块和带额外 agent `-2` 的已解析任务；不符合模式的分支即使有可匹配前缀的任务也绝不获得 `producedBy`；项目中没有任务的前缀、从现行映射中移除的模块以及还没有所有者的任务都降级为 `null`），
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`（任务分支显示所属 dev agent 的标记；不符合模式的分支没有任何标记）
- **来源：** 用户的请求——在 FASE 26b 的丰富下拉菜单中没有关于谁创建了分支的视觉线索

### RN-153 — "自动模式"：`ApprovalCard` 为一个 agent 之后的*任何*动作打开自主权 {#rn-153}

> **由 [RN-603](#rn-603) 修订**（ADR 0167）：`decide()` 开始同时接收自主权的*来源*，自动模式（处于 `auto_approve` 的通配符）不再经过路径范围上限。下面关于 `decide()` "不变"的内容描述的是原始设计。

在这条 RN 之前，`agent_autonomy` 只知道按 `(项目, agent, 动作类型)` 授予自主权——每种类型一行，一次 upsert *一条*规则（`SetAgentAutonomyUseCase`，
`apps/api/src/application/use-cases/actions/set-agent-autonomy.use-case.ts`）。广泛信任一个 agent 需要每种类型一行——`terminal`、`write_file`、`pr_open`……——而新类型诞生时没有规则，回到 `require_approval`。

"自动模式"是*同一*张表和*同一*端点（`PUT /projects/:projectId/agent-autonomy`）中的特殊值 `actionType: "*"`——不是新机制，而是现有的列（`agent_autonomy.action_type`，自由 `text`，没有枚举也没有外键——`apps/api/src/db/schema/agents.ts`）多接受一个值。通配符意味着"此 agent 的任何动作类型都有自主权"，在 `DrizzleAgentAutonomyRepository.findMode` 中解析（`apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`）：在同一查询中查找*具体*规则和通配符，具体规则总是胜出——在 `"*": auto_approve` 已打开的情况下写入 `terminal: deny`，仍会拒绝该 agent 的 `terminal`，而放行其余。`decide()`（`apps/api/src/domain/actions/decide.ts`）不变：它在 `ctx.autonomyMode` 中接收已解析的 `PermissionPolicy`，与通配符出现之前完全一样——这就是绝对上限无需知道"自动模式"存在就能生效的原因（见 [RN-154](#rn-154)）。

`ApprovalCard`（`apps/web/src/components/ApprovalCard.tsx`）在"始终允许"旁边新增了"自动模式"按钮，只在以下情况下可见：(a) 动作处于 `pending`，(b) 提议者是 *AGENT*（`actor.kind === 'agent'`——没有可授予用户的 agent 自主权）以及 (c) 调用方（`ProjectApprovalsTab.tsx`/`SessionPage.tsx`）已经确认在 workspace 中拥有 `maintainer`/`owner` 角色——与端点的要求相同（`@RequireRole('maintainer')`，未改变）。对没有该角色的人，`onActivateAutoMode` prop 为 `undefined`——卡片*隐藏*按钮，而不是显示为禁用，检查位于调用方而不在卡片中（展示型组件，没有自己的查询）。

**关闭**复用 agent 卡片已有的手动/自动开关（Fase 8d）——没有新界面。`AgentTeamGrid.tsx` 开始在代表性规则*之前*查找 agent 的通配符规则（`autonomyActionTypeFor`）：如果存在，卡片的开关反映并编辑*通配符*，而不再是代表性类型——关闭就是把同一通配符写为 `require_approval`，而 agent 卡片上的开关正是这个"关闭"。

- **位置：** `apps/api/src/domain/actions/decide.ts`
  （`AGENT_AUTONOMY_ALL_ACTIONS`、`AgentAutonomyActionType`），
  `apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`
  （具体 > 通配符优先级的 `findMode`），
  `apps/api/src/interfaces/http/actions/dto/set-agent-autonomy.dto.ts`
  （接受 `"*"`），`apps/web/src/components/ApprovalCard.tsx`（"自动模式"按钮），`apps/web/src/components/AgentTeamGrid.tsx`（开关开始优先考虑通配符），`apps/web/src/routes/ProjectApprovalsTab.tsx`
  和 `apps/web/src/routes/SessionPage.tsx`（`handleActivateAutoMode`，通过 `useCurrentWorkspaceWithRole` 的角色闸门）
- **测试：**
  `apps/api/test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  （具体 > 通配符优先级；通配符按 agent；关闭就是把通配符重写为 `require_approval`），
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  （自动模式在*不*查询 `permissions.json` 的情况下自动批准普通动作；处于 `deny` 的具体规则胜过通配符），
  `apps/api/test/interfaces/http/actions/agent-autonomy.controller.spec.ts`
  （`PUT`/`GET` 仍要求 `maintainer`；DTO 接受 `"*"` 并拒绝列表之外的字符串），`apps/web/src/components/ApprovalCard.test.tsx`
  （没有 `onActivateAutoMode` 时按钮消失；点击调用回调；说明解释仍需决定的上限）
- **来源：** 用户的请求——"始终允许"只写入一个具体的命令模式，而 `agent_autonomy` 一次只覆盖一种动作类型；缺的是一键广泛信任一个 agent

### RN-154 — 即使"自动模式"打开，三个绝对上限仍然阻止 {#rn-154}

> **由 [RN-603](#rn-603) 修订**（ADR 0167）：这里列出的上限在自动模式下仍然有效；对它不再有效的是*路径范围*上限（ADR 0055），而那从来不在这个列表中。

"自动模式"（[RN-153](#rn-153)）的设计刻意无法突破 `decide()` 中已有的三个上限——它们*最后*应用，作用于 `current.policy`，不看宽松来自哪里（具体类型的 `agent_autonomy`、通配符或 `permissions.json`——该函数从来不知道如何区分来源，现在也仍然不知道）：

1. **在受保护分支上合并**（目标为 `dev`/`qa`/`rc`/`main` 的 `git_merge`，[RN-006](../business-rules.md#rn-006)）——合并锁（`isProtectedBranch`）总是把 `auto_approve` 降为 `require_approval`，即使为该 agent 打开了 `"*": auto_approve`。
2. **`instruction_patch`**（[RN-007](../business-rules.md#rn-007)）——更改另一个 agent 的指令要求人看到 diff；自动模式不改变这一点。
3. **`parallelize`/`raise_max_parallel`**（[RN-086](../business-rules/custo.md#rn-086)）——提高并行上限，或在上限之上请求更多 agent，仍然是用户的决定；打开了自动模式的 agent 无法自行授予自己更多的花费权力。

证明是靠*构造*，而不是逐个情形：由于三个上限只检查 `current.policy === 'auto_approve'`——从不检查来源——，而"自动模式"只能通过具体 `agent_autonomy` 规则本来就使用的*同一*路径（`ctx.autonomyMode`）到达 `current.policy === 'auto_approve'`，已经约束 `agent_autonomy` 的上限无需新代码就继续约束通配符。真正的风险不在上限——而在于有人在把 `agent_autonomy` 泛化为接受 `"*"` 时，把通配符检查插到上限*之前*，重新打开这扇门；因此 `AGENT_AUTONOMY_ALL_ACTIONS` 完全在*仓储*中解析（在 `decide()` 运行之前），`decide()` 本身没有增加任何一行——恰好足以让通配符没有地方可以突破。

- **位置：** `apps/api/src/domain/actions/decide.ts`（三个上限块，约第 207–258 行，未被这个功能改变）
- **测试：**
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  （"auto mode NÃO auto-aprova merge em branch protegida"、"... instruction_patch"、
  "... parallelize/raise_max_parallel"——三者都把 `agent_autonomy` "*" 写为 `auto_approve`，裁决仍为 `require_approval`）
- **来源：** 用户在请求"自动模式"时确认的设计约束——三个上限是不能倒退的保证

### RN-603 — 自动模式放开路径范围，且只放开它 {#rn-603}

产品所有者在 2026-09-26 的决定（AT-226，
[ADR 0167](../adr/0167-modo-automatico-libera-o-escopo-de-caminho.md)）：在某个 agent 上打开"自动模式"——[RN-153](#rn-153) 的通配符 `"*"` 解析为 `auto_approve`——时，agent 无需请求批准就能运行*任何*终端命令，*包括*在项目文件夹之外。ADR 0055 的路径范围上限对该 agent 不再有效。在 `exp001`（`mounted` 模式，容器运行中）中测得：模式打开时有 51 条命令请求批准，其中 47 条仅仅因为引用了 `/work` 或 `/tmp`——dev agent 在容器中运行，而范围是与*主机*的根比较的。

`decide()` 开始接收自主权的*来源*（`ctx.autonomyOrigin`：
`'especifica'` 或 `'curinga'`），由已经解析优先级的*同一*仓储解析——`findMode` 成为 `resolve` 的一种读取，而不是第二把尺子。只有处于 `auto_approve` 的通配符才是自动模式（`modoAutomaticoDoAgente`）；缺少来源视为具体规则。在自动模式下，有两种请求不再存在：*范围*上限，以及当某段在 `permissions.json` 中没有任何规则时*复合*命令合成的 `require_approval`（文件没有意见，它从不降级之前的阶段）——没有第二点，`cd /work && npm test` 仍会请求批准。

在自动模式下，其余一切照旧：`deny`（来自文件、内置模式或具体自主权）胜出；文件中*写明*的 `ask` 会请求批准；外部效果/特权命令上限（push、PR、部署、`sudo`/`doas`，[RN-418](../business-rules.md#rn-418)）先运行且不看来源；在受保护分支上合并、`instruction_patch`、
`parallelize`/`raise_max_parallel` 和 `container_remove` 永远不可自动批准（[RN-154](#rn-154)）。该类型的具体规则在仓储中胜过通配符，并以 `'especifica'` 到达：通配符打开时，`terminal: require_approval` 仍然请求批准。关闭（agent 卡片的开关把通配符写为 `require_approval`）恢复上限。自
[RN-670](../business-rules.md#rn-670)（ADR 0189）起，位于 `auto_approve` 通配符之下的 `auto_approve` 具体规则——dev agent 的"始终允许"所写入的——解析为*通配符*，不再关闭自动模式；而在自动模式之外，范围与真实的执行文件夹比较（[RN-669](../business-rules.md#rn-669)）。

界面在点击之前说明模式放开了什么、什么仍然需要请求：`ApprovalCard` 的说明出现在*两种*变体中（聊天和审批队列），agent 卡片在开关下方显示一句话——只在*通配符*打开时，因为针对代表性类型的开关写入的是具体规则，它不放开范围。

- **位置：** `apps/api/src/domain/actions/decide.ts:295` (`modoAutomaticoDoAgente`),
  `apps/api/src/domain/actions/decide.ts:370`（被忽略的复合命令合成裁决），`apps/api/src/domain/actions/decide.ts:455`（被跳过的范围上限），
  `apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts:25`
  （`resolve`，带来源），
  `apps/api/src/application/use-cases/actions/propose-action.use-case.ts:216`
  (`autonomyOrigin`), `apps/web/src/components/AgentTeamGrid.tsx:108`
  (`autonomyHint`), `apps/web/src/components/ApprovalCard.tsx:313`（两种变体中的说明）
- **测试：** `apps/api/test/domain/actions/decide.spec.ts`（"modo automático
  libera o escopo de caminho (RN-603)"：范围之外和复合命令自动批准；push/`sudo`/`deny`/写明的 `ask` 照旧；具体规则和关闭的通配符不放开；其他上限不变），
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  （使用真实仓储的端到端），
  `apps/api/test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  （`resolve` 返回来源），`apps/web/src/components/AgentTeamGrid.test.tsx`,
  `apps/web/src/components/AgentCard.test.tsx`,
  `apps/web/src/components/ApprovalCard.test.tsx`
- **来源：** 产品所有者在 `exp001` 测试之后的决定（AT-226）

### RN-155 — 时间线排序使用 `proposed_action.created` 关联，绝不使用原始的 `action.seq` {#rn-155}

`SessionPage.tsx` 的 `timeline` 按单一可比较的数值轴对事件和提议动作排序。对事件而言是 `event.seq`（无间隙，按会话）。对动作而言是相关的 `proposed_action.created` 事件的 `seq`（通过 `payload.actionId === action.id` 找到，由 `ProposeActionUseCase` 在创建动作的*同一*事务中写入）——绝不是 `action.seq`，它是整张 `proposed_actions` 表唯一且全局的 `bigserial`，由系统的所有会话和项目共享，因此与 `event.seq` 不可比较（刻意的对比，见
`apps/api/src/db/schema/actions.ts`）。直接比较两者会在每次 `ApprovalCard` 与普通事件混在一起时产生不可预测的顺序。没有这种关联的动作（只有 Gitflow 的 bootstrap——
`git_repo_create`/`git_branch_create`，它们只写 outbox）降级为按 `createdAt` 插值的位置，锚定在之前的最后一个事件上。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`ordemDaAcaoNaTimeline`）
- **测试：** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **来源：** PR #286 的发现——审批卡片在时间线中顺序错乱，与普通事件混在一起

### RN-156 — 5s 等待指示器使用固定文本，不插入 agent 名称 {#rn-156}

5s 无响应后出现的指示器（`pensandoVisivel`）显示固定句子"Reunindo informações..."，不插入 agent 的名称——取代了之前的文本"{Agente} está escrevendo…"。真实文本流一开始，agent 的名称就在头部可见；在等待指示器中重复它对阅读没有帮助。

- **位置：** `apps/web/src/routes/SessionPage.tsx`
- **测试：** `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **来源：** PR #286 的发现——之前的文本点名的是一个已经在头部可见的 agent

### RN-157 — PO 创建史诗/故事成为紧凑提示，而不是完整气泡 {#rn-157}

`backlog.epic_created`/`backlog.story_created` 事件不再渲染为完整的消息气泡（`.message`/`.bubble`，32px 头像——与真正的 agent 回复相同的视觉分量），而是使用 `.handoffDivider`/`.handoffPill` 已经用于交接棒的相同紧凑提示格式：带水平细线和紧凑药丸的居中行，保留"在 Backlog 中查看"链接。`agentId` 在 `TimelineEntry` 中继续填充——与 handoff 分隔线不同，这不标志 agent 之间的过渡，而是 PO 在自己回合内的一个动作，仍然适用按 agent 的折叠（[RN-138](../business-rules.md#rn-138)）。

- **位置：** `apps/web/src/routes/SessionPage.tsx`
- **测试：** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **来源：** PR #286 的发现——对于 PO 的一个元数据动作，完整气泡的视觉分量与真正的 agent 回复相同

### RN-158 — 聊天中带高亮的轻量 Markdown {#rn-158}

会话消息流中的 `agent.response` 渲染 Markdown 的一个子集（粗体 `**texto**`、斜体 `*texto*`/`_texto_`、行内代码
`` `texto` ``、标题 `#`/`##`/`###`、列表 `-`/`1.`、链接
`[texto](url)` 以及代码围栏 ```` ```linguagem ````），通过基于正则的自有解析器（`apps/web/src/lib/markdown.ts`），没有新依赖。`chat.message`（用户输入的文本）保持原样——Markdown 只应用于 agent/LLM 的*输出*，绝不应用于人的输入。

安全：解析器从不产生 HTML——它返回一棵数据树，由 `MarkdownMessage.tsx` 直接转换为 React 元素（绝不用 `dangerouslySetInnerHTML`）。只有当 URL 的协议为 `http`、`https` 或相对路径（`/...`、`#...`）时，链接才变成可点击的 `<a href>`；任何其他协议（`javascript:`、`data:` 等）降级为链接文本，绝不是可执行的 `href`。

围栏中的代码获得按 token 的高亮，复用
`apps/web/src/routes/code/highlight.ts` 中的 `highlightLine`/`highlightFile`——与已经为代码标签页着色的同一函数。`sh`/`bash` 获得了自己的 shell 关键字词汇（之前只映射了行注释 `#`，并落入 JS 的回退）。围栏
```` ```sh ````/```` ```bash ```` 获得终端的视觉风格（每个命令行的 `$` 提示符），与 `ApprovalCard` 已经用于 `terminal` 动作的 `$ comando` 一致。

- **位置：** `apps/web/src/lib/markdown.ts`,
  `apps/web/src/components/ui/MarkdownMessage.tsx`,
  `apps/web/src/routes/code/highlight.ts`
- **测试：** `apps/web/src/lib/markdown.test.ts`,
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`,
  `apps/web/src/routes/code/highlight.test.ts`,
  `apps/web/src/routes/SessionPage.markdown-resposta.test.tsx`
- **来源：** PR #288——带列表、代码和链接的 agent 回复以原始文本到达消息流，没有任何结构

### RN-159 — 生成的工件按 agent 分组 {#rn-159}

会话的"生成的工件"面板（`SessionPage.tsx` 中的 `ContextAside`）列出 dev 的 PR（`pr_open`）、Arquiteto 的 ADR PR（`open_adr_pr`）以及 PO 创建的史诗/故事（`backlog.epic_created`/`backlog.story_created`），按 `agentId`——生成每个工件的人——分组，使用与 [RN-138](../business-rules.md#rn-138) 相同的可折叠 `Disclosure` 模式（agent 名称 + 数量，可展开为每个工件的标题）。

每个工件都导航到它所在的地方：PR（dev 或 ADR）打开真实 URL（`executionResult.pullRequestUrl`，与 `ProjectOverviewTab.tsx` 已经为 ADR PR 读取的字段相同）；史诗/故事导航到 `/projects/:projectId?tab=backlog`（与主消息流中 PO 的紧凑提示已经使用的 `Link` 模式相同，[RN-124](../business-rules.md#rn-124)/
[RN-157](#rn-157)）。还没有 `pullRequestUrl` 的 PR（执行待定）出现在面板中，但不成为可点击的链接。

出于记录在代码注释中（`SessionPage.tsx` 中的 `ContextAside`）的决定而不在范围内的：module_map/C4——它们是项目的*现行*状态（一个当前版本，每次生成时被覆盖），而不是像 PR/史诗/故事那样按*会话*标注日期的工件；概览标签页（`ProjectOverviewTab.tsx`）如今已经是它们的位置，没有自己的锚点——处理这一点不在本次交付范围之内。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`ContextAside`）
- **测试：** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
- **来源：** PR #288——面板不区分谁生成了每个工件，也不覆盖 ADR PR 和史诗/故事，只覆盖 dev 的 PR

### RN-160 — "确认架构就绪"要求至少 1 个已晋升的故事 {#rn-160}

"确认架构就绪"按钮（Arquiteto→Dev Lead 的 handoff，通过 `confirmArchitectureReadiness`）在项目 backlog 中存在至少 1 个状态不是 `draft` 的故事之前一直处于 `disabled`——也就是说，已经通过 `PromoteStoriesUseCase`/`TransitionStoryUseCase` 晋升（[RN-048](../business-rules/custo.md#rn-048)），只捕获了业务规则是不够的。`in_progress`/`done` 也算，因为只有经过 `ready` 才能到达那里。来源与 Backlog 标签页已经使用的*相同*（`useBacklog`，`ProjectBacklogTab.tsx`，相同的 queryKey `['backlog', projectId]`）——没有新的往返。在没有已晋升故事期间，按钮在 `title` 中显示解释原因的提示。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`hasPromotedStory`，按钮的渲染）
- **测试：** `apps/web/src/routes/SessionPage.readiness-arquitetura-exige-historia.test.tsx`
- **来源：** 用户的请求——Arquiteto→Dev Lead 的 handoff 按钮没有任何闸门

这只在*客户端*生效：直接的 HTTP 调用会忽略这条规则。由
[RN-404](../business-rules.md#rn-404)（ADR 0094）关闭，它在后端重新校验。

### RN-161 — 当有效角色已经授权时，接受给 Dev Lead 的 handoff 会串联执行的激活 {#rn-161}

> **由 [RN-677](../business-rules.md#rn-677) 修订（ADR 0194，所有者在 10月1日的决定）：** 接受给 Dev Lead 的 handoff 不再串联执行的激活，对*所有*角色都是如此——接受只是让它来*规划*，激活的是对其计划（`propose_execution_plan`）的*批准*。下面的文本描述的是当时的合并方式。

当 `toAgent === 'dev-lead'` *且*接受者的*有效*角色——从与已经授权"自动模式"（[RN-153](#rn-153)）以及审批/设置界面的同一个 `useCurrentWorkspaceWithRole()` 读取——是 `owner` 或 `maintainer` 时，`handleAcceptHandoff`（`SessionPage.tsx`）会自动串联 `activateExecution`。对于 `developer`（或尚未解析的角色），现有流程保持不变：接受不激活任何东西，"激活执行"仍作为第二个按钮。检查只在客户端——
`POST .../execution/activate` 在后端仍要求 `maintainer`
（[RN-137](../business-rules.md#rn-137)）；合并只是为本来就拥有两个角色的人省去一次多余的点击。复用"激活执行"按钮已经调用的*同一个* `handleActivateExecution`，它处理自己的错误（toast +
`mensagemDaApi`）且从不重新抛出——避免一个迟来的激活错误被报告为"无法接受 handoff"。

- **位置：** `apps/web/src/routes/SessionPage.tsx`
  （`podeFundirHandoffComExecucao`、`handleAcceptHandoff`）
- **测试：** `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`，
  describe "problema 4"
- **架构决策：** [ADR 0069](../adr/0069-fusao-condicional-do-handoff-com-a-ativacao-de-execucao.md)
- **来源：** 用户的请求（已批准的设计）

### RN-162 — Criativo 的结构化问题 {#rn-162}

当 Criativo 在同一个回答中提出*多个*问题时，它可以以*结构化*格式发出列表，而不是让用户用自由文本逐项回答——新工具 `ask_structured_questions`
（`apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`，
`:direct`），与 `emit_artifact` 并列注册。Schema：
`{ questions: [{ id, label, type?, options? }] }`——`id` 唯一且非空，`label` 非空，`type` ∈ `text|textarea|select`（默认 `text`），当 `type: select` 时 `options` 必填且非空。写入 `chat.structured_question`。

前端（`StructuredQuestionCard`，`SessionPage.tsx`）渲染一个每个问题一个字段的表单——根据 `type` 使用设计系统的 `Input`/`Textarea`/`Select`。`POST .../agents/:agent/structured-
question/:questionSetId/answer`（`AnswerStructuredQuestionUseCase`）校验每个问题都有非空回答，写入
`chat.structured_question_answered`（引用 `questionSetId` = 问题事件的 id），并*复用* `SendAgentMessageUseCase`——回答变成一条拼接的消息（"1. {label}: {resposta}\n2. ..."），就像用户在消息流中输入的一样；没有"agent 读取结构化回答"的新通道。一组问题只能被回答*一次*：重新提交以 409 被拒绝，表单甚至不会再出现——一旦存在之后带相同 `questionSetId` 的 `chat.structured_question_answered`，卡片就变为只读。

- **位置：** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
  `apps/engine/lib/engine/agents/criativo_server.ex`,
  `apps/api/src/application/use-cases/agents/answer-structured-question.use-case.ts`,
  `apps/api/src/interfaces/http/agents/agents.controller.ts`,
  `apps/web/src/routes/SessionPage.tsx`（`StructuredQuestionCard`）
- **测试：** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`,
  `apps/engine/test/engine/agents/criativo_server_test.exs`,
  `apps/api/test/application/use-cases/agents/answer-structured-question.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
- **来源：** 用户的请求——聊天中没有结构化输入的先例

### RN-163 — Criativo 兑现重试的承诺 {#rn-163}

Criativo 的每个回合都运行一个**有界的工具使用循环**，上限为 **12** 次模型调用——与 PO 和 Arquiteto 已有的设计相同。以前每个回合只调用模型*一次*：工具结果被附加到内存中的历史，再也没有人读它，因此*"vou corrigir e tentar de novo"*这句话——代码中的字面量——只有在用户再发一条消息时才会兑现。对使用者来说，Criativo 在说它要修正之后就干脆不再回应了。

四个后果，每一个都是规则：

1. **工具错误是输入，而不是终点。** 原因作为 `tool` 消息回到模型，循环再次调用模型，模型在同一回合*之内*发出修正后的结果。
2. **不宣布代码不会执行的东西。** 重试的句子在派发工具之后、在知道还剩多少圈的情况下决定：有剩余的圈数时，agent 说它会修正；没有时，它不作承诺。
3. **工具失败变成了带来源的持久 `agent.error`**（[RN-059](../business-rules/custo.md#rn-059)）——原来是 `agent.response`，在事件日志中与正常回答无法区分。api 拒绝 `append_event` 时为 `origem: infra`；对于模型写出的 payload（错误的键、不是列表的 `origin`、重复的规则、系统发出的类型）为 `origem: modelo`。payload 携带 `tool` 和 `retentativa`。
4. **上限耗尽不会以沉默结束。** 它变成带 `reason: "limite_de_iteracoes"` 和 `origem: modelo` 的 `agent.error`，与 `ToolLoop` 的 `toolloop.limit_reached` 相同的解读。事件名*不*被复用：这个 agent 不在 `ToolLoop` 内运行，那个事件会就谁产生了它撒谎。

循环的两个边界，都是刻意的：成功的 `ask_structured_questions` **结束**回合（球在用户那边，回答会在未来的回合中返回——[RN-162](#rn-162)）；某一圈失败过的回合在消息流中以*汇总*的结果收尾，使最后一句话不是一圈之后已经被修正的错误。

- **位置：** `apps/engine/lib/engine/agents/criativo_server.ex`
  （`run_turn_capturing/3`、`continuar/4`、`emit_falha_de_ferramenta/4`、
  `emit_falha_limite/2`）
- **测试：** `apps/engine/test/engine/agents/criativo_server_test.exs`
  （真正修正的循环、叙述出的上限耗尽、来源 `infra` 与 `modelo`、结束回合的结构化问题）
- **来源：** `exp001` 项目中的真实使用——"o Criativo não respondeu depois
  de dizer que iria corrigir e tentar de novo"

### RN-169 — 项目选择代码存放的位置：本地或容器 {#rn-169}

**由 [RN-421](../business-rules.md#rn-421) 修订（ADR 0104）**：`workspace_mode`/`local` 变成了有*三个*值的 `execution_mode`（`container`/`mounted`/`runner`，迁移 `0048`）——本条目的其余部分是历史，忠实于修订之前的有效内容。

项目诞生时带有一个**workspace 模式**（`projects.workspace_mode`，迁移 `0043`），由它决定范围根从哪里推导：

- **`container`**（默认，也是一直存在的行为）：由产品*托管*的文件夹，`join(PROJECT_WORKSPACES_ROOT, workspace_dir_name)`
  （[RN-109](#rn-109)）；
- **`local`**：*用户*的文件夹，位于 `projects.workspace_path` 的绝对路径。

这一对由数据库中的 CHECK 约束绑定
（`(workspace_mode = 'local') = (workspace_path IS NOT NULL)`），而不仅仅由用例绑定：该列由*两个*进程（api 和 engine）读取，并由不经过用例的 seed/回填脚本写入。没有路径的 `local` 会让终端范围指向无处；带路径的 `container` 会成为等待与第一个分歧的第二个事实来源。

推导仍然**唯一**——`projectScopeRoot` 开始接收位置（`{workspaceDirName, workspaceMode, workspacePath}`）并选择分支；四个消费者（[RN-092](../business-rules/custo.md#rn-092)）中没有一个获得自己的校验。engine 在*查询*中解析同一个定位器（`container` 中是文件夹名，`local` 中是绝对路径），并通过开头的斜杠区分两者，这是无歧义的，因为文件夹名会对照 `^[A-Za-z0-9_-]{1,64}$` 校验。

`local` 模式的两个明确后果：

1. **Arquiteto 的镜像闸门（[RN-105](#rn-105)）*不*适用。**
   **由 [RN-494](../business-rules.md#rn-494) 撤销（ADR 0135）**：豁免结束了——三种模式都开始要求在打开代码标签页之前作出镜像决定。本项的其余部分是历史。本地项目不启动容器，因此代码标签页会放行，而不等待一个永远不会发生的决定。豁免与 api 中的闸门位于同一漏斗中，界面也一致：当项目是本地时，`ProjectCodeTab` 甚至不去询问容器的状态（[RN-107](#rn-107)）——如果只有 api 豁免，标签页会因为一个不存在的决定而在界面上保持阻塞。
2. **`permissions.json` 位于用户的文件夹中**，与代码在一起——因为策略必须从终端范围所授权的*同一*根读取。

`workspace_mode` 不要与 `GitProviderName` `'local'` 混淆：一个说的是*代码*在磁盘上的位置，另一个说的是 git *仓库*的位置，两种选择是正交的。

- **位置：** `apps/api/src/db/schema/iam.ts`（`projects`），
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  （`projectScopeRoot`），`apps/api/src/domain/iam/project.entity.ts`,
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  （`portaoDoContainer`），`apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/engine/lib/engine/projects/project.ex`,
  `apps/engine/lib/engine/actions/workspace.ex`（`workspace_dir/2`），
  `apps/engine/lib/engine/dev/worktree_cleanup.ex`（它原是手写的第二个推导，改为使用唯一的那个），
  `apps/web/src/routes/NewProjectWizard.tsx`
- **测试：** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  （describe "projectScopeRoot no modo local"），
  `apps/api/test/infrastructure/filesystem/fs-permissions-file-store.spec.ts`
  （用户文件夹中的 permissions.json），
  `apps/api/test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`,
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  （本地项目不经过闸门），
  `apps/api/test/interfaces/http/iam/project-dto-modo-de-workspace.spec.ts`
  （模式被冻结：PATCH 不改变它），
  `apps/web/src/routes/ProjectCodeTab.test.tsx`（界面也豁免 gate），
  `apps/engine/test/engine/actions/workspace_test.exs`
  （describe "workspace_dir/2 com o localizador já resolvido"），
  `apps/web/src/routes/NewProjectWizard.test.tsx`
- **架构决策：** [ADR 0072](../adr/0072-projeto-local-ou-container.md)
- **来源：** 用户的请求（他的决定，明确选择了自由路径的变体）
