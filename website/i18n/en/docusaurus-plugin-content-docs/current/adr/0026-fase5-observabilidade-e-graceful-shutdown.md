# ADR 0026 — Phase 5 (session 3): graceful shutdown, OpenTelemetry, metrics, logs and dashboards

- Status: accepted
- Date: 2026-07-26
- Phase: 5 (session 3 — items 4 and 5 of the scope)
- Supersedes: [ADR 0025](0025-fase5-deploy-kubernetes-kustomize.md), whose
  limitation 1 ("there's no session draining on shutdown") is resolved here.

## Context

Sessions 1 and 2 delivered production images, CI and the Kubernetes deploy
with an HPA driven by queue depth. Graceful shutdown and observability were
explicitly left for later.

This session delivers both. The acceptance criterion was twofold and
executable: a rollout with active sessions leaving none orphaned, and, in
the local Grafana, following a session from the root trace down to a
specific tool call, seeing its cost in the dashboard.

**The big work wasn't writing instrumentation — it was discovering that
scaling the engine had been broken since the previous session.** Six
defects surfaced, and none of them broke a test: five were silent by
construction.

## Decisions

### 1. A session has ONE owner in the cluster: `:global` registration

`Engine.Sessions.SessionServer` was registered in a `Registry` **local to
the node**, and `Engine.Sessions.Rehydrator` recreates, on boot, one process
per row of `engine.session_states` — which is a global table. With N
replicas, each session started existing N times; the browser's websocket
lands on ONE of them (the Service load-balances), and the other N−1 copies,
never receiving a `ping`, would time out the 30s heartbeat and tell the api
to end **a session that was alive on another pod**.

In other words: scaling the engine was killing users' sessions within 30
seconds, and `make hpa-test`, approved in session 2, scales to 3.

The name was moved to `:global`. This deduplicates across nodes and, as a
bonus, makes `heartbeat/1` reach the owner wherever it is — before, the
channel's `join` would fail when the websocket landed on the "wrong" pod.
The `Registry` stays in the tree because the agent servers (`po:`,
`criativo:`, `arquiteto:`, `infra:`) use it with prefixed keys.

### 2. `:global` resolves a name conflict by KILLING a process — and that explained everything

This was the hardest defect of the session, and the method is worth
recording because the evidence pointed at the wrong place for several
rounds.

Symptom: the drain worked perfectly when called by hand (`5 sessions, 5
with node_shutdown`) and **drained nothing during a real rollout** — the
`preStop` reported `total: 0` and the api recorded the sessions as
`killed`.

Cause: during a rollout (`maxSurge: 1`) the new pod comes up while the old
one still hosts the sessions. It would rehydrate before `:global` had
**synchronized the name tables**, `whereis_name` would return `:undefined`
for names that existed on the other node, and it would create a second copy
of every session. When synchronization finished, `:global` resolved the
conflict with the default resolver `random_exit_name`, which **kills one of
the two processes with `exit(pid, :kill)`**. The coin flip was killing the
old pod's copy, which reached `preStop` with nothing local to drain.

`Node.list()` being non-empty says **connected**, not "tables exchanged".
What's missing is `:global.sync()`, and that's what closes the window. The
`Rehydrator` now waits for the cluster and synchronizes before rehydrating —
and only when there's a session to rehydrate, so as not to penalize boot
when the table is empty.

### 3. Proactive drain in `preStop`, not `terminate/2`

When the supervisor comes down, each `SessionServer` receives
`exit(:shutdown)` and dies instantly — it doesn't trap exits, doesn't have
a `terminate/2`. Adding `trap_exit` would only solve half the problem: the
supervisor gives each child 5s, and the drain needs the network (an event
to the api, a handoff to another node).

So `preStop` calls `Engine.Shutdown.drain()` with the whole BEAM still up.
For each local session: it emits `session.draining`, releases the global
name, and offers the session to a peer via `:erpc`. The **unadopted** ones
become `active → closing` (cause `node_shutdown`) and then
`closed_abnormally`.

An adopted session stays `active` and never becomes `closing` — the state
machine doesn't allow going back from `closing` to `active`, so announcing
`closing` for everything would make adoption impossible. This is the
answer to the assignment's "closing/node_shutdown **OR** rehydrated": both
halves, decided per session.

`drain/0` returns a summary (`%{total:, adopted:, terminated:}`) instead of
`:ok` because the hook's stdout is the only record left once the pod is
gone — that summary is what made diagnosing decision 2 possible.

