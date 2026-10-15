---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0096 — `MailSender` 中的真实 SMTP，置于显式开关之后

- **状态：** 已接受
- **日期：** 2026-08-18
- **先前背景：** [ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
  （只写日志的 `MailSender` 诞生于此）、[ADR 0032](0032-corte-do-keycloak-e-sessao-em-cookie.md)
  （把“真实 SMTP 仍是未来的配置”登记为已接受的后果）、[ADR 0059](0059-segredo-do-state-de-oauth-sem-default.md)（本 ADR 复用的生产环境秘密验证模式）

## 背景 {#contexto}

自第 7a 阶段起，`MailSender`（`apps/api/src/application/ports/mail-sender.port.ts`）只有一个实现，`LogMailSender`：电子邮件验证、密码重置、初始密码设置（从 Keycloak 迁移的账户）以及重复注册提醒从不离开 api——只进入日志。这足以端到端证明认证流程，但自那以后在 `docs/explanation/backlog.md` 中留下了一个开放项：“MailSender 中的真实 SMTP”。

这一项不是新功能——而是关闭一个已登记的缺口，其 port 自移除 Keycloak 起就已准备好：`MailSender.enviar(email)` 对传输方式不带任何主张，只关心 payload（`para`/`tipo`/`token?`/
`expiraEm?`）。真正的工作是 SMTP 实现，以及决定**如何**开启它而不破坏今天已经在运行产品的人。

## 决策 {#decisão}

### `nodemailer`，通过纯 SMTP 传输 {#nodemailer-via-transporte-smtp-puro}

`createTransport({ host, port, secure, auth })`。与产品其余部分集成的基于 HTTP 的 JSON API（LLM provider，基于纯 `node:http`——ADR 0041）不同，SMTP 是有状态的**行**协议，带有 MIME、STARTTLS 和多种 AUTH 机制。手工重新实现它就是在没有任何收益的情况下重新发明一个对安全敏感的轮子。`nodemailer` 是 Node 生态的事实标准，没有 provider SDK（SES/SendGrid/
Mailgun），也没有沉重的依赖树——自身零依赖。

### `MAIL_TRANSPORT`：显式开关，绝不推断 {#mail_transport-toggle-explícito-nunca-inferência}

`log`（默认，**包括在生产中**）或 `smtp`。真正发送电子邮件是操作员的 opt-in——没有显式的 `MAIL_TRANSPORT=smtp`，行为与今天完全相同，即使在生产中，已经在运行产品的人升级时也不会出问题。`docker-compose.prod.yml`/
`docker-compose.yml` 对五个 `SMTP_*` 变量都没有任何公开的回退值：每个在缺失时解析为空字符串
（`${SMTP_HOST:-}`），与 `AUTH_JWT_SECRET`/`BRABO_SERVICE_TOKEN` 在那里已使用的模式相同。

### 按 RN-114 的模式验证，有一处不同 {#validação-no-padrão-da-rn-114-com-uma-diferença}

原始的 RN-114（`AUTH_JWT_SECRET`、`BRABO_SERVICE_TOKEN`、
`CREDENTIALS_MASTER_KEY`、`SECRET_KEY_BASE`）在生产中让启动失败，因为这些变量**有**一个公开的开发默认值，而“非空”抓不住这个缺陷。这里不存在这样的默认值：没人设置时 `SMTP_HOST` 就是空的。这把尺子（缺失/只有空格/仓库示例值/格式无效）只在 `NODE_ENV=production` 时应用——在生产之外，没有变量的 `MAIL_TRANSPORT=smtp` 不会让启动失败，因为这是一条 opt-in 路径，开发者可能正针对本地 SMTP（例如 MailHog）测试而尚未定义值。

`apps/api/src/infrastructure/mail/smtp-config.ts`（`resolverConfigSmtp`）
遵循与 `apps/api/src/infrastructure/security/
auth-key-material.ts`/`service-token.ts` 相同的格式：当模式为 `smtp` 时，`SMTP_HOST`/`SMTP_USER`/
`SMTP_PASSWORD`/`SMTP_FROM` 在生产中是必需的；`SMTP_HOST` 如果等于 `.env.example` 中（注释掉的）公开字面值也会被拒绝；`SMTP_FROM` 必须匹配
`"Nome <email@dominio>"` 或 `email@dominio`。`SMTP_PORT`（默认 `587`）和
`SMTP_SECURE`（默认 `false`）不是秘密——它们有**产品**默认值而不是开发默认值，不经过“生产中必需”的尺子。

验证在 `SmtpMailSender` 的构造函数内运行，在 `AuthUseCasesModule` 的 `useFactory` 中被演练——而不是像 RN-114 的四个秘密那样在 `main.ts` 中的急切调用中。这一差别是刻意的：`AuthUseCasesModule` 被无条件导入（经由 `AuthHttpModule`），`useFactory` 在 `NestFactory.create()` 期间解析 `MailSender`，因此验证仍然发生在**启动**时——只是不在启动之前，因为只有在操作员选择了 `smtp` 时它才重要。这与 `CREDENTIALS_MASTER_KEY` 已采用的设计相同（在 `EnvelopeEncryptionService` 的构造函数中验证，由 provider 图的组装来演练）。

### 通过 `useFactory` 选择 {#seleção-via-usefactory}

`AuthUseCasesModule` 把 `{ provide: MailSender, useClass: LogMailSender }` 换成一个读取 `resolverModoDeTransporte()` 并实例化
`SmtpMailSender` 或 `LogMailSender` 的 `useFactory`。没有任何用例（`RegisterUseCase`、
`RequestPasswordResetUseCase`、`LoginUseCase`、脚本
`migrate-keycloak-users.ts`）改变——它们都继续注入 `MailSender` 并调用 `.enviar()`。

### 正文为纯文本，绝不是 HTML {#corpo-em-texto-puro-nunca-html}

port 不携带富正文的结构，而模板引擎会是一个注入/XSS 面，换来的收益没人要求过。每个 `tipo` 有一段固定的 pt-BR 文本，在合适时带上链接，由
`WEB_ORIGIN`（与 `auth.controller.ts`/`git.controller.ts` 已为重定向所做的同样的原始读取）+ 正确的 web 路由 + `?token=` 组装而成。

### 原始 token 和正文永不进入日志 {#o-token-bruto-e-o-corpo-nunca-vão-para-o-log}

与 `LogMailSender` 同一把尺子：发送成功和失败都只引用 `tipo` 和收件人，绝不引用 token 或邮件文本。

### 验证链接的缺口，一并关闭 {#a-lacuna-do-link-de-verificação-fechada-junto}

在实现之前调查调用点时发现：web 路由 `/definir-senha` 已经存在并服务于 `password_reset`/`set_initial_password`
（`SetPasswordPage.tsx`），但**没有为 `email_verification` 准备的路由或界面**——api 已经暴露了 `POST /auth/verify-email`，web 客户端（`apps/web/src/lib/auth.ts`，`verificarEmail`）也已存在，但没有任何调用者。在 `LogMailSender` 下，这个缺口是看不见的：链接从未离开日志，也没人点击它。有了真实 SMTP，邮件会带着一个死链接到达。

`/verificar-email?token=...`（`VerifyEmailPage.tsx`）关闭了这一点，镜像
`SetPasswordPage.tsx`/`setPasswordRoute`：在 `router.tsx` 中采用相同的 `validateSearch` 模式，对不存在/已过期/已使用的链接给出相同的单一响应，以及同样不让任何人登录的结局——只是这里没有表单：确认在挂载时自动触发（用户没有任何数据可填），因此界面需要 RN-088 的三种状态（加载/错误/成功），而不只是两种。

## 后果 {#consequências}

**刻意不破坏任何东西。** 未设置 `MAIL_TRANSPORT`——在任何环境中，包括生产——保持今天的行为（只写日志）。想要真正邮件的人做一次显式 opt-in，并在生产中运行时让五个变量在启动时接受验证。

**新的生产依赖：** `nodemailer`（+ 作为 dev dependency 的 `@types/nodemailer`）。自身零传递依赖。

**新的基础设施秘密：** `SMTP_PASSWORD`——与
`AUTH_JWT_SECRET`/`GIT_OAUTH_STATE_SECRET` 同一家族（简单的环境变量，在启动时验证），而不是用户秘密（不经过
`EncryptionService`/信封加密，那只用于按**登记**存放在数据库中的 LLM/git 凭据）。

**在敏感的认证流程中出现新的外部网络路径**——RN-030 到 RN-033（防枚举）保持不变：SMTP 实现不改变**任何**调用点，也不改变用例决定发送的 payload，只改变投递。

**登记在此，不在此关闭：** 对于在 SMTP 发送时失败的邮件（超时、凭据被提供方拒绝），不存在重试机制。`LoginUseCase.enviarDefinicaoDeSenha` 早已刻意吞掉失败（不改变 HTTP 响应）；`RegisterUseCase`/
`RequestPasswordResetUseCase` 会传播异常，SMTP 提供方宕机就会在认证路由上变成 500。这对 `MailSender` 的任何同步实现早已成立，本实现并没有让它更糟——发送用的 outbox/队列，如果某天需要，是单独的产品决定，不在本 ADR 范围内。
