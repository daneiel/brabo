---
traducao_de: 2245f20165791640b2229d908c179ea2f0925828
---

# 0144 — broker 的第二个根，以及选择它的可辨识定位符

## Context {#context}

broker（ADR 0130）是产品中唯一与服务器上 Docker daemon 通信的进程，而让它受约束的只有一件事：**它不接受容器规格**。它接收一个 `projectId` 和五个操作之一，去 api **读取** Arquiteto 的决定，然后自己**组装**镜像、网络、资源和唯一的挂载。没有任何路径穿过网络——api 发送 `workspaceDirName`，broker 把它与**自己的**根
（`PROJECT_WORKSPACES_HOST_ROOT`）拼接起来。

这种形式只有一个根，因为从服务器的角度看，项目文件夹只能在一个地方：`/data/project-workspaces`，即 `container` 模式下由产品**管理**的文件夹。`mounted` 和 `runner` 项目被排除在外，broker 在源头以 `ModoDeExecucaoNaoSuportadoError` 拒绝两者。

ADR 0141 改变了支撑这一拒绝一半理由的现实。所有处于“挂载文件夹”模式的项目都开始住在**一个**基础目录下
（`BRABO_PROJECTS_BASE`），以同一路径挂载到 `api` 和 `engine`，因此服务器的 daemon 可以到达。broker 的拒绝是关于**几何**的——“它的代码在一台我看不到的机器上”——而 `mounted` 的几何不再是这样。`runner` 的则毫无变化。

这引出了一个单根形式无法回答的问题：给定一个段，**它针对哪个根有效？**

显而易见的诱惑是 api 发送绝对路径，broker 挂载它。这会把 ADR 0130 整个推翻：一个在宿主机上等同 root 的进程的约束，将重新依赖于**调用者**是否正确，而这正是没有约束的定义。第二个诱惑是 broker 去猜——当模式为 `mounted` 时使用基础目录。这在出现第三个地方之前都行得通，而在那之前，它把决定藏在一个关于 broker 并不拥有的枚举的 `if` 里。

## Decision {#decision}

**broker 获得**第二个**根 `BRABO_PROJECTS_HOST_BASE`，api 开始发送一个**可辨识**的定位符，说明段针对两者中的哪一个有效。**

```ts
localizacao:
  | { tipo: 'gerenciada';   segmento: string }  // PROJECT_WORKSPACES_HOST_ROOT
  | { tipo: 'montada';      segmento: string }  // BRABO_PROJECTS_HOST_BASE
  | { tipo: 'indisponivel'; motivo: string }    // nenhuma raiz alcança
```

不变式保持在原处。穿过网络的仍然只是 broker 的根所不覆盖的那一半；api **不**知道这些根在宿主机上的位置，broker 对项目一无所知。任何一方单独都无法写出任意路径——改变的是 api 开始说明**哪个**根，而不是只有一个根、答案是隐含的。

**两个变量而不是一个，并且它们之间不继承。** 管理根由 `workspace_dir_name`（UNIQUE）命名，基础目录由用户命名。同一个名字在两者中指向不同的文件夹，schema 中没有任何东西阻止冲突——这是 ADR 0141 拒绝把
`BRABO_PROJECTS_BASE` 与 `PROJECT_WORKSPACES_HOST_DIR` 混为一谈的第一个原因，在这里同样成立。因此 `BaseDeProjetosNaoConfiguradaError` 是一个**专属**类，与 `RaizDeWorkspacesNaoConfiguradaError` 同一模子：来源 `infra`，消息点名变量，不触碰任何容器。默认落到另一个根会挂载**另一个**项目的文件夹，而容器会启动——里面是错误的代码，没有任何东西说明原因。

**三种变体而不是两种。** `indisponivel` 不是伪装的 `null`：它是本服务器上没有任何根能到达该文件夹的状态，有两种不同的修复方式。`runner` 项目（文件夹在用户机器上——修复是另一侧的 `brabo-runner`）以及在基础目录之前创建的**遗留** `mounted` 项目（修复是移动文件夹）。一个 `null` 会有一半的时间把运维人员指到错误的地方。**就是**基础目录本身的文件夹也落入这里，而不是变成空段：`<raiz>/` 会把整个基础目录——所有挂载项目的文件夹——挂载到单个项目的容器中。

