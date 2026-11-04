---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0119 — 每个正式 tag 都把镜像发布到 GHCR，生产 overlay 按 digest 固定

- **状态：** 已接受
- **日期：** 2026-08-29
- **参考（不编辑）：** [ADR 0025](0025-fase5-deploy-kubernetes-kustomize.md) 和
  [ADR 0027](0027-fase5-backup-hardening-release.md)（两者都把“把镜像发布到 registry”登记为超出范围——本 ADR 关闭了这一点）、[ADR 0030](0030-politica-de-branches-mecanizada.md)（本决策刻意不扩大的 push 例外）、
  [ADR 0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md)（写入制品中的版本，这就是 `VERSION` 与 `TAG` 分开的原因）。

## 背景 {#contexto}

`release.yml` 在每个正式 tag 时以 `load: true` 和 `push: false` 构建四个生产镜像，并在注释中说明这一点：构建的存在是为了证明 tag 是**可构建**的，而发布“将在 registry 决定后加入”。与此同时，生产 overlay 指向 `ghcr.io/OWNER/brabo-*`，带有 `newTag: REPLACE_WITH_DIGEST`——一个所有者占位符，以及一个没有任何步骤会替换的占位符。

后果并非表面上的。只要这种状态存在，**“生产部署可端到端执行”就是假的**，而所有排在它后面的东西也继续排在后面：真实的 rollout、针对生产镜像演练的恢复，以及 runner 二进制的代码签名故事（它需要一个已发布的制品来签名）。一次对仓库的外部审查把它列为代价最高的已声明债务，本 ADR 就是那一项。

途中出现了第二个缺陷：overlay 的 `images:` 块列出了**三个**镜像，而不是四个。`brabo-backup` 从未被重映射，因此备份 CronJob 继承了 base 的 `brabo-backup:prod`——一个在任何 registry 中都无法解析的名字。最需要备份的环境，将会是其备份 pod 永远起不来的那个。CI 从未发现这一点，因为 overlay 检查验证的是 overlay **能构建**，而一个带本地名字的镜像构建起来毫无问题。

## 决策 {#decisão}

**1. `release.yml` 在每个正式 tag 时把四个镜像发布到 GHCR。**
登录使用 job 自己带有 `packages: write` 的 `GITHUB_TOKEN`——没有需要轮换的新秘密，作用域随 job 结束。包是**公开**的：代码本就在同一仓库中公开，秘密从不写入镜像（四个兄弟密钥拒绝以示例值启动，RN-114），公开包让生产 overlay 保持“拉取即运行”，无需在每个 namespace 中创建、引用和轮换 `imagePullSecret`。

**2. registry 前缀是 bake 的一个变量，而不是第二个 bakefile。**
`REGISTRY` 默认为 `""`，因此 `ci.yml` 继续构建它扫描并在 smoke 中测试的本地短名（`brabo-api:prod`）；`release.yml` 定义 `ghcr.io/<owner>/`。结尾斜杠住在**值**中——空前缀必须恰好产生旧名字，插值中任何固定的分隔符都会破坏 `ci.yml`。`OUTPUT` 采用相同形式：默认 `type=docker`（本地加载），release 使用 `type=registry`（push）。`type=registry` 不是优化——它是 bake 返回 `containerimage.digest` 的唯一模式，因为**digest 诞生于 push**。

**3. 每个 tag 发布了什么，按 **DIGEST** 记录在
`.release/images.json` 中。** tag（`3.2.0`、提交的 sha）继续被发布：它们服务于人与人的交流和手动 `docker pull`。它们从不是 manifest 所引用的东西——一个随时间指向不同内容的可变 tag 会摧毁确定性回滚，并让同一 ReplicaSet 的两个 pod 运行不同的二进制，这正是 overlay 自第 5 阶段起的注释所说的。

**4. 该文件是 GitHub Release 的 asset，并通过 CHANGELOG 的 PR 进入仓库。** 它**不**获得第三个 push 例外。分支策略恰好有两个（release bot 的 tag、gate bot 的 `.release/gate.json`），一个每次扩展都需要新例外的机制就不再是策略。release 的 asset 是权威副本，在 tag 存在的那一刻就可用；受版本控制的副本经由 `release.yml` 已经向 `dev` 开出的 PR 到达。

**5. overlay 保留占位符；`make imagens-do-release` 应用 digest。** 仓库不声明哪个 release 在生产中——做部署的人在部署时决定。仓库保存的是每个 tag 发布内容的记录以及应用它的工具。这个工具是 `kustomize edit set image`，而不是 `sed`：kustomize 知道
`name=repo@sha256:…` 意味着 `newName` + `digest`，并且 `newTag` 必须移除，而 `sed` 会改对文本却改错 schema。

**6. `brabo-backup` 进入 overlay 的 `images:` 块**，在 prod 和 staging 中都是。

## 后果 {#consequências}

- 生产 overlay 命名了一个真实的所有者（`ghcr.io/daneiel/*`）而不是占位符，它的四个镜像都解析到存在的东西。
- **应用 digest 会重写整个 overlay 文件。** `kustomize edit` 会往返处理 YAML：重新排序键并丢弃注释。这对一次部署时操作是可以接受的，也正因如此，结果明确**不**用于提交——记录在文件自身的注释和 runbook 中，免得下一个人在 diff 中才发现。
- 只要四个目标中任何一个没有返回 digest，release 现在就会失败。这是刻意的：生产中三个新镜像和一个旧镜像比完全没有 release 更糟，而部分文件中没有任何东西会说明缺了一个镜像。与批量 `embed`（ADR 0075）同样的纪律——部分响应事后无法察觉。
- **尚未完成，也不声称：** 没有任何东西会自己部署。没有可以部署到的环境，`DEPLOY_ENABLED` 仍然不存在，`platform` gate 仍为 `planned`（ADR 0091/0092）。本 ADR 让生产 overlay *可执行*；它并不执行它。
- **同样未完成：签名或证明镜像。** 没有 cosign 签名，没有 SLSA 来源证明。那属于 runner 二进制的代码签名事项（ADR 0112），被同一个操作员动作阻塞——获得一个签名身份。
- 这条路径的第一次真实执行是**下一个正式 tag**。与 `build-runner-binaries.yml`（ADR 0112）一样，workflow 由 tag 触发，因此无法由 PR 证明。纯逻辑（`images-manifest.ts`、
  `aplicar-imagens.ts`）由测试覆盖；bake 的渲染在两种模式下都用 `docker buildx bake --print` 核对过；`kustomize edit` 的路径用合成的 manifest 针对 prod overlay 真正执行过。任何测试都给不了的是 GHCR 接受 push，那要等 tag。

## 考虑过的备选方案 {#alternativas-consideradas}

**由 release bot 重写 `kustomization.yaml` 并 push。**
因两个原因被拒绝：它会在一个只有两个例外的策略中开第三个 push 例外，并让一个 tag 单独决定生产中运行什么。

**私有包加 `imagePullSecret`。** 被拒绝：为了隐藏一个由公开代码构建、不携带秘密的镜像，要增加一个需要创建、在每个 namespace 中引用并轮换的秘密。成本是真实且持续的；在这里，收益则不是。

**按版本 tag 而不是 digest 固定。** 被拒绝，理由是 overlay 在本 ADR 存在之前就已写下、现在由测试强制的那个：`argumentosDeSetImage` 发出的任何参数都不能带有 `:tag`。
