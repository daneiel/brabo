# Superfície exposta da api

Toda rota registrada, com a classificação de autenticação e a justificativa das
que ficam abertas. Decisões em
[ADR 0027](adr/0027-fase5-backup-hardening-release.md).

> **Este documento é a fonte de verdade de um teste**, não uma cópia dele.
> `apps/api/test/interfaces/route-surface.spec.ts` sobe a aplicação, enumera as
> rotas **registradas em runtime** e compara com a tabela abaixo. Rota nova sem
> linha aqui **quebra o teste**; linha com classificação diferente da anotação
> real **quebra o teste**; linha órfã (que não corresponde a rota nenhuma)
> **quebra o teste**. Não dá para a documentação envelhecer em silêncio.

## Classificações

| valor | o que significa |
|---|---|
| `public` | `@Public()` — sem token. Cada uma justificada abaixo |
| `engine-service` | `EngineServiceGuard`: token válido E `clientId = engine-service`. É a superfície interna api↔engine |
| `role:<papel>` | autenticada e restrita pelo RBAC do domínio (`@RequireRole`) |
| `jwt` | autenticada, sem papel exigido na rota — o escopo vem do próprio recurso |

## As quatro rotas públicas

**`GET /live`** — liveness. Não toca no banco de propósito: responde enquanto o
processo estiver vivo. Exigir token aqui faria o kubelet reiniciar o pod ao
primeiro problema no Keycloak, transformando degradação em queda total.

**`GET /health`** — readiness, com `select 1`. Mesmo raciocínio: é o kubelet
quem chama, e ele não carrega token. Revela apenas se o banco responde.

**`GET /metrics`** — scrape do Prometheus, que também não carrega token do
Keycloak. Exposição controlada por REDE, não por auth: a NetworkPolicy só
libera o namespace `monitoring`, e o Ingress de produção bloqueia o caminho.
Sem `@Public()` o alvo apareceria como `down` com todo o resto verde.

**`GET /git/oauth/:provider/callback`** — o retorno do OAuth de GitHub/GitLab.
O browser do usuário chega aqui vindo do provider, sem sessão da api. Não é
irrestrita: o parâmetro `state` é validado por HMAC
(`GIT_OAUTH_STATE_SECRET`), e sem `state` válido a chamada é recusada.

## Notas

- **`GET /`** é o "Hello World!" do scaffold do NestJS
  (`src/app.controller.ts`). Está atrás do guard e não vaza nada, mas não serve
  a nada — candidata a remoção. Ficou registrada aqui em vez de removida por
  ser decisão de produto, fora do escopo desta sessão.
- **As rotas `engine-service` não são "internas" por convenção de nome.** O que
  as protege é o `EngineServiceGuard` verificando o `clientId` do token, mais a
  NetworkPolicy. O prefixo `/internal` é sinalização para humanos.
- **`jwt` sem papel não significa sem autorização.** Em `/users/me/*` o escopo é
  o próprio usuário; em `GET /workspaces` a listagem já é filtrada pela
  associação de quem chamou.

## Tabela

<!-- INÍCIO DA TABELA — o teste parseia daqui até o fim do documento. -->

