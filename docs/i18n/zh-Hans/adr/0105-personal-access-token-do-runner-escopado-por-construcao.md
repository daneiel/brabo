---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0105 — 给 runner 的 Personal Access Token（`brb_…`），按构造限定到一条路由

- **状态：** 已接受
- **日期：** 2026-08-22
- **背景：** [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md) 的 backlog
  （“长期账户令牌（PAT）取代登录重放……在分发**之前**”），RN-424/425/426
- **伴随：** [ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md)

## 背景 {#contexto}

`apps/runner/src/auth.ts` 手工复刻了浏览器自动完成的事情：首次运行时交互式输入电子邮件/密码，提取 cookie
`brabo_refresh`/`brabo_csrf` 并持久化到
`~/.brabo/runner-credentials.json`，每次尝试重连时通过 `/auth/refresh` 续期。ADR 0103 本身已把这记录为“用现有东西能做到的方式”，并在代码中标注为要替换的模块。`npm publish @brabo/runner` 从未运行过——在这种状态下发布 CLI 就会分发一个把密码+cookie 保存在磁盘上的流程，这正是本次交付要关闭的阻塞。

考虑过并放弃了两个现有机制：

- **`account_tokens`**——为**一次性**的邮件链接而建（验证、密码重置、从 Keycloak 迁移后的初始密码）。它没有每个用户多个活跃令牌的概念，也没有限定到某个资源的概念——复用它需要把表和用例扩展成不属于它的格式。
- **refresh token 的家族轮换**——refresh 在每次使用时被**消耗**并重新签发，检测到重用时撤销整个家族（ADR 0031）。PAT 恰恰相反：按设计被**不变地**重复出示（这正是让用户把值粘贴到 `--token` 一次、之后再也不碰的原因）。继承轮换模型会凭空发明一个 PAT 不需要的保证，并让本应简单的东西毫无收益地复杂化。

## 决策 {#decisão}

**新表 `personal_access_tokens`**（迁移 `0049`）：`id`、
`user_id`、`project_id`（NOT NULL——本次交付需要的唯一作用域格式）、`name`、`token_hash`（唯一索引）、可选的 `expires_at`、`revoked_at`/`revoked_reason`、`last_used_at`、`created_at`。
**没有 `scope_kind` 列。** 一个今天只填充一个值的枚举毫无价值——如果将来出现非项目的作用域格式，`project_id NOT NULL` 无论如何都不适用，表在那里也需要自己的迁移。把枚举推迟到第二种格式成为已排期的真实工作的那一天，而不是之前。

**哈希：通过 `hashDeToken()`/`TokenFactory` 的 HMAC-SHA256 + pepper，而不是 argon2。** 产品对**高熵**秘密（256 位 CSPRNG）的真实模式早已如此——与 refresh token 和 account token 的机制相同。argon2 留给**低熵**秘密（密码），那里抵抗字典攻击很重要；在这里使用它只会破坏按索引的查找 `WHERE token_hash = $1`，而毫无收益，因为对一个由 CSPRNG 生成的 256 位值没有字典可抵抗。原始令牌是 `brb_<32 bytes em base64url>`；哈希基于**带**前缀的字符串计算（`hashDe('brb_' + bruto)`），而不是基于 `TokenFactory.gerar()` 返回的值——那个哈希是不带前缀计算的，会是错误的哈希。

**核心的安全决策：PAT 永远不会在 `POST /projects/:projectId/runner-ticket` 之外的任何路由上认证，这是按**构造**实现的——而不是靠一个明天新路由可能忘记检查的 `if`。**

更简单的备选方案——全局 `JwtAuthGuard` 识别前缀 `brb_` 并为**任何**路由填充 `request.user`——被考虑过并被拒绝：一旦设置了 `request.user`，`RolesGuard`/`@RequireRole` 就会在 api 其余部分中按用户真实角色所允许的一切授权这个 PAT。“只请求 runner ticket”的作用域会变成装饰——一个泄露的 PAT 会作为完整会话生效。

