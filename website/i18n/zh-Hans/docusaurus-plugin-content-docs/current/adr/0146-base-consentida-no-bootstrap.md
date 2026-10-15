---
traducao_de: 285d458e5d984ace5ddf0fb39263b3b1ae7e8ff0
---

# 0146 — 在 bootstrap 中经同意设定的 base，以及 `mounted` 作为本地默认值

## 背景 {#context}

ADR 0141 创建了 `BRABO_PROJECTS_BASE`：宿主机上的**一个** base，按同一身份（`$X:$X`）挂载到
`api` 和 `engine` 中，“挂载文件夹”模式下所有项目的文件夹都放在其中。它解决了它打算解决的问题——
compose 中每个项目一行 bind-mount 的做法结束了，随之结束的还有为接入**一个**项目而杀死所有进行中
agent 回合的重启。

但它让该变量**默认缺失**，而这个后果正是本阶段存在的理由。没有该变量时，api 报告
`projectsBase: null`，创建向导**不提供**该模式（`docs/adr/0141-base-unica-dos-projetos-montados.md:68-72`）。
因此，一个刚克隆下来的安装的正常状态是：唯一把代码放进用户能在编辑器中打开的文件夹的模式**不出现
在界面上**。`container` 没有用户能看到的文件夹；`runner` 需要二进制、`chmod`、配对，以及——自
ADR 0145 起——用户机器上运行着的 Docker。产品有三种执行模式，而没有一种能在不做任何没人要求用户做
的配置工作的情况下，交付用户期望的最简单的东西：看到文件。

缺的是一个**同意的动作**。选择项目放在哪里是机器主人的决定，只发生**一次**，并且发生在**宿主机
上**——不在容器里，不经由 api，不经由 web 界面。产品恰好已经有一个具备这三种属性的地方：
`pnpm bootstrap`（`scripts/dev/bootstrap.sh`），这个菜单已经会创建 `.env`、修正文件夹的属主并
重新配置 Ollama。

还有第二个自 ADR 0130 以来已经改变、本阶段不能忽视的事实。broker 在
`profiles: ["container-broker"]` 下启动，**默认不启动**，记录下来的理由是字面的
（`docs/adr/0130-broker-de-container.md:131-135`）：

> Nada o chama para escrever ainda; dar acesso ao Docker do host a toda máquina
> de desenvolvimento **em troca de nada** seria uma mudança de postura sem
> contrapartida.

这句话的前提——“没有东西调用它”——已不再成立。ADR 0133 给了 `container_start` 一个真实的调用者；
ADR 0136 增加了 `stop` 和 `remove`；ADR 0134 增加了 `exec`。而 ADR 0144 让 `mounted` **通过
broker** 启动容器。在没有开启该 profile 的本地 compose 中，一个 `mounted` 项目不会以配置错误告终：
它以 `BrokerIndisponivelError` 告终，而那时用户已经选了模式、创建了项目，并与 Arquiteto 对话过。

## 决策 {#decision}

### 1. 默认 base 是 `$HOME/projetos-brabo`，写入它的是 Node，而不是 bash {#1-a-base-padrão-é-homeprojetos-brabo-e-quem-a-grava-é-node-não-bash}

建议的路径是 **`$HOME/projetos-brabo`**，写入之前总是展开为绝对路径。`~` 仍然被禁止，这不是出于
喜好：Compose 不会在要紧的那一侧展开它，写下它会创建一个名为 `~` 的文件夹
（`.env.example:225-229`）。

放在 `$HOME` 下，是因为这是 Docker Desktop **默认**共享的位置——macOS 上的 `/Users`，Windows 上
的用户配置文件目录。一个要求用户在能工作之前先打开 Docker 设置的默认值不是默认值；它是一个伪装的
问题。不用 `$HOME/brabo`，因为 base 不能是（也不能包含）Brabo 自身的 checkout——
`scripts/dev/preflight.mjs:316` 已经会在这种情况下拒绝启动——而把产品克隆在那里的人恰好会落入这个
拒绝。

也**不用 `$HOME/brabo-projetos`**，尽管它是最自然的名字，因为 `.env.example:202` 已经把这个路径
用作 `PROJECT_WORKSPACES_HOST_DIR` 的注释示例——即**产品**管理的 workspace 的根。它们是属主相反的
不同变量，而 ADR 0141 正是因为碰撞会“以一种难以看清的方式出问题”而拒绝把它们混为一谈：
`<base>/loja` 会与一个 `workspace_dir_name` 同样为 `loja` 的 `container` 项目冲突，bootstrap 会在
别人的项目里执行 `git init`（`.env.example:231-237`）。把文档已为另一个变量建议的路径提作默认值，
就是从正门走进这个陷阱。

