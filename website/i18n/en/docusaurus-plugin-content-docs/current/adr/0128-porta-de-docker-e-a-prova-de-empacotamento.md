---
traducao_de: 1ecc3883c1af3f1d2b34548c4e0fc82480119d61
---

# ADR 0128 — The Docker port, and the packaging proof that chose the implementation

## Context

The real-container execution plan has two places that need to talk to a Docker
daemon: the **runner** (the Docker of the user's machine, for a project in
`runner` mode) and a server **broker** yet to be born (PR 1.2, for a project in
`container` mode). The api never receives the socket, and that is a closed
decision.

The choice of library was conditioned on a proof, not on a preference.
`dockerode` is the de facto Node client for Docker, but the runner is
distributed through THREE paths — cloning the monorepo, `npm install -g
@brabo/runner` (ADR 0106) and a standalone binary via `bun build --compile`
(ADR 0112) — and the third is the most fragile of the three: it already needed
its own manifest generator (`scripts/build-bin.mjs`) to embed the `.node` of
`node-pty`, because Bun only embeds a file reached by a STATIC specifier.

The tree that `dockerode@5` drags in is large — `docker-modem`, `ssh2`,
`@grpc/grpc-js`, `protobufjs`, `tar-fs` — and `ssh2` carries an OPTIONAL native
binding (`cpu-features`). Hence the order the product owner set: **prove first,
design later**, with the decision already written for both outcomes — green,
`dockerode` stays; broken, the runner falls back to `execFile('docker', …)` and
this ADR records the exact error as the reason. No bundler patch or shim: a
creative workaround here becomes debt nobody understands later.

## Decision

### The proof, and what it returned

`dockerode@5.0.1` + `@types/dockerode@4.0.1` went into `apps/runner`, with an
adapter that IMPORTS, INSTANTIATES (`new Docker()`) and CALLS (`ping()`) —
exercised by a `--self-test-docker` flag run against the artifacts, never by an
`import` the bundler could erase.

| step | result |
|---|---|
| `pnpm --filter runner build` (tsup) | **passed** — but `tsup` leaves `dependencies` as external `require` (that is how `jose` already lives today), so `dockerode` did not even enter the bundle |
| `pnpm --filter runner smoke` | **passed** — `node dist/index.cjs --self-test-docker` resolved `dockerode` from `node_modules` and talked to the daemon |
| `pnpm --filter runner build:bin` (`bun build --compile`) | **FAILED** |

The error, pasted whole:

```
3 | const binding = require('../build/Release/cpufeatures.node');
                            ^
error: Could not resolve: "../build/Release/cpufeatures.node"
    at /…/node_modules/.pnpm/cpu-features@0.0.10/node_modules/cpu-features/lib/index.js:3:25
```

The chain is mandatory, not accidental — it was read in the installed code, not
assumed:

```
dockerode → docker-modem (lib/modem.js, linha 6: require('./ssh'))
          → ssh2 (lib/protocol/constants.js, linha 7: require('cpu-features'))
          → cpu-features/lib/index.js → require('../build/Release/cpufeatures.node')
```

`lib/modem.js` does `require('./ssh')` at the top of the module: the SSH
transport enters the graph even in this runner, which only talks to the local
unix socket. The `require` of `cpu-features` is wrapped in `try/catch` inside
`ssh2` and degrades gracefully **at runtime** — but whoever resolves the graph
here is the BUNDLER, at build time, and a bundler has no `try/catch`. It is the
same class of problem ADR 0112 documented with `node-pty`, with one deciding
difference: there the binding is ESSENTIAL (without it there is no terminal,
and so it was worth building the embedding mechanism), and here it is optional
acceleration of a transport we do not use.

