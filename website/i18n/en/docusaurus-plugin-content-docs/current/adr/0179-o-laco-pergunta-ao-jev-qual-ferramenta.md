---
traducao_de: 18ac246302f60de11fbc0120ea43c24ea800e722
---

# ADR 0179 — The loop asks Jev which tool, and the user's model sees only the menu that remains

## Status

**Accepted.** 2026-09-29 (AT-238, story HS-063, epic EP-029). Implements the
AT-235 specification with the sixteen maintainer decisions of AT-236
(2026-09-28) and the 2026-09-29 decision on the adoption criterion, below. It
replaces no ADR: it adds a piece **outside** the provider contract of
[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) and the
model catalog of
[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md), and
reuses metering, the budget (ADR 0110) and the holder's credential (RN-058)
without changing them.

## Context

Today whoever chooses the tool for each step of an agent is the **user's chat
model**, looking at a catalog of 7 to 19 definitions on every call. The
measurements of 2026-09-27 to 29 (`docs/explanation/medicao-do-jev.md`) put
Jev — the `typesafe/jev-1.13` model of OpenRouter's Decisions API, which answers
a multiple-choice question with probabilities — against 328 real steps already
recorded:

- **Jev top-1: 73% (66–79%)**, below the 90% AT-237 required for Jev to CHOOSE
  alone. Choosing and forcing does not work.
- **menu coverage of policy P3: 91% (85.1–94%)** — the fraction of steps in
  which the tool the agent actually called is INSIDE the menu
  {Jev's choice, previous tool of the same run}. Jev's top-2 covers 90%.
  Coverage is the CEILING of end-to-end accuracy (that of the chat model, now
  over 1.6 tools instead of 7.4), not the accuracy.
- P3 offers ONE single tool in 98 of the 160 validation steps, and the
  definitions the model reads per call drop from 746 to 138 tokens.

Jev, therefore, serves to **restrict** the menu, not to decide for it — and that
is what AT-236 had already decided (answer 12: Jev only restricts).

### The maintainer's decision on the criterion (2026-09-29)

AT-237's adoption criterion was a confidence interval lower bound of **90%**.
No policy reached it (P3: 85.1%). On 2026-09-29 the maintainer **lowered the
criterion to 80%**, with the numbers above in front of him, and ordered P3 to be
implemented. This is the owner's decision, not a finding: P3's lower bound
(85.1%) exceeds 80%, and no other text in this repository should say adoption
"passed the 90%". What the measurement does NOT prove remains declared:

- coverage is a ceiling, and the end-to-end accuracy measured in replay was
  between 62% and 91% depending on the hypothesis about the chat model;
- the Wilson interval treats 160 steps as independent and they are 10 runs —
  the honest interval is wider;
- **the real validation is AT-239**, live, comparing the turn's steps, latency
  and cost with and without Jev. This ADR delivers the mechanism, on by default
  as AT-236 ordered, with the per-workspace switch at hand.

## Decision

**1. The router lives in the api, inside `llm-turn`, behind its own port.**
`ToolRouter` (`apps/api/src/application/ports/tool-router.port.ts`) is not an
`LLMProvider` and is not in the `LLMProviderRegistry`: Jev decides, it does not
converse, does not go through the provider contract suite and **does not enter
the `models` catalog**. The adapter (`JevToolRouter`) talks to
`POST https://openrouter.ai/api/alpha/decisions`, with the format MEASURED in
`scripts/jev/jev.ts` — `questions` is an **object** keyed by the question id
(the AT-235 note wrote a list, and the API answered 400). A single use case,
`DecidirFerramentaDoPassoUseCase`, is called by BOTH turn use cases
(`RunLlmTurnUseCase` and `StreamLlmTurnUseCase`) after the resolved provider and
the budget gate pass and before `provider.chat`. Seven conversational agents,
the `ToolLoop` of dev agents and gates, and the Infra Lead all go through them
(AT-236 answer 2); only the Anamnese (paused) and the compaction summarizer stay
out.

**2. When it is consulted — all conditions, and only then is there a call:**
the turn model's provider is `openrouter` (AT-236 answer 1, reading (a)); the
request carries two or more tools; there is an agent in the turn; the engine did
not ask for the whole catalog; the workspace did not turn it off. Jev's key is
the SAME one already decrypted for chat — the workspace holder's (RN-058) — and
no new credential read is born. With provider ≠ `openrouter` no call goes out,
not even the workspace read.

**3. The policy is P3, and it only restricts.** The step's menu is
{tool chosen by Jev, previous tool of the same run}, in catalog order. If Jev
answers `responder_sem_ferramenta`, or there is no previous tool in the step's
catalog, the menu is the **whole catalog** (AT-236 answer 12: "whole catalog,
only record"). There is no `tool_choice`: only the menu is restricted, the model
can still answer in text (answer 7). **There is no confidence threshold in v1**
— the measured P3 does not use one, AT-236 answer 4 ordered it out of the
measurement and P3's measurement does not produce one. Confidence is RECORDED on
every step, and it is AT-239's job to propose a threshold (per agent, if the
curves differ).

**4. The `state` is what the product really has before the step** — the fields
of the `escopo` variant, the second round's winner, cut inside the api from the
`messages` the engine already sends, with no database read: `agente` (the
`agentId`), `contexto` (the beginning of the first `system` message, 1,500
characters), `pedido` (the last `user` message) and `passos_recentes` (the last 6
tool calls AFTER that message, argument and result cut at 500). Ceiling of 8
thousand tokens per request, a quarter of Jev's window; exceeded, fallback
`estado_grande`. Two differences from what was measured, declared: `contexto` is
the beginning of the real `system`, and not "actor identity + instruction" as in
the replay; and in a dev agent under correction the `pedido` is the correction
message, the last `user`, not the kickoff.

**5. The turn NEVER fails because of Jev.** HTTP error (includes the 404/410 of
an alpha endpoint that changed), timeout (ceiling of 2,000 ms,
`TOOL_ROUTER_TIMEOUT_MS`; 0 of 328 requests exceeded it in the measurement),
network error, unexpected JSON, choice outside the options, large state, name
collision with the reserved option: the provider receives the whole catalog and
the reason goes to the event with RN-059's **origin** (`infra` for the first
three, `modelo` for the two shape ones, `codigo` for ours). The adapter never
throws, and the use case still protects itself with a last-resort `try/catch`.

