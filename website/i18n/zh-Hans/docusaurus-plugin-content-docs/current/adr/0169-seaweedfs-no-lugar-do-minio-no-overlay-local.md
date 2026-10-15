---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0169 — 本地 overlay 的 S3 目标不再是 MinIO，改为 SeaweedFS

## 状态 {#status}

**已接受。** 于 2026-09-27 决定（AT-200，issue #633），依据测量，在维护者的授权下（"你来测量和选择"）。引用 [ADR 0027](0027-fase5-backup-hardening-release.md)（S3 中的备份以及用 `aws-cli` 替换 `mc`）和 [ADR 0159](0159-imagem-de-terceiro-por-digest.md)（第三方镜像按索引 digest 固定）。两者都不编辑。

## 背景 {#context}

Kubernetes 的本地 overlay 在 `brabo` 命名空间内启动一个 S3 服务器，使本地演练的备份与生产**相同**：脚本始终讲 S3，只有端点改变。这个服务器曾是 MinIO，自 ADR 0159 起固定在 `quay.io/minio/minio@sha256:a1ea29fa…  # RELEASE.2025-04-22T22-12-26Z`。

MinIO 停止发布社区镜像。2026-09-27 在未认证的情况下测得：

| 引用 | 响应 |
|---|---|
| `quay.io/v2/minio/minio/manifests/sha256:a1ea29fa…` | **401** |
| `quay.io/v2/minio/minio/tags/list` | **401** |
| `registry-1.docker.io/v2/minio/minio/manifests/RELEASE.2025-04-22T22-12-26Z` | **401** `UNAUTHORIZED`（对匿名者而言仓库不存在） |
| `hub.docker.com/v2/repositories/minio/minio/tags` | **404** `object not found` |

后果是全面的，而不是局部的：`deploy/k8s/bootstrap.sh` 在 seed 和创建 bucket **之前**等待 `rollout status deployment/minio`，所以 `propriedades.yml` 死在引导阶段，**任何**性质证明都没有运行——就连不涉及备份的那些也没有（`rollout-test`、`hpa-test`、`test-reprojecao-k8s`）。

digest 履行了 ADR 0159 的承诺——没有人在底下替换字节——而这还不够：**digest 保证不可变性，不保证可用性。** 固定能挺过 tag 所有者移动 tag；挺不过 registry 所有者删除仓库。

### 依赖这个 S3 的东西（已梳理） {#o-que-depende-desse-s3-mapeado}

- **服务器：** `deploy/k8s/overlays/local/minio/{minio,netpol}.yaml`，列在本地 overlay 的 `kustomization.yaml` 中。只在本地 overlay；staging 和 prod 指向外部 bucket。
- **客户端：****不是** MinIO 的镜像。`mc` 在 Fase 5 中退出（ADR 0027，决策 1b）；备份、还原和创建 bucket 使用 `brabo-backup`（`docker/backup/Dockerfile.prod`）中来自 apk 的 `aws-cli`，经由适配器 `docker/backup/lib.sh`。它执行的 S3 操作有七个：`s3 ls`、`s3 cp -`（stdin，分段上传）、`s3 cp`（下载）、`s3api head-object`、bucket→bucket 的 `s3 cp`（服务端复制）、`s3api list-objects-v2` 和 `s3 rm`——外加引导中的 `s3 mb`。
- **凭据：** `brabo` Secret 中的 `BACKUP_S3_ACCESS_KEY`/`BACKUP_S3_SECRET_KEY`，由 ESO 物化到 `brabo-secrets`。服务器读取**同一**对。
- **引导：** `BACKUP_S3_ENDPOINT`、`rollout status`、对 `Endpoints` 的等待以及创建 bucket 的临时 pod。
- **网络：** overlay 中的两条 NetworkPolicy（进入服务器、备份/还原的出口），匹配 **POD** 的端口。
- `make test-restore`（`deploy/k8s/test-restore.sh`）和备份 CronJob 只看到端点。compose（`docker/backup/test-restore-compose.sh`）使用磁盘而不是 S3，不受影响。

