# ADR 0010 — Agente Arquiteto: ADRs via PR real, module_map e validação cruzada

- Status: aceito
- Data: 2026-07-24
- Fase: 3b (sessão final — fecha a Fase 3)

## Contexto

Fecha o ciclo Criativo → PO → **Arquiteto**. Ativado por um handoff aceito do PO, o
Arquiteto produz: (a) **ADRs** commitados em `docs/adr/` do repo DO PROJETO via o pipeline
git da Fase 2, em branch `feature/adr-*`, com **PR real** que o usuário aprova/mergeia;
(b) um **module_map** validado contra ciclos de dependência. Impõe **validação cruzada**
(story só vai a `ready` se todos os módulos que referencia existirem no module_map
vigente) e emite **insights** de tensão regra↔arquitetura.

## Decisões

### 1. ADR = novo ActionType `open_adr_pr` com executor git
As ações git não tinham executor pós-aprovação (`ApproveActionUseCase` só roteava
`terminal`). Adicionamos `open_adr_pr` (efeito git, `require_approval`, min role
maintainer). O tool `propose_adr` do Arquiteto cria a proposed_action (pipeline existente);
ao aprovar, `ApproveActionUseCase` roteia pra `ExecuteAdrPrUseCase`, que via o
`GitProviderContract` (Fase 2) faz `createBranch(feature/adr-<slug>)` +
`commitFiles(docs/adr/<slug>.md)` + `openPullRequest` e grava `executionResult`
{pullRequestUrl, …}. **Duas etapas do usuário**: aprovar a ação (abre a PR) e mergear a PR
real no provider. O merge fica com o usuário (a app só abre a PR — como pede o aceite).

### 2. module_map em tabela própria, validado contra ciclos no domínio
Tool dedicado `create_module_map` (não `emit_artifact`): precisa ser ARMAZENADO pra
validação cruzada. Tabela `module_maps` (histórico imutável; **vigente = maior version**).
`domain/architecture/module-graph.ts` detecta ciclos (DFS) e **recusa** o mapa (erro →
tool-result). Também emite `artifact.module_map` no event log (narrativa).

### 3. Validação cruzada story↔module_map (bloqueio + revalidação)
Stories ganham `module_ids[]` (jsonb). `TransitionStoryUseCase` (draft→ready): além da
prontidão (DoD/DoR/RF/regra), exige que TODOS os `module_ids` existam no module_map vigente
(`assertModulesResolved`) — moduleIds vazio passa (é pendência, não bloqueio, respeitando
as stories da sessão anterior). Um module_map novo **revalida** as stories `ready` e
**rebaixa a draft** as órfãs (módulo removido), com evento `backlog.story_demoted` — que é
a notificação (surge no feed/sino via poll). O Arquiteto vincula módulos às stories com
`assign_story_modules` (valida existência) — é como uma story passa a referenciar módulos
válidos.

### 4. Arquiteto como GenServer com tool `:pipeline`
`ArquitetoServer` espelha o `PoServer` (streaming + loop bounded de tool use + rehydration
+ kickoff). Tools: `create_module_map`/`assign_story_modules`/`emit_insight` (`:direct`) e
`propose_adr` (`:pipeline` → `propose_action`). O **PO** ganhou `offer_handoff` e passa a
oferecer um handoff ao Arquiteto ao fim do kickoff; o usuário aceita (fluxo
`AcceptHandoffUseCase`), ativando o Arquiteto pela mesma regra de ativação da sessão 1.

### 5. Insights como artefato tipado
`emit_insight` grava `artifact.insight` quando o modelo vê tensão regra↔arquitetura (ex.:
RNF sem módulo que o atenda). Sem lógica de domínio — é julgamento do agente, narrado no
feed.

## Consequências

- A visão geral do projeto ganha a seção **Arquitetura**: module_map (módulos com
  `depends_on` em chips), ADRs (link pra a PR + badge de status) e pendências de validação
  cruzada em vermelho. O botão de aceitar handoff na sessão virou genérico (qualquer
  agente), e o composer roteia pro agente ativo mais avançado.
- Testes: domínio (`module-graph` ciclo rejeitado, `module-resolution`), use-case
  (`CreateModuleMap` recusa ciclo + revalida/rebaixa órfã; `TransitionStory` bloqueia ready
  com módulo faltante; `ExecuteAdrPr` com GitProvider fake abre a PR), e `arquiteto_server`
  (kickoff encadeia module_map→assign→ADR→insight; ciclo vira tool-result de erro;
  broadcast; rehydration).

## Escopo

Última sessão da Fase 3. Não implementa agentes de execução (Fase 4). A credencial usada
pra abrir a PR é a do aprovador (`decidedBy`), consistente com o provisionamento (Fase 2).
Sem Bitbucket/GenericGitProvider; filas no Postgres (Oban).