不过，名字只是闪避。保护是**机制**：脚本**拒绝**任何等于、包含或被包含于
`PROJECT_WORKSPACES_HOST_DIR` 的 base，复用 `scripts/dev/base-de-projetos.mjs` 中的 `dentroDe`——
这正是已经支撑 `baseSobrepoeOCheckout` 的同一个函数。这项检查适用于键入的路径，而不只是默认值；
选得好的默认值只是避免让拒绝成为用户看到的第一件事。

**写入的是 `scripts/dev/consentir-base.mjs`**，新的文件，是
`scripts/dev/base-de-projetos.mjs`（它已承载归一化与重叠的纯逻辑）的兄弟，由 `bootstrap.sh` 的
一个菜单项调用。

它不是 bash，两个理由都是测出来的，而不是审美上的。第一：`bootstrap.sh` **没有**向 `.env` 写变量
的 helper——`garantir_env`（`scripts/dev/bootstrap.sh:91`）只在文件不存在时复制 `.env.example`。
唯一能原地更新键、保留注释并在键不存在时追加到末尾的 helper 是 `escreverEnv`
（`scripts/dev/preflight.mjs:128`）。第二个、也是决定性的：**菜单项无法提问**。菜单中的每条命令
都在后台运行，stdin 来自 `/dev/null`（`scripts/dev/bootstrap.sh:770`），那一行上方的注释解释了
原因——没有它，任何读取 stdin 的东西都会抢走用户的方向键，而一条等待回答的命令会卡住且永远不显示
问题。在菜单中用 bash 写的同意步骤，在构造上就是一个无法同意的步骤。

**已有的值绝不会在没有确认的情况下被覆盖。** 而且**没有 TTY 时，脚本报告并且什么也不做**——
`perguntarUsoDoOllama`（`scripts/dev/preflight.mjs:208`）是字面的先例，它在没有终端时应用默认值
并发出提示，而不是卡住。一个在 CI 的管道中自己“同意”的同意脚本，是对这个词的否定。

文件夹在用户接受默认值或键入另一个路径**之后**才用 `mkdir -p` 创建，绝不在之前。

### 2. Docker Desktop 的共享靠**挂载**来证明 {#2-o-compartilhamento-do-docker-desktop-se-prova-montando}

在 macOS 和 Windows 上，一个不在 Docker Desktop 共享列表中的文件夹挂载出来是**空的**，或者让
`docker run` 失败——而整个“挂载文件夹”模式都依赖于这个挂载。校验是必需的，而它的形式就是裁决：

**靠挂载来证明，绝不读取 Docker Desktop 的配置。** 测试是一次
`docker run --rm -v <base>:/sonda <imagem já presente> ls /sonda`。读取 `settings.json` 等于在一个
未文档化、随版本以及在 macOS 与 Windows 之间变化的结构中读取声明的**意图**，它描述的是用户配置了
什么——而不是 daemon 会做什么。挂载测量的是**属性**。这与产品已经对 provider 应用的尺子相同：能力
只有在被执行证明时才被声明，绝不从官方文档中读取（ADR 0041/0042）。

只在 macOS 和 Windows 上，按 `process.platform`。在 Linux 上没有共享列表：检查只是存在性和写权限，
别无其他。这使该校验成为产品的**第二个**平台守卫——第一个是 `validarDirDentroDoHomeNoLinux`
（`apps/runner/src/guard.ts:240`），它**只**在 Linux 上把 `--dir` 限制在 `$HOME` 中。两者在原则上
是对称的：各自只在限制有意义的地方进行限制。值得记录的是，如今**没有任何开发脚本检测平台**——
`bootstrap.sh` 和 `preflight.mjs` 都不调用 `uname` 或读取 `process.platform`——因此本 ADR 引入了
这个模式，这也是它被写在这里、而不是变成一个没有主人的 `if` 的原因。

base 不在列表中：**以可操作的消息拒绝**，说出被测试的路径以及在哪里添加它（Docker Desktop →
Settings → Resources → File sharing）。绝不写入变量，绝不悄悄地挂载。一个被接受却未被共享的
base，会产生一个 api 接受、创建并展示的项目——而它的容器启动时文件夹是空的，远离做出选择的那个
界面。这与 RN-170 是同一个教训，也是拒绝出现在写入之前的原因。

