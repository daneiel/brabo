---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0209 — The engine moves up to Elixir 1.20.4 / OTP 29.1.1

## Status

**Accepted.** 2026-10-02 (AT-398; owner decision on 02/10, "move the engine up
to OTP 29.1.x"). Changes the runtime pinned in
[ADR 0024](0024-fase5-imagens-producao-ci.md) (decision 10: the same Elixir
version in the Dockerfiles and in CI), without editing it — the SINGLE version
rule still holds, what changes is the version.

## Context

Since AT-361 the engine's `Dockerfile.prod` runs on Alpine 3.24.2 with OTP
27.3.4.18 (hexpm does not publish 27.1.2 on 3.24), while dev and CI stayed on
Elixir 1.17.3 / OTP 27.1.2 / Alpine 3.20.3. The engine build in CI started
aborting in about 10% of runs (0/57 before #821, 5/49 after) with:

```
sys_signal_stack.c:101:sys_sigaltstack(): Internal error
```

Measured cause: Alpine 3.24's musl 1.2.6 refuses the fixed-size alternate signal
stack (`SIGSTKSZ` = 8192) that ERTS 27 requests, on hosts with AMX
(erlang/otp#11349). The fix — sizing by `sysconf(_SC_MINSIGSTKSZ)` (commits
`3a94587176`/`fc35c2496c`) — exists ONLY from OTP 29.1 on. The same defect would
make the PRODUCTION engine die at boot on a server with AMX: the CI flakiness is
the machine lottery.

Moving Alpine back to 3.22 would fix the symptom and freeze the image on a line
that stops receiving security fixes; it was not chosen.

## Decision

1. The engine runs **Elixir 1.20.4 / OTP 29.1.1** in dev, production and CI. The
   image is `hexpm/elixir:1.20.4-erlang-29.1.1-alpine-3.24.2`, pinned by the
   INDEX digest (`sha256:ad851f40…`, ADR 0159/0178), the SAME in the
   `Dockerfile.prod` builder and in the dev `Dockerfile`. The production runtime
   stays `alpine:3.24.2` (the builder's musl matches the runtime's). Elixir 1.20
   is the only line with an hexpm image and build for OTP 29.1.
2. `ELIXIR_VERSION`/`OTP_VERSION` go up together in the three workflows that
   declare them (`ci.yml`, `golden-set-rag.yml`, `golden-set-qa.yml`), and
   `mix.exs` now requires `~> 1.20`.
3. The "Build, scan e smoke" job prints whether the host has AMX
   (`grep -c amx_tile /proc/cpuinfo`): green on a host with AMX is the proof that
   the defect did not come back, and not luck of the draw.
4. No `mix.lock` dependency changed: `mix deps.get` + `mix compile
   --warnings-as-errors` pass on the new version. Elixir 1.20's type checker
   pointed out a dead clause in `Engine.Agents.FilaDeMensagens.acordar/3` — the
   failure to start the agent RAISES, it does not come back as a value — and it
   was fixed by containing the error per agent, not silenced.

## Consequences

- **Dev price:** the engine's `_build`/`deps` volumes were compiled with OTP 27.
  Mix recompiles on its own what was built with another Elixir version, so
  `docker compose up -d --build engine` is enough; if the volume insists on old
  artifacts, `docker volume rm` of the engine's two volumes. Being automatic
  recompilation, the change is NOT breaking for operators.
- Whoever runs the engine outside Docker needs Elixir 1.20.4 / OTP 29.1.1
  (`mix format --check-formatted` depends on the version, ADR 0024 decision 10).
- Dependabot `docker`: with OTP 29.1 + Alpine 3.24 there is no broken pair
  anymore, and no `ignore` was added. It may propose a newer OTP 29.1.x
  `hexpm/elixir` tag — all contain the fix. A proposal that GOES DOWN to OTP <
  29.1 with Alpine ≥ 3.24 reintroduces the defect and must be refused in review.
- A Kubernetes rollout mixes, for moments, OTP 27 and 29 nodes: Erlang
  distribution accepts pairs up to two major versions apart.
