# ADR 0021 — Closing Phase 4a: an infra gate that actually validates, and a panel that tells the truth

- Status: accepted — acceptance criterion NOT closed (see the dedicated section)
- Date: 2026-07-25
- Phase: 4a (closing — audit of ADR 0014)

## Context

ADR 0014 delivered the InfraAgent, the infra PR gates, and the team panel.
As with ADRs 0019 and 0020, **the acceptance criterion had never run**:
there was no infra demo (`grep` for
`InfraAgent|open_infra_pr|handoff-infra` across the four demo scripts
returned 0 in all of them).

The reading audit found that BOTH sides of the acceptance criterion were
compromised — the QA gate validated nothing, and the panel showed the wrong
state for most agents.

What was correct and wasn't touched: the denial of terminal access to the
InfraAgent (structural via the tool registry + the `agent_autonomy deny`
policy, with the short-circuit proven in `decide.spec.ts` and the full path
in `propose-action.use-case.spec.ts`), the shared gate machine, the
correction cycle with no new PR, and the rejection of `docker build --check`
(the engine container has neither the `docker` CLI nor the socket mounted —
confirmed by inspection).

## Decisions

### 1. The infra QA gate approved ANY Dockerfile (the central finding)

`hadolint` **was not installed in the engine container**. And
`InfraGateRunner.lint_dockerfiles/1` treats its absence as graceful
degradation: it returns `{[], ["hadolint unavailable, skipped"]}` →
`findings == []` → `veredito = "approved"`.

