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
  loop fechado com o Psicólogo. Gates destravados e validados por
  execução real (ADR 0020).
- FASE 5 — CONCLUÍDA: imagens de produção non-root e CI (ADR 0024),
  deploy Kubernetes com Kustomize, HPA por fila do Oban,
  NetworkPolicies e ESO (ADR 0025), graceful shutdown + OpenTelemetry
    + métricas e dashboards (ADR 0026), backup com restore testado,
      runbooks e hardening da api (ADR 0027).
- Não refatore o que está pronto sem pedido explícito.

## Escopo da FASE DOC (ativa — somente documentação)
Executar a missão de documentação (prompt dedicado) respeitando os
pontos de parada dela. Regras desta fase:
- NENHUMA mudança de comportamento de runtime. Bug encontrado durante
  a recon vira issue, nunca fix embutido.
- Código novo permitido: scripts de docs:generate, workflows de CI de
  docs, scaffold do website/ (Docusaurus). Nada além.
- docs/adr/ existentes (0001+) são fonte primária e INTOCÁVEIS: nunca
  renumerar, reescrever ou "melhorar". A missão apenas gera o index
  deles e, se reconstruir decisões pré-ADR-0001 do histórico git,
  numera em sequência livre no fim.
- Fonte de verdade do Markdown: docs/ na raiz; website/ apenas LÊ de
  lá via path — nunca criar website/docs/.
- Gerenciador de pacotes: pnpm em tudo (scripts docs:* na raiz
  delegando para website/); nada de npm --prefix.
- PRs de doc miram dev como qualquer PR; deploy do site de docs só em
  push em main (doc publicada acompanha release).
- Referências geradas obrigatórias além de env vars e scripts:
  catálogo de tipos de evento do event log, schemas de artefato
  (Engine.Harness.ArtifactSchemas), types de proposed_action e formato
  do permissions.json.
- A tabela de ambiente de inferência do ADR 0020 (GPU, contexto do
  Ollama, residência de modelos, purga de fila Oban) é promovida a
  docs/runbook.md.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev
- Auth: Keycloak (OIDC) em container; autorização RBAC no domínio da api
- Deploy: Kubernetes (k3d/kind em validação local)
- Docs: Docusaurus 3.x em website/ lendo de docs/; Mermaid para
  diagramas; busca local

## Convenções
- Branches permanentes: dev, qa, rc, main. Trabalhe SEMPRE em branch
  feature/* a partir de dev (doc-only usa docs/*). Commits em
  conventional commits, pt-BR.
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
- Todo desfecho de falha de agente registra a ORIGEM da falha
  (infra | modelo | código | política) — nunca diagnóstico por
  eliminação (lição do ADR 0020).
- Testes: vitest (api/web), ExUnit (engine). Nenhuma feature sem teste do
  caminho feliz + 1 caso de falha. Providers de git validados pela suite
  de contrato única.
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
- Não implementar Bitbucket nem GenericGitProvider (backlog futuro)
- Não adicionar features de produto nesta fase — só documentação e
  seus mecanismos
- Não alterar comportamento de runtime nesta fase
- Não instalar libs sem justificar no plano (exceção pré-aprovada:
  dependências do Docusaurus 3.x e do tooling de docs:generate)
- Não refatorar código das Fases 1–5