## 决策 {#decision}

**服务器改为 SeaweedFS，`docker.io/chrislusf/seaweedfs` 4.47，按**索引**的 digest 固定（`sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882`），运行 `server -s3 -s3.port=9000`。** 资源改名为 `s3-local`（Deployment、Service、PVC `s3-local-data`、标签 `app.kubernetes.io/name`），目录改为 `overlays/local/s3/`。

### 候选者，按维护者给出的标准顺序 {#as-candidatas-pelos-critérios-na-ordem-que-o-mantenedor-deu}

| 候选者 | 1. 官方、匿名、amd64+arm64 索引 | 2. 备份的真实流程 | 3. 最小改动 | 4. 许可证 | 结局 |
|---|---|---|---|---|---|
| **SeaweedFS 4.47**（`chrislusf/seaweedfs`） | **是**——作者的 Docker Hub（`seaweedfs/seaweedfs` 的 README 指向它；带有 `source`/`revision` 的 OCI 标签），匿名 200，OCI 索引含 `amd64`、`arm64`、`arm/v7`、`386`；tag 发布了 cosign 签名（`.sig`） | **是**，已测量（见下文） | 服务器更换；客户端、脚本、Secret 和端口保持不变 | Apache-2.0 | **选中** |
| Garage v2.1.0（`dxflrs/garage`） | 是——匿名 200，索引含 `amd64`、`arm64`、`arm`、`386` | 未测量 | 需要配置文件（带 `rpc_secret` 的 ConfigMap），并在启动**之后**执行 `garage layout assign` + `layout apply` 以及 `garage key import <key-id> <secret>`——引导中一个新的管理步骤。Garage 记载了自己的 key-id 格式（`GK…`），这将迫使更换 `BACKUP_S3_ACCESS_KEY=brabo-backup`（此处未测量） | AGPL-3.0（在测试 overlay 中未经修改使用没有问题，但比第一个更重） | 在标准 3 上被放弃 |
| 其他来源的 MinIO：`bitnami/minio` | **否**——匿名 404（Bitnami 也终止了免费目录） | — | — | — | 在标准 1 上被放弃 |
| 其他来源的 MinIO：`bitnamilegacy/minio` | 作为活跃发布**否**——仓库已**冻结**，最后更新于 2025-08-19；它是没有补丁、没有活跃发布者的镜像 | — | — | — | 在标准 1 上被放弃 |
| 其他来源的 MinIO：`cgr.dev/chainguard/minio` | 部分——amd64+arm64 索引，匿名，但只有 `:latest` 免费：没有可用于固定注释的稳定 tag，发布者是重新编译源码的一方，而不是 MinIO | — | — | AGPL-3.0 | 在标准 1 上被放弃（没有固定 tag；非官方发布者） |
| 原始 MinIO（`quay.io`/`docker.io`） | **否**——401/404（背景） | — | — | — | 它就是问题所在 |

"选第一个满足全部条件的"：SeaweedFS 满足了全部四条，所以 Garage 没有被带到真实流程中——测量在规则规定停止的地方停止了，该列如实说明这一点，而不是把它填满。

### 标准 2 的测量 {#a-medição-do-critério-2}

从本 checkout 构建的 `brabo-backup`（`aws-cli/2.15.57`，Alpine 3.20）针对一个以 uid 1000 运行的容器中的 `weed server -s3`，运行了**真实**的适配器（`docker/backup/lib.sh`、`destino_preparar` 和各 `destino_*` 函数），凭据对在环境中，`/data` 限制为 4 GiB（PVC 的大小）：

