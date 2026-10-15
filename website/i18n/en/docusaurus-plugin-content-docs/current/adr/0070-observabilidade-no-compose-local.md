# ADR 0070 — Observability in the local Compose: metric and log, no trace

- **Status:** accepted
- **Date:** 2026-08-14
- **Extends:** [ADR 0026](0026-fase5-observabilidade-e-graceful-shutdown.md),
  [ADR 0035](0035-observabilidade-legivel-e-trace-sem-coletor.md)

## Context

ADR 0026 set up full observability — Prometheus, Loki, Tempo, Alloy,
OpenTelemetry Collector, and Grafana — **only for Kubernetes**. That
session's acceptance criteria said "in the local Grafana", and "local" there
meant the k3d cluster, not Docker Compose.

The practical consequence: whoever develops with `pnpm dev` has the entire
instrumentation working — the api exposes 102 series at `/metrics`, the
engine exposes `oban_queue_depth` and `brabo_engine_sessions_hosted`, all
three services stamp `trace_id` in the log — and **none of it is
observable**. To see a dashboard you had to spin up a cluster, which by
design doesn't coexist with `pnpm dev` (the two publish on the same ports,
ADR 0025).

## Decision

### 1. An opt-in overlay, not part of `pnpm dev`

`docker/docker-compose.observability.yml` spins up Prometheus, Loki, Alloy,
and Grafana. It doesn't enter `pnpm dev` because that's four more containers
on a machine already running Postgres, Ollama, and three apps: whoever isn't
investigating anything shouldn't pay for them.

### 2. Metric and log. Trace is left out, and that's a decision

ADR 0026 (decision 9) established that trace goes through an OpenTelemetry
Collector, and that metric and log **don't** — metric is scrape, log is read
from stdout. This overlay implements the two that don't need a collector.

Trace would require Collector + Tempo, and ADR 0035 already separated
instrumenting from exporting precisely so that the absence of an endpoint
would be the normal state in development. That's why the overlay does
**not** define `OTEL_EXPORTER_OTLP_ENDPOINT`: pointing to a nonexistent
address would produce an export error on every turn, which is worse than
not exporting at all.

`trace_id` stays in the log, and it's still what correlates api and engine.

### 3. The artifacts are the SAME ones from the cluster, not a copy

Compose mounts `deploy/k8s/observability/dashboards/` directly, and the
datasource UIDs (`brabo-prometheus`, `brabo-loki`) are identical to the ones
in `grafana-values.yaml`. A dashboard references its datasource by UID:
diverging here would force yet another copy of the JSON files, and a
dashboard copy diverges the first time someone fixes just one panel on one
side.

For the same reason, Prometheus's scrape emits the `app` and `pod` labels
that the cluster's dashboards group by, and the log collector emits the
`app` label (`api`/`engine`/`web`) that the cluster's Alloy derives from
`app.kubernetes.io/name`.

The new dashboard in this delivery — **Brabo — logs**, with a service and
level selector — is born in the same directory, so it holds in both
environments.

### 4. Log parsing is by regex, not by `stage.json`

In the cluster, Alloy does `stage.json`, because in production pino writes
one JSON line per event. In development `pino-pretty` draws the readable
layer tree, and the engine uses `PrettyLogFormatter` — a deliberate, and
good, decision that doesn't get swapped just to please the collector.

So the collector is the one that adapts: it strips ANSI, extracts the level
from both formats (pino and Elixir), and normalizes the case. What **doesn't**
change are the labels, which are the contract with the dashboard.

### 5. Only the three applications go to Loki

`api`, `engine`, and `web`. Postgres and Ollama are third-party
infrastructure with high-volume logs, and whoever needs them has
`docker compose logs`.

The observability stack itself is left out for a stronger reason: it runs on
the SAME Compose project, so without the filter Loki would ingest its own
log — and the log of that ingestion — in a self-feeding loop.

### 6. `trace_id` is structured metadata, never a label

Same decision as in the cluster, and the reason is cardinality: one label
per trace explodes Loki's index. This requires
`allow_structured_metadata: true` and schema `v13`, which the image's
default config doesn't ship — hence the dedicated
`docker/observability/loki.yml`.

## Consequences

- Metric and log become observable without a cluster, and the same
  dashboard serves both environments.
- **The local Grafana and the cluster's compete for port 3001.** It's the
  same incompatibility that already exists between `pnpm dev` and
  `make deploy-local`, for the same reason, and it's not solved by changing
  one of the two ports — it's solved by not running both.
- Alloy reads the Docker socket. It's mounted read-only, and it's dev-only.
- The cost/token dashboard is born empty on a database with no traffic:
  those metrics have labels, and in `prom-client` a labeled metric doesn't
  emit a series before the first observation. Documented in the runbook so
  it doesn't get mistaken for a broken panel.

## Three silent-failure modes that cost time and became code comments

They're worth recording because the three share the same signature —
**valid configuration, zero error in the log, wrong data on the panel**:

1. **`stage.replace` without a capture group.** It replaces the groups, not
   the matched span. Without parentheses the regex matches and nothing
   happens, and ANSI leaks into the panel.
2. **Escaping `\x1b` in a River string.** River processes escapes before the
   regex compiles, so how many backslashes to write becomes guesswork. The
   POSIX class `[[:cntrl:]]` doesn't depend on that layer.
3. **A Go template with a missing key** renders the literal text
   `<NO VALUE>`, which ended up as a level value in the dashboard's
   selector. The explicit `else` (`OUTRO`) is what closes off the
   cardinality.

## Discarded alternatives

- **Put the four services in `docker-compose.yml`**: always on, a cost for
  everyone, a benefit for whoever is investigating.
- **Copy the dashboards to `docker/observability/`**: two copies that
  diverge the first time a panel gets fixed on one side only.
- **Make the development log turn into JSON** to reuse the cluster's
  `stage.json`: it would trade the day-to-day readability of whoever is
  developing for the collector's convenience. The collector is the one that
  adapts.
- **Bring up Tempo and the Collector as well**: its own scope, and ADR 0035
  already established that not exporting is the normal state in
  development.
