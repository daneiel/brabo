---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0154 — 机器级的设备密钥

## 状态 {#status}

**已接受**，于 2026-09-27（AT-108），在实现之后——与 [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)
走的是同一条路。它在 FASE 30 的第 1 次会话（2026-09-11）中以 `Proposed` 诞生，并在第 2 至 8 次会话中由
RN-543..552 加以执行，收尾记述在 [historico-de-fases.md](../explanation/historico-de-fases.md) 和
[fase-30-runner-por-maquina.md](../explanation/fase-30-runner-por-maquina.md) 中。凡下文与代码有出入
之处，决策**没有**被改写：出入被点名在末尾的“接受说明”中。

这是 [FASE 30](../explanation/fase-30-runner-por-maquina.md) 两项决策中的第一项。另一项是
[ADR 0155](0155-a-primeira-conta-nasce-no-terminal.md)，它依赖于本项：没有机器身份，安装程序就没有
东西可以登记。

## 背景 {#context}

产品方向是 [FASE 29](../explanation/fase-29-instalacao-de-uma-linha.md) 的方向：用一行命令安装 Brabo，
并让本地 agent **运行起来**。安装程序已经很接近了——自 RN-531 起，它下载二进制，对照签名的
`checksums.txt` 校验，并用 `install -m 0755` 安装，无需手动 `chmod`——然后就**停下了**。它输出的最后
一行白纸黑字地说明了原因：

> Não pareia o agente local com um projeto: o binário e a base ficam prontos
> aqui, mas a chave de dispositivo e o `brabo-runner.config.json` continuam
> vindo da tela do projeto (ADR 0118).

二进制留在磁盘上，静止不动。想使用它的人回到项目界面，选择文件夹，最后在终端里粘贴
`apps/web/src/lib/runner-bootstrap.ts:398` 拼出的命令——
`chmod +x ./brabo-runner && ./brabo-runner`。紧挨着它上方的注释解释了为什么**界面**无法消除这一步，
而这个论证是对的：

> Uma página web não executa binário na máquina de ninguém: este passo é
> humano em qualquer desenho, e o que dá para fazer é encolhê-lo a UMA linha
> copiável.

这个论证没有覆盖的是：**安装程序不是网页**。它在终端中运行，有 TTY，并且已经在提问——这正是
[ADR 0150](0150-instalador-de-uma-linha.md) 的全部设计，它拒绝 `curl | sh` 正是为了能够提问。这个人工
步骤在界面上不可避免，在那里却可以避免。

### 卡住的不是二进制：而是身份 {#o-que-trava-não-é-o-binário-é-a-identidade}

`brabo-runner service install` 自 RN-518（[ADR 0147](0147-agente-local-com-capacidades.md) 第 5 点）起
就存在，它把 agent 安装为用户服务（`systemd --user`/`LaunchAgent`）。没有人从 `install.sh` 调用它，
而这不是遗忘：它需要一个 `projectId` 和一个设备密钥，而**在安装时刻根本不存在任何项目**——没有账户，
没有 workspace。`.env` 刚刚诞生，compose 刚刚启动，还没有人注册。

FASE 29 测量了这种耦合并点出了它：*"um runner por projeto está imposto em cinco lugares
independentes"*。在这里重新测量，附 `arquivo:linha`：

| # | 位置 | 强制了什么 |
|---|---|---|
| 1 | `apps/engine/lib/engine_web/channels/terminal_channel.ex:204` | 主题是 `terminal:<projectId>` |
| 2 | `apps/engine/lib/engine_web/channels/runner_socket.ex:73` | socket id 是 `runner_socket:<kind>:<project_id>:<user_id>` |
| 3 | `Engine.Runners.SocketTicket`（`runner_socket_tickets`） | ticket 携带 `project_id`，join 要求它们一致 |
| 4 | `apps/api/src/db/schema/auth.ts:325-326` | `runner_device_keys.project_id` 是 `NOT NULL` |
| 5 | `apps/runner/src/servico.ts:264,391` | unit 是 `brabo-runner-<projectId>.service` |

### 五个中有三个不需要改变，而这正是本决策的发现 {#três-dos-cinco-não-precisam-mudar-e-essa-é-a-descoberta-desta-decisão}

显而易见的范围是穿越全部五个。测量 socket 之后，范围缩小了。

`RunnerSocket.connect/3`（`runner_socket.ex:33`）通过 **ticket** 认证，而 ticket 是按项目向 api 申请的。
`project_id` 进入 `socket.assigns`，原子消费发生在 `join` 时，对照主题的 `project_id`。也就是说：第
1、2、3 项描述的是**连接**，而不是进程。一个打开 **N 个连接**的单一进程——它所服务的每个项目一个——会
逐字节满足这三项，而不触碰主题、socket id、ticket，也不触碰对同一项目中第二个 runner 的拒绝，后者仍是
今天这样的保证。

剩下的是真正**属于进程**的东西：它用来申请 N 个 ticket 的凭据（第 4 项），以及让它保持运行的 unit
（第 5 项）。本 ADR 移动的正是这两样。

