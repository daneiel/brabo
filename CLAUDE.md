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
  contrato e capabilities, credenciais de git criptografadas,
  provisionamento com bootstrap de Gitflow idempotente e retomável via
  pipeline de proposed_actions, wizard de novo projeto com progresso
  ao vivo.
- Não refatore o que está pronto sem pedido explícito; a Fase 3
  CONSOME essas fundações.

## Escopo da FASE 3 (ativa — não implemente nada além disso)

### 3a — Harness de agentes (fundação; implementar ANTES de qualquer agente)
1. Cinco behaviours Elixir no apps/engine, com contratos explícitos:
   PromptAssembler (prompt em camadas ordenadas com orçamento de tokens
   por camada e corte determinístico), ToolLoop (loop de tool use via
   roteador de LLM da api, streaming, limite de iterações),
   ContextManager (compactação acima de X% via modelo barato com binding
   scope "context-manager", evento context.compacted com antes/depois em
   tokens, itens pinned preservados), InstructionFiles (AGENTS.md do
   workspace + arquivo de agente do banco, merge com precedência
   documentada), Hooks (pre_tool_use, post_tool_use, session_start,
   session_end; terminal e proposed_actions plugam como hooks).
2. O engine NUNCA fala com provider de LLM direto: toda chamada passa
   pelo endpoint da api (metering e budget obrigatórios).
3. Ferramentas iniciais do ToolLoop: read_file, write_file (via
   proposed_action fora de whitelist de paths), terminal (via pipeline),
   search_workspace, emit_artifact (artefato tipado no event log).
4. EchoAgent de validação exercitando o ciclo completo.

### 3b — Agentes de produto (só após 3a verde)
5. Handoffs explícitos: tabela handoffs {from_agent, to_agent,
   artifact_id, status}; agente só inicia com handoff recebido — agentes
   NUNCA conversam livremente entre si.
6. Criativo: ideação com o usuário; emite artefatos business_rule ao
   longo da conversa e product_brief quando o usuário confirmar
   prontidão; a cada rodada provoca "o que falta para começar?".
7. PO: backlog em tabelas próprias (epics, stories, tasks) com RF/RNF,
   regra de negócio vinculada, DoD e DoR obrigatórios — story sem
   DoD/DoR não sai de draft (validação no domínio, não só no prompt).
8. Arquiteto: ADRs commitados em docs/adr/ do repo DO PROJETO via
   pipeline git (PR), e artefato module_map (módulos, stacks,
   dependências); valida que toda story referencia módulo existente.
9. UI: tab Backlog (épicos → histórias → tarefas com DoD/DoR),
   artefatos do Arquiteto na visão geral, divisores de handoff no chat.

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
- Não implementar agentes de execução (fase 4): devs, infra, QA, secops,
  Psicólogo real, Anamnese, instanciação dinâmica por module_map
- Não implementar Bitbucket nem GenericGitProvider
- Não instalar libs sem justificar no plano
- Não refatorar código das Fases 1–2 fora do necessário para a Fase 3