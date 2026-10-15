# ADR 0102 — Revision of ADR 0065: the external-effect boundary stops being `deny` and becomes an absolute ceiling

- **Status:** Accepted
- **Date:** 2026-08-20
- **Context:** GLOBAL decision by the product owner on git/sudo
  policy, RN-418 (revises RN-106)
- **Revises:** [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

## Context

[ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) decided, at the time, that
`git push`, opening a PR, and deploy never go through the terminal —
the rule was unconditional `deny`, applied BEFORE any permissive stage
in `decide()`, with the message redirecting to the TYPED action
(`git_push`/`git_merge`/`pr_open`). The declared reason for `deny`
(instead of `require_approval`) was concrete: "always allow" existed,
and one click would write the pattern to `allow` in
`permissions.json`, opening the door for good — denying outright was
the only way to guarantee the door never opened.

The product owner asked, EXPLICITLY and GLOBALLY, for a semantic
change: `sudo`/`doas` and terminal commands with a git external effect
must ALWAYS request human authorization — never auto-approvable, even
with "automatic mode" on — and any OTHER command should auto-approve
when automatic mode is on. That's different from `deny`: it's "always
becomes a pending `proposed_action`, decided case by case," not
"always refused without becoming anything."

An automated security system flagged this change during implementation
(altering a rule that CLAUDE.md itself described as an absolute
`deny` deserves extra scrutiny) — the product owner explicitly
confirmed, after reviewing the change, that this was indeed the
intended decision.

## Decision

`git push`/opening a PR/deploy (RN-106, revised) and `sudo`/`doas`
(new) leave the boundary block (which used to sit right after IAM,
returning `deny`) and become an ABSOLUTE CEILING — in the SAME final
block where the other ceilings already live (protected-branch merge,
`instruction_patch`, `parallelize`/`raise_max_parallel`, path scope),
in the SAME code pattern (`current.policy === 'auto_approve'` →
overridden to `require_approval`). By construction, the ceiling holds
even if `agent_autonomy` says `auto_approve` for the wildcard `"*"`,
and even if `permissions.json` has an `allow` entry that would match.

**The "always allow" gap was closed AT THE SOURCE**, a necessary
condition for this ADR to be safe: `ApproveAlwaysActionUseCase`/
`patternForAction` REFUSE to write an `allow` pattern for a terminal
action with a git external effect or a privileged command. The user
can still approve the specific INSTANCE through the normal approval
flow — only "always allow" (which would write forever) is refused,
with a clear message explaining why. Without this second half, the
absolute ceiling becomes decorative — one click would be enough to
reopen the door it claims to close. It's exactly ADR 0065's original
argument for `deny`, just resolved at the origin instead of blocking
the symptom.

`sudo`/`doas` get their own category in `external-effect.ts`
(`comandoPrivilegiadoNoComando`), matching by VERB in any segment of
the command (the same principle as `efeitoExternoNoComando` for git).
They have no equivalent typed action to redirect to — the message just
explains why that command asks for a human decision.

## Consequences

- `require_approval` here isn't "weaker" than `deny` in the sense of
  "the agent can do it alone" — in NEITHER state does the command
  execute without an explicit human decision. The difference is purely
  one of MECHANISM: before, the terminal path to git was blocked and
  only the typed action (which already always required approval)
  existed; now, the terminal path itself can also become a pending
  `proposed_action`, auditable in the event log, decided case by
  case — consistent with the rest of the product, which prefers a
  pending, traceable action over a silent refusal.
- This is the FOURTH/FIFTH line of the absolute-ceiling ruler that
  `decide()` applies unconditionally — CLAUDE.md and the conventions
  documentation need to count this ceiling alongside the others from
  now on.
- The local runner's engine (ADR 0103) is the most direct consumer of
  this change: without it, a legitimate `sudo` on the user's own
  machine would fall into the generic `require_approval` (with no
  guarantee of never becoming auto-approvable if `permissions.json`/
  auto mode ever covered that verb by accident) — the absolute ceiling
  closes that risk by construction, not by convention.
