---
id: fase-29-instalacao-de-uma-linha
title: FASE 29 — the one-line installation
sidebar_label: FASE 29 — one-line installation
sidebar_position: 16
description: The scope of FASE 29 — signing of published artifacts, a versioned install.sh with a chosen source and a marker, volume backup and the runner's consented base. The decisions are in ADRs 0149 to 0152.
keywords: [fase 29, installer, signature, cosign, backup, runner, projects base]
traducao_de: 23a3d9e8bdca4523c3771b12d65118e8adcd6dcf
---

# FASE 29 — the one-line installation

> This document is the phase's **scope**: what it pursues, what it refuses,
> and in what order. The **decisions** live in [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md),
> [0150](../adr/0150-instalador-de-uma-linha.md), [0151](../adr/0151-base-consentida-no-runner.md)
> and [0152](../adr/0152-backup-de-volumes-contra-compose.md) — whatever is
> here and not there is intention, not decision.

## The problem {#o-problema}

Brabo installs today in **three disconnected gestures**, and none of them knows
about the others:

| gesture | where | what it requires of the installer |
|---|---|---|
| bring up the services | `docker compose -f docker/docker-compose.prod.yml` | export five secrets by hand (RN-114, [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)) and have the checkout |
| put the runner on the machine | browser ([ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)) | download the binary, manual `chmod +x` (BRB-031), repeat per project |
| choose where the code lives | `pnpm bootstrap` ([ADR 0146](../adr/0146-base-consentida-no-bootstrap.md)) | have a **development** checkout — the menu doesn't exist outside it |

FASE 28 **refused in writing** the one-line installer, and the reason still
holds: *"a one-line installer without a signature is worse than the current
download"* ([fase-28-pasta-do-usuario.md](fase-28-pasta-do-usuario.md), BRB-005).
A `curl | sh` that downloads an unsigned artifact turns any
compromise of the channel into code execution on the installer's machine — and
the product today **signs nothing** it publishes.

That is why this phase starts with the signature and not with the installer. The order
is not a preference: without ADR 0149, ADR 0150 would be the thing FASE 28
refused.

## The design, in four layers {#o-desenho-em-quatro-camadas}

Each layer with a single mechanism, and none inventing new authority:

| layer | where | mechanism |
|---|---|---|
| provenance | `release.yml`, `build-runner-binaries.yml` | keyless `cosign` (Actions OIDC) on images and binaries; signed `checksums.txt` |
| installation | versioned `install.sh`, obtained from GitHub Releases | verifies its own origin, detects what already exists, **asks**, writes a marker |
| data | `docker/backup/` | backup and restore that run **against compose**, without a cluster |
| live folder | the runner's `guard.ts` | one consented base; each project is a subfolder inside it |

The fourth layer exists for a physical reason FASE 28 had already named:
a bind mount doesn't cross the network nor reach a path outside what was mounted. The
`brabo-runner` is the process that already lives on the user's machine — what is missing
isn't an agent, it's for it to **be born with a base** instead of a loose path.

## Configuration consent ≠ action approval {#consentimento-de-configuração--aprovação-de-ação}

The point the four ADRs need to declare, and which decides the
installer's design:

