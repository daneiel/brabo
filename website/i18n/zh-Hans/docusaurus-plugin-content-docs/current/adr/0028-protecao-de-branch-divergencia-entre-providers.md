---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0028 — 分支保护：provider 之间的分歧与审批矩阵

## 背景 {#contexto}

[ADR 0001](0001-git-provider-contract-shape.md) 把九个 git 操作规范化为一个统一的契约。其中八个在 GitHub 和 GitLab 之间只在 API 的**形式**上有分歧——字段名、id 格式、错误码——规范化解决了它们。`protectBranch` 是例外：在那里两者在**模型**上有分歧，翻译不可能不丢失含义。

这一分歧自 Fase 2 起就以注释的形式记录在两个 provider 中。本 ADR 把它提升为明确的决定，因为从 Fase 4 起，领域有了**自己的审批矩阵**——QA → SecOps → 用户，以及 `decide.ts` 中合并锁的上限——于是对同一次合并存在了两个权威来源。写那条注释时，这种重叠还不存在。

## O que cada provider faz hoje {#o-que-cada-provider-faz-hoje}

`ProtectBranchInput`（packages/shared）**只**携带 `externalId`、`branchName` 和 `accessToken`——没有任何策略配置。每个实现都选择“最严格的合理做法”，而这落在不同的地方：

| provider | 平台的模型 | 我们应用的 |
|---|---|---|
| **GitHub** | 一个丰富 payload 中的独立规则 | `enforce_admins: true`、`required_approving_review_count: 1`、无 status check、无 push 限制 |
| **GitLab** | 两个访问级别 | `pushAccessLevel: MAINTAINER`、`mergeAccessLevel: MAINTAINER` |
| **local** | 不存在平台 | `capabilities.protectBranch: false`；调用以 `GitNotSupportedError` 拒绝 |

bootstrap 的 `protect_branches` 步骤在行动前查询能力，而契约测试套件按**能力**而不是按 provider 断言——所以这一分歧从未让测试失败：对契约而言，两条路径同样有效。

## A assimetria que a matriz de aprovação expõe {#a-assimetria-que-a-matriz-de-aprovação-expõe}

这两种保护不是“同一件事的不同写法”。它们与领域矩阵的交互方式截然相反：

- **在 GitHub 上，我们创造了第二个权威。** `required_approving_review_count: 1` 要求一个领域不知道、也不会去填补的**平台**审批——QA 和 SecOps 的意见是我们的事件，而不是 GitHub 的 review。再加上去掉管理员绕过的 `enforce_admins: true`，用户的手动合并——CLAUDE.md 规定它是强制的——在没有第二个人来批准 PR 时，可能会**被平台阻止**。
- **在 GitLab 上，我们没有创造任何权威。** 没有审批计数：拥有 Maintainer 角色的人可以直接 push 和合并。领域的矩阵是**唯一**的闸门，而一个 Maintainer token 可以完全绕过它。
- **在 local 上，按构造只存在领域的闸门。**

也就是说：同一个系统，用同一个不带参数的 `protectBranch()`，在一个 provider 上比预期更僵硬，在另一个上则更松。

## 决策 {#decisão}

**1. 领域的审批矩阵是事实来源。** QA → SecOps → 用户，以及 `decide.ts` 的上限（目标为受保护分支的合并绝不可自动批准）。平台的保护是针对绕过 Brabo 的访问的纵深防御——它不是闸门，领域的任何逻辑都不应依赖它。

**2. 分歧保留。** 把两个模型翻译成一个公分母，意味着要么把 GitHub 降到 GitLab 的水平（失去 `enforce_admins`），要么在 GitLab 中发明一个平台在免费层级中没有的审批概念。每一方都应用它能表达的最严格的东西，而契约只承诺可观察的部分：`listBranches` 返回 `protected: true`。

**3. `ProtectBranchInput` 现在**不**增加配置。** 增加 `requiredApprovals`、`enforceAdmins` 之类，会造出一套只有一个 provider 能兑现、另一个只能静默忽略的词汇——这比当前的分歧更糟，因为它会开始说谎。当真正有需要时，路径是一个规范化的 `ProtectionPolicy`，由 provider 通过 `capabilities` 声明它能应用什么，并由 bootstrap 报告被忽略的部分。

## 后果 {#consequências}

**接受的：**

- 按 provider 不同的僵硬程度，记录在这里以及两个文件的注释中，这些注释开始指向本 ADR。
- 在 GitHub 上，一个只有单一所有者的仓库，可能会因我们应用的保护本身而阻止手动合并。绕过方法属于运维者（在仓库中把 `required_approving_review_count` 降为 0），而不属于代码——默认改变它会为了解决一个特例而放松每个仓库的保护。

**未验证的：**

- **这两条路径都没有在本仓库中针对真实 API 演练过。** 冒烟测试（`github-provider.smoke.spec.ts`、`gitlab-provider.smoke.spec.ts`）是手动的，没有 `GITHUB_TEST_TOKEN` / `GITLAB_TEST_TOKEN` 时会被跳过；CI 使用 `LocalGitProvider`，其能力为 `false`。上面描述的合并阻止是从两个平台的文档行为推导出来的，而不是观察到的。**接入第一个真实仓库时，验证这一点是要做的第一个测试。**

**范围之外的：**

- 把 QA/SecOps 的意见反映为 GitHub 的 status check，这会通过把领域矩阵变成平台的合并条件来消除重叠。这是正确的解决方案，它依赖于 Brabo 有一个供 GitHub 调用的公共端点——见 [ADR 0027](0027-fase5-backup-hardening-release.md) 中待处理的 registry/暴露项。
