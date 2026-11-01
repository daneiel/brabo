---
traducao_de: 23a3d9e8bdca4523c3771b12d65118e8adcd6dcf
id: fase-29-instalacao-de-uma-linha
title: FASE 29 — 一行命令安装
sidebar_label: FASE 29 — 一行命令安装
sidebar_position: 16
description: FASE 29 的范围——已发布产物的签名、一个带可选来源和标记的、受版本管理的 install.sh、卷的备份，以及 runner 经同意设定的 base。决策位于 ADR 0149 至 0152。
keywords: [fase 29, 安装程序, 签名, cosign, 备份, runner, 项目 base]
---

# FASE 29 — 一行命令安装

> 本文档是该阶段的**范围界定**：它追求什么、拒绝什么、按什么顺序。**决策**位于
> [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md)、
> [0150](../adr/0150-instalador-de-uma-linha.md)、[0151](../adr/0151-base-consentida-no-runner.md)
> 和 [0152](../adr/0152-backup-de-volumes-contra-compose.md)——在这里有而在那里没有的东西，是意图，
> 而不是决策。

## 问题 {#o-problema}

如今 Brabo 的安装由**三个互不相连的动作**组成，而它们彼此都不知道对方：

| 动作 | 在哪里 | 对安装者有什么要求 |
|---|---|---|
| 启动服务 | `docker compose -f docker/docker-compose.prod.yml` | 手动导出五个机密（RN-114，[ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)），并拥有 checkout |
| 把 runner 放到机器上 | 浏览器（[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)） | 下载二进制，手动 `chmod +x`（BRB-031），每个项目重复一遍 |
| 选择代码放在哪里 | `pnpm bootstrap`（[ADR 0146](../adr/0146-base-consentida-no-bootstrap.md)） | 拥有一个**开发** checkout——在它之外菜单不存在 |

FASE 28 **以书面形式拒绝**了一行命令的安装程序，而那个理由依然有效：*"um instalador de uma linha
sem assinatura é pior que o download atual"*（[fase-28-pasta-do-usuario.md](fase-28-pasta-do-usuario.md)，
BRB-005）。一个下载未签名产物的 `curl | sh`，会把渠道的任何失陷变成在安装者机器上的代码执行——而
产品如今**不签名任何**它发布的东西。

这就是本阶段从签名而不是从安装程序开始的原因。这个顺序不是偏好：没有 ADR 0149，ADR 0150 就会是
FASE 28 所拒绝的那个东西。

## 设计，分为四层 {#o-desenho-em-quatro-camadas}

每层只有一个机制，没有一层发明新的权威：

| 层 | 在哪里 | 机制 |
|---|---|---|
| 来源 | `release.yml`、`build-runner-binaries.yml` | 对镜像和二进制使用 `cosign` keyless（Actions 的 OIDC）；签名的 `checksums.txt` |
| 安装 | 受版本管理的 `install.sh`，从 GitHub Releases 获取 | 校验自身来源，检测已有内容，**询问**，写入标记 |
| 数据 | `docker/backup/` | **针对 compose** 运行的备份与恢复，不需要集群 |
| 活动文件夹 | runner 的 `guard.ts` | 一个经同意设定的 base；每个项目是其中的子文件夹 |

第四层的存在有一个 FASE 28 已经点出的物理原因：bind mount 不能跨越网络，也到达不了被挂载范围之外的
路径。`brabo-runner` 是已经生活在用户机器上的进程——缺的不是一个 agent，而是让它**带着一个 base
诞生**，而不是带着一个松散的路径。

## 配置的同意 ≠ 动作的批准 {#consentimento-de-configuração--aprovação-de-ação}

四个 ADR 都必须声明、并决定安装程序设计的那一点：

选择 base、写入 `.env`、创建文件夹、安装服务，是**用户在自己终端中同意的配置**——而不是一个 agent
请求行动。这些都不会变成 `proposed_action`，而让它们经过那里，会落入
[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) 的路径作用域，变成例行审批的
队列，并侵蚀恰恰赋予这次点击意义的那个上限。

