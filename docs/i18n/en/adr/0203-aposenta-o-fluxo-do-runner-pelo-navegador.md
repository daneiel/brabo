---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0203 — The runner flow through the browser is retired, and the path is the installer

## Status

**Accepted.** 2026-10-01 (AT-014, `BRB-031`, round 36; owner decision on 01/10:
*"retire ADR 0118's browser flow — generating the key, downloading the binary and
writing config through the browser; the path is `install.sh`"*). Revises,
without editing it,
[ADR 0118](0118-configuracao-automatica-do-runner-pelo-navegador.md) (automatic
runner configuration through the browser, RN-464..466) and closes `BRB-031`.
Preserves [ADR 0154](0154-chave-de-dispositivo-de-maquina.md) (the two key
kinds), [ADR 0155](0155-a-primeira-conta-nasce-no-terminal.md) (the machine key
is born in the terminal and the installer registers it, RN-547/551/552) and
[ADR 0150](0150-instalador-de-uma-linha.md) (the one-line installer and the
verification of its own origin).

## Context

ADR 0118 made the browser **generate the Ed25519 pair** (Web Crypto),
**register the public key** (`POST /projects/:projectId/runner-device-keys`),
**download the binary** (`GET /runner-releases/binary`) and **write three
files** into a folder through the File System Access API — or, outside Chromium,
trigger two downloads. It accepted a limitation in writing: *"the browser does
not preserve the execute bit; `chmod +x` on Linux/macOS stays manual"*. It was
the last manual step of any installation path, and it is `BRB-031`.

PHASE 29 created a second path without that step: `install.sh` downloads the
binary, checks it against the **signed** `checksums.txt` and installs it with
`install -m 0755` (RN-531). PHASE 30 completed pairing on the machine side:
`brabo-runner device-key create` generates the pair ON THE MACHINE (RN-551), the
installer registers the public key through the internal MACHINE route with the
service token (RN-552) and chains both things at the end of the installation
(RN-547). Since then the browser flow was the **second** path, collapsed in a
`<details>` of `RunnerOnboardingPanel` (RN-548), and retiring it was declared as
a maintainer decision, not a consequence of that delivery.

Measured on `dev` (`ec0fbea52d`) before changing — who uses what the flow uses:

- `apps/web/src/lib/runner-bootstrap.ts` (generate pair, export JWK, download
  binary, write folder, manual kit) had **one** production consumer,
  `RunnerOnboardingPanel`. Outside it, only its own test and
  `scripts/ci/alvos-do-runner.spec.ts`, which read the browser's platform list
  as the fourth place enumerating targets.
- `registerRunnerDeviceKey` (`apps/web/src/lib/api-client.ts`) was only called
  by `runner-bootstrap.ts`.
- `POST /projects/:projectId/runner-device-keys` was only called by
  `runner-bootstrap.ts` and by `e2e/testes/chave-de-dispositivo.spec.ts`, which
  existed to prove EXACTLY the key generated in a Chromium. No script, no runner,
  no workflow, no `install.sh` calls it — the installer uses
  `POST /internal/machine-device-keys`.
- `GET` and `DELETE` of the same route have OTHER consumers: the keys section of
  Settings (RN-561), the panel's recognition (RN-548) and revocation.
- `PatAuthGuard` accepts a PROJECT key by `kid`, and there are project keys
  registered on real installations through the browser flow.
- `GET /runner-releases/binary` (the download proxy) had only the browser as a
  production consumer.

## Decision

1. **`RunnerOnboardingPanel` sends to `install.sh`.** The panel's foreground
   becomes the installer command
   (`curl -fsSLO …/install.sh && bash install.sh`, the SAME sentence as the
   runbook and `install.sh` itself, RN-526), copyable, with what it does stated
   in text — downloads the binary, checks it against the signed manifest,
   installs it already executable and pairs the machine — and the
   `EsperaDoRunner` (RN-474) below. The command is a TS copy of the installer's
   sentence, and `scripts/dev/install-invocacao.spec.ts` fails a diverging copy.
2. **What STAYS in the panel:** recognition of an already paired key (RN-548 and
   that of the PROJECT key, AT-107), with the same caveats — and, once a key
   serving the project is recognized, the installer block LEAVES. The manual
   command with a PAT (`--token`) stays in the `<details>`, renamed for the case
   it solves: *"Another machine, or run manually"*.
3. **What GOES from web:** all of `runner-bootstrap.ts` and its test (key
   generation through Web Crypto, binary download through the browser, writing
   via File System Access and the two-download kit), `registerRunnerDeviceKey`
   and the `RunnerDeviceKeySummary` type, the i18n keys of the flow's buttons and
   states, and the platform selector.
4. **What GOES from the api:** `POST /projects/:projectId/runner-device-keys`,
   with `RegisterRunnerDeviceKeyUseCase` and the two DTOs only it used. It was
   left without a caller. The internal MACHINE route
   (`POST /internal/machine-device-keys`) STAYS, and the JWK shape rule
   (`exigirJwkPublicaEd25519`, in the domain) stays with it.
5. **An ALREADY registered project key remains valid, and is revocable.**
   Nothing in the database changes: a filled `runner_device_keys.project_id` is
   still a valid kind, `PatAuthGuard` still accepts the JWT signed by it, `GET`
   still lists and `DELETE` still revokes. **A runner configured through the
   browser before this ADR does not break**: the folder with
   `brabo-runner.config.json` and `brabo-runner-device-key.jwk.json` is still
   read by the CLI (RN-466 in full), and the PROJECT unit it may have installed
   stays up. What ceases to exist is creating a NEW project key.
6. **The e2e of the browser-generated key goes too.** What it proved — that the
   `kid` written by the BROWSER is accepted by the server — has no producer
   anymore. The chain `kid` → JWT → `PatAuthGuard` with a real key remains
   covered in `apps/api/test/interfaces/pat-auth.guard.spec.ts` and the pair
   generated on the machine in
   `apps/runner/src/criar-chave-de-dispositivo.spec.ts`.
7. **The runner's target list now lives in THREE places**, not four: the
   browser's went with the module, and `scripts/ci/alvos-do-runner.spec.ts`
   locks it from silently coming back.

The branch is `breaking/`: removing a public route documented in OpenAPI is a
contract change for whoever calls it, and the version policy
(`scripts/ci/version.ts`) says the FUNCTION decides — a patch would say "update
without thinking".

## Consequences

**Good.**

- The installation path no longer has a manual `chmod` step anywhere in the
  product: the only one that had it is gone. `BRB-031` closes.
- A NEW device key is born in one place only — the machine's terminal — and is
  registered by one registrar only — the installer. The api loses a write route
  authenticated by a session JWT.
- Web loses ~530 lines of crypto, download and disk-writing code that jsdom could
  not exercise without a double.

**Bad, declared.**

- **An installation with a team loses the PAT-less path.** The route that
  creates a MACHINE key only serves a ONE-person installation (409 with two or
  more, RN-552), and `install.sh` installs the whole of Brabo on a machine — it
  does not serve to pair a SECOND machine with an existing installation. For
  those people the path becomes the manual command with a PAT (`--token`), which
  the panel keeps offering and names as the other machine's. The browser flow was
  the only way to pair without a PAT in that case, and the owner's decision
  retires it anyway.
- **`GET /runner-releases/binary` is left without a production consumer.** The
  proxy was NOT removed here: the decision named the key registration route, and
  the proxy carries RN-525's integrity check and the open provenance half of
  `BRB-005`. Removing or keeping it is the owner's decision, separately.
- **Whoever had the flow's tab open** at deploy time gets a 404 on the `POST`
  when clicking — the old bundle still calls the route. Reloading the page fixes
  it.
- RNs 464..466 and 473/475 describe the flow as it was; they get a revision
  note, never deletion.