出路镜像了代码中针对同一结构问题（不应经过标准用户认证的流量）早已存在的模式：`IS_SERVICE_ROUTE_KEY`/`@ServiceRoute()`/`EngineServiceGuard`。在 `JwtAuthGuard` 中现有的两个分支旁边增加了第三个分支 `IS_PAT_ROUTE_KEY`/`@RequirePatAuth()`：当它被设置时，全局 guard 不尝试 JWT 的 `verify()` 就返回 `true`，完全委托给路由级的 `PatAuthGuard`（`@UseGuards(PatAuthGuard)`），后者只在 `runnerTicket` handler 上运行——从不在 `terminalTicket` 上，后者仍然只接受会话 JWT（web 中没有任何地方调用 `runner-ticket`；只有 CLI 调用）。

`PatAuthGuard` 提取 bearer；如果不以 `brb_` 开头，401——在这条路由上从不尝试与 JWT 双重认证。它调用
`PersonalAccessTokenRepository.validarEUsar(hash)`：**一个**查询
`UPDATE ... WHERE token_hash = $1 AND revoked_at IS NULL AND
(expires_at IS NULL OR expires_at > now()) RETURNING id, user_id,
project_id`，与 `AccountTokenRepository.consumir()` 同一模式。零行同时覆盖“不存在”“已撤销”和“已过期”，返回**相同**的响应（401）——不让出示被盗/过期令牌的人知道是三者中的哪一个。项目作用域错误（返回的 `project_id` ≠ 路由的 `:projectId`）是 403，属于不同类别：令牌认证成功了，只是无权访问**这个**项目。

`last_used_at` 在同一个验证查询中**无条件**执行 `SET ... = now()`——没有节流。考虑过的备选方案（只在“NULL 或早于 5 分钟”时更新，并把这个条件放在**同一个** `WHERE` 中）有一个真实的 bug：5 分钟内被重复出示两次的 PAT，第二次会落在 `WHERE` 之外，查询会对一个**有效**令牌返回零行——以 401 拒绝一次正当的重连（runner 的重试循环在几秒内重连，而不是几分钟）。不节流的成本是按唯一索引的一行 `UPDATE`；真实的最坏情况（连续最多 10 次尝试，runner 的上限）远未构成负载问题。更简单，也没有这一类 bug。

`RolesGuard`/`ResolveEffectiveRoleUseCase` 继续在 `PatAuthGuard` 之后运行，不变——双重保险：如果 PAT 的所有者通过正常途径（`ProjectMember`/workspace）失去对项目的访问，令牌即使没有被显式撤销也会停止授权。

**签发/列出/撤销限定在**用户自己**的范围**，放在查询的 `WHERE` 中——绝不是取出全部后在内存中过滤。由 `maintainer` 撤销**其他**用户的 PAT（事件响应——离职的开发者令牌泄露）不在本次交付中，已声明。

## 后果 {#consequências}

- 解锁 ADR 0104 backlog 的下一行：`npm publish
  @brabo/runner` 不再分发把密码+cookie 保存在磁盘上的流程。`apps/runner/src/auth.ts` 完全失去交互式登录、cookie 和凭据文件——PAT 通过 `--token`/`BRABO_ACCOUNT_TOKEN` 现成地到达，CLI 从不把它写到磁盘上。
- `route-surface.spec.ts` 继续把 `runner-ticket` 归类为 `role:developer`——正确，这是一贯的同一角色要求，只是建立身份的机制变了。`docs/security-surface.md` 增加了一段说明这条路由只接受 PAT 的文字，因为自动表格不区分这两种机制。
- engine（Elixir）中没有任何变化——所有工作都在 api + runner + web + docs 中。
- 一个用户可以在同一项目中同时拥有多个活跃的 PAT（每台机器一个，刻意如此）——与 `account_tokens` 不同，不存在取代：签发新的不会使之前的失效。
