---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0118 — 通过浏览器配置 runner：Ed25519 设备密钥作为 `runner-ticket` 的第二种凭据、GitHub Releases 的二进制代理，以及用 File System Access API 一键配置文件夹

- **状态：** 已接受
- **日期：** 2026-08-27
- **背景：** 消除在用户机器上配置 `brabo-runner` 的摩擦——此前需要手动拼凑分散在不同界面上的三样东西：项目 id、文件夹路径，以及在第三个界面签发的 Personal Access Token
- **参考（不作编辑）：** [ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md)（runner 本身及其安全边界）、[ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)（`execution_mode: runner`，本 ADR 的设备密钥所补充的 PAT backlog 条目）、[ADR 0105](0105-personal-access-token-do-runner-escopado-por-construcao.md)（本决策**叠加**于其上、绝不替代的 PAT）、[ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md) 和 [ADR 0112](0112-binario-standalone-do-runner-via-bun-build-compile.md)（本 ADR 的代理所提供的独立二进制）、[ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md)（**通过**已连接的 runner 浏览文件夹——本 ADR 处理的是首先把 runner 连接起来）

## 背景 {#contexto}

`execution_mode: runner`（ADR 0104）允许项目代码存放在用户自己机器上的文件夹中，不用
bind-mount，也不用容器——但要达到这个状态，需要一个人手动完成：找到项目 id，在“项目设置 →
访问令牌”中生成 Personal Access Token（ADR 0105），复制一条有人正确键入的
`brabo-runner --project <id> --dir <path> --token <token>` 命令，自己为其操作系统/架构下载
正确的二进制，并从正确的文件夹运行它。三条信息，三个界面，还有一个用户必须在终端里键入或粘贴
的机密。

`NewProjectWizard.tsx` 和 `RunnerOnboardingPanel.tsx` 随着时间各自形成了**自己**的命令文本，
而两者出现了分歧——向导的那份从未包含 `--token`，面板的那份使用的是
`pnpm --filter runner start` 语法而不是二进制。写下时两者都没有错；没有任何东西强制这两个界面
保持一致，于是它们悄无声息地不再一致。

产品负责人也明确问过，runner 能否**自行发现**一个本地的 Docker/Kubernetes 容器并通过 SSH
连接，而不需要人经过任何配置。这条路在本次会话中被考虑过并被拒绝——见下文的“考虑过并被拒绝
的替代方案”。

## 决策 {#decisão}

### 1. 在浏览器中生成的 Ed25519 设备密钥是 `runner-ticket` 的第二种凭据——叠加于 PAT，绝不替代它 {#1-uma-chave-de-dispositivo-ed25519-gerada-no-navegador-é-uma-segunda-credencial-do-runner-ticket--soma-se-ao-pat-nunca-o-substitui}

新表 `runner_device_keys`（`apps/api/src/db/schema.ts:2058-2081`，
migration `0054_demonic_shiver_man.sql`）：`id`、`userId`（FK `users`，cascade）、
`projectId`（FK `projects`，cascade）、`name`、`publicKeyJwk`、`createdAt`、`revokedAt`、
`revokedReason`、`lastUsedAt`——浏览器用 `crypto.subtle.generateKey` 生成的 Ed25519 密钥对的
**公钥**一半（`apps/web/src/lib/runner-bootstrap.ts:123-131`）。私钥一半从不经由网络离开
浏览器；只有导出的公钥 JWK 通过 POST 发送给 `RegisterRunnerDeviceKeyUseCase`
（`apps/api/src/application/use-cases/auth/register-runner-device-key.use-case.ts`），
经由 `POST /projects/:projectId/runner-device-keys`
（`apps/api/src/interfaces/http/runner/runner-device-keys.controller.ts`）。
这个路由由**普通**会话 JWT 认证，`@RequireRole('developer')`——这里的调用者确实是已登录的
浏览器，在登记它即将配置的设备，是 `PersonalAccessTokensController` 签发 PAT 的镜像。
`RevokeRunnerDeviceKeyUseCase` 以与 `RevokePersonalAccessTokenUseCase` 相同的方式删除（标记
为已吊销）——幂等，“未找到或不是你的”返回 `null`，与 RN-426 相同的不暴露纪律。

