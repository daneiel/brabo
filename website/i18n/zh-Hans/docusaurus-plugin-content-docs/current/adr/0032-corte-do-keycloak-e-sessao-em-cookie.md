---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0032 — 切除 Keycloak：自有签发方、service token 与 cookie 中的会话

## 背景 {#contexto}

[ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) 与 Keycloak **并行**构建了 first-party 认证：argon2id、EdDSA access token、带重用检测的 refresh 轮换、锁定、账户 token。它已经完成、经过测试，却没有任何使用者——全局 `JwtAuthGuard` 仍在校验 Keycloak 的 token，而 `/auth/*` 路由存在却无人使用。

本 ADR 记录这次切换：签发方的替换、内部流量中 client-credentials 的替代、web 上的自有登录，以及从 compose、manifests、脚本和文档中移除 Keycloak。

探索中的三项发现重新定义了设计，值得记录，因为每一项都会让一个合理的方案失效：

1. **没有任何 RBAC 决策读取 token 的 claim。** `RolesGuard`、`ResolveEffectiveRoleUseCase` 和 `decide()` 依赖 `request.user.id` 和数据库中的行；`realm_access` 和 `resource_access` 从未被使用。权限矩阵在结构上不受签发方更换的影响——这把"矩阵完全一致"这一标准从一项审计工作变成了一次低成本的核对。
2. **`request.clientId` 是唯一一个一直存活到授权阶段的 claim。** 它来自 Keycloak 的 `azp`，并支配两件事：26 条 `/internal/*` 路由的 `EngineServiceGuard`，以及 engine 的限流豁免。first-party token 没有 `azp`，若不处理这一点，切换会一下子关闭这 26 条路由。
3. **复用 `SyncUserUseCase` 会得到 500，而不是 401。** 新 token 的 `sub` 就是 `users.id` 本身，但 `upsertFromKeycloak` 在 `keycloak_sub` 上做冲突处理——插入会违反 `users_email_lower_idx`，而抛出发生在只包住 token 校验的 `try/catch` **之外**。

## 决策 {#decisão}

### 切换是原子的：没有共存期 {#o-corte-é-atômico-não-há-período-de-coexistência}

在同一个 release 中，签发方更换，Keycloak 退出。所有人都被登出；原本已有账户的人第一次设置密码。

另一种做法——guard 在几周内同时接受两个签发方——需要 web 上两条会话路径、两套网络配置、两套测试，全都必须每天能用，直到有人决定结束。切换的代价是一次事先宣布的集体登出，只发生一次；共存的代价是一笔没有期限的债务。它作为**破坏性变更**写进 CHANGELOG。

### guard 只读取，不同步 {#o-guard-lê-não-sincroniza}

`FirstPartyTokenVerifier` 委托给 `Ed25519AccessTokenIssuer`，并返回 `{ sub: userId, email }`。`JwtAuthGuard` 改为调用 `UserRepository.findById`，找不到时返回 **401**——一个有效 token 的 `sub` 消失了，就是孤儿会话（账户在 15 分钟窗口内被删除），而 401 会把客户端送回登录，而不是变成一条基础设施告警。

`SyncUserUseCase`、`upsertFromKeycloak` 和 `KeycloakTokenVerifier` 被**移除**。每个已认证请求少了一次数据库写入。

`users.keycloak_sub` 在本次交付中**保留**。它是仅存的来源证据，也是迁移脚本用来区分"已迁移、等待设置密码的账户"和"废弃记录"的依据。移除它的迁移在切换稳定之后进行。

### `/internal/*` 脱离 JWT {#internal-sai-do-jwt}

新的装饰器 `@ServiceRoute()`，由 `JwtAuthGuard`（不要求 Bearer）和 `RateLimitGuard`（豁免）识别。豁免必须来自**元数据**而不是某个 guard：`RateLimitGuard` 是 `APP_GUARD`，在任何 controller guard 之前运行，所以当它做决定时 `EngineServiceGuard` 还没有运行。

`EngineServiceGuard` **保留了类名**，替换了实现：以常数时间校验 `X-Brabo-Service-Token`。保留名字不是出于留恋——正是它让 `route-surface.spec.ts` 继续把 26 条路由归类为 `engine-service`，也避免了 `docs/security-surface.md` 中 26 行无谓的变动在 diff 中掩盖任何真实的暴露面变化。

