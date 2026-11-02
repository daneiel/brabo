---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0167 — Automatic mode releases the path scope, and only it

## Status

**Accepted.** Decided by the product owner on 2026-09-26 (AT-226), among three
options: *"with automatic mode on, the agent executes any terminal command
without approval, including outside the project folder"*. It revises, ONLY for an
agent in automatic mode, the path scope ceiling of
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md). It edits neither
0055 nor [ADR 0102](0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md)
(the external effect/privileged command ceiling, RN-418), which remain valid in
full. The rule born from here is
[RN-603](../business-rules/autenticacao.md#rn-603); it revises
[RN-153](../business-rules/autenticacao.md#rn-153) and
[RN-154](../business-rules/autenticacao.md#rn-154).

## Context

"Automatic mode" ([RN-153](../business-rules/autenticacao.md#rn-153)) is the
`"*"` wildcard in `agent_autonomy`: autonomy for any action type of an agent. It
was designed NOT to break any ceiling of `decide()` — the ceilings acted on
`current.policy === 'auto_approve'`, without knowing where the permissiveness came
from ([RN-154](../business-rules/autenticacao.md#rn-154)).

One of those ceilings is the PATH SCOPE one (ADR 0055): a terminal command that
touches a path outside the project folder is never auto-approvable. Measured in
the owner's database on 2026-09-26, project `exp001` (`mounted` mode, container
up): with automatic mode on in the dev agents, **51** terminal commands still
asked for approval, and **47** only because they cited `/work` or `/tmp`. The dev
agent runs INSIDE the container, where the project folder is `/work`, and the
scope compares the command with the HOST root — so everything the agent writes
the right way for where it runs becomes "outside the project folder". None of the
51 was `git push`, PR, deploy or `sudo`.

There was a second request for the same reason, without the scope name: a
COMPOUND command (`cd /work && npm test`) with a segment without a rule in
`permissions.json` receives a `require_approval` SYNTHESIZED by the file — which
exists to prevent a partial `allow` from promoting the whole command — and that
verdict overwrote the autonomy's `auto_approve`.

The owner asked: *"once the user presses the automatic mode button, that agent
should understand it can execute any command… it should only ask for approval
again when the user sets the agents back to manual"*.

## Decision

1. **`decide()` now knows the ORIGIN of the autonomy.** The repository
   (`AgentAutonomyRepository.resolve`) returns the resolved mode AND whether it
   came from the type-specific rule or from the wildcard. The specific > wildcard
   precedence keeps living there, only once — `findMode` became a reading of
   `resolve`, not a second rule. `decide()` remains pure: it receives
   `ctx.autonomyOrigin`, and an absent origin counts as `'especifica'` (whoever
   does not report it keeps the previous verdict).
2. **Automatic mode is exactly: the wildcard, resolved as `auto_approve`.**
   `"*": require_approval` (the toggle off) and `"*": deny` gain no power at all.
   A type-specific rule (`terminal: require_approval`) beats the wildcard in the
   repository and arrives with origin `'especifica'` — automatic mode does not
   override it.
3. **In automatic mode, the path scope ceiling does not apply.** Nor the
   `require_approval` the compound command synthesizes per segment without a
   rule: it is the file WITHOUT an opinion, and a file without an opinion never
   downgrades a previous stage. An `ask` WRITTEN in `permissions.json` remains
   valid — it is the user's rule, and an explicit rule beats the wildcard, as in
   the repository.
4. **Everything else stays byte for byte.** `deny` (from `permissions.json`,
   from the built-in defaults or from specific autonomy) still wins; the external
   effect/privileged command ceiling (`git push`, PR, deploy, `sudo`/`doas`,
   RN-418) runs BEFORE the scope one and does not look at the origin; merge into
   a protected branch, `instruction_patch`, `parallelize`/`raise_max_parallel`
   and `container_remove` remain never auto-approvable.
5. **The screen says, before the click, what the button releases and what still
   asks.** The `ApprovalCard` note applies in both variants (chat and the
   Approvals queue), and the agent card shows a sentence under the toggle — only
   when the WILDCARD is on, because the toggle over the representative type
   writes a specific rule, which does not release the scope.

## Consequences

- An agent in automatic mode can read and write outside the project folder
  without asking. It is the chosen price: finding U (the agent reading the code of
  the platform that executes it, ADR 0055) becomes possible again FOR THAT AGENT,
  by explicit decision of the user who turned on the mode. The containment that
  remains is that of the place where the command runs — the container's mount
  namespace (`container`/`mounted`, ADR 0134) or the user's machine (`runner`) —
  plus `deny` and the effect ceilings.
- Switching the agent card's toggle back to "manual" rewrites the wildcard as
  `require_approval` and restores the scope ceiling on the next proposal.
- The card's toggle, when there is NO recorded wildcard, keeps editing the
  representative type (`autonomyActionTypeFor`) — a specific rule. Turning it on
  there is not automatic mode and does not release the scope; the screen does not
  say it releases.
- `decide()` stops being blind to the autonomy's origin, which was the proof by
  construction of RN-154. The proof remains valid for all ceilings except the
  scope one, and it is locked by tests: each of them with the wildcard on stays
  `require_approval`.

## Alternatives considered

- **Translating `/work` to the host root before the scope.** It would solve
  `exp001`'s 47, but not `/tmp` nor what the owner asked ("any command"). And the
  translation lives in the engine, after the decision, on purpose (ADR 0134).
- **Releasing the scope for every `auto_approve` autonomy, specific or not.**
  Rejected: per-type `terminal: auto_approve` has existed since Phase 8d with the
  scope on top, and changing its meaning without anyone having asked would reopen
  finding U in projects that never turned on automatic mode.
- **Letting the `ask` written in the file be ignored too.** Rejected: it would be
  automatic mode overriding an explicit user rule, the inverse of the precedence
  the repository already applies.
