---
id: brb
title: BRB 登记表
sidebar_position: 10
description: 33 项 BRB 发现——id、标题、优先级、维护者 vault 记录的状态以及在此测得的状态，并附上证明它的 文件:行。
keywords: [brb, 安全, 发现, backlog, 供应链]
traducao_de: 67d5067daf28ece21602f1fa6bd0cd4c6677f5aa
---

# BRB 登记表

`BRB-NNN` 发现在**维护者的 vault**（`07-backlog/Backlog de Melhorias (Brabo)`）中提出
并排定优先级，那里保存全部 33 项，含优先级、工作量、来源、提案和一个"完成标准"。那份登记
是**一项发现是什么**以及**它是否已关闭**的来源。

本文件是仓库能够**验证**的那一部分。由 **FASE 29** 第 1 次会话创建
（[fase-29-instalacao-de-uma-linha.md](../explanation/fase-29-instalacao-de-uma-linha.md)）。

## 覆盖标准

**从 `BRB-001` 到 `BRB-033` 的每个 id 恰好有一行**，按数字顺序排列。直到 2026-09-27，本页
只列出代码能够证明或反驳的发现——33 项中的 11 项——其余在这里不可见，其中包括 vault 已经
测得为已修正的六项（AT-186）。每个 id 一行不花任何代价，并让证据的缺失变得可见而不是沉默。
每一行包含：

- **vault 中的状态**——于 **2026-09-27** 从 vault 的登记中复制。这是维护者的决定，从不在
  这里决定。
- **在此测得**——仓库所显示的内容，于 2026-09-27 针对 `dev` 在 `34c1c83bdc` 上测得，除非
  证据另有日期。
- **证据**——该测量背后的 `文件:行`、PR 或运行。

主题位于本仓库之外的发现（vault 自身的笔记、产品决定、付费凭据）仍然有一行，标记为
**此处不可验证**，并附原因。一个毫无信息的 id 会带一个 `TODO(humano)`——目前没有。vault 中
新的 `BRB-NNN` 在第一次提到它的同一变更中在这里获得它的行。

## 为什么有这个文件

`BRB-018` 是下面第二条规则在实践中的样子。本文件诞生时，代码中关于它的任何东西都没有改变
——没有写任何重投影——但仓库获得了说明它*为什么*仍然开放、以及*开放期间花费多少*的能力，
因此这一行先于修正存在。该命令现在存在（RN-569）；这一行保留，是因为集群中的证明不存在。

有两个 id——`BRB-005` 和 `BRB-031`——在这里的五份文档中以散文形式被引用，却没有任何人能核对
的状态。其他 id 对本仓库完全不可见：在整个磁盘上搜索**只返回这两个**。

代价是测量出来的，不是想象出来的。FASE 29 的规划把六个 BRB 项列为前提或风险；逐一针对 `dev`
核对显示，**其中两个描述的缺陷在这里早已修正**，而第三个*仅凭 id 就被误读了*——见下面的
`BRB-004`，它讲的并不是大家以为的那个标签。

由此有两条规则：

- **状态以 `文件:行` 为依据，测量得出，绝不凭记忆。**
- **vault 拥有发现；仓库拥有证据。** 当两者在某件事是否仍在发生上意见不一时，仓库胜出——它就
  是被描述的那个东西。一项是否正式*关闭*仍然是维护者在 vault 中的决定。

## 登记表

