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
  supervisão e evento de término. Não refatore o que está pronto sem
  pedido explícito; a Fase 2 CONSOME essas fundações.

## Escopo da FASE 2 (ativa — não implemente nada além disso)
1. Interface GitProvider em packages/shared com tipos normalizados
   (nunca vazar o shape da API do provider para o domínio): createRepo,
   getRepo, createBranch, protectBranch, commitFiles, listBranches,
   openPullRequest, mergePullRequest. Cada provider expõe capabilities;
   o domínio degrada quando uma operação não é suportada.
2. Implementações: LocalGitProvider (completo), GithubProvider (Octokit)
   e GitlabProvider (REST). Bitbucket e GenericGitProvider ficam para
   fase futura — não criar stubs.
3. Credenciais de git do usuário em user_credentials (mesma envelope
   encryption da Fase 1), com teste de conexão no cadastro.
4. Provisionamento por projeto: use-case que cria o repositório com o
   provider configurado e executa o bootstrap de Gitflow IDEMPOTENTE:
   branches dev/qa/rc/main, proteções (onde o provider suportar),
   template de PR e docs/branching-policy.md. Rodar duas vezes não
   duplica nem falha — cada passo verifica o estado antes de agir.
5. Toda operação mutante de repo passa pelo pipeline de proposed_actions
   (types git_*); o bootstrap inicial é auto_approved, mas registrado
   no event log.
6. Wizard de novo projeto na web ligado ao fluxo real, com progresso do
   bootstrap exibido ao vivo a partir do event log.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev
- Auth: Keycloak (OIDC) em container; autorização RBAC no domínio da api

## Convenções
- Branches permanentes: dev, qa, rc, main. Trabalhe SEMPRE em branch
  feature/* a partir de dev. Commits em conventional commits, pt-BR.
- Comunicação api ↔ engine: eventos via Postgres (transactional outbox na
  api, Oban no engine) + HTTP interno para comandos síncronos.
- Todo evento de domínio é imutável: nunca UPDATE em tabelas de eventos.
- Estados de sessão são máquina de estados explícita:
  created → active → closing → closed | closed_abnormally
- Toda ação com efeito externo (git, terminal, gasto) nasce como
  proposed_action e respeita permissions.json; deny sempre vence allow.
- Testes: vitest (api/web), ExUnit (engine). Nenhuma feature sem teste do
  caminho feliz + 1 caso de falha. Providers de git validados por uma
  suite de contrato ÚNICA, rodada contra LocalGitProvider real (tmp dir)
  e contra os remotos mockados.
- UI: fidelidade estrita ao design system em design/ (tokens, tipografia
  Space Grotesk/Archivo/IBM Plex Mono, dark mode primário).
- Segredos de usuário (API keys de LLM e tokens de git) criptografados
  com envelope encryption; nunca em plaintext no banco ou em logs.
- Decisões arquiteturais relevantes registradas em docs/adr/.

## O que NÃO fazer
- Não usar Redis (filas ficam no Postgres via Oban)
- Não implementar agentes de produto/execução (fase 3+): harness,
  Criativo, PO, Arquiteto, devs, infra, QA, secops, Psicólogo real,
  Anamnese
- Não implementar Bitbucket nem GenericGitProvider nesta fase
- Não instalar libs sem justificar no plano
- Não refatorar código da Fase 1 fora do necessário para a Fase 2