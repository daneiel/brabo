---
traducao_de: cf708bdefd987dda6e1cb40b3aa9e520113eb6b8
---

# 0159 — 第三方镜像按 digest 引入，lint 让忘记的人失败

## 状态 {#status}

**已接受。** **修订**了 `docs/explanation/cadeia-de-suprimentos-do-ci.md` 中书面声明的一项决定——*"按 tag 固定是有意的停步，不是疏忽"*——并用测量撤销了它。不触及 [ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md)，后者仍然是产品发布的四个镜像的所有者。对应维护者登记中的 `BRB-004`，P2。

## 背景 {#context}

[ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md) 让四个**自有**镜像按 digest 进行，而 `#419` 为同一家族的另一面给了仓库一个机制：`scripts/ci/actions-pinadas.ts`，它让固定在 tag 上的 `uses:` 失败。它的 docblock 阐述了论据：

> Tag é um ponteiro que o dono da action pode remover e recriar apontando para
> outro commit (…). Quem move a tag executa código no runner que tem o checkout
> e, nos workflows de release, as credenciais do GHCR e do npm.

这个论据**从未被应用到 `image:` 上**，而供应链页面说明了原因：

> Third-party images are pinned by tag, not by digest (…) so this is weaker
> than the action pins — a deliberate stop, not an oversight. It buys the
> reproducibility that matters day to day (…) without the maintenance cost of
> digests on images we don't publish.

这句话有两个前提，而测量推翻了两者。

**"我们不发布的镜像"。** 2026-09-12 测得：共有 **37** 个第三方引用，而它们运行的地方中有三处并不是"日常"。

