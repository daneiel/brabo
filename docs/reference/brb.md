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
| **BRB-004** | Pin third-party images (`neo4j`, `pgvector`, `ollama`) **by digest** | P2 | **open** — and commonly misread | Every third-party image is pinned by **tag**, not digest: `ollama/ollama:0.33.1` in six places, `pgvector/pgvector:pg16` (`docker/docker-compose.prod.yml:34`), `neo4j:5.26-community` (`:61`), `alpine:3.20` (`docker/backup/Dockerfile.prod:33`). Tag pinning closed a *different* gap (PRs #401/#419); the finding asks for digests, by the same argument that bans tags in `uses:` |
| **BRB-005** | Sign the GHCR images and the runner binaries | P2 | **implemented, not yet exercised** | Was: no `cosign`/`sigstore`/`attestation` anywhere, `release.yml` without `id-token: write`, no `checksums.txt`. Now: `release.yml` signs the four images **by digest** and verifies them in the same run; `build-runner-binaries.yml` gained a `checksums` job publishing **one** signed manifest for the five targets ([ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md), [RN-524](../business-rules.md#rn-524)); verification procedure in [the runbook](../runbook.md#verificar-artefato-publicado). **Not exercised**: signing only runs on a real final tag, so nothing here proves it end to end yet. Still uncovered, and a separate item: OS code-signing of the binaries (notarization/Authenticode). Session 3 made the download proxy `GET /runner-releases/binary` verify — but **only the sha256 against the release's `checksums.txt`**, never the manifest's signature ([RN-525](../business-rules.md#rn-525)): that is integrity, not provenance, and whoever can rewrite the Release rewrites both files. Both ways for the api to check the signature were **measured and refused**: `cosign` in the image is 155 MB (nearly doubling an Alpine+Node runtime image), and `@sigstore/verify`+`@sigstore/tuf` is cheap (2.5 MB) but makes a `@Public()` route depend on a *second* third-party host (`tuf-repo-cdn.sigstore.dev`) to verify something no Release carries yet — unprovable, and ADRs 0041/0042 forbid declaring an unproven capability. The signature consumer is `install.sh` (session 4/7), which has a real pinned `cosign`. **So the provenance half of the proxy stays open**, and refusal is already named there: a Release without `checksums.txt` is refused, not served with a warning |
| **BRB-017** | Meet the GPL obligation of the tools baked into the published engine image | **P1** | **open** | Nothing under `docker/engine/` mentions licences. The obligation became real when [ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md) started publishing to GHCR on every final tag |
| **BRB-018** | Write and test the reconstruction of the Neo4j projection from the event log | P2 | **open** — and now with a named path and a named cost | No reprojection command exists: a full-tree search for `reprojet`/`reproject`/`graph:repro` across `apps/` and `scripts/` returns nothing, and `apps/api/src/application/graph-projection/` holds only the forward projector (`graph-projector.ts`). What changed is that the gap stopped being invisible: [ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md) decision 4 **refuses** to back up `neo4j_data` — restoring a possibly-stale projection beside a Postgres restored at another instant gives two derived states from different moments with nothing to reconcile — and names reprojection as the answer instead. FASE 29 session 5 built the backup and deliberately did **not** build the reprojection, so the consequence is now written where an operator meets it (`docs/runbook.md`, [Losing the graph](../runbook.md#perda-do-grafo)): a migrated install starts with an **empty graph**, graph-dependent reads degrade, and the RAG is unaffected because it lives in pgvector, inside the dump |
| **BRB-028** | Give the appsec moment (`threat_model`) a trigger | P2 | **fixed in an unmerged branch** | `SecOpsAgentServer.run_design/2` had no production caller; `docs/fluxo.yml:202-207` named `assess_implementability` as the natural trigger and declared it out of scope. Implemented on `feature/gatilho-do-appsec` (RN-522) — **not yet in `dev`** |
| **BRB-031** | Remove the manual `chmod +x` from browser-driven runner setup | P3 | **open** | The File System Access API does not preserve the execute bit (`docs/adr/0118-configuracao-automatica-do-runner-pelo-navegador.md:134-140`). ADR 0147:146-147 expected `service install` to kill it; `fase-28-pasta-do-usuario.md:138-145` records it did not |
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
looks like the `ollama:latest` pin that closed in #419. Read from the vault, it
asks for **digests**, which no image has. An id is not a description.

## Adding a row

A row is added here when this repository gains the ability to prove or disprove
a finding — never to invent one. The id, title and priority are copied from the
vault verbatim; the state and the evidence are measured here.