### 3. broker 在**本地** compose 中移出 `profiles`，并且只在那里 {#3-o-broker-sai-do-profiles-no-compose-local-e-só-nele}

**裁决：在 `docker/docker-compose.yml` 中移出；在 `docker/docker-compose.prod.yml` 中保留在
`profiles: ["container-broker"]` 之下。**

原来的理由（`docs/adr/0130-broker-de-container.md:131-135`，在“背景”中引用）有两半，只有第二半
还站得住。“还没有东西调用它来写入”自 ADR 0133/0134/0136 起就是**错的**——broker 有四个真实的调用
者。而“毫无回报”已不再描述这笔交换：随着本 ADR 让 `mounted` 成为本地默认值（第 4 点），以及 ADR
0144 让 `mounted` 通过 broker 启动，关闭的 profile 成了把**默认模式**与以
`BrokerIndisponivelError` 告终分隔开的东西。回报是存在的，而且它就是常规路径。

支撑本地↔生产这种不对称的，是 socket 在两侧各自意味着什么。**运行 `pnpm dev` 的人已经拥有
Docker 的 socket**——他正在用宿主机自己的 daemon 运行 `docker compose`。broker 获得它并没有授予
操作者尚未拥有的任何东西；边际的攻击面是 broker 自己的 HTTP，它不发布端口
（`docker/docker-compose.yml:486-487`），位于只有 api 能到达的 `internal: true` 网络中，并以常数
时间比较 `BRABO_SERVICE_TOKEN`。在生产中计算正相反：socket 是真正的权限边界，操作者不是开发者，
而本阶段没有任何东西改变生产安装的默认模式。所以 profile 留在那里。

**五层隔离没有被触碰**（`docs/adr/0130-broker-de-container.md:171-176`）。本 ADR 改变的是 broker
**何时**运行，绝不是它**接受什么**：它仍然接收 `projectId` 和五种操作之一，仍然去 api 读取
Arquiteto 的决定，并且仍然没有任何可以写入 `privileged`、`cap_add`、`network: host` 或一个自由
`-v` 的参数。隔离从来都不是 profile。

`DOCKER_GID`/`group_add` 仍然是环境上的脆弱点，而现在它适用于每一台开发机，而不只是开启了 profile
的人——见“后果”。

### 4. 配置了 base 时，`mounted` 是向导的默认值 {#4-com-base-configurada-mounted-é-o-padrão-do-assistente}

base 存在：**预先选中 `mounted`**，路径**建议**为 `<base>/<slug>` 且可编辑。base 缺失
（`projectsBase: null`）：**不提供** `mounted`，`container` 仍是默认值。

这两半都不是新规则。“没有 base 就不提供”是 RN-500 以及
`docs/adr/0141-base-unica-dos-projetos-montados.md:68-72`；“建议 `<base>/<slug>`”是 RN-501 和
ADR 0142，后者推迟了磁盘校验，恰恰是为了让向导能提议一个**尚不存在**的路径。本 ADR 记录的是**这两者
从未在客户端实现**：`GET /workspaces/:workspaceId/projects-base` 在 web 中没有任何调用者，而该模式
的卡片被无条件地提供。本阶段让它们成真；而不是发明它们。

新的是**预先选中**。它**修订了 ADR 0072 的默认值**，在那里 `container` 是“常规的”，本地模式是
escape hatch——并且**只为本地安装**修订它，那里的 base 是由人在宿主机上同意设定的。枚举
`projectExecutionModeEnum` 不变，没有新模式诞生，模式之间的转换（ADR 0111）保持完全相同。

### 5. 同意脚本在仓库中进行版本管理 {#5-o-script-de-consentimento-é-versionado-no-repositório}

`scripts/dev/consentir-base.mjs` 位于仓库中，进入 diff，经过审查，对每个人都是同一个文件。
**绝不由 api 动态生成，绝不在运行时下载。**

这与已经按 commit SHA 固定每个第三方 action、并用 `sha256sum -c` 校验每个下载的二进制的供应链
相同：一个配置用户宿主机、创建文件夹并写入 `.env` 的脚本，恰恰是其来源必须可审计的那种产物。由
api 生成的脚本会是在用户机器上运行、**没有人审查过**的代码，经由一个产品不验证其完整性的渠道
交付。

