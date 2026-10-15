---
traducao_de: 368d70ac0b60ed35c47ec8245b812c79d81e4550
---

# ADR 0204 — Automatic mode releases push and PR

## Status

**Accepted.** 2026-10-02 (AT-385; owner decision on 02/10: *"yes, allow
auto-promotion of any and every agent if the agent is in auto mode"*, confirmed
as applying also to the dev agents' `git push` and PR opening). Revises, without
editing them, [ADR 0102](0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md)
(the absolute ceiling on external effects, RN-418) and RN-689 (the same ceiling
through the typed door), only in the push and PR half. Preserves
[ADR 0167](0167-modo-automatico-libera-o-escopo-de-caminho.md) and
[ADR 0189](0189-o-piloto-automatico.md).

## Context

Since RN-418, `git push`, PR opening, deploy and `sudo`/`doas` were
unconditional `require_approval` in `decide()`, even with automatic mode on;
RN-689 extended the ceiling to the typed actions `git_push` and `pr_open`. With
the autopilot (ADR 0189) the dev agent already runs free inside the container,
and the only point where the execution flow still stopped for a human decision
in automatic mode was each task's push and PR.

## Decision

1. With the agent's AUTOMATIC MODE — the `agent_autonomy` wildcard
   `actionType: "*"` resolved to `auto_approve` (origin `curinga`) —, typed
   `git_push` and `pr_open`, and the same effect through the terminal command
   (`git push`, `git remote add/set-url`, `gh pr create`, `glab mr create`),
   come out `auto_approve`, with the reason `modo automático (RN-713)` in
   `proposed_action.created` (RN-567).
2. ONLY the wildcard releases. A specific `auto_approve` rule without the
   wildcard, "Always allow" (still refused at the source for push/PR) and `allow`
   in `permissions.json` still fall into the ceiling. Activation still seeds only
   `git_commit` (RN-689).
3. Still an absolute ceiling, even in automatic mode: merge (into a protected
   branch, through the typed action; and `git merge`/`gh pr merge` through the
   terminal), deploy, `sudo`/`doas`, `container_remove`, `instruction_patch` and
   parallelism.
4. `open_adr_pr`/`open_infra_pr` already followed automatic mode and still do.
5. Switching the toggle back to manual restores approval for push and PR.

## Consequences

- The dev agent in automatic mode pushes and opens PRs without stopping; the
  merge into `dev` stays manual, so code only reaches a permanent branch through
  a human click.
- The guarantee becomes the explicit consent of automatic mode, per agent, and no
  longer the ceiling. The price is declared: a PR opened by mistake does not ask
  for confirmation before existing in the provider.