- 错误的密钥 → `aws s3 ls` **被拒绝**（认证生效）；
- 引导的 `s3 mb` → 创建了 bucket；
- 通过 stdin 的 30 MiB `destino_enviar`（分段上传）→ `head-object` 返回 31457280，下载结果与 sha256 一致；
- 不存在对象的 `destino_tamanho` → `0`；
- `destino_copiar`（服务端复制）、`destino_listar`（3 个键，空前缀无输出）和 `destino_remover` → 正确；
- S3 端口上的 `/healthz` → 约 1 秒内返回 200，无需认证（这是探针所用的）；上传后内存约 470 MiB，在 1 GiB 限额之内。

并且在集群中，两次：

- **CI**，在分支上通过 `workflow_dispatch` 运行 `propriedades.yml`，run `36362479629`：bootstrap、`smoke-k8s`、`hpa-test`、`rollout-test`、`test-restore`、`test-restore-mutacao` 和 `test-reprojecao-k8s`——全部 `success`，没有改动任何证明。
- **本地**，在这台机器上的 k3d：`deploy/k8s/bootstrap.sh` 以 0 退出（`rollout status deployment/s3-local` 和创建 bucket 都通过了），`make test-restore` 把 183 KB 的 dump 上传到 `s3-local…/brabo-backups/daily/…`，下载并还原了 55 张相同的表（退出 0）；`make test-restore-mutacao` 让那次破坏失败并点名 `zz_mutacao_restore`（退出 0）。一个与 S3 **无关**的细节，记录下来以免与之混淆：在第一次本地运行中，seed 在与 engine 的竞争中丢失了会话的激活（`ECONNREFUSED …:4000`），dump 中没有任何 `session_event`，证明因此失败，这是应当的；通过证明消息本身指出的内部路由写入三个事件之后，它通过了。在 CI 中，seed 第一次就激活了会话。

### 为什么是 `server -s3` 而不是 `mini` {#por-que-server--s3-e-não-mini}

镜像默认是 `mini`，它增加了 WebDAV、Admin UI 和 Iceberg 目录。`server -s3` 启动 master、volume、filer 和 S3 网关——回应 S3 的最小集合。其余的会是没有使用者的暴露面和内存。

### 为什么是端口 9000 {#por-que-a-porta-9000}

NetworkPolicy 匹配 POD 的端口，而不是 Service 的。使用 `-s3.port=9000`，网关监听在 MinIO 原来监听的地方，两条策略和 `BACKUP_S3_ENDPOINT` 只改**名字**。master（9333）、volume（8080）和 filer（8888）在 pod 内部监听，并继续被基线拒绝。

### 为什么名字是中性的 {#por-que-o-nome-é-neutro}

把一个运行 SeaweedFS 的 Service 叫作 `minio`，可以省下引导中的三行，却会误导打开集群的人。备份消费的是**协议**；按背后的产品命名，正是会让下一次更换重演这一次的做法。

## 后果 {#consequences}

- 引导重新通过 S3，性质证明重新运行（run `36362479629`，六个全绿）。
- **客户端没有改变。** `docker/backup/` 没有一行被触碰，证明所衡量的内容（`test-restore`、`test-restore-mutacao`）相同。
- **声明的代价：`readOnlyRootFilesystem` 仍然为 false**，与 MinIO 时一样——`weed` 把 filer 的 socket 写在 `/tmp`。本地测试组件，在生产中没有对应物。
- **声明的代价：SeaweedFS 不是 MinIO。** S3 兼容性是逐操作的契约，不是一个徽章。产品使用的八个操作已经测量；`lib.sh` 中的**新**操作（生命周期、版本控制、对象锁）在进入之前需要针对它测量，因为这里是它会首先被演练的地方。生产继续与真实的 bucket 通信，那不会改变。
- **按 digest 固定不能防止发布者消失**——这个也不能。如果再次发生，信号相同：引导死在 S3 的 `rollout
  status` 上，带着 `ImagePullBackOff`。这一教训写进了 [`cadeia-de-suprimentos-do-ci.md`](../explanation/cadeia-de-suprimentos-do-ci.md)。
- 按 digest 固定的第三方镜像数量不变（出一个，进一个）：39。
- 不产生 RN：这是本地验证基础设施，没有业务规则。
