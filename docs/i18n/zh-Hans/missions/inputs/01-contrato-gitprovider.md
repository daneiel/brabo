---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
---

# 输入材料 1 — 已有的 GitProvider 契约

PO 为 Fase 10 准备的输入材料。它描述**已经就绪的部分**，以免史诗重新发明或与之矛盾。这里的一切都读自代码；每一条陈述都有 `arquivo:linha`。

新增一个 provider 意味着三件事，按此顺序：实现十个操作，**诚实地**声明 capabilities，并在不编写自有场景的情况下通过唯一的契约测试套件。

---

## 十个操作 {#as-dez-operações}

定义在 `packages/shared/src/index.ts:287-303`。provider 就是满足这个接口的对象——不多也不少。

| # | 操作 | 输入 → 输出 |
|---|---|---|
| 1 | `createRepo` | `CreateRepoInput` → `GitRepo` |
| 2 | `getRepo` | `GetRepoInput` → `GitRepo` |
| 3 | `createBranch` | `CreateBranchInput` → `GitBranch` |
| 4 | `protectBranch` | `ProtectBranchInput` → `void` |
| 5 | `commitFiles` | `CommitFilesInput` → `GitCommitResult` |
| 6 | `listBranches` | `ListBranchesInput` → `GitBranch[]` |
| 7 | `openPullRequest` | `OpenPullRequestInput` → `GitPullRequest` |
| 8 | `mergePullRequest` | `MergePullRequestInput` → `GitPullRequest` |
| 9 | `getFileContent` | `GetFileContentInput` → `string \| null` |
| 10 | `commentOnPullRequest` | `CommentOnPullRequestInput` → `void` |

另有两个必填字段：`name: GitProviderName`（`packages/shared/src/index.ts:288`）和 `capabilities: GitProviderCapabilities`（`:289`）。

第九个（`getFileContent`）随 Gitflow 引导（`docs/adr/0005-repo-bootstrap-idempotent-steps.md`）诞生，当文件或分支不存在时返回 `null`——不抛出（`packages/shared/src/index.ts:298`）。第十个（`commentOnPullRequest`）随 Fase 4a 的 PR gate 诞生，与其他 PR 操作一样遵守 `capabilities.pullRequests`（`packages/shared/src/index.ts:300-302`）。

### 输出格式 {#formatos-de-saída}

定义在 `packages/shared/src/index.ts:187-218`：

- `GitRepo` — `externalId`、`name`、`url`、`defaultBranch`、`visibility`
- `GitBranch` — `name`、`commitSha`、`protected`
- `GitCommitResult` — `sha`、`branch`
- `GitFileChange` — `path`、`content`
- `GitPullRequest` — `id`、`number`、`url`、`sourceBranch`、`targetBranch`、`state`（`"open" | "merged" | "closed"`）

### 输入格式 {#formatos-de-entrada}

`packages/shared/src/index.ts:220-285`。全都带有可选的 `accessToken?: string`——token 由调用方解密后传入，provider 从不持久化它。

| 类型 | `accessToken` 之外的字段 |
|---|---|
| `CreateRepoInput` | `name`, `visibility`, `namespace?` |
| `GetRepoInput` | `externalId` |
| `CreateBranchInput` | `externalId`, `branchName`, `fromRef` |
| `ProtectBranchInput` | `externalId`, `branchName` |
| `CommitFilesInput` | `externalId`, `branch`, `message`, `files: GitFileChange[]` |
| `ListBranchesInput` | `externalId` |
| `OpenPullRequestInput` | `externalId`, `sourceBranch`, `targetBranch`, `title`, `body?` |
| `MergePullRequestInput` | `externalId`, `pullRequestId` |
| `CommentOnPullRequestInput` | `externalId`, `pullRequestId`, `body` |
| `GetFileContentInput` | `externalId`, `branch`, `path` |

注意 `ProtectBranchInput` **不携带保护配置**——只有哪个分支。每个 provider 自行决定"受保护"的含义，这种分歧在 `docs/adr/0028-protecao-de-branch-divergencia-entre-providers.md` 中处理。

---

## Capabilities：两个标志，它们就是关口 {#capabilities-duas-flags-e-elas-são-o-portão}

```ts
interface GitProviderCapabilities {
  readonly protectBranch: boolean;
  readonly pullRequests: boolean;
}
```

`packages/shared/src/index.ts:182-185`。**只有两个。** 一个需要表达第三个维度的新 provider，是在要求变更契约——那是架构决策，不是实现细节。

各 provider 今天的声明：

