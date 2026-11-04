---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
---

# 输入 2 — Bitbucket Cloud：编码之前要调查什么

给 PO 和 Arquiteto 的第 10 阶段输入材料。

**本文件是一份问题清单，而不是答案清单。** 这里没有任何内容断言 Bitbucket Cloud 如何运作。每一项都指出一个需要在变成代码之前**在官方文档中验证**的语义——而验证的结果就是 Arquiteto 通过真实 PR 在语义 ADR 中记录的内容。

这条规则来自有记录的教训：第 9b 阶段停下来，恰恰是因为无法在官方文档中验证 `baseUrl`、认证和 `usage` 的格式，而决定是不去猜
（`docs/adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md:147-156`）。
对着猜测的合约编写的 provider 在 mock 中通过、在真实环境中失败——那是最糟糕的发现地点。

要满足的合约在 `inputs/01-contrato-gitprovider.md` 中。

---

## 1. 认证 {#1-autenticação}

这里决定的东西会改变 schema，而不只是 provider。

- Bitbucket Cloud 今天提供哪些机制，哪些已被**弃用**？
  （App passwords、API tokens、OAuth 2.0、仓库/workspace 的 access tokens——哪些存在，哪些已宣布终止日期？）
- 哪一个适合当前的格式：每次调用一个单独的 `accessToken?: string`
  （`packages/shared/src/index.ts`，所有 `*Input`）？如果机制要求**用户+密码对**而不是单个令牌，那就**不适合**合约——决定权在 Arquiteto：在 provider 中适配，还是改变合约。
- 覆盖十个操作的最小作用域是什么？读、写、管理 PR 和管理 branch restrictions 是不同的作用域吗？
- 连接测试应该怎么做？现有模式是一次“我是谁”的调用（`apps/api/src/infrastructure/git/git-credential-connection-tester.ts`），同步，并且在加密之前是必需的
  （`docs/adr/0004-git-credential-registration.md`）。

**对 schema 的影响：** `credentialProviderEnum`
（`apps/api/src/db/schema.ts:198-203`）今天有 `ollama`、`anthropic`、`openai`、
`github`、`gitlab`。加入 `bitbucket` 需要迁移。如果认证机制需要两个字段，`user_credentials` 表每行只保存**一个**加密的秘密——这同样是架构决策，而不是细节。

---

## 2. 仓库身份（`externalId`） {#2-identidade-do-repositório-externalid}

合约把 `externalId` 当作不透明字符串，而两个现有 provider 以不同方式解释它（GitHub 使用 `owner/repo`；见
`apps/api/src/infrastructure/git/github-provider.ts` 中的 `splitFullName`）。

- Bitbucket Cloud 中仓库的规范身份是什么——
  `workspace/repo_slug`、UUID，还是两者？
- 仓库重命名时 slug 是否稳定？如果不稳定，持久化在 `provisioned_repositories` 中的 `externalId` 就会腐烂——这需要写进 ADR。
- 什么填入 `CreateRepoInput` 的 `namespace`：workspace、项目（Bitbucket 有一个 GitHub 和 GitLab 没有的“project”层级），还是两者？如果层级多了一层，单靠 `namespace` 装得下吗？

---

## 3. Branch restrictions——`protectBranch` 的对应物 {#3-branch-restrictions--o-análogo-de-protectbranch}

最微妙的一点，因为这正是三个现有 provider 已经出现分歧的地方
（`docs/adr/0028-protecao-de-branch-divergencia-entre-providers.md`）。

- Bitbucket Cloud 如何对分支限制建模？是像 GitHub 那样带多个字段的**一个**实体，还是需要逐一创建的**多条**独立规则？
- 如果是多条，应用“保护”就变成 N 次调用。`protectBranch` 返回
  `void` 且不是事务性的——如果第三次失败会怎样？之后可观测的状态是什么？
- 有没有等价于 `enforce_admins` 的东西？如果有，**不要重复 GitHub 的错误**：`github-provider.ts:170-175` 在不读取当前状态的情况下应用 `enforce_admins: true` +
  1 名审阅者，这可能卡住负责人的手动合并（ADR 0028:83-84）。这已登记为本阶段的 P1 发现。
- 对已有限制的分支应用限制，是**覆盖**还是**累加**？答案决定这一步是幂等的还是破坏性的——而 RN-029 要求幂等。
- `GitBranch` 带有 `protected: boolean`
  （`packages/shared/src/index.ts:195-199`）。`listBranches` 在 Bitbucket 中如何得到这个布尔值？它是分支的一个字段，还是需要第二次调用列出限制再交叉比对？如果需要 N+1 次调用，这是需要声明的成本。

**根本问题：** `GitProviderCapabilities` 的两个 flag 足以诚实地描述 Bitbucket 吗？如果答案是否，决定权在 Arquiteto 并写进 ADR——不能靠声明 `true` 然后祈祷来解决。

