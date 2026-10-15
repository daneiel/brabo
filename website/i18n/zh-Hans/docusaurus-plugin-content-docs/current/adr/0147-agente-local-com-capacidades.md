---
traducao_de: 285d458e5d984ace5ddf0fb39263b3b1ae7e8ff0
---

# 0147 — 一个本地 agent，在连接时声明能力

## 背景 {#context}

`brabo-runner`（ADR 0104/0105）诞生时只为一件事：在用户机器上执行已经通过 `proposed_action` 流水线批准的
命令。从那以后，它积累了各种功能，而协议对此只字未提——交互式 PTY（`apps/runner/src/pty.ts`）、文件夹
浏览（`apps/runner/src/fs-browser.ts`），以及自 ADR 0137 起**用户机器上**的 Docker 容器的生命周期。
FASE 28 想再加一项：一个**镜像**，把 agent 的工作复制到用户选择的、位于挂载 base 之外的文件夹。

诱惑是做第二个二进制。这笔账很不划算：那会是两次安装、两种认证模型、两次吊销，以及用户想停下时要停的两样
东西。而产品已经有了在用户机器上运行着的进程——问题不在于缺少 agent，而在于现有的 agent 不会说出自己会做
什么。

**如今 `join` 在两侧都是沉默的。** runner 发送空的 params——
`socket.channel(\`terminal:${projectId}\`, {})`（`apps/runner/src/channel.ts:304`）——而服务器字面上忽略
它们：`def join("terminal:" <> project_id,
_params, socket)`（`apps/engine/lib/engine_web/channels/terminal_channel.ex:99`）。全部身份都来自 ticket：
角色（`:runner` 或 `:web`）来自 `kind`（`terminal_channel.ex:110`，`papel_do_kind/1`），而服务器无从知道
另一端的二进制是能理解 `mirror_sync` 的版本，还是会悄无声息地忽略这条消息的版本。runner 关于自身唯一声明
的数据，是 join 之后推送的 `workspace_confirm`（`apps/runner/src/index.ts:530`）。

一个获得能力却不协商它们的 agent，会以最糟的方式降级：消息到达，处理器不存在，什么也没发生——没有错误，
没有日志，没有人知道镜像从未运行过。

## 决策 {#decision}

**一个本地 agent，在 `join` 中声明能力，由服务器授予。** 先有三种能力：`exec`、`pty`、`espelho`。

### 1. 在哪里声明，在哪里授予 {#1-onde-se-declara-e-onde-se-concede}

runner 在如今为空的地方**声明**：`join` 的 params（`channel.ts:304`）。服务器在 `autorizar_por_papel/2`
（`terminal_channel.ex:110-138`）中**授予**——这正是已经用 `:role`、`:pending_execs` 和
`:open_pty_refs` 组装 `socket.assigns` 的地方——计算 runner 所声明的与项目的 `execution_mode` 所要求的
之间的**交集**。

授予的集合存放在 `socket.assigns` 中，**绝不放在表里**。这与在客户端保留 `containerAtivo` 的道理相同
（`apps/runner/src/index.ts:270-277`：*"a decisão é INTERNA ao runner, o engine não sabe disso e não
precisa saber"*），也与让 `Engine.Runners.Registry` 的 `:global` 条目随 pid 一起消亡的道理相同：能力是
**那个连接**的属性，不是项目的，也不是用户的。一张表会带来这样一种可能：数据库声称某个 runner 会做某件
事，而当前连接着的进程却不会。

**要求了却没有声明的能力会拒绝 `join`。** runner 已经把 `JoinRecusadoError` 视为不重试的致命错误
（`index.ts:725-732`，带有解释原因的注释：*"Recusa não é transitória… encerra com mensagem clara, SEM
laço automático"*），而这正是正确的形式——一个对项目来说太旧的 runner 不应该带着同一个二进制在退避中反复
重试。这也是 `Registry` 已经拒绝同一项目第二个 runner 的地方（`terminal_channel.ex:126-135`），因此按
能力的拒绝诞生在一个用户已经熟悉的拒绝旁边。

**为什么在 `join` 中，而不是之后像 `workspace_confirm` 那样推送。** 那个谈论的是 *workspace*，它在各次
执行之间会变化，由对磁盘有权限的 runner 确认（RN-423）。能力谈论的是*二进制*，它在连接的那一刻是固定的。
在 join 之后才声明，意味着存在一个窗口：服务器已经接受了连接，却还不知道它会做什么——而第一条消息恰恰在
这个窗口中到达。

### 2. 镜像：单向，从不删除，自有作用域 {#2-espelho-uma-direção-nunca-apaga-escopo-próprio}

`apps/runner/src/espelho-guard.ts`（新增），**是 `guard.ts` 的兄弟，而不是它的扩展**。它复用
`realpathMaisProximo` 以及 `validarCwdDentroDaRaiz`（`guard.ts:134-170`）先词法、后 realpath 的两遍
检查——第二遍正是如今能抓住中间某段 symlink 的东西，那里已写有 TOCTOU 的保留意见。