`PatAuthGuard`——`POST .../runner-ticket` 已经用于 PAT 的同一个 guard（ADR 0105、RN-439）——
增加了第二个分支（`apps/api/src/interfaces/http/auth/pat-auth.guard.ts:104-116`）：以 `brb_`
开头的 bearer token 走 PAT 路径，不变；形如紧凑 JWT（三段以点分隔）的 bearer token 走一条新
路径 `autenticarChaveDeDispositivo`（第 144-216 行）。它读取 JWT 头部中未经验证的 `kid`
（`decodeProtectedHeader`——此时还不检查签名），按这个 `kid` 查找 `runner_device_keys` 中一个
**活跃**的行，用 `jose` 的 `importJWK`/`jwtVerify` 针对**存储**的公钥验证签名，并强制一个
短而必需的 TTL：`exp - iat` 至多为 60 秒（`TTL_MAXIMO_DEVICE_KEY_SEGUNDOS`，第 23 行）——
对照的是 token **自己**声明的寿命，而不是“现在”，这样被截获的 token 无论何时都无法被有效地
重放。授权所用的 `userId` 来自**存储**的记录，从不来自 JWT 的 claim——token 只需要证明持有
私钥，而不需要声称它属于谁。`projectId` 被检查两次：JWT 自身的 claim 对照路由参数，以及另外
地，已登记密钥的 `projectId` 对照路由（镜像 PAT 路径中两项相同的检查）——在为另一个项目登记的
密钥上伪造的 claim 会以 403 被拒绝，沿用 PAT 路径对“未认证”与“已为错误项目认证”的类别区分。

runner 自己在 `apps/runner/src/auth.ts`
（`assinarTicketComChaveDeDispositivo`，第 143-154 行）中签署这个 JWT：EdDSA，30 秒过期，
`kid` 等于设备密钥的登记 id，使用函数运行时已经**在内存中**的私钥 JWK——它从不触碰
`node:fs`，保住了现有的“`auth.ts` 中没有任何文件 I/O”的保证（`auth.spec.ts` 中的“nenhum
I/O de arquivo”测试套件）。从磁盘读取密钥是一个**新的、独立的**模块
`apps/runner/src/device-key.ts`，这是有意为之（见决策 4）。

**这明确不是 RN-439 在此路由上已经禁止的“与会话 JWT 的双重认证”。** guard 自己的
docblock（`pat-auth.guard.ts:41-53`）阐明了这一区别：登录的会话 JWT 在这里仍然从不被接受——
接受它会让 `RolesGuard` 授权一个已登录的浏览器在 api 其余部分做其角色允许的一切，这正是
RN-439/ADR 0105 构建 `@RequirePatAuth()` 所要阻止的作用域逃逸。设备密钥的 JWT 是另一回事：
它是 runner **独自**签署的 token，使用的密钥的私钥一半 api 从未见过，只声明“我是为这个用户、
在这个项目中登记的设备”——与它旁边的 PAT 一样受作用域限制，绝不是伪装的会话凭据。

### 2. api 代理已发布在 GitHub Releases 上的二进制——它不构建、也不保存任何东西的第二份副本 {#2-a-api-faz-proxy-do-binário-já-publicado-no-github-releases--ela-não-constrói-nem-guarda-uma-segunda-cópia-de-nada}

`RunnerReleasesController`
（`apps/api/src/interfaces/http/runner/runner-releases.controller.ts`）
增加了 `GET /runner-releases/binary?platform=<target>`，`@Public()`——按设计不需要认证：二进制
本身不携带机密，而要求登录才能下载你用来配置**第一个**凭据的东西，是本末倒置。`platform` 在
触碰任何东西之前先对照一个封闭的允许列表（`linux-x64`、`linux-arm64`、`darwin-x64`、
`darwin-arm64`、`win32-x64`——与 ADR 0112 已经构建的五个目标相同）进行检查——从不原样插入
GitHub 的 URL 或资源名中，关闭了一个自由参数会打开的 SSRF/注入向量。controller 通过 GitHub
REST API 解析 `latest` release 的资源列表，将该解析结果缓存（只有 URL，从不缓存字节）在内存
中的 `Map` 里五分钟（`CACHE_TTL_MS`），即使在一阵并发下载下也远低于 GitHub 未认证每小时 60 次
请求的限制，然后直接转发资源的字节（`Readable.fromWeb(...).pipe(res)`）。没有新依赖——`fetch`
是 Node 自带的。让浏览器直接与 GitHub 对话的替代方案被拒绝：资源的确切名称是 api 已经在计算的
实现细节（`nomeDoAsset`），而浏览器→GitHub 的直接调用会放弃这个代理免费获得的缓存。