这个推论双向成立，也正是它把本阶段与普通安装程序区分开来：**同意不能免除校验**。用户同意的是 base
和安装；他无法对一个自己无法检查的二进制的来源表示同意。因此签名校验属于**机制**，绝不是界面上的
一个问题——校验失败是具名的拒绝，绝不是可以点一下就接受的警告。

## 编号——数出来的，而不是继承来的 {#numeração--contada-não-herdada}

> 仓库中散文里的计数持续存在已知的漂移：`docs/adr/index.md` 的 frontmatter 宣称的 ADR 数量，磁盘
> 并不证实。本阶段没有任何会话信任写在散文中的数字。

这个方法，是本阶段每次会话在预留任何编号之前都要重复的——FASE 28 已经在执行，**再加上原本缺少的
后一半**：

```bash
# ADRs e RNs em dev — o piso
git ls-tree --name-only dev docs/adr/ | grep -oE '^[0-9]{4}' | sort -n | tail -1
git grep -h -E '^### RN-' dev -- 'docs/business-rules.md' 'docs/business-rules/*.md' \
  | grep -oE 'RN-[0-9]+' | sed 's/RN-//' | sort -n -u | tail -1

# o que está EM VOO — branches locais e remotas ainda não mergeadas
for b in $(git branch --format='%(refname:short)'; git branch -r --format='%(refname:short)'); do
  git merge-base --is-ancestor "$b" dev 2>/dev/null && continue
  echo "$b: $(git ls-tree --name-only "$b" docs/adr/ | grep -oE '^[0-9]{4}' | sort -n | tail -1)"
done
```

在第 1 次会话开始时针对 `dev` 测得：**147 个 ADR**（最大为 `0147`）和 **382 条 RN**（最大为
`521`）。而在同一时刻在途的有：**ADR 0148 同时被两个分支分配**，以及 **RN 510、522 和 523**——
其中 522 和 523 也各自在两个分支之间重复。

**为本阶段预留的范围是 RN-524 至 RN-538**，ADR 是 **0149、0150、0151 和 0152**。跳过
510/522/523 和 0148 是有意的。

记录观察到的三次冲突才是重点，而不是细节：FASE 28 写过，只数 `dev` 会返回一个已被分配的编号，而这次
会话**发现同一种失败模式同时发生了三次**。数 `dev` 是必要条件而不是充分条件；上面命令的后一半正是
缺少的部分，这也是它被收录在这里的原因。

> **这三处后来都解决了，标准是日期。** 先分配的一方保留编号：2026-09-06 的三个分支保留了
> `ADR 0148`、`RN-522` 和 `RN-523`，而 2026-09-08 的那些重新编号为 `ADR 0153`、`RN-539` 和
> `RN-540`——高于本阶段的范围，不会触及任何在途的东西。其中一条已经是同一条 RN 的**第二次**重新
> 编号：它诞生时是 522，为了躲避一次冲突改为 523，结果又落入另一次——因为那次扫描覆盖了**远程**
> 分支，而等着它的那个是本地的。

值得重复一下为什么冲突能存活这么久：**`docs:build` 抓不到重复的锚点。** `onBrokenAnchors: 'throw'`
会否决指向**不存在**的锚点的链接；有两个相同的锚点时，Docusaurus 解析第一个，第二个悄无声息地变得
不可达。

## 测量对范围做了哪些修正 {#o-que-a-medição-corrigiu-no-recorte}

本阶段的计划诞生于测量之前写下的范围界定。其中五点没能在磁盘面前站住，它们被记录下来，因为一个为
迎合结果而重写自己的计划就不再有教益：

- **`workspace.verified` 不存在**——既不是事件，也不是通道消息，也不是路由。存在的是
  `workspace_confirm`，而它是**单向的**：`terminal_channel.ex:356-373` 回复 `{:noreply,
  socket}`，不向 runner 推送任何东西。仓库中带回复的配对是另一种模式，即 `exec`/`exec_result` 的
  模式。
