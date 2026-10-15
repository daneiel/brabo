---
traducao_de: cc6cd4e5f762017286b36c6232f5d75f5a0739e3
---

# ADR 0178 — 第三方镜像的 tag 住在引用**之内**，位于 digest 之前

## 状态 {#status}

**Accepted.** 2026-09-29（AT-139，故事 HS-024，史诗 EP-016）。基于
[ADR 0159](0159-imagem-de-terceiro-por-digest.md)，后者在除引用**形式**之外的一切方面继续有效：索引的 digest、三棵树、检查不覆盖什么以及原因。维护者 2026-09-27 的决定，写在 AT-139 的说明中，那里把它称为“ADR 0171”——这个编号被保留且从未写出；**本 ADR 就是那一份**，0171 仍然空着。

该决定有两半。本 ADR 记录被采纳的那一半——形式和 lint——并声明为什么另一半，即为镜像开启 Dependabot，**没有**被采纳（见*本 ADR 不做的*）。

## Context {#context}

ADR 0159 把 39 个第三方镜像引用按 digest 固定，tag 放在旁边的注释中（`neo4j@sha256:…  # 5.26-community`；在 Dockerfile 中放在上一行），镜像 action 的形式（`uses: x@<sha>  # v4`）。并声明了代价：digest 会冻结，而*"ligar o ecossistema `docker` do Dependabot
é decisão à parte"*。

决定于 2026-09-27 做出——Dependabot `docker`——附带一个条件：先测量它的 PR 能否通过 pin 的 lint。测量（第 15 轮的 lane，在关口处停下，没有 PR）推翻了 ADR 0159 的形式：

- **Dependabot 不读取注释中的 tag，任何格式都不读。** 它的 `github-actions` 读取的注释是**那个**生态系统的约定；`docker` 没有对应物。
- **只有 digest 的固定会被更新为 `latest` 的 digest**
  （`update_checker.rb`）。pgvector、neo4j 和 node 会跳到另一个主版本，而注释仍声称旧 tag，lint 却是**绿色**的——检查核对的是注释的存在，而不是它的真实性。
- **compose × workflow 的重复**（`ci.yml`/`golden-set-*.yml` 的 `services:` 中的 pgvector 和 ollama）会让 bot 的每个 PR 都因 ADR 0159 自己的“同一 tag、两个 digest”规则而以红色诞生：没有任何生态系统读取 workflow 的 `services:`。
- CloudNativePG 的 `imageName` 同样在任何生态系统之外。

而仓库中恰好有一个引用早已采用另一种形式，出于另一个原因：CNPG 的 `imageName` 是 `postgresql:16.10@sha256:…`，因为 operator 的 webhook **拒绝**只有 digest 的引用——它从 tag 中读取 Postgres 的版本。也就是说，`imagem:tag@sha256:` 这一形式已经在仓库中由 Kubernetes、`kubeconform` 和 k3d 的 bootstrap 证明过了。

## Decision {#decision}

**1. 第三方镜像的引用改为 `imagem:tag@sha256:<índice>`。**

```yaml
image: neo4j:5.26-community@sha256:22ec5cd0…
```

```dockerfile
FROM node:24.11.1-alpine3.21@sha256:b8f7c905… AS deps
```

两者同时存在时，Docker 按 digest 拉取：tag 是给读者的信息，digest 决定字节——ADR 0159 的不可变性保持不变。改变的是，tag 现在被执行者（Docker）、更新者（Dependabot）和审阅者用**同一种**语法读取。digest 仍然是**索引**的，绝不是某个平台的。

三棵树中的 39 个引用在不更换任何 digest 的情况下完成迁移——`docker/` 中 29 个（compose 中 16 个，13 个 `FROM`）、`deploy/k8s/` 中 4 个、
`.github/workflows/` 中 6 个。tag 注释被移除：引用就是来源，一模一样的注释会是又一份会过时的副本。

**2. lint 从引用中推导 tag，并拒绝与之矛盾的东西。**
`scripts/ci/imagens-pinadas.ts` 除了可变引用之外，还会拒绝：