`request.clientId` 已从 `AuthenticatedRequest` 中**移除**。没有 `azp` 也没有使用者，一个永远无值的身份字段只会诱使有人把它重新引入某个授权检查。

**一个密钥 `BRABO_SERVICE_TOKEN`，双向通用。** 两个独立密钥可以把泄露的损害限制在一个方向——但两端运行在同一集群、一起部署、读取同一个 Secret：能读其一就能读另一个。第二个密钥会给人隔离的印象而实际上什么都没隔离，还让需要同步轮换的东西翻倍。`BRABO_SERVICE_TOKEN_PREVIOUS` 只在校验时被接受，因此两端可以按任意顺序更新。

使用自有请求头而不是 `Authorization: Bearer`，是因为在那个请求头里，"用户 JWT"是 api 其余部分既定的含义，而这种歧义会导致有人把服务 token 发到用户路由上。

Elixir 一侧：`VerifyServiceToken` 取代 `VerifyApiToken`，**保留 401 + JSON + `halt()` 的契约**（`route_surface_test.exs` 中有三条断言依赖它），八处请求头组装合并为一处，并移除 `joken`、`joken_jwks`、`jose` 和 `tesla`。

### web 的会话存放在 httpOnly cookie 中 {#a-sessão-da-web-vive-em-cookie-httponly}

`POST /auth/login` 不再在响应体中返回 `refreshToken`。refresh 放在一个 `httpOnly`、`SameSite=Strict`、`Path=/auth`、生产环境 `Secure` 的 cookie 中；access token 仍保存在 JS 内存中并通过 `Authorization: Bearer` 发送。

如果**同时**在响应体中返回 refresh，整套保护就会失效：只需一次 XSS 读取登录响应即可。而那正是显而易见的替代方案——`localStorage`——会发生的事，更糟的是 XSS 会拿走长期会话（30 天的 family），而不是 access 的 15 分钟。

把 access token 放在 cookie **之外**，才避免了对每条已认证路由都要求 CSRF：只有 `/auth/*` 的路由需要。

**即使有 `SameSite=Strict`，仍采用 double-submit 的 CSRF 防护。** 这个属性本身就能阻止浏览器在来自其他站点的请求中附带 cookie，从而封住这些路由上的 CSRF。第二层是为它覆盖不到的三种情况买单：忽略该属性的浏览器、被攻陷的子域（在 cookie 意义上属于"same site"），以及哪天有人因为某个重定向流程需要放宽到 `Lax`。这一对是一个 JS 可读的 cookie（`brabo_csrf`），回显在 `X-CSRF-Token` 中：来自其他源的人无法**读取**该 cookie，因此无法构造请求头。

CSRF 失败是 **403，而不是 401**：401 意味着"你的凭据不可用"，客户端会尝试续期会话，从而陷入循环。

### single-flight 的 refresh 是需求，不是优化 {#refresh-em-single-flight-é-requisito-não-otimização}

ADR 0031 已经记录过这一点，这里将其实现：所有调用方共享一个进行中的 promise。

没有它，系统会因正常使用而把用户登出。两个同时得到 401 的调用会触发两次 refresh；第二次会出示第一次已经消费掉的 token——在服务端看来，这**恰恰**就是盗用的特征。family 被吊销，用户因为并行发起了两个请求而回到登录页。

### 已迁移用户无法被区分 {#o-usuário-migrado-não-é-distinguível}

从 Keycloak 导入的账户（存在于 `users`，在 `auth_credentials` 中没有行）登录时返回**统一的 401**，与不存在的邮箱完全相同，并静默发送"设置密码"链接。

