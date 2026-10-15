# ADR 0088 — Staff: código pronto, dormente para disparo automático

- **Status:** Aceito
- **Data:** 2026-08-16
- **Contexto:** `docs/fluxo.yml`, bloco `id: staff` (`camada_decisao_tecnica`),
  `status: planned` desde o ADR 0085
- **Precedente direto:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  (Dev Lead — agente conversacional solo, sem área),
  [ADR 0068](0068-diagrama-c4-do-arquiteto.md) (artefato sem tabela,
  versionado no event log)

## Contexto

`docs/fluxo.yml` declara o Staff/Principal Engineer desde o ADR 0085 como
`status: planned`: "contrato pronto, ativação decidida, aguarda gatilho". O
gatilho pensado para ele é a Anamnese notando um problema sistêmico
RECORRENTE — mas a Anamnese está pausada (`ANAMNESE_ENABLED=false`, decisão
de produto de 2026-08-10) e não vai propor handoff nenhum enquanto durar.

O dono do produto decidiu antecipar o CÓDIGO mesmo sabendo que o gatilho
automático não vai disparar: o Staff fica pronto e acionável MANUALMENTE
(qualquer agente ou o usuário pode endereçar um handoff a ele hoje, pela
rota interna genérica), e só o disparo automático segue pendente. Isto NÃO
é meia-implementação — é a mesma distinção que o ADR 0081 já fez para o
ciclo de vida do container (tabela pronta, orquestrador ainda não): a peça
que falta é declarada, não escondida.

## Decisão

**O Staff nasce como o QUINTO agente conversacional solo** (ao lado de
Criativo, PO, Arquiteto e Dev Lead), espelhando exatamente o molde do
Arquiteto — GenServer por sessão, rehydration do event log, laço bounded de
tool use próprio (teto 14, mesmo calibre de Arquiteto/Dev Lead:
raciocínio, não conversa leve) — com duas diferenças deliberadas.

### 1. Sem `kickoff/1`

Todos os outros leads conversacionais sintetizam uma instrução de abertura
a partir do event log da sessão no start FRESCO (`kickoff_instruction/1` em
cada um) — há sempre um artefato anterior (product_brief, module_map,
backlog) para resumir. O Staff não tem essa fonte: o problema sistêmico que
o traria à tona nasce de fora (Anamnese, quando existir, ou de quem cria o
handoff manualmente hoje), não do event log da própria sessão. Sem kickoff,
`Engine.Agents.StaffSupervisor.start_agent/2` sobe o processo (rehidrata o
histórico) e ele fica ocioso até a primeira `user_message` — que é como
quem endereçou o handoff explica o problema.

`apps/engine/lib/engine_web/controllers/agent_command_controller.ex` reflete
isto: a cláusula `start/2` de "staff" NUNCA chama `StaffServer.kickoff/1`
(a função nem existe), ao contrário de po/arquiteto/dev-lead/infra, que
chamam condicionalmente quando `origin == :started`.

### 2. Ativação: o caminho GENÉRICO, sem `USER_STARTED_AGENTS`

`USER_STARTED_AGENTS` (`apps/api/src/domain/sessions/agent-activation.ts`)
é a exceção do Criativo — inicia SEM handoff, por comando direto do
usuário. Investigação confirmou que o Staff NÃO precisa entrar nessa
lista: `canActivateAgent` já ativa qualquer agente com um handoff
`accepted` endereçado a ele, o mesmo caminho que já vale para
`dev-lead`/`arquiteto`/`infra` hoje. Nenhuma mudança de domínio foi
necessária na api para isto:

- `assertHandoffTargetAllowed` (`apps/api/src/domain/agents/agent-areas.ts`)
  só RECUSA handoff endereçado a um SUBAGENTE de área (ADR 0038); o Staff
  não tem área — passa livre, como Criativo/PO/Arquiteto/Dev Lead.
- `ActivateAgentUseCase`/`ApiToEngineClient.startAgent` são genéricos em
  `agent: string` — nenhum enum a estender.

A consequência é honesta: "acionável manualmente" significa que a
MECÂNICA de domínio permite o handoff e a ativação, não que existe hoje
uma tela dedicada para um humano escolher "endereçar handoff ao Staff"
sem ser via código de outro agente ou chamada direta à rota interna
(`POST .../internal/sessions/:sessionId/handoffs`) — a UI genérica de
"handoff manual a agente à escolha" segue no backlog
(`docs/explanation/backlog.md`), como já estava antes desta mudança.

### 3. `propose_rfc` — a única ferramenta, sem `proposed_action`

`Engine.Agents.StaffTools.propose_rfc` grava `artifact.rfc_staff` (problema,
opções com trade-offs, recomendação, PoC descartável) e devolve o handoff
ao Arquiteto no MESMO tool call — sem confirmação humana no meio, mesmo
padrão de `CriativoServer` emitindo o product_brief e oferecendo o handoff
ao PO na mesma resposta.

Dois precedentes reais decidiram o mecanismo, e por isso NENHUM caso de uso
novo nasceu na api:

