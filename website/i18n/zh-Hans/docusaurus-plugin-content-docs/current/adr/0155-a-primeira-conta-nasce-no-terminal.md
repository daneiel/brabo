---
traducao_de: 7bb8172e06f04a3473660371149177023de99b0a
---

# 0155 — 第一个账户在终端中诞生，本地 agent 启动时即已配对

## 状态 {#status}

**已接受**，2026-09-27（AT-108），在实现之后——与 [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) 的路径相同。它在 FASE 30 的第 1 次会话（2026-09-11）中以 `Proposed` 诞生，并在第 2 至第 8 次会话中由 RN-543..552 演练（在干净机器上的 E2E，RN-549，是端到端的证明），收尾记述在 [historico-de-fases.md](../explanation/historico-de-fases.md) 和 [fase-30-runner-por-maquina.md](../explanation/fase-30-runner-por-maquina.md) 中。下文与代码有分歧之处，决策**没有**被重写：分歧在末尾的"接受说明"中具名列出。

这是 [FASE 30](../explanation/fase-30-runner-por-maquina.md) 两项决策中的第二项。它依赖 [ADR 0154](0154-chave-de-dispositivo-de-maquina.md)：没有机器身份，这里就没有可注册的东西。

## 背景 {#context}

`install.sh` 结束时 compose 已经运行，runner 的二进制文件已在磁盘上。用户打开浏览器，看到的是一个**谁都不存在**的安装中的登录界面。

而在新安装中，离开那里的路是断的。测得：

- 安装程序生成的 `.env` **没有任何**邮件变量（`install.sh`，写入十一个键的 heredoc）；
- `MAIL_TRANSPORT` 落到默认值 `log`（`docker/docker-compose.install.yml:200`），compose 在旁边的注释里说 *"即使在这里，行为仍然只写日志"*；
- 注册要求验证邮箱，而 `apps/api/src/scripts/provisionar-usuario.ts` 的 docblock 早已把后果清清楚楚地写下：*"正常的注册流程要求验证邮箱——在 `MailSender` 只写日志的情况下，它不会自行完成"*。

也就是说：通过一行命令安装的人去注册，什么都收不到，唯一的出路是去 `docker compose logs api` 里捞链接。一个以"完成"结束、却不让任何人进入的安装。

`provisionarUsuario` 正是为这个缺口而存在的——它创建一个密码**已经验证**的用户——今天它有两个调用方：演示 seed 和冒烟测试。两者都不是真正的安装。

## 决策 {#decision}

**安装程序在终端中经明确同意创建第一个账户，并启动已经配对的本地 agent。**

### 1. 只有**第一个**账户，并且只在一个都没有时 {#1-só-a-primeira-conta-e-só-quando-não-há-nenhuma}

当安装中没有任何用户时，这一步才运行。只要有任何一个，安装程序就**不提供**——它不是账户创建器，而是新安装的收尾。在迁移中（RN-530），用户随还原而来，这一步按同样的标准保持沉默。

路由是内部的，并以 `BRABO_SERVICE_TOKEN` 认证——安装程序刚刚生成并以 600 权限写入 `.env` 的同一个密钥——如果已存在用户就拒绝。不会诞生"创建第一个 owner"的公开路由：一个创建 owner 的公开路由，就是安装者与扫描端口者之间的赛跑。

### 2. 不验证邮箱，而理由正是授权的依据 {#2-sem-verificação-de-e-mail-e-o-motivo-é-o-que-autoriza}

账户通过 `provisionarUsuario` 以已验证状态诞生。这并不放宽正常的注册，后者逐字节保持不变：邮箱验证证明的是 *"此人控制这个邮箱"*，而运行安装程序的人已经证明了更强的东西——**控制这台机器**、带有五个密钥的 `.env` 以及 Docker 守护进程。通过一个安装明知已关闭的渠道向此人索要更弱的证明，是走过场。

安装程序在输出中**说明**这一点，而不是让用户自己发现其账户与其他账户不同。

### 3. 同意是明确的，没有 TTY 就不执行这一步 {#3-o-consentimento-é-explícito-e-sem-tty-o-passo-não-acontece}

与 RN-511 和 `consentir-base.mjs` 同一把尺子：这一步**询问**邮箱和密码，没有交互式终端时就**报告**而不是替人决定。不存在账户以脚本选择的密码诞生的路径——既不生成，也没有默认值。

密码以无回显方式读取并确认。最低拒绝条件（长度）与领域层相同，由同一段代码调用；安装程序不携带第二把密码尺子，那会产生分歧。

### 4. 机器密钥在那里注册，服务带着它启动 {#4-a-chave-de-máquina-é-registrada-ali-e-o-serviço-sobe-com-ela}

账户创建后，安装程序注册一个机器设备密钥（ADR 0154），写入内含 `kid` 的私钥（RN-475，正是这个缺陷让自动模式从未认证成功），并安装服务——ADR 0154 第 4 点的**按机器** unit。

密钥对**在机器上**生成；私钥从不传输。这与浏览器的设计相同（ADR 0118），出于同样的原因，并让 RN-519 用来拒绝 `maintainer` 视图的那句话保持为真：*"设备密钥的私钥从不离开浏览器"*——变成"从不离开机器"。

