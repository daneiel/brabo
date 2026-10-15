---
traducao_de: 9a25c430731ce944336ddabb81a070a0a49a3239
---

# 0189 — The autopilot: automatic mode approves everything except the ceilings, the scope compares against the real execution folder, and "Always allow" records verb + subcommand

## Status

**Accepted.** 2026-10-01 (AT-259, AT-255, AT-258 and AT-257 — this one closes
AT-170 —, story HS-066, epic EP-030, round 35; owner decision of 01/10, written
in the activities). References
[ADR 0167](0167-modo-automatico-libera-o-escopo-de-caminho.md) (automatic mode
releases the path scope) and
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) (the terminal
policy's path scope) without editing them: 0167 **is not revoked** — automatic
mode still releases any command, including outside the folder —, and 0055 is
still the ceiling, now compared against the folder where the command RUNS.

## Context

The real use of 2026-09-29 measured three defects of one policy
(`analise-uso-real.md`, items 9 and 11):

1. **"Always allow" turned automatic mode off.** The seven dev agents received
   the `*: auto_approve` wildcard at 06:48:28–34 and, seconds later, got the
   `terminal: auto_approve` row recorded by the dev agent's "Always allow"
   ([RN-509](../business-rules.md#rn-509)). The repository returned the
   SPECIFIC rule before the wildcard, with origin `especifica`, and `decide()`
   only recognizes automatic mode with origin `curinga`
   ([RN-603](../business-rules/autenticacao.md#rn-603)). Result: 97 requests
   "compound command with at least one segment not covered by allow" and 37
   "scope" with automatic mode lit on screen.
2. **The scope compared against the folder where the command does NOT run.**
   The 37 "scope" ones were all `/work/...` or `/tmp`, compared against the HOST
   root (`/home/<usuario>/projetos-brabo/<projeto>`). With a `running`
   container, the engine executes the command INSIDE it (RN-492/RN-502), in
   `/work`, and translates the host `cwd` to `/work` only afterwards, in
   `terminal_executor.ex`.
3. **Automatic mode did not say, on screen, what it releases.** The batch card
   of [RN-661](../business-rules.md#rn-661) said what it does NOT release; the
   agent card toggle and the `ApprovalCard` had different sentences, and none
   said that `git commit` and a local branch pass.

Activity AT-259 proposed revoking the part of RN-603 that releases the scope.
The owner decided the opposite on 01/10: *"RN-603 is NOT revoked — since the
command runs in the container, automatic mode keeps releasing any command,
including outside the folder, as long as it is kept so that no problem occurs
with the code Brabo is running"*.

Measured on `dev` before changing (tests that failed on today's code):
`decide.spec.ts` (5 cases of the root in the container),
`agent-autonomy.repository.spec.ts` (the specific shadowing the wildcard) and
`approve-always-action.use-case.spec.ts` (the measured scenario, end to end).
**Did not reproduce:** the autopilot already approved `git commit`,
`git checkout -b`/`switch -c`/`branch` and the `git_commit`/`git_branch_create`
types with the wildcard on, and already held push/PR/merge/deploy,
`sudo`/`doas`, `container_remove`, `instruction_patch` and parallelism — AT-259
closes only through AT-255 and the screen.

## Decision

### 1. Automatic mode is the AUTOPILOT

The `*: auto_approve` wildcard approves EVERYTHING, including the compound
synthesized from `permissions.json` and a path outside the folder (RN-603,
kept), and `git commit` and LOCAL branch creation. Still out, never
auto-approvable: git push/PR/merge/deploy through the terminal
([RN-418](../business-rules.md#rn-418)), `sudo`/`doas`, merge into a protected
branch, `container_remove`, `instruction_patch` and
`parallelize`/`raise_max_parallel`. An explicit `deny` still wins, and an `ask`
WRITTEN in the file still asks — it is the user's rule, as it already was in
RN-603.

### 2. "Always allow" does not turn the autopilot off (the simplest form)

The specific `auto_approve` under the `auto_approve` wildcard resolves as the
WILDCARD, in the SAME repository that already resolved precedence
(`DrizzleAgentAutonomyRepository.resolve`). Of the two forms AT-255 offered —
not recording the specific when there is a wildcard, or the wildcard applying
to the exemptions with the specific `auto_approve` —, it was the second, for
three reasons: it fixes the rows ALREADY recorded in real use (the first would
only avoid the next ones); the click still records the specific, which stays in
effect if the toggle goes back to manual (with the scope, as always); and no new
path is born — `decide()` does not change its rule, it just receives the right
origin. A specific saying SOMETHING ELSE (`require_approval`, `deny`) still wins
over the wildcard.

`AutonomiaResolvida` gains `especifica` (the mode of the specific row, when it
exists), and it is through it, and not the resolved mode, that "Always allow"
decides whether the agent's pattern is already recorded.

### 3. The scope compares against the REAL execution folder

With a registered `running` container in a `container` or `mounted` project,
the scope ceiling's root is `/work` (the mount point — the project's folder and
`.worktrees`) plus the container's `/tmp`. The host `cwd` is translated to
`/work` by the SAME rule as the engine (`cwd_para_container/2`): the root
becomes `/work`, what is under it becomes `/work/...`, what is outside stays as
it came. In `mounted` the translation is bijective (the bind-mount is the
folder's identity). Without a container, the root is the project folder on the
host, and the host's `/tmp` stays OUT — it belongs to the whole machine,
including Brabo.

This applies to whoever is NOT on autopilot — the specific `terminal` rule —,
because the autopilot does not go through the scope. `projectScopeRoot` does not
change and does NOT merge with `permissionsFilePath` (RN-478): the host root is
still the input, and the root in the container is DERIVED from it in
`path-scope.ts`. The container auto-approval FLOOR (RN-493) is still only for
`container` mode; the new `DecideContext` field (`execucaoNoContainer`) is WHERE
the command runs, and it is a different thing.

`runner` stays out, on purpose: the host-vs-container choice is internal to the
runner (ADR 0137), and a restarted runner with the container up routes to the
HOST (RN-558) — the api does not know which of the two will happen, and
releasing `/tmp` for someone who may be on the host would be releasing the
`/tmp` of the user's machine.

### 4. The screen says what the autopilot releases and what it does not

ONE list (`OQueOPilotoLibera`), in the THREE places where automatic mode is
turned on: the Executors batch card (open), the `ApprovalCard` and the agent
card toggle (collapsed, under the sentence that already existed). The "does not
release" half is the text RN-661 already had, reused; the "releases" half is
born here.

### 5. The owner's guarantee: containment, proven

The decision's condition — no problem with the code Brabo is running — is not
policy, it is the container's containment, and it is proven end to end in
`apps/broker/src/contencao-do-brabo.spec.ts`: the project container mounts ONE
folder, always at `/work`, STRICTLY below the broker's root (managed or base),
with no Docker socket, no `--privileged`, no host network, and an
empty/absolute/traversing segment is refused before any Docker call. Added to
the guards preventing the root from containing the checkout
(`baseSobrepoeOCheckout` in `preflight.mjs`, tested in
`scripts/dev/base-de-projetos.spec.ts`) and to the refusal to execute without a
container (RN-502/RN-507), the autopilot's command does not reach Brabo's
checkout.

### 6. The unit of "Always allow": verb + subcommand, per segment

Owner decision of 01/10 (AT-257, which closes AT-170 — point 6 of ADR 0055, left
open there): the click stops recording the whole command, byte for byte, and
records ONE pattern per SEGMENT of the command, in the VERB + SUBCOMMAND unit
(`npm test`, `git status`); an argument that is not a word generalizes to the
verb (`cat src/x.ts` → `cat`); verb + flag stays EXACT (it is the form, where
findings Z/AD say verb and invocation diverge); and a unit that is a prefix of
an RN-418 ceiling (`git remote`, `gh pr`) stays exact, or disappears if even the
exact one is. AT-170's four sub-questions are answered: the unit is this one; it
does NOT inherit the verb allowlist (no verb list is born, and doubt between
argument and subcommand falls on the narrow side); whoever records is the same
role as today; and precedence with the wildcard is point 2's. Detail in
[RN-675](../business-rules.md#rn-675).

## Consequences

- The scenario measured on 29/09 stops asking for approval: wildcard + "Always
  allow" stays on autopilot (non-regression test in
  `approve-always-action.use-case.spec.ts`).
- The specific rule `terminal: auto_approve` stops asking for approval for
  `/work/...` and `/tmp` with the container up, and starts asking for a HOST
  path in a command (which does not exist inside the container — the engine
  translates only the `cwd`, never the arguments).
- **What the containment proof does NOT cover — declared, not fixed here (the
  owner's decision was to describe, not patch policy):**
  1. In the PRODUCTION compose (`docker/docker-compose.prod.yml`) nothing on the
     host checks that `BRABO_PROJECTS_BASE` does not contain the folder the
     compose runs from (the checkout, or the `.env` folder). `preflight.mjs`
     only runs in `pnpm dev`, and `caminhoDeWorkspaceLocalValido` compares
     against the api's OWN `cwd` (`/app`), which is never the host path. With
     such a base, a `mounted` project whose folder is the checkout mounts the
     checkout at `/work` — with or without autopilot.
  2. In the INSTALLATION, `install.sh` refuses a base overlapping the
     installation folder only at consent (`consentir_base`), without its own
     test; an `.env` edited afterwards is not checked again.
  3. In `runner` mode, nothing compares the project folder (or the local
     agent's base) with a Brabo checkout or with the installation folder on the
     user's machine — the api compares against its own `cwd`, and the runner's
     `guard.ts` only restricts to `$HOME` on Linux.
  4. `segmentoDeProjetoValidado` (`packages/docker-port`) accepts `.` as a
     segment: `<raiz>/.` passes `raizDeProjetoValidada` as the root itself and
     would mount ALL projects of that root. The api never produces `.` (the
     mounted segment comes out normalized, and the managed one is
     `[A-Za-z0-9_-]`), so it is not reachable today; but the broker exists so
     as not to depend on the caller being correct. It does not reach the
     checkout (the root does not contain it), it reaches the OTHER projects.
  5. The `egress` network is `bridge`: the container reaches the ports the
     machine publishes, including those of the api and the engine. Files no;
     services, yes — behind authentication.
- "Always allow" on a compound now releases the NEXT compounds with the same
  verbs and subcommands — including, for a verb without a subcommand (`cat`,
  `rm`, `cd`), the verb with ANY argument. It is the expansion AT-170 asked to be
  decided and not deduced; outside the autopilot the path scope still limits
  where, and the ceilings still run after the file.
- TYPED `git_push` and `pr_open` are not a ceiling in `decide()`: activation
  seeds `auto_approve` for them per `dev-<modulo>` (ADR 0053) and the wildcard
  also approves them; what holds them is "Always allow" refusing to record them
  (AT-320) and the ceiling on merging into a protected branch. Not changed here.
