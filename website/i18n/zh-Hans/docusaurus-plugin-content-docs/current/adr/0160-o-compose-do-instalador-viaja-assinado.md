---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0160 — 安装程序的 compose 随它一起传送，作为已签名的 asset

## 状态 {#status}

**已接受。** 由维护者于 2026-09-13 决定（AT-026）。扩展 [ADR 0149](0149-assinatura-dos-artefatos-publicados.md)——已签名的 `checksums.txt` 开始覆盖二进制文件以外的内容——并关闭 [ADR 0150](0150-instalador-de-uma-linha.md) 的一个缺口，后者设计了一行安装程序，却没有说明安装用的 compose 如何到达安装者的机器。两者都不被编辑；本文档引用它们。

## 背景 {#context}

安装程序在干净机器上的 E2E 第一次运行是在 FASE 30 的第 8 次会话（[RN-549](../business-rules.md#rn-549)），它对它本应回答的问题给出了**否**。`install.sh` 用 `docker compose -f docker/docker-compose.install.yml` 启动整套服务——一个**相对于运行所在目录**的路径——在七个地方使用，包括 `up -d --wait`。这个文件：

- **不是 Release 的 asset**；
- **不在已签名的 `checksums.txt` 中**；
- **在任何地方都没有被下载**——脚本唯一的下载是 `cosign`、清单及其签名、`images.json` 和 runner 的二进制文件。

而 compose 绑定挂载了两个相对于它的文件：`./postgres/init.sql`（`postgres`，创建 pgvector 扩展）和 `./ollama/pull-models.sh`（`ollama-model-loader`，位于 `llm` profile 之下）。`install-e2e.yml` 的变通步骤正是通过 `raw.githubusercontent.com` 从 tag 中取来这**三个**文件。

**症状来得很晚，这正是它代价高昂的原因。** 在空目录中按照 runbook 的一行命令操作的人，会在脚本已经验证了自身签名、检测了机器、询问了 base 并**写入了带有五个密钥的 `.env`** **之后**，死于 *"no such file or directory"*。半个安装，外加一条不说该怎么办的消息。

**实现时测得：是四个，不是三个。** **迁移**路径（`migrar_instalacao_anterior`，[RN-530](../business-rules.md#rn-530)）运行 `bash docker/backup/test-restore-compose.sh`——另一个相对路径，而且是一个在主机上**执行**的脚本。E2E 从未触及它，因为在干净机器上没有可迁移的东西，所以变通步骤没有带上它。在没有 checkout 的目录中，迁移会死在那里——按照 RN-530 的构造，会在删除任何东西之前，但还是会死。

E2E 之下的任何一层都看不到这一点：每个部件都能工作，并有自己的测试套件。缺陷位于**已发布的工件与安装者的机器之间**，而那是只有 E2E 才会跨越的边界——它只在 tag 时运行。

## 决策 {#decision}

**1. 这些文件成为 Release 的 asset，并进入**同一个**已签名的 `checksums.txt`。** 四个，名字互不冲突：

| Release 中的 asset | 仓库中以及安装目录下的路径 | 原因 |
|---|---|---|
| `brabo-install-compose.yml` | `docker/docker-compose.install.yml` | 启动安装的 compose |
| `brabo-install-postgres-init.sql` | `docker/postgres/init.sql` | 由 `postgres` 绑定挂载 |
| `brabo-install-ollama-pull-models.sh` | `docker/ollama/pull-models.sh` | 由 `ollama-model-loader` 绑定挂载 |
| `brabo-install-backup-test-restore.sh` | `docker/backup/test-restore-compose.sh` | 迁移的还原证明 |

Release 是**扁平**的——asset 就是一个名字，没有目录——清单按名字索引。`init.sql` 和 `pull-models.sh` 足够通用，可能会与下一个有人附加的 asset 冲突，而两个同名文件会只占一行，导致一个文件的校验对照另一个的哈希通过。因此使用前缀 `brabo-install-`，它也不会匹配 `checksums` job 下载二进制时所用的 `--pattern 'brabo-runner-*'`。

表格位于 `scripts/ci/assets-do-instalador.ts`（**发布**方）和 `install.sh` 中 `destino_do_asset_do_instalador` 的 `case`（**下载**方）。之所以有两份，是因为安装程序在 macOS 上以 bash 3.2 运行且没有 Node；两者的分歧由 `assets-do-instalador.spec.ts` 判定失败，它读取 shell 中的 `case`。同一个 spec 从 compose 中**推导**出每一个 `./…` 绑定挂载，并对不在表中的判定失败——缺陷恰恰就是这样诞生的：有人加了一个挂载，却没人问它如何传送。

**2. 发布者是 `build-runner-binaries.yml` 的 `checksums` job**，就是已经发布 `install.sh` 的那个：文件来自 **tag 的 checkout**（产生该处所签名的一切的同一个提交），由脚本以 asset 名复制，进入生成清单的 `sha256sum`，并一起附加。[RN-565](../business-rules.md#rn-565) 中对 asset 的等待没有任何变化：它们不来自 matrix，所以没有什么需要为它们等待。该 job 在验证签名之后、附加之前，还开始**对照文件核对清单的每一行**（`sha256sum -c
--strict`）——签名证明了是谁写的清单；核对证明了将要附加的就是清单所说的。

**3. `install.sh` 在询问或写入任何东西**之前**下载并验证这四个文件。** 紧接在 `verificar_a_si_mesmo` 之后，并对照那个函数已经验证过的**同一个** `checksums.txt`（绝不第二次下载，原因见该函数中所写）。比较按字段完全相等（`awk`）进行，而不是按模式：名字中有点号。三种**具名且互不相同**的拒绝，因为它们要求不同的行动——Release 没有发布该 asset（早于本 ADR，或者只发布了一半）、清单没有覆盖它、哈希不匹配（事件）。它们都说 *"Nada foi gravado"*，而且这是真的：到那时为止只写过临时目录。

**4. 绝不退回到相对路径。** `COMPOSE_DE_INSTALACAO` 不再是常量 `'docker/docker-compose.install.yml'`，而是诞生时为**空**；只有当 `materializar_os_arquivos_da_instalacao` 把已验证的副本复制到 `<pasta de onde o script roda>/docker/`（即 `.env` 所在的同一目录）时，它才获得值——一个**绝对**路径。这发生在第一次需要某个文件的那一刻（迁移，或紧接 `.env` 之后的启动），绝不更早：没有 TTY 的路径仍然什么都不写。目标位置已有的内容被**替换，从不读取**——在升级中那是上一个版本的 compose——复制前先 `rm`，以免符号链接把写入引到别处。目录下的布局有意与以前相同：compose 的相对绑定挂载继续能够解析，标记文件继续记录 compose，runbook 给运维人员的命令也不变。

**5. E2E 反转它所要求的内容。** 变通步骤被移除；取而代之的是断言：job 的目录开始时**没有** `docker/`（它没有 checkout），没有 TTY 时安装程序验证了文件却没有写入任何文件，以及——在安装之后的一个独立步骤中，以免 token 处于安装程序的环境中——写入的文件逐字节就是 Release 清单所覆盖的那些。`install-e2e.spec.ts` 不再要求变通的"两半"，而是要求它**不**回来。

## 本 ADR 明确拒绝的内容 {#o-que-este-adr-recusa-explicitamente}

- **在 tag 上克隆仓库。** 这样只需维护一个文件，总与 tag 一致——却会把签名链换成**对 `git` 传输的信任**，并增加一个干净机器上可能没有的依赖。启动安装的东西将成为安装程序所用的东西中唯一一个不像二进制那样被验证的。
- **包含这四个文件的 tarball。** 在别人的机器上多一个要解压的文件，清单中一行覆盖四个文件却不点它们的名——与 ADR 0149 偏好一份清单而不是五个签名的理由相同，只是反过来用。
- **把文件嵌入 `install.sh`**（heredoc）。compose 有几百行，并随拓扑变化；安装程序将随每个服务一起变化，而 `composes-em-conformidade.spec.ts` 将不得不去读 shell。
- **一个用于测试、指向另一个 Release URL 的变量或标志。** 这是跳过验证之门的最短形式（ADR 0150）。shell 的测试把 URL 作为函数的**参数**传入，`main` 也是这么做的。
- **在 `pull_request` 上运行 `install-e2e.yml`。** 仍然不做，理由见 ADR 0150。

## 后果 {#consequences}

- **在代码中关闭，只在下一个正式 tag 时证明。** 流水线只在 tag 时发布，E2E 只在之后运行；在 PR 中运行的是静态部分（`assets-do-instalador.spec.ts`、`install-e2e.spec.ts`）以及针对一个假 Release 的 shell 功能部分（`install-arquivos-da-instalacao.spec.ts`）。在本次合并之后的第一个 tag 之前，没有任何已发布的 Release 带有这些 asset。
- **不需要运维人员任何操作，也没有任何原本能工作的安装会停止工作。** 新的 `install.sh` 只会在 Release 中到达用户手里，而附加它的正是附加四个 asset 的**同一个** job 的**同一**步——所以带有新安装程序却没有这些文件的 Release 只有在这一步中途失败时才会存在，此时安装程序会早早地以 *"a Release não publica …"* 拒绝，而不是死在 `.env` 之后。从 checkout 中针对旧 Release 运行新的 `install.sh`，以前就会被来源验证拒绝（[RN-526](../business-rules.md#rn-526)）：它的哈希不在旧清单中。已发布的 Release 继续带着旧安装程序，以及在 tag 的 checkout 中运行它的变通办法。
- **Release 增加了**四个 asset（约 29 KB），清单增加了四行，而这四个文件开始与安装程序**一起版本化**：改动其中任何一个，就改动了下一个 tag 签名的内容。改动**表格**需要改动两边，只改一边时 spec 会判定失败。
- **目录就是安装目录的 checkout，其 `docker/` 会被 Release 的副本覆盖。** 在所安装的 tag 上两者完全相同；在其他地方，`git status` 会变脏，而脚本会**说出**它替换了哪些。这是布局不变的代价，并且只针对从 checkout 内部安装的人。
- **代理 `GET /runner-releases/binary` 不变**：它把清单当作名字 → 哈希的映射来读（[RN-525](../business-rules.md#rn-525)），多出来的行不影响它。
- **测得但**未**修正的相邻问题。** 迁移的还原证明（`test-restore-compose.sh`）调用 `docker compose -f <compose>` 而不带 `--env-file`，而 Compose 在 **compose** 所在目录中寻找 `.env`，而不是在运行所在目录中（测得：只在当前目录有 `.env` 时，`docker compose -f docker/c.yml config` 插值失败）。由于 compose 位于 `docker/` 而 `.env` 在上一级目录，变量 `BRABO_BACKUP_IMAGE` 到不了，证明倾向于失败——按 RN-530 这是**安全**的结局（不删除任何东西），但通过 compose 的迁移无法完成。这是迁移路径中早已存在的缺陷，没有任何 E2E 演练它；在此声明，留给将来演练它的工作线。
