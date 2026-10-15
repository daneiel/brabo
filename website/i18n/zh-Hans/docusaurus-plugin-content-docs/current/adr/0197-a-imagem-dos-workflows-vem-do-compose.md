---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0197 — workflow 的镜像来自 compose，并启用镜像的 Dependabot

## 状态 {#status}

**已接受。** 2026-10-01（AT-246，故事 HS-024，史诗 EP-016，第 36 轮；所有者 10月1日的决定：*"把字面量从 workflow 中拿掉"*——`services:` 的 `image:` 改为来自一个读取 compose 的前置 job，digest 只有一个来源，并启用 Dependabot 的 `docker`/`docker-compose`）。建立在 [ADR 0159](0159-imagem-de-terceiro-por-digest.md)（第三方镜像按索引 digest 固定）和 [ADR 0178](0178-tag-inline-na-imagem-de-terceiro.md)（引用中带 tag）之上，不编辑它们：两者在所有方面继续有效；本 ADR 关闭了 0178 在 *"O que este ADR NÃO faz"* 中声明**未**完成的那一半。

## 背景 {#context}

ADR 0178 把 tag 放进了引用中——Dependabot 能读取的形式——并因为**一个**障碍让镜像的 Dependabot 保持关闭：`pgvector` 和 `ollama` 存在两处，一处在 compose 中，一处是 workflow `services:` 中的字面量。没有任何生态读取 workflow 的 `services:`，所以 bot 的每个在 compose 中升级其中之一的 PR，都会因 `scripts/ci/imagens-pinadas.ts` 的"同一 tag，两个 digest"规则而生来就是红的；而在 bot 的 PR 中对齐 workflow 的步骤将不得不向 `.github/workflows/` 推送提交，这是 `GITHUB_TOKEN` 做不到的，即使通过 `permissions:` 也不行。ADR 列出了四种出路；所有者选择了第二种。

改动前在 `origin/dev`（d89f77714e）上测得——`.github/workflows/` 中所有第三方 `image:`，以及每一个应当从哪里读取：

| workflow | job → 服务 | 镜像 | 读取自 |
|---|---|---|---|
| `ci.yml` | `test-api-shard` → `postgres` | `pgvector/pgvector:pg16@sha256:ccc6e83d…` | `docker/docker-compose.yml` 的 `postgres` 服务 |
| `ci.yml` | `test-engine` → `postgres` | 同上 | 同上 |
| `golden-set-rag.yml` | `golden-set-rag` → `postgres` | 同上 | 同上 |
| `golden-set-rag.yml` | `golden-set-rag` → `ollama` | `ollama/ollama:0.33.1@sha256:075246f7…` | `docker/docker-compose.yml` 的 `ollama` 服务 |
| `golden-set-qa.yml` | `golden-set-qa` → `postgres` | pgvector，同上 | `postgres` 服务 |
| `golden-set-qa.yml` | `golden-set-qa` → `ollama` | ollama，同上 | `ollama` 服务 |

六个字面量，两个镜像，全部与开发 compose 的 digest 相同。没有 job 级的 `container:`，workflow 中也没有其他 `image:`。开发 compose——而不是生产或安装的 compose——是正确的来源，理由是早已存在的两条：api 和 engine 的测试套件在开发中就是针对它运行的，而 `golden-set-rag.yml` 承诺跟随的也是它（golden-set 的下限按**模型**而不是按环境键控）。三个 compose 今天带有相同的 digest，lint 保证它们继续如此。

而 lint 有一个盲点，如果没人注意，新的形式就会打开它：`image:` 的模式是 `(\S+)`，带表达式的一行（`${{ … }}`，其中有空格）**不**匹配——它从检查中消失，而不是被评判。更糟的是：匹配到 `$` 的内容被当作插值而跳过。`image: ${{ 'postgres:16' }}` 会显示为绿色。

## 决策 {#decision}

**1. workflow 的 `services:` 从 compose 读取镜像。** 一个新的可复用 workflow `.github/workflows/imagens-do-compose.yml`（仅 `workflow_call`）运行 `scripts/ci/imagens-do-compose.ts`，后者读取 `IMAGENS_DOS_WORKFLOWS` 中列出的每个服务的直接子项 `image:`，并作为 `output` 返回。调用方这样写：