| provider | `protectBranch` | `pullRequests` | 位置 |
|---|---|---|---|
| `LocalGitProvider` | `false` | `true` | `apps/api/src/infrastructure/git/local-git-provider.ts:55-58` |
| `GithubProvider` | `true` | `true` | `apps/api/src/infrastructure/git/github-provider.ts:39-42` |
| `GitlabProvider` | `true` | `true` | `apps/api/src/infrastructure/git/gitlab-provider.ts:41-44` |

Local 的 `pullRequests: true` 不是模拟：它是 bare repo 旁边 sidecar 中的一个轻量 PR 存储，为 Fase 4a 的 dev agent 而做（`apps/api/src/infrastructure/git/local-git-provider.ts:51-54`）。`protectBranch: false` 保留，是因为没有平台可以施加保护。

**RN-028 — 由 capability 决定，而不是 provider 的名字。** 不支持的操作在 `capabilities` 中声明，并以 `GitNotSupportedError` 拒绝，绝不静默失败。`LocalGitProvider` 在 `protectBranch` 中正是这样做的（`apps/api/src/infrastructure/git/local-git-provider.ts:137`）。没有任何使用者有 `if (provider.name === 'local')`。

---

## 规范化的错误 {#erros-normalizados}

七个类，位于 `apps/api/src/domain/git/git-errors.ts`。有意**没有公共基类**——该决定记录在 `docs/adr/0002-git-error-normalization.md`。

| 类 | 构造函数 | 行 |
|---|---|---|
| `GitRepoAlreadyExistsError` | `(repoId)` | `:10` |
| `GitRepoNotFoundError` | `(repoId)` | `:17` |
| `GitBranchNotFoundError` | `(repoId, ref)` | `:24` |
| `GitBranchAlreadyExistsError` | `(repoId, branchName)` | `:34` |
| `GitPermissionDeniedError` | `(path)` | `:44` |
| `GitNotSupportedError` | `(provider, operation)` | `:51` |
| `GitCredentialConnectionTestFailedError` | `(provider, reason?)` | `:64` |

不要与 `apps/api/src/domain/git/git-provider-errors.ts` 混淆，它有两个 **OAuth** 类（`GitProviderAuthError`、`InvalidOauthStateError`），不属于规范化契约。这一区分很重要：`GitPermissionDeniedError` 是"token 不能做这件事"；`GitProviderAuthError` 是"OAuth 流程失败了"。

把这些类翻译成状态码的 HTTP 过滤器位于 `apps/api/src/interfaces/http/shared/git-provider-error.filter.ts`。

### 各 provider 如何映射厂商的原始错误 {#como-cada-provider-mapeia-o-erro-cru-do-vendor}

这才是新 provider 的真正工作：厂商说它自己的方言，而契约只认识上面七个类。

- **GitHub**（Octokit）— 状态 `422` + `/already exists/i` → `GitRepoAlreadyExistsError`（`github-provider.ts:69-74`）；不带限流的 `403` → `GitPermissionDeniedError`（`:75-77`）。
- **GitLab**（Gitbeaker）— 状态 `400` + `/already (exists|been taken)/i` → `GitRepoAlreadyExistsError`（`gitlab-provider.ts:73-75`）；`401`/`403` → `GitPermissionDeniedError`（`:76-78`）。
- **Local**（通过 `execFile` 调用 git CLI）— 代码 `EEXIST` → `GitRepoAlreadyExistsError`（`local-git-provider.ts:71`）；`EACCES`/`EPERM` → `GitPermissionDeniedError`（`:72-74`）。

要照搬的模式：**按状态 + 响应体标记来判断**，绝不按整条消息的子串判断，因为消息会无预警地改变。

---

## 重试 {#retry}

`apps/api/src/infrastructure/git/retry.ts` — Full Jitter，4 次尝试，**只用于读取**（`docs/adr/0003`）。`LocalGitProvider` 不使用；GitHub 和 GitLab 使用。走 HTTP 的新 provider 应使用同一个辅助函数，并遵循同一规则：重复一次非幂等的写入，就是制造重复数据的方式。

---

## 唯一的契约测试套件 {#a-suite-de-contrato-única}

`apps/api/test/contract/git-provider.contract.ts`。它导出接口 `GitProviderContractHarness`（`:20`）和函数 `runGitProviderContract(label,
makeHarness)`（`:35`）。共有 **19 个场景**，新 provider 一个都不用写——只提供 harness。

按操作划分的场景：

