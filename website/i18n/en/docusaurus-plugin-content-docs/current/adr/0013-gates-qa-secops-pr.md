# ADR 0013 — PR gates: QAAgent and SecOpsAgent

- Status: accepted
- Date: 2026-07-24
- Phase: 4a (session 3 — QA and SecOps gates)

## Context

The real DevAgent (previous session) implements the task and opens a PR, but
the PR doesn't go through any automated review — it goes straight to
`in_review`. This session adds the two missing gates: **QA** (runs the
suite, builds the rule→test matrix, points out rules without coverage) and
**SecOps** (runs semgrep/gitleaks, cross-references security ADRs) — each
with a verdict recorded as an artifact + a PR comment, returned to the dev
on the SAME branch when it fails, and a limit on corrections before it
becomes `blocked`.

Acceptance criterion: a task with (a) a rule without a test and (b) a
hardcoded secret → QA returns the first, the dev fixes it, SecOps blocks the
second, the dev fixes it, the PR reaches `awaiting_user` with all 4 verdicts
on the timeline.

## Decisions

### 1. Gate state machine as a pure ceiling

`domain/execution/pr-gate-state-machine.ts` (same pattern as
`action-state-machine.ts`/`story-state-machine.ts`): `PrGateStatus =
'awaiting_qa' | 'awaiting_secops' | 'awaiting_user'`. `nextGateStatus`
takes the CURRENT gate + the verdict and returns the next status (or
`'blocked'` if the correction ceiling was exceeded) — each gate can only act
on ITS OWN status (`InvalidGateActionError` if QA tries to decide on
`awaiting_secops` or vice versa), guaranteeing the immutable ORDER
(approving QA never jumps straight to `awaiting_user`). `tasks` gains
`gate_status`/`gate_correction_count` (migration `0015`) — no new table for
verdicts: they are `session_events`
`artifact.qa_verdict`/`artifact.secops_verdict`, the same pattern as
`EmitArtifact`.

`RecordGateVerdictUseCase` is the ONLY place that applies the machine, posts
a comment on the PR (`GitProvider.commentOnPullRequest`, the 10th operation
of the contract — best-effort, never blocks the gate decision) and returns
the next action to the engine (`correct`/`run_secops`/`done`/`blocked`) —
same principle as always: the api decides, the engine executes.

### 2. Conversational handoff NOT reused

`domain/sessions/handoff.entity.ts` is modeled for CONVERSATIONAL agent
activation (`offered/accepted`), with no notion of branch/worktree/task —
forcing that fit would have been worse than creating a new path. The
"QA/SecOps rejected → back to the dev on the SAME branch" return is a
direct engine→engine call: `DevAgentServer.correct/3` (distinct from
`work/2`, which claims a NEW task) reuses the already-stored
`state.worktree`/`state.branch`/`state.task_id` — it NEVER calls
`worktree_manager().create/3` again. In the `report_done` of the
correction, only `propose_commit`/`propose_push` (the PR already exists,
same branch) — never `propose_pr` again.

### 3. QA uses ToolLoop/LLM; SecOps is deterministic — intentional asymmetry

Cross-referencing a business rule's description with a test's name/content
is SEMANTIC judgment — `QaAgentServer` uses the real `ToolLoop` (same
harness as DevAgent), with `Engine.Gates.Tools.EmitQaVerdict` ENFORCED
exactly like `ReportDone`: it only accepts `veredito: "approved"` if the
last `terminal` in the history exited with `exit 0`.

Finding a hardcoded secret or a vulnerability is a STRUCTURED check over
scanner output — a DETERMINISTIC SecOps (no LLM) is more reliable than a
model summarizing a security finding (risk of hallucination/omission in a
check that should be binary). `SecOpsAgentServer` runs
`gitleaks`+`semgrep` (`Engine.Actions.GitleaksDetector`/`SemgrepDetector`,
same optional-detection pattern as `RtkDetector` —
`System.find_executable/1`, never assumes it's installed) and lists the
`securityRelevant` ADRs (new, optional field, in the `open_adr_pr` payload —
an informative checklist, without deep line-by-line correlation). Zero
findings → `approved`; any finding → `changes_requested`.

**Both scanners were tested against the engine's real Dockerfile (Alpine)
and install/run without issue** (`gitleaks` via the GitHub release's static
binary; `semgrep` via pip) — the initial concern about instability on
musl/Alpine did not materialize in this session. Optional detection remains
as defense in depth (an environment without the binaries doesn't break the
gate).

### 4. QA/SecOps share the dev's worktree

Neither creates its own worktree — they find the dev's via
`DevAgentState.find_by_task_id/2` (new query) — since they only
read/run commands, never write code. `Engine.Gates.Diff.compute/2`
computes `git diff <default_branch>...HEAD` (no diff computation existed
in the engine before this) — used for the verdict summary (count of
changed files), not as a line-by-line filter of scanner findings
(documented simplification: reliably correlating scanner path ↔ diff is
fragile enough not to be worth the effort in this session).

### 5. Trigger indirection (Dispatcher) — testability

`Engine.Gates.Dispatcher` (`.run_qa/2`, `.run_secops/2`) is the single
point where `DevAgentServer`/`QaAgentServer` trigger the NEXT gate —
swappable in tests (`Engine.Gates.FakeGateDispatcher`) for the same reason
as `worktree_manager()`: without this indirection, `DevAgentServer` tests
would spin up a REAL `QaAgentServer` outside the test process's Ecto
sandbox (discovered while running the suite — the GenServer crashed trying
`DevAgentState.find_by_task_id` without owning the connection). The
gate→dev return (`DevAgentServer.correct/3`) does NOT go through the
indirection — it's a `GenServer.cast` via `:via`/`Registry`, which is
already fire-and-forget by OTP's nature (silent if the process doesn't
exist, never crashes the caller).

## Consequences

- UI: `ProjectApprovalsTab` gains the "PRs under review" section — a
  horizontal stepper dev→qa→secops→you (`PrGateTimeline`, new component)
  per task with an open gate, expandable verdicts, and the QA
  `coverageMatrix` rendered with `ui/Table`. `activity.ts` narrates
  `pr.gate_changed`/`artifact.qa_verdict`/`artifact.secops_verdict`.
- Tests: state machine (immutable order, correction ceiling),
  `RecordGateVerdictUseCase` (best-effort comment, exceeding K blocks),
  `DevAgentServer.correct/3` (same branch/worktree, no new PR),
  `QaAgentServer` (`emit_qa_verdict` enforcement), `SecOpsAgentServer`
  (planted secret → changes_requested; missing scanner → skips without
  breaking).

## Scope & assumptions

QA/SecOps only for DevAgent PRs — Infra and the full team panel via
Phoenix channels remain out of scope. `securityRelevant` on ADRs is just an
informative flag (the Phase 3b Architect changes only to accept the new
optional field). No deep diff↔scanner-finding correlation. `in_review →
done` (final user approval) remains out of this session — the gate ends at
`awaiting_user`, and the human merge action is already always manual.
