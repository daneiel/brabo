---
traducao_de: 1eb71c3229b3ec8770369028759fe2f4281495a4
---

# ADR 0138 — RAG 的 golden-set 开始在 CI 中定时运行——并且仍然是 `warn`

## Context {#context}

[ADR 0132](0132-golden-set-de-acerto-do-rag.md)（可测量 RAG 计划的第 2 阶段）以一项声明的后果收尾：

> **CI wiring é `TODO(humano)`, igual ao QA.** Sem segredo de LLM de API ou
> infra nova (Ollama de verdade em CI), o golden-set roda MANUAL —
> `mix golden_set.rag` — e nunca em `mix test` normal.

gate `rag-acertivo`（`docs/gates.yml`）以 `severidade: warn` 诞生，注释准确说明了原因：“没有带 LLM 的 CI……`block` 会承诺一个不存在的自动锁定”。

这是第 3 阶段，由产品负责人在本次会话中决定：**在 CI 中接上 RAG 的 golden-set**。仍然开放的问题——每个 PR 还是定时——也在本次会话中决定了：**定时**，考虑到在每个 CI 窗口中拉取 `nomic-embed-text`（约 274MB）并针对精选语料运行真实搜索（几分钟）的成本。QA 的 golden-set
（[ADR 0123](0123-golden-set-regressao-qa-automacao.md)）在这里**没有任何改变**——它继续完全是 `TODO(humano)`，原因由下一节说清楚。

### 为什么 RAG 的可以处理而 QA 的仍然不行 {#por-que-o-do-rag-é-tratável-e-o-do-qa-continua-não-sendo}

ADR 0123 的 `TODO(humano)` 列出了缺失的备选方案：“一个带 GPU 的 runner，一个拉取 Ollama 的步骤”。这句话掩盖了一个重要差别：QA 的 golden-set 调用**聊天**模型做**判断**——昂贵，测量的是本质上非确定性的东西（ADR 0123 本身记录了使用 `qwen2.5-coder:latest` 的真实轮次在不同执行之间 6 次中命中 1 到 5 次不等）。RAG 的 golden-set 只调用 **embedding** 模型（`nomic-embed-text`，约 1.37 亿参数）——CPU 就够，不需要 GPU，而且 embedding 不采样：同样的输入总是产生同样的向量。没有任何 GPU 的 `ubuntu-latest` 对这个 golden-set 是足够的基础设施——对 QA 的则不够。

### 不存在的障碍：不需要生成任何秘密 {#o-obstáculo-que-não-existia-nenhum-segredo-precisa-ser-gerado}

`apps/api/scripts/seed-golden-set-rag.ts` 打开自己的
`NestFactory.createApplicationContext(AppModule)`——从不与作为服务器运行的 api 通信。api 在生产中会拒绝示例字面值的四个秘密（`AUTH_JWT_SECRET`、`BRABO_SERVICE_TOKEN`、
`CREDENTIALS_MASTER_KEY`、`GIT_OAUTH_STATE_SECRET`——RN-114、
[ADR 0059](0059-segredo-do-state-de-oauth-sem-default.md)）只有在 `NODE_ENV === 'production'` 时才会被检查
（`apps/api/src/infrastructure/security/{oauth-state-secret,auth-key-material,service-token}.ts`、
`envelope-encryption.service.ts`）。脚本从不定义 `NODE_ENV`——它自己不定义，通过 `System.cmd` 调用它的 `mix golden_set.rag` 也不定义——因此四个秘密都落入开发分支，毫无怨言地使用开发字面值。与 `docker/smoke.sh` 不同，后者**刻意**以 `NODE_ENV=production` 启动 `docker-compose.prod.yml`，因此需要用 `openssl rand` 生成这四个——这个 workflow 不需要生成任何秘密。

## Decision {#decision}

**新 workflow，与 `ci.yml` 分开。** `.github/workflows/ci.yml` 刻意只有 `pull_request`（文件顶部自己的注释）：在那里混入 `schedule` 会影响每个现有 job，无法按 job 过滤。`.github/workflows/golden-set-rag.yml` 以 `schedule`（每日 cron）+ `workflow_dispatch`（按需运行——用于验证这次改动本身，以及在校准搜索权重/阈值（ADR 0080）或精选语料之后）诞生。