> **在实现中细化（RN-552）。** 这一点没有说明安装程序用哪种凭据注册密钥，而两个候选都是真实的。路由——`POST /internal/machine-device-keys`——诞生时使用 **service token**，与第一个账户相同：是同一个安装程序，在同一分钟内，而这个 token 证明的是对**机器**的控制，正是这一步想证明的。另一种选择，即刚创建用户的凭据，会违背本 ADR 的第 5 点（*"安装程序不替任何人登录"*），并让在 TTY 中读取的密码有了第二种用途，而后果一节承诺它是*用完即弃*的。代价——泄露的 service token 能够**伪造**持久的访问凭据——在 `docs/security-surface.md` 中声明，路由中有三道约束：请求体中没有 `userId`（所有者是安装中**唯一**的用户，零个或多于一个时返回 `409`），注册会**替换**所有者现有的机器密钥（重新安装的机器可以通过；不会出现一千个密钥），而带有 `d` 的 JWK 会被按名拒绝而不是写入。是细化而不是违背，并且写成文字，因为本 ADR 当时仍是 `Proposed`：**已接受**的 ADR 永不编辑，新的引用旧的。

### 5. 服务在没有项目的情况下启动，这是正常状态 {#5-o-serviço-sobe-sem-projeto-e-isso-é-o-estado-normal}

安装好的 agent 查询 `GET runner/projects`（ADR 0154 第 3 点），什么也找不到，因为还没有项目。它**等待**，这不是错误：不发出失败，不以非零代码退出，`service status` 说"运行中，没有 runner 模式的项目"——这是 RN-518 已经区分的四种状态之一，而不是第五种。

当用户在 web 上创建第一个 `runner` 模式的项目时，agent 已经在那里了。这就是本阶段所追求的"之后再链接目录"，它通过 `workspace_create`（RN-532）发生，无需任何人回到终端。

## 本 ADR 明确拒绝的内容 {#o-que-este-adr-recusa-explicitamente}

- **在已存在账户时创建账户。** 见第 1 点。
- **第一个 owner 的公开路由。** 见第 1 点。
- **由脚本生成的密码，或默认密码。** 见第 3 点。一个替人选择密码的安装程序会产出密码相同的安装。
- **放宽正常注册的邮箱验证。** 第 2 点为一个具名的情形创建了一条路径；不触碰另一条。
- **自行开启 SMTP。** 安装程序不询问邮件服务器，也不写入 `MAIL_*`：`MAIL_TRANSPORT=log` 仍是声明的默认值，在这里和在生产中都一样。它所做的，是不再**依赖**它来完成安装。
- **索要 LLM 凭据。** 不在范围内：安装结束时即可使用，而 provider 的密钥由将要花钱的人决定（RN-058）。

## 后果 {#consequences}

- **一行命令的安装真正能够收尾**：结束时有账户、可以登录、本地 agent 在运行。今天它结束时是一个不读容器日志就没人能通过的登录界面。
- **安装程序开始处理一个密码。** 它以无回显方式读取、使用后丢弃——从不写入 `.env`，从不写入标记文件，从不写入日志。标记文件（`$XDG_STATE_HOME/brabo/`）增加了所创建 owner 的**邮箱**，那是身份标识而不是秘密，仅此而已。
- **生产中开始存在第二条创建用户的路径。** 它很窄（第一个账户、内部路由、service token），一旦安装中有了人就消失——但它是一个新的暴露面，并已声明。
- **`provisionarUsuario` 获得第三个调用方**，也是第一个不是测试自动化的调用方。它的 docblock 今天说它为 seed 和冒烟测试而存在；将会也说为了安装。
- **FASE 29 与自身保持一致。** 它拒绝一行安装程序 *"在工件签名之前"*，并在安装之前完成了签名；本阶段关闭的是另一端——安装不是交付字节，而是让它可用。

## 接受说明（2026-09-27） {#notas-de-aceitação-2026-09-27}

在接受时对照代码核对。决策保持原样；以下是文本与代码有分歧、并由代码解决的地方：

- **第 2 点与后果——"账户通过 `provisionarUsuario` 以已验证状态诞生"，它"获得第三个调用方"。** 文本没有面对 `provisionarUsuario` 脚本**拒绝**在 `NODE_ENV=production` 下运行这一点（`apps/api/src/scripts/provisionar-usuario.ts:37`），而安装程序恰恰运行在生产中。解决办法是把核心——让账户以已验证状态诞生的那三次写入——抽取到 `ProvisionarUsuarioUseCase`（`apps/api/src/application/use-cases/auth/provisionar-usuario.use-case.ts:43`），并把拒绝留在**脚本**中，它保护的正是脚本（无人工交互地创建已知密码）。获得新调用方的是这个用例，经由第一个账户的路由（`apps/api/src/application/use-cases/auth/criar-primeira-conta.use-case.ts:85`）；脚本仍然只有原来的两个调用方，seed 和冒烟测试，而 `BRABO_FORCE_SEED` **不是**安装程序的路径（RN-546）。
- **第 4 点——机器密钥用哪种凭据注册。** 在 `Proposed` 期间已在文本中细化：service token，通过 `POST /internal/machine-device-keys`（RN-552）。密钥对通过两条命令在终端中诞生，`brabo-runner device-key create` 和 `finish --id`，因为 `kid` 就是服务器上记录的 id，只有在注册之后才存在（RN-551）。
- **第 5 点——"不以非零代码退出"。** 零项目时的等待是存在的（RN-550，它修正了 RN-544 以 0 退出的行为，正是因为违背了这一点），但它有一个上限：连续**十次**查询没有有用的响应，此时 agent 以 1 退出并说出这个数字（`apps/runner/src/espera-de-projetos.ts:75`，退出在 `apps/runner/src/index.ts:1547`）。空列表不算失败——只有不响应的 api 才算。
- **第 5 点——"`service status` 说'运行中，没有 runner 模式的项目'"。** `status` 不知道项目：它根据磁盘和服务管理器回答，使用 RN-518 的四种状态（`apps/runner/src/servico.ts:246`），而在等待中的机器 unit 显示为 `rodando`。说"没有 runner 模式的项目"的是 agent 自己的**日志**（`apps/runner/src/index.ts:1529`）。没有第五种状态这一点得到满足；归于 `status` 的文字则没有。
