# Brabo — Plataforma de engenharia orquestrada por agentes

## O que é
Sistema que gerencia o ciclo completo de uma aplicação: provisionamento de
repositório, Gitflow, agentes de IA especializados (Criativo, PO, Arquiteto,
Devs, Infra, QA, SecOps, Psicólogo, Anamnese), controle de custos de token
e pipeline de aprovação de ações com autoridade final do usuário.

## Escopo da FASE 1 (MVP — concluída)
1. Workspaces, projetos, usuários e IAM (RBAC por projeto)
2. Sessões com event log imutável (event sourcing das interações)
3. Chat com roteador de LLM (Ollama + APIs por credencial do usuário)
4. Metering de tokens: consumo por sessão/agente, budget, alertas 70/90/100%
5. Pipeline de ações propostas + permissions.json por projeto
6. Motor de sessões em Elixir/OTP com supervisão e evento de término

## Escopo da FASE 2 (não implemente nada além disso)
1. Abstração de git provider (GitProvider) + LocalGitProvider,
   GithubProvider e GitlabProvider via API, e provisionamento de
   repositório por projeto (endpoint/use-case que cria o repositório
   usando o provider configurado)

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
- Testes: vitest (api/web), ExUnit (engine). Nenhuma feature sem teste do
  caminho feliz + 1 caso de falha.
- UI: fidelidade estrita ao design system em design/ (tokens, tipografia
  Space Grotesk/Archivo/IBM Plex Mono, dark mode primário).
- Segredos de usuário (API keys de LLM) criptografados com envelope
  encryption; nunca em plaintext no banco ou em logs.

## O que NÃO fazer
- Não usar Redis (filas ficam no Postgres via Oban)
- Não implementar agentes de produto/execução (fase 3+)
- Não implementar adapters de git além do LocalGitProvider (fase 2)
- Não instalar libs sem justificar no plano