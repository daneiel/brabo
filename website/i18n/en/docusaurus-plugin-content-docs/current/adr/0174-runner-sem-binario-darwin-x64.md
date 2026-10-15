---
traducao_de: 153a82109c8bd8c3a907dc2603c40953ecb4b4c1
---

# ADR 0174 — The runner's standalone binary stops promising Intel Mac

## Status

**Accepted.** Decided by the maintainer on 2026-09-27 (AT-065, HS-035).
References [ADR 0112](0112-binario-standalone-do-runner-via-bun-build-compile.md)
(the standalone binary via `bun build --compile`, born with five targets),
[ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md) (the npm
package, which becomes the Intel Mac path) and
[ADR 0149](0149-assinatura-dos-artefatos-publicados.md) (the signed
`checksums.txt` that covers the binaries). It edits none of the three.

## Context

ADR 0112 promised five targets — `linux-x64`, `linux-arm64`, `darwin-x64`,
`darwin-arm64`, `win32-x64` —, each built on its native runner. `darwin-x64`
**never published**, and the cause is measured in two layers:

1. **There is no usable Intel runner.** The `macos-13` label points to an image
   GitHub retired (changelog of 2025-09-19, end in Dec/2025). On the three tags
   that exist (`v4.0.0`, `v4.0.1`, `v5.0.0`) the job sat **24h00m01s** in the
   queue and was cancelled by the Actions ceiling — the SAME number on all
   three, i.e. it was never scheduled. In a `workflow_dispatch` rehearsal
   (2026-09-13, run `34769280227`) it sat 30 min in the queue, again with no
   runner.
2. **The replacement schedules, builds and fails.** The Intel label GitHub
   offers instead, `macos-15-intel`, schedules in 3–22 s (five runs) and BUILDS
   the binary, but fails `--self-test-pty`: under Bun, `node-pty`'s `onData`
   never delivers the child process output — an open runtime bug,
   [oven-sh/bun#25822](https://github.com/oven-sh/bun/issues/25822), with no
   fixed release. The SAME proof passes under **Node** on the same runner (run
   `34770476634`).

The second measurement changed the nature of the pending item: the blocker
stopped being the runner (paying for an Intel runner would not solve it) and
became Bun. Two ways out remained — wait for Bun to fix it and then switch the
label, or drop the platform —, and `CLAUDE.md` recorded it as an owner's
decision.

Meanwhile, the five-target promise cost in four places: the matrix queued a
job that never ran; `ALVOS_ESPERADOS` made every `checksums.txt` announce,
forever, the absence of a target already known not to come
([RN-565](../business-rules.md#rn-565)); the `GET /runner-releases/binary`
proxy accepted `darwin-x64` only to answer 502 `plataforma_nao_publicada`; and
`install.sh` asked GitHub for an asset that returns 404 — with the same
"the Release does not publish" output, indistinguishable from an incomplete
Release.

## Decision

**The platform goes.** The standalone binary now promises FOUR targets, and
Intel Mac gets the npm path — `npm install -g @brabo/runner`, which runs under
Node, where the `node-pty` proof passes.

- `build-runner-binaries.yml` removes `darwin-x64` from the matrix and from
  `ALVOS_ESPERADOS`. `checksums.txt` now declares absence only of what is a
  real failure.
- The `GET /runner-releases/binary` proxy accepts the four, and refuses
  `darwin-x64` with its **own 400** — not with the generic "invalid platform" —
  naming this ADR and the npm command, without calling GitHub.
- `install.sh`, on `darwin-amd64`, **does not try to download**: it says in
  text that Intel Mac has no binary, that the rest of the installation is up
  and what the npm command is, and leaves `RUNNER_BIN` empty — the same signal
  by which the wrap-up ([RN-547](../business-rules.md#rn-547)) already reported
  the pending key and service. The installation itself remains supported on
  Intel Mac (the `cosign` pinned for `darwin-amd64` stays), only the local
  agent binary goes.
- The browser keeps **detecting** `darwin-x64` — detecting Intel Mac is true,
  and it is what allows stating the right path —, but the binary step does not
  request the download: it fails upfront, and falls into the same best-effort
  (`falhaDoBinario` → npm command) of [RN-473](../business-rules.md#rn-473).
- `scripts/ci/alvos-do-runner.spec.ts` ties together the four places that
  enumerate targets, in three languages: the matrix, the api list, the
  installer's `case` and the browser's. Removing (or restoring) a target in one
  and forgetting another fails.

## Alternatives considered

- **Wait for Bun and switch the label to `macos-15-intel`.** Keeps the promise
  with no deadline, and switching the label alone does not make the target
  publish — it only trades 24 h of queue for a red job on every tag. It remains
  the way back (below), not today's decision.
- **Build `darwin-x64` by cross-compiling from `darwin-arm64`.** ADR 0112
  refused cross-compiling a native addon, and `self-test-pty` would not run on
  the target architecture — it would publish a binary nobody proved.
- **Pay for an Intel runner.** The measurement showed the blocker is the
  runtime, not the machine: the same hosted `macos-15-intel` builds and fails.

## Consequences

- The standalone binary promise is four targets, and the Release keeps
  receiving **two** (`linux-x64`, `linux-arm64`) until a tag exercises the
  `win32-x64` and `darwin-arm64` fixes already on `dev`. This decision does not
  touch that.
- Intel Mac users need Node installed to have the local agent. `install.sh` and
  the browser panel say so in text; neither installs Node on its own.
- **Not measured, and declared:** the Bun issue was opened on darwin ARM64. It
  is likely that `darwin-arm64` will hit the same defect after the
  `spawn-helper` fix. If it happens, this ADR is the precedent, not the
  automatic answer — deciding `darwin-arm64` is another decision.
- **Way back:** when Bun fixes `node-pty`'s `onData` in a release, re-enabling
  the target is a new ADR that switches the label to `macos-15-intel`, runs the
  `workflow_dispatch` rehearsal with an empty `tag`, and returns `darwin-x64`
  to the four places the spec ties together.