明确的推论：**api 不会获得输出宿主机脚本的路由。** 已有的代理 `GET /runner-releases/binary` 不是
这种情况的先例——它提供的是一个已经**发布**在 GitHub Releases 上的产物，而不是生成一个；而那条
路径上缺少签名，正是 **BRB-005**，一个开放的 backlog 条目，而不是可以模仿的模式。

## 后果 {#consequences}

克隆 Brabo 并运行 `pnpm bootstrap` 的用户，最终会得到一个经同意设定的 base，它已针对用户实际拥有
的 Docker 做过校验，而向导默认提供的模式会把代码放进用户能在编辑器中打开的文件夹。本阶段的第 2、
3、4 次会话依次构建 bootstrap 的步骤、向导的行为以及 profile 的变更。

**本 ADR 不触及什么。** `decide.ts` 和绝对上限保持完全相同——这里没有任何东西是 agent 的动作。
`proposed_action` 仍是所有外部效果的来源。event log 的不可变性没有被碰到。镜像的闸门如 ADR 0135
所留下的那样适用于三种模式，一个没有已决定的 `artifact.project_image` 的 `mounted` 项目在代码
标签页仍返回 409。broker 仍然只有**五种**操作，规格由计算得出、从不被接受（ADR 0128/0130）——
第六种操作仍是需要独立 ADR 的产品决策。

**声明的代价 1：`DOCKER_GID` 对每个人都变得重要。** 当 broker 只在 profile 下启动时，错误的
`group_add` 影响的是有意开启 profile 的人。现在它在本地 compose 中默认启动，错误的 GID 对任何开发者
都会变成 socket 上的权限错误。默认值 `${DOCKER_GID:-999}` 在许多 Linux 发行版上是对的，在另一些
上是错的；第 4 次会话应在 `preflight.mjs` 中报告这一点，连同 base 的状态，而不是让故障只在有人提议
`container_start` 时才出现。

**声明的代价 2：只有一个 base，而且它是可浏览的。** ADR 0141 已经声明了这两点，本 ADR 原样继承而
没有改进：base 之下指向外部的 symlink 在两侧解析结果不同，而 base 之外的代码需要移动文件夹。
`.env.example:239-241` 已经指示选择一个**专用**文件夹——base 下的一切都能从产品的容器内部到达——
同意步骤的消息重复了这条指示，而不是假定它已被读过。

**声明的代价 3：共享探针要花一次 `docker run`。** 它只运行一次，在同意的动作中，并复用一个已有的
镜像以免访问网络。如果本地一个镜像都没有，该步骤会说明这一点，并请用户先运行一次 `pnpm dev`——
绝不为了能够测试而自行下载镜像。

**承担的缺口，附来源。** 在 `runner` 模式下的 `docker exec` 路径上，git 凭据仍会被丢弃
（`apps/runner/src/index.ts:318-320`；Docker 端口没有 `env` 字段，这是 ADR 0130 的设计）——本
阶段不关闭它。项目内部指向外部的 symlink 仍然不会被 `decide()` 检测到，后者是纯函数、不做 I/O
（`docs/adr/0055-escopo-de-caminho-na-politica-de-terminal.md:9-15`）；`apps/runner/src/guard.ts:9-31`
按声明的不变量仍是尽力而为。**BRB-005**（已发布产物的签名）和 **BRB-031**（手动 `chmod +x`）仍然
开放：本阶段触及它们而没有解决它们。

**Windows 不在被测试的路径上。** 共享探针在 Windows 上会运行，因为 `process.platform` 包含了它，
但产品仍然只在 Linux 和 macOS 上得到执行（`.env.example:198-201`），本阶段没有任何东西改变这一点。

参考 [0130](0130-broker-de-container.md)（profile 与五层）、
[0141](0141-base-unica-dos-projetos-montados.md)（本 ADR 开始对其进行同意设定的 base）、
[0142](0142-validacao-de-workspace-montado-adiada.md)（让建议成为可能的推迟校验）、
[0144](0144-a-segunda-raiz-do-broker.md)（`mounted` 经由 broker 启动）以及
[0072](0072-projeto-local-ou-container.md)（第 4 点为本地安装所修订的默认值）。它们都没有被编辑。
[0147](0147-agente-local-com-capacidades.md) 是本阶段的兄弟，决定另一半：本地 agent 及其能力。
