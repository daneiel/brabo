---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0108 — 在 `runner` 模式下，项目在点击“Navegar pasta...”时诞生，而不只是在确认时

- **状态：** 已接受
- **日期：** 2026-08-22
- **背景：** 关闭 [ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md) 已经在其后果一节中声明的缺口
- **扩展（不编辑）：** [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)、[ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md)

## 背景 {#context}

ADR 0107 交付了通过 Runner 的本地文件夹浏览，但在后果一节中明确声明了一个接受的架构缺口：Phoenix 通道的 ticket（`terminal:<projectId>`）是**按项目**签发的，而在创建界面（`NewProjectWizard.tsx`）中，项目只在确认步骤（`handleConfirm`）才诞生——所以“Onde o código vai morar”步骤中的“Navegar pasta...”按钮没有可以锚定 ticket 的东西，总是落入声明的状态（“disponível depois que o projeto existir”）。ADR 0107 本身列出了两个可能的出路：“(a) um modo de ticket/canal para o Runner não ancorado em projeto, ou (b) o projeto ser criado mais cedo no fluxo do assistente (antes da confirmação)”——并把选择推迟到“uma entrega futura que o dono do produto priorizar”。

这就是那次交付，由产品所有者创建一个真实项目进行了实时测试：在创建界面无法浏览文件夹，他被迫凭记忆输入路径——这正是 ADR 0107 存在要消除的摩擦，只是缺口恰好留在了浏览最能发挥作用的地方。

选择的是选项 (b)，而不是 (a)：没有项目的 ticket 模式会为 Runner 的整个面——exec、PTY 和浏览——改变通道的契约（`Engine.Runners.Registry`，今天以 `projectId` 为键），只为解决一个已经有更便宜出路的用例：ADR 0104 本身已经确立，`runner` 模式下的 `createProject` 是**轻量**操作（只有项目的行——没有远程仓库，没有 Gitflow bootstrap），并且该模式下的 `workspacePath` **按设计是临时的**：真正的 runner 在连接时会用它报告的主机路径**覆盖**它（RN-423）。更早创建项目不会引入关于路径的第二个事实来源——runner 仍然是唯一的来源。

## 决策 {#decision}

**范围：只有 `execution_mode = 'runner'`。** `mounted` 模式在工作区步骤中继续使用 `projectId: null`，不受影响——在那里磁盘验证在创建时在 api 的容器**内部**运行（RN-422/RN-170），而用一个尚未输入的路径提前创建，会在用户甚至还没开始考虑路径的时刻返回拒绝消息（它教人如何挂载文件夹）。`runner` 没有这个问题：该模式下的创建只验证路径的**词法**部分（ADR 0104，第 2 项），从不触碰磁盘。

1. **`NewProjectWizard.tsx` 在点击“Navegar pasta...”时创建项目**，而不再只在确认时——但只在模式为 `runner` 时。如果路径字段仍为空，它使用一个词法上有效、明显是临时的标记（`/workspace-a-confirmar`），而不是阻止点击——真正的 runner 在连接时会覆盖这个值（RN-423），所以这个标记最终绝不会成为关于路径的事实，它只是解锁浏览。
2. **按身份**快照**复用，而不是按“之前已经创建过某个项目”。** 快照只保存 `name`/`externalId`/`adotando`——决定正在创建的是**哪个**项目的字段——绝不保存 `caminhoLocal`，因为浏览的全部目的恰恰是在项目已经存在之后**细化**路径：把它包括在快照中会让每次点击都使复用失效。只要身份不变，第二次点击“Navegar pasta...”和最终确认都会**复用**同一个项目；改变名称（或者返回并更换接管的仓库）会使快照失效，下一次浏览会创建另一个。
3. **当快照仍然匹配时，`handleConfirm` 复用浏览期间创建的项目**——绝不会为同一次“Provisionar”/“Ver o plano”点击再次调用 `createProject`。同一个项目有两行会是缺陷，而不是功能。

## 后果 {#consequences}

- **如果向导在未完成时关闭，会留下一个“未开通”的孤立项目。** 点击“Navegar pasta...”后关闭向导而没有到达“Provisionar”，会留下一行已创建、没有仓库也没有 bootstrap 的记录。这是接受的副作用，接受它的理由是**它不是一个新状态**：今天任何被中断的创建——例如在确认和开通界面加载之间关闭标签页——已经会产生同样的结果。产品今天没有清理孤立项目的机制（对这一既有情况也没有），本 ADR 也不创建一个——只是它不再是更罕见的情况，因为创建现在发生在流程中更早的一步。如果将来出现清理机制，它会用同一条规则解决这两种情况。
- **`UpdateProjectDto` 仍然没有 `executionMode`/`workspacePath`。** ADR 0104 的结论（在模式之间转换一个**已存在**的项目不是简单的 PATCH）在这里不变——本次交付不引入任何编辑，只是提前了**第一次**写入的时刻。
- **`FolderBrowserModal` 获得了在确认之前接收非空 `projectId` 的第二个理由**，但组件的契约不变：它仍然不知道它收到的项目是最终的还是临时的——决定这一点的是向导，在快照中。
- **本 ADR 不重新打开 ADR 0107 的决定 (a)**（没有项目的 ticket）：它仍然不存在，也仍然不需要——Runner 的 exec 和 PTY 面仍然要求一个真实的项目，一如既往。
