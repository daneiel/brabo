---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0204 — 自动模式放行 push 和 PR

## 状态 {#status}

**已接受。** 2026-10-02（AT-385；所有者于 10月2日的决定：*"permitir sim o auto promove de todo e qualquer agente se o agente estiver no modo auto"*，并确认这同样适用于 dev agent 的 `git push` 和开 PR）。修订（不编辑）[ADR 0102](0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md)（外部效果的绝对上限，RN-418）和 RN-689（同一上限经由类型化入口），仅限 push 和 PR 那一半。保留 [ADR 0167](0167-modo-automatico-libera-o-escopo-de-caminho.md) 和 [ADR 0189](0189-o-piloto-automatico.md)。

## 背景 {#context}

自 RN-418 起，`git push`、开 PR、部署以及 `sudo`/`doas` 在 `decide()` 中都是无条件的 `require_approval`，即使开启了自动模式；RN-689 把该上限扩展到了类型化动作 `git_push` 和 `pr_open`。有了自动驾驶（ADR 0189），dev agent 已经在容器内自由运行，而自动模式下执行流程唯一仍需停下等待人工决定的地方，就是每个任务的 push 和 PR。

## 决策 {#decision}

1. 在 agent 的**自动模式**下——通配符 `agent_autonomy` `actionType: "*"` 解析为 `auto_approve`（来源 `curinga`）——类型化的 `git_push` 和 `pr_open`，以及经由终端命令达到的同样效果（`git push`、`git remote add/set-url`、`gh pr create`、`glab mr create`），结果为 `auto_approve`，并在 `proposed_action.created` 中带上原因 `modo automático (RN-713)`（RN-567）。
2. **只有**通配符能放行。没有通配符的特定 `auto_approve` 规则、“Sempre permitir”（对 push/PR 仍在源头被拒绝）以及 `permissions.json` 中的 `allow`，仍然落入上限。激活仍然只播种 `git_commit`（RN-689）。
3. 即使在自动模式下仍是绝对上限的：merge（在受保护分支上，经由类型化动作；以及经由终端的 `git merge`/`gh pr merge`）、部署、`sudo`/`doas`、`container_remove`、`instruction_patch` 和并行度。
4. `open_adr_pr`/`open_infra_pr` 之前就遵循自动模式，继续如此。
5. 把开关切回手动，会恢复 push 和 PR 的审批。

## 后果 {#consequences}

- 自动模式下的 dev agent 不停顿地 push 并开 PR；合并到 `dev` 仍是手动的，所以代码只有通过人工点击才能进入永久分支。
- 保证改为来自按 agent 显式同意的自动模式，而不再是上限。代价已声明：误开的 PR 在出现在 provider 之前不会请求确认。
