---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0084 — 社交登录（GitHub/GitLab），修订 ADR 0031/0032 的 backlog

## 背景 {#contexto}

ADR 0031（first-party 认证）和 ADR 0032（移除 Keycloak）明确把**社交登录**放进有意识的 backlog：“Keycloak 提供过它们，但没人使用；现在重新实现就是在没有需求的情况下付出成本。”`CLAUDE.md` 把这一决定变成了永久禁令——“不要实现（……）社交登录”——`docs/explanation/backlog.md` 自 FASE 13c 起一直把这一项保留为开放的待办。

产品负责人明确要求了这条战线，并清楚其中涉及的安全后果，因此该禁令**针对这条战线**被撤销——而不是追溯地针对 MFA、OIDC provider 或联合认证，它们仍然不在范围内（见“后果”）。

产品已经拥有该机制的**两**块，用于两个不同目的：

1. **First-party 认证**（ADR 0031/0032）：`EmitirSessaoUseCase` 在身份已解析之后打包 access（Ed25519，短期）+ refresh（不透明，带家族的轮换）这一对——今天由 `LoginUseCase` 和 `RegisterUseCase` 使用。
2. **GitHub/GitLab 的 OAuth**（第 2 阶段，ADR 0059）：`GitOauthClient`
   （`buildAuthorizeUrl`/`exchangeCode`）、`GitOauthClientRegistry`、由 `GIT_OAUTH_STATE_SECRET` 签名的 `signOauthState`/`verifyOauthState`
   ——但用于**把 git 凭据连接到一个已经认证的用户的项目**（`StartGitOauthUseCase` 需要 `projectId` 和 `userId`）。

这条战线的工作是把两者连接起来，**而不**发明第三种会话格式，也不混淆 `state` 的两种用途。

## 决策 {#decisão}

### 1. 会话签发机制被复用，没有例外 {#1-o-mecanismo-de-emissão-de-sessão-é-reusado-sem-exceção}

`SocialLoginCallbackUseCase` 最后调用的是与 `LoginUseCase`/`RefreshUseCase` 使用的**同一个** `EmitirSessaoUseCase`。对于通过 GitHub/GitLab 进入的人，不存在第二种令牌、cookie 或 claim 格式——通过密码登录的会话与通过 OAuth 登录的会话在签发后**无法区分**。

### 2. OAuth 客户端被复用；`state` 的用途**不**复用 {#2-o-cliente-oauth-é-reusado-o-propósito-do-state-não}

`GitOauthClient` 增加了两个新方法——
`buildLoginAuthorizeUrl`/`fetchIdentity`——由 git 连接流程的**同一个**
`GithubOauthClient`/`GitlabOauthClient` 实现。
`exchangeCode` 原样复用。