Choosing a base, writing a `.env`, creating a folder and installing a service are
**configuration consented to by the user in their own terminal** — not an agent
asking to act. None of it becomes a `proposed_action`, and routing it through there
would fall under the path scope of [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
become a queue of routine approvals and erode precisely the ceiling that gives
the click its meaning.

The corollary holds both ways, and it is what separates this phase from an
ordinary installer: **consent does not waive verification**. The user
consents to the base and to the installation; they have no way to consent to the
provenance of a binary they cannot inspect. That is why signature verification
belongs to the **mechanism**, never a question on screen — and failing it is a
named refusal, never a warning one can accept by clicking.

## Numbering — counted, not inherited {#numeração--contada-não-herdada}

> The repository's prose counts remain in known drift: the
> frontmatter of `docs/adr/index.md` announces a number of ADRs the disk doesn't
> confirm. No session of this phase trusts a number written in prose.

The method, which every session of this phase repeats before reserving any number —
and which FASE 28 already ran, **plus a second half that was missing**:

```bash
# ADRs e RNs em dev — o piso
git ls-tree --name-only dev docs/adr/ | grep -oE '^[0-9]{4}' | sort -n | tail -1
git grep -h -E '^### RN-' dev -- 'docs/business-rules.md' 'docs/business-rules/*.md' \
  | grep -oE 'RN-[0-9]+' | sed 's/RN-//' | sort -n -u | tail -1

# o que está EM VOO — branches locais e remotas ainda não mergeadas
for b in $(git branch --format='%(refname:short)'; git branch -r --format='%(refname:short)'); do
  git merge-base --is-ancestor "$b" dev 2>/dev/null && continue
  echo "$b: $(git ls-tree --name-only "$b" docs/adr/ | grep -oE '^[0-9]{4}' | sort -n | tail -1)"
done
```

Measured at the start of session 1, against `dev`: **147 ADRs** (highest `0147`) and
**382 RNs** (highest `521`). And in flight, at the same moment: **ADR 0148 allocated
by two branches at the same time**, and **RNs 510, 522 and 523** — 522 and 523
also duplicated between two branches each.

**The range reserved for the phase is RN-524 to RN-538**, and the ADRs are **0149,
0150, 0151 and 0152**. The jump over 510/522/523 and over 0148 is deliberate.

Recording the three observed collisions is the point, not a detail: FASE 28
wrote that counting only `dev` would return an already allocated number, and this
session **found the same failure mode happening three times at the same
time**. Counting `dev` is a necessary and not sufficient condition; the second half
of the command above is what was missing, and that is why it comes in here.

> **All three were resolved later, and the criterion was the date.** Whoever allocated
> first keeps the number: the three branches from 2026-09-06 kept
> `ADR 0148`, `RN-522` and `RN-523`, and those from 2026-09-08 renumbered to
> `ADR 0153`, `RN-539` and `RN-540` — above this phase's range, out of reach
> of anything in flight. One of them was already the **second** renumbering of the same
> RN: it was born 522, became 523 to escape a collision, and fell into another —
> because that sweep covered the **remote** branches, and the one waiting for it
> was local.

It's worth repeating why a collision survives so long: **`docs:build` doesn't catch
a duplicate anchor.** `onBrokenAnchors: 'throw'` fails a link to an anchor that
*doesn't exist*; with two identical anchors Docusaurus resolves the first and the
second becomes unreachable, silently.

## What the measurement corrected in the scope {#o-que-a-medição-corrigiu-no-recorte}

This phase's plan was born from a scope written before the measurement. Five points
of it didn't survive the disk, and they are recorded because a plan that
rewrites itself to match the result stops teaching:

- **`workspace.verified` doesn't exist** — not as an event, not as a channel
  message, not as a route. What exists is `workspace_confirm`, and it is
  **one-way**: `terminal_channel.ex:356-373` replies `{:noreply,
  socket}` and pushes nothing back to the runner. A pair with a reply has another
  mold in the repository, that of `exec`/`exec_result`.
- **Point 5 of ADR 0146 doesn't version any `install.sh`** — it versions
  `scripts/dev/consentir-base.mjs`. The principle ("never generated by the api, never
  downloaded at run time", with the corollary that the api gets no route
  that emits a host script) is generalizable, and ADR 0150 **extends** it; but
  citing it as if it already spoke of the installer would be attributing to the ADR a sentence
  it doesn't have.
- **`docker-compose.prod.yml` doesn't consume GHCR.** Every service points
  to `brabo-*:prod` with a local `build:` block, and the file's header says of
  itself: *"what this file is NOT: a hardened production manifest"*.
  The only consumer of `.release/images.json` is kustomize.
- **`make test-restore` is a Kubernetes path** (it requires `kubectl` and the
  `brabo-backup` CronJob), and `docker/backup/backup.sh` covers **only Postgres**. Treating it
  as "the migration proof" in a compose installation would be promising what the
  disk doesn't sustain — hence ADR 0152 existing.
- **The BRB register doesn't belong to the repository.** It lives in the maintainer's vault,
  with 33 items and a definition of done per item; here only two ids appeared, in
  prose. Measuring the six the phase inherited: **BRB-032 and BRB-033 describe
  defects that no longer reproduce**, and **BRB-004 is not what the id suggests** — it asks for
  third-party images by *digest*, not the tag #419 pinned. Hence
  [this repository's register](../reference/brb.md) keeps the **evidence**
  (measured state, `file:line`) and not the finding.
- **"One runner per project" is enforced in five independent places**, not
  only in the `Registry`: the `terminal:<projectId>` topic, the socket id
  `runner_socket:<kind>:<project_id>:<user_id>`, the project-scoped ticket,
  the `runner_device_keys.project_id NOT NULL` column and the service unit
  name. That is why the **per-machine** runner left this phase.

## The sessions {#as-sessões}

One deliverable each. The table is reading order, not precedence — the "depends
on" column is what orders, and FASE 28 recorded the case where the real order diverged.

| # | deliverable | depends on | its own prohibitions |
|---|---|---|---|
| 1 | this document, ADRs 0149-0152, [the BRB register](../reference/brb.md) and the RN range | — | doesn't touch `apps/`, `docker/`, `scripts/`, `.github/`, `deploy/`; doesn't edit an accepted ADR |
| 2 | signing in `release.yml` and `build-runner-binaries.yml`; `checksums.txt`; verification in the runbook | 1 | doesn't write `install.sh`; doesn't change what the images contain; **doesn't touch the api proxy** (see below) |
| 3 | `install.sh`: origin verification, detection, question, marker — **and the `GET /runner-releases/binary` proxy starts verifying** | 2 | **brings up nothing** — not compose, not migrate, not runner |
| 4 | `install.sh`: GHCR × local build source, secrets, installation compose, verified startup | 3 | doesn't install the runner; doesn't migrate a previous installation |
| 5 | volume backup and restore, running against compose | 1 | doesn't touch the k8s CronJob nor `deploy/k8s/test-restore.sh` |
| 6 | `install.sh`: migration of a previous installation, proven with session 5 | 4, 5 | doesn't delete the user's base nor the mirror folder, under any circumstances |
| 7 | runner: consented base in `guard.ts`; `install.sh` installs the runner | 4 | doesn't touch per-project pairing; doesn't create a new credential |
| 8 | protocol: capability and folder-creation message, its own predicate | 7 | doesn't change `RunnerReadiness`; doesn't introduce `proposed_action` |
| 9 | ✅ web: picker via `fs_list_dir` in `runner` mode, wait with three states (RN-533) | 8 | doesn't touch the `mounted` mode path (RN-504, through the api) |
| 10 | ✅ E2E on a clean machine, `install.sh` in the signed manifest, docmap, `docs:check` (RN-534) | 6, 9 | doesn't loosen a gate for the E2E to pass |

> **The two sides of verification don't come in together, and the split is the real
> dependency.** Session 2 delivers whoever **produces** the signature; the consumers
> come in at 3, because the two that exist — `install.sh` checking its own
> hash, and the `GET /runner-releases/binary` proxy checking the binary it serves —
> read the **same** signed `checksums.txt` and can only be written after
> it exists. Until 3 closes, the proxy keeps serving bytes from GitHub
> without verifying anything, exactly as before: session 2 **doesn't worsen** that
> path, and doesn't fix it either.

> **Session 4 doesn't call `docker/smoke.sh`, and the change is deliberate.** The
> plan said "migrate, smoke". Neither survived contact with the
> disk, and for opposite reasons: **migrate** isn't a step because compose already
> chains it (`api` depends on `migrate-api` with
> `service_completed_successfully`, and `up --wait` waits) — a second place
> ordering migration would be the second source of the same truth; and **`smoke.sh`**
> builds the images (`--build`) and tears down the stack at the end, which is the opposite of
> what an installation wants. In its place, the installer **asks before
> asserting**: it hits `/health` on the api and the engine and only then says it installed —
> the rule `reset-total.sh` learned the hard way (BRB-033).

## What this phase does NOT touch {#o-que-esta-fase-não-toca}

Declared in the four ADRs, and repeated here because it is what gives meaning to the rest:

- `decide.ts` and the absolute ceilings of the permissions policy — none gets
  an exception, not even a configurable one
- `proposed_action` as the origin of every external effect of an agent
- the immutability of the event log
- the image gate in the three modes ([ADR 0135](../adr/0135-portao-de-imagem-nos-tres-modos.md))
- the mirror (RN-515/516/517) — the folder binding is another thing, with another
  message; don't merge them
- the five containment layers of the broker ([ADR 0130](../adr/0130-broker-de-container.md))
- `docker-compose.prod.yml`, which remains the **validation** compose for the
  images

## Gaps the phase touches and doesn't solve {#lacunas-que-a-fase-encosta-e-não-resolve}

- **The per-machine runner** — the five couplings above. Declared as
  the scope of the next phase, with the measurement already done.
- **git credential discarded in `docker exec` in `runner` mode** —
  [ADR 0130](../adr/0130-broker-de-container.md)/[0145](../adr/0145-docker-pre-requisito-do-runner.md).
  The initial clone through the new message runs on the **HOST**, through the path that already
  carries the credential, and is therefore **not** affected; the gap stays where
  it was.
- **Revocation reaches `{project, user}`, never `{key}`** (RN-520). With
  per-project pairing preserved in this phase, the cost doesn't change — but when
  FASE 30 makes the runner per-machine, revoking will bring down **all** the
  projects of that machine. Cost declared here so it isn't discovered there.
- **The broker isn't published** — `docker-bake.hcl` has four targets and
  `scripts/ci/images-manifest.ts` accepts four. In a GHCR installation the
  `container-broker` profile is unreachable, and `mounted` mode brings up a container
  **through the broker** ([ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)).
  ADR 0150 decides what the installer does about it.
- **BRB-017** (GPL obligation of the tools bundled in the engine image,
  **P1**) stays where it was — and the phase makes it more concrete, not less: the
  installer distributes that image to third-party machines.
- **BRB-004** (third-party images by **digest**) is touched: the installer
  resolves its OWN images by digest, while `neo4j`, `pgvector` and
  `ollama` remain by tag. See [the BRB register](../reference/brb.md).
