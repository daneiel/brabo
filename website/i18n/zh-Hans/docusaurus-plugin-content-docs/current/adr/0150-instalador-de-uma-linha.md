---
traducao_de: b4ee01ec5b0fa2bb837b94747022ab4b10cdc213
---

# 0150 — 一行安装程序，带可选来源和标记文件

## 状态 {#status}

**提议中。** 依赖 [ADR 0149](0149-assinatura-dos-artefatos-publicados.md)：没有签名，本文档所提议的恰恰就是 FASE 28 拒绝过的东西。

## 背景 {#context}

如今安装 Brabo 需要一个 checkout、手工导出的五个密钥，以及哪里都没有记载的知识——即[阶段文档](../explanation/fase-29-instalacao-de-uma-linha.md)描述的三个动作。磁盘上的三个事实限制着任何安装程序的设计：

**生产 compose 不是安装清单。** `docker/docker-compose.prod.yml` 的所有服务都指向 `brabo-*:prod`，**带有本地 `build:` 块**（`:102-105`、`:144-147`、`:253-256`、`:381-384`）；`docker/` 中没有一处引用 `ghcr.io`。文件头在 `:1` 和 `:8` 中对自己说，它是*"生产镜像的**验证** compose"*，并且*"本文件**不是**：一份加固过的生产清单"*。仓库中 `.release/images.json` 唯一的使用者是 `scripts/ci/aplicar-imagens.ts`，它写入的是 **kustomize overlay**（`Makefile:35-36`）。

**已经有一个征得同意的模子，而且它在正确的地方是严格的。** `scripts/dev/consentir-base.mjs:195-208`：没有 TTY 时，脚本**报告并返回 0**——不同意、不写入、不创建目录。它的顺序就是法则：`validarBase` 在任何 `mkdir` **之前**运行（`:228-242`），写入 `.env` 是**最后**一步（`:272`），失败的证明会拒绝而不写入（`:246-258`）。

**五个密钥已经在某处被生成。** `docker/smoke.sh:31-57` 用 `openssl rand` 生成全部五个，尊重已导出的值（`${VAR:-$(gerar)}`），包括 `NEO4J_PASSWORD` 必须用 `-hex` 的细节，因为 `/` 会破坏 `NEO4J_AUTH` 的解析（`:53-56`）。这部分无需发明，只需让它持久化。

## 决策 {#decision}

### 1. 调用方式保留 stdin {#1-a-invocação-preserva-o-stdin}

```sh
sh -c "$(curl -fsSL https://github.com/daneiel/brabo/releases/latest/download/install.sh)"
```

而**不是** `curl … | sh`。理由是机械的，不是审美的：脚本经由管道到达时，进程的 `stdin` **就是下载流**，一个用来提问的 `read` 会读到脚本自身的字节或遇到 EOF。一个不能提问的安装程序只能自己决定在别人电脑上的哪里创建目录——而仓库的尺子恰恰相反（`consentir-base.mjs:195-208`）。

没有 TTY 时，安装程序**报告并退出**，格式与模子相同：打印它会做什么、它找到了什么，以及在终端中运行的命令。

### 2. 脚本在行动之前验证自身来源 {#2-o-script-verifica-a-própria-origem-antes-de-agir}

`install.sh` **在仓库中版本化**，并作为 Release 的 asset 发布。它携带自己的版本号，第一个动作是下载该 Release 的已签名 `checksums.txt`，验证签名（ADR 0149），并对照它核对**自身的哈希**。不一致就停止。

这是对 [ADR 0146](0146-base-consentida-no-bootstrap.md):195-212 第 5 点的扩展——而不是把它当作已经说过的话来引用——那一点把 `consentir-base.mjs` 版本化，理由是*"一个配置用户主机、创建目录并写入 `.env` 的脚本，恰恰是来源需要可审计的那种工件"*，其推论是 **api 不会获得发出主机脚本的路由**。`install.sh` 是同一类工件，作用范围更大；推论同样成立。