**不**复用的是 `state` 的签名。`domain/auth/social-oauth-state.ts`
是一个**专属**模块，其 payload 在结构上不同
（`{purpose: 'social_login', provider, nonce, expiresAt}`，没有 `projectId`
也没有 `userId`——社交登录没有“在哪里”，只有身份），以及一个在任何其他字段**之前**检查的**用途**判别值
（[RN-273](../business-rules.md#rn-273)）。git **连接**流程的 `state`，即使由**同一把**密钥签名，在这里也不被接受——测试套件证明了重要的那个方向（git-connect state → 社交登录验证器）：在**登录**回调中接受那个 `state` 意味着以别人的 `userId` 登录，纯粹的权限提升。

HMAC 密钥仍然是 `GIT_OAUTH_STATE_SECRET`
（`resolveOauthStateSecret()`）——**没有新的环境变量**。复用密钥是安全的，因为区分两种用途的是 payload 的结构不兼容，而不是秘密本身。

### 3. 登录专属的最小作用域 {#3-escopo-mínimo-próprio-do-login}

`buildLoginAuthorizeUrl` 请求 `read:user user:email`（GitHub）和 `read_user`
（GitLab）——绝不请求连接流程的 `repo`/`api`。登录账户不应授予对任何仓库的访问
（[RN-277](../business-rules.md#rn-277)）。

### 4. 新表：`social_identities` {#4-tabela-nova-social_identities}

迁移 `0047`。`users` 中的专用列被拒绝，原因 `keycloak_sub` 已经教过：每个遗留 provider 一列无法扩展到**两个**同时存在的 provider（一个用户可以同时通过 GitHub 和 GitLab 登录）。`(provider, provider_user_id)` 唯一；`provider_user_id` 是 provider 的**数字** id，绝不是登录名/电子邮件——它们可能换主人
（[RN-276](../business-rules.md#rn-276)）。`user_id` 为 `NOT NULL`：关联在解析身份的**同一步**中诞生，没有“没有主人的身份”这一中间状态。

### 5. 回调的三个决定，按顺序 {#5-as-três-decisões-do-callback-em-ordem}

`SocialLoginCallbackUseCase` 按以下顺序决定
（[RN-272](../business-rules.md#rn-272)）：

1. **已知身份**（`(provider, providerUserId)` 在
   `social_identities` 中）→ 直接登录。
2. **新身份，电子邮件匹配现有账户，且 provider 将该电子邮件标记为已验证** → 关联并登录
   （[RN-274](../business-rules.md#rn-274)）。关联就是账户合并——**provider** 的验证起到了密码注册中点击验证链接的作用，因此作为副作用，一个通过密码注册且从未验证的账户在关联后 `emailVerifiedAt` 会被填上（[RN-279](../business-rules.md#rn-279)）：provider 刚刚通过一条独立路径证明了那次点击所要证明的事情。
3. **新身份，电子邮件匹配但未验证** → 拒绝
   （`403`）。在 OAuth provider 中键入（未验证）的电子邮件不是拥有权的证明——在这里接受就会打开账户接管：在 Brabo 拥有 `alguem@empresa.com` 的人并没有要求让一个仅键入了该地址的他人 GitHub 继承这个账户。
4. **新身份，没有对应账户** → 配置一个**新**用户，**没有密码**——复用 Keycloak 迁移已经留下的**同一个**“待定”状态（`users` 在 `auth_credentials` 中没有行，
   [RN-278](../business-rules.md#rn-278)）。这里电子邮件**不**需要已验证（[RN-275](../business-rules.md#rn-275)）：没有可接管的现有账户，只有一个将要诞生的账户，要求验证只会让常见情况变贵而保护不了任何东西。`LoginUseCase` 和
   `ResetPasswordUseCase` 已经知道如何处理这种状态——社交账户免费获得“忘记密码”，无需第二种机制。

### 6. 回调从不在 URL 或正文中暴露令牌 {#6-o-callback-nunca-expõe-token-na-url-nem-no-corpo}

`GET /auth/oauth/:provider/callback` 写入会话 cookie
（`definirCookiesDeSessao`，与密码登录**相同**的函数）并重定向到 `WEB_ORIGIN/`。`access token` 不经由 URL 传输：web 的启动
（`restaurarSessao()`，在**每次**页面加载时调用，`apps/web/src/main.tsx`）已经会把刚写入的 refresh 换成 access token——客户端除了两个按钮和错误路由别名之外零新代码
（[RN-282](../business-rules.md#rn-282)）。失败跳转到
`WEB_ORIGIN/login?oauth_error=1`，不细说原因——与 git 连接回调同一模式（[RN-283](../business-rules.md#rn-283)）。

### 7. 复用**同一个** OAuth 应用——没有新的环境变量 {#7-reuso-do-mesmo-app-oauth--sem-variável-de-ambiente-nova}

`GITHUB_OAUTH_CLIENT_ID`/`_SECRET` 和 `GITLAB_OAUTH_CLIENT_ID`/`_SECRET`
仍然是已为 git 连接注册的应用的那些。按流程变化的是 `redirect_uri`（`/auth/oauth/<provider>/callback` 而不是
`/git/oauth/<provider>/callback`）和请求的 `scope`——两者都在请求时决定，而不是在配置时
（[RN-281](../business-rules.md#rn-281)）。**操作员的动作仍然必要**：第二个回调 URL 需要在每个 provider 的 OAuth 应用中注册（记录在 `.env.example` 中）——正是这一要求，而不是新的环境变量，使分支以 `breaking/` 诞生成为合理。

## 后果 {#consequências}

- **两条新的公开路由**（`GET /auth/oauth/:provider/start`、
  `GET /auth/oauth/:provider/callback`），在
  `docs/security-surface.md` 中说明理由，并由 `route-surface.spec.ts` 覆盖——公开暴露面从十二条变为十四条路由。
- **`social_identities` 是一张新表**，没有软删除也没有历史：解除身份关联（撤销通过 GitHub/GitLab 的访问而保留账户）在这条战线中没有 UI 也没有路由——backlog。
- **只有 GitHub 和 GitLab。** 没有通用 OIDC provider，没有 SAML 联合——ADR 0031/0032 的 backlog 对 **MFA**、**通用 OIDC 联合**和**作为 OIDC 提供方的 api** 仍然有效。本 ADR 修订的**只是**该列表中的“社交登录”一项，并且只针对已注册了 `GitOauthClient` 的两个 provider。
- **`emailVerified` 依赖 provider 说真话。** GitHub 把电子邮件和验证分在两次调用中（`/user` 和 `/user/emails`）；GitLab 把验证嵌在**账户**的 `confirmed_at` 中。两者按产品决定被视为等价——在 Brabo 一侧，除了信任 provider 的响应之外，两者都无法审计。
- **仅社交的账户从不经过密码登录的锁定桶**（RN-030/031）：没有可以拦截的密码尝试。拦截它的是 provider 一侧的 OAuth 握手本身。
- **`CLAUDE.md` 需要删除“O que NÃO fazer”一节中的“不要实现（……）社交登录”这句话**——本 ADR 不编辑它（留给本波次收尾的 PR，与其他战线一起）。
