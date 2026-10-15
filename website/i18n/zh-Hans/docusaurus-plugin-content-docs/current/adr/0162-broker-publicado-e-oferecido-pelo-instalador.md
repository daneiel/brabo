---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0162 — broker 成为第五个发布的镜像，安装程序**询问**是否启用它

## 状态 {#status}

**已接受。** 由维护者于 2026-09-18 决定（AT-097）。关闭 [ADR 0150](0150-instalador-de-uma-linha.md) 的决策 7（*"本阶段不启动 broker，并说明其后果"*），把 [ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md) 从四个镜像扩展为五个，并把 [ADR 0146](0146-base-consentida-no-bootstrap.md)（RN-512）对开发 compose 所用的论据应用到安装上。broker 本身——五层、五个操作、计算出的规格——是 [ADR 0130](0130-broker-de-container.md) 中的那个，没有任何改变。这些都不被编辑；本文档引用它们。

**兄弟：** [ADR 0161](0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md) 交付了维护者同一决定（"两者都要"）的 **WEB** 那一半——项目创建只提供安装能执行的模式——并书面声明**安装程序**那一半因镜像未发布而停下。本 ADR 就是那一半。两者互相补全，而不相互依赖：那一个阻止界面提供安装不能执行的东西；这一个经同意给安装一个执行的办法。启用 broker 后，安装就有了 `BROKER_URL`，0161 的界面正是凭它重新提供两种模式。

## 背景 {#context}

在真实安装中，`container` 或 `mounted` 项目**永远不会执行**。启动这两种模式容器的是 broker（[ADR 0144](0144-a-segunda-raiz-do-broker.md) 按**目标**分支：`container` 和 `mounted` → broker），而安装用的 compose 没有这个服务。`BROKER_URL` 保持未定义，`container_start` 以带 `BrokerIndisponivelError` 的 `container.start_failed` 结束，dev agent 永远停在 `dev.blocked_by_container`——RN-502 有理由地拒绝在 `running` 容器之外执行。

ADR 0150 的决策 7 声明了这一点，并称修正是**小**的。2026-09-18 打开这条工作线时测得：

- `docker manifest inspect ghcr.io/daneiel/brabo-broker:6.1.0` → `denied`；对 `brabo-api:6.1.0` 问同样的问题则能解析。该镜像在 registry 中不存在。
- `docker-bake.hcl` 有四个目标（`api`、`engine`、`web`、`backup`），`scripts/ci/images-manifest.ts` 恰好接受这四个。
- `docker/broker/Dockerfile.prod` **早已存在**，并已与其他四个一起通过 `ci.yml` 的 `hadolint`——按 digest 的 `FROM`，tag 在上一行，`USER node`，针对 `/health` 的 `HEALTHCHECK`，npm/corepack 已移除。缺的不是镜像：而是有人去构建、扫描和发布它。`ci.yml` 从不构建它；`docker-compose.prod.yml` 以 `brabo-broker:prod` 引用它，而这只存在于用 profile 运行过 `docker compose build` 的人的机器上。
- Release 不带代码，所以 `--source=local`——ADR 0150 指出的出路——需要一个位于 tag 上的 checkout，那不是一行安装。

## 决策 {#decision}

### 1. broker 是**第五个**发布的镜像，与其他镜像使用相同的 gate {#1-o-broker-é-a-quinta-imagem-publicada-com-os-mesmos-gates-das-outras}

