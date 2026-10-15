---
traducao_de: 8f0223952822af7ecfc40540dfed2f87c0ecda61
---

# 0180 — The project container runs as the folder's owner, measured by the api

## Status

**Accepted.** 2026-09-29 (AT-247, story HS-071, epic EP-030, round 27). On top
of [ADR 0130](0130-broker-de-container.md) (the broker, the five-layer
containment and the COMPUTED specification) and
[ADR 0144](0144-a-segunda-raiz-do-broker.md) (the broker serves `mounted`). It
does not edit them: it **adds a field to the specification** and says why it
opens no door.

## Context

Measured in real use on 2026-09-29: `docker inspect` of a project's container
showed an empty `User=` (root) and `CapDrop=[ALL]`. The project folder, mounted
at `/work`, is `755` owned by the operator's uid (1000). Root **without**
`CAP_DAC_OVERRIDE` does not write into another uid's folder, and `--cap-drop
ALL` is exactly what removes that capability. Result: `npm install` gave
`EACCES` in every dev agent and in QA-automation; only `write_file` worked,
because it writes through the engine process on the HOST, outside the container.

Reproduced on real Docker (`node:22-bookworm-slim`, `--cap-drop ALL`, folder
`755` of uid 1000): as root `touch` gives `Permission denied`; with
`--user 1000:1000` it writes. With a uid without an `/etc/passwd` entry `HOME`
becomes `/` and `npm` dies at `//.npm`.

`DockerPort` has five operations, the bind is ONE folder of a marked type and the
type has no `privileged`/`cap_add`/free `-v` (ADR 0130). Any fix has to fit in
that.

## Decision

1. `EspecificacaoDeContainer` gains `usuario?: { uid, gid }`. The CLI adapter
   translates it into `--user <uid>:<gid>` and `--env HOME=/tmp` (constant: a
   uid without passwd gets `HOME=/`). Without `usuario`, `run` comes out byte
   for byte as before.
2. **The api is who measures**, since it reaches the folder (the base mounted
   by identity, or the managed root): `GET /internal/projects/:id/container-spec`
   now returns `usuarioDaPasta` (`stat` of the folder; `null` if it cannot
   measure, if the project is `runner` or if the owner is root). The broker
   composes `usuario` FROM THAT context — never from a request body: `start` has
   no body and `pedidoDeExecValidado` ignores any extra field.
3. The broker **revalidates** (`usuarioValidado`): integers in 1..2^31-1, `0`
   refused naming the field. Root is the ABSENT one; an explicit `--user 0`
   would be a loosening nobody decided.
4. `exec` **gets no field**: `docker exec` inherits the container's user.
5. It applies to `container` and `mounted` (the api measures the folder each
   one mounts); `runner` mode does not go through the broker and does not
   change.

## Consequences

- **It opens no containment door.** The process now has LESS power over the
  host than before (non-root instead of root), `--cap-drop ALL` stays, and
  there is no field where a caller writes user, capability, mount or network.
- The second option considered, giving back
  `DAC_OVERRIDE`/`CHOWN`/`FOWNER`, was **refused**: it loosens the containment
  ADR 0130 fixed and keeps root.
- A third, the broker doing `stat` itself, would require mounting the projects'
  folders in the broker (today it only has the socket) — more surface in a
  root-equivalent process. The api already reaches them.
- It is not BREAKING for the operator: an unreadable or root-owned folder falls
  into "as always". An ALREADY created container does not change until
  recreated (`--user` belongs to `run`); the next `container_start` already
  comes up right.
- Folder owner ≠ who the dev agent should be is not a distinction the product
  makes: the goal is to write where the operator already writes.
- **Not measured:** Docker Desktop (macOS/Windows), where the bind-mount uid
  mapping is different; rootless Docker; a folder on NFS with `root_squash`.