返回一个明确的 `password_pending` 是显而易见的 UX，但已被排除：它会确认该地址存在**并且**是遗留账户——这是系统中最有价值的枚举信号，也正是 [RN-032](../business-rules/autenticacao.md#rn-032) 要封住的。

为了让三种结局的开销相同，`findByEmail` 改成了从 `users` 到 `auth_credentials` 的 LEFT JOIN：只有一次查询。两次串联查询会让待定分支多一次数据库往返，计时就能区分已迁移账户和不存在的邮箱。

"待定"是**派生**状态，不是列：不存在会失去同步的 `password_pending`，迁移脚本的幂等性也随之免费得到。

### 迁移不连接 Keycloak {#a-migração-não-conecta-no-keycloak}

因为没有东西可导入。从 Fase 1 起，`JwtAuthGuard` 每个请求都会把每个用户 upsert 到 `users`——id、邮箱和 RBAC 关联一直都在 api 的数据库里。Keycloak 从来不是 RBAC 的事实来源；它只是 token 的签发方。这些账户缺的是一个密码，而这它也给不了（密码哈希不迁移，CLAUDE.md 的决定）。

## 后果 {#consequências}

**release 时所有人都会被登出。** 这是原子切换公开声明的代价，并作为不兼容变更写进了 CHANGELOG。

**"设置密码"链接出现在 api 日志中，而不是收件箱。** `MailSender` 仍然只写日志，真实 SMTP 仍是未来的配置。对单一所有者的安装来说这已足够；runbook 解释了如何通过 `AUTH_MAIL_LOG_TOKENS=true` 提取它们。这是本次交付最明显的局限。

**轮换 `AUTH_TOKEN_PEPPER` 或 `BRABO_SERVICE_TOKEN` 的效果相反，且同样突然。** 前者登出所有人并使未用的链接失效；后者如果只在一侧执行，会切断内部流量。两者都写在 runbook 中，并把 `_PREVIOUS` 记录为无停机执行的方式。

**web 无法说"该邮箱已被使用"。** 这是继承自 ADR 0031 的后果，现在有了界面：表单写的是"如果该地址可用"。

**冒烟测试依赖一个预置的用户。** 没有外部 IdP，就不再有现成的凭据，而通过 API 注册会碰上邮箱验证。`bootstrap.sh` 运行 seed，它创建一个密码已知、邮箱已验证的账户——并且 `provisionarUsuario` **拒绝在 `NODE_ENV=production` 下运行**，除非显式覆盖。它是开发工具，并在代码中如此标注。

**`users.keycloak_sub` 仍留在 schema 中**，背后已没有任何签发方。这是有意识的债务，有目的（§ 决策），也有期限：移除它的迁移在切换稳定之后进入。

**公开暴露面没有变化。** 仍是 12 条路由，26 条 `engine-service` 仍是 26 条——`route-surface.spec.ts` 以空 diff 结束，这是预期结果，也证明 controller 的契约没有被触碰。

### 验证了什么，没验证什么 {#o-que-foi-verificado-e-o-que-não-foi}

RBAC 矩阵由三道锁证明：`decide.spec.ts`（24 个用例）和 `resolve-effective-role.use-case.spec.ts` 保持**不变且通过**；`route-surface.spec.ts` 以空 diff 结束；两个新的 spec——`roles.guard.spec.ts`（逐项写出的 4×4 矩阵）和 `jwt-auth.guard.spec.ts`（断言 `users` 中不出现任何新行）——覆盖了身份 → `user.id` 这一跳，它此前没有任何测试，也是切换唯一触及的点。

**本次交付没有运行 engine 的测试套件。** 所用的开发环境无法访问 `hex.pm`（网络策略封锁），没有 `mix deps.get` 就没有 `mix compile` 也没有 `mix test`。Elixir 代码已编写，并对每个修改的文件做了语法分析；真正的执行发生在有网络的 CI 中。它被记录在这里而不是被省略，因为这正是 ADR 0020 规定绝不能用排除法诊断的那类缺口。

### 有意识的 backlog（再次确认） {#backlog-consciente-reafirmado}

切换完成后，以下仍在范围之外：**MFA**（TOTP、WebAuthn）、**社交登录**、**OIDC 联合**以及**api 作为 OIDC 提供方**。另外加上：真实 SMTP、泄露密码字典、argon2 的机会性重新哈希、认证表的清理，以及移除 `users.keycloak_sub` 的迁移。

凭据版本 claim——它能让 access token 可被吊销——被附注了一个新细节：本次切换中 `JwtAuthGuard` **不再**对每个请求做写入，因此"反正都要访问数据库"这个让它变便宜的论据不再成立。如果它重新被提上议程，要凭自身的价值。
