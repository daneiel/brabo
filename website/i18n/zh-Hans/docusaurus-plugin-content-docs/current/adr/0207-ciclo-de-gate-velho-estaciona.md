---
traducao_de: 36da3628893047b803131fbe7b06c832f6a3081d
---

# ADR 0207 — 停滞超过 2 小时的 gate 周期会被搁置，只有人工操作才能恢复

## 状态 {#status}

**已接受。** 2026-10-02（AT-391，所有者于 10月2日的决定）。修订（不编辑）[ADR 0067](0067-o-gate-sobrevive-ao-restart.md)：自动救援继续存在，但加上年龄上限。

## 背景 {#context}

ADR 0067 让 `GateRescuer` 在启动时和每个 tick 自动恢复所有停滞超过 15 分钟的 `in_progress` 周期。10月2日的真实使用暴露了三个问题：（1）它重启了一个周期，而该周期的会话中有一个待 `qa-*` 参与者处理的 `proposed_action`——周期在等一个人，该领域被再次付费，而该动作将成为孤儿；（2）“进程存活”的检测是按**项目**的，而记录行是按 TASK 的，于是一个丢失的周期 8 小时没有被救援，因为项目的 QA Lead 存活且空闲；（3）没有上限：一个几个小时没人看的周期，会在可能已经改变的上下文上被完整重启。

## 决策 {#decision}

1. **存活按 task 判断。** 救援去问 lead（`{:em_voo?, task_id}`）；忙到无法回答的 lead 视为存活。
2. **待处理的人工决定会阻止救援。** 周期所在会话中有 gate 参与者（`qa*`、`secops*`、`appsec`）的 `pending` 动作：只记日志。
3. **上限 2 小时，按最后活动计算。** 年龄从 `updated_at` 算起——与 staleness 阈值用的是同一列——而不是 `inserted_at`：`upsert!` 每个子 agent 都会更新 `updated_at`，所以一个仍在推进的周期不算老；从创建时间算会把又长又活的周期搁置。超过上限时，该行获得 `parked_at`，会话日志获得 `gate.rescue_parked`（task、gate、年龄、原因），扫描不再看到它——启动和 tick 都是。
4. **恢复需要人工操作**，通过 `GateRescuer.retomar_estacionado/3`。同一周期新的进行中条目会清除该标记。

## 后果 {#consequences}

- 原先没有恢复 gate 周期的人工路径；交付的最小实现是 engine 的函数，由运维人员调用。内部路由和事件上的按钮保留为提议，尚未实现。
- 待处理项按**会话**读取，而不是按 task：`proposed_actions` 没有 `task_id`。同一会话中两个 task 都有待 QA 处理的动作时会互相阻止——代价已接受，最坏情况是不救援，绝不会付两次钱。
- 规则：[RN-722](../business-rules.md#rn-722)，它修订了 RN-140。