- 十三个是 Dockerfile 的 `FROM`——`node:24.11.1-alpine3.21`、`hexpm/elixir:1.17.3-…`、`nginx:1.27.5-alpine`、`alpine:3.20`/`3.20.3`、`node:24-alpine`。它们是**我们发布的镜像的基础**：我们用 `cosign` 签名（[RN-524](../business-rules.md#rn-524)）并交付给他人的第三方字节。顺带一提，`docker/backup/Dockerfile.prod` 的 `alpine:3.20` 是 `BRB-004` 本身唯一点名的 `FROM`。
- 四个位于 `docker/docker-compose.install.yml`，它是在**安装了产品的人的机器上**启动的东西，就在此人的 Postgres 旁边（[RN-527](../business-rules.md#rn-527)）。在**同一个文件**中，四个自有镜像通过已按 digest 解析的变量到达，而第三方镜像却按 tag 到达。
- 四个位于 `.github/workflows/ci.yml` 和 `golden-set-rag.yml`，作为 job 的 `services:`。这**正是** actions 规则所要保护的 runner，只是从另一扇门进入——而这两个文件从未以这种眼光被审视过。`BRB-004` 也没有列出它们。

**"维护成本"。** 它是真实的，不会消失，但它与仓库在 actions 上早已接受的成本**相同**，后者的固定也是手工移动的。它买到的东西也一样：引用的是内容，而不是一个由别人控制的名字。

还有一个陷阱被书面记录在 `docs/reference/brb.md` 中，它解释了为什么这个条目开放了这么久：按 id 读，`BRB-004` 看起来像 PR `#401`/`#419` 关闭的 `ollama:latest` 固定问题。*"An id is not a description"*——那些 PR 把 `latest` 换成了版本号；这一条要求的是 **digest**。

## 决策 {#decision}

**1. 每个第三方镜像都按 digest 固定，tag 放在旁边的注释里**——与 actions 使用的形式相同：

```yaml
image: neo4j@sha256:22ec5cd0…  # 5.26-community
```

在 **Dockerfile** 中，注释放在**上一行**：

```dockerfile
# 3.20
FROM alpine@sha256:d9e853e8… AS runtime
```

digest 是**索引**（manifest list）的，绝不是某个平台的：固定 `linux/amd64` 的 manifest 会在没有警告的情况下破坏 `linux-arm64`。注释是**必需**的，理由与 actions 完全相同——`sha256:22ec5cd0…` 不会告诉任何人那是 Neo4j 5.26——而且它是**一个 token**，不带空格：这正是把 tag 与本仓库几乎每个 `FROM` 上方早已存在的**散文**区分开来的东西。

**在 Dockerfile 中的位置不是口味问题，而是犯错之后学到的。** 本次改动的第一个版本写成了 `FROM alpine@sha256:… # 3.20`，为了与 compose 对称。Docker 的解析器只在行**开头**识别 `#`：那不是一个带注释的 `FROM`，而是一个带三个参数的 `FROM`，构建以 `FROM requires either one or three arguments` 失败。这一发现的后一半比前一半更有价值——**`hadolint` 在五个 Dockerfile 上都通过了**。它有自己的解析器，而 linter 同意并不等于构建同意；判定失败的是 `images` job 的 `bake`，用了 27 秒。

检查以**两种**形式继承了这一教训。它识别 `FROM` 末尾的注释**只是为了能让它失败**——一个干脆不匹配错误行的模式，会让该引用从扫描中**消失**而不是变红，以沉默替换错误，而那正是这个检查存在所要避免的缺陷。出于同样的原因，YAML 的注释被整体捕获之后再评判，而不是在模式内部校验。

**2. 一个**兄弟**检查，而不是扩展。** `scripts/ci/imagens-pinadas.ts` 在 `lint` job 中、与 `actions-pinadas.ts` 并列运行，并判定三种情况失败：可变引用、没有 tag 注释的 digest，以及在不同文件中**同一 tag 有两个不同 digest**。之所以是两个脚本而不是一个，是因为它们是两个问题：`uses:` 存在于 workflow YAML 中，有一种语法；镜像存在于 compose、kustomize manifest 和 Dockerfile 中，有另外三种。一个同时回答两者的函数会把两者都答得不好——这与 `docs/.docmap.yml` 用来区分 `politica-de-branches` 和 `checks-e-rulesets` 的推理相同。

第三条存在是因为一个具体的承诺：`golden-set-rag.yml` 在注释中说它运行*"MESMA versão pinada de docker/docker-compose.yml"*，因为 golden-set 的下限按模型而不是按环境键控（[ADR 0138](0138-golden-set-do-rag-em-ci-agendado.md)）。用 tag 时那是一个承诺；用 digest 时它变得可验证。

**3. 检查**不**覆盖产品发布的镜像**，这是有意的决定，有三个独立的理由：

- **它们不是第三方的。** 本仓库之外不存在能移动任何指针的所有者。
- **这不可能。** `brabo-api:prod` 是由 `docker compose build` 产生的**本地** tag：digest 在构建之前不存在，并且每次构建都会改变。在那里写一个字面量就是要求不存在的东西。
- **它会与早已解决它们的机制冲突。** 它们经过 registry 的地方，[ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md) 早已按 digest 放置——由 `release.yml` 写入的 `.release/images.json`，通过 `make imagens-do-release` 应用。overlay 有意保存**标记**（`REPLACE_WITH_DIGEST`）而不是一个冻结的 release：仓库不声明生产运行的是 v3.2.0。要求 overlay 中有字面 digest 的检查，恰恰会让正确的状态失败。

出于同样的理由，**插值**引用（`${BRABO_API_IMAGE:?…}`）不在其列——`install.sh` 已经按 digest 把四个写入 `.env`——**多阶段构建的阶段**（`FROM deps AS build`、`FROM scratch`）也不在，它们不是 registry 镜像。

例外列表按**名字**列出，并且失败即关闭：新的第三方镜像永远不会匹配 `brabo-`，所以生来就被检查。

**4. 可观测性的 compose 包含在内**，而这在活动中是一个开放问题（`TODO(humano)`：纳入检查范围，还是因为不会在用户安装中启动而排除？）。答案是两边的代价。纳入的代价是四个 digest。排除的代价是 **`docker/` 内部的一个具名例外**，而那正是 `actions-pinadas.ts` 的 docblock 所诊断的那种漏洞形状：*"新 workflow 诞生时会照抄邻居，而邻居用的是 tag"*。目录中间一个被豁免的文件，就是那个错误的邻居。

## 后果 {#consequences}

**digest 会冻结，代价已声明。** 按 digest 固定的镜像在有人手动更换 digest 之前不会收到安全修复——与 actions 的 SHA 所背负的债务相同（`BRB-006`）。本 ADR **不**解决这一点：它声明这一点。`.github/dependabot.yml` 正是为此启用了 `github-actions` 生态；`docker` 生态在这里**不**启用，启用它是另一个决定，因为它会改变一个早已因泛滥而关闭 npm *version updates* 的 monorepo 的 PR 节奏。

**开发镜像比生产镜像冻结得更多。** `node:24-alpine` 原本有意是一个滚动 tag，而 digest 把它固定在某个特定的 24.x 上。这是本决定最不舒服的后果，出于同样的论据被接受：broker 的开发镜像在构建时运行 `pnpm install`，一个在底下变化的基础，就是在某人机器上单独出问题时多出来的一个变量。

**37 行改变了，没有一行改变了内容。** 每个 digest 都是从已写着的 tag 对照 registry 解析出来的，并且是索引的 digest——构建仍然是多架构的。仓库失去的，是在没人看见的情况下接收不同内容的能力。

**`BRB-004` 不再复现**，而正式关闭它仍然是提出者的事，在 vault 中——`docs/reference/brb.md` 早已阐明的尺子。

**本 ADR 不做什么：**

- **不扩展到签名。** digest 是所取内容的完整性；来源证明是 `BRB-005`，其开放的那一半（代理验证清单的签名）已被测量并以数字拒绝（[RN-525](../business-rules.md#rn-525)）。
- **不覆盖 `deploy/k8s/helm/otel-collector-values.yaml`**，那里 `image:` 打开一个带 `repository:` 且没有 tag 的映射：在那里选择 tag 的是 chart，固定它还需要决定 chart 的版本。已**声明**，未覆盖。
- **不创建 RN。** 这条规则是禁止按 tag 使用 `uses:` 那条规则的兄弟，而那条也没有 RN：两者都存在于 `CLAUDE.md`（发布 CI/CD 一节）和 `docs/explanation/cadeia-de-suprimentos-do-ci.md` 中，后者由 `docs/.docmap.yml` 以 `block` 监视。把其中之一放进 `docs/business-rules.md`，会给同一个策略两个地址。