```yaml
jobs:
  imagens:
    uses: ./.github/workflows/imagens-do-compose.yml
  test-engine:
    needs: imagens
    if: ${{ !cancelled() }}
    services:
      postgres:
        image: ${{ needs.imagens.outputs.pgvector }}
```

脚本**拒绝**不存在或没有 `image:` 的服务（在 compose 中重命名会立即让 CI 失败，而不是交出空字符串），也拒绝不符合 `imagem:tag@sha256:<índice>` 形式的引用——这是第二道门，因为读取的 job 不能依赖 `lint` 已经先运行。不需要 `pnpm install`：脚本只使用 `node:fs`，以稀疏 checkout 取 `docker/` 和 `scripts/ci/`。

做成可复用的，而不是在每个文件中复制一个 job：有三个调用方，同一套 checkout + setup 复制三份，就是本 ADR 要移除的那种重复，只是高了一层。

**2. lint 理解新形式，并关上它所打开的门。** 在 `.github/workflows/` 的文件中，`imagens-pinadas.ts` 开始用一个接受空格的模式读取 `image:` 和简写形式 `container: <imagem>`，并判定以下情况失败：

- **`literal no workflow`** — 任何第三方的字面量引用，**即使**用 digest 固定：那正是没有任何生态会读取的重复；
- **`expressão de imagem fora da forma`** — 一切不**完全**是 `${{ needs.<job>.outputs.<imagem> }}` 的东西：表达式内部的字面量、带默认值的 `||`（在输出之前或之后）、`env.`、`vars.`、`format()`、`}}` 之后的后缀、没有闭合的表达式；
- **`imagem do workflow fora do compose`** — `needs.<job>` 中的 job 没有调用 `./.github/workflows/imagens-do-compose.yml`，或者它没有声明的 output。

产品自身的镜像（`brabo-*`）仍然不在其列，与其他目录树一样。每条规则都在 `imagens-pinadas.spec.ts` 中由**变异**证明：关掉字面量检查、放宽表达式的形式、不核对 job、不核对 output、忽略 `}}` 之后的内容或者把模式改回 `\S+`——每一种变异都至少让一个测试失败（测得：4、1、2、1、1 和 12）。而 `imagens-do-compose.spec.ts` 把可复用 workflow 与表格绑定：声明的输出**恰好**是 `IMAGENS_DOS_WORKFLOWS` 的键，每一个都连到运行脚本的那一步——中间夹一个带字面量的 output 就会失败。

**3. 启用镜像的 Dependabot**，在 `.github/dependabot.yml` 中，与其他的一样使用 `target-branch: dev`：

- `/docker` 中的 `docker-compose`——五个 compose 都在那里，所以一次升级会在**同一个** PR 中更新开发、生产和安装；
- `/docker/*`（`FROM`，每个镜像一个目录）和 `/deploy/k8s/**`（manifests）中的 `docker`。**绝不**写不带 `/*` 的 `/docker`：`docker` 生态也读取带 `image:` 的 YAML（它就是这样覆盖 Kubernetes 的——dependabot-core 的 `shared_file_fetcher.rb` 中的 `YAML_REGEXP`，于 10月1日阅读），它会读取 compose，为同一个镜像打开第二个 PR；
- 每个生态**一个**组（`patterns: ['*']`）：`node:24-alpine` 存在于三个开发 Dockerfile 中，`node:24.21.0-alpine3.23` 存在于三个生产 Dockerfile 中，各在一个目录里，没有分组就会是三个相同 tag、不同 digest 的 PR——按规则是红的；
- 对 `brabo-*`（以及 `ghcr.io/*/brabo-*`）使用 `ignore`：本仓库自己构建的镜像没有可供查找的第三方 registry。

**4. `golden-set-rag.yml` 的承诺变成了构造。** 它在注释中说运行"a MESMA versão pinada de docker/docker-compose.yml"。自 ADR 0159 起，lint 通过"同一 tag，两个 digest"规则**核实**这一点；现在没有什么需要核实的，因为不存在第二份副本：golden-set 的 Ollama 在构造上就是开发 compose 中 `ollama` 服务的引用。`golden-set-qa.yml` 以及 `ci.yml` 测试套件的 Postgres 同样如此。

## 后果 {#consequences}

**bot 的 PR 只触碰 compose，而该 PR 的 CI 已经针对新镜像运行**——`services:` 读取的是 PR 自身的 compose。没有对齐步骤，没有带 `workflows` 权限的凭据，也没有不经检查的 `GITHUB_TOKEN` 推送。