**Measured and NOT adopted, for the record:** `bun build --compile --external
cpu-features` compiles (280 modules against 79), produces a binary of
84 473 032 B (+1.7 MB) and `dockerode` WORKS inside it — the `ping` answers
against the real daemon, because the `try/catch` of `ssh2` swallows the stub
Bun leaves in place. This is written so that nobody needs to redo the
investigation, and it is exactly the workaround the product owner's decision
excluded in advance: it drags an optional `.node` from a dead SSH tree into five
binaries per platform, and the debt would be illegible six months later.

**Therefore: the runner uses `execFile('docker', …)`.** `dockerode` was removed
from `package.json` and from the lockfile; nothing of it remained in the tree.
The broker (PR 1.2) does NOT inherit this decision — it runs in an image we
build and never becomes a standalone binary, so `dockerode` remains a candidate
there, and that is precisely why the port below exists.

### Sizes, measured

| artifact | before | after | delta |
|---|---|---|---|
| `dist/index.cjs` | 91 843 B | 106 221 B | +14 378 B (+15.7 %) |
| `dist-bin/brabo-runner-linux-x64` | 82 777 288 B | 82 789 576 B | +12 288 B (+0.015 %) |

The growth is the new code (port + adapter + self-test), not a dependency:
`execFile` comes from `node:child_process`, and there is no tree to embed. For
comparison, the rejected alternative cost **+1.7 MB per binary, times five
platforms**.

### The port

`apps/runner/src/docker-port.ts`, in the same shape as the two contracts the
repository already uses to isolate an external vendor (`LLMProvider` from ADR
0041 and the `GitProviderContract` from Phase 2): abstract class, the domain's
own types, errors normalized by CLASS — whoever consumes decides by the error
type, never by a substring of a vendor message.

**Five operations, not six:** `start`, `stop`, `remove`, `inspect`, `exec`.

**Containment is the TYPE, not the caller's discipline.** What the port does
not let you WRITE is the half that matters:

- `privileged` and `cap_add` — there is no field, and no library type crosses
  the port: the specification is CLOSED and the adapter is who assembles the
  payload. There is nowhere to copy the option from;
- `network: host` — `RedeDoContainer` is the union `'none' | 'egress'`, the
  same boundary posture as ADR 0065. `host` is not a value of the type, so it
  is not a sentence that can be said;
