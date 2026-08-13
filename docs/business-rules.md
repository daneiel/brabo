---
id: business-rules
title: Regras de negócio
sidebar_label: Regras de negócio
sidebar_position: 3
description: As regras de domínio do Brabo, numeradas, com onde vivem no código e o teste que cobre cada uma.
keywords: [regras de negócio, domínio, máquina de estados, aprovação, RBAC]
---

# Regras de negócio

Cada regra tem **enunciado**, **onde vive** (`arquivo:linha`) e **o teste que a
cobre**. Se você mudar uma regra, atualize a linha aqui na mesma mudança — é o
que o [`.docmap.yml`](https://github.com/daneiel/brabo/blob/dev/docs/.docmap.yml)
exige com severidade `block`.

Todas moram em `apps/api/src/domain/`, que é **puro**: sem IO, sem framework,
sem banco. É por isso que cada uma tem teste unitário rápido e determinístico.

## Contexto de negócio

O Brabo executa trabalho de engenharia através de agentes de IA. Duas forças
moldam praticamente toda regra aqui:

**O agente não é confiável por construção.** Ele é um modelo de linguagem: pode
alucinar, entrar em laço, ou pedir algo destrutivo. As regras existem para que
o dano possível seja limitado por estrutura, não por qualidade do prompt.

**O gasto é real e contínuo.** Cada turno consome token pago. Orçamento, teto e
metering não são recursos administrativos — são o que impede um laço de agente
de virar prejuízo.

### Atores

| ator | quem é | autoridade |
|---|---|---|
| **Usuário** | a pessoa. Papéis: `viewer`, `developer`, `maintainer`, `owner` | decisão final sobre toda ação com efeito externo; merge é exclusivamente dele |
| **Agente** | processo de longa duração com um papel (Criativo, PO, Arquiteto, Dev, Infra, QA, SecOps, Psicólogo, Anamnese) | propõe; nunca decide sozinho o que a política não permitir |
| **Sistema** | api e engine | aplica a política, registra o evento, mede o custo |

O vocabulário está no [glossário](glossary.md).

---

## Sessão

### RN-001 — A sessão tem cinco estados e transições fechadas {#rn-001}

`created → active → closing → closed`, com `closed_abnormally` alcançável de
qualquer estado não-terminal. **De `closing` nunca se volta para `active`**, e
estados terminais não têm saída.

```mermaid
stateDiagram-v2
  [*] --> created
  created --> active
  created --> closed_abnormally: falha de provisionamento
  active --> closing
  active --> closed_abnormally
  closing --> closed
  closing --> closed_abnormally
  closed --> [*]
  closed_abnormally --> [*]
```

- **Onde:** `apps/api/src/domain/sessions/session-state-machine.ts:29`
- **Teste:** `test/domain/sessions/session-state-machine.spec.ts`
- **Borda:** `closing` é estado de **passagem**. Sessão parada ali significa que
  o drain começou e não completou — há alerta para isso, ver o
  [runbook](runbook.md).

### RN-002 — Todo evento de sessão é imutável e a `seq` é densa {#rn-002}

Nunca há `UPDATE` em `session_events`. A `seq` é única por sessão
(`unique(session_id, seq)`) e não tem buraco: começa em 1 e é contínua.

- **Onde:** `apps/api/src/db/schema.ts` (tabela `session_events`)
- **Teste:** verificado no restore — `docker/backup/restore.sh` reprova se
  `count(*) ≠ max(seq) − min(seq) + 1` ou `min(seq) ≠ 1`
- **Por quê:** é o que torna a evidência do Psicólogo rastreável e o backup
  verificável. Estado que precisa mudar vive em tabela própria, ao lado.

### RN-097 — O tipo da sessão é intenção de criação; a execução continua sendo evento {#rn-097}

A sessão nasce `consultiva` ou `criativa`, escolhido por **quem a abre** e
gravado em `sessions.kind`. `consultiva` é só conversa; `criativa` é a que
produz — abre a ideação com o Criativo e é a **única** que entra em execução.
O tipo **não muda**: não existe rota que o troque.

O risco desta regra não é o campo, é a **segunda fonte de verdade**. O produto
já sabia dizer se uma sessão está executando, e sabia por outro caminho:
`findActiveExecutionSession` procura a sessão `active` que carrega o evento
`execution.activated` (é o que faz reativar cair na sessão onde os dev agents
já estão, achado #11 do primeiro dogfooding). As duas coexistem sob uma regra
que as impede de brigar:

- **`kind` classifica a INTENÇÃO de criação.** Uma sessão `criativa` que nunca
  ativou execução **não** é a sessão de execução vigente, e a derivação por
  evento continua sem olhar `kind` — se passasse a olhar, toda sessão criativa
  aberta viraria candidata a receber os dev agents.
- **O evento classifica o ESTADO de execução**, como sempre.
- **`execution.activated` numa sessão `consultiva` é ERRO** (409), nunca
  conversão silenciosa. É este ponto que decide qual das duas fontes manda:
  deixar o evento promover o tipo seria exatamente tê-las escrevendo uma sobre
  a outra.

A trava mora no **funil** — `AppendSessionEventUseCase` —, e não no
`ActivateExecutionUseCase`, porque os dois caminhos que gravam evento (a rota
do usuário e a `/internal/*` do engine) passam por ele. A leitura extra da
sessão é paga só quando o evento é o de execução. A recusa acontece **antes**
do `incrementSeq`: uma tentativa recusada não pode consumir `seq`, ou a
[RN-002](#rn-002) cairia.

O DEFAULT da coluna é `consultiva` — o tipo que pode **menos**: linha que
chegue por caminho que não passa pela rota (migração, SQL de manutenção) não
ganha o direito de executar. O **backfill** da migração faz o contrário e é
dirigido, pelo raciocínio da 0033: no instante em que ela roda, toda sessão é
anterior à distinção, e algumas são as sessões em que os dev agents estão
trabalhando — acordar `consultiva` faria a reativação de um projeto em
andamento falhar sem ninguém ter decidido nada.

- **Onde:** `apps/api/src/domain/sessions/session-kind.ts:50`
  (`podeAtivarExecucao`), `apps/api/src/db/schema.ts:392` (a coluna),
  `apps/api/src/application/use-cases/sessions/append-session-event.use-case.ts:53`
  (a trava)
- **Teste:** `apps/api/test/application/use-cases/sessions/session-kind-e-nome.spec.ts`
- **Origem:** [ADR 0061](adr/0061-tipo-da-sessao-na-criacao.md)

### RN-098 — O nome da sessão se soma à hashtag, nunca a substitui {#rn-098}

A sessão pode receber um nome amigável (`sessions.name`, opcional), na criação
ou depois, por `PATCH /projects/:projectId/sessions/:sessionId`. O rótulo na
tela é **composto**: `<nome> · #<8 primeiros caracteres do id>`. Sem nome,
degrada para a **hashtag sozinha**.

A hashtag nunca sai, e o motivo é operacional: é ela que se cola numa URL, num
comando ou numa conversa, e um nome escolhido por pessoa **não é único** — duas
sessões chamadas "Checkout" são normais. Nome em branco (ou só espaço) conta
como **ausência**, na criação e na renomeação: gravar `''` faria o rótulo virar
`" · #a1b2c3d4"`, pior que a hashtag sozinha. `null` no corpo do `PATCH` é o
caminho de **desfazer**.

Renomear **não** é evento de sessão. O event log é o que a sessão viveu, e o
nome é rótulo de navegação, trocado quantas vezes se quiser — N eventos de
renomeação empurrariam para fora da cauda de 200 exatamente o que interessa.

- **Onde:** `apps/web/src/lib/session-label.ts:50` (`rotuloDaSessao`),
  `apps/api/src/application/ports/session-repository.port.ts:52` (`rename`).
  Alcançável tanto de dentro da sessão
  (`apps/web/src/routes/SessionPage.tsx:445`, `handleRename`) quanto da lista
  do projeto, sem precisar abrir a sessão primeiro
  (`apps/web/src/routes/ProjectSessionsTab.tsx:101`, `handleRenomear`) — as
  duas telas chamam o mesmo `renameSession` e a mesma `rotuloDaSessao`.
- **Teste:** `apps/web/src/lib/session-label.test.ts`,
  `apps/api/test/application/use-cases/sessions/session-kind-e-nome.spec.ts`,
  `apps/web/src/routes/ProjectSessionsTab.test.tsx`
- **Origem:** [ADR 0061](adr/0061-tipo-da-sessao-na-criacao.md)

### RN-104 — A aba deriva do tipo gravado, e cria naquele tipo {#rn-104}

O projeto tem **duas** abas de sessão — **Criativo** e **Chat** —, e cada uma é
um `kind`: ela lista as sessões cujo `sessions.kind` é o dela e o CTA dela cria
naquele `kind`, **sem perguntar de novo**. Não existe terceira aba listando os
dois juntos.

O tipo já era imutável ([RN-097](#rn-097)), e é isso que o torna uma coordenada
de navegação legítima em vez de um filtro salvo: uma sessão nunca troca de aba.
A aba lê o campo **gravado** — não deriva o tipo de evento nenhum, pelo mesmo
motivo da RN-097: `execution.activated` classifica ESTADO de execução, e uma
aba que olhasse para ele mudaria de lugar sozinha.

Duas consequências que a regra fixa, e que não são detalhe de tela:

- **A escolha de tipo sai do formulário.** Ela existia num `fieldset` de
  rádios, e agora aconteceu quando a pessoa clicou na aba. Manter os dois
  ofereceria a chance de criar uma sessão que contradiz o lugar em que se está.
  O que sobrou no formulário é o **nome**, que segue opcional
  ([RN-098](#rn-098)).
- **Uma ação, um lugar de cada vez.** "Iniciar ideação" continua existindo —
  ele é o que traz o Criativo para a sessão, e a partir daí a chave do owner
  passa a ser gasta ([RN-058](#rn-058)); ninguém entra sozinho. O que mudou é
  onde ele mora: **dentro do convite** enquanto o convite está na tela, e na
  topbar quando ele não está. O convite antes APONTAVA para a topbar ("use
  Iniciar ideação, no alto da tela"), que é a versão literal do problema que
  originou a [RN-097](#rn-097) — a ação num lugar e a explicação em outro. A
  topbar não pode simplesmente perder o botão: dá para digitar numa sessão
  criativa sem nunca ter chamado o Criativo, e aí o convite sai de cena.

As três telas respeitam os três estados da [RN-088](#rn-088), com **erro antes
de vazio**: a lista filtrada está vazia nos dois casos, e dizer "nenhuma
ideação ainda" depois de um 429 seria mentir sobre o que aconteceu.

A chave de deep-link do Chat continua sendo `sessions`, e não `chat`. É o que
faz um `?tab=sessions` guardado em link antigo abrir no Chat **com a aba
marcada na régua** — resolver a chave velha como alias só no painel deixaria a
régua sem seleção nenhuma, porque `Tabs` compara `active` com `key` e quem
escreve `active` recebe a chave crua do `validateSearch`.

- **Onde:** `apps/web/src/routes/project-tabs.ts:95` (as duas entradas),
  `apps/web/src/routes/ProjectSessionsTab.tsx:114` (o filtro pelo `kind`
  gravado) e `:98` (o CTA criando no `kind` da aba),
  `apps/web/src/routes/SessionPage.tsx:553` (`conviteVisivel`, a única pergunta
  que a topbar e o convite compartilham)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx`,
  `apps/web/src/routes/project-tabs.test.tsx`,
  `apps/web/src/routes/SessionPage.sessao.test.tsx`
- **Borda:** projeto sem nenhuma sessão daquele tipo mostra o vazio DO TIPO,
  mesmo tendo sessões do outro — é informação, não erro.
- **Origem:** [ADR 0061](adr/0061-tipo-da-sessao-na-criacao.md)

### RN-123 — Sessão criativa sem o Criativo ativo: a primeira mensagem TAMBÉM o ativa {#rn-123}

Numa sessão `kind: 'criativa'` ([RN-097](#rn-097)) sem `agent.activated`
nenhum ainda, mandar a primeira mensagem pelo composer ativa o Criativo
primeiro (aguardando a ativação terminar) e só depois entrega essa mensagem a
ele pelo caminho real (`sendAgentMessage` — histórico, system prompt, tool
`emit_artifact`). Antes desta regra, quem escrevia sem clicar em "Iniciar
ideação" caía num chat SSE genérico sem histórico nem regras de negócio: NÃO
era o Criativo de verdade, e a conversa não registrava nada no domínio.

O clique em "Iniciar ideação" continua existindo ([RN-104](#rn-104)) — é ele
que segue disparando a ativação quando a pessoa prefere o gesto explícito, e é
dele que a chave do owner ([RN-058](#rn-058)) passa a ser gasta em qualquer um
dos dois caminhos. O que mudou é que a PRIMEIRA MENSAGEM também conta como
esse gesto: ninguém deveria precisar de um clique separado antes de falar com
quem a tela já convidou a falar.

- **Onde:** `apps/web/src/routes/SessionPage.tsx:627` (`handleSend`)
- **Teste:** `apps/web/src/routes/SessionPage.ideacao-automatica.test.tsx`
- **Borda:** sessão `consultiva` não tem Criativo — a regra não se aplica, e o
  caminho SSE genérico continua sendo o certo pra ela.

### RN-119 — O agente ATIVO da sessão é o de `agent.activated` mais recente — nunca uma cadeia fixa {#rn-119}

`SessionPage` decide duas coisas a partir do MESMO agente: pra quem a
mensagem do composer vai, e de qual agente a topbar resolve o modelo exibido
(a cascata completa sessão→agente→área→projeto→workspace, a mesma que
`RunLlmTurnUseCase` usa pra rodar o turno de verdade). As duas perguntas
tinham respostas DIFERENTES antes desta regra: o roteamento usava uma cadeia
de precedência fixa (arquiteto > po > criativo, baseada em EXISTÊNCIA
histórica — "já ativou alguma vez", que nunca "desligava"), e o modelo
exibido nem sabia quem estava ativo — a rota de model-binding não recebia
agente nenhum e caía sempre no fallback fixo do Criativo
(`herdarModeloDeStart`), mesmo depois de um handoff pro PO, Arquiteto ou Dev
Lead.

A definição única: o agente ATIVO é o de `agent.activated` mais RECENTE (por
`seq`), entre os agentes conversacionais do fluxo de chat (Criativo, PO,
Arquiteto, Dev Lead). **Infra Lead fica de fora**: `agent_command_controller.ex`
(engine) só tem rota de `message` pra po/dev-lead/arquiteto (mais Criativo,
como fallback implícito da última cláusula) — Infra nunca teve `message`
wireada, só `start`. Mandar mensagem pra "infra" hoje cairia em silêncio no
Criativo; tratá-lo como agente ativo do composer reabriria essa armadilha em
vez de fechar uma.

- **Onde:** `apps/web/src/routes/SessionPage.tsx:273` (`activeAgent`),
  `apps/web/src/lib/api-client.ts:773` (`getSessionModelBinding`, o
  `agentId`), `apps/api/src/interfaces/http/llm/model-bindings.controller.ts:147`
  (`getSessionBinding`, `@Query('agentId')`)
- **Teste:** `apps/web/src/routes/SessionPage.agente-mais-recente.test.tsx`,
  `apps/web/src/routes/SessionPage.modelo-do-agente-ativo.test.tsx`,
  `apps/api/test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
- **Borda:** Infra Lead não participa do roteamento do composer nem da
  definição de "agente ativo" — ele é propositivo (Fase 4), não
  conversacional pelo composer.

### RN-120 — O poll de eventos da sessão pausa durante um turno em andamento {#rn-120}

`useSessionEvents` buscava eventos a cada poucos segundos SEM nenhuma
consciência de turno em andamento. Se o poll caísse DURANTE um turno (comum —
turnos costumam durar mais que o intervalo), ele trazia `chat.message`/
`agent.response` já persistidos, que renderizavam AO LADO do estado
otimista/streaming ainda em tela: a mesma mensagem, duas vezes.

A correção pausa só o TIMER (`refetchInterval`) enquanto `streaming` é
`true` — a query continua `enabled`, então a invalidação explícita que já
dispara no fim do turno (`finalizarTurnoDoAgente`) continua buscando o dado
fresco na hora certa. `pausarPoll` é parâmetro OPCIONAL, default `false`: os
outros consumidores do hook (Overview, Code, Provisioning, AdoptionPlan) não
têm turno conversacional em andamento e continuam como estavam.

- **Onde:** `apps/web/src/lib/hooks.ts:135` (`useSessionEvents`),
  `apps/web/src/routes/SessionPage.tsx:208` (`eventsQuery`)
- **Teste:** `apps/web/src/lib/hooks.pausar-poll.test.tsx`
- **Borda:** pausar o timer não é desligar a query — a invalidação explícita
  continua funcionando, e é dela que a correção depende pra nunca perder
  dado.

### RN-122 — O botão "Parar" cancela o turno DE VERDADE, matando a task que segura a chamada ao LLM {#rn-122}

Até aqui não existia cancelamento em lugar nenhum. A raiz era estrutural:
`agent_command_controller.ex` atendia a mensagem do usuário com
`GenServer.call(pid, {:user_message, texto}, ...)` — SÍNCRONO — e o turno
inteiro (loop de ferramentas + chamada SSE ao LLM) rodava DENTRO do
`handle_call`. O processo do agente ficava bloqueado até o turno acabar e não
atendia NENHUMA outra mensagem nesse meio tempo — nem um futuro comando de
cancelar.

A correção: o `handle_call`/`handle_cast` de turno dos quatro agentes
conversacionais (Criativo, PO, Arquiteto, Dev Lead) sobe uma
`Task.Supervisor.async_nolink/2` (`Engine.Agents.TurnoAssincrono`, novo,
compartilhado pelos quatro) com o trabalho pesado e devolve `{:noreply,
state}` — a resposta ao `GenServer.call` original fica ADIADA até a task
terminar (`GenServer.reply/2`, disparado quando `{ref, resultado}` chega em
`handle_info`). Como o processo do agente PARA de ficar bloqueado, um novo
`handle_cast(:cancel, state)` chega e é atendido enquanto o turno roda:
`Task.shutdown/2` no modo `:brutal_kill` mata a task, o que derruba a conexão
HTTP (SSE) que ela segura com a api — é isso que faz o cancelamento economizar
token de verdade, e não só parar de renderizar no cliente. O `from` original
recebe `{:error, :cancelado}`, e um `agent.error` TERMINAL é gravado com
origem `"politica"` (a mesma origem de orçamento/credencial/binding — cancelar
é uma decisão do usuário de não gastar mais token, não um quinto valor do
vocabulário fechado do ADR 0020) — sem ele, `GetSessionPendingWorkUseCase`
veria `agent.activated` sem `agent.response`/`agent.error` posterior e a
sessão ficaria pendurada pro sinal de pendência.

Duas mensagens concorrentes pro mesmo agente (usuário manda de novo enquanto
um turno já roda) nunca sobem uma segunda task: `TurnoAssincrono.iniciar/3`
responde `{:error, :turno_em_andamento}` na hora.

- **Onde:** `apps/engine/lib/engine/agents/turno_assincrono.ex` (o
  mecanismo), `apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  (os quatro `handle_call`/`handle_cast` de turno), `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:170`
  (`cancel/2`), `apps/engine/lib/engine_web/router.ex` (`POST
  /internal/sessions/:sessionId/agent/cancel`),
  `apps/api/src/application/use-cases/agents/cancel-agent-turn.use-case.ts`,
  `apps/api/src/interfaces/http/agents/agents.controller.ts` (`POST
  /projects/:projectId/sessions/:sessionId/agents/:agent/cancel`),
  `apps/web/src/routes/SessionPage.tsx` (`handleCancel`, botão "Parar" no
  composer)
- **Teste:** `apps/engine/test/engine/agents/turno_assincrono_test.exs` (a
  task morre DE VERDADE — `Process.alive?/1` antes e depois — e não só
  "parou de importar o resultado"), `apps/api/test/application/use-cases/agents/cancel-agent-turn.use-case.spec.ts`
- **Borda:** cancelar sem turno em curso é NO-OP idempotente — não existe
  task para matar nem `from` pendente para responder. O cancelamento NÃO
  desfaz efeito colateral que já tenha rodado ANTES de a task morrer (ex.:
  uma ferramenta que já tinha sido despachada e gravado seu evento) — só
  interrompe o que ainda não aconteceu.
- **Origem:** investigação desta sessão; sem ADR próprio (mudança de padrão
  de concorrência DENTRO do harness, não de fronteira de camada/banco).

### RN-142 — Confirmar prontidão sem NENHUMA regra de negócio é recusado pelo engine, não só escondido na UI {#rn-142}

Antes, clicar "Estou pronto para produzir" — ou chamar a rota direto —
SEMPRE criava o `product_brief` e oferecia o handoff ao PO, mesmo numa
conversa em que zero regras de negócio tivessem sido capturadas.
`business_rule_refs(state)` já existia em `criativo_server.ex`, mas só para
POPULAR o campo `"rules"` do brief — nunca como condição de bloqueio. Na UI,
`SessionPage.tsx` desabilitava o botão apenas durante `streaming`, sem
checar a contagem de regras.

A garantia de verdade tinha que ficar no servidor, não na tela: quem chama a
rota direto (ou um cliente futuro que não seja este frontend) não pode
furar o guardrail só porque o botão está desenhado desabilitado.
`CriativoServer.handle_call(:confirm_readiness, ...)` agora checa
`business_rule_refs(state)` ANTES de subir a `Task` de
`Engine.Agents.TurnoAssincrono` ([RN-122](#rn-122)) — vazio, recusa ali
mesmo, sem rodar o turno de consolidação, sem `product_brief`, sem handoff.

A recusa não vira 4xx HTTP: `agent_command_controller.ex#readiness/2` IGNORA
o retorno deste `GenServer.call` e sempre responde 202, o mesmo padrão que
`message/2` já usa desde a RN-122 ("esta resposta é só o aceite" — o
desfecho de verdade vive no event log). Por isso a recusa é narrada como
`agent.error` DURÁVEL (RN-059), com origem `"politica"` — é decisão de
produto, não falha de infra/modelo/turno — e mensagem explicando por quê; o
fio da sessão já sabe renderizar esse tipo de evento (`lerFalhaDeTurno`,
mesmo balão vermelho de qualquer outra falha de turno).

A UX complementar, em `SessionPage.tsx`: o botão nasce `disabled` (com
`title` explicando o motivo) enquanto `events` não tem nenhum
`artifact.business_rule` — a MESMA fonte que já alimenta o painel "Regras de
negócio" (`ContextAside`), sem uma segunda leitura que pudesse divergir da
primeira.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`handle_call(:confirm_readiness, ...)`, `emit_falha_sem_regra/1`),
  `apps/web/src/routes/SessionPage.tsx` (`hasBusinessRule`, o botão "Estou
  pronto para produzir")
- **Teste:**
  `apps/engine/test/engine/agents/criativo_server_test.exs` ("prontidão:
  recusa quando NENHUMA regra de negócio foi capturada" — nem turno, nem
  brief, nem handoff; a recusa narrada com origem `"politica"`),
  `apps/web/src/routes/SessionPage.readiness-exige-regra.test.tsx` (botão
  desabilitado sem regra, habilitado com 1+)
- **Borda:** a sessão já tinha `readiness.confirmed` gravado pela api
  ANTES de sinalizar o engine (`ConfirmReadinessUseCase`) — isso não muda:
  é o registro do CLIQUE do usuário, um fato que aconteceu independente do
  engine aceitar ou recusar em seguida.
- **Origem:** investigação de código confirmando um relato do usuário —
  nenhum ADR (guardrail novo sobre fluxo já existente, sem mudança de
  fronteira de camada/banco).

---

## Aprovação de ações

O coração do sistema. Toda ação com efeito externo nasce como
`proposed_action`.

### RN-003 — A ação tem seis estados, e negada é terminal {#rn-003}

```mermaid
stateDiagram-v2
  [*] --> pending
  [*] --> auto_approved: política permitiu
  pending --> approved: usuário aprova
  pending --> denied: usuário nega
  approved --> executed
  approved --> failed
  auto_approved --> executed
  auto_approved --> failed
  denied --> [*]
  executed --> [*]
  failed --> [*]
```

- **Onde:** `apps/api/src/domain/actions/action-state-machine.ts:36`
- **Teste:** `test/domain/actions/action-state-machine.spec.ts`
- **Borda:** uma ação aprovada que executou vira `executed`, **não** continua
  `approved`. Contar aprovações por `status = 'approved'` dá número errado — o
  critério correto é `decided_by IS NOT NULL`.

### RN-004 — A decisão avalia em três estágios, e `deny` vence na hora {#rn-004}

Ordem: **(a) IAM → (b) `agent_autonomy` → (c) `permissions.json`**. Cada estágio
só pode **subir** a permissividade; estágio silencioso nunca rebaixa o anterior.
`deny` em qualquer um retorna imediatamente.

- **Onde:** `apps/api/src/domain/actions/decide.ts:116`
- **Teste:** `test/domain/actions/decide.spec.ts` (10 KB — o maior do domínio)

### RN-005 — Papel mínimo por tipo de ação {#rn-005}

Antes de qualquer política, o IAM: cada `ActionType` exige um papel efetivo
mínimo. Sem ele, `deny` com motivo explícito.

- **Onde:** `apps/api/src/domain/actions/decide.ts:37` (`MIN_ROLE_FOR_ACTION_TYPE`)
- **Teste:** `test/domain/actions/decide.spec.ts`

### RN-006 — Teto: merge em branch protegida nunca é auto-aprovável {#rn-006}

`dev`, `qa`, `rc` e `main` são protegidas. Um `git_merge` com destino numa
delas é rebaixado de `auto_approve` para `require_approval` **depois** de toda
a política ter rodado. Nem `agent_autonomy` nem `permissions.json` conseguem
promovê-lo.

`rc` continua na lista mesmo depois de o degrau sair da política
([ADR 0030](adr/0030-politica-de-branches-mecanizada.md)) e de o bootstrap
parar de criá-la ([RN-029](#rn-029)). Esta lista decide o que a trava
**recusa**, e repositórios bootstrapados por versões anteriores ainda têm a
branch: proteger uma que não existe não custa nada; desproteger uma que existe
custa caro.

- **Onde:** `apps/api/src/domain/actions/decide.ts:149` + `protected-branches.ts:4`
- **Teste:** `test/domain/actions/decide.spec.ts`
- **Origem:** [ADR 0011](adr/0011-infra-dev-agents-worktrees-merge-lock.md) §1
- **Nota:** a proteção equivalente **na plataforma** (GitHub/GitLab) diverge
  entre providers e não é o portão — ver
  [ADR 0028](adr/0028-protecao-de-branch-divergencia-entre-providers.md).

### RN-007 — Teto: patch de instrução nunca é auto-aprovável {#rn-007}

Mudar a instrução de um agente exige decisão humana, sempre. O valor da
funcionalidade está no humano ver o diff; auto-aprovar seria o agente
reescrevendo a si mesmo.

- **Onde:** `apps/api/src/domain/actions/decide.ts:166`
- **Teste:** `test/domain/actions/decide.spec.ts`
- **Origem:** [ADR 0016](adr/0016-anamnese-proficiencia-patches-instrucao.md) §8

### RN-008 — Casamento de comando é por padrão, não por substring {#rn-008}

O `permissions.json` casa comando de terminal por padrão estruturado, com o
comando devidamente tokenizado — não por `includes()`.

- **Onde:** `apps/api/src/domain/actions/command-matcher.ts`
- **Teste:** `test/domain/actions/command-matcher.spec.ts`

---

## Backlog

### RN-009 — A história tem quatro estados, e `done` é terminal {#rn-009}

`draft → ready → in_progress → done`. Retrabalho é permitido: `ready → draft` e
`in_progress → ready`.

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> ready: passa na prontidão (RN-010)
  ready --> in_progress
  ready --> draft: retrabalho
  in_progress --> done
  in_progress --> ready: devolvida
  done --> [*]
```

- **Onde:** `apps/api/src/domain/backlog/story-state-machine.ts:27`
- **Teste:** `test/domain/backlog/story-state-machine.spec.ts`

### RN-010 — `draft → ready` exige quatro coisas, validadas no domínio {#rn-010}

Para uma história virar `ready` ela precisa, **todas**:

1. `dod` não vazio — Definition of Done
2. `dor` não vazio — Definition of Ready
3. ao menos 1 requisito funcional (`rf`)
4. ao menos 1 regra de negócio vinculada (`businessRuleIds`)

O erro nomeia **exatamente o que falta**, não um "inválido" genérico.

- **Onde:** `apps/api/src/domain/backlog/story-readiness.ts:39`
- **Teste:** `test/domain/backlog/story-readiness.spec.ts`
- **Origem:** [ADR 0009](adr/0009-agente-po-backlog-rastreabilidade.md) §3
- **Por quê:** é o que impede o PO de despejar história vaga na fila do dev.

### RN-011 — Regra de negócio sem história é descoberta, não erro {#rn-011}

A cobertura regra→história é calculada e o que não tem história aparece como
**pendência** — informação, não falha.

- **Onde:** `apps/api/src/domain/backlog/coverage.ts`
- **Teste:** `test/domain/backlog/coverage.spec.ts`

### RN-012 — Módulo removido do `module_map` rebaixa a história {#rn-012}

História vinculada a módulo que deixou de existir volta para `draft`, com
evento `backlog.story_demoted`.

- **Onde:** `apps/api/src/domain/architecture/module-resolution.ts`; o evento é
  emitido em `application/use-cases/architecture/create-module-map.use-case.ts:73`
- **Teste:** `test/domain/architecture/module-resolution.spec.ts`

### RN-013 — O grafo de módulos não pode ter ciclo {#rn-013}

- **Onde:** `apps/api/src/domain/architecture/module-graph.ts`
- **Teste:** `test/domain/architecture/module-graph.spec.ts`

---

## Gates de PR

### RN-014 — A ordem dos gates é imutável e `awaiting_user` é terminal {#rn-014}

`awaiting_qa → awaiting_secops → awaiting_user`. Aprovar o QA **nunca** pula
direto para o usuário. `changes_requested` devolve para o dev **na mesma
branch**, sem PR nova.

```mermaid
stateDiagram-v2
  [*] --> awaiting_qa
  awaiting_qa --> awaiting_secops: QA aprova
  awaiting_qa --> awaiting_qa: changes_requested (volta ao dev)
  awaiting_secops --> awaiting_user: SecOps aprova
  awaiting_secops --> awaiting_secops: changes_requested
  awaiting_user --> [*]: merge é do humano
```

- **Onde:** `apps/api/src/domain/execution/pr-gate-state-machine.ts:24`
- **Teste:** `test/domain/execution/pr-gate-state-machine.spec.ts`
- **Origem:** [ADR 0013](adr/0013-gates-qa-secops-pr.md) §1
- **Borda:** `awaiting_user` é terminal **de propósito** — o sistema nunca
  mergeia (RN-006).

### RN-015 — Ciclo K: o teto de correções é finito e herdado {#rn-015}

Cada devolução de gate consome uma volta. Esgotado o teto, a task é
**bloqueada** com motivo, em vez de girar para sempre. O subagente criado por
paralelização **herda** o teto do agente base.

Desde a Fase 8b o teto também vale para a ÁREA de QA, sem mudança de código:
o `QaLeadServer` é o único chamador de `record_gate_verdict`, então uma
rodada de gate — não importa quantas subespecialidades ele consultou por
baixo — ainda consome exatamente UMA volta. Ver
[RN-036](#rn-036).

- **Onde:** `DEFAULT_MAX_GATE_CORRECTIONS = 3` em
  `apps/api/src/application/use-cases/execution/record-gate-verdict.use-case.ts:21`;
  aplicado em `activate-execution.use-case.ts:85` e, no engine, em
  `qa_lead_server.ex:268` e `secops_agent_server.ex:142`
- **Teste:** `apps/engine/test/engine/gates/qa_automacao_agent_test.exs` (a
  subespecialidade devolve `{:blocked, ...}` sem chamar a api) e
  `qa_lead_server_test.exs` (o Lead NUNCA chama `record_gate_verdict` nesse
  caso — é o que impede a correção de ser queimada)
- **Origem:** [ADR 0017](adr/0017-lock-de-workspace-e-monitor-de-dev-agents.md) §4

### RN-016 — O parecer do gate prevalece sobre o enunciado da task {#rn-016}

Se a descrição da task mandar uma coisa e o parecer do gate apontar outra, o
parecer vence.

Desde a Fase 8b, "o parecer" pode vir de duas subespecialidades — a regra não
muda: cada uma prevalece sobre a task DENTRO do que avalia (Automação sobre
cobertura de teste; Performance/Segurança sobre RNF de performance e achado
de código). O `QaLead.consolidar/1` não arbitra entre elas e a task: qualquer
`changes_requested de qualquer uma` já reprova o todo (ver
[RN-036](#rn-036)).

- **Onde:** prompt de cada subespecialidade em
  `apps/engine/lib/engine/gates/qa_automacao_agent.ex` e
  `qa_performance_seguranca_agent.ex`
- **Origem:** [ADR 0020](adr/0020-destravar-gates-qa-secops.md) §9

### RN-036 — QA vira área: o Lead consolida sem mudar o contrato do gate {#rn-036}

A subespecialidade de Automação (o `QAAgent` da Fase 4a) sempre delega;
Performance/Segurança só quando a story tem RNF de performance pertinente
(`Engine.Gates.QaLead.rnf_de_performance?/1` — heurística por palavra-chave,
não NLP). A decisão de NÃO delegar é sempre registrada — uma delegação
`dispensed` com justificativa, nunca silêncio.

Consolidação: `approved` só se TODAS as delegações que rodaram tiverem
aprovado; qualquer `changes_requested` reprova o todo, com `itens` da(s)
subespecialidade(s) que pediu(ram) mudança, cada item prefixado com o rótulo
de quem o levantou (`"[QA de Automação] ..."`) — é assim que se rastreia a
origem SEM mudar `itens` de `string[]` pra outra forma. Falha de delegação
(qualquer origem — `infra`, `modelo`, `codigo`, `politica`) NUNCA vira
`changes_requested`: o Lead bloqueia a task com a origem real (RN-015).

O `qa_verdict` que chega à api é o MESMO artefato e passa pela MESMA rota de
sempre (`RecordGateVerdictUseCase`, `nextGateStatus`) — nenhum dos dois
mudou. O que a api aprende sobre a área fica só nos eventos
`delegation.completed`/`delegation.failed`/`delegation.dispensed`, que a
subespecialidade e o Lead gravam à parte.

- **Onde:** `apps/engine/lib/engine/gates/qa_lead.ex` (`consolidar/1`,
  `rnf_de_performance?/1`), `qa_lead_server.ex` (a fiação);
  `apps/api/src/application/use-cases/execution/record-delegation.use-case.ts`;
  `apps/api/src/db/schema.ts` (tabela `delegations`, enum `failure_origin`)
- **Teste:** `apps/engine/test/engine/gates/qa_lead_test.exs` (a árvore de
  decisão pura), `qa_lead_server_test.exs` (a fiação: decisão → delegação →
  registro → consolidação → a MESMA chamada de sempre), e — a prova de que o
  contrato não mudou — `record-gate-verdict.use-case.spec.ts`,
  `pr-gate-state-machine.spec.ts` e `record-infra-gate-verdict.use-case.spec.ts`
  passam **sem nenhuma alteração**
- **Origem:** [ADR 0038](adr/0038-hierarquia-de-agentes.md)

Do lado da `apps/web` (Fase 8d): o painel do time agrupa `qa`/
`qa-automacao`/`qa-performance-seguranca` como lead + subespecialidades
recolhíveis, a timeline de PR expande o parecer consolidado nos internos
(`ProjectApprovalsTab.tsx`, `PrGateTimeline.tsx`), e o feed narra
`delegation.*` — ver `apps/web/src/lib/agents.ts` (`AREAS`/`areaFor`).

---

### RN-054 — Handoff externo endereça lead de área ou agente sem área — nunca subagente {#rn-054}

Quem fala com uma área **de fora** fala com o lead. Um handoff endereçado a
subagente (`qa-automacao`, `qa-performance-seguranca`, `infra-workflows`) é
recusado com erro tipado que **nomeia o lead** a quem o chamador devia se
dirigir — recusar sem dizer o caminho certo só troca o furo de hierarquia por
um agente travado.

A recusa acontece **antes** do INSERT. Recusar depois deixaria um handoff
fantasma na tabela e um `handoff.offered` — evento imutável — afirmando uma
oferta que a política não permite.

Delegação interna (lead → subagente) **não** passa por aqui: é privada da área,
tem tabela própria (`delegations`) e caminho próprio
(`RecordDelegationUseCase`). A regra é sobre o contorno externo da área, não
sobre o que acontece dentro dela.

O ADR 0038 pediu esta validação nomeando o lugar — `CreateHandoffUseCase` é o
único do sistema que grava `toAgent` — e ela nunca tinha sido implementada
(achado #12 do primeiro dogfooding). A `offer_handoff` do engine repassa
`to_agent` como string livre, então até aqui nada impedia um agente de furar a
hierarquia.

**Área, lead e membros têm UMA fonte** desde a FASE 18:
`apps/api/src/domain/agents/agent-areas.ts`. A lista estava escrita à mão em
três lugares (api, web, engine) e o teste comparava só api contra web — o
engine divergia calado. Agora `apps/web/src/lib/agent-areas.generated.ts` e
`apps/engine/lib/engine/agents/areas.ex` saem de
`pnpm --filter api gerar:areas`, e o teste reprova o que estiver velho em
disco. A lista continua sendo o CATÁLOGO; `agent_areas` é o ESTADO por projeto
(RN-094), e as duas respondem perguntas diferentes.

- **Onde:** `apps/api/src/domain/agents/agent-areas.ts`
  (`assertHandoffTargetAllowed`, `HandoffToSubagentError`),
  `apps/api/src/application/use-cases/agents/create-handoff.use-case.ts`
- **Teste:** `test/domain/agents/agent-areas.spec.ts` (a regra + a checagem de
  que as cópias derivadas não divergem da fonte),
  `test/application/use-cases/agents/create-handoff.use-case.spec.ts`
  (recusa sem linha e sem evento)
- **Origem:** [ADR 0038](adr/0038-hierarquia-de-agentes.md), fechado a partir
  do achado #12 do [primeiro dogfooding](explanation/primeiro-dogfooding.md)

---

### RN-037 — Infra vira área: Workflows gera CI conforme o provider, Lead consolida numa PR só {#rn-037}

Segunda instância do modelo do ADR 0038, depois da área de QA (RN-036) — com
uma diferença estrutural: as duas delegações da área de Infra SEMPRE rodam
(Dockerfiles/compose pelo próprio Lead — "delega pra si"; pipeline de CI pelo
subagente Workflows), nunca uma é dispensada. `Workflows` decide o formato do
pipeline pelo `gitProvider` do contexto (`GetInfraContextUseCase`, lido de
`project_repositories.provider` — **não** por `capabilities` do
`GitProvider`, que são as MESMAS pra GitHub e GitLab): `"gitlab"` gera
`.gitlab-ci.yml`; qualquer outro valor (`"github"`, `"local"`, ou
desconhecido) gera `.github/workflows/ci.yml`. Cada arquivo passa por
`validate_infra_file` antes de terminar — hadolint pra Dockerfile,
`actionlint` pra workflow do GitHub Actions ([ADR 0039](adr/0039-actionlint-e-validacao-do-pipeline-de-ci-gerado.md);
`.gitlab-ci.yml` fica sem validação local, gap documentado, não meia-solução).

Consolidação: os arquivos dos dois delegados se juntam por `path` (o do
Workflows vence em colisão) numa PR SÓ — o mecanismo de propor a PR
(`propose_infra_pr`) muda de "a tool chama a api direto" pra "a tool sinaliza
pro Lead, que consolida e chama uma vez" — o `open_infra_pr` que a api recebe
é o MESMO de sempre, byte a byte (`ExecuteInfraPrUseCase` intocado). Falha de
qualquer delegado (origem `infra`/`modelo`/`codigo`/`politica`) NUNCA abre PR
parcial — mesma regra do RN-036, um nível acima de novo.

Cada delegado (mesmo o Lead, sobre si mesmo) é rastreado como uma linha de
`delegations` — reaproveitada tal como o RN-036 deixou, com UMA correção: a
coluna `task_id` virou NULLABLE (a área de Infra delega sobre a SESSÃO, sem
task de backlog por trás de uma PR de infra), e a rota
`POST /internal/sessions/:sessionId/delegations` deixou de ser aninhada sob
`/tasks/:taskId` — `taskId` agora vai no corpo, opcional. Ciclo K e orçamento
não têm coluna própria na área de Infra (o InfraAgent original nunca teve
orçamento por task, e este trabalho não introduziu um).

- **Onde:** `apps/engine/lib/engine/infra/infra_lead.ex` (`consolidar/2`),
  `infra_lead_server.ex` (a fiação), `workflows_agent.ex`,
  `tools/validate_infra_file.ex` (dispatch por extensão),
  `apps/api/src/application/use-cases/execution/get-infra-context.use-case.ts`
  (`gitProvider`), `record-delegation.use-case.ts` (`taskId` opcional)
- **Teste:** `apps/engine/test/engine/infra/infra_lead_test.exs` (a mescla e
  o bloqueio, puros), `infra_lead_server_test.exs` (a fiação: PR única com
  os dois conjuntos de arquivo, duas delegações, `gitProvider: "gitlab"` →
  `.gitlab-ci.yml`, falha do Workflows → sem PR), `workflows_agent_test.exs`
  — e a prova de que o contrato de `ExecuteInfraPrUseCase`/`InfraGateRunner`
  não mudou: `execute-infra-pr.use-case.spec.ts` e
  `infra_gate_runner_test.exs` passam **sem nenhuma alteração**
- **Origem:** [ADR 0038](adr/0038-hierarquia-de-agentes.md), [ADR 0039](adr/0039-actionlint-e-validacao-do-pipeline-de-ci-gerado.md)

Do lado da `apps/web` (Fase 8d): o painel do time agrupa `infra`/
`infra-workflows` do mesmo jeito que QA (RN-036), e o feed narra as
delegações da área — mesmo registro `AREAS`/`areaFor` de
`apps/web/src/lib/agents.ts`, sem código específico de Infra na UI.

---

### RN-140 — Um ciclo de gate morto no meio é retomado sozinho, sem intervenção manual {#rn-140}

`QaLeadServer`/`SecOpsAgentServer` são `restart: :temporary`, e as
transições intermediárias do gate (`DevAgentServer.correct/3`,
`Dispatcher.run_secops/2`) são chamada direta em memória — feitas DEPOIS de
`record_gate_verdict` já ter avançado o `gate_status` de forma durável na
api. Um crash entre as duas prendia a PR pra sempre em `awaiting_qa`/
`awaiting_secops`: nada sabia que aquele passo tinha ficado pendente, e
nenhum restart do engine consertava — o próprio [ADR 0057](adr/0057-o-gate-espera-a-aprovacao.md)
já declarava a suspensão em `{:awaiting, ...}` como limite conhecido, e
investigar de novo achou que a janela entre veredito gravado e dispatch
chamado é, na prática, mais fácil de acontecer.

`gate_states` (schema `engine`, chave `{project_id, task_id, gate}`) grava
o ciclo em voo nos MESMOS pontos onde as transições já aconteciam —
`"in_progress"` antes de qualquer subagente/scanner rodar,
`"dispatch_pending"` logo depois de `record_gate_verdict` voltar
`correct`/`run_secops` e antes da chamada em processo. `Engine.Gates.GateRescuer`
varre linhas paradas há mais de 15 minutos (configurável,
`GATE_RESCUE_STALE_AFTER_SECONDS`) — generoso de propósito, porque o
ToolLoop de um subagente de QA roda legitimamente até
`TOOL_LOOP_MAX_ITERATIONS_GATE` (60) iterações, e um limiar curto
resgataria (e duplicaria) um ciclo só lento — e retoma: `"in_progress"`
reinicia a área inteira (sem retomada cirúrgica do `ctx`, que não sobrevive
a um restart, mesma escolha do dev agent); `"dispatch_pending"` reenvia
exatamente a chamada perdida. Chamado no boot e por tick Oban
auto-reagendado a cada 5 minutos (`GATE_RESCUE_INTERVAL_SECONDS`),
`Engine.Workers.GateRescueSchedulerWorker` — mesmo idioma do
`ModelSyncSchedulerWorker`/`AnamneseSchedulerWorker`.

Duas guardas contra duplicar trabalho: um processo vivo NO MESMO nó
(`Registry.lookup`) nunca é perturbado, e o limiar de staleness cobre o que
a guarda local não alcança (réplica remota — `Registry` é local ao nó,
mesma ressalva do `Engine.Dev.Wake` desde o [ADR 0045](adr/0045-reagendamento-por-evento-do-dev-agent.md)).
O pior desfecho de uma corrida residual é trabalho duplicado e barato — a
api rejeita um segundo `record_gate_verdict` pro gate que já não é mais
dono do `gate_status` (`nextGateStatus`), e `DevAgentServer.correct/3` já é
idempotente por guarda de estado desde o ADR 0052 — nunca dado
inconsistente.

- **Onde:** `apps/engine/lib/engine/gates/gate_state.ex`,
  `gate_rescuer.ex`, os pontos de escrita em `qa_lead_server.ex`
  (`run_area/3`, `apply_gate_result/6`) e `secops_agent_server.ex`
  (`run_secops/3`, `apply_verdict/6`), e
  `apps/engine/lib/engine/workers/gate_rescue_scheduler_worker.ex`
- **Teste:** `apps/engine/test/engine/gates/gate_rescuer_test.exs` — mata um
  `QaLeadServer` real com o ciclo em voo (`DynamicSupervisor.terminate_child/2`,
  linha durável sobrevivendo ao processo) e prova que `GateRescuer.run/0`
  religa a área sozinho até um desfecho real; o cenário do enunciado
  (`run_secops` perdido) e a devolução `correct` perdida, os dois com
  processo e dispatch REAIS, sem `FakeGateDispatcher`; e as duas guardas
  (processo vivo local não é perturbado; linha recente não é tocada)
- **Origem:** [ADR 0067](adr/0067-o-gate-sobrevive-ao-restart.md), que
  estende o [ADR 0057](adr/0057-o-gate-espera-a-aprovacao.md)

---

## Custo

### RN-017 — Orçamento tem escopo exclusivo: projeto **ou** sessão {#rn-017}

Um `budget` referencia um projeto ou uma sessão, nunca os dois — garantido por
`check` no banco, não só em código.

- **Onde:** `apps/api/src/db/schema.ts` (`budgets_scope_check`)
- **Teste:** a constraint é a garantia

### RN-018 — Notificação de orçamento em 70%, 90% e 100%, sem repetir {#rn-018}

Cada limiar dispara **uma vez**; o último notificado fica persistido em
`budgets.last_threshold_notified`.

- **Onde:** `apps/api/src/domain/llm/budget-threshold.ts:1`
- **Teste:** `test/domain/llm/budget-threshold.spec.ts`

### RN-019 — `policy = 'block'` recusa a chamada; `'allow'` só registra {#rn-019}

- **Onde:** `apps/api/src/domain/llm/budget-threshold.ts:4`
- **Borda:** projeto em `allow` **não para sozinho** no teto. É a causa mais
  comum de "o orçamento não segurou" — ver o [runbook](runbook.md).

### RN-020 — O modelo é resolvido em cascata, do mais específico ao mais geral {#rn-020}

`sessão > agente > área > projeto > workspace`. O primeiro que existir vence.
`área` entrou na FASE 23 — ver [RN-102](#rn-102) para a posição dela e o que
muda em quem já lia esta cascata.

- **Onde:** `apps/api/src/domain/llm/binding-resolver.ts`
- **Teste:** `test/domain/llm/binding-resolver.spec.ts`

### RN-040 — Binding de agente exige tool calling nativo {#rn-040}

Vincular um modelo a um **agente** (`scope = 'agent'`) só é permitido se o
modelo tiver `supports_tool_calling`. Um agente só existe dentro do ToolLoop, e
o ToolLoop só funciona se o modelo souber **pedir** ferramentas; sem isso a
falha apareceria lá na frente como "o agente parou sem concluir", que é
exatamente o diagnóstico por eliminação que o [ADR 0020](adr/0020-destravar-gates-qa-secops.md)
proibiu. A recusa é 422 e a mensagem aponta o filtro **"aptos para agentes"** —
sem esse ponteiro a regra vira beco sem saída.

O `ToolCallRecovery` do engine recupera chamadas que o modelo escreveu em prosa,
mas é **resgate, não licença**: depende de o modelo acertar o formato por acaso.

Só `agent` valida. `workspace` e `project` são o fallback do chat humano e
`session` é conversa — nenhum roda ToolLoop, e travá-los proibiria modelo
chat-only no produto. O agente `context-manager` é coberto por construção: é um
slug **dentro** do escopo `agent`, não um escopo próprio.

- **Onde:** `apps/api/src/domain/llm/model-capabilities.ts:38`
- **Teste:** `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`
- **Origem:** [ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-041 — Contagem de token que o provider não deu é marcada como estimada {#rn-041}

Quando a resposta do provider não traz `usage`, a base OpenAI-compatível conta
localmente com o tokenizer e emite o chunk com `estimated: true`. O número
continua servindo para cobrar, mas a marca preserva a diferença entre **"o
provider disse zero"** e **"o provider não disse nada"** — e é ela que permite
à UI qualificar o custo em vez de exibir um valor sem procedência.

Os outros dois providers divergem, e a divergência é normalizada, não escondida:
o Ollama simplesmente não emite `usage` sem a linha `done`; o Anthropic não sabe
omitir contagem, porque `usage` é obrigatório no `message_start` do protocolo
dele. As três respostas estão em
[docs/reference/llm-providers.md](reference/llm-providers.md#divergências-normalizadas).

- **Onde:** `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:150`
- **Teste:** `test/contract/llm-provider.contract.ts` (cenário `sem_usage`,
  rodado contra os três providers)
- **Origem:** [ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-042 — O metering registra quem SERVIU a chamada, não só por onde ela entrou {#rn-042}

Quando a chamada passa por um hub que informa o provedor real, `token_usage`
grava esse provedor em `upstream_provider` além do provider de entrada. Sem hub
— ou com hub que não informou — o campo fica **`null`**, nunca string vazia: a
consulta de custo por provedor precisa distinguir "não passou por hub" de
"passou e o hub não disse".

Nas métricas o rótulo `upstream_provider` repete o próprio provider quando não
há hub, para que `sum by (upstream_provider)` continue somando o custo inteiro.

- **Onde:** `apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts:58`
- **Teste:** `test/application/use-cases/llm/record-llm-usage.use-case.spec.ts`
- **Origem:** [ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-043 — Modelo descoberto entra desligado; modelo que some é marcado, nunca apagado {#rn-043}

O sync de catálogo tem três desfechos, e nenhum deles é destrutivo:

1. **Modelo novo** entra **sem linha de curadoria em workspace nenhum**, e
   ausência de linha É o desligado. Um catálogo de provider tem centenas de
   linhas — despejá-las ativas tornaria a escolha impossível e ligaria modelo
   caro sem ninguém decidir. Ativar é curadoria do owner, e vale só no
   workspace dele ([RN-052](#rn-052)).
2. **Modelo que sumiu do catálogo remoto** recebe `availability = 'unavailable'`
   e **permanece na tabela**: `model_bindings` e `token_usage` apontam para a
   linha, e apagá-la levaria junto o histórico de custo.
3. **Modelo que voltou** volta a `available` com a curadoria **intocada** — a
   escolha do owner sobrevive a uma ausência temporária do provider.

Os dois eixos são independentes de propósito: a curadoria é decisão de pessoa,
`availability` é observação do provider. Nenhum dos dois escreve no outro — e
desde o [ADR 0049](adr/0049-curadoria-de-modelo-por-workspace.md) eles nem
moram na mesma tabela, então o sync não tem campo de curadoria para atropelar
nem se quisesse.

Três consequências no resto do sistema:

- **binding NOVO** para modelo inativo ou indisponível é recusado no domínio
  (`ModelNotBindableError`, 422). Os bindings que já existem ficam de pé;
- **a cascata** de `resolveBinding` pula o candidato indisponível, registra o
  que pulou em `skipped`, e — quando o turno carrega ferramentas — revalida
  `supports_tool_calling` em TODO nível. Sem isso o fallback pousaria um agente
  num modelo chat-only e violaria a [RN-040](#rn-040) em silêncio;
- **provider que falhou não indisponibiliza nada**: um 401 é "não sei o que tem
  lá", não "não tem nada lá". O provider é pulado, com a ORIGEM da falha
  (`infra` | `modelo`) no relatório — nunca diagnóstico por eliminação.

- **Onde:** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:160`,
  `apps/api/src/domain/llm/binding-resolver.ts:63`,
  `apps/api/src/domain/llm/model-capabilities.ts:49`
- **Teste:** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`,
  `test/domain/llm/binding-resolver.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`
- **Origem:** [ADR 0042](adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-044 — Preço vale daqui em diante, e o custo antigo continua batendo {#rn-044}

Cada linha de `token_usage` grava o preço que produziu o `cost_micros` dela.
Trocar o preço de um modelo **não reprecifica consumo passado** — e mais que
isso: o custo antigo continua **reproduzível**, porque `tokens × preço gravado`
fecha com o custo gravado mesmo depois de três correções na tabela `models`.

Toda mudança de preço grava uma linha em `model_price_changes`, append-only,
com o par antes/depois e a origem (`manual` | `sync`). O par é gravado junto de
propósito: reconstruir o "antes" a partir da linha anterior dependeria de
nenhuma escrita ter escapado do caminho auditado, que é o que a auditoria
existe para provar. Preço igual ao vigente é no-op — uma linha "mudou de 10
para 10" transformaria o log em ruído.

A regra vale para **todo** caminho que troca preço, não só o da tela. Duas
escritas escapavam dela: o sync de catálogo (que trocava preço pelo `upsert`,
sem nunca produzir a origem `sync` que o domínio declarava desde a Fase 9c) e o
`seed.ts` (que roda sobre banco já semeado — `BRABO_FORCE_SEED=1` no
`bootstrap.sh` do k8s — e portanto corrigia preço em silêncio). Os dois passaram
a auditar, o seed reusando o próprio `UpdateModelPricingUseCase`.

- **Onde:** `apps/api/src/application/use-cases/llm/update-model-pricing.use-case.ts:44`,
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:213`,
  `apps/api/src/db/seed.ts:376`
- **Teste:** `test/application/use-cases/llm/update-model-pricing.use-case.spec.ts`,
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
- **Origem:** [ADR 0042](adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-045 — Repositório adotado só é alterado por plano aprovado {#rn-045}

Adotar um repositório existente **diagnostica sem agir**. A adoção valida o
acesso (`getRepo`), grava as linhas do projeto e produz um **plano**: a lista
serializada do que o bootstrap faria, obtida chamando o `check()` de cada passo
— o mesmo que dá idempotência desde a [RN-029](#rn-029) — sem nunca executar a
mutação correspondente.

Enquanto `repo_bootstraps.plan_decision` for **nulo**, nenhuma mutação roda. O
portão está **antes** do executor, não dentro dele: o runner do bootstrap é o
mesmo da Fase 2, sem filtro, e simplesmente não é chamado. Somado ao guard que
já pulava branch protegida, não existe caminho de código que proteja uma branch
fora de um plano aprovado.

As duas saídas:

- **aprovar** é tudo-ou-nada (aprovar passos soltos quebraria a cascata
  `dev←main, qa←dev`). O que executa é o plano **re-derivado** no
  momento da execução: igual ou menor que o exibido, **nunca maior** — uma
  branch que tenha virado protegida nesse meio-tempo é pulada;
- **adotar como está** dispensa o bootstrap, registra a decisão e **não
  adultera o cursor** para fingir convergência. O plano fica guardado como
  evidência do que deliberadamente não foi aplicado.

Decidir sobre um plano regerado é recusado (409): a decisão carrega o
`planGeneratedAt` que o usuário viu, e um "sim" dado sobre outra coisa não vale.

O provisionamento normal recusa (409) rodar num repositório adotado — sem essa
guarda, o caminho de retomada rodaria o bootstrap num repositório de terceiro
sem plano nenhum.

**Limite conhecido:** "proteção divergente" aqui é presença × ausência, porque
é só isso que o contrato expõe (`GitBranch.protected` é booleano, e o
[ADR 0028](adr/0028-protecao-de-branch-divergencia-entre-providers.md) adiou um
`ProtectionPolicy` normalizado). Uma branch com proteção PARCIAL conta como
"sem proteção" e pode ser sobrescrita — mas só dentro de um plano aprovado.

- **Onde:** `apps/api/src/application/use-cases/git/decide-bootstrap-plan.use-case.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-plan.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-steps.ts:112`
- **Teste:** `test/application/use-cases/git/decide-bootstrap-plan.use-case.spec.ts`,
  `test/application/use-cases/git/bootstrap-plan.spec.ts`
- **Origem:** [ADR 0044](adr/0044-adocao-de-repositorio-existente.md)

### RN-046 — Todo repositório de projeto declara sua origem {#rn-046}

`project_repositories.origin` e `repo_bootstraps.origin` dizem se o Brabo
**criou** o repositório (`created`) ou **adotou** um que já existia (`adopted`).
A origem é gravada explicitamente por quem escreve — não pelo default da coluna
— e não muda depois.

Ela não é decoração: é o que faz o produto tratar como caso legítimo o que a
Fase 10 precisou fazer à mão (inserir linhas em `project_repositories` e
`repo_bootstraps` para apontar um projeto a um fork). Um repositório `adopted`
tem política de branches própria, não passa pelo provisionamento, e só é
alterado conforme a [RN-045](#rn-045).

O backfill da migração `0031` marca tudo que existia como `created`, e pode ser
cego: adoção não existia antes dela, então não há linha adotada para
classificar errado.

- **Onde:** `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0031_special_winter_soldier.sql`,
  `apps/api/src/domain/git/repo-bootstrap.entity.ts`
- **Teste:** `test/application/use-cases/git/adopt-repository.use-case.spec.ts`
- **Origem:** [ADR 0044](adr/0044-adocao-de-repositorio-existente.md)

### RN-047 — Circuit breaker do dev agent: N blocked seguidas param, sem gastar orçamento em loop {#rn-047}

Cada dev agent mantém um contador (`dev_agent_states.consecutive_blocked`)
de quantas tasks TERMINARAM `blocked` em sequência — local (no ToolLoop) ou
remotamente (teto de correções do gate estourado). Ao bater o teto por
projeto (`max_consecutive_blocked`, default 3), o agente para em
`idle_tripped` **sem tentar reivindicar a próxima task**. Um desfecho
terminal aprovado zera o contador; uma task blocked individual continua o
fluxo normal (devolvida com diagnóstico, disponível pra um humano
desbloquear) — o breaker é sobre a SEQUÊNCIA, não sobre a task.

A única saída de `idle_tripped` é o rearm explícito
(`POST .../agents/:agentId/rearm`, role `developer`): zera o contador e o
agente volta a tentar reivindicar. Não existe destrave automático — o
mesmo princípio de `MarkTaskBlockedUseCase`/`unblock`, aplicado à
sequência em vez de à task. Rearmar um agente que **não** está travado é
**409**, não sucesso silencioso: o evento `dev.rearmed` é imutável, e
gravá-lo para um rearm que não aconteceu seria mentira no event log.

Um bloqueio que vem de FORA do agente (o `QaLeadServer` falhando
internamente, por exemplo) também precisa acordá-lo — por isso a emissão
de `task.gate_resolved` fica em `MarkTaskBlockedUseCase`, o funil por
onde TODOS os bloqueios passam, e não no `RecordGateVerdictUseCase`, que
só vê parte deles. Sem isso o agente ficava em `awaiting_gate` para
sempre, com a task morta e o contador do breaker sem incrementar.

Reiniciar o engine com um agente em `working` **não** conta pro contador:
a task retida é bloqueada com diagnóstico do restart, mas esse bloqueio
não é o agente "queimando o teto" — é a infraestrutura caindo. O
contador só sobe quando o próprio ciclo dev↔gate produz um `blocked` de
verdade.

- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex` (`finish_task/2`,
  `resume_state/2`), `apps/api/src/application/use-cases/execution/rearm-dev-agent.use-case.ts`,
  `apps/api/src/db/schema.ts` (`projects.max_consecutive_blocked`)
- **Teste:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `circuit breaker`), `apps/engine/test/engine/dev/dev_rehydrator_test.exs`
  (describe `os quatro estados reidratados`), `test/application/use-cases/execution/rearm-dev-agent.use-case.spec.ts`
- **Origem:** [ADR 0045](adr/0045-reagendamento-por-evento-do-dev-agent.md)

### RN-053 — Reativar a execução acorda quem está parado, dentro da sessão que já existe {#rn-053}

Ativar a execução de um projeto que **já está executando** é reativação, não
começo: cai na sessão de execução vigente e acorda os agentes que estavam
parados. Duas partes, uma de cada lado do sistema.

**A sessão é reusada.** A ativação usa a sessão `active` do projeto que já
carrega um `execution.activated`; só cria uma quando não há nenhuma. Não existe
coluna dizendo "esta sessão é de execução" — o que distingue uma é o evento que
ela guarda, e é por ele que se pergunta. Fechar a sessão continua sendo o jeito
de recomeçar do zero: a fechada não é candidata, e a próxima ativação abre uma
nova.

Antes o `create` era incondicional, e o engine **descarta** o `session_id` novo
quando o agente já está vivo. Cada clique em "ativar" deixava para trás uma
sessão ativa que recebia o `execution.activated` e mais nada — os eventos dos
agentes continuavam indo para a sessão da ativação anterior.

**O agente é acordado por wake, não por `work`.** Start fresco dispara o ciclo
(`:work` — emite `dev.started` e reivindica). Agente que já estava vivo recebe
`{:wake, :became_claimable}`, e quem decide é o guard de estado do server:

| estado do agente | o que a reativação faz |
|---|---|
| `idle` | reivindica a próxima task |
| `working`, `awaiting_gate`, `awaiting_approval` | nada — a task em curso não é abandonada |
| `idle_tripped` | nada — só o rearm explícito destrava ([RN-047](#rn-047)) |

Disparar `:work` para todos seria pior que o defeito: ele reivindica
incondicionalmente, e sobre um agente `awaiting_gate` significaria largar o
worktree que o gate está varrendo — além de contornar o circuit breaker com um
clique.

- **Onde:** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/session.repository.ts`
  (`findActiveExecutionSession`),
  `apps/engine/lib/engine_web/controllers/execution_command_controller.ex`
  (`acordar/4`)
- **Teste:** `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (describe `reativação não abre sessão órfã`),
  `test/infrastructure/persistence/session-execution.repository.spec.ts`,
  `apps/engine/test/engine_web/controllers/execution_command_controller_test.exs`
  (describe `reativação`)
- **Origem:** achado #11 do
  [primeiro dogfooding](explanation/primeiro-dogfooding.md)

### RN-048 — Promoção de história é do usuário por default; o modo muda quem dispara, nunca o que é validado {#rn-048}

`projects.story_promotion` escolhe QUEM promove uma história de `draft` para
`ready`:

- **`manual`** (default de projeto novo): o PO deixa a história completa e ela
  fica `draft` com `stories.proposed_ready = true`. **Nenhuma tarefa dela é
  pegável** — `claimNext` exige `story.status = 'ready'` —, e é o usuário que
  promove, individualmente ou em lote, pelo Backlog.
- **`auto`**: o PO promove sozinho ao terminar uma história completa. É o
  comportamento anterior à Fase 12c, preservado como opção explícita.

**O modo muda o gatilho, não o critério.** Os dois caminhos passam por
`assertPromotable` — prontidão (RF/DoD/DoR/regra) e módulos resolvidos contra o
`module_map` vigente —, e é isso que o teste de simetria em
`story-promotion.spec.ts` fixa: para toda história, `isPromotable` concorda com
o que `assertPromotable` levanta. Antes da fase a validação estava duplicada e
assimétrica (a criação chamava `canBecomeReady`, a transição chamava
`assertReady` + `assertModulesResolved`): duas portas para o mesmo estado, com
fechaduras diferentes. Tornar o gatilho configurável exigia unificá-las
primeiro, senão "promover pela UI" e "promover na criação" seriam regras
distintas com o mesmo nome.

Uma história **incompleta nunca é proposta**. `proposed_ready` só liga quando a
história já passaria na validação — propor o que o domínio recusaria empurraria
o trabalho do PO para o usuário sob o disfarce de uma decisão.

A **recusa** devolve a história ao PO: grava `returned_reason`/`returned_at`,
desliga `proposed_ready`, emite `backlog.story_promotion_returned` e injeta o
motivo como mensagem FIXADA na sessão do PO, com a mesma frase de precedência
da devolução de um gate ao dev (lição do ADR 0020). A recusa é gravada **antes**
de falar com o engine, e o engine falhando não a desfaz — é o inverso da ordem
do rearm da [RN-047](#rn-047), e por um motivo: lá o evento afirma algo SOBRE o
engine, aqui afirma algo sobre o usuário, que é verdade tenha ou não um PO de pé
para ouvir.

Promover **em lote não é all-or-nothing**: cada história é sua própria
transação, e uma que perdeu a prontidão entre a proposta e a decisão volta em
`failed` com o motivo, sem derrubar as outras que o usuário acabou de revisar.

O evento `backlog.story_transitioned` grava o **ator real** — `user` na promoção
manual, `agent/po` na automática. O event log é imutável e é o que a auditoria
lê: registrar o PO numa decisão do usuário apagaria exatamente o passo humano
que a regra existe para devolver.

A migração `0033` faz um backfill **dirigido**, não cego: a coluna nasce
`manual` e todos os projetos que já existiam são movidos para `auto`. O default
novo vale para quem vier depois; um projeto em andamento não pode parar de
produzir por causa de um deploy.

- **Onde:** `apps/api/src/domain/backlog/story-promotion.ts`,
  `apps/api/src/db/migrations/0033_absurd_domino.sql`,
  `apps/api/src/application/use-cases/backlog/promote-stories.use-case.ts`,
  `apps/api/src/application/use-cases/backlog/return-story.use-case.ts`,
  `apps/engine/lib/engine/agents/po_server.ex` (`revision_message/1`)
- **Teste:** `test/domain/backlog/story-promotion.spec.ts` (simetria),
  `test/db/story-promotion-migration.spec.ts` (backfill dirigido),
  `test/application/use-cases/backlog/promote-stories.use-case.spec.ts`,
  `test/application/use-cases/backlog/return-story.use-case.spec.ts`,
  `apps/engine/test/engine/agents/po_server_test.exs` (describe `revise/2`)
- **Origem:** [ADR 0046](adr/0046-promocao-de-story-com-autoridade-do-usuario.md)

### RN-049 — Toda decisão sobre uma ação proposta fica no event log, com quem decidiu {#rn-049}

`proposed_action.created`, `.approved` e `.denied` são eventos de domínio em
`session_events`, além das linhas de outbox que os transportam ao engine. O
outbox **não** é memória: é drenado, marcado com `processed_at` e podado.

O `actor` é quem realmente decidiu — o **usuário** em `.approved`/`.denied`, o
**agente** que propôs em `.created`. E `created.payload.status` diz como a ação
nasceu (`pending`, `auto_approved`, `denied`).

Disso sai a distinção que dá a métrica: **decisão humana = evento
`proposed_action.approved`**; política decidindo sozinha aparece só no
`.created` com `status: auto_approved` e ator agente, e nunca é confundida com
um clique. Era exatamente essa contagem — "cliques de aprovação" — que a Fase
10 quis medir e não conseguiu, porque a decisão não existia em lugar nenhum
consultável (achado #17). `approve_always` conta como aprovação porque delega
ao mesmo use-case, e emite `permission.granted` por cima.

Fica de fora, por decisão: o `proposed_action.created` que o bootstrap de
repositório emite direto no outbox. Aquelas mutações já são narradas por
`bootstrap.step_*` na mesma sessão, e duplicá-las contaria o mesmo fato duas
vezes numa métrica de aprovação.

- **Onde:** `apps/api/src/application/use-cases/actions/propose-action.use-case.ts`,
  `.../approve-action.use-case.ts`, `.../deny-action.use-case.ts`
- **Teste:** `test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
  (describe `a decisão no event log`)
- **Origem:** [ADR 0048](adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-050 — Sem PR aberta não se abre gate {#rn-050}

O dev agent propõe commit, push e PR e **lê o desfecho de cada uma**. Só abre o
gate se as três executaram. Se alguma ficou `pending` — autonomia do agente em
`require_approval` —, ele entra em `awaiting_approval`, **retendo o worktree**,
e não abre gate nenhum.

Sem isso o gate abria de qualquer jeito, e o estrago era silencioso: o QA varre
o **worktree**, não a PR; encontrava os arquivos, aprovava; o SecOps aprovava; a
task fechava como concluída — **sem uma linha commitada e sem PR nenhuma**. Só
depois, ao aprovar o commit, o usuário via a ação falhar (com diagnóstico
vazio, porque `System.cmd` num diretório apagado devolve `{"", 2}`).

Quem solta o agente é `task.pr_settled`, emitido pela api quando o `pr_open`
tem desfecho terminal: `opened: true` abre o gate; `opened: false` (negado ou
falho) devolve a task com diagnóstico, em vez de deixar o agente esperando para
sempre por um gate que ninguém vai abrir.

Uma PR negada **não conta para o circuit breaker** da [RN-047](#rn-047): a
decisão foi do usuário, não o agente queimando o teto — mesmo princípio da
recuperação de restart.

Esta regra também elimina o D5 (worktree reciclado sob aprovação pendente) por
consequência: o worktree só é liberado em `gate_resolved`, o gate só abre depois
da PR, e a PR só abre depois de commit e push.

- **Onde:** `apps/engine/lib/engine/dev/agent_io.ex` (`propose/3`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex` (`abrir_gate/1`,
  `aguardar_aprovacao/2`),
  `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`
  (`settlePrOpen`)
- **Teste:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `aprovação pendente não abre gate`)
- **Origem:** [ADR 0048](adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-051 — Preço digitado à mão vence o catálogo do provider {#rn-051}

Linha de `models` com `manual_pricing = true` tem um número que alguém digitou
lendo a doc do provider. O sync de catálogo **não encosta nele** — nem quando o
catálogo remoto traz preço próprio. É o que o schema sempre disse ("quem
sincroniza preço NÃO pode sobrescrever uma linha marcada aqui sem decisão
explícita") e o que o código não fazia: o remoto vencia sempre que trouxesse
preço, e o sync seguinte desfazia a correção de quem tinha arrumado um número
errado.

A regra existe porque para vários providers o número digitado é o **único que
existe**: NVIDIA NIM e Bitdeer não publicam preço por token em doc alguma
([referência de providers](reference/llm-providers.md)), e o valor semeado é
aproximação de mercado. Deixar o catálogo remoto sobrescrever isso trocaria uma
aproximação conhecida por outra, sem ninguém decidir.

Modelo NOVO nasce com a marca vinda do catálogo, não de um default fixo:
descoberto **com** preço, `manual_pricing = false` (a origem é o sync, e é ele
quem mantém a linha em dia); descoberto **sem** preço, `true` — a linha está
esperando alguém digitar, e marcá-la já protege esse número do primeiro
catálogo que resolver informar preço.

- **Onde:** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`
  (`resolverPreco`), `apps/api/src/db/schema.ts:507`
- **Teste:** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`preço digitado à mão vence o catálogo que INFORMA preço`)
- **Origem:** [ADR 0042](adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-052 — Curadoria de modelo vale só no workspace que decidiu {#rn-052}

Ligar ou desligar um modelo no seletor é decisão **daquele workspace**, e não
alcança o vizinho. O catálogo em si continua global — nome, preço, janela e
capabilities são fato do provider, iguais para todo mundo, e duplicá-los por
workspace criaria N verdades sobre o mesmo modelo além de partir
`token_usage.model_id` ao meio.

Antes disso `models.is_active` era uma coluna para a instalação inteira: quem
clicasse "ativar" decidia por todos os workspaces, e a tela não dava sinal
nenhum disso. O efeito prático era um workspace ligar um modelo caro no seletor
do outro — e o gasto aparecer no orçamento de quem não decidiu nada.

Três regras derivadas:

1. **Ausência de linha é o desligado.** Não existe estado "nunca decidido"
   separado; modelo que o sync descobriu não tem linha e não aparece no seletor
   ([RN-043](#rn-043)).
2. **Desligar é `UPDATE`, não `DELETE`.** Apagar a linha apagaria junto quem
   decidiu e quando. A leitura trata os dois casos como inativo; o registro
   existe para quem for auditar.
3. **Escopos `agent` e `session` não verificam curadoria.** Os dois não têm
   âncora de workspace — binding de agente é por slug global. A verificação
   recebe `null` e checa só a disponibilidade, deixando a lacuna explícita em
   vez de chutar um workspace.

- **Onde:** `apps/api/src/db/schema.ts` (`workspace_models`),
  `apps/api/src/application/use-cases/llm/set-models-active.use-case.ts`,
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo`)
- **Teste:** `test/application/use-cases/llm/set-models-active.use-case.spec.ts`
  (`ativar num workspace NÃO liga o modelo no vizinho`)
- **Origem:** [ADR 0049](adr/0049-curadoria-de-modelo-por-workspace.md)

### RN-061 — Falha de FERRAMENTA também é evento, e volta para o modelo {#rn-061}

O resultado de uma tool call nunca é descartado. Ele vira `tool.result` no
event log (`ok` e, quando falha, `erro`), o agente **diz** o que houve no fio, e
o motivo **volta ao modelo** no papel `tool` — para ele corrigir e reemitir no
turno seguinte. Erro de ferramenta é entrada do laço, não fim de linha.

O Criativo era o único que descartava (`_ = EmitArtifact.run(args, state)`) — o
PO e o Arquiteto já realimentavam. Numa execução real o modelo emitiu
`titulo`/`descricao` contra um schema que exige `title`/`description`/`origin`:
as **quatro regras de negócio da conversa foram recusadas**, nenhum evento foi
gravado, e ele seguiu dizendo "registrei as regras" com o painel vazio.

A descrição da ferramenta passou a NOMEAR os campos obrigatórios de cada tipo,
em inglês e com exemplo preenchido — inclusive que `business_rule.origin` é uma
**lista não-vazia** de `seq` das mensagens que originaram a regra, não texto
livre. Sem isso o modelo adivinha, e adivinha no idioma da conversa.

É a mesma regra da [RN-059](#rn-059) aplicada ao outro caminho de falha: duas
políticas para o mesmo problema seriam duas chances de engolir o erro.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex` (`dispatch_tool`,
  `realimentar`), `apps/engine/lib/engine/harness/tools/emit_artifact.ex`
  (`descricao/0`), `apps/engine/lib/engine/harness/artifact_schemas.ex`
  (`required/1`)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (`ferramenta recusada vira tool.result com erro, e o agente fala`)
- **Origem:** execução real da FASE 13b

### RN-065 — Um module_map por SESSÃO; revisão é outra sessão {#rn-065}

`create_module_map` recusa a segunda emissão **na mesma sessão**, com uma
mensagem que diz o próximo passo. Entre sessões o mapa continua versionando
(`version + 1`, `findCurrent` devolve o maior) — revisar arquitetura é
comportamento desejado.

A distinção é o ponto: entre sessões, uma emissão nova é **revisão**; dentro da
mesma, é o modelo **redecidindo do zero**. Numa execução real o Arquiteto
emitiu quatro mapas seguidos, com nomes e recortes diferentes a cada volta —
`greeting`, `hello_core`, `greeting`, `hello-api-core` — e o laço só terminou
porque a rede caiu (`%Req.TransportError{reason: :timeout}`).

A recusa volta ao modelo pelo tool-result ([RN-061](#rn-061)): ele lê que já
existe e segue para `assign_story_modules`, que é o passo 2 do kickoff dele. Por
isso **não** se encerra o turno ao emitir o mapa — o Arquiteto ainda tem três
passos pela frente (vincular histórias, propor ADR, registrar tensões), e
terminar ali mataria os três.

- **Onde:** `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`
- **Teste:** `test/application/use-cases/architecture/create-module-map.use-case.spec.ts`
  (`recusa o SEGUNDO mapa da mesma sessão`; e o versionamento entre sessões
  continua provado ao lado)
- **Origem:** execução real da FASE 13b

### RN-066 — Toda resposta sobre módulos carrega os nomes canônicos {#rn-066}

O Arquiteto **não tem ferramenta para ler** o module_map vigente. Por isso as
três respostas que ele recebe sobre módulos precisam dizer os nomes:

1. `create_module_map` bem-sucedido devolve os módulos **como a api os gravou**
   — não só a versão.
2. `assign_story_modules` recusado lista os módulos **válidos**, além dos
   inexistentes.
3. `create_module_map` recusado por [RN-065](#rn-065) diz **quais** módulos a
   sessão já definiu, não quantos.

Sem mapa nenhum não há nomes a oferecer, e uma lista vazia lê-se como "chute de
novo": esse caminho nomeia o problema real — falta o passo 1 do kickoff.

O motivo é concreto. Numa execução real o Arquiteto emitiu o mapa
(`saudacao`, `api_http`), não conseguiu relê-lo, e partiu para força bruta: 18
chutes em sequência — `api`, `core`, `http`, `greeting`, `domain`, `web`,
`hello-api`, `hello`, `greeting-api`, `saudacao`, `app`, `server`, `publico`,
`public-api`, `api-publica` — até acertar **um por sorte**. Nas palavras dele no
event log: *"vou descobrir os nomes válidos testando candidatos plausíveis"*.

O estrago não foi o desperdício, foi o resultado: as **quatro** histórias
terminaram no mesmo módulo (`saudacao`), inclusive a do endpoint, `api_http`
ficou sem história nenhuma, e o desfecho afirmou *"Todas as 4 histórias foram
vinculadas com sucesso aos módulos"*. Como a execução sobe **um dev agent por
módulo**, a arquitetura desenhada não seria a construída.

O laço de [RN-065](#rn-065) era sintoma disto: o Arquiteto reemitia o mapa
justamente para tentar fixar nomes que não conseguia ler.

- **Onde:** `apps/api/src/application/use-cases/architecture/assign-story-modules.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_module_map.ex`
- **Teste:** `test/application/use-cases/architecture/assign-story-modules.use-case.spec.ts`
  (`a recusa lista os módulos VÁLIDOS`; `sem module_map, manda criar o mapa`) e
  `create-module-map.use-case.spec.ts` (`a recusa diz QUAIS são os módulos`)
- **Origem:** execução real da FASE 13b

### RN-067 — Toda sessão nasce emitindo `session.created` {#rn-067}

`CreateSessionUseCase` é o **único** lugar que cria sessão. Ele emite
`session.created` no outbox **na mesma transação** do insert, e é esse evento
que faz o engine subir o `SessionServer` da sessão.

Quem chamasse `sessions.create(...)` direto produzia uma sessão que o engine
nunca conhecia. O efeito é uma cascata silenciosa:

- o canal Phoenix responde `REFUSED JOIN` para sempre — a UI só reclama no
  console e segue tentando de 10 em 10 segundos;
- sem canal não há atualização ao vivo: o fio fica preso no indicador de
  digitação, mesmo com o agente já `idle`;
- ninguém bate heartbeat e, como é o heartbeat que encerra a sessão
  ([RN-064](#rn-064)), ela fica `active` **para sempre**.

Três caminhos faziam isso: `provision-repository` (duas chamadas),
`adopt-repository` e `activate-execution` — este último cria a sessão em que os
**dev agents** rodam.

A prova por contraste, de uma execução real: a sessão do wizard não tinha
`session.created`, tinha `engine.session_states` vazia e `REFUSED JOIN`; a
sessão aberta pela rota normal tinha o evento, a linha de estado e `JOINED`.

O teste é sobre a FONTE de propósito: um teste de comportamento provaria um
caminho de cada vez, e o defeito aqui é o caminho em que ninguém pensou.

- **Onde:** `apps/api/src/application/use-cases/sessions/create-session.use-case.ts`
  (o dono), `git/provision-repository.use-case.ts`,
  `git/adopt-repository.use-case.ts`,
  `execution/activate-execution.use-case.ts` (os chamadores)
- **Teste:** `test/application/use-cases/sessions/toda-sessao-emite-created.spec.ts`
  (`só o CreateSessionUseCase chama sessions.create`)
- **Origem:** execução real da FASE 13b

### RN-068 — O dev agent lê o worktree sem pedir licença {#rn-068}

Ativar a execução semeia no `allow` do projeto duas famílias de comando: as de
**leitura do próprio worktree** (`ls`, `pwd`, `find`, `cat`, `head`, `tail`,
`grep`, `wc`, `echo`, `git status`, `git diff`, `git log`) e as de **build e
teste**.

A segunda já existia: `ReportDone` só deixa abrir PR depois de um `terminal`
com `exit 0`. A primeira entrou porque o agente **olha antes de construir**, e
sem ela não conseguia começar.

O motivo é concreto. Ferramenta `:pipeline` pendente devolve
`proposed_action <id> status pending` como RESULTADO — não a saída do comando —
e o ToolLoop segue. Num repositório recém-provisionado, cada `ls -la` do agente
caía em aprovação, não ensinava nada e queimava uma iteração. Numa execução real
o desfecho foi `toolloop.limit_reached {iteration: 8, max_iterations: 8}`, task
bloqueada por "limite de iterações atingido", sem uma linha escrita — e as
aprovações concedidas pelo usuário chegaram depois do laço esgotado.

Liberar leitura não afrouxa o pipeline, e é isso que o teste afirma: `deny`
vence `allow`, os `BUILTIN_DENY_PATTERNS` seguem ativos, o casamento é por
prefixo de TOKEN (`ls` liberado não libera `lsof`) e comando composto exige que
CADA segmento case — `ls && rm -rf /` não passa por causa do `ls`.

A allowlist é mitigação, não solução: é lista de comandos previstos e o modelo
inventa comandos. A correção estrutural — o agente ESPERAR a decisão em vez de
queimar iterações — está no [ADR 0052](adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md).

- **Onde:** `apps/api/src/domain/actions/dev-terminal-patterns.ts`,
  semeado por `application/use-cases/execution/activate-execution.use-case.ts`
- **Teste:** `test/domain/actions/dev-terminal-patterns.spec.ts`
  (`libera ls -la`; `comando composto não passa carona no segmento liberado`)
- **Origem:** execução real da FASE 13b

### RN-143 — Subcomando git de leitura só entra ancorado pela flag que torna a leitura inequívoca, nunca pelo verbo pelado {#rn-143}

Consultando o banco de uma execução real, dev agents gastaram dezenas de
aprovações manuais em subcomandos de exploração — `git branch -a`, `git
remote -v`, `git worktree list`, `git show origin/dev --stat`, `git log
--all --oneline --graph`, `git for-each-ref`, `git ls-tree -r origin/dev
--name-only`, `git config user.name` — nenhum coberto pela [RN-068](#rn-068),
que só liberava `git status`/`diff`/`log` (sem flags adicionais). Como o
casamento por prefixo de token exige que TODO segmento de um comando composto
esteja em `allow`, uma cadeia de exploração longa caía inteira em
`require_approval` assim que UM desses subcomandos aparecia no meio.

`DEV_TERMINAL_ALLOW_PATTERNS` ganhou `git branch -a/-r/-v/--list/--show-current`,
`git remote -v`/`git remote show`, `git worktree list`, `git show`, `git
for-each-ref`, `git ls-tree`, `git rev-parse` e `git config --get`. `git log`
não precisou de padrão novo: o casamento já é por PREFIXO de tokens (tokens
extras no final são permitidos), então `Terminal(git log)` já cobria `git log
--all --graph --oneline --decorate`.

**O cuidado é o mesmo que a RN-068 já demonstra para `ls`/`lsof`, aplicado a
verbos com irmão MUTANTE que aceita a mesma forma truncada do padrão.**
`Terminal(git branch)` bateria tanto em `git branch -D nome` (apaga) quanto em
`git branch nome-nova` (cria) quanto em `git branch` sozinho — o padrão não
enxerga o que vem DEPOIS do prefixo que ele checou. Por isso nenhum dos quatro
verbos com mutação (`branch`, `remote`, `worktree`, `config`) entrou pelo verbo
pelado; cada um foi ANCORADO pela flag que torna a leitura inequívoca
independente de qualquer coisa que venha depois dela:

- `git branch` — ancorado em `-a`/`-r`/`-v`/`--list`/`--show-current`, nunca
  no verbo sozinho; `-D`/`-d`/`-m`/`-M` (apagar/renomear) e um nome de branch
  solto (criar) continuam fora.
- `git remote` — ancorado em `-v` e `show` (que só aceita nome de remote
  depois, sempre leitura); `add`/`remove`/`set-url` continuam fora.
- `git worktree` — ancorado em `list`; `add`/`remove`/`prune` continuam fora.
- `git config` — só `--get` entrou, porque é a única flag que o próprio git
  garante ser leitura independente do que vier depois (chave, ou chave +
  padrão de valor). `git config user.name`/`git config user.email` SEM
  `--get` ficaram de fora de propósito: um segundo token depois da chave
  (`git config user.name "novo valor"`) é ESCRITA, e o casamento por prefixo
  não distingue "sem mais tokens" de "com mais um token" sem inventar um
  parser de contagem de argumentos novo — a mesma limitação que já
  impede um `git branch` pelado. `--global`/`--system` nunca foram ancorados.

- **Onde:** `apps/api/src/domain/actions/dev-terminal-patterns.ts`
- **Teste:** `test/domain/actions/dev-terminal-patterns.spec.ts` (describe
  `subcomandos git de leitura (achado ao vivo)` — cobre a cadeia composta
  observada ao vivo auto-aprovando, e cada variante mutante com a MESMA
  palavra de comando — `git branch -D`, `git remote add`, `git worktree add`,
  `git config --global user.name` — continuando em `require_approval`)
- **Origem:** consulta ao banco de uma sessão real, achado durante uso

### RN-069 — Retentar uma task recria a branch, não falha {#rn-069}

`WorktreeManager.add_worktree/3` usa `git worktree add -B` (cria **ou**
redefine), não `-b`. Ele já removia o diretório do worktree anterior, mas
deixava a branch para trás — e como o nome dela vem do slug da task, a segunda
tentativa da MESMA task caía sempre em
`fatal: a branch named 'feature/<slug>' already exists`.

O efeito era permanente: destravar a task não adiantava, reativar a execução não
adiantava, e o circuit breaker desarmava sem saída. Numa execução real só saiu
com `git worktree prune` manual no workspace do projeto.

Redefinir é o certo: o worktree anterior já foi removido, o trabalho daquela
tentativa não vale (a task voltou para a fila) e a branch renasce do ponto atual
do work_dir.

- **Onde:** `apps/engine/lib/engine/dev/worktree_manager.ex`
- **Teste:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`retentar a MESMA task recria o worktree em vez de falhar`)
- **Origem:** execução real da FASE 13b

### RN-070 — Todo gate declarado aponta para a evidência que o prova {#rn-070}

Nenhuma entrada de `docs/gates.yml` existe sem `evidencia`, e o registro não
pode afirmar mais do que verifica: gate `block` exige `verificacao: script`, e
gate `planned` não carrega evidência de algo que ainda não aconteceu.

A evidência é um **localizador**, não prosa: `event_log` traz os tipos de evento
e o filtro de payload que os distingue dos vizinhos; `teste` e `ci` trazem o
caminho, e alvo que sumiu REPROVA. É o mesmo modo de falha que o docmap chama de
glob morto — regra que nunca dispara e finge cobertura.

Três tipos porque nem todo gate mora no event log:
[`merge-protegida`](#rn-014) é um teto em regra pura que não emite evento
próprio (o que o garante é teste) e `backmerge` é CI com estado em
`.release/gate.json`. Rebaixá-los a `warn` por isso mentiria sobre as travas
mais duras do produto.

O filtro importa tanto quanto o tipo: `qa-verificada` e `secops-segura` gravam o
MESMO `pr.gate_changed`, e o mesmo tipo sai na ABERTURA do gate sem `veredito` —
sem o filtro, abertura contaria como passagem. Vale igual para os dois gates de
PR de infra. Por isso nenhum par (`event_types` + `filtro`) pode se repetir.

O filtro só alcança o PAYLOAD, de propósito: aceitar coluna arbitrária abriria a
consulta inteira. Quem promoveu uma story (humano ou o PO) vive na coluna
`actor_kind` e fica fora do vocabulário declarativo.

- **Onde:** `apps/api/src/domain/gates/gate-registry.ts`, registro em
  `docs/gates.yml`, medição em `apps/api/scripts/validacao-gates.ts`
- **Teste:** `apps/api/test/domain/gates/gate-registry.spec.ts`
  (`é válido: nenhum problema acumulado`; `nenhum par (event_types + filtro) se
  repete entre gates`)
- **Origem:** FASE 15a (ADR 0054)

### RN-071 — Os quatro gates de autoridade do usuário não podem ser declarados automáticos {#rn-071}

`acao-aprovada`, `story-promovida`, `plano-de-adocao` e `merge-protegida` têm
`aprovacao_humana: true` por construção. A lista mora no DOMÍNIO
(`GATES_HUMANOS_IMUTAVEIS`), não no teste: mexer nela tem que ser ato
deliberado, revisado como código.

`aprovacao_humana: true` quer dizer que a decisão é do usuário — direta no
clique, ou delegada por política que ele mesmo escreveu no `permissions.json`. É
isso que deixa `acao-aprovada` conviver com `status: auto_approved`: a política
decidindo sozinha é o usuário decidindo antes. `merge-protegida` é o caso onde
nem a delegação existe — o teto rebaixa `auto_approve` para `require_approval`
mesmo com autonomia ligada.

O contrário também reprova: id na lista sem gate correspondente é regra morta,
apontando para o vazio.

- **Onde:** `apps/api/src/domain/gates/gate-registry.ts`
  (`GATES_HUMANOS_IMUTAVEIS`); o teto em
  `apps/api/src/domain/actions/decide.ts`
- **Teste:** `apps/api/test/domain/gates/gate-registry.spec.ts`
  (`%s não pode ter aprovacao_humana false`); o teto em
  `apps/api/test/domain/actions/decide.spec.ts`
- **Origem:** FASE 15a (ADR 0054)

### RN-072 — Sem escolha explícita, o modelo é o do Criativo {#rn-072}

Quando a cascata de binding pousa no default do **workspace** — isto é, ninguém
decidiu nada para este projeto —, o modelo herdado é o do **Criativo**, e não o
default global.

O Criativo é sempre a porta de entrada de um projeto: é com ele que a primeira
conversa acontece, e é o binding dele que representa "o modelo que este projeto
usa para pensar".

A herança ocupa o **vazio**, nunca sobrepõe: binding de sessão, de agente ou de
projeto são escolhas explícitas de alguém e continuam vencendo. É por isso que
ela é um passo DEPOIS da cascata e não um escopo novo dentro dela — não compete
por precedência. E o modelo herdado passa pelos mesmos filtros: sumido do
catálogo ou sem tool calling não é herdado, pelo mesmo motivo que a cascata os
pula ([RN-043](#rn-043)).

O que isso conserta: o default de workspace é global e costuma ser um modelo
local pequeno. Sessão nova e dev agent — que não têm binding próprio — nasciam
nele, e o [ADR 0020](adr/0020-destravar-gates-qa-secops.md) proíbe modelo local
pequeno no passo semântico. Numa execução real foi preciso trocar o modelo à
mão em toda sessão aberta, e os três dev agents subiram em `llama3.2:1b` sem
ninguém pedir.

- **Onde:** `apps/api/src/domain/llm/binding-resolver.ts`
  (`herdarModeloDeStart`), aplicado em
  `application/use-cases/llm/resolve-model-binding.use-case.ts`
- **Teste:** `apps/api/test/domain/llm/binding-resolver.spec.ts`
  (`ocupa o vazio`; `NÃO sobrepõe escolha explícita de %s`)
- **Origem:** achados B e O da execução real (FASE 13c, fase A)

### RN-073 — Aprovação pendente SUSPENDE o laço, não o gasta {#rn-073}

Quando uma ferramenta de pipeline volta `pending`, o ToolLoop **para** e o dev
agent entra em `:awaiting_approval` retendo task, worktree e o histórico do
laço. A decisão do usuário emite `task.action_settled`, que o acorda: o
resultado de verdade ocupa o lugar onde estaria a palavra "pending", e o laço
retoma do ponto em que parou.

Duas propriedades que o teste fixa:

- **Nada é gravado enquanto se espera.** O lugar da mensagem de ferramenta fica
  vago. Gravar "pending" ali seria dizer ao modelo que o comando respondeu
  isso — que era exatamente o defeito.
- **Recusa é resposta.** O motivo entra no lugar do resultado e o agente aprende
  que aquele caminho fechou, em vez de esperar para sempre por algo que ninguém
  vai aprovar. É o mesmo princípio do `pr_settled` com `opened: false`
  ([RN-047](#rn-047)), um nível abaixo.
- **O wake precisa CHEGAR.** `task.action_settled` nasce no agregado `task`, e
  não no `proposed_action` que o nome da tabela sugere: o dreno do engine lê uma
  lista fechada de agregados (`session` e `task`). Emitido fora dela, o evento é
  gravado com sucesso, fica com `processed_at` nulo e nunca é sequer lido —
  nenhum job, nenhum erro, nenhum log, e o agente espera para sempre. O contrato
  atravessa duas linguagens e por isso é fixado dos dois lados.

Se o engine **reiniciar** durante a espera, a regra não vale mais para aquela
task: o laço suspenso só existe em memória, então ela volta para a fila
bloqueada com origem `infra`, e a decisão tomada depois não tem onde ser
aplicada. Bloquear com diagnóstico é deliberado — a alternativa era a espera
eterna silenciosa, que é o que esta regra existe para acabar.

O que isso conserta: `pending` voltava como RESULTADO da ferramenta e o laço
seguia. O modelo lia aquilo como resposta do comando, não aprendia nada, tentava
outra coisa — e cada tentativa queimava uma iteração até
`toolloop.limit_reached {iteration: 8, max_iterations: 8}`, com a task bloqueada
por "limite de iterações atingido" sem uma linha escrita. As aprovações
concedidas chegavam depois do laço esgotado e eram inúteis.

A allowlist de terminal ([RN-068](#rn-068)) continua valendo, mas deixa de ser a
única defesa: ela é lista de comandos previstos, e o modelo inventa comandos.

- **Onde:** `apps/engine/lib/engine/harness/hooks/action_pipeline.ex`,
  `harness/tool_loop.ex`, `dev/dev_agent_server.ex`,
  `workers/dev_agent_wake_worker.ex`; emissão em
  `apps/api/src/application/use-cases/actions/{approve,deny}-action.use-case.ts`
- **Teste:** `apps/engine/test/engine/dev/dev_agent_awaiting_approval_test.exs`
  (`ação pendente PARA o agente`; `aprovada: retoma o laço com a saída REAL`;
  `restart durante a espera BLOQUEIA a task`) e
  `apps/engine/test/engine/dev/wake_do_outbox_ao_agente_test.exs`, que percorre
  a corrente inteira — outbox, dreno, fila e processo — porque os testes por
  elo ficavam todos verdes com a entrega quebrada; o agregado é fixado do lado
  da api em
  `apps/api/test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
- **Origem:** [ADR 0052](adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md),
  fase A da triagem

### RN-135 — Ativar execução fecha a sessão de CHAT que originou o pedido {#rn-135}

`ActivateExecutionUseCase` sempre resolvia a sessão de EXECUÇÃO
(`findActiveExecutionSession`, ou cria uma nova `criativa`), mas nunca
transicionava a sessão de CHAT de onde partiu o clique em "ativar
execução" — o Dev Lead/PO conversando numa sessão separada. Ela ficava
`active` para sempre, mesmo com a execução já correndo sozinha em outra
sessão, e continuava aparecendo como conversa em aberto na lista.

`execute()` ganhou `originSessionId`, opcional e por último — chamador
antigo (hoje só a ativação pela Visão Geral, sem contexto de sessão)
continua funcionando IDÊNTICO, sem fechar nada. Informado, ao FINAL do
método (depois de tudo o resto ter acontecido: module_map, áreas,
autonomia, `startExecution`, `execution.activated`):

- **nunca fecha a própria sessão de execução** — se `originSessionId` for
  igual à sessão que acabou de receber `execution.activated`, o fechamento
  é pulado, porque fechá-la destruiria o processo que os dev agents
  acabaram de ganhar;
- **só fecha o que está `active`** — mesma cautela de
  `decide-bootstrap-plan.use-case.ts#fecharSessao`, nada a fazer se a
  sessão já não existir ou já não estiver aberta;
- **reusa `GetSessionPendingWorkUseCase`** ([RN-073](#rn-073)) — a MESMA
  trava que segura o fechamento por heartbeat de inatividade: handoff
  `offered`, `proposed_action` pendente ou agente `working` sem `idle`
  posterior impedem o fechamento;
- passa por `closing` antes de `closed` — a máquina de estados
  (`active -> closing -> closed`) não permite o salto direto.

Falha ou pendência aqui NUNCA propaga para quem chamou `execute()`: a
ativação da execução já aconteceu e é o efeito principal; fechar o chat de
origem é um efeito colateral *best-effort*.

- **Onde:** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`
  (`closeOriginSession`), `apps/api/src/interfaces/http/execution/dto/activate-execution.dto.ts`
  (`originSessionId`), `apps/api/src/interfaces/http/execution/execution.controller.ts`
- **Teste:** `apps/api/test/application/use-cases/execution/activate-execution.use-case.spec.ts`,
  describe `fecha a sessão de origem (RN-135)` — fecha sem pendência,
  NÃO fecha com pendência, NÃO fecha sessão já não-`active`, chamador
  antigo sem o parâmetro não fecha nada, e nunca fecha a própria sessão de
  execução mesmo se `originSessionId` coincidir com ela
- **Origem:** achado de investigação de código — sessão criativa com
  execução ativada continuava `active` na lista mesmo com 35 eventos de
  dev agents dentro dela

### RN-074 — A saída de terminal tem teto de bytes {#rn-074}

A saída de um comando é cortada em `TERMINAL_OUTPUT_MAX_BYTES` (default 32 KiB)
antes de virar resultado da ferramenta, e o corte deixa uma **marca** dizendo os
dois tamanhos e o que fazer:

```
[saída truncada: 32768 de 1048576 bytes. Refine o comando (head, grep,
-maxdepth) para ver o que falta.]
```

Três propriedades que o teste fixa:

- **O teto é `>`, não `>=`.** Saída que cabe exatamente no limite passa
  intacta — marcá-la faria o modelo refinar um comando que já deu tudo.
- **O corte não parte caractere multibyte.** `binary_part/3` corta por byte;
  cair no meio de um `é` produz binário inválido que quebra a serialização
  JSON antes de o resultado chegar ao modelo.
- **`raw_bytes` continua sendo o tamanho REAL produzido**, não o truncado. É
  medição, e mentir nela esconderia justamente o comportamento que motivou o
  teto. Quem quiser detectar truncagem compara `byte_size(stdout)` com
  `raw_bytes`.

O que isso conserta: a saída de cada comando fica no histórico do laço e viaja
em **todo** turno seguinte. Sem teto, um `find` numa árvore grande basta — a
execução do `hello-limpo` morreu com `{413, "request entity too large"}` no
turno 18, sem uma linha escrita. O estouro é de **bytes da requisição**, não de
janela de contexto: a maior chamada bem-sucedida tinha 28.993 tokens de entrada.

A marca é endereçada ao **modelo**, não ao humano — sem dizer o que fazer, ele
tende a repetir o mesmo comando.

- **Onde:** `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`truncate/2`), teto em `apps/engine/config/runtime.exs`
- **Teste:** `apps/engine/test/engine/actions/terminal_executor_test.exs`
  (describe `teto de bytes da saída`)
- **Origem:** achado S de
  [achados-execucao-real.md](explanation/achados-execucao-real.md), Fase F do
  [backlog](explanation/backlog.md)

### RN-075 — Comando de terminal é avaliado por onde toca, não só pelo verbo {#rn-075}

A pasta do projeto (`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>` — o
UUID puro num projeto de antes do [RN-109](#rn-109), `<slug>-<8 chars do
id>` num projeto novo) é o **escopo**.
Um comando de `terminal` que toca qualquer caminho fora dela **nunca** é
auto-aprovado, por mais que o verbo esteja em `allow`. Dentro dela, `cd` deixa
de exigir permissão — ele é a declaração de escopo, não um verbo.

Quatro propriedades que os testes fixam:

- **Aperta:** `Terminal(cat)` liberado deixa de auto-executar
  `cat /workspace/apps/engine/.../git_executor.ex`. Era o achado U: o
  casamento é por VERBO, então o agente lia o código da plataforma que o
  executava, e alcançava o worktree de outros projetos.
- **Afrouxa:** `cd <dentro> && cat README.md` vira `auto_approve`. Era o
  defeito mais caro da escada — o dev agent emite sempre `cd <caminho> &&
  <verbo>`, `cd` não estava em `allow` nenhum, e comando composto exige que
  TODOS os segmentos casem.
- **Permite sem isentar:** dentro do escopo, verbo fora do `allow` continua
  pedindo. Estar na pasta do projeto não torna `curl … | sh` seguro.
- **Fora do escopo é `require_approval`, nunca `deny`:** o agente pode ter
  razão legítima para olhar fora, e a decisão continua sendo do usuário.

`deny` continua vencendo primeiro, e os dois tetos ([RN-006](#rn-006),
[RN-007](#rn-007)) seguem intocados. Sem raiz informada ao `decide()`, o
veredito é o de antes desta regra — nenhum chamador tem comportamento alterado
por omissão.

A normalização é **léxica**, não `realpath`: `<raiz>/../..` é resolvido e
reprovado, mas link simbólico de dentro apontando para fora não é detectado.
`decide()` é puro por contrato e resolver symlink exigiria IO no domínio.
Escopo é política; isolamento é outro problema, declarado em aberto no ADR.

**Sem regex sobre a entrada, de propósito.** Tirar as barras finais da raiz era
`.replace(/\/+$/, '')`, e o CodeQL apontou ReDoS polinomial
(`js/polynomial-redos`, HIGH): o padrão obriga o motor a tentar cada posição
inicial e varrer até o fim, degradando em O(n²). Hoje é varredura O(n),
equivalente inclusive no caso degenerado — a raiz `/` vira string vazia nos
dois, e é isso que faz `startsWith('/')` valer para todo caminho absoluto.
Quem for "simplificar" de volta para regex reabre o alerta.

- **Onde:** `apps/api/src/domain/actions/path-scope.ts`,
  `domain/actions/decide.ts` (teto do escopo e o `cd` no escopo),
  raiz derivada em
  `infrastructure/filesystem/project-workspaces-root.ts`
- **Teste:** `apps/api/test/domain/actions/path-scope.spec.ts` e
  `apps/api/test/domain/actions/decide.spec.ts`
  (describe `decide — escopo de caminho`)
- **Origem:** [ADR 0055](adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
  achado U, Fase F do [backlog](explanation/backlog.md)

O escopo só vale enquanto ele próprio estiver dentro da raiz — quem garante isso
é a [RN-092](#rn-092).

### RN-092 — O `projectId` é segmento de caminho, e o escopo nunca sai da raiz {#rn-092}

`projectScopeRoot()` **recusa** um `projectId` que não seja segmento de caminho
simples (`^[A-Za-z0-9_-]{1,64}$`), lançando em vez de montar o caminho.

O motivo é que o id chega de `@Param('projectId')` sem pipe de validação, e o
Express **decodifica o percent-encoding do segmento antes de entregá-lo**: um
`..%2F..%2Fetc` chega como `../../etc`, e o `join` resolveria para fora da raiz
sem reclamar. Os dois consumidores da função sofrem, e o segundo é o grave:

- o `permissions.json` seria lido **e escrito** em caminho arbitrário;
- o escopo da [RN-075](#rn-075) autoriza comando de `terminal` sob essa pasta.
  Um escopo que escapa da raiz é a política de aprovação apontando para o lugar
  errado — falha de SEGURANÇA, não de arquivo não encontrado.

A checagem é deliberadamente **mais larga que UUID** (aceita letra, dígito,
hífen e sublinhado) para não amarrar o formato do id, e estreita o bastante para
que o resultado nunca escape. E fica **onde a raiz é derivada**, não em cada
chamador, pela mesma razão que fez a função existir: as duas derivações têm que
concordar, e checagem duplicada é checagem que um dia diverge.

O caminho feliz não muda — todo id real é UUID vindo do banco.

- **Onde:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`)
- **Teste:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Origem:** [ADR 0058](adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md),
  alertas `js/path-injection` do CodeQL

### RN-095 — A leitura de repositório é contida ao projeto e limitada {#rn-095}

A superfície de leitura de código (`GET /projects/:projectId/code/{tree,file,search}`
e o diff de PR) tem **duas** garantias, e as duas são do mesmo tipo: o produto
recusando fazer o que o cliente pediu.

**Contenção.** Todo caminho de arquivo vindo do cliente passa por
`caminhoDeRepositorioContido()`, que ancora o pedido na pasta do projeto e
recusa o que sair dela — `../`, absoluto, ou byte NUL. Ela é uma função só, no
mesmo arquivo do `projectScopeRoot` da [RN-092](#rn-092), reusando as primitivas
do escopo de terminal (`normalizarCaminho`/`dentroDoEscopo`). **Nenhuma rota
valida caminho por conta própria**, e é isso que a regra afirma: quatro
implementações da mesma contenção seriam quatro chances de divergir, e o
CLAUDE.md já registra que a decisão foi manter a checagem central e pagar o
preço no painel do CodeQL (barreira em outra função ele não enxerga).

Ela devolve o caminho **normalizado**, e o chamador usa o que voltou. Devolver o
original permitiria conferir `b` e mandar `a/../b` ao provider — a forma mais
comum de a contenção existir e não valer.

O vetor não é "ler o arquivo errado". Em `github`/`gitlab` o caminho vira
segmento de URL da API do provider, então um `../` **troca de endpoint** com a
credencial do owner do workspace na mão ([RN-058](#rn-058)/[RN-082](#rn-082)).
Em `local` ele vira o lado direito de `git show <ref>:<path>`. A `ref` é
conferida no mesmo lugar, pelo mesmo motivo, e `..` nela é recusado porque para
o git `dev..main` é intervalo de commits, não revisão.

**Limite.** Árvore e diff já vêm cortados pelo contrato
(`GIT_TREE_ENTRY_LIMIT`, `GIT_DIFF_FILE_LIMIT`, FASE 26a). A **busca** não: ela
não é operação do contrato — é composta sobre `listTree` e `getFileContent`, e
é a única leitura cujo custo cresce com o TAMANHO do repositório em vez do
tamanho do pedido. Três orçamentos a param (diretórios percorridos, arquivos
abertos, casamentos devolvidos), um cache de TTL curto evita repetir as mesmas
chamadas, e `truncated` diz que o corte aconteceu. Sem eles, um `viewer`
gastaria a credencial e o rate limit do owner à vontade — a mesma família de
defeito dos 3.824 req/min do dashboard ([RN-090](#rn-090)).

Cortar é sempre **visível**: toda resposta que pode ter sido cortada diz isso
num campo. `filesScanned` vai junto na busca porque o custo que ninguém vê é o
que ninguém corrige.

**Ler não vira `proposed_action`.** Leitura não é efeito externo, e transformá-la
em ação de aprovação encheria a fila de ruído até ninguém mais ler as de
verdade. O congelamento da fase é o outro lado disso: a aba é só leitura, e
escrita — quando vier — nasce `proposed_action`.

- **Onde:**
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`caminhoDeRepositorioContido`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`,
  `apps/api/src/domain/git/git-read-limits.ts`,
  `apps/api/src/domain/git/git-read-cache.ts`,
  `apps/api/src/interfaces/http/git/code.controller.ts`
- **Teste:**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (a contenção isolada),
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (o caminho malicioso recusado nas três rotas **antes** de o provider ser
  chamado, e cada um dos três orçamentos parando a busca),
  `apps/api/test/domain/git/git-read-cache.spec.ts`
- **Origem:** FASE 26b, item 34 do programa 16–26; a contenção estende a
  [RN-092](#rn-092) ([ADR 0058](adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md))

### RN-127 — `ref`/`path` da aba Code recusam chegar como ARRAY, não só como caminho fora do escopo {#rn-127}

`@Query('ref') ref?: string` e `@Query('path') path?: string`
(`code.controller.ts`) extraem o valor cru sem DTO/`class-validator` no
meio, e o `ValidationPipe` global (`main.ts`) não ajuda: ele pula tipo
primitivo nativo (`String`) por desenho do Nest, então nada intercepta
`ref`/`path` antes de chegarem como argumento de método. O Express entrega
`?ref=a&ref=b` como **array**, não string — a anotação `string` do
TypeScript só existe em compile-time.

Um array escapava das DUAS checagens que a [RN-095](#rn-095) já fazia
tratando o valor como string: `ref.includes('..')` tem semântica de
ELEMENTO EXATO (não substring) em array, e `REF_VALIDO.test(ref)` chama
`.toString()` no array antes de casar — um valor como `['x/../y']`
continha `..` e ainda assim passaria pelas duas.

`garantirQueryEscalar(valor, criarErro)` recusa o array ANTES de qualquer
outra checagem, num lugar só, reusado pelos DOIS pontos que tratavam query
como string: `caminhoDeRepositorioContido` (mesmo arquivo da RN-092/095) e
`ReadProjectCodeUseCase.alvo` (`ref`). O erro concreto (`CaminhoForaDoEscopoError`
ou `BadRequestException`) é decidido por quem chama, passado como fábrica —
a função central não decide o tipo de erro, só a forma da checagem.

O caminho feliz não muda: todo `ref`/`path` legítimo já era string.

- **Onde:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`garantirQueryEscalar`, usada em `caminhoDeRepositorioContido`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`alvo`, `ref`)
- **Teste:**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`garantirQueryEscalar` isolada e `caminhoDeRepositorioContido` recusando
  array), `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (`ref`/`path` como array são 400 em `tree`, que todas as outras rotas
  reusam via `alvo`)
- **Origem:** alerta CRÍTICO do CodeQL (confusão de tipo em query param HTTP)
  bloqueando a promoção qa→main, achado durante a PR #256; estende a
  [RN-095](#rn-095)

### RN-093 — Em produção, a api não sobe com a chave de exemplo do `state` de OAuth {#rn-093}

`resolveOauthStateSecret()` **derruba o boot** quando `NODE_ENV === 'production'`
e `GIT_OAUTH_STATE_SECRET` está ausente, é igual ao literal de exemplo do
repositório, ou tem menos de 16 caracteres. Fora de produção o default de
desenvolvimento continua valendo.

Essa chave assina o `state` do OAuth de git, e o `state` é o único que impede o
callback `GET /git/oauth/:provider/callback` — rota pública, por necessidade —
de ser forjado. Com a chave conhecida, qualquer um assina um `state` para
`{projectId, userId, provider}` à escolha e faz o callback gravar, no projeto
apontado por esse payload, o token de git obtido do provider.

**Por que rejeitar o literal, e não só o vazio.** O default estava no
`.env.example` de um repositório open source — é segredo publicado, não segredo
fraco. E o `docker-compose.prod.yml` o supria como fallback, então no caminho
real de erro a variável estava **definida**: uma verificação de "não vazia"
passaria por cima do defeito inteiro.

A resolução fica em função única, e não em cada chamador, pela mesma razão da
[RN-092](#rn-092) — eram duas cópias do mesmo literal, e cópias divergem.
Divergindo aqui, o callback recusaria todo `state` legítimo.

- **Onde:** `apps/api/src/infrastructure/security/oauth-state-secret.ts`
  (`resolveOauthStateSecret`), chamada no boot em `apps/api/src/main.ts`
- **Teste:** `apps/api/test/infrastructure/security/oauth-state-secret.spec.ts`
- **Origem:** [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-114 — Os quatro segredos irmãos do `GIT_OAUTH_STATE_SECRET` também não sobem em produção com o valor de exemplo {#rn-114}

O [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md) fechou o
padrão para `GIT_OAUTH_STATE_SECRET` e deixou declaradamente aberto que o
mesmo modo de falha valia para quatro segredos irmãos, todos com default de
desenvolvimento no `docker-compose.prod.yml`: `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` e `SECRET_KEY_BASE`. Esta RN
fecha os quatro, replicando exatamente a mesma regra — não é decisão nova,
é a mesma decisão aplicada aos irmãos.

Em produção (`NODE_ENV === 'production'`), cada resolutor **derruba o boot**
quando a variável está ausente/só com espaços, é igual ao literal de exemplo
do repositório (que é público — está no `.env.example`), ou tem menos de 16
caracteres. Fora de produção o default de desenvolvimento continua valendo,
porque `docker compose up` sem `.env` tem que funcionar.

- `AUTH_JWT_SECRET` — deriva o par Ed25519 que assina o access token. Com o
  default público, qualquer um forja um access token válido.
- `BRABO_SERVICE_TOKEN` — autentica o tráfego interno api ↔ engine. Com o
  default público, qualquer um chama as rotas `/internal/*` sem passar pelo
  `EngineServiceGuard`.
- `CREDENTIALS_MASTER_KEY` — embrulha os DEKs que cifram as credenciais do
  usuário (chaves de LLM, tokens de git). Com o default público, qualquer um
  decripta o acervo. **Fora de escopo aqui**: qualquer mecanismo de rotação —
  esse já existe (`CREDENTIALS_MASTER_KEY_PREVIOUS` +
  `src/scripts/rewrap-deks.ts`) e não muda; esta é só a checagem de BOOT.
- `SECRET_KEY_BASE` (engine) — já derrubava o boot sem a variável
  (`runtime.exs`, bloco `:prod`, boilerplate padrão do Phoenix). O defeito
  real não era falta de checagem no Elixir: era o `docker-compose.prod.yml`
  suprir o literal público como fallback, o que fazia a variável chegar
  sempre DEFINIDA e mascarava o `raise` que já existia. A correção aqui foi
  só remover o fallback do compose — nenhuma linha de Elixir mudou.

Vale a mesma razão do ADR 0059 para rejeitar o literal, e não só o vazio: o
`docker-compose.prod.yml` supria os quatro literais como fallback, então no
caminho real de erro as variáveis estavam **definidas** — uma verificação de
"não vazia" passaria por cima do defeito inteiro.

- **Onde:** `apps/api/src/infrastructure/security/auth-key-material.ts`
  (`passphraseAtual`), `apps/api/src/infrastructure/security/service-token.ts`
  (`tokenDeServicoAtual`) e
  `apps/api/src/infrastructure/security/envelope-encryption.service.ts`
  (`EnvelopeEncryptionService`, checagem no construtor) — os dois primeiros
  chamados no boot em `apps/api/src/main.ts`, o terceiro exercitado quando o
  `NestFactory.create` monta o grafo de providers. `SECRET_KEY_BASE` em
  `apps/engine/config/runtime.exs` (inalterado) com o fallback removido de
  `docker/docker-compose.prod.yml`
- **Teste:** `apps/api/test/infrastructure/security/auth-key-material.spec.ts`,
  `apps/api/test/infrastructure/security/service-token.spec.ts` e o describe
  `validação de produção` em
  `apps/api/test/infrastructure/security/envelope-encryption.service.spec.ts`
- **Origem:** [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-076 — A credencial de git nunca é escrita em arquivo {#rn-076}

O engine trabalha em repositório remoto pedindo o **remoto de trabalho** à api
(`GET /internal/projects/:projectId/git-remote`), que devolve a origem **limpa**
e o token do owner à parte. O token entra na invocação do git pelo **ambiente do
processo filho** e em nenhum outro lugar:

- **não no `origin`** — é a URL limpa que fica gravada no `.git/config`;
- **não em argv** — `ps` mostra a linha de comando de qualquer processo;
- **não em arquivo** — nem helper persistido, nem `~/.git-credentials`.

O helper de credencial é passado por `-c`, vale só para aquele processo, e vem
depois de um `credential.helper=` vazio: helpers são acumulativos e o primeiro a
responder ganha, então sem zerar antes um helper do host responderia no lugar.

**Por que isso é regra e não preferência.** Escrever
`https://x-access-token:TOKEN@github.com/…` no `origin` — o que quase todo
tutorial ensina — grava a credencial em texto puro **dentro da pasta do
projeto**, exatamente onde a [RN-075](#rn-075) dá ao dev agent leitura
**auto-aprovada**. Um `cat .git/config` devolveria o token sem passar por
aprovação nenhuma, e ele viajaria ao provider de LLM no histórico do laço. O
escopo de caminho protege contra o agente ler para FORA do projeto; não tem como
proteger contra um segredo que o próprio produto colocou DENTRO.

A credencial é a do **owner do workspace**, pelo mesmo resolvedor da
[RN-058](#rn-058) — duas regras de "de quem é a credencial" divergiriam.
Provider `local` não tem token nem consulta a api: é resolvido direto do banco,
e é o caminho que o `pnpm dev` e a suite inteira exercitam.

- **Onde:** `apps/engine/lib/engine/actions/git_auth.ex`,
  `engine/projects/project_repository.ex` (`remoto_de_trabalho/1`),
  `apps/api/src/application/use-cases/git/get-project-git-remote.use-case.ts`
- **Teste:** `apps/engine/test/engine/actions/git_auth_test.exs` (o token não
  aparece em argv nem no helper) e
  `apps/api/test/application/use-cases/git/get-project-git-remote.use-case.spec.ts`
  (a origem devolvida não contém o token nem `@`)
- **Origem:** [ADR 0056](adr/0056-o-engine-trabalha-em-repositorio-remoto.md),
  achado N, Fase B do [backlog](explanation/backlog.md)

### RN-077 — A origem da falha é sempre uma das quatro {#rn-077}

Todo desfecho de falha nomeia a ORIGEM no vocabulário **fechado** do
[ADR 0020](adr/0020-destravar-gates-qa-secops.md) —
`infra | modelo | codigo | politica`. Não há quinto valor: `null` e
`"indeterminada"` deixaram de ser possíveis.

Duas garantias estruturais, e nenhuma depende de alguém lembrar:

- **`AgentIo.block_task/4` não tem default para a origem.** Ela era
  "obrigatória em espírito", com `"indeterminada"` de default — e o desfecho
  mais caro da execução real saiu exatamente assim, porque o call site não
  passou nada. Sem default, esquecer vira erro de compilação.
- **`FalhaDeTurno.origem/1` sempre devolve uma das quatro**, e há teste de
  tabela que falha se alguma entrada — inclusive uma forma nunca vista —
  produzir outra coisa.

**Por que `indeterminada` saiu.** Ela existiu com um argumento razoável: não
chutar seria mais honesto que escolher no escuro. O efeito real foi o oposto —
`indeterminada` **não aponta ação nenhuma**, e quem triava a rodada seguinte
recomeçava a investigação do zero. O que ela significava de fato era *o
classificador não reconheceu esta forma*, que é lacuna do nosso código: `codigo`
é a origem que aponta a ação certa (acrescentar a cláusula que falta). O
diagnóstico continua indo verbatim, então nada se perde.

**As origens não são chute.** Cada desfecho do ToolLoop diz quem decidiu parar:
`report_blocked` e teto de iterações são do **modelo** (ele decidiu, ou gastou o
que tinha); orçamento e PR não aprovada são **política** (foi uma decisão, nada
quebrou); restart e falha ao montar contexto são **infra**; e quando há
`last_error`, a origem sai do MESMO erro que o diagnóstico narra — era esse par
que se contradizia, com `diagnosis` dizendo `{413, …}` e `origem` dizendo
"indeterminada" na mesma linha.

- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `engine/dev/agent_io.ex` (`block_task/4`, sem default),
  `engine/dev/dev_agent_server.ex` (`origem_da_parada/1`)
- **Teste:** `apps/engine/test/engine/agents/falha_de_turno_test.exs`
  (`o vocabulário é fechado`) e
  `apps/engine/test/engine/dev/dev_agent_server_test.exs`, que afirma a origem
  no evento emitido
- **Origem:** achados P, Q e T de
  [achados-execucao-real.md](explanation/achados-execucao-real.md), Fase G do
  [backlog](explanation/backlog.md)

### RN-078 — Falha em proteger branches pode ser reconhecida, e só ela {#rn-078}

`protect_branches` falha em repositório privado no plano gratuito do GitHub — e
o wizard **avisa isso antes de começar**. O usuário pode reconhecer a falha e
seguir; o bootstrap fecha e o projeto passa a ser alcançável.

**O que isso destrava é maior do que parece.** O único botão oferecido depois da
falha era "Tentar novamente", que falha sempre pelo mesmo motivo. E
`provision_failed` faz o dashboard **redirecionar o clique do projeto de volta
para a página de provisionamento** — o projeto ficava inalcançável para sempre,
preso num passo que não tem como suceder.

**Só a proteção pode ser reconhecida.** Ela é o ÚLTIMO passo e a única cuja
falha deixa um repositório utilizável: o repo existe, os arquivos foram
commitados, as branches foram criadas. Falhar em criar o repositório ou em
commitar é outra coisa — ali "seguir" produziria um projeto sem onde trabalhar,
e o botão seria uma segunda mentira em cima da primeira. A recusa diz isso, em
vez de só negar.

**A garantia do produto não muda.** A trava de merge ([RN-006](#rn-006)) é
aplicada em `decide.ts`, não pela proteção do provider. Seguir sem ela remove a
segunda camada, a do GitHub — não a do Brabo. É o que torna esta saída honesta
em vez de um atalho.

A decisão vai para o event log com o **usuário** como ator e o erro original no
payload: seguir sem proteção é escolha dele, e quem ler depois precisa saber o
que exatamente foi dispensado.

- **Onde:** `apps/api/src/application/use-cases/git/acknowledge-protection-failure.use-case.ts`,
  rota em `interfaces/http/git/git.controller.ts`, botão em
  `apps/web/src/routes/ProvisioningPage.tsx`
- **Teste:** `apps/api/test/application/use-cases/git/acknowledge-protection-failure.use-case.spec.ts`
  (destrava; a decisão no log com o ator; e a recusa para falha anterior)
- **Origem:** achado D, Fase D do [backlog](explanation/backlog.md)

### RN-079 — O Psicólogo não analisa sessão sem evento analisável {#rn-079}

Antes de gastar um turno de modelo, a análise pergunta se há o que analisar. Não
havendo, ela **não roda** e o desfecho vira `psychologist.analysis_skipped`.

**Analisável exclui duas coisas, por motivos diferentes:**

- **o rastro dos próprios analistas.** O Psicólogo grava o turno dele no log da
  sessão que está analisando (`agent.response`, `tool.call`, `tool.result`, a
  hipótese). Contar isso faria uma sessão vazia parecer povoada **a partir da
  primeira análise**, e cada retentativa a encheria mais — o critério nunca mais
  reprovaria. Vale igual para a Anamnese;
- **`bootstrap.*`**, que é provisionamento de repositório rodando sozinho: nove
  passos de máquina não dizem nada sobre a pessoa.

Tudo o mais conta, inclusive `proposed_action.*` — o usuário aprovando e negando
sem escrever mensagem nenhuma **é** comportamento, lição que a Anamnese já tinha
aprendido ([RN-063](#rn-063)).

**São duas contagens, e elas não se substituem.** A crua dimensiona o trabalho
(quanto log ler, logo qual tier de triagem, leve ou pesado); a analisável decide
se há trabalho. Confundi-las é o defeito: uma sessão só de bootstrap passava por "20
eventos" sem ter nenhum, ganhava a análise, e o modelo — sem nada para citar —
inventava `seq` inexistentes até a validação de evidência rejeitar e ele
desistir, com o orçamento já gasto.

**Pular vale também para reprocessamento manual.** Reprocessar não fabrica
material: quem clicou recebe o motivo no log em vez de uma hipótese inventada
sobre um log que não existe.

O skip vira **evento**, ao contrário do da Anamnese, que é só log — aquele roda
a cada 15 min e viraria ruído, este roda uma vez por fechamento de sessão, e uma
análise ausente sem nada narrado é indiagnosticável.

- **Onde:** `apps/engine/lib/engine/session_events/event.ex` (`count_analisaveis/1`),
  `apps/engine/lib/engine/psychologist/triage.ex` (`should_run?/1`),
  `apps/engine/lib/engine/workers/psychologist_worker.ex`
- **Teste:** `apps/engine/test/engine/session_events/event_analisaveis_test.exs`
  (inclui a reprodução da sessão do achado: 14 eventos, nenhum analisável),
  `apps/engine/test/engine/workers/psychologist_worker_test.exs`
- **Origem:** achado J, Fase E do [backlog](explanation/backlog.md)

### RN-080 — Regra de negócio duplicada é recusada na entrada {#rn-080}

`business_rule` cujo título já existe **no projeto** não é gravada. A recusa
volta ao modelo pelo mesmo caminho de um payload inválido, e ele segue para a
próxima regra em vez de parar.

**Na entrada porque não há outro lugar.** Não existe tabela de regras: o
artefato É o evento `artifact.business_rule`, e evento de domínio não é apagado
nem editado. Deixar entrar significa conviver com a duplicata para sempre.

**Escopo de projeto, não de sessão** — é entre sessões que a duplicata nasce.
Rodar o Criativo de novo abre sessão nova, e uma checagem por sessão não veria a
rodada anterior, que é exatamente o caso do achado.

A comparação normaliza caixa, acento e espaço redundante; pontuação fica.
**Duplicata semântica continua passando, e isso é declarado, não esquecido:**
"Saudação com nome" e "Quem chama pode se identificar" seguem sendo duas regras,
porque separá-las é julgamento e não cabe num `if`.

- **Onde:** `apps/engine/lib/engine/harness/artifact_dedupe.ex`,
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex`,
  `apps/engine/lib/engine/session_events/event.ex` (`titulos_de_regras/1`)
- **Teste:** `apps/engine/test/engine/harness/artifact_dedupe_test.exs`,
  `apps/engine/test/engine/harness/emit_artifact_dedupe_test.exs`
- **Origem:** achado K, Fase E do [backlog](explanation/backlog.md)

### RN-081 — História repetida: título igual recusa, justificativa igual avisa {#rn-081}

Duas respostas diferentes para dois problemas diferentes:

- **título idêntico** no projeto é erro, não escolha: a história é **recusada** e
  nada é criado;
- **mesma justificativa** — todas as regras de negócio que a história cita já
  estavam cobertas por outra — é suspeita, não erro. A história **é criada** e
  sai um `backlog.story_overlap_warned`. Um segundo recorte da mesma regra pode
  ser legítimo, então quem julga é o usuário; o produto só se recusa a deixar
  passar despercebido.

**Contido, não intersecção.** Duas histórias compartilharem uma regra é normal, e
avisar disso viraria ruído que ninguém lê. O sinal só existe quando a nova não
acrescenta cobertura nenhuma. História que não cita regra alguma não gera aviso:
tratar o conjunto vazio como subconjunto de tudo acusaria todas.

**O limite é o mesmo da [RN-080](#rn-080), e o par do achado o atravessa:**
"Endpoint público de saudação determinística" e "Endpoint público GET /hello que
responde saudação imediata" cobrem o mesmo endpoint com títulos e justificativas
diferentes — nada mecânico os liga, e eles continuam passando. Há teste
afirmando isso, para o limite ficar visível em vez de implícito.

- **Onde:** `apps/api/src/domain/backlog/story-overlap.ts`,
  `apps/api/src/application/use-cases/backlog/create-story.use-case.ts`
- **Teste:** `apps/api/test/domain/backlog/story-overlap.spec.ts`,
  `apps/api/test/application/use-cases/backlog/create-story.use-case.spec.ts`
- **Origem:** achado R, Fase E do [backlog](explanation/backlog.md)

### RN-082 — A credencial de git de uma ação é a do OWNER do workspace {#rn-082}

Quando a api executa uma ação de git contra provider remoto (`pr_open`,
`git_merge`), o token vem do **owner do workspace** — o mesmo resolvedor da
[RN-058](#rn-058), não de quem decidiu a ação.

**Resolver por quem decidiu só funcionava com clique humano.** Ação
auto-aprovada por política não tem decisor: `decided_by` fica `NULL`, o token
fica `undefined`, e o GitHub responde `Requires authentication`. Na prática,
com autonomia ligada — que é o modo que o ADR 0055 existe para viabilizar —
**nenhum dev agent conseguia abrir PR em provider remoto**.

**O contraste que expôs o defeito** aconteceu dentro de uma execução só: no
mesmo run, `git_push` passou e `pr_open` falhou. O push é executado pelo
ENGINE, que já injetava a credencial do owner
([RN-076](#rn-076)); a PR é aberta pela API, que estava fora de simetria.

Não apareceu antes porque toda validação anterior usou o `LocalGitProvider`,
onde o token nem é consultado.

O princípio é o mesmo da RN-058, e vale repetir porque é o que impede as duas
regras de divergirem com o tempo: **quem banca a conta banca os agentes**, e
isso não muda conforme quem clica. Por isso o resolvedor é REUSADO em vez de
reimplementado.

- **Onde:** `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`,
  reusando `application/use-cases/llm/resolve-credential-owner.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  (`pr_open` auto-aprovado, com `decidedBy: null`, pede a credencial do owner)
- **Origem:** achado AA, [validação real da 13b](explanation/validacao-real.md)

### RN-083 — O lead decide o paralelismo; acima do teto, você autoriza {#rn-083}

Quantos agentes sobem deixa de ser um número no código: quem avalia é o **lead
da área**. Mas a decisão dele não é soberana sobre GASTO — até
`agent_areas.max_parallel` (default **2**) ele sobe e segue; **acima disso vira
`proposed_action` do tipo `parallelize`**, pelo mesmo pipeline de toda ação com
efeito externo.

**O teto é da SESSÃO, não do módulo.** É a única parte da regra que não é
óbvia, e a que um refactor desatento desfaz: contar por módulo permitiria N
módulos × 2 agentes sem autorização nenhuma — o buraco anterior com outro nome.
Há teste afirmando exatamente isso.

**Teto zero ou negativo é configuração inválida, não "sem limite".** Tratá-lo
como ilimitado transformaria um erro de digitação em gasto irrestrito, que é o
oposto do que o pipeline existe para fazer.

**Quem PEDE é o lead; quem DECIDE é você.** A `proposed_action` nasce com o
lead como ator, e a decisão fica no event log com o seu nome — é essa distinção
que faz a história ser reconstituível depois ([ADR 0048](adr/0048-decisao-no-log-e-a-ordem-do-gate.md)).

O motivo viaja no payload IMUTÁVEL, com os três números (quantos há, quantos
pede, qual o teto): quem ler daqui a seis meses precisa entender o que foi
autorizado sem reconstruir o estado da sessão.

`AcceptParallelizationUseCase` não muda: ele continua sendo quem EXECUTA, tanto
no caminho direto quanto quando a ação é aprovada. Absorvê-lo por dentro, em vez
de reescrevê-lo, é o que mantém a suite da Fase 4 verde sem modificação — que é
a prova de que a troca não vazou para o contrato externo.

**O teto é configurável por área, e só por você.** `PATCH
/projects/:projectId/agent-areas/:key/max-parallel` exige `maintainer` — o mesmo
papel de ativar a execução, e pelo mesmo motivo: mudar o teto é decidir quanto o
produto pode gastar sem perguntar. Não existe caminho automático de subi-lo. A
Anamnese pode PROPOR, quando notar que a autorização virou rotina, e a proposta
continua passando por esta rota depois que você aceita — um produto que eleva o
próprio teto de gasto é exatamente o que o pipeline de aprovação existe para
impedir.

Mudar o teto vale para os PRÓXIMOS pedidos. O que já está aguardando decisão
continua aguardando: a ação carrega no payload o teto vigente quando foi criada,
e reinterpretá-la sob o teto novo mudaria o que você está prestes a decidir
depois de ler.

- **Onde:** `apps/api/src/domain/execution/paralelismo.ts` (a regra pura),
  `application/use-cases/execution/request-parallelization.use-case.ts`,
  `application/use-cases/execution/set-area-max-parallel.use-case.ts`,
  exposto em `interfaces/http/execution/execution.controller.ts` e configurado
  em `apps/web/src/routes/ProjectSettingsTab.tsx` (`ParallelismSection`)
- **Teste:** `apps/api/test/domain/execution/paralelismo.spec.ts`,
  `test/application/use-cases/execution/request-parallelization.use-case.spec.ts`,
  `test/application/use-cases/execution/set-area-max-parallel.use-case.spec.ts`
  e `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ParallelismSection`)
- **Origem:** [ADR 0053](adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-094 — A área de agentes nasce com o projeto {#rn-094}

Criar um projeto grava as três áreas (`dev`, `qa`, `infra`) em `agent_areas`,
com o lead de cada uma e os membros **enumeráveis** em `agent_area_members` —
na MESMA transação da criação. Se o seeding falha, o projeto não nasce: projeto
sem área é projeto onde a RN-083 lê tabela vazia e cai no default sem que
ninguém tenha decidido nada.

**Isto é a correção de um defeito, não uma capacidade nova.** `agent_areas`
existe desde a FASE 14d e nunca foi gravada — `AgentAreaRepository.upsert`
tinha teste e não tinha NENHUM chamador. Em produção a tabela estava vazia,
`GET /projects/:projectId/agent-areas` devolvia `[]`, e os quatro casos de uso
que a leem operavam sobre o nada. É a mesma falha da própria FASE 14d, escrita
no CLAUDE.md: **testar a peça não é testar o caminho até ela**. Por isso o
teste desta regra entra pelo caso de uso que a rota chama, com repositório
real: um fake aqui provaria exatamente o que já estava provado e quebrado.

**Semeia em DOIS lugares, e cada um responde uma pergunta diferente.** A
criação do projeto faz a área EXISTIR — a tela de Configurações lê num projeto
que nunca executou. A ativação da execução diz quem são os MEMBROS da área de
`dev`: um `dev-<modulo>` por módulo do `module_map`, que não existia quando o
projeto nasceu. Enquanto não há membros gravados, quem sustenta a regra de
endereçamento (RN-087) é o predicado `ehDevDeModulo`, que não consulta o banco.

**O seeding nunca manda `max_parallel`.** A ativação é repetível, e mandar o
default faria um teto que você subiu para 5 voltar para 2 em silêncio — o
produto desfazendo a sua decisão. O mesmo vale para a migração de backfill: ela
faz a área existir e para aí.

Projetos criados antes disto são cobertos pela migração `0038`, com `ON
CONFLICT DO NOTHING` nas duas tabelas. Sem ela, o defeito ficaria corrigido só
para quem começasse do zero.

- **Onde:**
  `apps/api/src/application/use-cases/agents/seed-agent-areas.use-case.ts`,
  chamado por `application/use-cases/iam/create-project.use-case.ts` e
  `application/use-cases/execution/activate-execution.use-case.ts`;
  lista canônica em `apps/api/src/domain/agents/agent-areas.ts`;
  backfill em `apps/api/src/db/migrations/0038_wandering_lila_cheney.sql`
- **Teste:**
  `test/application/use-cases/iam/create-project-semeia-areas.spec.ts` (o
  caminho, contra o banco, incluindo a falha que derruba a criação),
  `test/db/agent-areas-backfill.spec.ts` (a migração rodada de verdade, duas
  vezes) e `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (os membros de dev, e o teto nunca enviado)
- **Origem:** FASE 18, defeito achado na investigação do programa 16–26;
  a tabela vem do [ADR 0053](adr/0053-dev-lead-e-paralelismo-autorizado.md)

### RN-084 — A esteira exibida deriva do registro de gates {#rn-084}

O painel do time mostra a etapa em que uma PR está **derivando-a de
`docs/gates.yml`**, não de uma lista escrita na tela. Gate que sai do registro
some da esteira; gate `planned` nunca aparece.

**A regra existe por uma forma específica de envelhecimento.** Antes da FASE
15b a tela tinha as etapas fixas no componente, e o registro (FASE 15a)
descrevia os gates em outro lugar. Nada ligava os dois: acrescentar um gate ao
YAML não mudava a tela, e remover um deixava a tela mostrando uma etapa que já
não existia — sem nenhum teste falhar, porque as duas fontes estavam certas
cada uma por si. É o mesmo apodrecimento que o `docs/.docmap.yml` existe para
impedir, e a resposta é a mesma: uma fonte só, com o consumo cobrado.

Três decisões de borda, todas para a tela **degradar** em vez de sumir:

- gate de PR que a tela ainda não sabe desenhar é **ignorado**, não quebra o
  render — o registro pode ganhar um gate antes de a tela ganhar o rótulo;
- os **rótulos são de tela**, não do registro: o YAML descreve engenharia, e a
  tela fala com quem espera uma PR;
- **sem registro** (a rota falhou), mostra a esteira completa em vez de vazia —
  uma esteira genérica informa mais que nada.

- **Onde:** `apps/web/src/components/PrGateTimeline.tsx` (`etapasDaEsteira`),
  lendo `GET /gates` (`apps/api/src/interfaces/http/gates/gates.controller.ts`)
- **Teste:** `apps/web/src/components/PrGateTimeline.test.ts`
  (`gate que SAI do registro some da tela`, `gate de PR que a tela ainda não
  sabe desenhar é IGNORADO`, `sem registro, mostra a esteira completa`)
- **Origem:** [ADR 0054](adr/0054-gates-como-registro-declarativo.md), FASE 15b

### RN-085 — O teto de iterações é por TIPO de agente {#rn-085}

Quantas voltas um agente pode dar no laço de ferramenta depende do trabalho que
ele faz: **8** para quem conversa, **60** para o dev agent e para os subagentes
de QA. Não há mais um número único.

**O teto de 8 nasceu de agente conversacional e foi herdado por quem trabalha.**
Na validação real da 13b isso apareceu como bloqueio: o dev agent gastou as
oito voltas explorando um repositório recém-provisionado e **nunca escreveu um
arquivo**; com 25, escreveu três e rodou os testes. O desfecho registrado era
`limite de iterações atingido` com origem `modelo` — tecnicamente verdade e
praticamente inútil, porque o modelo nunca chegou a julgar nada.

**Subir o default global seria a correção errada**, e é isso que a regra
protege: o Criativo não precisa de 60 voltas para conversar, e o teto também é
a trava contra laço infinito.

**Quem pode subir não é "quem trabalha muito", é quem tem trava de gasto por
baixo.** O teto de iterações protege contra laço infinito; quem protege o
BOLSO é o `token_budget_micros`. Dev agents e subagentes de QA rodam com o
`task_budget_micros` da task, então afrouxar as voltas não afrouxa a conta.
`infra-workflows` usa ferramenta pesada e mesmo assim **fica em 8**: ele roda
sem budget, e para ele o teto é a única trava que existe.

Duas bordas com teste próprio:

- **`dev-lead` é conversacional**, apesar do prefixo `dev-` que identifica os
  dev agents (`dev-<modulo>`, `dev-<modulo>-2`). O lead decide e delega, e sem
  a cláusula explícita nasceria com o teto do trabalho pesado por acidente de
  nomenclatura.
- **Agente desconhecido cai no teto mais baixo.** Errar para o lado barato:
  quem precisa de mais voltas aparece como `limite de iterações atingido` e é
  corrigido; quem ganha 60 por engano gasta calado.

- **Onde:** `apps/engine/lib/engine/harness/iteracoes.ex`, aplicado em
  `apps/engine/lib/engine/harness/tool_loop.ex` (`init/1`)
- **Teste:** `apps/engine/test/engine/harness/iteracoes_test.exs` e
  `apps/engine/test/engine/harness/tool_loop_test.exs`
  (`o teto vem do TIPO do agente quando o chamador não passa um`,
  `teto explícito do chamador VENCE o do tipo`)
- **Origem:** achado X, [validação real da 13b](explanation/validacao-real.md);
  [ADR 0053](adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-086 — Gastar com mais agentes nunca se auto-aprova {#rn-086}

As duas ações que mexem em **quanto o produto pode gastar sozinho** —
`parallelize` (ultrapassar o teto agora) e `raise_max_parallel` (mudar o teto)
— nunca são auto-aprováveis. Nem por `agent_autonomy`, nem por
`permissions.json`. É a mesma classe de garantia da trava de merge e do teto do
patch de instrução.

**Sem isto o teto da [RN-083](#rn-083) seria decorativo.** Um `permissions.json`
com `Parallelize()` no `allow` faria toda ultrapassagem se aprovar sozinha — a
regra que existe para EXIGIR a decisão do usuário passaria a dispensá-la. E
`raise_max_parallel` é o caso mais grave: seria o produto elevando o próprio
limite de gasto, exatamente o que o pipeline de aprovação existe para impedir.

**A Anamnese pode PROPOR, e é isso que ela faz.** Quando autorizar mais um
agente vira rotina, o teto está errado, e quem percebe primeiro é quem lê o
histórico. O sinal já chegava a ela: as decisões do usuário na janela vêm de
`proposed_actions`, com `actionType` e `status`.

O limiar é **três aprovações e nenhuma negação**, e as duas metades importam:

- **duas não são rotina — são duas.** Três é o que separa "aconteceu" de "está
  acontecendo sempre";
- **uma negação derruba o sinal inteiro**, por mais aprovações que haja. Se o
  usuário recusou alguma vez, o teto está fazendo o trabalho dele, e propor
  subi-lo seria ler o sinal ao contrário.

Propor um teto **igual ou menor** que o vigente é recusado pela api: a Anamnese
roda periodicamente e reproporia a mesma coisa a cada rodada, enchendo de ruído
uma fila que o usuário precisa ler.

Aprovar aplica o valor do **payload**, não um recalculado na hora — é o número
que você leu ao decidir.

- **Onde:** `apps/api/src/domain/actions/decide.ts` (o teto),
  `application/use-cases/execution/propose-max-parallel.use-case.ts`,
  `execute-max-parallel-raise.use-case.ts`,
  `apps/engine/lib/engine/anamnese/tools/propose_max_parallel.ex` e o limiar em
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`nota_de_paralelismo/1`)
- **Teste:** `apps/api/test/domain/actions/decide.spec.ts`
  (`decide — teto do paralelismo`),
  `test/application/use-cases/execution/propose-max-parallel.use-case.spec.ts`,
  `execute-max-parallel-raise.use-case.spec.ts`,
  `apps/engine/test/engine/anamnese/tools_test.exs` e
  `test/engine/workers/anamnese_worker_test.exs` (`duas aprovacoes NAO sao
  rotina`, `uma NEGACAO derruba o sinal`)
- **Origem:** [ADR 0053](adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-087 — O Dev Lead é o único endereço externo da execução {#rn-087}

Existe um agente `dev-lead`, conversacional, que recebe o handoff do Arquiteto
e propõe o **plano de execução**: quantos agentes por módulo e por quê. Ele não
escreve código — distribui trabalho e responde por ele.

**Antes dele, a frase "quem decide é o lead" da [RN-083](#rn-083) não tinha
dono.** O Arquiteto terminava e a execução subia por um botão, sem ninguém no
meio para avaliar quanto trabalho havia.

**Os `dev-<modulo>` deixaram de ser endereçáveis por handoff.** Isso não é
exceção nova: é a regra do [ADR 0038](adr/0038-hierarquia-de-agentes.md) —
handoff externo endereça só lead de área ou agente sem área — passando a valer
para o dev como já valia para QA e Infra. Enquanto não havia Dev Lead, eles
eram agentes SEM área e por isso alvos válidos; virando membros, deixam de ser.

**A área de `dev` é a primeira DINÂMICA**, e é o que forçou o predicado: os
membros são um por módulo do `module_map`, decididos pelo Arquiteto e
diferentes em cada projeto, então não há lista a enumerar. `dev-lead` casa com
o mesmo prefixo `dev-` dos membros, e quem o exclui é a regra genérica **o lead
nunca é membro da própria área** — que vale para qualquer área e vive num lugar
só. A primeira versão repetia essa exclusão em três pontos, e a verificação por
mutação mostrou que nenhuma das cópias era alcançável por teste: cada uma
sobrevivia à mutação da outra.

**O plano é EVENTO, não `proposed_action`.** Propor não tem efeito externo: o
gasto acontece quando os agentes sobem, e é lá que o teto cobra autorização.
Transformar a proposta em ação a decidir faria você decidir duas vezes a mesma
coisa.

**O plano BEM-SUCEDIDO encerra o turno.** Na primeira execução real o Dev Lead
registrou **dois** `execution.plan_proposed` na mesma sessão — textos
diferentes, mesmo total —, porque o laço voltava ao modelo e ele propunha de
novo. O event log é imutável: ficaram duas propostas e nada dizendo qual valia.
A instrução "use uma vez" no spec da ferramenta é pedido, não garantia; quem
garante é o laço parar.

**Bem-sucedido, e não "chamou a ferramenta"**: um plano recusado (vazio, ou com
zero agente num módulo) deixa o laço seguir, senão a recusa vira fim de turno e
o modelo nunca chega a corrigir. A primeira versão desta guarda olhava só o
nome da ferramenta e tinha esse defeito — encontrado pelo teste comportamental,
não pela leitura.

Um plano vazio, ou com zero agente num módulo, é recusado **antes de gravar
qualquer coisa** — o event log é imutável, e um plano meio gravado não teria
como ser retratado.

- **Onde:** `apps/engine/lib/engine/agents/dev_lead_server.ex` e
  `dev_lead_tools.ex`; a regra de endereçamento em
  `apps/api/src/domain/agents/agent-areas.ts`; o handoff em
  `application/use-cases/agents/offer-infra-handoff.use-case.ts`
- **Teste:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  `dev_lead_server_test.exs` (`o plano ENCERRA o turno`, `o plano recusado NÃO
  encerra o turno`),
  `apps/api/test/domain/agents/agent-areas.spec.ts` (`o dev de módulo DEIXOU de
  ser endereçável`, `` `dev-lead` É endereçável, apesar do prefixo ``) e
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
- **Origem:** [ADR 0053](adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-064 — Heartbeat não encerra sessão com trabalho pendente {#rn-064}

O timeout de heartbeat mede inatividade da **aba**, não do **trabalho**. Antes
de encerrar, o `SessionServer` pergunta à api se sobrou trabalho
(`GET /internal/sessions/:id/pending-work`); havendo, reagenda o timeout e
registra o motivo no log em vez de matar a sessão.

O default são **30 segundos**. Sair da sessão para a aba de Backlog já bastava
para matá-la — e numa execução real isso prendeu um handoff `offered` para o
Arquiteto dentro de uma sessão fechada: épico e quatro histórias prontos, e a
cadeia sem como seguir, porque não existe onde aceitar handoff de sessão morta.

Fechar sessão é sobre o trabalho ter acabado, não sobre quem está olhando.

**A api fora do ar NÃO impede o encerramento**: `{:error, _}` encerra assim
mesmo, com aviso no log. Trocar sessão órfã por sessão imortal seria trocar um
defeito por outro.

"Trabalho pendente" são **três** sinais — o segundo entrou pelo achado V, o
terceiro pelo bug real do Criativo→PO→Arquiteto:

1. **handoff `offered`** — o caso original acima;
2. **`proposed_action` com status `pending`** — alguém está esperando a SUA
   decisão, e um agente pode estar suspenso esperando o desfecho
   ([RN-073](#rn-073));
3. **agente ATIVADO ainda em turno** — o último `agent.status` de cada ator
   que já falou na sessão é `working` sem um `idle` posterior.

O segundo é o mesmo defeito do primeiro um nível abaixo, e a execução do
`hello-limpo` mostrou o custo: a sessão nasceu 23:34:12, uma ação ficou
`pending` às 23:34:13, e o heartbeat a fechou às **23:34:42 — exatamente os 30s
do timeout**. O dev agent seguiu trabalhando por mais de uma hora numa sessão
que o banco dava por encerrada, e isso envenena toda métrica por sessão:
duração, custo e "quantas terminaram bem" passam a ler um estado que não
descreve o que houve.

O terceiro é a mesma janela, um passo antes de qualquer um dos dois primeiros
existir: `AcceptHandoffUseCase` marca o handoff antigo como `accepted` e ativa
o próximo agente na hora, mas a ativação no engine é `GenServer.cast`
fire-and-forget — responde 201 antes de o agente sequer começar. O PO ativado
pelo handoff do Criativo roda um kickoff de até 12 iterações de LLM usando só
ferramentas `category: :direct` (`create_epic`/`create_story`/`create_task`),
que nunca geram `proposed_action`, e só oferece o handoff seguinte (o sinal 1)
no FIM do turno inteiro. Entre a ativação e esse fim, nem o sinal 1 nem o sinal
2 existiam — só o ping do canal Phoenix a cada 10s segurava a sessão, e
qualquer atraso maior que os 30s do timeout fechava a sessão com o PO ainda
gerando o backlog, quebrando a cadeia de handoff pela raiz: o handoff seguinte
acabava sendo oferecido numa sessão já `closed`, que não aceita mais nada.

`agent.status` (`working`/`idle`) é o que todo agente conversacional
(Criativo/PO/Arquiteto/Dev Lead/Infra) já narra nos limites de turno, e é
PERSISTIDO no event log, não só broadcastado no canal
(`Engine.Sessions.LiveBroadcast.agent_status/4`, [ADR 0021](adr/0021-fechamento-4a-infra-e-painel.md))
— o mesmo sinal que o painel do time já lê para derivar o roster
(`conversationalStatus` em `apps/web/src/lib/agent-status.ts`). Reaproveitá-lo
aqui não exigiu evento novo nenhum: o terceiro sinal é o último `agent.status`
de CADA ator que já falou na sessão, e é genérico por tipo de evento — cobre
qualquer agente ativado por handoff, não só o PO.

A versão anterior desta regra dizia, por escrito, que incluir trabalho de agente
"sem um teste que prove a interação seria adivinhar". A execução produziu a
prova, e o teste agora existe.

**O que continua fora:** task `in_progress` sem ação pendente nem handoff nem
turno em aberto. O dev agent tem máquina de estados própria e retém o worktree
por conta dele; o sinal que a api possui e que a execução comprovou é a ação
pendente. Incluir a task exigiria a api ler `dev_agent_states`, que é do
engine — decisão de fronteira, não conserto de passagem. Os dev agents também
não emitem `agent.status` (rodam com máquina de estados própria, não com o
loop conversacional de turno) — o terceiro sinal não os cobre, e não precisa:
a ação pendente já cobre o caminho deles.

- **Onde:** `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`,
  `apps/api/src/application/ports/session-event-repository.port.ts`
  (`listByTypeInSession`), `apps/engine/lib/engine/sessions/session_server.ex`
  (`handle_info(:heartbeat_timeout, …)`)
- **Teste:** `apps/engine/test/engine/sessions/session_lifecycle_test.exs`
  (`heartbeat NÃO encerra sessão com trabalho pendente` e o caso oposto) e
  `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  (os três sinais, a ação já decidida que NÃO segura, o `idle` que libera, o
  isolamento por ator, a genericidade por tipo de agente e o escopo por
  sessão)
- **Origem:** execução real da FASE 13b; achado V, Fase H do
  [backlog](explanation/backlog.md); bug real do encadeamento
  Criativo→PO→Arquiteto

### RN-063 — Encerrar sem produzir é desfecho, não falha {#rn-063}

A Anamnese tem uma ferramenta para dizer **"não há nada a emitir, e este é o
motivo"** (`skip_proficiency`). A rodada encerra com `anamnese.run_skipped` e o
motivo no payload — nunca com `anamnese.run_failed`.

Antes ela não tinha esse verbo. A única ferramenta era `emit_proficiency`, que
recusa lista vazia (com razão: perfil vazio não é perfil). Numa janela sem
membro elegível a Anamnese descobria isso na PRIMEIRA iteração, escrevia em
prosa "não há membros elegíveis", chamava `emit_proficiency` com `profiles: []`,
era recusada — e repetia até o teto de iterações. Cada volta reenvia o
histórico, que cresce a cada volta.

Numa execução real isso custou **145 mil tokens de entrada e 4× o gasto do
Criativo e do PO somados**, sem produzir nada. E voltava a cada tick do
agendador, a cada 15 minutos, para sempre.

O teto de iterações funcionava — não era laço infinito. O desperdício era **por
rodada, repetido indefinidamente**, que é pior: um laço trava e alguém percebe;
este sangrava devagar.

Narrar `run_failed` para uma rodada que fez a coisa certa também é defeito: quem
lê o log aprende a ignorar o evento de falha.

- **Onde:** `apps/engine/lib/engine/anamnese/tools/skip_proficiency.ex`,
  `apps/engine/lib/engine/anamnese/hooks/termination.ex`,
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`handle_outcome`)
- **Teste:** `apps/engine/test/engine/workers/anamnese_worker_test.exs`
  (`encerrar sem perfis é DESFECHO: narra run_skipped com o motivo, não falha`)
- **Origem:** execução real da FASE 13b

### RN-062 — Mensagem a agente conversacional REIDRATA o processo {#rn-062}

Uma mensagem endereçada a Criativo, PO ou Arquiteto sobe o processo se ele não
estiver de pé, antes de entregar. O `init` de cada servidor já reconstrói o
histórico do event log; faltava quem o chamasse.

Antes, um restart do engine matava a conversa em silêncio: a sessão sobrevivia
como `active`, o processo do agente não, e a próxima mensagem morria com
`GenServer.call ... exited` — sem evento, sem erro na tela, sem nada. O usuário
via a própria mensagem aparecer e nenhuma resposta chegar, para sempre.

O comentário de `revise/2` dizia que agente morto nesta rota "é um bug". É — e
basta o engine reiniciar para acontecer. É a mesma garantia que a Fase 12b deu
aos dev agents, aplicada aos conversacionais.

- **Onde:** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  (`message/2`)
- **Teste:** coberto pela suite de agentes; a prova de execução está em
  docs/explanation/validacao-real.md
- **Origem:** execução real da FASE 13b

### RN-060 — O gasto das chaves é do owner, e só ele vê {#rn-060}

O relatório de consumo por credencial (`GET /workspaces/:id/credential-spend`)
exige **`owner`** no workspace. Não é `maintainer`: desde a
[RN-058](#rn-058) os agentes de todos os projetos gastam a credencial do dono,
e a fatura dele não é assunto de quem só opera um projeto.

O relatório agrupa por **provider**, porque é essa a unidade da credencial —
uma chave por provider, por pessoa. Um total único não bateria com fatura
nenhuma.

E separa **agente** de **pessoa**: as duas coisas saem da mesma chave desde a
RN-058, e "meus agentes estão caros?" é uma pergunta diferente de "eu uso muito
o chat?". Por isso este é o único agregado de custo do produto **sem** o filtro
`actor_kind = 'agent'` da [RN-038](#rn-038) — aqui a pergunta é quanto saiu da
chave, e o chat do próprio owner sai dela.

Gasto de credencial **já removida** continua no relatório, marcado: o consumo
aconteceu, e escondê-lo daria um total que não fecha com o extrato do provider.

Nenhum segredo atravessa: a resposta tem provider, tokens e custo — nunca a
chave, nem cifrada ([ADR 0050](adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)).

- **Onde:**
  `apps/api/src/application/use-cases/llm/get-credential-spend.use-case.ts`,
  `apps/api/src/interfaces/http/llm/budgets.controller.ts`,
  `apps/web/src/components/CredentialSpendSection.tsx`
- **Teste:** `test/application/use-cases/llm/get-credential-spend.use-case.spec.ts`
  (agrupa por provider; separa agente de pessoa; chave removida fica marcada);
  `apps/web/src/components/CredentialSpendSection.test.tsx`
- **Origem:** decisão do usuário junto com a RN-058

### RN-101 — O mesmo gasto, duas audiências: a fatura é do owner, o consumo é de quem gastou {#rn-101}

O produto responde **duas perguntas diferentes** sobre `token_usage`, e nenhuma
é recorte da outra.

**A do owner é por CREDENCIAL.** `GET /workspaces/:id/credential-spend` continua
como a [RN-060](#rn-060) o deixou — por provider, exigindo `owner`, respondendo
"quanto saiu da minha chave". Junto dele, `GET /workspaces/:id/spend-report`
(também `owner`) quebra o workspace por **modelo, projeto, ator e dia**. O owner
vê os dois porque é a única pessoa que pode ver os dois.

**A do membro é por ATOR.** `GET /projects/:id/spend/me` (papel `viewer`)
devolve, em tokens e custo **estimado**, o que **quem chamou** consumiu naquele
projeto, por sessão e por dia. Ela **não quebra por provider nem por
credencial** — a chave que rodou é a do owner ([RN-058](#rn-058)), e uma fatia
da fatura dele não é o que o membro está perguntando.

O ator **não é parâmetro**: sai do usuário autenticado, e não existe onde
escrever o id de outra pessoa. "Membro não vê linha de outro ator" é propriedade
da assinatura do caso de uso, não uma checagem que alguém pode esquecer de
chamar.

**Agente não entra na conta do membro.** `token_usage` registra quem GASTOU, não
quem mandou gastar; atribuir o agente a quem o iniciou seria inventar um dado
que a tabela não tem. Gasto de agente aparece no relatório do owner, de quem é a
chave.

**A agregação nova não tem eixo de `provider`.** As cinco dimensões de
`sumGroupedBy` são `model`, `project`, `actor`, `session` e `day` — e só. A
ausência é o que impede a visão do membro de ganhar esse eixo por descuido: não
há argumento a passar. Pelo mesmo motivo, dois providers servindo o mesmo nome
de modelo caem numa linha só.

- **Onde:**
  `apps/api/src/application/use-cases/llm/get-my-spend.use-case.ts`,
  `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts`,
  `apps/api/src/application/ports/token-usage-repository.port.ts`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts`,
  `apps/web/src/routes/ProjectSpendTab.tsx`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  (o membro não enxerga linha de outro ator, nem de agente, nem do owner; o
  filtro é pelo par `(kind, id)`; a resposta não carrega provider);
  `apps/web/src/routes/ProjectSpendTab.test.tsx`
- **Origem:** [ADR 0063](adr/0063-duas-audiencias-para-o-mesmo-gasto.md) (FASE 22)

### RN-102 — O modelo da área é padrão herdável; divergir é decisão do agente, e voltar a herdar apaga a decisão {#rn-102}

A cascata de binding ganhou um nível: `sessão > agente > **área** > projeto >
workspace`. `area` fica ENTRE agente e projeto — é o PADRÃO que o lead e os
subagentes de uma área compartilham (`qa`/`qa-automacao`/
`qa-performance-seguranca`, `infra`/`infra-workflows`, `dev`/`dev-<módulo>`), e
o binding do próprio agente é a DIVERGÊNCIA que o sobrepõe. Se a área viesse
ACIMA do agente ela venceria sempre, e "padrão herdável" seria, na prática,
"padrão imposto" — nenhum agente conseguiria escolher outro modelo.

O nível novo entra na MESMA revalidação de capability da
[RN-041](#rn-041)/[RN-043](#rn-043): modelo da área que sumiu do provider ou
que não faz tool calling é PULADO e registrado em `skipped`, exatamente como
`agent` já era. `assertModelFitsBindingScope` (RN-040) passou a exigir
`supports_tool_calling` também no escopo `area` — ela nunca é lida por chat
humano, só por agente, então deixá-la passar adiaria a mesma falha silenciosa
em um nível.

**"Voltar a herdar" apaga o binding, nunca copia o modelo do nível de baixo
para o de cima.** Gravar no agente o modelo que a área decidiu pareceria igual
na tela e não é: viraria uma CÓPIA, e a próxima mudança da área deixaria esse
agente para trás sem ninguém notar. Herdar é a AUSÊNCIA de decisão própria, e
desfazer uma divergência é remover a linha — `DELETE
/projects/:id/agent-bindings/:slug` e `DELETE
/projects/:id/area-bindings/:key`, ambos 204, ambos 404 quando o escopo já
herda (idempotência que MENTIRIA se fosse 204 silencioso: apagar o que não
existia e apagar de verdade são respostas diferentes para a mesma tela).

Mudar o modelo da ÁREA exige `maintainer`, e não `developer` como o do agente
individual — pelo mesmo motivo do teto de paralelismo
([RN-083](#rn-083)): o binding da área alcança o lead e TODOS os subagentes de
uma vez, e escolher modelo é decidir quanto o produto gasta sem perguntar.

- **Onde:** `apps/api/src/domain/llm/binding-resolver.ts` (precedência),
  `apps/api/src/domain/llm/model-capabilities.ts` (capability de `area`),
  `apps/api/src/application/use-cases/llm/resolve-model-binding.use-case.ts`
  (a área do agente sai do catálogo `agent-areas.ts`, sem round-trip ao
  banco), `apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts`,
  `apps/api/src/interfaces/http/llm/model-bindings.controller.ts`
  (`area-bindings`, `DELETE` em `agent-bindings` e `area-bindings`),
  `apps/web/src/routes/ProjectSettingsTab.tsx` (`AreaModelsSection`, coluna
  Origem com "voltar a herdar")
- **Teste:** `test/domain/llm/binding-resolver.spec.ts`,
  `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/clear-model-binding.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`
- **Origem:** [ADR 0064](adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (FASE 23)

### RN-103 — O binding de agente é POR PROJETO, não mais global {#rn-103}

Até a FASE 23, `scope = 'agent'` guardava um SLUG global
(`scope_id = 'qa'`), e `PUT /projects/:id/agent-bindings/:slug` recebia
`:projectId` na rota e o DESCARTAVA de propósito — escolher o modelo do
Arquiteto na tela de um projeto mudava o modelo dele em TODOS os projetos.
Isso deixou de se sustentar quando a área virou padrão herdável (RN-102): a
área é por projeto, e um binding de agente global ACIMA de um padrão por
projeto faria o mesmo agente resolver modelos diferentes só onde existisse
área — e faria "voltar a herdar" apagar uma decisão que alcançava projetos
que ninguém está olhando.

A saída foi tornar `agent` por projeto também, e não rebaixar a área para
abaixo do agente: `scope_id` de `agent` e de `area` virou COMPOSTO —
`<projectId>:<slug do agente|chave da área>` — em vez de inventar uma tabela
nova só para guardar um projeto por binding. UUID de projeto e slug de agente
nunca contêm `:`, o que torna o primeiro `:` um separador não ambíguo; a
leitura corta nele, e não em todos, para um slug com `:` (nenhum existe hoje,
mas nada impede) não virar três pedaços.

`scope_id` sem o projeto (o formato antigo) é RECUSADO na escrita, não aceito
e ignorado: gravá-lo criaria um binding que a cascata nunca mais encontraria
— invisível, e não um erro. A migração 0040 espalha cada binding de agente
global existente para uma linha por projeto (preservando o que cada projeto
resolvia antes da mudança) e apaga o formato antigo; é ESPALHAR e não
apagar porque a linha global nunca guardou informação de a quem "pertencia" —
inventar um projeto dono seria inventar dado que não existia.

- **Onde:** `apps/api/src/domain/llm/binding-scope-id.ts` (formato e
  validação), `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo` passou a derivar o workspace de `agent`/`area` também —
  a curadoria da RN-043 não era verificável neles antes), `apps/api/src/db/migrations/0040_tearful_night_nurse.sql`
- **Teste:** `test/domain/llm/binding-scope-id.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  ("o binding de agente é POR PROJETO: o vizinho não o enxerga")
- **Origem:** [ADR 0064](adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (FASE 23)

### RN-059 — Falha de turno é evento durável com origem, e o agente fala {#rn-059}

Quando um turno de LLM falha, o agente grava **`agent.error`** no event log
com três campos: `origem` (vocabulário do ADR 0020), `mensagem` em português e
o `reason` bruto. E a mensagem aparece **no fio da conversa**, não só no log.

Era o contrário, e o desfecho era o pior possível: os quatro agentes
conversacionais gravavam `agent.response` com conteúdo **vazio** —
indistinguível de sucesso no log imutável — e mandavam o motivo por
`broadcast`, que é efêmero. Quem não estivesse com a aba aberta naquele
segundo nunca saberia que houve erro; quem estivesse, via um balão em branco.

Havia um segundo caminho, pior ainda: quando a api narrava a falha no PRÓPRIO
frame final (budget, credencial ausente, binding faltando), o turno não caía no
ramo de erro e **não emitia evento nenhum** — silêncio absoluto.

A origem NUNCA é adivinhada: cada padrão em `FalhaDeTurno.origem/1` tem um
motivo escrito, e o que não casa com nenhum sai como **`indeterminada`**, que é
mais honesto que chutar uma das quatro (ADR 0020).

Os eventos já gravados não se apagam — a tela os NOMEIA como resposta vazia
anterior a esta regra, em vez de mostrar branco.

- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `criativo_server.ex`, `po_server.ex`, `arquiteto_server.ex`,
  `infra_lead_server.ex` (`emit_falha/2`),
  `apps/web/src/lib/session-falha.ts`
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (evento durável com origem; nunca grava resposta vazia; erro narrado no frame
  final também vira evento); `apps/web/src/lib/session-falha.test.ts`
- **Origem:** execução real da FASE 13b

### RN-116 — Falha ao CRIAR um handoff não derruba o agente {#rn-116}

`confirm_readiness` (Criativo → PO) e `offer_infra_handoff`/`offer_dev_handoff`
(Arquiteto → Infra/Dev Lead) chamam a api pra criar o handoff DEPOIS de o
turno já ter rodado — no caso do Criativo, depois de o `product_brief` já
estar gravado no event log. Se essa chamada falhar (api fora, 5xx, etc.), o
handoff não existe, mas isso NUNCA derruba o GenServer do agente: a falha vira
`agent.error` durável, com `origem` (`FalhaDeTurno.origem/1`) e uma mensagem
que diz o que JÁ foi salvo (o product_brief, as regras) e o que não foi (o
handoff) — para o usuário saber que confirmar de novo é seguro, não repete
trabalho.

Era o oposto: as três chamadas usavam `{:ok, _handoff} = EngineApiClient.create_handoff(...)`
— um match rígido. `{:error, _}` virava `MatchError`, e como os três agentes
sobem com `restart: :temporary` num `DynamicSupervisor` `:one_for_one`, o
processo simplesmente SUMIA — sem `agent.error`, sem resposta no fio, só
silêncio. Do lado de quem observava: a informação (regras, product brief)
parecia ter "passado" (estava gravada), mas nada iniciava do lado do agente
seguinte, porque o handoff nunca chegou a existir. Reabrir a conversa não
resolvia sozinho — só uma NOVA mensagem reativa o processo (rehidratando do
event log), e só uma nova confirmação de prontidão tenta o handoff de novo.

A mensagem NÃO reusa `FalhaDeTurno.mensagem/1` (a de `RN-059`, "não consegui
completar este turno... nada foi gasto"): nos três call sites o trabalho já
rodou (ou nem precisava rodar, no caso de `offer_dev_handoff`) — dizer "nada
foi gasto" seria falso quando tokens já tinham sido gastos no turno de
consolidação. Reusa só `FalhaDeTurno.origem/1`, que classifica pelo FORMATO
do motivo (status HTTP, exceção de transporte), não por ser turno de LLM.

O `Engine.Harness.Tools.OfferHandoff` (a ferramenta que o PO usa via tool
call, dentro do ToolLoop) já tratava `{:error, reason}` sem crashar — o
defeito era só nestes três handlers server-driven, que chamam
`EngineApiClient.create_handoff/5` DIRETO em vez de passar pela ferramenta.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`handle_call(:confirm_readiness, ...)`, `emit_falha_handoff/3`),
  `apps/engine/lib/engine/agents/arquiteto_server.ex`
  (`handle_call(:offer_infra_handoff, ...)`, `handle_call(:offer_dev_handoff, ...)`,
  `emit_falha_handoff/3`)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  ("prontidão: falha ao criar o handoff NÃO derruba o processo, e vira
  agent.error durável"); `apps/engine/test/engine/agents/arquiteto_server_test.exs`
  (as quatro variantes de `offer_infra_handoff`/`offer_dev_handoff`, sucesso e
  falha)
- **Origem:** relato de uso real no projeto `exp-001` (Criativo → PO); a
  mesma falha estrutural foi achada por leitura de código nos dois handoffs
  do Arquiteto, sem reprodução separada para eles

### RN-058 — A chave que o AGENTE gasta é a do owner do workspace {#rn-058}

Credencial de LLM pertence a uma pessoa (`user_credentials.user_id`), e agente
não é pessoa. O turno de agente resolve a chave pelo **owner do workspace**
(`workspaces.created_by`), não por quem abriu a sessão nem por quem criou o
projeto: quem banca a conta banca os agentes, e isso não muda quando outra
pessoa da equipe começa a sessão.

`created_by` e não `workspace_members.role = 'owner'`: pode haver vários
owners, e "qualquer um deles" faria a chave usada variar sem ninguém decidir.

Antes disto o turno passava o **slug do agente** (`agentId ?? sessionId`) na
coluna de usuário. A consulta ia ao banco com `user_id = 'criativo'`, o
Postgres recusava o UUID inválido, e o erro virava **resposta vazia** no fio —
sem métrica, sem evento de falha, sem nada na tela. O efeito prático, que só
uma execução real revelou: **nenhum agente jamais usou um provider com
credencial**. Só `ollama` funcionava, porque para ele a busca é pulada — e foi
com modelo local que a Fase 4, o dogfooding da Fase 10 e todas as demos
rodaram.

O chat humano nunca teve o defeito: ele usa `actor.id`, que é o usuário de
verdade.

- **Onde:**
  `apps/api/src/application/use-cases/llm/resolve-credential-owner.use-case.ts`,
  `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`,
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
- **Teste:** `test/application/use-cases/llm/resolve-credential-owner.use-case.spec.ts`
  (o owner vence quem criou o projeto; a chave encontrada é a dele; projeto
  inexistente é 404 e não erro de banco)
- **Origem:** execução real da FASE 13b

### RN-056 — Faceta de capability vem do provider; silêncio preserva o que estava {#rn-056}

`supports_vision`, `supports_reasoning` e `generates_image` são **fato do
provider**, não opinião: saem do catálogo remoto no sync, com o mesmo fallback
de `supports_tool_calling` — remoto, depois local, depois `false`.

No OpenRouter (o único que publica isso hoje) as três saem de:
`architecture.input_modalities` contém `image`,
`supported_parameters` contém `reasoning`, e
`architecture.output_modalities` contém `image`. Aceitar imagem e **produzir**
imagem são eixos distintos: fundi-los mandaria o usuário para o modelo errado.

Antes, o sync lia `supportsVision` do que já estava GRAVADO e nunca consultava
o remoto — a coluna nascia `false` e não havia caminho para virar verdadeira.
Os 338 modelos do primeiro sync real ficaram todos `false`, incluindo 181 que o
provider declara como multimodais.

**Ausência de declaração não é declaração de ausência**
([ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)): o
parser OMITE o campo quando o provider se cala, e `undefined` preserva o valor
local. Por isso a tela usa as facetas só como filtro POSITIVO e nunca escreve
"não lê imagem" — `false` aqui quer dizer "o provider não declarou".

- **Onde:** `apps/api/src/infrastructure/llm/openrouter-provider.ts`
  (`temModalidade`, `parseCatalogoOpenRouter`),
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`,
  `apps/api/src/db/schema.ts` (`models`)
- **Teste:**
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  (`modalidade não declarada OMITE o campo em vez de afirmar false`);
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`catálogo que se cala sobre modalidade preserva a faceta gravada`)
- **Origem:** [ADR 0051](adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-057 — "Para que serve" é curadoria do workspace, e marcar uso não liga o modelo {#rn-057}

Nenhum catálogo de provider publica "bom para código". Isso é **opinião de quem
opera**, descoberta usando — então mora em `workspace_models.uses`, ao lado da
outra decisão do workspace ([RN-052](#rn-052)), e não em `models`.

Vocabulário FECHADO — `codigo`, `documentacao`, `analise`, `imagem`,
`conversa` —, com prova de exaustividade em tempo de compilação nos dois lados.
Texto livre daria `code`, `coding` e `código` no mesmo filtro em uma semana.

Duas regras que mantêm os eixos separados:

1. **Marcar uso não liga o modelo.** `workspace_models.is_active` tem DEFAULT
   `true`, então a linha criada por uma marcação de uso é inserida com
   `is_active = false` explícito. Sem isso, opinar sobre um modelo o autorizaria
   a gastar, contra a [RN-043](#rn-043).
2. **Trocar o uso não desliga o que estava ligado.** `is_active` fica fora do
   `SET` do `ON CONFLICT`.

A lista de usos **substitui** a anterior, não soma: lista vazia é como se
desmarca tudo, e é um estado legítimo — "ninguém opinou" não é "não serve".

- **Onde:** `apps/api/src/domain/llm/model-uses.ts`,
  `apps/api/src/db/schema.ts` (`workspace_models.uses`),
  `apps/api/src/infrastructure/persistence/drizzle/workspace-model.repository.ts`
  (`setUses`),
  `apps/api/src/application/use-cases/llm/set-model-uses.use-case.ts`
- **Teste:** `test/application/use-cases/llm/set-model-uses.use-case.spec.ts`
  (`marcar uso NÃO liga o modelo — a linha nova nasce inativa`,
  `trocar o uso não desliga o que já estava ligado`,
  `o uso vale só neste workspace`)
- **Origem:** [ADR 0051](adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-038 — Agente contado no resumo do workspace = gastou tokens este mês {#rn-038}

O resumo do dashboard de projetos ("N projetos ativos · M agentes · gasto
este mês") conta como "agente" quem tem pelo menos uma linha em
`token_usage` com `actor_kind = 'agent'` no mês corrente, somando todos os
projetos do workspace. Sem o filtro de `actor_kind`, um `user` mandando
chat ou um `system` registrando uso inflaria a contagem — `token_usage`
grava para qualquer tipo de ator, não só agente. O corte por mês usa
`created_at >= date_trunc('month', now())`; um agente que trabalhou só no
mês anterior não conta, mesmo que ainda apareça no roster de alguma
sessão. A contagem naturalmente inclui as subespecialidades de área da
Fase 8 (`qa-automacao`, `qa-performance-seguranca`, `infra-workflows`):
cada uma tem seu próprio `actor_id` quando gasta tokens.

- **Onde:** `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts`
  (`summarizeForWorkspaceThisMonth`)
- **Teste:** `test/application/use-cases/iam/get-workspace-summary.use-case.spec.ts`

---

## Painel de projetos

### RN-039 — Dot de status do projeto: risco sempre vence inatividade {#rn-039}

A sidebar do dashboard mostra um dot de saúde por projeto, derivado de três
sinais independentes: orçamento (mesmos limiares 70%/90% do RN-018), task
bloqueada (`tasks.blocked`) e atividade recente (7 dias). Cores: verde =
saudável e ativo; âmbar = orçamento ≥70%; vermelho = orçamento ≥90% **ou**
task bloqueada; cinza = sem atividade nos últimos 7 dias. Quando um sinal
de risco (âmbar/vermelho) e o de inatividade (cinza) se aplicam ao mesmo
tempo, o de risco vence — um projeto estourado e parado ainda é algo a
olhar, não algo a esconder atrás de "sem atividade".

- **Onde:** `apps/web/src/lib/project-status.ts` (`deriveProjectStatus`)
- **Teste:** `apps/web/src/lib/project-status.test.ts`
- **Origem:** fidelidade do dashboard de projetos ao design aprovado

### RN-088 — Falha de carregamento é dita na tela; 429 não se retenta {#rn-088}

Toda tela que carrega dado da api distingue três estados, e nunca dois:
**carregando** (esqueleto), **erro** (a mensagem que a api mandou, com o
`trace_id` e um botão de tentar de novo) e **vazio** (o texto de lista vazia).
`if (!dado) return null` colapsa os três, e o desfecho observado foi o pior
possível: com a api limitando por `429`, a área principal de `/projects/:id`
ficava **completamente em branco** — sem mensagem, sem erro, sem esqueleto — e
o motivo existia só no console. No dashboard era pior que branco: `!projects`
também era verdadeiro no erro, então a tela convidava a criar o **primeiro**
projeto de um workspace que podia ter vinte.

É a [RN-059](#rn-059) do outro lado do fio: falha nunca vira resposta vazia.
Quem falha, diz.

A frase é a **da api**, extraída por `mensagemDaApi` — a mesma função que o
caminho de mutação já usava nos toasts. Um texto genérico nosso não sabe a
diferença entre "limite de requisições excedido, tente em instantes" (espere) e
"acesso negado" (não adianta esperar).

O outro lado da mesma regra é não responder ao limite com mais tráfego. **4xx
não se retenta**: `429` é literalmente o servidor mandando parar, e `401` já
foi renovado uma vez dentro de `request()`. E **poll para quando a query erra**
— volta no foco da janela, na remontagem ou no botão. Antes eram três
retentativas por falha somadas a ~25 polls de 3 a 5 segundos que não sabiam
parar: uma sessão real acumulou **1128 erros 429** contra um limite de 300
requisições por minuto por usuário (`RateLimitGuard`), e o laço impedia a
janela deslizante de se refazer. 5xx e falha de rede continuam com as três
tentativas, onde repetir é a reação certa.

- **Onde:** `apps/web/src/lib/query-policy.ts` (`deveRetentar`,
  `pollQueParaNoErro`), `apps/web/src/components/ErroDeCarregamento.tsx`,
  `apps/web/src/routes/ProjectPage.tsx`, `apps/web/src/routes/Dashboard.tsx`,
  `apps/web/src/routes/Shell.tsx`, `apps/web/src/main.tsx`
- **Teste:** `apps/web/src/lib/query-policy.test.ts`;
  `apps/web/src/routes/ProjectPage.test.tsx` (429 vira mensagem com a frase da
  api; 403 mostra o motivo do 403; carregando não é erro);
  `apps/web/src/routes/Dashboard.test.tsx` (erro na lista não vira "nenhum
  projeto ainda"); `apps/web/src/routes/Shell.test.tsx` (a sidebar diz em vez
  de ficar vazia)
- **Origem:** navegação real em `/projects/:id` com 1128 erros 429 no console

### RN-089 — Projeto de nome repetido se desempata na barra lateral {#rn-089}

Nome de projeto **não é único** — nada no domínio impede. Quando dois ou mais
projetos da lista têm o mesmo nome, cada um deles mostra na sidebar o id
abreviado e a data de criação (`#a1b2c3d4 · 07/08 14:32`), os dois já presentes
no payload do projeto. Quem tem nome único não mostra nada: a legenda em toda
linha seria ruído no lugar com menos espaço da tela.

Origem concreta: uma execução de validação criou vinte projetos chamados
`validacao-real`, e as vinte linhas da sidebar eram visualmente idênticas.

- **Onde:** `apps/web/src/lib/project-label.ts` (`nomesRepetidos`,
  `desempateDoProjeto`), `apps/web/src/routes/Shell.tsx`
- **Teste:** `apps/web/src/routes/Shell.test.tsx` (nome repetido ganha
  desempate, nome único não)
- **Origem:** navegação real com a sidebar cheia de projetos de validação

### RN-090 — O dashboard lê o workspace, não um projeto de cada vez {#rn-090}

A grade de cards e os dots da barra lateral se alimentam de **uma** requisição
por ciclo — `GET /workspaces/:workspaceId/projects-summary` —, e o número de
requisições **não cresce com a quantidade de projetos**.

O card mostra provedor de git, status de provisionamento, orçamento, chips de
agentes e última atividade; a sidebar mostra o dot de status e o contador de
não lidos. Tudo isso vinha de sete consultas em POLL por projeto, o que fazia
23 projetos custarem 3.824 requisições por minuto contra um limite de 300
(`RateLimitGuard`) — a tela derrubava a si mesma em 429 antes de terminar de
carregar. A [RN-088](#rn-088) fez a app parar de insistir quando isso acontece;
esta reduz o pedido.

Duas fronteiras que a regra fixa, e que não são detalhe de implementação:

- **A api responde fatos, não roster.** `roster` traz o que aconteceu no event
  log (execução ativada, módulos, gate já aberto, subagentes delegados, infra
  aceita). Quem é lead de área, que ícone cada agente tem e como os membros
  viram um chip continua sendo do web — e a regra de PRESENÇA é uma só
  (`rosterFromFacts`), compartilhada com o painel do time, para que um agente
  novo não apareça num lugar e falte no outro.
- **A gaveta do sino só busca quando aberta.** Ela era, até a
  [RN-091](#rn-091), a única leitura que continuava sendo uma requisição por
  projeto — o corte de "onde parei de ler" é `seq` guardado no navegador
  (`read-state`), que o servidor não conhece. Hoje o navegador **manda** esse
  corte, e a gaveta também é uma requisição só.

Efeito colateral aceito e desejado: `gatesEverOpened` e `delegatedSubagents`
passam a cobrir a sessão INTEIRA. O cliente derivava dos últimos 200 eventos e
perdia chips em sessão longa (ver
[ADR 0021](adr/0021-fechamento-4a-infra-e-painel.md)) — o texto de
`deriveAgentRoster` sempre disse "já abriu alguma vez".

- **Onde:**
  `apps/api/src/application/ports/projects-summary-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`,
  `apps/api/src/interfaces/http/iam/workspaces.controller.ts`
  (`getProjectsSummary`), `apps/web/src/lib/hooks.ts` (`useProjectsSummary`),
  `apps/web/src/lib/agent-status.ts` (`rosterFromFacts`),
  `apps/web/src/routes/Dashboard.tsx`, `apps/web/src/routes/Shell.tsx`
- **Teste:** `apps/web/src/routes/Dashboard.fanout.test.tsx` (30 projetos
  custam o mesmo que 3; nenhum endpoint por projeto é chamado);
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (o número de consultas ao banco não cresce com N);
  `apps/web/src/lib/agent-status.test.ts` (os fatos da api produzem os mesmos
  chips que o event log)
- **Origem:** dashboard de 23 projetos medido no navegador — 3.824 req/min
  antes, 12 depois

### RN-091 — O navegador manda onde parou de ler; o sino é uma requisição {#rn-091}

Com a gaveta de notificações **aberta**, o conteúdo dela sai de **uma**
requisição por ciclo — `POST /workspaces/:workspaceId/unread-events` — e o
número de requisições **não cresce com a quantidade de projetos**.

É a metade que faltava da [RN-090](#rn-090). Aquela derrubou o dashboard de
3.824 para 12 req/min, mas o sino continuou buscando um projeto de cada vez:
23 projetos com a gaveta aberta mediam **286 req/min** contra o limite de 300
(`RateLimitGuard`). Passava, e sumia com um projeto a mais.

**O obstáculo, e por que a saída é esta.** Não existe "marcar como lido" no
servidor, de propósito: o corte é um `seq` por projeto guardado no
`localStorage` de cada navegador (`read-state`). Havia duas saídas, e a
diferença entre elas é de PRODUTO:

- parar de repolar enquanto a gaveta está aberta muda a atualidade do que o
  usuário vê — **recusada**, ninguém pediu essa troca;
- o navegador **mandar** o mapa `projeto → afterSeq` devolve exatamente os
  mesmos dados na mesma cadência. **É batelamento puro: nada muda para quem
  olha a tela**, nem a frescura nem o conteúdo.

**É `POST` sem mutar nada**, e a api responde `200` (nunca `201`) para dizer
isso. O verbo foi escolhido por ser o único com CORPO: são dezenas de pares, e
em query string isso vira URL longa — que proxy trunca — além de pôr id de
projeto do usuário em log de acesso, contra a regra de não passar dado pessoal
por query string.

Três garantias de semântica que a rota fixa, porque batelar leituras com cortes
diferentes é onde o erro fácil mora:

- **mapa vazio devolve vazio**, e sem tocar no banco. "Não perguntei nada" não
  é "me dê tudo";
- **cada projeto respeita o SEU corte** — `seq` estritamente maior que o dele;
- **o teto de 50 eventos é por projeto**, o mesmo que `GET .../events` aplica
  sem `limit`. Um limite na resposta inteira deixaria o projeto barulhento
  comer a cota dos calados.

Cursor apontando para projeto de outro workspace é **ignorado**, não recusado:
ele vem do armazenamento local de quem chama e pode ser sobra de um workspace
antigo.

- **Onde:**
  `apps/api/src/application/ports/projects-summary-repository.port.ts`
  (`unreadEventsForWorkspace`),
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`,
  `apps/api/src/interfaces/http/iam/workspaces.controller.ts`
  (`getUnreadEvents`), `apps/api/src/interfaces/http/iam/dto/unread-events.dto.ts`,
  `apps/web/src/lib/notifications.ts` (`useNotificationGroups`),
  `apps/web/src/lib/api-client.ts` (`getUnreadEvents`)
- **Teste:** `apps/web/src/routes/Dashboard.fanout.test.tsx` (com a gaveta
  ABERTA: uma requisição, e 30 projetos custam o mesmo que 3);
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (o número de consultas ao banco não cresce com N; mapa vazio, corte por
  projeto, teto por projeto e isolamento de workspace)
- **Origem:** residual medido da [RN-090](#rn-090) — 286 req/min com a gaveta
  aberta num workspace de 23 projetos

### RN-099 — Atividades pagina o passado sem repolar o que não muda {#rn-099}

A coluna de **Atividade** da Visão geral mostra uma **janela** de 100 eventos
ancorada na **cauda** da sessão, e desce no passado de página em página. Cada
página usa o `afterSeq`/`nextCursor` que
`GET /projects/:p/sessions/:s/events` **já** devolve: nenhuma rota nova,
nenhum parâmetro novo.

**Duas perguntas, duas queries.** `useSessionEvents` responde "como está
agora" — os últimos 200 em poll — e alimenta o painel do time, a linha do
tempo em árvore, a seção de execução e a aba de Aprovações. Nenhuma delas
pagina. A de Atividades responde "o que aconteceu", e era a única que fazia
essa pergunta com a resposta da outra: 200 itens de uma vez, sem começo nem
fim, e ainda assim sem alcançar o início de uma sessão longa.

**A âncora é a cauda, não o começo da sessão.** O endpoint pagina para
FRENTE, e não existe `beforeSeq` — inventar um seria contrato novo. Mas abrir
o feed no evento nº 1 de uma sessão de milhares entrega a tela errada: quem
abre Atividades quer o que acabou de acontecer. Então a primeira página é a
mesma leitura `latest` que a tela já faz, com a **mesma `queryKey`** (o React
Query serve as duas com UMA busca), e cada clique desce uma janela fixa com
`afterSeq`.

**O que a paginação não pode custar.** Uma requisição por ciclo de poll — a
mesma de antes, e a economia da [RN-090](#rn-090)/[RN-091](#rn-091) não
regride. Três peças garantem isso:

- a cauda é a query que a tela já tinha, compartilhada por `queryKey`;
- o primeiro clique **não** vira requisição: a leitura `latest` traz 200 e a
  janela mostra 100, então revelar o que já se pagou vem antes de pedir de
  novo;
- página antiga é uma janela **fechada** de `seq` sobre eventos **imutáveis**
  (nunca há UPDATE em tabela de evento): `staleTime: Infinity` e
  **nenhum** `refetchInterval`. Um poll ali seria pagar N requisições para
  receber N respostas idênticas.

**A contagem é honesta sobre o que ela sabe.** Os filtros por agente e por
tipo rodam sobre a **página carregada**, não sobre a sessão — então a UI diz
`N de M carregados`, e não "N resultados". Levar o filtro ao servidor daria o
total verdadeiro e mexeria no repositório de eventos; não é desta fase, e
dizer o total errado seria pior que dizer menos.

Os três estados da [RN-088](#rn-088) valem aqui: **erro antes de vazio** — a
coluna dizia "nenhuma atividade" quando a api tinha recusado.

- **Onde:** `apps/web/src/lib/hooks.ts` (`useSessionEventHistory`,
  `EVENTOS_POR_PAGINA`), `apps/web/src/components/ActivityFeed.tsx`,
  `apps/web/src/routes/ProjectOverviewTab.tsx`,
  `apps/api/src/infrastructure/persistence/drizzle/session-event.repository.ts`
  (`listPaginated`, já existente)
- **Teste:** `apps/web/src/lib/session-history.test.tsx` (abre na cauda; o
  primeiro clique não custa requisição; o seguinte pagina com `afterSeq`
  contíguo; o laço termina no começo da sessão; montado junto com o estado
  atual a cauda é UMA busca; página antiga não repolla);
  `apps/web/src/components/ActivityFeed.test.tsx` (o "N de M carregados"
  acompanha o filtro; sem as props de paginação nada muda)
- **Origem:** pedido do usuário na primeira navegação real — "Atividades na
  aba Visão Geral deve ser paginada, para não ficar infinita"

### RN-100 — A ordem do sino é do SQL, não do front {#rn-100}

A gaveta de notificações mostra os eventos **do mais recente para o mais
antigo**, e quando um projeto tem mais não lidos que o teto de 50 os que
aparecem são os **mais NOVOS**.

**A ordenação é do banco por necessidade, não por gosto.** A consulta corta em
50 **por projeto** com uma função de janela
(`row_number() OVER (PARTITION BY session_id ORDER BY seq DESC)`), e é ela que
decide **quais** 50 eventos sobrevivem — não só em que ordem eles saem. Com
`ASC` sobreviviam os 50 mais **antigos**, e um `.sort()` no cliente ordenaria
por recência justamente a janela que a consulta já tinha escolhido errado:
num projeto com 300 não lidos, o 251º evento apareceria como "o mais recente".
É por isso que não há ordenação nenhuma no caminho do front, e o comentário no
componente diz que não pode haver.

**A consequência, e por que o corte de leitura não mudou.** O corte é um `seq`
por projeto no `localStorage`, e **não existe endpoint de marcar lido**, por
decisão registrada na [RN-091](#rn-091). Um corte por `seq` marca um
**prefixo**; a gaveta agora mostra um **sufixo**. Marcar como lidas "as 50
exibidas" é inexprimível sem um conjunto de lidos **por evento** — tabela nova,
fora de escopo. Os dois únicos cortes expressáveis continuam sendo "nada" e
"tudo até agora".

A saída não foi mudar a semântica (ela continua avançando para o último `seq`,
exatamente como antes), foi **parar de esconder o que esse avanço engole**:

- cada projeto mostra o **total** de não lidos, não o tamanho da janela, e
  declara quantos ficaram de fora (`+ N mais antigos`);
- o botão passa a dizer o que faz — `marcar as N como lidas` — quando há algo
  fora da janela;
- o número que falta sai de **subtração**, não de requisição: `latestSeq`
  menos o corte já vem no resumo do workspace ([RN-090](#rn-090)).

Como a semântica do corte não mudou, **não há ADR** nesta regra: o que mudou
foi qual janela a consulta escolhe e o que a gaveta declara sobre ela.

- **Onde:**
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (`unreadEventsForWorkspace`),
  `apps/api/src/application/ports/projects-summary-repository.port.ts`,
  `apps/api/src/interfaces/http/iam/dto/iam.response.dto.ts`
  (`ProjectUnreadEventsResponseDto`),
  `apps/web/src/lib/notifications.ts` (`useNotificationGroups`),
  `apps/web/src/components/NotificationBell.tsx`
- **Teste:**
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  ("com mais não lidos que o teto, voltam os MAIS RECENTES, do novo para o
  velho" — afirma o CONJUNTO antes da ordem);
  `apps/web/src/components/NotificationBell.test.tsx` (renderiza na ordem
  recebida, sem reordenar; o contador é o total; o botão diz quantas marca);
  `apps/web/src/lib/notifications.test.tsx` (o que ficou fora da janela sai
  por subtração, sem segunda requisição);
  `apps/web/src/routes/Dashboard.fanout.test.tsx` (a gaveta continua sendo
  UMA requisição)
- **Origem:** pedido do usuário na primeira navegação real — "Sino e
  notificações devem sempre ordenar para última data modificada em descendente
  para a mais antiga"

---

### RN-118 — A árvore do time expõe detalhe de execução por marco, e abre os "5 últimos" {#rn-118}

`AgentTimelineTree`/`timeline-tree.ts` (FASE 14b) já agrupava o event log por
agente, mas com três lacunas: o critério de abrir um ramo era só
ativo/parado (sem relação com quantos agentes existiam), o contador do
cabeçalho era o TOTAL de marcos (nunca "o que é novo"), e `tool.call`/
`tool.result`/`agent.response` viravam marco mostrando só o nome da
ferramenta — `args`, `result` e `iteration`, que o event log já grava,
nunca chegavam na tela.

**Abertura padrão** passa a ser "os 5 agentes de atividade mais recente
(maior `seq` do último marco)", com ativo mantendo prioridade sobre
recência — não se soma: como `montarArvore` já ordena ativos primeiro e,
dentro de cada grupo, do mais recente pro mais antigo, os dois critérios
colapsam numa fatia só (`ramosAbertosPorPadrao`, os primeiros
`max(nº de ativos, 5)` ramos). Mais de 5 ativos: todos abrem, sem corte.

**Contador de novidade** por agente usa o MESMO mecanismo do sino
(`read-state.ts`, `localStorage`), granular por `projectId:agentId` em vez
de só `projectId` — não existia "último visto" nessa granularidade antes.
Ramo colapsado com marco de `seq` maior que o último visto daquele agente
mostra a contagem de NOVIDADE no lugar do total; abrir o ramo (automático
ou manual) marca como visto até o `seq` mais recente.

**Detalhe expansível** é por MARCO, não por ramo — só `tool.call`,
`tool.result` e `agent.response` (`EVENTOS_EXPANSIVEIS`) viram botão
individual, porque só eles carregam payload que vale expandir. O
agrupamento visual por ITERAÇÃO usa `iteration` do payload de
`agent.response` quando existe (ToolLoop — `tool.call`/`tool.result`
herdam a iteração da resposta que os despachou, porque no ToolLoop eles
são emitidos DEPOIS dela); agentes fora do ToolLoop (PO, Criativo, sem
`iteration` no payload) ganham um contador PRÓPRIO por agente, incrementado
a cada resposta — inferência por proximidade de `seq`, não um campo novo no
event log.

- **Onde:** `apps/web/src/lib/timeline-tree.ts` (`Marco.iteracao`,
  `Marco.eventType`, `Marco.payload`, `ramosAbertosPorPadrao`,
  `marcoExpansivel`), `apps/web/src/components/AgentTimelineTree.tsx`,
  `apps/web/src/lib/read-state.ts` (`getAgentLastSeenSeq`/
  `setAgentLastSeenSeq`)
- **Teste:** `apps/web/src/lib/timeline-tree.test.ts` (agrupamento por
  iteração real e inferida, `ramosAbertosPorPadrao` com ativo/recência/sem
  corte), `apps/web/src/components/AgentTimelineTree.test.tsx` (abertura
  padrão, contador de novidade aparecendo/sumindo, marco expandindo com
  args/resultado/iteração)
- **Origem:** pedido do usuário — lacunas confirmadas por investigação no
  componente existente da FASE 14b; sem ADR, mesma semântica de "não visto"
  do sino, só granularidade nova

---

### RN-096 — Toda decisão diz em português o que acontece; o payload cru nasce colapsado {#rn-096}

Todo tipo de `proposed_action` tem uma **frase em português** que descreve o
efeito de aprovar, e ela é a primeira coisa visível no card — antes de qualquer
detalhe, nas três telas onde uma decisão é pedida (a fila de Aprovações, o card
dentro do chat da sessão e a aba Insights). O payload cru continua acessível,
**dentro de um colapso que nasce fechado**, e nunca é despejado na tela.

**O que existia era um despejo.** Todo tipo sem corpo visual próprio caía num
`Object.entries(payload).map(([k, v]) => k + ': ' + JSON.stringify(v))`, sempre
aberto. Quem abria a fila lia `worktree: /workspaces/dev-api`,
`coAuthor: Brabo User <user@brabo.dev>` e `proposto: 4` — e tinha de deduzir o
que ia acontecer se clicasse em Aprovar. Aprovação que exige dedução é
aprovação que se dá no automático, e o produto inteiro se apoia em o usuário
ser a autoridade final.

**A frase degrada, e é isso que a torna confiável.** Nenhuma delas assume que
uma chave do payload existe: com payload vazio a frase continua sendo uma frase
verdadeira, só menos específica ("Registra um commit no repositório do
projeto."). O payload vem do engine e de dez casos de uso diferentes, e nenhum
deles promete um formato — frase que só funciona com a fixture certa é frase
que quebra na primeira aprovação real.

**Tipo que o web ainda não conhece não é caso teórico.** A união `ActionType`
do web já ficou defasada duas vezes: primeiro com os três tipos do bootstrap de
Gitflow, e de novo com `parallelize`/`raise_max_parallel`, que entraram na FASE
14d. O compilador não pega: a lista canônica está em `apps/api`, que o web não
importa. Por isso duas coisas ao mesmo tempo — o card **degrada** (verbo neutro
+ "ver detalhes", com o payload colapsado, em vez do `undefined` no mapa de
ícones que derrubava a árvore inteira do React), e o **teste lê o `decide.ts`
do backend** e reprova quando um tipo entra sem frase.

**O default de aberto/fechado é derivado, não configurado.** A regra é uma só —
abre o que ainda espera decisão de quem está olhando: no chat, ação `pending`;
na fila, nunca (são N cards, e N detalhes abertos são a mesma parede de texto);
em Insights, hipótese `proposed`. E o payload CRU não abre em variante nenhuma.
A consequência de projeto é que `ApprovalCard` **não ganhou prop nova
obrigatória**: o default sai de `variant` e `status`, que já existiam.

**Verbo e frase saem de um módulo só**, consumido pelas três telas. A hipótese
do Psicólogo usa literalmente o verbo do `instruction_patch` em vez de um
vocabulário paralelo — e a frase dela diz o que o accept faz de verdade
(enfileira para a Anamnese, que **pode** propor o ajuste, que ainda vem para
aprovação), nunca "a instrução será alterada".

**`write_file` tinha frase, mas não corpo.** Ele nasceu de fora de
`COM_CORPO_PROPRIO`: a frase mostrava só o `path`, e o detalhe caía no mesmo
despejo de JSON cru colapsado que esta RN existe para evitar — então um write
que genuinamente pedia aprovação (fora do prefixo `dev-`, ou caminho fora do
escopo do agente) exigia um clique a mais para ver o `content`. Entrou em
`COM_CORPO_PROPRIO` com corpo próprio: `path` e um preview do `content` (até
25 linhas/4.000 caracteres, com aviso de truncamento — nunca o arquivo
inteiro, mesma regra do payload cru), aberto por padrão no chat enquanto
pendente, igual `terminal`.

**Payload vazio não é payload ausente.** `command` (terminal) ou
`path`/`content` (write_file) chegando como string vazia — tool-call
malformada do modelo, não bug de renderização — degradava para um prompt
`$ ` ou um preview em branco, que o usuário lia como defeito da tela. Os dois
corpos agora distinguem os dois casos e mostram "o modelo não produziu um
X válido para esta ação" em vez de um branco.

- **Onde:** `apps/web/src/lib/aprovacoes.ts` (`VERBO_DA_ACAO`, `fraseDaAcao`,
  `descreverAcao`, `descreverHipotese`), consumido por
  `apps/web/src/components/ApprovalCard.tsx` (Aprovações + chat da sessão,
  `COM_CORPO_PROPRIO`, `previewConteudo` para o `content` de `write_file`) e
  `apps/web/src/components/HypothesisCard.tsx` (Insights); colapso pelo
  `Disclosure` de `apps/web/src/components/ui/Disclosure.tsx`
- **Teste:** `apps/web/src/lib/aprovacoes.test.ts` (lê `ACTION_TYPES` de
  `apps/api/src/domain/actions/decide.ts` e exige verbo + frase para cada tipo,
  com payload vazio); `apps/web/src/components/ApprovalCard.test.tsx`
  (`frase e colapso` — payload colapsado nas duas variantes, JSON legível ao
  abrir, tipo desconhecido não derruba a tela, `write_file` com corpo próprio
  aberto por padrão e truncamento do preview, `command`/`path`/`content`
  vazios mostrando a mensagem de fallback);
  `apps/web/src/components/HypothesisCard.test.tsx` (`frase e colapso`)
- **Origem:** FASE 19 do programa 16–26, do pedido "hoje está muito difícil a
  leitura" na primeira navegação real depois do reset do banco

---

### RN-121 — Dev agent e QA são "executores": aba própria, fora do "Time de agentes" {#rn-121}

O grid "Time de agentes" e a "Linha do tempo do time" da Visão geral
misturavam Criativo/PO/Arquiteto/Infra com dev-`<módulo>` e QA (lead +
`qa-automacao`/`qa-performance-seguranca`) — sete, oito agentes na mesma
grade, sem distinguir quem CRIA/DECIDE de quem IMPLEMENTA/VERIFICA. A aba
**Executores** isola os dois últimos, com a MESMA renderização da Visão
geral (`AgentCard`, o grid de área — extraído para `AgentTeamGrid.tsx` — e
`AgentTimelineTree`), nunca um card reinventado.

**A regra de separação é uma função só**, `isExecutorGroup`/
`isExecutorAgentId` (`lib/agent-status.ts`): `dev-lead`/`dev-<qualquer
módulo>` e a área `qa` inteira (lead + subespecialidades) são executor;
o resto não é. As DUAS telas filtram o MESMO `groupRosterByArea` com essa
função — a Visão geral com `!isExecutorGroup`, Executores com
`isExecutorGroup` — então um agente não pode aparecer nos dois nem sumir
dos dois: é sempre exatamente um lado.

**A árvore não duplica**: cada aba filtra os EVENTOS antes de passar para
`AgentTimelineTree` (por `actor.id` pertencer ou não ao conjunto de
executores), então o ramo de um dev agent aparece só em Executores, nunca
também na Visão geral. A coluna de Atividade (`ActivityFeed`, RN-099/100)
NÃO foi filtrada — ela responde "o que aconteceu" na sessão inteira,
dev/QA inclusive, e o filtro por agente do próprio componente já lista
todo mundo que falou; só o grid e a árvore de "quem está fazendo o quê"
mudam de lugar.

- **Onde:** `apps/web/src/lib/agent-status.ts` (`isExecutorGroup`,
  `isExecutorAgentId`, `autonomyActionTypeFor` — movido de
  `ProjectOverviewTab.tsx`), `apps/web/src/components/AgentTeamGrid.tsx`
  (extraído do grid que já existia), `apps/web/src/routes/
  ProjectExecutorsTab.tsx`, `apps/web/src/routes/ProjectOverviewTab.tsx`,
  `apps/web/src/routes/project-tabs.ts` (`key: 'executores'`, `ordem: 12`
  — logo depois da Visão geral, antes de Criativo/Chat/Code)
- **Teste:** `apps/web/src/lib/agent-status.test.ts` (`isExecutorAgentId`/
  `isExecutorGroup` — dev-`<módulo>`, `dev-lead`, área `qa` inteira são
  executor; criativo/po/arquiteto/infra/secops não são);
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx` (mostra só dev/QA,
  estado vazio sem os dois, contagem do cabeçalho);
  `apps/web/src/routes/ProjectOverviewTab.test.tsx` (dev-backend/QA somem
  do grid, o resto do time continua); `apps/web/src/routes/
  project-tabs.test.tsx` (a aba nova entra na varredura genérica do
  registro — régua, painel, deep-link, ordem única)
- **Borda:** SecOps NÃO é executor — ele entra na roster pelo MESMO
  `pr.gate_changed` que traz QA (Fase 4a, `rosterFactsFromEvents`), mas
  fica na Visão geral. `dev-lead` está na lista de executores por
  completude (RN-087 o descreve como conversacional), embora hoje nenhum
  caminho o instancie na roster da sessão (a delegação Dev Lead →
  `dev-<módulo>` segue fora de escopo, ADR 0053 item 5).
- **Origem:** pedido do usuário — "Executores" própria pra dev agent e QA,
  fora do grid misturado da Visão geral.

---

### RN-125 — O aceite de handoff é INLINE no fio, com CTA pro Dev Lead apontando pra Executores {#rn-125}

O divisor "X passou o bastão ao Y" que já existia na timeline (`handoff.offered`)
vira um **card acionável** — com o botão de aceitar embutido — sempre que
representa a oferta pendente **atual** (a mesma que `offeredHandoff` já
resolvia para o botão da topbar). O botão da topbar **saiu**: com o aceite
morando dentro do fio, no lugar exato onde a passagem aconteceu, manter os
dois puxaria dois botões com o texto IDÊNTICO visíveis ao mesmo tempo — o
mesmo problema que `ApprovalCard` já evita ao nunca duplicar a ação fora do
fio (RN-096).

**Qual evento vira o card é decidido por PAR, não por id.** O payload de
`handoff.offered` carrega só `toAgent`; o `fromAgent` é o `actor` do evento
(RN-054 já usava essa leitura para o texto do divisor). Sem o id do handoff
no evento, "esta é a oferta atual" é respondido achando o `handoff.offered`
mais RECENTE (maior `seq`) com o MESMO par `fromAgent`/`toAgent` de
`offeredHandoff` — o que impede reabrir um convite de aceite que uma oferta
mais antiga pro mesmo par já tenha resolvido (aceita, recusada ou superada
por uma oferta nova).

**O card pro Dev Lead ganha um segundo link**, "Acompanhe a execução em
Executores", pra aba que já existe (RN-121) — é o início da EXECUÇÃO, e quem
aceita precisa saber onde olhar depois. As outras ofertas (PO, Arquiteto…)
não ganham o link: a sessão delas segue sendo o próprio lugar de acompanhar,
não há "onde mais olhar".

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`timeline` — bloco
  `handoff.offered`, `offeredHandoffEventSeq`; `isActive` subiu para antes do
  `useMemo`), `apps/web/src/routes/SessionPage.module.css` (`.handoffCard`,
  `.timelineLink`)
- **Teste:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`
  (card acionável só na oferta atual, oferta antiga do mesmo par fica muda,
  handoff já aceito não mostra botão nenhum, link de Executores só no
  `dev-lead`); `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`
  atualizado para o botão inline (não mais na topbar)
- **Verificado por execução real:** aceitar um handoff pro PO numa sessão
  criativa contra um build isolado (stack Docker próprio, projeto/sessão
  reais) — o card vira divisor mudo e o log de eventos avança assim que o
  clique volta da api; o CTA pro Dev Lead navega pra `?tab=executores` de
  verdade.
- **Origem:** pedido do usuário — aceite de handoff também inline no fio,
  não só na topbar.

### RN-124 — O PO narra épico/história criados no fio, com link direto pro Backlog {#rn-124}

`backlog.epic_created`/`backlog.story_created` — que o PO já gravava no
event log (`CreateEpicUseCase`/`CreateStoryUseCase`) — não tinham
tratamento nenhum na timeline da sessão: criar história não deixava rastro
NENHUM no fio, só na aba Backlog, pra quem já soubesse ir olhar lá. Os dois
tipos ganham entrada na timeline, no MESMO corpo visual das outras
mensagens do agente (`.message`/`.bubble`) — nenhuma classe nova pro chip
em si, só o link.

O link ("Ver no Backlog") reusa o deep-link genérico da aba (`?tab=backlog`,
o mesmo mecanismo do CTA "Definir orçamento" do card do dashboard) — não
tenta realçar a história recém-criada dentro da aba, que é fora de escopo.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`timeline` — bloco
  `backlog.epic_created`/`backlog.story_created`)
- **Teste:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`
  (`item 2`)
- **Verificado por execução real:** épico e história inseridos no event log
  de uma sessão real aparecem como "Épico criado"/"História criada" com o
  título, e o link navega pra `?tab=backlog` de verdade.
- **Origem:** pedido do usuário — link do PO pras histórias criadas, direto
  pro Backlog.

### RN-126 — Promoção de história é decidível INLINE no fio, com o mesmo mecanismo da aba Backlog {#rn-126}

`backlog.story_promotion_proposed` (RN-048) ganha o mesmo tratamento que
RN-125 deu ao handoff: o evento vira **card acionável** na timeline da
sessão, com os botões "Promover" e "Devolver" chamando os MESMOS
`promoteStories`/`returnStory` que `PromotionQueue`
(`ProjectBacklogTab.tsx`) já usa — nenhum endpoint novo, nenhuma segunda
fonte de verdade. A decisão continua acontecendo em UM lugar (o backend), só
o gatilho ganhou um segundo caminho.

**Resolução por evento posterior, não por status derivado à parte.** O card
some sozinho (vira divisor mudo, sem botões) assim que um evento de seq
MAIOR decidir o destino da MESMA história —
`backlog.story_transitioned{storyId}` (promovida, emitido por
`PromoteStoriesUseCase` via `TransitionStoryUseCase`) ou
`backlog.story_promotion_returned{storyId}` (devolvida). Sem essa checagem,
promover ou devolver deixaria os mesmos dois botões plantados no fio,
oferecendo de novo uma decisão já tomada.

`backlog.story_promotion_returned` ganha narração simétrica no fio (motivo
incluído), reusando a mesma frase que `apps/web/src/lib/activity.ts` já
usava só no log colapsado da sidebar.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`timeline` — blocos
  `backlog.story_promotion_proposed`/`backlog.story_promotion_returned`,
  `handlePromoteStory`/`handleReturnStory`, modal de motivo reusando
  `Modal`/`Textarea`)
- **Teste:** `apps/web/src/routes/SessionPage.promocao-inline-e-volta.test.tsx`
  (card com os botões, promover chama `promoteStories` com o `storyId` do
  payload, devolver exige motivo e chama `returnStory`, história resolvida
  por `story_transitioned` posterior vira divisor mudo, `story_promotion_returned`
  narra com o motivo)
- **Origem:** pedido do usuário — promoção de história inline no fio, opção
  barata reusando RN-048 em vez de gatear a criação da história.

### RN-131 — Três corridas confirmadas AO VIVO no fio da sessão: convite por cima do histórico, indicador ansioso e turno preso em `handleReadiness` {#rn-131}

Três defeitos achados navegando `SessionPage.tsx` de verdade no Chrome, não
por teste — e os três eram condição de corrida ou critério incompleto
disfarçado de decisão de produto.

**1. `conversaComecou` virou "existe QUALQUER evento", não "existe
`chat.message`/`agent.response`".** O critério anterior (achado G) nasceu
pra não confundir os cards do bootstrap do git com conversa, mas tinha o
efeito contrário: uma sessão criada pelo `git-bootstrap` (ações de
commit/branch já aprovadas, zero `chat.message`) mostrava o convite por
cima delas, e o mesmo acontecia — de forma bem mais grave — na sessão que a
ativação de execução usa, com dezenas de eventos reais (`tool.call`,
`tool.result`, eventos de task) e nenhum `chat.message`/`agent.response`: o
convite cobria o histórico de execução **inteiro**. Sessão nova é a única
sem nenhum evento — essa é a pergunta certa.

**2. `conviteVisivel` espera `useSessionEvents` terminar de carregar.** Em
cache frio (reload de página), `session` podia chegar enquanto `events`
ainda era `[]` — o default de `data?.items`, indistinguível de "sessão
vazia de verdade" até o primeiro fetch resolver. Sem o gate
`!eventsQuery.isPending`, o convite piscava por cima de sessões com
histórico grande.

**3. O indicador de "pensando" (bolha com os 3 pontinhos) só liga depois de
5s sem nenhum texto chegar.** Antes ele ligava no instante em que
`streaming`/`statusAgent` virava truthy — ruído visual na maioria dos
turnos, que respondem em menos de um segundo. Um `useEffect` arma um
`setTimeout(…, 5000)` quando o turno começa sem texto ainda, e o desarma (via
cleanup) assim que o primeiro delta chega ou o turno termina antes do prazo.
Texto de verdade (`streamingText`) continua aparecendo **na hora**, nunca
espera o timer — só o indicador vazio é que ganhou paciência.

**4. `handleReadiness` ganhou a mesma rede de segurança que `handleSend` já
tinha.** `confirmReadiness` é, como `sendAgentMessage`, um `GenServer.call`
síncrono no engine (até 120s) — e o canal Phoenix pode não ter terminado de
conectar (ticket + join, RN-108) quando o turno acaba, perdendo o broadcast
de `agent.done` pra sempre. `handleSend` já chamava
`finalizarTurnoDoAgente()` assim que a chamada síncrona resolvia,
independente do canal ter entregue o evento; `handleReadiness` tinha ficado
de fora dessa correção, e sem ela a bolha do agente ficava presa vazia
(`streaming: true`, sem texto) até a página recarregar.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`conversaComecou`,
  `conviteVisivel`, o `useEffect` de `pensandoVisivel` logo abaixo de
  `agenteExibido`, e o bloco de sucesso de `handleReadiness`)
- **Teste:**
  `apps/web/src/routes/SessionPage.convite-so-em-sessao-vazia.test.tsx`
  (sessão vazia mostra o convite; sessão com eventos de git-bootstrap ou com
  dezenas de `tool.call`/`tool.result` esconde; `eventsQuery.isPending`
  segura o convite até o primeiro fetch resolver),
  `apps/web/src/routes/SessionPage.pista-e-status.test.tsx` (achado B —
  indicador não aparece antes de 5s, aparece depois, some no primeiro delta
  e nunca aparece quando o turno termina antes do prazo), e
  `apps/web/src/routes/SessionPage.readiness-turno-preso.test.tsx`
  (`confirmReadiness` resolvendo sem `onAgentDone` reconcilia o estado do
  mesmo jeito que `SessionPage.turno-preso.test.tsx` já prova pra
  `handleSend`)
- **Origem:** investigação AO VIVO do produto no Chrome — os três reproduzidos
  manualmente antes da correção.

### RN-136 — O card acionável de handoff no chat só considera quem CONVERSA nesta tela {#rn-136}

`OfferInfraHandoffUseCase` oferece o handoff pro Infra e, na MESMA
confirmação, oferece pro Dev Lead logo em seguida (FASE 14d) — duas chamadas
separadas, a de Infra primeiro. `handoffs` (o que `SessionPage.tsx` lê de
`useHandoffs`) vem ordenado por `createdAt` ASC
(`DrizzleHandoffRepository#findBySession`), e o `offeredHandoff` que decide
qual card vira "acionável" resolvia com um `.find()` puro — sempre o
`offered` mais **antigo**. Como o Infra Lead não é conversacional (não está
em `AGENTES_DE_CHAT`, e nunca é aceito por esta tela), o card do Dev Lead só
ficaria acionável depois de alguém aceitar o de Infra num lugar que esta
tela não mostra — na prática, nunca: o usuário só via "aceitar handoff de
Infra" e o convite pro Dev Lead ficava invisível atrás dele.

O filtro restringe `offeredHandoff` a handoffs endereçados a um agente de
`AGENTES_DE_CHAT`. O handoff pro Infra continua **narrado** no fio — o
`handoff.offered` dele vira divisor mudo, como qualquer oferta que não é "a
atual" — só o card com botão é que passa a ignorá-lo: Infra nunca teve (nem
precisa ter) um jeito de ser aceito por aqui.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`offeredHandoff`)
- **Teste:**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 1" — Infra mais antigo + Dev Lead mais novo resolve pro
  card do Dev Lead, nunca pro de Infra; só Infra `offered` não mostra card
  nenhum
- **Origem:** investigação de código + teste ao vivo no Chrome — o handoff
  pro Dev Lead nunca ficava acionável depois da FASE 14d

### RN-137 — "Ativar execução" tem atalho inline no card do Dev Lead, sem baixar a exigência de papel {#rn-137}

O card de aceite do handoff pro Dev Lead ganhou um botão "Ativar execução"
ao lado do link "Acompanhe a execução em Executores" — atalho pra quem já
sabe o que quer, sem passar pela conversa. Chama a MESMA
`activateExecution` que a Visão Geral usa, agora com `sessionId` (a sessão
de chat aberta) como `originSessionId` — sem isto a sessão que trouxe o
Dev Lead ficava `active` para sempre, mesmo com a execução (numa sessão
SEPARADA) já tendo decolado por este atalho ([RN-135](#rn-135)).

**A rota continua exigindo `maintainer`** — DELIBERADAMENTE não alinhada ao
`developer` que já basta pra aceitar o handoff no mesmo card. Quem ativa
vira `session.createdBy` da sessão de execução, e é esse papel que
`ProposeActionUseCase` resolve (`ResolveEffectiveRoleUseCase.forProject`)
como o EFETIVO de todo `git_commit`/`git_push`/`pr_open` que os dev agents
propuserem dali em diante — é o mesmo motivo que já justificava o
`maintainer` do botão da Visão Geral
(`ExecutionController#activate`). Baixar a exigência aqui inverteria essa
resolução em silêncio: toda PR que a execução abrisse passaria de
`auto_approve` para `require_approval` sempre que quem clicou fosse
`developer`, sem ninguém ter decidido isso. Quem não é `maintainer` recebe
a frase real da api ("Papel insuficiente para esta ação", via
`mensagemDaApi`) em vez de um erro genérico.

Sem gate de `module_map` client-side: quando este card existe, o Arquiteto
já o definiu — é o artefato que precede a oferta do handoff pro Dev Lead —,
então replicar o `disabled={!hasModuleMap}` da Visão Geral travaria o botão
à toa. O caso raro (sessão inconsistente) cai no mesmo catch que trata
403/outros erros.

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
  (`handleActivateExecution`), `apps/web/src/lib/api-client.ts`
  (`activateExecution` ganhou `originSessionId`)
- **Teste:**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 2" — clique chama `activateExecution` com
  `sessionId`; 403 mostra a frase real da api; o botão convive com o de
  aceitar o handoff e com o link de Executores
- **Origem:** investigação de código + teste ao vivo no Chrome — pedido de
  atalho, com a divergência de papel confirmada e mantida por decisão
  (não corrigida por alinhamento automático)

### RN-138 — Mensagens de um agente colapsam depois que ele passa o bastão {#rn-138}

A timeline do chat mostrava tudo sempre expandido, sem agrupar por autor —
numa sessão longa com Criativo, PO e Arquiteto se revezando, o histórico de
quem já saiu de cena competia por espaço com quem está falando agora. Cada
entrada da timeline ganhou um `agentId` (o `actor.id` de quem a gerou,
quando é um agente — `agent.response`, `agent.error`, épico/história
criados pelo PO, card de aprovação); entradas de usuário e as que marcam
uma TRANSIÇÃO (handoff, promoção de história) ficam sem `agentId` de
propósito, porque são pontos de corte por natureza.

Uma sequência CONSECUTIVA do mesmo `agentId` vira cabeçalho colapsável
(`Disclosure` do design system, fechado por padrão — nome do agente +
contagem, reabre com um clique) quando as duas condições valem:

1. **o agente já passou o bastão** — existe um handoff dele (`fromAgent`)
   com `status: 'accepted'` (a mesma verdade que o `handoff.accepted` do
   event log grava, sem precisar reconstruir por junção de evento); e
2. **nenhuma ação dele está `pending`** — a checagem é por `actor.id` em
   TODAS as `actions` da sessão, não só nas da sequência corrente: uma
   corrida de aprovação em aberto não pode ficar escondida atrás de um
   clique em NENHUM ponto do fio.

Uma sequência de 1 entrada nunca colapsa — "Fulano · 1 mensagem" no lugar
da própria mensagem não ganha nada. Qualquer entrada sem `agentId`, ou de
um agente diferente, quebra a sequência corrente exatamente como uma troca
de agente quebra — só agrupa o que é realmente consecutivo.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`TimelineEntry.agentId`,
  `timelineAgrupada`), `apps/web/src/routes/SessionPage.module.css`
  (`.agentGroup*`)
- **Teste:**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 3" — colapsa com bastão passado e sem ação pendente;
  não colapsa sem handoff aceito; não colapsa com ação pendente do mesmo
  agente; mensagem de outro autor no meio quebra o agrupamento
- **Origem:** investigação de código + teste ao vivo no Chrome — pedido de
  colapso, com `AgentTimelineTree`/`timeline-tree.ts` como referência de
  FORMA (agrupar por agente, nome + contagem, aberto/fechado), adaptada à
  timeline heterogênea intercalada do chat

---

## Psicólogo e Anamnese

### RN-021 — Hipótese sem evidência válida não é gravada {#rn-021}

Os `evidenceEventIds` precisam apontar para eventos **que existem e pertencem à
sessão analisada**. A validação é atômica por lote: um id inválido reprova o
lote inteiro.

- **Onde:** `apps/api/src/domain/psychologist/hypothesis-evidence.ts`
- **Teste:** `test/domain/psychologist/hypothesis-evidence.spec.ts`
- **Origem:** [ADR 0015](adr/0015-psicologo-real-toolloop-hipoteses-evidencia.md) §3

### RN-022 — O ciclo de vida da hipótese é compare-and-swap {#rn-022}

`proposed → accepted | dismissed`. Duas decisões concorrentes sobre a mesma
hipótese: uma vence, a outra recebe conflito — não 500, não silêncio.

- **Onde:** `apps/api/src/domain/psychologist/hypothesis-lifecycle.ts`
- **Teste:** `test/domain/psychologist/hypothesis-lifecycle.spec.ts`
- **Origem:** [ADR 0022](adr/0022-fechamento-4b-psicologo.md) §7

### RN-023 — A causa de término é classificação determinística {#rn-023}

Vem do **motivo** registrado, nunca de julgamento do LLM e nunca por
eliminação. Toda falha registra a origem: `infra | modelo | código | política`.

- **Onde:** `apps/engine/lib/engine/psychologist/termination_classifier.ex`
- **Origem:** [ADR 0022](adr/0022-fechamento-4b-psicologo.md) §5 e
  [ADR 0020](adr/0020-destravar-gates-qa-secops.md) §6

### RN-024 — A Anamnese só perfila competência do catálogo — guarda-corpo estrutural {#rn-024}

Competências de processo são **seis**, fechadas: `git`, `agile`, `arquitetura`,
`testes`, `seguranca`, `infra`. Mais as stacks técnicas derivadas do
`module_map`. Qualquer outra coisa — "ansiedade", "saúde mental" — **não tem
caminho de escrita**: é erro no domínio, não instrução de prompt.

- **Onde:** `apps/api/src/domain/anamnese/competency-catalog.ts:16`
- **Teste:** `test/domain/anamnese/competency-catalog.spec.ts`
- **Origem:** [ADR 0016](adr/0016-anamnese-proficiencia-patches-instrucao.md) §1
- **Por quê:** a Anamnese perfila **competência técnica**, não pessoa. O limite
  é estrutural porque uma instrução de prompt não é garantia.

### RN-025 — Apagar o perfil apaga de verdade, e o opt-out impede a re-derivação {#rn-025}

- **Onde:** `apps/api/src/domain/anamnese/proficiency-profile.entity.ts` +
  tabela `anamnese_opt_outs`
- **Origem:** [ADR 0016](adr/0016-anamnese-proficiencia-patches-instrucao.md) §2

### RN-026 — Patch de instrução negado não é reproposto {#rn-026}

A comparação é sobre o conteúdo **normalizado**, não sobre o texto literal:
reindentar o mesmo patch não o transforma em proposta nova. Não há tabela de
dedup — a fonte é o próprio histórico de `proposed_action` com `actionType =
instruction_patch` e `status = denied`.

- **Onde:** `apps/api/src/domain/instructions/patch-dedup.ts:22`
- **Teste:** `test/domain/instructions/patch-dedup.spec.ts`

### RN-027 — Rollback de instrução é operação **para frente** {#rn-027}

Reverter cria uma versão nova com o conteúdo antigo; não apaga histórico. A
tabela de versões é append-only.

- **Onde:** `apps/api/src/domain/instructions/`
- **Origem:** [ADR 0016](adr/0016-anamnese-proficiencia-patches-instrucao.md) §4

---

## Git

### RN-028 — Capability decide, não o nome do provider {#rn-028}

Operação não suportada (proteção de branch no provider local) é declarada em
`capabilities` e rejeitada com `GitNotSupportedError` — nunca falha silenciosa.

São **quatro** capabilities: `protectBranch` e `pullRequests` desde a Fase 2, e
`listTree` e `pullRequestDiff` desde a FASE 26 (aba Code, só leitura). A regra
não mudou com elas — mudou o alcance. E o critério de declarar continua sendo
prova: capability só é `true` quando a suite a exercita naquele provider; sem
prova, declara-se `false` e degrada (mesmo critério dos ADRs 0041/0042).

- **Onde:** `packages/shared/src/index.ts` (`GitProviderCapabilities`); os
  tetos das duas operações de leitura em
  `apps/api/src/domain/git/git-read-limits.ts`, fora do shared porque ele é
  100% tipo
- **Teste:** suite de contrato única, `test/contract/git-provider.contract.ts`,
  rodada contra os três providers
- **Origem:** [ADR 0001](adr/0001-git-provider-contract-shape.md)

### RN-029 — O bootstrap de Gitflow é idempotente e retomável {#rn-029}

Cinco passos; cada um verifica antes de agir e pode ser retomado do ponto que
falhou. `skip` é sucesso, não erro.

Eram seis. O sexto criava a branch `rc`, degrau que o
[ADR 0030](adr/0030-politica-de-branches-mecanizada.md) removeu da política —
o bootstrap continuou criando, protegendo e **documentando no repositório do
usuário** uma escada que o produto já tinha abandonado (achado #3 do primeiro
dogfooding). O valor `create_rc_branch` continua no enum `bootstrap_step`:
linhas antigas o referenciam, e passo que aconteceu de verdade não se apaga do
histórico.

- **Onde:** `apps/api/src/application/use-cases/git/bootstrap-steps.ts` +
  `domain/git/repo-bootstrap.entity.ts` (`RETIRED_BOOTSTRAP_STEPS`)
- **Teste:** `test/domain/git/repo-bootstrap-status.spec.ts`
- **Origem:** [ADR 0005](adr/0005-repo-bootstrap-idempotent-steps.md)

---

## Credenciais

Chave de LLM e token de git do usuário vivem na mesma tabela
(`user_credentials`), sob o mesmo envelope encryption. Esta seção vale para as
duas.

### RN-055 — Credencial é sempre cifrada e gravada; verificar é ação à parte, com três respostas {#rn-055}

O cadastro **não julga a credencial**: cifra e grava, mesmo que o provider
fosse recusá-la. Verificar é uma ação explícita sobre a credencial **já
gravada** — a api decifra, chama o provider e devolve só o veredito. O texto
plano nunca volta em resposta nenhuma, nem em pedaço, nem no motivo da recusa.

Era o contrário: o cadastro testava antes de persistir e recusava a gravação
([ADR 0004](adr/0004-git-credential-registration.md), estendido às chaves de
LLM na Fase 11a). O modo de falha real foi o oposto do previsto — como o campo
é write-only e a tela nunca reexibe o que foi digitado, uma recusa deixava o
usuário **sem credencial e sem o texto para corrigir**.

O veredito tem **três** valores, e o terceiro é obrigatório:

| | quando |
|---|---|
| `ok` | o provider aceitou |
| `recusado` | o provider rejeitou — carrega o motivo **dele** |
| `nao_suportado` | não há endpoint de teste verificado (`ollama`, `anthropic`, `openai`) |

Sem `nao_suportado`, um provider cujo tester é NO-OP voltaria `ok` e a tela
afirmaria uma verificação que nunca aconteceu. É a regra de capability do
[ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)
aplicada aqui: só se declara o que foi provado. Por isso o port declara
`supports()` — o silêncio de `test()` sozinho é ambíguo.

Chave ruim **não é exceção HTTP**: o caso de uso captura
`LLMCredentialConnectionTestFailedError`/`GitCredentialConnectionTestFailedError`
e devolve resultado, com 200. A única exceção é não existir credencial para
(usuário, provider) — 404, porque aí não há o que testar.

- **Onde:**
  `apps/api/src/application/use-cases/credentials/test-stored-credential.use-case.ts`,
  `apps/api/src/application/use-cases/llm/upsert-user-credential.use-case.ts`,
  `apps/api/src/application/use-cases/git/register-git-credential.use-case.ts`,
  `apps/api/src/application/ports/llm-credential-connection-tester.port.ts`
  (`supports`)
- **Teste:**
  `test/application/use-cases/credentials/test-stored-credential.use-case.spec.ts`
  (os três resultados, o despacho git×LLM, o 404 e a ausência do segredo na
  resposta); `test/application/use-cases/llm/upsert-user-credential.use-case.spec.ts`
  e `test/application/use-cases/git/register-git-credential.use-case.spec.ts`
  (a gravação incondicional, que é a inversão)
- **Origem:** [ADR 0050](adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)

---

## Autenticação

Regras do auth first-party. Todas valem no domínio da api, que desde a 7.2 é
também o **emissor** dos tokens de acesso — o Keycloak saiu num corte atômico,
sem período de coexistência.
Decisões em [ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
e [ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

### RN-030 — Reapresentar um refresh já usado revoga a família inteira {#rn-030}

Cada refresh consome o token apresentado e emite um filho com o **mesmo**
`family_id` e o mesmo `family_started_at`. Apresentar um token que já foi
consumido é a assinatura de um roubo — alguém está usando uma cópia — e a
resposta é revogar todos os tokens vivos daquela família, com evento de
segurança.

O usuário legítimo é deslogado junto. Isso é o comportamento correto, não um
defeito: do lado do servidor, um duplo-submit do cliente e um replay de ladrão
são idênticos.

- **Onde:** `apps/api/src/domain/auth/refresh-token.ts:50` +
  `application/use-cases/auth/refresh.use-case.ts:98`
- **Teste:** `test/application/use-cases/auth/rotacao-e-reuso.spec.ts`
- **Borda:** quem apresenta um token de família **já revogada** é vítima a
  jusante, não novo roubo: registra `refresh_revoked` e **não** dispara segunda
  cascata. Sem essa distinção, cada aba do usuário legítimo geraria um alarme
  falso durante o incidente.
- **Origem:** [ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-031 — Falha de login é contada por e-mail e por IP, e o bloqueio escala {#rn-031}

Janela deslizante de 15 minutos no Postgres, sem Redis. Dois baldes por
tentativa e o mais restritivo vence: e-mail (5 falhas → 30s, 8 → 5min, 12 →
15min) e IP (20 → 30s, 30 → 2min). Um login bem-sucedido limpa o balde do
e-mail; o de IP drena só por tempo.

A chave do balde é o **e-mail normalizado**, nunca o id do usuário. Com id, o
balde só existiria depois de encontrar a conta, e o próprio lockout viraria
oráculo de existência.

- **Onde:** `apps/api/src/domain/auth/lockout-policy.ts:97` +
  `infrastructure/persistence/drizzle/drizzle-login-throttle.ts:74`
- **Teste:** `test/application/use-cases/auth/lockout.spec.ts`
- **Borda:** enquanto bloqueado, a tentativa **não** é registrada. Se fosse, um
  atacante manteria a conta da vítima travada para sempre só continuando a
  tentar — o lockout viraria negação de serviço contra quem ele protege.
- **Por quê:** o balde de IP não pode ser limpo no sucesso; quem tem uma conta
  válida zeraria a janela à vontade e pulverizaria palpites sem limite.
- **Origem:** [ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-032 — Nenhuma resposta distingue conta existente de inexistente {#rn-032}

Qualquer resposta diferente da falha uniforme só é alcançável **depois** de uma
verificação de senha bem-sucedida. No login, e-mail inexistente, senha errada e
conta bloqueada devolvem o mesmo 401 e gastam o mesmo tempo — o ramo sem conta
verifica contra um hash dummy gerado com **os mesmos parâmetros** do real. No
registro e no pedido de reset, endereço conhecido e desconhecido devolvem 202.

- **Onde:** `apps/api/src/application/use-cases/auth/login.use-case.ts:79` +
  `register.use-case.ts:74`
- **Teste:** `test/application/use-cases/auth/enumeracao.spec.ts`
- **Borda:** a checagem de bloqueio por e-mail roda **depois** do argon2, não
  antes. Sair mais cedo é a otimização que qualquer revisor sugeriria, e é
  exatamente o vazamento — o teste fica vermelho se alguém a introduzir.
- **Borda:** o usuário MIGRADO do Keycloak (existe em `users`, sem linha em
  `auth_credentials`) também recebe o 401 uniforme — e o link de "definir
  senha" é disparado em silêncio. Responder `password_pending` confirmaria que
  o endereço existe **e** que é conta legada. Por isso `findByEmail` é um LEFT
  JOIN numa consulta só: duas consultas encadeadas fariam esse ramo pagar uma
  ida a mais ao banco, e o relógio revelaria o que o corpo esconde.
- **Por quê:** o que se afirma é "nenhum ramo pula o trabalho caro e nenhum
  produz resposta distinguível", **não** tempo constante. Ver as consequências
  no ADR.
- **Origem:** [ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md),
  borda do migrado em
  [ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-033 — Token de verificação e de reset vale uma vez só {#rn-033}

Consumo por UPDATE condicional com `returning`: o próprio UPDATE é a guarda.
Zero linhas cobre inexistente, de outro propósito, já consumido, invalidado e
expirado — todos com a mesma resposta. Pedir um link novo invalida o anterior.
Concluir um reset revoga **todas** as sessões do usuário e não emite tokens.

- **Onde:** `apps/api/src/infrastructure/persistence/drizzle/account-token.repository.ts:76`
- **Teste:** `test/application/use-cases/auth/tokens-de-conta.spec.ts`
- **Borda:** dois envios simultâneos não passam os dois. A corrida é o caso
  **normal**, não a exceção: scanner de e-mail corporativo abre todo link de
  toda mensagem, então o robô costuma consumir o token antes do humano clicar.
- **Por quê:** o reset não emite sessão de propósito — logar direto a partir de
  um link recebido por e-mail faria comprometer o e-mail equivaler a tomar a
  conta, sem segundo passo.
- **Origem:** [ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-034 — A sessão da web vive em cookie httpOnly, com CSRF {#rn-034}

O refresh token vai num cookie `brabo_refresh` (`httpOnly`, `SameSite=Strict`,
`Path=/auth`, `Secure` em produção) e **não** aparece no corpo de nenhuma
resposta. O access token, de 15 minutos, fica em memória no cliente e viaja no
`Authorization: Bearer`.

`/auth/refresh` e `/auth/logout` exigem `X-CSRF-Token` igual ao cookie
`brabo_csrf`, comparado em tempo constante.

- **Onde:** `apps/api/src/interfaces/http/auth/session-cookies.ts:53` +
  `interfaces/http/auth/auth.controller.ts`
- **Teste:** `test/interfaces/session-cookies.spec.ts`
- **Borda:** falha de CSRF é **403**, não 401. Com 401 o cliente tentaria
  renovar a sessão e entraria em laço — a credencial está boa, quem está errada
  é a requisição.
- **Por quê:** devolver o refresh também no corpo anularia o `httpOnly` —
  bastaria um XSS ler a resposta do login, e levaria a sessão longa em vez dos
  15 minutos do access.
- **Origem:** [ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-035 — O tráfego interno engine ↔ api exige o segredo de serviço {#rn-035}

As 32 rotas `/internal/*` são `@ServiceRoute()`: ficam fora do JWT de usuário e
fora do rate limit. Quem autentica é o `EngineServiceGuard`, comparando
`X-Brabo-Service-Token` com `BRABO_SERVICE_TOKEN` em tempo constante. O mesmo
segredo vale nos dois sentidos, e `BRABO_SERVICE_TOKEN_PREVIOUS` é aceito só na
verificação, para a rotação não ter janela de indisponibilidade.

- **Onde:** `apps/api/src/interfaces/http/auth/engine-service.guard.ts:44` +
  `infrastructure/security/service-token.ts` +
  `apps/engine/lib/engine_web/plugs/verify_service_token.ex`
- **Teste:** `apps/engine/test/engine_web/plugs/verify_service_token_test.exs`
  e `test/interfaces/route-surface.spec.ts`
- **Borda:** a isenção de rate limit vem do METADADO da rota, não do guard. O
  `RateLimitGuard` é `APP_GUARD` e roda antes de qualquer guard de controller —
  quando ele decide, o `EngineServiceGuard` ainda não rodou.
- **Origem:** [ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-128 — `sessionId`/`projectId`/`agent`/`agentId` são validados ANTES de virar segmento de URL da requisição interna ao engine {#rn-128}

`HttpApiToEngineClient` interpola estes valores em template string pra
montar a URL de `/internal/*` — sem DTO/`class-validator` no meio, igual
à [RN-127](#rn-127): eles chegam de `@Param`/lookup de sessão sem pipe de
validação em algum ponto da cadeia, e nada garante a forma deles antes da
interpolação. Um valor malicioso poderia injetar segmento de path extra
ou caracteres que quebram a URL montada — o `EngineServiceGuard` autentica
o CHAMADOR (RN-035), não CONFERE o que o chamador manda na URL.

`garantirSegmentoDeUrlInterna` reusa a mesma largura de
`NOME_DE_PASTA_VALIDO` (RN-092/109) — hex, hífen e sublinhado, 1 a 64
chars — e é chamada em DOIS lugares, cobrindo TODOS os métodos que
interpolam id em URL, não só os que o CodeQL reportou:

- dentro de `postCommand`, que a maioria dos métodos já usa
  (`startAgent`, `sendAgentMessage`, `confirmReadiness`, `cancelAgentTurn`,
  `offerInfraHandoff`, `offerDevHandoff`, `invalidateInstructions`,
  `startExecution`, `acceptParallelization`, `rearmDevAgent`,
  `reviseStory`) — o chamador lista as tuplas `(nome, valor)` que já
  interpolou no `path`, e `postCommand` valida TODAS antes de montar a
  requisição;
- direto em `reanalyzeSession`/`runAnamnese`, que não passam por
  `postCommand` (precisam distinguir 503 de falha de transporte) e por
  isso eram os dois únicos pontos que o CodeQL alcançou.

O caminho feliz não muda: `sessionId`/`projectId` são sempre UUID vindo do
banco, e `agent`/`agentId` são sempre slug curto.

- **Onde:** `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`garantirSegmentoDeUrlInterna`, `postCommand`)
- **Teste:** `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (id malformado é recusado ANTES de tocar a rede — provado apontando
  `ENGINE_URL` pra uma porta que nada escuta — e o caminho feliz chega a
  fazer a requisição)
- **Origem:** alerta CRÍTICO do CodeQL (URL de requisição interna montada
  com valor não validado) bloqueando a promoção qa→main, achado durante a
  PR #256; mesmo padrão do [RN-092](#rn-092)

### RN-105 — Sem imagem decidida pelo Arquiteto, o container não sobe e o Code não abre {#rn-105}

A aba Code (`GET /projects/:id/code/*`, [ADR 0060](adr/0060-superficie-de-leitura-de-codigo.md))
responde **409** enquanto o projeto estiver em `sem_decisao` — o estado inicial
de todo projeto. `sem_decisao` vira `decidido` só quando o Arquiteto emite
`artifact.project_image` pela ferramenta `choose_project_image`, com imagem OCI
de tag explícita (`latest` recusado), `rationale` e postura de rede.

A checagem mora no MESMO funil que a contenção de caminho da
[RN-095](#rn-095) (`ReadProjectCodeUseCase.alvo`), e não em cada uma das quatro
rotas — checagem duplicada em quatro chamadores é checagem que um dia diverge
em um deles ([ADR 0058](adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)).

O artefato não tem tabela: é o próprio evento no event log, versionado
(`version` cresce a cada emissão, o vigente é o de maior `version`), do mesmo
jeito que `artifact.module_map`. Revisar a imagem é emitir uma versão nova,
nunca sobrescrever a anterior.

- **Onde:** `apps/api/src/domain/containers/project-container.ts`,
  `apps/api/src/application/use-cases/containers/decidir-imagem-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/containers/obter-container-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts` (método
  `portaoDoContainer`), `apps/engine/lib/engine/harness/tools/choose_project_image.ex`
- **Teste:**
  `apps/api/test/domain/containers/project-container.spec.ts`,
  `apps/api/test/application/use-cases/containers/container-do-projeto.use-case.spec.ts`,
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (bloco "o portão do container")
- **Borda:** 409 e não 403 — nada está errado com quem pediu nem com a
  permissão dele; o recurso ainda não existe NESTE ESTADO. E não é 404: a aba
  existe, só não está liberada. A mensagem diz o que falta, para a tela mostrar
  o motivo em vez de um erro mudo (RN-088).
- **Origem:** [ADR 0065](adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-106 — `git push`, PR e deploy não saem pelo terminal — mesmo dentro do escopo do projeto {#rn-106}

Dentro do container do projeto o agente é livre (ADR 0065): o allowlist de
verbos do [ADR 0055](adr/0055-escopo-de-caminho-na-politica-de-terminal.md) não
converge (achados Z e AD — verbo, forma e invocação são espaços distintos), e a
saída é a parede, não uma lista mais longa. Mas três efeitos atravessam a
parede e chegam no mundo, e a decisão do usuário foi textual: *"agente livre
para o que quiser desde que não seja comandos de git ligado ao deploy e ao PR —
estas ações ainda devem ser humanas"*.

`decide()` reconhece `git push`, `git remote add/set-url`, `git merge`, os CLIs
de provider (`gh pr create`, `gh pr merge`, `glab mr create/merge`, releases e
workflow dispatch) e os comandos de deploy comuns (`kubectl apply`, `helm
upgrade`, `terraform apply`, `docker push`, `npm publish`, ...) por PREFIXO de
tokens, ignorando flags globais no meio (`git -C /tmp push` casa). Qualquer
segmento do comando composto que case é **`deny`** — não `require_approval`:
"sempre permitir" grava o padrão em `allow`, e um clique bastaria para a
segunda porta ficar aberta para sempre. `deny` vence `allow` em qualquer
estágio, e é aplicado ANTES de qualquer estágio permissivo em `decide()`.

Negar não tira poder do agente: a mensagem redireciona para a ação TIPADA
(`git_push`, `git_merge`, `pr_open`) — que nasce `proposed_action`, tem papel
mínimo próprio e registra no event log o que foi empurrado e para onde. É o
caminho que o dev agent já usa (`agent_io.ex` propõe `git_push`); o que muda é
que agora está garantido por `deny`, não só combinado por convenção.

- **Onde:** `apps/api/src/domain/actions/external-effect.ts`,
  `apps/api/src/domain/actions/decide.ts` (bloco "FRONTEIRA DO CONTAINER")
- **Teste:** `apps/api/test/domain/actions/external-effect.spec.ts`,
  `apps/api/test/domain/actions/decide.spec.ts` (describe "a fronteira do
  container")
- **Borda:** a fronteira NÃO se sobrepõe à trava de merge em branch protegida
  (RN-014, sempre manual) nem ao escopo de caminho (RN-095/ADR 0055) — as três
  regras coexistem, cada uma vetando por um motivo diferente.
- **Origem:** [ADR 0065](adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-107 — A aba Code tem um QUARTO estado: bloqueada por decisão pendente {#rn-107}

Os três estados da [RN-088](#rn-088) (carregando/erro/vazio) não descrevem
`sem_decisao` ([RN-105](#rn-105)): não é carregando (a api já respondeu), não é
erro (ela respondeu CERTO) e não é vazio (não falta dado — falta uma DECISÃO,
que é outra coisa). Tratar `sem_decisao` como "vazio" mostraria um editor sem
arquivos, convidando a pensar que o repositório está vazio; tratar como "erro"
faria a tela sugerir "tentar de novo" para algo que só o Arquiteto resolve.

A aba pergunta o estado do container ANTES de tentar ler código
(`GET /projects/:id/container`), em vez de esperar a primeira árvore ou
arquivo devolver 409 — a mesma checagem que a api já faz no funil de
`ReadProjectCodeUseCase` (RN-105), só que perguntada primeiro, para o quarto
estado nascer como mensagem própria e não como o rodapé de um erro genérico.
Enquanto bloqueada, a tela reconsulta sozinha a cada 15s — depois de decidida
a imagem não muda sem ação humana nova, e ficar reconsultando um estado
estável seria a mesma família de tráfego desnecessário da PÓS-FASE 15.

- **Onde:** `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/web/src/routes/ProjectCodeTab.module.css`
- **Teste:** `apps/web/src/routes/ProjectCodeTab.test.tsx` ("o gate")
- **Borda:** a checagem no front NÃO substitui a da api — é conveniência de
  UX. Se a api mudar de estado entre a consulta do gate e a leitura de
  verdade, a rota de leitura ainda recusa com 409 (RN-105); o front só evita
  o caso comum de mostrar o editor vazio por um instante.
- **Origem:** [ADR 0065](adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-110 — `blame` é a 13ª operação do `GitProviderContract`, com o mesmo vocabulário de ausência das outras leituras {#rn-110}

Fundação da pendência de blame declarada na FASE 26 (nenhuma tela consome
ainda — vem na onda seguinte). `blame(ref, path)` devolve `GitBlame | null`,
`null` significando exatamente o que já significa em `getFileContent`/
`listTree`: arquivo ausente naquela ref, ou ref inexistente. Dois vocabulários
de "não existe" para a mesma aba fariam a tela tratar o mesmo caso de duas
formas — a mesma razão que já valia para as duas operações anteriores.

Cada provider computa por meios PRÓPRIOS, porque não há endpoint comum: o
GitHub não tem blame na REST (só GraphQL — a única operação do provider que
fala GraphQL), o GitLab tem `repository/files/:path/blame`, e o local sai de
`git blame --porcelain`, o único dos três testado contra um repositório de
verdade nesta sessão (os outros dois só contra os backends fake do teste de
contrato — sem `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` no ambiente, quem prova
contra a API real é o smoke manual). `GIT_BLAME_LINE_LIMIT` (2000) corta
arquivo genuinamente enorme — já cortado por bytes na rota de conteúdo, mas
`blame` lê o arquivo inteiro do provider antes de decidir.

- **Onde:** `packages/shared/src/index.ts` (`BlameInput`, `GitBlame`,
  `GitBlameLine`, capability `blame`),
  `apps/api/src/infrastructure/git/{github,gitlab,local}-provider.ts`,
  `apps/api/src/domain/git/git-read-limits.ts` (`GIT_BLAME_LINE_LIMIT`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (método `blame`), `apps/api/src/interfaces/http/git/code.controller.ts`
  (`GET /projects/:id/code/blame`)
- **Teste:** `apps/api/test/contract/git-provider.contract.ts` (bloco "blame"),
  exercitado pelos três specs de provider — o do `local` contra git de
  verdade — e `read-project-code.use-case.spec.ts` (bloco "blame")
- **Origem:** FASE 26b (fundação das pendências declaradas da FASE 26/
  [ADR 0060](adr/0060-superficie-de-leitura-de-codigo.md))

### RN-111 — `listPullRequests` é a 14ª operação do `GitProviderContract`; a lista navegável abre o mesmo diff por id {#rn-111}

`CodeDiffPanel.tsx` consome `listPullRequests(state?)` numa lista clicável
(id/número/título/autor/estado/branches, com filtro por estado); clicar num
item reusa o MESMO fluxo de diff por id que já existia — não há caminho novo
de leitura, só como CHEGAR ao id sem precisar saber de cor. Quem já sabe o id
(ex.: veio de Aprovações) continua podendo colar direto.

`listPullRequests(state?)` devolve um RESUMO por PR
(`GitPullRequestSummary`: id, número, título, autor, estado, branches,
`updatedAt`) — não `GitPullRequest`, que é o tipo de ESCREVER (abrir/mesclar) e
nunca teve título nem autor porque nenhuma das duas operações precisava. Um
tipo próprio evita que a escrita ganhe campos que só a leitura usa.

O `local` TEM PR — o store sidecar da Fase 4a já é a fonte, e a suposição do
enunciado ("PR não existe no conceito de repositório local puro") não se
sustentou: o self-contained dos dev agents criou PR local desde então. As três
capabilities são `true`. `GIT_PR_LIST_LIMIT` (100) é uma página só, sem
paginação de seguimento — navegação humana, não sincronização de histórico.

- **Onde:** `packages/shared/src/index.ts` (`ListPullRequestsInput`,
  `GitPullRequestSummary`, `GitPullRequestList`, capability
  `pullRequestsList`), `apps/api/src/infrastructure/git/{github,gitlab,
  local}-provider.ts`, `apps/api/src/domain/git/git-read-limits.ts`
  (`GIT_PR_LIST_LIMIT`), `read-project-code.use-case.ts` (método
  `pullRequests`), `code.controller.ts` (`GET /projects/:id/code/pull-requests`),
  `apps/web/src/routes/code/CodeDiffPanel.tsx` (lista clicável, filtro por
  estado, reuso do fluxo de diff por id)
- **Teste:** `git-provider.contract.ts` (bloco "listPullRequests"),
  `read-project-code.use-case.spec.ts` (bloco "lista de PRs"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`
- **Origem:** FASE 26b

### RN-112 — `listBranchesDetailed` é operação PRÓPRIA, separada de `listBranches` {#rn-112}

Fundação do dropdown rico, agora consumida por `CodeBranchPicker.tsx`
(`ahead`/`behind`, badge de PR — a onda seguinte à FASE 26b fechou a
pendência que `CodeShell.tsx` declarava). A decisão foi NÃO estender `listBranches` — a
13ª operação original, que o bootstrap de Gitflow chama sem precisar de nada
disso: enriquecer custa uma chamada extra ao provider POR BRANCH (duas no
GitLab, que não tem endpoint que devolva os dois lados de uma comparação numa
chamada só, ao contrário de `compareCommitsWithBasehead` do GitHub e de `git
rev-list --left-right --count` no local). Encostar esse custo em toda
adoção/criação de branch transformaria o bootstrap numa varredura cara. As
duas operações convivem no contrato: `listBranches` pro bootstrap,
`listBranchesDetailed` (a 15ª) pra aba Code — `GitBranchDetail` estende
`GitBranch` só na FORMA, nunca no CONTRATO de quem chama.

`ahead`/`behind` são sempre relativos à branch DEFAULT do repositório
(`ListBranchesDetailedInput.defaultBranch`, que o chamador já sabe — pedi-la
de novo ao provider seria uma chamada a mais só pra redescobrir o que já
tinha). `null` nos dois quando o provider não consegue computar (branch órfã,
histórico não relacionado) é degradação honesta, nunca um número inventado.
`GIT_BRANCH_DETAIL_LIMIT` (30) corta pelas mesmas razões de tráfego do item 34
da FASE 26 — sem ele, um repositório com centenas de branches viraria centenas
de chamadas por abertura do dropdown.

- **Onde:** `packages/shared/src/index.ts` (`ListBranchesDetailedInput`,
  `GitBranchDetail`, `GitBranchDetailList`, `GitBranchPullRequestRef`,
  capability `branchesDetailed`), `apps/api/src/infrastructure/git/{github,
  gitlab,local}-provider.ts`, `git-read-limits.ts`
  (`GIT_BRANCH_DETAIL_LIMIT`), `read-project-code.use-case.ts` (método
  `branches`), `code.controller.ts` (`GET /projects/:id/code/branches`);
  no web, `apps/web/src/lib/api-client.ts` (`getCodeBranches`) e
  `apps/web/src/routes/code/CodeBranchPicker.tsx` — o dropdown em si, aberto
  a partir de `CodeShell.tsx`
- **Teste:** `git-provider.contract.ts` (bloco "listBranchesDetailed"),
  `read-project-code.use-case.spec.ts` (bloco "branches detalhadas"),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`
- **Borda:** o método `branches()` mora no MESMO caso de uso das outras seis
  leituras (`ReadProjectCodeUseCase`), não perto do bootstrap — é uma LEITURA
  da aba Code, com a mesma resolução de credencial e o mesmo portão de
  container (RN-105) que as demais; tratá-la como operação de bootstrap
  duplicaria os dois. Uma ref fora da lista de branches (tag ou sha) segue
  alcançável — o rodapé do dropdown tem um campo manual, porque
  `listBranchesDetailed` não enumera essas duas coisas.
- **Origem:** FASE 26b (fundação); onda seguinte fechou a UI

### RN-113 — Blame no editor é anotação SOB DEMANDA — um toggle, nunca embutida na leitura do arquivo {#rn-113}

A UI que consome a fundação da [RN-110](#rn-110) entra aqui: o editor da aba
Code (`CodeEditor.tsx`) só chama `getCodeBlame` quando o usuário liga o toggle
"Blame" — nunca junto da leitura de arquivo, que já dispara sozinha ao abrir
uma aba. O motivo é o mesmo dos orçamentos de leitura composta (ADR 0060):
blame é uma SEGUNDA chamada ao provider por arquivo aberto, e um arquivo perto
do teto (`GIT_BLAME_LINE_LIMIT`, 2000 linhas) já é caro o bastante para não
pagá-lo de graça em toda navegação. `truncated` (que a RN-110 já expõe) vira
aviso visível, no mesmo padrão do aviso de `fileQuery.data.truncated`.

Linhas consecutivas do MESMO commit mostram autor e sha curto só na PRIMEIRA
linha do bloco — repetir o mesmo texto em cada linha de um bloco de dezenas
de linhas seria ruído, não anotação; a linha só some do texto, nunca some da
anotação (o `title` do elemento continua com data completa e resumo do
commit em qualquer linha do bloco).

- **Onde:** `apps/web/src/routes/code/CodeEditor.tsx`,
  `apps/web/src/routes/code/CodeEditor.module.css`
- **Teste:** `apps/web/src/routes/code/CodeEditor.test.tsx`
- **Origem:** onda de UI da FASE 26b (blame — dropdown rico de branches e
  lista de PRs são UI de outros dois agentes, sem risco de colisão)

### RN-115 — A Anamnese pode ser pausada globalmente; a pausa é do PRODUTO, nunca apaga dado {#rn-115}

`ANAMNESE_ENABLED` (env var do engine, boolean, default `false` a partir
desta regra) decide se uma rodada NOVA da Anamnese pode acontecer — periódica
(`AnamneseSchedulerWorker`) ou sob demanda (`AnamneseCommandController`).
Decisão de PRODUTO do usuário em 2026-08-10 ("hoje ele não está trazendo
dados de muito valor"), não bug — ver docs/explanation/backlog.md. Desativada,
NENHUM dado existente é tocado: hipóteses, perfis de proficiência e patches
de instrução já gravados continuam intactos e visíveis, e o opt-out POR
MEMBRO (RN-025) continua um conceito separado — a pausa é do SISTEMA, não do
perfilamento individual.

`AnamneseSchedulerWorker.kickoff/0` (chamado uma vez no boot) NÃO agenda o
job periódico quando desativado, em vez de agendar e deixar `perform/1`
no-opar a cada tick — mais barato (a fila do Oban não recebe um job a cada
`ANAMNESE_INTERVAL_SECONDS` só para não fazer nada) e mais claro para quem
inspeciona a fila. **Correção em 2026-08-10** (achado real em execução, não
hipótese): a versão original desta regra deixava `perform/1` incondicional
de propósito, para a corrente entre rodadas não carregar a decisão de
ligar/desligar consigo — mas isso significava que uma corrente já agendada
ANTES de a flag existir (ou de alguém desativá-la) continuava se
reagendando pra sempre, rodando Anamnese de verdade com a flag dizendo
`false`. Foi exatamente o que aconteceu num Postgres de dev mais antigo que
o PR original, remediado manualmente cancelando os jobs agendados.
`perform/1` agora confere `enabled?/0` a cada tick, igual `kickoff/0`: se
desativado, nem `enqueue_projects/0` nem o reagendamento acontecem, e a
corrente morre ali — o que também AUTO-CURA sozinho o cenário de job antigo
que ainda dispara uma vez, sem precisar de intervenção manual.

`AnamneseCommandController.run/2` (rota sob demanda, "reanalisar agora" nas
Configurações) responde **503** com corpo `{"error": "anamnese_desativada"}`
quando desativado — distinto de propósito do 409 vazio que já existia para
"projeto sem sessão" (os dois eram fáceis de confundir num 409 puro, e são
causas bem diferentes). `RunAnamneseUseCase`, do lado api, converte o 503 do
engine em `ServiceUnavailableException` com `reason: "anamnese_disabled"` no
corpo — nunca um 500 genérico nem um 409 reaproveitado. A web
(`ProjectSettingsTab.tsx`) descobre o estado no primeiro clique de "Rodar
agora" (não há hoje uma leitura prévia do estado global) e, a partir daí,
desabilita o botão e mantém a explicação VISÍVEL na tela — não só um toast
que some (RN-088: nunca falha silenciosa ou confusa).

- **Onde:** `apps/engine/lib/engine/workers/anamnese_scheduler_worker.ex`
  (`enabled?/0`, `kickoff/0`),
  `apps/engine/lib/engine_web/controllers/anamnese_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/anamnese/anamnese-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`runAnamnese`), `apps/api/src/application/use-cases/anamnese/run-anamnese.use-case.ts`,
  `apps/web/src/routes/ProjectSettingsTab.tsx` (`ProficiencySection`)
- **Teste:**
  `apps/engine/test/engine/workers/anamnese_scheduler_worker_test.exs`
  (`kickoff/0` não agenda desativado, agenda ativado, default desligado;
  `perform/1` desativado no meio da corrente não faz fan-out nem reagenda),
  `apps/engine/test/engine_web/controllers/anamnese_command_controller_test.exs`
  (503 distinto de 409, com e sem sessão),
  `apps/api/test/application/use-cases/anamnese/run-anamnese.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ProficiencySection`)
- **Borda:** a flag é GLOBAL (todos os projetos/workspaces), não por projeto
  — ao contrário do teto de paralelismo (RN-083) ou do modelo herdável por
  área (RN-102), que são decisões por escopo. Ligar de volta é
  `ANAMNESE_ENABLED=true` e reiniciar o engine; não há botão na UI para isso
  (é operacional, não uma preferência de projeto).
- **Origem:** sem ADR — decisão de produto reversível, não mudança estrutural
  de arquitetura. Ver docs/explanation/backlog.md.

### RN-117 — O Psicólogo pode ser pausado globalmente; a pausa é do PRODUTO, nunca apaga dado {#rn-117}

`PSYCHOLOGIST_ENABLED` (env var do engine, boolean, default `false`) decide
se uma rodada NOVA do Psicólogo pode acontecer — automática (fechamento de
sessão, roteado pelo `Engine.Outbox.Drain`) ou sob demanda
(`PsychologistCommandController.reanalyze/2`). Mesma decisão de PRODUTO do
usuário em 2026-08-10 já aplicada à Anamnese (RN-115, "hoje ele não está
trazendo dados de muito valor") — não bug, ver docs/explanation/backlog.md.
Desativado, NENHUM dado existente é tocado: análises e hipóteses já
emitidas continuam intactas e visíveis.

Diferente da Anamnese (cujo gatilho automático é um TICK periódico que a
própria flag decide se reagenda), o gatilho automático do Psicólogo é o
fechamento de sessão — o `Engine.Outbox.Drain` roteia
`session.closed`/`session.closed_abnormally` pra `PsychologistWorker` só
quando `PsychologistWorker.enabled?/0` é true (`Drain.handlers_for/1`);
desativado, só `SessionLifecycleWorker` roda, e o job do Psicólogo nem
nasce. `PsychologistWorker.perform/1` continua incondicional de propósito —
mas NÃO é mais "o mesmo padrão" do `AnamneseSchedulerWorker` (ver a correção
de 2026-08-10 na RN-115 acima): lá `perform/1` passou a conferir a flag
porque ele PRÓPRIO reagenda a corrente a cada tick, e um job antigo
disparando incondicionalmente reabria a Anamnese com a flag desligada. O
Psicólogo não tem corrente nenhuma que se reagende sozinha — cada job nasce
de UM evento (`session.closed`), e quem decide é o `Drain` no momento em que
RECEBE o evento, não o worker no momento em que RODA; um job de Psicólogo
já enfileirado antes de desligar a flag é, no máximo, a última rodada
pendente, nunca uma corrente infinita. Por isso a suite pré-existente de
`PsychologistWorker` (que chama `perform/1` direto) não precisou mudar.

`PsychologistCommandController.reanalyze/2` (rota sob demanda,
"Reanalisar" na aba Insights) responde **503** com corpo
`{"error": "psicologo_desativado"}` quando desativado, sem sequer criar o
job. `ReanalyzeSessionUseCase`, do lado api, converte o 503 do engine em
`ServiceUnavailableException` com `reason: "psychologist_disabled"` no
corpo — nunca um 500 genérico. A web (`ProjectInsightsTab.tsx`) descobre o
estado no primeiro clique de "Reanalisar" (não há hoje uma leitura prévia
do estado global) e, a partir daí, desabilita os botões e mantém a
explicação VISÍVEL na tela — não só um toast que some (RN-088: nunca falha
silenciosa ou confusa).

- **Onde:** `apps/engine/lib/engine/workers/psychologist_worker.ex`
  (`enabled?/0`), `apps/engine/lib/engine/outbox/drain.ex`
  (`handlers_for/1`),
  `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/psychologist/psychologist-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`reanalyzeSession`),
  `apps/api/src/application/use-cases/execution/reanalyze-session.use-case.ts`,
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **Teste:**
  `apps/engine/test/engine/outbox/drain_test.exs` (`session.closed` só
  enfileira o Psicólogo quando ativado),
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  (503 sem criar job, 202 com job enfileirado quando ativado),
  `apps/api/test/application/use-cases/execution/reanalyze-session.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **Borda:** a flag é GLOBAL (todos os projetos/workspaces), como a da
  Anamnese. Ligar de volta é `PSYCHOLOGIST_ENABLED=true` e reiniciar o
  engine; não há botão na UI para isso.
- **Origem:** sem ADR — decisão de produto reversível, não mudança estrutural
  de arquitetura. Ver docs/explanation/backlog.md.

### RN-108 — O socket da sessão exige um ticket opaco de uso único, não o JWT reaproveitado {#rn-108}

`EngineWeb.SessionSocket.connect/3` recusava a conexão inteira só com o
`session_id` (UUID) precisando existir no Registry — quem descobrisse o UUID
entrava no canal `session:<id>` e recebia todos os broadcasts ao vivo da
sessão. Fechar isso era limitação deliberada documentada no próprio módulo
desde a Fase 3.

`POST /projects/:projectId/sessions/:sessionId/socket-ticket` (`scope:
"heartbeat"|"terminal"`) emite um ticket opaco (32 bytes de CSPRNG,
`TokenFactory`), TTL de **30 segundos**, uso único. `scope: "heartbeat"` exige
papel `viewer`; `scope: "terminal"` exige `developer` — o mesmo papel mínimo
de `MIN_ROLE_FOR_ACTION_TYPE.terminal` em `domain/actions/decide.ts` (hoje
nenhum caminho pede `terminal` de verdade; o valor nasce certo para a FASE 25,
o terminal interativo). A api persiste só o HASH (SHA-256 **puro**, não
`hashDeToken`/HMAC — o engine não tem o pepper da api, e um token de 256 bits
de CSPRNG não precisa de pepper contra dicionário, mesmo raciocínio que o
próprio `hashDeToken` já registra), nunca o token bruto.

O consumo é do ENGINE, que lê `session_socket_tickets` direto (mesmo padrão de
`Engine.Outbox.Event` sobre `outbox_events` — nunca changeset/insert, só a
escrita estreita que o uso único exige) em DUAS etapas:
`SocketTicket.validar/1` (peek, sem marcar nada — chamado por `connect/3`,
que ainda não sabe qual `session_id` vai ser pedido) e
`SocketTicket.consumir/2` (`UPDATE` condicional exigindo o `session_id` do
tópico bater com o da linha — chamado por `SessionChannel.join/3`, que
também confere o `project_id` do ticket contra o da sessão, defesa em
profundidade contra ticket de um projeto abrindo canal de outro). Sem ticket,
ou com um inválido: a conexão inteira é recusada (`{:error, %{reason:
"unauthorized"}}`), não só o join do canal.

O web (`session-channel.ts`) busca um ticket NOVO antes de TODA
`socket.connect()` — inclusive em reconexão automática, que existe. O
reconnect nativo do `Phoenix.Socket` reusaria o mesmo `params` da construção
(o ticket velho, já expirado ou consumido), então ele é neutralizado
(`reconnectAfterMs` que praticamente nunca dispara) e a reconexão passa a ser
inteiramente manual, com busca de ticket fresco a cada tentativa.

- **Onde:** `apps/api/src/db/schema.ts` (`sessionSocketTickets`),
  `apps/api/src/domain/sessions/socket-ticket-scope.ts`,
  `apps/api/src/application/use-cases/sessions/create-socket-ticket.use-case.ts`,
  `apps/api/src/interfaces/http/sessions/sessions.controller.ts` (rota
  `socket-ticket`), `apps/engine/lib/engine/sessions/socket_ticket.ex`,
  `apps/engine/lib/engine_web/channels/session_socket.ex`,
  `apps/engine/lib/engine_web/channels/session_channel.ex`,
  `apps/web/src/lib/session-channel.ts`
- **Teste:**
  `apps/api/test/application/use-cases/sessions/create-socket-ticket.use-case.spec.ts`,
  `apps/api/test/domain/sessions/socket-ticket-scope.spec.ts`,
  `apps/api/test/infrastructure/persistence/session-socket-ticket.repository.spec.ts`,
  `apps/engine/test/engine/sessions/socket_ticket_test.exs` (reuso falha,
  session_id errado falha, corrida concorrente só um vence),
  `apps/engine/test/engine_web/channels/session_socket_test.exs` (sem ticket
  a conexão é recusada),
  `apps/engine/test/engine_web/channels/session_channel_test.exs` (ticket de
  outro projeto: join falha), `apps/web/src/lib/session-channel.test.ts`
- **Borda:** o ticket NÃO é o JWT reaproveitado — TTL curto, uso único, escopo
  fechado, e nasce de uma rota própria que já checa papel efetivo, não de
  decodificar o access token existente.
- **Origem:** sem ADR — extração/hardening pontual, não mudança estrutural.

### RN-109 — O nome de pasta do workspace é congelado na criação, e projeto antigo mantém o UUID {#rn-109}

A pasta física de um projeto em `PROJECT_WORKSPACES_ROOT` era o UUID puro —
ilegível ao abrir no disco. `projects.workspace_dir_name` (NOT NULL, UNIQUE)
passou a guardar o nome de verdade: `<slug>-<8 chars do id>` para projeto
NOVO (`workspaceDirNameFor` em
`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`), gerado
em código — o id nasce de `crypto.randomUUID()` no
`CreateProjectUseCase`, não do `defaultRandom()` do Postgres, porque o nome
da pasta precisa do id ANTES do insert. Os 8 caracteres seguem a mesma
convenção do rótulo de sessão (`apps/web/src/lib/session-label.ts`).

O nome é CONGELADO no momento da criação e nunca recalculado: `UpdateProjectUseCase`
permite editar o `slug` depois, e isso NÃO toca `workspace_dir_name` — reservar a
pasta física, com working tree e worktrees de agente possivelmente abertos, é
risco real que a decisão evita por construção, não por disciplina de quem
chama.

Projeto criado ANTES desta migração (0042) manteve a pasta física que já
tinha: o backfill grava `workspace_dir_name = id` para toda linha existente —
o mesmo valor que já era verdade no disco — e NUNCA renomeia diretório
nenhum. Um trigger `BEFORE INSERT` (`projects_workspace_dir_name_default_trg`)
aplica o MESMO fallback (`id::text`) para qualquer insert que chegue sem o
campo — rede de segurança para quem esquecer de gravá-lo (nunca o caminho
principal, que sempre grava explícito), e o que mantém as dezenas de
fixtures de teste existentes, que não conhecem este conceito, funcionando
sem precisar reescrever cada uma.

A derivação de caminho a partir do nome (`projectScopeRoot`, RN-092/RN-075)
passou a receber `workspace_dir_name` em vez do `projectId` cru — mesma
validação de charset, mesma pureza. O engine lê a MESMA coluna
(`Engine.Projects.Project.workspace_dir_name/1`) para resolver
`Engine.Actions.Workspace.workspace_dir/1`, nunca recomputando o nome a
partir do id: as duas derivações (api e engine) são, na prática, a mesma
leitura contra o mesmo banco — é o que garante que RN-075 (escopo de
terminal) e RN-092 (leitura de código) continuam apontando para a MESMA
pasta que o engine realmente usa.

- **Onde:** `apps/api/src/db/schema.ts` (`projects.workspaceDirName`),
  `apps/api/src/db/migrations/0042_tough_captain_midlands.sql`,
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`workspaceDirNameFor`, `projectScopeRoot`),
  `apps/api/src/application/use-cases/iam/create-project.use-case.ts`,
  `apps/engine/lib/engine/projects/project.ex`
  (`workspace_dir_name/1`, `all_workspace_dirs/0`),
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/1,2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex`
- **Teste:**
  `apps/api/test/db/workspace-dir-name-migration.spec.ts` (trigger, backfill
  equivalente, unicidade),
  `apps/api/test/application/use-cases/iam/create-project-semeia-areas.spec.ts`
  (`workspaceDirName` nasce `<slug>-<8 chars>`, dois projetos com o mesmo
  slug em workspaces diferentes não colidem de pasta),
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Borda:** o teto de paralelismo e o gate de merge não mudam — RN-109 é só
  NOME de pasta, nunca política. Renomear o slug depois da criação não
  renomeia a pasta; a pasta só se lê pelo `workspace_dir_name` gravado.
- **Origem:** ADR 0066 (revisa o ADR 0055).

### RN-129 — O ToolLoop nunca grava `agent.response` vazio; falha de transporte vira `agent.error` durável {#rn-129}

A [RN-059](#rn-059) fechou o balão vazio para os quatro agentes
conversacionais, mas eles não passam pelo `Engine.Harness.ToolLoop` — cada um
chama `EngineApiClient.llm_turn_stream/6` no próprio módulo. O `ToolLoop`
(usado por dev agents, QA Automação/Performance-Segurança, Infra-Workflows,
Anamnese e Psicólogo) tinha o MESMO defeito num caminho diferente: emitia
`agent.response` a cada iteração, mesmo quando o modelo só chamou ferramenta
sem texto, ou terminou o turno sem produzir nada — e a falha de transporte
(provider fora do ar, timeout) virava `agent.response` com `content` ausente,
igualmente indistinguível de sucesso.

Achado ao vivo numa sessão de execução real (dev agents): duas bolhas com o
texto de compatibilidade da RN-059 ("resposta vazia — evento anterior...")
apareceram numa sessão criada minutos antes — não eram eventos antigos, eram
o mesmo defeito acontecendo de novo, só que na aba de execução.

Duas correções, no ponto ESTRUTURAL comum a todo consumidor do `ToolLoop`,
não módulo por módulo:

1. **Conteúdo vazio nunca vira `agent.response`.** Iteração que só chamou
   ferramenta já está narrada por `tool.call`/`tool.result`; iteração que não
   produziu nada (nem texto, nem tool call) deixa o desfecho para quem chamou
   o loop decidir — `ctx.last_error`/`{:ok, ctx}` carregam a informação, e
   quem consome (ex.: `DevAgentServer.handle_outcome/4`) já grava o evento
   durável do PRÓPRIO domínio (`dev.blocked`, com `origem`).
2. **Falha de transporte vira `agent.error` durável**, com `origem`
   (`Engine.Agents.FalhaDeTurno.origem/1` — o MESMO helper que os quatro
   agentes conversacionais usam, sem duplicar classificação) e `mensagem` em
   português — nunca mais `agent.response` sem `content`.

- **Onde:** `apps/engine/lib/engine/harness/tool_loop.ex` (`loop/1`,
  `emit_falha/2`)
- **Teste:** `apps/engine/test/engine/harness/tool_loop_test.exs`
  ("iteração só com tool call (sem texto) não grava agent.response vazio",
  "modelo termina o turno sem texto e sem tool call...", "falha de
  transporte... grava agent.error durável com origem")
- **Origem:** RN-059 (regra que esta estende) — achado ao vivo numa sessão de
  execução real com dev agents

### RN-139 — A aba Executores lê a sessão de execução VIGENTE, nunca a mais recente do projeto {#rn-139}

`ProjectExecutorsTab` buscava os eventos de dev agent/QA pela sessão que
`useLatestSession` devolvia — a de `createdAt` mais recente do projeto, sem
filtrar por `kind` nem exigir `execution.activated`. Funcionava só por
**coincidência**: a sessão de execução costuma ser a mais nova. Assim que
qualquer sessão nasce depois dela — uma ideação nova, um chat consultivo — a
aba passa a olhar essa sessão nova, vazia de eventos de execução, em
silêncio: nenhuma pista na tela dizia qual sessão estava sendo exibida.

A leitura correta já existia no backend: `findActiveExecutionSession`
(`SessionRepository`) — a sessão `active` mais recente que carrega
`execution.activated` — mas só era usada internamente por
`ActivateExecutionUseCase` para decidir se reativa ou cria. A correção expõe
o MESMO critério por HTTP, em vez de duplicá-lo no front:

- **`GET /projects/:projectId/execution/session`** (`role:viewer`) devolve a
  sessão vigente ou `null` — nunca infere pela mais recente;
- `ProjectExecutorsTab` troca `useLatestSession` por `useActiveExecutionSession`
  (novo hook sobre a rota acima) como fonte da sessão que a aba inteira lê;
- o cabeçalho da aba sempre mostra QUAL sessão está sendo exibida — o rótulo
  dela (hashtag + nome) linkando para `SessionPage`, ou "Nenhuma execução
  ativa" quando `null` — nunca mais implícito. Os três estados da
  [RN-088](#rn-088) se aplicam à própria busca da sessão: carregando, erro
  (com `trace_id`) e vazio (`null`) são três renders distintos, nunca um
  `if (!sessão) return null` que os colapsa.

- **Onde:**
  `apps/api/src/application/use-cases/execution/get-active-execution-session.use-case.ts`,
  `apps/api/src/interfaces/http/execution/execution.controller.ts` (`getSession`),
  `apps/web/src/lib/hooks.ts` (`useActiveExecutionSession`),
  `apps/web/src/routes/ProjectExecutorsTab.tsx`
- **Teste:**
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx` — mostra a sessão de
  execução mesmo com sessão mais recente existindo no projeto, estado
  "nenhuma execução ativa" explícito, e erro de rede tratado (não em branco)
- **Origem:** achado de investigação de código + teste ao vivo — a mesma
  classe de defeito que a RN-088 fechou para 429, agora para "qual sessão a
  tela está olhando"

### RN-141 — O conteúdo lido por `read_file` também tem teto de bytes {#rn-141}

A [RN-074](#rn-074) travou a saída do **terminal** contra
`{413, "request entity too large"}`, mas deixou aberta a mesma porta pelo
`read_file`: ele lia o arquivo INTEIRO, sem teto, e esse conteúdo entrava no
histórico do laço e viajava em todo turno seguinte. Um PR com arquivo grande
(lockfile, bundle, arquivo gerado) bastava pra travar dev agents E o QA de
Performance/Segurança — que só tem `ReadFile`/`SearchWorkspace` (sem
`Terminal`, de propósito) pra investigar uma PR, então não tinha rota de
escape nenhuma quando o arquivo era grande demais.

O conteúdo é cortado em `READ_FILE_MAX_BYTES` (default 32 KiB, mesmo valor da
RN-074 por coincidência de contexto, não por acoplamento — as duas variáveis
são independentes) antes de virar resultado da ferramenta, com marca dizendo
o arquivo e os dois tamanhos:

```
[arquivo package-lock.json truncado: mostrando 32768 de 1048576 bytes. Use
search_workspace para localizar um trecho específico em vez de reler o
arquivo inteiro.]
```

Mesmas três propriedades da RN-074 (teto é `>` não `>=`; corte não parte
caractere multibyte; a marca é endereçada ao modelo, dizendo o que fazer). A
truncagem mora na FERRAMENTA (`Engine.Harness.Tools.ReadFile`), não em
`Engine.Harness.WorkspaceFiles.read_file/2` — essa é a base genérica de
acesso a arquivo, compartilhada por `write_file`/`search_workspace`, e
truncar ali cortaria conteúdo de quem não precisa desse teto.

`search_workspace` não teve o mesmo tratamento: ele devolve só os PATHS que
bateram (`matched_content` é booleano), nunca o conteúdo do arquivo — o vetor
de estouro que motivou esta RN não se aplica a ele.

- **Onde:** `apps/engine/lib/engine/harness/tools/read_file.ex`
  (`truncate/2`), teto em `apps/engine/config/runtime.exs`
  (`read_file_max_bytes`)
- **Teste:** `apps/engine/test/engine/harness/tools/read_file_test.exs`
  (describe `teto de bytes do conteúdo`)
- **Origem:** achado ao vivo no event log de uma execução real — os 4 dev
  agents de um projeto e os QA de Automação/Performance-Segurança bloqueados
  com `{413, "request entity too large"}`, mesma causa raiz da RN-074, porta
  diferente

### RN-144 — A aba Criativo não lista a sessão de execução vigente {#rn-144}

A sessão que recebe `execution.activated` e os eventos de tool-call dos dev
agents precisa nascer com `kind: 'criativa'` — regra estrutural (RN-097,
`garantirQuePodeAtivarExecucao`), sem isso o evento é recusado. Como
`ProjectSessionsTab` (a aba Criativo, RN-104) lista sessões filtrando só por
`session.kind === 'criativa'`, a sessão de execução aparecia MISTURADA na
lista ao lado de ideações de verdade — abrir ela em `SessionPage.tsx` mostra
uma timeline inteira de tool-calls de dev agent, parecendo (pro usuário) "o
dev escrevendo no chat do Criativo". Confirmado ao vivo: uma sessão real com
35+ eventos de dev agent aparecia normal na lista, ao lado de sessões reais
de ideação.

A correção reusa o sinal que a [RN-139](#rn-139) já expõe —
`useActiveExecutionSession`/`GET /projects/:projectId/execution/session` — em
vez de o backend calcular um campo novo por sessão (`hasExecutionActivated`
ou equivalente). A aba Criativo busca a sessão vigente e a exclui da lista
renderizada:

- a busca só roda na aba Criativo (`enabled` desligado em `kind !==
  'criativa'`) — a aba Chat nunca fez essa chamada e continua sem fazer;
- o filtro é por `id`, depois do filtro por `kind` já existente — não muda o
  que a lista É, só o que ela EXCLUI.

**Decisão deliberada de escopo:** isto cobre só a execução VIGENTE, não
execuções ANTIGAS já encerradas (`execution.activated` gravado numa sessão
que hoje está `closed`). Calcular isso pediria o backend anotar, por sessão,
se ela tem o evento gravado — mudança no repositório e no endpoint de
listagem, para um caso residual: uma sessão de execução ANTIGA aparece com o
badge `closed`, o que já sinaliza "não é uma ideação ativa" de um jeito bem
menos ambíguo do que a vigente (que aparecia `active`, indistinguível de uma
ideação em andamento). Se isso voltar a confundir na prática, a saída é o
endpoint de listagem devolver o sinal por sessão — não um `filter` a mais no
front por sessão antiga.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`ProjectSessionsTab`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — a vigente
  some da lista Criativo com sessões normais ao lado, a aba Chat não chama a
  busca de execução vigente, e sem execução vigente (`null`) a lista aparece
  inteira
- **Origem:** achado de investigação de código + teste ao vivo — sessão real
  com execução ativa aparecendo misturada na aba Criativo

### RN-145 — O Arquiteto também tem um botão de prontidão, e a MESMA confirmação oferece Infra e Dev Lead {#rn-145}

`OfferInfraHandoffUseCase` (`POST .../agents/arquiteto/handoff-infra`) já
existia desde a Fase 4a — grava `architecture.readiness_confirmed` e chama o
engine, que oferece o handoff ao Infra e, na MESMA confirmação, ao Dev Lead
(FASE 14d/ADR 0053). O que faltava era o jeito de chegar até ele: nenhum
lugar do frontend chamava o endpoint. O botão "Confirmar arquitetura pronta"
existe pro Criativo desde sempre ("Estou pronto para produzir",
[RN-131](#rn-131)/[RN-142](#rn-142)) — o Arquiteto não tinha equivalente
nenhum, e sem o clique o handoff nunca nascia: a correção de prioridade do
card no fio ([RN-125](#rn-125)) ficava sem efeito prático, porque não havia o
que mostrar.

`arquitetoActive` espelha `criativoActive` (existe um `agent.activated` pro
Arquiteto nesta sessão) e `arquiteturaJaDeclarada` espelha
`prontidaoJaDeclarada` (existe QUALQUER handoff saindo do Arquiteto — a prova
de que a confirmação já aconteceu, já que `OfferInfraHandoffUseCase` cria
pelo menos o de Infra na mesma chamada). O botão aparece no composer só
quando o primeiro é verdadeiro e o segundo não é — some depois do clique
pelo mesmo motivo que o do Criativo some depois da prontidão.

Ao contrário do Criativo, o Arquiteto NÃO tem guardrail de servidor
bloqueando a confirmação sem `module_map` — `ArquitetoServer.offer_infra_handoff`
não recusa nada, diferente de `CriativoServer.confirm_readiness`
([RN-142](#rn-142)). O botão só desabilita durante `streaming`; não replicar
aqui o `disabled={!hasModuleMap}` da Visão Geral é decisão deliberada, pelo
mesmo raciocínio que já vale para "Ativar execução" no card do Dev Lead
([RN-137](#rn-137)) — quando este card existe, o Arquiteto já decidiu a
arquitetura.

- **Onde:** `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`handoffInfra`, rota preexistente), `apps/web/src/lib/api-client.ts`
  (`confirmArchitectureReadiness`), `apps/web/src/routes/SessionPage.tsx`
  (`arquitetoActive`, `arquiteturaJaDeclarada`, `handleArchitectureReadiness`,
  botão "Confirmar arquitetura pronta")
- **Teste:**
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 1" — botão ausente sem o Arquiteto ativo, caminho feliz chama o
  endpoint dedicado, falha mostra toast de erro, e o botão some com a
  arquitetura já declarada
- **Origem:** investigação de código — o endpoint e a lógica do engine
  existiam desde a Fase 4a/14d sem NENHUM caminho de UI até eles

### RN-146 — `agent.response` carrega o nome do modelo que gerou a resposta {#rn-146}

O nome do modelo só existia em `token_usage`, sem vínculo com o evento
`agent.response` específico que ele produziu — `SessionPage.tsx` mostrava a
string FIXA `"modelo"` ao lado do nome do agente, nunca o nome real.

A mudança atravessa as três camadas, todas com o MESMO nome de campo
(`modelName`), para que não seja preciso traduzir entre elas:

1. **api** — `StreamLlmTurnUseCase`/`RunLlmTurnUseCase` já resolviam o
   modelo (`resolveModelBinding` → `models.findById`) para chamar o
   provider; o frame `final`/`RunLlmTurnResult` ganham `modelName: string |
   null`. `null` só quando o turno falhou ANTES de resolver um modelo (sem
   binding, ou binding para modelo inexistente) — nos demais casos,
   inclusive orçamento excedido, o binding já tinha resolvido e o nome
   viaja mesmo no frame de erro.
2. **engine** — os quatro agentes conversacionais (`criativo_server.ex`,
   `po_server.ex`, `arquiteto_server.ex`, `dev_lead_server.ex`) extraem
   `Map.get(frame, "modelName")` do frame `final` e o incluem no payload de
   `emit_response`/`agent.response` (`%{content: content, modelName:
   model_name}`).
3. **web** — `SessionPage.tsx` lê `event.payload.modelName`. Evento
   GRAVADO antes desta mudança não tem a chave (`undefined`), e um turno
   cuja api não resolveu modelo nenhum grava `null` — os dois degradam para
   o rótulo genérico `"modelo"`, nunca para `undefined`/`null` na tela; o
   mesmo padrão que `text === ''` já usa para resposta anterior à RN-059.

- **Onde:** `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`
  (`LlmTurnStreamEvent`), `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
  (`RunLlmTurnResult`), `apps/api/src/interfaces/http/internal/dto/internal.response.dto.ts`
  (`LlmTurnResponseDto`/`LlmTurnStreamEventResponseDto`),
  `apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  (`emit_response/3`), `apps/web/src/routes/SessionPage.tsx` (bloco
  `agent.response` da timeline)
- **Teste:** `apps/api/test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `apps/api/test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`
  (`modelName` no caminho feliz, no erro do provider e sem binding),
  `apps/engine/test/engine/agents/{criativo,po,arquiteto,dev_lead}_server_test.exs`
  (`agent.response` carrega o nome do modelo; borda do frame sem a chave),
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 2" — nome real, evento antigo sem a chave, `modelName: null`
- **Origem:** investigação de código — confirmado que o dado já existia em
  `token_usage`, mas nunca chegava ao payload do evento

### RN-147 — O cabeçalho do grupo colapsado mostra o ícone do agente, não só o nome {#rn-147}

O `Disclosure` de `timelineAgrupada` ([RN-138](#rn-138)) recebia só a STRING
do nome em `titulo` — cada mensagem expandida já tem um avatar (`.avatar` +
ícone), e o cabeçalho colapsado perdia essa pista visual justamente onde ela
mais ajuda a escanear o fio.

`AvatarDoAgente` reusa a MESMA caixa `.avatar` das mensagens expandidas, mas
o ícone escolhido é o do ROSTER (`AGENTS[id].icon`) — a mesma fonte que já
identifica "quem está falando" no indicador de streaming (`agenteExibido.icon`,
[RN-131](#rn-131)) — e não o ícone por TIPO de evento que cada entrada
expandida usa (`ModelIcon` em `agent.response`, `StackIcon` em
`backlog.*_created`, `AlertCircleIcon` em `agent.error`). Um grupo colapsado
pode misturar esses tipos de entrada de um mesmo agente; o cabeçalho
representa o AGENTE, não a última entrada dele, e só o ícone do roster é
estável para isso. Sem `id`, ou agente fora do roster, degrada para
`ModelIcon` — nunca para uma caixa vazia.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`AvatarDoAgente`,
  `timelineAgrupada`), `apps/web/src/routes/SessionPage.module.css`
  (`.agentGroupTitulo`)
- **Teste:** `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  describe "problema 3" — o cabeçalho colapsado tem o PATH do ícone do PO
  (`UserIcon`), não só um SVG decorativo genérico
- **Origem:** investigação de código — `Disclosure` já aceitava `ReactNode`
  em `titulo`; faltava passar o avatar junto do nome

### RN-148 — Histórias com promoção pendente ao mesmo tempo viram carrossel, não N cards {#rn-148}

O PO cria histórias uma a uma, e cada `backlog.story_promotion_proposed`
([RN-126](#rn-126)) virava um card avulso na timeline — numa leva de várias
histórias, isso empilhava N cards idênticos disputando o mesmo espaço,
misturados com o resto da narração.

Uma **leva** é o conjunto de propostas de promoção AINDA PENDENTES na
sessão, avaliado a cada render — não "criadas em sequência sem
interrupção". O critério é o MESMO que cada card avulso já usava sozinho
para decidir se virou card acionável ou divisor (nenhum
`backlog.story_transitioned`/`backlog.story_promotion_returned` posterior
com o mesmo `storyId`), só que olhado de uma vez para a sessão inteira:

- **0 ou 1 pendente:** nada muda — card avulso de sempre (a degradação é
  deliberada: um carrossel de um slide só não ganha nada virando carrossel).
- **2+ pendentes ao mesmo tempo:** viram UM `Carousel` (novo no design
  system, `apps/web/src/components/ui/Carousel.tsx`), inserido na posição
  da PRIMEIRA proposta ainda pendente; as demais somem como card
  individual — cada uma vira um SLIDE dele. Cada slide mostra a mesma
  frase do card avulso ("história … pronta, aguardando sua promoção"), um
  resumo/RF se o payload trouxer (hoje não traz — ver abaixo), e os botões
  Promover/Devolver daquela história específica, chamando os MESMOS
  `promoteStories`/`returnStory` de sempre.
- **"Aprovar todas"** no cabeçalho do carrossel chama `promoteStories` com
  os ids de TODAS as pendentes numa chamada só — o endpoint já era lote
  (`promoteStories(projectId, storyIds[])`, RN-048), então não houve mudança
  de contrato nenhuma, só de quem monta a lista.
- Uma história resolvida (promovida ou devolvida) enquanto o carrossel está
  aberto sai da leva no próximo render (a query de eventos é invalidada nas
  duas ações) — se sobrar só 1 pendente, o carrossel se desfaz sozinho e o
  card volta a ser avulso.

`resumo`/RF no slide é campo PRONTO, não usado: `CreateStoryUseCase` hoje só
grava `storyId`/`epicId`/`title` no payload de `backlog.story_promotion_proposed`
— sem descrição nem requisitos funcionais. O slide já sabe exibir
`description`/`rf` se o payload um dia carregar (degrada pro título sozinho
até lá); estender o payload ficou fora desta entrega, por não ter sido
pedido.

- **Onde:** `apps/web/src/components/ui/Carousel.tsx` (componente novo,
  navegação genérica), `apps/web/src/routes/SessionPage.tsx`
  (`promocoesPendentes`, `ehLevaDeHistorias`, `StorySlide`,
  `handlePromoteAll`), `apps/web/src/routes/SessionPage.module.css`
  (`.storySlide`)
- **Teste:** `apps/web/src/components/ui/Carousel.test.tsx` (navegação,
  ARIA, só o slide atual montado, índice clampado quando a lista encolhe),
  `apps/web/src/routes/SessionPage.carrossel-historias.test.tsx` (3+
  pendentes viram carrossel; "Aprovar todas" manda o lote inteiro; promoção
  e devolução unitárias continuam funcionando a partir de um slide
  navegado; 1 pendente degrada pro card simples; história resolvida sai da
  leva e o carrossel recalcula a contagem)
- **Origem:** pedido do usuário — histórias produzidas em lote pelo PO
  ficavam difíceis de decidir uma por uma no fio

### RN-149 — O Container level do diagrama C4 é derivado do module_map, nunca redigitado pelo modelo {#rn-149}

`create_c4_diagram` (ferramenta nova do Arquiteto) gera as duas sintaxes
Mermaid do diagrama C4 (Context + Container, modelo de Simon Brown). O tool
call carrega só `system_name`/`system_description`/`actors` — os módulos e
as dependências do nível Container NÃO fazem parte da entrada: o caso de uso
busca o `module_map` VIGENTE do projeto (`ModuleMapRepository.findCurrent`,
mesma leitura de `GetArchitectureUseCase`) e deriva o Container level dele,
com os MESMOS nomes e dependências que `create_module_map` já validou sem
ciclo.

A alternativa óbvia — deixar o modelo descrever os módulos de novo no tool
call do diagrama, como ele já faz para `create_module_map` — foi descartada
de propósito: um segundo lugar onde o modelo escreve "os módulos são X, Y,
Z" é um segundo lugar onde essa lista pode divergir da primeira, e a
divergência seria SILENCIOSA — nada recusaria um diagrama com um módulo que
não existe mais no mapa real. Derivar do repositório fecha essa divergência
por construção: o diagrama pode ficar DESATUALIZADO se o `module_map` mudar
depois (reemitir é gerar de novo, sem trava — ver ADR 0068), mas nunca
MENTE sobre o que existia no momento em que foi gerado.

Sem `module_map` vigente, `create_c4_diagram` é recusado com 400 — não há
Container level sem módulos para desenhar, e a mensagem de erro instrui o
Arquiteto a chamar `create_module_map` primeiro (RN-061: a recusa volta
pelo tool-result, com o motivo inteiro).

O artefato `artifact.c4_diagram` é versionado no event log sem tabela
própria — mesmo desenho de `artifact.project_image` (ADR 0065): o vigente é
o de maior `version`, e revisar é gerar de novo, nunca sobrescrever.

- **Onde:** `apps/api/src/domain/architecture/c4-diagram.ts`
  (`gerarDiagramaContexto`/`gerarDiagramaContainer`, puras),
  `apps/api/src/application/use-cases/architecture/create-c4-diagram.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/get-c4-diagram.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_c4_diagram.ex`,
  `apps/web/src/components/C4DiagramView.tsx` (renderização, três estados —
  RN-088), `apps/web/src/lib/mermaid-render.ts` (o `mermaid` fica isolado
  aqui, `import()` dinâmico)
- **Teste:** `apps/api/test/domain/architecture/c4-diagram.spec.ts` (sintaxe
  Mermaid válida a partir de um `module_map` de exemplo, aresta pendurada
  ignorada, ids deduplicados),
  `apps/api/test/application/use-cases/architecture/create-c4-diagram.use-case.spec.ts`
  (sem module_map recusa com 400 e não grava nada; Container reflete os
  módulos/dependências reais; versiona ao reemitir),
  `apps/engine/test/engine/harness/tools/create_c4_diagram_test.exs`,
  `apps/web/src/components/C4DiagramView.test.tsx` (sucesso vira SVG, erro
  de sintaxe vira Alert legível sem quebrar a tela, diagrama vazio não tenta
  renderizar)
- **Origem:** pedido do usuário — diagrama C4 do Arquiteto na Visão Geral do
  projeto (ADR 0068)

### RN-150 — `search_workspace` tem teto de QUANTIDADE de hits e de BYTES, cada um com sua marca {#rn-150}

Achado numa revisão de PR: `search_workspace` (dev agents e os dois agentes
de QA/gate, `qa_tools.ex` e `qa_performance_seguranca_agent.ex` — este
último só tem `read_file`/`search_workspace`, sem `Terminal`, de propósito)
devolvia TODOS os resultados da busca, sem teto nenhum — mesma classe do
achado S (`Engine.Actions.TerminalExecutor.truncate/2`) e da correção de
`read_file` (`Engine.Harness.Tools.ReadFile.truncate/2`): o resultado fica
no histórico do laço e viaja em todo turno seguinte, e uma árvore grande
basta pra estourar `{413, "request entity too large"}` do provider.

Dois tetos independentes, porque a busca estoura de duas formas diferentes:

1. **Quantidade de hits** — uma árvore com milhares de arquivos batendo o
   termo produz milhares de linhas `- caminho` mesmo que nenhum arquivo
   individual seja grande. Truncar só por BYTES no fim ainda pagaria o custo
   de escanear e ler o conteúdo de cada um desses arquivos antes de montar a
   string. Por isso o teto de quantidade (`SEARCH_WORKSPACE_MAX_HITS`,
   default 500) vive em `WorkspaceFiles.search/3`, que já PARA de consumir a
   busca assim que encontra hit suficiente — o pipeline roda sobre um
   `Stream`, e `Enum.take(stream, max_hits + 1)` só lê da fonte o que
   precisa pra produzir os `max_hits + 1` primeiros resultados. O "+1" é o
   que permite dizer que HAVIA mais sem continuar escaneando o resto pra
   contar o total exato — contar o total pagaria de novo o I/O que o teto
   existe pra evitar, então a marca diz "mostrando os N primeiros" e nunca
   inventa um total.
2. **Bytes do texto final** — mesmo com hits limitados, caminhos muito
   longos podem produzir uma string grande. Teto de bytes
   (`SEARCH_WORKSPACE_MAX_BYTES`, default 32.768), mesmo padrão de
   `terminal_output_max_bytes`/`read_file_max_bytes` — variável PRÓPRIA,
   não reaproveita as outras duas: mesma classe de estouro, divergir uma não
   deve exigir tocar as outras.

A marca de truncagem é dirigida ao MODELO, não ao humano: diz o que foi
cortado (hits e/ou bytes) e instrui a refinar o termo da busca — mesmo
espírito das marcas de `TerminalExecutor`/`ReadFile`.

- **Onde:** `apps/engine/lib/engine/harness/workspace_files.ex`
  (`search/3`, `take_capped/2`),
  `apps/engine/lib/engine/harness/tools/search_workspace.ex`
  (`truncate/3`, `marca_de_truncagem/5`),
  `apps/engine/config/runtime.exs` (`search_workspace_max_hits`,
  `search_workspace_max_bytes`)
- **Teste:** `apps/engine/test/engine/harness/workspace_files_test.exs`
  (`search/3` com `max_hits` corta a QUANTIDADE e marca truncagem só
  quando há mais que o teto),
  `apps/engine/test/engine/harness/search_workspace_test.exs` (busca com
  poucos resultados não é alterada; busca com mais hits que o teto é
  truncada com aviso claro; texto final maior que o teto de bytes também é
  cortado)
- **Origem:** achado de revisão de PR — segunda causa real do 413 em
  revisões, depois da correção de `read_file`

---

### RN-151 — O badge de projeto na sidebar é aprovações pendentes, não atividade não lida {#rn-151}

O número ao lado do nome de cada projeto em `Shell.tsx` vinha de
`useProjectsUnread` — `latestSeq` (o `seq` mais recente já gravado na sessão)
menos o cursor de "última vez visto" que o navegador guarda em
`read-state.ts`. Isso conta QUALQUER evento novo — `tool.call`,
`agent.response`, chat — não só decisão pendente. Um projeto de teste
mostrava "392" na sidebar (atividade acumulada de uma execução real) enquanto
a aba Aprovações do MESMO projeto mostrava "8" (a contagem de verdade). Um
número que não corresponde a nada acionável ao clicar é pior que nenhum.

O read model do dashboard (`ProjectsSummaryRepository.summarizeForWorkspace`,
RN-090) ganhou `pendingApprovalsCount`: `COUNT(*)` de `proposed_actions` com
`status = 'pending'`, agregado por `project_id` numa consulta a mais no
`Promise.all` já existente — mesmo formato de `storiesAwaitingPromotion`
(RN-048), sem crescer o número de idas ao banco por projeto. A soma é do
projeto INTEIRO, todas as sessões — de propósito diferente da aba Aprovações
(`ProjectApprovalsTab.tsx`), que mostra só as pendências da sessão MAIS
RECENTE: o badge é por PROJETO, não por sessão, e uma pendência numa sessão
antiga continua sendo uma pendência.

`Shell.tsx` parou de importar `useProjectsUnread` — o único consumidor dele
ali era este badge. `Dashboard.tsx`/`ProjectCard.tsx` ganharam o mesmo fio:
o prop `unreadCount` de `ProjectCard` nunca tinha chamador (`ProjectCardContainer`
não o passava), e virou `pendingApprovalsCount` com o mesmo valor da sidebar
— duas telas, um número, uma fonte.

- **Onde:** `apps/api/src/application/ports/projects-summary-repository.port.ts`
  (`ProjectCardSummary.pendingApprovalsCount`),
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (`summarizeForWorkspace`, consulta agregada sobre `proposed_actions`),
  `apps/web/src/routes/Shell.tsx`, `apps/web/src/routes/Dashboard.tsx`,
  `apps/web/src/components/ProjectCard.tsx`
- **Teste:**
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (`pendingApprovalsCount soma o projeto INTEIRO...`, só `pending` conta, não
  vaza entre projetos, número de consultas continua constante),
  `apps/web/src/routes/Shell.test.tsx` (badge de aprovações pendentes)
- **Origem:** achado do usuário navegando a app — badge da sidebar mostrando
  "392" contra "8" de verdade na aba Aprovações do mesmo projeto

---

### RN-152 — A branch de uma task diz de qual dev agent e módulo ela é, no dropdown da aba Code {#rn-152}

`CodeBranchPicker` já listava toda branch do repositório, inclusive as dos
dev agents (`feature/task-XXXXXXXX`, `Engine.Dev.AgentIo`), mas sem pista
nenhuma de quem a criou — só o nome cru. `ReadProjectCodeUseCase.branches`
resolve isso sem chamada a mais ao provider de git: os 8 chars depois de
`feature/task-` são exatamente o primeiro grupo hifenizado do uuid da task
(`"feature/task-" <> String.slice(to_string(row.task_id), 0, 8)`, não um
substring arbitrário), então casam contra `TaskRepository
.findByProjectAndIdPrefix` (join por PROJETO, pra prefixo de 8 chars nunca
vazar task de outro projeto). O `assignedTo` da task é o agent_id
(`dev-<modulo>`/`dev-<modulo>-2`, RN-087); o módulo é resolvido comparando
contra o `module_map` VIGENTE do projeto pelas MESMAS funções que o geraram
(`devAgentId`/`extraDevAgentId` em `activate-execution.use-case.ts`) — nunca
por regex reversa, que degeneraria em ambiguidade pra nome de módulo com
caractere especial.

`producedBy: { agentId, moduleId } | null` é degradação honesta, do mesmo
jeito que `ahead`/`behind` já são: `null` pra branch sem o padrão (manual do
usuário, ou `main`/`dev`/`qa`), e também quando o padrão bate mas a
task/módulo não são mais resolvíveis (task apagada, módulo removido do mapa
vigente) — nunca um valor inventado. No dropdown, cada branch produzida por
um dev ganha o ícone e a cor do agente (`AGENTS`/`agents.ts`, RN-087),
reaproveitando a MESMA degradação que `apps/web/src/lib/agent-status.ts` já
usa pro roster ao vivo: módulo sem chave fixa em `AGENTS` herda ícone/cor de
`dev-backend`.

- **Onde:** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`branches`/`producedBy`/`moduloDoAgente`),
  `apps/api/src/application/ports/backlog-repository.port.ts`
  (`TaskRepository.findByProjectAndIdPrefix`),
  `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts`,
  `apps/api/src/interfaces/http/git/dto/code.response.dto.ts`
  (`CodeBranchProducedByResponseDto`), `apps/web/src/lib/api-types.ts`
  (`CodeBranchProducedBy`), `apps/web/src/routes/code/CodeBranchPicker.tsx`
  (`IconeDoAgenteProdutor`/`defDoAgenteProdutor`)
- **Teste:**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (describe "producedBy da branch de task" — task resolvida com módulo e com
  o agente extra `-2`, branch fora do padrão nunca ganha `producedBy` mesmo
  com task de prefixo casável, prefixo sem task no projeto, módulo removido
  do mapa vigente e task sem dono ainda degradam pra `null`),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx` (branch de task mostra
  o selo do dev agent dono; branch sem padrão não ganha selo nenhum)
- **Origem:** pedido do usuário — nenhuma pista visual de quem criou a
  branch no dropdown rico da FASE 26b

### RN-153 — "Auto mode": o `ApprovalCard` liga autonomia pra QUALQUER ação futura de um agente {#rn-153}

Antes deste RN, `agent_autonomy` só sabia conceder autonomia por
`(projeto, agente, TIPO de ação)` — uma linha por tipo, upsert de UMA regra
por vez (`SetAgentAutonomyUseCase`,
`apps/api/src/application/use-cases/actions/set-agent-autonomy.use-case.ts`).
Confiar amplamente num agente exigia uma linha por tipo — `terminal`,
`write_file`, `pr_open`… — e tipo novo nascia sem regra, de volta a
`require_approval`.

"Auto mode" é o valor especial `actionType: "*"` na MESMA tabela e no MESMO
endpoint (`PUT /projects/:projectId/agent-autonomy`) — não é mecanismo novo,
é a coluna existente (`agent_autonomy.action_type`, `text` livre, sem enum
nem FK — `apps/api/src/db/schema.ts`) aceitando um valor a mais. A curinga
significa "autonomia pra qualquer tipo de ação DESTE agente" e é resolvida
em `DrizzleAgentAutonomyRepository.findMode`
(`apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`):
busca a regra ESPECÍFICA e a curinga na mesma consulta, e a específica
sempre vence — gravar `terminal: deny` com `"*": auto_approve` já ligado
continua negando `terminal` desse agente, e liberando o resto. `decide()`
(`apps/api/src/domain/actions/decide.ts`) não muda: ele recebe o
`PermissionPolicy` já resolvido em `ctx.autonomyMode`, exatamente como antes
da curinga existir — é por isso que os tetos absolutos valem sem precisar
saber que "auto mode" existe (ver [RN-154](#rn-154)).

O `ApprovalCard` (`apps/web/src/components/ApprovalCard.tsx`) ganha o botão
"Modo automático" ao lado de "Sempre permitir", visível só quando: (a) a
ação está `pending`, (b) quem propôs é um AGENTE (`actor.kind === 'agent'` —
não há autonomia de agente para conceder a um usuário) e (c) quem chama
(`ProjectApprovalsTab.tsx`/`SessionPage.tsx`) já confirmou papel
`maintainer`/`owner` no workspace — mesma exigência do endpoint
(`@RequireRole('maintainer')`, inalterado). O prop `onActivateAutoMode` é
`undefined` para quem não tem o papel — o card ESCONDE o botão em vez de
mostrá-lo desabilitado, e a checagem mora em quem chama, não no card
(componente presentational, sem query própria).

**Desligar** reusa o toggle manual/auto que o card do agente já tinha (Fase
8d) — nenhuma tela nova. `AgentTeamGrid.tsx` passa a procurar a regra
curinga do agente ANTES da representativa (`autonomyActionTypeFor`): se
existir, o toggle do card reflete e edita a CURINGA, não mais o tipo
representativo — desligar é gravar a mesma curinga como
`require_approval`, e o toggle no card do agente é exatamente esse
"desligar".

- **Onde:** `apps/api/src/domain/actions/decide.ts`
  (`AGENT_AUTONOMY_ALL_ACTIONS`, `AgentAutonomyActionType`),
  `apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`
  (`findMode` com precedência específica > curinga),
  `apps/api/src/interfaces/http/actions/dto/set-agent-autonomy.dto.ts`
  (aceita `"*"`), `apps/web/src/components/ApprovalCard.tsx` (botão "Modo
  automático"), `apps/web/src/components/AgentTeamGrid.tsx` (toggle
  passa a priorizar a curinga), `apps/web/src/routes/ProjectApprovalsTab.tsx`
  e `apps/web/src/routes/SessionPage.tsx` (`handleActivateAutoMode`, gate de
  papel via `useCurrentWorkspaceWithRole`)
- **Teste:**
  `apps/api/test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  (precedência específica > curinga; curinga é por agente; desligar é
  regravar a curinga como `require_approval`),
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (auto mode auto-aprova ação comum SEM bater em `permissions.json`; regra
  específica em `deny` vence a curinga),
  `apps/api/test/interfaces/http/actions/agent-autonomy.controller.spec.ts`
  (`PUT`/`GET` continuam exigindo `maintainer`; DTO aceita `"*"` e recusa
  string fora da lista), `apps/web/src/components/ApprovalCard.test.tsx`
  (botão some sem `onActivateAutoMode`; clique chama o callback; nota
  explica os tetos que continuam pedindo decisão)
- **Origem:** pedido do usuário — "Sempre permitir" só grava um padrão de
  comando específico, e `agent_autonomy` só cobria um tipo de ação por vez;
  faltava confiar amplamente num agente com um clique só

### RN-154 — Os três tetos absolutos continuam bloqueando MESMO com "auto mode" ligado {#rn-154}

O desenho do "auto mode" ([RN-153](#rn-153)) é deliberadamente incapaz de
furar os três tetos que já existiam em `decide()` — eles são aplicados por
ÚLTIMO, sobre `current.policy`, sem olhar de onde veio a permissividade
(`agent_autonomy` com tipo específico, curinga, ou `permissions.json` — a
função nunca soube distinguir as origens, e continua sem saber):

1. **Merge em branch protegida** (`git_merge` com destino em
   `dev`/`qa`/`rc`/`main`, [RN-006](#rn-006)) — a trava de merge
   (`isProtectedBranch`) rebaixa `auto_approve` para `require_approval`
   sempre, mesmo com `"*": auto_approve` ligado pro agente.
2. **`instruction_patch`** ([RN-007](#rn-007)) — mudar a instrução de outro
   agente exige o humano ver o diff; auto mode não muda isso.
3. **`parallelize`/`raise_max_parallel`** ([RN-086](#rn-086)) — subir o
   teto de paralelismo, ou pedir mais agente acima dele, continua decisão
   do usuário; um agente com auto mode ligado não consegue se auto-conceder
   mais poder de gasto.

A prova é por CONSTRUÇÃO, não por caso a caso: como os três tetos verificam
só `current.policy === 'auto_approve'` — nunca a origem —, e "auto mode" só
consegue chegar em `current.policy === 'auto_approve'` pelo MESMO caminho
que uma regra específica de `agent_autonomy` já usava
(`ctx.autonomyMode`), os tetos que já continham `agent_autonomy` continuam
contendo a curinga sem precisar de código novo. O risco real não era o
teto — era alguém, ao generalizar `agent_autonomy` pra aceitar `"*"`,
inserir a checagem da curinga ANTES dos tetos e reabrir a porta; por isso
`AGENT_AUTONOMY_ALL_ACTIONS` foi resolvido inteiramente no REPOSITÓRIO
(antes de `decide()` rodar), e `decide()` em si não ganhou nenhuma linha
nova — só o suficiente pra não ter onde a curinga furar.

- **Onde:** `apps/api/src/domain/actions/decide.ts` (os três blocos de teto,
  linhas ~207–258, inalterados por esta feature)
- **Teste:**
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  ("auto mode NÃO auto-aprova merge em branch protegida", "... instruction_patch",
  "... parallelize/raise_max_parallel" — os três com `agent_autonomy` "*"
  gravado como `auto_approve` e o veredito continuando `require_approval`)
- **Origem:** restrição de design confirmada pelo usuário ao pedir o "auto
  mode" — os três tetos são a garantia que não pode regredir

### RN-155 — ordenação da timeline usa o vínculo `proposed_action.created`, nunca `action.seq` cru {#rn-155}

A `timeline` de `SessionPage.tsx` ordena eventos e ações propostas por um
único eixo numérico comparável. Para eventos, é `event.seq` (gapless, por
sessão). Para ações, é o `seq` do evento `proposed_action.created` correlato
(achado por `payload.actionId === action.id`, gravado por
`ProposeActionUseCase` na MESMA transação que cria a ação) — nunca
`action.seq`, que é `bigserial` único e global de toda a tabela
`proposed_actions`, compartilhado por todas as sessões e projetos do
sistema, e portanto incomparável com `event.seq` (contraste deliberado, ver
`apps/api/src/db/schema.ts`). Comparar os dois direto produzia ordem
imprevisível toda vez que um `ApprovalCard` entrava na mistura com eventos
normais. Ações sem esse vínculo (só o bootstrap de Gitflow —
`git_repo_create`/`git_branch_create`, que gravam apenas outbox) degradam
para uma posição interpolada por `createdAt`, ancorada no último evento
anterior.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`ordemDaAcaoNaTimeline`)
- **Teste:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origem:** achado de PR #286 — cards de aprovação apareciam fora de ordem
  na timeline, misturados com eventos normais

### RN-156 — indicador de espera de 5s tem texto fixo, sem interpolar o agente {#rn-156}

O indicador que aparece depois de 5s sem resposta (`pensandoVisivel`) mostra
a frase fixa "Reunindo informações...", sem o nome do agente interpolado —
substitui o texto anterior "{Agente} está escrevendo…". O nome do agente já
é visível no cabeçalho assim que o streaming de texto real começa; repeti-lo
no indicador de espera não ajudava a leitura.

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
- **Teste:** `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origem:** achado de PR #286 — o texto anterior nomeava um agente que já
  estava visível no cabeçalho

### RN-157 — criação de épico/história pelo PO vira aviso compacto, não bolha completa {#rn-157}

Os eventos `backlog.epic_created`/`backlog.story_created` deixam de
renderizar como bolha completa de mensagem (`.message`/`.bubble`, avatar de
32px — o mesmo peso visual de uma resposta de agente de verdade) e passam a
usar o mesmo formato de aviso compacto que `.handoffDivider`/`.handoffPill`
já usa para a passagem de bastão: linha centralizada com filete horizontal e
pílula compacta, mantendo o link "Ver no Backlog". `agentId` continua
populado no `TimelineEntry` — ao contrário do divisor de handoff, isto não
marca uma transição entre agentes, é uma ação do PO dentro do próprio turno
dele, e segue elegível ao colapso por agente ([RN-138](#rn-138)).

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
- **Teste:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origem:** achado de PR #286 — a bolha completa tinha peso visual igual a
  uma resposta de agente de verdade, para uma ação de metadado do PO

### RN-158 — Markdown leve com highlight no chat {#rn-158}

`agent.response` no fio da Sessão renderiza um subconjunto de Markdown
(negrito `**texto**`, itálico `*texto*`/`_texto_`, código inline
`` `texto` ``, cabeçalho `#`/`##`/`###`, lista `-`/`1.`, link
`[texto](url)` e fence de código ```` ```linguagem ````), via parser
próprio por regex (`apps/web/src/lib/markdown.ts`), sem dependência nova.
`chat.message` (texto digitado pelo usuário) permanece literal — Markdown
só se aplica à SAÍDA de um agente/LLM, nunca à entrada humana.

Segurança: o parser nunca produz HTML — devolve uma árvore de dados que
`MarkdownMessage.tsx` converte em elementos React diretamente (nunca
`dangerouslySetInnerHTML`). Um link só vira `<a href>` clicável quando o
esquema da URL é `http`, `https` ou relativo (`/...`, `#...`); qualquer
outro esquema (`javascript:`, `data:`, etc.) degrada para o texto do link,
nunca para um `href` executável.

Código dentro de um fence ganha realce por token, reusando
`highlightLine`/`highlightFile` de `apps/web/src/routes/code/highlight.ts`
— a mesma função que já colore a aba Code. `sh`/`bash` ganharam
vocabulário próprio de palavras-chave de shell (antes só tinham o
comentário de linha `#` mapeado e caíam no fallback de JS). Fences
```` ```sh ````/```` ```bash ```` ganham a estética visual de terminal
(prompt `$` por linha de comando), consistente com o `$ comando` que
`ApprovalCard` já usa para a ação `terminal`.

- **Onde:** `apps/web/src/lib/markdown.ts`,
  `apps/web/src/components/ui/MarkdownMessage.tsx`,
  `apps/web/src/routes/code/highlight.ts`
- **Teste:** `apps/web/src/lib/markdown.test.ts`,
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`,
  `apps/web/src/routes/code/highlight.test.ts`,
  `apps/web/src/routes/SessionPage.markdown-resposta.test.tsx`
- **Origem:** PR #288 — respostas de agente com listas, código e links
  chegavam como texto cru no fio, sem estrutura nenhuma

### RN-159 — Artefatos Gerados agrupados por agente {#rn-159}

O painel "Artefatos gerados" da Sessão (`ContextAside` em
`SessionPage.tsx`) lista PR de dev (`pr_open`), PR de ADR do Arquiteto
(`open_adr_pr`) e épico/história criados pelo PO
(`backlog.epic_created`/`backlog.story_created`), agrupados por
`agentId` — quem gerou cada artefato — com o mesmo padrão de
`Disclosure` colapsável da [RN-138](#rn-138) (nome do agente + contagem,
expansível pro título de cada artefato).

Cada artefato navega pro lugar onde ele vive: PR (dev ou ADR) abre a URL
real (`executionResult.pullRequestUrl`, mesmo campo que
`ProjectOverviewTab.tsx` já lê para PR de ADR); épico/história navega
para `/projects/:projectId?tab=backlog` (mesmo padrão `Link` já usado nos
avisos compactos do PO no fio principal, [RN-124](#rn-124)/
[RN-157](#rn-157)). PR ainda sem `pullRequestUrl` (execução pendente)
aparece no painel sem virar link clicável.

Fora de escopo, por decisão registrada em comentário no código
(`ContextAside` em `SessionPage.tsx`): module_map/C4 — são estado
VIGENTE do projeto (uma versão corrente, sobrescrita a cada geração), não
um artefato datado por SESSÃO como PR/épico/história; a aba Visão Geral
(`ProjectOverviewTab.tsx`) já é o lugar deles hoje, sem âncora própria —
endereçar isso é fora do escopo desta entrega.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`ContextAside`)
- **Teste:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
- **Origem:** PR #288 — o painel não distinguia quem gerou cada artefato
  nem cobria PR de ADR e épico/história, só PR de dev

---

## Quando dá errado

| situação | o que o sistema faz |
|---|---|
| Transição de estado inválida | erro tipado (`InvalidSessionTransitionError` etc.), traduzido para 4xx — nunca grava estado inconsistente |
| Agente estoura o teto de iterações ou tokens | encerra e registra artefato de bloqueio com a origem da falha |
| Task esgota o ciclo K | bloqueada com motivo, não gira para sempre (RN-015) |
| Provider de LLM cai no meio | registrado como falha de **infra**, nunca "o modelo parou" (RN-023) |
| Duas decisões concorrentes na mesma hipótese | conflito explícito (RN-022) |
| Réplica do engine cai | sessão é adotada por outra ou encerra como `closed_abnormally / node_shutdown` — nunca fica órfã |
| `QaLeadServer`/`SecOpsAgentServer` cai no meio de um ciclo de gate | `Engine.Gates.GateRescuer` retoma sozinho — reinicia a área (nenhum veredito gravado) ou reenvia a chamada perdida (veredito já gravado) — sem intervenção manual (RN-140) |
| Rate limit indisponível | a requisição **passa**: o guard protege contra abuso, não contra acesso indevido |
| Rate limit **estourado** (429) | a tela diz o que a api respondeu e o poll para; a app nunca responde ao limite com mais tráfego (RN-088) |
| Credencial errada, conta inexistente ou conta bloqueada | **a mesma** resposta 401, com o mesmo custo de argon2 (RN-032) |
| Refresh já usado reapresentado | família revogada e evento de segurança; o usuário legítimo também é deslogado (RN-030) |
| Tráfego interno sem o segredo de serviço | 403 na api, 401 no engine — nunca alcança o controller (RN-035) |
| Provider recusa a chave durante o sync de catálogo | provider **pulado** com a origem da falha; nenhum modelo é marcado como sumido (RN-041) |
| Modelo do binding some do provider | a cascata cai para o nível de baixo e AVISA qual escopo pulou — nunca troca o modelo em silêncio (RN-041) |
| Preço do modelo muda | vale daqui em diante; o custo gravado e o preço que o produziu ficam intocados (RN-042) |
| Criar o handoff falha (Criativo→PO, Arquiteto→Infra/Dev Lead) | `agent.error` durável, o processo do agente CONTINUA vivo; o que já foi gravado antes (product_brief, regras) não se perde (RN-116) |

> **TODO(humano):** as RNs acima foram extraídas do código e dos testes. Falta
> confirmar se existe regra de negócio **não implementada** que deveria estar
> aqui — algo combinado e ainda não codificado não aparece nesta varredura.
