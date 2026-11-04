---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0002 — GitProvider 错误的规范化

## 背景 {#contexto}

`GitProviderContract` 的契约测试套件（见 0001）需要针对 8 个操作的规范、稳定的错误——尤其是原始需求中提到的 3 个场景（仓库已存在、分支不存在、权限被拒绝），再加上能力缺失的情况，后者绝不能是一次原始崩溃。

其余代码已经有一套领域错误的约定：每个错误都是一个独立的 `class X extends Error`，显式设置 `this.name`，并带有类型化的上下文字段（绝不是通用的 `code` 枚举）——见 `apps/api/src/domain/git/git-provider-errors.ts`（`GitProviderAuthError`、`InvalidOauthStateError`，专注于 OAuth）以及会话/动作状态机的错误。

## 决策 {#decisão}

**没有公共基类。** 曾考虑引入一个抽象的 `GitError extends Error`，让 6 个新类汇聚于它（便于将来使用单一的 `@Catch(GitError)`），但被否决：本次会话没有注册任何新的 HTTP 过滤器（还没有任何端点暴露这 8 个操作——那是 Fase 2 的第 4-6 项，属于未来），所以公共基类没有直接用途，而且在目前没有具体理由的情况下，会偏离整个领域已经确立的“无基类”约定。

六个独立的类，位于 `apps/api/src/domain/git/git-errors.ts`（新文件，与 OAuth 的 `git-provider-errors.ts` 分开）：

- `GitRepoAlreadyExistsError(repoId)`
- `GitRepoNotFoundError(repoId)`
- `GitBranchNotFoundError(repoId, ref)`
- `GitBranchAlreadyExistsError(repoId, branchName)`——它免费来自 `createBranch` 中使用的 `git update-ref` 的 compare-and-swap 语义；它不在原始的 3 个场景清单中，但它是拒绝覆盖现有分支的自然行为。
- `GitPermissionDeniedError(path)`
- `GitNotSupportedError(provider, operation)`

**权限被拒绝的测试与以 root 运行的容器。** api 的开发容器以 root 运行（`docker/api/Dockerfile`，没有 `USER`）。root 会忽略 Unix 权限检查（DAC），所以一个执行 `chmod(dir, 0o000)` 并期待 `EACCES` 的测试在以 root 运行时不会重现任何真实情况——测试会在没有执行任何错误处理代码的情况下“通过”，这比没有测试更糟。曾考虑（并推迟，对本次会话的范围而言不成比例）使用 Node `child_process` 的 `uid`/`gid` 选项，在尝试操作之前有意降低权限——这需要假定在测试套件运行的每个环境中都存在某个特定的非特权 uid（`nobody` 或类似），并且会仅为测试的方便而增加一条身份覆盖的途径。决定：测试套件检测 `process.getuid?.() === 0`，在以 root 运行时跳过（`it.skipIf`）权限被拒绝的测试，并在代码中附上明确的注释——绝不假装通过。

## 后果 {#consequências}

- 本次会话不添加任何 HTTP 过滤器（`@Catch(...)`）——留待将来某次会话通过端点暴露这 8 个操作时（Fase 2 的第 4-6 项）。在那之前，这 6 个类只在 api 进程内部流转（对 provider 的直接调用、测试）。
- 在测试以非 root 用户运行的环境中（例如：不以 root 配置的 CI，或将来某个带非 root `USER` 的开发镜像），权限被拒绝的测试会被真正执行——这不需要任何代码改动，只需要环境改变。
