---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0102 — 修订 ADR 0065：外部效果的边界不再是 `deny`，而是绝对上限

- **状态：** 已接受
- **日期：** 2026-08-20
- **背景：** 产品所有者关于 git/sudo 政策的**全局**决定，RN-418（修订 RN-106）
- **修订：** [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

## 背景 {#contexto}

[ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) 当时决定，`git push`、开 PR 和部署绝不经由终端——规则是无条件的 `deny`，在 `decide()` 中任何宽松阶段**之前**应用，并以消息引导到**类型化**动作（`git_push`/`git_merge`/`pr_open`）。之所以用 `deny`（而不是 `require_approval`），声明的理由很具体：存在“sempre permitir”，一次点击就会把模式写入 `permissions.json` 的 `allow`，从而永远打开这扇门——直接拒绝是确保这扇门永不打开的唯一方式。

产品所有者**明确**且**全局**地要求改变语义：`sudo`/`doas` 和带 git 外部效果的终端命令必须**始终**请求人工授权——绝不可自动批准，即使开启了“modo automático”——而任何**其他**命令在自动模式开启时都应自动批准。这与 `deny` 不同：它是“总是变成待处理的 `proposed_action`，逐案决定”，而不是“总是被拒绝，什么都不产生”。

在实现过程中，一个自动安全系统标记了这一变更（修改一条 CLAUDE.md 本身描述为绝对 `deny` 的规则，值得加倍审视）——产品所有者在审阅变更后明确确认，决定确实如此。

## 决策 {#decisão}

`git push`/开 PR/部署（RN-106，已修订）和 `sudo`/`doas`（新）离开边界块（它紧跟在 IAM 之后，返回 `deny`），变成**绝对上限**——位于其他上限已经所在的**同一个**末尾块中（受保护分支合并、`instruction_patch`、`parallelize`/`raise_max_parallel`、路径范围），采用**同样**的代码模式（`current.policy === 'auto_approve'` → 覆盖为 `require_approval`）。按构造，即使 `agent_autonomy` 对通配符 `"*"` 说 `auto_approve`，即使 `permissions.json` 中有一条会匹配的 `allow` 条目，上限依然有效。

**“sempre permitir”的缝隙在源头被关闭**，这是本 ADR 安全的必要条件：`ApproveAlwaysActionUseCase`/`patternForAction` **拒绝**为带 git 外部效果或特权命令的终端动作把模式写入 `allow`。用户仍然可以通过正常的审批流程批准**该具体实例**——只有“sempre permitir”（会永久写入）被拒绝，并附上解释原因的清晰消息。没有这后一半，绝对上限就成了装饰——一次点击就足以重新打开它声称关闭的门。这正是 ADR 0065 当初主张 `deny` 的论点，只不过是在源头解决，而不是阻断症状。

`sudo`/`doas` 在 `external-effect.ts` 中获得专门类别（`comandoPrivilegiadoNoComando`），按**动词**在命令的任意片段中匹配（与 git 的 `efeitoExternoNoComando` 原则相同）。它们没有可以引导到的对应类型化动作——消息只解释该命令为什么需要人工决定。

## 后果 {#consequências}

- 这里的 `require_approval` 在“agent 能独自完成”的意义上并不比 `deny` “更弱”——在**两种**状态下，命令都不会在没有明确人工决定的情况下执行。区别纯粹在于**机制**：以前，git 的终端路径被阻断，只存在类型化动作（它本来就总是需要审批）；现在，终端路径本身也能变成待处理的 `proposed_action`，在事件日志中可审计，逐案决定——这与产品其余部分一致，产品偏好可追踪的待处理动作，而不是无声的拒绝。
- 这是 `decide()` 无条件应用的绝对上限尺子中的第四/第五条——从现在起，CLAUDE.md 和约定文档需要把这条上限与其他上限一起计算。
- 本地 runner 的引擎（ADR 0103）是这一变更最直接的使用者：没有它，用户机器上一个合法的 `sudo` 会落入通用的 `require_approval`（如果哪天 `permissions.json`/auto mode 因疏忽覆盖了这个动词，就无法保证它永远不会变成可自动批准）——绝对上限按构造而不是按约定关闭了这一风险。
