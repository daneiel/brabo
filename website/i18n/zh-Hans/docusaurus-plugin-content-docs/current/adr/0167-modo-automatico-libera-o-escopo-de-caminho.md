---
traducao_de: bc436f20d320ce519c89beb3c0674f0a623ce711
---

# 0167 — 自动模式放行路径范围，而且只有它放行

## 状态 {#status}

**已接受。** 由产品所有者于 2026-09-26 决定（AT-226），在三个选项中选择：*"com o modo automático ligado, o agente executa qualquer comando de
terminal sem aprovação, inclusive fora da pasta do projeto"*。**仅**针对处于自动模式的 agent，修订 [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) 的路径范围上限。不编辑 0055，也不编辑 [ADR 0102](0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md)（外部效果/特权命令的上限，RN-418），它们继续完整有效。由此产生的规则是 [RN-603](../business-rules/autenticacao.md#rn-603)；它修订 [RN-153](../business-rules/autenticacao.md#rn-153) 和 [RN-154](../business-rules/autenticacao.md#rn-154)。

## 背景 {#context}

“自动模式”（[RN-153](../business-rules/autenticacao.md#rn-153)）是 `agent_autonomy` 中的通配符 `"*"`：对一个 agent 的任何类型动作的自主权。它被设计为**不**突破 `decide()` 的任何上限——上限作用于 `current.policy === 'auto_approve'`，不知道宽松度来自哪里（[RN-154](../business-rules/autenticacao.md#rn-154)）。

其中一个上限是**路径范围**（ADR 0055）：触及项目文件夹之外路径的终端命令绝不可自动批准。2026-09-26 在所有者的数据库中测得，项目 `exp001`（`mounted` 模式，容器运行中）：在 dev agent 上开启自动模式后，仍有 **51** 个终端命令请求审批，其中 **47** 个只是因为引用了 `/work` 或 `/tmp`。dev agent 在容器**内部**运行，那里项目文件夹是 `/work`，而范围检查把命令与**主机**的根进行比较——于是 agent 针对它运行的地方正确写出的一切，都变成了“项目文件夹之外”。51 个中没有一个是 `git push`、PR、部署或 `sudo`。

出于同样的原因，还有第二种请求，只是没有范围这个名字：**复合**命令（`cd /work && npm test`），其中一个片段在 `permissions.json` 中没有规则，会收到文件**合成**的 `require_approval`——它的存在是为了防止部分的 `allow` 提升整个命令——而这一裁决会覆盖自主权的 `auto_approve`。

所有者要求：*"uma vez que o usuário apertar o botão modo automático, aquele
agente deve entender que pode executar qualquer comando… só deve novamente
pedir para aprovar quando o usuário definir os agentes como manual
novamente"*。

## 决策 {#decision}

1. **`decide()` 开始知道自主权的来源。** 仓库（`AgentAutonomyRepository.resolve`）返回解析后的模式，**以及**它来自该类型的特定规则还是来自通配符。特定 > 通配符的优先级仍然只住在那里，一次——`findMode` 变成了 `resolve` 的读取，而不是第二把尺子。`decide()` 仍然是纯的：它接收 `ctx.autonomyOrigin`，缺失的来源视为 `'especifica'`（不提供它的人保持之前的裁决）。
2. **自动模式恰恰就是：通配符，解析为 `auto_approve`。** `"*": require_approval`（关闭的开关）和 `"*": deny` 不获得任何权力。该类型的特定规则（`terminal: require_approval`）在仓库中胜过通配符，并以 `'especifica'` 来源到达——自动模式不会践踏它。
3. **在自动模式下，路径范围上限不适用。** 复合命令为没有规则的片段合成的 `require_approval` 也不适用：那是**没有意见**的文件，而没有意见的文件绝不降级前一个阶段。`permissions.json` 中**写明**的 `ask` 仍然有效——它是用户的规则，而明确的规则胜过通配符，与仓库中一样。
4. **其他一切逐字节不变。** `deny`（来自 `permissions.json`、内置模式或特定自主权）仍然胜出；外部效果/特权命令的上限（`git push`、PR、部署、`sudo`/`doas`，RN-418）在范围上限**之前**运行，不看来源；受保护分支上的合并、`instruction_patch`、`parallelize`/`raise_max_parallel` 和 `container_remove` 仍然绝不可自动批准。
5. **界面在点击之前说明按钮放行了什么、什么仍然需要请求。** `ApprovalCard` 的说明在两种变体（聊天和审批队列）中都有效，agent 卡片在开关下方显示一句话——只在**通配符**开启时，因为针对代表性类型的开关写入的是一条特定规则，它不放行范围。

## 后果 {#consequences}

- 处于自动模式的 agent 可以不经询问就读写项目文件夹之外的内容。这是选定的代价：发现 U（agent 读取执行它的平台的代码，ADR 0055）对**该 agent** 又变得可能，这是开启该模式的用户的明确决定。剩下的隔离是命令运行之处的隔离——容器的挂载命名空间（`container`/`mounted`，ADR 0134）或用户的机器（`runner`）——加上 `deny` 和效果上限。
- 把 agent 卡片的开关切回“manual”会把通配符重写为 `require_approval`，并在下一次提议时恢复范围上限。
- 当**没有**写入通配符时，卡片的开关仍然编辑代表性类型（`autonomyActionTypeFor`）——一条特定规则。从那里打开它不是自动模式，也不放行范围；界面不会说它放行。
- `decide()` 不再对自主权的来源视而不见，而这曾是 RN-154 的构造性证明。该证明对除范围之外的所有上限仍然有效，并由测试锁定：通配符开启时，每一个都仍然是 `require_approval`。

## 考虑过的替代方案 {#alternatives-considered}

- **在范围检查之前把 `/work` 翻译为主机的根。** 能解决 `exp001` 的 47 个，但解决不了 `/tmp`，也解决不了所有者要求的（“任何命令”）。而且翻译有意位于 engine 中，在决定之后（ADR 0134）。
- **为所有 `auto_approve` 自主权放行范围，无论特定与否。** 拒绝：按类型的 `terminal: auto_approve` 从 Fase 8d 起就存在，上面有范围检查，在没人要求的情况下改变其含义，会在从未开启自动模式的项目中重新打开发现 U。
- **让文件中写明的 `ask` 也被忽略。** 拒绝：那会是自动模式践踏用户的明确规则，与仓库已经应用的优先级相反。
