---
traducao_de: 94baaa08c45cd0a4b4685d1b071035095fc6285a
---

# 0193 — 带凭据的 git 在 runner 的**宿主机**上运行；代码在容器中运行

## 状态 {#status}

**Accepted.** 2026-10-01（AT-116，故事 HS-037，史诗 EP-010，第 36 轮；
负责人 10月1日的决定：*"operações de git credenciadas no HOST, código no
container"*）。关闭 [RN-558](../business-rules.md#rn-558) 声明为开放的那一半，并在不编辑的前提下引用
[ADR 0130](0130-broker-de-container.md)（没有自由 `-e` 的 Docker port）、
[ADR 0145](0145-docker-pre-requisito-do-runner.md)（`RunnerReadiness` 以及 `runner` 模式的三个前置条件）和
[ADR 0056](0056-o-engine-trabalha-em-repositorio-remoto.md)（git 凭据只在子进程的**环境**中）。证明是 AT-111。

## Context {#context}

2026-10-01 在 `dev` 上测量，改动之前：

- engine 中**唯一**携带 `env` 的 `exec` 是
  `Engine.Actions.Workspace.RunnerGit.fetch!/3` 的带认证 `git fetch`（`GitAuth.env_de_auth/1`，转换为 map；没有 token 的 provider 为 `nil`）。`TerminalExecutor` 调用 `RunnerRouter.exec/4`，从不传 `env`。在 `runner` 模式下不存在经由 `exec` 的带凭据 `push` 或 `clone`：创建文件夹时的 clone 经由 `workspace_create`（RN-532）传输，本就在**宿主机**上运行（`criarPastaDoProjeto`）。
- `RunnerReadiness`（ADR 0145）在 `RunnerGit` 的任何操作之前要求有**已登记**的 `running` 容器，而在 `runner` 项目中，这个登记之所以存在只是因为**同一个** runner 启动了容器——这会设置 `estado.containerAtivo`。设置之后，`tratarExec`
  （`apps/runner/src/index.ts`）会把**每个**命令路由到 `docker exec`，而后者没有 `env` 字段（ADR 0130）。自 RN-558 起，这一对（`env` 存在、容器活跃）以标记
  `credencial-nao-atravessa-o-container` 被**拒绝**：带认证 fetch 的**常见**路径以带名称的拒绝告终，从不成功。
- 两侧的文件夹是**同一个**：`tratarContainerStart` 把
  `estado.dir`（runner 确认的根）挂载到 `/work`
  （`DockerViaCli.start`，`${raizDoProjeto}:/work:rw`，`packages/docker-port/src/docker-port.ts` 中的 `PONTO_DE_MONTAGEM`），每个 `exec` 的 `cwd` 都在 `estado.dir` 内被验证（`validarCwdDentroDaRaiz`），只有在去往容器时才转换为 `/work/...`。宿主机上 fetch 所更新的 `.git` 就是容器看到的那个。

两条被否决的出路仍被否决：`DockerPort` 中自由的 `-e`（ADR
0130 拒绝了它），以及 `RunnerReadiness` 中“跳过容器”的 flag（会为整个 `exec` 推翻 ADR 0145 的第三个前置条件）。

## Decision {#decision}

1. **带凭据的 git 操作在 runner 的宿主机上运行，即使容器处于活跃状态。** dev agent 的命令继续去 `docker exec`。凭据通过一贯有效的路径到达子进程：`apps/runner/src/exec.ts` 把 `env` 合并到 `process.env` 之上。

2. **判别依据是由 engine 设置的**显式标记**，而不是 `env`。**
   `exec` payload 增加可选的 `gitCredenciado: true`，设置它的是
   `RunnerRouter.exec_git_credenciado/5`，由**一个**点调用
   （`RunnerGit.despachar/5`，来自 `fetch!/3`，仅在有凭据时）。该函数通过子句守卫要求 `env` 非空。runner **只有**在两者**同时成立**（字面值为 `true` 的标记**且**非空 `env`）时才在宿主机上运行。

   为什么不单靠已存在的 `env`：那样的话，任何带 `env` 到达的 `exec` 都会逃出容器——`env` 会变成 ADR 0145 为代码设置的约束的出口。有了标记，出口就是 engine 唯一调用者的一个**有名称**的决定，而没有标记的 `env` 得不到宿主机。标记单独也不够：没有凭据就没有要保护的东西，命令照常路由。

