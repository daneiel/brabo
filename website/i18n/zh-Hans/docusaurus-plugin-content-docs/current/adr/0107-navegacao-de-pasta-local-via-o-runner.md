---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0107 — 通过 Runner 浏览本地文件夹

- **状态：** 已接受
- **日期：** 2026-08-20
- **背景：** 一个更大计划的 Onda 4（本地文件夹、PR 管理、i18n）——产品所有者的要求
- **修订（不编辑）以下领域：** [ADR 0072](0072-projeto-local-ou-container.md)，与 [ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md) 配套

## 背景 {#contexto}

ADR 0072（本地项目，RN-169/170）**明确**拒绝了在创建/接管项目时使用文件夹选择器：“um seletor exigiria a api enumerar o filesystem do CONTAINER para o navegador, superfície nova para resolver ergonomia”。当时的决定是正确的——api 运行在容器内，它看到的文件系统不是用户的文件系统。唯一的途径是凭记忆输入绝对路径，并事先知道它在容器**内部**是什么样子（RN-170）。

此后，ADR 0103 引入了 `apps/runner`：一个运行在用户**机器**上的 CLI，拥有用户的权限，通过一次性 ticket 认证，已经用于两个目的（已批准的 agent 命令、交互式 PTY）。它改变了问题：枚举文件系统的那个面不再需要是 api 枚举**容器**——它可以是 **RUNNER** 枚举用户真实的机器，正是那个为运行终端而本来就拥有这一视野的组件。

## 决策 {#decisão}

**文件夹浏览开始存在，但只通过 Runner。** 在 PTY 已经使用的**同一个** Phoenix 通道 `terminal:<projectId>` 上增加两个新事件（`apps/runner/src/channel.ts`、`EngineWeb.TerminalChannel`）：`fs_list_dir`/`fs_list_dir_reply` 和 `fs_home_dir`/`fs_home_dir_reply`。与 PTY 相同的设计——`:web` 请求，engine 纯粹地转发给已注册的 runner 的 pid（`Engine.Runners.Registry`），`:runner` 回应，广播只过滤给 `:web` socket。通过客户端生成的 `ref` 关联，正如 PTY 通过 `sessionRef` 关联——engine **绝不**解释任何路径，只是转发。

**api 仍然不枚举任何文件系统。** 这一点不变：api 中没有为列出目录而新增任何 HTTP 路由。读取始终是 runner → engine（转发）→ web，经由已经存在的通道。ADR 0072 反对 api 枚举**容器**的论点仍然成立、未被触碰——本决定不与之矛盾，而是把问题转移给一个本来就拥有正确视野的组件。

**安全边界仍然是 ADR 0103 的边界，而不是路径允许清单。** `apps/runner/src/guard.ts` 把**已批准**的 agent 命令的 `cwd` 限制在项目根目录（`--dir`）——但这一限制有意**不**适用于文件夹浏览：这里的目标恰恰是让用户**自由**浏览自己的机器，以选择**任意**文件夹作为未来本地项目的根。用路径允许清单拒绝这一点会与该功能本身的目的相矛盾。真正的边界仍然是三者的组合，与 ADR 0103 相同：认证（只有持有通道 ticket 的人才能发出请求）、没有任何效果的纯读取（列出目录不是命令，不经过 `proposed_action`，不写任何东西），以及**同意**——是用户决定在自己的机器上运行 Runner，知道它会列出被请求的内容。

**按条目报错，而不是按整个列表。** 一个没有读权限的条目（限制性 ACL、损坏的符号链接、奇怪的挂载）会被跳过——`apps/runner/src/fs-browser.ts` 绝不因为一个有问题的项目而中止整个列表。

## 后果 {#consequências}

- **接受并声明的架构缺口（本次交付不关闭）：** 通道的 ticket（`getTerminalTicket`/`getRunnerTicket`）是**按项目**签发的——Runner 是 `--project <id> --dir <pasta>`，锚定在一个已经存在的项目上。在项目的**创建**界面（`NewProjectWizard.tsx`）中，项目只在确认步骤才诞生，所以工作区步骤中的“Procurar pasta...”按钮**无法**连接任何 runner——没有项目可以锚定 ticket。`FolderBrowserModal` 接收 `projectId: string | null`，为空时显示声明的状态（“disponível depois que o projeto existir”），而不是尝试一次今天的架构不允许的连接。在这个特定流程中，自由文本字段仍然是唯一的途径——与本次交付之前完全一样。真正关闭这一点需要（a）一种与项目解锚的 Runner ticket/通道模式，或者（b）项目在向导流程中更早诞生（在确认之前）——两者都是比本 Onda 更大范围的改动，留给产品所有者优先安排的未来交付。
- 在项目**已经存在**的地方（例如本地项目的 Code 标签页——浏览也可以在那里通过同一个 `FolderBrowserModal` 使用，与创建无关），浏览端到端可用，包括带安装引导的“尚无已连接的 runner”——见 `RunnerOnboardingPanel`。
- `apps/runner` 在**同一个**通道上获得第三项职责（exec、PTY，现在还有文件夹浏览）——没有新通道，没有新 ticket，只是在已有协议中多了两个事件。
- 文件夹浏览没有审计事件（`terminal.session.*`）——与 PTY 不同，PTY 是有持续时间的**会话**。列出目录是一次性的读取，没有状态，没有效果：这与产品其他地方已经把读取排除在 `proposed_action` 之外的尺子相同。
