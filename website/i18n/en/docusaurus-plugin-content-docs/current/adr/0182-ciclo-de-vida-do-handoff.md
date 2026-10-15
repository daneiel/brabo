---
traducao_de: bc37a486a802cb4f98fc31c0b53619d72c5a77ce
---

# ADR 0182 — The handoff offer gains a lifecycle: one pending per destination, and `superseded`

## Status

**Accepted.** 2026-09-30 (AT-291 and AT-292, story HS-075, round 29; the vault's
AT-273 merges into AT-292 by owner decision). On top of
[ADR 0038](0038-hierarquia-de-agentes.md) (an external handoff addresses only an
area lead or an agent without an area, validated in `CreateHandoffUseCase`) and
[ADR 0090](0090-qa-estrategia-e-appsec-segundo-momento.md) (AppSec delivers the
threat model to three destinations). It does not edit them: it **adds a state
and an invariant** to the `handoffs` table.

## Context

Measured in the `dev` code on 2026-09-30:

- `HandoffStatus` declared `offered | accepted | completed | rejected`, but only
  `offered` and `accepted` were written. There was no expiration, supersession
  nor dedupe.
- `CreateHandoffUseCase` inserted a new row on every call. Any repetition became
  a new offer: the agent repeating `offer_handoff`, the Criativo reconfirming
  readiness, the Staff returning another RFC.
- `OfferInfraHandoffUseCase` was not idempotent. A double click on
  "architecture ready", or two tabs, recorded the milestone twice and asked the
  engine for two Arquiteto closing turns and two offers to the Dev Lead — 2×
  Infra and 2× Dev Lead on screen.
- AppSec (`criar_handoffs_appsec/3`) creates three offers per story with
  `run_design`, to the same three destinations (`arquiteto`, `dev-lead`,
  `infra`). With N stories, 3N pending offers piled up.
- An offer to an agent that was already active stayed `offered` forever, and the
  screen showed it as actionable: accepting would activate again someone who was
  already up.

## Decision

1. **New status `superseded`** (migration `0064`, only `ALTER TYPE … ADD
   VALUE`). The offer that stopped being the current one changes status in the
   ROW, as acceptance already did, and gains a `handoff.superseded` event with
   `handoffId`, `toAgent`, `motivo` (`agente_ativado` | `nova_oferta`) and
   `substitutaId`. Never an UPDATE on an event: the `handoff.offered` that
   announced the offer stays as it was. The event lands in the OLD offer's
   session, with the `system` actor `handoff-lifecycle`, and goes in even in a
   closed session (it is not conversation, RN-581).

2. **At most ONE `offered` offer per (project, destination).** The decision is
   pure (`decidirOferta`, `domain/sessions/ciclo-de-vida-do-handoff.ts`):
   - no pending one, create;
   - pending in the SAME session and the new offer brings no new artifact
     (`null` or equal) → return the existing one (`desfecho: ja_oferecido`),
     with no row nor event. It is the double click, the two tabs, the agent
     repeating the tool;
   - any other case (NEW artifact, or pending in another session) → create the
     new one and SUPERSEDE the pending one (`desfecho: substituiu_oferta`).

   **Why supersede, and not always return the existing one.** The card asked for
   both options and preferred not to lose the new artifact. Returning the old
   one when the artifact changed would leave the rewritten brief (or the Staff's
   new RFC) without an offer carrying it. Returning a pending one from ANOTHER
   session would leave the requester with nothing to accept in the conversation
   they are in — and, if the other session already closed, with nothing
   acceptable anywhere (RN-581 refuses acceptance in a closed session).
   Returning only holds where nothing is lost: same session, same artifact.

3. **Concurrency via a TRANSACTION advisory lock**
   (`pg_advisory_xact_lock(hashtextextended('handoff:<projeto>:<destino>'))`),
   not via a partial unique index. The index would require cleaning the
   duplicates that already exist BEFORE creating it, in the same migration — and
   the new enum value cannot be used in the transaction that creates it.
   Cleaning by marking `rejected` would lie; cleaning without an event would
   violate the rule itself. With the lock, the earlier duplicates converge on
   the next offer or activation for that destination, WITH an event. The lock is
   per destination, not per project: offers to different destinations do not
   wait on each other.

4. **An offer to an agent already ACTIVE in the project is refused**, 409
   `agente_ja_ativo`, with no row nor event. Active = `agent.activated` for it
   in a project session that is NOT terminal — the screen's reading
   (`session-handoffs.ts`) extended from session to project; a closed session
   stops its conversational agents. The `message` is the text the model reads
   (RN-163): the `offer_handoff` tool passes it on literally, and
   `FalhaDeTurno.origem/1` classifies it as `politica`, not `codigo`.

5. **Activating an agent supersedes the pending offers to it**, in ANY session
   of the project, through the three paths that activate: acceptance (which goes
   through `ActivateAgentUseCase`; the accepted one is already `accepted` and is
   not touched), direct activation and execution activation (by
   `dev-<modulo>`).

6. **`OfferInfraHandoffUseCase` idempotent.** Each destination (`infra`,
   `dev-lead`) with a pending offer or already active is not triggered again;
   with both like that, nothing is written nor asked of the engine
   (`desfecho: ja_oferecido`, `jaAtendidos` saying why). Only what is missing is
   triggered: Infra active and Dev Lead without an offer asks only for the Dev
   Lead's, with no Arquiteto turn.

7. **AppSec only offers to whoever has not yet received one nor is active
   (RN-636).** The engine asks the api in `seAusente` mode
   (`create_handoff_if_absent/5`), instead of checking beforehand: asking from
   here would race with another offer, and the api answers under the
   destination's lock. "Already offered" and "already active" do not become
   `agent.error`; a real failure is still narrated per target (RN-116).

## Consequences

- **The screen gets one more status.** `GET .../handoffs` returns `superseded`,
  and the creation routes return `desfecho`. The web types are regenerated here;
  what the screen DOES with the new status (not offering it as actionable,
  reading "active" from the project) belongs to the `handoff-web` lane
  (AT-293..295).
- **The race of two clicks at the SAME instant on "architecture ready" still
  records the `architecture.readiness_confirmed` milestone twice.** No offer is
  duplicated (the lock), and the Arquiteto's second turn is refused by the
  engine with 409 `turno_em_andamento`
  ([ADR 0163](0163-o-clique-responde-ao-aceitar.md)). Also closing the event
  would require holding the lock during the engine call, which is network inside
  a transaction — refused.
- **A new offer to an active agent ceases to exist, and with it "reactivating
  through the offer".** Whoever rewrites the brief with the PO already active
  gets the named refusal; the artifact stays in the log and the conversation
  goes on with the active agent. Whoever needs a new round closes the session in
  which it is active.
- **The threat model offer of a second story is not born while the first one's
  is pending** (RN-636). The artifact stays in the log; the destination, when
  activated, reads the project's threat models. The pending offer does not point
  to the most recent one — that is the price of not superseding the offer that
  still awaits acceptance.
- **Execution activation supersedes offers to `dev-<modulo>`, which today are
  not born** (a subagent does not receive an external handoff, ADR 0038). The
  call exists so the rule holds the day the hierarchy changes, and costs one
  read per module.
- **The earlier duplicates are not cleaned by the migration.** They converge on
  the next offer or activation to the same destination. A destination that never
  again receives an offer nor an activation keeps its `offered` ones, as today.
