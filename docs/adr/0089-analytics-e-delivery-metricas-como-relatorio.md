# ADR 0089 — `analytics` and `delivery-metricas` become a report script

- **Status:** Accepted
- **Date:** 2026-08-16
- **Context:** product owner's decision to anticipate two roles of the
  target model (`docs/fluxo.yml`) without waiting for the organic trigger
- **Sibling piece:** [ADR 0085](0085-fluxo-como-registro-declarativo.md)
  (`docs/fluxo.yml`); direct FORM precedent:
  `apps/api/scripts/medir-execucao.ts` (Phase 13b)

## Context

`docs/fluxo.yml` already described two target-model roles as
`status: proposto`, each already carrying the separation criterion that
was missing for them to become `active`:

- `analytics` (Analytics Engineer, PRODUCT metric) — "absorbed by
  `medicao` (which only covers EXECUTION metric)," with the criterion
  "the day `metricas-de-produto` becomes a mandatory PO input";
- `delivery-metricas` (Delivery Manager, flow — DORA) — "absorbed by
  `medicao` (partially)," with the criterion "never becomes an agent; it
  becomes a REPORT of `medicao` (lead time, deployment frequency, MTTR,
  change failure rate extracted from the event log + `gates.yml`)."

Neither trigger fired organically. The product owner decided to
anticipate the build anyway: the session → commit → PR → merge funnel and
a real slice of DORA (lead time, deployment frequency) are already
extractable from data the product already records —
`proposed_actions.execution_result` for the three git actions the dev
agent produces
(`apps/api/src/domain/git/git-action-execution-result.ts`) and
`docs/gates.yml` for the `backmerge` gate. Waiting for the organic
trigger would postpone a report that's already possible.

## Decision

The two roles become `status: active` in `docs/fluxo.yml`, and what
materializes them is a SINGLE SCRIPT — `apps/api/scripts/analise-funil.ts`
(`pnpm --filter api analise:funil -- --projeto <uuid> [--json]`) — in the
SAME format as `apps/api/scripts/medir-execucao.ts`:
`NestFactory.createApplicationContext(AppModule)`, required
`--projeto <uuid>` argument, pure Drizzle read, zero database writes,
Markdown output by default and `--json` for programmatic consumption.

This isn't a new product feature: it's the form `docs/fluxo.yml` already
prescribed for the two roles, just built before the anticipated trigger.
No GenServer, no LLM agent, no new HTTP route.

### What the script measures FOR REAL

- **Real funnel** (`calcularFunil`): how many sessions produced at least
  one `executed` `git_commit`, one `pr_open`, and one `git_merge`, and the
  conversion rate between consecutive stages. Counts SESSIONS, not
  actions.
- **Real lead time** (`calcularLeadTimes`): from the first `executed`
  `git_commit` to the first `executed` `git_merge` in the same session,
  using `updated_at` — the moment `ExecuteGitActionUseCase` actually
  recorded the `execution_result`, not when the action was proposed.
- **Real deployment frequency** (`deploymentFrequencyPorDia`): `executed`
  `git_merge` whose `targetBranch` is in `PROTECTED_BRANCHES`, grouped by
  day. Cross-references by REFERENCE with the `backmerge` gate
  (`docs/gates.yml`) — its evidence is CI (`.release/gate.json`), out of
  reach for a script that only reads the database, so there's no data
  join at all, just the same branch filter.

### What the script DECLARES absent, and why that isn't "missing data"

Three metrics live in a "Not measured, on purpose" section of the output,
and the decision to keep them that way is permanent while the
preconditions below don't change — it's not a gap to close next round:

1. **Complete product funnel (ideation → commit).** `sessions` has no
   `storyId` — [RN-230](../business-rules.md#rn-230) already declares
   this gap in the Criativo tab (`apps/web/src/routes/ProjectSessionsTab.tsx`).
   Closing it would require new schema (a new column, possibly a
   migration on `sessions` or a link table), out of scope for this piece
   on principle: **no migration in this round**.
2. **Feature-level adoption evidence.** Unlike the first, this isn't data
   that's missing to COLLECT: it's a capability the product has NO PATH
   to today. Brabo doesn't instrument the projects it BUILDS — there's no
   usage-telemetry pipeline coming out of the generated code, nor a
   product decision about how it would exist. Declaring it "absent" here
   followed the same principle as ADR 0042 for model score and ADR 0077
   (RN-210) for the "ideal" ranking: never approximate with a number that
   would look real.
3. **MTTR and change failure rate.** Both require a real production
   INCIDENT signal, the same dependency `docs/fluxo.yml` already records
   for the `secops-runtime`/`platform` roles (`status: proposto`/
   `planned`, activation synced to `DEPLOY_ENABLED`). Work for another
   round, not this one.

## Consequences

- `docs/fluxo.yml`: `analytics` and `delivery-metricas` move from
  `status: proposto` to `status: active`, with `saidas_alvo` rewritten to
  `saidas` (what's real today) plus an explicit `lacunas` field (what
  remains `status: lacuna`, without erasing the declaration).
- `apps/api/package.json`: new `"analise:funil"` entry.
- No migration, no new HTTP route, no new screen.
- RN-320..322 in `docs/business-rules.md` cover the script's form
  (RN-320), the funnel and lead-time semantics (RN-321), and deployment
  frequency plus the three declared absences (RN-322).

## Alternatives considered

**Wait for each role's organic trigger.** Was the default plan in
`docs/fluxo.yml` and remains the default behavior of the team model for
the other `proposto` roles. Rejected here only because the product owner
explicitly decided to anticipate — not a precedent for anticipating the
other `proposto` roles without an equivalent decision.

**An `analytics` LLM agent reading the database and narrating the
funnel.** Rejected by the very separation criterion `docs/fluxo.yml`
already declared for `delivery-metricas` ("never becomes an agent"),
which this decision extends to `analytics`: the report is
deterministic — sum, group, filter by status — and doesn't need a model
to interpret it. An agent here would be LLM cost with no information
gain.

**Approximate the three absent metrics with a proxy** (e.g., counting
`chat.message` as a proxy for "usage," or time to the next commit as a
proxy for MTTR). Rejected: a proxy that looks like the real metric and
isn't it is the same error ADR 0042 already named for model score —
better a "—" with the reason written than a number that teaches wrong.

## References

- `docs/fluxo.yml` (blocks `id: analytics`, `id: delivery-metricas`)
- `apps/api/scripts/analise-funil.ts` / `apps/api/scripts/medir-execucao.ts`
  (form precedent, Phase 13b)
- `apps/api/src/domain/git/git-action-execution-result.ts`
- `docs/gates.yml` (`backmerge` gate)
- [RN-230](../business-rules.md#rn-230) — the ideation → commit gap,
  already declared in the Criativo tab
- [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) —
  the principle of never faking data that doesn't exist
- [ADR 0077](0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md) —
  the same rejection applied to "ideal model"