### 而如今凭据诞生时就绑定在一个项目上 {#e-hoje-a-credencial-nasce-presa-a-um-projeto}

`runner_device_keys.project_id` 是 `NOT NULL`（`auth.ts:325-326`），而密钥由浏览器**在某个项目的界面中**
生成（[ADR 0118](0118-configuracao-automatica-do-runner-pelo-navegador.md)、RN-464..466、RN-475）。一台
有三个 `runner` 模式项目的机器，有三个密钥、三个带 `brabo-runner-device-key.jwk.json` 的文件夹、三个
服务 unit 和三个进程——而这个人为了描述**一台**机器，把同一个浏览器流程走了三遍。

## 决策 {#decision}

**本地 agent 的身份改为属于机器，而不是项目。**

### 1. `runner_device_keys.project_id` 变为可为空，`NULL` 表示机器 {#1-runner_device_keysproject_id-vira-nullable-e-null-significa-máquina}

不诞生新表。机器密钥就是 `project_id NULL` 的设备密钥——同一张表、同一个 `public_key_jwk` 列、写在私钥
JWK 内部的同一个 `kid`（RN-475）、同样的吊销。

考虑过并拒绝了兄弟表：`PatAuthGuard` 按 `kid` 找到公钥，不需要知道它属于哪一种；两张表会做**两次**
查找，而第二次恰好会被遗忘一次。RN-519（列表）和 RN-520（触及活动连接的吊销）无需新代码就继续有效，
带有下文声明的一个后果。

用 `NULL` 而不是哨兵值（`project_id = '00000000-…'`）：FK 是真实的，哨兵值需要在 `projects` 中放一条
假行来满足它。

### 2. 机器密钥对用户的项目有效，在申请 ticket 时解析 {#2-uma-chave-de-máquina-vale-para-os-projetos-do-usuário-resolvidos-na-hora-do-ticket}

`POST .../runner-ticket` 仍然是**按项目**的——正是它携带第 3 项的 `project_id`。改变的是它接受什么作为
凭据：**同一用户**的机器密钥，对该用户在其中达到路由已要求角色的任何项目都有效。没有新的上限，也没有
放松任何上限：授权仍是一贯的授权，针对所请求的项目解析。

机器密钥**不**做的是扩大作用范围：它不会给 runner 任何其所有者用户原本没有的东西。它把 *"每个项目一个
凭据"* 换成 *"每台机器一个凭据"*，仅此而已。

### 3. runner 发现它所服务的项目，而不是去猜 {#3-o-runner-descobre-os-projetos-que-atende-e-não-os-adivinha}

新路由 `GET runner/projects`（路由的最低要求是 `developer`，与 `runner-ticket` 相同）：用户处于
`execution_mode: runner` 的项目，附每个项目的 `workspace_dir_name` 和校验状态。runner 在启动时查询它，
并为它列出的每个项目打开一个连接。

它**询问**而不是扫描 base：base 属于用户，可能包含不是任何项目的文件夹，而按文件夹名猜测，正是
[ADR 0141](0141-base-unica-dos-projetos-montados.md) 禁止把 `PROJECT_WORKSPACES_HOST_DIR` 用作 base 时
所拒绝的那类错误。

### 4. 服务 unit 改为每台机器**一个** {#4-a-unit-de-serviço-passa-a-ser-uma-por-máquina}

`brabo-runner.service` / `dev.brabo.runner`，名字中没有 `projectId`。`servico.ts:32-38` 原来的论证——
*"nomear pela pasta permitiria instalar duas units que nunca podem estar de pé ao mesmo tempo"*——随前提
一起消失：每台机器一个进程，就不会有两个。

`Restart=on-abnormal` 逐字节保留，理由同 RN-518：exit 1 是致命的 join 拒绝或重试次数耗尽，重启就会成为
CLI 自己拒绝做的那个循环。

### 5. 按项目的 unit 继续工作，转换会被说明 {#5-as-units-por-projeto-continuam-funcionando-e-a-conversão-é-dita}

新二进制配旧 unit 不会出问题，`status` 会对两者都作答。有三个按项目 unit 的人，在对每个 unit 运行
`service uninstall` 之前，继续有三个进程——而机器 unit 的 `status` 会**说出**它们的存在，而不是让六个
进程悄无声息地争抢三个项目。

> **在实现中修正（RN-545）。** 本 ADR 原本说 **不带 `--project`** 的 `service install` 会安装机器
> unit。经测量，这行不通：缺少该 flag **已经有含义**——`resolverProjeto` 会落到文件夹中的
> `brabo-runner.config.json`，而如今使用产品的人的正常路径，就是在浏览器配置好的文件夹里不带任何 flag
> 运行 `install`。照字面执行，这条规则会**悄无声息地**转换已在使用产品的人的安装——与这一点本身所承诺的
> 恰恰相反。判别依据是显式的 flag **`--machine`**。之所以编辑而不是另立相反的说法，是因为本 ADR 当时仍是
> `Proposed`：**已接受**的 ADR 从不编辑，新的引用旧的。