**6. Policy does not change.** Jev does not approve, does not deny and does not
choose a model. The tool remaining in the menu still becomes a
`Proposed Action` and goes through `decide()` and the absolute ceilings as
always; the router does not even import those modules, and an engine test
asserts that its module does not know them. If the model calls a tool that was
NOT on the step's menu (remembered from history), the engine dispatches it as
today and the event only records `foraDoCardapio` (AT-236 answer 13: Jev
narrows, does not forbid). The iteration ceiling stays intact: the Jev call is
INSIDE the same `llm-turn`, and the loop only increments after dispatch.

**7. Per-step record, for AT-239 to measure.** The engine records
`tool_router.decided` in the `EngineApiClient` facade (a single place, for the
seven servers and the `ToolLoop`) with the menu before and after, choice,
confidence, second option, previous tool, `aplicado`, `motivoDaQueda`,
`origemDaQueda`, latency, cost and `foraDoCardapio`. Metrics come from a script
over the log and over `token_usage`, never annotated. The api returns the step
in the new optional field `toolRouting` of `llm-turn` and of the stream's
`final` frame; an old engine ignores it.

**8. Jev's spending is real spending.** One `token_usage` row through the same
`RecordLlmUsageUseCase` (the only metering path, with project, session and AREA
budget): `actor` is the **agent itself** (answer 10 — with its own actor the
spending would escape ADR 0110's area budget), `provider = openrouter`,
`modelId = null`, `modelName = typesafe/jev-1.13` (that is how the Spending tab
separates Jev from chat, answer 8), `estimated = false` and `costMicros` = the
RESPONSE's `usage.cost`, in micro-USD. The price per million is **implicit**
(`cost ÷ tokens` of the response itself, answer 11) and the row says so in the
new column `price_implicit`, keeping `tokens × price = cost` (RN-044) without
pretending a catalog price exists. The budget gate is **not** re-checked between
Jev and chat (answer 15). Jev's cost returns to the engine in
`toolRouting.custoMicros`, and the `ToolLoop` adds it to its local budget
without touching `usage`. Brabo's metering for CHAT records less than OpenRouter
charges (catalog price, no cache nor reasoning); Jev's does not suffer from
that, because it uses the cost the response returns.

**9. The switch belongs to the WORKSPACE** (answer 3), column
`workspaces.tool_router_enabled`, default on, migration 0066, changed through
`PUT workspaces/:workspaceId/tool-router` (`owner`, the owner of the key that
pays). The api reads the flag from its own database in the turn path; the
engine reads nothing and makes no extra HTTP. Off, no Jev call goes out and no
event is born. The installation variable `TOOL_ROUTER=jev|off` that AT-235
proposed was NOT born: the maintainer's decision was per workspace. Only
`TOOL_ROUTER_TIMEOUT_MS` was born.

**10. The path for the agent to ask for the full catalog** — AT-281 showed that
61% of steps would have a ONE-tool menu, and a wrong menu cannot become a dead
end. The mechanism is the simplest one that does not open a new containment
door: if the menu was restricted (`aplicado`) and the model answered **without
calling a tool** (not even in text recoverable via ADR 0020) and without a
provider error, the facade repeats the step **once** with
`catalogoCompleto: true`, which makes the api skip Jev. The repetition asks for
MORE tools, never one the agent did not have; the api trusts nothing from the
engine beyond "don't restrict me"; the menu was never a security boundary. In
the conversational agents' stream it only repeats if NOTHING was written to the
person (a delivered delta cannot be undone). The repetition's cost is the two
chat calls, both metered; the first one's `toolRouting` stays marked
`repetidoComCatalogoInteiro`. Discarded: a `request_full_toolset` as a new tool
(it is new tool surface in every agent, and the model with a one-tool menu has
no reason to call it) and `report_blocked` as a signal (it ends the loop).

## Consequences

- Each eligible step gains a serial call (Jev, then chat): +~0.2–0.4 s of
  latency (the measurement's recorded rows) and ~US$ 0.00005 per step. The gain
  — fewer definitions per call, and maybe fewer steps — is a hypothesis, and
  AT-239 measures it.
- When Jev is wrong and the menu leaves the model without the right tool, the
  cost is one more round (item 10). The rate of that repetition is in the event
  (`repetidoComCatalogoInteiro`) and it is the metric that the menu is bad.
- The endpoint is ALPHA. If it changes, the manual smoke
  (`jev-tool-router.smoke.spec.ts`, ceiling US$ 0.05, skipped without
  `OPENROUTER_TEST_KEY`) fails and, in production, every step falls back to the
  whole catalog with `erro_http` or `resposta_invalida` in the event — the
  per-workspace switch exists for the case of the fallback being too noisy.
- A timeout on Brabo's side may have been charged by OpenRouter without us
  seeing the `usage.cost`: that spending does not enter `token_usage`.
  Declared, not measured.
- The key is one per workspace installation, not per agent nor per project.

## What this ADR does NOT do

- **It does not measure the gain** (AT-239) nor calibrate a threshold; there is
  no threshold in v1.
- **It shows nothing on screen.** AT-236 (answer 3) wants the screen to show
  that the step was routed by Jev, with the confidence, and (answer 16) the
  strip to narrate "choosing tool". The data exists (the event and the stream's
  `tool_routing_started` frame, which the engine ignores as an unknown type);
  the screen and the strip are `apps/web` work, outside this lane.
- It does not change the agent servers beyond what the facade already covers,
  does not route the Anamnese and does not put Jev in the model catalog.
- It does not decide on raising the 2,000 ms ceiling nor on the Dependabot
  ecosystem for the `typesafe/jev-1.13` pin (bump by PR, answer 5).
