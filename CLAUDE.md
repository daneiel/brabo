# Brabo — Plataforma de engenharia orquestrada por agentes

## O que é
Sistema que gerencia o ciclo completo de uma aplicação: provisionamento de
repositório, Gitflow, agentes de IA especializados (Criativo, PO, Arquiteto,
Devs, Infra, QA, SecOps, Psicólogo, Anamnese), controle de custos de token
e pipeline de aprovação de ações com autoridade final do usuário.

## Status
- FASE 1 (MVP) — CONCLUÍDA: IAM/RBAC, sessões com event log imutável,
  chat com roteador de LLM (Ollama + APIs), metering/budget de tokens,
  pipeline de proposed_actions + permissions.json, motor Elixir/OTP com
  supervisão e evento de término.
- FASE 2 — CONCLUÍDA: GitProvider (Local/GitHub/GitLab) com suite de
  contrato e capabilities, credenciais criptografadas, bootstrap de
  Gitflow idempotente e retomável via pipeline, wizard com progresso
  ao vivo.
- FASE 3 — CONCLUÍDA: Harness (PromptAssembler, ToolLoop,
  ContextManager, InstructionFiles, Hooks), handoffs explícitos,
  agentes Criativo, PO e Arquiteto com artefatos e validações no
  domínio.
- FASE 4 — CONCLUÍDA: agentes de execução (devs dinâmicos por módulo
  em worktrees isolados, QA e SecOps como gates de PR, Infra
  propositivo), trava de merge protegido, painel do time ao vivo;
  Psicólogo real e Anamnese com loop fechado. Gates validados por
  execução real (ADR 0020).
- FASE 5 — CONCLUÍDA: imagens de produção non-root e CI (ADR 0024),
  Kubernetes com Kustomize, HPA por fila do Oban, NetworkPolicies e
  ESO (ADR 0025), graceful shutdown + OpenTelemetry + dashboards
  (ADR 0026), backup com restore testado, runbooks e hardening
  (ADR 0027).
- FASE DOC — CONCLUÍDA: docs/ como fonte única com Diátaxis, site
  Docusaurus em website/ lendo de docs/, referências geradas,
  docs/.docmap.yml + drift check (docs:check) no CI, camada de
  comunidade, MIT verificado, mecanismo documentado em
  docs/explanation/documentation-workflow.md.
- FASE 6 — CONCLUÍDA: política de branches mecanizada (ADR 0030) —
  pr-police, approval-ladder com os dois modos, promote/tag-release
  com versão calculada e âncora por árvore, backmerge gate com
  retropropagação automática, rulesets versionados. Esteira exercitada
  de ponta a ponta (v0.1.0 → v0.2.0) e a cadeia de hotfix validada por
  execução real.
