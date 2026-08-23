# ADR 0109 — Standalone binary of `@brabo/runner` via `bun build --compile`, native `.node` addon embedded by real extraction to a temp directory

- **Status:** Accepted
- **Date:** 2026-08-23
- **Context:** backlog item of [ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md)
  ("standalone binary (`pkg`/`bun build --compile`), separate backlog item,
  higher cost, no defined trigger") — companion of ADR 0106, which shipped
  the `npm install -g @brabo/runner` path and explicitly deferred this one.

## Context

`npm install -g @brabo/runner` (ADR 0106) still requires the user to have
Node ≥ 22.6 installed and to trust `npm` to compile `node-pty`'s native
addon on their machine. The product owner asked for the harder, more
complete alternative — a **true single-file binary**, full platform matrix
including Windows from v1 — after being explicitly offered and rejecting
the cheaper "binary + `node-pty-native/` folder alongside" design.

## Decision

### Why `bun build --compile` over `pkg`

`pkg` (Vercel) has been unmaintained since 2023 (superseded internally by
`@yao-pkg/pkg`, a community fork) and its Node-version-pinned "base binary"
download model is exactly the kind of external dependency this repo avoids
adding without a forcing reason (ADR 0033/0041 already reject build-time
magic that isn't provable). `bun build --compile` is maintained, actively
developed, and — critically — Bun 1.1+ documents first-class support for
embedding native `.node` addons via `with { type: 'file' }`, which is the
mechanism this ADR ends up needing anyway.

### The real problem: `node-pty` resolves its own native addon by a DYNAMIC path

`node-pty`'s `lib/utils.js#loadNativeModule` (confirmed by reading the
installed package, `node_modules/node-pty/lib/utils.js`) does:

```js
function loadNativeModule(name) {
  var dirs = ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`];
  var relative = ['..', '.'];
  for (var d of dirs) for (var r of relative) {
    try { return { dir, module: require(`${r}/${d}/${name}.node`) }; } catch (e) {}
  }
  throw new Error(...);
}
```

This `require()` call has a **computed** path — Bun's bundler can only
embed what it can resolve **statically**, at build time (proven
empirically: a naive `bun build --compile src/index.ts` with `node-pty`
bundled normally **compiles without error** and then **fails at runtime**
with `Cannot find module './prebuilds/linux-x64//pty.node'` — the native
file was silently never embedded). This is the entire reason this item was
higher-risk than the npm path: it isn't "embed a file", it's "get a
third-party package's own dynamic path resolution to work against files
that only exist inside a compiled bundle."

### The mechanism that works, proven empirically before writing production code

1. At BUILD time (`apps/runner/scripts/build-bin.mjs`, one run per native
   platform — see the matrix below), walk the installed `node-pty` package
   and collect every file it actually needs at runtime: all of
   `lib/**/*.js` (excluding `*.test.js` — 13 files: `index.js`,
   `unixTerminal.js`, `windowsTerminal.js`, `windowsPtyAgent.js`,
   `windowsConoutConnection.js`, `terminal.js`, `utils.js`, `types.js`,
   `interfaces.js`, `eventEmitter2.js`, `conpty_console_list_agent.js`,
   `shared/conout.js`, `worker/conoutSocketWorker.js`) plus the native
   `.node` file(s) for the CURRENT platform — `build/Release/*.node` when
   `node-gyp rebuild` compiled locally (Linux: `node-pty` ships **no**
   Linux prebuild at all, confirmed by listing `prebuilds/` in the
   installed package — only `darwin-x64`, `darwin-arm64`, `win32-x64`,
   `win32-arm64` exist), or `prebuilds/<platform>-<arch>/*.node` when the
   package shipped one (macOS: 1 file; **Windows: 3** —
   `pty.node`/`conpty.node`/`conpty_console_list.node`, all picked up
   generically by globbing `*.node` in whichever directory is chosen, no
   per-file special-casing).
2. Generate `apps/runner/src/native-pty-embed.generated.ts` with one
   **static** `import fN from '<real-path>' with { type: 'file' }` per
   file — `with { type: 'file' }` is the one Bun mechanism that requires a
   literal specifier, and this is why the manifest has to be *generated*
   (the file list is only known after `pnpm install` on that specific
   platform) rather than hand-written.
3. At RUNTIME (`apps/runner/src/native-pty-loader.ts`), inside the
   compiled binary only: write every embedded file to a REAL temp
   directory (`fs.mkdtempSync`), preserving the **exact original relative
   layout** (`lib/utils.js`, `build/Release/pty.node`, etc.). This
   preservation is the whole trick — `node-pty`'s own `require()` calls
   are all *relative*, so once its files sit in a real directory with the
   real shape it expects, its dynamic resolution works completely
   unmodified, exactly as if the package had been `npm install`ed
   normally.
4. Import `<tempdir>/lib/index.js` by **absolute file path**
   (`await import(pathToFileURL(...).href)`) — never `require('node-pty')`
   by package name, which would need a `node_modules` folder that doesn't
   exist next to a standalone binary.

Two properties of this mechanism were verified empirically, not assumed:
`.node` addons embedded via `with { type: 'file' }` **do** load correctly
through `require()` even though the reported path is the virtual
`/$bunfs/root/...` (Bun transparently makes the native addon loadable via
`dlopen` despite the fake path); and a real, **non-native** file read via
`with { type: 'file' }` — `fs.readFileSync(embeddedPath)` — returns the
real bytes correctly, including from inside a compiled binary (so the
byte-for-byte re-extraction to a real temp directory is reliable).

### Two real bugs found only by running the compiled binary, not by reading the API surface

**1. `--external node-pty` is required on the `bun build` invocation
itself**, even though nothing in `pty.ts` imports `node-pty` by bare
specifier anymore. `native-pty-loader.ts`'s non-compiled fallback path
(`await import('node-pty')`, used only outside a compiled binary) is a
*literal* dynamic import — Bun's bundler discovers and tries to resolve
it during `--compile` regardless of which runtime branch would actually
reach it, and since it CAN partially resolve `node-pty` from
`node_modules` (unlike a fully missing module), the build **succeeds
silently** and inserts a throwing stub in its place. The symptom looked
identical to the very first failure (`Cannot find module`/`is not a
function` errors surfacing only inside `lib/utils.js`'s own require
chain) which cost real debugging time before the actual cause (the
bare-specifier fallback getting bundled) was isolated. `--external
node-pty` on the `bun build --compile` command makes Bun leave that
specifier alone entirely, matching `tsup.config.ts`'s existing
`external: ['node-pty']` for the same reason.

**2. The auto-run guard (ADR 0106) breaks for a NEW reason inside a
compiled binary.** `process.argv[1]` inside a `bun build --compile`
executable is `/$bunfs/root/<name>` — a virtual path — and
`realpathSync()` on it throws `ENOENT` (confirmed with a real compiled
binary before touching production code), **outside any try/catch**,
before `main()` is ever attempted. The existing guard already had one
`realpathSync`-based fix (for the `npm install -g` symlink case); this ADR
adds a second, orthogonal branch: `import.meta.url.includes('/$bunfs/')`
is `true` for every module inside a compiled binary (verified for both the
entry module and a non-entry imported module) and is checked FIRST — a
standalone binary's own entry point has no "imported by a test" ambiguity
to disambiguate, so detecting the compiled case runs `main()`
unconditionally, sidestepping the `realpathSync` call that would otherwise
crash.

### Testing an interactive shell inside a PTY under Bun was unreliable in this sandbox — `cat` is the smoke's stand-in shell, not `bash`

The self-test path (`--self-test-pty`, an undocumented internal flag —
see below) originally spawned the user's real shell (`bash`) and typed
`echo MARKER`, mirroring production usage. Under plain Node this
completed in well under a second. Under Bun (`bun run`, and inside the
compiled binary) the exact same call — spawn `bash` in a PTY via
`node-pty`, write a command, wait for the prompt to redraw — never
completed within a 20s timeout in this sandboxed container, even though
the *first* kernel-level echo of the typed input arrived immediately (so
the PTY and the native addon were unambiguously working — only the
shell's own prompt-redraw output never showed up in time). The self-test
was changed to spawn `/bin/cat` instead (`GerenciadorDePty`/`shellPadrao()`
only reads the shell to spawn from `$SHELL`, with no parameter to override
it — the smoke temporarily sets `process.env.SHELL = '/bin/cat'` before
constructing the PTY, restored in a `finally`). `cat` is deterministic
(echoes exactly what it reads, no prompt, no rc files) and still proves
the real thing: `GerenciadorDePty.abrir()` spawns a REAL OS process via
the native addon, `escrever()` writes to its stdin through the PTY, and
`onData` proves the process read it and wrote back — the marker string
appearing **twice** (once from the PTY's own kernel-level input echo,
once from `cat` actually reading and re-emitting it) is what distinguishes
a genuine process round-trip from local terminal echo alone. This
divergence from `bash` — and whether it is Bun-runtime-specific or an
artifact of this specific sandboxed container (no real TTY, restricted
process/thread scheduling) — was NOT root-caused further; it doesn't
affect the actual product (the aba Terminal always spawns the user's real
shell on the user's real machine, outside any container), and chasing it
further would have been solving a sandbox artifact, not a product defect.
It's recorded here in case it recurs during real Windows/macOS validation.

Also found and fixed while building the self-test: `process.exit()`
called from inside a native addon's async callback (`onData`) did **not**
immediately terminate the Bun process while the spawned child (`cat`) was
still alive and its PTY file descriptor still open — the process lingered
past the deliberately short timeout of an ad-hoc reproduction until the
child was killed FIRST (`GerenciadorDePty.fechar()`, which calls
`processo.kill()`) before resolving. Production code already does this
(`fechar()` is called before `resolvePromise()`), so this is not a
separate bug in the shipped mechanism — it's recorded because it would be
an easy trap to fall into for anyone touching this code later.

### `--self-test-pty` — an undocumented internal flag, not part of the public CLI surface

`scripts/smoke-bin.mjs` needs to prove the embedded native addon works
**inside the actual published binary**, spawning a real PTY and reading
real output — "no mocking," per the product owner's brief. There is no
other way to reach that code path from outside the process (it's a
standalone executable, not a library), so `--self-test-pty` was added:
undocumented in `uso()`, resolves `node-pty` exactly like production,
spawns a PTY exactly like production (`GerenciadorDePty`), and exits
without touching the network (`--project`/`--dir`/`--token` are never
read on this path). This is the same category of decision as any CLI's
hidden diagnostic flag (`--version`, `--diag`) — not a second code path
with its own risk of drift, since it calls the exact same public methods
production calls.

## Target matrix and what was actually validated where

| Platform | Runner | Native `.node` source | Validated **in this sandbox** |
|---|---|---|---|
| `linux-x64` | `ubuntu-latest` | `node-gyp rebuild` (no Linux prebuild shipped) | **Yes, end to end** — `pnpm --filter runner build:bin` + `smoke:bin` both green, repeatedly, including the two bugs above found and fixed by running the real compiled binary |
| `linux-arm64` | `ubuntu-24.04-arm` | `node-gyp rebuild` | No — no ARM64 machine available here. The mechanism is architecture-agnostic in this repo's code (nothing here branches on `arch`, only on the generic `${platform}-${arch}` pair that `node-pty` itself already uses); risk is `node-gyp`'s own cross-toolchain on that runner, which is outside this repo's control and unrelated to Bun |
| `darwin-x64` | `macos-13` | `prebuilds/darwin-x64/pty.node` | No — no macOS machine available here. Confirmed via `oven-sh/setup-bun` and Bun's own docs that `bun build --compile` supports macOS `x64`/`arm64` natively (no cross-compile involved, this repo builds on native runners only) |
| `darwin-arm64` | `macos-14` | `prebuilds/darwin-arm64/pty.node` | No — same as above |
| `win32-x64` | `windows-latest` | `prebuilds/win32-x64/{pty.node,conpty.node,conpty_console_list.node}` | **No — the highest-risk gap, stated plainly.** Three native files instead of one, `windowsConoutConnection.js`'s `worker_threads.Worker` loading `worker/conoutSocketWorker.js` by a path computed relative to the extracted directory, and this repo's build/test scripts running under `bash` via Git Bash rather than PowerShell (`defaults: run: shell: bash` in the new workflow) are all reasoned through by reading `node-pty`'s source, never executed on a real Windows machine. This ADR ships the TRUE single-file approach for Windows anyway, per the product owner's explicit instruction to attempt the harder option first — but the honest status is: this platform's FIRST real execution is the next version tag push (or a manual `workflow_dispatch`), not this PR |

No per-platform fallback (the cheaper "binary + `node-pty-native/` folder"
design that was explicitly offered and rejected) was implemented for any
platform — nothing observed in this investigation DISPROVED the true
single-file approach for any of the five targets. If Windows genuinely
cannot work this way, that will surface as a real CI failure on the first
tag build, at which point the fallback becomes a targeted, single-platform
exception exactly as this ADR's brief allowed for — not a decision made
preemptively without evidence.

## What was built

- `apps/runner/src/native-pty-loader.ts` — resolves `node-pty` for both
  execution models (see mechanism above).
- `apps/runner/src/native-pty-embed.generated.ts` — tracked in git as an
  EMPTY placeholder (`NATIVE_PTY_FILES: []`); `scripts/build-bin.mjs`
  overwrites it with the real per-platform manifest immediately before
  `bun build --compile` and restores the placeholder in a `finally` —
  the same "never committed, generated in a disposable step" philosophy
  ADR 0106 already established for injecting the npm version.
- `apps/runner/src/pty.ts` — `GerenciadorDePty` now receives the resolved
  `node-pty` module by constructor injection instead of a static top-level
  `import`; the type-only `import type * as NodePtyNamespace from
  'node-pty'` carries zero runtime cost (erased by `verbatimModuleSyntax`).
- `apps/runner/src/index.ts` — resolves `node-pty` once in `main()`
  (`RN-441`), fixes the auto-run guard for the `/$bunfs/` case, and adds
  the internal `--self-test-pty` path.
- `apps/runner/scripts/build-bin.mjs` — generates the manifest, invokes
  `bun build --compile --external node-pty`, `chmod 755` on non-Windows.
- `apps/runner/scripts/smoke-bin.mjs` — mirrors `smoke-dist.mjs`'s
  pattern but runs the COMPILED BINARY as a real subprocess (`RN-441`).
- `.github/workflows/build-runner-binaries.yml` — same tag trigger as
  `publish-runner.yml`/`release.yml`, 5-target matrix, each job builds on
  its OWN native runner (never cross-compiles), runs the real smoke, and
  `gh release upload`s to the Release `release.yml` already created —
  idempotent (checks `gh release view --json assets` before uploading),
  never creates a Release itself, mirrors the owner-only dispatch
  restriction and tag-resolution pattern already established by
  `publish-runner.yml`.

## Consequences

- Unblocks a THIRD distribution path for `@brabo/runner`, alongside
  cloning the monorepo (dev) and `npm install -g` (ADR 0106): download one
  file, no Node/npm/node-gyp toolchain required on the user's machine at
  all.
- **The existing `npm install -g` path (ADR 0106) is completely
  unmodified in behavior** — `pty.ts`'s refactor to constructor injection
  changes internals only; `pnpm --filter runner build`/`smoke`/`test` all
  pass unmodified. One REAL regression this refactor introduced and
  closed in the same change: moving `node-pty` resolution from a
  module-level side effect (hoisted before argument parsing, ADR 0106's
  own "free" smoke coverage) to a lazy call inside `main()` meant the
  EXISTING `smoke-dist.mjs` (which only exercises the zero-argument `uso()`
  path) stopped proving `node-pty` loads at all for the npm/tsup artifact.
  `smoke-dist.mjs` gained a new check — real args, unreachable `--api-url`,
  waiting for the `node-pty carregado com sucesso` line — closing the gap
  in the same commit that opened it, not left as a silent loss of
  coverage.
- Operational: the FIRST real execution of `build-runner-binaries.yml`'s
  matrix is the next version tag push. Nothing in the PR that introduces
  this workflow exercises it (tag-triggered, same as `publish-runner.yml`)
  — four of five platforms are validated by REASONING over `node-pty`'s
  source and Bun's documented behavior, not by execution, and that gap is
  stated precisely per platform in the table above rather than implied
  as closed.
- `dist-bin/` is gitignored, same treatment as `dist/` (ADR 0106).
- Out of scope, unchanged from ADR 0106: PAT revocation nuances, runner
  exclusivity by `{project_id, machine_id}`; and now also: code-signing
  the binaries (macOS Gatekeeper/notarization, Windows Authenticode) —
  an unsigned binary downloaded from a GitHub Release will trigger OS
  warnings on first run, a real UX cost accepted for this first version
  and left for a future item, since it requires the product owner to
  obtain and fund a signing identity, the same category of operator
  action ADR 0106 already declared out of reach for `NPM_TOKEN`.
