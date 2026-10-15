---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0130 — 容器 broker：谁与服务器的 Docker 对话，以及它为什么不接受规格

## 背景 {#context}

ADR 0065 决定项目的镜像是 Arquiteto 的 **artifact**，ADR 0081 创建了生命周期表（`project_containers`）。两者
都没有启动过容器：直到今天 CLAUDE.md 都记录着“FASE 25b segue cortada: NENHUM serviço chama Docker”。ADR 0128
构建了基础——一个有**五**种操作（`start`/`stop`/`remove`/`inspect`/`exec`）的 `DockerPort`，以及一个基于
`execFile('docker', …)` 的适配器——放在 `apps/runner` 中，并预先写明，当第二个消费者诞生时，那个文件**会
移动**：*"um segundo arquivo com as mesmas cinco operações e uma sexta 'só no broker' é o começo do fim da
contenção"*。

本 ADR 就是那第二个消费者。它决定三件不可分割的事：端口改放在哪里、broker 是什么，以及是什么阻止一个在宿主机
上等同 root 的服务变成对 Docker 的任意访问。

它**不**重新打开的先前决定：api 永远拿不到 socket。engine 也一样。socket 只挂载到一个服务中，这个服务就是为此
而存在的。

## 决策 {#decision}

### 1. 端口**移动**到 `packages/docker-port` {#1-a-porta-move-para-packagesdocker-port}

`apps/runner/src/docker-port.ts` 和 `docker-cli.ts`（以及两个 `.spec.ts`）变成
`packages/docker-port/src/`，位于一个新的 workspace 包（`@brabo/docker-port`）中，由 `apps/runner` 和
`apps/broker` 消费。没有任何文件是复制的。

**`packages/shared` 被拒绝，理由是经过验证的，而不是审美上的。** 那个包 100% 是**类型**，这个不变量由
`apps/api/test/packages-shared-so-tipos.spec.ts` 保持诚实——它的 `main` 指向原始的 `.ts`，如果有任何值在
`tsc` 之后幸存，api 的生产镜像会在启动时以 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 死掉。一个带错误
类、常量和校验函数的端口是运行时代码。

**新包没有构建步骤，而这正是它可被消费的原因。** 两个消费者都**打包**它：runner 通过 `tsup` 和
`bun build --compile`，broker 通过 `tsup`。两者在镜像中都不在运行时从 `node_modules` 解析它。在开发中，
`.ts` 由 Node 的类型剥离直接执行——pnpm 的链接是 symlink，`realpath` 落在 `node_modules` 之外，所以 Node 的
拒绝不适用（经测量，而非假设）。

**声明的后果：api 不能消费这个包。** 它镜像中的 `pnpm deploy --prod` 会真正复制这个包，没有 symlink，
于是 `realpath` 落在 `node_modules` 之内——这正是 `packages/shared` 的测试存在要防止的错误。这就是
`validarDecisaoDeImagem`（api 的领域）**不搬到这里**、broker 也不导入它的原因。broker 有的是一个**自己的**
解析（`especificacaoValidada`），下一节解释为什么它不是同一规则的第二个版本。

**打包，在移动之后测量。** `pnpm --filter runner build`、`build:bin`、`smoke` 和 `smoke:bin` 仍然通过；
独立二进制（`linux-x64`）加载端口并从内部查询 daemon，这是 ADR 0128 已经证明的。Bun 的 bundle 从 79 个模块
变为 83 个。该包作为 runner 的 `devDependency` 加入——与 `phoenix` 同一层——因为 `tsup` 把 `dependencies`
保留为**外部** `require`，而把 devDependency 内嵌，也因为发布到 npm 的包不能带着一个本仓库之外没人能解析的
`workspace:*`。`apps/runner` 中的 `npm pack --dry-run` 仍产出同样的四个文件。

### 2. broker 不接受容器规格 {#2-o-broker-não-aceita-especificação-de-container}

`apps/broker` 是一个 Node/TS 服务，与 runner 同一家族：没有 web 框架（只有六个路由），纯 `node:http`，自己的
镜像在 `docker/broker/` 中。

让它不任意的不是任何东西的 allowlist。而是输入的**形式**：

> Ele recebe um `projectId` e uma das cinco operações. Vai à api LER a decisão
> do Arquiteto e o contexto do projeto (`GET
> /internal/projects/:projectId/container-spec`). COMPÕE a especificação ele
> mesmo. Não existe parâmetro em que se escreva `privileged`, `cap_add`,
> `network: host` ou um `-v` livre — porque não existe parâmetro.

