---
id: brb
title: BRB register
sidebar_label: BRB register
sidebar_position: 10
description: The BRB findings this repository can verify — id, title, severity, measured state and the file:line that proves it. The full register lives in the maintainer's vault.
keywords: [brb, security, findings, backlog, supply chain]
---

# BRB register

`BRB-NNN` findings are raised and prioritised in **the maintainer's vault**
(`07-backlog/Backlog de Melhorias (Brabo)`), which holds all 33 of them with
priority, effort, origin, proposal and a "done when". That register is the
source for **what a finding is**.

This file is the part the repository can **verify**: for each finding the code
here can prove or disprove, the measured state with its `file:line`. Created by
**FASE 29**, session 1
([fase-29-instalacao-de-uma-linha.md](../explanation/fase-29-instalacao-de-uma-linha.md)).

## Why this file exists

`BRB-018` is what the second rule looks like in practice. Nothing about it
changed in the code — no reprojection was written — but the repository gained
the ability to say *why* it is still open and *what it costs while it is*, so
the row exists now and did not before.

Two ids — `BRB-005` and `BRB-031` — were referenced across five documents here,
in prose, with no state anyone could check. The other ids were invisible to
this repository entirely: a full-disk search returns **only those two**.

The cost was measured, not imagined. Planning FASE 29 listed six BRB items as
prerequisites or risks; checking each against `dev` found that **two describe
defects already fixed here**, and that a third had been *misread from its id
alone* — see `BRB-004` below, which is not about the tag anyone assumes.

Two rules follow:

- **State is backed by `file:line`, measured, never remembered.**
- **The vault owns the finding; the repository owns the evidence.** Where the
  two disagree about whether something still happens, the repository wins —
  it is the thing being described. Whether an item is formally *closed* stays
  the maintainer's call, in the vault.

## What this repository can verify

