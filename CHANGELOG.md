# Changelog

Gerado dos conventional commits por `scripts/changelog.mjs`.

## Unreleased

### ⚠ Mudanças incompatíveis

- **auth**: o Keycloak saiu. A api passa a ser o **emissor** dos tokens de
  acesso, num corte **atômico** — não há período de coexistência, e um token
  do emissor antigo não é aceito em rota nenhuma. Todo mundo é deslogado no
  deploy. Decisões e o porquê do corte sem transição em
  [ADR 0032](docs/adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)
- **auth**: usuários existentes **não têm senha** — hash do Keycloak não migra.
  Rode `pnpm --filter api migrate:keycloak-users` no release para emitir os
  links de definição de senha. Enquanto o usuário não define uma, o login
  responde o **mesmo 401** de sempre, indistinguível de senha errada
  ([RN-032](docs/business-rules.md#rn-032)). Procedimento no
  [runbook](docs/runbook.md#migracao-dos-usuarios-do-keycloak)
- **api**: `POST /auth/login` deixa de devolver `refreshToken` no corpo. A
  resposta passa a ser `{ accessToken, expiresIn }` mais dois cookies —
  `brabo_refresh` (httpOnly) e `brabo_csrf`. `/auth/refresh` e `/auth/logout`
  passam a exigir o cabeçalho `X-CSRF-Token` igual ao segundo
  ([RN-034](docs/business-rules.md#rn-034)). Cliente que lia o refresh do corpo
  quebra
- **api,engine**: o tráfego interno `/internal/*` sai do JWT. Passa a exigir
  `X-Brabo-Service-Token` igual ao segredo compartilhado
  `BRABO_SERVICE_TOKEN`, obrigatório **nas duas cargas**
  ([RN-035](docs/business-rules.md#rn-035)). Token de usuário não abre mais
  essas rotas, e o service token não abre nenhuma outra
- **config**: saem todas as `KEYCLOAK_*`, `*_KEYCLOAK_CLIENT_*` e
  `VITE_KEYCLOAK_*`; entram `BRABO_SERVICE_TOKEN(_PREVIOUS)` e
  `AUTH_SET_PASSWORD_TTL_MS`. O serviço `keycloak` sai do compose de dev e de
  prod, e `deploy/k8s/base/keycloak/` deixa de existir junto com o
  `ExternalSecret` `keycloak-secrets`
- **api,engine**: a rota interna de delegação de área deixa de ser aninhada
  sob task — `POST /internal/sessions/:sessionId/tasks/:taskId/delegations`
  vira `POST /internal/sessions/:sessionId/delegations`, com `taskId` agora
  opcional no corpo em vez de obrigatório na URL. `delegations.task_id` no
  banco virou nullable. Motivo: a área de Infra (Fase 8c) delega sobre a
  sessão, sem task de backlog por trás de uma PR de infra — a rota nascida
  na Fase 8b (só QA) era estreita demais pra segunda área
  ([RN-037](docs/business-rules.md#rn-037))

### Novidades

- **api,engine,web**: o catálogo de modelos passa a ser **vivo**. Provider que
  declara `listModels` é sincronizado por um job periódico (6h, configurável por
  `MODEL_SYNC_INTERVAL_SECONDS`) e pelo botão "Atualizar catálogo" na tela de
  configurações. Modelo descoberto entra **desativado**, modelo que some do
  provider vira `unavailable` e **nunca é deletado**, e provider que falhou é
  PULADO com a origem da falha — nunca tratado como catálogo vazio
  ([RN-043](docs/business-rules.md#rn-043))
- **api**: `is_active` de modelo ganha dentes. Binding NOVO para modelo
  desativado ou indisponível responde **422**, e a cascata de resolução passa a
  pular o indisponível avisando qual escopo pulou, em vez de trocar o modelo em
  silêncio. Quando o turno carrega ferramentas, a cascata revalida
  `supports_tool_calling` em todo nível — sem isso o fallback pousaria um agente
  num modelo chat-only ([RN-040](docs/business-rules.md#rn-040))
- **api**: custo passa a ser **reproduzível**, não só imutável. `token_usage`
  grava o preço que produziu cada `cost_micros`, e toda mudança de preço deixa
  linha em `model_price_changes` com o par antes/depois e a origem
  (`manual` | `sync`). Preço novo continua não reprecificando o passado
  ([RN-044](docs/business-rules.md#rn-044)). Decisão em
  [ADR 0042](docs/adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
- **web**: o seletor de modelos foi reagrupado por **origem** (Local · APIs
  diretas · Hubs), ganhou selos de custo, janela e tool calling, e o filtro
  **"aptos para agentes"** que a mensagem de erro da RN-040 citava desde a Fase
  9a sem existir. O custo passa a mostrar entrada e saída separadas — a média
  escondia a assimetria. Modelo indisponível aparece esmaecido e marcado, nunca
  some. Nova seção de curadoria do catálogo, com ativação em lote e o relatório
  do sync por provider
- **api,k8s**: preparo da Fase 9b — o metering passa a registrar **quem serviu**
  a chamada, não só por onde ela entrou. `token_usage` ganha
  `upstream_provider` (texto, `null` quando não houve hub), as métricas
  `brabo_llm_tokens_total` e `brabo_llm_cost_micros_total` ganham o rótulo
  `upstream_provider`, e o dashboard executivo ganha um painel de custo por
  provedor subjacente ([RN-042](docs/business-rules.md#rn-042)). `models` ganha
  `manual_pricing`, que marca preço digitado da doc para o sync da Fase 9c não
  sobrescrever sem decisão explícita. **Nenhum provider novo entrou ainda** — a
  verificação na doc oficial dos seis depende de acesso de rede que a sessão
  não teve. **Pendente:** o aceite com credencial real do OpenRouter (catálogo
  de verdade e `upstream_provider` preenchido numa task) fica em aberto até os
  seis providers entrarem — registrado no
  [ADR 0042](docs/adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
- **api**: providers de LLM passam a ter **contrato único** e capabilities, como
  os de git desde a Fase 2. `LLMProvider` ganha `capabilities`
  (`streaming`/`toolCalling`) e `models` ganha `supports_tool_calling`,
  `supports_streaming` e `supports_vision`. Vincular a um **agente** um modelo
  sem tool calling nativo passa a responder **422** com a mensagem que aponta o
  filtro "aptos para agentes" ([RN-040](docs/business-rules.md#rn-040)); a
  migração `0026` faz o backfill dirigido dos modelos do seed, então bindings
  existentes continuam valendo. Decisão em
  [ADR 0041](docs/adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)
- **api**: o provider da **OpenAI passa a fazer tool calling** — antes ele
  descartava `options.tools` em silêncio, e um agente vinculado a um modelo da
  OpenAI terminava sem concluir. Ele agora deriva de uma base OpenAI-compatível
  sobre `node:http`, com teto de **inatividade** de socket configurável em
  `LLM_REQUEST_TIMEOUT_MS`. A dependência `openai` saiu do projeto
- **api**: o provider da **Anthropic passa a fazer tool calling**, com
  `role: 'tool'` virando bloco `tool_result` no turno certo em vez de ser
  achatado em texto de `user`
- **api**: falha de provider de LLM passa a ser **classificada**. O chunk de
  erro ganha `code` (`auth`, `rate_limit`, `model_not_found`, `context_length`,
  `timeout`, `connection`, `upstream`) em vez de repassar a string crua do
  vendor. Contagem de token que o provider não informou vem marcada como
  estimada ([RN-041](docs/business-rules.md#rn-041)) — o número serve para
  cobrar, mas não se confunde com um zero informado

- **api,web**: fidelidade do dashboard de projetos ao design aprovado
  (`design/SCREENS.md`, `design/COMPONENTS.md`):
  - linha de resumo `"{N} projetos ativos · {M} agentes · {gasto} este mês"`,
    alimentada por um endpoint novo (`GET /workspaces/:workspaceId/summary`)
    que soma tokens gastos e conta agentes distintos que trabalharam no mês
    corrente ([RN-038](docs/business-rules.md#rn-038));
  - cards do dashboard passam a mostrar o roster REAL do projeto (antes era
    a lista estática de todo agente, igual em todo card) em chips agrupados
    por área — QA com subespecialidades delegadas vira um chip único com a
    contagem (`"QA ×3"`), até 4 chips visíveis + excedente num badge;
  - `TokenMeter` `compact` ganha rodapé de gasto/saldo e um estado de "sem
    orçamento" (CTA "Definir orçamento" levando à aba de Configurações do
    projeto, via deep-link `?tab=settings`) — antes mostrava `0/0 · 0%`
    indistinguível de gasto zero real;
  - sidebar ganha dot de status por projeto (verde=saudável, âmbar=orçamento
    ≥70%, vermelho=orçamento ≥90% ou task bloqueada, cinza=sem atividade em
    7 dias — risco sempre vence inatividade,
    [RN-039](docs/business-rules.md#rn-039)) via um segundo endpoint novo
    (`GET /workspaces/:workspaceId/projects-status`), e rodapé com
    avatar/iniciais + e-mail + papel RBAC (sem o rótulo de proficiência da
    Anamnese, que o mock mistura ali)
  - moeda do card e do resumo passam a ser só USD — decisão registrada em
    [ADR 0040](docs/adr/0040-moeda-do-dashboard.md); `TokenMeter`
    `default`/`live` (header do projeto, chat) continuam R$+US$, sem mudança;
  - componente `Skeleton` novo (nenhum existia) durante o carregamento da
    grade e do resumo; o vazio de "workspace sem projeto nenhum" ganha um
    CTA "Criar projeto" e passa a se distinguir do vazio de "busca sem
    resultado" (antes os dois mostravam o mesmo texto)
- **web**: as quatro telas de auth (`/login`, `/registrar`, `/esqueci-senha`,
  `/definir-senha`) passam a seguir o design aprovado: cabeçalho de marca acima
  do card, rodapé de página com a versão do artefato, campo com botão de mostrar
  senha, botão com estado de carregamento e o aviso da conta migrada como alerta
  próprio fora do card
  ([ADR 0036](docs/adr/0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md))
- **web**: o erro de credencial passa a aparecer como alerta no topo do card, em
  vez de sob o campo de senha, e o texto muda para **"E-mail ou senha
  incorretos."**. A propriedade de anti-enumeração é a mesma: uma única mensagem
  para conta inexistente, senha errada, conta bloqueada e conta migrada
- **web**: `/status` **não exige mais sessão** — é para lá que o rodapé das telas
  de auth aponta, e atrás do guard o clique voltava para o login. A página só
  consulta os `/health`, que já eram públicos
- **web**: o rodapé das telas de auth mostra a **versão da imagem**. Fora de um
  release ela é `dev`, porque o build não nasceu de tag; o `release.yml` passa a
  assar a tag no artefato via `VERSION` do `docker-bake.hcl`
- **api**: `BRABO_VERSION` passa a ser **definida na imagem de release**, então o
  `service.version` dos spans deixa de ser `dev` em todo ambiente
- **web**: componente `Alert` no design system (4 tons, papel de acessibilidade
  escolhido e não derivado do tom), `loading` no `Button`, e `preenchido` /
  `revelavel` / `acaoNoLabel` no `Input`

- **api**: módulo de auth first-party — registro, login, logout, refresh,
  verificação de e-mail e reset de senha, em `/auth/*`. Senhas com argon2id;
  access token EdDSA de 15 min com chave derivada por scrypt e JWKS público em
  `/.well-known/jwks.json`; refresh opaco com rotação obrigatória, em que
  reapresentar um token já usado revoga a família inteira
  ([RN-030](docs/business-rules.md#rn-030))
- **api**: lockout progressivo por e-mail e por IP, em janela deslizante no
  Postgres, sem Redis ([RN-031](docs/business-rules.md#rn-031))
- **api**: respostas de login, registro e pedido de reset não distinguem conta
  existente de inexistente ([RN-032](docs/business-rules.md#rn-032))
- **api**: tokens de verificação e reset de uso único, com hash em repouso e
  expiração ([RN-033](docs/business-rules.md#rn-033))
- **web**: login próprio em `/login`, `/register`, `/forgot-password` e
  `/set-password`, seguindo o design system. O access token vive em memória e o
  refresh no cookie httpOnly, então a sessão sobrevive ao reload sem
  `localStorage`. O refresh é single-flight: sem isso, dois 401 simultâneos
  disparariam duas rotações e a segunda revogaria a família por reuso
- **api**: `BRABO_SERVICE_TOKEN_PREVIOUS` e `AUTH_JWT_SECRET_PREVIOUS` aceitos
  só na verificação, o que permite rotacionar os dois segredos sem downtime
  ([runbook](docs/runbook.md#rotacao-das-chaves-do-auth))

- **docs**: referência completa da API em `docs/reference/api/`, gerada do
  OpenAPI — 118 páginas, uma por rota, agrupadas por domínio, com corpo de
  request, corpo de response e códigos de erro. A visão geral sai do
  `info.description` do documento, então é gerada de fonte única
  ([ADR 0033](docs/adr/0033-referencia-de-api-gerada-do-openapi.md))
- **api**: Swagger UI em `/docs` e `/docs-json`, montada apenas quando
  `NODE_ENV !== 'production'`
- **api**: o teste de tabela de rotas passa a exigir os metadados de OpenAPI —
  rota nova sem summary, sem resposta com corpo descrito ou sem tag da lista
  fechada reprova. É o mecanismo anti-drift que o docmap não tem: ele dispara
  quando um arquivo muda, mas não enxerga rota nova que nasceu sem documentação
- **docs**: `pnpm docs:check` reprova quando o `openapi.json` ou os MDX gerados
  saem de dia — alterar um DTO sem regerar quebra o check

- **docs**: a documentação passa a ser publicada por **degrau**, no mesmo GitHub
  Pages: `main` em `/brabo/` (inalterado), `qa` em `/brabo/qa/` e `dev` em
  `/brabo/dev/`. Os dois degraus de baixo saem do índice dos buscadores, e a busca
  local continua funcionando nos três
  ([ADR 0034](docs/adr/0034-documentacao-publicada-por-degrau.md))
- **api,engine,web**: **trace correlacionado sem coletor.** Instrumentar e
  exportar passaram a ser decisões separadas: span é sempre criada e o `trace_id`
  sempre entra no log, e `OTEL_EXPORTER_OTLP_ENDPOINT` decide só se ela sai do
  processo. Na prática, `pnpm dev` passa a ter as três streams de log marcadas
  com o mesmo id — antes desenvolvimento era o único ambiente sem correlação
  nenhuma, justo onde se lê log com os olhos
  ([ADR 0035](docs/adr/0035-observabilidade-legivel-e-trace-sem-coletor.md))
- **api**: **o caminho entre camadas no log.** Uma linha por requisição mostra
  `interfaces → application → infrastructure` com a duração de cada passo, vinda
  de um `AsyncLocalStorage` alimentado pelo decorator `@Traced`. Em produção sai
  como o campo `path` numa linha de JSON; em desenvolvimento, como árvore
  indentada. Nenhum controller foi tocado — a fronteira HTTP vem do
  `ExecutionContext`
- **api,engine**: **log legível em desenvolvimento.** `pino-pretty` em processo na
  api (com a árvore de camadas) e `PrettyLogFormatter` novo no engine, onde
  `dev.exs` jogava fora timestamp e toda a metadata e deixava `trace_id`,
  `session_id` e `mfa` invisíveis. Produção segue com uma linha de JSON por
  evento, que é o que o Alloy parseia
- **engine**: log de acesso HTTP, que não existia — as 13 rotas `/internal` não
  deixavam linha nenhuma, então "a api chamou?" não tinha resposta no log
- **web**: `WEB_LOG_LEVEL` ligado no k8s. A encanação existia ponta a ponta e
  faltava a variável, então `logger.debug` era código morto em todo ambiente
  publicado
- **engine**: o gate de QA vira **área** — `QA Lead` passa a ser o único
  contato do gate (mesmo contrato `gates/verdict`/`tasks/:taskId/block` de
  sempre), e delega a duas subespecialidades: `QA de Automação` (o QAAgent de
  antes, sem mudança de prompt ou de matriz de cobertura) sempre, e `QA de
  Performance e Segurança` (RNFs de performance da story; apoio de segurança em
  nível de código — SecOps continua o gate determinístico próprio) só quando a
  story tem RNF pertinente. Story sem RNF de performance gera delegação
  **dispensada** com justificativa registrada, nunca silêncio. Falha de
  subespecialidade com origem infra/modelo bloqueia a task com a origem real em
  vez de virar `changes_requested` para o dev — a mesma lição do
  [ADR 0020](docs/adr/0020-gates-validados-por-execucao-real.md), agora um
  nível acima ([RN-036](docs/business-rules.md#rn-036),
  [ADR 0038](docs/adr/0038-hierarquia-de-agentes.md))
- **api**: rota interna nova `POST /internal/sessions/:sessionId/delegations`,
  que registra o desfecho de cada delegação de área
  (`completed`/`failed`/`dispensed`) separado da chamada que a área usa pra
  reportar o resultado consolidado pra fora — a api continua enxergando só
  esse resultado, nunca os delegados internos. `tasks.block` ganha um campo
  opcional `origin` (a mesma origem de falha — infra/modelo/código/política)
  persistido em `tasks.blocked_origin`
- **engine**: o Infra vira **área** (segunda instância do ADR 0038, depois
  da de QA) — `InfraLeadServer` continua o contato externo de sempre
  (handoff do Arquiteto inalterado) e passa a delegar o pipeline de CI pro
  subagente `Workflows`, que gera GitHub Actions ou GitLab CI conforme o
  provider do repositório do projeto (nunca por `capabilities` — GitHub e
  GitLab têm as mesmas). As duas delegações (Dockerfiles/compose pelo
  próprio Lead, CI pelo Workflows) sempre rodam e sempre são rastreadas, e
  se consolidam numa PR só, pelo mesmo `open_infra_pr` de sempre. Cada
  arquivo passa por validação local antes de propor — `actionlint` novo,
  pinado no Dockerfile do engine, só pra GitHub Actions (sem equivalente
  offline pro GitLab CI, gap documentado)
  ([RN-037](docs/business-rules.md#rn-037),
  [ADR 0039](docs/adr/0039-actionlint-e-validacao-do-pipeline-de-ci-gerado.md))
- **web**: a hierarquia de agentes (QA e Infra) fica visível — painel do
  time agrupado por área (card do lead com badge "Lead", subespecialidades
  aninhadas e recolhíveis, cada uma com binding de modelo e custo de tokens
  próprios); Insights (hipóteses do Psicólogo) agrupados por área quando o
  alvo é uma subespecialidade, com o alvo específico sempre visível no
  card; feed do projeto narrando `delegation.completed`/`failed`/
  `dispensed` com o mesmo tratamento dos demais eventos. Tudo derivado do
  `session_events` que a UI já buscava — nenhuma rota nova
  ([ADR 0038](docs/adr/0038-hierarquia-de-agentes.md#fechamento-fase-8d))
- **engine**: a tool do Psicólogo (`emit_hypotheses`) e a da Anamnese
  (`propose_instruction_patch`) passam a citar subagentes de área como
  exemplo de alvo válido (`qa-automacao`, `qa-performance-seguranca`,
  `infra-workflows`) — nenhuma validação nova, já aceitavam qualquer string;
  só o modelo não tinha o nudge pra considerar a subespecialidade

### Correções

- **infra**: mudar `WEB_PORT` deixa de quebrar o CORS em silêncio. A porta faz
  parte do contrato de CORS desde o [ADR 0037](docs/adr/0037-cors-do-engine-e-a-porta-como-contrato.md),
  mas nos composes `WEB_PORT` e `WEB_ORIGIN` tinham defaults **independentes**:
  quem trocasse a porta (o que o próprio guia de primeiros passos manda fazer
  quando a 5173 está ocupada) abria o browser numa origem que a api e o engine
  não aceitavam, e a mensagem no console falava de CORS, não de porta. O default
  de `WEB_ORIGIN` passa a **derivar** de `WEB_PORT` nos dois composes, e um check
  do CI impede que alguém volte a separá-los. Definir `WEB_ORIGIN` à mão continua
  sobrepondo a derivação
- **deps**: `brace-expansion` sobe para `1.1.18` (era `1.1.16`), fechando o
  alerta HIGH de DoS por expansão sem limite. Vinha transitivamente do
  `minimatch@3.1.5`, cujo range já aceitava a versão corrigida — só o lockfile
  mudou
- **api**: a imagem de produção da api voltou a **subir**. A Fase 9a exportou
  `LLM_PROVIDER_NAMES` (uma `const`) de `packages/shared`, e esse era o
  primeiro valor em runtime de um pacote que o `Dockerfile.prod` documenta
  como "100% tipos": todo import anterior era `import type` e sumia na
  compilação. Com um valor de verdade, o compilado passou a fazer `require`
  do pacote, cujo `main` aponta pro `.ts` cru — o Node recusa type stripping
  dentro de `node_modules` e o container morria no boot com
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. A lista mudou para
  `apps/api/src/domain/llm/llm-provider-names.ts`, amarrada ao tipo do shared
  por exaustividade nos dois sentidos, e o invariante — que até aqui só vivia
  num comentário de Dockerfile — passou a ter teste
  (`test/packages-shared-so-tipos.spec.ts`)
- **web**: `design-contraste.test.ts` (citado em comentários de
  `Input.module.css`/`AuthLayout.module.css` desde a Fase 7, mas nunca
  criado) recriado — e achou 2 pares novos que reprovavam o AA: o papel
  RBAC do rodapé da sidebar e o rodapé de gasto/saldo do `TokenMeter`
  `compact` usavam `--text-muted` sobre `--surface-1` (3.89:1, mesmo motivo
  já documentado no `.hint` do Input), e o avatar da sidebar era um
  gradiente `--accent`→`--warning` que derrubava o contraste das iniciais
  pra 2.10:1. Os três corrigidos antes de qualquer um chegar a produção
- **web**: a linha de resumo do dashboard dizia **"1 projetos ativos"** — não
  havia pluralização nenhuma, só interpolação crua do número
  (`lib/pluralize.ts` agora resolve isso, e a linha de resumo inteira, para
  os dois substantivos)
- **web**: `classifyEvent` (última atividade do card/feed) vazava o TIPO CRU
  do evento pro humano (`"infra · foo.bar_novo"`) sempre que não havia
  tradução específica — em 6 pontos diferentes da função, não só no fallback
  final. Agora cai em `"atividade em {agente}"`, nunca no identificador
  interno; um teste novo (`activity-catalog.test.ts`) lê o catálogo GERADO de
  eventos e quebra se um tipo cadastrado ficar sem tradução
- **web**: a timeline de PR vazava o parecer INTERNO de cada subespecialidade
  de QA como um card duplicado, idêntico ao consolidado — `verdictsFor`/
  `infraVerdictsFor` (`ProjectApprovalsTab.tsx`) filtravam só por tipo de
  evento e `taskId`, nunca por `actor.id`, e o parecer interno de
  `qa-automacao`/`qa-performance-seguranca` carrega o MESMO `taskId` do
  parecer final. Numa story com RNF de performance a timeline mostrava 2-3
  cards "QA" indistinguíveis. Agora o card principal é só o consolidado
  (`actor.id === 'qa'`); os internos ficam dentro do expand
- **web**: o filtro "por agente" do feed de atividade nunca funcionou —
  `agentOptions` existia como prop de `ActivityFeed` desde sempre, mas
  nenhum dos dois lugares que renderizam o feed (`ProjectOverviewTab.tsx`,
  `SessionPage.tsx`) chegava a passá-la
- **docs**: `docs/reference/artifacts.md` ainda dizia "os seis schemas de
  artefato" e não listava `infra_delegation_files` (o sétimo, Fase 8c) —
  drift de documentação gerada que o `docmap` marca como `block` e ninguém
  tinha fechado
- **engine**: o endpoint **não tinha CORS nenhum**. `GET /health` respondia 200 com
  o corpo correto e sem um único cabeçalho `Access-Control-*`, então o navegador
  descartava a resposta — a tela de status mostrava `engine: error` com o engine
  saudável. Agora há CORS nas rotas de health (`/health`, `/live`, `/ready`), com
  as origens de `WEB_ORIGIN`; **`/internal/*` e `/metrics` seguem sem**, e há teste
  afirmando a ausência
  ([ADR 0037](docs/adr/0037-cors-do-engine-e-a-porta-como-contrato.md))
- **web**: `vite.config.ts` ganha `strictPort`. Sem ele, com 5173 ocupada o Vite
  subia em **5174** avisando numa linha de log, e como a api aceita só a origem
  exata, **toda** chamada era barrada — inclusive o `/auth/refresh`, o que faz a
  tela parecer deslogada. O erro falava de CORS e não de porta, e a "correção"
  natural (afrouxar o CORS) conserta 5174 e quebra 5173. Agora o Vite recusa subir
  e diz que a porta está em uso
- **engine**: `WEB_ORIGIN` era lida em dois lugares — o `check_origin` do socket
  tinha a lista certa desde a Fase 4a, e o CORS HTTP não existia. Passa a ser
  resolvida uma vez em `runtime.exs` e compartilhada pelos dois consumidores
- **api,engine**: o CORS dos dois ganha `Access-Control-Max-Age: 600`. Toda chamada
  da web é preflighted (`Authorization` e `traceparent` não são safelisted), então
  sem cache de preflight cada requisição eram duas viagens

- **web**: as **três fontes do design system não carregavam em produção**.
  `index.html` as puxava do Google Fonts, e a CSP da imagem do nginx
  (`style-src 'self'; font-src 'self' data:`) bloqueava a folha e os arquivos —
  as três caíam em fonte de sistema, e como `--font-heading` e `--font-body`
  compartilham o fallback `sans-serif`, a distinção entre título e corpo
  desaparecia. Agora são auto-hospedadas em `public/fonts/`, com aviso de licença
  OFL, teste de integridade e gate no `Dockerfile.prod`
- **web**: `fullWidth` do `Button` **nunca funcionou** — era `flex: 1`, que só faz
  efeito se o pai for flex ou grid, e nenhum dos sete usos tinha pai assim
- **web**: foco de campo era `:focus` com indicação só por `box-shadow`, que é
  descartado em `forced-colors` — o campo focado ficava sem indicador nenhum no
  modo de alto contraste do sistema. Virou `:focus-visible` com `outline`
  transparente que o modo pinta
- **web**: três pares de cor reprovavam o 4.5:1 do WCAG AA — o texto de apoio do
  campo (3.89:1, e valia para as cinco telas fora de auth), o link das telas de
  auth (3.88:1) e o placeholder do campo preenchido (3.10:1). Os três passaram a
  usar tokens que já existiam. O botão primário segue em 3.20:1: consertar exige
  escurecer a cor da marca, e é decisão de design
- **docs**: `configuration.md` afirmava que a imagem de release injetava
  `BRABO_VERSION` e que ela aparecia no `/health`. As duas eram falsas — a
  primeira virou verdade nesta entrega, a segunda foi corrigida no texto (o
  `/health` não devolve versão de propósito)

- **api**: `PUT /projects/:id/agent-autonomy` e
  `DELETE /projects/:id/members/:userId` devolviam **200 com corpo vazio**, e o
  cliente da web caía em `res.json()` lançando `SyntaxError`. Os dois passam a
  responder **204**
- **api**: `POST /auth/register` e `POST /auth/request-password-reset`
  documentavam 200 enquanto devolvem 202 — o `@nestjs/swagger` ignora
  `@HttpCode` quando há qualquer `@ApiResponse`
- **api**: o `@ApiBearerAuth` de classe no controller de git vazava para o
  callback de OAuth, que é público
- **docs**: as **117 páginas de operação** da referência de API não
  renderizavam no site publicado — todas mostravam "Esta página deu erro." em
  vez do explorador. Faltava `docItemComponent: '@theme/ApiItem'` no config do
  Docusaurus, então o wrapper que monta o store do redux nunca era montado e
  cada página morria na hidratação. Estava assim desde que a referência nasceu:
  saiu quebrada na `v1.0.0` e na `v1.0.1`. Junto entra
  `scripts/docs/api-render-check.mjs`, que reprova o CI se a referência
  construir sem renderizar — o build ficava verde durante todo o defeito, e era
  essa lacuna que deixava passar
- **engine**: a correlação do trabalho assíncrono estava **morta**.
  `Engine.Outbox.Event` não declarava a coluna `metadata`, então o struct não
  tinha a chave, a cláusula que lê o `traceparent` era inalcançável, e **todo**
  job do Oban nascia com `traceparent: nil`. Os dois workers também não liam o
  argumento: agora abrem a span na trace da sessão e chamam
  `Logger.metadata(session_id:)` — que não era chamado em lugar nenhum do engine,
  e é por isso que o campo `session_id` do log sempre saiu ausente
- **engine**: `traceparent` era injetado só nos POSTs para a api. Os seis
  `Req.get` e o `llm_turn_stream` iam sem trace, então toda a metade de leitura
  da conversa entre os serviços — incluindo o turno de LLM em streaming —
  aparecia no Tempo como trace órfã. Agora há um funil único de headers
- **engine**: o gate de telemetria estava invertido. Não havia config
  `:opentelemetry` no projeto, então o SDK subia com o default apontando para
  `localhost:4318` e o engine pagava por um batch condenado em dev **e em
  `mix test`**; e o que o gate desligava era justamente a extração do
  `traceparent` que chega
- **web**: o chat não propagava trace. `chat-stream.ts` contorna o
  `api-client.ts` e era o único caminho da web sem `traceparent` — o pior lugar
  possível para a lacuna, porque é o turno de LLM
- **web**: a retentativa depois do 401 reusava o mesmo `traceparent`, então as
  duas tentativas chegavam à api declarando o mesmo `span_id` como pai e o Tempo
  as colapsava num nó só
- **web**: três silêncios em caminho crítico. `renovarSessao` falhava sem log (é
  o caminho pelo qual o usuário é deslogado), falha de rede no `request<T>` subia
  sem `trace_id` nem rota, e o socket da sessão nunca registrou `onError`/`onClose`
- **api**: o `X-Brabo-Service-Token` não era redigido no log — se caísse num corpo
  de erro logado, ia para o Loki em texto claro. Entraram junto `serviceToken`,
  `privateKey`, `encryptedDek` e `dek`
- **engine**: a recusa de token de serviço respondia 401 sem deixar linha, então
  deploy mal configurado e varredura contra `/internal` eram igualmente invisíveis
- **docs**: duas frases afirmavam o contrário do comportamento — a causa 1 de
  "quando não há trace" no runbook (já falsa para o engine antes desta mudança) e
  a nota de `OTEL_EXPORTER_OTLP_ENDPOINT` na referência de configuração

### Manutenção

- **api**: `pnpm --filter api typecheck` entra no CI. O vitest transpila por
  SWC e não verifica tipo nenhum, e os DTOs de resposta provam POR TIPO que
  espelham a entidade de domínio
- **api**: `users.keycloak_sub` passa a aceitar `NULL` (conta criada pelo auth
  first-party não tem sub) e `users.email` ganha índice único em `lower(email)`.
  A coluna **fica**: é a única evidência de procedência das contas migradas, e
  apagá-la no mesmo release destruiria o que o script de migração usa
- **api**: superfície pública passa de 4 para 12 rotas, cada uma justificada em
  [`docs/security-surface.md`](docs/security-surface.md)
- **api**: `JwtAuthGuard` deixa de fazer upsert de usuário por requisição —
  agora é uma leitura por `id`, com 401 quando não existe. Somem
  `SyncUserUseCase`, `upsertFromKeycloak` e `KeycloakTokenVerifier`
- **api**: o RBAC da Fase 1 fica **intocado** — nenhuma decisão de autorização
  lia claim de token. A matriz `(papel efetivo × papel exigido)` ganhou spec
  próprio de `RolesGuard` para provar isso
- **engine**: `Engine.Auth.ApiTokenVerifier` e `JwksStrategy` removidos, e com
  eles as dependências `joken`, `joken_jwks`, `jose` e `tesla`.
  `EngineWeb.Plugs.VerifyApiToken` vira `VerifyServiceToken`, preservando o
  contrato de 401 + JSON + `halt()`
- **web**: `keycloak-js` sai das dependências junto com `src/lib/keycloak.ts` e
  os três campos `VITE_KEYCLOAK_*` de `runtime-config.ts`
- **deploy**: o seed passa a criar `owner@brabo.dev` já verificado com a senha
  de `BRABO_SEED_PASSWORD` — sem IdP externo não haveria credencial pronta para
  o smoke nem para entrar na web local

## v0.1.0 — 2026-07-27

### Novidades

- **k8s,api,docs**: backup testado, hardening da api e release (Fase 5, item 6 e 7) (7794b29)
- **design-sync**: importa os 57 componentes do apps/web para o Claude Design (f340416)
- **api,engine,web**: OpenTelemetry, logs JSON correlacionados e dashboards (Fase 5) (3f6781b)
- **api,engine**: métricas Prometheus de custo, sessões, ações e latência (Fase 5) (e76c74b)
- **k8s**: stack de observabilidade local — Tempo, Loki, Alloy, Collector e Grafana (Fase 5) (9efd832)
- **engine,api,k8s**: graceful shutdown com handoff de sessão e propriedade única no cluster (Fase 5) (8b4614a)
- **k8s**: deploy Kubernetes com Kustomize, HPA por fila do Oban e overlay local (Fase 5) (ec47864)
- **docker,ci**: imagens de produção non-root, compose.prod, CI e smoke test (Fase 5) (6ffac72)
- **api,docs**: critério de aceite executável da Anamnese e ADR 0023 (0bf764c)
- **api,engine,web**: rodada da Anamnese sob demanda e os testes que faltavam (Fase 4b) (5a84add)
- **engine,api**: NoopDevAgent como modo de execução permanente (Fase 4a) (f93e2ef)
- **api,engine,web**: Anamnese — perfil de proficiência e patches de instrução (Fase 4b, sessão 2) (0e23bed)
- **api,engine,web**: Psicólogo real substitui o stub (Fase 4b, sessão 1) (9fa8b68)
- **api,engine,web**: InfraAgent e painel do time ao vivo (fechamento Fase 4a) (fb2513c)
- **api,engine,web**: gates de QA e SecOps pra PR de dev agent (Fase 4a) (c7a8937)
- **api,engine,web**: DevAgent real via ToolLoop, substitui o NoopDevAgent (Fase 4a) (82918aa)
- **api,engine,web**: infraestrutura dos dev agents com NoopDevAgent (Fase 4a) (f1247ca)
- **api,engine,web**: Agente Arquiteto — ADRs via PR real, module_map, validação cruzada (Fase 3b) (3b9a82b)
- **api,engine,web**: Agente PO + backlog + rastreabilidade (Fase 3b) (72b6c01)
- **api,engine,web**: Agente Criativo conversacional + handoffs (Fase 3b) (c97b2c4)
- **engine,api**: ToolLoop, ferramentas, ContextManager e EchoAgent (Fase 3a) (77c05cc)
- **engine,api**: harness de agentes — montagem determinística de contexto (Fase 3a) (f9a6e4e)
- **web,api**: wizard de novo projeto ligado ao fluxo real + tela de progresso do bootstrap (c2a5b05)
- **api,shared**: bootstrap de Gitflow idempotente e retomável (ProvisionRepositoryUseCase) (5d31d4f)
- **api,shared**: credenciais de git, GithubProvider/GitlabProvider completos e suite de contrato mockada (d858982)
- **api,shared**: fundação do contrato normalizado GitProvider (Fase 2) (935f55b)
- **web,api**: implementa apps/web completo e endpoints de suporte (fb630ab)
- **api,engine**: endurece o pipeline de acoes propostas com decide(), permissions.json fisico, agent_autonomy e executor de terminal (d581c88)
- **engine**: endurece o motor de sessoes com persistencia, heartbeat, outbox via Oban e PsychologistStub (74b0c46)
- **api**: abstracao GitProvider + LocalGitProvider/GithubProvider/GitlabProvider e provisionamento de repositorio (02302af)
- **engine**: motor de sessoes em Elixir/OTP com supervisao e evento de termino (e258558)
- **api**: adiciona pipeline de acoes propostas e permissions.json por projeto (5e86ee7)
- **api**: camada de LLM — providers, binding em cascata, metering e budget (b3972b7)
- **api**: núcleo de domínio — auth, IAM, sessões, event log e outbox (968c150)
- **design**: extrai tokens do design system para design/tokens.css (f797899)

### Correções

- **docker**: troca mc por aws-cli na imagem de backup — 48 CVEs para 0 (533862b)
- **ci**: pina o trivy na versão que a action realmente instala (f7875a1)
- **ci**: mix deps.get antes do format e tag válida do trivy-action (e45cf6a)
- **web**: dropdown de modelo era recortado pela tabela nas últimas linhas (a3fe71c)
- **engine**: janela da Anamnese truncava pra segundo e pulava a rodada calada (4a2bb45)
- **api,web**: perfil de proficiência identifica a pessoa por e-mail (7f11f89)
- **api,web**: três defeitos que só a passada visual pegaria (Fase 4b) (58220b6)
- **api,engine,web**: destrava a Anamnese num projeto real (Fase 4b, sessão 2) (3deaef5)
- **api,docker**: ajusta o demo do Psicólogo ao que a stack local aguenta (Fase 4b) (da25bb3)
- **api,engine,web**: fecha os desvios do Psicólogo e roda o critério de aceite (Fase 4b, sessão 1) (3571634)
- **engine,api,web**: gate de infra que valida e painel que diz a verdade (Fase 4a) (df2573a)
- **engine,api**: destrava os gates de QA e SecOps e roda o critério de aceite (Fase 4a) (5d721bd)
- **engine,api,web**: destrava o DevAgent real e fecha os desvios do enunciado (Fase 4a) (15dc967)
- **engine,api**: corrida do workspace, monitor de dev agents e tetos (Fase 4a) (391f992)

### Documentação

- **adr**: promove a divergência de proteção de branch GitHub×GitLab a ADR (486f402)
- **adr**: registra a verificação executada do fechamento da 4b (5ca75ea)

### Testes

- **ci**: planta CVE crítica para provar o gate de auditoria (77f6b03)

### Revertidos

- **ci**: remove a CVE plantada e corrige a formatação do prettier (64f5ccf)

### Manutenção

- scaffold do monorepo (api, engine, web, packages/shared, docker) (0827e80)

## v0.1.0 — 2026-07-27

### Novidades

- **design-sync**: importa os 57 componentes do apps/web para o Claude Design (f340416)
- **api,engine,web**: OpenTelemetry, logs JSON correlacionados e dashboards (Fase 5) (3f6781b)
- **api,engine**: métricas Prometheus de custo, sessões, ações e latência (Fase 5) (e76c74b)
- **k8s**: stack de observabilidade local — Tempo, Loki, Alloy, Collector e Grafana (Fase 5) (9efd832)
- **engine,api,k8s**: graceful shutdown com handoff de sessão e propriedade única no cluster (Fase 5) (8b4614a)
- **k8s**: deploy Kubernetes com Kustomize, HPA por fila do Oban e overlay local (Fase 5) (ec47864)
- **docker,ci**: imagens de produção non-root, compose.prod, CI e smoke test (Fase 5) (6ffac72)
- **api,docs**: critério de aceite executável da Anamnese e ADR 0023 (0bf764c)
- **api,engine,web**: rodada da Anamnese sob demanda e os testes que faltavam (Fase 4b) (5a84add)
- **engine,api**: NoopDevAgent como modo de execução permanente (Fase 4a) (f93e2ef)
- **api,engine,web**: Anamnese — perfil de proficiência e patches de instrução (Fase 4b, sessão 2) (0e23bed)
- **api,engine,web**: Psicólogo real substitui o stub (Fase 4b, sessão 1) (9fa8b68)
- **api,engine,web**: InfraAgent e painel do time ao vivo (fechamento Fase 4a) (fb2513c)
- **api,engine,web**: gates de QA e SecOps pra PR de dev agent (Fase 4a) (c7a8937)
- **api,engine,web**: DevAgent real via ToolLoop, substitui o NoopDevAgent (Fase 4a) (82918aa)
- **api,engine,web**: infraestrutura dos dev agents com NoopDevAgent (Fase 4a) (f1247ca)
- **api,engine,web**: Agente Arquiteto — ADRs via PR real, module_map, validação cruzada (Fase 3b) (3b9a82b)
- **api,engine,web**: Agente PO + backlog + rastreabilidade (Fase 3b) (72b6c01)
- **api,engine,web**: Agente Criativo conversacional + handoffs (Fase 3b) (c97b2c4)
- **engine,api**: ToolLoop, ferramentas, ContextManager e EchoAgent (Fase 3a) (77c05cc)
- **engine,api**: harness de agentes — montagem determinística de contexto (Fase 3a) (f9a6e4e)
- **web,api**: wizard de novo projeto ligado ao fluxo real + tela de progresso do bootstrap (c2a5b05)
- **api,shared**: bootstrap de Gitflow idempotente e retomável (ProvisionRepositoryUseCase) (5d31d4f)
- **api,shared**: credenciais de git, GithubProvider/GitlabProvider completos e suite de contrato mockada (d858982)
- **api,shared**: fundação do contrato normalizado GitProvider (Fase 2) (935f55b)
- **web,api**: implementa apps/web completo e endpoints de suporte (fb630ab)
- **api,engine**: endurece o pipeline de acoes propostas com decide(), permissions.json fisico, agent_autonomy e executor de terminal (d581c88)
- **engine**: endurece o motor de sessoes com persistencia, heartbeat, outbox via Oban e PsychologistStub (74b0c46)
- **api**: abstracao GitProvider + LocalGitProvider/GithubProvider/GitlabProvider e provisionamento de repositorio (02302af)
- **engine**: motor de sessoes em Elixir/OTP com supervisao e evento de termino (e258558)
- **api**: adiciona pipeline de acoes propostas e permissions.json por projeto (5e86ee7)
- **api**: camada de LLM — providers, binding em cascata, metering e budget (b3972b7)
- **api**: núcleo de domínio — auth, IAM, sessões, event log e outbox (968c150)
- **design**: extrai tokens do design system para design/tokens.css (f797899)

### Correções

- **ci**: pina o trivy na versão que a action realmente instala (f7875a1)
- **ci**: mix deps.get antes do format e tag válida do trivy-action (e45cf6a)
- **web**: dropdown de modelo era recortado pela tabela nas últimas linhas (a3fe71c)
- **engine**: janela da Anamnese truncava pra segundo e pulava a rodada calada (4a2bb45)
- **api,web**: perfil de proficiência identifica a pessoa por e-mail (7f11f89)
- **api,web**: três defeitos que só a passada visual pegaria (Fase 4b) (58220b6)
- **api,engine,web**: destrava a Anamnese num projeto real (Fase 4b, sessão 2) (3deaef5)
- **api,docker**: ajusta o demo do Psicólogo ao que a stack local aguenta (Fase 4b) (da25bb3)
- **api,engine,web**: fecha os desvios do Psicólogo e roda o critério de aceite (Fase 4b, sessão 1) (3571634)
- **engine,api,web**: gate de infra que valida e painel que diz a verdade (Fase 4a) (df2573a)
- **engine,api**: destrava os gates de QA e SecOps e roda o critério de aceite (Fase 4a) (5d721bd)
- **engine,api,web**: destrava o DevAgent real e fecha os desvios do enunciado (Fase 4a) (15dc967)
- **engine,api**: corrida do workspace, monitor de dev agents e tetos (Fase 4a) (391f992)

### Documentação

- **adr**: registra a verificação executada do fechamento da 4b (5ca75ea)

### Manutenção

- scaffold do monorepo (api, engine, web, packages/shared, docker) (0827e80)