在 `docker-bake.hcl` 中、`default` 组内加入 `broker` 目标：`ci.yml` 开始在每个 PR 中构建它，核对它不以 root 运行，以相同规则（`HIGH,CRITICAL`，`--ignore-unfixed`）用 Trivy 扫描它，并证明它在只读 rootfs 下能健康启动。`release.yml` 按 **DIGEST** 发布它，`images-manifest.ts` 要求它（缺少目标仍会失败——五个全有或全无），而 keyless 的 `cosign` 签名和同一次运行中的验证（[RN-524](../business-rules.md#rn-524)）无需新增一行就覆盖它，因为两个循环都读取清单。

**Kubernetes 不认识它**，这是决定，不是遗忘：`deploy/k8s/` 中没有 broker 的 Deployment，在 pod 中挂载节点的 socket 是另一场关于权限的对话。`argumentosDeSetImage` 改为只输出 kustomize base 声明的镜像——`make imagens-do-release` 继续在 overlay 中写四行。

### 2. 安装用 compose 获得该服务，默认**关闭** {#2-o-compose-de-instalação-ganha-o-serviço-desligado-por-padrão}

该服务放在 `profiles: ["container-broker"]` 之下，即验证 compose 的**同一个** profile，并完整保留 ADR 0130 的五层：没有 `ports:`，只在 `broker` 网络中（`internal: true`，只有 api 能到达，且没有出口），生产中 `BRABO_SERVICE_TOKEN` 必需，五个操作，规格根据 api 所说计算。socket 只挂载在它身上，不挂在其他任何服务上。`api` 始终加入 `broker` 网络——验证 compose 中早已如此——而 api 中的 `BROKER_URL` 保持为空，除非 `.env` 另有说明。

镜像来自 `BRABO_BROKER_IMAGE`，与其他四个一样是**必需**的，而这是测量出来的而不是选择出来的：Compose 在按 profile 过滤之前对**整个**文件做插值，所以一个关闭的服务中的 `${VAR:?…}` 同样会拒绝整个文件。安装程序总是写入它（它来自同一个清单），无论是否启用 broker。

两个根与验证 compose 中一样：`BRABO_PROJECTS_HOST_BASE` 派生自 `BRABO_PROJECTS_BASE`，后者本来就是主机路径。另一个 `PROJECT_WORKSPACES_HOST_ROOT` 在 compose 中无法派生——安装的托管目录是**命名**卷 `project_workspaces`，而守护进程解析的路径是**主机**的。安装程序**计算**它（`<DockerRootDir>/volumes/brabo_project_workspaces/_data`，`local` 驱动的布局），并在启动之后对照守护进程为该卷返回的 `Mountpoint` **核对**；不一致会变成带有正确值的具名待办，绝不是静默猜测的值。

### 3. 安装程序**询问**，以文字说明风险，默认为**否** {#3-o-instalador-pergunta-com-o-risco-dito-em-texto-e-o-default-é-não}

一个新问题，在 base 之后、`.env` 之前。它说明启用所授予的东西——本安装的一个服务开始与本机的 Docker 对话，而指挥那个服务的人就指挥 Docker——各层约束了什么，以及没有它会改变什么（`container` 和 `mounted` 项目不执行；Runner 模式不依赖它）。只有 `s`/`sim` 会启用。回车、任何其他输入或没有终端都会保持关闭，并且脚本会**说明**它保持关闭。

回答是会在 `.env` 中写入 `COMPOSE_PROFILES=container-broker`、`BROKER_URL=http://broker:8090`、`DOCKER_GID` 以及计算出的根。`DOCKER_GID` 是**在容器内部**测量的，使用 broker 自己的镜像，并以 `--mount type=bind` 挂载 socket（当源不存在时它会拒绝而不是创建目录），因为 `group_add` 需要的是进程在那里看到的 gid——而在 Docker Desktop 中，主机上 socket 的 gid 对 VM 内部的 gid 说明不了什么。无法测量，或者路径不是 socket，都是**具名**拒绝，教用户重新运行并回答否；绝不是猜一个 999。

这一决定出现在最终摘要中，而*"本安装程序**不**做的事"*那句话不再说只有"Pasta montada"没有容器：`container` 也没有。

### 4. 为什么 RN-512 的论据在这里成立 {#4-por-que-o-argumento-da-rn-512-vale-aqui}

ADR 0146 按 socket 的**含义**区分两个 compose：在开发中，启动整套服务的人本来就拥有 socket，所以 broker 收到它并不授予操作者尚未拥有的东西；在生产中，socket 是权限边界，操作者不是开发者。

一行安装是第一种情况，不是第二种。它运行**在用户自己的机器上**，而此人刚刚运行了 `docker compose up`——不拥有 socket，安装程序就无法工作。操作者和用户是同一个人。安装**不能**假定的——这也是它询问而不是像开发 compose 那样直接启用的原因——是安装的人知道 socket 是什么：开发 compose 由开发产品的人阅读；安装程序由从未打开过本仓库的人运行。明确的同意是剩下的唯一差别，也正是本 ADR 所买下的。

`docker-compose.prod.yml` 不变：它仍在 profile 之下，对它而言 ADR 0146 的解读毫无保留地继续有效。

## 后果 {#consequences}

**代价，已声明。**

- **一个等同于 root 的镜像变为公开。** 任何人都可以拉取 `ghcr.io/daneiel/brabo-broker`。镜像本身不授予任何东西——授予的是挂载的 socket——但它成了一个可研究的目标，其中的一个漏洞，在每个启用了它的安装中，都会成为通往主机 Docker 的路径。这就是为什么它进入每个 PR 的 Trivy 和每个 tag 的签名，而不是放在单独的列表里。
- **在用户安装的一个服务中开始挂载 Docker socket**，当用户同意时。指挥 broker 的人就指挥机器的 Docker。把它与其余部分隔开的是：不发布端口，只有 api 能到达，token 以常数时间比较，并且没有可以写 `privileged`、`cap_add`、`network: host` 或自由 `-v` 的字段。这约束了调用方；约束不了 broker 自身的 bug。
- **`BRABO_BROKER_IMAGE` 在安装的 `.env` 中变为必需**，无论是否启用。由之前的安装程序写入的 `.env` 没有它——但安装程序每次运行都会重写 `.env`，而更新要经过它。
- **安装程序要求 `images.json` 中有 `broker`。** 早于此的 Release 没有它，本版本的安装程序会点名该目标并拒绝。这与 ADR 0160 的规则相同：某个 tag 的安装程序安装那个 tag。
- **托管根依赖于 `local` 驱动的布局。** 启动前计算，启动后核对；不符的会变成带有从守护进程读取的值的待办。
- **未测量：** macOS Docker Desktop 上的 `DOCKER_GID` 和计算出的根。tag 的 E2E 只在 Linux 上运行交互的那一半。

**不变的内容。** 验证 compose、`smoke.sh`（不带 profile 启动，继续证明同样的三个应用镜像）、开发 compose、Kubernetes，以及 broker 本身。
