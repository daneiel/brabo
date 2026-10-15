---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0001 — GitProvider 规范化契约的形态

## 背景 {#contexto}

Fase 2（CLAUDE.md）要求在 `packages/shared` 中有一个规范化的 `GitProvider` 接口，覆盖 8 个操作（`createRepo`、`getRepo`、`createBranch`、`protectBranch`、`commitFiles`、`listBranches`、`openPullRequest`、`mergePullRequest`），其类型绝不泄露 Octokit（GitHub）或 GitLab REST 客户端（`@gitbeaker`）的形态，并有一个 `capabilities` 对象，当某个 provider 不支持某个操作时，领域通过它降级。

在本次会话之前，`apps/api` 已经有一个 `GitProvider`——但它是作为 NestJS 依赖注入 token 使用的 `abstract class`，只有一个操作（`createRepository`），由已在生产中的仓库开通管道使用（`ProvisionRepositoryUseCase`、`GitProviderRegistry`、`GitInfrastructureModule`）。本次会话只限定于“基础”（类型 + 契约测试套件 + 完整的 `LocalGitProvider`）——把 `GithubProvider`/`GitlabProvider` 补全到 8 个操作留给未来的会话。

## 决策 {#decisão}

**暂时有意让两个契约共存**：

1. `GitProvider`（不变，`apps/api/src/application/ports/git-provider.port.ts`）——仍然是 Nest 的 DI token，带 `createRepository`。本次会话中它没有任何改变；`GithubProvider`/`GitlabProvider`/registry/开通用例都不被触碰。
2. `GitProviderContract`（新，`packages/shared/src/index.ts`）——8 个操作 + `capabilities` 的规范化接口，类型 `GitRepo`/`GitBranch`/`GitPullRequest`/`GitCommitResult`。它还没有绑定到任何 DI token。目前只有 `LocalGitProvider` 实现它（同时继续实现不变的旧 `GitProvider`）。

命名为 `GitProviderContract`，而不是复用 `GitProvider` 标识符——避免在同时实现两者的文件（`LocalGitProvider`）中名称冲突，并与 CLAUDE.md 本身用来描述测试的“契约测试套件”这一词汇相符。

每个标识仓库的字段都使用 `externalId`（而不是 `id` 或 `repoId`）——与 `CreateRepositoryResult`/`ProvisionedRepository` 已经使用的名称相同，以便与已持久化的内容保持一致。

**`capabilities`**：`{ protectBranch: boolean; pullRequests: boolean }`——两个布尔标志，可在运行时内省（`provider.capabilities.protectBranch`），除此之外没有按操作的粒度（例如：不存在“部分 protectBranch”）。`LocalGitProvider` 把两者都声明为 `false`——本地的 bare repo 背后没有平台来承载分支保护或 pull request。当调用一个被缺失能力限制的操作时，provider 抛出 `GitNotSupportedError`（绝不是原始崩溃）——见 0002。

**本地的合并/PR**：`LocalGitProvider` 中的 `openPullRequest` 和 `mergePullRequest` 无条件抛出 `GitNotSupportedError`——本次会话不存在通过分支+直接合并来模拟 PR。未来的某次 Gitflow bootstrap 会话很可能需要为没有 `pullRequests` 的 provider 提供直接合并操作（而不是“假 PR”）——该操作在这里有意尚未建模，以免发明一个还没有人使用的 API 面。

## 后果 {#consequências}

- 对已在生产中的开通管道零回归风险——`GitProvider`/`GithubProvider`/`GitlabProvider` 保持原样。
- 明确的债务：两个契约（`GitProvider` 和 `GitProviderContract`）需要在未来的会话中收敛，届时 `GithubProvider`/`GitlabProvider` 也会实现 `GitProviderContract`——到那时，让（旧的）`GitProvider` 退役而改用新的，或者让其中一个扩展另一个，是合理的。
- 契约测试套件（`apps/api/test/contract/git-provider.contract.ts`）已经以可复用的方式编写——它根据 `provider.capabilities.*` 分支来决定正确的断言——所以在 Github/Gitlab 加入时不需要改变，只是调用它的 harness 会改变。

## 更新（Fase 2，会话 3——Gitflow bootstrap） {#atualização-fase-2-sessão-3--bootstrap-de-gitflow}

上一节的“明确的债务”已经还清：自 git 凭据那次会话起，`GithubProvider` 和 `GitlabProvider` 就已经完整实现了 `GitProviderContract`（模拟的契约测试套件在 3 个 provider 上通过）。在本次会话中，`GitProviderRegistry.get()` 改为返回 `GitProviderContract`，而不是遗留的 `GitProvider`——`createRepository`/`CreateRepositoryInput`/`CreateRepositoryResult` 被移除（经 grep 确认：`ProvisionRepositoryUseCase` 是唯一的使用者）。契约还增加了第 9 个操作 `getFileContent`，bootstrap 需要它在重新提交之前检查“文件已以相同内容提交”——见 docs/adr/0005-repo-bootstrap-idempotent-steps.md。