### 3. File System Access API 直接写入已配置的文件夹；其他所有情况下的后备是下载两个文件 {#3-a-file-system-access-api-escreve-a-pasta-configurada-diretamente-um-download-de-dois-arquivos-é-o-plano-b-em-todo-o-resto}

`apps/web/src/lib/runner-bootstrap.ts` 是下面两个入口点调用的新模块。`detectarPlataforma`
为用户的操作系统/架构选择正确的二进制——在 Chromium 中，通过
`navigator.userAgentData.getHighEntropyValues`（经典的 `userAgent` 字符串被有意“精简”，在
现代 Chrome 中对架构不可靠）；在 Chromium 之外，对 `userAgent`/`platform` 做尽力而为的正则，
置信度太低时返回 `null`（从不把猜测当作事实呈现），此时界面让用户手动选择。

`configurarPastaAutomaticamente`（第 199-229 行）是一键路径，只在存在 `showDirectoryPicker` 的
地方可用（Chrome/Edge/Opera）：它生成 Ed25519 密钥对，登记公钥（`registerRunnerDeviceKey`），
通过决策 2 的路由下载二进制，打开浏览器原生的文件夹选择器，并把**三个**文件直接写入所选文件夹
——可执行文件、`brabo-runner.config.json`（`{ projectId, apiUrl }`）以及
`brabo-runner-device-key.jwk.json`（**私钥** JWK，只在这里写入磁盘，从不通过网络发送）。
`baixarKitManual`（第 250-268 行）是在 File System Access API 不存在的任何地方（Firefox、
Safari），或用户不想让网站触碰其文件系统时使用的后备：同样的三个产物，但作为两次普通的浏览器
下载（二进制，以及一个汇集配置和私钥的 `brabo-runner-kit.json`），由用户手动移动到某个文件夹
——不用 zip 库，只有两个文件。

`RunnerOnboardingPanel.tsx` 成为绘制这个流程的**唯一**组件，被此前出现分歧的三个界面使用：
`NewProjectWizard` 的 `workspace` 步骤（`runner` 模式）、`FolderBrowserModal` 的“没有连接
runner”状态，以及 `TerminalPanel` 的等价状态。对本次调查中发现的真实分歧的修复——向导中自有的、
未被追踪的手动命令副本缺少 `--token`，以及面板中的那份使用 `pnpm --filter runner start` 而不是
二进制——在同一次变更中完成：现在只有一条手动命令字符串，始终带 `--token`，默认折叠在一个
`<details>` “prefere rodar à mão” 之后。

**被接受的限制，而非缺陷：** File System Access API 不保留 Unix 的执行位。自动写入之后，
Linux/macOS 用户仍需自己运行 `chmod +x ./brabo-runner`——在成功状态中已预先填好、可直接复制
（`instrucaoFinal`，`runner-bootstrap.ts:224-226`）。这是浏览器平台的限制，网页无法绕过；不是
此功能未来版本应当移除的东西。

### 4. 存在本地配置时，CLI 中的 `--project`/`--dir`/`--token` 变为可选 {#4---project--dir--token-ficam-opcionais-no-cli-quando-há-uma-configuração-local}

`apps/runner/src/device-key.ts` 是一个新模块，有意与 `auth.ts` 分开（其 docblock 解释了原因：
`auth.ts` 有一个专门的测试“nenhum I/O de arquivo”，防止重新引入 ADR 0104 的 Onda 2 有意移除的
全局凭据缓存 `~/.brabo/...`——这个新模块读取的是用户刚刚通过浏览器流程放在那里的**本地**、
**显式**的文件，从不是全局路径）。
`lerConfigLocal`/`lerChaveDeDispositivo` 从**当前**工作目录读取 `brabo-runner.config.json` 和
`brabo-runner-device-key.jwk.json`，对缺失的文件、无效的 JSON 或缺失的必需字段返回 `null`——
从不抛出——因为对仍使用显式 flag 的人来说，这些文件不存在是**正常**情况。