`Engine.Sessions.Adopter` covers what `preStop` can't reach: `kill -9`,
OOMKill, an evicted node. Without it, "zero orphans" would only hold for
the graceful shutdown path.

### 4. Four blockers at the api↔engine boundary

- The internal DTO rejected `to: "closing"`
  (`@IsIn(['closed','closed_abnormally'])`); the only route that accepted
  `closing` was the human one, behind user RBAC.
- `termination_reason` was only persisted in a terminal state, so the
  `node_shutdown` cause would be dropped exactly where the Psychologist's
  `TerminationClassifier` is going to read it.
- The classifier didn't know about `node_shutdown`. It was added **before**
  the `closed_abnormally` catch-all, or the drain would show up as `:crash`
  and the Psychologist would raise a hypothesis about a defect that doesn't
  exist.
- The hypothesis DTO would reject the new cause, and the failure mode is
  bad: the 400 comes back to the model as a tool result and the ToolLoop
  spins until `max_iterations` is hit, spending budget without recording
  anything.

### 5. `force_ssl` was answering 301 on every `/internal/*`

`Plug.SSL`'s exclusion matches the **exact path**
(`conn.path_info in paths`), so `paths: ["/health", ...]` would never cover
the twenty-plus `/internal` routes. The api doesn't send
`x-forwarded-proto: https`, and the engine has no HTTPS listener — TLS
terminates at the ingress. Result: **api→engine had been broken since
session 2**.

And no smoke caught it, because **creating a session doesn't call the
engine — activating it does**. Both smokes were changed to activate, and
the comment claiming to prove that path stopped being false. The exclusion
decision became a function (`EngineWeb.ForceSslExclusions`), because a list
of exact paths goes stale at the first new endpoint.

### 6. Trace model: the session is the root, persisted

A session lasts minutes or hours, and an OTel span only reaches the backend
once it **ends**: a root open that whole time would be invisible in Tempo
precisely while the session is happening, and would disappear entirely if
the session never ended cleanly — which is the case item 4 addresses.

So the root is short (`session.create`) and its `traceparent` is persisted
in `sessions.trace_parent`. All later work uses it as a **remote parent**,
shares the `trace_id`, and the whole session is recoverable from a single
id.

Propagation across three paths, each at a single point:

| path | injection point |
|---|---|
| api → engine | `buildHeaders()` — before this, four identical inline blocks |
| engine → api | `post_returning/3`, the funnel for every POST from the engine |
| outbox → Oban | `DrizzleOutboxRepository.append()` reads the active context; the **18 call sites didn't change** |

`outbox_events` got a `metadata jsonb` column, not a key inside `payload`:
the engine deserializes the payload by event type, and mixing transport
with domain would poison every producer. The engine keeps its own copy of
the traceparent in `engine.session_states` — a copy, not a join, because
reading the api's table on every agent turn just to fetch an immutable
value would trade one write for N reads.

The OTel context lives in the process dictionary, and the engine dispatches
work via `cast` and `Task`. `Span.capture/0` and `Span.attach/1` carry the
context by hand — without that pair, the trace breaks exactly at the most
interesting points.

### 7. Counter for rate, gauge for state

- "tokens/min" and "cost/hour" are **rates**: a monotonic counter with
  `rate()` deriving the window. The dashboard asks per minute, the alert
  per hour, and neither needs its own metric; `rate()` also handles process
  restarts.
- "active sessions" and "blocked tasks" are **state**: there's no "stopped
  being active" event that survives a restart. A periodic query to the
  database, with `reset()` before rewriting — without the reset the series
  gets stuck and the panel shows work that already finished.

Two domain details that would change the query: "blocked tasks" is the
**boolean** column `tasks.blocked` (a blocked task goes back to `todo`),
and `tasks` has no `project_id` — the path is `task_id → stories`. Approval
rate is a counter on the decision, not `count(status='approved')`: an
approved action that executes becomes `executed`.

The api's `/metrics` needs `@Public()`: `JwtAuthGuard` is global, and
without this the scrape gets a 401, with the symptom being a `down` target
and everything else green.

### 8. JSON logs: `trace_id` via `mixin`, and the name is a contract

On the api, pino's `mixin` is evaluated on every line, reading the active
context at that instant — that's what makes a line emitted inside a tool
call carry that tool call's trace, without any log call site passing an id.

