---
traducao_de: 122ec00d6ff5390cc968dd5404c70d8661e896e4
---

# 0212 — 已归档的故事：一列，而不是状态机中的一个状态

## 状态 {#status}

**已接受。** 2026-10-03（AT-406；所有者于 10月3日的决定：“PO e usuário”——PO 和 Backlog 标签页可以编辑和归档没有执行中任务的 `draft` 故事）。规则见 [RN-727](../business-rules.md#rn-727)。

## 背景 {#context}

在 10月3日的 TP-01 中，PO 创建了两个重复的故事，却没有办法删除它们：它的工具是 `create_epic`、`create_story`、`create_task` 和 `complete_story`，而 Backlog 标签页是只读的。这些重复项得到了任务，进入了 Dev Lead 的计划，并让 Arquiteto 感到困惑。决定是允许**归档**（以及更正标题），而不从日志中删除任何东西。

权衡了三种表示“已归档”的方式：

1. **`story_status` 中的新值。** 否决：`status = 'ready'` 是可认领性（`claimNext`）的闸门，而状态机（`story-state-machine.ts`）关注的是故事的进展。归档只从 `draft` 发生，本次交付中不可撤回，也不是一个进展步骤——把它放进枚举会迫使每个状态转换都得知道它。
2. **删除该行。** 被所有者的决定和产品的约定否决：做过的事情保留下来，而引用该故事的任务和事件会继续指向一个已消失的东西。
3. **`stories` 中的列 `archived_at`（以及 `archived_reason`）。** 采纳。

## 决策 {#decision}

- `stories` 增加 `archived_at timestamptz NULL` 和 `archived_reason text NULL`（迁移 `0069`），位于 backlog 聚合的文件中（ADR 0121）。`NULL` 表示故事仍在局中。
- 每个做**决定**的读取都过滤 `archived_at IS NULL`：backlog 和覆盖率（`findByProject`）、晋升队列（`listProposedReady`）、Dev Lead 的计划（`findInProjectByIds`）以及认领和可认领计数（`claimNext`、`countClaimableByModule`）。**任务**随故事退出——`tasks` 中没有新列。`findById` 仍能找到已归档的故事，用于具名拒绝和审计。
- 归档在**同一次**写入中关闭 `proposed_ready`（故事在归档后绝不会残留为“等待你”）。
- 事实以**新的**、不可变的事件进入日志：`backlog.story_archived`（`storyId`、`title`、`reason`、`taskIds`）和 `backlog.story_updated`（`storyId`、`previousTitle`、`title`、`descriptionChanged`）。前缀 `backlog.` 沿用该聚合已有的事件（`backlog.story_created`、`backlog.story_promotion_returned`）。
- 两个入口——PO 的工具和用户的路由——只用一把尺子（`recusaDeCorrecaoDeHistoria`），返回具名的 409。

## 后果 {#consequences}

- 本次交付中不存在取消归档：该列允许它，但那是另一项产品决定，不在此作出。
- 已归档的故事从 `listar_backlog` 中消失（PO 看不到它，以免再次完成它）；需要了解它的人去读会话日志中的事件。
- 用户的最低角色是 `developer`，与晋升和退回相同（RN-048）——没有新角色。