### 3. 检测先说出它找到了什么，然后才提问 {#3-detecção-nomeia-o-que-encontrou-e-só-então-pergunta}

**标记文件**位于 `$XDG_STATE_HOME/brabo/install-state.json`，回退到 `~/.local/state/brabo/`——与 `servico.ts:250-261` 对 `XDG_CONFIG_HOME` 已使用的惯用法相同。不放在 `~/.brabo/`，那是 runner 存放**按项目**内容的地方：安装状态和项目配置有着不同的生命周期，把它们放在一起，删除其一就会抹掉另一个。

标记文件是**带版本**的（`schemaVersion`），保存：已安装版本、来源（`ghcr` 或 `local`）、已应用的 digest、路径（`.env`、项目 base、compose 目录）以及日期。正是它让第二次运行成为一次 **diff** 而不是猜测。

没有标记文件——此版本之前的所有安装——脚本就寻找**迹象**：带有 `brabo-*` 服务的 compose 项目、`brabo-runner-*.service` unit、带有五个键的 `.env`。并在任何提问之前**说出它找到的东西**。不存在"发现了什么，自己决定"的路径。

### 4. 删除会说明删除什么，以及永远不删除什么 {#4-deleção-diz-o-que-apaga-e-o-que-nunca-apaga}

| 删除（需确认，事先列出） | **永不**删除 |
|---|---|
| compose 的命名卷，包括 `pgdata` | 用户的**项目 base** |
| 生成的 `.env` | **镜像目录**（RN-516：镜像从不删除，安装程序也不） |
| runner 的服务 unit | 标记文件路径之外的任何目录 |
| 磁盘上的设备密钥 | 该密钥在服务器上所保护的东西——吊销是另一个操作 |

第二列才是要点。用户目录是累积，不是产品状态；删除它就是安装程序在做一个没人委托给它的决定。

### 5. 两种镜像来源，"官方"是验证的结果 {#5-duas-fontes-de-imagem-e-oficial-é-resultado-de-verificação}

- **`--source=ghcr`**（默认）：读取 Release 的 `.release/images.json`，**按 digest** 解析每个镜像并验证签名（ADR 0149）。
- **`--source=local`**：用 `docker-bake.hcl:81-83` 执行 `docker buildx bake`，恰好产出 compose 所期望的四个名字。要求**工作区干净且处于 tag 上**；否则**拒绝**，因为从脏目录树构建的镜像不是它所声称的版本。

"官方"一词只在验证**通过**时才出现在输出中。之后更换来源，是在相同的卷上更换镜像——数据不移动。

### 6. 安装专用的 compose {#6-um-compose-próprio-da-instalação}

新增 `docker/docker-compose.install.yml`，它使用 `.release/images.json` 中的 **digest**，没有 `build:` 块。`docker-compose.prod.yml` 保持**不变**：它是验证用的 compose，是 `docker/smoke.sh` 使用的那个（`:19-20`，有意在本地构建），把它提升为安装清单会破坏它已有的用途，并违背它自己的文件头。

代价已声明：两个文件具有相同的服务拓扑。区分它们的是各自回答的问题——*"这个 tag 能构建吗？"*对*"这台机器运行的是已发布的东西吗？"*。

### 7. 本阶段不启动 broker，并说明其后果 {#7-o-broker-não-sobe-nesta-fase-e-a-consequência-é-dita}

`docker-bake.hcl:81-83` 有**四个**目标，`scripts/ci/images-manifest.ts:54` 接受四个；`brabo-broker:prod`（`docker-compose.prod.yml:333`）只在本地构建时存在，因此 `container-broker` profile **无法从 Release 工件到达**。

安装程序**不**提供该 profile，并**说明**这意味着什么：使用 `--source=ghcr` 时，`mounted` 模式的项目——[ADR 0146](0146-base-consentida-no-bootstrap.md) 把它设为本地默认——不会启动容器，因为启动它的是 broker（[ADR 0144](0144-a-segunda-raiz-do-broker.md)）。对话和 backlog 可以工作；在该模式下 dev agent 的执行不行。

