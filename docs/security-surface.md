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
| `engine-service` | `EngineServiceGuard`: `X-Brabo-Service-Token` igual ao segredo compartilhado. É a superfície interna api↔engine, fora do JWT |
| `role:<papel>` | autenticada e restrita pelo RBAC do domínio (`@RequireRole`) |
| `jwt` | autenticada, sem papel exigido na rota — o escopo vem do próprio recurso |

## As doze rotas públicas

Eram quatro até a Fase 6. A Fase 7a acrescentou oito de uma vez — o auth
first-party — e cada uma está justificada abaixo. Abrir mais alguma continua
exigindo mexer na asserção de `route-surface.spec.ts`, que lista as públicas
literalmente para forçar a conversa.

### Infraestrutura

**`GET /live`** — liveness. Não toca no banco de propósito: responde enquanto o
processo estiver vivo. Exigir token aqui faria o kubelet reiniciar o pod ao
primeiro problema no caminho de autenticação, transformando degradação em queda
total.

**`GET /health`** — readiness, com `select 1`. Mesmo raciocínio: é o kubelet
quem chama, e ele não carrega token. Revela apenas se o banco responde.

**`GET /metrics`** — scrape do Prometheus, que também não carrega token nenhum.
Exposição controlada por REDE, não por auth: a NetworkPolicy só
libera o namespace `monitoring`, e o Ingress de produção bloqueia o caminho.
Sem `@Public()` o alvo apareceria como `down` com todo o resto verde.

**`GET /git/oauth/:provider/callback`** — o retorno do OAuth de GitHub/GitLab.
O browser do usuário chega aqui vindo do provider, sem sessão da api. Não é
irrestrita: o parâmetro `state` é validado por HMAC
(`GIT_OAUTH_STATE_SECRET`), e sem `state` válido a chamada é recusada.

### Auth first-party

As sete rotas de `/auth/*` mais o JWKS. **Todas precisam ser públicas pela
mesma razão estrutural:** são o caminho por onde se OBTÉM um access token, e o
`JwtAuthGuard` global exige um. Uma rota de auth atrás do guard pediria a
credencial que ela mesma emite. O `logout` é a única que poderia ser
autenticada, e não é de propósito: ele já carrega a credencial que lhe
interessa — o refresh no cookie, com o par de CSRF — e deslogar precisa
funcionar mesmo com o access token expirado.