如果规格在请求体中传递，那么对一个在宿主机上等同 root 的进程的约束就会依赖于**调用者**是正确的。多一次 HTTP
调用，是让约束不依赖任何人的代价，而且代价很低：api 就在同一内部网络的另一端。

**为什么 broker 要重新校验 api 自己返回的东西。** 因为它不能预设回应它的一方是正确的——也因为两次校验回答的
是不同的问题。api 中的 `validarDecisaoDeImagem` 问的是“这个架构决策可审查吗？”（要求 `rationale`，拒绝
`latest`，应用 `RECURSOS_MAXIMOS`，通过 tool-result 把拒绝返回给**模型**）。这里的 `especificacaoValidada`
问的是“我能把这个交给 daemon 吗？”——是把不可信的 JSON 解析成封闭类型。重叠很小且已声明（tag/digest、一个
数值上限），而且不是需要维护的镜像：这里的上限是 **broker** 的，是无论请求来自何处它都绝不超越的最后防线。
如今这些数字有意与 api 的相同；如果有一天出现分歧，较小者胜出，什么都不会坏，因为两者都不声称自己是另一个。

**有一项检查只存在于这一侧，而且是新的：** 以 `-` 开头的镜像引用。`image` 成为 `docker run` 的**位置**参数，
而作为“镜像名”的 `--privileged` 会被 CLI 读成 flag。不经 shell 的 `execFile` 解决的是**命令**注入；**参数**
注入是另一回事，在这里解决。

### 3. `pidsLimit` 进入端口 {#3-pidslimit-entra-na-porta}

ADR 0128 的 `EspecificacaoDeContainer` 有 `cpus` 和 `memoriaMb`，而 Arquiteto 的 artifact 一直有三个数字——
`RecursosDoContainer.pidsLimit` 是能遏制 fork bomb 而不依赖识别命令的东西。没有这个字段，broker 会读取
artifact 并丢弃第三个：artifact 会承诺一个容器得不到的上限，这正是 api 领域本身点名的“承诺多于容器所得的
artifact 是在对审计者撒谎”。

给端口加字段是值得一提的举动，因为这个设计的尺子是不加参数。这把尺子针对的是**放松**的东西。这个是收紧，
它变成与 `--cap-drop ALL` 并列的 `--pids-limit`。

### 4. 网络、端口与 socket {#4-rede-porta-e-socket}

- Compose 中**自己的**网络（`broker`，`internal: true`），在两个文件中都是。api 加入两个网络；engine 和 web
  不加入这个，因此到达不了 broker。`internal: true` 还去掉了 broker 通往互联网的出站路由，它也用不到。
- **没有发布端口。** 宿主机上没有任何东西需要到达它。
- `/var/run/docker.sock` **只**挂载在这里。socket 上的 `:ro` 只是装饰——Docker 的协议是基于该 socket 的
  HTTP，每个操作都会写入——因此没有把它当作约束来用。
- 通过 `BRABO_SERVICE_TOKEN` 认证，与 api↔engine 双向已在使用的同一个机密和同一个 header，以恒定时间比较。
  在生产中，如果该变量为空、是仓库中的公开字面量或少于 16 个字符，broker **拒绝**启动——即 ADR 0059/RN-114
  的尺子，这里比在其他任何服务中都更重要。
- broker 在两个 compose 中都处于 `profiles: ["container-broker"]` 之下，因此**默认不启动**。还没有任何东西
  调用它写入；为了毫无回报而让每台开发机都能访问宿主机的 Docker，会是一次没有对价的姿态改变。
  `docker/smoke.sh` 不带 profile 运行，继续证明同样的三个镜像。

### 5. 没有任何路径穿越边界 {#5-nenhum-caminho-atravessa-a-fronteira}

api 不发送任何路径——既不发送 `workspace_path`，也不发送托管根目录。`docker run` 的 `-v` 由 **daemon** 针对
**宿主机**的文件系统解析；`/data/project-workspaces/<x>` 是 api 容器内部的路径，发送它会让 daemon 创建并挂载
一个**空**文件夹，dev agent 在一个没有代码的目录中工作，而没有任何迹象说明原因。