The acceptance criterion ("PR with a valid Dockerfile that passes the
gates") would pass without anything having been checked. Same class as
ADR 0020's gitleaks: the gate looked green precisely because it checked
nothing, and the graceful degradation — which exists for good reasons — was
hiding that.

`hadolint` went into the Dockerfile in the SAME block as gitleaks, to reuse
the virtual group's `curl` before it gets removed.

### 2. Compose and CI went through no validation at all

`lint_dockerfiles/1` filters by `dockerfile?/1`, and there was even a test
pinning that "with no Dockerfile among the files, approve without running
hadolint". But the InfraAgent ALSO proposes a `docker-compose.yml` and a
`.github/workflows/ci.yml`, and the spec calls for "syntactic validation" of
infra PRs.

`Engine.Actions.YamlLintDetector` (new) mirrors `HadolintDetector` —
content instead of path, `available?/0` + `lint/1`, `.Live`/`.Fake`, same
degradation. Uses `yamllint` via pip, reusing the python3 that already came
with semgrep: there's no YAML parser among the Elixir deps, and the house
pattern for validation is an external tool with optional detection, not a
new dependency.

### 3. Severity: only `error` fails — otherwise the gate is useless

Discovered by testing the binaries before writing the code, and it's what
decides whether the gate is usable:

- A perfectly reasonable Dockerfile (`FROM node:24-alpine` +
  `RUN apk add --no-cache git`) already picks up a `warning` DL3018 ("pin
  versions in apk add"). If `warning` failed the gate, **no LLM-generated
  Dockerfile would ever pass** and the InfraAgent would loop until the
  correction cap was hit — exactly the loop that got the ADR 0020
  acceptance run stuck.
- In yamllint, filtering by level wasn't enough: in the `relaxed` profile
  it classifies `new-line-at-end-of-file` as `[error]`, and LLM-generated
  YAML rarely ends with a trailing newline. The solution was running with
  **empty rules** (`-d "{rules: {}}"`): with no rule active, yamllint only
  reports PARSE failures, which is what "syntactic validation" is meant
  to mean. Verified: valid YAML with no trailing newline comes out clean,
  `ports: [` left unclosed comes out `[error] syntax error (syntax)`.

Non-blocking findings still show up in the verdict as information — the
summary distinguishes "N finding(s)" from "N non-blocking warning(s)", so
the verdict doesn't imply a style nit blocked the PR.

### 4. `agent.status` was never persisted — 4 agents stuck at "idle"

In the engine, `agent.status` only existed as an
`EngineWeb.Endpoint.broadcast`. But `deriveAgentRoster` reads `agent.status`
from the event log fetched over HTTP — so Creative, PO, Architect, and
Infra appeared **permanently "idle"**, even in the middle of a turn. Worse:
the web's `onAgentStatus` handler was invalidating a query that, by
construction, could never contain the data the push had just delivered.

`Engine.Sessions.LiveBroadcast.agent_status/4` (new) broadcasts AND
persists. The four servers now route through the `broadcast/3` clause
instead of having 20 call sites changed. Broadcast first (it's the live
path, it shouldn't wait on the HTTP round trip); a failure on append doesn't
bring down the turn — status is narrative, not decision.

### 5. The panel read the FIRST 200 events of the session

`listPaginated` orders `asc(seq)` with `limit`. The team panel, the
execution section, and the activity feed derived state from the START of
the session forever, as soon as it went past 200 events — which any real
execution does comfortably. On its own, this invalidated "correct states
during a real execution".

`ListPaginatedOptions.latest` (opt-in) fetches from the end via the
database and reverses in memory, returning in ascending order so as not to
change how consumers read it. `nextCursor` is `null`: there's no page more
recent than the last one — whoever sweeps the whole session continues using
`afterSeq`, which `latest` ignores.

### 6. Status heuristics that never told the truth

- `devStatus` returned `working` for everything that wasn't a block,
  including with `dev.idle` in the log and even **with no event from the
  agent at all**: a stopped dev appeared "working" forever. It now says
  `idle` for `dev.idle` and total silence alike.
- **No path ever produced `waiting`** — the header's counter was always
  0. Now an agent with a pending `proposed_action` shows as `waiting`,
  which is the most informative state it can have on the panel. `failed`
  still wins: a blocked task is what the user needs to see first.

### 7. The AgentCard showed no autonomy, task, or tokens

- The autonomy toggle **never rendered**: `AgentCard` requires
  `autonomy && onAutonomyChange`, and `ProjectOverviewTab` never passed
  the handler. `setAgentAutonomy` had existed in `api-client.ts` since
  Phase 4a as **dead code**. On top of that, `autonomyActionTypeFor` only
  mapped `infra` and `dev-*` — creative/po/architect/qa/secops didn't
  even receive the prop.
- Task and tokens had no prop and no slot. The task was already derived
  by `deriveExecutionProgress` but only fed the `ExecutionSection`: the
  same `dev-<module>` appeared twice on the screen, once with the data
  and once without.
- **Per-agent tokens didn't exist in the backend.** `token_usage` has
  `session_id`/`actor_id`/`cost_micros`, but the port only exposed
  `sumBySessionAndActorIds`, consumed only by the Psychologist's cost,
  and there was no route. New: `sumBySessionGroupedByActor`,
  `GetSessionTokenUsageUseCase` and
  `GET projects/:id/sessions/:id/token-usage`. No new instrumentation —
  `RecordLlmUsageUseCase` already recorded for any agent.

### 8. Tool-call recovery didn't apply to the conversational agents

Found while running the acceptance criterion. The InfraAgent wrote the
correct `propose_infra_pr`, but as a text block instead of a native tool
call — and the turn ended with an empty response and the agent went idle
without proposing anything. `Engine.Harness.ToolCallRecovery` had existed
since ADR 0020 and solves exactly this, but it lives inside the `ToolLoop`,
and the four conversational agents (Creative/PO/Architect/Infra) have their
**own loop** — they were left out of the fix without anyone noticing,
because none of them had run against a local model since then.

`tool_calls/2` of all four now consults the recovery when `toolCalls` comes
back empty, anchored to the agent's own `tool_specs` (same precision as the
ToolLoop: it only recovers a name that's a genuinely registered tool).

### 9. The QA gate approved an infra PR with NO VALID FILE AT ALL

A second form of empty approval, and it also only showed up while running
things: the model produced malformed `files` — the `path` values were JSON
blobs — so no Dockerfile or YAML was recognized, `lint_dockerfiles/1` and
`lint_yamls/1` returned an empty list, and the verdict came out
**`approved`**, with the summary literally saying "no Dockerfile found in
the PR no YAML found in the PR". The PR reached `awaiting_user` without
containing a single infra artifact.

The demo's assertion caught it (it requires a Dockerfile); the GATE didn't.
Now an infra PR with no recognizable file at all is `changes_requested`,
with an item explaining the expected `path`/`content` format. **Not
invalidatable isn't the same as valid** — and the test that existed
("with no Dockerfile among the files, approve without running hadolint")
was pinning exactly this defect.

### 10. The feed didn't narrate the execution phase

`classifyEvent` covered verdicts, gates, and infra, but the events the spec
lists by name fell into the generic path:

- `backlog.task_claimed` → "updated the backlog", without saying WHICH task
- **a dev's PR** → the api records `action.pr_open`, which fell into the
  `action.*` branch and was narrated as "ran a command", lumped in with any
  terminal
- `backlog.task_blocked`/`task_unblocked`/`task_status_changed` → generic

### 11. An absolute path took down the PR, and an orphan branch stalled the session

Two chained defects, both ours, found while running things:

- The model chose `path: "/api/Dockerfile"`. The local provider's
  `commitFiles` passes the path straight to `git update-index
  --cacheinfo`, which rejects an absolute path — the whole PR died with
  an opaque `Command failed: git ... update-index`. `normalizeInfraPath`
  (new, pure, tested) strips the leading slash (unambiguous intent of
  "repo root") and **rejects** traversal (`..`) with a clear message:
  content coming from an LLM never has a legitimate reason to write
  outside the repository.
- With the first attempt failing AFTER `createBranch` and BEFORE the
  artifact was written (it's only born on success), every following
  attempt fell into `createBranch` again and died with "branch already
  exists" — the session became **permanently** unable to open the infra
  PR. Five consecutive attempts like that in the log. `createBranch` now
  tolerates the branch already existing.

`ExecuteInfraPrUseCase` had no test at all; it gained six.

## Acceptance criterion status: NOT CLOSED

Four runs, none completed. The first three failed on **our own defects**
(items 8, 9, and 11) — and that's why it was worth persisting: each run
paid off a real defect that no reading had found.

The fourth failed on a **model limitation**: `qwen2.5-coder:7b` produced
`propose_infra_pr` with malformed JSON (unbalanced quotes) and nonsensical
content (`node_modules/@express·require` as Dockerfile content). The
tool-call recovery correctly returned empty — it refuses to guess about
broken JSON, and that refusal is the correct behavior.

The InfraAgent's task is harder than the DevAgent's: three artifact types
(Dockerfile per module + compose + CI), with real content, in a single tool
call with a nested payload. A local 7B doesn't sustain that reliably.

**What's missing**: pointing the infra demo's `DEMO_MODEL` at an API model.
Same conclusion as ADR 0020 about the QA semantic gate, and the per-agent
binding already exists for this.

What IS verified against a real run, despite this:

- `agent.status` persisted (`working`/`idle` in the event log — item 4)
- tool-call recovery in the conversational agents working (item 8): in
  one of the runs the InfraAgent proposed the PR and both gates ran all
  the way to `awaiting_user`
- the infra gates firing in order and recording a verdict with
  `prActionId`
- the gate rejecting a PR with no valid artifact (item 9), and
  hadolint/yamllint installed and responding inside the container

## Consequences

- Suites: engine 237, api 445, web 72 (baseline 227/433/47).
- Tests: `hadolint_detector_test` and `yamllint_detector_test` against the
  REAL binaries (`:hadolint`/`:yamllint` tags, automatically excluded when
  absent — same mechanism as `:gitleaks`), pinning that broken syntax
  fails and a style nit doesn't; `session-event-latest.repository`
  (first × last); `token-usage.repository` (aggregation by actor);
  `agent-status.test.ts` and `activity.test.ts` — **`deriveAgentRoster`
  and `classifyEvent` had NO test at all**, and they're exactly items 3
  and 4 of the spec; `AgentCard.test.tsx` (the five fields + the toggle).
- `apps/api/scripts/demo-infra-agent.ts` (`pnpm --filter api
  demo:infra-agent`) is the executable acceptance criterion. It fails
  explicitly if the verdict summary says "hadolint unavailable" or
  "yamllint unavailable" — a gate that approves without validating
  doesn't count as an approval.

## Scope & assumptions

`docker build --check` remains out (no `docker` CLI or socket in the engine
container) — the spec accommodates this with "when available in the
container".

The Phoenix channel remains a refetch TRIGGER, not a data source: the
`event.appended` payload is discarded and what updates the screen is the
query invalidation. With `agent.status` now persisted, the data the push
announces actually exists in the log — that was the broken link. A relay
that uses the payload directly remains out of scope.

Dev/qa/secops status remains heuristic over the event log (best-effort,
never used for gate decisions). The demo isn't deterministic: the
InfraAgent generates the files via LLM, and what's required is the PR with
a Dockerfile and the two verdicts — not that the model writes a specific
Dockerfile.
