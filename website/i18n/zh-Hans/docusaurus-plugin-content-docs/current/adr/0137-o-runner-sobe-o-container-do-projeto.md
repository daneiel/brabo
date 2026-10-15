---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0137 — `brabo-runner` 在用户的机器上启动项目容器

## 背景 {#context}

自 RN-494（ADR 0135）起，镜像关口（RN-105）在**全部三种**执行模式下生效：`mounted`/`runner` 需要已决定的 `artifact.project_image` 才能打开 Code 标签页，与 `container` 完全一样。RN-494 白纸黑字留下的声明是："没有启动的是容器本身——`mounted`/`runner` 在服务器上仍然没有自己的容器。"本 PR 关闭的正是这一半，但不是在**服务器**一侧——而是在**用户**一侧。

如今，`runner`/`mounted` 模式的项目把**每一条**终端命令直接在用户机器上执行（`child_process`，没有任何隔离）——由同一个 `brabo-runner` 执行，它早已维护着 Phoenix 通道 `terminal:<projectId>`（ADR 0103/0104），并且早已懂得与**它自己的** Docker 对话（`@brabo/docker-port`，自 ADR 0128 起由 `--self-test-docker` 证明，直到现在都没有真实使用者）。broker（`apps/broker`，ADR 0130）早已为 `container` 模式提供这种隔离，在**服务器**上启动容器——但它**永远**不会为 `mounted`/`runner` 启动容器：它们的代码存放在服务器看不到的**用户**目录中（`ModoDeExecucaoNaoSuportadoError`，`apps/broker/src/operacoes.ts`）。唯一能看到那个目录的进程，是 runner 本身，在拥有该目录的人的机器上。

## 决策 {#decision}

**`container_start`/`container_stop`/`container_remove` 获得**第二条**执行路径，按项目的 `executionMode` 分支——`container` 继续经由 broker，`mounted`/`runner` 改为通过**同一个**已存在的 Phoenix 通道向已连接的 **RUNNER** 请求。**

### 复用 exec/exec_result 这一对，三次 {#reuso-do-par-execexec_result-três-vezes}

`apps/runner/src/channel.ts` 早已有一个恰好对应"服务器向 runner 请求某事，runner 回应，按 `ref` 关联，带超时"的模式：runner 一侧的 `exec`/`exec_result`；engine 一侧的 `Engine.Runners.RunnerRouter.exec/4` + `EngineWeb.TerminalChannel`（`handle_info({:dispatch_exec, ...})` + `handle_in("exec_result", ...)`）。本 PR **复制**这一模式三次——从不发明新的：

- `container_start`/`container_start_result`
- `container_stop`/`container_stop_result`
- `container_remove`/`container_remove_result`

在 engine 一侧，`RunnerRouter` 增加 `start_container/3`、`stop_container/3` 和 `remove_container/3`，基于一个公共的私有 `dispatch/5` 分解（三者只在事件原子和结果原子上不同——`exec/4` 保留自己的代码，不去动它）。`TerminalChannel` 增加四个 `handle_info({:dispatch_container_*, ...})`（`despachar_pedido/6`，与 `dispatch_exec` 共用的模子）和三个 `handle_in("container_*_result", ...)`（`responder_pedido_pendente/3`，它也开始处理 `exec_result`——同一个 `pending_execs`，一个通用的 ref→from 映射，不知道也不需要知道待处理的是**什么**请求）。

在 runner 一侧，`channel.ts` 增加三种消息类型 + `enviarContainerStartResult`/`Stop`/`Remove`；`RunnerChannelHandlers` 增加 `onContainerStart`/`onContainerStop`/`onContainerRemove`；`index.ts` 增加 `tratarContainerStart`/`Stop`/`Remove`，它们调用 `DockerViaCli`——broker 在服务器一侧使用的**同一个**端口（`packages/docker-port`，ADR 0130），使用的是**用户**的 Docker。

### 新的 HTTP 路径：api → engine → runner {#o-caminho-http-novo-api--engine--runner}

`ApiToEngineClient`（api 早已用于 `executeTerminalAction` 的端口，同步）增加 `startContainerViaRunner`/`stopContainerViaRunner`/`removeContainerViaRunner`。`EngineWeb.ContainerCommandController`（`POST internal/projects/:projectId/containers/{start,stop,remove}`）是 engine 一侧唯一的调用方——它转给 `RunnerRouter`，从不写入 `project_containers`（写入者仍然是 api 一侧的 `RegistrarTransicaoDeContainerUseCase`，在调用返回之后）。

**engine 的响应**总是** 200**——与 `ActionCommandController`/`ExecutarComandoNoContainerUseCase` 同一纪律（ADR 0134）：在**响应体**中 `sucesso: false`，绝不是 HTTP 错误状态码，用于两种属于**正常**失败的原因——没有已连接的 runner/超时（`motivoCodigo`），以及 runner 尝试了但拒绝了（用户机器上 Docker 不可用、规格无效）。`HttpApiToEngineClient` 只在第一种情况下抛出 `RunnerNaoConectadoError`，在第二种情况下抛出 `RunnerRecusouContainerError`——三个用例一并捕获**两者**（与 `BrokerRecusouError`/`BrokerIndisponivelError` 同样的推理），并以原因写入 `failed`，绝不让它们传播。

### 镜像：**读取**，绝不重新**选举** {#a-imagem-lida-nunca-eleita-de-novo}