- **没有内联 tag 的 digest**——包括 ADR 0159 那种 tag 只在注释中的形式，因为 bot 会把它更新到 `latest`；
- **声称另一个 tag 的注释**——一个由**单个**带数字的 token 构成的注释（`# 5.26-community`、`# pg16`）且与内联 tag 不同。注释仍然被允许（决定说“注释删掉或保持一致”）；被拒绝的是版本升级后的残留。散文和不带数字的单词不声称版本，不予评判；
- **`FROM` 行末尾的注释**——继续被拒绝，现在有专属原因：Docker 的解析器不接受它（ADR 0159）；
- **同一 tag 两个 digest**——键改为从引用中读出的 `nome:tag`。

每条规则都在 `imagens-pinadas.spec.ts` 中经变异证明：关掉五条中的任何一条都会让至少一个测试失败。

## Consequences {#consequences}

**ADR 0159 的形式开始被拒绝。** 复制旧示例（来自 ADR 0159、来自旧 PR）的人会收到让他把 tag 内联的消息，并附上原因。runbook（*Bumping a third-party image*）、供应链页面和 `CLAUDE.md` 改为只展示新形式。

**注释不再是必需的**，这是对 ADR 0159 论据的反转，而不是放松：在那里它是必需的，因为它是 tag 的**唯一**位置；在这里 tag 在引用中，检查要求的是它存在、且旁边没有任何东西与之矛盾。

**没有任何版本变化。** 每个 digest 都与之前相同；`docker build --check` 在九个 Dockerfile 上通过，一次真实构建（`docker/backup/Dockerfile.prod`）完成，`docker compose config` 在被触及的 compose 上通过，`kubectl kustomize` + `kubeconform` 在各 overlay 上通过。

## 本 ADR 不做的 {#o-que-este-adr-não-faz}

**不为镜像开启 Dependabot**，原因是一个 9月27日的决定没有覆盖的阻塞。该决定要求*"um passo que alinha os `services:` dos
workflows no PR do bot"*，按 `dependabot-justifica-pin.ts` 的模子。这一步必须向 bot 的分支**推送**一个修改 `.github/workflows/*.yml` 的提交，而 `GITHUB_TOKEN` 做不到：它没有、也无法通过 `permissions:` 获得 `workflows` 权限，GitHub 会拒绝这次 push
（*"refusing to allow a GitHub App to create or update workflow … without
`workflows` permission"*）。由 GitHub 社区记录，这里没有通过执行测量。还有第二个代价，仓库中早已知晓：`GITHUB_TOKEN` 做的 push 不会触发 workflow，因此对齐提交在有人重新触发之前将没有检查。

在没有这一步的情况下开启 `docker`/`docker-compose`，会让 bot 每个触及 pgvector 或 ollama 的 PR 以红色诞生。存在的路径——属于维护者而不是本 ADR 的决定——在 AT-139 的报告中：只为这一步准备一个带 `workflows` 的凭据（GitHub App 或令牌）；把字面量从 workflow 中移除（`services:` 的 `image:` 接受 `needs` 上下文，之前的一个 job 可以从 compose 中读取它——不存在的重复不会产生分歧）；让这一步只做**诊断**，由人来应用；或者让 bot `ignore` 这两个重复的镜像。在那之前，升级 digest 遵循 runbook 的流程。

**不把 `dependabot-justifica-pin.ts` 扩展到镜像 pin。** bot 触及 `docker/**` 的 PR 会撞上漂移检查（`config-e-inferencia`，`block`），而 AT-094 的决定把 bot 写入的那一行限制为 **action** 的 pin 替换。扩大这一类别是另外的决定。

**不覆盖原本就在范围外的东西**：产品自己的镜像、插值引用、多阶段的 stage 以及 Helm 的 `otel-collector-values.yaml`（ADR 0159）。并且，无论有没有 Dependabot，住在三棵树之外或位于任何生态系统都不读取的键中的两个镜像，仍然走**手动**流程：CNPG 的 `imageName` 以及 QA golden-set 用例的镜像（`IMAGEM_DO_GOLDEN_SET_QA`，一个 TypeScript 常量——已经是内联形式）。

**不创建 RN。** 这条规则是 action 规则的姊妹，像它一样住在 `CLAUDE.md` 和 `docs/explanation/cadeia-de-suprimentos-do-ci.md` 中。
