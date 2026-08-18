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

## As catorze rotas públicas

Eram quatro até a Fase 6. A Fase 7a acrescentou oito de uma vez — o auth
first-party — e o ADR 0084 acrescentou mais duas, o login social. Cada uma
está justificada abaixo. Abrir mais alguma continua exigindo mexer na
asserção de `route-surface.spec.ts`, que lista as públicas literalmente para
forçar a conversa.

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

Essa garantia vale exatamente o quanto vale a chave, e por isso ela deixou de
ter default: em produção a api **não sobe** com a chave de exemplo do
repositório, que é pública (ADR 0059, [RN-093](business-rules.md#rn-093)). Com
a chave conhecida, esta rota volta a ser irrestrita na prática — qualquer um
assina um `state` para o projeto que quiser.

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

### Login social (ADR 0084)

**`GET /auth/oauth/:provider/start`** — redireciona direto para o provider
(GitHub/GitLab). Pública pela mesma razão estrutural das outras sete: é o
próprio ponto de entrada, antes de qualquer sessão existir. O `state` que ela
gera é assinado por HMAC com propósito PRÓPRIO
(`signSocialOauthState`/[RN-273](business-rules.md#rn-273)) — nunca o mesmo
`state` do `GET /git/oauth/:provider/callback` acima, mesmo as duas rotas
assinando com a MESMA chave `GIT_OAUTH_STATE_SECRET`. O campo `purpose` no
payload é o que impede um `state` de um fluxo ser aceito no verificador do
outro.

**`GET /auth/oauth/:provider/callback`** — recebe o retorno do provider.
Mesmo raciocínio do callback de conexão de git: o browser chega sem sessão, o
`state` é verificado por HMAC, e a rota nunca responde JSON — sempre
redireciona, para `WEB_ORIGIN/` no sucesso (com os cookies de sessão já
gravados) e para `WEB_ORIGIN/login?oauth_error=1` na falha, sem detalhar o
motivo na URL.

## Notas

- **`POST /workspaces/:workspaceId/projects` decide onde o agente vai escrever,
  e por isso é rota de superfície de segurança, não só de cadastro**
  ([ADR 0072](adr/0072-projeto-local-ou-container.md),
  [RN-169](business-rules.md#rn-169)/[RN-170](business-rules.md#rn-170)). O
  corpo ganhou `workspaceMode` (`container` — o default e o comportamento de
  sempre — ou `local`) e `workspacePath`. No modo `local` o caminho absoluto
  informado vira a **raiz do escopo de terminal** do ADR 0055: o que se digita
  aqui é o que o agente pode ler e escrever. Nenhuma rota nova, e nenhuma
  mudança de papel (`RequireRole('maintainer')`, como já era) — o que mudou é
  o alcance do que a rota concede.

  A validação está toda na criação (RN-170: absoluto, sem `..`, existente,
  gravável de dentro do container, nunca raiz nem pasta de sistema, nunca
  sobreposto ao checkout do Brabo nos dois sentidos) e a recusa é `400` com a
  linha de compose que resolve. O modo é **congelado** depois: `UpdateProjectDto`
  omite os dois campos de propósito, senão `PartialType(CreateProjectDto)` os
  exporia num `PATCH` sem guarda nenhuma. O predicado léxico ainda roda a cada
  derivação da raiz, porque o único jeito de burlar a criação é escrever direto
  no banco.
- **`GET /`** é o "Hello World!" do scaffold do NestJS
  (`src/app.controller.ts`). Está atrás do guard e não vaza nada, mas não serve
  a nada — candidata a remoção. Ficou registrada aqui em vez de removida por
  ser decisão de produto, fora do escopo desta sessão.
- **`GET /internal/projects/:projectId/git-remote` é a única rota do produto que
  devolve um segredo DECIFRADO** — o token de git do owner do workspace
  ([ADR 0056](adr/0056-o-engine-trabalha-em-repositorio-remoto.md)). Ela existe
  porque o engine trabalha no sistema de arquivos e não tem a chave mestra;
  replicá-la no engine dobraria o raio de explosão do segredo mais sensível do
  produto. Duas propriedades a mantêm defensável: o `origin` que ela devolve é
  **limpo** (a credencial vem em campo separado, e nunca embutida na URL), e
  quem consome tem a obrigação de injetá-la por invocação, nunca em arquivo —
  ver `Engine.Actions.GitAuth` e o porquê disso na
  [RN-076](business-rules.md#rn-076). Se algum dia esta rota passar a devolver
  a URL já autenticada, o token vai parar no `.git/config`, dentro da pasta
  onde o dev agent tem leitura auto-aprovada.
- **As duas rotas de leitura do PO** — `GET /internal/projects/:projectId/business-rules`
  e `GET /internal/projects/:projectId/backlog`
  ([RN-164](business-rules.md#rn-164)) — não devolvem segredo nenhum e **não
  aceitam nada além do id do projeto**: sem termo de busca, sem paginação, sem
  filtro. É de propósito. Uma rota de leitura para agente é uma superfície que
  o modelo escolhe chamar, e parâmetro é onde o modelo escreve o que quiser;
  aqui não há onde escrever. O escopo é fechado no projeto pelo caminho, e o
  custo por chamada é constante (três leituras no backlog, duas nas regras).
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
- **`GET /projects/:projectId/agent-areas` passou a devolver dados de verdade,
  e a classificação não mudou** — continua `role:developer`, enquanto o `PATCH`
  do teto continua `role:maintainer`. Até a FASE 18 a tabela `agent_areas`
  nunca era gravada e a rota respondia `[]` a todo mundo, o que fazia a
  classificação parecer folgada por acidente e não por decisão. Com a área
  nascendo junto com o projeto ([RN-094](business-rules.md#rn-094)), o corte
  volta a ser o que a FASE 14d quis: **ler** o teto é trabalho de quem executa;
  **mudá-lo** é decidir quanto o produto gasta sem perguntar, e por isso exige
  o mesmo papel de ativar a execução.
- **As três rotas `/projects/:projectId/rag/*` dividem o papel pelo mesmo
  critério do teto de paralelismo de área (RN-083)** (PROGRAMA 28, Onda 4 —
  RN-231..234, ADR 0080): `search` e `coverage` são `role:viewer` (leitura
  pura sobre o que já está indexado), e `reindex` é `role:maintainer` — ele
  dispara N chamadas ao repositório do projeto e ao provider de embedding, o
  mesmo "muda o que o produto gasta sem perguntar" que já justifica o papel
  mais alto em outras rotas de disparo caro.
- **As quatro rotas `/projects/:projectId/code/*` são `role:viewer` e SÓ
  LEITURA** (FASE 26b). Ver o código do projeto é a mesma permissão que ver o
  projeto — o mesmo corte de `GET /projects/:id/git/repository`. Três coisas
  fazem essa folga aparente ser decisão e não descuido:
  - **não há verbo de escrita no controller**, e não pode haver: a aba Code é de
    leitura, e escrita é efeito externo, que nasce `proposed_action` e é fase
    seguinte. Um `@Post` neste arquivo é mudança de fase, não de rota;
  - **o caminho é contido em UM lugar** ([RN-095](business-rules.md#rn-095)),
    pela mesma checagem central da [RN-092](business-rules.md#rn-092) — e a
    contenção importa aqui mais que o papel, porque nos providers remotos o
    caminho vira segmento de URL da API do provider e um `../` troca de
    **endpoint**, não de arquivo;
  - **a credencial gasta é a do owner do workspace**
    ([RN-058](business-rules.md#rn-058)/[RN-082](business-rules.md#rn-082)),
    como na escrita. Ler custa rate limit do provider, e é por isso que a busca
    tem orçamento: sem teto, um `viewer` pagaria a conta do owner à vontade.
- **`GET /workspaces/:workspaceId/spend-report` passou a devolver a quebra por
  provider, que é quebra por CREDENCIAL** ([ADR
  0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md),
  [RN-186](business-rules.md#rn-186)/[RN-187](business-rules.md#rn-187)). Nenhuma
  rota nova e nenhuma mudança de papel — continua `role:owner`, como já era —,
  mas o que ela CONCEDE mudou, e é por isso que a nota existe. O ADR
  [0063](adr/0063-duas-audiencias-para-o-mesmo-gasto.md) tinha recusado o eixo
  justamente por isso; o 0076 o revisa por decisão do dono do produto. O que
  segura a fronteira agora são DUAS barreiras independentes: `GET
  /projects/:projectId/spend/me` (`role:viewer`) não tem parâmetro de dimensão
  nenhum, e o TIPO recusa a combinação — escopo com `actor` só aceita
  `Exclude<SpendDimension, 'provider'>`, então pedir provider na visão do membro
  não compila. A segunda é mais fraca que a garantia anterior ("a dimensão não
  existia"), e é por isso que são duas.
- **`POST /projects/:projectId/sessions/:sessionId/socket-ticket` é
  `role:viewer` na tabela, mas isso é o PISO, não o teto** (RN-108). O
  `@RequireRole('viewer')` cobre `scope: "heartbeat"` — o socket de
  heartbeat/eventos ao vivo que já existe; `scope: "terminal"` exige
  `developer`, checado DENTRO do `CreateSocketTicketUseCase` contra
  `request.effectiveRole` (o mesmo que o `RolesGuard` já resolveu), porque o
  papel mínimo depende do CORPO da requisição, não só da rota — o mesmo padrão
  de `MIN_ROLE_FOR_ACTION_TYPE.terminal` em `domain/actions/decide.ts`. Hoje
  nenhum caminho pede `scope: "terminal"` de verdade (o socket de terminal
  interativo é FASE 25); o valor já nasce certo para quando existir.
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
- **`POST /projects/:projectId/execution/activate` ganhou `originSessionId`
  opcional no corpo, e a classificação não mudou** — continua `role:maintainer`
  (RN-135). O campo deixa quem já tem esse papel fechar a sessão de CHAT que
  originou o pedido, mas com duas contenções que impedem usá-lo pra fechar
  sessão alheia: `findInProject(projectId, originSessionId)` recusa silenciosamente
  um id que não pertença ao PRÓPRIO projeto do path, e o fechamento só acontece
  se `GetSessionPendingWorkUseCase` (a mesma trava do heartbeat de inatividade,
  [RN-073](business-rules.md#rn-073)) confirmar que não há handoff, ação ou
  turno pendurado ali. Nunca fecha a sessão de execução que a própria chamada
  acabou de ativar.
- **`GET /projects/:projectId/execution/session` é `role:viewer`, o mesmo
  papel de `GET /sessions/:sessionId`** ([RN-139](business-rules.md#rn-139)).
  Devolve a sessão de execução VIGENTE do projeto — `active` com
  `execution.activated` gravado — ou `null`; nunca a sessão mais recente do
  projeto, que é o que a aba Executores lia antes e que muda de sessão em
  silêncio assim que outra sessão nasce depois dela.
- **`POST .../llm-turn` e `POST .../llm-turn-stream` ganharam `modelName` no
  corpo de resposta/frame final, e a classificação não mudou** — continuam
  `engine-service` como sempre ([RN-146](business-rules.md#rn-146)). O nome
  do modelo já era resolvido para chamar o provider; só passou a viajar de
  volta ao engine, que o inclui no payload de `agent.response`. Nenhum dado
  novo é lido, nenhuma credencial nova é exposta — é o mesmo nome que já sai
  em `token_usage`.
- **`PUT /projects/:projectId/agent-autonomy` passou a aceitar `actionType:
  "*"` — "auto mode" ([RN-153](business-rules.md#rn-153)) —, e a
  classificação não mudou:** continua `role:maintainer`, o mesmo do `GET`
  ao lado. A diferença é o que o corpo agora AUTORIZA, não quem pode
  chamar: a curinga concede autonomia pra QUALQUER tipo de ação do agente
  de uma vez, em vez de um tipo por vez como antes. A resolução (uma regra
  ESPECÍFICA sempre vence a curinga) mora inteira no repositório
  (`DrizzleAgentAutonomyRepository.findMode`), nunca em `decide()` — que
  segue recebendo só o `PermissionPolicy` já resolvido, exatamente como
  antes da curinga existir. É por isso que os três tetos absolutos —
  merge em branch protegida, `instruction_patch`,
  `parallelize`/`raise_max_parallel` — continuam bloqueando mesmo com a
  curinga em `auto_approve` ([RN-154](business-rules.md#rn-154)): eles
  reagem a `current.policy === 'auto_approve'`, nunca à origem dela, e
  nenhuma exceção precisou entrar em `decide()` pra isso continuar
  valendo. `ApprovalCard.tsx` só oferece o botão que grava a curinga a
  quem o cliente já sabe ter `maintainer`/`owner` — mas quem garante o
  papel de verdade é este mesmo `@RequireRole('maintainer')`, inalterado.

## Tabela

<!-- INÍCIO DA TABELA — o teste parseia daqui até o fim do documento. -->

| método | caminho | classificação |
|---|---|---|
| GET | `/.well-known/jwks.json` | public |
| POST | `/auth/login` | public |
| POST | `/auth/logout` | public |
| GET | `/auth/oauth/:provider/callback` | public |
| GET | `/auth/oauth/:provider/start` | public |
| POST | `/auth/refresh` | public |
| POST | `/auth/register` | public |
| POST | `/auth/request-password-reset` | public |
| POST | `/auth/reset-password` | public |
| POST | `/auth/verify-email` | public |
| GET | `/gates` | jwt |
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
| GET | `/internal/sessions/:sessionId/pending-work` | engine-service |
| POST | `/internal/sessions/:sessionId/events` | engine-service |
| POST | `/internal/sessions/:sessionId/gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/handoffs` | engine-service |
| POST | `/internal/sessions/:sessionId/hypotheses` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-artifacts/:prActionId/files` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-context` | engine-service |
| POST | `/internal/sessions/:sessionId/infra-gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/instruction-patches` | engine-service |
| POST | `/internal/sessions/:sessionId/max-parallel-proposals` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn-stream` | engine-service |
| POST | `/internal/sessions/:sessionId/c4-diagram` | engine-service |
| POST | `/internal/sessions/:sessionId/module-map` | engine-service |
| POST | `/internal/sessions/:sessionId/project-image` | engine-service |
| POST | `/internal/sessions/:sessionId/proficiency` | engine-service |
| POST | `/internal/models/sync` | engine-service |
| GET | `/internal/gates` | engine-service |
| GET | `/internal/projects/:projectId/git-remote` | engine-service |
| GET | `/internal/projects/:projectId/business-rules` | engine-service |
| GET | `/internal/projects/:projectId/backlog` | engine-service |
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
| GET | `/users/me/credentials` | jwt |
| POST | `/users/me/credentials` | jwt |
| POST | `/users/me/credentials/:provider/test` | jwt |
| DELETE | `/users/me/credentials/:provider` | jwt |
| POST | `/users/me/git-credentials` | jwt |
| GET | `/workspaces` | jwt |
| POST | `/workspaces` | jwt |
| DELETE | `/projects/:projectId` | role:maintainer |
| GET | `/projects/:projectId` | role:viewer |
| PATCH | `/projects/:projectId` | role:maintainer |
| GET | `/projects/:projectId/models` | role:viewer |
| GET | `/projects/:projectId/agent-autonomy` | role:maintainer |
| PUT | `/projects/:projectId/agent-autonomy` | role:maintainer |
| DELETE | `/projects/:projectId/agent-bindings/:agentSlug` | role:developer |
| GET | `/projects/:projectId/agent-bindings/:agentSlug` | role:viewer |
| PUT | `/projects/:projectId/agent-bindings/:agentSlug` | role:developer |
| DELETE | `/projects/:projectId/area-bindings/:areaKey` | role:maintainer |
| GET | `/projects/:projectId/area-bindings/:areaKey` | role:viewer |
| PUT | `/projects/:projectId/area-bindings/:areaKey` | role:maintainer |
| GET | `/projects/:projectId/agent-costs` | role:developer |
| GET | `/projects/:projectId/agents/:agent/instruction-versions` | role:viewer |
| POST | `/projects/:projectId/agents/:agent/instruction-versions/:version/rollback` | role:maintainer |
| POST | `/projects/:projectId/anamnese/run` | role:maintainer |
| GET | `/projects/:projectId/architecture` | role:viewer |
| GET | `/projects/:projectId/backlog` | role:viewer |
| GET | `/projects/:projectId/budget` | role:maintainer |
| PUT | `/projects/:projectId/budget` | role:maintainer |
| GET | `/projects/:projectId/agent-areas` | role:developer |
| PATCH | `/projects/:projectId/agent-areas/:key/max-parallel` | role:maintainer |
| GET | `/projects/:projectId/code/blame` | role:viewer |
| GET | `/projects/:projectId/code/branches` | role:viewer |
| GET | `/projects/:projectId/code/file` | role:viewer |
| GET | `/projects/:projectId/code/pull-requests` | role:viewer |
| GET | `/projects/:projectId/code/pull-requests/:pullRequestId/diff` | role:viewer |
| GET | `/projects/:projectId/code/search` | role:viewer |
| GET | `/projects/:projectId/code/tree` | role:viewer |
| POST | `/projects/:projectId/rag/search` | role:viewer |
| POST | `/projects/:projectId/rag/reindex` | role:maintainer |
| GET | `/projects/:projectId/rag/coverage` | role:viewer |
| GET | `/projects/:projectId/container` | role:viewer |
| GET | `/projects/:projectId/container/lifecycle` | role:viewer |
| GET | `/projects/:projectId/coverage` | role:viewer |
| GET | `/projects/:projectId/events/:eventId` | role:viewer |
| POST | `/projects/:projectId/execution/activate` | role:maintainer |
| GET | `/projects/:projectId/execution/session` | role:viewer |
| GET | `/projects/:projectId/git/:provider/connect` | role:maintainer |
| POST | `/projects/:projectId/git/:provider/repository` | role:maintainer |
| POST | `/projects/:projectId/git/:provider/repository/adopt` | role:maintainer |
| GET | `/projects/:projectId/git/bootstrap` | role:viewer |
| GET | `/projects/:projectId/git/bootstrap/plan` | role:viewer |
| POST | `/projects/:projectId/git/bootstrap/plan/approve` | role:maintainer |
| POST | `/projects/:projectId/git/bootstrap/plan/skip` | role:maintainer |
| POST | `/projects/:projectId/git/bootstrap/acknowledge-protection-failure` | role:maintainer |
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
| PATCH | `/projects/:projectId/sessions/:sessionId` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve_always` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/deny` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/cancel` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/message` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/start` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/structured-question/:questionSetId/answer` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agentId/rearm` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/arquiteto/handoff-infra` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/criativo/validate-necessity` | role:developer |
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
| POST | `/projects/:projectId/sessions/:sessionId/socket-ticket` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/tasks/:taskId/unblock` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/token-usage` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/transition` | role:developer |
| GET | `/projects/:projectId/spend/me` | role:viewer |
| POST | `/projects/:projectId/stories/:storyId/return` | role:developer |
| POST | `/projects/:projectId/stories/promote` | role:developer |
| DELETE | `/workspaces/:workspaceId` | role:owner |
| GET | `/workspaces/:workspaceId` | role:viewer |
| PATCH | `/workspaces/:workspaceId` | role:maintainer |
| POST | `/workspaces/:workspaceId/members` | role:owner |
| GET | `/workspaces/:workspaceId/model-binding` | role:viewer |
| PUT | `/workspaces/:workspaceId/model-binding` | role:maintainer |
| GET | `/workspaces/:workspaceId/credential-spend` | role:owner |
| GET | `/workspaces/:workspaceId/spend-report` | role:owner |
| POST | `/workspaces/:workspaceId/models/activate` | role:owner |
| GET | `/workspaces/:workspaceId/models/catalog` | role:maintainer |
| POST | `/workspaces/:workspaceId/models/sync` | role:owner |
| POST | `/workspaces/:workspaceId/models/uses` | role:owner |
| GET | `/workspaces/:workspaceId/models/:modelId/price-changes` | role:maintainer |
| PATCH | `/workspaces/:workspaceId/models/:modelId/pricing` | role:owner |
| GET | `/workspaces/:workspaceId/projects` | role:viewer |
| POST | `/workspaces/:workspaceId/projects` | role:maintainer |
| GET | `/workspaces/:workspaceId/projects-status` | role:viewer |
| GET | `/workspaces/:workspaceId/projects-summary` | role:viewer |
| GET | `/workspaces/:workspaceId/summary` | role:viewer |
| POST | `/workspaces/:workspaceId/unread-events` | role:viewer |
