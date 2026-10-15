---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0003 — 远程 provider 的重试策略

## 背景 {#contexto}

`GithubProvider` 和 `GitlabProvider` 进行真实的网络调用（Octokit 和 Gitbeaker），会出现短暂性失败——rate-limit（429）、5xx 错误、超时。`GitProviderContract` 的 8 个操作（见 0001）就能否安全重新执行而言分为两种截然不同的性质：

- 读取（`getRepo`、`listBranches`）天然是幂等的——重新执行没有副作用。
- 变更（`createRepo`、`createBranch`、`protectBranch`、`commitFiles`、`openPullRequest`、`mergePullRequest`）在一般意义上不是幂等的（例如：超时后重发 `createRepo` 可能与第一次尝试创建的仓库本身冲突，或者触发第二次提交）——决定是否/如何重新执行取决于重试包装器所没有的上下文。

## 决策 {#decisão}

**自动重试只用于读取，绝不用于变更。** `apps/api/src/infrastructure/git/retry.ts` 暴露 `withRetry(fn,
options)`，采用“Full Jitter”（AWS 的算法：`sleep = random(0,
min(maxDelay, base·2^tentativa))`），`maxAttempts` 默认 4，`baseDelayMs` 250，`maxDelayMs` 4000。两个远程 provider 中只有 `getRepo`/`listBranches` 经过 `withRetry`；每个变更都直接调用 API，在第一次失败时让错误原样上抛——由调用方决定是否再试。

**重试标准按 provider 而定，而不是通用的**，通过每次调用传入的 `shouldRetry: (error) => boolean`：

- GitHub（`github-provider.ts` 中的 `isRetryableReadError`）：429，或任何 5xx，或**仅当**头 `x-ratelimit-remaining: 0` 确认是 rate-limit 时的 403（`isRateLimited`）——GitHub 把 403 同时用于权限被拒绝**和** rate-limit，只有这个头能区分两者；绝不仅凭状态码重试 403（重试一个被拒绝的权限是无穷且无用的）。
- GitLab（`gitlab-provider.ts` 中的 `isRetryableReadError`）：只有 `GitbeakerTimeoutError` 和 500/503/504。Gitbeaker **已经**在内部重试 429/502（无 jitter 的指数退避，最多 10 次）——在这里再为这些码加重试会使总延迟翻倍而没有收益；包装器只覆盖 Gitbeaker 不处理的情况。

**已知的、不在我们控制范围内的保留：Gitbeaker 内置的重试是按**传输**，而不是按操作。** `@gitbeaker/rest` 的 `defaultRequestHandler`（`retryCodes = [429, 502]`、`maxRetries = 10`、延迟 `2^tentativa · 0.25s`、无 jitter）对客户端发出的**任何** HTTP 请求都会运行——GET、POST、PUT，不区分读取与变更——而这两个值（`retryCodes`、`maxRetries`）是模块的内部常量，`Gitlab(...)` 构造器中没有任何公开选项可以禁用或重新配置它们（通过阅读 `@gitbeaker/rest@43.8.0` 确认——这里使用的聚合类没有暴露任何可定制的 `requesterFn`）。实际上，这意味着 `GitlabProvider` 的一个以 429 或 502 响应的变更**仍然会被重试**，只不过是由库而不是由我们的 `withRetry` 重试——“变更绝不自动重试”这一保证只对 GitHub 100% 成立（Octokit 没有内置任何重试：依赖中既没有 `@octokit/plugin-retry` 也没有 `plugin-throttling`），而在 GitLab 上只对 Gitbeaker **不**处理的码成立（400、403、404、422、500、503、504）——429/502 从我们控制之外漏过。见测试 `GitlabProvider — cenários de HTTP mockados > 429 numa mutação
(createRepo): o Gitbeaker retenta por conta própria`（`gitlab-provider.contract.spec.ts`），它记录了这一真实行为而不是假装它不存在，以及用 **500**（不在 Gitbeaker 列表中）的测试，它同时在两层证明“没有重试”。

## 后果 {#consequências}

- GitHub 的一个因 rate-limit 或 5xx 失败的变更，总是在第一次尝试时就被拒绝——本阶段没有写入的自动重试。如果这被证明是真实的 UX 问题（例如：Gitflow bootstrap 因短暂的 rate-limit 而失败），未来的决定关乎针对特定操作的幂等重试（例如：`createBranch` 可以在重新执行前检查分支是否已存在），而不是一个通用的包装器。
- GitLab 的一个以 429/502 失败的变更，会在我们的代码看到错误**之前**被 Gitbeaker 重试（最多 10 次，最坏情况下累计等待约 29s：`0.25·(2^10-1)` 秒之和）——作为库的限制被接受，已记录，未隐藏。仅为此在本阶段更换库是不成比例的；如果它变成真实问题（例如：在 rate-limit 之上不当重新执行导致重复的 `createRepo`），未来的决定关乎用一个能完全控制重试的轻量 HTTP 客户端替换 `@gitbeaker/rest`，而不是试图从外部绕过这一行为。
- `withRetry` 与 Octokit/Gitbeaker 没有耦合——它用通用的 `fn` 单独测试（`retry.spec.ts`），每个 provider 只提供自己的 `shouldRetry`。
- 一次所有尝试都用尽的读取，其总等待时间受每次尝试的 `maxDelayMs`（4s）限制，而不是受总时间上限限制——在最坏情况下（4 次尝试，每次都达上限），等待累计约 12s 才会上抛最终错误。
