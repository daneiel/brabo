---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0103 — 本地 runner：通过带一次性 ticket 的 Phoenix 通道在用户机器上执行

- **状态：** 已接受
- **日期：** 2026-08-20
- **背景：** 产品所有者的要求，RN-419/420——与 [ADR 0102](0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md) 配套
- **修订（不削弱）以下领域：** [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)、[ADR 0072](0072-projeto-local-ou-container.md)

## 背景 {#contexto}

在本次交付之前，产品中**没有任何东西**在容器之外执行：每个终端命令都是 engine 进程内的 `System.cmd("sh", ["-c", cmd])`（`terminal_executor.ex`），而 `local` 模式（ADR 0072）只通过 bind-mount 改变**文件夹**——命令仍然在 engine 的**同一个**容器中运行。产品所有者的要求是真正跨越这一边界：agent 在用户的**机器**上、在本地文件夹中、通过其默认终端执行——再加上 Code 标签页中一个真正的交互式终端，那里此前只显示说明文字 + `project_containers` 的状态（从来不是真正的终端）。

## 决策 {#decisão}

**新组件 `apps/runner`**（Node/TS）：用户在**自己**机器上运行的 CLI（`brabo-runner`）。它**不**由产品编排——它出于用户的选择和明确同意而启动，拥有用户的**权限**。

**通道**：在 `/runner` 上的**新** Phoenix socket（与已存在的会话 `/socket` 并列），主题 `terminal:<projectId>`，以**一次性** ticket 认证——与 RN-108（会话 socket 的 ticket）相同的安全模式，但在所有权上有一个**颠倒**的细节：ticket 由 **ENGINE** 自己签发（表 `runner_socket_tickets`，schema `"engine"`，自己的 Ecto 迁移），而 API 通过内部 HTTP 路由向 engine **请求**它——与会话 ticket 的流程相反，后者由 api 写入自己的表。这一交换是有理由的：runner 的 ticket 没有关联的聊天会话（它是按**项目**的），而需要验证排他性（每个项目只有一个 runner）的状态已经存在于 engine 中（`Engine.Runners.Registry`，`:global`）。

**同一主题中的两个角色**：`:runner`（CLI，通过 `:global.register_name/3` 保证排他性——每个项目只有**一个**，第二个 `join` 被拒绝）和 `:web`（终端标签页，可多个同时存在）。engine 在两者之间纯粹**转发** PTY 的字节——从不解释内容。

**路由**总是**在批准之后。** `TerminalExecutor` 只在正常管道（`decide()`/`proposed_action`）已经批准命令**之后**，才决定路由到 runner（而不是一贯的 `System.cmd`）——runner 绝不是逃脱政策的第二条执行路径，它只是同一个已授权命令的另一个**目的地**。没有已连接的 runner 时，即使在 `local` 模式下，一贯的行为照旧（通过 bind-mount 在容器中 `System.cmd`）——runner 是附加的，绝不是强制依赖。

**runner 的安全边界**不是**沙箱。** 它是三者的组合：认证（CLI 用用户**账户**的 token 标识自己）、一贯的审批管道（每个 agent 命令仍以 `proposed_action` 诞生，ADR 0102 的绝对上限同样有效），以及用户在自己机器上运行该二进制的**同意**。`apps/runner/src/guard.ts` 通过词法解析验证收到的 `cwd` 位于项目根目录内——但它在代码中被**声明**为尽力而为，而不是真正的保证；真正的保证是上述组合。这修订（不削弱）了 ADR 0055/0072 的领域：对于经由 runner 的执行，保护 container 模式的 `join(raiz, coluna)` 结构性隔离并不存在——命令以用户**自己**的权限，在其自己的机器上运行。

**交互式 PTY 是用户的动作，带痕迹。** 来自 web 的 `pty_open`/`pty_close` 在事件日志中发出 `terminal.session.started`/`ended`（审计）——包括标签页在没有显式关闭的情况下断开时（通道的 `terminate/2` 会关闭痕迹）。它不经过 `proposed_action`，因为这不是 agent 在行动——而是已认证的用户在自己机器的终端中输入。

## 实现过程中的真实发现 {#achado-real-durante-a-implementação}

产品今天**没有**用于自动化的**长期**账户 token 机制——`account_tokens` 只为一次性的邮件链接（验证、重置密码、迁移后的初始密码）而存在。runner 需要某种能在 CLI 多次执行之间存续的东西。在真正的自动化机制出现之前采用的方案：runner 复制浏览器的**登录**流程（首次执行时用户名/密码，httpOnly cookie + CSRF 被提取并持久化在 `~/.brabo/runner-credentials.json` 中，权限 `0600`，通过 `/auth/refresh` 轮换）。这在代码中被标记为当真正的自动化 token（personal access token 或等价物）进入产品时要替换的模块——它不是最终形式，而是用今天已有的东西所能做到的形式。

## 后果 {#consequências}

- 四个新依赖，全部隔离：web 中的 `@xterm/xterm` + `@xterm/addon-fit`（与 `mermaid`/ADR 0068 同样的尺子——动态 `import()`；在已安装的包中通过 grep 确认没有 `eval`/`new Function`，被声明为有力证据，而**不是**针对混淆的正式保证）；runner 中的 `phoenix` + `node-pty`。
- **容器**的交互式终端仍然不存在——FASE 25b 仍被砍掉。runner **不是**那一块：它是一条平行的路径，在用户的机器上，而不在项目的容器内。
- `TERMINAL_ACTION_TIMEOUT_MS`/`TERMINAL_OUTPUT_MAX_BYTES`（容器执行器已有的上限）作为默认值复制到 runner 中——相同的值，以免因命令运行的位置不同而出现两种不同的上限行为。
- 范围守卫（`guard.ts`）是尽力而为，已声明——不在已写下的内容之外加强围绕它的论点：它有助于抓住粗大的错误，但不是一堵墙。
