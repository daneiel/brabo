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
  ContextManager, InstructionFiles, Hooks) com ferramentas e EchoAgent;
  handoffs explícitos; agentes Criativo (business_rules +
  product_brief), PO (backlog com DoD/DoR validados no domínio e
  rastreabilidade regra→story) e Arquiteto (ADRs via PR + module_map
  com validação cruzada de stories).
- Não refatore o que está pronto sem pedido explícito; a Fase 4
  CONSOME essas fundações.

## Escopo da FASE 4 (ativa — não implemente nada além disso)

### 4a — Agentes de execução (dev, QA, SecOps, Infra)
1. Instanciação dinâmica: ao ativar a fase de execução de um projeto,
   criar um subagente dev por módulo do module_map (dev-<modulo>),
   cada um como processo supervisionado próprio com harness e
   instruções próprias. Paralelização adicional é SUGERIDA via
   notificação com aprovação de um clique — nunca criada sozinha.
2. Isolamento git: cada dev em git worktree próprio, branch feature/*
   conforme taxonomia; commits com identidade "dev-<modulo>[bot]" e
   usuário como co-author. Commit/push/PR via pipeline respeitando
   autonomia por agente.
3. Ciclo de tarefa do dev: pega task ready (respeitando DoR) →
   implementa no worktree → roda testes via ferramenta terminal (rtk
   quando disponível) → abre PR referenciando a story → atualiza o
   backlog.
4. QA: gate de PR — roda a suite, produz matriz regra→teste como
   artefato, aprova ou devolve com parecer estruturado no event log e
   comentário na PR.
5. SecOps: gate após o QA — checklist derivado dos ADRs + scanners do
   container (semgrep, gitleaks); parecer estruturado, mesmo fluxo.
6. Infra: lê module_map e ADRs de infraestrutura e propõe via PRs os
   artefatos (Dockerfiles, compose, manifests, pipelines) — sempre
   propondo, nunca aplicando em ambiente.
7. UI: painel do time com status ao vivo real (ocioso/trabalhando/
   aguardando aprovação, tarefa atual, branch) via canais Phoenix.

### 4b — Psicólogo real e Anamnese (só após 4a verde)
8. Psicólogo: consumer de session.closed (qualquer causa); lê event
   log + regras de negócio + hipóteses anteriores e produz via LLM
   hipóteses {agente_alvo, observação, hipótese, sugestão, evidência
   (refs a event ids), confiança}; análise adicional de causa em
   términos anormais; idempotente por sessão.
9. Anamnese: jobs periódicos sobre o event log mantêm
   proficiency_profile por usuário e competência com evidências;
   propõe patches nos arquivos de agente como proposed_action de tipo
   instruction_patch (usuário vê o diff e aprova/nega); patches
   versionados com rollback de um clique.
10. Loop fechado: hipótese do Psicólogo aceita pelo usuário vira input
    priorizado da Anamnese.
11. UI: seção Insights (hipóteses com evidência navegável), perfil de
    proficiência com os porquês, histórico de versões por arquivo de
    agente com diff e rollback.

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
- Não implementar deploy em produção/Kubernetes (fase 5)
- Não implementar Bitbucket nem GenericGitProvider
- Não instalar libs sem justificar no plano
- Não refatorar código das Fases 1–3 fora do necessário para a Fase 4