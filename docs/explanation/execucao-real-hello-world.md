---
id: execucao-real-hello-world
title: The real execution — the hello world
sidebar_label: Real execution (hello world)
description: Brabo's first end-to-end execution with an API model, the sixteen findings it produced, and what still hasn't been proven.
keywords: [dogfooding, real execution, findings, phase 13]
---

# The real execution — the hello world

The first time the agent chain ran with an **API model** end to end,
instead of local Ollama. A new project (`Hello API`), a real GitHub
repository, the OpenRouter provider, model
`~deepseek/deepseek-v4-flash-latest`.

The goal wasn't to deliver the hello world. It was to discover what
breaks when the product is used the way a user would use it — and it
did that in quantity.

:::caution This execution is NOT the official measurement from PHASE 13b
There were **engine restarts in the middle**, several times, to load
the fixes the execution itself required. The "zero restart" criterion
was lost, and the table below measures a run that was deliberately
rocky. The measurement that counts still needs to be done, with
everything already fixed and with no interruption.
:::

## How far the chain got

| step | result |
|---|---|
| GitHub provisioning | ✅ `daneiel/hello-api`, 4 of 5 Gitflow steps |
| Creative | ✅ 4 business rules, with traceability |
| Readiness → brief | ✅ `product_brief` referencing the 4 rules |
| PO | ✅ 1 epic, 4 stories with RF/DOR/DOD |
| Manual promotion | ✅ 4 stories promoted by the user (RN-048) |
| Architect | ❌ never received the baton |
| Dev, PR, gates | ❌ never reached |

Step 5 of the bootstrap (protecting branches) failed due to a GitHub
**plan** limitation: a private repository doesn't accept branch
protection on the free plan. It's not a product defect — but the
product treated it as a hard failure, without warning beforehand. The
wizard now warns at the time of the choice.

## The cost, extracted from `token_usage`

| agent | calls | input tokens | output | cost (micro-USD) |
|---|---|---|---|---|
| **anamnese** | 32 | **392,510** | 18,207 | 38,605 |
| psicologo | 2 | 16,406 | 5,140 | 2,401 |
| po | 5 | 18,777 | 3,492 | 2,318 |
| criativo | 6 | 6,406 | 3,343 | 1,180 |
| psicologo-leve | 1 | 1,947 | 2,039 | 542 |

The Anamnese spent **8× the Creative and PO combined** without
producing anything — it had no way to say "there's nothing to emit"
([RN-063](../business-rules.md#rn-063)). It's the most important
number in this table: the actual work cost pennies, the waste cost the
rest.

## The sixteen findings

Numbered in the order they appeared. The fixed ones were decided by
the user, one at a time.

### Fixed in this execution

| # | what | where it landed |
|---|---|---|
| 4 | the wizard showed `brabo/<slug>` as the repo destination, with `brabo/` hardcoded — the api creates it in `createForAuthenticatedUser` | open |
| 6 | provisioning failed and the screen stayed on "Working…" forever, with zero events | open |
| 8 | bootstrap died on **every new GitHub project**: an empty repo responds 409 across the entire Git Data API, and the provider only handled 404 | PR #125 |
| — | the GitHub fake responded 404 where the real one responds 409 — the suite stayed green with the product broken | PR #125 |
| — | the free plan doesn't protect branches on a private repo, and the choice gave no warning | PR #125 |
| 13 | **no agent could use a provider with credentials**: the turn looked up the key by the agent's slug in a UUID column | PR #126 |
| 14 | turn failure turned into an empty `agent.response` in the log, with the reason only in an ephemeral broadcast | PR #127 |
| — | the Creative's chat opened blank, without saying it was the user's turn to speak | PR #127 |
| 12 | the Creative was deciding technology (`GET` or `POST`? JSON or text?) — its identity didn't say what was **not** its job | PR #131 |
| — | TOOL failure was discarded with `_ =`: four rules refused in silence | PR #131 |
| — | an engine restart killed the conversation with nothing on screen | PR #131 |
| 15 | Anamnese had no verb to end: it repeated an impossible call up to the cap, every tick | PR #132 |
| 16 | a 30s heartbeat killed the session with a pending handoff — work became unreachable | PR #133 |

### Open, pending triage

| # | what |
|---|---|
| 1 | "Settings" in the side menu doesn't navigate; the (workspace-level) catalog is only reachable from inside a project |
| 2 | there's no **git** credential section in settings — only LLM |
| 3 | the wizard promises "select an already-registered credential" and "check settings," and neither exists |
| 4 | `brabo/` hardcoded in the preview **and in the wizard's confirmation screen** |
| 5 | the policy step announces the `rc` branch and the `rc ← qa` cascade, removed by ADR 0030 |
| 6 | a failure before the `repo_bootstraps` row leaves the screen spinning forever, with no event at all |
| 7 | the activity feed shows "activity in system" for every event |
| 11 | session closes due to **tab** inactivity (partially resolved by RN-064: it only protects when there's a pending handoff) |
| — | the Anamnese runs **inside** the work session, interleaving events and competing for budget |

## What this execution proved, and what it didn't

**It proved** that the Creative → PO chain works with an API model and
produces a real-quality artifact: the backlog came out with closed
traceability, and the stories' DOR said "format and technical details
defined by the Architect" — the boundary added to the Creative crossed
through the brief and reached the backlog.

**It proved** that the product swallowed errors in three different
layers (turn, tool, process), and that's what kept the defects
invisible. All three now speak up.

**It didn't prove** the Architect, the dev, the remote PR, or the
gates. **It didn't prove** anything about the real cost of a complete
execution. And it doesn't count as the PHASE 13b measurement, because
of the restart in the middle.

> **TODO(human):** the clean execution — no restart, everything fixed
> — still needs to be run, and it's the one that fills
> `docs/explanation/validacao-real.md` with the table extracted by
> `pnpm --filter api medir:execucao`.