`apps/runner/src/index.ts` 中的 `lerArgumentos`（第 95-206 行）现在以“显式 flag 优先于本地
文件”作为唯一规则来解析三个输入中的每一个，重复三次：`--project` 优先于
`configLocal.projectId`；存在本地配置时 `--dir` 优先于 `.`（解析为当前工作目录，与今天强制的
默认值相同）；`--token`/`BRABO_ACCOUNT_TOKEN` 优先于本地设备密钥。既没有 token 也没有本地设备
密钥时，CLI 仍然像以前一样带着用法说明（`uso()`）退出——这里没有任何东西让认证变成可选，只是
决定使用两种形式中的哪一种。净效果：当当前文件夹是浏览器通过决策 3 配置的文件夹时，不带任何
flag 的 `./brabo-runner` 就能工作，而每个现有的带显式 flag 的调用都完全不变。

## 后果 {#consequências}

**设备密钥仍然没有 PAT 所具有的、`maintainer` 查看其他用户的视图。**
`RunnerDeviceKeysController` 自己的 docblock 声明了这一点：与
`PersonalAccessTokensController`（RN-427——`maintainer` 可以列出/吊销项目中**任何**用户的
PAT，用于事故响应）不同，设备密钥目前只能由登记它的用户列出/吊销。这是本轮声明的裁剪，而不是
遗漏——如果有人要求，把同样的事故响应能力扩展到设备密钥是直接的未来工作，完全沿用 RN-427 已为
PAT 确立的模式。

**设备密钥的 JWT 从不携带用户身份——只有 api 中存储的记录携带。** 这是有意的（决策 1），但
意味着设备密钥永远不能被用来冒充一个声明的用户；它只以**原始**记录所属的用户身份行事。吊销记录
是使其失效的唯一方式——没有单独的“这个特定 JWT 是坏的”黑名单，也不需要有，因为有 30 秒的签名
TTL，再加上 guard 独立强制的 `exp - iat` 最多 60 秒。

**二进制代理把 GitHub Releases 当作唯一的分发渠道。** 如果“latest” release 没有所请求平台的
资源（一次部分的 release，发布到一半），路由返回 502，而不是去猜一个更旧的 tag——与 ADR 0112
自己声明的缺口一致：到目前为止只有 `linux-x64` 经过了真实执行的验证。

**GitHub 资源解析的缓存是按实例、在内存中的，没有失效钩子。** 在窗口中途发布的新 release，
对正在运行的 api 实例最多五分钟不可见。鉴于 runner 发布新二进制的频率很低（与其他所有东西绑在
同一个 release 节奏上），这被判断为一个可以接受的交换，以便远低于 GitHub 的未认证限制——这里
没有构建真正的 webhook 失效机制。

## 考虑过并被拒绝的替代方案 {#alternativas-consideradas-e-recusadas}

- **runner 自行发现本地的 Docker/Kubernetes 容器并通过 SSH 连接，完全没有选择文件夹的步骤。**
  被考虑过，并在本次会话中被产品负责人明确**拒绝**——不是技术上的死胡同，而是有意的范围裁剪。
  `execution_mode:
  runner` 之所以存在，正是因为阶段 25b（产品的任何服务都不调用 Docker——见 CLAUDE.md 中的
  “Cortes e pausas vigentes”）仍处于裁剪状态：教 runner 探测并连接本地容器，会从侧门重新打开
  正是这条边界，而通过 SSH 的连接路径是一种与 ADR 0103 已确立的“认证加审批流水线”边界实质上
  不同的安全模型。它留作独立 ADR 的候选，如果并且当阶段 25b 本身被重新审视时——而不是让这个功能
  悄悄地倒车驶入。
- **复用会话 JWT 作为 `runner-ticket` 的第二种凭据，而不是创建新的设备密钥机制。** 按 RN-439
  自身的条款被拒绝：该路由的 guard 存在的特定目的，就是让浏览器会话的 JWT **永远**不足以通过那里，
  因为否则 `RolesGuard`/`@RequireRole` 会在 api 其余部分授权该会话拥有用户角色的全部范围——这与
  此功能所需要的狭窄、可吊销、限定于设备的凭据正相反。
- **把手动下载的后备压缩成一个 zip 文件。** 被拒绝：没有任何新依赖值得为这点便利而引入——两个
  简单的文件（二进制和一个小的 JSON kit）在生成和让用户解包上都没有额外成本。
- **由 api 构建并托管自己的 runner 二进制副本**，而不是代理 GitHub Releases。被拒绝：ADR
  0106/0112 已经通过 release 流水线发布了恰好这五个二进制；维护第二条构建并保存同一产物的路径会
  是毫无收益的纯重复——一个带短缓存的薄代理就够了。
