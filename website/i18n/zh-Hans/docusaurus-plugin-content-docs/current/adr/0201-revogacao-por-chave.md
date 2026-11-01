---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0201 — 吊销针对的是**密钥**，而不是 `{projeto, usuário}` 这一对

## 状态 {#status}

**已接受。** 2026-10-01（AT-013，故事 HS-008，史诗 EP-003，第 36 轮；所有者于 10月1日的决定：*"是，按密钥吊销，配 ADR——在 socket 的 ticket 中加密钥列，并采用新的认证契约；吊销只断开用该密钥打开的连接。有意改动 engine。"*）。修订 [RN-520](../business-rules.md#rn-520)——它诞生于 [ADR 0147](0147-agente-local-com-capacidades.md) 第 6 点——并引用（不编辑）[ADR 0154](0154-chave-de-dispositivo-de-maquina.md)（**机器**密钥，它把*"按密钥吊销"*列为不做的事项之一）和 [ADR 0155](0155-a-primeira-conta-nasce-no-terminal.md)（在终端中生成、由安装程序注册的机器密钥）。新规则：[RN-685](../business-rules.md#rn-685)。

## 背景 {#context}

自 RN-520 起，吊销一个设备密钥会断开 runner 的**活动**连接，而不只是下一个 ticket。这次断开的目标是 `{projeto,
usuário}`，RN-520 也说明了原因：请求 ticket 的凭据身份——密钥的 `kid`（即记录的 id，RN-475）或 PAT——在 `PatAuthGuard` 中就消失了。`runner_socket_tickets` 只保存 `project_id`、`user_id` 和 `kind`，别无其他；通道只能比较用户。

改动之前在代码中测得的情况（`origin/dev`，`ec0fbea52d`）：

- **ticket 如何产生。** `POST /projects/:projectId/runner-ticket` 经过 `PatAuthGuard`，它通过 PAT（`validarEUsar` 返回 `{id, userId,
  projectId}`）或设备密钥（JWT 头中的 `kid` 在 `runner_device_keys` 中找到公钥；`chave.id` 就是这个 `kid`）进行认证。guard 只设置 `request.user`。`RequestRunnerTicketUseCase` 用 `{userId, kind}` 请求 engine 的 `POST /internal/projects/:projectId/runner-tickets`，由 `Engine.Runners.SocketTicket.emitir/3` 写入该行。
- **engine 如何消费。** `EngineWeb.RunnerSocket.connect/3` 校验 ticket，并把 `project_id`/`user_id`/`kind` 放入 `assigns`；socket 的 `id/1` 是 `runner_socket:<kind>:<projectId>:<userId>`；通道的 `join/3` 消费 ticket 并在 `Engine.Runners.Registry`（`:global`，集群中每个项目最多**一个** runner）中登记在场。
- **吊销在哪里断开。** `RevokeRunnerDeviceKeyUseCase` 写入吊销并调用 `disconnectRunnerOfUser(projectId, userId)`——`POST /internal/projects/:projectId/runner/disconnect`——engine 通过 `Registry` 找到 pid，通道比较 `user_id` 并向**自己的** id 广播 `disconnect`。对于**机器**密钥（项目为空），PR #534 把目标变成**复数**：同一对，对所有者可达的每个 `runner` 模式项目各调用一次（`listRunnerModeReachableBy`）。
- **今天断开了但不该断开的。** 同一用户在该项目中用 PAT 或用另一个密钥连接的 runner。对于机器密钥，代价成倍增加：吊销笔记本的密钥，会在两者交叉的每个项目中断开台式机的 agent。
- **今天没有断开但应该断开的。** (1) 机器密钥在 api 列表中没有的项目里的连接——所有者的角色被降级、项目在 runner 运行时被转换了模式。(2) 在吊销**之前**几秒请求、在**之后**使用的 ticket：`connect/3` 和 `join/3` 都不询问凭据。(3) 吊销 PAT 什么都不断开——只是阻止新 ticket。

AT-013 因两个叠加的原因被阻塞：它不在 FASE 30 的切分范围内，而且改变目标就是改变"吊销"的含义。所有者已作出决定。

## 决策 {#decision}

1. **ticket 记录是**哪个**凭据请求了它。** 在 `engine.runner_socket_tickets` 中增加两个**可为空**的列——`credential_kind`（`"device_key"` |
   `"pat"`）和 `credential_id`（`kid`，或 PAT 的 id）——Ecto 迁移 `20261001120000_add_credential_to_runner_socket_tickets.exs`，追加式，不回填（ticket 只存活 30 秒）。该表属于 **engine**（`engine` schema），所以迁移也是它的；Drizzle 的日志不变（仍在 `0068`）。空值是合法状态：`terminal` 的 ticket 属于 web 标签页，以会话认证；而由本 ADR 之前的 api 签发的 `runner` ticket 在发布期间到达时不带凭据。

2. **认证契约开始把凭据一路带到 engine。** `PatAuthGuard` 在授权之后填充 `request.credencialDeDispositivo`（`{tipo: 'pat', id}` 或 `{tipo: 'device_key', id: chave.id}`）；controller 转发；`RequestRunnerTicketUseCase` 只在 `kind: "runner"` 时发送它（`terminal` 的永远不带，即使有人传了一个）；内部请求增加 `credentialKind`/`credentialId`，二者只能同时出现。engine 对这一对做规范化（`SocketTicket.credencial/2`）：未知种类或空 id 变成 `nil`，绝不捏造一个凭据——而 ticket 照样可用。

3. **engine 把凭据保存在 socket 中。** `connect/3` 设置 `assigns.credencial`，当凭据存在时 `id/1` 多出两段——`runner_socket:<kind>:<projectId>:<userId>:<espécie>:<id>`——这样通道向**自己的** id 广播的 `disconnect` 只会到达该凭据的连接。没有凭据时，id 与以前相同。

4. **吊销**单个**凭据有自己的路由和自己的目标。** `POST /internal/runner/disconnect-credential`（没有 `:projectId`：机器密钥没有项目），`Engine.Runners.Revogacao.derrubar_credencial/4`：
   1. **作废该凭据的待用 ticket**（填充 `consumed_at`——与 `validar/1` 和 `consumir/2` 拒绝的"已使用"状态相同，没有新状态），关闭签发与使用之间的窗口；
   2. **询问集群中登记的**每一个** runner**（`Registry.todos/0`）是否由该凭据产生——只有通道知道，因为凭据存放在 `assigns` 中。由它产生的断开（transport + 释放在场的 `{:stop, …}`）；不是由它产生的回答 `:intocado` 并保持运行；
   3. 以 200 返回一份**清单**（`derrubados`、`legados`、`intocados`、`semResposta`、`ticketsAnulados`），**整体**上限 5 秒。只有格式不对的凭据才返回 400——这样"我什么都没瞄准"绝不会被当成"本来就什么都没有"。

   **机器**密钥不再是把那一对应用 N 次：它是**一次**请求，并且会在它打开过连接的每个项目中断开，包括 api 不会列出的项目。

5. **密钥吊销和 PAT 吊销都使用这个目标。** `RevokeRunnerDeviceKeyUseCase`（以及通过委托的账户入口，RN-611）按 `{tipo: 'device_key', id}` 请求断开；两种 PAT 吊销（所有者的，RN-426，以及 `maintainer` 的，RN-427）开始按 `{tipo: 'pat', id}` 断开——以前它们什么都不断开。顺序不变：**先**吊销，后断开，而断开是只**记录日志**的副作用。

6. **不要停止断开原本会断开的东西（AT-013 的禁令）。** 两个**过渡**部件，二者都不是目标：
   - **遗留连接**（没有凭据的 ticket），属于同一所有者，位于 api 作为可达范围发送的某个项目中（该行的项目，或机器的候选项目），像以前一样按那一对断开（`:derrubado_legado`）。仅适用于设备密钥：PAT 以前什么都不断开，所以不获得遗留范围——否则它会获得一次从未有过的断开，落在与它毫不相干的人身上。
   - **B 计划**：如果 engine 不响应按密钥的请求（早于这条路由的 engine 返回 404），密钥吊销回退到旧目标，按项目调用 `disconnectRunnerOfUser`。多断开是可逆的；少断开会重新打开 RN-519。

7. **`{projeto, usuário}` 依然存在，但归属**另一个**主人。** `POST /internal/projects/:projectId/runner/disconnect` 和 `Revogacao.derrubar/3` 逐字节保持不变（只是 socket id 更细）：它是**成员移除**（RN-615）的目标，后者把**这个人**移出项目，需要断开其任何连接，无论使用哪种凭据——外加上面的 B 计划。

8. **界面改变文字，不改变行为。** 吊销的确认——在设置中的设备密钥部分，以及账户中的机器密钥部分——把"连带"（*"你在同一项目中的另一个 runner 也会断开"*）换成**精确**（*"只有用**这个**密钥连接的会断开"*），因为 RN-561 要求界面说出正确的范围，而旧句子会声称一次不会发生的断开。这是对 AT-013 的 `TODO(humano)`（*"界面是改变行为还是只改标签？"*）的回答：只改标签——点击、路由和失效处理都相同。

9. **runner 不变。** 它本来就在 JWT 头中发送 `kid`，这条路径只需要这个。`apps/runner/` 没有任何一行改动。

## 本 ADR 不做什么 {#o-que-este-adr-não-faz}

- **不改变**授权**依据。** 没有新的上限，也没有放宽：`PatAuthGuard` 一如既往地做决定，凭据只是在授权**之后**被**标注**。本 ADR 移动的是断开的目标，绝不是权限。
- **不断开 web 的 Terminal 标签页。** `kind: "terminal"` 的 socket 没有设备凭据，不占用 `Registry`，也从不被询问——与以前一样。
- **不关闭由旧 api 签发、尚未**连接**、不带凭据的 ticket。** 没有凭据的 ticket（由更早的 api 签发）在吊销时不会被作废：没有可以比较的东西。窗口为 30 秒，并且只在发布期间存在。
- **不给 `maintainer` 视图吊销其他用户密钥的能力。** 按 RN-519 的决定，仍不在范围内。

## 后果 {#consequences}

- **同一用户的另一个 runner 保持运行。** RN-520 声明的代价消失了：吊销笔记本的密钥不会断开用另一个密钥连接的台式机，也不会断开用 PAT 连接的 runner。
- **吊销机器密钥是**一次**请求，并且比复数形式更完整。** 它能到达 api 列表中没有的项目。代价是询问集群中**每一个** runner——与已连接的 runner 数量成线性关系，只在有人吊销时发生，并且整体上限 5 秒。
- **吊销 PAT 开始会断开连接。** 这是可观察的行为变化：用已吊销 token 连接的 runner 立即断开，而不是一直运行到重新连接。对于 `maintainer` 的吊销（事件响应，RN-427），这正是它能控制住任何东西所缺的。
- **在密钥吊销的日志中，清单取代了单一结局。** `derrubar/3` 的四种结局继续存在，供成员移除使用。
- **发布无需运维人员操作。** 迁移是追加式的，并在一贯的迁移任务中运行（`Engine.Release.migrate/0`）。新 api 配旧 engine：ticket 请求中的新字段被忽略，吊销落入 B 计划。旧 api 配新 engine：ticket 不带凭据，按那一对（遗留）断开，而旧的吊销继续调用那一对的路由，它没有变化。所以分支是 `feature/` 而不是 `breaking/`。
- **runner 的 socket id 形式改变。** 外部没有任何东西读取它——它是 Phoenix `disconnect` 的内部 topic——而部署前打开的 socket 随旧 pod 一起消亡。
- **engine 的证明只在 CI 中。** ExUnit（带凭据的真实通道、保持运行的 PAT、两个项目中没有列表的机器、按那一对断开的遗留连接、被作废的待用 ticket、controller 200/400）在本地没有运行就已编写（此环境下 `repo.hex.pm` 返回 403）；语法和格式已核对。
