---
id: cadeia-de-suprimentos-do-ci
title: CI 的供应链
sidebar_label: CI 的供应链
description: 在我们的 CI runner 中运行的、不是我们写的东西，它们如何被固定，以及哪些仍然凭信任接受。
traducao_de: 929963d24eb727bd64875486f2f1889172f3084a
---

# CI 的供应链

这个仓库的每个 job 都在一台机器上运行第三方代码，这台机器上有源代码的检出，并且在 release workflow 中还有 GHCR
registry、npm registry 以及仓库自身 git ref 的凭据。这些代码通过两条路径到来：**GitHub Actions**（`uses:`）和
**用 `curl` 下载的二进制**（扫描器）。两者都不是在这里编写的，也都没有经过 PR 审阅。

本页处理其中我们能控制的部分。它之所以存在，是因为这个机制原先只住在 workflow 的注释里——一个规则可以被阅读却
无法被审计的地方，而两半恰恰因此产生了分歧。

## 直白地说出威胁 {#the-threat-stated-plainly}

tag 是一个指针。`actions/checkout@v4` 不是一个版本，而是一个名字，action 的所有者可以随时删除并重建它、让它指向另一个
提交，而在这个仓库中没有任何信号。移动这个 tag 的人会在我们的 runner 上、在我们的检出中、带着该 workflow 收到的密钥
运行他的代码。

GitHub Release 资产的 `curl` 也是如此：一个被攻破的 release，或 runner 与 CDN 之间的中间人，会给我们另一个二进制而
无人察觉——直到扫描器无法启动，或者更糟，直到它"能工作"。

两者都不是专门针对我们仓库的假设。它们是现实世界中 CI 被攻破的两种有记录的方式，对两者的防御是同一个想法：**引用内容，
而不是名字**。

## 两个机制 {#the-two-mechanisms}

### 二进制：每次下载后做校验和 {#binaries-checksum-after-every-download}

`ci.yml` 和 engine 的两个 Dockerfile 中每个 release 资产的 `curl` 之后，都跟着针对写在 workflow 本身中的哈希的
`sha256sum -c`：

```yaml
GITLEAKS_SHA256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
```

哈希来自每个 release 发布的 `checksums.txt`，通过一次独立的下载获得。不一致会在二进制甚至被执行之前让 job 失败。

`propriedades.yml`（定时的属性证明，BRB-009）对它启动集群所需的三个二进制——`k3d`、`helm` 和 `kubectl`——遵循同样的
规则，每个都在 workflow 的 `env:` 中有自己的哈希。它在运行 `deploy/k8s/bootstrap.sh` **之前**安装它们，而这个顺序就是
关键：bootstrap 自己的 `ensure_k3d` **不带**校验和地下载 k3d，而在 `PATH` 中已经找到二进制正是阻止它下载的原因。如果
那里固定的版本与 bootstrap 将安装的版本不一致，一个步骤会让 job 失败。该 workflow 仍凭信任接受的，已声明：Helm 的
chart 按**版本**而不是按 digest 从各自的仓库获取（`deploy/k8s/helm/charts.env`），连同这些 chart 引用的镜像；而
`k3d` 按**嵌入在 k3d 二进制中的 tag** 下载节点镜像 `rancher/k3s` 和它的负载均衡器镜像——因此，它们只被固定到 k3d 的
校验和所固定的程度。