**两个必需的 job 多了一个依赖，并且不能变成 `skipped`。** `Testes do engine (ExUnit)`（必需检查）和 api 的分片等待 `imagens` job。GitHub 的默认行为会在 `imagens` 失败时**跳过**该 job，而 `skipped` 对必需检查算作绿色——与 api 聚合 job 已经通过 `if: always()` 避开的陷阱相同。因此这两个 job 带上 `if: ${{ !cancelled() }}`：`imagens` 为红时，job 照样运行，收到空镜像并失败。新 job（`imagens / Ler as imagens do compose`）**不**进入 ruleset。时间成本：尚未测量——它是一次稀疏 checkout 加一个不带缓存的 `setup-node`，与 `lint` 并行运行；首次运行时 `TODO(humano)`。

**新的 workflow 服务只有一条路径**：镜像放在 compose 中，在 `IMAGENS_DOS_WORKFLOWS` 中加一行，在可复用 workflow 中加 output（不一致时 spec 判定失败），在 workflow 中写 `needs: imagens`。runbook（*Bumping a third-party image*）说明了这一点。

**lint 的计数从 39 降到 33** 个字面量引用：workflow 中的六个不复存在，而 `contagens-do-codigo.mjs` 核对的 `cadeia-de-suprimentos-do-ci.md` 中的那句话随之更新。

## 本 ADR 不做什么 {#o-que-este-adr-não-faz}

**不解决生态**之间**的重复。** `neo4j:5.26-community` 和 `ollama/ollama:0.33.1` 也存在于 `deploy/k8s/base/`（`neo4j/statefulset.yaml`、`ollama/job-model-loader.yaml`），它属于 `docker` 生态，而 compose 属于 `docker-compose`——Dependabot 不跨生态分组。两个后果，在此声明：

- 当 bot 升级 **TAG** 时（常见情况），会出现两个绿色 PR，各在一处；在两者都合入之前，compose 和集群运行不同版本——而 lint 不会因为 tag 不同而失败，只会因为同一 tag 不同 digest 而失败；
- 当 registry 以另一个 digest **重新发布**同一个 tag 时（`5.26-community` 是会移动的 tag），两个 PR 都会因"同一 tag，两个 digest"规则生来就是红的，审查者把两次升级合并成一个 PR（runbook 中的流程）。如果有一天 `node:24-alpine` 同时存在于某个 compose **和**某个 Dockerfile 中，它被重新发布的 digest 也是同样的命运。

这里没有解决，因为每一种出路都是产品决策，而不是本 ADR 的：从 compose 派生 manifest（kustomize 的转换器仍然保留字面量）、把 compose 从 `docker-compose` 拿出来交给 `docker`（它也读 YAML，但未针对 compose 测量），或者放宽跨目录树的规则（这条规则所保护的——开发和集群在同一 tag 下运行相同的字节——是真实的）。

**不测量 Dependabot 的实际运行。** 镜像 bot 的 PR 还一个都没有。未经执行测量的：`docker-compose` 接受五个文件名（`docker-compose.<sufixo>.yml`）并忽略插值引用（`${BRABO_API_IMAGE:?…}`）；按 `directories` 分组跨目录产生**一个** PR。bot 的第一个 PR 就是证明，它所反驳的内容会以一个新 ADR 回到这里。

**不把 `dependabot-justifica-pin.ts` 扩展到镜像固定。** bot 的 PR 触及 `docker/**`，而 drift（`config-e-inferencia`，`block`）会向人请求 `docs-not-needed:`——AT-094 的决定把 bot 写入的那一行限制在 **action** 固定的替换上，ADR 0178 已经声明了这一点。

**不覆盖本来就在外面的东西。** 无论有没有 Dependabot，以下内容都留在 runbook 的**手动**流程中：CloudNativePG 的 `imageName`（没有任何生态读取的键）和 `IMAGEM_DO_GOLDEN_SET_QA`（由 `golden-set-qa.yml` 通过 `sed` 读取的 TypeScript 常量）。产品的镜像、插值引用以及多阶段构建的阶段仍然不在 lint 范围内（ADR 0159）。

**不创建 RN。** 镜像规则没有 RN，原因与 action 相同：它存在于 `CLAUDE.md` 和 `docs/explanation/cadeia-de-suprimentos-do-ci.md` 中。
