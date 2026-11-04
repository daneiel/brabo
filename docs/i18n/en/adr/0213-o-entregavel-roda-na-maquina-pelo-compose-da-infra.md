---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0213 — The deliverable runs on the user's machine through Infra's compose

## Status

**Accepted.** 2026-10-11 (AT-517; owner decisions of 11/10: "through Infra's
compose", no published port on the broker). Rules in RN-851..855. References,
without editing, [ADR 0130](0130-broker-de-container.md),
[ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) and
[ADR 0199](0199-recurso-minimo-derivado-do-module-map.md).

## Context

At the end of an execution the user had merged code and no declared way to see
it running. What was measured:

- The `docker-compose.yml` Infra opened in the PR was "for development": it
  brought up the environment, not the APP, and the Infra Lead's prompt said the
  project container does not come up through it.
- The image decided in `artifact.project_image` did not reach Infra when it wrote
  the compose, so the module Dockerfile's `FROM` was a guess.
- The app's default port (3000) collides with Brabo's on the same machine.
- The project container has no Docker (ADR 0130 containment), so nothing inside
  Brabo can run `docker compose up` to prove the compose.
- The deliverable's routes are already documented in the README by the dev
  ([RN-850](../business-rules.md#rn-850)), and QA already brings up processes in
  the background and ends the group ([RN-817](../business-rules.md#rn-817)), but
  nothing tied a URL to what the user opens.

## Decision

1. **The path is Infra's compose**, run by the user in the delivered repository.
   The broker does NOT publish a port: ADR 0130's containment stays intact.
2. **The compose brings up the APP** (RN-851): `build` of the module's Dockerfile
   with `FROM` equal to the `artifact.project_image` image, host port
   `${APP_PORT:-8080}:<porta interna>` (8080 is free next to Brabo's ports: 3000,
   4000, 5173, 5432, 7474, 7687, 8088, 11434), a volume for persistent data and
   `env_file` with a committed `.env.example` — never `.env`.
3. **Infra writes the README's "Run on your machine" section**, in its PR. The
   dev keeps "HTTP routes" (RN-850) and adds the Swagger or page URL when it
   creates it.
4. **`propose_infra_pr` gains the MANDATORY `run` field**, validated in the
   engine and the api:
   - `command`: non-empty string, up to 300 characters (e.g.
     `cp .env.example .env && docker compose up --build`);
   - `urls`: 1 to 5 items `{ label, url, kind }`, `label` up to 60 characters,
     `kind` ∈ `api_docs` | `web`, `url` starting with `http://localhost:` or
     `http://127.0.0.1:`;
   - `envExample`: boolean — when `true`, the `.env.example` is among the PR's
     `files`.
5. **The api emits `artifact.run_instructions`** (RN-852) when executing
   `open_infra_pr` successfully: versioned, no table, the current one replaces —
   the design of `artifact.project_image` —, payload
   `{ command, urls, envExample, prUrl }`, read by
   `GET /projects/:projectId/infra-artifacts` (or a dedicated GET if that one
   does not serve).
6. **The dev exposes what is opened** (RN-853), without tying a stack: an HTTP
   module serves `/openapi.json` (OpenAPI 3) and `/docs` (Swagger UI); with
   network `none` or without the package, `/docs` is an HTML page loading
   `swagger-ui` from a CDN — whoever downloads it is the user's browser, not the
   container. A web module serves the home page. The clause only enters when the
   task touches the entrypoint or routes.
7. **QA proves INSIDE the container** (RN-854): it brings up the app with the
   README's command in the background, hits `localhost:<porta interna>/openapi.json`
   and `/docs` (`curl`, `wget` or `node -e fetch`) and ends the process group
   (RN-817). The real `docker compose up` is an OBSERVATION ("proven only on the
   user's machine"), never a plan item.
8. **The Overview gains the "Run on your machine" card** (RN-855): the command
   with a copy button and the clickable URLs, with the text "declared by Infra,
   not verified on your machine" ([RN-468](../business-rules.md#rn-468)) — never
   green.

## Consequences

- Token cost: the `run` payload, the README section and the dev and QA clause are
  more text in turns that already existed; no new turn.
- Declared gap: the real `docker compose up` never runs inside Brabo. What QA
  proves is the app answering inside the container; host port, volume and build
  through the compose are only proven on the user's machine, and the screen says
  so.
- What does NOT change: the containment of ADR 0130 and the broker (no published
  port, no socket in the container, `internal` network), the automatic start-up
  of [ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) and the resources
  derived from the `module_map` of
  [ADR 0199](0199-recurso-minimo-derivado-do-module-map.md). The evidence that
  the entrypoint comes up ([RN-813](../business-rules.md#rn-813)) and the HTTP
  route in the README ([RN-846](../business-rules.md#rn-846)) still hold; this
  ADR adds the URL that is opened, it does not replace the proof.

## Alternatives considered

- **A port published by the broker** for the user to open the app from the
  project container. Refused by owner decision: it would open the project
  container's first port to the host and change ADR 0130's containment.
- **The screen reads the repository's README or compose** to build the card.
  Refused: it would be parsing prose and YAML on the client, without a contract;
  the validated `run` payload and the versioned artifact give the same data with a
  fixed shape.