- **ADR 0146 的第 5 点并没有版本管理任何 `install.sh`**——它版本管理的是
  `scripts/dev/consentir-base.mjs`。其原则（“绝不由 api 生成，绝不在运行时下载”，推论是 api 不会
  获得输出宿主机脚本的路由）是可推广的，ADR 0150 **扩展**了它；但把它引用为好像已经在谈论安装程序，
  就是把一句它没有说过的话归于该 ADR。
- **`docker-compose.prod.yml` 不消费 GHCR。** 所有服务都指向带有本地 `build:` 块的 `brabo-*:prod`，
  文件头部这样描述自己：*"o que este arquivo NÃO é: um manifesto de produção endurecido"*。
  `.release/images.json` 唯一的消费者是 kustomize。
- **`make test-restore` 是 Kubernetes 路径**（需要 `kubectl` 和 CronJob `brabo-backup`），而
  `docker/backup/backup.sh` **只覆盖 Postgres**。在通过 compose 的安装中把它当作“迁移的证明”，就是
  承诺磁盘无法支撑的东西——ADR 0152 因此而存在。
- **BRB 登记不属于仓库。** 它位于维护者的 vault 中，有 33 个条目，每个条目都有完成标准；这里只在
  散文中出现过两个 id。测量本阶段继承的六个：**BRB-032 和 BRB-033 描述的缺陷已不再复现**，而
  **BRB-004 不是 id 所暗示的那样**——它要求第三方镜像按 **digest** 引用，而不是 #419 固定的 tag。
  因此 [本仓库的登记](../reference/brb.md) 保存的是**证据**（测得的状态，`arquivo:linha`），而不是
  发现本身。
- **“每个项目一个 runner” 在五个彼此独立的地方被强制**，而不只是在 `Registry` 中：主题
  `terminal:<projectId>`、socket id `runner_socket:<kind>:<project_id>:<user_id>`、按项目限定作用域
  的 ticket、列 `runner_device_keys.project_id NOT NULL`，以及服务 unit 的名称。因此**按机器**的
  runner 被移出了本阶段。

## 各次会话 {#as-sessões}

每次会话一个交付物。表格是阅读用的，不代表优先级——决定顺序的是“依赖”这一列，而 FASE 28 记录过
实际顺序与之不同的情形。

| # | 交付物 | 依赖 | 自身的禁止事项 |
|---|---|---|---|
| 1 | 本文档、ADR 0149-0152、[BRB 登记](../reference/brb.md) 以及 RN 范围 | — | 不碰 `apps/`、`docker/`、`scripts/`、`.github/`、`deploy/`；不编辑已接受的 ADR |
| 2 | `release.yml` 和 `build-runner-binaries.yml` 中的签名；`checksums.txt`；runbook 中的校验 | 1 | 不写 `install.sh`；不改变镜像包含的内容；**不碰 api 的代理**（见下文） |
| 3 | `install.sh`：来源校验、检测、询问、标记——**以及代理 `GET /runner-releases/binary` 开始做校验** | 2 | **什么都不启动**——不启动 compose，不做 migrate，不启动 runner |
| 4 | `install.sh`：GHCR 来源 × 本地构建、机密、安装用 compose、经过验证的启动 | 3 | 不安装 runner；不迁移之前的安装 |
| 5 | 卷的备份与恢复，针对 compose 运行 | 1 | 不碰 k8s 的 CronJob，也不碰 `deploy/k8s/test-restore.sh` |
| 6 | `install.sh`：迁移之前的安装，用第 5 次会话证明 | 4, 5 | 无论如何都不删除用户的 base，也不删除镜像文件夹 |
| 7 | runner：`guard.ts` 中经同意设定的 base；`install.sh` 安装 runner | 4 | 不改动按项目的配对；不创建新凭据 |
| 8 | 协议：创建文件夹的能力和消息，独立的谓词 | 7 | 不修改 `RunnerReadiness`；不引入 `proposed_action` |
| 9 | ✅ web：在 `runner` 模式下经由 `fs_list_dir` 的选择器，带三种状态的等待（RN-533） | 8 | 不碰 `mounted` 模式的路径（RN-504，经由 api） |
| 10 | ✅ 在干净机器上的 E2E、签名清单中的 `install.sh`、docmap、`docs:check`（RN-534） | 6, 9 | 不为了让 E2E 通过而放松 gate |

