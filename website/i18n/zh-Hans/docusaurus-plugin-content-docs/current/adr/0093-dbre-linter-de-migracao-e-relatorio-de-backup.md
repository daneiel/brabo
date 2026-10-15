---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0093 — `dbre` 角色变成两个脚本：迁移 linter 和备份报告

- **状态：** 已接受
- **日期：** 2026-08-17
- **背景：** 产品所有者决定提前 `docs/fluxo.yml`（ADR 0085）中声明的 `dbre` 角色的一部分，不等待触发条件（“volume real de dados”）触发
- **修订：** `docs/fluxo.yml`，块 `id: dbre`

## 背景 {#contexto}

`docs/fluxo.yml`（ADR 0085）已经把 `dbre` 声明为 `proposto`，由 `dev-lead`（迁移评审）和 `platform`（调优，激活时）吸收，分离标准是：“volume real de dados no projeto gerenciado
(hoje o risco é de SCHEMA, não de carga)”。

这句话已经包含了尚待执行的答案。在该角色的四个目标交付物中——`parecer-de-migracao`、`plano-de-capacidade`、`backup-restore-testado`、`tuning`——只有两个真正依赖真实的数据量：

- **`plano-de-capacidade`** 和 **`tuning`** 需要真实的负载才有意义。没有它就模拟它们会是编造数字——与 [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) 已经对模型评分、[ADR 0077](0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md) 对能力排名拒绝的同一类错误。
- **`parecer-de-migracao`** 是对 SQL 文本的**静态**分析：一个风险模式（`DROP COLUMN`、`ALTER COLUMN ... TYPE`、不带 `DEFAULT` 的 `ADD COLUMN ... NOT NULL`）无论被管理的数据库有十行还是一千万行都是有风险的。
- **`backup-restore-testado`** **今天**就已经是真实且经过测试的——备份 CronJob 自 Fase 5 起运行，写入 `backup_runs`，恢复步骤也**真正执行过**（`docs/runbook.md#restore`，针对约 108 KB 的数据库，真实 RTO 约 40s）。缺的只是一种按需**读取**这一状态、并格式化为报告的方式。

两者都不需要 LLM agent（没有要做的自然语言判断——是 SQL 文本中的模式识别和读取一张表），也不需要 engine 的 `GenServer`（没有长期状态也没有循环——每次执行都是一次性读取，由人或 CI 触发）。决定是把它们当作它们本来的样子：两个机械脚本，与 `scripts/ci/pr-police.ts` 和 `apps/api/scripts/medir-execucao.ts` 同类。

## 决策 {#decisão}

1. **`apps/api/scripts/lint-migracao.ts`** 扫描**所有** `apps/api/src/db/migrations/*.sql`（没有 `--projeto`——这是对仓库的分析，而不是对某次执行的分析），逐行标记五种风险模式：`DROP TABLE`、`TRUNCATE`、`DROP COLUMN`、`ALTER COLUMN ... TYPE`/`SET DATA TYPE`，以及不带 `DEFAULT` 的 `ADD COLUMN ... NOT NULL`。逻辑是**纯**的（`lintarConteudo`，接收 SQL 的名称 + 文本，返回发现），与 I/O 适配器（`lintarDiretorio`/`principal`）分开，与 `pr-police.ts`（`avaliarPr`）同样的设计。注释行会被忽略，因为本仓库的注释在散文中引用这些模式本身，以解释为什么**避免**了它们（真实案例：`0042_tough_captain_midlands.sql`，第 3 行）。发现任何出现时以 `!= 0` 退出。
2. **`apps/api/scripts/relatorio-backup.ts`** 用与 `DomainGaugesCollector.collectBackup()` **相同**的逻辑读取 `backup_runs`（最近一次**成功**——年龄、大小——以及**最近一次**执行如何结束），格式化为按需报告——不是 Prometheus gauge，而是给想要立刻得到答案的人的一次性读取。它引用已经测试过的恢复步骤，而不是重新执行它。分类逻辑（`avaliarBackup`）是纯的，可以用模拟的 `backup_runs` 测试。
3. **两者暂时都不进入 CI**——见后果。
4. **`docs/fluxo.yml`**：`dbre` 从 `status: proposto` 变为 `status: active`。`entregaveis_alvo`（扁平列表）变成 `entregaveis`（带 `status` 的对象列表）：`parecer-de-migracao` 和 `backup-restore-testado` 标为 `real`，附上证明它们的机制；`plano-de-capacidade` 和 `tuning` 保持 `lacuna`，附上明确的原因。`hoje_absorvido_por`/`criterio_de_separacao` 继续留在块中，现在只描述剩下的部分——每批**一个**迁移的规则（`meta/_journal.json`）**不再**被称为“该角色的机械化版本”：它避免的是并行 agent 之间快照的**冲突**，这与“这个 SQL 有风险模式”是正交的关注点，后者现在有了自己的机制。

## 后果 {#consequências}

- **linter 扫描整个**仓库**，而不是某个 PR 的 diff。** 针对今天真实的迁移运行它，会在已经合并并接受的迁移中**发现**三处——`0006_whole_princess_powerful.sql:22` 和 `0034_quick_saracen.sql:33`（`DROP COLUMN`）、`0007_groovy_bullseye.sql:2`（`ALTER COLUMN ... SET DATA TYPE`）。这不是要修正的缺陷：它们是已经作出并接受的决定，顺带修正它们会抹去它们为何存在的证据（与 CLAUDE.md 对发现 Z/AD/AE 的规则相同）。这正是该脚本**没有作为 CI 步骤进入**的原因：一个扫描整个仓库的闸门会永远让每个 PR 失败，原因却是不属于它们的发现。把它变成真正的闸门需要与 `pr-police.ts` 相同的技术——把范围限定在与 PR 基线的 diff——留待 `dbre` 真正需要**阻止**合并时；今天它是意见而不是裁决，手动运行（`pnpm --filter api lint:migracao`）。
- **备份报告不会重新执行恢复。** 它只复用 `collectBackup()` 已经在做的读取；恢复本身的步骤已经测试并记录（`docs/runbook.md#restore`）。混淆两者会让脚本的范围膨胀，去重新实现已经存在且能用的东西。
- **“备份延迟”的阈值（26h）是复制的**，而不是从告警 `brabo-backup-atrasado`（`deploy/k8s/observability/alerts/brabo-alerts.yaml`）导入——Grafana 的 YAML 不会被脚本的 Node 进程读取。如果有人改了一边而忘了另一边，两个数字可能会分歧；这是有意识地接受的，与代码中任何重复阈值的代价相同。
- **`plano-de-capacidade` 和 `tuning` 仍然是缺口**，在 `docs/fluxo.yml` 中声明，没有期限。分离它们的触发条件仍然是**被管理**项目中的真实数据量——不是 Brabo 自身的 `token_usage`/`session_events` 的量（它已经很大），而是 agent 构建的产品的数据量。