broker 用 `PROJECT_WORKSPACES_HOST_ROOT`（**它自己**的配置）加上在项目创建时冻结的 `workspaceDirName`
（RN-109）来组成路径。没有这个变量时，`start` 会点名它并拒绝；其他四种操作继续工作。拒绝就是决定：猜测会
悄无声息地产生空挂载。

### 6. api 得到了什么，又有意没得到什么 {#6-o-que-a-api-ganha-e-o-que-ela-deliberadamente-não-ganha}

它得到一个**端口**（`ContainerBrokerPort`）和一个 HTTP 客户端。在声明的五种操作中，**有一种有调用者**：
`inspect`，经由容器生命周期路由，它开始在**登记的**状态旁边返回**观察到的**状态。其他四种是外部效果，没有
`proposed_action` 就不会发生——提议者会是 Infra Lead，由用户拥有最终权限，而那是另一个 PR。现在声明五种、
之后接通四种，与隐藏触发器恰恰相反：方法存在而没有东西调用它，任何对调用者的搜索一秒钟就能显示出来。

它没有得到任何新的写入。`RegistrarTransicaoDeContainerUseCase` 逐字节保持原样，包括模式守卫——它会与 RN-105
在三种模式下的闸门一起取消，在一个同时决定这两件事的 PR 中。因此，**broker 在它那一侧声明同样的策略**：
`mounted`/`runner` 项目以 409 被拒绝，因为它们的代码位于一个 broker 的宿主机看不到的用户文件夹中。现在只改
一侧，会让 api 和 broker 对“存在什么”产生分歧。

## 后果 {#consequences}

**broker 在宿主机上等同 root，而这就是代价。** 写明了，没有隐藏。由五个独立的层约束：没有发布端口；只有 api
能到达的内部网络；恒定时间比较的服务 token；表面封闭的五种操作；以及计算出来、从不被接受的规格。它们彼此
互不信任。

**一种机制，而不是两种。** ADR 0128 在技术上允许 broker 使用 `dockerode`（它从不会变成独立二进制）。产品
负责人的决定是两侧都用 CLI，理由不是技术上的：同一操作的两种机制意味着两种失败方式、两个需要分类的错误面，
以及规格 → daemon 转换的两个版本。代价是 broker 的镜像里需要 `docker` 二进制——`docker-cli`，只有客户端——
这在 Dockerfile 中已付清，`DockerCliAusenteError` 会点名有人挂载了 socket 却没安装客户端的那一天。

**`project_containers` 表现在可能撒谎，而读取会说出这一点。** 以前它不会：`container_id` 总是 NULL。
协调发生在**读取时**，而不是后台 daemon——在外部死掉的容器会显示为登记 `running`、观察 `exited`。这两列永不
合并，“我没能看”有自己的原因（`broker-nao-configurado`、`broker-sem-resposta`、`broker-recusou`），而不是
继承登记值。这是 RN-468 的应用，broker 的任何拒绝都不会拖垮对登记值的读取，后者本身就是合法的信息。

**声明的缺口：** 一个从未有过生命周期行的项目的孤立容器，不会出现在这个路由中——它先读取登记值，然后才询问
daemon。找到孤儿的是按 `brabo.managed=true` 的扫描，而消费它的全局页面是另一个 PR。

**broker 的镜像不发布到 GHCR。** `docker-bake.hcl`、`scripts/ci/images-manifest.ts`（`ALVOS`）和
`release.yml` 仍是 ADR 0119 的**四个**镜像。broker 在 profile 下启动，不属于默认部署，也没有任何东西调用它
写入；现在发布它，会在公共 registry 中放一个没人安装的镜像。当 Infra Lead 的 PR 让它成为必需时，它会走与另外
四个相同的路径进入——在三个地方各加一行，而 `ALVOS` 有测试。

**FASE 25b 不再完全处于裁剪状态，仅此而已。** 存在一个能调用 Docker 的服务，以及一条调用它的**读取**路径。
没有任何容器启动：没有循环，没有队列，没有 `container_start` 的 `proposed_action`。CLAUDE.md 中的那句话改为
恰好说明这一点，别无其他。

**原本不存在的运维新事项：**`DOCKER_GID`。socket 在宿主机上是 `root:docker`，而 broker 进程以非 root 运行，
因此 compose 使用 `group_add`。默认值（999）是最常见的，在许多发行版上是错的；出错会在 socket 上产生
“permission denied”，`DockerIndisponivelError` 已经会带着关于组的提示点名它。它写在 `.env.example` 和
runbook 中。