| método | caminho | classificação |
|---|---|---|
| GET | `/git/oauth/:provider/callback` | public |
| GET | `/health` | public |
| GET | `/live` | public |
| GET | `/metrics` | public |
| POST | `/internal/sessions/:sessionId/actions` | engine-service |
| GET | `/internal/sessions/:sessionId/anamnese-context` | engine-service |
| GET | `/internal/sessions/:sessionId/dev-context` | engine-service |
| POST | `/internal/sessions/:sessionId/epics` | engine-service |
| GET | `/internal/sessions/:sessionId/events` | engine-service |
| POST | `/internal/sessions/:sessionId/events` | engine-service |
| POST | `/internal/sessions/:sessionId/gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/handoffs` | engine-service |
| POST | `/internal/sessions/:sessionId/hypotheses` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-artifacts/:prActionId/files` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-context` | engine-service |
| POST | `/internal/sessions/:sessionId/infra-gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/instruction-patches` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn-stream` | engine-service |
| POST | `/internal/sessions/:sessionId/module-map` | engine-service |
| POST | `/internal/sessions/:sessionId/proficiency` | engine-service |
| GET | `/internal/sessions/:sessionId/psychologist-context` | engine-service |
| POST | `/internal/sessions/:sessionId/stories` | engine-service |
| POST | `/internal/sessions/:sessionId/story-modules` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/block` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/gate/open` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/status` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/claim` | engine-service |
| POST | `/internal/sessions/:sessionId/termination` | engine-service |
| GET | `/` | jwt |
| GET | `/models` | jwt |
| GET | `/users/me/credentials` | jwt |
| POST | `/users/me/credentials` | jwt |
| DELETE | `/users/me/credentials/:provider` | jwt |
| POST | `/users/me/git-credentials` | jwt |
| GET | `/workspaces` | jwt |
| POST | `/workspaces` | jwt |
| DELETE | `/projects/:projectId` | role:maintainer |
| GET | `/projects/:projectId` | role:viewer |
| PATCH | `/projects/:projectId` | role:maintainer |
| GET | `/projects/:projectId/agent-autonomy` | role:maintainer |
| PUT | `/projects/:projectId/agent-autonomy` | role:maintainer |
| GET | `/projects/:projectId/agent-bindings/:agentSlug` | role:viewer |
| PUT | `/projects/:projectId/agent-bindings/:agentSlug` | role:developer |
| GET | `/projects/:projectId/agents/:agent/instruction-versions` | role:viewer |
| POST | `/projects/:projectId/agents/:agent/instruction-versions/:version/rollback` | role:maintainer |
| POST | `/projects/:projectId/anamnese/run` | role:maintainer |
| GET | `/projects/:projectId/architecture` | role:viewer |
| GET | `/projects/:projectId/backlog` | role:viewer |
| GET | `/projects/:projectId/budget` | role:maintainer |
| PUT | `/projects/:projectId/budget` | role:maintainer |
| GET | `/projects/:projectId/coverage` | role:viewer |
| GET | `/projects/:projectId/events/:eventId` | role:viewer |
| POST | `/projects/:projectId/execution/activate` | role:maintainer |
| GET | `/projects/:projectId/git/:provider/connect` | role:maintainer |
| POST | `/projects/:projectId/git/:provider/repository` | role:maintainer |
| GET | `/projects/:projectId/git/bootstrap` | role:viewer |
| GET | `/projects/:projectId/git/repository` | role:viewer |
| GET | `/projects/:projectId/hypotheses` | role:viewer |
| POST | `/projects/:projectId/hypotheses/:hypothesisId/accept` | role:developer |
| POST | `/projects/:projectId/hypotheses/:hypothesisId/dismiss` | role:developer |
| GET | `/projects/:projectId/infra-artifacts` | role:viewer |
| GET | `/projects/:projectId/instruction-versions` | role:viewer |
| GET | `/projects/:projectId/members` | role:viewer |
| POST | `/projects/:projectId/members` | role:maintainer |
| DELETE | `/projects/:projectId/members/:userId` | role:maintainer |
| GET | `/projects/:projectId/model-binding` | role:viewer |
| PUT | `/projects/:projectId/model-binding` | role:maintainer |
| GET | `/projects/:projectId/permissions` | role:maintainer |
| PUT | `/projects/:projectId/permissions` | role:maintainer |
| GET | `/projects/:projectId/proficiency` | role:viewer |
| DELETE | `/projects/:projectId/proficiency/me` | role:viewer |
| POST | `/projects/:projectId/proficiency/me/opt-in` | role:viewer |
| GET | `/projects/:projectId/psychologist/analyses` | role:viewer |
| GET | `/projects/:projectId/sessions` | role:viewer |
| POST | `/projects/:projectId/sessions` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId` | role:viewer |
| GET | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve_always` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/deny` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/message` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/start` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/arquiteto/handoff-infra` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| PUT | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/chat` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/events` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/events` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/events/:eventId` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/execution/parallelize` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/handoffs` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/handoffs/:handoffId/accept` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/model-binding` | role:viewer |
| PUT | `/projects/:projectId/sessions/:sessionId/model-binding` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/psychologist/reanalyze` | role:maintainer |
| POST | `/projects/:projectId/sessions/:sessionId/readiness` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/tasks/:taskId/unblock` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/token-usage` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/transition` | role:developer |
| DELETE | `/workspaces/:workspaceId` | role:owner |
| GET | `/workspaces/:workspaceId` | role:viewer |
| PATCH | `/workspaces/:workspaceId` | role:maintainer |
| POST | `/workspaces/:workspaceId/members` | role:owner |
| GET | `/workspaces/:workspaceId/model-binding` | role:viewer |
| PUT | `/workspaces/:workspaceId/model-binding` | role:maintainer |
| GET | `/workspaces/:workspaceId/projects` | role:viewer |
| POST | `/workspaces/:workspaceId/projects` | role:maintainer |
