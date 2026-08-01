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
- FASE 9 — CONCLUÍDA PARCIALMENTE: providers de IA — suite de contrato
  de LLMProvider rodando contra os existentes, base
  OpenAICompatibleProvider sobre node:http com timeout de INATIVIDADE,
  erro normalizado por `code`, capabilities em duas camadas (ADR 0041);
  sync de catálogo com modelo descoberto entrando desativado, modelo
  sumido marcado em vez de apagado, e preço congelado em `token_usage`
  com auditoria append-only (ADR 0042); ModelPicker reagrupado por
  origem com curadoria de catálogo.
  NÃO ENTROU: os SEIS providers da 9b — OpenRouter, NVIDIA NIM,
  Together, Deep Infra, Bitdeer e Vultr. A base, o contrato, o sync e
  o metering por `upstream_provider` estão prontos para recebê-los
  (cada um é config + seed + kind de credencial), mas nenhum foi
  implementado — registrado em ADR 0042 "o que fica para depois".
  `LLM_PROVIDER_NAMES` tem TRÊS entradas: ollama, anthropic, openai.
  Só o openai declara `listModels`, então o sync de catálogo só tem
  efeito nele; ollama e anthropic declaram false e são pulados. Junto
  fica pendente o aceite com credencial real do OpenRouter.
- Não refatore o que está pronto sem pedido explícito.

## Escopo da FASE 10 (ativa — Bitbucket + GenericGitProvider VIA dogfooding)
Entrega dupla: os dois providers do backlog E a primeira execução real
do Brabo construindo software de produção — o próprio Brabo. Método é
parte do escopo: desvio do protocolo de dogfooding é achado, não
atalho.

### 10a — Preparação e protocolo
1. docs/missions/dogfooding-mission.md: protocolo de observação — o
   que anotar por sessão (fadiga de aprovação em cliques, qualidade
   dos pareceres consolidados, custo por task, intervenções manuais
   com motivo), quais hipóteses do Psicólogo aceitar/descartar
   deliberadamente para exercitar o loop da Anamnese, e critério de
   encerramento (suite verde nos dois providers OU teto de
   orçamento/tempo — valores TODO(humano)).
2. Projeto "brabo-gitproviders" DENTRO do Brabo apontando para um
   FORK do repositório (GithubProvider), com as linhas de
   `provisioned_repositories`/`repo_bootstraps` semeadas à mão e o
   bootstrap de Gitflow NÃO executado.
   Por que não é o repo real, nem pelo wizard: o produto não sabe
   adotar repositório existente — `createRepo` é chamado sem condição
   (provision-repository.use-case.ts:144), `getRepo` existe e nenhum
   caso de uso o chama, e o DTO não tem campo para `externalId`.
   Rodar o bootstrap contra um repo que já existe criaria a branch
   `rc` (que a política do Brabo não usa) e sobrescreveria a proteção
   da Fase 6 com `enforce_admins: true` + 1 revisor, podendo travar o
   merge manual do dono (ADR 0028). O seed manual é a intervenção #1
   do log, e a limitação é achado P1 da fase.
   Sobre "áreas da Fase 8 ativas": não há o que ativar — ver o corte
   de escopo no Status da FASE 8. Autonomia MANUAL em tudo já é o
   default (decide.ts:125-128, permissions.json nasce vazio); a regra
   do experimento é NÃO afrouxar — nunca usar approve_always, nunca
   popular allow, nunca gravar agent_autonomy. Budget por task
   conservador e bindings deliberados (dev com modelo forte de API;
   gates nunca com 7B local no passo semântico — ADR 0020).
3. Salvaguardas: worktrees como sempre; merge manual do usuário;
   pr-police/approval-ladder/gates do repo valem integralmente para
   PRs de agente.

### 10b — Execução pelos agentes (conduzida no produto, não no Claude Code)
4. SESSÃO 0 com o CRIATIVO — o Criativo NÃO é dispensado, ao contrário
   do que esta fase previa. É o único caminho até o PO (não existe
   handoff manual para agente à escolha) e o único agente com
   `emit_artifact`: story só vira `ready` com ≥1 regra de negócio
   vinculada, o id é validado contra um `artifact.business_rule` real,
   e o claim de task exige `s.status = 'ready'`. Sem Criativo, nenhum
   dev pega task. O texto de entrada está em
   docs/missions/inputs/00-handoff-criativo.md; os demais insumos
   (contrato, semânticas do Bitbucket a investigar, escopo do Generic)
   seguem em docs/missions/inputs/. PO estrutura épico/stories com
   DoD/DoR (promoção a `ready` é AUTOMÁTICA na criação — não há passo
   humano); Arquiteto valida contra o module_map e produz ADR das
   semânticas via PR real.
5. Devs implementam BitbucketProvider e GenericGitProvider contra a
   suite de contrato ÚNICA (mock; smoke atrás de env var); bootstrap
   degradando corretamente no Generic; wizard da web ganha os dois
   (ícone do Bitbucket entra na UI, removendo a divergência
   deliberada do dashboard).
   A execução roda em TANDAS: cada dev agent processa UMA task e para
   (`:work` só é disparado na ativação e no aceite de paralelização;
   nada reagenda depois do gate). Reativar não redispara — o
   supervisor devolve o agente existente. Entre tandas: reiniciar o
   engine e reativar. Backlog fatiado em MUITOS módulos com POUCAS
   tasks; a contagem de restarts é métrica da fase.
6. Gates reais em toda PR: QA Lead consolidando, SecOps. O MERGE
   acontece no provider de git, fora do produto: `awaiting_user` é
   terminal de propósito (RN-014) e o engine não conhece `git_merge`.

### 10c — Colheita
7. docs/explanation/primeiro-dogfooding.md: métricas do protocolo
   validadas contra o event log, custo real por provider (metering
   com snapshot), intervenções e o diff promessa×realidade em prosa
   honesta.
8. Hipóteses do Psicólogo da fase revisadas uma a uma (lidas EM LOTE
   só na colheita); patches da Anamnese decorrentes avaliados.
9. ADR "primeiro dogfooding": aprendizados e achados convertidos em
   backlog priorizado (P1/P2/P3) — nunca fixes embutidos.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev
- Auth: first-party no domínio da api (argon2id + access JWT curto +
  refresh opaco com rotação); autorização RBAC no domínio da api
  (inalterada desde a Fase 1)
- LLM: roteador na api com suite de contrato; base OpenAI-compatível
  com quirks declarativos; catálogo de modelos com origem
  (manual | provider_api) e snapshot de preço no metering
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
- Commits de agentes usam identidade "<agente>[bot]" com o usuário
  como co-author.
- Todo desfecho de falha de agente registra a ORIGEM da falha
  (infra | modelo | código | política) — nunca diagnóstico por
  eliminação (lição do ADR 0020).
- Testes: vitest (api/web/scripts de CI), ExUnit (engine). Nenhuma
  feature sem teste do caminho feliz + 1 caso de falha. Providers de
  git e de LLM validados por suas suites de contrato únicas.
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
  do ADR da hierarquia)
- Não versionar à mão: toda tag nasce de workflow
- Não instalar libs sem justificar no plano
- Não refatorar código das fases concluídas fora do necessário para a
  Fase 10
- (FASE 10) Não implementar os providers "por fora" se os agentes
  travarem — travamento é achado de altíssimo valor: registre,
  destrave via intervenção DOCUMENTADA e siga
- (FASE 10) Não ajustar instruções de agente no meio do experimento
  fora do fluxo da Anamnese
- (FASE 10) Não refatorar o produto durante a fase: achado vira
  backlog priorizado na colheita