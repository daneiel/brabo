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

### Novidades

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

### Correções

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