**broker 所服务的模式列表是**允许**列表**，而不是拒绝列表（`container`、`mounted`）。api 枚举中的新模式以被拒绝的状态诞生，并带有消息，而不是静默地被接受，然后落入一个没有根能解析的组装中。

**拼接之上有三道屏障，而不是一道。** api 拒绝不在基础目录下的东西（`segmentoSobABaseDeProjetos`）；`packages/docker-port` 拒绝非相对的段（`segmentoDeProjetoValidado`：`..`、绝对路径、空、双斜杠、NUL）；而 `raiz + segmento` 的结果在变成 `-v` 之前仍然要经过 `raizDeProjetoValidada`，一如既往。只验证段而不验证拼接，就是信任字符串运算——而 broker 一侧的验证之所以存在，正是因为它不能假定 api 是正确的。

**api 一侧的后果：`container_start` 的分支改为按**目的地**进行。** `container` 和 `mounted` 去 broker；只有 `runner` 去 runner。而 `container_stop`/`container_remove` 必须一起改变：在服务器上启动、却请求在用户机器上停止，会让正在运行的东西无法停止地继续运行。

**`mounted` 像 `container` 一样**选择**镜像。** 这不是对称：这是在这一侧唯一可行的设计。broker 从 `artifact.project_image` 组装，并去 api **获取**它——一次没有写入这个工件的 Infra 选择将毫无作用，容器会以 Arquiteto 的镜像启动，而人批准的 payload 说的却是另一回事。这正是 ADR 0133 的论据，应用到第二种模式。runner 的路径可以读取当前值，因为在那里 api 通过通道**发送**规格的字段；工件不是另一侧所查询的来源。

## Consequences {#consequences}

“挂载文件夹”模式不再需要连接一个 `brabo-runner` 才能拥有容器。正是这一要求让产品负责人计划所要求的顺序变得不连贯——在创建时选择 `mounted`，并让容器在 dev agent 之前启动。

**`runner` 独自留在 runner 的路径上**，这是设计，而不是剩余：broker（以及服务器）仍然看不到它的文件夹。`container` 仍然是唯一一个在服务器上启动容器而**无需**依赖操作员配置的基础目录的模式；`mounted` 在基础目录存在时于服务器上启动。

**声明的代价 1：一个安装可能有一个根而没有另一个。** 这是合法状态，每个操作都会说明缺的是哪一个，而不是两者都落入一个笼统的拒绝。代价是本可以是一个带参数的类却成了两个错误类——被接受，因为读到错误的人需要知道定义**哪个**变量。

**声明的代价 2：broker 现在认识第二种段格式。**
`gerenciada` 是一个不含 `/` 的名字；`montada` 是一个相对路径，可以有多级。`nomeDeWorkspaceValidado`（服务于容器的**名字**，刻意拒绝 `/`）不再适用于验证路径，`segmentoDeProjetoValidado` 在它旁边诞生。这是两个开始有不同答案的问题——“容器叫什么”和“文件夹在哪里”——在它们重合时，用一个函数回答两者是行得通的。

**本 ADR 不决定的。** 它不实体化任何文件夹（那是延迟验证，相邻的 PR）。它不改变镜像关口——自 RN-494/ADR 0135 起 RN-105 已对三种模式有效。它不改变谁**提出** `container_start`：Infra Lead 仍然可以为没有连接 runner、也没有已决定镜像的项目提出，这是自 RN-494 起声明的缺口。它不改变 broker 的操作数量：仍然是**五个**，第六个仍然是需要 ADR 的产品决定。它也不把 broker 镜像发布到 GHCR——ADR 0119 的四个仍然是四个。

引用 [0130](0130-broker-de-container.md)（broker 组装规格）、
[0133](0133-infra-elege-imagem-do-roteamento.md)（选择需要被写入才能生效）、[0137](0137-o-runner-sobe-o-container-do-projeto.md)
（另一条执行路径）以及 [0141](0141-base-unica-dos-projetos-montados.md)
（让这一切成为可能的基础目录）。它们都不被编辑。