**`services: postgres` + `services: ollama`，与产品其余部分相同的固定版本。** `pgvector/pgvector:pg16`（与 `ci.yml` 的 `test-engine` 相同）和 `ollama/ollama:0.33.1`——与 `docker/docker-compose.yml` **相同**的固定版本。Ollama 版本的一致性正是让 `test/fixtures/golden_set_rag/floor.json`（按**模型**而不是按环境作键）在 CI 中运行时继续有效的原因：一个不同于生成本地下限的 Ollama 可能产生细微不同的 embedding，并改变临界用例的排名，而那并不是真正的回归。

**Ollama 的健康检查使用 `ollama list`，而不是 `curl`。** `--health-cmd` 在服务容器**内部**运行，而官方镜像不保证有 `curl`——只保证有 `ollama` 二进制本身。`docker/ollama/pull-models.sh`（参考逻辑，已用真实模型下载验证）正是使用这种等待模式（`until ollama list >/dev/null 2>&1`）；这个 workflow 把同一命令复用为 health-cmd，而不是发明新的等待机制。

**模型通过直接的 HTTP 调用 `POST /api/pull` 拉取，在 **RUNNER** 一侧（而不是在容器内部）。** `ubuntu-latest` runner 上的 `curl` 是有保证的（在 `ci.yml` 的多个步骤中已用于下载 gate 二进制）。`stream:false` 让调用阻塞直到完成并返回最终 JSON——没有轮询循环。这与 `ollama pull` 二进制底层调用的是**同一个**端点（`docker/ollama/pull-models.sh` 记录了这一点：“a CLI `ollama` usa HTTP contra `${OLLAMA_HOST}/api/*`”），只是不经过 runner 上没有安装的 CLI 包装。

**seed 之前显式迁移。** `main.ts`/`app.module.ts` 在启动时不会自行迁移任何东西——通过阅读 `apps/api/src/db/migrate.ts`（单独的脚本）确认。job 在 `mix golden_set.rag` 之前运行 `pnpm --filter api db:migrate`。

**`docs/gates.yml`：`rag-acertivo` 仍然是 `severidade: warn`。** 刻意的，而不是遗忘——见 Consequences。`evidencia.tipo` 从 `teste` 改为 `ci`（与 `backmerge` gate 相同的格式），`workflow` 指向新文件。

## Consequences {#consequences}

**`warn` 仍然是 `warn`——出于节奏的决定，而不是技术限制，这一差别正是本 ADR 相对于 0132 所改变的。** gate 现在真正在 CI 中运行；不存在的是被它阻塞的 PR。搜索命中率的回归会在合并后最多 24h 出现（或通过手动 `workflow_dispatch` 立即出现），绝不会在 PR 时出现——这是产品负责人明确接受的权衡，考虑到每次执行约 3-6 分钟（拉取模型 + 索引 + 17 次搜索）在每个 PR 上运行的成本。

**QA 的 golden-set（ADR 0123）在这里没有任何改变。** 它继续完全手动，`TODO(humano)`——这种不对称（CPU 上确定性的 embedding vs. 昂贵且非确定性的聊天判断）是刻意的并已在上文解释，不是之后要修正的不一致。

**精选语料的缺口仍然开放。** 17 个问题继续在 ADR 0132 的同样 22 个精选文件上测量检索，而不是 130 多个真实 ADR——这一阶段在 CI 中接上的是**机制**，而不是扩大它所测量的东西。扩大语料仍然是一次手动轮次中关于 embedding 成本的决定，另行声明。

**新风险，以及它所在之处。** 业务逻辑（seed 脚本、命中标准、ExUnit 测试）早已被证明——17/17，两次，据 ADR 0132。这里真正新的是 workflow 的**编排**（两个服务、步骤顺序、通过直接 HTTP 拉取模型），在真实的 GitHub Actions 之外无法端到端测试。建议用户：本 PR 合并后立即手动触发一次 `workflow_dispatch`，在等待第一个定时窗口之前确认 job 为绿色。
