---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
---

# 输入 3 — GenericGitProvider：最小 capabilities 与降级

给 PO 的第 10 阶段输入材料。

`GenericGitProvider` 是面向“任意 git 服务器，没有平台 API”的 provider：自托管的 Gitea、位于 SSH 之后的 bare repo、Forgejo、只讲 git 协议的服务器。作为问题，它与 Bitbucket 正好相反——那里的挑战是翻译一个丰富的 API；这里是**诚实地声明做不到什么**，并保证系统的其余部分会降级而不是崩溃。

要满足的合约在 `inputs/01-contrato-gitprovider.md` 中。

---

## 先例已经存在：`LocalGitProvider` {#o-precedente-já-existe-localgitprovider}

它在精神上并不是一个新 provider——它就是远程放在别处的 `LocalGitProvider`。史诗需要决定的一切在那里都已有答案，最省事的路径是在设计任何东西之前先读那个文件
（`apps/api/src/infrastructure/git/local-git-provider.ts`，467 行）。

它所确立的：

- **声明 `protectBranch: false`** 和 `pullRequests: true`
  （`apps/api/src/infrastructure/git/local-git-provider.ts:55-58`）。
- **以 `GitNotSupportedError` 拒绝不支持的操作**，绝不沉默（`:137`，以及在 `:290` 和 `:323` 中针对没有真实 PR 的合并路径）。
- **在没有平台的情况下实现真正的 PR**：在 bare repo 的 sidecar 中一个轻量的 PR store，为第 4a 阶段的 dev agent 而做（`:51-54`）。也就是说，没有 PR 服务器的 `pullRequests: true` **是可能的**——问题在于状态住在哪里。
- **讲真正的 git**，通过对二进制的 `execFile`，而不是重新实现。

---

## 核心问题：服务器不保存的状态住在哪里 {#a-pergunta-central-onde-mora-o-estado-que-o-servidor-não-guarda}

纯 git 服务器只知道 ref、对象，别无其他。它没有 PR，没有评论，没有分支保护。合约的十个操作对每一种缺失都需要一个答案。

| 操作 | 纯 git 服务器知道吗？ | 预期答案 |
|---|---|---|
| `createRepo` | 视情况而定——创建远程仓库需要 API 或磁盘访问 | 调查；可能就是缺失的那个 capability |
| `getRepo` | 部分——可以通过 `ls-remote` 发现 `defaultBranch` | 很可能是 |
| `createBranch` | **是**——就是 push 一个 ref | 是 |
| `protectBranch` | **否** | `false` + `GitNotSupportedError` |
| `commitFiles` | **是** | 是 |
| `listBranches` | **是**——`ls-remote --heads` | 是，`protected: false` 恒定 |
| `openPullRequest` | 原生**不**知道 | 决定：自有 store（像 Local 那样）或 `false` |
| `mergePullRequest` | 原生**不**知道 | 同上 |
| `commentOnPullRequest` | **否** | 同上——而这是 gate 所用的 |
| `getFileContent` | **是**——`git show ref:path` | 是，两种缺失情况都返回 `null` |

**架构决策只有一个：** Generic 复用 `LocalGitProvider` 的 PR 机制（并因此声明 `pullRequests: true`），还是声明 `false` 并接受级联降级？两者都站得住。站不住的是声明 `true` 却抛出 `GitNotSupportedError`——合约测试套件刻意会拒绝这一点。

---

## “声明 `false`”在级联中的代价 {#o-que-declarar-false-custa-em-cascata}

在选择之前，需要知道会失去什么。声明 `pullRequests: false` 不是 provider 的细节——它会关闭产品的一部分。

- **QA 和 SecOps 的 gate** 在 PR 上发布意见
  （`commentOnPullRequest`，第十个操作，在第 4a 阶段为此而生）。
  没有 PR，意见作为工件存在于 event log 中，却不会出现在仓库里。
- **dev agent 的流程**在完成 task 时开 PR。
- **受保护合并锁**（`decide.ts:149-160`）继续有效——它属于领域，而不是平台。这很重要：**服务器上没有保护并不会放松任何东西**，因为阻止不当合并的是领域中的上限。