- **free bind-mount** — there is no LIST of mounts. There is ONE folder, the
  destination is the constant `PONTO_DE_MONTAGEM` (`/work`), and the folder's
  type is a BRAND (`RaizDeProjeto`): only `raizDeProjetoValidada()` produces a
  value of that type, and it refuses a relative path, with `..`, with NUL, the
  filesystem root and the system folders (`/etc`, `/var` — which is where
  Docker's own socket lives —, `/dev`, and the others). Mounting `/` is not
  "discouraged" here: it does not compile.

**No operation receives a container id.** All of them start from the
`workspaceDirName` (RN-109, frozen at creation), derive
`brabo-<workspace_dir_name>` and resolve through `docker ps` FILTERED by name
**and** by the label `brabo.managed=true`. "Stop container X", with arbitrary
X, is not a sentence this port knows how to hear — and a namesake without the
label returns `ContainerNaoGerenciadoError`, never `null`: treating it as absent
would make `start` try to create over it and fail with "name already in use", a
message that says nothing about the only thing that actually happened.

**Where the port lives, and why.** In `apps/runner/src/`, because the runner is
the only consumer that exists today. `packages/shared` was considered and
rejected because of an invariant the package itself declares and an api test
keeps honest (`packages-shared-so-tipos.spec.ts`): it is 100 % TYPE, nothing
there can survive `tsc`, because `main` points to raw `.ts` and the api's
production image would die with
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. A port with error classes and a
validation function is runtime code. Splitting the contract into "types there,
errors here" would create two sources for a single thing — which is the defect
the port exists to avoid. When `apps/broker` is born, the file **MOVES** to a
workspace package; it is not COPIED, and that is written in its docblock,
because a second file with the same five operations and a sixth "only in the
broker" is the beginning of the end of the containment above.

### Failure classification

Three named outcomes, in the product's vocabulary (`infra | modelo | código |
política`), and a fourth deliberately WITHOUT origin:

| class | origin | when |
|---|---|---|
| `DockerIndisponivelError` | `infra` | the daemon did not answer. The message says what to DO (`docker info`, `docker` group on Linux) and that no container was touched |
| `DockerCliAusenteError` | `infra` | the `docker` executable is not in the `PATH`. It is its OWN error and not "daemon down": the two are fixed in different ways, and collapsing them is the lesson of RN-475 one floor down |
| `ContainerNaoGerenciadoError` | `política` | there is a container with the derived name and WITHOUT the label `brabo.managed=true` |
| `ComandoDeDockerFalhouError` | *none* | the daemon is alive and refused the command. Its message goes whole |

The fourth declares no origin on purpose: choosing between infra and code for
"No such image" would be diagnosis by elimination, which is the defect ADR 0020
records as the one not to repeat. It says it is the rest, and shows what the
daemon said.

The separation between "daemon down" and "daemon refused" is made by the
COMMAND, not by substring: any non-zero exit triggers a confirming
`docker version`, and it is ITS result that decides the class. It costs one
more call and only on the failure path — the price of not classifying by vendor
text, which ADR 0002 (git) and ADR 0041 (LLM) already forbid on the other two
sides.

## Consequences

**Nothing brings up a container yet, and that is the scope.** The port exists,
the adapter exists, and nobody calls them: no new message on the Phoenix
channel, no change of observable behavior. `start`/`stop`/`remove`/`inspect`/
`exec` are covered by a double in `docker-cli.spec.ts` and **none of them was
exercised against a real daemon** — only `ping` was, through
`--self-test-docker`. It is the same discipline as "a capability is only
declared when proven": who proves the five is PR 1.3, which wires them to the
channel.

**The runner now requires the `docker` BINARY in the `PATH`, not just the
socket.** On the machine of whoever runs Docker this is practically always
true, and its absence has its own error. It is the most visible difference
between this choice and the rejected one: `dockerode` talks to the socket
directly and would not need the CLI.

**The CLI output is text, and text is not a versioned contract.** Every read
uses `--format '{{json .}}'` with a tolerant `JSON.parse` (an illegible line
becomes `null`, never an exception), never column cutting. The CLI version is
that of the user's machine, so no exotic flag is used — only options that have
existed for many versions. Still: a change in the `docker ps` format would
break the read, and that is a risk `dockerode` would not have.

**The `exec` timeout kills the client, not the command.** A `docker exec`
terminated by timeout leaves the process running INSIDE the container, and
there is no way to kill it without a second exec and a PID this path does not
know. The output SAYS so, instead of letting the reader assume the command
died.

**No RN is born here, and that is declared.** There is no observable behavior
for a rule to describe: the product does not call the port. The rule to record
— only the container with `brabo.managed=true` is stopped, removed or used as
an `exec` target — is born in the PR that makes a container actually come up,
together with the test evidence that covers it.

**The proof stays alive.** `--self-test-docker` runs in both smokes
(`pnpm --filter runner smoke` and `smoke:bin`) and passes in BOTH outcomes of
the self-test — daemon answered, daemon did not answer —, because the question
is about the ARTIFACT and not about the machine: requiring a daemon would make
the smoke stop running exactly where it most needs to run (CI, which has no
Docker for the runner). What it guarantees from now on is that the port arrives
whole in `dist` and in the binary, and that absent Docker becomes a NAMED error
instead of a raw stack trace.

**What nobody should redo.** If someone one day proposes `dockerode` in the
runner again, the answer is already measured above: it breaks `build:bin`, and
the only known way to make it fit is the `--external cpu-features` that was
rejected. In the BROKER the question is different and remains open — there is
no standalone binary there, and the port is what makes that second answer an
implementation instead of a rewrite.
