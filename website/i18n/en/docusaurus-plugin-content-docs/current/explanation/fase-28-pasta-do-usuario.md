---
id: fase-28-pasta-do-usuario
title: FASE 28 — the user's folder
sidebar_label: FASE 28 — user's folder
sidebar_position: 15
description: The scope of FASE 28 — a base consented to in the bootstrap, mounted as the local default, and a local agent that declares capabilities. The decisions are in ADRs 0146 and 0147.
keywords: [fase 28, user folder, projects base, runner, mirror, capabilities]
traducao_de: 30db82e3431b60a20fdb35062732923d3ddb6a5a
---

# FASE 28 — the user's folder

> This document is the phase's **scope**: what it pursues, what it refuses,
> and in what order. The **decisions** live in [ADR 0146](../adr/0146-base-consentida-no-bootstrap.md)
> and [ADR 0147](../adr/0147-agente-local-com-capacidades.md) — whatever is here
> and not there is intention, not decision.

## The problem {#o-problema}

The product has had three execution modes since [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md),
and none of them delivers the simplest thing a user expects: **open the
editor and see the work happening in a folder of their own**.

| mode | user's folder | what it costs |
|---|---|---|
| `container` | does not exist | the code lives in a volume they never open |
| `mounted` | yes, under `BRABO_PROJECTS_BASE` | **invisible in practice**: without the variable the mode isn't even offered, and nothing in the product asks for it to be configured |
| `runner` | yes, real folder | binary, manual `chmod +x`, pairing, and Docker as a hard prerequisite (RN-507/508) |

`mounted` is the most instructive case. [ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md)
built the single base and [ADR 0142](../adr/0142-validacao-de-workspace-montado-adiada.md)
made it possible to suggest a path that doesn't exist yet — but neither of the two
things reached the screen. `GET /workspaces/:workspaceId/projects-base` exists, is
consumed by nobody in the web, and so the mode that was already ready remains
out of reach for whoever installs the product.

## The design, in three layers {#o-desenho-em-três-camadas}

Each layer with a single mechanism, and none inventing new authority:

| layer | where | mechanism |
|---|---|---|
| consent | `pnpm bootstrap`, once, on the host | picks the base, writes `BRABO_PROJECTS_BASE`, proves Docker Desktop file sharing |
| live folder | inside the base | bind by identity (ADR 0141) — zero synchronization |
| destination outside the base | optional, per project | the local agent's `espelho` capability: one direction, never deletes |

The third layer exists for a physical reason: **a bind mount does not cross the network
nor reach a path outside what was mounted.** To write to an arbitrary folder
on the host there are only three ways out — run api/engine natively, have a
live process on the host, or have the browser write through the File System Access API. The
second is the only continuous one, and `brabo-runner` already is that process.

## Configuration consent ≠ action approval {#consentimento-de-configuração--aprovação-de-ação}

The point both ADRs need to declare, and which decides the mirror's design:

