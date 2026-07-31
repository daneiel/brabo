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
- FASE 7 — CONCLUÍDA: auth first-party substituindo o Keycloak e
  referência de rotas gerada do OpenAPI — argon2id, access Ed25519,
  rotação de refresh com revogação de família no reuso, lockout
  progressivo, tokens de conta e MailSender log-only (ADR 0031,
  RN-030..033); corte atômico com emissor próprio no guard e RBAC
  intocado, /internal/* com service token, cookie httpOnly + CSRF na
  web, migração de usuários e remoção total do Keycloak (ADR 0032,
  RN-034/035); OpenAPI nos 23 controllers com DTOs travados por tipo
  (Wire<T> + MesmasChaves), teste de tabela exigindo summary/corpo/tag
  da lista fechada, docs/reference/api/ gerado com manifesto de hashes
  no docs:check (ADR 0033).
- Não refatore o que está pronto sem pedido explícito.

## Escopo da FASE 8 (ativa — hierarquia de agentes: leads e subespecialidades)
Regra estrutural nova: todo subagente/especialista responde ao LEAD da
sua área; o lead é o ÚNICO ponto de contato externo da área. ADR antes
de código.

### 8a — Modelo de hierarquia no domínio (genérico, sem agente novo)
1. Áreas: tabela agent_areas {area, lead_agent, members[]} por projeto;
   agente pertence a no máximo uma área; área tem exatamente um lead.
   Agentes sem área (Criativo, PO, Arquiteto, Psicólogo, Anamnese)
   seguem como hoje.
2. Handoff externo só endereça LEAD ou agente sem área — handoff a
   subagente de área é rejeitado no domínio (teste). Delegação interna
   é mecanismo novo: delegations {lead, subagent, task_ref, status,
   parecer_ref}, invisível para fora da área.
3. Consolidação: o lead responde ao handoff com UM artefato
   consolidado (consolidated_verdict em ArtifactSchemas,
   server-emitted) referenciando os pareceres internos —
   rastreabilidade preservada, contrato externo dos gates INALTERADO.
4. Orçamento e falha: budget da área no lead, repassado às delegações
   como sub-budget; subagente estourado/blocked reporta ao lead com
   ORIGEM da falha (ADR 0020), e o lead decide: redistribuir,
   consolidar parcial ou bloquear a área — decisão registrada como
   evento; nunca falha silenciosa de subagente.
5. Dev continua PLANO nesta fase (dev-<modulo> sem lead); extensões
   futuras registradas no ADR (Dev Lead, áreas propostas pelo
   Arquiteto via module_map), não implementadas.

### 8b — Primeira instância: QA como área
6. QA Lead (Gerente de Qualidade) assume o gate awaiting_qa como único
   contato; duas subespecialidades com harness e instruções próprias:
   QA de Automação (herda o QAAgent atual: suite + coverage_matrix) e
   QA de Performance e Segurança (RNFs de performance da story + apoio
   ao checklist de segurança SEM substituir o SecOps, que segue gate
   próprio — fronteira explícita nas instruções de ambos).
7. Delegação é decisão do lead conforme a story (sem RNF de
   performance → "delegação dispensada" registrada com justificativa,
   nunca silêncio); consolidação num veredito único do gate; ciclo K
   de correções e teto de orçamento passam ao nível da ÁREA; falha de
   subespecialidade com origem infra/modelo bloqueia a task com o
   motivo real — não vira changes_requested nem queima correção do dev.

### 8c — Segunda instância: subagente de workflows no Infra
8. Área infra: InfraAgent vira lead (handoff do Arquiteto inalterado);
   subagente Workflows gera pipelines de CI do projeto do usuário
   conforme o provider (GitHub Actions | GitLab CI via capabilities),
   com conhecimento base em docs/explanation/branching-policy.md e no
   ADR 0030; validação local com actionlint (pinado no Dockerfile do
   engine); entrega via delegação → consolidação → PRs pelo fluxo
   normal com gates.

### 8d — UI e fechamento
9. Painel do time agrupado por área (lead com badge, subespecialidades
   aninhadas com status/binding/tokens próprios); delegações e
   dispensas visíveis na linha do tempo da PR (parecer consolidado
   expansível); agente_alvo do Psicólogo e da Anamnese aceita
   subagentes de área.
10. ADR "hierarquia de agentes" fechando: modelo, contratos, e o que
    fica para depois (Dev Lead; áreas dinâmicas do Arquiteto via
    module_map). docmap, catálogos gerados (delegations,
    consolidated_verdict), CHANGELOG e docs verdes.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev
- Auth: first-party no domínio da api (argon2id + access JWT curto +
  refresh opaco com rotação); autorização RBAC no domínio da api
  (inalterada desde a Fase 1)
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
  delegação interna é privada da área (regra da FASE 8).
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
  Fase 8

## O que NÃO fazer (adições da FASE 8)
- Não implementar Dev Lead nem áreas dinâmicas propostas pelo
  Arquiteto via module_map — backlog registrado no ADR da hierarquia
- Não mudar o contrato EXTERNO dos gates (QA/SecOps) ao introduzir
  consolidação — quem consome o parecer continua vendo um veredito por
  gate
- Não deixar falha de subagente silenciosa: toda falha reporta origem
  ao lead, que decide e registra evento