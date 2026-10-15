---
traducao_de: acad6bd367a09a0b48f20de94df3482e772dc258
---

# 0187 — The runner's standalone binary stops promising Windows

## Status

**Accepted.** Decided by the maintainer on 2026-09-30 and confirmed on
2026-10-01 (AT-343). Follows the mould of
[ADR 0174](0174-runner-sem-binario-darwin-x64.md), which removed Intel Mac by
the same path, and references
[ADR 0112](0112-binario-standalone-do-runner-via-bun-build-compile.md) (the
binary via `bun build --compile`),
[ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md) (the npm
package, which becomes the Windows path) and
[ADR 0150](0150-instalador-de-uma-linha.md) (the `install.sh`, which already
refused Windows entirely). It edits none of them.

## Context

Since ADR 0174 the matrix promised four targets, and the Release only received
the two Linux ones. `win32-x64` had a build fix on `dev` never exercised, and
the `workflow_dispatch` rehearsal with an empty `tag` (the mode that attaches
nothing) exercised it. The layers fell one by one, and the last one is not the
runner's:

1. **Run `36775746724`** — the binary BUILDS, and exits with code 1 on usage
   without arguments: `ENOENT` in `realpathSync`. The runner only recognized
   the compiled binary's virtual path for Linux/macOS (`/$bunfs/root/`); the
   Windows one is `B:/~BUN/root/`. Fixed (AT-343,
   `apps/runner/src/binario-compilado.ts`).
2. **Run `36779817686`** — usage passes, and `--self-test-pty` fails with
   `Cannot find package 'node-pty'`: the loader received the form WITHOUT the
   colon (`B/~BUN/root/`) and fell into the plain `import('node-pty')`. Fixed.
   In this same run `darwin-arm64` and the two Linux ones PASSED with AT-342's
   own PTY reader ([RN-688](../business-rules.md#rn-688)).
3. **Run `36780804339`** — `node-pty` loads, and from `cmd.exe` only the
   ConPTY's initial sequences arrive (`ESC[?9001h ESC[?1004h`), not even the
   prompt. The self-test gained a PROBE that does not depend on input, to
   separate input from reading.
4. **Run `36781729045`** — the probe decides: `cmd.exe /c echo` in a second PTY
   delivers **1 chunk** (the same two sequences), the read stream gives
   `end,close`, and the child exits with `-1073741510` — **0xC000013A**
   (`STATUS_CONTROL_C_EXIT`). Under Bun, the `net.Socket` over the ConPTY's
   output named pipe ends after the first chunk; `node-pty` treats the end of
   the pipe as the end of the terminal, closes the pseudoconsole, and Windows
   kills the child. No input is involved — even a command that only writes dies.

It is the same family as [oven-sh/bun#25822](https://github.com/oven-sh/bun/issues/25822)
that removed Intel Mac: Bun's stream layer under `node-pty`. On Unix it had a
workaround (the master's fd is a regular fd, and AT-342 reads it with
`fs.read`, waiting on `EAGAIN`); on Windows the read side is a named pipe
opened by `node-pty` itself as a `net.Socket`, and there is no fd the runner can
read from outside without rewriting the Windows half of `node-pty`. Under
**Node**, the same `node-pty` is what VS Code uses on Windows.

## Decision

**The platform goes.** The standalone binary now promises THREE targets
(`linux-x64`, `linux-arm64`, `darwin-arm64`), and Windows gets the npm path —
`npm install -g @brabo/runner`, under Node. The same four places of ADR 0174
change together:

- `build-runner-binaries.yml` removes `win32-x64` from the matrix and from
  `ALVOS_ESPERADOS`. `checksums.txt` declares absence only of what is a
  failure.
- The `GET /runner-releases/binary` proxy accepts the three, and refuses
  `win32-x64` with its **own 400** — naming this ADR and the npm command,
  without calling GitHub —, in the SAME table as the `darwin-x64` refusal
  (`SEM_BINARIO_POR_DECISAO`, readable name and ADR per platform).
- `install.sh` already refused Windows entirely before any download (ADR 0150),
  and continues to: the refusal now also SAYS that the local agent there is the
  npm package, naming this ADR. The `case` of `instalar_o_runner` never had
  `win32-x64` and does not gain it.
- The browser keeps **detecting** `win32-x64` and does not request the
  download: it goes into `SEM_BINARIO_PUBLICADO`, which fails upfront and falls
  into the usual best-effort (`falhaDoBinario` → npm command,
  [RN-473](../business-rules.md#rn-473)).
- `scripts/ci/alvos-do-runner.spec.ts` ties the four places together and now
  fails `windows-latest` in the matrix.

The Windows fixes the rehearsal produced (the virtual path in the three forms,
the `node-pty` loader, `cmd.exe` in the self-test and the probe) STAY: they are
the starting point of the way back, and cost nothing to the other targets.

## Alternatives considered

- **Keep the target and publish the binary that fails the terminal.** Usage
  without arguments passes, but the Code tab's interactive terminal would die on
  the first output chunk, with the child killed by Ctrl+C. Publishing a binary
  known to be broken in the function that justifies it is worse than not
  publishing.
- **Read the ConPTY pipe outside `node-pty`, as AT-342 did on Unix.** It would
  require reimplementing the Windows half of `node-pty` (the pipe is opened and
  connected inside it), and a workaround of that size against an open runtime
  bug is debt without a deadline.
- **Switch the binary's runtime (Node SEA) only for Windows.** It would change
  ADR 0112's distribution mechanism for one target, with a second build and
  proof path. It is a bigger decision than this one, and fits in its own ADR if
  Bun does not fix it.

## Consequences

- The standalone binary promise is **three** targets, and all three are PROVEN
  in rehearsal (runs `36779817686` and `36805241339`, the latter already with
  the three-target matrix). The Release keeps receiving two until the next final
  tag exercises `darwin-arm64`.
- Windows users need Node installed to have the local agent, and the user
  service stays out (ADR 0147 point 5). The browser panel says so in text;
  `install.sh` too.
- **Way back:** when Bun fixes the named pipe stream in a release, re-enabling
  the target is a new ADR that returns `win32-x64`/`windows-latest` to the
  matrix and to the four places the spec ties together, the names with `.exe`
  in the proxy, and runs the `workflow_dispatch` rehearsal with an empty `tag` —
  the `--self-test-pty` probe says straight away whether reading came back.