The mirror's write does **not** go through `proposed_action`, because it isn't an agent
asking to act — it is the system writing to a path the user themselves
declared when creating the project. Syncing through a terminal command would be the
opposite: it would fall under the path scope of [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
become a queue of routine approvals, and erode precisely the ceiling that gives
the click its meaning.


## Numbering — counted, not inherited {#numeração--contada-não-herdada}

> The repository's prose counts are in known drift. `CONTRIBUTING.md`
> says "68 ADRs"; the frontmatter of `docs/adr/index.md` says "108". No session
> of this phase trusts a number written in prose.

The method, which every session of this phase repeats before reserving any number:

```bash
# ADRs — arquivos, não prosa
ls docs/adr/ | grep -cE '^[0-9]{4}-.*\.md$'

# RNs — cabeçalhos, nos três arquivos que compartilham a numeração
git grep -h -E '^### RN-' -- 'docs/business-rules.md' 'docs/business-rules/*.md' \
  | grep -oE 'RN-[0-9]+' | sort -u | wc -l
```

Measured at the start of session 1, against `dev`: **144 ADRs** (highest `0145`, with a
gap at `0062`) and **371 RNs** (highest `509`, zero duplicate anchors). Hence
`0146` and `0147`.

**The range reserved for the phase is RN-511 to RN-520**, and the jump over RN-510 is
deliberate. Counting only `dev` would return 510 — but RN-510 was already allocated
in a work branch that hadn't merged yet. Reserving it here would recreate
exactly the collision that happened with RN-505, when two PRs allocated the
same number two minutes apart and the `{#rn-505}` anchor stayed
duplicated for weeks.

It's worth recording why that collision survived so long: **`docs:build`
doesn't catch a duplicate anchor.** `onBrokenAnchors: 'throw'` fails a link to an
anchor that *doesn't exist*; with two identical anchors Docusaurus resolves the first
and the second becomes unreachable, silently. Counting only what is in `dev` is a
necessary condition and not a sufficient one — you also have to count what is in flight.

## The sessions {#as-sessões}

One deliverable each, in order. The full prompt for each session is written at the
end of the previous one, with whatever it discovered.

| # | deliverable | depends on |
|---|---|---|
| 1 | this document + ADR 0146 + ADR 0147 + reserved RN range | — |
| 2 | consented base in `bootstrap.sh`/`preflight.mjs`, `.env.example`, file-sharing proof | 1 |
| 3 | wizard offers `mounted` by default when the base exists | 2 |
| 4 | broker in the local compose per the verdict of ADR 0146 | 2 |
| 5 | capabilities declared in the local agent's protocol (no mirror yet) | 1 |
| 6 | `espelho` capability: own scope, one direction, never deletes | 5 |
| 7 | install as a user service, stop/remove, server-side revocation | 6 |
| 8 | mirror state on the web (last sync, count, error) | 6 |
| 9 | E2E, `docs:check`, docmap and CHANGELOG closed | 8 |

## What the phase delivered, and where it deviated from the plan {#o-que-a-fase-entregou-e-onde-ela-desviou-do-plano}

The table above is the plan. What follows is the record of what happened — the
differences are here because a plan that rewrites itself to match the
result stops teaching anything.

| # | RN/ADR | how it came out |
|---|---|---|
| 1 | ADR 0146, ADR 0147 | as planned; range RN-511..520 reserved, with the jump over RN-510 (already allocated in an unmerged branch) |
| 2 | ADR 0146 points 1–2 | as planned — default base `$HOME/projetos-brabo`, written by a Node script because a `bootstrap.sh` menu item runs with stdin on `/dev/null` and by construction cannot ask |
| 3 | RN-513 | both halves were already rules (RN-500/RN-501) and had never reached the screen; the only NEW thing was the pre-selection |
| 4 | RN-512, ADR 0146 point 3 | the broker leaves `profiles` in the LOCAL compose **and only there** — the two composes diverge on purpose |
| 5 | RN-514, ADR 0147 point 1 | as planned; the refusal for a missing capability was born implemented and tested **without firing** — only RN-516 gave it its first real firing |
| 6 | RN-515/RN-516, ADR 0147 points 2/3/4/8 | split into two halves (destination × copy), a decision made during the session |
| 7 | RN-518, RN-519/520, ADR 0147 points 5–6 | delivered **after** session 8 — both depended only on 6, and nothing ordered them relative to each other |
| 8 | RN-517, ADR 0147 point 7 | as planned |
| 9 | — | closing: the missing E2E, the docmap rule for `apps/runner/**` and this record |

Three things came out differently from what the plan assumed, and all three are
declared where it matters:

- **Session 7 ran after session 8.** Both depended on 6 and nothing else, and
  neither depended on the other — the table order was reading order, not precedence.
- **BRB-031 did not die.** [ADR 0147](../adr/0147-agente-local-com-capacidades.md)
  expected the install-as-a-service to kill the manual `chmod +x` of
  [ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md).
  It doesn't: whoever gets to run `brabo-runner service install` already had to
  make the binary executable to reach the command. The side effect
  depended on the installation coming from the versioned bootstrap of
  [ADR 0146](../adr/0146-base-consentida-no-bootstrap.md), which this phase did not
  wire up.
- **Revocation reaches `{project, user}`, never `{key}`.** Point 6 of the
  ADR didn't promise per-credential precision, but that was its natural reading.
  It doesn't exist: `runner_socket_tickets` stores `project_id`/`user_id`/`kind`,
  and the credential's identity dies in `PatAuthGuard`. The cost is written in
  RN-520 and in `security-surface.md` instead of disguised.

## What this phase does NOT touch {#o-que-esta-fase-não-toca}

Declared in both ADRs, and repeated here because it is what gives meaning to the rest:

- `decide.ts` and the absolute ceilings — no ceiling gets an exception, not even a configurable one
- `proposed_action` as the origin of every external effect of an agent
- the immutability of the event log
- the image gate in the three modes ([ADR 0135](../adr/0135-portao-de-imagem-nos-tres-modos.md))
- the five operations and the computed spec of the broker ([ADR 0128](../adr/0128-porta-de-docker-e-a-prova-de-empacotamento.md)/[0130](../adr/0130-broker-de-container.md))
- the `project_execution_mode` enum — no new mode is born in this phase

## Gaps the phase touches and doesn't solve {#lacunas-que-a-fase-encosta-e-não-resolve}

- **git credential discarded on the `docker exec` path in `runner` mode** —
  `apps/runner/src/index.ts:318-320`; `packages/docker-port` has no `env` field,
  by decision of ADR 0130. Declared in ADRs 0130/0145, not fixed here.
- **a symlink inside the project pointing outside** is not detected by
  `decide()`, which is pure and does no I/O — ADR 0055. `apps/runner/src/guard.ts:9-31`
  declares itself best-effort for the same reason.
- **BRB-005** — the published artifacts (GHCR images, runner binaries)
  are not signed. A one-line installer without a signature is worse than the
  current download, and that is why session 7 doesn't get a one-line installer.
- **BRB-031** — manual `chmod +x` in the browser configuration. It goes away as a
  side effect if installation starts coming from the versioned bootstrap.
- **`{project_id, machine_id}` exclusivity** postponed until there is a second real
  simultaneous dev — ADR 0137.