它拒绝三种情况：

1. 逃出目的地的 symlink；
2. **包含** workspace 的目的地；
3. 位于 workspace **内部**的目的地。

后两种是同一个循环的两个相反方向：在 ADR 0141 按身份绑定的情况下，把镜像写在来源内部，会让镜像复制镜像
自身。

**只有一个方向**——workspace → 目的地。**绝不 `--delete`，绝不 `unlink`。** 在 workspace 中被删除的
文件会留在目的地。这是决定，不是疏忽：用户的文件夹不是副本，而是累积——而一个因为另一端的 `git clean`
就去删除某人个人文件夹中文件的 agent，正是整个产品存在要避免制造的那种意外。

### 3. 镜像不需要 Docker {#3-o-espelho-não-exige-docker}

`Engine.Runners.RunnerReadiness` **逐字节保持原样**
（`apps/engine/lib/engine/runners/runner_readiness.ex:44-61`），连同它一贯的两个消费者
（`TerminalExecutor` 和 `Engine.Actions.Workspace.RunnerGit`）。

镜像获得**自己的谓词**，带有它真正需要的两个前提——workspace 已确认、runner 已连接——**绝不**是带参数的
`RunnerReadiness`。一个带“跳过容器”flag 的共享函数，恰恰是第三个前提在未来某次重构中意外地对 `exec` 失守
的机制，而 ADR 0145 存在的目的就是让第三个前提不失守。

为什么镜像正当地不需要它：第三个前提之所以存在，是因为没有容器的命令**会悄悄落到宿主机上**（ADR 0145）——
有两种可能的执行，而错的那种是看不见的。镜像没有这种歧义：按定义它就是用户机器上的文件复制，没有可以从中
落下的容器。在那里要求 Docker，就是引入一个前提却没有为之辩护的缺陷，而代价是真实的——镜像正是应当对不想用
Docker 的人也能工作的那项能力。

### 4. 按项目、按目的地的同意 {#4-consentimento-por-projeto-e-por-destino}

目的地是**按项目**的，由用户声明，并**在 join 时授予的能力之内**传给 runner。对于那次连接中没有授予它的
目的地，runner 会拒绝 `mirror_sync`。

绝不是 runner 中的全局配置，绝不是环境变量：全局目的地会让项目 B 的产物落在项目 A 的文件夹中，而用户会通过
内容发现这一点，而不是通过一个错误。

### 5. 用户服务 {#5-serviço-de-usuário}

**始终在用户级别**：Linux 上是 `systemd --user`，macOS 上是 `LaunchAgent`。**绝不是系统服务，绝不是
root。** runner *按设计*以用户的权限运行——`guard.ts:9-31` 把这一点声明为整个守卫的前提
（*"O runner roda NA máquina do usuário, com os privilégios DELE"*）——而一个 root 服务会打破那段 docblock
中三条真实边界所依赖的不变量。

子命令 `brabo-runner service install | uninstall | status`。移除是彻底的：unit 文件、
`brabo-runner.config.json` 和 `brabo-runner-device-key.jwk.json`。

**先例为零**：`apps/runner/` 中没有任何地方提到 `systemd`、`launchd` 或 `LaunchAgent`；如今的模型是前台
运行，由 SIGINT/SIGTERM 结束（`index.ts:709-717`）。Windows **不在范围内，已声明**——构建矩阵已经产出了
二进制（ADR 0112），但 Windows 上的用户服务是第三种机制，而不是前两种的变体。

期望的副作用：如果安装改为来自 ADR 0146 受版本管理的 bootstrap，**BRB-031**（ADR 0118 遗留下来的手动
`chmod +x`）就会消失。

### 6. 吊销不再是盲目的，并开始能触及活动连接 {#6-revogação-deixa-de-ser-cega-e-passa-a-alcançar-a-conexão-viva}

吊销是存在的：`DELETE /projects/:projectId/runner-device-keys/:deviceKeyId`
（`apps/api/src/interfaces/http/runner/runner-device-keys.controller.ts:82-83`，`developer`，204，
幂等）。**但没有办法看到要吊销的是什么。**

controller 的 docblock（`:39-40`）把这一裁剪声明为 *"sem a visão de `maintainer` (listar/revogar de
qualquer usuário) que o PAT tem"*——而真实的裁剪比它说的更大。`PersonalAccessTokensController` 有**五**
条路由：给用户本人的 `@Post()`、`@Get()` 和 `@Delete(':tokenId')`（`developer`），外加给 `maintainer` 的
`@Get('all')` 和 `@Delete(':tokenId/admin')`
（`personal-access-tokens.controller.ts:63,86,97,113,127`）。设备密钥的 controller 只有**两**条：
`@Post()` 和 `@Delete(':deviceKeyId')`。缺的不只是 `maintainer` 的视图——缺的是**所有者本人**的列表。没有人
能吊销自己看不到的东西，而一个孤立的密钥（在 ADR 0118 流程中途关掉的标签页）如今是不可见且永久的。

