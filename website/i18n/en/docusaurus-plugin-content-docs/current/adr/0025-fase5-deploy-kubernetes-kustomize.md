# ADR 0025 — Phase 5 (session 2): Kubernetes deploy with Kustomize, queue metric and local overlay

- Status: accepted
- Date: 2026-07-26
- Phase: 5 (session 2 — item 3 of the scope, plus the metric the HPA requires)
- Supersedes: [ADR 0024](0024-fase5-imagens-producao-ci.md), which delivered
  the production images and CI and recorded five limitations — the first of
  them ("`VITE_*` is compile-time; solving this is a prerequisite for the
  following session's Kubernetes work") is resolved here.

## Context

After session 1 there was a production path for the three images and CI
exercising it, but **no deploy artifact at all**: no manifest, no chart, no
`docs/runbooks/`. Item 3 of Phase 5 asks for the Kubernetes deploy with HPA
for the engine driven by Oban queue depth, and the acceptance criterion is
executable — `make deploy-local` on a clean cluster ends with every pod
Ready, smoke green, and artificially filling the queue triggers the HPA.

The hard part wasn't writing YAML. It was that **scaling the engine beyond
one replica is an operation the code from Phases 1–4 didn't support**, and
three of the five blockers below only exist because this session introduces
an HPA.

## Decisions

### 1. Kustomize base+overlays, not Helm

The criteria the assignment asked for, answered:

- **Templating needed**: low. There are four components of ours, with no
  conditionals, no loops, no sub-charts. What varies between environments is
  a value (URL, StorageClass, replica count, CIDR), not structure. A
  templating language would pay for flexibility that isn't used.
- **Per-environment overlays**: this is Kustomize's native shape, and
  overlays are valid YAML — `kubectl apply --dry-run=server` and
  `kubeconform` check them before any cluster exists. Helm's `values.yaml`
  only becomes YAML after rendering; reviewing a values diff is reviewing an
  input, not the result.
- **Upgrade experience**: `kubectl apply -k` plus `kubectl rollout undo` per
  workload, with git as the source of truth. We deliberately give up `helm
  rollback` and the concept of a release: in exchange there's no release
  state to drift from the repository, which is Helm's most common failure
  mode when operated by several people.

**Third-party components still come through Helm.** External Secrets
Operator, CloudNativePG, Prometheus, prometheus-adapter and metrics-server
are installed by `deploy/k8s/bootstrap.sh` with `helm upgrade --install` and
a pinned version in `deploy/k8s/helm/charts.env`. Rewriting them in
Kustomize would mean maintaining a fork of an upstream manifest — pure work
with no gain. The split is: **operators via Helm, application via
Kustomize.**

### 2. The engine is a Deployment, not a StatefulSet

A StatefulSet offers two things, and neither is useful here:

**A PVC per replica would be actively wrong.** Dev agent worktrees live at
`<PROJECT_WORKSPACES_ROOT>/<project_id>/.worktrees/<agent_id>`, inside the
**same volume the api mounts** — the api creates the bare repo, writes the
absolute path to Postgres, and the engine reads that path from the database
and uses it literally in `git push` (ADR 0024, decision 5). Giving each
replica its own volume breaks the path identity that push depends on. A
worktree isn't per-replica state: it's project state, guarded by the
workspace lock (ADR 0017).

**A stable network identity isn't needed.** HTTP traffic comes in through a
Service, which load-balances; and `DNSCluster` discovers peers through a
headless Service (`engine-headless`), which works the same over a
Deployment.

Consequence: the shared PVC is **ReadWriteMany**. This isn't a preference,
it's a requirement — api and engine write to the same volume and can land on
different nodes.

### 3. prometheus-adapter, not KEDA

Keeps the native Kubernetes HPA and one fewer operator. The cost is real: a
discovery rule (`deploy/k8s/helm/prometheus-adapter-values.yaml`) and an
aggregated APIService, which is the most fragile piece of the arrangement.

What makes the cost acceptable is the test: **the adapter's failure mode is
silent.** If the rule doesn't match, the HPA stays at `<unknown>` and simply
doesn't scale, with pods Ready and everything else green. That's why
`deploy/k8s/smoke.sh` doesn't trust the HPA — it queries
`external.metrics.k8s.io` directly and fails if it doesn't serve the metric.

### 4. Five blockers that had to be fixed in the code

These aren't elective refactoring from Phases 1–4. They're the difference
between "the YAML applies" and "the system works", and three of them exist
solely because of the HPA.

#### 4.1. `force_ssl` was redirecting the probes

`apps/engine/config/prod.exs` had `paths: ["/health"]` **commented out** in
the `force_ssl` exclusion list. The kubelet calls the probe by the pod's
**IP**, not by `localhost`, so the host-based exclusion didn't cover it:
`/live` and `/ready` would respond **301** to `https://` and the pod would
never become Ready. An entire deploy would be blocked by one commented-out
line.

#### 4.2. Worktree pruning was deleting live work from another replica

`Engine.Dev.WorktreeCleanup.live_agents/1` queried
`Engine.Dev.Registry`, which is **local to the node**. While the engine was
a single replica, "alive in the Registry" and "alive" were synonyms. With
the volume shared across replicas, replica A scans replica B's agents'
worktrees, doesn't find them in its own Registry, and **removes them as
orphans** — while the dev agent is still writing to them.

Fix: the source of truth became `dev_agent_states`, which is global by
construction (it's what rehydration starts from) and whose row is deleted
when the agent finishes. The set is equivalent with a single node and
correct across N nodes.

#### 4.3. `Engine.Sessions.Monitor` deleted `session_states` on any `:DOWN`

`Engine.Dev.Monitor` already distinguished a node going down from an agent
terminating (`forget?/1`); the session monitor didn't. And the effect was
worse than a race: because the shutdown order of the tree brings down
`SessionSupervisor` **before** the Monitor, the Monitor stays alive to
process every `:DOWN`, delete every active session, **and even report it to
the api as `closed_abnormally`**. Every rollout and every scale-down would
mark exactly the healthy sessions as abnormal.

The fix isn't a copy of `Dev.Monitor`: there, `{:shutdown, _}` always means
the node is going down; here, `{:shutdown, :heartbeat_timeout}` is a
legitimate termination and the row **needs** to be removed, or the session
would rehydrate forever.

#### 4.4. `:global.trans` without an Erlang cluster serializes nothing

`Engine.Actions.Workspace.ensure!` serializes per-project workspace
initialization with `:global.trans`, which is only global if the nodes are
clustered. Without that, two replicas run concurrent `git init` in the same
directory of the shared volume. `DNSCluster` had already been in the
supervision tree since Phase 1, governed by `DNS_CLUSTER_QUERY` — it just
needed to be pointed at the headless Service and to have the distribution
port pinned (`inet_dist_listen_min/max`) so the NetworkPolicy could open it.

#### 4.5. The web's URLs were compile-time

Debt recorded in ADR 0024. Vite inlines `import.meta.env.VITE_*` into the
bundle, so each environment required its own image — the opposite of
promoting the artifact that passed CI. Now the nginx entrypoint generates
`/config.js` from the container's environment and
`apps/web/src/lib/runtime-config.ts` reads it, keeping the `VITE_*`
variables as a fallback for `pnpm dev:web`, where there's no nginx.

Two details that shaped the implementation:

- `config.js`'s `Cache-Control: no-store` goes into the `map $uri`,
  **never** an `add_header` in a child block — the nginx trap that decision
  7 of ADR 0024 documents (an `add_header` in a child block discards every
  inherited header).
- An empty value counts as absent. `envsubst` writes `""` for an undefined
  variable, and `'' ?? default` is `''` in JavaScript: without this
  handling, a key missing from the ConfigMap makes the app point at an
  empty origin and fail with a CORS error that says nothing about the cause.

### 5. Probes: three different questions

There used to be a single `/health` on both services, and it queries the
database. That's a correct readiness check and a **wrong** liveness check:
under a slow Postgres, a liveness probe tied to the database restarts every
replica at the same time — degradation turns into a total outage, carried
out by the kubelet itself.

| | startup | liveness | readiness |
|---|---|---|---|
| api | `/live` | `/live` | `/health` (database) |
| engine | `/live`, wide window | `/live` | `/ready` (database + rehydration) |
| web | `/healthz` | `/healthz` | `/healthz` |
| keycloak | `:9000/health/started` | `:9000/health/live` | `:9000/health/ready` |

**"Readiness only after rehydration" stopped being an emergent property.**
The guarantee existed, but implicitly: the two rehydrators sit before the
`Endpoint` in the supervision tree, and `Supervisor.start_link/2` is
sequential. That's enough in Docker; it isn't enough in Kubernetes, because
the probe needs to **distinguish** "still rehydrating" from "ready", and
without an observable signal the only difference would be a closed port —
which the kubelet reads as a dead pod. Now `Engine.Readiness` marks each
stage in `:persistent_term` and `/ready` reads it, which also makes the
rule testable instead of dependent on an ordering that any future
reordering would silently break.

### 6. The metric: `oban_queue_depth`, dimensioned by `state`

Exposed at the engine's `/metrics` via `telemetry_metrics_prometheus_core` —
just the aggregator plus `scrape/1`, served by the router that already
exists. PromEx would bring its own plug and HTTP server plus a Grafana
dashboard uploader, which is item 5's work.

The measurement is a SQL aggregation over `engine.oban_jobs`, not
`Oban.check_queue/1`: the latter returns the state of the **local**
producer, and the HPA's question is how much work exists waiting across the
**entire cluster** — a property of the table, not of the node.

**The `state="available"` filter is mandatory.** Three workers reschedule
themselves (`OutboxDrainWorker` every 2s, `WorktreeCleanupWorker` every 60s,
`AnamneseSchedulerWorker`), inserting their own successor: under normal
operation the table is **never** empty, there's always something in
`scheduled`. An HPA that counted the whole table would read an idle system
as saturated and keep the engine at maximum replicas forever.

The metric also **explicitly zeroes** queues that have drained. Without
that the gauge gets sticky: a queue that emptied out disappears from the
query, Prometheus keeps serving the last value, and the HPA keeps replicas
up for a backlog that no longer exists.

### 7. Networking: the assignment's list is incomplete

The scope asks for "web→api, api→db, engine→api, engine→db; nothing else."
Applied literally, that list leaves the system dangling and broken. We
implemented `default-deny` for ingress and egress plus **exactly the flows
the system actually exercises**, which are:

| flow | why it's here |
|---|---|
| api → keycloak | creating a session requires a client-credentials token. **Missing from the list** |
| api → engine | creating a session calls the engine over internal HTTP. **Missing from the list** |
| engine → keycloak | validates the received token against the JWKS |
| engine → api | writes an event, creates a task, reports termination |
| engine ↔ engine | Erlang distribution (see 4.4) |
| prometheus → engine:4000 | **without this the HPA never receives a metric** |
| all → kube-dns | without DNS nothing resolves and the rest is moot |
| api/engine → db | by label `brabo.dev/role: database`; in prod, by `ipBlock` |

And `web→api` **isn't a pod flow at all**: the web is nginx serving static
files, and the caller of the api is the browser, from outside the cluster.
Giving the web pod egress would loosen the policy without enabling anything.

Enforcement caveat: NetworkPolicy only takes effect if the CNI implements
it. k3s ships the controller built in; **kind's kindnet does not implement
NetworkPolicy** and silently ignores the manifests. That's why the
bootstrap uses k3d by default even when only kind is installed, and the
smoke reports when the cluster doesn't enforce it.

### 8. External Postgres by default, CloudNativePG for dev/staging

The base doesn't know where the database is: the connection arrives only
through the Secret's `DATABASE_URL`. The local overlay brings up a
CloudNativePG `Cluster` **in its own namespace** (`brabo-db`), because the
application namespace's `default-deny` would require operator-specific
egress rules that have nothing to do with the application. The
`allow-db-egress` rule crosses namespaces by matching on label, not on name.

### 9. Secrets: ESO by default, sealed-secrets as fallback

No secret in a versioned manifest. The base's `ExternalSecret` resources are
identical in every environment; only the `SecretStore` changes, which is
the only resource in the secret path declared per overlay. Locally, the
store reads from a source Secret that `bootstrap.sh` creates
**imperatively** with `openssl rand`.

Corollary: Keycloak's `realm.json` became a **template**. The original
carries the clients' secrets in plaintext, and putting it in a ConfigMap
would be exactly the "secret in a plain manifest" the scope forbids. An
initContainer renders it with values from ESO into an in-memory `emptyDir`,
and **fails loudly** if any placeholder is left over — a half-imported
realm comes up green and only breaks at login.

### 10. Local overlay without ingress: NodePorts on the compose's ports

The local overlay maps NodePorts to **3000/4000/8080/8088**, exactly the
`docker-compose.prod.yml` ports. This keeps the development realm and
`docker/smoke.sh`'s defaults valid with no translation, and avoids needing
an ingress controller and DNS resolution — which would cost memory on a
development machine and bring a whole class of offline failure (`nip.io`
and similar need internet). Ingress only exists in staging/prod.

For the same reason, Prometheus is just the server chart on its own, with
no Alertmanager, Pushgateway, node-exporter or Grafana: the
kube-prometheus-stack doesn't fit, and dashboards provisioned as code are
item 5's work.

### 11. How the HPA's acceptance criterion is exercised

`make hpa-test` inserts jobs in `available` into a queue **that isn't
declared in the Oban configuration**. With no producer configured, nothing
consumes them: they sit in `available` until removed, which is the
condition to observe. The alternatives were discarded due to side effects —
inserting into the `default` queue would have the engine execute them
(measuring drainage, not backlog), pausing the queue would change the
system's behavior during the test, and creating a no-op worker would put
test code inside the domain.

## Consequences

- A real Kubernetes deploy now exists, verifiable with a single command, and
  the gap between "the image comes up in compose" and "the system works in
  a cluster" stopped being invisible — there were five defects, all silent.
- The engine now supports more than one replica for real, not just on
  paper.
- The same web image serves any environment; debt item 1 from ADR 0024 is
  paid off.
- `bandit` was bumped from 1.12.0 to 1.12.3 (within the already declared
  `~> 1.5`): this session's `mix deps.get` flagged EEF-CVE-2026-65623
  (HIGH, quadratic CPU blow-up on fragmented WebSocket) — and the engine
  serves Phoenix channels over WebSocket.

## Known limitations (recorded, not resolved)

1. **There's no session draining on shutdown.** That's item 4 of Phase 5 and
   wasn't among the six for this session. The manifests already reserve
   `terminationGracePeriodSeconds` and the `preStop` hook point, and fix 4.3
   keeps scale-down from destroying state — but a replica going down still
   ends the sessions it hosted without the `closing` transition with cause
   `node_shutdown`. That's why `scaleDown.stabilizationWindowSeconds` is 600
   on the engine: scaling down is asymmetrically more expensive than
   staying up.
2. **No image is published to a registry.** CI uses `load: true` with fixed
   `:prod` tags. The staging/prod overlays already have the `images:` field
   ready, with `REPLACE_WITH_DIGEST` — publishing by digest is a
   prerequisite for those, not for local.
3. **Keycloak still runs in `start-dev`**, inherited from ADR 0024
   (limitation 4). What changed is that the secrets stopped being
   plaintext. Production mode, an external database and a fixed hostname
   remain out of scope.
4. **The local overlay uses ReadWriteOnce**, not RWX. It works because the
   cluster is single-node and RWO means "one NODE", not "one pod". The base
   remains RWX, which is correct; the overlay is what loosens it, and on a
   real cluster this configuration would place api and engine on different
   nodes and push would fail with `remote unpack failed`.
5. **The staging and prod overlays aren't exercised** by any test beyond
   `kustomize build` + `kubeconform`. They depend on a managed Postgres, an
   RWX StorageClass, a secrets provider and a registry — none of which
   exist on a development machine. The `REPLACE_ME` placeholders are
   deliberate: a plausible default there would be worse than a placeholder,
   because it would go unnoticed.
6. **`k3d image import` doesn't import the initContainer's busybox.** It
   fails with `content digest ... not found` — `docker pull` produces a
   multi-architecture index with an attestation manifest, which the node's
   `ctr` rejects. The bootstrap treats importing this image as optional and
   lets the kubelet pull it from the registry (we already depend on
   internet for the charts). For OUR images, importing remains mandatory:
   they don't exist in any registry, and failing there is a real error —
   the script now inspects the output because `k3d` exits with code 0 even
   when it fails.
7. **pgvector isn't in the local overlay's Postgres.** The extension is only
   created by `docker/postgres/init.sql`, never by a migration (verified);
   no `vector` column exists today. When the first one does, CloudNativePG
   will need an image with the extension.