---

## 4. 合并策略 {#4-merge-strategies}

- Bitbucket Cloud 在 PR 合并时接受哪些策略，未指定时**默认**是哪一个？
- `MergePullRequestInput`（`packages/shared/src/index.ts:267-271`）只带
  `externalId` 和 `pullRequestId`——没有策略字段。Bitbucket 的默认值对 Brabo 的流程是否可接受，还是 provider 需要显式固定一个？
- 合并可能因冲突、未满足的分支限制或缺少审批而失败。每一种对应七个规范化错误类中的哪一个？如果没有合适的，那就是一个新错误——给合约增加类是决定，而不是细节。
- 返回值需要在 `GitPullRequest.state` 中填入 `"merged"`。Bitbucket 在合并响应中告知这一点，还是需要重新读取？

---

## 5. Pull requests、评论及其余 {#5-pull-requests-comentários-e-o-resto}

- `openPullRequest`——Bitbucket 如何标识源和目标？直接接受分支名，还是需要连同仓库一起的对象（与 fork 之间的 PR 相关）？
- `GitPullRequest` 需要 `id` **和** `number`
  （`packages/shared/src/index.ts:211-218`）。Bitbucket 这两个概念是分开的，还是只有一个？如果只有一个，每个字段里放什么？
- `commentOnPullRequest`——哪个端点，评论需要是 PR 级别的（而非 diff 行级别）吗？QA/SecOps 的 gate 在整个 PR 上发布意见。
- `getFileContent`——哪个端点返回某分支上文件的原始内容？对于文件缺失和分支缺失，它是否同样返回 404？合约要求在**两种**情况下都返回 `null`，不抛出。
- `commitFiles`——合约在**一条消息中提交多个文件**
  （`CommitFilesInput.files`）。Bitbucket 支持一次调用完成，还是每个文件一次？如果需要逐个，结果就不是原子的，这需要写进 ADR。

---

## 6. 错误：status → 类的映射 {#6-erros-o-mapa-de-status--classe}

重复现有 provider 遵循的模式：**按 HTTP status + 正文标记决定**，绝不按整条消息的子串。

用官方文档的证据整理：

| 情况 | Bitbucket 返回的 status | 规范化类 |
|---|---|---|
| 仓库名已被占用 | ? | `GitRepoAlreadyExistsError` |
| 仓库不存在 | ? | `GitRepoNotFoundError` |
| 分支/ref 不存在 | ? | `GitBranchNotFoundError` |
| 分支已存在 | ? | `GitBranchAlreadyExistsError` |
| 令牌没有权限 | ? | `GitPermissionDeniedError` |
| 速率限制 | ? | **不是** `GitPermissionDeniedError`——见 GitHub 在 `github-provider.ts:75-77` 中的谨慎处理 |

特别注意有歧义的 404 对：如果“仓库不存在”和“令牌看不到仓库”返回**相同**的 404，provider 就无法区分 `GitRepoNotFoundError` 和 `GitPermissionDeniedError`。这是正当的限制——而抛出哪一个的决定需要写下来，而不是隐含。

---

## 7. 重试 {#7-retry}

`apps/api/src/infrastructure/git/retry.ts` 做 Full Jitter，4 次尝试，**只针对读取**（`docs/adr/0003`）。

- Bitbucket 是否以可区分的方式提示速率限制（header、专用 status）？如果存在 `Retry-After`，值得遵守吗？
- Bitbucket 有没有哪种写入是幂等到值得重试的？默认答案是否——重复写入就是制造重复数据的方式。

---

## 8. 没有真实凭据时如何验证 {#8-como-validar-sem-credencial-real}

模式已经存在，应当照搬：CI 中用 mock，smoke 放在环境变量之后。

- 假后端放在 `apps/api/test/support/msw/`（参考
  `github-fake-backend.ts` 和 `fake-repo-store.ts`）。
- smoke 以 `describe.skipIf(!token)` 运行**同一**套件，遵循
  `apps/api/test/infrastructure/git/github-provider.smoke.spec.ts:37` 的模式。

> smoke 的环境变量将遵循 `BITBUCKET_TEST_TOKEN` 的模式。如果第 1 项选定的认证机制需要不止一个值，名称和形式都会改变——这同样是需要登记的决定。

---

## 不要做什么 {#o-que-não-fazer}

- 不要通过类比 GitHub 或 GitLab 来推断行为。这两者在分支保护上已经彼此不同；按另外两者的模式去假设第三个，正是悄悄累积债务的方式。
- 没有套件场景针对它通过，就不要声明 capability 为 `true`。
- 不要让问题悬而未决却照样编码。如果官方文档没有回答，**那就是答案**——它变成 ADR 中声明的限制，就像第 9b 阶段声明 `listModels: false` 而不是去猜测解析方式那样。