本 ADR 以与 PAT 已有格式相同的 `@Get()` 关闭这一点，角色为 `developer`。`maintainer` 的视图仍不在范围内，
如今是出于决定而不是遗漏。

第二个同样大小的漏洞：**如今的吊销只阻止新的 ticket。** 一个已经连接的 runner 会保持通道，直到它自己断开，
而密钥已被吊销。吊销改为**拖垮活动连接**——`Engine.Runners.Registry.whereis/1`
（`apps/engine/lib/engine/runners/registry.ex:45`）已经能给出 pid，不需要新的机制就能触及它。

### 7. 可见的状态 {#7-estado-visível}

runner 以与 `workspace_confirm`（`index.ts:530`）相同的形式在通道中推送状态——那是 runner 讲述自身情况的
唯一先例。

它与项目的其他 runner 事实保存在一起，**而不是在 event log 中**：这是连接的遥测，而不是会话的领域事件，而
`session_events.session_id` 是 `NOT NULL`。这与让 `rag_searches` 成为表而不是事件（RN-479）的道理相同：当
要测量的东西没有会话时，event log 就是错误的地方。

三个字段——最后一次同步、计数、最后一个错误——并且**“从未看过”绝不坍缩为“看过但什么都没找到”**，即
RN-088 的三种状态。一个从未运行的镜像与一个运行了却什么都没复制的镜像是不同的情形，界面需要能说出是哪一种。

### 8. 由事件触发，绝不使用 watcher {#8-gatilho-por-evento-nunca-watcher}

engine 在**具名的时刻**推送 `mirror_sync`——agent 回合结束、commit。**绝不 `fs.watch`。**

watcher 是由任何东西触发的无限工作：一次依赖安装、一次构建，以及——更糟的是——镜像自己的写入，这就是循环。
此外它还会在用户机器上持续运行，而没有人要求过，这与“本地 agent”应有的含义正相反。

## 后果 {#consequences}

- **配置的同意不是动作的批准，而镜像站在配置这一边。** 镜像的写入**不**经过 `proposed_action`：这不是
  agent 请求行动，而是系统在用户配置项目时声明的路径上写入。相反的做法——通过终端命令同步——会落入 ADR 0055
  的路径作用域，变成例行审批的队列，并侵蚀恰恰赋予这次点击意义的那个上限：一个几乎都是例行公事的队列，会训练
  人不读就批准。
- **本 ADR 不触及、并声明不触及的不变量**：`decide.ts` 以及绝对上限；`proposed_action` 作为 agent 一切外部
  效果的来源；event log 的不可变性；三种模式下的镜像闸门（ADR 0135）；broker 的五种操作及计算出的规格
  （ADR 0128/0130）。
- **连接到要求 `espelho` 的项目的旧 runner 将无法再连接。** 这是 `join` 中带消息的明确拒绝——不是无声的
  降级。代价是真实的：更新二进制成为使用新能力的前提，而通过 ADR 0118 流程安装的人没有自动更新
  （BRB-005/BRB-031 触及同一点）。
- **镜像的目的地会累积。** 没有 `--delete`，在 workspace 中删除的文件会永远留在那里，也没有任何自动机制
  清理。这是“绝不在用户的文件夹中删除”的直接代价，而替代方案更糟。
- **承担而未在这里关闭的缺口：**
  - 当 `exec` 经由 `docker exec` 路由时被丢弃的 git 凭据——`apps/runner/src/index.ts:311-320`；
    `packages/docker-port` 有意没有 `env` 字段（ADR 0130），ADR 0145 已经声明了这一代价；
  - 项目内部指向外部的 symlink 不会被策略决策检测到（ADR 0055），而 `guard.ts:9-31` 按不变量是尽力而为——
    `espelho-guard.ts` 继承了同样的 TOCTOU 保留意见；
  - 按 `{project_id, machine_id}` 的排他性仍被推迟（ADR 0137），因此同一项目在两台机器上仍然由 `Registry`
    保证一次一个 runner，而不是每台机器一个身份；
  - **BRB-005**：runner 的镜像和二进制都没有签名。一个获得了在 base 之外写入能力的本地 agent，让二进制的
    来源变得更重要，而不是更不重要。
- **本阶段的兄弟**：[ADR 0146](0146-base-consentida-no-bootstrap.md) 决定 bootstrap 中经同意设定的 base，
  以及 `mounted` 作为本地默认值。两者这样分工：0146 覆盖 bind 能触及的文件夹，本 ADR 覆盖它触及不到的
  目的地。
