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
  de ponta a ponta (v0.1.0 → v0.2.0) e cadeia de hotfix validada por
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
  Criativo obrigatório na cadeia). Colheita em
  docs/explanation/primeiro-dogfooding.md e ADR TODO(humano): número.
  Achados P1: adoção de repositório existente (createRepo incondicional
  em provision-repository.use-case.ts:144, getRepo sem uso, sem
  externalId no DTO), reagendamento de dev agent após gate (`:work` só
  na ativação — tandas exigem restart do engine) e promoção automática
  de story a ready sem passo humano. Demais achados: TODO(humano).
- FASE 11 — CONCLUÍDA: os seis providers da Fase 9b como config sobre
  a base, cada um investigado do zero contra a doc oficial (proibido
  herdar quirk); LLM_PROVIDER_NAMES de 3 para 9; DTO de credencial e
  testador de conexão derivando de lista única; capability só
  declarada quando provada, com duas reversões ao vivo (DeepInfra e
  Vultr); único hook novo na base (`parseErrorFrame`, +31 linhas)
  provado necessário pelo OpenRouter (ADR 0043).
  Pendente: aceite com credencial real dos seis smokes, gated por
  `<PROVIDER>_TEST_KEY` — depende de chaves do usuário, rastreado como
  item de backlog, não bloqueia fase.
- Não refatore o que está pronto sem pedido explícito.

## Escopo da FASE 12 (ativa — operabilidade: os três achados P1 do dogfooding)
O que separa o experimento controlado da operação real. Cada item
nasce da colheita da Fase 10; a correção deve caber no desenho
existente — se exigir mudança estrutural, ADR antes.

### 12a — Adoção de repositório existente
1. O wizard ganha o caminho "Adotar repositório existente" ao lado de
   "Criar novo": DTO com externalId/URL + provider + credencial;
   getRepo (existente e sem uso desde a Fase 2) valida acesso e
   capabilities; createRepo deixa de ser incondicional
   (provision-repository.use-case.ts:144) — adoção NÃO cria repo.
2. Bootstrap em modo adoção é OPT-IN e começa com PLANO: o use-case
   roda em dry-run listando o que criaria/alteraria (branches
   faltantes, proteções, arquivos) SEM executar; o usuário aprova o
   plano inteiro ou adota "como está" (bootstrap dispensado,
   registrado). Nunca sobrescrever proteção existente sem aprovação
   explícita — a lição do ADR 0028 vira regra do produto.
3. Detecção de política divergente: repo adotado cujas branches não
   batem com o template (ex.: sem qa, com rc) é registrado como
   política própria do projeto — o bootstrap não força o template;
   diagnóstico vai para o event log e para a tela do projeto.
4. Idempotência preservada: adotar o mesmo repo duas vezes converge;
   provisioned_repositories/repo_bootstraps ganham origem
   (created | adopted) — o seed manual da Fase 10 nunca mais é
   necessário.

### 12b — Reagendamento do dev agent após gate
5. Fim das tandas: o DevAgentServer volta ao trabalho quando (a) o
   gate resolve sua task (approved → pega a próxima ready do módulo;
   changes_requested → correção, fluxo já existente) e (b) uma task
   nova do seu módulo vira ready — sem restart do engine. Sem task
   ready: estado idle explícito no painel, não processo morto.
6. Guardas do reagendamento: claim atômico preservado, teto de
   orçamento por task inalterado, e um circuit breaker por agente
   (N tasks consecutivas blocked → agente para em idle com evento e
   notificação, em vez de queimar orçamento em série — valor
   configurável por projeto).
7. Reidratação pós-restart retoma o estado correto (idle | working |
   awaiting_gate) — o teste da Fase 4 de reidratação é estendido para
   os estados novos.

### 12c — Promoção de story com autoridade do usuário
8. Transição draft→ready deixa de ser automática na criação: modo por
   projeto (manual — DEFAULT — | auto), alinhado ao princípio de
   autoridade do usuário. Em manual, o PO propõe (story fica draft
   completa com DoD/DoR validados) e o usuário promove na UI do
   Backlog — individualmente ou em lote com revisão.
9. O modo auto permanece para quem preferir (é o comportamento atual,
   documentado como opt-in); a mudança de default entra no CHANGELOG
   como breaking de comportamento.

### 12d — Fechamento
10. Mini-validação: reexecutar UMA task de ponta a ponta num projeto
    ADOTADO (fork da Fase 10 serve), sem seed manual, sem restart do
    engine, com promoção manual de story — os três achados provados
    resolvidos numa única execução.
11. ADR "operabilidade pós-dogfooding" referenciando a colheita;
    RN-XXX para as regras novas (adoção sem sobrescrita, circuit
    breaker, promoção manual como default); docmap/CHANGELOG/docs
    verdes.

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
  eliminação (lição do ADR 0020).
- Testes: vitest (api/web/scripts de CI), ExUnit (engine). Nenhuma
  feature sem teste do caminho feliz + 1 caso de falha. Providers de
  git e de LLM validados por suas suites de contrato únicas.
- Capability só é declarada quando provada pela suite; sem prova,
  declara-se false e degrada (regra dos ADRs 0041/0042, vale para git
  e LLM).
- UI: fidelidade estrita ao design system em design/ (tokens, tipografia
  Space Grotesk/Archivo/IBM Plex Mono, dark mode primário).
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
- Não implementar Dev Lead nem áreas dinâmicas via module_map (backlog
  do ADR 0038)
- Não implementar o aparato genérico de áreas (agent_areas/budget por
  área) — corte registrado da Fase 8
- Não versionar à mão: toda tag nasce de workflow
- Não instalar libs sem justificar no plano
- Não refatorar código das fases concluídas fora do necessário para a
  Fase 12
- Não ativar modelo descoberto automaticamente: curadoria manual
  sempre (ADR 0042)
- (FASE 12) Não estender a adoção a migração de dados do repo
  (issues, PRs históricas) — adoção é acesso + política, nada mais
- (FASE 12) Não transformar o reagendamento em autonomia nova: o
  pipeline de aprovações continua exatamente como está — o que muda é
  o agente não morrer entre tasks