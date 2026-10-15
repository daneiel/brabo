---
traducao_de: a58e2abe46dee1d68d49868a5df5911c6c19683e
---

# 0217 — QA 处于测试阶段时，`dev` → `qa` 自动晋升

## 状态 {#status}

**已接受。** 2026-10-15（AT-555，所有者于 10月15日的决定）：*"Para ganharmos agilidade, uma regra de auto merge em qa quando houver merge em dev, e um aviso de que, enquanto estiver em fase de teste, a qa ainda não será considerada."*

主题：`git`。修订（不编辑）ADR 0030 的晋升流程（晋升合并作为手动行为）及其审批阶梯，只针对 `dev` → `qa` 这一对，且只在变量开启时。ADR 0073（发布路径以环境命名）不变：改变的是 `/brabo/qa/` 发布的频度。

## 背景 {#contexto}

`dev` → `qa` 的晋升一直是手动的：`promote.yml`（`workflow_dispatch`）计算版本，并通过 `BRABO_BOT_TOKEN` 打开 PR，由 owner 批准并合并。由于 `qa` 还没有作为经过验证的环境被使用，这一步每个周期都要付出一次人工操作，却没有保护任何有人在消费的东西。

仓库没有必需检查：`gh pr merge --auto` 会立即合并，不等 CI。把合并自动化，要求**等待**由自动化来负责。

## 决策 {#decisão}

1. **工作流 `promote-auto-qa.yml`**，在 `dev` 的 `push` 上运行，且仅当仓库变量 `QA_FASE_DE_TESTE == 'true'` 时。它运行**相同**的版本计算（`scripts/ci/promote.ts`）和**相同**的打开步骤（`scripts/ci/abrir-pr-de-promocao.sh`，从 `promote.yml` 中抽出），通过 `BRABO_BOT_TOKEN` 打开或更新 `dev` → `qa` 的 PR。
2. **等待与合并**由 `scripts/ci/promocao-automatica.ts` 完成：读取 head 的 check run，直到**全部**结束；只有在没有任何一个以 `failure`、`cancelled`、`timed_out`、`action_required`、`startup_failure` 或 `stale` 结束时，才以 merge commit（并带 `--match-head-commit`）合并。零个检查意味着等待，绝不合并。任何失败都会停止晋升，并在作业摘要中写明是哪个检查以及链接。等待上限 50 分钟。Concurrency `promote-auto-qa`，不取消。
3. **空周期在自动晋升中不是失败**（`cicloVazioEhFalha`）：没有新工作的 `dev` push——晋升合并、回合并、`dev` 已与 `qa` 相同——以 0 退出，带 `::notice::`，并在摘要中写“nada a promover: o ciclo está vazio”，不打开 PR。反复出现的红色会教人忽视红色。在手动的 `promote.yml` 中仍是失败。
4. **没有 `BRABO_BOT_TOKEN` 时，可见地失败**：作业以红色退出并说明这一点。默认 token 打开的 PR 其检查会处于 `action_required`，而它的合并不会触发 `tag-release` 和 `docs-deploy`。
5. **阶梯**（`scripts/ci/approval-ladder.ts`，`ehPromocaoAutomaticaDaFaseDeTeste`）**仅当**这一对是 `dev` → `qa`、变量开启、且 PR 作者是 `BRABO_BOT_TOKEN` 的用户时才免除审批——该用户在工作流中用这个 secret 本身通过 `gh api user` 解析，绝不用固定名字。原因写在检查的摘要中。`qa` → `main` 以及任何其他组合在两种模式下仍要求审批。
6. **提示**：发布在 `/brabo/qa/` 的站点获得固定的 `announcementBar`，自动 PR 的正文以同样的文字开头——*"Fase de teste: a QA é promovida automaticamente a cada merge na dev e ainda não é considerada ambiente validado."*

## 后果 {#consequências}

- 每次 CI 为绿的 `dev` 合并都会变成一个 `-qa.N` tag（`tag-release` 在 `qa` 的 push 上运行），`N` 改为计数合并，而不是验证轮次。
- `/brabo/qa/` 在每次 `dev` 合并时重新发布。
- 变量的开关无需改代码：删除它或改变其值就回到手动的 `promote.yml`，阶梯也恢复要求 owner。
- `qa` → `main` 保持不变：手动、需审批，最终 tag 只在最后一个 `-qa.N` 的提交上产生。
- 如果 `BRABO_BOT_TOKEN` 的用户就是 owner 本人，阶梯本来就因作者身份（`solo` 模式）通过；新的免除只改变写下的原因。
- 声明的代价：变量开启期间，`qa` 不再是经过验证的候选——这正是提示所说的。
