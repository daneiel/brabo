# ADR 0118 — Browser-driven runner setup: an Ed25519 device key as a second `runner-ticket` credential, a GitHub Releases proxy for the binary, and the File System Access API for a one-click configured folder

- **Status:** Accepted
- **Date:** 2026-08-27
- **Context:** closes the friction of setting up `brabo-runner` on the user's machine — until now it required manually assembling three things scattered across different screens: the project id, the folder path, and a Personal Access Token minted on a third screen
- **References (without editing):** [ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md) (the runner itself and its security boundary), [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md) (`execution_mode: runner`, the PAT backlog item this ADR's device key complements), [ADR 0105](0105-personal-access-token-do-runner-escopado-por-construcao.md) (the PAT this decision is additive to, never a replacement), [ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md) and [ADR 0112](0112-binario-standalone-do-runner-via-bun-build-compile.md) (the standalone binaries this ADR's proxy serves), [ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md) (folder browsing THROUGH an already-connected runner — this ADR is about getting the runner connected in the first place)

## Context

`execution_mode: runner` (ADR 0104) lets a project's code live in a folder on
the user's own machine, with no bind-mount and no container — but reaching
that state meant a person had to, by hand: find the project's id, generate a
Personal Access Token on Project Settings → Access Tokens (ADR 0105), copy a
`brabo-runner --project <id> --dir <path> --token <token>` command someone
had typed correctly, download the right binary for their OS/architecture
themselves, and run it from the right folder. Three pieces of information,
three screens, and a secret the user had to type or paste into a terminal.

`NewProjectWizard.tsx` and `RunnerOnboardingPanel.tsx` had independently
grown their OWN command text for this over time, and they had drifted apart —
the wizard's copy never included `--token` at all, and the panel's copy used
`pnpm --filter runner start` syntax instead of the binary. Neither was wrong
when written; nothing forced the two surfaces to agree, so they silently
stopped agreeing.

The product owner also asked, explicitly, whether the runner could DISCOVER
a local Docker/Kubernetes container on its own and connect over SSH instead
of needing a human to walk through any setup at all. That path was
considered and rejected in this same session — see "Alternatives considered
and rejected" below.

## Decision

### 1. An Ed25519 device key, generated in the browser, is a second credential for `runner-ticket` — additive to the PAT, never a replacement

New table `runner_device_keys` (`apps/api/src/db/schema.ts:2058-2081`,
migration `0054_demonic_shiver_man.sql`): `id`, `userId` (FK `users`,
cascade), `projectId` (FK `projects`, cascade), `name`, `publicKeyJwk`,
`createdAt`, `revokedAt`, `revokedReason`, `lastUsedAt` — the PUBLIC half of
an Ed25519 key pair the browser generates with `crypto.subtle.generateKey`
(`apps/web/src/lib/runner-bootstrap.ts:123-131`). The private half never
leaves the browser over the network; only the exported public JWK is POSTed
to `RegisterRunnerDeviceKeyUseCase`
(`apps/api/src/application/use-cases/auth/register-runner-device-key.use-case.ts`)
via `POST /projects/:projectId/runner-device-keys`
(`apps/api/src/interfaces/http/runner/runner-device-keys.controller.ts`).
That route is authenticated by the NORMAL session JWT, `@RequireRole('developer')`
— the caller here really is the logged-in browser registering the device
it's about to configure, the mirror image of `PersonalAccessTokensController`
issuing a PAT. `RevokeRunnerDeviceKeyUseCase` deletes (marks revoked) the
same way `RevokePersonalAccessTokenUseCase` does — idempotent, `null` for
"not found or not yours," same non-disclosure discipline as RN-426.