`ExecuteContainerStartUseCase`（ADR 0133）在请求 broker 启动**之前**，从 Arquiteto 的路由中选举一个候选镜像，并发出 `artifact.project_image` 的新版本（`DecidirImagemDoProjetoUseCase`，`decidedBy: 'infra-lead'`）——这是 `container` 路径特有的，`mounted`/`runner` 路径**不**重复这一步。它只通过 `ObterSpecDeContainerUseCase` **读取**当前的决定——早已为 broker 组装 `GET .../container-spec` 的**同一个**用例（ADR 0130），**直接**调用，不经 HTTP，因为 `ExecuteContainerStartUseCase` 和 `ObterSpecDeContainerUseCase` 运行在同一个 api 进程中。没有已决定的镜像（RN-105）时，在询问 engine **之前**就失败——与产品其他三个部分早已生效的关口相同。

发往 runner 的 payload（`EspecificacaoDeContainerParaRunner`）是与 `EntradaDeEspecificacao`（`packages/docker-port`）**相同**的字段，**减去** `raizDoProjeto`——runner 自己用 `estado.dir` 填充该字段。这不是为了省带宽：这是一个决定，即**没有任何**主机路径从服务器传到 runner，原因与没有任何主机路径从服务器传到 broker 相同（`apps/broker`，ADR 0130）——知道**真实**路径的是在那台机器上的那一方。

### `Engine.Actions.TerminalExecutor` **没有**获得新的出口 {#engineactionsterminalexecutor-não-ganhou-saída-nova}

读代码确认的发现：`decisao_de_execucao/1` 早已**无条件**地把每一条**已验证**且**已连接**的 `runner` 项目命令路由到 `RunnerRouter.exec/4`（RN-423，ADR 0104）——它不问"有容器吗？"，只问"有 runner 吗？"。"在主机上运行还是在我启动的容器内运行"这个决定属于 runner **内部**，而不是 engine，因此 engine 不需要知道它的存在。

唯一改变的是 `apps/runner/src/index.ts`：`EstadoDoRunner` 增加 `containerAtivo: string | null`（**本** runner 启动的容器的**名字**——`brabo-<workspaceDirName>`——或 `null`）；`tratarExec` 开始检查这个字段——有活动容器时，通过 `DockerViaCli.exec(nome, { comando,
cwd })` 运行；没有时，走一贯的路径（直接在主机上 `executarComando`）。`cwd`（早已由 `validarCwdDentroDaRaiz` 对照项目根校验过）通过**前缀**替换转换到 `/work` 内部（`cwdParaContainer(raiz, cwd, pontoDeMontagem)`，`guard.ts`）——与 engine 一侧 `cwd_para_container/2` 的推理相同（RN-492，ADR 0134）：根变成挂载点，路径的其余部分保持不变。

`containerAtivo` 在通道重连之后依然存在（它是 `estado` 的一部分，在 `main()` 的 `while` 中持续存在）——WebSocket 断开时 Docker 容器本身并不会倒下，runner 不应因为一次重连就"忘记"它。

### `guard.ts`/RN-434 已经覆盖挂载，无需新代码 {#guardtsrn-434-já-cobre-o-mount-sem-código-novo}

原计划记录了一个问题：容器的 bind-mount 是否需要第二次"有效挂载路径"校验？**通过完整阅读 `guard.ts` 确认不需要。** `estado.dir` **已经**是被确认的根——由 `validarDirDentroDoHomeNoLinux`（RN-434，在 Linux 上拒绝 `$HOME` 之外的 `--dir`）和 `garantirDiretorio`（RN-435）校验，两者都在 CLI **启动**时，在任何通道连接或任何容器启动**之前**。容器的挂载**就是** `estado.dir`，仅此而已——runner 一侧不存在（也不需要存在）类似 `caminhoDeWorkspaceLocalValido` 的第二次检查。RN-434"开始也覆盖被挂载的路径"，只是因为挂载使用了它已经校验过的**同一个**变量，而不是因为写了什么新东西。

## 后果 {#consequences}

**`packages/docker-port` 在 runner 一侧获得**真实使用**——以前只由 `--self-test-docker` 证明（ADR 0112/0128）；现在 `DockerViaCli.start/stop/
exec` 被真正调用，使用的是用户的 Docker。

**`DockerPort` 的**五个**操作仍然没有第六个**——`start`/`stop`/`remove`/`inspect`/`exec` 依然是这五个；本 PR 只是给它们第二个使用者（runner，除 broker 之外），从不在规格中增加新字段。

**`mounted` 获得与 `runner` **相同**的路径**——三个用例中的分支按 `executionMode !== 'container'`，而不是按 `executionMode === 'runner'`；只要有已连接的 runner，`mounted` 也可以启动自己的容器（`brabo-runner` 在两种模式下运行方式相同，RN-169/RN-421/RN-422）。

**对于 `mounted`/`runner`，`join` 的结构性约束（broker，ADR 0055）仍然缺失**——ADR 0055 早已记录的符号链接途径仍然开放；本 PR 关闭的是**完全没有**隔离的状况，而不是一道与服务器一样坚固的边界。`guard.ts` 按不变量仍然是尽力而为——不是本 PR 的缺口。

**按 `{project_id, machine_id}` 的排他性继续推迟**（CLAUDE.md、ADR 0104 中早已声明的缺口）——两个 runner 连接到同一项目仍然不可能，是由于 `Registry`（`:global`）的排他性，而不是某个容器检查。

**考虑并放弃的替代方案：在 `mounted`/`runner` 路径中也重新选举镜像，调用 `DecidirImagemDoProjetoUseCase`。** 这会让两条路径在外观上对称，但会迫使 `container_start` 的 payload 携带 `network`/`resources`/`rationale`，即使没人使用它们（runner 不需要它们：它只读取当前的决定）。被放弃：`mounted`/`runner` 路径早已有镜像决定——之前已经有人以一贯的方式决定了，由 Arquiteto 或 Infra——在这里重新选举会重复一个已经存在的决定，而且没有任何新的候选可供选举。