把 broker 作为第五个镜像发布才是修正，而且它**很小**（bake 中一个目标，`images-manifest.ts` 中一个 id，多一个签名）。它因为范围而不是因为疑虑留在本 ADR 之外：作为独立条目进入，在它进入之前，`--source=local` 是能得到完整 `mounted` 的途径。

### 8. Windows 是具名的拒绝 {#8-windows-é-recusa-nomeada}

与 RN-518 中已有的一样（`servico.ts:517-532`）：安装程序说出平台名，说明按已声明的决定它不在范围内，并指出前台运行的路径。不是一个笼统的失败，也不是沉默。

### 9. 纯 bash，决策逻辑可测试 {#9-bash-puro-com-a-decisão-testável}

`install.sh` 是 **bash**，因为它需要在机器上存在任何依赖之前就能运行。决策逻辑（检测、比较标记文件、选择来源、组装删除计划）放在纯函数中，脚本暴露 `--print-plan` / `--print-state`，使 vitest spec 可以在不执行任何操作的情况下演练它们——这个先例是真实的，就在同一个仓库中：`scripts/dev/bootstrap.sh` 有 `--print-commands`，并由 `scripts/dev/bootstrap.spec.ts` 测试。

### 10. 启动后的验证是自己的，不复用 `smoke.sh` {#10-a-verificação-pós-subida-é-própria-e-o-smokesh-não-é-reusado}

`docker/smoke.sh` 生成五个密钥（`:31-57`），是决策 5 的先例——但**调用它不合适**：它用 `--build` 启动（构建本安装刚按 digest 下载的东西），并在结束时拆掉整套服务，除非 `SMOKE_KEEP_UP=1`。它是 CI 测试，而安装不是测试。

安装程序在这里做最低限度的诚实之事：在 `up --wait` 之后，访问 api 和 engine 的 `/health`，**然后才**说安装完成。`--wait` 已经会等待健康检查——但宣布一个状态的人必须问过它，这正是 `reset-total.sh` 付出代价换来的教训（它在 api 处于 `Exited (1)` 时宣布"reset completo"）。

出于同样的理由**没有 migrate 步骤**：compose 以 `service_completed_successfully` 把 `api` → `migrate-api` 串起来，第二个下令迁移的地方会成为同一事实的第二个来源。

## 本 ADR 明确拒绝的内容 {#o-que-este-adr-recusa-explicitamente}

- **`curl | sh`。** 依据决策 1：它关闭了 stdin，同意也随之关闭。
- **把 `docker-compose.prod.yml` 提升为安装清单。** 会破坏有意在本地构建的 `smoke.sh`，并与文件头相矛盾。
- **一条生成脚本的 api 路由。** ADR 0146 第 5 点的明确推论，在这里以更大的力度继续有效。
- **猜测式迁移。** 没有标记文件的旧安装不是"大概一样"：它会被点名，路径是 [ADR 0152](0152-backup-de-volumes-contra-compose.md) 的路径。
- **删除标记文件路径之外的任何东西。**

## 后果 {#consequences}

- 安装不再需要 checkout，五个密钥一次生成并以 `600` 权限持久化——今天 `smoke.sh` 生成它们，并随整套服务一起丢弃。
- **两个 compose** 具有相同的拓扑，它们之间的分歧成为需要盯防的东西。上限：安装用的 compose 不得增加验证用 compose 没有的服务。
- 使用 `--source=ghcr` 时，在 broker 发布之前 `mounted` 没有容器（决策 7）。在安装程序的输出中声明，而不是事后发现。
- 安装程序的第二次运行变成可读的 diff。**在一台已有 Brabo 的机器上**的第一次运行仍是困难的情形，也是唯一依赖另一个 ADR 的情形。