史诗需要明确说明在 Generic 中这些各自会发生什么。“降级”不是答案——降级**成什么**才是。

---

## bootstrap 中的降级：机制已经就绪 {#degradação-no-bootstrap-o-mecanismo-já-está-pronto}

**RN-029**——Gitflow bootstrap 是幂等且可恢复的；共有六个步骤，每一步在行动前先检查，`skip` **就是成功**
（`apps/api/src/application/use-cases/git/bootstrap-steps.ts`）。

对于没有 `protectBranch` 的 provider，`protect_branches` 步骤不会失败：它以 **`degraded`** 结束，这同样是成功。事件
`bootstrap.step_degraded` 正是为“在缺少 provider 某项 capability 的情况下完成”而存在——见 `docs/reference/events.md` 的“Git e bootstrap”一节。使用 Local provider 时，这在今天的每次执行中都已发生。

也就是说：**降级不需要构建，需要声明。** 系统早已知道如何处理缺失的 capability；它不能原谅的是被谎报的 capability。

---

## “最小”具体意味着什么 {#o-que-mínimo-significa-concretamente}

一个 provider 在以下情况下被接受：

1. 十个操作都存在——即使其中一些只会抛出
   `GitNotSupportedError`（`apps/api/src/domain/git/git-errors.ts:51`）。
2. 两个 capabilities 反映现实
   （`packages/shared/src/index.ts:182-185`）。
3. 唯一测试套件的 **19 个场景**通过，无需编写自己的场景
   （`apps/api/test/contract/git-provider.contract.ts`）。`protectBranch`、`openPullRequest`、`mergePullRequest` 和
   `commentOnPullRequest` 的场景验证的恰恰是声明的 flag 与行为之间的一致性——为 `true` 时可用，为 `false` 时拒绝。

**RN-028** 封住了这条规则：由 capability 决定，而不是由 provider 的名字决定。任何消费者都不能获得 `if (provider.name === 'generic')`。如果有消费者需要，问题在于 capabilities 的建模，而不在消费者——那就要写 ADR。

---

## 留给 Arquiteto 的开放问题 {#perguntas-em-aberto-para-o-arquiteto}

- **配置。** Generic 需要远程的 URL，可能还需要凭据。它如何进入？`CreateRepoInput` 有 `name`、`visibility`、
  `namespace` 和 `accessToken`——没有一个是“服务器 URL”。URL 住在哪里：在 `externalId` 中、在 `provisioned_repositories` 的新列中，还是在项目配置中？
- **认证。** HTTPS 令牌、SSH 密钥，还是两者？SSH 密钥无法像令牌那样放进 `accessToken?: string`，而
  `credentialProviderEnum`（`apps/api/src/db/schema.ts:198-203`）无论如何都需要新条目。
- **`visibility`。** `GitRepo` 要求 `"public" | "private"`
  （`packages/shared/src/index.ts:187-193`）。纯 git 服务器可能没有这个概念。返回什么——一个声明的默认值，还是让它成为合约中的可选字段？
- **`createRepo`。** 如果 Generic 不会创建远程仓库，它对当前总是调用 `createRepo` 的向导就毫无用处
  （`provision-repository.use-case.ts:144`）。这与任务中的 P1 发现相关：产品不知道如何采纳现有仓库。**Generic 可能恰恰就是让那个发现变得紧迫的 provider**——值得 Arquiteto 评估两者能否一起解决。
- **安全。** 用户提供的任意服务器 URL 是 SSRF 的攻击面。在做决定之前，值得检查 `docs/security-surface.md` 如何处理网络出站。

---

## 不要做什么 {#o-que-não-fazer}

- 不要为了能把一切都声明为 `true` 而“随便”实现这十个操作。capability 的诚实才是要求；完整性不是。
- 不要逐字复制 `LocalGitProvider`。复用的是**决策**（PR 状态住在哪里），不一定是代码。
- 不要在任何消费者中按 provider 名字写 `if`。
