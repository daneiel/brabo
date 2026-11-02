---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0004 — 用户 git 凭据的登记

## 背景 {#contexto}

Fase 2 的第 3 项（见 CLAUDE.md）：用户的 git 凭据（`GithubProvider`/`GitlabProvider` 用来代表用户操作的 GitHub/GitLab token）需要存放在与 LLM API 密钥（Fase 1）相同的 `user_credentials` 表中，使用相同的信封加密，并且在登记时必须进行连接测试。

两个形态问题：

1. `user_credentials.provider` 本来是 `llm_provider` 枚举（`ollama`/`anthropic`/...）。git token 不是 LLM provider——扩宽 `llm_provider` 会在一个也被 `models`/`token_usage`（真正只与 LLM 相关）使用的枚举中混入两个领域。复用 `git_provider`（被 `project_git_connections` 使用）也不行：它包含 `'local'`，作为*凭据*的 provider 没有意义（本地 git 没有 token）。
2. 无效/被吊销的 token 只有在尝试使用时才会被发现——没有连接测试，登记会“成功”，而失败只会在第一次 Gitflow bootstrap 时出现，晚得多，诊断代价也高得多。

## 决策 {#decisão}

**专用枚举** `credential_provider`（迁移 `0007`），在 `packages/shared` 中有 `CredentialProviderName = LLMProviderName | GitCredentialProviderName`——两个领域的并集只出现在 `UserCredentialRepository` 使用的类型中，不混合数据库枚举。`GitCredentialProviderName` 是 `Extract<GitProviderName, 'github' |
'gitlab'>`——它从 git provider 枚举派生，不重复列表，但在结构上排除了 `'local'`。

**在加密/持久化之前进行同步且强制的连接测试。** `RegisterGitCredentialUseCase.execute`（新）首先调用 `GitCredentialConnectionTester.test(provider, token)`；只有它成功后，token 才会被加密（`EncryptionService.encrypt`）并写入（`UserCredentialRepository.upsert`）。失败时什么都不写——见 `domain/git/git-errors.ts` 中的 `GitCredentialConnectionTestFailedError`。真实实现（`GitCredentialConnectionTesterImpl`）在各 API 上做尽可能便宜的调用来确认 token 能认证：GitHub 上 `GET /user`（Octokit `users.getAuthenticated`），GitLab 上 `GET /user`（Gitbeaker `Users.showCurrentUser`）——两者都不尝试列出仓库或任何依赖基本认证之外权限范围的操作。

**PAT 在 Gitbeaker 中总是通过 `token:`，绝不用 `oauthToken:`。** GitLab 以不同方式验证两者（头 `PRIVATE-TOKEN` 与 `Authorization: Bearer`）——它们不可互换。`oauthToken` 保留给项目的 OAuth 流程（`project_git_connections`，Fase 2 第 4 项及以后），本次会话不改动它。

**只为登记设专用端点；GET/DELETE 复用。** `POST /users/me/git-credentials`（新，`GitCredentialsController`）是本次会话唯一的路径，因为只有登记需要同步的连接测试。列出和删除已经存在于 `CredentialsController`（Fase 1，LLM）中，作用于同一张表/仓库——`UserCredentialRepository` 从 `LLMProviderName` 扩宽为 `CredentialProviderName`（那是遗留下来、导致构建失败的孤立 `LLMProviderName`，见 `user-credential.repository.ts` 中的 `delete()`），而不是为 git 复制 list/delete。新控制器上没有 `@RequireRole`：它关乎已认证用户自己的凭据，与对应的 LLM 端点模式相同。

**连接失败映射为 422，而不是 400 或 409**（`git-provider-error.filter.ts`）：它不是格式错误的 payload（400），也不是与现有状态的冲突（409）——它是一个语义上无效的实体（从未认证成功的 token），是 422 的经典情形。

## 后果 {#consequências}

- 登记 git 凭据现在会在响应之前同步地对 provider 的 API 发起一次网络调用——端点比“盲目”登记更慢，这是有意的（见决策）。
- `UserCredentialRepository`（及其迁移 `0007`）现在通过同一张表/类型枚举服务两个领域（LLM 和 git）——任何未来的凭据 provider（无论是否为 git）都通过 `CredentialProviderName` 进入，而不是新的枚举。
- 连接测试不重试（`GitCredentialConnectionTester` 不使用 `withRetry`，见 0003）——登记时短暂的网络故障需要用户手动重试；这可以接受，因为它是一次性的交互操作，不是后台操作。