扫描器的版本有第二个约束：它们必须与 `docker/engine/Dockerfile.prod` 一致，因为针对与生产中运行的不同的扫描器进行测试
是假绿。承诺这一点的注释自 Fase 5 起就在那里；**强制执行**它的步骤
（`Versões dos scanners batem com o Dockerfile.prod do engine`，在 `lint` job 中）直到
[#408](https://github.com/daneiel/brabo/pull/408) 才到来。

### Actions：提交 SHA，旁边带版本 {#actions-commit-sha-with-the-version-alongside}

每个 `uses:` 都固定在一个 40 字符的提交 SHA 上，它来自的 tag 保留在行尾的注释中：

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262  # v4
```

注释是**必需**的，而且不是装饰。它是唯一告诉人类——以及 Dependabot，它读的正是这个注释——一个哈希是哪个版本的东西。
旁边没有版本的 SHA 是一个没人能审计、也没人能更新的固定。

要把 tag 解析为要标注的 SHA：

```bash
gh api repos/actions/checkout/commits/v4 --jq .sha
```

## 为什么有一个检查而不只是一条规则 {#why-theres-a-check-and-not-just-a-rule}

#408 固定了 `ci.yml` 的 actions，而且只固定了它的。其余十五个 workflow 在可变 tag 上停留了几个月——包括
`release.yml`（把镜像推到 GHCR）、`publish-runner.yml`（发布到 npm）、`tag-release.yml`（创建 tag）和
`docs-deploy.yml`（推送到 `gh-pages`）。没有被固定的那一半，恰恰是拥有凭据的那一半。

这不是疏忽，而是没有机制的规则可预见的形态：新的 workflow 是通过复制邻居写成的，而邻居用的是 tag。于是这条规则现在有了
机制——`scripts/ci/actions-pinadas.ts`，在 `lint` job 中运行，它让任何不是提交 SHA 的 `uses:` 以及任何没有版本注释的
SHA 失败。这与[RN 和 ADR 计数](documentation-workflow.md)是同样的推理：手工保持正确的数字在有人忘记的那一刻就会变老，
因此要读取工件而不是信任它。

对**本仓库内部** action 的引用（`./.github/...`）会通过：那是我们的代码，由修改它的 PR 审阅，没有能移动任何东西的第三方。

## Playwright 的浏览器 {#the-playwright-browser}

浏览器 E2E（[ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md)）在 CI 时从 Playwright 的 CDN 下载
chromium——第三种下载，既不是 action 也不是 GitHub Release 的资产，因此上面两个机制都不覆盖它。

固定它的是 `e2e/pnpm-lock.yaml` 中 `@playwright/test` 的**精确**版本：包的每个 release 都绑定到一个浏览器构建，
`playwright install` 获取的就是那个。因此固定就是 lockfile，而 job 中的 `--frozen-lockfile` 让它成为固定而不是建议。

这里没有 `sha256sum -c`，这是诚实的描述：工具自己下载并验证，而手工复制它的校验和表会是一份会变老的副本。比扫描器的
二进制弱，说出来而不是隐含。

## 镜像 job 缓存了什么，以及缓存不能改变什么 {#images-job-caches}

自 AT-304 起，`ci.yml` 的 `images` job 用 `actions/cache`（像每个 action 一样按 SHA 固定）在执行之间保存三样东西，每一样
的选择都是为了让缓存节省时间而不改变任何裁决：

| 缓存 | 键 | 什么决定内容 |
|---|---|---|
| Playwright 的浏览器（`~/.cache/ms-playwright`） | `@playwright/test` 的精确版本 + `e2e/pnpm-lock.yaml` 的哈希 | 上面 lockfile 的固定——新的 Playwright 是新的键，绝不是旧的命中 |
| `e2e/` 的 pnpm store（`setup-node`，`cache-dependency-path: e2e/pnpm-lock.yaml`） | `e2e/pnpm-lock.yaml` 的哈希 | `pnpm install --frozen-lockfile`，它继续对照 lockfile 核对每个 tarball 的完整性 |
| Trivy 的漏洞数据库（`/tmp/trivy-cache/seed/db`） | Trivy 版本 + UTC 日期，恢复最近的前一天 | **Trivy 本身**：`--download-db-only` 继续运行，读取数据库自己的 `NextUpdate`，过期时重新下载 |

最后一行是可能放宽一个 gate 的那一行，而它没有放宽：缓存只是*播种*目录，新鲜度由 Trivy 在笔记本上也会应用的同一条规则
判断。缓存省掉的是每次执行从 registry 下载约 110 MB——这也曾是偶发的 `TOOMANYREQUESTS` 失败的来源。`release.yml` 不使用
这个缓存：tag 用它自己下载的数据库扫描。

浏览器缓存**只**保存浏览器。`--with-deps` 安装的系统库进入 runner 的 apt，没有任何目录缓存能保存它们，因此热执行仍会
安装它们（`playwright install-deps`）。

范围是 GitHub 的，不是我们的：`ci.yml` 只在 `pull_request` 上运行，因此这些缓存写入 PR 自己的范围，并由该 PR 之后的推送
读回（以及基础分支的范围，这个 workflow 从不写入它）。一个 PR 无法为另一个 PR 播种缓存。

## 容器镜像：digest，tag 在引用内部 {#container-images-digest-with-the-tag-alongside}

第三方镜像按 **digest** 固定，它们来自的 tag 写在**引用内部**、digest 之前——`image:tag@sha256:<index>`
（[ADR 0178](../adr/0178-tag-inline-na-imagem-de-terceiro.md)）：

```yaml
image: neo4j:5.26-community@sha256:d9cfe82983d27f5a75b3aaae8f316d04f9a698a3b7f6103a508f7caf8362f255
```

```dockerfile
FROM node:26.12.0-alpine3.24@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS deps
```

两者都存在时，Docker 按 digest 拉取：tag 是给读这一行的人的信息，digest 决定字节。

**在 ADR 0178 之前，tag 住在注释中**（`neo4j@sha256:…  # 5.26-community`，在 Dockerfile 中是在上一行），模仿 actions。
它换了地方是因为一次测量（AT-139，2026-09-27）：Dependabot 不以任何格式读取这个注释，而只有 digest 的固定会被"更新"为
`latest` 的 digest——这本会把 pgvector、neo4j 和 node 带到另一个大版本，而注释仍断言旧 tag，lint 是绿的。tag 内联后，
Docker、Dependabot 和人类读到的都是同一个 tag。CloudNativePG 的 `imageName` 出于另一个原因已经是这种形式：它的 webhook
拒绝只有 digest 的引用，因为它从 tag 读取 Postgres 的版本。

注释仍然**允许**，但只能说同样的事：断言一个与内联 tag 不同的 tag（带数字的单个词元）的注释会让检查失败——这正是一次版本
更换会留下的残余。**在 Dockerfile 中，`FROM` 行尾的注释仍然失败**：Docker 的解析器只在行*首*识别 `#`，因此
`FROM alpine:3.20@sha256:… # 3.20` 是一个带三个参数的 `FROM`，构建死于 *"FROM requires either one or three
arguments"*。这是在 ADR 0159 下以正确的方式发现的——`images` job 的 `bake` 步骤在第一次推送时失败，用时 27 秒——而
`hadolint` 放过了同一个文件：linter 同意不等于构建同意。

本页曾经说过相反的话——按 tag 固定是"一个刻意的停顿，而不是疏忽"，换来日常的可复现性"而没有在我们不发布的镜像上维护
digest 的成本"。这个推理已被**撤销**，测量就是原因：仓库中 37 个第三方引用都在 tag 上，而其中三个它们运行的地方比
`docker compose pull` 变旧更糟。

- `FROM` 行是我们发布到 GHCR 的镜像的基础——自 [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)
  起有五个。一个被移动的 tag 会变成我们签名并交给别人的镜像中的字节。
- `docker/docker-compose.install.yml` 在安装了产品的人的机器上运行，挨着他的 Postgres。在同一个文件中，我们**自己**的
  镜像已经通过安装器填写的变量按 digest 到来——第三方的则按 tag 到来，就在它们旁边。
- `ci.yml`、`golden-set-rag.yml` 和 `golden-set-qa.yml` 把第三方镜像作为 job 的 `services:` 运行。这字面上就是 actions
  规则要保护的 runner，从另一扇门进入。自 [ADR 0197](../adr/0197-a-imagem-dos-workflows-vem-do-compose.md) 起它们不保存
  任何字面量：见下面的*workflow 读取 compose*。

要把 tag 解析为要标注的 digest——**索引**的 digest，让固定在 `linux/amd64` 之外也能在 `linux/arm64` 上工作：

```bash
docker manifest inspect neo4j:5.26-community | head -3   # confirms it is an index
docker buildx imagetools inspect neo4j:5.26-community --format '{{.Manifest.Digest}}'
```

tag 是**必需**的，原因与 actions 中版本注释是必需的相同：`sha256:22ec5cd0…` 不会告诉任何人那是 Neo4j 5.26。并且，与
actions 一样，这条规则有机制而不是靠善意——`scripts/ci/imagens-pinadas.ts`，在 `lint` job 中运行，它让以下情况失败：任何
不是 digest 的 `image:`/`imageName:`/`FROM`、任何没有内联 tag 的 digest（包括只有注释的旧形式）、与内联 tag 不一致的 tag
注释、`FROM` 行尾的注释，以及同一个内联 tag 在两个文件中带着两个不同的 digest。它是 `actions-pinadas.ts` 的**兄弟**，而
不是它的扩展：`uses:` 住在一种语法的 workflow YAML 中，镜像住在 compose、kustomize 清单和 Dockerfile 中，有另外三种语法，
而一个回答两个问题的函数会把两个都答得很差。

检查故意**不**覆盖的：

- **我们自己构建的镜像**（`brabo-api`、`brabo-engine`、`brabo-web`、`brabo-backup` 和 `brabo-broker`——最后一个自
  [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md) 起发布）。没有能移动任何东西的第三方，而
  `brabo-api:prod` 是一个*本地* tag，它的 digest 在构建之前并不存在。在它们穿过 registry 的地方，它们**已经**通过拥有它们
  的机制按 digest 进行：由 `release.yml` 写入、由 `make imagens-do-release` 应用的 `.release/images.json`
  （[ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)）。仓库的 overlay 保存*标记*，而不是冻结的版本——
  在那里要求字面的 digest 会与这个机制冲突，而不是加强它。
- **插值引用**（`${BRABO_API_IMAGE:?…}`），它们是从另一面看到的同一种情况。
- **多阶段构建的阶段**（`FROM deps AS build`、`FROM scratch`），它们不是 registry 的镜像。

例外列表按*名称*且失败即关闭：一个新的第三方镜像永远不会匹配 `brabo-`，所以它诞生在规则之下。

### workflow 读取 compose {#the-workflows-read-the-compose}

在 [ADR 0197](../adr/0197-a-imagem-dos-workflows-vem-do-compose.md) 之前，`pgvector` 和 `ollama` 住在两个地方：compose
中，以及作为字面量，在 `ci.yml` 和两个 golden-set workflow 的 `services:` 中。没有任何 Dependabot 生态系统读取 workflow
的 `services:`，因此每个在 compose 中升级其中一个的机器人 PR 都会因"同一 tag，两个 digest"规则生来就是红的，而在机器人 PR
中对齐 workflow 的步骤无法用 `GITHUB_TOKEN` 推送，它从来没有修改 `.github/workflows/` 的权限。

字面量被移除了。一个可复用 workflow `.github/workflows/imagens-do-compose.yml` 运行
`scripts/ci/imagens-do-compose.ts`，它读取 `docker/docker-compose.yml` 中每个服务的 `image:`（并拒绝不是
`image:tag@sha256:<index>` 的），调用方写 `image: ${{ needs.imagens.outputs.pgvector }}`。一个不存在的副本无法产生分歧：
机器人 PR 只触及 compose，而同一个 PR 的 CI 已经针对新镜像运行。`golden-set-rag.yml` 曾在注释中*承诺*的——与 dev 相同的
Ollama，因为 golden-set 的下限按模型而不是按环境设键——现在在构造上就是真的。

`imagens-pinadas.ts` 学会了新形式，并关上了它打开的门。在 workflow 中，它让以下情况失败：任何第三方**字面量**（无论是否
固定）；任何不完全是 `${{ needs.<job>.outputs.<name> }}` 的表达式——表达式中的字面量、`||` 的默认值、`env.`、`vars.`、
`format()` 都是可变引用可以藏身的地方，而旧的模式甚至不匹配带空格的行；以及一个其 job 不调用可复用 workflow 的
`needs.<job>`，或它没有声明的输出。每条规则都在它的 spec 中经变异证明。

**代价是真实的，而 Dependabot 现在承担其中一部分。** 按 digest 固定的镜像在有人换掉 digest 之前收不到安全更新——与
actions 的 SHA 所背负的是同一笔债。`.github/dependabot.yml` 因此开启 `github-actions`，并且自 ADR 0197 起开启
`docker-compose`（`/docker`）和 `docker`（`/docker/*` 和 `/deploy/k8s/**`），每个都分组为每周一个指向 `dev` 的 PR。`node`
大版本的临时忽略（AT-360）随迁移到 Node 26 而移除（负责人的决定，2026-10-02）：两个镜像生态系统现在像其他任何更新一样
提议 `node` 的大版本。仍然是手动的，并在 ADR 0197 中声明：`neo4j` 和 `ollama` 也住在 `deploy/k8s/base/` 中，两个生态系统
从不共享一个 PR，而同一 tag 的 digest 重新发布会让两个 PR 都失败，直到一个人类把它们合并；CloudNativePG 的 `imageName`
和 `IMAGEM_DO_GOLDEN_SET_QA` 不被任何生态系统读取。这些遵循[runbook 的步骤](../runbook.md#subindo-imagem-de-terceiro)。

**digest 保证不可变性，而不是可用性。** 固定防止 tag 的所有者移动它；它不防止发布者删除仓库。这在 MinIO 上发生过：本地
overlay 的 S3 服务器按索引 digest 固定在 `quay.io/minio/minio`，MinIO 停止发布社区镜像，同一个 digest 开始返回 401
（Docker Hub：404）。bootstrap 死在 `rollout status` 上，在服务器被换成 SeaweedFS 之前没有任何属性证明运行
（[ADR 0169](../adr/0169-seaweedfs-no-lugar-do-minio-no-overlay-local.md)）。如果任何固定的镜像再次发生这种情况，症状是一个
没有变化的 digest 上的 `ImagePullBackOff`——修正是来自仍在提供它的发布者的新镜像，绝不是去掉固定。

## 构建缓存不能隐藏一个旧包 {#the-build-cache-cannot-hide-a-stale-package}

每个 `Dockerfile.prod` 的最终阶段（`runtime`）都运行 `apk upgrade`。BuildKit 按指令加父层为层设键，从不按时间，因此开启
`cache-from` 时，一个 PR 构建会复用一个冻结在该 PR 第一次构建中的 `apk upgrade` 层（测得：5 个镜像中 5 个 `CACHED`），而
Trivy 扫描的是一个旧的 openssl，而冷构建的 tag 不会带着它。这就是为什么 `docker-bake.hcl` 在共享的基础目标上定义
`no-cache-filter = ["runtime"]`：最终阶段及其之后的东西每次都重建，构建阶段保留它们的缓存（时间都在那里），扫描看到的是
tag 将发布的东西。这不是 Trivy 的允许列表。代价是每个镜像约 7–9 s，并行。

这修正了 **PR** 扫描的东西。它无法修正 **tag** 发布的东西：tag 在另一次执行中冷构建，而在
[ADR 0172](../adr/0172-trivy-no-release-antes-de-assinar.md) 之前没有任何东西扫描它。

## release 在签名之前扫描它发布的东西 {#the-release-scans-what-it-publishes-before-signing-it}

`release.yml` 在 bake 推送并写入 `.release/images.json` 之后、`cosign sign` **之前**，**按 digest** 直接从 registry
（`--image-src remote`）对每个镜像运行 Trivy。顺序就是机制：失败的镜像永远不会被签名，而 `install.sh` 不安装未签名的镜像。
此时推送已经发生（正是推送创建了 digest），因此一个失败的 tag 会在 GHCR 中留下它的未签名 tag 且没有 Release——这是正确的
状态，因为没有任何东西会安装它们。

gate 与 `ci.yml` job 的规则**相同**，逐个标志：`--scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1`
以及同样的 `.trivyignore.yaml`，其中每个条目都带 `expired_at`。**有可用修复**的 HIGH 或 CRITICAL 会让 release 失败。
**没有**修复的会被报告而不阻止：第二次不带 `--ignore-unfixed`、带 `--exit-code 0` 的扫描为
`scripts/ci/trivy-do-release.ts` 提供输入，它写入 job 摘要和 Release 资产 `trivy-sem-correcao.md`。这个脚本从不决定裁决——
决定的是 Trivy 的退出码——因为关于"有修复"的第二条规则会在 Trivy 第一次添加一个状态时与它自己的规则产生分歧。**没有新的
允许列表**：这一步不接受 PR 已经使用的之外的任何忽略文件。

二进制是与 `ci.yml` 相同的 `v0.70.0`，带相同的 `sha256`，声明两次是因为 workflow 的 `env:` 不能被导入。这种重复是受监视
的：当版本、哈希或 gate 的标志在两个 workflow 之间分歧、当 gate 被移到签名之后，或当出现第二个忽略文件时，
`scripts/ci/trivy-do-release.spec.ts` 会失败。与 `install-e2e.yml` 一样，release 只在最终 tag 上运行，因此这个 spec 是 PR
能给出的证明。

于 2026-09-27 针对最新 release（`v6.1.0`，四个镜像，2026-09-14 发布）的 digest、用同样的标志测量：`api` 和 `web` **会失败**
——`CVE-2026-45447`（HIGH，`libcrypto3`/`libssl3` `3.3.7-r0`，在 `3.3.7-r1` 中修复），一个在那个 tag 之后发布的 CVE——
`engine` 和 `backup` 通过，应用 `.trivyignore.yaml` 后没有出现没有修复的 HIGH/CRITICAL。没有它，`engine` 会在该文件记录的
第三方扫描器二进制中带有 56 个可修复的发现。四次扫描加上数据库下载用了大约 30 s。

## 一个固定在 git 提交上的依赖：`bandit`，临时的 {#bandit-pinned-to-a-commit}

engine 的每个依赖都来自 hex.pm，只有一个**临时**例外。公告 EEF-CVE-2026-105659（GHSA-69m6-wcv4-rwcf，HIGH，Bandit 的
HTTP/2）影响所有 Bandit `>= 1.4.0`，包括 hex 上最新的 release 1.12.5，而 CI 的 `mix hex.audit` 在每个 PR 中都因它失败。
修复只作为 `mtrudel/bandit` 的提交 `d88b21953c65061f21136ea76a89a4f95a2ac7a1` 存在（2026-10-12 合并），没有 release。自
2026-10-14 起，`apps/engine/mix.exs` 让 `bandit` 指向这个提交，按完整 SHA 而绝不按分支，带 `override: true`，因为
`phoenix` 和 `opentelemetry_bandit` 请求的是 hex 的包（测得：没有它，`mix deps.get` 会以 "Dependencies have diverged"
停下）。SHA 起到校验和对 hex 包所起的作用：lock 记录它，没有人能移动它。engine 的两个 Dockerfile 已经在构建阶段安装了
`git`。

回去的路：一旦发布了包含这个提交的 release，就回到 hex 的 `{:bandit, "~> 1.12"}`，并同时删除这一节。

## 仍然凭信任接受的 {#what-is-still-trusted-on-faith}

已声明，未修正：

- ~~**没有 Dependabot。**~~ **一半已关闭，另一半不由我们关闭。** 这个断言也已不再成立：*安全*更新是在仓库的**界面**中
  开启的，不在任何文件中，并且每天都针对 `npm_and_yarn in /., /website` 运行——而且每天都以
  `Dependabot::DependabotError` **失败**。测得的原因：它追逐的包（`multer`、`esbuild` 以及旁边的列表）正是这个仓库通过
  `pnpm-workspace.yaml` 中的 **overrides** 修正的那些，一种 Dependabot 无法操纵的机制。它追逐的警报已经关闭；剩下的是错误。

  `.github/dependabot.yml` 现在存在，并做一个文件能做的两件事：**开启 `github-actions`**——就在这里点名的债务，因为 SHA
  是手工移动的，而*一个没人更新的固定是一个会老化到已知有漏洞版本的固定*——并用 `open-pull-requests-limit: 0` 声明两棵
  npm 树，这会关闭例行的版本更新而不触及安全更新。**关闭安全更新是界面上的一个开关**，只有仓库所有者能触及；在有人决定
  之前，这个 job 会继续因 overrides 已经关闭的警报而失败。

  每个 Dependabot PR 都从 `dev` 进入（五个条目中都是 `target-branch: dev`——自 ADR 0197 起包括两个镜像生态系统）。安全更新
  忽略这个键并针对默认分支打开，因此 `dependabot-para-dev.yml` 关闭 `dev` 已经修正的那些，并重定向其余的——见
  `branching-policy.md` 中的 *Dependabot enters through dev*。
- **npm/pnpm 依赖没有证明。** lockfile 固定版本和完整性哈希，这是真实的，但在任何 job 中都没有来源检查
  （`npm audit signatures` 或等价物）。
- ~~**我们自己的工件没有签名也没有证明。**~~ **由 [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md) 关闭**
  （BRB-005）。`release.yml` 用 `cosign` keyless **按 digest** 对它发布的镜像签名——workflow 的 OIDC 身份，任何地方都没有
  托管的密钥——而 `build-runner-binaries.yml` 获得了一个合并 job，发布**一个已签名的 `checksums.txt`**，覆盖 runner 的二进制
  （自 [ADR 0174](../adr/0174-runner-sem-binario-darwin-x64.md) 移除 `darwin-x64` 起为四个目标），而不是每个二进制一个签名。
  两个 workflow 都在同一次执行中**验证它们刚刚签名的东西**：一个没人尝试验证的签名只是 release 中的又一个文件，否则失败会
  出现在安装者的机器上——发现它的最糟糕的地方。

  自 [ADR 0160](../adr/0160-o-compose-do-instalador-viaja-assinado.md) 起，这个清单覆盖的不只是二进制：`install.sh` 以及它
  启动一个安装所需的四个文件——安装 compose 和它按相对路径使用的三个文件，作为 `brabo-install-*` 资产从 tag 的检出发布——
  是**同一个** `checksums.txt` 中的行，job 在附加任何东西之前对它运行 `sha256sum -c --strict`。安装器在询问或写入任何东西
  之前，对照这个清单核对这四个中的每一个（[RN-570](../business-rules.md#rn-570)）。在那之前，compose 是安装器使用的、唯一
  没有任何东西验证的东西——甚至不下载它。列表位于 `scripts/ci/assets-do-instalador.ts`，它的 spec 在安装器自己的副本分歧，
  或 compose 获得一个不在其中的相对 bind-mount 时失败。

  **broker 的镜像是第五个，也是最重要的一个**（[ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)）。
  在那之前没有人构建它：`Dockerfile.prod` 存在并通过了 `hadolint`，但没有任何 bake 目标构建它，因此它从未被扫描或发布，
  而安装无法提供这个服务。现在它经过另外四个经过的每一个 gate——`ci.yml` 在每个 PR 中构建它，拒绝以 root 运行，对它运行
  Trivy，并以只读 rootfs、无网络的方式让它健康启动；`release.yml` 按 digest 发布、记录、签名并验证它，不多一行，因为两个
  循环都读取 `.release/images.json`。它比其他任何镜像更需要这些的原因：在一个同意的安装中，它是唯一接收宿主 Docker socket
  的服务，因此它的漏洞是通往整台机器的路径。发布它使它成为一个可被研究的公开目标；这个代价在 ADR 中声明，没有隐藏。
  Kubernetes 的 overlay 不认识它（`argumentosDeSetImage` 只发出 kustomize 基础声明的四个镜像）——按决定，没有 broker 的
  Deployment。

  这**不**覆盖的，是另一个条目：面向操作系统的 **runner 二进制代码签名**（macOS 的公证、Windows 的 Authenticode），它需要
  一个付费的签名身份，留在 [backlog](backlog.md) 中。
- ~~**第三方镜像按 tag 而不是按 digest 固定。**~~ **已关闭**（见上）：全部 33 个第三方引用——compose、kustomize 清单和
  Dockerfile 的 `FROM` 行——都按 digest 固定，tag 在引用内部（ADR 0178），workflow 的 `services:` 从 compose 读取它们的
  镜像（ADR 0197），`scripts/ci/imagens-pinadas.ts` 会在下一次回退时让 `lint` job 失败。**没有**关闭的，是固定的代价而不是
  残余：digest 在有人升级它之前收不到安全更新。Dependabot 的 `docker`/`docker-compose` 生态系统自 ADR 0197 起提议这些升级；
  它们触及不到的列在那里。
- **workflow 自身的权限**不在这里覆盖；那是每个 workflow 的 `permissions:` 块，是另一次审计。
- **`pnpm audit` 的重复超时是按决定承担的风险。** 当 npm 的公告端点连续三次不响应时，job 以响亮的警告变绿而不是变红——见
  [ADR 0140](../adr/0140-timeout-do-audit-como-risco-assumido.md)。代价直说：在这些执行中，依赖树**没有**被审计，执行会说明
  这一点，而不是暗示一个干净的结果。它不触及的：实际报告的漏洞在第一次尝试时仍然失败，不重试，未被识别的失败也会失败
  （失败即关闭）。另一种选择——在第三方宕机时变红——在它发生的那天被测量过（四个 PR 被同一个 503 阻塞）并被拒绝，因为一个
  喊"狼来了"的 gate 会教人一直重跑直到变绿，而这个习惯区分不了真的红和假的红。
