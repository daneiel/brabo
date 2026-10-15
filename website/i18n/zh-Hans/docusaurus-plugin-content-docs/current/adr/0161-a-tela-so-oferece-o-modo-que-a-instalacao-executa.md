---
traducao_de: 9624de8abe26503310142e39c49058bc36338c6d
---

# ADR 0161 — 界面只提供安装能执行的模式，而通过 Release 的安装没有 broker

## 状态 {#status}

**Accepted.** 由维护者于 2026-09-18 决定（AT-085），对问题“安装程序启用 broker，还是界面不再提供无法运行的东西？”的回答是“两者都要”。修订
[RN-513](../business-rules.md#rn-513)（[ADR 0146](0146-base-consentida-no-bootstrap.md)，第 4 点）的预选，并为
[RN-521](../business-rules.md#rn-521) 增加一个本地拒绝原因。两者都不被编辑；本文档引用它们。**只交付了界面那一半**——安装程序那一半经测量后停下，原因见“停下的那一半”一节。

## Context {#context}

2026-09-14 通过一行命令进行的一次 v6.1.0 真实安装，通过 web 以 `mounted` 创建了一个项目。它是**预选**的模式：`install.sh` 总是写入 `BRABO_PROJECTS_BASE`（经同意的基础目录，[RN-531](../business-rules.md#rn-531)），而有已知基础目录时 [RN-513](../business-rules.md#rn-513) 会预选 `mounted`。event log 中随后发生的是：

- 6× `dev.started` → 6× `dev.blocked_by_container`；
- 2× `container.start_failed`，带有 *"BROKER_URL não está definida — o broker de
  container não faz parte desta instalação…"*。

没有人能在那个项目上工作，永远。`container` 和 `mounted` 只能通过 BROKER 启动容器（[ADR 0144](0144-a-segunda-raiz-do-broker.md)），而没有 `running` 容器，任何 dev agent 命令都不会运行
（[ADR 0143](0143-agentes-de-dev-so-depois-do-container.md)）。只有 `runner` 不依赖它：启动容器的是用户机器上的本地 agent
（[ADR 0137](0137-o-runner-sobe-o-container-do-projeto.md)）。而 `/containers` 页面允许批准了那两个只能失败的 `container_start`。

**经测量，且与活动描述不同：** 安装用 compose 并没有“在关闭的 profile 下继承 broker”。`broker` 服务在 `docker/docker-compose.install.yml` 中**根本不存在**——其文件头在第 3 点就这样说——而这种缺席已在 [ADR 0150](0150-instalador-de-uma-linha.md) 的决策 7 中书面决定，该决策也把它声明为“在安装程序的输出中”。缺陷不在于安装程序隐藏了这种缺席：而在于**界面**不知道它，并提供——甚至预选——这种缺席会让其无用的模式。

## 停下的那一半：安装程序无法获得 broker 的镜像 {#a-metade-que-parou-o-instalador-não-consegue-obter-a-imagem-do-broker}

维护者的决定有一个 (a) 部分：`install.sh` 询问是否启用 broker，并以文字说明风险（挂载到服务中的 Docker socket 在宿主机上等同于 root）。在写下这个问题之前，先测量了安装能否拥有回答“是”时要启动的镜像。**它不能：**

- `docker-bake.hcl` 有四个目标（`api`、`engine`、`web`、`backup`）；
  `scripts/ci/images-manifest.ts` 不认识 `broker`；Release v6.1.0 的 `images.json` 恰好列出这四个；
- `docker manifest inspect ghcr.io/daneiel/brabo-broker:6.1.0` 回答
  `denied`（该仓库不存在），而对
  `ghcr.io/daneiel/brabo-api:6.1.0` 执行**同一**匿名命令可以解析——不是缺凭据；
- Release v6.1.0 的 assets 中既没有 `docker/broker/Dockerfile.prod`，也没有
  `apps/broker`/`packages/docker-port` 的代码，因此在没有 checkout 的文件夹中运行的一行命令安装（[ADR 0160](0160-o-compose-do-instalador-viaja-assinado.md)）连可以构建的东西都没有。

一个回答“是”却没有镜像可启动的问题比没有问题更糟：用户同意了 socket 的风险，收到的却是 `pull access denied`。只有 `--source=local`（干净的 checkout，在 tag 上）才能构建 broker——即便如此，安装用 compose 中也没有这个服务。修正就是 ADR 0150 已经指出的、规模小且不在其范围内的那件事：把 broker 作为第五个镜像发布（bake 中一个目标、清单中一个 id、多一个签名），**然后**才是安装程序的问题。它留给一条专属战线，正是那条战线会重新打开这一半。本 ADR 没有触碰 `install.sh`。

## Decision {#decision}

### 1. api 在界面已经读取的两条路由中说明安装是否有 broker {#1-a-api-diz-se-a-instalação-tem-broker-nas-duas-rotas-que-a-tela-já-lê}

`brokerConfigurado: boolean` 进入**两个现有响应**，不新增任何路由：

- `GET workspaces/:workspaceId/projects-base`——创建向导的问题本来就是*“这次**安装**能执行什么模式？”*，而基础目录只是一半。相同的最低角色（`maintainer`）、相同的调用者、相同的时刻；
- `GET workspaces/:workspaceId/containers`——按**行**，所有行同一值。响应是一个列表，换成信封结构会为一个属于安装的字段打破合约。

来源是 `ContainerBrokerPort.configurado()`，与决定观测状态的读取是询问 broker 还是声明缺席的**同一个**——第二次读取 `BROKER_URL` 就会成为某天产生分歧的第二个来源。该字段说明变量**存在**，从不说明 broker **有响应**：知道这一点的仍然是
`naoObservado`（[RN-486](../business-rules.md#rn-486)）。

### 2. 向导在没有 broker 时不预选 `mounted`，而是提供 `runner` {#2-o-assistente-não-pré-seleciona-mounted-sem-broker-e-oferece-runner}

三种状态，不会合并：

- **broker 已确认**（`true`）：RN-513 的行为不变——有基础目录时预选 `mounted`；
- **确认缺席**（`false`）：`container` 和 `mounted` 继续**在界面上**（移除卡片会隐藏信息——[RN-102](../business-rules/custo.md#rn-102) 的“移除的是控件，绝不是信息”尺子），但**不可用**，原因以文字在其下方说明**一**次，`runner` 是预选项。在响应到达之前所做的、处于被它变为不可执行的模式中的人为选择，会落到 `runner`——与基础目录消失时已经让 `mounted` 落下的规则相同；
- **不知道**（加载中、查询失败、字段缺失）：既不是“有”也不是“没有”。不预选 `mounted`——这是对 RN-513 的修订——也不锁定卡片，不以文字断言一个没人确认过的缺席：保持选中 `container`，与以前一样。

### 3. `/containers` 在点击之前拒绝启动，带专属原因 {#3-a-containers-recusa-a-subida-antes-do-clique-com-motivo-próprio}

`decidirSubida` 增加原因 `sem_broker_na_instalacao`，对 `container` 和
`mounted` 在 `brokerConfigurado !== true` 时适用——“不知道”不会变成“有”。它紧跟在 `ja_esta_de_pe` 之后、在 `sem_imagem_decidida` **之前**：在一个没有人能启动容器的安装中，叫人去决定镜像就是指错了门。`runner` 从不落入其中。分支与 `acaoDeSubidaDoModo` 的按**目的地**分支相同（依赖 broker 的是提出 `container_start` 的那一方），在另一侧由 `usaBroker` 读取，而不是第二把尺子。

## Consequences {#consequences}

- 在通过 Release 的安装中，端到端可用的模式成为被建议的那个，而不可用的模式在有人选择之前就说明原因。代价：`runner` 要求本地 agent 在运行，以及用户机器上的 Docker——一行命令安装本已提供这些
  （[ADR 0155](0155-a-primeira-conta-nasce-no-terminal.md)）。
- 在**开发**用 compose 中，broker 默认启动（[RN-512](../business-rules.md#rn-512)），但在有人把 `BROKER_URL` 放进 `.env` 之前它保持为空
  （`docker/docker-compose.yml`、`.env.example`）。没有它，开发者的向导开始显示提醒——而且这是**对**的：没有 `BROKER_URL`，api 从不调用正在运行的 broker，`container_start` 同样会失败。
- RN-512 **不**改变：broker 在生产 compose 中仍处于 `profiles: ["container-broker"]` 之下，不在安装用 compose 中，五层约束都未被触碰。改变的是**界面**不再假设相反的情况。

**超出范围，已声明：**

- 安装程序那一半（上节）——取决于发布镜像；
- 模式转换（`ExecutionModeSection`，[ADR 0111](0111-conversao-de-execution-mode-de-projeto-existente.md)）在没有 broker 的安装中仍可转换为 `container`/`mounted`；它读取同一路由，字段触手可及，但那是另一个界面，有另一把提供尺子（[RN-559](../business-rules.md#rn-559)）；
- 停止和移除（`container_stop`/`container_remove`）没有获得该拒绝：没有 broker 就不会有被登记为运行中的 `container`/`mounted` 容器可停止，这种情况没有测量；
- Infra Lead 不知道 broker 缺席——它按**模式**拒绝
  （[RN-566](../business-rules.md#rn-566)），而用安装信息丰富它的上下文是 RN-566 已声明的代价最高的那条战线；
- 忽略被容器阻塞的 agent 的并行化建议；
- `install.sh` 的结束语说没有 broker 时“Pasta montada 模式的项目不会启动容器”，却省略了同样不会启动的 `container` 模式——已测量的相邻问题，未在此修正，因为安装程序属于另一条并行战线。
