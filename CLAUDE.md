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
  Docusaurus em website/ lendo de docs/, referências geradas (eventos,
  artefatos, proposed_actions, permissions.json, env vars, rotas,
  métricas, scripts), docs/.docmap.yml + drift check (docs:check) no
  CI, camada de comunidade, licenciamento MIT verificado e o mecanismo
  documentado em docs/explanation/documentation-workflow.md.
- FASE 6 — CONCLUÍDA: política de branches mecanizada (ADR 0030) —
  pr-police, approval-ladder com os dois modos, promote/tag-release
  com versão calculada e âncora por árvore, backmerge gate com
  retropropagação automática, rulesets versionados em
  docs/reference/rulesets.md. Esteira exercitada de ponta a ponta
  (v0.1.0 → v0.2.0) e a cadeia de hotfix validada por execução real.
- FASE 7 — ATIVA: auth first-party no domínio da api (substituindo o
  Keycloak) e referência completa de rotas gerada a partir do OpenAPI.
  - 7a (itens 1–3) — CONCLUÍDA: módulo auth em paralelo ao Keycloak —
    argon2id, access token Ed25519, rotação de refresh com revogação
    de família no reuso, lockout progressivo, tokens de conta e
    MailSender log-only (ADR 0031, RN-030..033).
  - 7.2 (itens 4–5) — CONCLUÍDA: o corte atômico — emissor próprio no
    guard sem tocar no RBAC, /internal/* fora do JWT com service
    token, sessão da web em cookie httpOnly com CSRF, migração dos
    usuários e remoção do Keycloak do compose, do k8s e das docs
    (ADR 0032, RN-034/035).
  - 7b (itens 6–8) — PENDENTE: OpenAPI em todos os controllers e
    docs/reference/api/ gerado no Docusaurus.
- Não refatore o que está pronto sem pedido explícito.

## Escopo da FASE 7 (ativa — auth first-party + referência de rotas)

### 7a — Substituir o Keycloak por auth no domínio da api
1. Módulo auth first-party: registro (email+senha), login, logout,
   refresh. Senhas com argon2id (parâmetros documentados); tokens:
   access JWT curto (15min, assinado com chave em env via envelope da
   Fase 1) + refresh opaco em tabela com ROTAÇÃO obrigatória (reuso de
   refresh já rotacionado = revogação da família inteira + evento de
   segurança no log).
2. Proteções: lockout progressivo por usuário e IP (janela no
   Postgres, sem Redis), comparações em tempo constante, enumeração de
   e-mail bloqueada (mesma resposta para usuário inexistente), senha
   com política mínima verificada no domínio.
3. Fluxos de conta: verificação de e-mail e reset de senha por token
   de uso único com expiração — envio de e-mail atrás de interface
   MailSender com implementação log-only por ora (SMTP real é config
   futura, não bloqueia a fase).
4. Migração: usuários existentes do Keycloak importados (id, email,
   roles do RBAC preservados); senhas NÃO migram — fluxo de "definir
   nova senha" no primeiro login pós-migração. Guard JWT da api
   troca de emissor sem mudar o contrato dos controllers (RBAC da
   Fase 1 intocado). HTTP interno engine↔api passa a service token
   próprio (segredo compartilhado via env, rotacionável).
5. Remoção do Keycloak: containers (compose dev e prod), manifests
   k8s, realm e docs; a web troca o fluxo OIDC por login próprio
   seguindo o design system. ADR registrando o subconjunto
   implementado e o backlog consciente (MFA, OIDC social, federação).

### 7b — Referência completa de rotas no Docusaurus (gerada, nunca à mão)
6. OpenAPI como fonte: @nestjs/swagger em TODOS os controllers —
   summary (objetivo), tags por domínio, DTOs de request/response
   tipados com exemplos, códigos de erro; o teste de tabela de rotas
   da Fase 5 passa a exigir também metadados OpenAPI (rota sem
   summary/DTO quebra o teste).
7. Geração: pnpm docs:generate exporta o openapi.json e materializa
   docs/reference/api/ via docusaurus-plugin-openapi-docs (uma página
   por tag, sidebar própria); entra no docmap como generated: true
   com severity block; docs:check falha se o gerado divergir.
8. Rotas de auth novas nascem já documentadas (7a e 7b na mesma
   entrega de superfície).

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev
- Auth: first-party no domínio da api (argon2id + access JWT curto +
  refresh opaco com rotação) — substitui o Keycloak na Fase 7;
  autorização RBAC no domínio da api (inalterada desde a Fase 1)
- Deploy: Kubernetes (k3d/kind em validação local)
- Docs: Docusaurus 3.x em website/ lendo de docs/; Mermaid para
  diagramas; busca local
- CI/CD de release: GitHub Actions com lógica em scripts testáveis
  (scripts/ci/, vitest)

## Convenções
- Branches permanentes: dev, qa, main — um branch, um ambiente.
  Trabalho nasce de dev com a taxonomia da política (breaking/,
  feature/, bugfix/, perf/, refactor/, chore/, docs/, test/);
  hotfix/ nasce de main. Formato funcao/descritivo,
  regex ^.{0,15}/\S{0,32}$. Commits em conventional commits, pt-BR.
- Toda mudança entra por PR — push direto em permanente é bloqueado;
  única exceção de push: tags (bot de release) e .release/gate.json
  (bot do gate).
- Comunicação api ↔ engine: eventos via Postgres (transactional outbox na
  api, Oban no engine) + HTTP interno para comandos síncronos.
- Todo evento de domínio é imutável: nunca UPDATE em tabelas de eventos.
- Estados de sessão são máquina de estados explícita:
  created → active → closing → closed | closed_abnormally
- Toda ação com efeito externo (git, terminal, gasto) nasce como
  proposed_action e respeita permissions.json; deny sempre vence allow.
- Agentes rodam SEMPRE dentro de um Harness; nenhuma chamada de LLM ou
  ferramenta fora dele.
- Merge em branch protegida (dev/qa/main) é SEMPRE manual do
  usuário — sem opção de automatizar, garantido por teste.
- Commits de agentes usam identidade "<agente>[bot]" com o usuário
  como co-author.
- Todo desfecho de falha de agente registra a ORIGEM da falha
  (infra | modelo | código | política) — nunca diagnóstico por
  eliminação (lição do ADR 0020).
- Testes: vitest (api/web/scripts de CI), ExUnit (engine). Nenhuma
  feature sem teste do caminho feliz + 1 caso de falha. Providers de
  git validados pela suite de contrato única.
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
- Não versionar à mão: toda tag nasce de workflow
- Não instalar libs sem justificar no plano
- Não refatorar código das fases concluídas fora do necessário para a
  Fase 7

## O que NÃO fazer (adições da FASE 7)
- Não implementar MFA, login social, OIDC provider ou federação —
  backlog registrado no ADR
- Não migrar senhas do Keycloak (inviável e indesejável): fluxo de
  redefinição
- Não escrever docs/reference/api/ à mão — só via geração