## 本 ADR 明确拒绝的东西 {#o-que-este-adr-recusa-explicitamente}

- **把主题合并为 `runner:<userId>`。** 那会为了一无所获而穿越第 1、2、3 项：N 个连接已经满足它们，而
  对每个项目第二个 runner 的拒绝——这是一个真实的保证——恰恰住在那里。
- **跨越用户的机器密钥。** `runner_device_keys.user_id` 仍是 `NOT NULL`。两个人共用的机器是两个密钥，
  这是正确的回答：凭据描述的是**谁**在行动，而不只是在哪里。
- **通过磁盘发现项目。** 见第 3 点。
- **按密钥吊销。** RN-520 在构造上作用于 `{projeto, usuário}`，本 ADR 不改变它——只是让它的代价更高，
  这写在“后果”中。
- **`decide.ts` 中的任何例外。** 五个绝对上限、[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)
  的词法作用域以及 RN-493 的自动批准下限保持原样。本 ADR 移动的是身份，绝不是权限。
- **带 flag 的 `RunnerReadiness`。** RN-507 的三个前提逐字节保留，理由已记录在 ADR 0147 第 4 点：
  第三个前提正是会因为这样一个 flag 而意外失守。

## 后果 {#consequences}

- **吊销变得更昂贵，而这是预料之中的。** FASE 29 声明过：*"quando a FASE 30 fizer o runner por
  máquina, revogar passará a derrubar todos os projetos daquela máquina. Custo declarado aqui para não
  ser descoberto lá."* 发生的正是这样，而 RN-519 的列表开始需要说明每个密钥是哪一种——机器密钥不是
  “项目 X 的密钥”。
- **一个进程取代 N 个。** 更少的内存和更少的 unit，以及在原本有 N 个独立点的地方出现一个单点故障：服务
  宕机会让那台机器上**所有**项目失去本地 agent。
- **`espelho` 和 `workspace_create` 不变。** 两者都是按项目的，并随该连接的 `join` 授予一起传递
  （RN-516、RN-532）。有 N 个连接时，每个连接继续收到自己的那份——项目 B 的镜像目的地仍然无法通过项目 A
  的连接到达，这正是 RN-515 存在要给出的保证。
- **浏览器流程（ADR 0118）没有被移除。** 它仍是已有安装的人的路径，并变成第二条。决定它是否应该消失，
  是 BRB-031 所说的维护者的决定，而不是这次交付的后果。
- **能力 `workspace`（RN-532）获得了存在的第二个理由。** 它原本已依赖于**状态**（经同意设定的 base）；
  有了机器 agent，服务器正是通过它知道那个进程可以为新创建的项目实体化文件夹——这就是本阶段所追求的
  “稍后再链接文件夹”。

## 接受说明（2026-09-27） {#notas-de-aceitação-2026-09-27}

在接受时对照代码核对过。决策保持原样；以下是文本与代码出现分歧、并由代码给出解决的点：

- **第 1 点——“RN-519 和 RN-520 无需新代码就继续有效”。** 它们并没有在没有代码的情况下继续有效。列表
  开始在所有者的每个项目中包含机器密钥
  （`apps/api/src/infrastructure/persistence/drizzle/runner-device-key.repository.ts:88`），并说明其
  种类，从 `project_id` 在一个地方推导（`:23`）；吊销机器密钥开始对所有者每个处于 `runner` 模式的项目
  各调用一次 `disconnectRunnerOfUser`
  （`apps/api/src/application/use-cases/auth/revoke-runner-device-key.use-case.ts:120`）。这正是“后果”
  已经预见、以代码支付的后果（RN-543）。
- **第 3 点——“路由的最低要求是 `developer`”。** `GET runner/projects` 上没有 `@RequireRole`：路径中
  没有可以据以解析它的项目。最低要求按**行**施加，使用项目的有效角色
  （`apps/api/src/application/use-cases/runner/list-runner-projects.use-case.ts:75`），并且只有**机器**
  凭据能进入——绑定项目的凭据以带专门消息的 403 被拒绝
  （`apps/api/src/interfaces/http/auth/pat-auth.guard.ts:279`）。列出的集合与该点所承诺的相同
  （RN-543）。
- **第 4 点——unit 的判别依据。** 已在第 4 次会话中、在 `Proposed` 期间于文本本身中修正：是 flag
  `--machine`（`apps/runner/src/servico.ts:898`，`resolverEspecie` 在 `:912`），绝不是缺少 `--project`
  （RN-545）。
- **第 5 点——两种并存。** 文本描述的是按项目的 unit 与机器 unit 一同安装，由 `status` 指出重叠。代码
  不让事情走到那一步：当**另一种**已安装时，`install` 会**拒绝**，点名每个 unit 的 `uninstall`，不删除
  任何东西，也没有 `--force`（`apps/runner/src/servico.ts:993`，`recusaDeSobreposicao` 在 `:1269`）。
  `status` 仍以文字说明另一种存在——第 5 点剩下的是在守卫之前就已安装的情形（RN-545）。