- FASE 7 — CONCLUÍDA: auth first-party substituindo o Keycloak —
  argon2id, access Ed25519, rotação de refresh com revogação de
  família, lockout progressivo, tokens de conta e MailSender log-only
  (ADR 0031, RN-030..033); corte atômico com emissor próprio, RBAC
  intocado, /internal/* com service token, cookie httpOnly + CSRF,
  migração de usuários e remoção total do Keycloak (ADR 0032,
  RN-034/035); OpenAPI nos 23 controllers com DTOs travados por tipo,
  teste de tabela exigindo metadados, docs/reference/api/ gerado com
  manifesto de hashes (ADR 0033).
- FASE 8 — CONCLUÍDA COM CORTE: hierarquia de agentes — áreas com lead
  único como contato externo, delegações internas privadas (tabela
  `delegations`, `area` como TEXT), veredito consolidado com
  rastreabilidade, falha com origem; QA como área (Lead + Automação +
  Performance/Segurança, contrato externo dos gates inalterado — suite
  da Fase 4 verde sem modificação); Infra como área com subagente
  Workflows gerando CI por provider; painel do time por área e
  Psicólogo/Anamnese mirando subagentes (ADR 0038).
  CORTE DE ESCOPO, não implementado: `agent_areas`/`agent_area_members`
  (o aparato genérico do ADR 0038) — área, lead e membros são
  HARDCODED em apps/web/src/lib/agents.ts e no engine, não há rota
  para ativar área num projeto, e não existe budget por área. Está
  dito no schema (apps/api/src/db/schema.ts:781-786). Tetos de
  orçamento reais: projeto, sessão e task.
- FASE 9 — CONCLUÍDA: suite de contrato de LLMProvider rodando
  contra os existentes, base OpenAICompatibleProvider sobre
  node:http com timeout de INATIVIDADE, erro normalizado por `code`,
  capabilities em duas camadas (ADR 0041); sync de catálogo com modelo
  descoberto entrando desativado, modelo sumido marcado em vez de
  apagado, preço congelado em `token_usage` com auditoria append-only
  (ADR 0042); ModelPicker reagrupado por origem com curadoria.
  Os seis providers da 9b entraram pela Fase 11 (ADR 0043).
- FASE 10 — CONCLUÍDA: Bitbucket + GenericGitProvider entregues VIA
  dogfooding (primeira execução real do Brabo construindo o próprio
  Brabo, em fork com seed manual, tandas com restart entre tasks,
  Criativo obrigatório na cadeia). Colheita escrita na Fase 12d, em
  docs/explanation/primeiro-dogfooding.md — os 17 achados com
  arquivo:linha são reais; a metade QUANTITATIVA (restarts,
  intervenções, custo) ficou como `não medido`, porque a tabela de
  observação nunca foi preenchida. Os três P1 de operabilidade foram
  fechados pela Fase 12. Os outros 14 seguem abertos e listados na
  colheita — não corrija de passagem.
- FASE 11 — CONCLUÍDA: os seis providers da Fase 9b como config sobre
  a base, cada um investigado do zero contra a doc oficial (proibido
  herdar quirk); LLM_PROVIDER_NAMES de 3 para 9; DTO de credencial e
  testador de conexão derivando de lista única; capability só
  declarada quando provada, com duas reversões ao vivo (DeepInfra e
  Vultr); único hook novo na base (`parseErrorFrame`, +31 linhas)
  provado necessário pelo OpenRouter (ADR 0043).
  Pendência dos smokes com credencial real: absorvida pela FASE 13.
- FASE 12 — CONCLUÍDA: operabilidade pós-dogfooding, os três achados
  P1 fechados e provados numa execução única (ADR 0047).
  12a — adoção de repositório existente: rota própria, `getRepo`
  validando acesso antes de gravar, `origin` (created|adopted) nas duas
  tabelas, e o PLANO como portão — dry-run que descreve a divergência e
  não altera nada enquanto a decisão for nula; readotar converge
  (ADR 0044, RN-045/046).
  12b — reagendamento do dev agent por evento: máquina de estados
  persistida (working|awaiting_gate|idle|idle_tripped) reagindo a dois
  eventos da outbox existente, `awaiting_gate` retendo o worktree (que
  é por AGENTE, não por task) até o gate terminar, e circuit breaker
  com rearm explícito (ADR 0045, RN-047).
  12c — promoção de story com autoridade do usuário: `story_promotion`
  por projeto com `manual` como DEFAULT NOVO (backfill dirigido põe os
  projetos existentes em `auto`), `proposed_ready` como proposta e não
  estado, promoção reusando o TransitionStoryUseCase (código morto do
  achado #13) e recusa devolvendo ao PO com o motivo fixado na sessão
  dele (ADR 0046, RN-048).
  12d — o Noop entrou na máquina de estados da 12b; script
  `pnpm --filter api validacao:fase-12` que sai != 0 quando o critério
  não fecha e extrai a evidência do banco; colheita da Fase 10
  escrita; docmap cobrindo engine/dev e engine/agents.
  Pendências (execução da validação; limites Local/Noop declarados):
  absorvidas pela FASE 13.
- Não refatore o que está pronto sem pedido explícito.

## Escopo da FASE 13 (ativa — provar de verdade e triar os achados)
Nenhuma feature nova. A fase fecha as pendências declaradas, prova o
que a validação Local/Noop declaradamente não prova, e transforma os
19 achados abertos em plano priorizado. Lição incorporada: a tabela
manual da Fase 10 nunca foi preenchida — nesta fase TODA métrica é
extraída por script do event log/token_usage, nunca anotada à mão.

### 13a — Fechar as pendências declaradas
1. Rodar `pnpm --filter api validacao:fase-12` e preencher a tabela de
   event ids em docs/explanation/validacao-fase-12.md (o TODO(humano)
   do próprio arquivo sai).
2. Smokes com credencial real da Fase 11: rodar os que houver
   `<PROVIDER>_TEST_KEY` exportada (custo em centavos, autorização
   explícita do usuário antes); resultado datado — quais rodaram,
   quais pularam e por quê — registrado em
   docs/explanation/aceite-providers.md (ADR 0043 não é editado; o
   documento o referencia).

### 13b — Validação REAL: GitHub remoto + gates por LLM, MEDIDA
3. Repetir o roteiro da validação num projeto ADOTADO do fork via
   GithubProvider remoto, DevAgent real (modelo de API forte) e gates
   por LLM (nunca 7B local no passo semântico — ADR 0020): adoção sem
   seed → promoção manual de UMA story → dev implementa → PR remota →
   gates com julgamento real → merge manual do usuário. Zero restart
   do engine.
4. Medição por script (scripts/ci/ ou apps/api/scripts): extrai do
   event log e do token_usage a tabela que a Fase 10 deixou como "não
   medido" — restarts, intervenções (proposed_actions decididas pelo
   usuário, com tipo), voltas de gate, custo por task e por agente,
   duração por etapa. O script é reutilizável: vira o instrumento
   padrão de qualquer dogfooding futuro.
5. Resultado em docs/explanation/validacao-real.md com event ids e a
   tabela extraída; achado novo vai para a triagem da 13c como item,
   nunca como fix (a disciplina de sempre).

### 13c — Triagem dos 19 achados abertos
6. Sessão de triagem: ler docs/explanation/primeiro-dogfooding.md e
   classificar os 19 achados em P1/P2/P3 com proposta de agrupamento
   em fases coesas (por tema e dependência entre eles), custo relativo
   estimado (P/M/G) e risco de esperar. A saída é PROPOSTA — a
   decisão de prioridade é do usuário.
7. Consolidar o backlog completo num documento vivo
   (docs/explanation/backlog.md ou equivalente): achados triados +
   itens antigos — budget por área (ADR 0038; o aparato de áreas e o
   Dev Lead saíram do backlog com o ADR 0053, que a FASE 14d
   implementa), handoff manual a agente à escolha,
   MFA/social/OIDC/federação (ADR 0031),
   SMTP real no MailSender, deploy (DEPLOY_ENABLED + Environments),
   volta da rc/rcfix (ADR 0030), modo community do approval-ladder,
   "N agentes online" no dashboard, preferência de moeda com taxa
   manual.

## FASE 14 (ativa em paralelo à 13 — o que a execução real exigiu)
A execução do hello world não passou do primeiro turno e revelou defeitos que
nenhuma suite pegava, porque tudo antes rodou com modelo LOCAL. As correções
já entraram; o que sobra é feature decidida pelo usuário durante a execução.

### 14a — Operabilidade dos agentes (CONCLUÍDA)
- Falha de turno virou `agent.error` DURÁVEL com origem, e o agente FALA no
  fio; os quatro conversacionais paravam de gravar `agent.response` vazio
  (RN-059). O caminho do erro narrado no frame final, que não emitia evento
  nenhum, também fechou.
- O chat do Criativo abre com convite em vez de vazio: ele é ativado e espera
  o usuário falar primeiro, e a tela agora diz isso — incluindo que tecnologia
  e código NÃO são dele.
- A chave que o agente gasta é a do OWNER do workspace (RN-058). Antes o turno
  procurava a credencial pelo SLUG do agente numa coluna UUID: nenhum agente
  jamais usou provider com credencial, e só `ollama` funcionava.
- Relatório de gasto das chaves, só para o owner, com agente separado de
  pessoa (RN-060).
- Bootstrap de Gitflow no GitHub: repo recém-criado responde 409 em toda a Git
  Data API, e o primeiro commit passa pela Contents API. O backend falso dos
  testes mentia (404 onde o GitHub responde 409) — corrigido junto, é o que
  fazia a suite ficar verde com o produto quebrado.

### 14b — Linha do tempo em árvore (CONCLUÍDA)
Um ramo por agente, do primeiro marco ao que ele está fazendo AGORA, derivado
100% do event log que a tela já busca. Ativos abrem sozinhos; quem terminou
nasce fechado. O feed cronológico continua, na coluna de atividade: ele
responde "o que aconteceu", a árvore responde "quem está fazendo o quê".

### 14c — Validação automática de UI (CONCLUÍDA)
Contraste virou teste sobre `design/tokens.css`, com a dívida conhecida medida
e travada; layout (texto cortado, menu fora da viewport, dropdown recortado
por ancestral, alvo < 24px) virou verificador de navegador em
`scripts/dev/validacao-visual.js`. Sem dependência nova.

### 14d — Paralelismo decidido pelo LEAD, com autorização do usuário (A FAZER)
Decisão do usuário, tomada durante a execução — substitui a ideia de teto fixo:

1. **Quem decide é o lead.** Ele avalia quantos agentes valem a pena para o
   trabalho em mão, em vez de um número fixo no código.
2. **Acima de 2, pede autorização.** Passar de dois agentes na sessão vira
   `proposed_action` — o mesmo pipeline de aprovação de toda ação com efeito
   externo. O usuário decide, e a decisão fica no event log.
3. **Configurável por lead**, na tela de Configurações: cada lead tem um máximo
   próprio, com 2 como default.
4. **A Anamnese propõe subir o limite** quando perceber que a autorização é
   RECORRENTE — mesma mecânica de hipótese que ela já usa, com o usuário
   decidindo. Automatizar sem isso seria o produto elevando o próprio teto de
   gasto, que é exatamente o que o pipeline de aprovação existe para impedir.

Ainda não implementado. O que existe hoje continua: um agente por módulo no
`start`, e um extra por módulo (`dev-<modulo>-2`) via aceite de um clique, sem
teto de sessão.

O desenho está fechado no ADR 0053, que revoga três cortes de uma vez (Dev
Lead, áreas dinâmicas via module_map e o aparato genérico de áreas) — os três
caem juntos porque os membros da área de dev são um por módulo do module_map,
decididos pelo Arquiteto e diferentes em cada projeto, logo não são
hardcodáveis como qa e infra.

## FASE 15 (paralela à 13 — gates como dado)
Nenhum gate NOVO. A fase extrai para docs/gates.yml os gates que JÁ
existem implícitos no produto, com verificação por script e severidade,
no mesmo espírito do docs/.docmap.yml. Gate de agente que não existe
(dev-lead, platform) entra como `status: planned` referenciando o
backlog — nunca ativo. O contrato externo dos gates NÃO muda.

### 15a — Registro declarativo
1. docs/gates.yml com os gates existentes (ver ADR 0054, que estende o
   ADR 0048 — a decisão no event log é o que torna a passagem de um
   gate mensurável), schema validado por teste.
2. Loader na api lendo o registro; endpoint interno de leitura.
3. Script `pnpm --filter api validacao:gates` que extrai do event log
   a última passagem de cada gate ativo e sai != 0 se algum gate
   `block` não tem evidência de verificação por script.

Nem todo gate tem prova no event log, e o registro diz onde ela mora:
`merge-protegida` é garantido por TESTE (a trava em decide.ts não emite
evento próprio) e `backmerge` é CI, com estado em .release/gate.json.
Por isso cada gate declara `evidencia: event_log | teste | ci` com o
localizador — rebaixá-los a `warn` seria mentir sobre as travas mais
duras do produto.

### 15b — Consumo
4. Painel do time exibe o gate que cada story/PR está aguardando,
   derivado do registro (não hardcoded).
5. docs/explanation/gates.md explicando o mecanismo, no docmap.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev
- Auth: first-party no domínio da api (argon2id + access JWT curto +
  refresh opaco com rotação); autorização RBAC no domínio da api
  (inalterada desde a Fase 1)
- LLM: roteador na api com suite de contrato; base OpenAI-compatível
  sobre node:http (timeout de inatividade, erro por `code`,
  capabilities em duas camadas — ADR 0041); catálogo com curadoria e
  preço congelado no metering (ADR 0042); 9 providers (ADR 0043)
- Deploy: Kubernetes (k3d/kind em validação local)
- Docs: Docusaurus 3.x em website/ lendo de docs/; Mermaid; busca local
- CI/CD de release: GitHub Actions com lógica em scripts testáveis
  (scripts/ci/, vitest)

## Convenções
- Branches permanentes: dev, qa, main — um branch, um ambiente.
  Trabalho nasce de dev com a taxonomia da política (breaking/,
  feature/, bugfix/, perf/, refactor/, chore/, docs/, test/);
  hotfix/ nasce de main. Formato funcao/descritivo,
  regex ^.{0,15}/\S{0,32}$. Commits em conventional commits, pt-BR.
- Toda mudança entra por PR — push direto em permanente é bloqueado;
  únicas exceções de push: tags (bot de release) e .release/gate.json
  (bot do gate).
- Comunicação api ↔ engine: eventos via Postgres (transactional outbox
  na api, Oban no engine) + HTTP interno com service token para
  comandos síncronos.
- Todo evento de domínio é imutável: nunca UPDATE em tabelas de eventos.
- Estados de sessão são máquina de estados explícita:
  created → active → closing → closed | closed_abnormally
- Toda ação com efeito externo (git, terminal, gasto) nasce como
  proposed_action e respeita permissions.json; deny sempre vence allow.
- Agentes rodam SEMPRE dentro de um Harness; nenhuma chamada de LLM ou
  ferramenta fora dele.
- Handoff externo endereça só LEAD de área ou agente sem área;
  delegação interna é privada da área; falha de subagente NUNCA é
  silenciosa — reporta origem ao lead, que decide e registra evento.
- O contrato externo dos gates é estável: quem consome vê um veredito
  por gate, independente da estrutura interna da área.
- Merge em branch protegida (dev/qa/main) é SEMPRE manual do
  usuário — sem opção de automatizar, garantido por teste.
- O produto NUNCA sobrescreve configuração de repositório do usuário
  (proteções, branches) sem plano aprovado explicitamente (regra da
  FASE 12, origem no ADR 0028).
- Commits de agentes usam identidade "<agente>[bot]" com o usuário
  como co-author.
- Todo desfecho de falha de agente registra a ORIGEM da falha
  (infra | modelo | código | política) — nunca diagnóstico por
  eliminação (lição do ADR 0020). Falha NUNCA vira resposta vazia no
  event log, e o motivo NUNCA fica só em broadcast: `agent.error` é
  durável e o agente diz o que houve no fio (RN-059).
- A chave de LLM que um agente gasta é a do OWNER do workspace
  (RN-058); o relatório desse gasto é do owner e só dele (RN-060).
- Métrica de execução de agentes é extraída do event log/token_usage
  por script, nunca anotada manualmente (lição da Fase 10/13).
- Testes: vitest (api/web/scripts de CI), ExUnit (engine). Nenhuma
  feature sem teste do caminho feliz + 1 caso de falha. Providers de
  git e de LLM validados por suas suites de contrato únicas.
- Capability só é declarada quando provada pela suite; sem prova,
  declara-se false e degrada (regra dos ADRs 0041/0042, vale para git
  e LLM).
- UI: fidelidade estrita ao design system em design/ (tokens, tipografia
  Space Grotesk/Archivo/IBM Plex Mono, dark mode primário). Contraste é
  medido por teste sobre os tokens e layout é verificado no navegador
  por scripts/dev/validacao-visual.js — as duas validações estão
  explicadas em design/README.md.
- Segredos de usuário (API keys de LLM e tokens de git) criptografados
  com envelope encryption; nunca em plaintext no banco ou em logs.
- Decisões arquiteturais relevantes registradas em docs/adr/.

## Documentação é parte da definição de pronto (permanente)
- Ao alterar código, consulte docs/.docmap.yml e atualize os docs
  mapeados NA MESMA mudança, mostrando o diff da doc junto com o do
  código. Não pergunte se deve fazer — faça.
- Fonte de verdade do Markdown: docs/ na raiz. NUNCA crie website/docs/
  — o site lê de docs/ via path.
- Arquivos generated: true no docmap são gerados por pnpm docs:generate
  — nunca editados à mão (o próximo build sobrescreve). Se o gerador
  marcar algo como "sem descrição acima", é lacuna real: escreva a
  descrição na prosa.
- Mudança de comportamento observável → entrada em CHANGELOG.md
  (Unreleased).
- Mudança estrutural (fronteira de camada, banco, modelo de
  consistência, dependência pesada) → ADR novo com o próximo número.
  ADR aceito NUNCA é editado: o novo referencia o antigo.
- Regra de negócio nova → RN-XXX em docs/business-rules.md com
  arquivo:linha e o teste que a cobre.
- Antes de finalizar: pnpm docs:check e pnpm docs:build verdes (glob
  morto, gerado fora de dia e link quebrado reprovam).
- Nunca inventar conteúdo de doc: sem informação suficiente, use
  > **TODO(humano):** <pergunta específica>.
- Diagramas em Mermaid no próprio Markdown. Nunca imagem de diagrama.
- O mecanismo inteiro está explicado em
  docs/explanation/documentation-workflow.md — leia antes de desligar
  qualquer peça dele.

## O que NÃO fazer
- Não usar Redis (filas ficam no Postgres via Oban)
- Não implementar MFA, login social, OIDC provider ou federação
  (backlog do ADR 0031)
- Dev Lead, áreas dinâmicas via module_map e o aparato genérico de
  áreas (agent_areas) DEIXARAM de ser proibidos: o ADR 0053 revogou os
  três cortes (do ADR 0038 e da Fase 8) e a FASE 14d os implementa.
  Fora da 14d, continuam valendo — não abra área nova de passagem
- Não versionar à mão: toda tag nasce de workflow
- Não instalar libs sem justificar no plano
- Não refatorar código de fase concluída sem pedido explícito
- Não ativar modelo descoberto automaticamente: curadoria manual
  sempre (ADR 0042)
- Não corrigir de passagem os 19 achados abertos, hoje em
  docs/explanation/achados-execucao-real.md — cada um espera a fase que
  o endereça, e corrigir fora dela apaga a evidência de por que existia
- (FASE 15) Nenhum gate NOVO e nenhuma mudança de comportamento de
  gate existente — a fase só DECLARA e MEDE o que já existe
- (FASE 13) Nenhuma feature nova e nenhum fix: a fase produz
  execuções, medições e um plano — achado novo entra na triagem