| id | title (from the vault) | prio | state measured here | evidence |
|---|---|---|---|---|
| **BRB-001** | Cap self-downgrade through the REMOVAL of a project membership | **P1** | **defect no longer reproduces** | `RemoveProjectMemberUseCase.execute` took `(projectId, userId)` — **no actor** — and the controller called it with the two route params, so a `maintainer` whose authority came from the project row (`viewer` in the workspace) could remove their own row and drop to `viewer` irreversibly; the case was pinned in a test whose own name said it was open. [ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md) had declared the gap in writing, cost estimate included. Closed by [ADR 0156](../adr/0156-teto-de-auto-rebaixamento-na-remocao.md) / [RN-556](../business-rules.md#rn-556): the actor now reaches the use case, `remocaoEhAutoRebaixamento` **delegates** to the existing cap-2 rule with the workspace role as the requested one, and the lacuna test was INVERTED rather than deleted. The workspace-`owner` cap deliberately gets no counterpart — removal can only raise an owner |
| **BRB-002** | Cap self-movement on the WORKSPACE member upsert | **P1** | **defect no longer reproduces** | `AddWorkspaceMemberUseCase.execute` took `(workspaceId, userId, role)` and called `workspaces.addMember` — **no actor** — while the controller (`@Post(':workspaceId/members')`, `@RequireRole('owner')`) passed the raw body with no `@CurrentUser()`. An `owner` could write themselves `viewer` and lose the whole workspace: nothing above catches the fall, and `WorkspacesController` has **no member `@Delete`** (measured), so undoing is that same route, demanding the `owner` just abandoned. [ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md) named it in writing (*"same class of defect, one scope up"*) and [ADR 0156](../adr/0156-teto-de-auto-rebaixamento-na-remocao.md) left it as a separate decision. Closed by [ADR 0157](../adr/0157-teto-de-auto-movimento-no-upsert-de-workspace.md) / [RN-557](../business-rules.md#rn-557): the actor reaches the use case and changing your own role is 403 in **both** directions. The cap does **not** count owners (the clause already guarantees a workspace never reaches zero, since removing the last owner would take that owner), and cap 1 gets no counterpart here — `@RequireRole('owner')` already forbids the hierarchy inversion it exists to stop, and adding it would make `owner` an absorbing state with no HTTP exit. The same ADR closes **self-promotion** on both association routes, revising ADR 0127's Consequences: it is the only half of the movement that escalates privilege |
| **BRB-004** | Pin third-party images (`neo4j`, `pgvector`, `ollama`) **by digest** | P2 | **defect no longer reproduces** | Was: every third-party image pinned by **tag**, not digest. Tag pinning had closed a *different* gap (PRs #401/#419) and this row read as if that were the fix — the reason the id/description distinction below earns its keep. Closed by [ADR 0158](../adr/0158-imagem-de-terceiro-por-digest.md): all **37** third-party references go by index digest with the tag in a trailing comment, and `scripts/ci/imagens-pinadas.ts` fails the `lint` job on a mutable reference, on a digest with no tag comment, and on the same tag carrying two different digests. The count is 37 and not the finding's own list, because three whole places were outside it: the Dockerfile `FROM` lines (the base of the four images we publish and sign), and the `services:` images of `ci.yml`/`golden-set-rag.yml` — the CI runner the sibling rule already protects, reached by the other door. The four images the product publishes are **deliberately not covered**: no third party can move them, `brabo-api:prod` is a local tag whose digest does not exist before the build, and where they cross a registry [ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md) already resolves them — the overlay holds a marker on purpose, so a literal there would fail the correct state. Declared and not fixed, because it is the price of the pin: a digest gets no security update until someone bumps it by hand, and Dependabot's `docker` ecosystem stays off — a separate decision. Also uncovered, and stated: `otel-collector-values.yaml`, where `image:` opens a map whose tag the Helm chart chooses |
| **BRB-005** | Sign the GHCR images and the runner binaries | P2 | **implemented, not yet exercised** | Was: no `cosign`/`sigstore`/`attestation` anywhere, `release.yml` without `id-token: write`, no `checksums.txt`. Now: `release.yml` signs the four images **by digest** and verifies them in the same run; `build-runner-binaries.yml` gained a `checksums` job publishing **one** signed manifest for the five targets ([ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md), [RN-524](../business-rules.md#rn-524)); verification procedure in [the runbook](../runbook.md#verificar-artefato-publicado). **Not exercised**: signing only runs on a real final tag, so nothing here proves it end to end yet. Still uncovered, and a separate item: OS code-signing of the binaries (notarization/Authenticode). Session 3 made the download proxy `GET /runner-releases/binary` verify — but **only the sha256 against the release's `checksums.txt`**, never the manifest's signature ([RN-525](../business-rules.md#rn-525)): that is integrity, not provenance, and whoever can rewrite the Release rewrites both files. Both ways for the api to check the signature were **measured and refused**: `cosign` in the image is 155 MB (nearly doubling an Alpine+Node runtime image), and `@sigstore/verify`+`@sigstore/tuf` is cheap (2.5 MB) but makes a `@Public()` route depend on a *second* third-party host (`tuf-repo-cdn.sigstore.dev`) to verify something no Release carries yet — unprovable, and ADRs 0041/0042 forbid declaring an unproven capability. The signature consumer is `install.sh` (session 4/7), which has a real pinned `cosign`. **So the provenance half of the proxy stays open**, and refusal is already named there: a Release without `checksums.txt` is refused, not served with a warning |
| **BRB-017** | Meet the GPL obligation of the tools baked into the published engine image | **P1** | **defect no longer reproduces** | Was: nothing under `docker/engine/` mentioned licences, an obligation that became real when [ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md) started publishing to GHCR on every final tag. The offer existed and was good — `THIRD_PARTY_NOTICES.md` at the root, naming each component, its exact version and its licence — **it just did not travel**. It does now: `docker/engine/Dockerfile.prod:175-176` copies it to `/usr/share/doc/brabo/`, before the `USER` and as root, so it ships inside every published engine image (PR #532). Locked by `scripts/ci/oferta-de-fonte-na-imagem.spec.ts`, exercised by mutation. Two things stay open, and neither is a defect: the **sidecar** (path 3) is still an unmade architecture choice, and whether the obligation is *met* is a legal judgement this repository cannot assert — it can only say the image carries the offer. Found on the way: the document **asserted the opposite of what the repository does** (*"no image is published today"*, superseded by ADR 0119), and its `TODO(humano)` to decide "before the first push" **expired unread** |
| **BRB-018** | Write and test the reconstruction of the Neo4j projection from the event log | P2 | **open** — and now with a named path and a named cost | No reprojection command exists: a full-tree search for `reprojet`/`reproject`/`graph:repro` across `apps/` and `scripts/` returns nothing, and `apps/api/src/application/graph-projection/` holds only the forward projector (`graph-projector.ts`). What changed is that the gap stopped being invisible: [ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md) decision 4 **refuses** to back up `neo4j_data` — restoring a possibly-stale projection beside a Postgres restored at another instant gives two derived states from different moments with nothing to reconcile — and names reprojection as the answer instead. FASE 29 session 5 built the backup and deliberately did **not** build the reprojection, so the consequence is now written where an operator meets it (`docs/runbook.md`, [Losing the graph](../runbook.md#perda-do-grafo)): a migrated install starts with an **empty graph**, graph-dependent reads degrade, and the RAG is unaffected because it lives in pgvector, inside the dump |
| **BRB-028** | Give the appsec moment (`threat_model`) a trigger | P2 | **defect no longer reproduces** | Was: `SecOpsAgentServer.run_design/2` had no production caller, and `docs/fluxo.yml` named `assess_implementability` as the natural trigger while declaring it out of scope. Merged into `dev` by PR #514 (**RN-539** — renumbered from 522, already taken two days earlier): `dev_lead_tools.ex:333-338` fires it from `assess_implementability`, exactly where the gap said it belonged, through `Dispatcher.run_appsec_design/2` (`dispatcher.ex:112`); `docs/fluxo.yml:188-196` now reads `status: active` with no gap declared. The trigger is **guarded by idempotence** and that is not zeal: the `:sem_plano` outcome asks the model to call `assess_implementability` again, and each re-call would otherwise spend another appsec LLM round and three more handoffs on the same story. One limit stays declared in the code: `artifact.threat_model` is emitted in the STORY session while the guard reads the DEV LEAD session — the same session in the common path, and a repeated LLM round, never wrong data, when they differ |
| **BRB-031** | Remove the manual `chmod +x` from browser-driven runner setup | P3 | **closed by the installer** | The File System Access API does not preserve the execute bit (`docs/adr/0118-configuracao-automatica-do-runner-pelo-navegador.md:134-140`). ADR 0147:146-147 expected `service install` to kill it; `fase-28-pasta-do-usuario.md:138-145` records it did not — because the installation did not come from a versioned artifact. It does now: `install.sh` places the binary with `install -m 0755`, which sets the execute bit in the same act that copies ([RN-531](../business-rules.md#rn-531)). The browser flow of ADR 0118 still exists and still needs the manual step; what closes here is the path through the installer |
| **BRB-032** | The broker never came up in the local compose | **P1** | **defect no longer reproduces** | The broker left `profiles:`; the only `profiles` in the dev compose are `local-llm` (`docker/docker-compose.yml:86,126`). The root cause — `corepack` as root at build with no registry at runtime — was fixed by preparing `COREPACK_HOME` at build and adding a healthcheck (RN-512) |
| **BRB-033** | `reset-total.sh` tore down the engine and the seed died with it | P2 | **defect no longer reproduces** | `718b859e2` — "o reset total sobrevive a si mesmo e para de mentir no fim", merged into `dev` via `c230e91af` (PR #507). The script now probes `/health` of the three services and any failure exits naming the step |

Findings with no row here are the ones this repository cannot verify on its own
— they live in the vault only.

## What "fixed", "no longer reproduces" and "not yet exercised" mean

They are deliberately different words. **Fixed** would be the maintainer's
judgement, recorded in the vault. **Defect no longer reproduces** is all this
repository can honestly assert: the behaviour the finding describes is not what
the code does today, measured at the date of the row. And
**implemented, not yet exercised** is the weakest of the three: the code exists
and the tests that can run do pass, but the path only executes somewhere this
repository cannot reach — a real release tag, in CI. Calling that "fixed" would
be claiming a proof nobody has. Closing the item — and
deciding whether the fix covers everything the finding asked for — stays where
the finding was raised.

`BRB-004` is the reason the distinction earns its keep. Read from its id, it
looked like the `ollama:latest` pin that closed in #419. Read from the vault, it
asked for **digests**, which no image had. An id is not a description — and the
misreading is what kept it open while a sibling rule for `uses:` had had a
mechanism since #419.

## Adding a row

A row is added here when this repository gains the ability to prove or disprove
a finding — never to invent one. The id, title and priority are copied from the
vault verbatim; the state and the evidence are measured here.