> **校验的两侧不是一起进入的，而划分依据是真实的依赖。** 第 2 次会话交付**产生**签名的一方；消费者在
> 第 3 次进入，因为现有的两个消费者——`install.sh` 核对自己的哈希，以及代理
> `GET /runner-releases/binary` 核对它所提供的二进制——读取的是**同一个**签名的 `checksums.txt`，
> 只能在它存在之后才能编写。在第 3 次关闭之前，代理继续不做任何校验地提供来自 GitHub 的字节，与以前
> 完全一样：第 2 次会话**没有让**这条路径变得更糟，也没有修好它。

> **第 4 次会话不调用 `docker/smoke.sh`，这一变化是有意的。** 计划写的是“migrate, smoke”。两者都没能
> 在接触磁盘后站住，而且原因相反：**migrate** 不是一个步骤，因为 compose 已经把它串联起来了（`api`
> 以 `service_completed_successfully` 依赖 `migrate-api`，而 `up --wait` 会等待）——第二个下令迁移的
> 地方会是同一事实的第二个来源；而 **`smoke.sh`** 会构建镜像（`--build`）并在结束时拆掉整个栈，这与
> 安装想要的恰恰相反。取而代之，安装程序**先问再断言**：它访问 api 和 engine 的 `/health`，然后才说
> 已安装——这是 `reset-total.sh` 吃过苦头才学到的尺子（BRB-033）。

## 本阶段**不**触及的东西 {#o-que-esta-fase-não-toca}

在四个 ADR 中都有声明，在这里重复，因为这正是赋予其余部分意义的东西：

- `decide.ts` 以及权限策略的绝对上限——没有一个获得例外，可配置的也没有
- `proposed_action` 作为 agent 一切外部效果的来源
- event log 的不可变性
- 三种模式下的镜像闸门（[ADR 0135](../adr/0135-portao-de-imagem-nos-tres-modos.md)）
- 镜像（RN-515/516/517）——文件夹绑定是另一回事，有另一种消息；不要合并
- broker 的五层隔离（[ADR 0130](../adr/0130-broker-de-container.md)）
- `docker-compose.prod.yml`，它仍然是镜像的**验证**用 compose

## 本阶段触及但不解决的缺口 {#lacunas-que-a-fase-encosta-e-não-resolve}

- **按机器的 runner**——上面的五处耦合。作为下一阶段的范围声明，测量已经完成。
- **在 `runner` 模式下 `docker exec` 中被丢弃的 git 凭据**——
  [ADR 0130](../adr/0130-broker-de-container.md)/[0145](../adr/0145-docker-pre-requisito-do-runner.md)。
  通过新消息进行的初始 clone 在**宿主机**上运行，走的是已经携带凭据的路径，因此**不**受影响；缺口
  仍在原处。
- **吊销作用于 `{projeto, usuário}`，从不作用于 `{chave}`**（RN-520）。由于本阶段保留了按项目的
  配对，代价不变——但当 FASE 30 做出按机器的 runner 时，吊销将会拖垮那台机器上的**所有**项目。在这里
  声明这一代价，以免在那里才被发现。
- **broker 没有被发布**——`docker-bake.hcl` 有四个目标，`scripts/ci/images-manifest.ts` 接受四个。
  在通过 GHCR 的安装中，profile `container-broker` 是不可达的，而 `mounted` 模式**通过 broker** 启动
  容器（[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)）。ADR 0150 决定安装程序如何处理这一点。
- **BRB-017**（engine 镜像中内嵌工具的 GPL 义务，**P1**）留在原处——而本阶段让它变得更具体，而不是
  更少：安装程序会把这个镜像分发到第三方的机器上。
- **BRB-004**（按 **digest** 引用的第三方镜像）被触及：安装程序按 digest 解析**自己的**镜像，而
  `neo4j`、`pgvector` 和 `ollama` 仍按 tag。见 [BRB 登记](../reference/brb.md)。
