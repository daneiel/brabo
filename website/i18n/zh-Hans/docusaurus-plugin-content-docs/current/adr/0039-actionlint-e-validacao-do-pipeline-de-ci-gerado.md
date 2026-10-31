---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0039 — actionlint 与生成的 CI 管道的验证

## 背景 {#contexto}

CLAUDE.md 8c 要求 ADR 0038 模型的第二个实例：InfraAgent 变成 Infra Lead，并获得子 agent Workflows，它为用户的项目生成 CI 管道（GitHub Actions 或 GitLab CI，取决于 provider——RN-037）。本 ADR 不重新打开通用的领域/lead/委派模型（那是 ADR 0038）；它只固定这个实例新的、特定的决定：Workflows 如何在提议之前在本地验证它生成的内容，以及什么因缺少工具而未被验证。

先例是原始 InfraAgent 的 hadolint（Fase 4a，ADR 0021）：没有二进制文件时，infra 的 QA gate 会批准任何 Dockerfile——包括无法解析的——因为缺失被当作“跳过”，而不是“因缺少证明而失败”。同样的陷阱在这里也适用：没有任何验证，Workflows 会提议一个语法损坏的 CI 管道，而 PR 中没有任何迹象。

## 决策 {#decisão}

### 1. 在 engine 的 Dockerfile 中固定 `actionlint`，与 gitleaks/hadolint 模式相同 {#1-actionlint-pinado-no-dockerfile-do-engine-mesmo-padrão-do-gitleakshadolint}

`docker/engine/Dockerfile`（尽力而为，`|| echo`）和 `docker/engine/
Dockerfile.prod`（硬失败，`ARG ACTIONLINT_SHA256` 用 `sha256sum -c -` 校验，进入证明每个 gate 二进制都存在且可执行的探测块）。版本 `1.7.12`，校验和对照 `rhysd/actionlint` 发布中公布的 `actionlint_1.7.12_checksums.txt`，并通过独立下载 tarball + `sha256sum` 核对。在 `.github/workflows/ci.yml` 中镜像（`env.ACTIONLINT_VERSION`，安装在 `test-engine` 作业中——与 gitleaks/hadolint 已经要求的开发/生产/CI 一致性相同）。

它最初固定在 `1.7.7`（Go 1.23.4），在本次交付中就升到了 `1.7.12`（Go 1.26.1）——镜像的 CI（`trivy`）因官方二进制继承的 15 个 Go 标准库 CVE（1 个 CRITICAL）而让 `1.7.7` 失败。新版本并没有把列表清零（最新的 `rhysd/actionlint` 仍未为每个 CVE 打包最新的 Go 补丁），但消除了 CRITICAL 和 3 个 HIGH——剩下的 12 个 HIGH 放在 `.trivyignore.yaml` 中，带 `expired_at`，与 gitleaks 的模式相同：只下载（不编译）的第三方二进制，已是最新发布版本，带过期日期。

`Engine.Actions.ActionlintDetector`（Live + Fake）是 `Engine.Actions.HadolintDetector` 的精确镜像：`System.find_executable/1`，在不破坏回合的情况下降级为 `:unavailable`，退出码 `0`/`1` 规范化（`1` = 有发现，不是进程失败）。

### 2. 验证发生在**生成**时，而不是在一个新的 PR 后 gate 中 {#2-a-validação-acontece-na-geração-não-num-gate-pós-pr-novo}

`Engine.Infra.Tools.ValidateInfraFile`（在这一阶段泛化——以前只认识 hadolint）按路径扩展名分派：`Dockerfile*` → hadolint，`.github/workflows/*.{yml,yaml}` → actionlint，`.gitlab-ci.yml` → 不验证（第 3 项）。`WorkflowsAgent` 在 `emit_infra_delegation_result` 之前调用这个工具——这与 Lead 对 Dockerfile 已经遵循的纪律相同。

我们**不**创建第三个 PR 后 gate：`Engine.Infra.InfraGateRunner` 继续用 `yamllint` 验证通用 YAML（compose + 任何 CI 管道），语法性且表层——它检查是否**能解析**，而不是引用的 `actions` 是否存在或是有效版本。`actionlint` 做更深的语义分析（action 名称、表达式类型、有效上下文），并且在 PR 存在**之前**做——在生成时，Workflows 还能纠正而不耗费 gate 的纠正周期。运行两种验证（PR 后的 yamllint + 提议前的 actionlint）并不冗余：它们是两种不同的深度，与 hadolint（语法性，提议前）和 SecOps 的密钥扫描器（语义性，PR 后）共存的精神相同。

### 3. `.gitlab-ci.yml` 没有本地静态验证——已记录的缺口 {#3-gitlab-ciyml-fica-sem-validação-estática-local--gap-documentado}

GitLab CI 不存在与 `actionlint` 等价的离线二进制——官方 linter（`POST /api/v4/projects/:id/ci/lint`）需要一个运行中的 GitLab 实例，而 Workflows 没有（也不应该有）GitLab 凭据去调用这个 API 只为了验证语法。`ValidateInfraFile` 以明确的消息（“sem linter estático local”）降级，而不是编造一个部分验证（例如一个不理解 `.gitlab-ci.yml` schema 的通用 YAML 解析器），那会带来虚假的信心。作为环境的已知限制记录（`docs/runbook.md`），而不是隐藏。

## 后果 {#consequências}

- Workflows/Lead 提议的每个 Dockerfile **或** GitHub Actions 工作流，在 PR 存在之前都已经过语法/语义验证——没有二进制时，“indisponível”消息记录在事件的 `tool.result` 中，这正是演示 `demo:infra-workflows-github` 验证的内容（RN-037）。
- 使用 `GithubProvider` 的项目永远不会生成 `.gitlab-ci.yml`（Workflows 根据上下文的 `gitProvider` 决定格式——RN-037）；`.gitlab-ci.yml` 只为 GitLab 项目生成，并且生成时没有本地验证。
- 如果 GitLab CI 将来获得离线验证器，扩展点是 `Engine.Infra.Tools.ValidateInfraFile.gitlab_ci?/1`——把“sem linter”分支换成对一个新的 `Engine.Actions.GitlabCiLintDetector` 的调用，与其他三个相同的模式。