| 操作 | 场景 |
|---|---|
| `createRepo` | 创建；拒绝已用名称（`GitRepoAlreadyExistsError`）；拒绝权限不足（`GitPermissionDeniedError`，以 root 运行时跳过） |
| `getRepo` | 返回已创建的；拒绝不存在的 id（`GitRepoNotFoundError`） |
| `commitFiles` | 新分支上的第一次提交；第二次提交产生新 sha；拒绝不存在的分支（`GitBranchNotFoundError`） |
| `getFileContent` | 返回内容；文件不存在时为 `null`；分支不存在时为 `null` |
| `createBranch` | 从已有 ref 创建；拒绝不存在的 `fromRef`；拒绝已存在的名称 |
| `listBranches` | 列出已有分支 |
| `protectBranch` | **遵守 `capabilities.protectBranch`** |
| `openPullRequest` / `mergePullRequest` / `commentOnPullRequest` | **遵守 `capabilities.pullRequests`** |

最后四个对新 provider 最重要：套件不要求操作能工作——它要求操作**要么能工作，要么抛出 `GitNotSupportedError`，与声明的标志一致**。声明 `true` 却不实现会失败；声明 `false` 却实现了同样失败。

今天运行该套件的有：

| harness | 文件 |
|---|---|
| `local` — 真实 provider + 临时目录 | `apps/api/test/infrastructure/git/local-git-provider.contract.spec.ts:12` |
| `github (mockado)` — 真实 provider + 通过 `msw` 的 HTTP 后端 | `apps/api/test/infrastructure/git/github-provider.contract.spec.ts:23` |
| `gitlab (mockado)` — 同上 | `apps/api/test/infrastructure/git/gitlab-provider.contract.spec.ts:23` |
| `github (API real)` — 仅在有 `GITHUB_TEST_TOKEN` 时 | `apps/api/test/infrastructure/git/github-provider.smoke.spec.ts:40` |
| `gitlab (API real)` — 仅在有 `GITLAB_TEST_TOKEN` 时 | `apps/api/test/infrastructure/git/gitlab-provider.smoke.spec.ts:31` |

mock + smoke 这一对是要遵循的模型：套件在 CI 中针对假后端运行，而**同一个**套件在环境变量之后针对真实 API 运行，默认跳过。

> ⚠️ `apps/api/test/contract/git-provider.contract.ts:12-18` 顶部的注释仍然说只有 Local 运行该套件。这自 Fase 2 起就已过时——在任务中被记录为 P3 发现，将在本阶段修正。

---

## 注册表 {#registry}

`apps/api/src/infrastructure/git/git-provider-registry.ts` — 一个按 `GitProviderName` 的 `switch`，返回注入的实例。新 provider 要加在这里、加在模块 `apps/api/src/infrastructure/git/git-infrastructure.module.ts` 中，以及 `packages/shared/src/index.ts` 中的类型 `GitProviderName` 里。

注意一个以前咬过人的细节：`packages/shared` **100% 是类型**。运行时的列表不能放在那里——该包通过原始 `.ts` 解析，api 的生产镜像会起不来。有测试守着这一点（`apps/api/test/packages-shared-so-tipos.spec.ts`）。

---

## provider 在后端之外出现的位置 {#onde-o-provider-aparece-fora-do-backend}

史诗需要覆盖这些点，否则 provider 存在却没人能选择它：

- `apps/web/src/routes/NewProjectWizard.tsx:28-37` — 向导的 `PROVIDERS` 数组
- `apps/web/src/lib/wizard.ts` — `providerNeedsCredential`，决定凭据步骤是否出现
- `apps/web/src/components/wizard/CredentialStep.tsx:19-21` — 标签
- `apps/web/src/components/ProjectCard.tsx:11-19` 和 `apps/web/src/routes/ProjectPage.tsx:16` — 每个 provider 的图标和标签
- `apps/web/src/components/ui/icons.tsx` — 图标
- `apps/api/src/db/schema.ts:198-203` 中的 `credentialProviderEnum` — 如果 provider 接受凭据，就需要迁移

---

## 史诗不能违背的两条业务规则 {#duas-regras-de-negócio-que-o-épico-não-pode-contrariar}

- **RN-028** — 由 capability 决定，而不是 provider 的名字。由针对所有 provider 运行的契约套件验证。
- **RN-029** — Gitflow 引导是幂等且可恢复的；共六步，每一步在行动前先检查，而 `skip` **就是成功**。没有 `protectBranch` 的 provider 会让该步骤以 `degraded` 结束，这同样是成功——`bootstrap.step_degraded` 正是为此而存在。
