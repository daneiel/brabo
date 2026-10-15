# ADR 0091 — `secops-runtime` as a report script over `rate_limit_hits`

- **Status:** Accepted
- **Date:** 2026-08-16
- **Context:** decided anticipation of the `secops-runtime` role
  (`docs/fluxo.yml`, `camada_seguranca`)

## Context

`docs/fluxo.yml` (ADR 0085) declares `secops-runtime` as a `proposto`
role in the security layer, with `papel_de_mercado: detection and
response` and `criterio_de_separacao: production with real traffic (post
DEPLOY_ENABLED + platform active)`. That trigger is real: automatic
incident detection, incident response, and security postmortems require
continuous production traffic to make sense — an alarm calibrated
against zero real traffic either fires on noise or never fires, and a
postmortem with no incident is fiction.

The product owner decided to anticipate part of the role even without
the trigger having fired: the RateLimitGuard (ADR 0027) already records
one line per counted request in `rate_limit_hits`
(`apps/api/src/interfaces/http/shared/rate-limit.guard.ts`), including
under dev/CI traffic — real data, collected today, with no report over
it at all. `apps/api/scripts/medir-execucao.ts` (PHASE 13b) already
established the pattern for this kind of instrument:
`NestFactory.createApplicationContext`, pure Drizzle read, functions
extracted and tested without bringing up Nest.

## Decision

`secops-runtime` enters as a **script** — `pnpm --filter api
relatorio:seguranca-runtime` —, not as an LLM agent or a `GenServer`.
There's no decision to make about the data, only aggregation: a ranking
of buckets (`bucket_key` = `user:<uuid>` or `ip:<address>`, the only two
formats `RateLimitGuard` records) by hit volume, and a temporal
distribution in fixed slices to reveal attempt spikes.

What the script explicitly **does not do**, and why:

- **Automatic incident detection** — would require a threshold calibrated
  against real traffic; calibrating against dev/CI traffic would produce
  a number with no relation to production abuse.
- **Incident response** — there's no real incident to respond to.
- **Security postmortem** — there's no real incident to investigate.

All three depend on the SAME trigger `docs/fluxo.yml` already declared
(production with real traffic, post `DEPLOY_ENABLED` + `platform`
active) and remain out of scope. The report lists them in a "not
measured" section — never simulates a sample incident, never invents a
detection number — the same principle ADRs 0041/0042/0077 already apply
to other capabilities the product doesn't have yet: declare the gap,
don't fake it.

The data window is short and the report says so:
`DomainGaugesCollector.pruneRateLimit` erases hits older than
`2 × RATE_LIMIT_WINDOW_MS` (240s by default), every
`METRICS_GAUGE_INTERVAL_MS` (15s by default). The report prints both the
CONFIGURED window (the theoretical ceiling of the pruning) and the
OBSERVED window (what the data actually covers), and never lets the
latter pass for a history longer than it really is — if the two
coincide, it's a sign that older hits were pruned, not that they never
existed.

`docs/fluxo.yml` changes from `status: proposto` to `status: active` in
the `secops-runtime` block, with `entregaveis` replacing
`entregaveis_alvo`: the `deteccao` item becomes real (`via: script`), and
`resposta-a-incidente`/`postmortem-de-seguranca` remain `status: lacuna`
— the field doesn't disappear, it now points exactly at what's missing.

## Consequences

- Real gain: a single command (`pnpm --filter api
  relatorio:seguranca-runtime`) that today already shows who's hitting
  the rate limit the most and when, without waiting for production —
  useful even in dev/CI to spot a malformed test pattern or local abuse.
- The report is only as good as the data `rate_limit_hits` keeps: without
  a route, method, or block reason, the ranking can't tell "one client
  hammering `/auth/login`" apart from "one client hammering any route." A
  route column would require changing what `RateLimitGuard` records — out
  of scope for this slice, which only reads what already exists.
- The retention window (minutes, not days) limits the ranking's value for
  incidents that already passed: running the script TODAY only sees what
  happened in the last `2 × RATE_LIMIT_WINDOW_MS`. Extending retention
  would be its own product decision (growing storage cost in a table with
  no foreign key, ADR 0027) and wasn't made here.
- `secops-runtime` still has no automatic detection, incident response,
  or postmortem — the role's full market promise still depends on the
  original trigger (`DEPLOY_ENABLED` + `platform` active). Nothing in
  this decision anticipates that day; it only keeps `rate_limit_hits`
  from having no consumer at all until then.
