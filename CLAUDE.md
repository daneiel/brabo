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
- Não refatore o que está pronto sem pedido explícito.

## Escopo da FASE 6 (ativa — CI/CD da política de branches)
Mecanizar a política de branches e versionamento (fonte:
docs/explanation/branching-policy.md — se ainda não existir, criá-lo a
partir da apresentação da política é o PRIMEIRO entregável) no
repositório do Brabo:
1. Rulesets nas 4 permanentes: sem push direto, PR obrigatório, sem
   force-push/delete, checks required; tags só via bot de release.
   Configuração versionada em docs/reference/rulesets.md (aplicação
   manual do usuário).
2. Workflow pr-police (required, lógica em script testável): regex
   ^.{0,15}/\S{0,32}$, prefixo na lista fechada (breaking, feature,
   bugfix, perf, refactor, chore, docs, test, rcfix, hotfix), origem
   por merge-base (trabalho:dev · rcfix:rc · hotfix:main), destino
   coerente, promoção só em par adjacente (dev→qa→rc→main, sem pular),
   label de família (trabalho|promocao|retropropagacao|correcao-alta).
3. Workflow approval-ladder (required, reroda a cada review), com DOIS
   modos controlados por variável de repositório APPROVAL_MODE:
    - solo (ATIVO agora): todo PR de terceiro exige 1 aprovação do
      OWNER (@handle, em variável); PR de autoria do próprio owner
      passa no check sem review (BDFL não se auto-aprova via GitHub —
      o merge manual dele É a aprovação; registrar essa semântica no
      branching-policy.md). A exigência de pessoas distintas fica
      SUSPENSA e documentada como suspensa.
    - community (futuro, implementado e testado desde já, ativado só
      por config): a escada completa por destino — dev: 1 dev · qa: 2
      devs · rc: 1 qualidade + 1 dev · main: 1 PO + 1 gestor; pessoas
      distintas em rc e main. Papéis são LISTAS DE HANDLES em variáveis
      de repositório (APROVADORES_DEVS, _QUALIDADE, _PO, _GESTAO), NÃO
      times do GitHub: times só existem em organização, este repo é de
      usuário, e o GITHUB_TOKEN não lê membership de time nem em org.
      Com listas, community é ativável hoje e o flip é demonstrável.
      Regras comuns aos dois modos: só reviews APPROVED no último commit
      contam; o resumo do check mostra o modo ativo, quem aprovou e o que
      falta. A troca solo→community é APENAS mudar variáveis — com teste
      provando os dois modos.
4. Workflow promote (dispatch restrito ao time de release): calcula a
   versão do ciclo pelo maior impacto dos PRs mergeados (breaking→
   MAJOR, feature→MINOR, senão PATCH), abre PR de promoção listando o
   escopo; check de promoção confere range limpo, tag do degrau
   anterior e merge --no-ff.
5. Versionamento calculado, nunca manual: tags v X.Y.Z-dev.N/-qa.N/
   -rc.N/final criadas por workflow no merge; N incrementa por
   reprovação no ciclo; tag final DEVE apontar para o commit da última
   -rc.N (verificação com falha ruidosa). A tag é o registro do que
   ESTARIA em cada ambiente — vale mesmo sem deploy.
6. Deploy DESLIGADO por ora (variável DEPLOY_ENABLED=false): o
   workflow de tag termina na tag; o passo de deploy existe no
   workflow, testado a seco, mas só executa com a variável ligada.
   Validação local por make deploy-local (Fase 5) consumindo uma tag
   como referência. GitHub Environments NÃO são criados agora; a
   configuração futura fica documentada em docs/reference/
   environments.md como "quando houver ambientes". Ligar deploy no
   futuro = criar environments + flipar a variável, sem mudar código.
7. Backmerge gate: .release/gate.json (locked[], awaiting, order[],
   acúmulo) escrito por workflow no merge de hotfix (trava rc,qa,dev)
   e rcfix (trava qa,dev) — única exceção de escrita direta, pelo bot,
   documentada; PRs de retropropagação abertos automaticamente em
   cadeia; check required em todo PR consulta o gate; destrava por
   branch NA ORDEM; última destrava limpa awaiting.
8. Fechamento: ADR "política de branches mecanizada" mapeando
   regra→mecanismo→o que entra no template do bootstrap de Gitflow do
   produto (fase futura); docs/.docmap.yml atualizado (workflows de
   release → branching-policy.md e reference/).
9. Decisões da política registradas no branching-policy.md: responsável
   de release = owner (único autorizado a disparar promote enquanto
   APPROVAL_MODE=solo); plantão de hotfix = owner (a questão reabre na
   migração para community, onde o fallback deve ser exceção documentada
   no mapa de exigências, nunca burla). O documento deve conter a seção
   "Migração para modo community": pré-requisitos (listas de aprovadores
   preenchidas por papel, critério de quem entra em cada uma) e o passo
   a passo da troca de variáveis. O GOVERNANCE.md citado antes como
   fonte do critério NÃO existe — foi cortado no escopo da FASE DOC; ou
   ele é escrito, ou o critério mora no branching-policy.md.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev
- Auth: Keycloak (OIDC) em container; autorização RBAC no domínio da api
- Deploy: Kubernetes (k3d/kind em validação local)
- Docs: Docusaurus 3.x em website/ lendo de docs/; Mermaid para
  diagramas; busca local
- CI/CD de release: GitHub Actions com lógica em scripts testáveis
  (scripts/ci/, vitest)

## Convenções
- Branches permanentes: dev, qa, rc, main — um branch, um ambiente.
  Trabalho nasce de dev com a taxonomia da política (breaking/,
  feature/, bugfix/, perf/, refactor/, chore/, docs/, test/); rcfix/
  nasce de rc; hotfix/ nasce de main. Formato funcao/descritivo,
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
- Merge em branch protegida (dev/qa/rc/main) é SEMPRE manual do
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
- Não alterar comportamento de runtime do produto nesta fase — a FASE
  6 é CI/CD do repositório; o que ela ensina ao produto vira ADR para
  fase futura, não código agora
- Não versionar à mão: toda tag nasce de workflow
- Não instalar libs sem justificar no plano
- Não refatorar código das fases concluídas fora do necessário para a
  Fase 6