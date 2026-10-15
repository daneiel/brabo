---
id: fase-30-runner-por-maquina
title: FASE 30——机器的本地智能体
sidebar_label: FASE 30——机器的本地智能体
sidebar_position: 17
description: FASE 30 的范围——本地智能体的身份不再按项目，而改为属于机器，安装器通过创建第一个账户并启动已配对的智能体来完成安装。决定在 ADR 0154 和 0155 中。
keywords: [fase 30, runner, 本地智能体, 设备密钥, 安装器, 服务]
traducao_de: 11f3dbb485e7626c292e2f894b0d8ece64429d47
---

# FASE 30——机器的本地智能体

> 本文档是本阶段的**范围**：它追求什么、拒绝什么，以及按什么顺序。**决定**在
> [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md) 和
> [ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 中——这里与那里有不一致之处，以 ADR 为准。

## 本阶段追求什么 {#o-que-a-fase-persegue}

一行命令安装 Brabo 并**使用**它。目前 [FASE 29](fase-29-instalacao-de-uma-linha.md) 几乎做到了这一点：
`install.sh` 验证自己的来源，启动 compose，用 `install -m 0755` 安装 runner 的二进制并写入基目录。然后它停下了，
停在产品本身早已书面声明的两个地方。

**第一个是本地智能体。** 安装器的最后一行说它不会把智能体与项目配对，设备密钥仍然来自界面。想使用已安装二进制的
人要回到浏览器，最终在终端中粘贴 `apps/web/src/lib/runner-bootstrap.ts:398` 组装的命令。旁边的注释解释了为什么
界面无法避免这一点——*"uma página web não executa binário na máquina de ninguém"*——而且它是对的。它没有涵盖的是，
**安装器不是网页**：它在终端中运行，有 TTY，而 [ADR 0150](../adr/0150-instalador-de-uma-linha.md) 拒绝
`curl | sh` 正是为了能够提问。

**第二个是没有人能进入。** 在本阶段测得：生成的 `.env` 没有任何邮件变量，`MAIL_TRANSPORT` 落到 `log`
（`docker/docker-compose.install.yml:200`），而注册需要验证邮件——正如
`apps/api/src/scripts/provisionar-usuario.ts` 的文档块已经记录的，*"com o `MailSender` log-only não fecha
sozinho"*。一行安装以"Pronto"结束，留下用户自己在 `docker compose logs api` 中捞验证链接。

两者在同一个地方解决，这就是它们构成一个阶段的原因。

## 测量改变了范围的什么 {#o-que-a-medição-mudou-no-recorte}

FASE 29 通过一次测量把按机器的 runner 移出了范围：*"um runner por projeto está imposto em cinco lugares
independentes"*。用 `arquivo:linha` 重新测量，**五个中有三个不需要改变**——这让阶段缩小了一半。

| # | 位置 | 强制什么 | 本阶段 |
|---|---|---|---|
| 1 | `terminal_channel.ex:204` | 主题 `terminal:<projectId>` | **不触碰** |
| 2 | `runner_socket.ex:73` | 带 `project_id` 的 socket id | **不触碰** |
| 3 | `Engine.Runners.SocketTicket` | ticket 携带 `project_id` | **不触碰** |
| 4 | `apps/api/src/db/schema/auth.ts:325-326` | `project_id` `NOT NULL` | 改为可空 |
| 5 | `apps/runner/src/servico.ts:264,391` | unit `brabo-runner-<projectId>` | 改为每台机器一个 |

原因在 ADR 0154 中：第 1、2、3 项描述的是一个**连接**，而不是一个进程。一个打开 **N 个连接**——每个项目一个——的
进程逐字节地满足它们，并保留了对同一项目第二个 runner 的拒绝，这是一个真实的保证而不是偶然。剩下的是属于进程的：
凭据（4）和 unit（5）。

**本阶段 engine 中什么都不变。** 这是测量最有用的发现，也是让 `RunnerReadiness`（RN-507）、镜像（RN-516）和
`workspace_create`（RN-532）逐字节保持不变的原因。

## 会话 {#as-sessões}

每个会话一个交付物。"依赖于"那一列决定顺序。

| # | 交付物 | 依赖于 | 自己的禁令 |
|---|---|---|---|
| 1 | 本文档、ADR 0154/0155 以及 RN 范围 | — | 不触碰 `apps/`、`docker/`、`scripts/`、`install.sh`；不编辑已接受的 ADR |
| 2 | **已关闭**——api：`project_id` 可空，`runner-ticket` 接受机器密钥，`GET runner/projects`（[RN-543](../business-rules.md#rn-543)） | 1 | 不触碰 engine；不放宽任何路由的角色 |
| 3 | **已关闭**——runner：N 个连接，每个项目一个，通过路由发现（[RN-544](../business-rules.md#rn-544)） | 2 | 不触碰 `RunnerReadiness`、镜像或 `workspace_create` |
| 4 | **已关闭**——runner：`service install` 中按机器的 unit，与按项目的共存（[RN-545](../business-rules.md#rn-545)） | 3 | 不删除按项目的 unit；不改变 `Restart=on-abnormal` |
| 5 | **已关闭**——api：`POST /internal/first-account`，已验证账户 + 个人 workspace，有任何用户时 `409`（[RN-546](../business-rules.md#rn-546)） | 1 | 不创建公开路由；不触碰正常注册 |
| 6 | **已关闭**——`install.sh`：同意、账户、机器密钥和 `service install`（[RN-547](../business-rules.md#rn-547)） | 4, 5 | 不在任何地方写入密码；没有 TTY 时报告并以 0 退出 |
| 7 | **已关闭**——web：项目界面识别已配对的机器智能体（[RN-548](../business-rules.md#rn-548)） | 3 | 不删除 ADR 0118 的流程 |
| 8 | **已关闭**——干净机器上的 E2E、docmap、`docs:check`（[RN-549](../business-rules.md#rn-549)） | 6, 7 | 不为了让 E2E 通过而放宽 gate |

### 会话 2 关闭了什么，以及它声明留下了什么 {#o-que-a-sessão-2-fechou-e-o-que-ela-deixou-declarado}

api 那一半已经就位：`runner_device_keys.project_id` 可空，当凭据没有指定任何项目时，`PatAuthGuard` 针对**请求的**
项目解析角色，`GET runner/projects` 存在。有两件事是范围的测量没有预见、而实现迫使我们决定的，两者都记录在
[RN-543](../business-rules.md#rn-543) 中：

- **RN-519 的列表开始返回两种类型，并加以标记。** 一把不出现在任何列表中的机器密钥将是不可见且永久的——RN-519
  关闭的缺陷，在新类型中重生。
- **撤销获得了**复数**目标。** 撤销一把机器密钥没有可以传给 engine 的 `projectId`；不再断开连接会在 N 个连接中重新
  打开 RN-520。对所有者每个 `runner` 模式的项目一个 `{项目, 用户}`，**不触碰 engine**。

以及仍然**已声明、未完成**的：还没有任何 api 路由**创建**机器密钥——注册的是 `install.sh`
（[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 4 点），在会话 6 中。路由在有第一个真实调用方的
PR 中诞生。

### 会话 3 关闭了什么，以及它必须作出的三个决定 {#o-que-a-sessão-3-fechou-e-as-três-decisões-que-ela-teve-de-tomar}

本地智能体真正打开 N 个连接，范围的测量得到了证实：**engine 中什么都没变**，runner 的处理器（`tratarExec`、
`tratarMirrorSync`、`tratarWorkspaceCreate`）一行都没改——迫使设计的是 `EstadoDoRunner` 的四个**按项目**的字段，
它们变成了 N 个状态，`docker` 和 `base` 按值共享。旧模式逐字节保留，新闸门很窄：机器凭据**和**已同意的基目录。

有三件事是范围没有预见的，[RN-544](../business-rules.md#rn-544) 记录了它们：

- **一个被拒绝的项目不会拖垮其他项目。** 尝试上限和 join 拒绝不再属于**进程**，而属于**项目**；只有当一个都不剩时
  进程才以 1 退出，并给出每个项目的结果。在单项目模式中，旧的处置保持不变，理由反过来：只有**一个**连接时，没有
  剩下要服务的。
- **列表只在启动时查询。** 重新查询会让一个变**小**的列表——删除了？转换了？暂时的 500？——因歧义而断开活着的连接。
  进程在启动时说明这一点，动作是重新连接。
- **空列表是**正常**状态，以 0 退出。** 这是每个新安装的状态，而 `Restart=on-abnormal` 故意不重启它。*（在拆分会话 6
  时修订，[RN-550](../business-rules.md#rn-550)：有**零**个连接时智能体改为**保持运行**并重新查询——"只在启动时"那一半
  对有活连接的情况保持不变。）*

以及仍然**已声明、未完成**的：机器模式下的 `apiUrl` 来自 `--api-url`/`BRABO_API_URL`/默认值，从不来自
`brabo-runner.config.json`，后者是**按项目**的——写这个标志的是按机器的 unit，即会话 4。unit 仍然是按项目的：这个会话
改变的是**进程**，而不是服务。

### 会话 4 关闭了什么，以及它必须作出的三个决定 {#o-que-a-sessão-4-fechou-e-as-três-decisões-que-ela-teve-de-tomar}

上表的第五个也是最后一个耦合关闭了：`service install
--machine` 安装 `brabo-runner.service` / `dev.brabo.runner`，不带后缀，并让会话 3 创建的进程运行起来。按项目的 unit
**没有被删除也没有被重命名**，`Restart=on-abnormal` 逐字节保留（换掉它也会撤销会话 3 让空列表以 0 退出的决定），
api、engine 或 web 中什么都没有被触碰。

一次测量改变了机制，它与 ADR 0154 第 5 点的字面相矛盾。ADR 写道 *"`service install` sem `--project` instala a unit
de máquina"*；`resolverProjeto` 有**两个**来源，而今天的正常路径是在浏览器配置的文件夹中不带任何标志运行
`install`——回答的是 `brabo-runner.config.json`。照字面执行，ADR 会悄悄转换已在使用产品的人的安装，这与同一个第 5 点
所承诺的恰好相反。所以判别器变成了标志 **`--machine`**，显式的选择加入，两个项目来源保持不变。

范围留待解决的三个决定，记录在 [RN-545](../business-rules.md#rn-545) 中：

- **`status` 回答被询问的那种类型，代码不相加。** 四种状态和四种代码（RN-088）不会变成八种；另一种类型以**文本**
  出现，作为从**磁盘**读取的存在，并说明它的状态没有询问管理器。没有 `--machine` 也没有可解析的项目时，回答是关于
  **机器**的——唯一一个名字不需要参数的 unit。
- **当另一种类型已安装时，`install` 拒绝。** 它不删除任何东西，不写入任何东西，并点名找到的每个 unit 的
  `uninstall`。没有 `--force`：两者同时存在将是两个进程争夺同一个项目，服务器会拒绝其中一个。第 5 点的保证（已安装
  的 unit 继续工作）保持不变——被拒绝的是现在制造这种重叠。
- **没有指定类型的 `uninstall` 不删除任何东西**，并列出存在的东西。它故意不继承 `status` 的默认值：读错类型代价是
  一行错误的输出，删错类型代价是一个服务和一把密钥。

`install --machine` 自己的两个拒绝不在范围中，是经过测量的：文件夹中不能有 `brabo-runner.config.json`（服务会悄悄
以**项目**模式启动，只服务一个），基目录必须已获同意（没有它，智能体在第一次启动时以 `uso()` 退出）。unit 冻结
`XDG_CONFIG_HOME`——是它决定基目录文件住在哪里，而两个管理器都不传递 shell 的环境——但**从不**冻结基目录的值。

以及仍然**已声明、未完成**的：`install --machine` 不知道那个文件夹的密钥是否真的是机器密钥（在磁盘上两种类型是
同一个文件，知道的是服务器），所以一个带项目密钥的文件夹会无错误地安装 unit，拒绝在第一次启动时出现。而且还没有人
**创建**机器密钥——那是会话 6。

### 会话 5 关闭了什么，以及 ADR 0155 没有的那个决定 {#o-que-a-sessão-5-fechou-e-a-decisão-que-o-adr-0155-não-tinha}

会话 5 以一个 ADR 0155 没有面对的决定关闭，它对接手会话 6 的人有效：`provisionarUsuario` **拒绝在
`NODE_ENV=production` 下运行**，而安装器恰好在那里运行。没有用 `BRABO_FORCE_SEED`，核心变成了
`ProvisionarUsuarioUseCase`，**拒绝留在了脚本中**——它保护的是在**没有**人类交互的情况下创建的**已知**密码，而这条
路由是另一类。会话 5 还加上了 ADR 没有说、而 [RN-410](../business-rules.md#rn-410) 要求的东西：**个人 workspace** 在
同一个事务中诞生，否则安装会以一个能通过的登录和一个"Novo projeto"无处可建的仪表板结束。

### 会话 7 关闭了什么，以及它必须作出的三个决定 {#o-que-a-sessão-7-fechou-e-as-três-decisões-que-ela-teve-de-tomar}

会话 2 加到列表上的类型标记——*"sem elas na lista, uma chave de máquina seria invisível em toda tela"*——有了消费者。
runner 的入门面板开始识别活跃的**机器**密钥，有了它，就不再要求配对：缺的不是配对，而是智能体在运行。api、engine 或
runner 中什么都没有被触碰。

范围留待解决的三个决定，以及每个变成了什么（[RN-548](../business-rules.md#rn-548) 有完整的原因）：

- **在哪里出现：在**面板**中，因此一次出现在三个挂载者中——但结果不同。** 识别是按**项目**的，因为路由是
  `GET /projects/:projectId/runner-device-keys`：`TerminalPanel` 和 `FolderBrowserModal` 总是有项目，而
  `NewProjectWizard` 只在提前创建之后才有（[RN-437](../business-rules.md#rn-437)）。没有 `projectId` 就没有可以询问的
  对象。`AmbienteDoProjeto` 被**考虑过**并被拒绝：它的文档块已经声明 runner 的存在是通道的第一手知识，在那里加一行
  关于已注册密钥的内容会是与一个更强信号竞争的第三个代理——而且是关于**机器**的，不是关于项目的。
- **有密钥而没有活连接——最常见的情况——界面说出它知道的两件事，并点名它不知道的两件事。** 它宣布配对（带密钥的
  名称和最后使用日期），并在旁边说明：*已注册的密钥不是正在运行的智能体*，以及*列表属于你的**账户**，而不是这个
  浏览器*。这是 `workspaceVerifiedAt` 的标尺提前一步应用，`accent` 色调，绝不包括 `success`。它提供的动作是在已配对
  的机器上检查**服务**，而对"现在"负责的仍是被复用的 `EsperaDoRunner`。
- **类型以它的**代价**出现，而不是作为标签。** 面板不列出密钥也不撤销——它说一把机器密钥服务于所有者的所有项目，
  撤销它会在所有这些项目中断开本地智能体。

以及仍然**已声明、未完成**的：还没有人**创建**机器密钥（是 `install.sh`，会话 6），所以今天这个界面只能用手工注册的
密钥来演练。提供的命令是 `brabo-runner service status --project <id>`，今天存在的形式——按机器的形式随会话 4 的 unit
到来（**之后关闭，AT-106**：识别出机器密钥时，面板提供 `brabo-runner service status --machine`；对项目密钥，仍是
`--project <id>`）。一把活跃的**项目**密钥不改变面板：那是低一级范围的兄弟缺陷。列出/撤销密钥的界面仍然不存在。

### 会话 6 的拆分关闭了什么——以及为什么它不是会话 8 {#o-que-a-divisão-da-sessão-6-fechou--e-por-que-ela-não-é-sessão-8}

**会话 6** 会一次触及 `apps/api`、`apps/runner` 和 `install.sh`，而交付三个 workspace 正是一个会话迷失的地方。它被
**拆分为三部分**：下面两个部件，互不相交并且并行，然后是在它们之后的 `install.sh`，作为**编排者，仅此而已**——会话 6
仍然开放，范围更小。**这两个都不是本阶段编号的会话**，特别是都不是会话 8，后者是 E2E，在上表中仍然开放。

**智能体一侧**缺少的两个部件，两者都来自 ADR 0155。

第一个是对会话 3 的**修订**，决定是**不对称**（[RN-550](../business-rules.md#rn-550)）：有**零**个连接时智能体不再
退出，而改为**等待**，以 15s/30s/60s 重新查询 `GET runner/projects`，直到第一个项目出现；有**活**连接时，列表仍然
只在启动时读取，逐字节不变。会话 3 的论证在它有效的地方仍然完整——变**小**的列表是有歧义的，因歧义断开活连接是用
猜测换掉正确的状态——而有零个连接时没有什么可断开的。被推翻的是 `exit 0` 的论证（"一个什么都不做的活跃服务"），因为
进程开始做事并说明它在做事。在这个会话中测得：`Restart=on-abnormal` **不看退出码**——它因信号、看门狗或超时而重启——
所以两个 unit 中什么都不变，效果是机器 unit 真正处于 `active (running)`。等待没有上限；失败有（连续十次查询，以 1 退出
并点名次数）。

第二个关闭了会话 2、3 和 4 声明的缺口——*"ninguém CRIA chave de máquina ainda"*——属于智能体的那一半
（[RN-551](../business-rules.md#rn-551)）：`brabo-runner device-key
create|finish` **在这台机器上**生成 Ed25519 密钥对。这里的决定是**切分**：CLI **不**与 api 对话，因为注册的是带着
`BRABO_SERVICE_TOKEN` 的安装器，而把这个密钥交给智能体会把它能做的事扩大到远超它所需——每一方保管一个秘密，谁也看不到
对方的。由此得出两步的设计：`kid` 是**注册记录**的 id，只在注册之后才存在，所以 `create` 写入一个读取者会忽略的
`.parcial`，`finish` 写入真正的名字。**runner 读取的文件永远不会在没有 `kid` 的情况下存在**——RN-475 的缺陷，在构造上
不可能。

仍然**已声明、未完成**的：注册机器公钥的**路由**和串联三个命令的 `install.sh` 仍然是会话 6。

以及同一拆分的 API 那一半（[RN-552](../business-rules.md#rn-552)）：`POST /internal/machine-device-keys`、
`engine-service`、正文 `{ name, publicKeyJwk }`，响应带有成为私钥 `kid` 的 `id`（RN-475）。**凭据已经决定，代价已经
声明**：服务 token，因为要求刚创建用户的凭据会迫使安装器在机器上打开
[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 5 点恰恰拒绝打开的活会话——并给 RN-546 故意丢弃的
密码第二种用途。代价：泄漏的 `BRABO_SERVICE_TOKEN` 开始能够**制造**持久的访问凭据，而不只是与内部路由对话。

三个约束住在**路由中**，而不是文本中：正文中没有 `userId`（所有者是安装的**唯一**用户，零个或多于一个是 409 且不写入
任何东西——RN-546 的条件换了一种形式，针对**安装**而从不针对参数）；注册在同一个事务中**替换**所有者的活跃机器密钥，
因此重新安装的机器可以通过，而一千把密钥**通过子句**就不可能，**没有会变老的数字**；带 `d` 的 JWK 按名称被拒绝，形式
的标尺变成**一个**，在领域中，由两个注册者调用。

仍然**已声明、未完成**的：在一个没有**项目**的安装中，任何界面都无法触及机器密钥——列出和撤销都通过
`/projects/:projectId/...`——这就是为什么注册是替换而不是留下孤儿：那里的孤儿将是**活着却无法触及**的。

### 会话 6 关闭了什么，以及它必须作出的四个决定 {#o-que-a-sessão-6-fechou-e-as-quatro-decisões-que-ela-teve-de-tomar}

范围缩小后，会话 6 是**编排，仅此而已**：`apps/` 中一行都没改，没有诞生任何路由，`install.sh` 串联的四个部件都已
存在并经过测试。本阶段一开始打开的漏洞——*"numa instalação nova ninguém consegue entrar"*——在这里关闭，而
[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 5 点的承诺真正开始发生：智能体在没有项目的情况下启动，
等待，并领取用户在 web 上创建的第一个项目。

四个决定，完整记录在 [RN-547](../business-rules.md#rn-547) 中：

- **当中间某一环失败时，什么都不撤销，一切都报告——脚本总是以 0 退出。** 已完成的环节本身就有用（有了账户就能进入，
  有了密钥机器就已配对），撤销需要删除账户和撤销密钥，而没有这样的路由，也不应该有一个由安装器自行调用的。代价是安装
  可能只完成一半；它永远不会做的是**悄无声息地**只完成一半——每个失败都是最后一个块中的一行命名项，带有重试的命令。
- **幂等性就是 HTTP 代码，`409` 不是失败。** 第二次执行，或其恢复带回了用户的迁移：该步骤沉默并说明原因，不进入待办。
  `000`——没有与 api 对话的 curl——有自己的处理，否则"api 没有启动"会被读成"api 拒绝了"。而智能体的步骤只在**这次**
  执行创建了账户时才运行：对已存在的用户，注册机器密钥会为在这一轮中什么都没要求的人铸造持久的凭据。
- **密钥的 `name` 是 `hostname`。** [RN-551](../business-rules.md#rn-551) 声明 CLI 不命名——它是注册记录的字段，命名的
  是注册者。打开密钥列表的人需要知道去**哪台**机器，而 hostname 是用户已经在用来称呼自己机器的名字。
- **注册没有闭合时剩下的 `.parcial` 会**保留**，并被点名。** 删除它会是安装器决定它知道一件它并不知道的事：api 写入
  之后的超时与之前的超时无法区分，而这个文件可能是一把已注册密钥私钥那一半的唯一副本。

有两件事改变了，而它们不在范围中。密码通过 `curl` 的 **STDIN** 发送，服务 token 放在一个 600 的 `--config` 中——
`/proc/<pid>/cmdline` 对机器的任何用户可读，而在 `argv` 中的密码会在请求期间暴露。而 `--help` 曾经**撒谎**：它打印
文件头，那是注释，而禁止对安装者谈论"阶段会话"的规则只读代码行——所以 *"ESTA VERSÃO NÃO INSTALA NADA"* 在脚本开始
启动 compose 并安装 runner 之后又存活了几个月。已修正，并有一个针对 `--help` **输出**的测试，而悄悄截断它的固定行区间
变成了"直到第一个不是注释的行"。

以及仍然**已声明、未完成**的：在干净机器上的端到端安装——真实的 compose、真实的 api、真实的 runner 二进制、写入的
unit 和等待中的智能体——是**会话 8 的 E2E**，只有它能证明。在这个会话的测试中，`brabo-runner` 是一个 shell 替身，
api 是一个测试服务器：证明的是**串联**，从来不是集成。而 `install --machine` 仍然不知道那个文件夹的密钥是否真的是
机器密钥（[RN-545](../business-rules.md#rn-545) 的缺口）——不同的是现在存在一条在那里**创建**机器密钥的路径，所以第一次
启动时的拒绝不再是可能的结果。

### 会话 8 关闭了什么——以及它必须作出的三个决定 {#o-que-a-sessão-8-fechou--e-as-três-decisões-que-ela-teve-de-tomar}

本阶段的最后一个会话，也是唯一能回答整个阶段所追求的问题的会话。会话 6 书面声明它的测试证明的是**串联**，从来不是
集成——`brabo-runner` 是 shell 替身，api 是假的——而正是这个缺口在这里关闭。

harness **不是在这个会话中诞生的**：`.github/workflows/install-e2e.yml` 自 FASE 29 起就存在
（[RN-534](../business-rules.md#rn-534)），并且已经在 Actions 的一个临时 runner 上运行已发布的安装器，那字面上就是一台
干净的机器。它证明的东西止于 `.env`。这个会话**扩展**了它，它现在证明的是 [RN-547](../business-rules.md#rn-547) 的五个
环节针对真实的 api 和二进制、**运行中并等待**的智能体，以及第一个 Runner 模式的项目在无人回到终端的情况下被领取。

三个决定，完整记录在 [RN-549](../business-rules.md#rn-549) 中：

- **"智能体在运行"的信号是它写下的**那一行**，从不是管理器的状态。** `perguntarEstado` 把 `activating` 映射为
  `rodando`——有理由的（[RN-088](../business-rules.md#rn-088)："subindo" 不是 "parado"）——所以 `systemctl is-active`
  和 `service status --machine` 对一个两秒后就会死掉的进程回答*运行中*。[RN-550](../business-rules.md#rn-550) 的那一行
  只在智能体从磁盘读取密钥、取得 ticket、与 api 对话并收到**空**列表之后才存在：它一次证明了配对和等待，并且它是一个
  **记录下来的事实**，而不是状态的抽样——这就是为什么带上限地等待它不是竞争。`status` 在它之后进入，作为确认，从不
  代替它。
- **结果通过 API 证明，而不是通过浏览器。** 主体是**智能体**，它观察的是 `GET /runner/projects`。浏览器会通过同一个
  路由创建项目，多出一层会因无关原因失败的东西——并且不会让断言更强，因为断言仍然是 journal 中的那一行。浏览器那一层
  是存在的（`e2e/`，[ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md)），它回答另一个问题，并假定
  生产 compose 已运行：把它带进来会让安装器的 E2E 依赖于一台本应干净的机器上的第二个 harness。
- **在 PR 中运行的那一半是一个**测试**，而不是 workflow。** E2E 仍在 `pull_request` 之外——打开这扇门就是给安装器一个
  跳过来源验证的方法，而这正是 [ADR 0150](../adr/0150-instalador-de-uma-linha.md) 所拒绝的。只是在 tag 上运行的
  workflow，其错误会出现在 tag 上：`scripts/dev/install-e2e.spec.ts` 守护它悄悄腐烂的两种方式——被放宽的 gate，以及
  `install.sh` 的句子被改写，这会让断言不是失败，而是**消失**。

**出现了两个缺陷，两者都不可见，因为 workflow 从未运行过。** 第一个属于 harness，已修正：TTY 的应答文件以
`nao-migrar` 开头，在干净机器上它落到**标记**的问题上——它不匹配 `s|S|sim|SIM`，脚本说 *"Nada foi gravado"* 并以 0
退出，标记的断言本会失败。第二个是**发现**并保持为发现：已发布的 `install.sh` **在干净机器上无法自行启动任何东西**——
它使用 `docker/docker-compose.install.yml`，而它不是 Release 的资产，不进入已签名的 `checksums.txt`，**它也不在任何
地方下载它**（连同 `./postgres/init.sql`，是三个文件）。遵循 runbook 中 `curl … install.sh` 的人，在已经验证了签名并
写入了 `.env` 之后，死于 "no such file or directory"。workflow 按 tag 手工带来它们，在一个声明这是发现的步骤中；修复
需要在已签名资产和克隆之间作出决定，是一个独立的交付。

以及仍然**已声明、未完成**的：这个 E2E **不在编写它的 PR 中运行**——第一次真实执行是下一个最终 tag，PR 的任何检查都
证明不了它的一行。按决定留在外面的：通过**迁移**路径的第二次执行（[RN-530](../business-rules.md#rn-530)）、macOS
（完整步骤是 Linux——`launchd`，以及托管 runner 没有的 Docker）以及浏览器。

保留的范围：**RN-543..555**。ADR **0154** 和 **0155**。RN-541 已经分配在一个未合并的分支中——跳号是有意的，依据
FASE 29 在按日期解决三次冲突时记录的标准。

## 本阶段整体交付了什么 {#o-que-a-fase-entregou-no-conjunto}

八个会话，加上从会话 6 的拆分中产生、不是编号会话的两个部件。本阶段开始时承诺的——*一行命令安装 Brabo 并**使用**它*
——开始发生了：

- **本地智能体的身份不再按**项目**，而改为属于**机器**。** 范围的测量说需要改变的两个耦合改变了：
  `runner_device_keys.project_id` 可空（[RN-543](../business-rules.md#rn-543)），unit 是每台机器一个
  （[RN-545](../business-rules.md#rn-545)）。另外三个**没有改变**，而拯救了它们的测量是本阶段最有用的发现：主题、
  socket id 和 ticket 描述的是一个**连接**，而 N 个连接逐字节地满足它们。
- **engine 中什么都没变。** `RunnerReadiness`（[RN-507](../business-rules.md#rn-507)）、镜像
  （[RN-516](../business-rules.md#rn-516)）和 `workspace_create`（[RN-532](../business-rules.md#rn-532)）逐字节保持不变，
  runner 的处理器也是。
- **新安装不再生来无人在内。** `MAIL_TRANSPORT` 仍然是 `log`，安装器仍然不开启 SMTP——改变的是第一个账户在**终端**中
  诞生，已经验证（[RN-546](../business-rules.md#rn-546)/[RN-547](../business-rules.md#rn-547)），个人 workspace 在同一个
  事务中。在 `docker compose logs api` 中捞验证链接不再是路径。
- **智能体以已配对状态启动并**等待**。** Ed25519 密钥对在机器上诞生（[RN-551](../business-rules.md#rn-551)），只有公钥
  传输（[RN-552](../business-rules.md#rn-552)），注册的 `id` 成为 `kid`（[RN-475](../business-rules.md#rn-475) 的不变量，
  现在在构造上不可能违反），有零个项目时进程保持运行并重新查询（[RN-550](../business-rules.md#rn-550)），而不是退出。
- **界面识别已配对的人**（[RN-548](../business-rules.md#rn-548)），从不断言智能体在运行——已注册的密钥证明配对，不证明
  进程活着。
- **整体经过端到端测量**（[RN-549](../business-rules.md#rn-549)），针对真实的 api 和二进制，在一台干净的机器上。

本阶段**没有**关闭的就在下面，"本阶段触及但未解决的缺口"中，在途中没有一个改变了大小——除了列出/撤销密钥的**界面**，
它故意变得**更大**：本阶段增加了一种要列出的密钥类型，却没有构建界面。再加上会话 8 测得的 compose 发现，以及
`install --machine` 的缺口，它仍然不知道那个文件夹的密钥是否真的是机器密钥——在磁盘上两种类型是同一个文件，知道的是
服务器。

## 本阶段**不**触碰什么 {#o-que-esta-fase-não-toca}

在两个 ADR 中声明，在这里重复，因为正是它赋予其余部分意义：

- `decide.ts` 和绝对上限——没有一个获得例外，即使是可配置的例外也没有
- `proposed_action` 作为智能体每个外部效果的来源；创建文件夹和配对智能体仍然是**经同意的配置**，而不是智能体的动作
  （RN-516 的界线）
- event log 的不可变性
- `RunnerReadiness`（RN-507）及其三个前提条件——以及**绝不**加一个"跳过容器"的标志，原因见 ADR 0147 第 4 点
- 镜像（RN-515/516/517）和 `workspace_create`（RN-532）：两者都是按项目的，并在那个连接的 `join` 授予中传递
- 带邮件验证的正常注册，以及默认的 `MAIL_TRANSPORT=log`
- 通过浏览器的配置流程（[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)）

## 本阶段触及但未解决的缺口 {#lacunas-que-a-fase-encosta-e-não-resolve}

- **撤销仍然针对 `{项目, 用户}`，从不针对 `{密钥}`**（RN-520）——而且代价更高：撤销会断开那台机器上**所有**项目的
  智能体。FASE 29 预先声明了这个代价；它在这里到来了。关闭它需要改变撤销的目标，这是独立的工作线。
- **没有列出和撤销设备密钥的界面。** RN-519 在 api 中打开了 `GET`；web 从未获得这个界面。本阶段增加了一种要列出的
  密钥类型，却没有构建界面——缺口变大了，并已声明。[RN-548](../business-rules.md#rn-548) 开始在入门面板中**消费**这个
  列表，但这并不关闭它：为了识别而读取，与为了撤销而列出是两回事。
- **单点故障。** 每台机器一个进程取代 N 个：服务宕掉会让所有项目失去智能体。这是设计的代价，不是疏忽。
- **git 凭据在 `runner` 模式的 `docker exec` 中仍被丢弃**（[ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md)）——
  本阶段不触碰它，这里的任何东西都没有让它变得更糟。
- **BRB-031** 因维护者的决定而关闭，而不是作为后果：本阶段创建了不需要 `chmod` 的路径，并**保留**了浏览器的路径。选择
  退役后者是另一个决定。
- **BRB-017**（engine 镜像的 GPL 义务，P1）保持原样，而本阶段出于与 FASE 29 相同的原因使它更具体：更多安装在第三方的
  机器上。
