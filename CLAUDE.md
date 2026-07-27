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
  Psicólogo real com hipóteses evidenciadas e Anamnese com
  proficiency_profile, instruction_patches versionados com rollback e
  loop fechado com o Psicólogo.
- FASE 5 — CONCLUÍDA: imagens de produção non-root e CI (ADR 0024);
  deploy Kubernetes com Kustomize, HPA por fila do Oban, NetworkPolicies
  e secrets via ESO (ADR 0025); graceful shutdown com handoff de sessão,
  OpenTelemetry ponta a ponta, métricas e dashboards (ADR 0026); backup
  agendado com restore TESTADO (`make test-restore`), runbooks
  operacionais, hardening da api (rate limit, CORS estrito, helmet,
  auditoria de dependências) e superfície exposta verificada por teste
  (ADR 0027).
- Não refatore o que está pronto sem pedido explícito.

## Escopo da FASE 5 (CONCLUÍDA — mantido como registro do que foi entregue)
1. Imagens de produção multi-stage para api, engine e web (web via
   nginx com config SPA); rtk, semgrep, gitleaks e hadolint na imagem
   do engine; imagens non-root, read-only fs onde possível.
2. CI do próprio Brabo: pipeline (GitHub Actions) com lint, testes,
   build das imagens, scan de imagem e de segredos; obrigatório verde
   para merge em dev.
3. Deploy Kubernetes: chart Helm OU Kustomize base+overlays (escolher
   e registrar em ADR) cobrindo api/engine/web/Keycloak, Postgres
   externo configurável, HPA do engine por profundidade de fila do
   Oban (métrica exposta), PDBs, NetworkPolicies (web→api→db;
   engine→api→db), secrets via External Secrets ou sealed-secrets.
4. Graceful shutdown do engine: preStop drena sessões ativas
   (transição closing com causa node_shutdown) antes do SIGTERM;
   rollout NUNCA gera sessão órfã.
5. Observabilidade: OpenTelemetry em api e engine com trace por sessão
   (uma sessão = uma trace raiz atravessando api↔engine), métricas
   Prometheus (tokens/min e custo/hora por projeto, fila Oban, sessões
   ativas, taxa de aprovação de ações, tasks blocked) e dashboards
   Grafana provisionados como código.
6. Backup e restore: pg_dump agendado com retenção, runbook de restore
   TESTADO em docs/runbooks/.
7. Hardening da api: rate limit, headers de segurança na web, CORS
   estrito, auditoria de dependências no CI.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev
- Auth: Keycloak (OIDC) em container; autorização RBAC no domínio da api
- Deploy: Kubernetes (k3d/kind em validação local)

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
- Agentes rodam SEMPRE dentro de um Harness; nenhuma chamada de LLM ou
  ferramenta fora dele.
- Merge em branch protegida (dev/qa/rc/main) é SEMPRE manual do
  usuário — sem opção de automatizar, garantido por teste.
- Commits de agentes usam identidade "<agente>[bot]" com o usuário
  como co-author.
- Testes: vitest (api/web), ExUnit (engine). Nenhuma feature sem teste do
  caminho feliz + 1 caso de falha. Providers de git validados pela suite
  de contrato única.
- UI: fidelidade estrita ao design system em design/ (tokens, tipografia
  Space Grotesk/Archivo/IBM Plex Mono, dark mode primário).
- Segredos de usuário (API keys de LLM e tokens de git) criptografados
  com envelope encryption; nunca em plaintext no banco ou em logs.
- Decisões arquiteturais relevantes registradas em docs/adr/.

## O que NÃO fazer
- Não usar Redis (filas ficam no Postgres via Oban)
- Não implementar Bitbucket nem GenericGitProvider (backlog futuro)
- Não adicionar features de produto nesta fase — só produção
- Não instalar libs sem justificar no plano
- Não refatorar código das Fases 1–4 fora do necessário para a Fase 5