- `Engine.Harness.Tools.EmitInsight` (o `emit_insight` do Arquiteto) é o
  padrão de artefato SEM derivação: o payload inteiro vem do tool call, e o
  evento é gravado direto via `EngineApiClient.append_event_returning/3` —
  sem tabela, sem caso de uso dedicado.
- `artifact.c4_diagram` (ADR 0068) é o CONTRASTE que confirma a escolha: ele
  tem caso de uso próprio na api porque o nível Container é DERIVADO do
  `module_map` vigente — só a api tem esse dado. O RFC não deriva nada do
  lado de lá.

`propose_rfc` também NÃO é `proposed_action`: registrar um documento de
arquitetura não é efeito externo (não é git, terminal, nem gasto de
agente) — a decisão real (adotar, adaptar, recusar) é do Arquiteto, no
handoff que a ferramenta já devolve. Mesmo raciocínio de `emit_insight`.

## Consequências

**A favor**

- O Staff existe de ponta a ponta no engine (servidor, ferramenta,
  supervisor, roteamento) e é testável hoje, sem esperar a Anamnese sair de
  refinamento — quando ela voltar, só falta o CÓDIGO da Anamnese chamar
  `create_handoff(..., "staff", ...)`; o resto já está pronto.
- Nenhuma mudança de domínio na api foi necessária para a ativação — a
  investigação provou que o caminho genérico já bastava, evitando abrir uma
  exceção nova (`USER_STARTED_AGENTS`) que precisaria ser revogada depois.
- `docs/fluxo.yml` deixa de ser a única fonte que sabe que o Staff existe:
  o código bate com o que o registro já declarava, com a lacuna real
  (gatilho automático) precisa e não mais genérica ("aguarda gatilho").

**Contra, declarado**

- **A roster do painel do time (`apps/web/src/lib/agent-status.ts`) e o
  card do dashboard (`ProjectCardSummary.roster`, via
  `apps/api/.../projects-summary.repository.ts`) mostram o Staff quando
  ativo** — `staffActive` foi adicionado nos dois caminhos, no mesmo
  critério de `infraActive`, para não repetir a divergência que o
  comentário de `RosterFacts` já alertava ("duas regras divergiriam no
  primeiro agente novo").
- **A tela de Sessão (`SessionPage.tsx`) NÃO foi tocada.** `staff` não
  entra em `AGENTES_DE_CHAT` — o mesmo padrão já aceito para `infra`
  (agente REAL, ATIVO, e também fora dessa lista: o comentário do próprio
  arquivo documenta que o handoff para Infra "nunca é aceito por AQUI").
  Isto não é lacuna NOVA do Staff: é o padrão que o produto já tinha para
  um lead sem conversa dirigida pela composer da sessão. Diferença real
  declarada: Infra tem `kickoff/1` (roda sozinho após aceito); o Staff não
  — então, sem uma superfície de chat que envie a primeira `user_message`
  para ele, o caminho ponta a ponta de uso hoje é a rota interna
  (`POST .../agent/message`, `agent: "staff"`), não a tela. Fechar isto é
  tocar `SessionPage.tsx`, o arquivo mais disputado do produto, e não fazia
  parte desta decisão — antecipar o código, não a UI de chat.
- Sem entrada em `Engine.Harness.Agents.identity/1`
  (`apps/engine/lib/engine/harness/agents.ex`) — mesmo estado do `dev-lead`
  hoje, que também cai no fallback genérico ("Você é o agente staff.").
  Não é lacuna NOVA: é o estado real de um precedente ativo, não corrigido
  de passagem.

## Alternativas consideradas

**Esperar a Anamnese sair de refinamento para construir o Staff.** Recusada
— decisão explícita do dono do produto: antecipar o código elimina o
"segundo PR" no dia em que a Anamnese religar, e o valor de acionamento
MANUAL existe independente do gatilho automático.

**Adicionar `staff` a `USER_STARTED_AGENTS`.** Recusada — a investigação
mostrou que não é necessário: o caminho padrão de `canActivateAgent` já
ativa por handoff aceito, e essa lista existe para a exceção OPOSTA (agente
que inicia SEM handoff). Adicionar aqui inventaria uma regra que o domínio
não pede.

**Dar ao Staff `kickoff/1` com uma instrução genérica ("investigue
problemas sistêmicos").** Recusada — sem um artefato real para resumir (o
que só a Anamnese vai produzir), o kickoff seria um convite vazio; a
sessão fica ociosa até a primeira mensagem, e é honesto que fique.

## Referências

- `docs/fluxo.yml` — bloco `id: staff`
- `docs/business-rules.md` — RN-305/RN-306
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — o molde de agente
  conversacional solo sem área
- [ADR 0068](0068-diagrama-c4-do-arquiteto.md) — o contraste que decide
  "sem caso de uso dedicado" para o RFC
- [ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md) —
  o precedente de "peça pronta, consumidor real ainda não" declarado sem
  atenuar
- `apps/engine/lib/engine/agents/staff_server.ex`, `staff_tools.ex`,
  `staff_supervisor.ex`
- `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
- `apps/api/src/domain/sessions/agent-activation.ts`,
  `apps/api/src/domain/agents/agent-areas.ts`
- `apps/web/src/lib/agents.ts`, `apps/web/src/lib/agent-status.ts`