> **O que protege estas rotas não é o rate limit.** O `RateLimitGuard` libera
> rota `@Public()` — de propósito, para não estrangular `/health` até o kubelet
> reiniciar o pod. Quem segura esta superfície é o **lockout progressivo** por
> e-mail e por IP, dentro dos casos de uso. Não é reforço opcional: é a única
> defesa que existe aqui. Ver
> [RN-030](business-rules.md#rn-030) e [RN-031](business-rules.md#rn-031).

**`POST /auth/register`** — cadastro. Responde `202` tanto para endereço novo
quanto para já cadastrado; no segundo caso nada é criado e o dono do endereço
recebe um aviso. Um `409 Conflict`, que é o que o bom senso REST pediria,
entregaria a lista de usuários a quem tiver uma wordlist.

**`POST /auth/login`** — autenticação. E-mail inexistente, senha errada e conta
bloqueada devolvem a **mesma** resposta 401, e gastam o **mesmo** tempo (o ramo
sem conta verifica contra um hash dummy de parâmetros idênticos).

**`POST /auth/refresh`** — rotação. O próprio refresh token é a credencial, e
por isso a rota não pode exigir outra.

**`POST /auth/logout`** — revoga a família do token apresentado. Sempre `204`,
inclusive para token desconhecido: responder 401 aqui seria um oráculo de
validade de token.

**`POST /auth/verify-email`**, **`POST /auth/request-password-reset`**,
**`POST /auth/reset-password`** — fluxos de conta. Quem chega neles ainda não
tem sessão, por definição. A credencial é o token de uso único que veio por
e-mail; link inválido, expirado e já usado têm resposta idêntica.

**`GET /.well-known/jwks.json`** — a metade **pública** do par Ed25519 que
assina os access tokens. Mesmo raciocínio de `/metrics`: quem consome não tem
token, e exigir um seria pedir credencial para poder validar credencial.
Publicar chave pública é o propósito do formato — o que não pode sair daqui é
o componente `d` da JWK, travado por teste.

## Notas

- **`GET /`** é o "Hello World!" do scaffold do NestJS
  (`src/app.controller.ts`). Está atrás do guard e não vaza nada, mas não serve
  a nada — candidata a remoção. Ficou registrada aqui em vez de removida por
  ser decisão de produto, fora do escopo desta sessão.
- **As rotas `engine-service` não são "internas" por convenção de nome.** O que
  as protege é o `EngineServiceGuard` comparando o `X-Brabo-Service-Token` com
  o segredo compartilhado em tempo constante, mais a NetworkPolicy. O prefixo
  `/internal` é sinalização para humanos. Elas ficam **fora do JWT** por
  `@ServiceRoute()`: o token de usuário não serve aqui e o de serviço não serve
  em nenhuma outra rota — os dois mecanismos nunca se sobrepõem
  ([RN-035](business-rules.md#rn-035)).
- **`/docs` e `/docs-json` NÃO estão na tabela, e isso é uma lacuna
  conhecida.** O Swagger UI é montado por `SwaggerModule.setup()` no nível do
  Express, não como controller, e o teste enumera por `DiscoveryService` — ele
  estruturalmente não as vê. As duas só existem com `NODE_ENV !== 'production'`
  (`main.ts`), são públicas, e servem o mesmo documento que a
  [referência gerada](reference/api/brabo-api) publica. Registrado aqui em vez
  de omitido: o que o teste não alcança precisa estar na prosa.
- **`jwt` sem papel não significa sem autorização.** Em `/users/me/*` o escopo é
  o próprio usuário; em `GET /workspaces` a listagem já é filtrada pela
  associação de quem chamou.
- **O `X-Brabo-Service-Token` passou a ser redigido no log** ([ADR
  0035](adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)). Ele é o bearer
  de todo o tráfego api↔engine e **não** constava da lista de `redact` do pino: se
  caísse num corpo de erro logado, iria para o Loki em texto claro e com retenção.
  Entraram junto `serviceToken`, `privateKey`, `encryptedDek` e `dek`. A lista
  completa está em `apps/api/src/infrastructure/observability/logger.config.ts`, e
  há teste afirmando cada caminho — a lista é contrato, não conveniência.
- **`allowedHeaders` do CORS é explícito**, e a lista precisa conter todo header
  que a web manda: `Content-Type`, `Authorization`, `X-CSRF-Token` e `traceparent`.
  Faltar um não quebra teste nenhum (teste não faz preflight) e quebra o browser.
- **O engine tem CORS só nas rotas de health** ([ADR
  0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)). `/health`, `/live` e
  `/ready` respondem `Access-Control-Allow-Origin` para as origens de
  `WEB_ORIGIN`; **`/internal/*` e `/metrics` não**, e a exclusão é o ponto. As 13
  rotas internas são server-to-server com segredo compartilhado
  ([RN-035](business-rules.md#rn-035)); CORS ali não habilitaria nada — o cliente
  HTTP da api ignora esses cabeçalhos — mas **anunciaria a um navegador que ele é
  um cliente esperado daquele canal**. Há teste afirmando a ausência, e um sobre a
  lista de caminhos ter exatamente três entradas, para mover a fronteira aparecer
  no diff.
- **Origem desconhecida recebe resposta, não `403`.** Nos dois serviços, o pedido
  é atendido e sai sem o cabeçalho; quem barra a leitura é o navegador, que é de
  quem a decisão é. Responder `403` quebraria todo cliente que não manda `Origin`
  — probe do kubelet, `curl`, o `docker/smoke.sh`.
- **`POST .../delegations` é engine-service como as demais rotas internas**
  (Fase 8b QA, Fase 8c Infra — ADR 0038) — o lead de cada área registra o
  desfecho de cada delegado (`completed`/`failed`/`dispensed`) SEPARADO da
  chamada que a área usa pra reportar o resultado consolidado pra fora
  (`gates/verdict` pro QA, `open_infra_pr` pro Infra). Session-scoped, não
  task-scoped — `taskId` é opcional no corpo. Delegação nunca é visível como
  handoff.

## Tabela

<!-- INÍCIO DA TABELA — o teste parseia daqui até o fim do documento. -->

| método | caminho | classificação |
|---|---|---|
| GET | `/.well-known/jwks.json` | public |
| POST | `/auth/login` | public |
| POST | `/auth/logout` | public |
| POST | `/auth/refresh` | public |
| POST | `/auth/register` | public |
| POST | `/auth/request-password-reset` | public |
| POST | `/auth/reset-password` | public |
| POST | `/auth/verify-email` | public |
| GET | `/git/oauth/:provider/callback` | public |
| GET | `/health` | public |
| GET | `/live` | public |
| GET | `/metrics` | public |
| POST | `/internal/sessions/:sessionId/actions` | engine-service |
| GET | `/internal/sessions/:sessionId/anamnese-context` | engine-service |
| POST | `/internal/sessions/:sessionId/delegations` | engine-service |
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
