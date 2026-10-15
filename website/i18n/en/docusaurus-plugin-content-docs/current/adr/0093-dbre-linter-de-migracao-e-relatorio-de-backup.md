# ADR 0093 — The `dbre` role becomes two scripts: migration linter and backup report

- **Status:** Accepted
- **Date:** 2026-08-17
- **Context:** the product owner's decision to bring forward part of the
  `dbre` role declared in `docs/fluxo.yml` (ADR 0085), without waiting for
  the trigger ("real data volume") to fire
- **Revises:** `docs/fluxo.yml`, block `id: dbre`

## Context

`docs/fluxo.yml` (ADR 0085) already declared `dbre` as `proposto`, absorbed
by `dev-lead` (migration review) and `platform` (tuning, once activated),
with the separation criterion: "real data volume in the managed project
(today the risk is SCHEMA risk, not load risk)".

That sentence already contained the answer that was missing execution. Of
the four target deliverables for the role — `parecer-de-migracao`,
`plano-de-capacidade`, `backup-restore-testado`, `tuning` —, only two
genuinely depend on real data volume:

- **`plano-de-capacidade`** and **`tuning`** require real load to mean
  anything. Simulating them without it would be inventing a number — the
  same class of error that [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
  already refuses for model rating and [ADR 0077](0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md)
  refuses for capability ranking.
- **`parecer-de-migracao`** is STATIC analysis of SQL text: a risk pattern
  (`DROP COLUMN`, `ALTER COLUMN ... TYPE`, `ADD COLUMN ... NOT NULL`
  without `DEFAULT`) is risky regardless of whether the managed database
  has ten or ten million rows.
- **`backup-restore-testado`** is already real and tested TODAY — the
  backup CronJob has been running since Phase 5, writes to `backup_runs`,
  and the restore procedure has been EXECUTED for real
  (`docs/runbook.md#restore`, real RTO ~40s against a ~108 KB database).
  What was missing was just a way to READ that state on demand, formatted
  as a report.

Neither one calls for an LLM agent (there's no natural-language judgment
to make — it's pattern recognition over SQL text and reading a table) nor
an engine `GenServer` (there's no long-lived state or loop — each run is a
point-in-time read, triggered by a human or by CI). The decision was to
treat them for what they are: two mechanical scripts, of the same genre as
`scripts/ci/pr-police.ts` and `apps/api/scripts/medir-execucao.ts`.

## Decision

1. **`apps/api/scripts/lint-migracao.ts`** scans ALL of
   `apps/api/src/db/migrations/*.sql` (no `--projeto` — it's analysis of
   the repository, not of a run) and flags five risk patterns, line by
   line: `DROP TABLE`, `TRUNCATE`, `DROP COLUMN`, `ALTER COLUMN ...
   TYPE`/`SET DATA TYPE`, and `ADD COLUMN ... NOT NULL` without
   `DEFAULT`. The logic is PURE (`lintarConteudo`, receives name + SQL
   text, returns findings) separate from the I/O adapter
   (`lintarDiretorio`/`principal`), the same design as `pr-police.ts`
   (`avaliarPr`). Comment lines are ignored, because comments in this
   repository cite these very patterns in prose to explain why they were
   AVOIDED (real case: `0042_tough_captain_midlands.sql`, line 3). Exits
   `!= 0` if it finds any occurrence.
2. **`apps/api/scripts/relatorio-backup.ts`** reads `backup_runs` with the
   SAME logic as `DomainGaugesCollector.collectBackup()` (last SUCCESS —
   age, size — and how the LAST run ended), formatted as an on-demand
   report — not a Prometheus gauge, a point-in-time read for whoever wants
   the answer now. It cites the already-tested restore procedure instead
   of re-executing it. The classification logic (`avaliarBackup`) is pure,
   testable with a mocked `backup_runs`.
3. **Neither one enters CI for now** — see Consequences.
4. **`docs/fluxo.yml`**: `dbre` moves from `status: proposto` to `status:
   active`. `entregaveis_alvo` (flat list) becomes `entregaveis` (list of
   objects with `status`): `parecer-de-migracao` and
   `backup-restore-testado` marked `real`, with the mechanism that proves
   them; `plano-de-capacidade` and `tuning` kept as `lacuna`, with the
   explicit reason. `hoje_absorvido_por`/`criterio_de_separacao` remain in
   the block, now describing only what's left — the rule of ONE migration
   per wave (`meta/_journal.json`) is NO LONGER called the "mechanized
   version of the role": it prevents snapshot CONFLICTS between agents
   running in parallel, a concern orthogonal to "this SQL has a risky
   pattern", which now has its own mechanism.

## Consequences

- **The linter scans the ENTIRE repository, not a PR's diff.** Running it
  against today's real migrations FINDS three occurrences in migrations
  already merged and accepted — `0006_whole_princess_powerful.sql:22` and
  `0034_quick_saracen.sql:33` (`DROP COLUMN`), `0007_groovy_bullseye.sql:2`
  (`ALTER COLUMN ... SET DATA TYPE`). This isn't a defect to fix: these
  are decisions already made and accepted, and fixing them in passing
  would erase the evidence of why they existed (the same rule CLAUDE.md
  states for findings Z/AD/AE). This is exactly why the script **did not
  enter as a CI step**: a gate that scans the whole repository would fail
  every PR, forever, for findings that aren't the PR's. Turning it into a
  real gate requires the same technique as `pr-police.ts` — scoping to the
  diff against the PR's base — left for when `dbre` actually needs to
  BLOCK a merge; today it's a report, not a verdict, and runs manually
  (`pnpm --filter api lint:migracao`).
- **The backup report doesn't re-execute the restore.** It reuses
  exclusively the read that `collectBackup()` already does; the restore
  procedure itself is already tested and documented
  (`docs/runbook.md#restore`). Conflating the two would inflate the
  script's scope into reimplementing something that already exists and
  already works.
- **The "backup overdue" threshold (26h) is duplicated**, not imported,
  from the `brabo-backup-atrasado` alert
  (`deploy/k8s/observability/alerts/brabo-alerts.yaml`) — the Grafana YAML
  isn't read by the script's Node process. The two numbers can drift apart
  if someone changes one side and forgets the other; accepted consciously,
  the same cost any duplicated threshold in code would have.
- **`plano-de-capacidade` and `tuning` remain a GAP**, declared in
  `docs/fluxo.yml`, with no deadline. The trigger for splitting them off
  is still real data volume in the MANAGED project — not the
  `token_usage`/`session_events` volume of Brabo itself, which is already
  large, but that of the product the agents build.