| id | 标题（来自 vault） | 优先级 | vault 中的状态 | 在此测得 | 证据 |
|---|---|---|---|---|---|
| **BRB-001** | 为通过**移除**项目成员关系进行的自我降级设置上限 | **P1** | 已关闭 2026-09-12（PR #531） | **缺陷不再复现** | `RemoveProjectMemberUseCase.execute` 接收 `(projectId, userId)`——**没有执行者**——而 controller 用路由的两个参数调用它，因此一个权限来自项目行（在工作区中为 `viewer`）的 `maintainer` 可以移除自己的行并不可逆地降为 `viewer`；该情况被固定在一个测试中，其名称本身就说明它是开放的。[ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md) 曾以书面形式声明这一缺口，并估算了成本。由 [ADR 0156](../adr/0156-teto-de-auto-rebaixamento-na-remocao.md) / [RN-556](../business-rules.md#rn-556) 关闭：执行者现在到达用例，`remocaoEhAutoRebaixamento` 以工作区角色作为请求的角色**委托**给现有的上限 2 规则，缺口的测试被**反转**而不是删除。工作区 `owner` 的上限有意不配对——移除只可能提升 owner |
| **BRB-002** | 为工作区成员 upsert 中的自我变动设置上限 | P2 | 已关闭 2026-09-12（PR #533） | **缺陷不再复现** | `AddWorkspaceMemberUseCase.execute` 接收 `(workspaceId, userId, role)` 并调用 `workspaces.addMember`——**没有执行者**——而 controller（`@Post(':workspaceId/members')`、`@RequireRole('owner')`）在没有 `@CurrentUser()` 的情况下传递原始正文。一个 `owner` 可以把自己写成 `viewer` 并失去整个工作区：上面没有任何东西能接住这次下跌，而 `WorkspacesController` **没有成员的 `@Delete`**（已测量），因此撤销只能走同一路由，而它要求刚刚放弃的 `owner`。[ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md) 以书面形式点名了它（*"同一类缺陷，高一个作用域"*），[ADR 0156](../adr/0156-teto-de-auto-rebaixamento-na-remocao.md) 将其留作单独的决定。由 [ADR 0157](../adr/0157-teto-de-auto-movimento-no-upsert-de-workspace.md) / [RN-557](../business-rules.md#rn-557) 关闭：执行者到达用例，改变自己的角色在**两个**方向上都是 403。上限**不**统计 owner 数量（该条款已保证工作区永远不会降到零，因为移除最后一个 owner 需要该 owner 本人），上限 1 在这里也不配对——`@RequireRole('owner')` 已禁止它要防止的层级倒置，加上它会让 `owner` 成为一个无法通过 HTTP 离开的吸收态。同一 ADR 在两条成员关系路由上关闭了**自我提升**，修订了 ADR 0127 的"后果"：这是该变动中唯一提升权限的那一半 |
| **BRB-003** | 修正三处承诺"两者中较高者"的 OpenAPI 描述（RN-471） | P2 | 已关闭 2026-09-27（AT-136） | **缺陷不再复现** | `grep -rn "higher of the two" apps/api/src` 为空。`apps/api/src/interfaces/http/iam/dto/add-member.dto.ts:29` 和 `projects.controller.ts:190,239` 说项目角色在*两个方向上*都*覆盖*工作区角色——该文本随 [ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md) / [RN-472](../business-rules.md#rn-472)（PR #445）到来。首次测量于 2026-09-11（AT-017） |
| **BRB-004** | 将第三方镜像（`neo4j`、`pgvector`、`ollama`）**按 digest** 固定 | P2 | 开放 | **缺陷不再复现** | 原来：每个第三方镜像都按**标签**固定，而不是按 digest。按标签固定关闭的是一个*不同的*缺口（PR #401/#419），而这一行读起来就像那就是修正——这正是下面 id 与描述之间的区别值得其代价的原因。由 [ADR 0159](../adr/0159-imagem-de-terceiro-por-digest.md) 关闭：**37** 处第三方引用按索引 digest 引用，标签放在末尾的注释中，`scripts/ci/imagens-pinadas.ts` 会在可变引用、没有标签注释的 digest、以及同一标签对应两个不同 digest 时让 `lint` job 失败。数量是 37 而不是该发现自己的列表，因为有三整处不在其中：Dockerfile 的 `FROM` 行（我们发布并签名的四个镜像的基础）以及 `ci.yml`/`golden-set-rag.yml` 中 `services:` 的镜像——姊妹规则已保护的 CI runner，从另一扇门触达。产品发布的五个镜像**有意不被覆盖**（写这一行时是四个；第五个 broker 随 ADR 0162 到来）：没有第三方能移动它们，`brabo-api:prod` 是一个在构建前其 digest 不存在的本地标签，而在它们跨越 registry 的地方 [ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md) 已经解析了它们——overlay 有意保存一个标记，因此那里的字面量会让正确的状态失败。已声明但未修正，因为这是固定的代价：digest 在有人手动升级之前不会收到安全更新，而 Dependabot 的 `docker` 生态保持关闭——单独的决定。同样未覆盖并已说明：`otel-collector-values.yaml`，其中 `image:` 打开一个由 Helm chart 选择标签的映射 |
| **BRB-005** | 为 GHCR 镜像和 runner 二进制签名 | P2 | 开放 | **已实现，尚未实践** | 原来：任何地方都没有 `cosign`/`sigstore`/`attestation`，`release.yml` 没有 `id-token: write`，没有 `checksums.txt`。现在：`release.yml` **按 digest** 为五个镜像签名（编写时是四个；ADR 0162 加入了 broker）并在同一运行中验证它们；`build-runner-binaries.yml` 新增一个 `checksums` job，为五个目标发布**一个**签名清单（[ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md)、[RN-524](../business-rules.md#rn-524)）；验证步骤见 [runbook](../runbook.md#verificar-artefato-publicado)。**未实践**：签名只在真正的最终标签上运行，因此这里还没有任何东西端到端地证明它。仍未覆盖，且是单独一项：二进制的操作系统代码签名（公证/Authenticode）。第 3 次会话让下载代理 `GET /runner-releases/binary` 进行验证——但**只验证 sha256 与 release 的 `checksums.txt`**，从不验证清单的签名（[RN-525](../business-rules.md#rn-525)）：那是完整性，不是来源，能改写 Release 的人能改写这两个文件。api 核对签名的两种方式都**经过测量并被拒绝**：镜像中的 `cosign` 是 155 MB（几乎使 Alpine+Node 运行时镜像翻倍），`@sigstore/verify`+`@sigstore/tuf` 很便宜（2.5 MB），但会让一条 `@Public()` 路由依赖*第二个*第三方主机（`tuf-repo-cdn.sigstore.dev`）来验证一个还没有任何 Release 携带的东西——不太可能，而且 ADR 0041/0042 禁止声明未经证明的能力。签名的消费者是 `install.sh`（第 4/7 次会话），它有一个真正固定的 `cosign`。**因此代理的来源那一半仍然开放**，而拒绝在那里已经有了名字：没有 `checksums.txt` 的 Release 会被拒绝，而不是带警告提供 |
| **BRB-006** | 自动更新固定的 SHA（Dependabot/Renovate） | P3 | 开放 | **缺陷不再复现** | `.github/dependabot.yml:35` 声明了 `github-actions` 生态（以及 `npm`，`:55`/`:61`），全部带 `target-branch: dev`；`.github/workflows/dependabot-para-dev.yml` 把安全更新转到 `dev`，`scripts/ci/dependabot-justifica-pin.ts`（AT-094）在仅固定版本的 bump 上写入 `docs-not-needed:` 行。**此处未测量：**"完成标准"要求一个真实的 bump PR 在没有手动步骤的情况下通过 `actions-pinadas.ts`——这一行没有列出任何 PR |
| **BRB-007** | 在 CI 中运行 Automation-QA 的 golden-set | P2 | 已交付 2026-09-27（PR #687、#689），未标记为关闭 | **缺陷不再复现** | `.github/workflows/golden-set-qa.yml:39` 每周运行它（`cron: '17 1 * * 6'`）外加 `workflow_dispatch`，从不在 `pull_request` 上运行（[ADR 0168](../adr/0168-golden-set-do-qa-em-ci-semanal.md)）。该工具在 [RN-502](../business-rules.md#rn-502) 下重新进行测量：seed 通过 `container_start` 启动容器（AT-076），验证运行得分 3/6，下限为 1/6。`apps/engine/test/fixtures/golden_set_qa/floor.json` 中的下限仍是 2026-08-30 的——只有人类会写它 |
| **BRB-008** | 更换（或说明理由）golden-set seed 的默认模型 | P2 | 开放 | **仍然复现** | `apps/api/scripts/seed-golden-set-qa.ts:119` 默认仍使用 `qwen2.5-coder:latest`，其在 `apps/engine/test/fixtures/golden_set_qa/floor.json` 中的下限为 1/6（对比 `gpt-oss:20b` 的 4/6）。没有记录任何决定 |
| **BRB-009** | 调度三项属性证明（`test-restore`、`rollout-test`、`hpa-test`） | P2 | 开放 | **开放**——现已调度；restore 的变异能被捕获，最后一次成功运行是 workflow artifact 而尚不是指标 | 原来：三个目标（`Makefile:41-48`）只在有人输入 `make` 时运行，没有 workflow 启动集群（`grep -rn "k3d\|kind" .github/workflows/` 为空）。现在 `.github/workflows/propriedades.yml` 每周及 `workflow_dispatch` 时运行：按固定校验和安装 k3d/helm/kubectl，运行人类运行的同一个 `deploy/k8s/bootstrap.sh`，然后是 `make smoke-k8s`、`make hpa-test`、`make rollout-test` 和 `make test-restore`，每个都在运行摘要中计时；失败的目标会打开一个带其名称的 issue，重复失败则在已打开的 issue 上评论而不是再开一个。它不是 gate 也不是必需检查。**第一次**运行就已经回本：bootstrap 在创建 CNPG 集群时死掉，因为 [ADR 0159](../adr/0159-imagem-de-terceiro-por-digest.md) 写的只有 digest 的 `imageName` 被 operator 的 webhook 拒绝——`kubeconform` 不运行 webhook，所以 manifests job 一直是绿的。又发现了九个，全部在同一变更中修正（列在 runbook 中），其中一个在本地集群之外：`brabo-restore` 在任何应用角色不是超级用户的 Postgres 上死于 `COMMENT ON EXTENSION vector`。第一次全绿的运行是 `34784563928`（2026-09-13，12 分 56 秒），第二次尝试再次为绿。rollout 证明在到达它的四次运行中的一次里指出了一个孤立会话，这一点**已声明，未修正**。AT-126 关闭了剩余两个条款中的第一个：`make test-restore-mutacao` 故意破坏 restore（源中有一个 dump 没有的表），如果 restore 没有点名该表拒绝它，计划运行就会失败并打开自己的 issue；一次故意让 restore 失明的运行在该步骤失败。**仍然开放**，且不是本仓库能通过 CI 关闭的：最后一次成功运行现在由 workflow 标注日期（artifact `restore-ultima-execucao-boa`，只在 restore 和故意破坏都通过时写入），但**不是**与备份告警并列的指标，也不是 `backupRuns` 的一行——那需要 `apps/api` 中的代码。测得的时长和节奏：[runbook，计划的属性证明](../runbook.md#provas-de-propriedade-agendadas) |
| **BRB-010** | 用脚本和测试实践 `CREDENTIALS_MASTER_KEY` 的轮换 | P2 | 已关闭 2026-09-27（AT-136） | **缺陷不再复现** | 由 PR #551、[ADR 0158](../adr/0158-o-id-da-chave-mestra-gravado-no-envelope.md) / [RN-562](../business-rules.md#rn-562) 关闭：`apps/api/src/scripts/rewrap-deks.ts` 导出核心（`reenvelopar`），`apps/api/test/scripts/rewrap-deks.spec.ts` 是具名验证，针对真实的 Postgres 和两张信封表；runbook 运行它（`docs/runbook.md:2770`）。命令名与该发现的提案（`credenciais:reenvelopar`）不同；"完成标准"——一个具名验证——已满足。自 AT-146 起轮换还有一次**集群演练**：它从未在真实环境中运行过（维护者，2026-09-27），而 `make test-rotacao-chave-mestra-k8s` 每周在 `propriedades.yml` 中运行 runbook 的三个步骤——使用 `ExternalSecret`、重启 api 以及镜像中的 `rewrap-deks.js`（第一次绿色运行 `36502355798`） |
| **BRB-011** | 覆盖告警的单点故障（Grafana 无 Alertmanager） | P2 | 开放 | **仍然复现** | `deploy/k8s/observability/alerts/brabo-alerts.yaml:8` 仍说没有 Alertmanager 也没有 receiver；`deploy/k8s` 中没有任何东西在 Grafana 本身停止评估时发出警告（由 AT-121 测得，2026-09-19） |
| **BRB-012** | 用真实凭据证明从未实践过的 LLM provider | P3 | 开放 | **此处不可验证** | 运行需要本仓库没有的付费密钥。仓库记录的内容：`docs/explanation/aceite-providers.md:108-115` 中的聊天表（2026-08-07 的状态）显示 OpenRouter 真实运行过，而 Together、DeepInfra、NVIDIA NIM、Bitdeer 和 Vultr 因缺少 `*_TEST_KEY` 而 `skipped`；其上方的 embeddings 表（`:83-93`）只证明了 Ollama |
| **BRB-013** | 清理 `rc` 台阶的残留（enum 和受保护分支列表） | P3 | 开放 | **部分复现——仓库那一半是决定** | `apps/api/src/domain/actions/protected-branches.ts:12` 保留 `rc`，`apps/api/src/db/schema/git.ts:24` 保留 `create_rc_branch`——**有意为之**：该列表决定 merge 上限拒绝什么，而由旧版本 bootstrap 的仓库仍有该分支（CLAUDE.md，约定）。另一半——两条仍把 `rc` 列为受保护的 vault 笔记——位于 vault 中 |
| **BRB-014** | 把 `api-types.ts` 的其余部分迁移到生成的类型 | P3 | 开放 | **仍然复现** | `apps/web/src/lib/api-types.ts` 有 1,852 行、185 个 `export`（该发现说约 1,600），与生成的 `api-types.generated.ts` 并存 |
| **BRB-015** | 继续拆分 `SessionPage.tsx` | P3 | 开放 | **缺陷不再复现** | 在 [ADR 0176](../adr/0176-sessionpage-abaixo-de-mil-linhas.md)（AT-138）的十个机械性 PR 之后，`apps/web/src/routes/SessionPage.tsx` 有 **834 行**（在 `dev` 的 `018b8cd24c` 上是 2,637 行；该发现说 2,479 行，位于 `pages/`）。"完成标准"是低于 1,000，现在已被**锁定**：`apps/web/src/routes/SessionPage.teto.test.ts` 会让 1,000 行或以上的文件失败，经变异证明。提高上限需要新的 ADR |
| **BRB-016** | 在 `wrapped_dek` 中记录密钥 id 以简化轮换 | P3 | 已关闭 2026-09-27（AT-136） | **缺陷不再复现** | 由 PR #551、[ADR 0158](../adr/0158-o-id-da-chave-mestra-gravado-no-envelope.md) / [RN-563](../business-rules.md#rn-563) 关闭：`key_id`（主密钥的指纹）位于 `apps/api/src/db/schema/llm.ts:275` 和 `git.ts:76`，因此"还有多少凭据在旧密钥上？"是一个查询（`IS DISTINCT FROM`，把没有标签的行算作待处理）。标签从不决定信封能否打开——决定的是 GCM |
| **BRB-017** | 履行已发布 engine 镜像中内嵌工具的 GPL 义务 | **P1** | 开放 | **缺陷不再复现** | 原来：`docker/engine/` 中没有任何东西提到许可证，而当 [ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md) 开始在每个最终标签发布到 GHCR 时，这个义务就成真了。提供本身存在且很好——根目录的 `THIRD_PARTY_NOTICES.md`，列出每个组件、确切版本和许可证——**只是没有随之传递**。现在随之传递：`docker/engine/Dockerfile.prod:190-192` 把它复制到 `/usr/share/doc/brabo/`，在 `USER` 之前以 root 进行，因此它位于每个已发布的 engine 镜像内（PR #532）。于 2026-10-01 重新测量（AT-120）：经维护者决定，同样形式的同一个 `COPY` 也在其他四个生产 Dockerfile（api、web、broker、backup）中，runner 的 Release 将该文件作为签名 `checksums.txt` 内的 asset 携带——没有任何制品被声明为豁免。由 `scripts/ci/oferta-de-fonte-na-imagem.spec.ts` 锁定（每个 Dockerfile 的最终阶段、Release 的 asset、变异用例），`ci.yml` 的镜像 job 从它构建的五个镜像中的每一个内部读回该文件。途中发现：engine 的副本对镜像的非 root 用户不可读（BuildKit 对它创建的目录应用了 `--chmod=0644`），因此文档中的 `docker run … cat` 核对以 "Permission denied" 失败；该目录现在事先以 `0755` 创建。还有两件事仍然开放，都不是缺陷：**sidecar**（路径 3）仍是一个尚未做出的架构选择，而义务是否*已履行*是本仓库无法断言的法律判断——它只能说镜像携带了提供。途中发现：该文档**断言了与仓库所做相反的内容**（*"今天没有发布任何镜像"*，已被 ADR 0119 取代），而它那个要求"在第一次 push 之前"决定的 `TODO(humano)` **未被阅读就过期了** |
| **BRB-018** | 编写并测试从事件日志重建 Neo4j 投影 | P2 | 开放 | **已实现并在本地集群中证明**（已调度）；无大日志的时间测量 | 原来：任何地方都没有重投影命令（在 `apps/` 和 `scripts/` 中 `grep reprojet/reproject/graph:repro` 无结果），而 [ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md) 的决定 4 已经以重投影就是答案为理由**拒绝**了 `neo4j_data` 的备份。现在：`apps/api/src/scripts/reprojetar-grafo.ts`（`pnpm --filter api grafo:reprojetar`，镜像中为 `node scripts/reprojetar-grafo.js`）按游标分批遍历 `session_events` 和已关闭的 `sessions`，把每个来源交给 `GraphEventTranslator`——前向的 `GraphProjector` 现在调用的**同一个**翻译，从它中抽取出来而不是写两遍（[RN-569](../business-rules.md#rn-569)）。幂等（`MERGE`，从不删除），整个日志或 `--project`，不触碰实时投影器保存进度的 outbox，并在 Neo4j 宕机或项目不存在时具名失败。步骤见 runbook（[图丢失](../runbook.md#perda-do-grafo)）。证明是 `make test-reprojecao`（`apps/api/test/scripts/reprojetar-grafo.spec.ts`）：前向投影一个场景，**删除**其子图，重投影，比较节点和边的数量以及键的列表，再次重投影——针对开发 compose 的 Neo4j 为绿，在没有 Neo4j 的地方**跳过**，包括 CI 中的 api job。**集群中的证明（AT-127）：**`make test-reprojecao-k8s`（`deploy/k8s/test-reprojecao.sh`）是 `propriedades.yml` 的第四个目标——在它创建的一个项目（一个已关闭会话、两个事件）中，在 api pod 内运行 `node scripts/reprojetar-grafo.js --project`，在集群的 Neo4j 中删除该子图，重投影并要求相同的数量（5 个节点、4 条边），然后再次重投影；在运行 `35471428634` 中 16 秒内为绿，此前有两次运行在脚本本身中失败（`35469877869`、`35470685598`）。自 AT-191 起场景有四个事件——除消息和 handoff 外还有一个心理学家假设和一个 Anamnese 画像——因此覆盖翻译器的每条路径，数量为 9 个节点和 6 条边（运行 `36498776825`，18 秒）。它不依赖 `test-restore`，也不依赖其他目标的状态。**尚未关闭：**没有在大型事件日志上的时间测量（唯一的真实运行是开发 compose，98 个事件，2.5 秒），并且 `PromptTemplate`/`PromptVersion` 不在事件日志中——它们通过 `scripts/dev/seed-prompts.ts` 恢复 |
| **BRB-019** | 停止在开发环境中以 root 运行 `api` 和 `web` | P3 | 已关闭 2026-08-28（PR #406） | **缺陷不再复现** | `docker/api/Dockerfile:52` 和 `docker/web/Dockerfile:23` 以 `USER ${DEV_UID}:${DEV_GID}` 运行（PR #406，在该发现提出之前已关闭） |
| **BRB-020** | 为 `brabo-alerts.yaml` 中的每个告警设置严重级别 | P3 | 开放 | **缺陷不再复现** | 五个告警都有 `severity:`（`deploy/k8s/observability/alerts/brabo-alerts.yaml:29,59,87,123,160`）。**此处未测量：**"完成标准"还要求运维面板按它过滤 |
| **BRB-021** | 填补 runbook 的缺口：rollout 和成本事件 | P3 | 开放 | **缺陷不再复现** | `docs/runbook.md:1671` `## Engine rollout {#rollout-do-engine}` 和 `:2899` `## Cost incident {#incidente-de-custo}`，两者都能从分诊表（`:21`、`:30`）到达 |
| **BRB-022** | 修正仓库早已知道有误的散文中的计数 | P2 | 已关闭 2026-09-27（AT-136） | **缺陷不再复现** | 由 PR #530 关闭：`CONTRIBUTING.md:11`（ADR 计数）由 `pnpm docs:check` 核对，词汇表中制品 schema 的计数由 `Engine.Harness.ArtifactSchemas` 推导（`scripts/docs/generate.mjs:623-624`），在两个方向上经变异实践 |
| **BRB-023** | 更新 vault：ADR 0127、RN-471/472 以及不一致的 ADR 计数 | P2 | 开放 | **此处不可验证** | 该发现关于 vault 自身的笔记。仓库只能给出 vault 应当复制的数字——`docs/adr/` 和 RN 文件是来源 |
| **BRB-024** | 移除对已不存在的文件夹和路径的引用 | P3 | 开放 | **仓库那一半不再复现**；vault 那一半此处不可验证 | `README.md:296` 和 `docs/getting-started.md:274` 写的是 `apps/api/src/db/schema/<aggregate>.ts`，两句都由 `verificarFrasesAncoradasNoCodigo` 锚定在代码上；`design_handoff_brabo/` 只出现在历史性散文中。该发现点名的笔记（UX Designer、Desenvolvimento Local、Comandos）位于 vault 中 |
| **BRB-025** | 将 `apps/api/scripts/` 和 `e2e/` 纳入生成的环境清单 | P3 | 开放 | **缺陷不再复现** | `scripts/docs/fontes-de-env.mjs:49-52` 扫描这两处，那里的新 `process.env.X` 会让 `docs:check` 失败（AT-124，PR #638，经变异测量）。仍然开放的那一半——`docs:generate` 之后 ⚠️ 不会失败，而 `HUGGINGFACE_API_TOKEN`/`HUGGINGFACE_HUB_URL` 就是这样被提交的——在 AT-211（2026-09-27）中关闭：`docs:check` 会让环境清单中的任何 ⚠️ 失败，两类来源都是（`scripts/docs/inventario-de-env.mjs`，在 `inventario-de-env.spec.ts` 中经变异证明），这两个变量已在 `configuration.md` 中描述 |
| **BRB-026** | 重组 `docs/adr/index.md`——0044 以来的一切都在 "Phase 12" 下 | P3 | 开放 | **仍然复现** | `docs/adr/index.md:143` `## Phase 12 — Post-dogfooding operability` 仍然容纳之后的每个 ADR，且索引没有生成块 |
| **BRB-027** | 记录"规模"表背后的方法论 | P3 | 开放 | **仍然复现** | 没有 `scripts/docs/escala.mjs`，`docs/architecture.md` 也没有生成的规模块；表本身位于 vault 中 |
| **BRB-028** | 为 appsec 时刻（`threat_model`）提供触发器 | P2 | 已关闭 2026-09-27（AT-136） | **缺陷不再复现** | 原来：`SecOpsAgentServer.run_design/2` 没有生产调用方，`docs/fluxo.yml` 把 `assess_implementability` 称为自然的触发器，同时又宣布它超出范围。由 PR #514（**RN-539**——由 522 重新编号，该编号两天前已被占用）合并到 `dev`：`dev_lead_tools.ex:333-338` 从 `assess_implementability` 触发它，恰好在缺口说它应在的位置，通过 `Dispatcher.run_appsec_design/2`（`dispatcher.ex:112`）；`docs/fluxo.yml:188-196` 现在写着 `status: active`，没有声明的缺口。该触发器**由幂等性守护**，这并非过度谨慎：结果 `:sem_plano` 要求模型再次调用 `assess_implementability`，每次新调用都会再花一轮 appsec 的 LLM 并在同一个故事上再产生三个 handoff。代码中声明了一个限制：`artifact.threat_model` 在**故事**的会话中发出，而守卫读取的是 **DEV LEAD** 的会话——在常见路径上是同一个会话，两者不同时则是一轮重复的 LLM，绝不是错误的数据 |
| **BRB-029** | 决定心理学家和 Anamnese 的去留（自 2026-08-10 起暂停） | P2 | 开放 | **此处不可验证——产品决定** | 该暂停在 CLAUDE.md 中声明为开放的产品决定，并随 [RN-540](../business-rules.md#rn-540) 变得可逆；没有 ADR 记录在一段确定时期内保持关闭 |
| **BRB-030** | 协调重复的标签页导航（轨道 × 侧边栏） | P3 | 开放 | **此处不可验证——产品决定** | CLAUDE.md 将这种重复（`LinhaDeAba`，RN-196）列为已接受的缺口和单独的产品决定，在 [ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md) 中未做出 |
| **BRB-031** | 去掉通过浏览器配置 runner 时的手动 `chmod +x` | P3 | 已关闭 2026-10-01（AT-014） | **缺陷不再复现** | 原来：File System Access API 不保留执行位（`docs/adr/0118-configuracao-automatica-do-runner-pelo-navegador.md:134-140`），因此 ADR 0118 的浏览器流程以手动 `chmod +x` 结束。一半此前已通过另一条路关闭：`install.sh` 用 `install -m 0755` 安装二进制（[RN-531](../business-rules.md#rn-531)）并通过终端配对机器（[RN-547](../business-rules.md#rn-547)）。另一半因所有者（10/01）**停用**浏览器流程的决定而关闭：[ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md) / [RN-687](../business-rules.md#rn-687) 删除了 `apps/web/src/lib/runner-bootstrap.ts` 和 `POST /projects/:projectId/runner-device-keys`，`RunnerOnboardingPanel` 现在把人们引导到安装器的命令。`grep -rn "chmod +x" apps/web/src` 只找到面板讲述该步骤为何移除的 docblock。在此之前通过浏览器注册的项目密钥仍然有效且可撤销。该发现还要求的下载 e2e 覆盖失去了对象：已经没有可覆盖的浏览器下载 |
| **BRB-032** | broker 在本地 compose 中从未启动 | **P1** | 已关闭 2026-09-27，**仅限已测量的那一半**（AT-136） | 三半中有两半**缺陷不再复现**；第三半**未实践** | 在 vault 中**仅关闭已测量的那一半**。已测量：broker 已从 `profiles:` 中移出——开发 compose 唯一的 `profiles` 是 `local-llm`（`docker/docker-compose.yml:86,126`）；根本原因——构建时以 root 运行 `corepack` 而运行时没有 registry——通过在构建时准备 `COREPACK_HOME` 并加入 healthcheck 修正（PR #503，RN-512），没有给 broker 网络；`.env.example` 也不再自相矛盾（2026-09-11）。**仍然开放：**"在 `container` 项目中 `container_start` 能到达 daemon"从未被实践——它需要由架构师决定的镜像（RN-105），而测得的实例都没有 |
| **BRB-033** | `reset-total.sh` 搞垮了 engine，seed 也随之死掉 | P2 | 已关闭 2026-09-27（AT-136） | **缺陷不再复现** | `718b859e2`——"o reset total sobrevive a si mesmo e para de mentir no fim"，经由 `c230e91af`（PR #507）合并到 `dev`。脚本现在探测三个服务的 `/health`，任何失败都会点名该步骤退出 |

2026-09-27，vault 记录 **10 项已关闭**（`BRB-032` 仅限已测量的那一半）、**1 项已交付但尚未
标记为关闭**（`BRB-007`）以及 **22 项开放**。vault 中的开放状态与"缺陷不再复现"并列并不矛盾：
那是维护者尚未执行的关闭。

## "在此测得"中的用词是什么意思

这些用词有意不同。**已修正**会是维护者的判断，记录在 vault 中。**缺陷不再复现**是本仓库能够
诚实断言的全部：该发现描述的行为不是代码今天的行为，在该行的日期测得。**已实现，尚未实践**
更弱：代码存在，能够运行的测试都通过，但该路径只在本仓库触及不到的地方执行——在 CI 中一个真正
的 release 标签上。把它称为"已修正"就是声称一个没有人拥有的证明。**仍然复现**和**部分复现**说明
该发现的行为仍然存在，全部或部分。**此处不可验证**说明该发现关于本仓库不保存的东西。关闭该项——
并决定修正是否覆盖了该发现所要求的一切——留在提出该发现的地方。

`BRB-004` 是这种区分值得其代价的原因。按 id 读，它看起来像在 #419 中关闭的 `ollama:latest` 固定。
在 vault 中读，它要求的是**digest**，而当时没有任何镜像有。id 不是描述——而正是这种误读让它保持
开放，尽管针对 `uses:` 的姊妹规则自 #419 起就已有机制。

## 修改一行

id、标题和优先级逐字从 vault 复制，vault 中的状态也是；"在此测得"的状态和证据在这里测量。当 vault
改变一行的状态，或当本仓库的变更改变了能被证明的内容时，该行才会改变——绝不为了捏造一项发现。
