# ADR 0009 — Agente PO, backlog (epics/stories/tasks) e rastreabilidade

- Status: aceito
- Data: 2026-07-24
- Fase: 3b (sessão 2)

## Contexto

A 3b sessão 1 entregou o Criativo conversacional (emite `business_rule`,
consolida `product_brief` e **oferece** handoff ao PO — `handoffs` com status
`offered`, regra de ativação que exige `accepted`). Esta sessão fecha o ciclo:
o usuário **aceita** o handoff, o **PO** é ativado, consome o brief + as regras
e **produz o backlog** (épicos → histórias → tarefas) com DoD/DoR e vínculo
obrigatório a regras de negócio, mantendo rastreabilidade regra→stories.

## Decisões

### 1. PO como GenServer conversacional com loop de tool use por turno
O `Engine.Agents.PoServer` espelha o `CriativoServer` (GenServer por sessão,
estado + rehydration + streaming pelo canal Phoenix), mas **cada turno roda um
loop bounded de tool use**: despacha `create_epic/create_story/create_task` e
**injeta o resultado (id/erro) de volta como mensagem `tool`**, re-chamando o
modelo — assim ele encadeia (id do épico → `create_story` → `create_task`). O
Criativo não faz isso (single-turn). Ativado pelo handoff aceito (não por
comando do usuário), o PO faz um `:kickoff` no start FRESCO (lê o brief + regras
do event log e gera o backlog); restart/reativação não regeram.

### 2. Backlog em tabelas próprias; arrays em JSONB; vínculo a regra por ULID
`epics`/`stories`/`tasks` (migração 0011). Como o projeto **não usa arrays do
Postgres**, RF/RNF/DoD/DoR/`business_rule_ids` são `jsonb` (`$type<string[]>`).
`business_rule_ids` referencia `session_events.id` (o artefato
`artifact.business_rule`) por **texto ULID sem FK** — mesma escolha de
`handoffs.artifact_id` (vínculo lógico, não relacional). Tarefas herdam o
vínculo da história (derivado, não armazenado).

### 3. Prontidão draft→ready validada no DOMÍNIO
`domain/backlog/story-readiness.ts` (`assertReady` → `StoryNotReadyError`) exige
DoD, DoR não vazios, ≥1 RF e ≥1 regra vinculada — "validação no domínio, não só
no prompt". `story-state-machine.ts` cobre `draft→ready→in_progress→done`. O
`create_story` cria em `draft` e promove pra `ready` na mesma operação **quando
a regra é satisfeita** (o PO usa só as 3 ferramentas nomeadas — não há tool de
transição); `TransitionStoryUseCase` expõe a transição explícita (testada) e
serve os estados futuros.

### 4. Ferramentas do PO passam pela api (nunca SQL/insert direto)
`create_epic/create_story/create_task` são tools `:direct` que chamam o
`EngineApiClient` → endpoints internos → use-cases com validação de domínio.
`CreateStoryUseCase` **valida que cada `business_rule_id` referencia mesmo um
evento `artifact.business_rule` existente** (recusa ids inventados; nada é
criado). Cada criação emite `backlog.*` no event log (narrativa do PO).

### 5. Rastreabilidade regra→stories (pendência = descoberta)
`domain/backlog/coverage.ts` (`computeCoverage`, puro) + `GET /projects/:id/
coverage`: para cada `artifact.business_rule` do projeto, quais histórias a
cobrem (via `business_rule_ids`). Regra sem cobertura é uma **descoberta** — a
UI a mostra em vermelho na tab Backlog. Nível de projeto (agrega as regras das
sessões via join em `sessions`).

### 6. Aceitar handoff ativa o PO pela regra da sessão 1
`AcceptHandoffUseCase` (ação do usuário): `offered→accepted` + `handoff.accepted`
→ chama `ActivateAgentUseCase` pro `toAgent`. A regra de ativação (que exige um
handoff `accepted`) agora passa exatamente por causa desta aceitação. UI: botão
"Aceitar handoff e iniciar PO" na sessão.

## Consequências

- A tab Backlog é project-level (estado local, sem rota nova), lida do poll de
  `GET backlog` + `GET coverage` — reflete o PO gerando em tempo real.
- O composer da sessão roteia pro agente ativo (PO tem precedência sobre o
  Criativo) via `sendAgentMessage`.
- Testes: domínio (`story-readiness`, `story-state-machine`, `coverage`),
  use-case (`create-story` recusa regra inexistente; `transition-story` rejeita
  draft→ready sem DoD), e `po_server_test` (kickoff encadeia create_epic→
  create_story com injeção de resultado; regra inválida vira tool-result de
  erro sem derrubar o loop; broadcast; rehydration).

## Escopo

Só o PO + backlog + rastreabilidade. O **Arquiteto** (ADRs em docs/adr/ do repo
do projeto, `module_map`, validar que story referencia módulo existente) é a
próxima sessão. `in_progress`/`done` e edição manual do backlog na UI ficam pra
depois (a máquina de estados já cobre).
