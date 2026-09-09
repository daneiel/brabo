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
| **BRB-005** | Sign the GHCR images and the runner binaries | P2 | **open** | No `cosign`/`sigstore`/`slsa`/`attestation` anywhere in `.github/`, `scripts/`, `docker/`. `release.yml` lacks `id-token: write` (`:40-43`); `build-runner-binaries.yml` publishes no `checksums.txt` (`:227`); `GET /runner-releases/binary` is `@Public()` and verifies nothing (`runner-releases.controller.ts:73-74`). **Addressed by [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md)** |
| **BRB-017** | Meet the GPL obligation of the tools baked into the published engine image | **P1** | **open** | Nothing under `docker/engine/` mentions licences. The obligation became real when [ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md) started publishing to GHCR on every final tag |
| **BRB-028** | Give the appsec moment (`threat_model`) a trigger | P2 | **fixed in an unmerged branch** | `SecOpsAgentServer.run_design/2` had no production caller; `docs/fluxo.yml:202-207` named `assess_implementability` as the natural trigger and declared it out of scope. Implemented on `feature/gatilho-do-appsec` (RN-522) — **not yet in `dev`** |
| **BRB-031** | Remove the manual `chmod +x` from browser-driven runner setup | P3 | **open** | The File System Access API does not preserve the execute bit (`docs/adr/0118-configuracao-automatica-do-runner-pelo-navegador.md:134-140`). ADR 0147:146-147 expected `service install` to kill it; `fase-28-pasta-do-usuario.md:138-145` records it did not |
| **BRB-032** | The broker never came up in the local compose | **P1** | **defect no longer reproduces** | The broker left `profiles:`; the only `profiles` in the dev compose are `local-llm` (`docker/docker-compose.yml:86,126`). The root cause — `corepack` as root at build with no registry at runtime — was fixed by preparing `COREPACK_HOME` at build and adding a healthcheck (RN-512) |
| **BRB-033** | `reset-total.sh` tore down the engine and the seed died with it | P2 | **defect no longer reproduces** | `718b859e2` — "o reset total sobrevive a si mesmo e para de mentir no fim", merged into `dev` via `c230e91af` (PR #507). The script now probes `/health` of the three services and any failure exits naming the step |

Findings with no row here are the ones this repository cannot verify on its own
— they live in the vault only.

## What "fixed" and "no longer reproduces" mean

They are deliberately different words. **Fixed** would be the maintainer's
judgement, recorded in the vault. **Defect no longer reproduces** is all this
repository can honestly assert: the behaviour the finding describes is not what
the code does today, measured at the date of the row. Closing the item — and
deciding whether the fix covers everything the finding asked for — stays where
the finding was raised.

`BRB-004` is the reason the distinction earns its keep. Read from its id, it
looks like the `ollama:latest` pin that closed in #419. Read from the vault, it
asks for **digests**, which no image has. An id is not a description.

## Adding a row

A row is added here when this repository gains the ability to prove or disprove
a finding — never to invent one. The id, title and priority are copied from the
vault verbatim; the state and the evidence are measured here.