`PatAuthGuard` — the same guard `POST .../runner-ticket` already used for the
PAT (ADR 0105, RN-439) — grew a second branch
(`apps/api/src/interfaces/http/auth/pat-auth.guard.ts:104-116`): a bearer
token starting with `brb_` takes the existing PAT path unchanged; a bearer
token shaped like a compact JWT (three dot-separated segments) takes a new
path, `autenticarChaveDeDispositivo` (lines 144-216). It reads the
unverified `kid` from the JWT header (`decodeProtectedHeader` — no signature
check yet), looks up an ACTIVE `runner_device_keys` row by that `kid`,
verifies the signature with `jose`'s `importJWK`/`jwtVerify` against the
STORED public key, and enforces a short, mandatory TTL: `exp - iat` must be
at most 60 seconds (`TTL_MAXIMO_DEVICE_KEY_SEGUNDOS`, line 23) — checked
against the token's OWN claimed lifetime, not "now," so a captured token
can't be replayed usefully no matter when it's replayed. The `userId` used
for authorization comes from the STORED registration, never from a JWT
claim — the token only needs to prove possession of the private key, not
assert whose it is. `projectId` is checked twice: the JWT's own claim
against the route parameter, and separately the registered key's `projectId`
against the route (mirroring the PAT path's identical two checks) — a
forged claim on a key registered to a different project is rejected with
403, matching the PAT path's category distinction between "not
authenticated" and "authenticated for the wrong project."

The runner signs this JWT itself, in `apps/runner/src/auth.ts`
(`assinarTicketComChaveDeDispositivo`, lines 143-154): EdDSA, 30-second
expiry, `kid` set to the device key's registration id, using a private JWK
that's already IN MEMORY by the time this function runs — it never touches
`node:fs` itself, preserving the existing "no file I/O in `auth.ts`"
guarantee (`auth.spec.ts`'s "nenhum I/O de arquivo" suite). Reading the key
off disk is a SEPARATE, new module, `apps/runner/src/device-key.ts`, on
purpose (see Decision 4).

**This is explicitly NOT the "dual-auth with a session JWT" that RN-439
already forbids on this route.** The guard's own docblock
(`pat-auth.guard.ts:41-53`) states the distinction: the session JWT from
login is still never accepted here — accepting it would let `RolesGuard`
authorize a logged-in browser for anything its role permits everywhere else
in the api, which is exactly the scope-escape RN-439/ADR 0105 built
`@RequirePatAuth()` to prevent. The device-key JWT is a different animal: a
token the runner signs ITSELF, with a key the api never saw the private
half of, asserting only "I am a registered device for this user, on this
project" — as scoped as the PAT it sits beside, never a session credential
in disguise.

### 2. The api proxies the already-published GitHub Releases binary — it does not build or store a second copy of anything

`RunnerReleasesController`
(`apps/api/src/interfaces/http/runner/runner-releases.controller.ts`) adds
`GET /runner-releases/binary?platform=<target>`, `@Public()` — unauthenticated,
by design: the binary itself carries no secret, and requiring login to
download the thing you'd use to set up your FIRST credential would be
backwards. `platform` is checked against a closed allowlist (`linux-x64`,
`linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64` — the same five
targets ADR 0112 already builds) before it touches anything — never
interpolated raw into the GitHub URL or the asset name, closing the
SSRF/injection vector a free-form parameter would open. The controller
resolves the `latest` release's asset list from the GitHub REST API, caches
that resolution (URLs only, never bytes) in an in-memory `Map` for five
minutes (`CACHE_TTL_MS`) to stay well under GitHub's 60-requests/hour
unauthenticated rate limit even under a burst of concurrent downloads, then
streams the actual asset bytes straight through
(`Readable.fromWeb(...).pipe(res)`). No new dependency — `fetch` is
Node's own. The alternative of the browser talking to GitHub directly was
rejected: the exact asset name is an implementation detail the api already
computes (`nomeDoAsset`), and a direct browser→GitHub call would forfeit the
caching this proxy gets for free.

### 3. File System Access API writes the configured folder directly; a two-file download is the fallback everywhere else

`apps/web/src/lib/runner-bootstrap.ts` is the new module both entry points
below call into. `detectarPlataforma` picks the right binary for the user's
OS/architecture — in Chromium, via
`navigator.userAgentData.getHighEntropyValues` (the classical `userAgent`
string is deliberately "reduced" and can't be trusted for architecture on
modern Chrome); outside Chromium, a best-effort regex over `userAgent`/
`platform`, with `null` (never a guess presented as fact) when confidence is
too low, at which point the UI lets the user pick manually.

`configurarPastaAutomaticamente` (lines 199-229) is the one-click path,
available only where `showDirectoryPicker` exists (Chrome/Edge/Opera): it
generates the Ed25519 pair, registers the public key
(`registerRunnerDeviceKey`), downloads the binary from Decision 2's route,
opens the browser's native folder picker, and writes THREE files directly
into the chosen folder — the executable, `brabo-runner.config.json`
(`{ projectId, apiUrl }`), and `brabo-runner-device-key.jwk.json` (the
PRIVATE JWK, written to disk only here, never sent over the network).
`baixarKitManual` (lines 250-268) is the fallback used everywhere the File
System Access API doesn't exist (Firefox, Safari) or a user opts out of
letting a site touch their filesystem: the same three artifacts, but as two
ordinary browser downloads (the binary, and a `brabo-runner-kit.json`
bundling the config and the private key) that the user moves into a folder
by hand — no zip library, just two files.

`RunnerOnboardingPanel.tsx` is now the SINGLE component rendering this flow,
consumed by all three surfaces that used to disagree: `NewProjectWizard`'s
`workspace` step (`runner` mode), `FolderBrowserModal`'s "no runner
connected" state, and `TerminalPanel`'s equivalent state. Fixing the real
divergence found during this investigation — the wizard's own untracked copy
of the manual command, missing `--token`, and the panel's copy using
`pnpm --filter runner start` instead of the binary — was folded into this
same change: there is now one manual-command string, always including
`--token`, collapsed by default behind a "prefer to run it manually"
`<details>` disclosure.

**Accepted limitation, not a bug:** the File System Access API does not
preserve the Unix execute bit. After the automatic write, a Linux/macOS user
still has to run `chmod +x ./brabo-runner` themselves — shown pre-filled,
ready to copy, in the success state (`instrucaoFinal`,
`runner-bootstrap.ts:224-226`). This is a browser-platform limitation with
no workaround available to a web page; it is not something a future version
of this feature is expected to remove.

### 4. `--project`/`--dir`/`--token` become optional in the CLI when a local config is present

`apps/runner/src/device-key.ts` is a new module, deliberately separate from
`auth.ts` (its own docblock explains why: `auth.ts` carries a dedicated test,
"nenhum I/O de arquivo," guarding against reintroducing the global
`~/.brabo/...` credential cache ADR 0104's Wave 2 removed on purpose — this
new module reads a LOCAL, EXPLICIT file the user just placed there by using
the browser flow, never a global path). `lerConfigLocal`/
`lerChaveDeDispositivo` read `brabo-runner.config.json` and
`brabo-runner-device-key.jwk.json` from the CURRENT working directory,
returning `null` — never throwing — for a missing file, invalid JSON, or a
missing required field, because the absence of these files is the NORMAL
case for anyone still using explicit flags.

`lerArgumentos` in `apps/runner/src/index.ts` (lines 95-206) now resolves
each of the three inputs with "explicit flag wins over local file" as the
one rule repeated three times: `--project` beats `configLocal.projectId`;
`--dir` beats `.` (which resolves to the current working directory, same as
today's forced default) when the local config exists; `--token`/
`BRABO_ACCOUNT_TOKEN` beats the local device key. With NEITHER a token nor a
local device key available, the CLI still exits with usage instructions
(`uso()`) exactly as before — nothing here makes authentication optional,
only which of the two forms is used. The net effect: `./brabo-runner` with
no flags at all works when the current folder is one the browser configured
via Decision 3, and every existing invocation with explicit flags is
completely unchanged.

## Consequences

**Device keys do NOT yet have the maintainer cross-user view that PATs
have.** `RunnerDeviceKeysController`'s own docblock declares this: unlike
`PersonalAccessTokensController` (RN-427 — a `maintainer` can list/revoke
ANY user's PAT on the project, for incident response), a device key today
can only be listed/revoked by the user who registered it. This is a
declared cut for this round, not an oversight — extending the same
incident-response capability to device keys is straightforward future work
if it's asked for, following the exact pattern RN-427 already established
for PATs.

**A device key JWT never carries the user's identity — only the api's
stored registration does.** This is intentional (Decision 1), but it means
a device key can never be used to impersonate a specific claimed user; it
can only ever act as whichever user the ORIGINAL registration belongs to.
Revoking the registration is the only way to invalidate it — there is no
separate "this specific JWT is bad" denylist, nor does one need to exist,
given the 30-second signing TTL plus the 60-second maximum `exp - iat`
enforced independently by the guard.

**The binary proxy trusts GitHub Releases as the sole distribution
channel.** If the "latest" release lacks an asset for a requested platform
(a partial release, mid-publish), the route returns 502 rather than
guessing at an older tag — consistent with ADR 0112's own declared gap that
only `linux-x64` has been validated by real execution so far.

**The GitHub asset-resolution cache is per-instance, in-memory, with no
invalidation hook.** A fresh release published mid-window is invisible to a
running api instance for up to five minutes. Given how infrequently the
runner ships new binaries (tied to the same release cadence as everything
else), this was judged an acceptable trade for staying comfortably under
GitHub's unauthenticated rate limit — a proper webhook-driven invalidation
is not built here.

## Alternatives considered and rejected

- **The runner auto-discovers a local Docker/Kubernetes container and
  connects to it over SSH, with no folder-selection step at all.**
  Considered and explicitly REJECTED by the product owner in this same
  session — not a technical dead end, a deliberate scope cut. `execution_mode:
  runner` exists precisely because Phase 25b (no product service calls
  Docker — see CLAUDE.md's "Cortes e pausas vigentes") stays cut: teaching
  the runner to probe for and connect to local containers would reopen
  exactly that boundary through a side door, and an SSH-based connection
  path is a materially different security model from the
  authentication-plus-approval-pipeline boundary ADR 0103 already
  established. Left as a candidate for its own future ADR, if and when
  Phase 25b itself is revisited — not something this feature quietly backs
  into.
- **Reuse the session JWT as a second `runner-ticket` credential instead of
  minting a new device-key mechanism.** Rejected on RN-439's own terms: that
  route's guard exists specifically so a browser session's JWT is NEVER
  sufficient there, because `RolesGuard`/`@RequireRole` would then authorize
  that session for the full breadth of the user's role everywhere else in
  the api — the opposite of the narrow, revocable, device-scoped credential
  this feature needs.
- **Zip the manual-download fallback into a single archive.** Rejected: no
  new dependency justified the convenience — two plain files (the binary,
  and a small JSON kit) cost nothing extra to produce and nothing extra for
  a user to unpack.
- **Have the api build and host its own copy of the runner binary** instead
  of proxying GitHub Releases. Rejected: ADR 0106/0112 already publish
  exactly these five binaries through the release pipeline; maintaining a
  second build-and-store path for the same artifact would be pure
  duplication with no benefit — a thin proxy with a short cache is enough.
