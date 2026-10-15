---
traducao_de: 42943eb911ce4bccd8d00101edc9e854ff9d8c3c
---

# 0149 — 已发布工件的签名

## 状态 {#status}

**提议中。** [FASE 29](../explanation/fase-29-instalacao-de-uma-linha.md) 的第一个 ADR。这里的任何内容都不改变镜像所包含的东西，也不改变 runner 所做的事——改变的是在它们**旁边**发布什么，以及什么开始变得可验证。

## 背景 {#context}

产品**对其发布的任何东西都不签名**。在 `.github/`、`scripts/`、`docker/` 和 `Makefile` 中搜索 `cosign`、`sigstore`、`slsa` 和 `attestation`，只返回一个真实出现，而它既不覆盖镜像也不覆盖二进制：runner npm 包的 `npm publish --provenance`（`.github/workflows/publish-runner.yml:188`，以及它在 `:27` 中要求的 `id-token: write`）。

没有来源证明的内容：

- **GHCR 上的四个镜像。** `release.yml` 用 `docker/bake-action` 构建并发布（`.github/workflows/release.yml:286-303`），把 digest 记录到 `.release/images.json`（`:308-319`，通过 `scripts/ci/images-manifest.ts`），并把该清单附加到 Release（`:321-332`）。workflow 声明了三项权限——`contents: write`、`pull-requests: write`、`packages: write`（`:40-43`）——**没有 `id-token: write`**，而那正是 keyless 签名所需要的。
- **runner 的五个二进制。** `build-runner-binaries.yml` 组装 matrix（`:58-74`），构建并用 `gh release upload` 上传每个文件（`:227`）——**仅此而已**。在任何 workflow 中都没有我们自己工件的 `checksums.txt`、`.sig`、`.asc` 或 `sha256`。现有的 `sha256sum -c`（`ci.yml:201,453,458,462`、`docker/engine/Dockerfile.prod:95,100,104`）验证的是**第三方**的二进制，它们恰恰是仓库早已懂得应用、却从未应用于自身的模式。
- **产品提供的下载路径。** `GET /runner-releases/binary` 是 `@Public()`（`apps/api/src/interfaces/http/runner/runner-releases.controller.ts:73-74`），校验**输入**（`platform` 对照一个封闭的允许列表，`:97`），并把 GitHub 的字节直接流式传给客户端（`:111-133`）。没有校验和、签名或任何完整性验证。[ADR 0146](0146-base-consentida-no-bootstrap.md):208-212 已经把这称为 BRB-005——*"不是值得模仿的模式"*。

这就是 **BRB-005**，也是它在 FASE 28 中挡住了一行安装程序：*"一个没有签名的一行安装程序比当前的下载更糟"*（`../explanation/fase-28-pasta-do-usuario.md:171-173`）。FASE 29 的顺序由此而来——没有本 ADR，[ADR 0150](0150-instalador-de-uma-linha.md) 恰恰就是上一个阶段拒绝的东西。

## 决策 {#decision}

### 1. keyless 的 `cosign`，使用 workflow 的身份 {#1-cosign-keyless-com-a-identidade-do-workflow}

`release.yml` 获得 `id-token: write`，并**按 digest** 对**四个镜像**签名——它早已计算并写入 `.release/images.json` 的 digest，绝不按 tag，因为 tag 是会移动的指针。签名的身份是 workflow 自身（GitHub Actions 的 OIDC），验证所要求的正是它：workflow 的 `--certificate-identity` 和 GitHub 的 `--certificate-oidc-issuer`。

用 keyless 而不是手工管理的密钥对，理由是仓库早已在供应链上运用的：私钥需要保管、轮换以及**又一个 CI 密钥**——而仓库最近的历史中就有一个过期的 PAT，让 `tag-release` 两次运行失败，直到自动 issue 出现之前都没人察觉（[ADR 0139](0139-o-alarme-de-esteira-ganha-destinatario.md)）。由执行派生的临时凭据不会在柜子里过期。

### 2. 一个已签名的 `checksums.txt`，而不是五个签名 {#2-um-checksumstxt-assinado-não-cinco-assinaturas}

`build-runner-binaries.yml` 开始发布一个包含五个二进制 SHA-256 的 `checksums.txt`，并**对这个文件签名**。逐个签名每个二进制会产生五个需要验证的签名工件，以及五种验证只做一半的方式；一份已签名的清单通过一次验证覆盖整套，而且是任何使用者都懂得读取的格式。

`checksums.txt` 诞生于早已在等待 Release 存在的同一个 job（`build-runner-binaries.yml:213-221`，带 600 秒上限的循环），matrix 仍然是 `fail-fast: false`：一个没构建出来的目标**不**会阻止其他目标发布，但清单会声明它覆盖了哪些目标——一个列出四个二进制、对第五个保持沉默的 checksums 比没有更糟。

### 3. 谁来验证，失败时会怎样 {#3-quem-verifica-e-o-que-acontece-quando-falha}

| 使用者 | 验证 | 失败时 |
|---|---|---|
| `install.sh`（ADR 0150） | 按 digest 验证镜像签名；使用二进制之前验证已签名的 `checksums.txt` | **具名拒绝**——说出哪个工件、哪项验证，然后停止 |
| `GET /runner-releases/binary` | **只**对照同一 Release 的 `checksums.txt` 验证二进制的 SHA-256——**不**验证它的签名（见下文） | 带 `motivo` 的 502；绝不提供未经验证的字节 |
| 本地构建（ADR 0150） | git tag 和干净的工作区 | 构建之前拒绝 |

