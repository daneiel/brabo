---
traducao_de: 8b4e3fbcf8776909f26bdab5da0c730a4daffecd
---

# 0165 — The repository is born at the acceptance of the handoff to the Arquiteto, and execution does not start without it

## Status

**Accepted.** Decided by the maintainer on 2026-09-18 (AT-092). It revises the
TRIGGER of [RN-522](../business-rules.md#rn-522), which had been born to keep the
promise of [RN-541](../business-rules.md#rn-541) ("the bootstrap is deferred
until the Arquiteto's handoff"). Neither came from an ADR — both were born from a
direct request of the product owner and live only in `docs/business-rules.md` —,
so this is the first structural record of the moment the repository is born. The
provisioning MECHANISM does not change: it is the same
`ProvisionRepositoryUseCase`, idempotent by design since
[ADR 0005](0005-repo-bootstrap-idempotent-steps.md), called by the same
`AcceptHandoffUseCase`. The handoff target rule of
[ADR 0038](0038-hierarquia-de-agentes.md) (an external handoff addresses only an
area lead or an agent without an area) and the Arquiteto → Dev Lead chain of
[ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) remain intact.

## Context

A real v6.1.0 installation, on 2026-09-14, produced this sequence in the event log
of a new project:

- 02:40:54 — the Arquiteto (Architect) proposes `open_adr_pr` three times. The
  repository does not exist yet, and the tool fails all three times.
- 02:43:53 — `handoff.offered` to `infra` and to `dev-lead` (the architecture
  readiness confirmation offers both, `OfferInfraHandoffUseCase`).
- Only the `infra` one is accepted. The `dev-lead` one stays `offered`.
- 03:02:34 — `POST /projects/:id/execution/activate` answers **201**.
- `project_repositories`, `project_git_connections` and `repo_bootstraps` stay
  empty. The project stays without a repository forever.

The two defects are independent, and RN-522 carried both:

1. **The trigger was after whoever needs the repository.** The Arquiteto is the
   first agent with a tool that WRITES to the repository (`open_adr_pr`), and the
   Infra Lead, activated by the Arquiteto → Infra handoff, is the second
   (`open_infra_pr`). Both work BEFORE the acceptance to the Dev Lead. RN-541
   said "the repository is born when development starts", and development,
   measured by what the agents do, starts at the Arquiteto.
2. **The only trigger was SKIPPABLE.** Activating execution does not require an
   accepted handoff to the Dev Lead — it requires a current `module_map`, and
   nothing else. Whoever activates through the Overview (or through the "Activate
   execution" shortcut of the handoff card itself, RN-137) skips the acceptance,
   and with it the provisioning. Nothing on the path refused.

**Who hands off to the Arquiteto, measured.** The Arquiteto can only be activated
with an `accepted` handoff addressed to it (`canActivateAgent`,
`domain/sessions/agent-activation.ts`) — the exception is only the Criativo
(Creative). The handoff is born through two doors, and both write through the
SAME `CreateHandoffUseCase`: the PO, when finishing the backlog, with
`offer_handoff(to_agent: "arquiteto")` (the kickoff instruction in
`po_server.ex` says so), or the user, through the manual handoff
(`RequestManualHandoffUseCase`, ADR 0109). And the acceptance is a single one:
`AcceptHandoffUseCase`, the same one that already hosted RN-522's trigger. There
is no path in which the Arquiteto works without having gone through that
acceptance.

## Decision

**1. The trigger becomes the acceptance of the handoff addressed to
`arquiteto`.** In `AcceptHandoffUseCase`, the branch that calls
`provisionarRepositorio` now fires for `toAgent === 'arquiteto'`, BEFORE
`activateAgent` — the same order RN-522 already used, for the same reason: the
Arquiteto wakes up in a project that already has somewhere to work, and the
first `open_adr_pr` finds a repository. Everything else in the branch stays byte
for byte: always `local` (the only provider without credentials), a failure
becomes `repository.provision_failed` with an origin and never brings down the
acceptance, an ADOPTED repository leaves early without being a failure.

**2. The old trigger STAYS, as a second idempotent door.** The acceptance to
`dev-lead` keeps calling the same provisioning. Three reasons, in order of
weight:

- **It is the way out for the projects already broken.** A project that went past
  the Arquiteto BEFORE this change (AT-092's `exp001` is exactly that: handoff to
  the Arquiteto accepted under the old rule, handoff to the Dev Lead still
  `offered`) has a pending handoff whose acceptance provisions. Without this door,
  the only way out would be the manual provisioning page, which no screen offers
  from the session.
- **It is the natural retry of a failure.** If provisioning fails at the
  acceptance to the Arquiteto, the event stays in the log, and the next step the
  user takes anyway — accepting the Dev Lead — tries again, without anyone
  needing to know a provisioning route exists.
- **The price is zero by construction.** With the `created` repository already
  up, `ProvisionRepositoryUseCase` does not call `createRepo`, creates neither
  session nor bootstrap, and the runner reports all steps as satisfied (ADR 0005).
  That was already proven for three consecutive runs of the use case; what this
  ADR adds is the proof THROUGH BOTH DOORS: accepting the Arquiteto and then the
  Dev Lead, against real Postgres and `LocalGitProvider`, ends with ONE
  `createRepo`, ONE row in `project_repositories`, ONE in `repo_bootstraps`, and
  no `repository.provision_failed`.

Removing the second door was considered and rejected: it has no cost, and the
alternative leaves `exp001` with no way out through the screen where the user is.

**3. `execution/activate` without a repository is REFUSED with 409.** In
`ActivateExecutionUseCase`, right after the `module_map` check and BEFORE any
effect (persisting budget, seeding `permissions.json`, creating a session), the
use case queries `ProvisionedRepositoryRepository.findByProjectId`. Without a
row, `ConflictException` with a NAMED reason, chosen by the state of the
project's handoffs (`HandoffRepository.findByProject`, a new read and only a
read) by a pure domain function:

- there is an `offered` handoff to the Arquiteto → "accept the handoff to the
  Arquiteto";
- otherwise, there is an `offered` handoff to the Dev Lead → "accept the handoff
  to the Dev Lead" (the second door);
- otherwise, one of the two was already accepted → automatic provisioning ran
  and left no repository (`repository.provision_failed` says why), and the path
  is the project's provisioning page;
- otherwise → no handoff to the Arquiteto was accepted, and the repository is
  born there.

An ADOPTED repository counts as a repository. 409 and not 400 because the request
is right: it is the project's STATE that does not yet allow it. Reactivating an
execution that is already running is still not a conflict WHEN there is a
repository; `exp001`, which activated without having one, now also receives the
409 on reactivation — and that is what is wanted, because its dev agents never
had anywhere to work.

**4. The screen does not offer activating without a repository, and says why
once, in text.** The Overview's Execution section reads
`GET .../git/repository` (the same `queryKey` `['repository', projectId]` that
`ProjectPage`, `CodeShell` and Settings already use — no truly new request) and,
with a CONFIRMED `null` answer, leaves the button inert in place and writes the
reason, with the link to the provisioning page. Loading or with an error, the
button stays as it was: "don't know" does not become "doesn't have", and the
backend refuses anyway. On the handoff card to the Dev Lead, inside the session,
the "Activate execution" shortcut disappears while the repository does not exist,
and the card says that accepting the handoff provisions it — the accept button is
right next to it. It is the rule of RN-102 and ADR 0064: remove the control,
never the information.

## Consequences

- **RN-522 changes trigger, not mechanism.** RN-582 records the new rule; RN-522
  and RN-541 gain a note pointing to it, and the creation wizard's comment stops
  saying "Dev Lead".
- **The Arquiteto → Infra before Dev Lead case ceases to exist.** The Infra Lead
  is activated by the Arquiteto's handoff, which by construction only exists after
  the acceptance to the Arquiteto — so the repository has already been born when it
  wakes up.
- **The local refusal of `open_adr_pr`/`open_infra_pr` (AT-088) remains
  necessary**, and complementary: it covers provisioning that FAILED and the
  legacy project, which this ADR cannot prevent from existing.
- **A consequence measured in the code and accepted: the `git-bootstrap` session
  is now born in the MIDDLE of the Arquiteto's phase.**
  `ProvisionRepositoryUseCase` opens its own session for the bootstrap log, and
  the Overview and the workspace summary choose the "most recent" session by
  `createdAt`. Under RN-522 that session was born at the acceptance to the Dev Lead
  and was soon overtaken by the execution one; now it becomes the project's "most
  recent" during the whole conversation with the Arquiteto, until the next session
  is born. The chat session is not affected (its screen reads its own id). Fixing
  it requires deciding whether the bootstrap log deserves its own session, or
  whether "the most recent" should ignore system sessions — both touch another
  front's rule (RN-139, ADR 0005), and are not decided here.
- **A project with no handoff to the Arquiteto at all, with a `module_map`
  written outside the flow**, falls into the refusal's fourth reason and leaves
  through the provisioning page. There is no automatic path for it, and there does
  not need to be.
- **Rejected:** provisioning at project creation (it would undo RN-541, which is
  the product owner's request); provisioning INSIDE `execution/activate`
  (activation would gain a hidden git effect, and the agents before it would
  remain without a repository — defect 1 entirely); and moving the trigger without
  keeping the old door (it would leave `exp001` with no way out through the
  session).
