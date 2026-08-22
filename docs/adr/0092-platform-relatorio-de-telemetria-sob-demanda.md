# 0092 — `platform` starts as an on-demand reporting script, not an agent

## Status

Accepted. Does not change the `status: planned` or the `gate_saida` of the
`platform` role in `docs/fluxo.yml` (ADR 0085) — its activation stays
synchronized with `DEPLOY_ENABLED`, which doesn't exist. This document
delivers only the half that already has real data behind it.

## Context

`docs/fluxo.yml` (`camada_plataforma`) describes `platform` as "SRE /
Platform — owner of the feedback loop": it would receive `pipeline-verde`
from the Infra area and `nfrs-mensuraveis` from the Architect, and would
deliver `slo + dashboard + runbook`, `telemetria-consolidada` and
`postmortem`. Its `status` is `planned` and `ativacao` is written as
"synchronized with `DEPLOY_ENABLED`" — a flag that doesn't exist in the
product today. There is no production environment with real traffic, no
numeric SLO defined anywhere, and no real incident for any postmortem to
analyze.

The product owner consciously decided to bring part of this role forward —
not as an LLM agent nor as a supervised process (`GenServer`), which would
invent authority over a loop that doesn't close yet, but as what is already
honestly possible: a read-only SCRIPT, in the same mold as
`apps/api/scripts/medir-execucao.ts` (Phase 13b) and
`apps/api/scripts/validacao-gates.ts` (Phase 15).

The data already exists. `DomainGaugesCollector`
(`apps/api/src/infrastructure/observability/domain-gauges.collector.ts`)
runs every `METRICS_GAUGE_INTERVAL_MS` and maintains three Prometheus
gauges: active/closing sessions per project, blocked tasks per project, and
the state of the last backup (`backup_runs` — age, status, size, always
GLOBAL, because the product backs up the entire database, not per project).
What was missing wasn't the metric: it was a way to look at that snapshot
RIGHT NOW, for a specific project, without opening Grafana.

## Decision

**`apps/api/scripts/relatorio-telemetria.ts`**, invoked via
`pnpm --filter api relatorio:telemetria [--projeto <uuid>] [--json]`. It
asks the SAME three questions as `DomainGaugesCollector` — but as a
point-in-time read, ad hoc, triggered by whoever asks for it, and finishes
after printing. It is not a second collector: it registers no gauge, it
doesn't run on a `setInterval`.

**The SQL queries are replicated, not imported.** The collector's methods
(`collectSessions`/`collectBlockedTasks`/`collectBackup`) are private and
end up writing into `this.metrics.*.set(...)` — there's no pure "just the
query" half to extract without coupling a standalone script to the
lifecycle of a NestJS `@Injectable` that only makes sense inside its
module. Replicating a READ query (same tables, same filters) is cheaper
than opening that dependency.

**The report never invents what it doesn't have.** Two fixed sections in
every output:

- **"Where to see more"** — links to what already exists, versioned: the
  three dashboards under `deploy/k8s/observability/dashboards/*.json`, the
  alerts under `deploy/k8s/observability/alerts/brabo-alerts.yaml`,
  `docs/runbook.md#observabilidade`, and `pnpm dev:obs` to bring up local
  observability. The script LINKS, never duplicates the content of those
  files.
- **"Not measured"** — three named gaps: a formal numeric SLO (none is
  defined anywhere in the product — inventing one here would be the same
  error that ADR 0042 already refuses for model rating and ADR 0077
  refuses for code quality); postmortem (depends on a real incident);
  telemetry feeding back into the product in a CLOSED loop (this script
  observes and prints — it doesn't decide or act on its own; that's what
  would make `platform` `active`, and the trigger is still absent).

**`docs/fluxo.yml` gains a note, not a new status.** The `status: planned`
of the `platform` role does NOT change, nor does the `gate_saida: { id:
operavel, status: planned }`. The `telemetria-consolidada` output gains a
`nota` field saying that the MANUAL/on-demand version is already real
(this script) and the AUTOMATIC/closed-loop version remains pending
`DEPLOY_ENABLED` — the same discipline ADR 0077 already applied for
"recommended" vs. "invented rating": what exists is stated as existing,
and what doesn't exist is still stated as not existing.

## Consequences

**What starts to exist.** A way to answer "how is this project doing
right now" (sessions, blocked tasks, backup) without opening Grafana and
without waiting for the next scrape — useful precisely because
`DomainGaugesCollector` already publishes that data to Prometheus, but
nobody was reading it on demand before.

**What stays exactly as it was.** `platform` remains `planned`. No new
agent, no `GenServer`, no numeric SLO, no simulated postmortem. The script
decides nothing and acts on nothing — it only prints what's already in the
database.

**The duplicated query is a choice, not an oversight.** The same tables
(`sessions`, `tasks`/`stories`, `backup_runs`) are read twice through two
different paths — the periodic collector and this on-demand script — and
the two queries can drift apart over time if one changes without the other
following. The accepted cost is smaller than coupling a CLI script to the
lifecycle of a NestJS `@Injectable` just to reuse private code.

## References

- [ADR 0085](0085-fluxo-como-registro-declarativo.md) — declares the
  `platform` role as `planned`; this document doesn't promote it.
- [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md),
  [ADR 0077](0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md) —
  the same discipline of never inventing a number/rating without real data.
- [RN-385](../business-rules.md#rn-385), [RN-386](../business-rules.md#rn-386).
- `apps/api/scripts/relatorio-telemetria.ts`,
  `apps/api/src/infrastructure/observability/domain-gauges.collector.ts`,
  `docs/fluxo.yml` (`camada_plataforma › platform`).