3. **ADR 0130 的任何 port 都不变。** `DockerPort.exec` 继续没有 `env` 字段；镜像、网络、挂载和 broker 都不被触碰。
   `RunnerReadiness` 逐字节保持：标记改变的是 runner 在**哪里**执行，从不改变 engine **是否**分派——已登记 `running` 容器的前置条件对 fetch 同样有效。

4. **RN-558 的拒绝继续存在，并收缩为一种情况。** 没有标记的（`env` 存在、容器活跃）这一对，继续以相同的协议标记和来源 `politica` 被拒绝。今天 engine 的任何调用者都不会产生这一对；实际上它会因版本**不匹配**而出现——早于本 ADR 的 `brabo-runner` 不读取该标记，把 fetch 路由到容器并像以前一样拒绝。因此
   `Engine.Runners.CredencialDeGit.mensagem/2` 的消息开始说明修复方法（更新 runner，或停止容器），而不是“缺失的那一半不存在”。runner 拒绝的文本也改变了（说明“SEM a marca de
   git credenciado”），fixture
   `apps/runner/fixtures/exec-result-recusa-de-credencial.json` 随之改变。

5. **日志不变式继续有效。** 拒绝和宿主机路径的日志都不引用 `env` 中变量的名称或值——拒绝给出**数量**，宿主机日志只加上 `[git credenciado, no host]`。命令文本照常被记录（它携带 ADR 0056 的 helper，按名称引用变量，但从不引用值——这里不改变）。

## Consequences {#consequences}

- 在 `runner` 模式下，**带认证**的远程仓库 fetch/clone 在容器运行时开始可用，这是常见路径。RN-558 不再在其中触发。
- **旧 runner + 新 engine：** runner 忽略标记并以 RN-558 的标记拒绝；engine 说“更新 runner”。**新 runner + 旧 engine：** engine 不发送标记，runner 像以前一样拒绝。没有任何组合会回到静默丢弃。
- 带凭据的 git 以**宿主机**的用户和 `git` 运行，而不是容器的。fetch 写入 `.git` 的文件以 runner 进程的所有者身份诞生——也就是被挂载文件夹的所有者。**未测量：** 一个 `--user` 不是该所有者的 `runner` 项目容器，会看到所有者不同的已更新 `.git`；今天 api 发送给 runner 的规格（`EspecificacaoDeContainerParaRunner`）没有 `usuario`，因此容器以镜像的用户运行，这一效果尚未针对真实 Docker 演练过。
- RN-558 曾把这个选项列为“会打破工作在容器内发生这一不变式”的那个。负责人的决定以写明的代价接受了它：离开容器的是 `git` 与远程的**对话**（带凭据的 fetch），绝不是项目的代码——dev agent 的 `npm install`、测试和构建继续在 `docker exec` 中。fetch 带来的是 git 对象，只有在一次不携带凭据、照常路由的 `checkout`/`worktree add` 中才会变成工作文件。
- 宿主机需要安装 `git`。它本来就需要：`workspace_create`（RN-532）和无容器路径一直都在宿主机上运行 `git`。
- 标记是 `exec` 这一对中的第二个协议常量，与 `env` 并列。它只有在为 `true` 时才被传输（普通终端的 payload 与之前逐字节相同），runner 只接受布尔值 `true`——任何其他值都等于缺失。
- 不在范围内：今天不存在经由 runner `exec` 的带凭据 `push`；如果诞生，它经由同一个函数（`exec_git_credenciado/5`）进入，绝不经由第二条标记路径。
- 证明（AT-111）在两侧都把拒绝换成成功：
  `apps/runner/src/index-handlers.spec.ts`（容器活跃且有标记时，真实的 `git` helper 收到凭据，一次真实的 `git fetch origin` 在宿主机上成功，没有 `docker.exec`；没有标记的 `env` 继续被拒绝）以及
  `apps/engine/test/engine_web/channels/credencial_no_runner_test.exs`（经由真实的 `TerminalChannel`，fetch 带标记发出，链条以 `{:ok, _}` 结束）。ExUnit 测试没有在本次交付的环境中运行（`repo.hex.pm` 返回 403）；证明它们的是 CI。