The field is `trace_id` with an underscore across all **three** services,
because that's what Alloy's `stage.json` extracts and Loki's
`derivedFields` looks for. Renaming it compiles, passes the suite, and
destroys the clickable correlation.

On the engine, a hand-written formatter (~30 lines) instead of a library:
the options bring formatters for three clouds and their own configuration
scheme, and none of them injects the OTel context without duct tape either
way. It **never raises** — an exception there would happen inside the
logger, losing the line and possibly recursing while trying to log the
failure.

On the web, with no browser SDK: `@opentelemetry/sdk-trace-web` costs
~90 kB and requires CORS on the collector plus an entry in the CSP. The web
**generates** a `traceparent` per request, which the api adopts as parent
(that's the default propagator), and logs with the same `trace_id`. It's
~20 lines, and swapping in the SDK later is just replacing a function.
`ApiError` now carries the `traceId`, so "it errored" became an actionable
report.

Global hooks that didn't exist: `QueryCache`/`MutationCache` `onError` and
`window.error`/`unhandledrejection` — without them, a render exception was
a blank screen with no record.

### 9. Collector in the middle, and what does NOT go through it

`OTEL_EXPORTER_OTLP_ENDPOINT` points at the OpenTelemetry Collector, not at
Tempo: the three apps know a single endpoint, and swapping backends,
sampling or filtering an attribute becomes a pipeline change.

Metrics and logs **don't** go through it: a metric is scraped (pull model,
survives a collector restart) and a log is read from the pods' stdout by
Alloy. Sending all three through the same path would make the collector a
single point of failure for observability as a whole.

**The `allow-otlp-egress` NetworkPolicy is mandatory**: the `brabo`
namespace's egress `default-deny` (ADR 0025) blocks OTLP to `monitoring`,
and the failure mode is the worst possible — the apps come up, spans are
created, sending fails, and everything else stays green with Tempo empty.

### 10. Grafana alerts, not Prometheus — a recorded deviation

The assignment asks for "Prometheus alerts." They're implemented as
**unified Grafana rules**, provisioned as code, by the user's explicit
choice. The accepted trade-off: they stop being evaluated if Grafana goes
down, which wouldn't happen with rules loaded by Prometheus. There's no
Alertmanager and no receiver — routing is an operational decision.

## Consequences

- The engine supports more than one replica **for real**, and a rollout
  preserves users' sessions instead of killing them.
- A session is traceable end to end: `session.create` on the api,
  `agent.turn`, `tool.call`, `llm.turn` and `gate.scanner` on the engine,
  all under one `trace_id`.
- The logs of all three services are JSON with the same `trace_id`,
  clickable from Tempo to Loki and back.
- `pnpm-workspace.yaml` now declares `protobufjs: false`: it comes in as a
  transitive dependency of the OTLP exporter and the exporter we use is
  HTTP/JSON — not running a transitive dependency's postinstall is the same
  discipline as the rest of the phase's pinning and checksumming.

## Known limitations (recorded, not resolved)

1. **The agent servers remain node-local.** `po:`, `criativo:`,
   `arquiteto:` and `infra:` still sit in a local `Registry`, with the same
   shape of defect as decision 1: an agent command that lands on the
   "wrong" pod won't find the process. This wasn't part of this session's
   acceptance criterion, but it's the next piece to migrate to `:global`.
2. **The `Adopter` has a partition window.** It syncs `:global` before
   adopting, but with 1 replica `Node.list()` is legitimately empty and
   there's no way to distinguish "alone because it's a single replica" from
   "alone because it's partitioned". In a real partition, both sides could
   adopt the same session.
3. **A real agent's `tool.call` wasn't exercised end to end.** Verification
   used the span mechanism directly (`Span.with_session` via `rpc`),
   because running a real agent requires an LLM — Ollama or an API key —
   and none was available in the environment. The code path is the same;
   what wasn't observed is a real agent turn producing the tree.
4. **The `grafana/grafana` chart is marked deprecated** in the upstream
   repository, and the only replacement is the `grafana-operator` (CRDs, a
   different provisioning model).
5. **Items 6 and 7 of Phase 5 remain open**: scheduled `pg_dump`
   backup/restore with a tested runbook; rate limiting, security headers,
   strict CORS and dependency auditing in CI.
6. **Publishing the images to a registry** remains pending from session 2,
   and is a prerequisite for the staging/prod overlays.