**验证失败就是拒绝，绝不是警告。** 一个可以点一下就接受的警告，就是一项不存在的验证——产品早已在别处运用这把尺子：当共享未被证明时，`consentir-base.mjs:246-258` 拒绝写入并以 1 退出。缺少本应被验证的东西同样是拒绝：没有 `checksums.txt` 的 Release 会让代理**拒绝**，而不是声明自己无法核对后照样提供——否则删掉 Release 中的 400 字节就会关掉所有人的验证。

#### api 代理验证的是**完整性**，不是来源——这是决定，不是遗漏 {#o-proxy-da-api-verifica-integridade-não-procedência--e-isso-é-decisão-não-omissão}

表格第二行当初写得好像两半是一回事。在第 3 次会话中，在测量了 api 验证签名的两种方式之后，它们被分开了：

| 路径 | 测得 | 为什么不 |
|---|---|---|
| api 镜像内的 `cosign` | **155 MB**（`cosign-linux-amd64` v2.6.1） | 让一个 Alpine + Node、按 digest 发布在 GHCR 上的运行时镜像（[ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md)）几乎翻倍，只为验证一个可选的下载 |
| `@sigstore/verify` + `@sigstore/tuf` | **2.5 MB，12 个包**，无安全公告 | 体积不是代价。`getTrustedRoot()` 会针对 `tuf-repo-cdn.sigstore.dev` 刷新 TUF 元数据（包中的 `seeds.json` 只播种 `root.json`），所以一条今天依赖**一个**第三方主机的 `@Public()` 路由会变成依赖两个——而它是 [ADR 0118](0118-configuracao-automatica-do-runner-pelo-navegador.md) 引导流程的入口。更糟的是：按照 ADR [0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) 的尺子——capability 只有在**被证明**时才声明——今天无法证明这条路径，因为**没有任何 Release 带有 `checksums.txt.bundle`**：`checksums` job 只在正式 tag 时运行，而签名一方的 RN-524 早已声明了这一缺口。在引导流程之前加一个无法证明的验证，会把一个已知的弱点换成在每个平台、每个安装上的 502，而且只在生产中才被发现 |

因此代理核对哈希，并**说明这只是哈希**——在 docblock、OpenAPI 描述、拒绝消息以及 [RN-525](../business-rules.md#rn-525) 中。验证签名的是 `install.sh`，它通过决策 4 的路径拥有真正的 `cosign`。后果被记录而不是隐藏：**BRB-005 对签名的产出关闭，而对这条路由的来源那一半保持开放**——重新打开它是之后某次会话的决定，要有一个真实的已签名 Release 来作证明。

### 4. 用于验证的 `cosign` 也需要来源证明 {#4-o-cosign-que-verifica-também-precisa-de-procedência}

验证需要安装者机器上有 `cosign` 二进制，而不经验证就下载它会在上一层重新制造问题。`install.sh` 通过 CI 早已对每个第三方二进制使用的路径解决这一点：下载**固定**的版本，并用 `sha256sum -c` 对照**写在版本化脚本本身中**的哈希核对（`ci.yml:201` 是先例）。信任 `install.sh` 到愿意执行它的人，也就信任它携带的哈希；这条链不会比起始它的那一环更脆弱。

## 本 ADR 明确拒绝的内容 {#o-que-este-adr-recusa-explicitamente}

- **手工管理的密钥**（自有密钥对、KMS、GPG）：保管和轮换一个 CI 密钥，却得不到 keyless 在这里给不了的任何好处。
- **"现在签名，以后再验证。"** 没有使用者的签名只是 Release 中多出的一个文件。上表中的三个使用者都在本阶段进入，而 `install.sh` 那一个赋予了它意义。
- **按 tag 给镜像签名。** tag 是会移动的指针；digest 才是 `.release/images.json` 早已记录、overlay 早已应用的东西。
- **SBOM 证明和完整的 SLSA 来源证明。** 声明在范围之外：它们是另一条轴，有另一个使用者，而且没有一个能消除 BRB-005。

## 后果 {#consequences}

- **BRB-005 对镜像和二进制关闭**——并且只对它们关闭。登记（[BRB register](../reference/brb.md)）在第 2 次会话合并时收到证据。
- **而对 api 代理的来源那一半不关闭。** 按照决策 3，`GET /runner-releases/binary` 对照清单核对完整性并拒绝它无法核对的东西，但不验证清单的签名——两种做法都已测量并被拒绝（镜像中 155 MB 的 `cosign`；公开路由上的第二个第三方主机，去验证尚不存在、无从证明的东西）。BRB 登记如实说明这一点，而不是宣布该条目已关闭。
- **broker 仍然没有签名，因为它仍然没有发布。** `docker-bake.hcl:81-83` 有四个目标，`scripts/ci/images-manifest.ts:54` 接受四个；`brabo-broker:prod` 只在本地构建时存在。后果属于 ADR 0150 并已在那里声明：在通过 GHCR 的安装中，`container-broker` profile 不可达——而 `mounted` 模式**通过 broker** 启动容器（[ADR 0144](0144-a-segunda-raiz-do-broker.md)）。
- **`release.yml` 多了一项权限。** `id-token: write` 作用域限于该 workflow，不会扩大它凭 `packages: write` 早已能做的事。
- 在没有到 Sigstore 网络的情况下安装的人无法验证——并且按照决策 3，无法安装。这是验证不可选的被接受代价。
