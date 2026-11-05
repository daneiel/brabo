---
id: rn-web
title: 'Regras de negócio — Web'
sidebar_label: Web
description: 'As RNs hospedadas na raiz web.'
keywords: [regras de negócio, web]
---

# Web

## Painel de projetos

As RNs de orçamento, metering e teto de custo moram em
**[Regras de negócio — Custo](custo.md)**.

Mesmo motivo da seção de Autenticação abaixo: tamanho, não assunto.
Âncoras `#rn-NNN` inalteradas.

## Cost

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

### RN-064 — Heartbeat não encerra sessão com trabalho pendente {#rn-064}

> **Estendida pela [RN-581](api.md#rn-581) (AT-072):** um agente
> conversacional esperando o usuário passou a ser o QUINTO sinal, e o único com
> teto (8h, causa `conversation_idle_timeout`); a resposta ganhou
> `aguardandoUsuarioDesde`. O resto desta regra vale como está.

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
   ([RN-073](engine.md#rn-073));
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
(`Engine.Sessions.LiveBroadcast.agent_status/4`, [ADR 0021](../adr/0021-fechamento-4a-infra-e-painel.md))
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
  [backlog](../explanation/backlog.md); bug real do encadeamento
  Criativo→PO→Arquiteto

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

É a [RN-059](engine.md#rn-059) do outro lado do fio: falha nunca vira resposta vazia.
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

## Session

### RN-098 — The session name adds to the hashtag, never replaces it {#rn-098}

The session can receive a friendly name (`sessions.name`, optional), at
creation or later, via `PATCH /projects/:projectId/sessions/:sessionId`. The
label shown on screen is **composite**: `<name> · #<first 8 characters of the
id>`. With no name, it degrades to the **hashtag alone**.

The hashtag never disappears, and the reason is operational: it's what gets
pasted into a URL, a command, or a conversation, and a name chosen by a
person **isn't unique** — two sessions named "Checkout" are normal. A blank
name (or whitespace only) counts as **absence**, both on creation and on
renaming: writing `''` would turn the label into `" · #a1b2c3d4"`, worse than
the hashtag alone. `null` in the `PATCH` body is the way to **undo**.

Renaming is **not** a session event. The event log is what the session lived
through, and the name is a navigation label, changed as many times as
desired — N renaming events would push exactly what matters out of the
200-event tail.

- **Where:** `apps/web/src/lib/session-label.ts:61` (`rotuloDaSessao`),
  `apps/api/src/application/ports/session-repository.port.ts:52` (`rename`).
  Reachable both from inside the session
  (`apps/web/src/routes/SessionPage.tsx:439`, `handleRename`) and from the
  project's list, without needing to open the session first
  (`apps/web/src/routes/ProjectSessionsTab.tsx:101`, `handleRenomear`) — both
  screens call the same `renameSession` and the same `rotuloDaSessao`.
- **Test:** `apps/web/src/lib/session-label.test.ts`,
  `apps/api/test/application/use-cases/sessions/session-kind-e-nome.spec.ts`,
  `apps/web/src/routes/ProjectSessionsTab.test.tsx`
- **Origin:** [ADR 0061](../adr/0061-tipo-da-sessao-na-criacao.md)

## Painel de projetos

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
mesma de antes, e a economia da [RN-090](api.md#rn-090)/[RN-091](api.md#rn-091) não
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

## Session

### RN-104 — The tab derives from the recorded kind, and creates in that kind {#rn-104}

The project has **two** session tabs — **Creative** and **Chat** — and each
one is a `kind`: it lists the sessions whose `sessions.kind` is its own, and
its CTA creates in that `kind`, **without asking again**. There's no third
tab listing both together.

The kind was already immutable ([RN-097](api.md#rn-097)), and that's what makes it
a legitimate navigation coordinate instead of a saved filter: a session never
switches tabs. The tab reads the **recorded** field — it doesn't derive the
kind from any event, for the same reason as RN-097: `execution.activated`
classifies execution STATE, and a tab that looked at it would move on its
own.

Two consequences the rule fixes, and which aren't screen detail:

- **The kind choice leaves the form.** It used to live in a radio-button
  `fieldset`, and now it happens the moment the person clicks the tab.
  Keeping both would offer the chance to create a session that contradicts
  the place you're standing in. What's left in the form is the **name**,
  which stays optional ([RN-098](#rn-098)).
- **One action, one place at a time.** "Start ideation" still exists — it's
  what brings the Creative agent into the session, and from there on the
  owner's key starts being spent ([RN-058](api.md#rn-058)); no one steps in alone.
  What changed is where it lives: **inside the invite** while the invite is
  on screen, and in the topbar when it isn't. The invite used to POINT to the
  topbar ("use Start ideation, at the top of the screen"), which is the
  literal version of the problem that originated [RN-097](api.md#rn-097) — the
  action in one place and the explanation in another. The topbar can't
  simply lose the button: it's possible to type into a creative session
  without ever having called the Creative agent, and then the invite leaves
  the scene.

The three screens honor the three states of [RN-088](#rn-088), with **error
before empty**: the filtered list is empty in both cases, and saying "no
ideation yet" after a 429 would be lying about what happened.

The Chat's deep-link key stays `sessions`, not `chat`. That's what makes an
old bookmarked `?tab=sessions` link open the Chat **with the tab marked in
the tab bar** — resolving the old key as an alias only in the panel would
leave the tab bar with no selection at all, because `Tabs` compares `active`
to `key`, and whoever writes `active` receives the raw key from
`validateSearch`.

- **Where:** `apps/web/src/routes/project-tabs.ts:95` (both entries),
  `apps/web/src/routes/ProjectSessionsTab.tsx:114` (the filter by recorded
  `kind`) and `:98` (the CTA creating in the tab's `kind`),
  `apps/web/src/routes/SessionPage.tsx:722` (`conviteVisivel`, the one
  question the topbar and the invite share)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx`,
  `apps/web/src/routes/project-tabs.test.tsx`,
  `apps/web/src/routes/SessionPage.sessao.test.tsx`
- **Edge case:** a project with no session of that kind shows the empty
  state OF THAT KIND, even when it has sessions of the other kind — that's
  information, not an error.
- **Origin:** [ADR 0061](../adr/0061-tipo-da-sessao-na-criacao.md)

### RN-107 — A aba Code tem um QUARTO estado: bloqueada por decisão pendente {#rn-107}

Os três estados da [RN-088](#rn-088) (carregando/erro/vazio) não descrevem
`sem_decisao` ([RN-105](api.md#rn-105)): não é carregando (a api já respondeu), não é
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

A apresentação do quarto estado foi EXTRAÍDA para `ContainerImageGateNotice`
(`apps/web/src/components/ContainerImageGate.tsx`) — achado de uso: a aba PRs
(`apps/web/src/routes/code/PrListAndDiff.tsx`, consumida por
`ProjectPrsTab.tsx` e por `CodeDiffPanel.tsx`) chama `getCodePullRequests`/
`getCodeDiff`, que passam pelo MESMO funil (RN-105) e podem devolver o MESMO
409 — mas, ao contrário desta aba, sem perguntar antes. Ela mostrava esse 409
no banner de erro genérico com "Tentar de novo", a afordância errada para um
estado que só o Arquiteto resolve. `isContainerImageGateError`
(`apps/web/src/lib/api-client.ts`) identifica a causa pelo `status === 409`
— única causa de `ConflictException` em `ReadProjectCodeUseCase.alvo` — e
`PrListAndDiff` troca o banner por `ContainerImageGateNotice` quando ela bate,
sem pré-checagem própria (reage ao 409 da query que já ia rodar).

- **Onde:** `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/web/src/routes/ProjectCodeTab.module.css`,
  `apps/web/src/components/ContainerImageGate.tsx` (apresentação
  compartilhada), `apps/web/src/routes/code/PrListAndDiff.tsx` (consumidor
  reativo ao 409), `apps/web/src/lib/api-client.ts`
  (`isContainerImageGateError`)
- **Teste:** `apps/web/src/routes/ProjectCodeTab.test.tsx` ("o gate"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`,
  `apps/web/src/routes/ProjectPrsTab.test.tsx` ("o gate do container não é
  erro genérico")
- **Borda:** a checagem no front NÃO substitui a da api — é conveniência de
  UX. Se a api mudar de estado entre a consulta do gate e a leitura de
  verdade, a rota de leitura ainda recusa com 409 (RN-105); o front só evita
  o caso comum de mostrar o editor vazio por um instante. A aba PRs não faz
  pré-checagem: ela descobre o bloqueio quando a query já falhou, porque não
  há árvore/arquivo nenhum ali para o instante "vazio" que a pré-checagem da
  aba Code evita.
- **Origem:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

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

Essa neutralização vale para TODO cliente do socket, e não só para o do web —
inclusive o socket `/runner`, cujo ticket (`POST .../runner-ticket`) é do
mesmo calibre. Ela falhou em DOIS dos quatro construtores de `Socket` do
repositório, e o custo foi medido em execução real: `apps/runner/src/
channel.ts` construía o socket sem a opção — enquanto o docblock do módulo
AFIRMAVA que o reconnect era "por isso neutralizado" — e o auto-reconnect
repetia o mesmo ticket já consumido a cada **~5,13s** (o teto do backoff
interno do phoenix.js), rendendo **61 `REFUSED CONNECTION TO
EngineWeb.RunnerSocket`** em poucas horas. Somado à política PRÓPRIA do
runner (`index.ts`, essa correta), o resultado foram **530 requisições num
minuto** contra o teto de 300 do `RATE_LIMIT_USER` — e como o limite é por
USUÁRIO, o 429 aparecia no NAVEGADOR do dono da conta. Duas consequências, e
a segunda é pior que o 429: enquanto está nesse laço o runner NÃO está
conectado, então `RunnerReadiness` (RN-507) recusa e o projeto parece "sem
agente local". `apps/web/src/lib/fs-browser-channel.ts` tinha a MESMA linha
de defeito (mesmo ticket de uso único, e sem política própria de reconexão —
o `onClose` dele manda "feche e reabra") e foi corrigido junto.

O que impede a terceira instância é MECANISMO, não comentário: no runner as
opções do `Socket` viraram um tipo com `reconnectAfterMs` OBRIGATÓRIO
(`OpcoesDoSocket` em `channel.ts`), e os dois lados ganharam teste que assere
a OPÇÃO PASSADA ao construtor — um teste que só verifique "conecta" passava
com o defeito de pé, e passou. Junto, `conectarERodar` (`index.ts`) passou a
DESCARTAR explicitamente a conexão caída (`conexao.desconectar()`): sem isso
o `Socket` da rodada anterior sobrevivia à criação do próximo, e cada queda
deixava mais um objeto vivo tentando com o ticket morto.

- **Onde:** `apps/api/src/db/schema/sessions.ts` (`sessionSocketTickets`),
  `apps/api/src/domain/sessions/socket-ticket-scope.ts`,
  `apps/api/src/application/use-cases/sessions/create-socket-ticket.use-case.ts`,
  `apps/api/src/interfaces/http/sessions/sessions.controller.ts` (rota
  `socket-ticket`), `apps/engine/lib/engine/sessions/socket_ticket.ex`,
  `apps/engine/lib/engine_web/channels/session_socket.ex`,
  `apps/engine/lib/engine_web/channels/session_channel.ex`,
  `apps/web/src/lib/session-channel.ts`,
  `apps/web/src/lib/fs-browser-channel.ts`,
  `apps/runner/src/channel.ts` (`OpcoesDoSocket`,
  `NUNCA_RECONECTAR_SOZINHO_MS`), `apps/runner/src/index.ts`
  (`conectarERodar`, o descarte da conexão caída)
- **Teste:**
  `apps/api/test/application/use-cases/sessions/create-socket-ticket.use-case.spec.ts`,
  `apps/api/test/domain/sessions/socket-ticket-scope.spec.ts`,
  `apps/api/test/infrastructure/persistence/session-socket-ticket.repository.spec.ts`,
  `apps/engine/test/engine/sessions/socket_ticket_test.exs` (reuso falha,
  session_id errado falha, corrida concorrente só um vence),
  `apps/engine/test/engine_web/channels/session_socket_test.exs` (sem ticket
  a conexão é recusada),
  `apps/engine/test/engine_web/channels/session_channel_test.exs` (ticket de
  outro projeto: join falha), `apps/web/src/lib/session-channel.test.ts`,
  `apps/runner/src/channel.spec.ts` ("neutraliza o auto-reconnect do
  Phoenix.Socket — ticket de uso único nunca é repetido"; assere a OPÇÃO
  passada ao construtor, e reprova sem ela),
  `apps/web/src/lib/fs-browser-channel.test.ts` (o mesmo, no transporte via
  runner do navegador de pastas)
- **Borda:** o ticket NÃO é o JWT reaproveitado — TTL curto, uso único, escopo
  fechado, e nasce de uma rota própria que já checa papel efetivo, não de
  decodificar o access token existente.
- **Origem:** sem ADR — extração/hardening pontual, não mudança estrutural.

### RN-113 — Blame no editor é anotação SOB DEMANDA — um toggle, nunca embutida na leitura do arquivo {#rn-113}

A UI que consome a fundação da [RN-110](contracts.md#rn-110) entra aqui: o editor da aba
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

## Painel de projetos

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

## Session

### RN-119 — The session's ACTIVE agent is the one with the most recent `agent.activated` — never a fixed chain {#rn-119}

`SessionPage` decides two things from the SAME agent: who the composer's
message goes to, and which agent the topbar resolves the displayed model
from (the full cascade session→agent→area→project→workspace, the same one
`RunLlmTurnUseCase` uses to actually run the turn). The two questions used
to have DIFFERENT answers before this rule: routing used a fixed precedence
chain (architect > po > creative, based on historical EXISTENCE — "has
already activated once", which never "turned off"), and the displayed model
didn't even know who was active — the model-binding route received no agent
at all and always fell back to the Creative agent's fixed fallback
(`herdarModeloDeStart`), even after a handoff to the PO, Architect, or Dev
Lead.

The single definition: the ACTIVE agent is the one with the most RECENT
`agent.activated` (by `seq`), among the conversational agents of the chat
flow (Creative, PO, Architect, Dev Lead). **Infra Lead is left out**:
`agent_command_controller.ex` (engine) only has a `message` route for
po/dev-lead/arquiteto (plus Creative, as the last clause's implicit
fallback) — Infra never had `message` wired, only `start`. Sending a message
to "infra" today would silently fall through to the Creative agent; treating
it as the composer's active agent would reopen that trap instead of closing
one.

> **Superseded in part by [RN-631](#rn-631) (AT-251):** "most recent
> `agent.activated` wins" was itself an implicit default recipient, and an
> invisible one. The composer's recipient is now CHOSEN by the person (a "To"
> selector listing the agents already in the session) and the topbar model
> follows that recipient. What survives from this rule is the half about the
> model: the binding route receives the agent, never falls back silently.

- **Where:** `apps/web/src/lib/session-destinatario.ts:290`
  (`useDestinatarioDoChat`, since RN-631),
  `apps/web/src/lib/api-client.ts:1192` (`getSessionModelBinding`, the
  `agentId`), `apps/api/src/interfaces/http/llm/model-bindings.controller.ts:166`
  (`getSessionBinding`, `@Query('agentId')`)
- **Test:** `apps/web/src/routes/SessionPage.destinatario-do-chat.test.tsx`
  (formerly `SessionPage.agente-mais-recente.test.tsx`),
  `apps/web/src/routes/SessionPage.modelo-do-agente-ativo.test.tsx`,
  `apps/api/test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
- **Edge case:** Infra Lead doesn't participate in composer routing nor in
  the "active agent" definition — it's proactive (Phase 4), not
  conversational through the composer.

### RN-120 — The session's event poll pauses during an in-progress turn {#rn-120}

`useSessionEvents` fetched events every few seconds with NO awareness of an
in-progress turn. If the poll landed DURING a turn (common — turns usually
last longer than the interval), it brought already-persisted
`chat.message`/`agent.response`, which rendered ALONGSIDE the
optimistic/streaming state still on screen: the same message, twice.

The fix pauses only the TIMER (`refetchInterval`) while `streaming` is
`true` — the query stays `enabled`, so the explicit invalidation that
already fires at the end of the turn (`finalizarTurnoDoAgente`) keeps
fetching fresh data at the right time. `pausarPoll` is an OPTIONAL
parameter, default `false`: the hook's other consumers (Overview, Code,
Provisioning, AdoptionPlan) have no conversational turn in progress and
stay as they were.

- **Where:** `apps/web/src/lib/hooks.ts:221` (`useSessionEvents`),
  `apps/web/src/routes/SessionPage.tsx:277` (`eventsQuery`)
- **Test:** `apps/web/src/lib/hooks.pausar-poll.test.tsx`
- **Edge case:** pausing the timer isn't disabling the query — explicit
  invalidation keeps working, and the fix depends on it to never miss data.

## Painel de projetos

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

## Session

### RN-123 — Creative session with no active Creative agent: the first message ALSO activates it {#rn-123}

In a `kind: 'criativa'` session ([RN-097](api.md#rn-097)) with no `agent.activated`
yet, sending the first message through the composer activates the Creative
agent first (waiting for activation to finish) and only then delivers that
message to it through the real path (`sendAgentMessage` — history, system
prompt, `emit_artifact` tool). Before this rule, whoever typed without
clicking "Start ideation" fell into a generic SSE chat with no history and no
business rules: it was NOT the real Creative agent, and the conversation
recorded nothing in the domain.

The "Start ideation" click still exists ([RN-104](#rn-104)) — it's still
what triggers activation when the person prefers the explicit gesture, and
it's from it that the owner's key ([RN-058](api.md#rn-058)) starts being spent on
either of the two paths. What changed is that the FIRST MESSAGE now also
counts as that gesture: no one should need a separate click before talking
to whoever the screen already invited them to talk to.

- **Where:** `apps/web/src/routes/SessionPage.tsx:684` (`handleSend`)
- **Test:** `apps/web/src/routes/SessionPage.ideacao-automatica.test.tsx`
- **Edge case:** a `consultiva` session has no Creative agent — the rule
  doesn't apply, and the generic SSE path stays the right one for it.

## Painel de projetos

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

> **Desde o [ADR 0185](../adr/0185-estou-pronto-fecha-os-dois-gates.md)
> ([RN-658](api.md#rn-658))** o handoff Criativo→PO que o "Estou pronto" pediu
> nasce e é aceito na mesma chamada, em nome de quem clicou — o card de
> aceite dele só aparece quando esse aceite não cabe (sessão anterior ao ADR,
> brief que não veio do clique) ou falhou. O filtro abaixo não muda.

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
SEPARADA) já tendo decolado por este atalho ([RN-135](api.md#rn-135)).

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

A correção reusa o sinal que a [RN-139](api.md#rn-139) já expõe —
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

### RN-160 — "Confirmar arquitetura pronta" exige pelo menos 1 história promovida {#rn-160}

O botão "Confirmar arquitetura pronta" (handoff Arquiteto→Dev Lead, via
`confirmArchitectureReadiness`) nasce `disabled` até existir no backlog do
projeto pelo menos 1 história com status diferente de `draft` — ou seja, já
promovida por `PromoteStoriesUseCase`/`TransitionStoryUseCase` ([RN-048](api.md#rn-048)),
não bastando ter regra de negócio capturada. `in_progress`/`done` também
contam, porque só se chega lá tendo passado por `ready`. A fonte é a MESMA
que a aba Backlog já usa (`useBacklog`, `ProjectBacklogTab.tsx`, mesma
queryKey `['backlog', projectId]`) — sem round-trip novo. Enquanto não há
história promovida, o botão mostra a dica em `title` explicando o motivo.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`hasPromotedStory`,
  render do botão)
- **Teste:** `apps/web/src/routes/SessionPage.readiness-arquitetura-exige-historia.test.tsx`
- **Origem:** pedido do usuário — o botão de handoff Arquiteto→Dev Lead
  não tinha gate nenhum

Só valia no CLIENTE: uma chamada HTTP direta ignorava a regra. Fechado por
[RN-404](api.md#rn-404) (ADR 0094), que revalida no backend.

### RN-161 — Aceitar o handoff pro Dev Lead encadeia a ativação de execução quando o papel efetivo já autoriza {#rn-161}

> **Revisada pela [RN-677](api.md#rn-677) (ADR 0194, decisão do
> dono em 01/10):** aceitar o handoff ao Dev Lead deixou de encadear a ativação
> da execução, para TODO papel — o aceite só o traz para PLANEJAR, e quem ativa
> é a APROVAÇÃO do plano dele (`propose_execution_plan`). O texto abaixo
> descreve a fusão como ela era.

`handleAcceptHandoff` (`SessionPage.tsx`) encadeia `activateExecution`
automaticamente quando `toAgent === 'dev-lead'` E o papel EFETIVO de quem
aceita — lido do mesmo `useCurrentWorkspaceWithRole()` que já autoriza o
"Auto mode" ([RN-153](api.md#rn-153)) e as telas de Aprovações/Configurações — é
`owner` ou `maintainer`. Para `developer` (ou papel ainda não resolvido), o
fluxo atual continua intocado: aceitar não ativa nada, e "Ativar execução"
permanece como segundo botão. A checagem é só no cliente —
`POST .../execution/activate` continua exigindo `maintainer` no backend
([RN-137](#rn-137)); a fusão só evita um clique redundante para quem já
tinha os dois papéis. Reusa a MESMA `handleActivateExecution` que o botão
"Ativar execução" já chama, que trata o próprio erro (toast +
`mensagemDaApi`) e nunca relança — evita que um erro de ativação tardio
seja reportado como "não foi possível aceitar o handoff".

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
  (`podeFundirHandoffComExecucao`, `handleAcceptHandoff`)
- **Teste:** `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 4"
- **Decisão arquitetural:** [ADR 0069](../adr/0069-fusao-condicional-do-handoff-com-a-ativacao-de-execucao.md)
- **Origem:** pedido do usuário (desenho aprovado)

### RN-172 — Handoff e aprovação são o DESFECHO do turno {#rn-172}

No fio da sessão, o **handoff oferecido** e o **card de aprovação** aparecem
DEPOIS da última fala do turno em que nasceram — nunca no meio dele.

Isto **não corrige ordenação**: a RN-155 continua valendo inteira, e a
timeline segue ordenada pelo `seq` do event log. O que o log registra é a
verdade: `po_server.ex` (`run_turn/2`) emite, na MESMA iteração, o
`agent.response` do turno, DEPOIS o `tool.call` de `offer_handoff` (que grava
`handoff.offered`) e SÓ ENTÃO recursa para o `agent.response` de fechamento.
O `seq` do handoff é honestamente menor que o da última fala. O mesmo vale
para `proposed_action.created`, que nasce no meio do turno enquanto o agente
ainda tem o que dizer. Mostrar "passou o bastão" ou "aprove isto" no meio da
conversa é leitura errada de um dado certo — então a regra é de
APRESENTAÇÃO, aplicada numa passada separada e explícita
(`afundarDesfechos`), depois do `sort` por `seq`, e não escondida num
comparador com três termos.

Turnos diferentes **nunca se misturam**. Um desfecho desce até o fim do
trecho logo abaixo dele e para na primeira entrada que falhe qualquer uma das
três condições:

1. **mesmo turno** — turno é o `seq` da última ABERTURA anterior à entrada, e
   abertura é evento de ator `user` (`chat.message`, `agent.activated`,
   promoção/devolução de história). Protege o caso em que a fronteira entre
   dois turnos não tem entrada VISÍVEL nenhuma: `agent.activated` abre turno e
   não vira item do fio.
2. **mesmo autor** — em sessão de EXECUÇÃO vários agentes escrevem sem que o
   usuário fale uma única vez, e todos ficam no mesmo turno; o desfecho de um
   não pode atravessar a fala de outro.
3. **não é desfecho** — dois desfechos seguidos preservam a ordem entre si (o
   `handoff.offered` do Infra antes do Dev Lead, na mesma confirmação).

Ator `system` NÃO abre turno: é ruído de infraestrutura no meio do fio, não
decisão de quem conversa.

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
  (`aberturasDeTurno`, `turnoDoSeq`, `afundarDesfechos`, e os campos
  `autor`/`turno`/`desfecho` de `TimelineEntry`)
- **Teste:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describes "RN-172 — turno e desfecho (unidade)" e "RN-172 — a sequência
  REAL do engine, renderizada")
- **Origem:** uso real no `exp001` — "a passagem de bastão do PO para o
  arquiteto está aparecendo acima da última mensagem do PO" e "a mensagem de
  aprovação apareceu acima do chat do arquiteto até ele finalizar a resposta"

---

### RN-173 — O fio acompanha tudo que cresce, e só quem já estava no fim {#rn-173}

O chat rola para o fim quando o conteúdo cresce — **e não só quando chega
evento novo**. As duas fontes da timeline são queries SEPARADAS (`events` e
`actions`), e a altura ainda muda sem nenhuma das duas: abrir/fechar um
`Disclosure` (colapso por agente da RN-138, "Detalhes" do card de aprovação),
Markdown reflowando, diagrama renderizando depois. Por isso são dois
mecanismos: as dependências do efeito cobrem o que o React sabe
(`events.length`, `actions.length`, `streamingText`), e um `ResizeObserver`
sobre o CONTEÚDO do fio cobre o que só o layout sabe.

A guarda continua **inalterada e deliberada**: só rola quem já está a menos de
120px do fim. Quem subiu para reler o histórico não é arrastado — o fio segue
a conversa, não sequestra a leitura.

No mesmo fio, o card de aprovação deixa de ocupar os 780px inteiros da
coluna: ganha teto de 560px e fica centralizado, como
`.handoffCard`/`.handoffDivider` já são. Recuar 45px como as bolhas seria
errado — o card não é fala de ninguém, é uma decisão pedida ao usuário. A
fila da aba Aprovações não muda: lá o card DEVE preencher a coluna do grid.
Desde a AT-322 o card é UM só em toda superfície e preenche o contêiner —
quem aplica o teto e a centralização no fio é o contêiner dele
(`.acaoNoFio`), não mais uma variante do card.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`acompanharOFim` e os dois
  efeitos que o chamam); `apps/web/src/components/ApprovalCard.module.css`
  (`.card`) e `apps/web/src/routes/SessionPage.module.css` (`.acaoNoFio`)
- **Teste:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describe "RN-173 — o fio acompanha o que cresce", com o caso de o usuário
  ter rolado para cima)
- **Origem:** uso real no `exp001` — "o scroll do chat deve ficar sempre no
  final seguindo o chat" e "aprovação mal diagramado deve ficar ao centro"

### RN-174 — Ação que dispara turno de agente arma o indicador do fio {#rn-174}

O indicador de "o agente está trabalhando" (os três pontinhos depois de 5s,
[RN-131](#rn-131)/[RN-156](#rn-156)) só aparece enquanto `streaming` ou
`statusAgent` valem, e eles eram ligados em três lugares: o composer
(`handleSend`), as confirmações de prontidão e o canal Phoenix. **Toda ação da
tela que dispara um turno síncrono no engine passa a armá-lo também.**

São duas, e nenhuma delas é o composer:

1. **Responder o formulário de perguntas estruturadas** —
   `AnswerStructuredQuestionUseCase` reusa `SendAgentMessageUseCase`
   ([RN-162](engine.md#rn-162)), e a chamada só resolve depois do turno inteiro.
2. **Devolver uma história ao PO** — `ReturnStoryUseCase` chama `reviseStory`,
   que é `handle_call({:revise, …})` no `po_server`: a resposta HTTP espera o
   PO reescrever a história.

O canal Phoenix não cobre o buraco, e é isso que torna a correção necessária
em vez de redundante: quando ele ainda não terminou de conectar (ticket +
join, [RN-108](#rn-108)) o broadcast de `agent.status` "working" não tem
ouvinte e se perde — a tela fica em silêncio absoluto por dezenas de segundos,
que é indistinguível de "não vai acontecer nada".

O par é `iniciarTurnoDoAgente(agente)` **antes** do `await` (o `agent.status`
do canal pode chegar primeiro, e sem o agente fixado o indicador nasceria sem
saber quem fala) e `finalizarTurnoDoAgente()` no `finally` — nos DOIS
caminhos, porque um erro que deixasse `streaming` ligado travaria o composer
até o próximo turno. Resolver a chamada é sinal de fim de turno tão confiável
quanto o `agent.done` do canal, e `finalizarTurnoDoAgente` é idempotente. O
prazo de 5s não muda: turno que responde rápido continua sem mostrar nada.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`iniciarTurnoDoAgente`,
  `handleReturnStory`, `StructuredQuestionCard`)
- **Teste:** `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  e `apps/web/src/routes/SessionPage.promocao-inline-e-volta.test.tsx`
  (describes de RN-174, com o caso de falha provando que o indicador não fica
  preso)
- **Origem:** uso real no `exp001` — "caso a web, api e engine demore mais de
  5s para ter uma resposta, a web deve apresentar uma animação no chat
  mostrando que o agente está pensando"

### RN-176 — Tabela em Markdown no fio vira tabela de verdade {#rn-176}

O Markdown leve do chat ([RN-158](#rn-158)) passa a reconhecer **tabela GFM** e
a renderizá-la com o `Table` do design system — o mesmo componente de
Configurações, Gastos e Executores, não uma `<table>` própria: "como o Brabo
desenha uma tabela" é uma decisão só. Antes, a tabela do Mapa de Módulos que o
Arquiteto escreve na resposta saía como parágrafo com pipes literais.

O que distingue tabela de prosa com `|` é a **linha separadora**, e ela é
obrigatória como no GFM: sem ela o bloco continua sendo parágrafo, então
"escolha entre a | b | c" não vira tabela por engano. O cabeçalho manda no
número de colunas — linha curta ganha célula vazia, linha longa perde o
excesso —, `\|` escapado fica dentro da célula, e o alinhamento sai dos
dois-pontos do separador. Zero dependência nova: o parser continua sendo o
próprio, por regex, e a árvore de dados continua virando elementos React
diretos (nenhum `dangerouslySetInnerHTML`).

**O artefato `artifact.module_map` continua FORA do fio**, e a escolha é
deliberada: ele é estado VIGENTE do projeto, não artefato datado por sessão —
a mesma decisão já registrada na [RN-159](#rn-159) —, e vive na Visão Geral.
O que o usuário pediu foi a tabela **dentro da mensagem**, e é ela que passou
a ser desenhada; a correção serve a QUALQUER agente que escreva uma tabela, e
não só ao Mapa de Módulos.

No balão, a tabela **rola na horizontal** em vez de espremer coluna: o fio tem
~700px e um `module_map` tem 4 colunas.

- **Onde:** `apps/web/src/lib/markdown.ts` (bloco `table`, `celulasDaLinha`),
  `apps/web/src/components/ui/MarkdownMessage.tsx` (`TabelaMarkdown`),
  `apps/web/src/components/ui/MarkdownMessage.module.css`
- **Teste:** `apps/web/src/lib/markdown.test.ts` (describe "tabela (RN-176)"),
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`
- **Origem:** uso real no `exp001` — "a tabela dentro da mensagem do Mapa de
  Módulos do arquiteto tem que ficar bem estruturada em formato tabela,
  utilizar design system do próprio Brabo"

### RN-177 — O log mostra tudo, e o histórico se recolhe por ORIGEM {#rn-177}

O feed de atividade escondia seis tipos de evento (`tool.call`, `tool.result`,
`agent.response`, `agent.delta`, `agent.status`, `context.compacted`) **sem
oferecer alternativa nenhuma**: quem quisesse ver o que o agente e o harness
trocam entre si tinha de abrir o banco. O filtro continua, e continua
**desligado por padrão** — a razão dele não mudou (116 de 193 eventos reais
eram desses tipos, ver `isMachineEvent`) —, mas virou **escolha**: um botão
"Eventos de máquina" no mesmo trilho dos chips de tipo.

Mostrar tudo só resolve metade: uma sessão longa vira uma lista que ninguém
percorre. Por isso as **5 mais recentes ficam abertas** e o resto entra em
colapsos por **ORIGEM** — uma classificação NOVA, que não substitui o
`ActivityKind`: `kind` diz de que ASSUNTO o evento fala (commit, PR, permissão)
e decide ícone e cor; `origem` diz de que CAMADA ele veio, e é ela que torna o
histórico legível em punhados. As seis saem do dado que existe — `actor.kind` e
o prefixo do `type` —, nunca de suposição:

| origem | o que cai nela |
|---|---|
| `harness` | `tool.*`, `toolloop.*`, `agent.status`, `context.compacted` |
| `llm` | `agent.response`, `agent.delta`, `llm.*` |
| `usuario` | qualquer evento com `actor.kind === 'user'` |
| `sistema` | qualquer evento com `actor.kind === 'system'` |
| `agente` | `agent.*` restante, `handoff.*`, `delegation.*`, `chat.*` de agente |
| `eventos` | o event log de domínio (backlog, git, PR, artefato, bootstrap…) |

A **precedência** é o que torna a classificação previsível, e está na ordem dos
`if`: mecanismo (`harness`, `llm`) vence ator, porque um `tool.call` é do
harness qualquer que seja o ator; e ator vence prefixo de agente, porque
`chat.message` existe dos dois lados e quem os distingue é quem falou. Tipo que
ninguém previu cai em `eventos` — nunca some, nunca inventa categoria.

**A mesma regra vale no FIO da sessão**, com o eixo invertido: o fio é
crescente (o mais novo junto do composer), então as 5 últimas entradas ficam
abertas em baixo e o histórico recolhido fica no TOPO. O corte é sobre a lista
já agrupada por agente ([RN-138](#rn-138)) — quem conta é o que o usuário vê, e
um colapso de doze mensagens é UMA entrada na tela. **Revista no fio pela
[RN-644](#rn-644):** lá o corte conta só MENSAGENS, recua
até a abertura do turno e o histórico é UM bloco cronológico, não grupos por
origem (que punham a resposta acima da pergunta). O painel de log segue como
descrito aqui.

- **Onde:** `apps/web/src/lib/activity.ts:94` (`OrigemDeEvento`), `:125`
  (`origemDoEvento`), `:152` (`agruparPorOrigem`);
  `apps/web/src/components/ActivityFeed.tsx:34` (o corte de 5), `:66` (o
  toggle); `apps/web/src/routes/session-fio.tsx:119` (o corte do fio), `:291`
  (`dividirFio`); `apps/web/src/routes/SessionPage.tsx:516` (`fio`)
  toggle); `apps/web/src/routes/session-fio.tsx:119` (o corte do fio), `:291`
  (`dividirFio`); `apps/web/src/routes/SessionPage.tsx:516` (`fio`)
- **Teste:** `apps/web/src/lib/activity-origem.test.ts`,
  `apps/web/src/components/ActivityFeed.test.tsx` (describe "ordem,
  agrupamento e o toggle de máquina"),
  `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx` (describe
  "RN-177")
- **Origem:** uso real no `exp001` — "em log de eventos mostrar também log do
  sistema, concentrar a mensagem em grupo, ou seja mantém as últimas 5
  mensagens mas abaixo vira o grupo de log de eventos, sistema, llm, harness,
  agente, usuário"

### RN-178 — O painel da sessão lê do último para o primeiro, e a lista de regras pagina {#rn-178}

As quatro seções do painel de contexto (regras de negócio, artefatos gerados,
arquivos tocados e log de eventos) eram **crescentes**: abriam no começo da
sessão. Numa sessão de milhares de eventos isso entrega a tela errada — quem
abre o painel quer o que acabou de acontecer. As quatro passaram a ser
**decrescentes**, inclusive dentro da árvore de backlog ([RN-179](#rn-179)).

Uma consequência que veio junto: o botão "Carregar mais antigos" do feed
([RN-099](#rn-099)) **mudou de lado**. Ele ficava ACIMA da lista porque a lista
era crescente e o passado estava em cima; com a ordem invertida o passado está
no fim, e um botão no topo pediria para rolar na direção contrária à que ele
carrega — o mesmo argumento de antes, com o sinal trocado.

E **acima de 5 regras a lista pagina**, em vez de crescer sem fim: o painel tem
a largura de uma coluna e uma sessão de ideação passa de vinte regras sem
esforço. A página vigente é resolvida por *clamp* (`min(pagina, total - 1)`) e
não por efeito de sincronização: uma regra nova chegando pelo poll alonga a
lista, e um `useEffect` renderizaria uma vez com a página inválida antes de
corrigir. Com 5 ou menos, o paginador **não existe** — controle que não pagina
nada é ruído ocupando altura.

- **Onde:** `apps/web/src/routes/ContextAside.tsx:109` (`REGRAS_POR_PAGINA`) e
  a ordenação das quatro seções no mesmo arquivo;
  `apps/web/src/components/ActivityFeed.tsx:98` (o `sort` decrescente)
- **Teste:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-178"), `apps/web/src/components/ActivityFeed.test.tsx`
- **Origem:** uso real no `exp001` — "mostrar log de eventos, arquivos tocados
  e regras de negócio sempre em ordem do último para o primeiro de acordo com
  a data" e "caso as regras de negócio ficar acima de 5, deve-se paginar"

### RN-179 — O artefato do PO é uma ÁRVORE: épico → história → tarefa {#rn-179}

O painel "Artefatos gerados" ([RN-159](#rn-159)) listava épico e história lado
a lado, planos, e **ignorava `backlog.task_created`** — justamente o que um dev
agent pega para trabalhar. Os três passaram a formar uma árvore, com o filho
dentro de um colapso do pai, e as tarefas nascem FECHADAS: um épico com trinta
tarefas tomaria o painel inteiro sem que ninguém tivesse pedido.

O parentesco sai do **vínculo que o evento já carrega** —
`backlog.story_created` grava `epicId`, `backlog.task_created` grava `storyId`
—, nunca da vizinhança no log. Nó cujo pai não está entre os eventos carregados
**sobe para a raiz** em vez de ser pendurado no épico mais próximo: inventar
parentesco é pior que mostrar o nó solto, e uma tarefa cuja história ficou fora
da janela é caso normal, não erro.

Cada nível continua sendo um **link** para o Backlog, e o colapso dos filhos
vem ABAIXO da linha em vez de dentro do cabeçalho — cabeçalho de `Disclosure` é
`<button>`, e um `<a>` dentro de um `<button>` é HTML inválido e alvo de clique
ambíguo. O contador do cabeçalho da seção conta a árvore INTEIRA, não só as
raízes: dizer "3" com dezoito tarefas dentro seria o mesmo tipo de número que
não corresponde a nada que a [RN-151](api.md#rn-151) tirou da sidebar.

- **Onde:** `apps/web/src/lib/session-backlog-tree.ts:68`
  (`montarArvoreDeBacklog`), `apps/web/src/routes/ContextAside.tsx:210` (as
  raízes viram item), `:225` (a contagem da árvore)
- **Teste:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
  (casos "épico/história/tarefa do PO viram árvore" e "nó sem pai carregado
  aparece na raiz")
- **Origem:** uso real no `exp001` — "mostrar também as tarefas criadas no
  artefato do PO, mas abaixo do épico e ter opção de colapsar"

### RN-180 — O painel diz o que NÃO está mostrando {#rn-180}

`useSessionEvents` busca `{ limit: 200, latest: true }`, e o painel de contexto
lia esse recorte por prop. Consequência: numa sessão de milhares de eventos as
quatro seções mostravam a cauda **como se fosse a sessão inteira** — regra de
negócio capturada no começo da ideação simplesmente não existia, sem aviso
nenhum.

O painel passou a ler o mesmo histórico paginado que a aba de Atividade da
Visão Geral já usava ([RN-099](#rn-099)), com a `queryKey` da cauda
compartilhada com o fio — **zero requisição a mais** no ciclo de poll
([RN-090](api.md#rn-090)/[RN-091](api.md#rn-091)). Duas coisas mudaram com isso:

1. **O feed ganhou o pager que o componente sempre teve.** As props
   `onLoadOlder`/`hasOlder`/`loadingOlder` são opcionais desde a RN-099 e este
   call site nunca as passava — era essa a razão de a sessão perder o começo em
   silêncio.
2. **Uma nota conta quantos eventos faltam.** O número sai de SUBTRAÇÃO sobre o
   `seq` (gapless e por sessão): `menor seq baixado − 1`. Nunca de uma
   requisição a mais — o mesmo mecanismo do "+ N mais antigos" do sino
   ([RN-100](api.md#rn-100)). Alcançando o começo da sessão a nota **desaparece**, em
   vez de afirmar um zero.

As seções derivadas leem `baixados` (tudo que já veio) e não `events` (a janela
de 100 do feed): elas não paginam item a item, e cortá-las na janela as faria
mostrar MENOS do que mostravam antes desta mudança. É o mesmo botão que
alimenta as duas.

O `pausarPoll` desce por `useSessionEventHistory` até `useSessionEvents`, e não
é detalhe: o intervalo de refetch é de cada OBSERVADOR, não da query. Um
segundo observador da mesma chave com timer ligado ressuscitaria o poll que a
tela pausa durante o turno — e com ele a duplicata visual da bolha em
streaming.

- **Onde:** `apps/web/src/lib/hooks.ts:262` (o `pausarPoll` do histórico),
  `:388` (`baixados`); `apps/web/src/routes/ContextAside.tsx:154`
  (`eventosAnteriores`) e o `ActivityFeed` com o pager, no fim do mesmo
  arquivo
- **Teste:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-180")
- **Origem:** revisão da própria rodada — o teto de 200 existia em silêncio nas
  quatro seções

### RN-181 — Delegação de área aparece no fio {#rn-181}

Quando uma área (QA, Infra) delega a subagentes e consolida o veredito, os três
desfechos que o lead registra — `delegation.completed`, `delegation.failed` e
`delegation.dispensed` — só existiam no painel de log. Quem acompanhava a
sessão via o gate abrir e fechar **sem nenhum sinal** de que houve uma segunda
tentativa por baixo.

Os três passaram a ser narrados no fio como **aviso compacto**, no formato da
[RN-157](#rn-157) — não bolha: é notificação do que aconteceu dentro da área,
não uma fala. A FRASE sai de `classifyEvent`, a mesma do painel, porque duas
redações do mesmo evento divergem na primeira mudança de payload; e ela já
nomeia o subagente e a área, então o lead **não** é prefixado (produziria "QA
Lead QA Automação concluiu a delegação (qa)").

O contrato externo da área **não muda** (ADR 0038): o fio não passa a endereçar
subagente, só a narrar o que o lead já registrou. A origem da falha viaja junto
em `delegation.failed`, pela mesma razão da [RN-059](engine.md#rn-059) — é ela que diz
se o próximo passo é trocar a chave, esperar o provider ou abrir um bug.

- **Onde:** `apps/web/src/routes/session-timeline-montagem.tsx:754`
- **Teste:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-181")
- **Origem:** uso real no `exp001` — "quando houver uma nova tentativa e
  consolidação de algum agente deve apresentar no chat"

### RN-182 — O tema é escolhido, persistido e aplicado antes do primeiro paint {#rn-182}

O tema claro existe em `design/tokens.css` desde o começo, sob
`[data-theme='light']`, e **nada em `apps/web` escrevia esse atributo**: o
único jeito de ver o tema claro era digitar o atributo no DevTools. Ele passa a
ser alcançável.

A preferência mora em `localStorage['brabo.theme']`, aceita **só** `'dark'` ou
`'light'`, e o default é `dark` — o tema primário do design system. Quem aplica
é `apps/web/public/theme-boot.js`, **síncrono no `<head>` e antes do bundle**:
`data-theme` decide as cores de todo o `tokens.css`, e aplicá-lo depois da
hidratação faria o usuário do tema claro ver um flash escuro a cada carga.

É **arquivo, não script inline**, e a razão é a mesma que fez as fontes serem
auto-hospedadas (ADR 0036): a imagem de produção serve sob `script-src 'self'`
(`docker/web/nginx.conf`), sem `'unsafe-inline'` e sem nonce. Inline
funcionaria em `pnpm dev:web` e seria **bloqueado na imagem publicada** — o
pior modo de falha possível, porque só aparece depois do deploy.

O caminho inteiro degrada em vez de quebrar: `localStorage` pode lançar (modo
privado, storage bloqueado em iframe) e tema é preferência, não função; valor
desconhecido cai no default em vez de virar um `data-theme` que o CSS não
conhece e que renderizaria sem tema nenhum.

- **Onde:** `apps/web/public/theme-boot.js:41`,
  `apps/web/index.html:53`
- **Teste:** `apps/web/src/lib/tema.test.ts` (describe "contrato com o script
  de boot")
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-183 — A preferência de tema tem uma fonte, e o atributo do `<html>` é a verdade {#rn-183}

Ler, gravar, alternar e observar o tema é `apps/web/src/lib/tema.ts` — o botão
mora no shell e consome essa API, nunca escreve `data-theme` por conta própria.

Três decisões dentro dela:

1. **`temaAtual()` lê o ATRIBUTO primeiro**, e só depois o `localStorage` e o
   default. É o atributo que a tela está mostrando; cair na preferência gravada
   antes dele faria a UI afirmar um tema diferente do que se vê, no exato caso
   em que o boot falhou.
2. **`lerTemaSalvo()` devolve `null`, não o default**, quando não há preferência
   gravada. Quem nunca escolheu pode um dia seguir o sistema operacional
   (`prefers-color-scheme`), e apagar essa distinção aqui tiraria a informação
   de quem decidir isso depois.
3. **`observarTema()` cobre o evento `storage`**, que o navegador dispara nas
   OUTRAS abas do mesmo origin. Sem isso dois separadores abertos ficariam em
   temas diferentes até o próximo reload.

A chave e o default são repetidos em `public/theme-boot.js` porque ele roda
antes do bundle e não pode importar nada. É a única duplicação possível de
divergir em silêncio, e por isso o teste lê o arquivo de boot e reprova se os
dois deixarem de bater.

- **Onde:** `apps/web/src/lib/tema.ts:73`
- **Teste:** `apps/web/src/lib/tema.test.ts`
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-184 — Contraste é medido nos DOIS temas {#rn-184}

Enquanto o tema claro era inalcançável ([RN-182](#rn-182)), medir só o escuro
era honesto: medir uma tela que ninguém pode abrir é medir uma intenção. Com o
botão de tema, deixar de medir o claro passaria a esconder metade da superfície
visível do produto — então os pares passam a ser cobrados nos dois temas, com o
mesmo piso (4,5:1 para texto, 3:1 para elemento de interface).

Para isso, **seis tokens do tema claro mudaram de valor**. O fundo mais
exigente do claro é o `--code-bg` (papel, `#efe4d2`, a um passo das
superfícies), e quem fecha contra ele fecha contra o resto: `--accent`
3,56 → 4,81, `--warning` 3,15 → 4,98, `--success` 3,89 → 5,12, `--violet`
4,16 → 4,95, `--text-muted` 2,76 → 5,17, e `--accent-hover` seguiu o accent um
degrau abaixo. O tema escuro **não mudou um valor**, e a dívida conhecida dele
seguiu travada pelos mesmos cinco números (3,89 / 3,10 / 3,88 / 3,88 / 4,41)
até a [RN-640](#rn-640) (ADR 0181), que a fechou com a
paleta neutra e a transformou em piso.

O `--text-muted` do claro não era dívida: a 2,40:1 sobre `--surface-2` ele
reprovava até o piso de **elemento de interface**, que é o mais baixo que
existe. Era defeito, e o tema claro não tem por que ser pior que o primário.

- **Onde:** `design/tokens.css:208`
- **Teste:** `apps/web/src/lib/contraste.test.ts`,
  `apps/web/src/design-contraste.test.ts`,
  `apps/web/test/design-contraste.test.ts`
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-185 — Os oito papéis de sintaxe, e o valor do handoff só entra medido {#rn-185}

A paleta de realce era três tokens próprios (`--syntax-function`,
`--syntax-comment`, `--syntax-operator`) e cinco reusos de semântico
(`--accent`, `--warning`, `--violet`, `--success`, `--text-primary`). É esse
reuso que fazia a paleta ser medida só no escuro: no claro os semânticos
reprovavam contra o `--code-bg` de papel.

Passa a ter os **oito papéis** do handoff, com o prefixo `--syntax-*` que o
repositório já usa, e cada um com valor próprio por tema. Nomear os oito é o
que permite o realce divergir do semântico no dia em que precisar.

**Valor do handoff só entra quando a medição aprova.** Contra o próprio
`--code-bg` do handoff, cinco dos oito reprovam os 4,5:1 que texto de código
exige — `--syn-cm` 4,09:1 no escuro e 2,32:1 no claro, `--syn-kw` 4,34:1,
`--syn-str` 4,20:1, `--syn-fn` 4,14:1, `--syn-op` 4,00:1. Onde o handoff
reprova, vale o número medido: é a mesma régua do ADR 0036 — a intenção do
handoff vale, o mecanismo (ou o número) que quebra o produto, não.

Os cinco semânticos continuam sendo quem pinta (`SyntaxTokens.module.css` não
mudou nesta entrega) e por isso vão **medidos ao lado** dos oito: enquanto
forem o pixel de verdade, é deles que o piso é cobrado. No tema claro cada
papel tem hoje o MESMO número do semântico que o pinta, de propósito — duas
fontes com números diferentes para o mesmo pixel divergiriam na primeira
correção feita de um lado só.

- **Onde:** `design/tokens.css:111`
- **Teste:** `apps/web/src/lib/contraste.test.ts` (describe "contraste — paleta
  de sintaxe sobre --code-bg")
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-195 — A sidebar recolhe para uma trilha de ícones, com a preferência persistida {#rn-195}

`Shell.tsx` tinha largura fixa (248px) e nenhum jeito de encolher. Passa a
alternar entre 264px e 62px (tokens `--sidebar-w`/`--sidebar-w-collapsed`,
removidos com o ADR 0241: hoje a largura é a do shadcn) com `transition: width .18s ease`. Recolhida, vira uma trilha vertical: um
quadrado de iniciais por projeto (borda na cor de identidade,
[RN-197](#rn-197)) mais um ícone de Atividades; clicar num projeto na
trilha reexpande a barra, abre aquele projeto e navega para ele.

A preferência é do usuário e sobrevive a reload: `brabo.sidebar.collapsed`
(`'1'`/`'0'`) em `apps/web/src/lib/sidebar-state.ts`. Ela é **só manual**
(`colapsadoManual`): havia um segundo estado, **automático**
(`autoColapsado`), somado por OR pela aba de Código, e ele foi removido pelo
[ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md) — ver
[RN-201](#rn-201). Nenhuma tela recolhe a sidebar por conta própria; o que se
vê recolhido foi o usuário quem pediu, e está gravado.

- **Onde:** `apps/web/src/routes/Shell.tsx:340-351` (estado e toggle),
  `apps/web/src/routes/Shell.module.css` (`.sidebar`, `.colapsado .sidebar`,
  `.trilha*`), `apps/web/src/lib/sidebar-state.ts`
  (`lerColapsado`/`gravarColapsado`)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe "colapso"),
  `apps/web/src/routes/Shell.test.tsx`
- **Origem:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/README.md` seção "Navigation shell"

### RN-196 — Projetos expansíveis revelam as abas do projeto, N ao mesmo tempo {#rn-196}

Cada projeto na sidebar ganha um chevron: clicar nele expande a linha e
revela a lista de abas daquele projeto (Visão geral, Executores, Criativo,
Chat, Code, Backlog, Aprovações, Insights, Gastos, Configurações), cada uma
um link para `/projects/$projectId?tab=<chave>`. Vários projetos podem ficar
abertos ao mesmo tempo — o estado é um `Set<string>` de ids, persistido em
`brabo.sidebar.open`.

A lista de abas e os rótulos vêm de `ABAS_DO_PROJETO`
(`apps/web/src/routes/project-tabs.ts`, dono da frente C, rodando em
paralelo nesta mesma onda) — a sidebar só **lê** o array exportado, nunca
reescreve nomes de aba. **Suposição de shape**, para conferir contra o que a
frente C entregou: `AbaDoProjeto` tem `key: string`, `label: string` e
`count?: (contagens: ContagensDeAba) => number | undefined`, com
`ContagensDeAba = { promocoesPendentes, aprovacoesPendentes,
hipotesesPendentes }`. A sidebar só consegue preencher
`aprovacoesPendentes` de graça (`pendingApprovalsCount` já vem no resumo do
dashboard, [RN-151](api.md#rn-151)); `promocoesPendentes`/`hipotesesPendentes`
entram como `0` — calculá-los exigiria uma consulta nova POR PROJETO
ABERTO na sidebar, a mesma classe de N+1 que a RN-090/091 fechou no
dashboard. Os dois selos continuam corretos dentro da régua da própria
`ProjectPage`; só o preview na sidebar é parcial, e é uma omissão
deliberada, não um bug.

O projeto da rota ATUAL sempre aparece expandido (`projetosAbertosEfetivo`),
mesmo sem estar no `Set` persistido — abrir "de graça" pela rota não grava
nada; só o clique explícito no chevron entra em `brabo.sidebar.open`.

**Desde o [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
(AT-404) esta lista é a ÚNICA navegação do projeto:** o trilho vertical saiu e
ela recebeu tudo o que só ele tinha — os três grupos com cabeçalho, a aba
ativa marcada, o `tablist` vertical nomeado pelo projeto, o teclado
(`ArrowDown`/`ArrowUp`/`Home`/`End` com volta, atravessando grupos) e os CINCO
contadores, cada um na sua aba e nunca somados. A omissão deliberada acima
continua valendo para projeto FECHADO e para o projeto aberto fora da moldura
(na Sessão, por exemplo): só Aprovações, do resumo. Com a moldura do projeto
montada, os cinco números saem do MESMO hook que ela usa
(`useContagensDoProjeto`), sem requisição nova. Recolhida, o quadrado do
projeto aberto abre um flyout com as mesmas abas.

- **Onde:** `apps/web/src/routes/Shell.tsx:564` (`projetosAbertosEfetivo`),
  `:504` (`useContagensDoProjeto`), `:519` (`irParaAba`), `:546`
  (`flyoutAberto`), `:243` (`contagensDoResumo`);
  `apps/web/src/routes/AbasDoProjeto.tsx:88` (`AbasDoProjeto`), `:44`
  (`itensDasAbas`), `:105` (`aoTeclar`);
  `apps/web/src/lib/contagens-do-projeto.ts:22` (`useContagensDoProjeto`),
  `:70` (`publicarAbaAtiva`), `:86` (`pedirAba`);
  `apps/web/src/lib/sidebar-state.ts` (`lerProjetosAbertos`/`gravarProjetosAbertos`)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe "conjuntos"),
  `apps/web/src/routes/Shell.test.tsx` (describe "Shell — abas do projeto
  aberto (ADR 0211)": as 12 abas, os cinco contadores separados, a ativa, o
  clique e a seta navegando, o flyout recolhido, a gaveta no telefone e o caso
  de falha — sem a moldura montada, só o número do resumo),
  `apps/web/src/routes/AbasDoProjeto.test.tsx` (grupos, ativa, contadores,
  teclado, roving tabindex, link por projeto), `apps/web/src/routes/project-tabs.test.tsx`
- **Origem:** PROGRAMA 28, Onda 2, frente B; ADR 0211 (AT-404)

### RN-197 — Duas cores de projeto, dois propósitos: identidade não é status {#rn-197}

O handoff pede um "ponto de cor do projeto" na linha expandida e o mesmo
princípio de cor na trilha recolhida. O produto já tinha um dot ali —
`NavStatusDot` — mas ele é **status** (orçamento/atividade recente,
derivado sem consulta própria de `useProjectsSummary`/`useProjectsStatus`,
RN-039), não identidade: a cor dele MUDA com o tempo.

Decisão, documentada em vez de resolvida: a linha expandida continua
mostrando só `NavStatusDot` (é informação acionável; duplicar um segundo
dot ao lado seria ruído). A cor de IDENTIDADE — estável por projeto, hash
determinístico do id sobre uma paleta fixa de tokens (`corDoProjeto`,
sem tabela nova, mesma ideia de `AGENTS[key].color`) — aparece só na
trilha recolhida, como borda do quadrado de iniciais, que é onde não há
espaço para os dois dots e onde a identidade (não o status) é o que ajuda a
achar o projeto certo entre vários quadrados parecidos.

Do mesmo jeito, o handoff pede "badge com o total de últimas iterações" no
projeto; o produto usa `pendingApprovalsCount` desde a RN-151, que é
posterior ao handoff e resolve um defeito real (um número que não
correspondia a nada acionável ao clicar). Este badge **não muda** — RN-151
continua valendo, e é o handoff que diverge aqui.

- **Onde:** `apps/web/src/lib/sidebar-state.ts` (`corDoProjeto`),
  `apps/web/src/routes/Shell.tsx` (`NavStatusDot`, comentário da divergência)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe "corDoProjeto")
- **Origem:** PROGRAMA 28, Onda 2, frente B — divergência entre
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` e RN-151

### RN-199 — Botão de tema no rodapé, funcional recolhido {#rn-199}

O rodapé da sidebar ganha um botão sol/lua que consome a API de
`apps/web/src/lib/tema.ts` da Onda 1/frente A (`temaAtual`,
`alternarTema`, `observarTema`) sem reimplementar nada — só o BOTÃO é novo.
Funciona recolhido (62px): o rótulo textual some, mas `aria-label`/`title`
continuam descrevendo o tema atual e o clique continua alternando.

- **Onde:** `apps/web/src/routes/Shell.tsx:130-148` (`BotaoDeTema`)
- **Teste:** `apps/web/src/lib/tema.test.ts` (a API, inalterada por esta RN)
  — `Shell.test.tsx` não duplica a suite do tema, só monta o Shell
- **Origem:** PROGRAMA 28, Onda 2, frente B

### RN-200 — Só Projetos e Atividades como itens globais {#rn-200}

Os dois itens sem rota do rodapé da nav ("Chat global"/"Configurações",
`title="em breve"`) saem. O handoff é explícito: só Projetos e Atividades
são itens GLOBAIS — tudo o mais é escopado a um projeto. "Configurações"
continua existindo, como ABA de projeto ([RN-196](#rn-196)) dentro da linha
expandida — o que sai é o item solto sem destino.

- **Onde:** `apps/web/src/routes/Shell.tsx` (o bloco `.globalNav`/
  `.inertNavItem` da FASE 17a foi removido, sem substituto global)
- **Teste:** `apps/web/src/routes/Shell.test.tsx` (describe "sem itens
  globais inertes")
- **Origem:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/README.md` seção "Navigation shell"

### RN-201 — Projeto/aba ativos persistem entre páginas; o colapso da sidebar é SÓ do usuário {#rn-201}

Duas chaves finais do handoff: `brabo.project` (o projeto ativo) e
`brabo.tab` (a aba ativa) — gravadas quando o usuário clica um link de aba
NA SIDEBAR (`LinhaDeAba`/o link de nome do projeto). `?tab=` na URL só vale
como deep-link INICIAL (`project-tabs.ts`, FASE 24) — trocar de aba dentro
de `ProjectPage.tsx` é estado local e não escreve na URL depois do
primeiro load, então estas chaves são o único jeito de a preferência
sobreviver entre uma navegação e outra. **Esta metade nunca mudou.**

**O auto-colapso da aba de Código SAIU (ADR 0126).** Até aqui a aba de
Código recolhia a sidebar sozinha para dar largura ao editor, sem gravar
preferência: `AutoCollapseContext`/`useAutoCollapseSidebar` em
`sidebar-state.ts`, registrados por `ProjectCodeTab.tsx` (a única
chamadora) e somados por OR ao colapso manual dentro do `Shell`. O contexto,
o hook, o estado `autoColapsado`, o `Provider` em torno de `<Outlet />` e o
`disabled` do botão de recolher — que existia só para proteger esse caminho
— foram todos removidos.

O motivo é estrutural: com o trilho vertical do projeto
(`routes/ProjectRail.tsx`, removido no ADR 0211) sempre presente, manter o auto-colapso poria a
trilha de ícones do Shell encostada no trilho do projeto — DOIS trilhos
verticais adjacentes, permanentes, na aba mais pesada do produto.

O que passa a valer: **o colapso da sidebar é uma decisão do USUÁRIO, e só
dele.** Continua manual, continua persistido em `brabo.sidebar.collapsed`
([RN-195](#rn-195)), e nenhuma tela recolhe a sidebar por conta própria.

**O custo, aceito e declarado:** a aba de Código passa a abrir com a sidebar
EXPANDIDA (264px) + o trilho do projeto (180px) + o trilho do próprio
`CodeShell` (48px) — 492px de moldura antes do primeiro caractere de código,
MEDIDOS no navegador, contra ~110px antes (62px de sidebar recolhida + 48px
do trilho do Código). Recolher manualmente continua possível e
ainda produz trilho do Shell ao lado do trilho do projeto — a diferença é
que agora quem escolheu foi o usuário, não o sistema.

**Revisto pelo [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
(AT-404):** o trilho do projeto saiu, e a moldura da aba Código passou a
**312px** com a sidebar expandida (264 + 48 do `CodeShell`) e **110px**
recolhida (62 + 48) — sem trilho duplo em nenhum dos dois casos. O colapso
continua só do usuário. A aba ativa que a sidebar marca vem da moldura do
projeto (`publicarAbaAtiva`), não só de `brabo.tab`.

- **Onde:** `apps/web/src/lib/sidebar-state.ts:80-105`
  (`lerProjetoAtivo`/`gravarProjetoAtivo`, `lerAbaAtiva`/`gravarAbaAtiva`, e
  o comentário que registra a remoção), `apps/web/src/routes/Shell.tsx:366-369`
  (só `colapsadoManual` sobrou), `apps/web/src/routes/ProjectCodeTab.tsx`
  (nenhuma chamada de colapso)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe "projeto e
  aba ativos"), `apps/web/src/routes/Shell.test.tsx` (describe "Shell —
  colapso da sidebar": a preferência só nasce de clique no botão e é sempre
  gravada). O describe "useAutoCollapseSidebar" foi removido junto com o
  hook.
- **Origem:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` seção 1; a metade do
  auto-colapso foi revista pelo
  [ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md)

### RN-202 — A aba `sessions` continua "Chat", nunca "Chat RAG" {#rn-202}

O handoff de design mais recente do PROGRAMA 28 chama a aba consultiva de
"Chat RAG" (`designs/Brabo Chat.dc.html`), mas o produto não tem essa
funcionalidade: não há pipeline de indexação por projeto, não há índice
vetorial, não há UI de citação de fonte. O ADR 0075 pôs `embed` no contrato de
`LLMProvider` — a operação existe e é PROVADA no Ollama —, mas nada ainda a
CONSOME. A aba `sessions` de hoje é o Chat consultivo comum da
[RN-104](#rn-104): um agente respondendo com o contexto da sessão, sem
produzir backlog, sem RAG nenhum por trás.

Rotular a aba "Chat RAG" hoje anunciaria uma capacidade que não existe — o
mesmo erro que o [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
já recusa para modelo de catálogo ("não ativar modelo descoberto
automaticamente"). O rótulo muda no dia em que a funcionalidade chegar, junto
com o dado por trás dele — nunca antes.

- **Onde:** `apps/web/src/routes/project-tabs.ts:144` (entrada `key:
  'sessions'`)
- **Teste:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-202 — a aba \`sessions\` continua
  "Chat", nunca "Chat RAG"'`)
- **ADR:** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)

### RN-203 — O handoff é referência visual, não teto de quantas abas o produto tem {#rn-203}

O handoff de design lista 7 abas de projeto (Visão geral, Criativo, Código,
Chat RAG, Gastos, Aprovações, Configurações); o registro
(`apps/web/src/routes/project-tabs.ts`) tem 10. As três a mais —
`executores` ([RN-121](#rn-121)), `backlog` ([RN-048](api.md#rn-048)) e
`insights` (hipóteses do Psicólogo aguardando decisão) — nasceram DEPOIS do
handoff ser desenhado, todas com dado real, contador derivado de consulta e
pelo menos uma RN própria com teste.

O handoff fixa como cada tela deve se PARECER — cores, tipografia,
espaçamento, o desenho da moldura —, e essa parte foi seguida à risca nesta
mesma mudança (header, régua, rolagem, largura do conteúdo). Ele não congela o
inventário de abas no dia em que foi escrito. Apagar as três para "bater" com
o handoff destruiria informação que o produto já sabia mostrar, pelo motivo
errado.

- **Onde:** `apps/web/src/routes/project-tabs.ts:91` (o `REGISTRO`)
- **Teste:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-203 — as 3 abas que o handoff não
  previu continuam no registro'`)
- **ADR:** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)

### RN-210 — "Recomendado" é uso real e custo, nunca nota calculada {#rn-210}

O bloco "Melhores modelos por capacidade" (Configurações) não tem coluna de
score. O handoff mostra uma nota por capacidade (código 9.4, imagem 9.1…), mas
é dado FICTÍCIO do mock — nenhum provider publica "qualidade de código" e o
produto não mede isso em lugar nenhum. Calcular um número aqui seria o mesmo
"palpite vestido de dado" que o [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)
proíbe para capability de MODELO, agora sobre qualidade.

Em vez disso, "recomendado"/"alternativa" saem de dois sinais reais, entre os
modelos que a curadoria DESTE workspace marcou para aquela capacidade (`uses`,
[RN-057](api.md#rn-057)): primeiro os mais usados por agentes DESTE projeto — a
mesma cascata que resolve o binding vigente de cada agente —, custo (do
catálogo, ascendente) como desempate. "O que o time já escolheu" é o sinal
mais honesto disponível sem inventar nota. Capacidade sem nenhum modelo curado
mostra "sem cobertura curada" — nunca esconde a linha, mesmo padrão que a
coluna Origem de `ModelsSection` já usa para o binding pulado.

- **Onde:** `apps/web/src/routes/settings/MelhoresModelosPorCapacidadeSection.tsx`
- **Teste:** `apps/web/src/routes/ProjectSettingsTab.test.tsx`
  (describe "MelhoresModelosPorCapacidadeSection")
- **ADR:** [0077](../adr/0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md)

### RN-211 — Gasto por provider na tela é Ranking, não paleta categórica inventada {#rn-211}

O handoff pede barras diárias empilhadas por provider e uma quebra por
provider. A skill de dataviz do repositório manda validar paleta
categórica por script antes de usar, nunca por olho: `validate_palette.js`
reprova toda combinação de 3+ tokens de `design/tokens.css` contra pelo
menos um dos dois temas — `--accent`+`--violet` é o único par que passa
nos dois (vários `--syntax-*` são literalmente o mesmo hex de
`--warning`/`--violet`/`--success`, medido). Com 9 providers (ADR 0043) e
2 cores validadas, ciclar a paleta é o anti-padrão que a própria skill
nomeia ("a 9th series is never a generated hue"), e inventar hex novo
violaria a instrução desta frente. A quebra por provider vira `Ranking` —
a mesma peça de "Por modelo"/"Por projeto"/"Por agente e pessoa", sem
identidade por cor. A série DIÁRIA por provider não é entregue:
`sumGroupedBy` (ADR 0076) agrupa por uma dimensão de cada vez, e não existe
agregação cruzada dia×provider no backend desta onda.

- **Onde:** `apps/web/src/lib/spend.ts` (bloco "Gasto por PROVIDER na
  tela"), `apps/web/src/routes/ProjectSpendTab.tsx` (`GastoDoWorkspace`)
- **Teste:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "a
  audiência do owner" — `'mostra os cinco recortes do workspace,
  incluindo provider'`)
- **ADR:** [0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-212 — Bloco "por projeto" é o TokenMeter plugado ao orçamento real {#rn-212}

A aba de Gastos ganha um bloco por PROJETO (não por audiência):
`OrcamentoDoProjeto` lê `GET /projects/:id/budget` e planta o resultado
direto no `TokenMeter` existente, que já implementa os limiares 70/90
(`tokenThreshold`) — nenhum componente novo. Três leituras: carregando
(silencioso, evita piscar antes do papel resolver a audiência de baixo),
sem orçamento definido (nota em texto, sem CTA) e erro (silencioso — na
prática quase sempre 403 de quem tem papel de WORKSPACE mas não é
`maintainer` no PROJETO, e mostrar banner de propósito seria alarme falso
para a maioria dos membros, o mesmo padrão já usado pelo `TokenMeter`
compacto de `ProjectPage.tsx`).

- **Onde:** `apps/web/src/routes/ProjectSpendTab.tsx`
  (`OrcamentoDoProjeto`)
- **Teste:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

### RN-214 — KPI de economia com modelo local fica de fora por falta de preço contrafactual {#rn-214}

`TokenMeter` já tem `savingsBRL`/`savingsPct` prontos para receber o
número, e permanecem não alimentados de propósito. O card exigiria um
preço CONTRAFACTUAL — quanto a mesma chamada teria custado num modelo
pago — que não existe em lugar nenhum do produto: o catálogo (ADR 0042)
só congela o preço do modelo REALMENTE usado (RN-044), e não há
mapeamento declarado "modelo local X ~ modelo pago Y". Inventá-lo aqui
seria a mesma classe de "nota vestida de dado" que a RN-210 já recusou
para ranking de capacidade. Pendência registrada no backlog para quando
existir um preço contrafactual defensável e versionado.

- **Onde:** `apps/web/src/routes/ProjectSpendTab.tsx` (comentário "KPI de
  economia com modelos locais — CORTE DECLARADO", fim do arquivo)

### RN-215 — Aba Problemas nasce com estado vazio honesto {#rn-215}

Não há lint nem teste integrado sobre o código do projeto gerido; a aba
Problemas do painel inferior (handoff `design_handoff_brabo`) diz isso
explicitamente em vez de mostrar contagem inventada (o mock do handoff traz
badge "3"). Mesmo padrão já usado pelo Terminal (FASE 25b) e pelo item
"Testes" desabilitado do rail.

- **Onde:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Teste:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` —
  "Problemas diz honestamente que não há lint/teste integrado, sem
  contagem inventada"

### RN-216 — Aba Saída nasce com estado vazio honesto {#rn-216}

Não há stream de comando de build/deploy nesta aba — ele dependeria do
terminal interativo (FASE 25b), que não existe. A aba explica isso e lembra
que `git push`/PR/deploy não saem pelo terminal de qualquer forma (RN-106).

- **Onde:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Teste:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` — "Saída
  diz honestamente que não há stream de comando, sem simular execução"

### RN-217 — Status bar da aba Código só mostra dado real {#rn-217}

A status bar de 24px (`CodeShell.tsx`) mostra `↑N ↓M` de commits da branch
atual (via `getCodeBranches`, mesma `queryKey` de `CodeBranchPicker` —
dedup, zero requisição extra, RN-090/091) e a linguagem do arquivo ativo
(`linguagemPorCaminho`). Posição do cursor e contagem de erros/testes do
mock do handoff ficaram de fora: `CodeEditor` não expõe seleção/caret
rastreável e não há lint/teste integrado (mesma decisão da RN-215).

- **Onde:** `apps/web/src/routes/code/CodeShell.tsx`
- **Teste:** `apps/web/src/routes/code/CodeShell.test.tsx` — "a status bar
  mostra ↑/↓ real da branch atual" e "sem ahead/behind (branch em dia), a
  status bar não mostra o par vazio"

### RN-218 — Foco visível nas abas próprias do painel inferior {#rn-218}

As abas de `CodeBottomPanel.tsx` são implementação própria (não o `Tabs` do
design system) e não herdavam o `:focus-visible` calibrado que
`Tabs.module.css` ganhou na Onda 2/frente C. Corrigido com o mesmo padrão de
`Input.module.css` (ADR 0036), incluindo `forced-colors`.

- **Onde:** `apps/web/src/routes/code/CodeBottomPanel.module.css`

### RN-227 — Selo de status da sessão cobre os 5 estados reais, não os 4 do handoff {#rn-227}

O handoff pede 4 selos (ativa/aguardando/fechada/abortada) para os 5
estados reais da máquina (`created/active/closing/closed/closed_abnormally`).
`closed_abnormally`→abortada e `created`→aguardando são diretos. `closing`
NÃO é fundido com "fechada": ganha selo próprio ("encerrando", tom
`accent`, pulsante), porque em `closing` o desfecho (`closed` ou
`closed_abnormally`) ainda não é conhecido — chamá-la de "fechada"
mentiria sobre isso.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`SELO_DO_STATUS`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "ProjectSessionsTab — selo de status (RN-227)"

### RN-228 — Filtro pill agrupa os 2 estados sem pill própria por TRAJETÓRIA {#rn-228}

Os filtros pill do handoff (todas/ativas/fechadas/abortadas) só cobrem 4
dos 5 estados. `created` (aguardando) entra no pill "Ativas" — ainda não
chegou a lugar nenhum, é "sessão em jogo". `closing` entra no pill
"Fechadas" — já está a caminho de fechar sem erro. O SELO de cada linha
(RN-227) nunca é reescrito pelo filtro; o pill só agrupa.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`correspondeAoFiltro`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "filtro pill agrupa os 2 estados sem pill própria (RN-228)"

### RN-229 — KPI "custo do mês" da aba Criativo é o consumo do ATOR, não o total do projeto {#rn-229}

Reaproveita `getMySpend(projectId, 30)` — a MESMA queryKey que
`ProjectSpendTab.tsx#MeuConsumo` usa para a visão do membro (RN-101, ADR
0063), sem agregação nova. NUNCA mostra o total do projeto somando todo
mundo (`porProjeto` em `getWorkspaceSpendReport`), porque esse dado é
owner-only e a aba Criativo é vista por qualquer membro do projeto —
mostrar o total geral vazaria gasto alheio para quem a RN-060/101 não
autoriza a ver.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "KPIs da aba Criativo", casos "caminho feliz" e "CASO DE FALHA"

### RN-230 — KPI "taxa ideação → commit" é declarado ausente, nunca calculado {#rn-230}

Não existe, em lugar nenhum do produto, vínculo entre uma sessão criativa e
o commit que ela produziu. A aba Criativo mostra "—" com a frase "não
medido: sessão não é vinculada a commit hoje" em vez de inventar um
cálculo — mesma classe de erro que o ADR 0042 já recusa para nota de
modelo.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — "'Taxa
  ideação → commit' é DECLARADA ausente — nunca um número calculado"

## PROGRAMA 28 — Onda 4, frente E2: virtualização de linha e minimapa na aba Code (RN-239..242)

### RN-239 — Virtualização de linha: só a janela visível vira nó de DOM {#rn-239}

`CodeEditor.tsx` renderiza só as linhas dentro da janela visível (mais
`OVERSCAN = 20` de margem) como `[data-line-row]`; o resto vira dois
espaçadores que reservam a altura sem existir como nó. A decisão de NÃO
usar `react-window`/`react-virtual`: a altura de linha é FIXA
(`ALTURA_LINHA = 21`, monoespaçado), o que reduz "qual linha está visível"
a uma divisão inteira sobre `scrollTop` — o problema que essas libs
resolvem de verdade é altura VARIÁVEL por item, que não é o caso da aba
Code.

- **Onde:** `apps/web/src/routes/code/CodeEditor.tsx` (linhas 38-96, 45,
  48)
- **Teste:** `apps/web/src/routes/code/CodeEditor.test.tsx` — describe
  "CodeEditor — virtualização", "caminho feliz: arquivo de 5.000 linhas
  renderiza uma janela pequena de nós, não o arquivo inteiro" (`< 150` nós
  `[data-line-row]`) e "rolar para o meio do arquivo troca a janela —
  linha 1 some, linhas do meio aparecem"

### RN-240 — Sem medição de altura, degrada para janela padrão generosa, nunca renderiza tudo {#rn-240}

Quando `containerHeight` ainda não foi medido (1º render, ou jsdom sem
`ResizeObserver` em teste), a janela cai para `LINHAS_SEM_MEDICAO = 40` —
generosa o bastante para não truncar os arquivos pequenos que os testes
usam, pequena o bastante para nunca virar "renderiza tudo" num arquivo
grande de verdade.

- **Onde:** `apps/web/src/routes/code/CodeEditor.tsx` (linha 57)
- **Teste:** `apps/web/src/routes/code/CodeEditor.test.tsx` — "falha/borda:
  sem medição de altura (jsdom sem ResizeObserver, clientHeight 0),
  degrada para uma janela padrão em vez de não renderizar nada"

### RN-241 — Minimapa reusa a MESMA tokenização da virtualização — zero segundo passe sobre o arquivo {#rn-241}

`minimap.ts` não tokeniza nada: ele resume a saída que `highlight.ts` já
produziu (`HighlightToken[][]` de `highlightFile`, chamada uma vez só) —
a MESMA que a virtualização usa para colorir as linhas visíveis.
Tokenizar de novo só para o minimapa pagaria o custo de leitura do
arquivo pela segunda vez, e por isso o minimapa só entra depois de a
virtualização estar de pé, nunca antes.

- **Onde:** `apps/web/src/routes/code/minimap.ts` (linhas 1-18, 39)
- **Teste:** `apps/web/src/routes/code/minimap.test.ts`

### RN-242 — Minimapa é CANVAS, um nó de DOM só, nunca um `<div>` por linha {#rn-242}

O desenho é em `<canvas>` (`desenharMinimapa`), não em elemento por
linha: um minimapa com um nó por linha dobraria de novo a contagem que a
virtualização (RN-239) acabou de cortar. Sem contexto de canvas 2D
disponível (jsdom sem o pacote `canvas`), o overlay clicável continua
funcionando — só o desenho é pulado, nunca a interação.

- **Onde:** `apps/web/src/routes/code/minimap.ts` (linhas 14-16, 91)
- **Teste:** `apps/web/src/routes/code/CodeEditor.test.tsx` — describe
  "CodeEditor — minimapa", "caminho feliz: clicar no minimapa rola o
  editor e troca a janela renderizada" e "falha: sem contexto de canvas
  2D (jsdom sem o pacote `canvas`), o overlay continua clicável e nada
  quebra"

## PROGRAMA 28 — Onda 4, frente H4: os colapsos ad-hoc restantes migram para o `Disclosure` (RN-249..251)

### RN-249 — Alvo de clique do marco com detalhe sobe de 20px para o piso de 24px do `Disclosure` {#rn-249}

O marco COM detalhe de `AgentTimelineTree` tinha `min-height: 20px` no
cabeçalho clicável — abaixo do WCAG 2.2 AA 2.5.8 (Target Size, mínimo
24px) que um comentário anterior já prometia sem cumprir. A migração
para o `Disclosure` compartilhado corrige isso de graça: o componente
genérico já nasce em 24px, e não é preciso lembrar de setar a régua em
cada novo consumidor.

- **Onde:** `apps/web/src/components/AgentTimelineTree.module.css`
  (linhas 135-155, `.marcoLinha`)
- **Teste:** `apps/web/src/components/AgentTimelineTree.test.tsx`
- **ADR:** nenhum — correção pontual de a11y, mesmo padrão do ADR 0036

### RN-250 — Faixa de arquivo do diff em `ApprovalCard` NÃO migra para o `Disclosure` — a animação própria é a razão {#rn-250}

A faixa de arquivo do diff em `ApprovalCard` gira o chevron por
`transform: rotate(90deg)` com transição própria
(`.chevron.open`/`ApprovalCard.module.css`); o `Disclosure` genérico
TROCA o ícone (seta direita → seta baixo) sem animação nenhuma. Forçar a
migração apagaria a micro-interação sem ganho — a exclusividade (só um
arquivo aberto por vez) já vem de fora (`expandedFile`), o mesmo que o
`Disclosure` controlado faria. O que faltava, e não era peculiaridade —
é o mesmo defeito que o `Disclosure` existe para fechar —, era
`aria-controls` apontando para uma região nomeada: corrigido diretamente,
sem trocar de componente.

- **Onde:** `apps/web/src/components/ApprovalCard.tsx` (linhas 511-539)
- **Teste:** `apps/web/src/components/ApprovalCard.test.tsx`

### RN-251 — Cinco call sites migram para o `Disclosure` compartilhado; o componente ganha `testId` como único hook novo {#rn-251}

`ModelCatalogSection` (a referência original que gerou o componente na
FASE 16), `AgentTimelineTree` (ramo + marco), `code/CodeExplorer.tsx`
(pasta da árvore) e `code/CodeShell.tsx` (painel inferior) passam a usar
o `Disclosure` compartilhado — nenhuma das seis implementações ad-hoc que
sobreviveram à FASE 16 fica de fora, exceto a exceção declarada da
RN-250. `testId` é o único prop novo que um consumidor precisou (`data-
testid` no cabeçalho, para os testes existentes continuarem
selecionando o botão certo sem reescrever a suíte inteira). A região
controlada existe no DOM mesmo fechada — só `hidden` e sem os filhos
montados —, porque `aria-controls` apontando para um id que não resolve
é pior que não ter o atributo (leitor de tela anunciaria controle de
algo inexistente); é essa mesma propriedade que permite colapsar listas
caras (o catálogo do OpenRouter tem 338 modelos) sem montar o que
ninguém está vendo.

- **Onde:** `apps/web/src/components/ui/Disclosure.tsx` (linhas 33-71),
  `apps/web/src/components/ModelCatalogSection.tsx`,
  `apps/web/src/components/AgentTimelineTree.tsx`,
  `apps/web/src/routes/code/CodeExplorer.tsx`,
  `apps/web/src/routes/code/CodeShell.tsx`
- **Teste:** `apps/web/src/components/ui/Disclosure.test.tsx`,
  `apps/web/src/routes/code/CodeExplorer.test.tsx`,
  `apps/web/src/routes/code/CodeShell.test.tsx`

## PROGRAMA 28 — Onda 5, frente G3: a tela do Chat RAG (RN-252..254, ADR 0082)

### RN-252 — A tela do Chat RAG mostra as duas degradações honestas que o backend já declara, nunca as esconde {#rn-252}

`HybridSearchUseCase` já devolve `vectorAvailable: false` quando o provider
de embedding não respondeu (RN-233) e `GetRagCoverageUseCase` já nunca
inclui timestamp de indexação (RN-237) — mas um contrato honesto no
backend não garante uma tela honesta se ela decidir não ler os dois
campos. `ProjectRagTab` mostra um aviso acima dos resultados quando
`vectorAvailable` é `false` (com `vectorUnavailableReason`, quando
existe), e `RagCoveragePanel` só renderiza contagem REAL (`filesIndexed`/
`filesInRepo`, `sessionsIndexed`/`sessionsInProject`) — nenhum texto do
tipo "reindexado há Xmin" nasce nesta tela, porque a resposta não carrega
esse dado e inventá-lo mentiria (mesma régua do ADR 0042 para nota de
modelo).

- **Onde:** `apps/web/src/routes/ProjectRagTab.tsx` (linhas 27-31, 176-182),
  `apps/web/src/components/rag/RagCoveragePanel.tsx` (linhas 27-34)
- **Teste:** `apps/web/src/routes/ProjectRagTab.test.tsx` — "CASO DE FALHA
  (degradação honesta): vectorAvailable false avisa..."; `apps/web/src/components/rag/RagCoveragePanel.test.tsx`
  — "CASO DE FALHA (degradação honesta): nunca escreve..."
- **ADR:** [0082](../adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-253 — Citação de origem `session` navega até o EVENTO exato, reusando o mecanismo do Psicólogo {#rn-253}

`RagCitationCard` não inventa um segundo caminho de navegação: origem
`{ kind: 'session', sessionId, eventId }` chama `useNavigate` para
`/projects/:projectId/sessions/:sessionId` com `search: { highlightEvent:
eventId }` — a MESMA rota e o MESMO parâmetro que os chips de evidência
do Psicólogo já usam (`HypothesisCard.tsx`, Fase 4b) para rolar o fio até
o evento e destacá-lo. Origem `{ kind: 'file' }` mostra caminho e
`headingPath` como texto, sem link: a aba Código não tem hoje deep-link
por caminho, e construir essa navegação está fora do escopo desta
frente.

- **Onde:** `apps/web/src/components/rag/RagCitationCard.tsx` (linhas
  32-38, 49-56)
- **Teste:** `apps/web/src/components/rag/RagCitationCard.test.tsx` —
  "caminho feliz: origem de sessão navega até o evento exato ao clicar"
- **ADR:** [0082](../adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-254 — O botão de reindexar é maintainer/owner na TELA, espelhando a régua da rota {#rn-254}

`POST .../rag/reindex` já exige `role:maintainer` (RN-238) — quem
garante é a api. `ProjectRagTab` espelha a régua no CLIENTE pelo mesmo
padrão que `ProjectSettingsTab`/`ProjectApprovalsTab` já usam para outros
gates de `maintainer` (`useCurrentWorkspaceWithRole`, já que não existe
hoje um papel de PROJETO no cliente, só o de workspace que a listagem
devolve): o botão "Reindexar agora" nem aparece para quem não é
`owner`/`maintainer`, em vez de aparecer desabilitado — reindexar dispara
N chamadas ao repositório do projeto e ao provider de embedding (mesma
régua "muda o que o produto gasta sem perguntar" do teto de paralelismo,
RN-083), e um botão visível mas sempre recusado só ensinaria a
ignorar o 403.

- **Onde:** `apps/web/src/routes/ProjectRagTab.tsx` (linhas 43-44, 109)
- **Teste:** `apps/web/src/routes/ProjectRagTab.test.tsx` — "botão de
  reindexar só aparece para maintainer/owner..."; "maintainer vê e pode
  disparar a reindexação"
- **ADR:** [0082](../adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-268 — A aba Terminal mostra o estado REAL do container, nunca finge um terminal que não existe {#rn-268}

O plano original desta frente era o terminal interativo completo, mas a
investigação confirmou que a FASE 25b continua cortada: nenhum serviço monta
`/var/run/docker.sock`, e mesmo depois do ADR 0081 (Onda 4) nada transiciona
`project_containers` em produção. Implementar um terminal que finge executar
comandos — ou que roda no mesmo container do monorepo do Brabo, a dívida que
o ADR 0055 já descreve como política e não isolamento — seria inventar
capacidade, o mesmo erro que os ADRs 0041/0042 já recusam para provider de
LLM e modelo de catálogo.

O que a aba GANHA é honesto: sob o texto explicativo que já existia (FASE
26b), `CodeBottomPanel` busca `GET .../container/lifecycle` (RN-267) só
enquanto a aba Terminal está aberta (`enabled: aba === 'terminal'` — sem
polling em segundo plano, a mesma disciplina de tráfego da RN-107) e mostra
o status com um `Badge` (`provisioning`/`running`/`stopped`/`failed`/
`removed`, em pt-BR), há quanto tempo, e o `failureReason` quando o estado é
`failed`. Projeto nunca provisionado — o caso comum hoje — mostra a frase
"ainda não foi provisionado", nunca um badge inventado.

- **Onde:** `apps/web/src/routes/code/CodeBottomPanel.tsx`,
  `apps/web/src/routes/code/CodeBottomPanel.module.css`,
  `apps/web/src/lib/api-client.ts` (`getContainerLifecycle`),
  `apps/web/src/lib/api-types.ts` (`CicloDeVidaDoContainer`)
- **Teste:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx`
  (describe "Terminal — o estado REAL do ciclo de vida do container")
- **Borda:** o terminal interativo em si NÃO nasce aqui — é FASE 25b, que
  segue cortada e depende da parede física do container (o worktree do
  agente vivendo lá dentro), não desta rota de leitura.
- **ADR:** [0083](../adr/0083-terminal-mostra-estado-real-do-container.md)

## UX Designer — o quinto agente conversacional (RN-285..287, ADR 0087)

### RN-287 — `uxDesignerActive` no roster, nas DUAS fontes (RN-090) {#rn-287}

Mesmo critério de `infraActive`: handoff `accepted` endereçado a
"ux-designer" na sessão. `apps/web/src/lib/agent-status.ts`
(`rosterFactsFromEvents`/`rosterFromFacts`) ganhou o fato e o empurra
condicionalmente no roster como agente SOLO — sem `pushAreaMembers`
correspondente, porque ele não é área.

A RN-090 exige as DUAS fontes em sincronia (painel do time via event log; o
card do dashboard via `ProjectCardSummary.roster`, computado na api) para que
um agente novo não apareça num lugar e falte no outro. O fato entrou nas
duas: `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
amplia a MESMA consulta de `infraActive` (um `inArray(handoffs.toAgent,
['infra', 'ux-designer'])` no lugar do `eq` único, partido em dois `Set` por
`toAgent`) — nenhuma consulta nova, a contagem de doze consultas constantes
que `projects-summary.repository.spec.ts` prova não cresce.

- **Onde:** `apps/engine/lib/engine/agents/ux_designer_server.ex`,
  `ux_designer_tools.ex`, `ux_designer_supervisor.ex`;
  `apps/engine/lib/engine/harness/agents.ex` (identidade),
  `artifact_schemas.ex` (tipo `prototipo_navegavel`);
  `apps/engine/lib/engine/application.ex`;
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`;
  `apps/web/src/lib/agents.ts`, `agent-status.ts`;
  `apps/api/src/application/ports/projects-summary-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
- **Teste:** `apps/engine/test/engine/agents/ux_designer_server_test.exs`,
  `ux_designer_tools_test.exs`; `apps/web/src/lib/agent-status.test.ts`;
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (describe com os dois `toAgent` na mesma sessão)
- **ADR:** [0087](../adr/0087-ux-designer-agente.md)

---

## Onda 1 do ADR 0104 — `execution_mode` em três valores, workspace verificado pelo runner

### RN-428 — Carrossel de promoção de histórias sobrevive à janela de eventos {#rn-428}

`promocoesPendentes`/o carrossel de promoção do PO (RN-148) não depende mais
de scan sobre a janela dos últimos 200 eventos de `useSessionEvents`. A fonte
de conteúdo/contagem é `useBacklog` (`Story.proposedReady`, por sessão,
completa e sem janela) — numa sessão longa, `backlog.story_promotion_proposed`
sai da janela enquanto a história continua pendente de verdade, e antes disso
o carrossel encolhia (ou sumia) silenciosamente. Mesma classe de bug que a
RN-180 já corrigiu para `ContextAside`.

Quando a story não está no backlog carregado (query ainda não respondeu),
degrada story a story para o scan de janela de sempre. O ancoramento na
timeline continua vindo do evento dentro da janela quando ele existir; se o
evento que abriu a leva já saiu da janela, o carrossel ancora no TOPO do
trecho visível em vez de sumir — nunca esconder um estado real por causa de
corte de leitura.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`useMemo` `timeline`)
- **Teste:** `apps/web/src/routes/SessionPage.carrossel-janela-estourada.test.tsx`
- **ADR:** nenhum — correção de bug, mesma classe já corrigida pela RN-180
- **Origem:** achado por uso real ("o chat falhou em mostrar o carrossel do PO")

---

### RN-431 — O selo da aba Arquitetura conta pendência de validação, nunca "diagrama não gerado" {#rn-431}

`contagens.arquiteturaPendente` (régua de abas) vem de
`architecture.pendencies.length` (divergência de validação cruzada
história↔módulo), não de `c4Diagram.status === 'sem_diagrama'`. As outras
três contagens da régua (`promocoesPendentes`, `aprovacoesPendentes`,
`hipotesesPendentes`) significam todas "algo espera SUA decisão" — gerar o
diagrama é trabalho do Arquiteto, não fila de decisão do usuário, e
badigar por isso seria ruído.

- **Onde:** `apps/web/src/routes/ProjectPage.tsx`
- **Teste:** `ProjectPage.test.tsx`
- **ADR:** nenhum
- **Origem:** decisão de design tomada ao extrair a aba Arquitetura da
  Visão Geral

---

### RN-432 — Preferência de idioma vem no payload de login/refresh, nunca numa chamada extra {#rn-432}

> Revisada pela [RN-891](api.md#rn-891): a coluna aceita também `ru` e `zh-Hans`,
> e o padrão do web passou de `en` para `pt-BR` (ADR 0216).

Fundação de i18n da interface (Onda 6a de um programa maior — a extração em
massa das strings do resto do app é etapa separada, em paralelo). Coluna
`locale` em `users` (`'pt-BR' | 'en'`, default `'pt-BR'` — nunca flipa
silenciosamente quem já tem conta). `EmitirSessaoUseCase` é o ÚNICO ponto
que emite sessão (login, refresh, login social) — `locale` embutido no
corpo de `/auth/login`/`/auth/refresh` a partir dele, sem round-trip
adicional. `GET/PATCH /users/me/preferences` existe como via REDUNDANTE,
pra `AccountPage` reafirmar o valor sem esperar o próximo refresh.

`en` é o idioma DEFAULT do app a partir de agora (`react-i18next`, nova
dependência — mesma régua de "dependência nova precisa de justificativa"
que `mermaid`/`@xterm/xterm` já seguiram); `pt-BR` continua disponível.
`apps/web/src/lib/idioma.ts` (mesmo desenho de `tema.ts`): o SERVIDOR é a
fonte de verdade, `localStorage['brabo.locale']` é só cache pra evitar
flash de idioma errado no primeiro paint. Usuário sem conta ainda usa
`navigator.language` só como sugestão de EXIBIÇÃO, nunca persiste nada
antes de existir conta.

- **Onde:** `apps/api/src/application/use-cases/auth/emitir-sessao.use-case.ts`,
  `apps/api/src/interfaces/http/iam/user-preferences.controller.ts`,
  `apps/web/src/lib/idioma.ts`, `apps/web/src/lib/i18n.ts`,
  `apps/web/src/routes/AccountPage.tsx`
- **Teste:** `apps/web/src/lib/idioma.test.ts`,
  `apps/web/src/routes/AccountPage.test.tsx`,
  `apps/api/test/application/use-cases/auth/*.spec.ts`,
  `apps/api/test/interfaces/route-surface.spec.ts`
- **ADR:** nenhum — extensão aditiva de um choke point já existente, sem
  mudar o formato de sessão pra ninguém que não usa o campo novo
- **Origem:** pedido do dono do produto — interface e docs em inglês por
  padrão, com português preservado

---

## O explorador de pasta do Runner vira três colunas, e a criação de um projeto `runner` deixa de esperar o passo final (RN-436/436)

Duas mudanças pedidas pelo dono do produto depois de testar a criação de um
projeto real: (1) o navegador de pasta existente
(`FolderBrowserModal`) era uma lista simples com breadcrumb, quando a
referência visual que ele mandou (um picker estilo GNOME Files/GTK, de três
colunas) já existia como handoff de design pronto pra adaptar; (2) "Procurar
pasta..." não funcionava na TELA DE CRIAÇÃO do projeto — só depois de
criado — porque o ticket do canal do Runner (ADR 0107) é ancorado a um
`projectId` que, até esta correção, só nascia na confirmação.

### RN-436 — `FolderBrowserModal` vira um explorador de três colunas: atalhos, lista com um clique seleciona/duplo clique entra, e um painel de detalhes {#rn-436}

O layout de lista única virou três colunas dentro do `Modal size="full"`:
atalhos (Pasta pessoal, que chama `diretorioInicial()`; Raiz, `/`), a lista
central com breadcrumb, e um painel de detalhes à direita. O protocolo
(`FsEntrada`, em `apps/web/src/lib/fs-browser-channel.ts`) só tem
`{ nome, isDir }` — sem tamanho nem data de modificação — e não foi
estendido (mexeria em `apps/engine`/`apps/runner`, fora do escopo desta
entrega); o painel de detalhes só mostra o que dá pra derivar client-side:
nome, tipo, e a contagem de itens quando o item exibido é a pasta JÁ ABERTA
(nunca de uma pasta só selecionada, que exigiria uma chamada extra ao
runner).

Os DOIS gestos que antes estavam fundidos num único clique (que já navegava
pra dentro da pasta) foram separados: um clique agora só SELECIONA (destaca
o item e atualiza o painel de detalhes) e um duplo clique ENTRA. O botão
final ("Usar esta pasta", renomeado de "Selecionar esta pasta" — a chave
`folderBrowserModal.select` de `pt-BR`/`en` mudou junto) usa o item
selecionado quando houver um (`selected.kind === 'dir' ? join(path,
selected.name) : path`) ou a pasta aberta no momento quando não houver
nenhum. A lista deixou de filtrar arquivos — a listagem inteira aparece
agora, com arquivos renderizados como `<div aria-disabled>` em vez de
`<button>`: visualmente apagados e sem gesto nenhum, porque só pasta
continua navegável/selecionável.

- **Onde:** `apps/web/src/components/FolderBrowserModal.tsx`,
  `FolderBrowserModal.module.css`,
  `apps/web/src/locales/{pt-BR,en}/terminal.json`
- **Teste:** `apps/web/src/components/FolderBrowserModal.test.tsx` — clique
  único seleciona sem chamar `listarDiretorio` de novo; duplo clique navega;
  arquivo aparece na lista mas não é alcançável por `getByRole('button')`;
  atalhos "Pasta pessoal"/"Raiz"; e "Usar esta pasta" usa o selecionado
  quando houver, senão a pasta aberta
- **ADR:** nenhum — redesenho de UI sobre um componente que já existia, sem
  mudança de protocolo nem de fronteira de dado (o ADR 0107 continua
  descrevendo o mecanismo por trás)
- **Origem:** pedido do dono do produto, depois de testar a criação de um
  projeto real e achar o navegador de pasta pouco parecido com um
  explorador de arquivos de verdade — referência visual enviada por ele
  (picker de três colunas, estilo GNOME Files/GTK)

### RN-437 — No modo `runner`, "Procurar pasta..." cria o projeto ANTECIPADAMENTE, e a confirmação final reusa por SNAPSHOT de identidade {#rn-437}

O ADR 0107 já tinha declarado esta lacuna na própria seção de Consequências:
sem projeto ainda, o ticket do canal (RN-429) não tem a quem se ancorar, e
"Procurar pasta..." caía sempre no estado "disponível depois que o projeto
existir" — mesmo no modo `runner`, onde a criação NÃO depende de validar
disco (ADR 0104, item 2). Fechado pelo [ADR 0108](../adr/0108-projeto-runner-nasce-ao-navegar-pasta-no-wizard.md):
`NewProjectWizard.tsx` (`handleProcurarPasta`) chama `createProject` ao
clicar "Procurar pasta..." quando `modoDeWorkspace === 'runner'` — usando o
caminho já digitado, ou um placeholder lexicalmente válido e claramente
provisório (`/workspace-a-confirmar`) quando o campo ainda está vazio, nunca
bloqueando o clique. O modo `mounted` **não muda**: continua com
`projectId={null}` até a confirmação, porque ali a validação de disco roda
na criação e criar cedo com caminho vazio devolveria a recusa da RN-422 num
momento em que o usuário nem pensou em caminho ainda.

Um SNAPSHOT de identidade (`{ name, externalId, adotando }` — nunca
`caminhoLocal`, cujo refino é o PROPÓSITO de navegar) decide quando reusar:
clicar "Procurar pasta..." de novo com a identidade intacta reabre o modal
com o MESMO projeto, sem criar outro; mudar o nome (ou voltar e trocar o
repositório a adotar) invalida o snapshot, e a próxima navegada cria um
projeto novo. `handleConfirm` aplica a mesma régua — reusa o projeto
já criado ao navegar quando o snapshot ainda bate, e só chama `createProject`
quando não há nada pra reusar. `montarPayloadDeCriacao`, função pura extraída
do que antes vivia só dentro de `handleConfirm`, é reaproveitada pelos dois
caminhos.

O pré-requisito do botão é dito ANTES do clique (AT-214): neste modo a lista
vem do agente local, então sem um `brabo-runner` rodando e conectado ao
projeto recém-criado o modal só consegue mostrar a espera e o onboarding. A
tela passou a dizer isso em TEXTO abaixo do campo (`aviso-procurar-runner`,
ADR 0064 — nunca tooltip), com o comando
`brabo-runner --project <id> --dir <pasta>` e a alternativa que não depende
de nada: digitar o caminho no campo, que o runner confirma ao conectar. O
mecanismo (a criação antecipada, o transporte pelo agente local) não mudou.

- **Onde:** `apps/web/src/routes/NewProjectWizard.tsx`
  (`handleProcurarPasta`, `handleConfirm`, `montarPayloadDeCriacao`,
  `snapshotDeIdentidade`/`mesmaIdentidade`)
- **Teste:** `apps/web/src/routes/NewProjectWizard.test.tsx`, describe
  `navegação de pasta antecipada no modo Runner` — cria o projeto e abre o
  modal com o id real; usa o placeholder quando o campo está vazio; clicar
  de novo sem mudar nada não cria outro; mudar o nome invalida o snapshot e
  cria um projeto diferente; `handleConfirm` reusa em vez de duplicar. O
  teste preexistente "'Procurar pasta...' mostra o estado declarado" (modo
  `mounted`) continua verde, sem alteração — prova que o escopo não vazou
- **ADR:** [0108](../adr/0108-projeto-runner-nasce-ao-navegar-pasta-no-wizard.md)
  — mudança estrutural (QUANDO um projeto passa a existir no fluxo de
  criação), com o efeito colateral aceito de projeto "não provisionado"
  órfão quando o wizard é fechado sem terminar (o MESMO estado que qualquer
  criação interrompida hoje já produz, não uma regressão nova)
- **Origem:** pedido do dono do produto, depois de testar a criação de um
  projeto real no modo Runner e não conseguir navegar pastas antes de
  confirmar — a lacuna que o ADR 0107 já tinha declarado e adiado

### RN-438 — `fs-browser-channel.ts` tinha o MESMO bug de path duplicado que a RN-433 já tinha corrigido no `terminal-channel.ts` irmão {#rn-438}

Achado ao verificar a RN-437 ponta a ponta no Chrome, contra o engine real:
o modal abria com o `projectId` certo, mas a conexão caía na hora com "A
conexão com o runner caiu — feche e reabra para tentar de novo." em vez de
mostrar `RunnerOnboardingPanel`. `apps/web/src/lib/fs-browser-channel.ts`
concatenava `'/runner/websocket'` a um `engineWsUrl` que a api já devolve
PRONTO (`ws://host:porta/runner`, de `engineWsUrlPublico()`) — o mesmo
`Socket` do `phoenix.js` ainda acrescenta `/websocket` sozinho no
construtor, e o resultado batia no engine como `GET
/runner/runner/websocket/websocket`, que `Phoenix.Router.NoRouteError`
recusa. É EXATAMENTE o item 3 da RN-433, só que no módulo IRMÃO — a
correção de lá nunca tinha sido replicada aqui, e nenhuma suite pegava
porque este módulo não tinha teste nenhum até agora (o próprio docblock
dizia, incorretamente, que `terminal-channel.test.ts` cobria "indiretamente").
Fix: mesma linha da RN-433 — `engineWsUrl.replace(/^http/, 'ws')`, sem
concatenar path nenhum.

Verificado END TO END contra um projeto `runner` real (owner logado,
`teste-navegacao`, criado pela RN-437): antes da correção, o modal caía
direto no erro de conexão; depois, mostra `RunnerOnboardingPanel` com o
comando `brabo-runner --project <id-real> --dir <pasta>` em menos de 2s —
o resultado esperado sem um runner de verdade conectado.

- **Onde:** `apps/web/src/lib/fs-browser-channel.ts`
- **Teste:** `apps/web/src/lib/fs-browser-channel.test.ts` (novo — o
  módulo não tinha teste próprio nenhum até esta correção). Caminho feliz
  confirma `socket.url === engineWsUrl` sem concatenação; mais
  `diretorioInicial`/`listarDiretorio` roundtrip, falha ao buscar ticket, e
  `fechar()` idempotente
- **ADR:** nenhum — restaura o comportamento que o ADR 0103/0107 e a RN-433
  já declaravam como intenção, só que num módulo que a correção anterior não
  alcançou
- **Origem:** achado testando manualmente a RN-437 (criação antecipada de
  projeto `runner`) contra o Chrome e o engine real — a primeira vez que
  `FolderBrowserModal` foi exercitado ponta a ponta contra uma conexão de
  verdade, porque antes desta entrega "Procurar pasta..." nunca alcançava
  um projeto real antes da confirmação

## Pasta local anexada vira o quarto escopo do índice RAG, lido pelo NAVEGADOR (RN-455..457, ADR 0113)

### RN-456 — Teto agregado REJEITA (400) o upload inteiro; arquivo individual grande/binário só é PULADO {#rn-456}

Diferente de `docs`/`adr` (uma varredura em background, sem ninguém
olhando), anexar uma pasta é um gesto ÚNICO com um seletor de pasta na
tela. `IndexLocalFolderUseCase` recusa (400) o lote inteiro quando a
quantidade de arquivos (`RAG_LOCAL_FILE_COUNT_LIMIT`, 500) ou os bytes
somados (`RAG_LOCAL_TOTAL_BYTES_LIMIT`, 8 MiB) estouram — nunca trunca em
silêncio, porque quem clicou "Anexar" pode escolher uma pasta menor. Um
arquivo individual grande demais (`RAG_LOCAL_FILE_BYTES_LIMIT`, 512 KiB) ou
de extensão não reconhecida (`RAG_LOCAL_ALLOWED_EXTENSIONS`, allowlist) é
só PULADO (`filesSkipped`), nunca derruba o lote — a mesma distinção que
`IndexProjectDocsUseCase` já faz implicitamente ao filtrar só `.md`.
Caminho com `..` ou barra inicial é RECUSADO (400), nunca aceito
silenciosamente, mesma disciplina de nunca confiar em caminho vindo do
cliente (RN-092/095) mesmo quando ele "não deveria" conter isso.
`apps/web/src/lib/rag-local-limits.ts` espelha os mesmos números no
cliente, só como conveniência de UX (resumo antes de enviar) — quem
garante de verdade é o servidor.

- **Onde:** `apps/api/src/domain/rag/rag-search-limits.ts` (`RAG_LOCAL_*`),
  `apps/api/src/application/use-cases/rag/index-local-folder.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/rag/index-local-folder.use-case.spec.ts`
  (tetos de quantidade e bytes somados rejeitam; arquivo grande/binário é
  pulado; caminho com `..`/barra inicial é recusado)
- **ADR:** [0113](../adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origem:** pedido do dono do produto

### RN-460 — A faixa de atividade do turno narra em tempo real, e o fio só recebe a resposta no fim {#rn-460}

A tela de Sessão mostra, ACIMA do composer, uma faixa que narra em
linguagem humana o que um agente conversacional (Criativo, PO, Arquiteto,
Dev Lead, UX Designer, Staff) está fazendo DURANTE o turno — referência
visual: a linha de status do Claude Code. O fio só recebe a bolha de
resposta DEPOIS que o turno termina; a regra é do CHAT (canal Phoenix) e
vale só para os seis agentes conversacionais — o chat consultivo sem
agente ativo (SSE, `streamChatMessage`) continua com a bolha de streaming
de sempre, intocada. (Desde a [RN-682](api.md#rn-682) a tela não chama mais esse
SSE: a consultiva sem agente pede um agente antes de enviar.)

**Mecanismo (engine)**: os seis servers já emitem `tool.call` DURÁVEL no
event log; passam a também fazer `broadcast(state, "tool.call", %{tool:
name, agent: @agent})` — EFÊMERO, sem `args` (nunca payload cru, mesma
régua da RN-096/RN-412) — logo depois, pro canal `session:<id>` entregar
em tempo real. Não há behaviour/macro compartilhado entre os seis
`dispatch_tool` (quatro formas estruturais distintas confirmadas por
leitura completa): a mudança é seis edições adaptadas à forma local de
cada um.

**Mecanismo (web)**: um reducer PURO
(`reduzirAtividadeDoTurno`/`lib/atividade-do-turno.ts`) acumula o texto do
`agent.delta` como "corrente"; ao chegar um `tool.call` do canal, arquiva
o corrente não-vazio como linha de NARRAÇÃO, zera, e SEMPRE adiciona uma
linha de FERRAMENTA com `fraseDaFerramenta(tool)` (dicionário das 19
ferramentas dos seis agentes, `lib/narracao-de-ferramentas.ts`, sem RN
própria — só existe pra servir esta regra) — duas chamadas consecutivas
sem delta entre elas viram duas linhas separadas, nunca uma. Fim de turno
reseta (`finalizarTurnoDoAgente`, ÚNICO ponto de reset). `turnoViaCanal`
é uma flag PRÓPRIA (nunca derivada de `statusAgent`/`streamingAgent`, que
passam por janelas legitimamente `null` no meio de um turno) que decide
se a faixa aparece OU a bolha antiga — nunca as duas.

**Regra de apresentação (histórico)**: `agruparNarracoesDoTurno`, nova
passada pura que roda DEPOIS de `afundarDesfechos` (RN-172) no mesmo
`useMemo` — dentro de um mesmo `turno`+`autor`, `agent.response`
consecutivas viram um `Disclosure` compacto ("Passos do turno · N"),
deixando só a última intacta e fora dele. `turno === 0` (o prólogo
sentinela de `turnoDoSeq`) fica de FORA do agrupamento, de propósito —
não é um turno de verdade, e fixtures antigas empilham `agent.response`
sem fronteira de turno pra testar outro mecanismo (RN-138/RN-177).
Função agnóstica a agente (só lê `turno`/`autor`), `afundarDesfechos` em
si não muda.

- **Onde:** `apps/engine/lib/engine/agents/{po,criativo,arquiteto,
  dev_lead,ux_designer,staff}_server.ex` (broadcast de `tool.call`);
  `apps/web/src/lib/atividade-do-turno.ts` (reducer);
  `apps/web/src/components/TurnActivityStrip.tsx` (componente);
  `apps/web/src/lib/session-channel.ts:54` (`onToolCall`);
  `apps/web/src/routes/session-fio.tsx:48` (`agruparNarracoesDoTurno`),
  `apps/web/src/routes/SessionPage.tsx:202` (`turnoViaCanal`)
- **Teste:** `apps/web/src/lib/atividade-do-turno.test.ts`,
  `apps/web/src/components/TurnActivityStrip.test.tsx`,
  `apps/web/src/lib/session-channel.test.ts`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (`agruparNarracoesDoTurno`), suite de `apps/engine/test/engine/agents/
  *_server_test.exs` (broadcast de `tool.call` sem args crus)
- **Origem:** pedido do dono do produto

## Painel "precisa de você" (RN-467)

### RN-467 — O painel das cinco filas de decisão NUNCA soma e NUNCA executa: separa por fila e encaminha para a decisão {#rn-467}

O chip "Precisa de você", no topo do projeto, abre um painel com as CINCO
filas de decisão do projeto — aprovações de ação, merges de PR, promoções de
história, pendências de arquitetura e hipóteses do Psicólogo. Duas garantias
o definem, e nenhuma das duas é estética:

**Nunca soma.** Cada fila tem cabeçalho e contagem PRÓPRIA, e não existe
total do projeto em lugar nenhum: nem no painel, nem no chip que o abre — o
chip anuncia PRESENÇA (um ponto, `temAlgoEsperando`, booleano por assinatura)
e nunca quantidade. É a mesma decisão de produto que já mantém os cinco
contadores do trilho separados (ADR 0126): somar apaga QUAL fila está pedindo
atenção, que é justamente a pergunta de quem abre o painel. `montarFilas`
devolve as cinco na ordem de urgência declarada (`ORDEM_DAS_FILAS`) e não
exporta função de total — a ausência é o mecanismo, não um esquecimento.

A única dedupe que existe é por IDENTIDADE, nunca entre filas: a MESMA
`proposed_action` de `git_merge` chega pelos dois hooks (`usePendingActions` é
da sessão e não filtra por tipo; `useProjectPendingActions` é project-wide) e
apareceria duas vezes na mesma lista, sob dois títulos. Fica no grupo mais
específico (`prs`).

**Nunca executa.** As duas filas acionáveis no painel (`aprovacoes`, `prs`)
renderizam o MESMO `ApprovalCard` da aba de Aprovações (uma variante só desde
a AT-322, com o detalhe recolhido),
e os botões chamam os mesmos endpoints de decisão — o painel é um ATALHO para
a decisão, nunca um substituto dela. Isso importa em especial para
`git_merge`: merge em branch protegida é rebaixado a `require_approval`
INCONDICIONALMENTE (`apps/api/src/domain/actions/decide.ts`), teto que nem
`agent_autonomy` nem `permissions.json` levantam, e nada no painel toca nesse
caminho. `onActivateAutoMode` é OMITIDO nos dois cards de propósito: ligar
"auto mode" (RN-153) é mudar POLÍTICA do agente, não decidir a ação que está
na frente — quem quer isso decide na aba de Aprovações, onde o papel de
workspace já é checado. As outras três filas não têm card de decisão fora do
contexto delas e por isso LEVAM à aba onde a decisão mora.

**A pendência de arquitetura não tem data própria** — nenhuma, em campo
nenhum (`ArchitecturePendency`): ela é visão DERIVADA do cruzamento entre
história e `module_map`, recalculada a cada leitura e nunca gravada. O painel
EMPRESTA a data da história relacionada e DIZ que emprestou ("história
atualizada há 18 min", `dataEmprestada`); sem a história no backlog carregado,
mostra "sem data" e ordena o item no FIM da fila. Em nenhum caso um instante
inventado: renderizar "agora" faria a linha mais urgente da tela ser a que
menos se sabe, sem nada denunciando a mentira. Acrescentar coluna e migração
na api resolveria de verdade e é decisão à parte, fora do escopo desta.

- **Onde:** `apps/web/src/lib/precisa-de-voce.ts:108` (`ORDEM_DAS_FILAS`),
  `:117` (`FILAS_ACIONAVEIS`), `:139` (`montarFilas` — a dedupe por
  identidade e o empréstimo de data), `:245` (`temAlgoEsperando`);
  `apps/web/src/components/PainelPrecisaDeVoce.tsx:246-248` (`role="dialog"`,
  `aria-modal`, rótulo) e `:279-284` (grupo por fila, com a contagem dela);
  `apps/web/src/routes/ProjectPage.tsx:120` (monta as filas a partir dos
  cinco hooks que os contadores do trilho já usam)
- **Teste:** `apps/web/src/lib/precisa-de-voce.test.ts` (as cinco filas
  separadas com os itens de cada uma; nada somado e nenhuma função de total;
  o `git_merge` duplicado aparece uma vez, na fila de PRs; ordem por espera
  mais longa; data emprestada marcada, ausente vira `null` e vai para o fim),
  `apps/web/src/components/PainelPrecisaDeVoce.test.tsx` (cinco cabeçalhos com
  a contagem de cada fila; o total não aparece em lugar nenhum; frase própria
  do vazio; `ApprovalCard` decide pela sessão da PRÓPRIA ação; "Modo
  automático" não é oferecido; linha de arquitetura sem data renderiza sem
  quebrar; `Esc`, clique-fora, foco e `aria-expanded`)
- **Origem:** revisão de design do dono do produto (item #3 do canvas de
  melhorias de UI)

## Estado de ambiente na tela (RN-468)

### RN-468 — Sinal de ambiente diz o que SABE: `workspaceVerifiedAt` é registro de confirmação, nunca garantia de que o runner está vivo {#rn-468}

O produto mostra estado de ambiente em dois lugares, e o recorte de cada um é
a regra: a tela de **login** mostra só o que é verdade SEM identidade, e a
**Visão geral do projeto** mostra o que só é verdade COM ela.

**Pré-login, o recorte é imposto pelo escopo do dado, não por escolha
estética.** Sobram os dois `/health` — públicos nos dois serviços de propósito
(`@Public()` na api; "Sem auth de propósito" no `router.ex`), os mesmos que
`StatusPage` já consome sem sessão. Presença de runner é chaveada por
`{user_id, project_id}` (`runner_device_keys`) e a lista de modelos é
`projects/:projectId/models` com papel `viewer`: antes do login não existe
nenhum dos dois sujeitos, então a tela **declara a ausência** ("Runner e
modelos locais dependem da sua conta e de um projeto") em vez de omiti-la —
omitir faria a plataforma parecer não ter o que ela tem. Os dois `/health`
mantêm os TRÊS estados separados (RN-088 aplicada a um sinal de ambiente):
`verificando…` não é `sem resposta`, e nenhum dos dois é `respondendo`. A
sonda tem TETO (6s): uma api que aceita a conexão e nunca responde deixaria a
linha em "verificando…" para sempre, o que é honesto por meio segundo e
mentira por omissão depois de dez.

**E o formulário nunca espera pela sonda.** O estado é local ao bloco, que é
IRMÃO do card — api fora do ar muda um texto e não atrasa nem esconde um pixel
do login. Isso importa exatamente no momento em que a api cai, que é quando
alguém mais precisa que a tela ao menos ABRA.

**Pós-login, a regra é sobre o que o dado NÃO afirma.** O sinal de runner sai
de `projects.workspace_verified_at` — o carimbo que `ConfirmProjectWorkspaceUseCase`
grava quando um runner conecta e confirma a pasta (RN-423), e o MESMO campo
que o engine usa como portão (`TerminalExecutor` recusa comando em projeto
`runner` com o campo nulo). Ele **não é batimento**, por duas razões
independentes: não há processo sendo observado, e **reconectar reportando o
mesmo caminho não regrava o carimbo** (decisão explícita do caso de uso), de
modo que nem a data é "a última vez que o runner apareceu". A tela diz "pasta
confirmada em `<data>`" com a ressalva do que isso não é, e **nunca** "de pé",
"online" nem bolinha verde — o tom é `neutro`, e verde ali leria como uma
garantia de liveness que o dado não sustenta. Quem sabe do AGORA é o socket
do terminal, na aba Código (`TerminalPanel`/`RunnerOnboardingPanel`), e a
ressalva aponta para lá. Mesma disciplina que a RN-467 usou ao tomar
emprestado o `updatedAt` da história.

A linha do runner só existe em projeto no modo `runner`: nos outros dois o
campo é nulo por definição (a conversão de modo o zera, RN-450) e uma linha
"nunca confirmada" ali seria uma ausência inventada.

- **Onde:** `apps/web/src/components/SinaisDoAmbiente.tsx:72` (`useSaude` — a
  sonda com teto e o `.catch` da rejeição de conexão), `:133`
  (`SinaisDoAmbiente`, o bloco pré-login);
  `apps/web/src/components/AmbienteDoProjeto.tsx:92` (`AmbienteDoProjeto`),
  `:102` (linha do runner, só no modo `runner`, com tom `neutro` e ressalva);
  `apps/web/src/routes/AuthLayout.tsx:46` (`colunaDeIdentidade` — nada focável
  ali, ou a primeira parada de `Tab` deixa de ser o campo de e-mail);
  `apps/api/src/application/use-cases/iam/confirm-project-workspace.use-case.ts:93`
  (o carimbo NÃO é regravado quando o caminho não muda — a razão de a data não
  ser recência)
- **Teste:** `apps/web/src/components/SinaisDoAmbiente.test.tsx` (os três
  estados distintos; rejeição de conexão vira "sem resposta" e não silêncio;
  resposta não-OK idem; teto da sonda pendurada; nenhum elemento focável; a
  ausência de runner/modelos é declarada),
  `apps/web/src/components/AmbienteDoProjeto.test.tsx` (sem linha de runner
  fora do modo `runner`; confirmado exige a ressalva e o bloco não contém
  `de pé|online|conectado agora`; nunca confirmado ensina o caminho; contagem
  de modelos locais no singular, no plural e no zero; chaves de consulta
  reusadas), `apps/web/src/routes/LoginPage.ambiente.test.tsx` (o formulário
  renderiza e submete com a sonda rejeitando E com a sonda pendurada; um `<h1>`
  só; a versão continua com uma fonte)
- **Origem:** revisão de design do dono do produto (item #6 do canvas de
  melhorias de UI)

### RN-469 — Salvar uma seção são N chamadas, e a tela nunca afirma o desfecho que não obteve {#rn-469}

Nas seções de Configurações cujas linhas são um ajuste ESCALAR por chave
(`Paralelismo por área` e `Teto de gasto por área`, as duas por `agent_areas`),
o botão de salvar é UM, da seção, e não um por linha. Salvar dispara **uma
chamada por linha suja** — `PUT .../areas/:key/max-parallel` e
`.../budget` são endpoints por ÁREA, não existe endpoint transacional para "grave
estes N tetos", e este produto **não inventou um**. A consequência é que o
desfecho de um clique pode ser parcial, e a regra é sobre o que a tela pode
dizer então.

**As chamadas são em SÉRIE, na ordem da tela, e uma falha não interrompe as
seguintes.** Em série porque o relatório de falha nomeia linhas e precisa sair
na ordem em que a pessoa as vê. Sem interromper porque quem clicou pediu as N:
abortar na primeira recusa deixaria linhas sem tentativa nenhuma, e a tela não
teria como distinguir "a api recusou" de "nem chegou a tentar".

**O desfecho é por LINHA, e é ele que a UI mostra.** Só o rascunho que a api
CONFIRMOU é descartado; o que falhou permanece no campo, com o que a pessoa
digitou, e a seção continua marcada como não salva por exatamente essas linhas
— clicar Salvar de novo tenta só elas. Os três desfechos são distintos e nenhum
se disfarça de outro: todas passaram → sucesso; **nenhuma** passou → a mensagem
que a API deu, nunca uma contagem; **algumas** passaram → aviso que diz quantas
de quantas e **nomeia** as que ficaram. "Salvo" e "não salvo" seriam as duas
mentira no terceiro caso, e é ele que esta RN existe para proteger.

**A seção declara QUANTAS linhas estão pendentes antes do clique.** Um botão
por seção diz "Salvar" igual com uma linha suja e com cinco; a contagem
("2 alterações não salvas nesta seção") é a contrapartida de ter trocado N
botões por um. Sujo é comparação por **valor interpretado**, não por texto:
`20` e `20.0` são o mesmo teto, e comparar string mandaria uma chamada que a
api trata como no-op. Rascunho inválido conta como sujo e **substitui** a
contagem pela mensagem que explica o bloqueio — dois números sobre o mesmo
conjunto seriam ruído, e quem tem valor inválido precisa do que trava o botão.

**Onde a regra NÃO vale, e por quê.** Seção cujo controle é escolha de valor
NOMEADO (`Promoção de história`, `Modelos por agente` (com a caixa da área do lead, RN-912),
papel em `Membros`) salva no `onChange`, sem botão, e continua assim: a
confirmação existe para campo DIGITADO, onde salvar a cada tecla mandaria `1` a
caminho de `12`. O que essa frase mede é de quem é o valor: ela vale para o
controle que grava o PRÓPRIO valor, e não alcança um seletor cujo valor é o
ARGUMENTO de uma ação sobre outras linhas — ver
[RN-476](#rn-476), que é a exceção e diz por quê. E `Credenciais` mantém botão por linha apesar de também ter
`drafts` por chave: a credencial é write-only (ADR 0050) e nunca volta do
servidor, então não há valor com que comparar para decidir "sujo"; o botão da
linha alterna entre "Salvar" e "Trocar" conforme aquele provider já tenha
chave; e ele divide o card com "Testar" e "Remover", que são irredutivelmente
da linha.

- **Onde:** `apps/web/src/routes/settings/secao-salvavel.tsx:105`
  (`useSecaoSalvavel` — o laço em série, o desfecho por linha e os três toasts),
  `:130` (sujo por valor interpretado), `:241` (`MarcaDeNaoSalvo` — a contagem,
  e o inválido substituindo-a),
  `apps/web/src/routes/settings/ParallelismSection.tsx:31`,
  `apps/web/src/routes/settings/BudgetSection.tsx:37` (os dois consumidores),
  `apps/web/src/routes/settings/CredentialsSection.tsx:57` (por que esta seção
  ficou de fora)
- **Teste:** `apps/web/src/routes/settings/secao-salvavel.test.tsx` (a contagem
  de linhas sujas; voltar ao valor do servidor limpa a marca; inválido
  substitui a contagem e trava o botão; um clique persiste todas as linhas
  sujas; número e `null` na mesma leva; falha parcial diz quantas de quantas e
  nomeia a que ficou; a seção continua marcada pelas que falharam; o segundo
  clique tenta só elas; uma falha não interrompe as seguintes; nenhuma passando
  mostra a mensagem da API e não a contagem)
- **Origem:** revisão de design do dono do produto (item #7 do canvas de
  melhorias de UI — "salvar por seção em vez de por linha")

### RN-470 — A origem do modelo distingue binding próprio de herança do Criativo, e nenhum vazio da cascata usa o mesmo símbolo de outro {#rn-470}

`origin: 'agent'` na resposta da api significa **duas coisas diferentes**, e a
api está certa em não separá-las: o agente tem uma linha de escopo `agent` em
`model_bindings`, **ou** a cascata pousou em `workspace` e
[`herdarModeloDeStart`](api.md#rn-102) trocou o valor pelo modelo do Criativo — quem
lê "de onde veio" precisa ver que veio de um AGENTE, não de um escopo que não
existe no banco. Quem tem de separá-las é a **tela**, e até aqui ela não
separava: a coluna Origem imprimia o enum cru, e num projeto com 3 linhas de
`agent` no banco os 12 agentes mostravam a mesma palavra `agent`.

**A origem é uma CADEIA, não uma palavra.** `workspace › projeto › área ›
agente` com quatro estados por nó, e os quatro existem porque dizem coisas
diferentes: **vigente** (é daqui que sai o modelo em uso — o único nó em
`Badge`), **definido** (este nível tem valor próprio, mas um mais específico
venceu), **vazio** (nenhum valor aqui) e **pulado** (tinha valor e a cascata o
descartou por `unavailable`/`sem_tool_calling`, [RN-043](api.md#rn-043)). Colapsar
`definido` em `vazio` devolveria o problema do enum cru um nível abaixo.

**Na herança, o nó `agente` fica VAZIO e um nó extra nomeia o Criativo.** O
nível que a cascata alcançou (`workspace`) aparece como `definido` e **não**
como vigente: o modelo do workspace não é o que vale, e marcá-lo vigente
afirmaria o modelo errado. O nó do Criativo é o único que não é escopo do
banco, de propósito — ele nomeia o passo pós-cascata. A mesma cadeia vale para
a seção de ÁREA, onde `origin: 'agent'` **só** pode ser esse passo: a consulta
de área não põe escopo de agente na cascata.

**A derivação é do CLIENTE, e o que ela não consegue provar continua
acionável.** Nenhum endpoint novo: a tela já busca os quatro níveis. `agent` é
herança quando nenhum nível acima do workspace tinha valor UTILIZÁVEL (o que
foi pulado não segura a descida) e o modelo é o mesmo do Criativo resolvido.
Sobra um caso indistinguível: agente com linha própria apontando para o mesmo
modelo do Criativo, sem padrão de área nem de projeto. Por isso "voltar a
herdar" continua aparecendo em toda origem `agent` — a ação segue disponível
justamente no caso que a cadeia não prova, e nele ela ainda muda o futuro
(sem a linha, o agente passa a acompanhar o Criativo).

**A outra metade dessa escolha: o 404 tem desfecho próprio.** Manter o botão em
toda origem `agent` significa oferecê-lo TAMBÉM onde não há linha para apagar —
e ali `ClearModelBindingUseCase` responde **404**, corretamente ("apaguei o que
não existia" e "apaguei" não são a mesma resposta; colapsá-las esconderia um
`agentSlug` errado). Para quem clicou, porém, esse 404 não é falha: o estado
pedido — o agente herda — **já é verdade**, e chamá-lo de erro seria a tela
contradizendo o que ela sabe. Então ele não passa por `mensagemDaApi` como as
demais recusas, por dois motivos: a frase da api é pt-BR cravada no código e o
idioma default do web é `en`, e este endpoint tem **uma** causa de 404 (papel
insuficiente é 403 no `RolesGuard`, `scope_id` malformado não é 404) — o cliente
SABE o que este 404 significa e pode dizer na língua de quem lê. Qualquer outro
status continua sendo falha de verdade, com a frase da api e tom `danger`. Nos
**dois** desfechos a linha é relida: se a api diz que não havia binding, quem
está velha é a tela.

**E o desfecho próprio é do ENDPOINT, não da tela.** A outra ação da mesma
linha — trocar o modelo pelo `ModelPicker` da coluna MODELO VIGENTE — recusa
por sete caminhos, e **nenhum status identifica um deles sozinho**
(`SetModelBindingUseCase`): 400 para `scope_id` malformado ou `modelId`
reprovado no DTO, 403 para papel abaixo de `developer`, **404 para duas causas
indistinguíveis** ("Modelo não encontrado" e "Projeto não encontrado") e 422
para três ([RN-040](api.md#rn-040) sem tool calling; [RN-043](api.md#rn-043) desativado no
workspace ou sumido do provider). Ali o cliente NÃO pode nomear o 404 —
escolher uma das duas frases seria a tela afirmando o que não sabe —, então
toda recusa segue a gramática normal, com a frase da api e tom `danger`. As
duas funções são vizinhas e tratam o mesmo status de formas opostas de
propósito: o que autoriza o desfecho próprio é a causa ÚNICA, não a tela.

**Na recusa, a coluna MODELO VIGENTE continua exibindo o binding confirmado.**
O `ModelPicker` não guarda a escolha em estado local (`selected` sai do prop
`selectedModelId`, que vem da query), então uma recusa não deixa na tela um
modelo que a api se recusou a gravar — e a linha só é relida no sucesso, já que
na recusa nada mudou no banco. É a mesma disciplina desta RN aplicada ao
tempo: a tela não afirma um estado que não existe, nem por traço, nem por enum,
nem por otimismo.

**Vazio tem texto próprio, e vazios diferentes têm textos diferentes.** Os três
`—` da tela diziam três coisas com o mesmo símbolo e agora dizem cada uma a
sua: `sem modelo em nenhum nível` (nenhum nível tem binding para o agente),
`sem gasto ainda` (o agente não registrou consumo — diferente de `US$ 0,00`,
que é ter rodado de graça) e `sem padrão em nenhum nível` (a área e os dois
níveis acima dela estão vazios). Mesma disciplina da
[RN-180](#rn-180): a tela não afirma com um traço o que não
consegue nomear.

- **Onde:** `apps/web/src/routes/settings/cascata.tsx:119` (`montarCadeia` — os
  quatro estados e o nó do Criativo), `:178` (`herdouDoCriativo` — a dedução e
  seu limite), `:287` (`CadeiaDeCascata`),
  `apps/web/src/routes/settings/ModelsSection.tsx:158` (`cadeiaDoAgente`),
  `:325` (`handleModelChange` — por que aqui o 404 NÃO tem desfecho próprio, e
  por que a linha só relê no sucesso), `:407` (`handleClearAgentBinding` — os
  três desfechos, e por que o 404 tem o dele), `:359` (coluna Origem), `:429`
  (`não há nível abaixo`), `:448` (`sem gasto ainda`),
  `apps/web/src/components/ModelPicker.tsx:95` (`selected` sai do prop — o
  picker não guarda a escolha, e é por isso que a recusa não deixa valor
  fantasma na tela),
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts:38`
  (as duas causas de 404 deste endpoint — este arquivo NÃO mudou),
  `apps/api/src/interfaces/http/shared/llm-binding-error.filter.ts:39`
  (400/422 das recusas de curadoria — este arquivo NÃO mudou),
  `apps/web/src/routes/settings/ModelsSection.tsx` (a cadeia do agente, que já
  desenha o nó da área),
  `apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts:25`
  (o 404 que a api levanta — este arquivo NÃO mudou),
  `apps/api/src/domain/llm/binding-resolver.ts:140` (o `origin: 'agent'` que a
  api devolve, e o comentário que explica por que ele está certo — este
  arquivo NÃO mudou)
- **Teste:** `apps/web/src/routes/settings/cascata.test.tsx` (binding próprio
  termina no nó `agente`; herança deixa `agente` vazio e nomeia o Criativo;
  o workspace nunca aparece vigente na herança; a seção de área idem; a
  distinção sobrevive ao `en`; nível descartado vira nó riscado e o badge
  concorrente sumiu; os três vazios com três textos; `montarCadeia` e
  `herdouDoCriativo` como funções puras, incluindo o caso do padrão de área
  DESCARTADO, que não segura a descida),
  `apps/web/src/routes/settings/voltar-a-herdar.test.tsx` (os três desfechos do
  clique: apagou e relê; 404 não é erro, não repassa a frase pt-BR da api nem
  em `en`, e relê porque a tela é que estava velha; outro status vai por
  `mensagemDaApi` e não relê),
  `apps/web/src/routes/settings/troca-de-modelo.test.tsx` (a outra ação da
  mesma linha: grava e relê; 422 do modelo `unavailable` — o alcançável, já
  que o picker mostra o indisponível marcado — vai por `mensagemDaApi` e não
  relê; a coluna MODELO VIGENTE segue no modelo antigo, nunca no recusado; e o
  404 NÃO ganha desfecho próprio, que é o contraste com a função irmã)
- **Origem:** revisão de design do dono do produto (item #9 do canvas de
  melhorias de UI — "cascata de modelo como cadeia visível")

## A seção de Membros respeita o papel, e o papel é o EFETIVO do projeto (RN-471)

### RN-471 — Papel na seção de Membros: `maintainer`, e derivado da linha do projeto sobre a do workspace {#rn-471}

`MembersSection` não checava papel nenhum. As TRÊS ações da seção — convidar,
trocar o papel de alguém e remover — apareciam ativas para todo mundo, `viewer`
incluído, e a api recusava com 403. Duas delas nem chegavam a dizer isso:
`handleRoleChange` e `handleRemove` não tinham `try/catch` e eram chamadas de um
`onChange`/`onClick`, então toda recusa virava `unhandled promise rejection` —
silêncio na tela e ruído no console, a mesma classe de defeito que a
[RN-102](api.md#rn-102) fechou na tabela de modelos. Remover um
membro em silêncio é o pior dos três: é ação consequente e sem volta pela tela,
porque repor exige o UUID que a linha removida levava junto.

**O mínimo é `maintainer`, e é do ENDPOINT.** Os três caminhos pedem o mesmo
(`projects.controller.ts`), e `GET` pede `viewer` — por isso quem não edita
continua vendo a tabela inteira:

| ação | endpoint | papel |
|---|---|---|
| convidar | `POST :projectId/members` | `maintainer` |
| trocar papel | `POST :projectId/members` (upsert) | `maintainer` |
| remover | `DELETE :projectId/members/:userId` | `maintainer` |
| ver a tabela | `GET :projectId/members` | `viewer` |

Copiar o gate da seção de modelos (`developer`, e correto lá) ofereceria aqui os
três controles a quem a api recusa. É a SEGUNDA seção seguida cujo mínimo difere
da vizinha: a régua continua sendo o endpoint, nunca a tela ao lado.

**O papel é o EFETIVO do PROJETO — e isto FECHA a lacuna que a RN-102 declarou,
não a repete.** Lá a tela lê o papel de WORKSPACE enquanto quem autoriza é
`ResolveEffectiveRoleUseCase.forProject`, e fechar isso exigiria uma consulta de
papel por projeto que o web não tem. É a MESMA lacuna aqui, vista do outro lado:
esta seção JÁ faz essa consulta. `listProjectMembers` é `findMemberRole` para
todo mundo de uma vez, e `userIdDaSessao()` (o `sub` do access token) diz qual
linha é a de quem olha. A composição é literalmente a do caso de uso —
`projectRole ?? workspaceRole` —, não uma segunda fonte de papel inventada só
nesta tela. Enquanto a lista não chegou o papel é AUSENTE, não o de workspace:
sem ela não há como saber se existe linha própria, e errar para o lado de
desabilitar se conserta recarregando.

**A sobreposição vale nos DOIS sentidos, e QUATRO lugares diziam o contrário.**
`forProject` devolve a linha de `project_members` quando ela existe, sem comparar
com o workspace. Então definir `viewer` aqui rebaixa mesmo — até um `owner` de
workspace, que depois só é restaurado por quem tenha `maintainer`. O código nunca
fez o contrário, e o próprio `resolve-effective-role.use-case.spec.ts` fixa isso
("papel de projeto sobrepõe o de workspace"). Onde a promessa falsa estava:

| lugar | o que dizia | situação |
|---|---|---|
| descrição de `POST :projectId/members` | "the EFFECTIVE role is the higher of this one and what the person already has in the workspace"; "associating someone as `viewer` here doesn't downgrade a workspace `owner`" | **não corrigida** — é mudança de api |
| descrição de `AddMemberDto.role` | a mesma frase do "higher of" | **não corrigida** — é mudança de api |
| resumo de `GET :projectId/members` | "with their effective role"; "includes whoever inherits access from the workspace" | **não corrigida** — é mudança de api |
| `apps/web/src/lib/roles.ts:3` | "Papel efetivo nunca é rebaixado" | **corrigida aqui** |

As três da api ficam declaradas e não são tocadas de passagem: as descrições
propagam para `api-types.generated.ts`. A do web é PIOR que as outras três e por
isso foi corrigida junto — as da api ao menos moram numa descrição de OpenAPI,
enquanto essa estava no módulo que `roleAtLeast` e `ROLE_ORDER` exportam, ou
seja, no código que a próxima pessoa desta família de correções vai abrir e
editar, lendo a regra errada antes de qualquer outra coisa. A hierarquia linear
declarada na mesma linha continua válida — é a ordem que `roleAtLeast` compara, e
não mudou. A tela, por sua vez, DIZ o que vale, em vez de deixar o `Select` ser
lido como sugestão inofensiva.

**Some o CONTROLE, nunca a INFORMAÇÃO** (ADR 0064). Quem não tem `maintainer`
continua lendo o papel de cada membro no próprio `Select` apagado — é a
informação central da tabela, e trocá-la por texto esconderia o estado junto com
a ação. O motivo é dito UMA vez, em texto, na legenda: `title` em elemento
`disabled` não abre no Chromium, e uma linha por membro repetiria um fato sobre
QUEM OLHA em cima de cada pessoa da lista.

**A tabela é um RECORTE, e declara
([RN-180](#rn-180)).** `listMembers` é um
`innerJoin` em `project_members`: quem alcança o projeto só pelo workspace não
aparece em linha nenhuma, embora o resumo do `GET` prometa "includes whoever
inherits access from the workspace". Esse dado NÃO está ao alcance do cliente —
nenhuma consulta do web lista membros de workspace com papel —, então a legenda
diz que a lista omite, em vez de deixá-la ser lida como "todo mundo que tem
acesso". É a lacuna que sobra, e ela é declarada, não tratada.

**Nada disto é fronteira de segurança:** quem recusa continua sendo o
`RolesGuard`.

**Convidar mantém a dica fixa, e é decisão.** As outras duas ações usam
`mensagemDaApi` porque o `userId` delas veio da lista e existe — o que sobra é
403 e rede, e a frase da api é a informação mais útil que há. No convite o
`userId` é DIGITADO, e o erro alcançável é apontar para um usuário inexistente:
um UUID bem formado passa pelo `@IsUUID()`, estoura a FK
`project_members.user_id → users.id`, nenhum dos filtros globais trata isso e o
Nest responde o 500 padrão. `mensagemDaApi` devolveria "Internal server error",
pior que a dica — o `padrao` dela só vale para erro que não é `ApiError`.
Uniformizar a forma pioraria o conteúdo no caminho mais provável da caixa.

- **Onde:** `apps/api/src/interfaces/http/iam/projects.controller.ts:121`,
  `:135`, `:147` (os três papéis — estas linhas NÃO mudaram),
  `apps/api/src/application/use-cases/iam/resolve-effective-role.use-case.ts:14`
  (`projectRole ?? workspaceRole`, a sobreposição nos dois sentidos),
  `apps/api/src/infrastructure/persistence/drizzle/project.repository.ts:194`
  (`listMembers` — o `innerJoin` que faz a tabela ser recorte),
  `apps/web/src/routes/settings/MembersSection.tsx:62` (o papel efetivo e por
  que `maintainer`), `:109` (por que convidar não usa `mensagemDaApi`), `:142` e
  `:162` (os dois `try/catch` que faltavam),
  `apps/web/src/lib/roles.ts:49` (`roleAtLeast`), `:3` (o comentário de
  `ROLE_ORDER`, que afirmava "papel efetivo nunca é rebaixado" — o quarto lugar
  da tabela acima, e o único corrigido)
- **Teste:** `apps/web/src/routes/settings/papel-na-secao-de-membros.test.tsx`
  (`viewer` e `developer` não editam e o clique não chega na api; `maintainer` e
  `owner` editam e o POST/DELETE chegam; papel ausente é inerte; o papel da
  linha sobrevive ao controle apagado; o PAR que prova a sobreposição nos dois
  sentidos — `viewer` de workspace com linha `maintainer` EDITA, `owner` de
  workspace com linha `viewer` NÃO edita; as duas recusas viram toast com a
  frase da api; a tela não passa a exibir o papel que a api negou; e convidar
  mantendo a dica fixa contra um 500)
- **Origem:** revisão da #443 — a lacuna que ela declarou, vista da seção que
  tem os dados para fechá-la
- **Adendo (aditivo, o texto acima não mudou):** as três descrições de OpenAPI
  que a tabela marca como "não corrigida" FORAM corrigidas depois, pela
  [RN-472](api.md#rn-472) / [ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md),
  na mesma mudança que pôs os dois tetos de rebaixamento na api. Não reabra
  essa linha da tabela.

---

## A pasta vem primeiro, e o binário não é bloqueio (RN-473/474)

### RN-473 — A configuração do runner pelo navegador começa pela PASTA, e a falha do binário nunca descarta o que já foi configurado {#rn-473}

> **Revisada pela [RN-687](#rn-687) ([ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md), 01/10):**
> o fluxo que esta RN ordena SAIU — `runner-bootstrap.ts` e o teste dele foram
> removidos com o fluxo do navegador. O que sobrevive dela é a régua do passo
> humano dito ANTES, que o painel aplica ao comando do instalador.

O fluxo da [RN-464](api.md#rn-464)..[466](runner.md#rn-466) rodava na ordem `chave → registro
→ binário → pasta` (`configurarPastaAutomaticamente`,
`apps/web/src/lib/runner-bootstrap.ts`). Os quatro passos não têm o mesmo risco:
o download do binário é o ÚNICO que depende de uma release publicada no GitHub
(`RunnerReleasesController`, proxy de `releases/latest`), e com a release
corrente sem asset para plataforma nenhuma ele devolve **502**. A exceção subia
antes de `showDirectoryPicker`, então **o seletor de pastas nunca chegava a
abrir** — o botão parecia inerte e a pasta ficava inalcançável, com a
configuração inteira perdida por causa do passo mais frágil.

A ordem passa a ser `pasta → config → chave → registro → chave privada →
binário`, e o último passo é **best-effort**:

| passo | falha derruba o fluxo? | por quê |
|---|---|---|
| 1. `showDirectoryPicker` | **sim** | sem pasta não há onde gravar nada. Cancelar (`AbortError`/`NotAllowedError`) NÃO é falha — volta ao estado inicial, sem alerta |
| 2. `brabo-runner.config.json` | **sim** | é metade do par que a [RN-466](runner.md#rn-466) lê |
| 3. par Ed25519 + `registerRunnerDeviceKey` + `…device-key.jwk.json` | **sim** | privada em disco sem contraparte no servidor não autentica; por isso o registro vem ANTES da gravação, e as duas são adjacentes |
| 4. binário | **não** | devolve `falhaDoBinario` preenchido; a instrução final vira `npm install -g @brabo/runner && brabo-runner` |

O caminho alternativo funciona **sem flag nenhuma** exatamente porque os passos
2 e 3 já rodaram: o CLI lê os dois arquivos do `cwd` (RN-466). É um dos TRÊS
caminhos de distribuição que o `CLAUDE.md` declara, e o único que não depende
nem da release nem de um checkout do monorepo. O `baixarKitManual` (fora do
Chromium) segue a mesma régua invertendo a ordem dos dois downloads: o **kit**
sai primeiro, o binário por último.

**O passo do terminal é humano, e a tela nunca finge o contrário.** Uma página
web não executa binário na máquina de ninguém, e a File System Access API não
preserva o bit de execução — daí o `chmod +x` continuar no comando. O que o
produto faz é encolher esse passo a UMA linha copiável em um clique; nenhum
texto de UI diz "instalação automática".

**E ele é anunciado ANTES do clique, não só depois.** A frase que explica o
passo existia desde o início, mas era renderizada apenas no estado de SUCESSO —
depois de a pessoa escolher a pasta, esperar o registro da chave e o download
do binário. Quem clica num botão chamado "Configurar pasta automaticamente" e
só então descobre que ainda precisa abrir um terminal foi surpreendido, mesmo
sem nenhuma frase ter mentido: anunciar no fim é o mais tarde possível para
ainda não ser fingimento. Agora há um aviso no estado inicial, ao lado do
botão, e o do fim CONTINUA — as duas dizem coisas diferentes (uma avisa que o
passo virá, a outra explica por que ele existe). O rótulo do botão **não**
mudou: ele fala da PASTA, que é de fato configurada automaticamente, e trocá-lo
descreveria pior o que ele faz.

**O comando final diz em que pasta rodar, quando dá para afirmar qual é.** A
instrução dizia "dentro da pasta escolhida, rode: …" sem nunca dizer onde essa
pasta fica — a File System Access API expõe só o basename (`dirHandle.name`),
nunca o caminho absoluto. O caminho existe do outro lado: é o
`projects.workspace_path` que a pessoa digitou ao criar o projeto. Quando o
basename dele bate com a pasta escolhida, a instrução ganha um prefixo
`cd <caminho> && `; quando NÃO bate, sai sem prefixo — nada obriga a pessoa a
escolher no seletor a mesma pasta que digitou, e um `cd` para o lugar errado
seria a tela afirmando o que não sabe. O basename é o máximo que se prova
daqui, e o caso raro em que ele coincide para pastas diferentes falha ALTO
(`cd` não acha o caminho, ou `./brabo-runner` não está lá), nunca em silêncio —
que é a régua que decide se uma heurística pode entrar. O kit manual (fallback
fora do Chromium) **não** recebe o prefixo, e não é esquecimento: lá os
arquivos caem na pasta de downloads, e `cd` mandaria para onde eles ainda não
estão.

**Lacuna declarada:** fechar a aba entre o passo 3 e o fim deixa uma chave de
dispositivo **órfã** no projeto. Ela é inerte — a privada correspondente só
existiu na memória daquela aba, e sem ela a chave não autentica nada — mas hoje
é invisível: `RunnerDeviceKeysController` tem `POST` e `DELETE`, e nenhuma rota
de LISTAGEM, então não há tela onde revogá-la. Refazer o fluxo registra uma
chave nova, que funciona. Uma listagem é trabalho direto sobre o `DELETE` que já
existe, quando for pedido.

- **Onde:** `apps/web/src/lib/runner-bootstrap.ts`
  (`configurarPastaAutomaticamente`, `baixarKitManual`, `COMANDO_VIA_NPM`),
  `apps/web/src/components/RunnerOnboardingPanel.tsx`
  (`ehCancelamentoDoSeletor`, o bloco de desfecho)
- **Teste:** `apps/web/src/lib/runner-bootstrap.test.ts` (a ordem dos quatro
  passos afirmada como lista; binário 502 e falha de GRAVAÇÃO do binário
  gravando os outros dois arquivos e devolvendo o comando alternativo;
  cancelamento do seletor sem registrar chave nem baixar nada; o kit saindo
  mesmo com o binário em 502),
  `apps/web/src/components/RunnerOnboardingPanel.test.tsx` (a pasta é anunciada
  com o motivo da falha ao lado; cancelar não vira alerta)
- **ADR:** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
  — esta RN revisa a ORDEM do fluxo que ele estabeleceu, não o mecanismo
- **Origem:** pedido do dono do produto

### RN-474 — Depois da instrução, a tela ESPERA o runner: três estados, teto, e o caminho que vale é o que o runner reportou {#rn-474}

Configurar a pasta e mostrar o comando deixava a pessoa sem saber se tinha dado
certo. O quarto passo é uma espera que resolve sozinha
(`apps/web/src/components/EsperaDoRunner.tsx`), montada pelo
`RunnerOnboardingPanel` assim que a configuração termina — nos dois caminhos
(pasta gravada e kit baixado).

**O mecanismo é o que já existia.** O sinal é `project.workspaceVerifiedAt`, o
carimbo que `ConfirmProjectWorkspaceUseCase` grava quando o runner conecta
([RN-423](runner.md#rn-423)) e que o engine usa como PORTÃO (`terminal_executor.ex`
recusa executar em projeto `runner` com `workspace_verified_at` nulo) — a
definição do próprio produto de "este projeto tem runner". É o mesmo dado que
`AmbienteDoProjeto` já lê ([RN-468](#rn-468)), na mesma chave de cache
`['project', id]` que a página inteira mantém. A alternativa considerada foi
sondar `connectFsBrowserChannel` (cujo erro `'Nenhum runner conectado'` o
`FolderBrowserModal` detecta): ela sabe do AGORA, que é mais forte, mas o canal
grava `erroDeConexao` de forma permanente por instância, então cada sondagem
custaria ticket + socket NOVOS — dezenas ao longo da espera — e ela ainda não
responderia a segunda metade do que a tela deve dizer: QUAL caminho o runner
reportou.

**Confirmado é o carimbo MUDAR, nunca "existir".** A espera tira uma linha de
base no primeiro `GET` e compara contra ela. Sem isso, um projeto já confirmado
antes seria anunciado como recém-conectado no instante em que a tela abrisse.

**Os três estados não colapsam, e nenhum é eterno** ([RN-088](#rn-088),
[RN-468](#rn-468)):

| estado | o que a tela diz |
|---|---|
| `esperando` | "procurando o runner", com o teto DECLARADO ("paramos depois de 3 minutos") |
| `confirmado` | a data do carimbo E o `workspacePath` que o runner reportou, dizendo que ele substitui o que foi digitado — a tela não compete com quem roda no host de verdade |
| `semResposta` | o teto estourou, e a tela declara o que NÃO sabe: reconectar com uma pasta já confirmada não regrava o carimbo, então ausência aqui não é prova de ausência, e quem sabe do agora é a aba Código. Um botão recomeça a busca sem refazer a configuração |

- **Onde:** `apps/web/src/components/EsperaDoRunner.tsx` (`INTERVALO_MS`,
  `TETO_MS`, a linha de base em `base`),
  `apps/web/src/components/RunnerOnboardingPanel.tsx` (quem a monta)
- **Teste:** `apps/web/src/components/EsperaDoRunner.test.tsx` (os três
  estados, um a um, cada um afirmando que os outros dois NÃO estão na tela; o
  carimbo preexistente que não conta como conexão nova; o teto estourando com
  temporizador falso e o botão que recomeça)
- **ADR:** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
- **Origem:** pedido do dono do produto

## O `kid` é o vínculo, e a recusa tem nome (RN-475)

### RN-475 — A JWK privada gravada pelo navegador carrega o `kid` do registro; e o CLI distingue "não há chave" de "há chave e ela não serve" {#rn-475}

> **Revisada pela [RN-687](#rn-687) ([ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md), 01/10):**
> a metade do NAVEGADOR saiu com o fluxo (e o e2e que a provava num Chromium);
> o `kid` carimbado continua valendo para a chave criada no terminal
> (`device-key finish --id`, RN-551), e a metade do CLI — ausente × recusada —
> continua inteira.

O modo automático do [ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
([RN-464](api.md#rn-464)..[466](runner.md#rn-466)) **nunca autenticou nenhuma vez** desde que
nasceu. As duas metades desta RN são o defeito e o que o escondeu.

**O `kid` não é decoração — é o único vínculo entre os dois lados.** O `id` que
`POST projects/:projectId/runner-device-keys` devolve identifica o registro
`runner_device_keys` que guarda a chave PÚBLICA. Ele precisa chegar ao disco
DENTRO da JWK privada, no campo `kid` (RFC 7517), porque é assim que a cadeia
inteira o carrega: `lerChaveDeDispositivo` só REPASSA `jwk.kid` (nunca inventa
nem deriva um id),
`assinarTicketComChaveDeDispositivo` o põe no header protegido do JWT de
ticket, e o `PatAuthGuard` usa exatamente esse `kid` para achar a pública e
verificar a assinatura ([RN-465](api.md#rn-465)).

O navegador **descartava o retorno** de `registerRunnerDeviceKey` nos DOIS
caminhos (`configurarPastaAutomaticamente` e `baixarKitManual`), e
`crypto.subtle.exportKey` exporta a JWK CRUA, sem `kid` nenhum. O produtor
gravava um arquivo que o consumidor recusa **sempre** — e o defeito era
invisível dos dois lados: cada função estava certa sozinha. A prova está no
banco: as chaves registradas pelo fluxo tinham `last_used_at` nulo, todas.

A correção é estrutural, não uma linha: o passo 3 da [RN-473](#rn-473) (exportar
a pública, registrar, exportar a privada) vira UMA função
(`registrarChaveEExportarPrivada`), com o `id` fluindo dentro dela. Descartá-lo
de novo passa a exigir apagar código, não esquecer uma atribuição. O `kid` vai
só na PRIVADA: a pública não o leva, porque é o registro dela que o produz.

**A recusa tem nome.** `lerChaveDeDispositivo` devolve `null` sem lançar — de
propósito, e isso não muda: a ausência dos arquivos é o caminho NORMAL de quem
roda com `--project`/`--dir`/`--token`. Mas `null` respondia a duas perguntas
diferentes, e o CLI imprimia o MESMO bloco de `uso()` — que fala de flags e não
menciona o arquivo — tanto para "você não configurou nada" quanto para "sua
pasta está configurada e a chave não serve". Uma pessoa com
`brabo-runner.config.json` perfeito era mandada investigar justamente o lado
que estava certo.

| estado | quem responde | saída do CLI |
|---|---|---|
| `ausente` | caminho normal | o bloco de `uso()`, inalterado |
| `json-invalido` | recusa | `explicacaoDaChaveRecusada` — nomeia o arquivo, o motivo, e as duas saídas (regravar a pasta pelo navegador, ou `--token` enquanto isso) |
| `sem-kid` | recusa | idem, nomeando o campo que falta e para que ele serve |
| `valida` | segue o fluxo | — |

`estadoDaChaveDeDispositivo` e `explicacaoDaChaveRecusada` vivem em
`device-key.ts` porque falam do ARQUIVO; o que FAZER com a recusa (sair, com
qual código, com ou sem o bloco de uso) continua sendo do `index.ts`, como o
docblock do módulo já dizia. O tipo de `explicacaoDaChaveRecusada` exclui
`ausente` e `valida`: não existe explicação para o caso normal nem para o
sucesso, e um texto vago cobrindo os quatro estados seria o mesmo defeito de
novo.

**O que deixou passar:** o teste do web afirmava que o arquivo tinha sido
ABERTO (`getFileHandle` chamado com o nome certo), nunca o que havia DENTRO
dele. Um teste que prova a criação de um arquivo sem provar seu conteúdo deixa
gravar qualquer coisa. O dublê passou a amarrar nome → conteúdo, e as duas
asserções antigas ganharam a metade que faltava.

- **Onde:** `apps/web/src/lib/runner-bootstrap.ts`
  (`registrarChaveEExportarPrivada`, `exportarJwkPrivada`),
  `apps/runner/src/device-key.ts` (`estadoDaChaveDeDispositivo`,
  `explicacaoDaChaveRecusada`, `EstadoDaChaveLocal`),
  `apps/runner/src/index.ts` (o ramo de credencial em `lerArgumentos`)
- **Teste:** `apps/web/src/lib/runner-bootstrap.test.ts` (o `kid` gravado É o
  `id` devolvido, provado com um id diferente do padrão; os dois caminhos —
  pasta e kit manual; a pública SEM `kid`; a chave útil sobrevivendo ao binário
  em 502), `apps/runner/src/device-key.spec.ts` (os quatro estados, um a um;
  ausente ≠ sem-kid enquanto `lerChaveDeDispositivo` colapsa os dois em `null`;
  as duas frases de recusa diferentes entre si),
  `apps/runner/src/index.spec.ts` (o CLI DE VERDADE, em processo separado: a
  pasta sem chave cai no bloco de uso, a pasta com chave sem `kid` cai na
  recusa nomeada, e as duas saídas não são iguais — o defeito era elas serem)
- **ADR:** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
  — esta RN não revisa o mecanismo dele, fecha o contrato que ele deixou
  implícito entre as duas pontas
- **Origem:** uso real do fluxo contra o ambiente local pelo dono do produto

## Estado de ambiente na tela (RN-468)

### RN-476 — Aplicar um modelo a TODOS os agentes: um valor, N chamadas, e um botão apesar do valor ser nomeado {#rn-476}

A tabela `Modelos por agente` tem uma linha por agente e um seletor em cada
uma. Escolher o mesmo modelo para os 17 era percorrer as 17 linhas, e o custo
disso não é o tempo: é que ninguém confere 17 dropdowns e a tela não tem como
dizer se sobrou um para trás. A seção ganha uma barra ACIMA da tabela — um
seletor e um botão — que aplica UM modelo a todos os agentes de uma vez.

**A ação grava no nível do AGENTE, nas 17 linhas — não no projeto.** As duas
leituras de "um modelo para todos" existem e produzem estados diferentes:
gravar no projeto e apagar os bindings de agente e de área faria os 17
HERDAREM, e é o idioma da própria cascata. Não foi o escolhido, por dois preços
concretos: `PUT projects/:id/model-binding` e os endpoints de área exigem
`maintainer`, enquanto o binding de agente exige `developer` — a mesma pessoa
que pode trocar linha a linha passaria a não poder fazê-lo de uma vez —, e o
binding de projeto é também o default da SESSÃO, que a
[RN-040](api.md#rn-040) deixa livre de propósito. A escolha
tem preço declarado: as 17 linhas passam a divergir, com origem `agent` na
coluna Origem, e voltar a herdar continua sendo linha a linha.

**Há botão, apesar de o valor ser NOMEADO.** A régua da
[RN-469](#rn-469) diz que escolha de valor nomeado salva no `onChange`, e ela
continua valendo para o seletor de CADA LINHA, que grava o próprio valor. O
seletor da barra não é configuração de nada: ele é o argumento da ação ao lado.
Aplicar no `onChange` faria um clique exploratório num dropdown reescrever 17
linhas que a pessoa não estava editando, e desfazer isso são 17 cliques. O
botão NOMEIA quantas linhas vai alcançar, porque esse número é a consequência.

**O desfecho segue a RN-469 inteira, e é a razão de a barra não inventar
nada.** Uma chamada por agente, em SÉRIE, na ordem da tela, sem abortar na
primeira recusa — abortar deixaria 16 linhas sem tentativa e a tela não
distinguiria "recusou" de "nem tentou". Os três desfechos não se disfarçam:
todas passaram → sucesso nomeando o modelo; **nenhuma** passou → a mensagem da
api, nunca uma contagem; **algumas** passaram → aviso com quantas de quantas,
nomeando as que ficaram pelo NOME do agente, que é o que a pessoa lê na
primeira coluna. Só as linhas que a api CONFIRMOU são relidas: invalidar as 17
apagaria da tela a diferença que o relatório parcial acabou de contar.

**O gate é o do ENDPOINT, e o endpoint é o mesmo dos controles de linha.**
`developer`, por `PUT projects/:projectId/agent-bindings/:agentSlug` — não o
`maintainer` da seção vizinha de área ([RN-102](api.md#rn-102)).
O botão fica inerte para quem não alcança, e o motivo é dito UMA vez, em TEXTO,
na legenda da seção, junto com as outras duas ações que ficam inertes: `title`
em elemento `disabled` não abre no Chromium (ADR 0064). O filtro "aptos para
agentes" do seletor abre MARCADO, como no picker de linha e pelo mesmo motivo
([RN-040](api.md#rn-040)) — com mais força aqui, porque um
modelo chat-only escolhido na barra não produziria um 422, e sim 17, e o
relatório parcial contaria a mesma recusa dezessete vezes.

- **Onde:** `apps/web/src/routes/settings/aplicar-a-todos.tsx:66`
  (`useAplicacaoEmLote` — o laço em série e os três desfechos),
  `apps/web/src/routes/settings/ModelsSection.tsx` (a barra, o estado local do
  modelo escolhido e a invalidação só das linhas confirmadas)
- **Teste:** `apps/web/src/routes/settings/aplicar-a-todos.test.tsx` (grava o
  mesmo modelo em todos os agentes, na ordem da tela; nenhuma passando mostra a
  mensagem da api e NÃO a contagem, e ainda assim tenta todas; falha parcial diz
  quantas de quantas e nomeia a que ficou; papel abaixo de `developer` deixa o
  botão inerte e o motivo continua em texto)
- **Origem:** pedido do dono do produto ao configurar um ambiente zerado com um
  provider só — todos os agentes precisavam do mesmo modelo

---

## A busca do RAG deixa rastro, e o rastro congela os pesos (RN-479..481)

### RN-491 — A Infra elege entre as candidatas do Arquiteto, e a eleição vira uma NOVA versão de `artifact.project_image` {#rn-491}

`propose_container_start` fecha a metade que a RN-487 deixou declarada em
aberto: a Infra elege UMA das `imagemCandidata` do roteamento vigente do
Arquiteto (`artifact.module_routing`) e propõe subir o container REAL do
projeto. A eleição só tem efeito porque `ExecuteContainerStartUseCase` REUSA
`DecidirImagemDoProjetoUseCase` para emitir uma nova versão de
`artifact.project_image` com `decidedBy: 'infra-lead'` — sem isso a eleição
seria auditável e INERTE: o broker compõe o container lendo `GET
.../container-spec`, que lê `artifact.project_image` (RN-105), nunca
`artifact.module_routing`.

**A imagem eleita precisa estar na lista de candidatas, sempre — validado
ANTES de tocar no artefato.** Fora da lista, a ação falha nomeando a imagem
recusada e listando as candidatas válidas, e nem `DecidirImagemDoProjetoUseCase`
nem o broker chegam a ser chamados: a Infra elege, nunca inventa.

**Novo `container_start` (`maintainer`, mesmo calibre de `open_infra_pr`/
`parallelize`), deliberadamente FORA do bloco de tetos absolutos de
`decide.ts`** — mesmo raciocínio já registrado ali para
`propose_execution_plan`/`assess_implementability`: é a PRIMEIRA vez que este
container sobe de verdade para esta eleição, não uma ultrapassagem de um teto
já autorizado. Diferente de `open_infra_pr`, esta ação NÃO é seedada em
`INFRA_AUTONOMY_SEEDS` — o Infra Lead nunca aplica nada com `open_infra_pr`
(só propõe uma PR que um humano ainda mergeia), mas subir um container é
efeito externo real, então fica `require_approval` por padrão, decidido caso a
caso pelo `ApprovalCard`. Um `maintainer` PODE configurar auto-aprovação
depois, e por isso `ProposeActionUseCase` também executa no caminho
`auto_approved`, mesma lição do comentário sobre `parallelize` nesse arquivo
("sem isto a ação nascia, era aprovada — e nada subia").

**Revisado pela [RN-671](api.md#rn-671) (ADR 0190, 01/10):** `container_start` passa
a ser SEMEADO `auto_approve` no aceite do handoff da Infra, e o servidor do
Infra Lead propõe a primeira subida sozinho quando há roteamento. O resto desta
regra — a lista de candidatas, `maintainer`, fora dos tetos absolutos — segue.

**Depois do broker confirmar, a transição de ciclo de vida segue a máquina de
estados do ADR 0081, nunca reprovisiona à toa.** Sem linha ainda, ou linha em
`failed`/`removed`: `provisioning` (a que lê a imagem recém-decidida e
congela `imageVersion`) e só então `running`. Linha em `stopped`: direto para
`running` — a máquina de estados nem permite `stopped -> provisioning`, e
reprovisionar reemitiria uma imagem que já está gravada na linha. Linha já
`provisioning`/`running`: completa a transição pendente ou não faz nada,
apoiado no `start` idempotente do broker (`jaEstavaDePe`).

**Revisa a RN-485.** "Nada dispara subida... o único chamador que existe hoje
faz LEITURA" deixa de ser verdade: `container_start` é o primeiro chamador
real de `ContainerBrokerPort.start`, das cinco operações que o ADR 0128/0130
declarou. `RegistrarTransicaoDeContainerUseCase` ganha o primeiro chamador
fora de teste também. Continua valendo que NADA dispara sozinho — é sempre uma
`proposed_action`, decidida por um humano ou por política explícita.

**Dev agents NÃO passam a trabalhar dentro do container que sobe aqui.** Essa
etapa é uma PR posterior, declarada em aberto no CLAUDE.md — a frase que a
tela de aprovação mostra (`apps/web/src/lib/aprovacoes.ts`) para de propósito
antes de prometer isso.

- **Onde:** `apps/api/src/application/use-cases/actions/execute-container-start.use-case.ts`,
  `apps/api/src/domain/actions/decide.ts` (`ACTION_TYPES`,
  `MIN_ROLE_FOR_ACTION_TYPE`), `apps/api/src/domain/containers/container-start-execution-result.ts`,
  `apps/api/src/application/use-cases/actions/approve-action.use-case.ts`,
  `apps/api/src/application/use-cases/actions/propose-action.use-case.ts`,
  `apps/api/src/application/use-cases/execution/get-infra-context.use-case.ts`
  (`moduleRouting`, primeiro consumidor HTTP de `GetModuleRoutingUseCase`),
  `apps/web/src/lib/aprovacoes.ts`,
  `apps/engine/lib/engine/infra/tools/propose_container_start.ex`,
  `apps/engine/lib/engine/infra/infra_lead_server.ex`
- **Teste:**
  `apps/api/test/application/use-cases/actions/execute-container-start.use-case.spec.ts`
  (caminho feliz elegendo candidata; imagem fora das candidatas recusa sem
  chamar `DecidirImagemDoProjetoUseCase` nem o broker; `BrokerRecusouError`/
  `BrokerIndisponivelError` viram `failed`, nunca propagam; `stopped` pula
  direto para `running`),
  `apps/api/test/domain/actions/decide.spec.ts` (`container_start` exige
  `maintainer`; CONSEGUE chegar a `auto_approve` quando configurado — ao
  contrário de `parallelize`/merge protegido/`instruction_patch`),
  `apps/api/test/application/use-cases/execution/get-infra-context.use-case.spec.ts`
  (`moduleRouting` presente e ausente),
  `apps/web/src/lib/aprovacoes.test.ts` (frase não promete dev agent dentro
  do container),
  `apps/engine/test/engine/infra/infra_lead_server_test.exs`
- **ADR:** [0130](../adr/0130-broker-de-container.md), [0133](../adr/0133-infra-elege-imagem-do-roteamento.md)
- **Origem:** plano do dono do produto, Parte 1 / PR 1.5

### RN-499 — O handoff da Infra tem card acionável PRÓPRIO, fora do fio — sem alargar `AGENTES_DE_CHAT` {#rn-499}

`OfferInfraHandoffUseCase` oferece o handoff pro Infra Lead
(`offer-infra-handoff.use-case.ts:43`), e até aqui **tela nenhuma podia
aceitá-lo**. `offeredHandoff` (`SessionPage.tsx`) restringe o card do fio a
`AGENTES_DE_CHAT` ([RN-136](#rn-136)), que não inclui `infra`, e
`acceptHandoff` (`api-client.ts`) tinha **um único consumidor** — esse card,
atrás desse filtro. O comentário do próprio código registrava a consequência
como aceita: *"como Infra nunca é aceito por AQUI … na prática, nunca"*.

O efeito não era cosmético: o handoff ficava `offered` para sempre, o Infra
Lead nunca era ativado, `propose_container_start` nunca era chamado
([RN-491](#rn-491)) e **nenhum projeto de nenhum modo chegava a ter container
de pé**. A cadeia "Infra aceita → propõe `container_start` → aprovado →
`running`" era inalcançável por qualquer caminho de tela.

**O filtro NÃO foi alargado, e isso é a regra.** `AGENTES_DE_CHAT` está certo
em excluir `infra`: o `agent_command_controller.ex` do engine não tem cláusula
de `message` pro Infra Lead, e a última cláusula (sem guarda) trataria
`"infra"` como se fosse o Criativo — pôr `infra` na lista faria a tela
oferecer um fio de conversa que não existe e o composer mandar mensagem pro
agente errado. (Desde a [RN-584](engine.md#rn-584) o engine recusa com nome em vez de
entregar ao Criativo; o filtro continua certo pelo mesmo motivo.) Aceitar a Infra é uma ação **propositiva**, não conversacional.

O card acionável mora, então, **fora do fio**: na faixa fixa entre a área que
rola e o composer, a mesma que hospeda o handoff manual
([RN-440](api.md#rn-440)) e que já se declara o lugar das ações de handoff que "não
são conversa, são redirecionamento". Três consequências que a escolha compra:
o `handoff.offered` da Infra **continua narrado** no fio como divisor mudo
(nada muda na timeline); nenhum handoff conversacional muda de forma; e o
botão não some quando a oferta sai da janela de 200 eventos numa sessão longa
— o card do fio dependeria do evento estar visível, este não depende.

O card **diz a consequência do clique**, porque ela não é óbvia: aceitar ativa
o Infra Lead, que assume o provisionamento e vai **propor** a subida do
container; a proposta ainda passa pelo pipeline de aprovação de sempre
(`container_start`, `maintainer`, nunca auto-aprovável por seed —
[RN-491](#rn-491)). Aceitar não sobe container nenhum.

Fechamento: o mesmo `activeFor(h.toAgent)` do card do fio — handoff já aceito,
ou Infra já ativa nesta sessão por qualquer outro caminho, não reabre convite.
E o clique chama o **mesmo** `handleAcceptHandoff`, sem segundo caminho de
aceite.

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
  (`handoffDaInfraOferecido`, e o bloco `styles.infraHandoffRow` acima do
  `manualHandoffRow`)
- **Teste:** `apps/web/src/routes/SessionPage.handoff-da-infra.test.tsx` —
  card aparece e aceita com os ids certos; some com a Infra já ativa; some em
  sessão não-ativa; o divisor mudo do fio continua lá sem botão de fio; e a
  **não-regressão** de [RN-136](#rn-136): Infra (mais antigo) + Dev Lead (mais
  novo) pendentes mostram os DOIS cards, cada um aceitando o próprio handoff
- **Origem:** exploração do plano "Nome e local na mesma tela, e container
  antes dos dev agents" (D0) — o bloqueador que tornava o requisito "dev agent
  só depois do container de pé" equivalente a "dev agent nunca começa"

## O navegador de pastas servido pela api (RN-504)

### RN-504 — O navegador de pastas é escopado à base de projetos e NUNCA sai dela {#rn-504}

`GET /workspaces/:workspaceId/project-folders` lista as **subpastas** de um
caminho, e existe porque o assistente de criação de projeto perde, de uma vez,
os DOIS mecanismos de "procurar pasta" que tinha: `FolderBrowserModal` navegava
pelo **websocket do runner** (`fs_list_dir`/`fs_home_dir`) e o
`RunnerOnboardingPanel` usava `showDirectoryPicker`, que devolve um handle do
navegador e nunca um caminho absoluto. Sem runner, o navegador não tem como
listar filesystem nenhum — e é caminho absoluto que `projects.workspace_path`
guarda.

**A contenção é UMA, e é dura.** `path` é opcional e omitido quer dizer a base
(`baseDeProjetos()`); todo `path` fornecido tem que satisfazer
`dentroDaBaseDeProjetos` (RN-500), que reusa `dentroDoEscopo` — a mesma função
do escopo de terminal do ADR 0055 — e por isso pega a armadilha de prefixo:
`/home/voce/brabo2` **não** está dentro de `/home/voce/brabo`, embora a string
comece igual. `..` e `.` são **recusados** em vez de resolvidos, pela mesma
razão de `caminhoDeWorkspaceLocalValido`: resolver aceitaria que o caminho lido
não é o caminho pedido.

**Sair da base é 400, e não 403.** 403 diria "você não tem permissão para ver
isto" e sugeriria que outro papel veria — não é o caso. Não existe papel nenhum
que navegue fora da base, porque fora da base não é uma área mais privilegiada,
é uma área que esta rota simplesmente não endereça. O pedido está MALFORMADO.

**Os tetos são contrato, não detalhe de implementação:** só diretório em
`entries`; no máximo **500**, ordenados **antes** do corte (senão "as 500
primeiras" seria a ordem que o filesystem devolveu, que muda entre máquinas);
sem recursão; entradas começadas com `.` fora; e symlink **reportado, nunca
descido** — `readdirSync(withFileTypes)` tem semântica de `lstat`, então um
link apontando para fora da base não é porta de saída. **O que fica de fora é
CONTADO** (`arquivos`, `simbolicos`, `truncado`): sem isso uma pasta cheia de
código voltaria como lista vazia e a tela diria "pasta vazia", afirmando sobre
o que não leu (RN-180).

**Não há POST.** Criar pasta é da materialização do workspace montado, no
momento em que o container sobe — nunca do seletor.

**O mínimo é `maintainer`**, o mesmo de `POST .../projects` e de
`.../projects-base`, e pelo mesmo raciocínio um passo adiante: `projects-base`
revela UM caminho da máquina do operador, esta rota revela a TOPOLOGIA abaixo
dele. Herdar o `viewer` das rotas vizinhas por elas serem vizinhas é o defeito
que a RN-102 nomeia — o mínimo é do ENDPOINT, nunca da seção. `workspaceId` não
entra no cálculo: a base é da INSTALAÇÃO, e ele está na rota porque é o que dá
escopo ao `RolesGuard`.

**No cliente**, o transporte vira uma das DUAS implementações da interface
`FsBrowser` (`apps/web/src/lib/fs-browser.ts`): `criarFsBrowserViaApi` (nova) e
`connectFsBrowserChannel` (o canal do runner, re-tipada). `FolderBrowserModal`
escolhe por `origem: { tipo: 'api'; workspaceId } | { tipo: 'runner'; projectId }`
— união discriminada, e não duas props opcionais, porque "nenhuma das duas" e
"as duas" seriam estados representáveis que o componente teria de tratar em
runtime. O transporte via runner fica **sem chamador no web** a partir daqui, e
continua no repositório por decisão declarada do dono do produto (o runner sai
da interface, o binário segue sendo refinado); o protocolo em
`apps/runner/src/channel.ts` não é tocado de qualquer forma.

- **Onde:** `apps/api/src/infrastructure/filesystem/project-folders-browser.ts`
  (`listarPastasDeProjeto`, `TETO_DE_ENTRADAS`, `PastaForaDaBaseError`,
  `PastaNaoLegivelError`);
  `apps/api/src/interfaces/http/iam/workspaces.controller.ts`
  (`listProjectFolders`); `apps/web/src/lib/fs-browser.ts`;
  `apps/web/src/components/FolderBrowserModal.tsx`
- **Teste:**
  `apps/api/test/infrastructure/filesystem/project-folders-browser.spec.ts`,
  `apps/api/test/interfaces/http/iam/workspaces-project-folders.controller.spec.ts`,
  `apps/web/src/lib/fs-browser.test.ts`,
  `apps/web/src/components/FolderBrowserModal.test.tsx`
- **ADR:** [0141](../adr/0141-base-unica-dos-projetos-montados.md) (a base que
  esta rota escopa)
- **Origem:** plano do dono do produto, PR 4

## A base decide o que a criação de projeto oferece (RN-513)

### RN-513 — Com base consentida, `mounted` é o pré-selecionado com `<base>/<slug>` sugerido; sem base, ou sem saber, ele não é oferecido {#rn-513}

> **Revisada pela [RN-573](api.md#rn-573) (ADR 0161):** a pré-seleção de `mounted`
> passou a exigir TAMBÉM o broker de container confirmado. Com base e sem
> broker (a instalação por Release), `runner` é o pré-selecionado e
> `container`/`mounted` ficam inertes com o motivo em texto; com o broker
> desconhecido, `container` segue selecionado. O resto desta regra vale como
> está.

Duas metades desta regra **já eram regra** e nunca tinham chegado ao cliente.
"Não oferecer o modo sem base" é a [RN-500](api.md#rn-500); "sugerir `<base>/<slug>`"
é a [RN-501](api.md#rn-501), e o ADR 0142 adiou a validação de disco justamente para
que o assistente pudesse propor uma pasta que **ainda não existe**. Até aqui,
`GET /workspaces/:workspaceId/projects-base` não tinha **chamador nenhum** no
web, e o card "Pasta montada" era oferecido incondicionalmente — numa
instalação sem `BRABO_PROJECTS_BASE`, escolher o modo terminava numa recusa
400 da api depois de a pessoa ter escolhido, digitado o caminho e chegado ao
fim do assistente.

O que é **novo** é a **pré-seleção**: com base configurada, `mounted` nasce
selecionado. Ela revisa o default do ADR 0072 (onde `container` é "a normal" e
o modo local é escape hatch) e o revisa **só para a instalação local**, onde a
base foi consentida por um humano no host ([RN-511](infra.md#rn-511)). O enum
`project_execution_mode` não muda, nenhum modo novo nasce, e a conversão de
modo (ADR 0111) não é tocada.

**A consulta nasce com o assistente, não com o passo.** O passo "Onde o código
vai morar" é o quinto; um `useQuery` montado só ali faria o card aparecer
piscando depois que a pessoa já estivesse olhando a tela.

**Desconhecido não vira oferta.** Enquanto a resposta não chegou, e também
quando a consulta **falha** (403, rede, api fora), o card não aparece e
`container` segue selecionado. Falha não é permissão para oferecer um modo
cuja pré-condição não se conseguiu confirmar: é a mesma régua da
[RN-088](#rn-088)/[RN-468](#rn-468) — o produto não colapsa "não sei" com "não
tem" — e a dos ADRs 0041/0042, onde capability só é declarada quando
**provada**.

**A pré-seleção nunca sobrescreve escolha humana.** A base chega por rede,
sempre DEPOIS do primeiro render. A tela guarda a escolha do usuário separada
do modo vigente (`modoDeWorkspaceEscolhido` × `modoDeWorkspace`), e a
pré-seleção só vale enquanto ninguém tocou nos cards — trocar o modo debaixo da
mão de quem já clicou é defeito, não conveniência.

**A sugestão nunca clobbera o que foi digitado.** `<base>/<slug>` entra em dois
casos e só neles: campo vazio com nada sugerido ainda, ou campo contendo
exatamente a sugestão anterior desta tela (o nome mudou no passo de detalhes, e
a sugestão acompanha). Qualquer outra coisa — inclusive o campo vazio **depois**
de o usuário ter apagado a sugestão — fica como está. Slug vazio (a adoção, onde
o nome vem do provider) não vira segmento inventado: o campo continua vazio, e
`canAdvanceFromWorkspace` segura o passo. O campo é **editável** o tempo todo; a
pré-seleção não relaxou nenhuma régua de avanço.

**E o aviso do modo parou de mentir.** O texto anterior era anterior ao ADR
0141: dizia que o caminho era livre e que só funcionaria se o usuário o
montasse. Hoje são **dois estados, e são os dois que o backend tem** — sob a
base, nota neutra (a criação passa, e a pasta nem precisa existir: a Infra a
cria ao subir o container, [RN-501](api.md#rn-501)); fora da base, aviso dizendo que
a api **recusa a criação** (400, em `resolverWorkspacePath`) e **nomeando** a
base, em vez de mandar procurar a variável. Campo vazio não é "fora da base":
não há caminho para a api recusar ainda, e alarmar antes de a pessoa digitar
seria a tela afirmando sobre o que não tem. A comparação é por **segmento**,
nunca `startsWith` cru — `/base-outra` não está dentro de `/base` —, espelhando
`dentroDoEscopo` da api.

- **Onde:** `apps/web/src/routes/NewProjectWizard.tsx:220` (a consulta),
  `:238` (`podeOferecerMounted`/`baseDeProjetos`), `:283` (o modo vigente),
  `:333` (`caminhoForaDaBase`), `:360` (a sugestão);
  `apps/web/src/lib/wizard.ts:143` (`caminhoSugeridoNaBase`) e `:171`
  (`caminhoDentroDaBase`) — as funções puras;
  `apps/web/src/lib/api-client.ts:305` (`getProjectsBase`)
- **Teste:** `apps/web/src/routes/NewProjectWizard.test.tsx`
  (`describe('NewProjectWizard — a base de projetos decide o que é
  oferecido')` — base presente, base `null`, consulta recusada com 403, a
  escolha humana antes de a base chegar, e os dois estados do aviso);
  `apps/web/src/lib/wizard.test.ts` (`describe('caminhoSugeridoNaBase')` e
  `describe('caminhoDentroDaBase')`)
- **ADR:** [0146](../adr/0146-base-consentida-no-bootstrap.md), ponto 4
- **Origem:** FASE 28, sessão 3

---

## O picker do modo Runner volta a ler o disco de QUEM ESCOLHE (RN-533)

### RN-533 — Em modo `runner` o navegador de pastas pergunta ao agente local, e a tela diz de quem é o disco {#rn-533}

O assistente de criação tinha **um** navegador de pastas para **dois** modos que
leem discos **diferentes**. A [RN-504](#rn-504) apontou os dois para a api —
certo para `mounted`, cuja pasta mora sob `BRABO_PROJECTS_BASE`, no SERVIDOR — e
declarou o preço por escrito: *"para `runner` a lista deixa de ser o disco da
máquina do usuário e passa a ser a base"*. Aquilo foi aceito porque *"o modo
`runner` sai da criação de projeto no PR seguinte"*, o que **não aconteceu**: o
modo continua sendo oferecido, e a direção do
[ADR 0151](../adr/0151-base-consentida-no-runner.md) (ponto 7) é a oposta. Enquanto
durou, escolher `runner` e clicar "Procurar pasta…" navegava um disco que não é
o daquele projeto — e **nada na tela dizia isso**, então o erro só apareceria
pelo CONTEÚDO da lista.

**O MODO decide o transporte, e são duas perguntas diferentes.** `mounted`
segue byte a byte pela api (`GET workspaces/:workspaceId/project-folders`,
escopado duro à base — RN-504 intacta); `runner` volta a `fs_list_dir`, que
sempre existiu dos dois lados e cujo transporte no web nunca saiu do
repositório. Não é um transporte sobrando que ganhou uso: é a pergunta "o que há
na SUA máquina?", que a api não tem como responder, voltando a ser feita a quem
tem como.

**A âncora do modo `runner` é a criação ANTECIPADA da [RN-437](#rn-437).** O
ticket do canal é escopado a um `projectId` real, então o clique cria o projeto
antes de abrir o modal — o propósito original daquela regra, que a RN-504 tinha
deixado sem consumidor. E falhar essa criação **não abre o modal em transporte
nenhum**: cair na api mostraria a base do SERVIDOR sob o rótulo de "sua
máquina", exatamente o defeito que esta regra fecha.

**Sem agente local conectado, o modo continua oferecido — e quem declara é o
PICKER, não o passo de modo.** A [RN-513](#rn-513) esconde `mounted` quando a
base é desconhecida ou ausente, e está certa: ali a api TEM sinal
(`GET .../projects-base`), e sem base a criação termina em 400 no fim do
assistente, sem conserto na tela. Aqui nenhuma das duas coisas vale. Não existe
sinal de presença de runner na api — a [RN-521](api.md#rn-521) já declara isso por
escrito —, então esconder o modo ou apagar o botão seria decidir "não tem" a
partir de "não sei", o colapso que a [RN-088](#rn-088)/[RN-468](#rn-468)
proíbem; e o modo **não está quebrado** sem runner, porque o caminho é
confirmado depois, pelo CLI ([RN-423](runner.md#rn-423)) — o que falta é só a
NAVEGAÇÃO. Então a declaração vai para o único lugar que de fato pergunta: o
picker, no instante em que pergunta.

**O motivo é DISCRIMINADO, e os dois desfechos não colapsam.**
`MotivoDeFalhaDoAgente` é `sem-agente` (o engine AFIRMA que não há runner
conectado — um fato do servidor) ou `sem-resposta` (teto da requisição, socket
caído, ticket recusado — ignorância, e dita como ignorância na tela). Antes
desta regra quem decidia era `erro?.includes('Nenhum runner conectado')` no
COMPONENTE — uma tela casando substring de uma frase em pt-BR que mora num
`.ex` do engine, exatamente o que a [RN-532](runner.md#rn-532) recusa por escrito do
outro lado (*"o texto é para um humano ler, o motivo é para o outro lado
DECIDIR"*). O casamento sobrou em **um** lugar, o módulo que é dono do
protocolo do canal, e a degradação é nomeada: frase reescrita no engine cai em
`sem-resposta` — o estado "não sei" —, nunca em "há agente". O transporte de
api **nunca** preenche `motivo`, e isso é decisão: recusa da api é recusa da
api, tem mensagem própria que ENSINA e não há agente local a instalar para
consertá-la.

**A espera é a da [RN-474](#rn-474), REUSADA e não reescrita.** Os dois motivos
levam à `EsperaDoRunner` — mesmos três estados (`esperando`/`confirmado`/
`semResposta`, que nunca colapsam), mesmo TETO de 3 minutos, mesma redação,
mesmo sinal (`workspaceVerifiedAt` MUDANDO, nunca "existindo"). Ela ganhou uma
callback opcional porque aqui a confirmação tem CONSEQUÊNCIA: a listagem que
falhou é refeita sozinha, em vez de a pessoa ter de descobrir que precisa
clicar em algo. A callback dispara UMA vez por instância — sem o `ref`, cada
rodada da sonda a redispararia e o chamador entraria em laço — e ela **não
afirma "está de pé agora"** (`workspaceVerifiedAt` nunca disse isso, RN-468):
por isso quem a recebe REPETE o pedido, e se o agente já caiu de novo a tela
volta ao mesmo estado, honesta das duas vezes. Espera é UMA por tela:
`RunnerOnboardingPanel` ganhou `mostrarEspera`, `false` só onde quem o monta já
mostra a sua — duas seriam duas sondas, dois tetos e, no pior caso, duas frases
discordando sobre o mesmo carimbo.

**E o picker diz de QUEM é o disco, nas DUAS origens.** O único sinal antes
disso era o rótulo de um atalho ("Base de projetos" × "Pasta pessoal"), que
nomeia um lugar e não uma máquina. A frase da api não é decoração de simetria:
sem ela a do runner leria como aviso excepcional, quando é informação que as
duas devem.

- **Onde:** `apps/web/src/lib/fs-browser.ts:60`
  (`MotivoDeFalhaDoAgente`, e por que só o transporte do runner o preenche);
  `apps/web/src/lib/fs-browser-channel.ts:66`
  (`FRASE_DO_ENGINE_SEM_RUNNER`, o único casamento por substring que sobrou) e
  `:68` (`motivoDaMensagem`); `apps/web/src/components/FolderBrowserModal.tsx:227`
  (`agenteNaoRespondeu`, a decisão pelo motivo) e a linha de origem nas duas
  origens; `apps/web/src/components/EsperaDoRunner.tsx:91` (`onConfirmado`) e
  `:136` (o `ref` que a dispara uma vez);
  `apps/web/src/components/RunnerOnboardingPanel.tsx:131` (`mostrarEspera`);
  `apps/web/src/routes/NewProjectWizard.tsx:304` (`origemDoNavegador`, o
  transporte escolhido pelo modo, `undefined` quando não há projeto a ancorar)
- **Teste:** `apps/web/src/components/FolderBrowserModal.test.tsx` (a lista
  declarando o disco da máquina do usuário; `sem-agente` caindo no painel de
  onboarding; a decisão pelo MOTIVO e não pelo texto, com uma redação que
  ninguém prometeu manter; `sem-resposta` com a ressalva de que isso não prova
  ausência, UMA espera só e o teto anunciado; a listagem refeita sozinha quando
  o carimbo muda); `apps/web/src/routes/NewProjectWizard.test.tsx` (o modo
  decidindo o transporte nos dois sentidos; a criação antecipada ancorando o
  canal; a criação que FALHA não abrindo navegador nenhum)
- **ADR:** [0151](../adr/0151-base-consentida-no-runner.md) ponto 7
- **Origem:** FASE 29, sessão 9. Fica declarado e NÃO feito: o picker **não**
  dispara `workspace_create` — escolher uma pasta é escolher, e criar é outra
  coisa. `Engine.Runners.PastaDoProjeto.criar/3` (RN-532) segue sem chamador, e
  ligá-lo exigiria uma rota HTTP nova na api, fora do escopo desta sessão. O
  conserto definitivo do casamento por substring — o engine mandar um código ao
  lado do texto, como o runner já faz com os cinco `motivo` da RN-532 — também
  é do lado do engine, e fica declarado no código

---

## Criar projeto não provisiona repositório (RN-541)

### RN-541 — Criar um projeto NÃO cria repositório git; o bootstrap é adiado até o handoff do Arquiteto {#rn-541}

Criar um projeto e provisionar o git eram, na prática, o mesmo gesto — e o que
os unia era uma TELA. `ProvisioningPage` dispara `provisionRepository` no efeito
de montagem e é o **único** chamador dele no web; o assistente navegava para lá
ao confirmar, então todo projeto nascia com repositório e Gitflow completos, sem
que ninguém tivesse pedido.

O dono do produto quer o contrário: o que se gera por ora segue **sem git**, e o
repositório só nasce quando o desenvolvimento começa de verdade — o momento em
que o **Arquiteto passa o handoff ao Dev Lead**.

**O mecanismo do adiamento é não navegar para aquela tela.** Ao criar, o
assistente vai direto para a página do PROJETO. Nada mais precisou ser desligado:
como o disparo mora no `useEffect` de uma rota que deixou de ser visitada, deixar
de visitá-la É o adiamento. A rota continua existindo e continua alcançável — o
Dashboard leva a ela quando o provisionamento **falhou** e precisa ser retomado.

**Provider e credencial saem da criação, e ficam na adoção.** Sem repositório
para criar agora, perguntar "onde hospedar" seria colher uma decisão que a tela
não usa, e o passo de credencial cobraria um PAT para um repositório que ninguém
vai criar. Adotar é o oposto por construção — aponta para um repositório que já
existe, e sem provider não há o que apontar. O assistente passa a ter **três**
passos ao criar e quatro ou cinco ao adotar.

**A tela de Confirmar deixa de prometer o Gitflow.** Ela anunciava "N passos de
Gitflow" ao criar, contando `BOOTSTRAP_STEPS`; isso passaria a ser mentira no
instante em que o bootstrap deixou de rodar ali. Passa a dizer QUANDO o
repositório nasce, em vez de afirmar que já está nascendo.

**Consequência declarada:** entre a criação e o handoff, o projeto existe sem
repositório. Nada quebra — `GET .../repository` responde `null` e não 404, a
página do projeto já tem o estado "repositório não provisionado" e a seção de
Repositório em Configurações simplesmente não aparece —, mas todo caminho que
precise de working tree falha NOMEADO até lá (`remoto_de_trabalho` devolve
`:not_found`, e `open_adr_pr` recusa com "Projeto sem repositório provisionado").
Isso deixa de ser borda e passa a ser o estado normal do começo de um projeto.

**O gatilho é a próxima entrega**, e sem ele um projeto criado hoje ficaria sem
repositório para sempre: o aceite do handoff Arquiteto → Dev Lead passa a
provisionar `local`, o único provider que não pede credencial.
Desde a [RN-582](api.md#rn-582), esse gatilho é o aceite do handoff **ao Arquiteto**
(o do Dev Lead ficou como segunda porta), e ativar a execução sem repositório é
recusado.

O aviso "no plano gratuito do GitHub, repositório privado não aceita proteção de
branch" saiu da tela junto — não por ter deixado de ser verdade, mas por ter
ficado **inalcançável**: a condição era `provider === 'github'`, e ao criar não
há mais provider escolhido.

- **Onde:** `apps/web/src/routes/NewProjectWizard.tsx:379` (`stepKeys`, agora
  dependente de `adotando`), `:540` (a guarda de `provider` restrita à adoção) e
  `:590` (a navegação para `/projects/$projectId`)
- **Teste:** `apps/web/src/routes/NewProjectWizard.test.tsx`, `describe('NewProjectWizard — o git é adiado')`
  — "criar não passa mais pela página de provisionamento — vai direto ao
  projeto", "criar tem TRÊS passos: provider e credencial saíram", "adotar
  mantém provider e credencial" e "a tela de Confirmar não promete mais o
  Gitflow agora"
- **Origem:** pedido do dono do produto — *"o que for gerado por hora segue sem
  git; git mesmo só será iniciado após iniciar desenvolvimento em projetos
  novos, neste momento que deve rodar o bootstrap"*

---

## A tela reconhece um agente local de MÁQUINA já pareado (RN-548, FASE 30)

### RN-548 — Com chave de MÁQUINA ativa, o painel do runner para de mandar parear e passa a dizer o que falta — sem nunca afirmar que o agente está de pé {#rn-548}

Sessão 7 da [FASE 30](../explanation/fase-30-runner-por-maquina.md), decidida pelo
[ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md). É a metade de WEB da
identidade de máquina: a [RN-543](produto.md#rn-543) fez a listagem de chaves marcar a
ESPÉCIE (`projeto` | `maquina`) *"para que uma chave de máquina não ficasse
invisível em toda tela"*, e ficou sem consumidor. Esta RN é o consumidor.

**O defeito, medido.** `RunnerOnboardingPanel` é o painel que os TRÊS pontos de
onboarding montam (`TerminalPanel`, `FolderBrowserModal` e o passo `workspace`
do `NewProjectWizard`), e ele tinha uma pergunta só: *"configure a pasta"*.
Com a chave de máquina do ADR 0154, essa pergunta passa a estar errada no caso
mais comum — a máquina já foi pareada, o que falta é o agente estar rodando.
Mandar a pessoa repetir o pareamento que a máquina já tem é o painel
respondendo à pergunta errada, com um fluxo que termina no terminal dela.

**Sete estados, e nenhum vira o outro
([RN-088](#rn-088)/[RN-470](#rn-470)).** `semPapel`
(não perguntamos),
`verificando` (perguntamos e não voltou), `naoSei` (a pergunta falhou),
`semChaveDeMaquina` (voltou e não há), `revogada` (houve e foi revogada),
`pareadaNuncaUsada` (há chave ativa que agente nenhum usou — a ÓRFÃ da
[RN-519](api.md#rn-519) renascida na espécie nova) e `pareada`. **"Não sei" nunca
vira "não tem"**, e os dois vazios têm textos diferentes porque o gesto é
diferente: um pede parear, o outro explica por que o agente parou de conectar.
A falha é derivada de `isError` e não de haver `status` — erro de rede não tem
status, e derivá-la do status deixaria um `fetch` recusado girando em
"verificando…" para sempre, que é mentira por omissão depois de dez segundos.
`semChaveDeMaquina` é o único que renderiza NADA, e de propósito: o painel
inteiro já É a resposta para "nenhuma máquina pareada".

**Reconhecer NÃO é dizer que o agente está de pé, e a régua é a de sempre.**
`workspaceVerifiedAt` é registro de uma confirmação e não batimento
([RN-468](#rn-468)); chave registrada é a mesma coisa um passo antes — ela
prova que a máquina foi pareada um dia, nunca que há processo vivo agora. Uma
tela que confundisse as duas seria PIOR que a de hoje, porque a de hoje ao
menos não mente. Por isso o tom do alerta é `accent` e nunca `success` (verde
leria como "está de pé" — a mesma aritmética que `AmbienteDoProjeto` faz na
linha do runner), a ressalva é dita em texto ao lado, e quem responde pelo
AGORA continua sendo a `EsperaDoRunner` ([RN-474](#rn-474)), REUSADA e não
reescrita: reconhecida a máquina, o que falta é o agente CONECTAR, que é
exatamente a pergunta dela.

**E há um segundo limite, que o dado impõe e nenhuma redação apaga: a lista é
da CONTA, não deste navegador.** `runner_device_keys` não sabe de que máquina o
navegador está falando, então o mais forte que a tela pode afirmar é *"sua
conta tem uma máquina pareada"* — nunca *"esta máquina está pareada"*. É por
isso que o fluxo do navegador
([ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)) **não é
removido**: ele muda de LUGAR, para um `<details>` cujo rótulo nomeia o único
caso em que ainda é a resposta ("estou em outra máquina"). Aposentá-lo é o
`BRB-031`, decisão do mantenedor, e não consequência desta entrega.

**A ESPÉCIE aparece, e o que aparece é o CUSTO dela.** O painel não lista
chaves nem oferece revogação — isso é a tela que o web nunca ganhou, a metade
aberta da RN-519, e é frente própria. O que
ele diz é o que a espécie significa para quem lê: uma chave de máquina atende
TODOS os projetos do dono em modo `runner`, e revogá-la derruba o agente local
em todos eles ([RN-520](api.md#rn-520), cujo alcance `{projeto, usuário}` não muda
aqui). Sem essa frase, a marca da RN-543 seria decoração.

**O papel é o do ENDPOINT, e a api é a autoridade.** O mínimo sai de
`roleAtLeast` ([RN-102](api.md#rn-102)) contra `developer`, o
que `RunnerDeviceKeysController` exige nas três rotas — a tela deixa de
perguntar o que a api negaria, e diz por quê UMA vez em TEXTO (`title` em
elemento `disabled` não abre no Chromium). Isso **não é fronteira de
segurança**: quem recusa é o `RolesGuard`. O 403 de verdade cai no MESMO
estado, e não é redundância — o papel lido é o de WORKSPACE e quem autoriza é
o EFETIVO do projeto ([RN-471](#rn-471)), uma SOBREPOSIÇÃO nos dois sentidos:
o proxy evita a pergunta obviamente perdida, a api corrige o proxy.

**Onde aparece, e por que não é igual nos três montadores.** O reconhecimento é
por PROJETO, porque a rota é `GET /projects/:projectId/runner-device-keys` —
existe em `TerminalPanel` e `FolderBrowserModal`, que sempre têm projeto, e no
`NewProjectWizard` só DEPOIS da criação antecipada ([RN-437](#rn-437)). Sem
`projectId` não há a quem perguntar e o painel fica byte a byte como era. A
diferença não é escolha de desenho: é a forma do endpoint.

- **Código:** `apps/web/src/lib/agente-de-maquina.ts` (a derivação inteira —
  `reconhecerAgenteDeMaquina`, `podeLerChavesDeDispositivo`,
  `maquinaJaPareada`), `apps/web/src/components/RunnerOnboardingPanel.tsx:173`
  (as duas consultas e o `ReconhecimentoDeMaquina`),
  `apps/web/src/components/RunnerOnboardingPanel.module.css`
  (`.reconhecimento`, `.gesto`), `apps/web/src/lib/api-client.ts:442`
  (`listRunnerDeviceKeys`), `apps/web/src/lib/api-types.ts:791`
  (`RunnerDeviceKeyListItem`, `RunnerDeviceKeyEspecie`),
  `apps/web/src/locales/{en,pt-BR}/terminal.json` (`agenteDeMaquina.*`)
- **Teste:** `apps/web/src/lib/agente-de-maquina.test.ts` — o caminho feliz
  (ativa e usada, com o uso MAIS RECENTE entre N) e os sete estados sem
  colapso, inclusive a falha SEM status e a chave de PROJETO que NÃO conta;
  `apps/web/src/components/RunnerOnboardingPanel.test.tsx` — o painel
  anunciando o pareamento com o gesto do serviço e o fluxo do ADR 0118
  recolhido e ainda alcançável, as duas ressalvas ("não é agente rodando",
  "é da sua CONTA") mais a do alcance, a chave REVOGADA voltando a mandar
  parear, a consulta falhada dizendo que não sabe, o papel abaixo de
  `developer` sem chamar a rota, e o wizard sem `projectId` sem a quem
  perguntar
- **Lacuna DECLARADA, FECHADA depois pela [RN-552](api.md#rn-552):** quando esta RN
  fechou, ninguém CRIAVA chave de máquina (era o `install.sh`, ADR 0155 ponto
  4, sessão 6), então esta tela só era exercitável com uma chave registrada à
  mão — a mesma metade que as RN-543 e RN-544 já declaravam. O comando que o painel oferece é
  `brabo-runner service status --project <id>`, a forma que existe HOJE; a
  forma por máquina chega com a unit da sessão 4 — **FECHADO depois
  (AT-106)**: reconhecida a chave de MÁQUINA, o painel oferece
  `brabo-runner service status --machine` (a unit de máquina da
  [RN-545](runner.md#rn-545)), e o bloco da chave de PROJETO segue oferecendo
  `--project <id>`; as duas espécies ativas mostram cada uma o seu. O comando
  continua sendo para a pessoa PERGUNTAR — a tela não afirma a resposta
  (chaves `agenteDeMaquina.comandoDeServico` e
  `chaveDeProjeto.comandoDeServico`, testes em `RunnerOnboardingPanel.test.tsx`
  nos dois ramos e no par). Uma chave de PROJETO ativa
  NÃO muda o painel: é o defeito irmão, um escopo abaixo, e fechá-lo é decisão
  à parte — **FECHADO depois (AT-107)**: o painel reconhece chave de PROJETO
  ativa DESTE projeto (`reconhecerChaveDeProjeto`, `lib/agente-de-maquina.ts`,
  mesma listagem e mesma `queryKey`, nenhuma rota nova), com o mesmo
  vocabulário — tom `accent`, chave registrada não é agente de pé, o gatilho é
  conferir o serviço — e o custo da ESPÉCIE dito: revogar derruba o agente
  NESTE projeto, não em todos. Chave de outro projeto e revogada não contam, e
  o `<details>` do ADR 0118 continua alcançável. E o web continua sem TELA onde listar ou revogar chave de
  dispositivo (a metade aberta da [RN-519](api.md#rn-519)) — esta entrega consome a
  listagem e não a constrói. **FECHADA depois pela [RN-561](#rn-561)**, que a
  constrói: a seção de Configurações reusa `podeLerChavesDeDispositivo` daqui
  e a MESMA `queryKey`, e por isso revogar por lá invalida o reconhecimento
  deste painel
- **ADR:** [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **Origem:** FASE 30, sessão 7 —
  [o recorte da fase](../explanation/fase-30-runner-por-maquina.md)

---

## A conversão de modo deixa de ser um salto no escuro (RN-559, RN-560)

### RN-559 — A conversão para `mounted` abre o MESMO navegador de pastas do wizard; o ramo `runner` continua digitado, e a tela diz por quê {#rn-559}

`ExecutionModeSection` era o **único dos cinco lugares** do produto em que se
escolhe uma pasta e se digitava o caminho **no escuro** — os outros quatro já
abriam o `FolderBrowserModal` desde a [RN-473](#rn-473)/[RN-504](#rn-504). A
lacuna estava declarada no `CLAUDE.md` e o motivo declarado era do **outro
ramo**: onboardar um runner ANTES de a conversão salvar registra chave num
projeto que ainda não é `runner`, e `ConfirmProjectWorkspaceUseCase` recusa com
400. Nada disso vale para `mounted`, e é isso que esta regra fecha.

**Mesmo componente, mesmo transporte, nenhuma régua nova.** O ramo `mounted`
monta o `FolderBrowserModal` com `origem: { tipo: 'api', workspaceId }` — a
mesma união discriminada que `NewProjectWizard` usa para esse modo
([RN-533](#rn-533)), porque a pasta mora dentro da base do SERVIDOR
([ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md)) e é o servidor quem a
enxerga. Não nasce navegador novo nem endpoint novo, e o navegador **não
garante** caminho válido: quem valida continua sendo
`validarExecutionModeEWorkspacePath` e o CHECK do banco.

**O ramo `runner` NÃO ganha navegador, e isso é decisão, não esquecimento.** O
transporte dele (`{ tipo: 'runner', projectId }`) exige um runner conectado a
ESTE projeto, e um projeto que ainda não é `runner` não tem nenhum — a espera
terminaria num erro com cara de bug. A ordem *"converte, depois onboarda"* segue
sendo decisão de produto à parte. O que muda é a tela passar a **dizer** isso em
texto em vez de só não oferecer botão nenhum, que é a régua do
[ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md): tira-se o
controle, nunca a informação.

**A base é um estado de QUATRO valores, e eles não colapsam.** A rota
`GET workspaces/:workspaceId/projects-base` ([RN-500](api.md#rn-500)) pode estar em
voo, ter falhado, ter respondido `null` ou ter respondido um caminho — e cada
um desses tem texto PRÓPRIO, pela régua da [RN-088](#rn-088)/[RN-468](#rn-468):
*"não sei"* nunca vira *"não tem"*. O botão fica na tela apagado nos três
primeiros, com o motivo dito em TEXTO logo abaixo, e não por `title` (que em
elemento `disabled` não abre no Chromium).

| estado da base | o botão | o que a tela diz |
|---|---|---|
| em voo | apagado | "consultando a base de projetos desta instalação" |
| a consulta falhou | apagado | não deu para SABER se ela existe; recarregue |
| respondeu `null` | apagado | esta instalação não declarou base |
| respondeu um caminho | vivo | a base, NOMEADA, e que é nela que o navegador abre |

O modo `mounted` **não sai do seletor** quando a base falta, e essa é a
diferença deliberada em relação ao wizard ([RN-513](#rn-513)): um projeto que
JÁ é `mounted` não pode ver o próprio modo sumir do controle por causa de uma
consulta em voo. O que some é o NAVEGADOR, não a conversão.

**O mínimo é o do ENDPOINT.** `PUT projects/:projectId/execution-mode` e
`GET workspaces/:workspaceId/projects-base` pedem os dois `maintainer`, lido por
`roleAtLeast` sobre a `ROLE_ORDER` e nunca por uma lista de papéis à mão
([RN-102](api.md#rn-102)) — a seção fazia
`role === 'owner' || role === 'maintainer'`, que acerta por acidente enquanto o
mínimo é alto. Quem não alcança o mínimo não dispara a consulta da base: ela
terminaria num 403 certo, e o *"não sei"* que ela produziria seria sobre a
autorização, não sobre a base.

O valor escolhido no navegador é tratado como valor DIGITADO: ele preenche o
campo e só vai à api quando alguém confirma no botão da seção. Esta seção **não
vira autosave** ([RN-469](#rn-469)).

- **Código:** `apps/web/src/routes/settings/ExecutionModeSection.tsx:68` (os
  quatro estados da base, como união), `:211` (o mínimo por `roleAtLeast`),
  `:220` (a consulta que não sai para quem não alcança `maintainer`), `:260` (a
  derivação dos quatro), `:280` (o que o navegador exige para existir), `:414`
  (o botão, apagado e não escondido), `:423` (o texto do ramo `runner`), `:475`
  (o `FolderBrowserModal` com `origem: { tipo: 'api', workspaceId }`);
  `apps/web/src/locales/pt-BR/settings.json:231` e
  `apps/web/src/locales/en/settings.json:231` (`executionMode.path.*`, os cinco
  textos nos dois idiomas)
- **Teste:** `apps/web/src/routes/settings/conversao-de-modo.test.tsx` — o
  caminho feliz (abrir o navegador, escolher `loja`, o campo preencher e a
  conversão enviar o que foi ESCOLHIDO, só depois do botão), a consulta da base
  FALHANDO (botão inerte, texto próprio, o modal não montando nem à força, e o
  campo continuando editável), a base AUSENTE com texto DIFERENTE do de falha e
  do de carregamento, o ramo `runner` sem botão e com o motivo em texto, e o
  papel abaixo de `maintainer` (controles apagados, valor vigente ainda
  visível, consulta da base não disparada)
- **Lacuna DECLARADA:** o ramo `runner` desta seção **continua digitado no
  escuro** — a lacuna do `CLAUDE.md` encolheu para ele e não fechou. Fechá-la
  exige decidir a ordem "converte, depois onboarda", que é decisão de produto à
  parte e segue sem dono. *Atualização:* a ordem foi decidida e medida na
  [RN-612](#rn-612) — o ramo `runner` ganha o onboarding DEPOIS de salvar, e o
  navegador segue fora por outro motivo, dito lá
- **ADR:** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md),
  [0141](../adr/0141-base-unica-dos-projetos-montados.md)
- **Origem:** AT-049 (EP-021/HS-033)

### RN-560 — O aviso da conversão diz o que ela recusa, o que ela leva e o que ela NÃO leva — nomeando o caminho antigo {#rn-560}

O aviso fixo da seção afirmava *"isto migra a pasta de trabalho do agente"*, nos
dois idiomas. `ConvertProjectExecutionModeUseCase` **não tem uma linha que copie
ou mova conteúdo de pasta**: ele move o `permissions.json` (a POLÍTICA, com
allow/deny/ask intactos — [RN-448](api.md#rn-448)), zera `workspaceVerifiedAt`
([RN-450](api.md#rn-450)) e `mirrorPath` ([RN-515](api.md#rn-515)), desprovisiona o
container ao SAIR de `container` ([RN-449](api.md#rn-449)) e grava o novo
`workspacePath`. `materializarWorkspaceMontado` apenas CRIA a pasta nova
([RN-501](api.md#rn-501)). O que estiver na pasta antiga — **trabalho não commitado
incluído** — fica lá, órfão.

O órfão já era lacuna declarada no `CLAUDE.md` desde a
[RN-447](api.md#rn-447)..[450](api.md#rn-450). O que esta regra fecha não é o órfão: é a
tela afirmando o CONTRÁRIO do que o servidor faz. Isto é correção de afirmação,
não feature — migrar conteúdo entre modos segue fora, sem dono.

**Três fatos, e não um parágrafo**, porque respondem perguntas diferentes:

1. **o que a conversão RECUSA** — dev agent trabalhando ou travado agora vira
   409, e a frase da api é a que aparece no toast (o texto que já existia e
   continua valendo);
2. **o que ela LEVA** — a política do projeto muda de escopo com o conteúdo
   intacto;
3. **o que ela NÃO leva** — o conteúdo da pasta, trabalho não commitado
   incluído, **nomeando o caminho antigo**.

**O aviso NOMEIA o caminho** porque *"fica no disco antigo"* sem dizer QUAL
disco manda a pessoa procurar. O valor está a uma linha de distância
(`project.workspacePath`) e **some da tela** no instante em que a conversão
salva. Quando não há caminho a nomear — o projeto é `container`, e a pasta
antiga é um volume do SERVIDOR — a frase é OUTRA, apontando a pasta gerenciada:
uma variante com `{{caminho}}` vazio diria *"o que estiver em "*, que é a tela
recusando nomear o que sabe. É o caso em que a pessoa tem MENOS como adivinhar.

**Ele não promete detecção.** Perguntar ao disco *"há trabalho não commitado?"*
é I/O por modo e impossível de responder para `runner` do lado da api: a pasta
mora numa máquina que o servidor não enxerga. Não se mede, não se afirma
(ADRs [0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)).
E ele não bloqueia nada: a conversão continua sendo a mesma chamada, com as
mesmas recusas.

O tom do `Alert` passou de `accent` para `warning`, porque o terceiro fato é uma
PERDA de alcance e não uma informação neutra. Segue sem `role="alert"`: é texto
que já estava na tela quando ela abriu, e uma live region assertiva ali viraria
interrupção sem causa.

- **Código:** `apps/web/src/routes/settings/ExecutionModeSection.tsx:333` (os
  três fatos, um por linha), `:337` (a variante que nomeia o caminho antigo × a
  da pasta gerenciada);
  `apps/web/src/locales/pt-BR/settings.json:220` e
  `apps/web/src/locales/en/settings.json:220` (`executionMode.warning.*`, os
  quatro textos nos dois idiomas — `en` é o idioma default do app
  ([RN-425](api.md#rn-425)), e um aviso honesto só em português é a mesma mentira com
  sotaque)
- **Teste:** `apps/web/src/routes/settings/conversao-de-modo.test.tsx` — o
  caminho feliz (o aviso contendo o caminho antigo E as palavras "trabalho não
  commitado"), a variante sem caminho antigo (projeto `container` apontando a
  pasta gerenciada, e a variante com caminho NÃO renderizada), e a prova
  negativa nos DOIS bundles de idioma: a promessa de migração não sobrevive em
  nenhum deles, e as quatro chaves existem em ambos
- **As consequências CONDICIONAIS (AT-144).** A pergunta que esta regra deixou
  em aberto — listar TODAS as consequências ou só a que enganava — foi decidida
  pelo mantenedor: **só as que valem para ESTE projeto**. O aviso acrescenta,
  depois dos três fatos, uma linha por consequência que se aplica, e NENHUMA
  para o que não se aplica:

  | linha | quando aparece | a mesma condição do caso de uso |
  |---|---|---|
  | o destino de espelho é zerado, NOMEADO | `mirrorPath` preenchido | toda conversão zera ([RN-515](api.md#rn-515)) |
  | o container registrado é parado e removido | o projeto é `container` HOJE e o ciclo de vida existe fora de `removed` | `removerContainerSeExistir` só roda ao SAIR de `container` ([RN-449](api.md#rn-449)) |
  | "não consegui ler se há container" | o projeto é `container` e a leitura do ciclo de vida FALHOU | — ("não sei" nunca vira "não tem", [RN-468](#rn-468)) |
  | a pasta confirmada em `<data>` deixa de valer | `workspaceVerifiedAt` preenchido | toda conversão zera ([RN-450](api.md#rn-450)) |

  A linha do container **não** aparece em `mounted`/`runner` mesmo com container
  registrado, porque o caso de uso não o remove ali — o aviso diria o contrário
  do servidor, que é o defeito que esta regra existe para fechar. Os dados são
  os que a seção já tem (`Project`: `mirrorPath`, `workspaceVerifiedAt`,
  `executionMode`) mais o ciclo de vida do container, que a seção NÃO carregava:
  ele vem da rota que JÁ existe, `GET projects/:projectId/container/lifecycle`
  (`viewer`), consultada só quando o projeto é `container` — nenhum endpoint
  novo. Enquanto a leitura está em voo, a linha simplesmente não aparece.
  - **Código:** `apps/web/src/routes/settings/ExecutionModeSection.tsx:106`
    (`consequenciasCondicionais`), `:122` (`containerParaOAviso`, os três
    estados), `:240` (`cicloQuery`, só em `container`), `:344` (as quatro
    linhas no `Alert`)
  - **Teste:** o describe `AT-144` em
    `apps/web/src/routes/settings/conversao-de-modo.test.tsx` — nenhuma
    condição (nenhuma linha a mais), container registrado, linha `removed` que
    não conta, leitura FALHANDO com texto próprio, `mounted` com espelho (a
    linha do espelho sim, a do container não, e a consulta nem sai), `runner`
    com pasta confirmada (com a data), e as três condicionais em `en`
- **ADR:** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)
- **Origem:** AT-050 (EP-021/HS-034); as condicionais, AT-144 (EP-021/HS-034)

## A chave de dispositivo ganha tela, e a tela diz o alcance de revogar (RN-561)

### RN-561 — A aba Configurações lista e revoga chave de dispositivo, marcando a ESPÉCIE — porque revogar a de MÁQUINA derruba o agente local em TODOS os projetos do dono {#rn-561}

A metade que faltava da [RN-519](api.md#rn-519), declarada por escrito desde então no
`CLAUDE.md`: *"o que segue aberto é só a TELA: `apps/web` não tem onde listar
nem revogar, então quem quiser revogar chama a rota"*. As duas rotas existem —
o `DELETE` desde o
[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md) e o
`GET` desde a RN-519 —, e **tela nenhuma as usava**. Esta RN é a tela, e ela
**não abre rota nova**: o que a listagem já devolve basta para desenhar tudo o
que segue.

**Onde ela mora, e por que de PROJETO.** Ela leva a aba Configurações de 17 para
**18** seções e é a **13ª na ordem de render** (`device-keys`, grupo `pessoas`,
logo depois de `access-tokens` — a vizinha que faz o mesmo com PAT); a ordem do
registro é a MESMA do barrel, porque é ela que o scroll-spy usa. De projeto
porque o endpoint é
`/projects/:projectId/runner-device-keys`: uma tela de CONTA exigiria rota nova,
e o recorte é sobre a que existe.

**A ESPÉCIE aparece, e não é enfeite — é o alcance da única ação irreversível
da tela.** Desde a [RN-543](produto.md#rn-543) a listagem marca `projeto` | `maquina`, e
uma chave de MÁQUINA (`project_id` nulo) **serve todos os projetos do dono** e
por isso aparece na lista de TODOS eles. Mostrá-la sem a marca faria a tela
afirmar que é "a chave deste projeto", e quem clicasse em revogar acharia que
derruba o agente local aqui quando derruba **em todos** — a tela mentiria
justamente sobre o que menos pode errar. A marca é `warning` para a de máquina
e `muted` para a de projeto, e **nunca `success`**: verde leria como "está de
pé", que é a aritmética que a [RN-548](#rn-548) já recusou.

**A confirmação DEPENDE da espécie, e diz também o custo colateral.** Revogar
abre um diálogo com TRÊS frases, e a do meio é a que muda: a de máquina nomeia
*todos os seus projetos em modo runner* (o laço de
`RevokeRunnerDeviceKeyUseCase` sobre `listRunnerModeReachableBy`), a de projeto
nomeia *o projeto dela*. Um texto só para as duas mentiria numa das metades. A
terceira frase é o custo que a [RN-520](api.md#rn-520) declarou e que esta entrega
**não muda**: o alvo da desconexão é `{projeto, usuário}` e nunca `{chave}`, então
outro runner do mesmo usuário no mesmo projeto também cai — mesmo autenticado
por PAT ou por outra chave — e reconecta sozinho se a credencial dele ainda
valer.

**Uso registrado NÃO é agente de pé, e o vocabulário é o MESMO da RN-548.**
`lastUsedAt` é a classe de dado do `workspaceVerifiedAt` ([RN-468](#rn-468)):
registro de uma confirmação, nunca batimento. A ressalva é dita em TEXTO na
legenda, e a coluna de status fala de REVOGAÇÃO ("ativa"/"revogada", um fato
sobre a linha), nunca de conexão — quem sabe do AGORA continua sendo o canal do
terminal. Inventar um segundo vocabulário para a mesma distinção seria a tela
dizendo a mesma coisa de dois jeitos, e um dos dois envelheceria.

**Cinco estados, e nenhum vira o outro
([RN-088](#rn-088)/[RN-470](#rn-470)).** Nenhuma chave
("Nenhuma chave de dispositivo sua serve este projeto"), chave REVOGADA (que
**continua na lista** por decisão da RN-519 — sumir com a linha faria a tela
afirmar que nunca existiu, e ela não ganha botão porque revogar de novo, ainda
que idempotente na api, sugeriria efeito que não sobrou), `lastUsedAt` NULO (a
chave ÓRFÃ da [RN-473](#rn-473): registrada por uma aba que fechou no meio do
fluxo e nunca usada por runner nenhum — texto próprio, e uma explicação abaixo
da tabela que só aparece quando existe uma, porque explicar o que não ocorre é
ruído), "ainda não carregou" e "não consegui ler". **"Não sei" nunca vira "não
tem".**

**O papel é o do ENDPOINT, e é o EFETIVO do projeto.** O mínimo é `developer`
— o que `RunnerDeviceKeysController` exige nas TRÊS rotas
([RN-102](api.md#rn-102)) — e a comparação sai da MESMA função
que a RN-548 criou (`podeLerChavesDeDispositivo`, sobre `roleAtLeast`), nunca
uma segunda régua e nunca `role === 'x' || role === 'y'` à mão. O que muda em
relação à RN-548 é o INSUMO: lá o painel lia o papel de WORKSPACE e **declarava**
a lacuna, porque monta em lugares que não buscam `project_members`; aqui os
dados estão à mão — a seção mora na mesma aba que `MembersSection`, com a MESMA
`queryKey`, e o react-query deduplica —, então o papel é composto como no caso
de uso (`projectRole ?? workspaceRole`, uma SOBREPOSIÇÃO nos dois sentidos,
[RN-471](#rn-471)) e a lacuna **fecha** em vez de se repetir. Papel AUSENTE não
é papel INSUFICIENTE: enquanto a lista de membros está em voo a tela diz que
está verificando, e não acusa quem lê de não alcançar `developer`. Quem não
alcança **continua vendo** a seção inteira, o que uma chave de dispositivo é e o
que revogar a de máquina custa — some o CONTROLE, nunca a INFORMAÇÃO
([ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)) —, e o motivo é dito UMA vez
em TEXTO (`title` em elemento `disabled` não abre no Chromium). Como as três
rotas pedem o MESMO papel, quem não alcança também não vê a LISTA: a tela deixa
de perguntar o que a api negaria, em vez de transformar um 403 previsível em
"não consegui ler". Isto **não é fronteira de segurança** — quem recusa é o
`RolesGuard`.

**Uma por vez, e por isso não há desfecho de lote.** A tela não oferece
"revogar todas", então a régua da [RN-469](#rn-469) — ação de UI que vira N
chamadas não é transação, e a tela diz isso — não se aplica: oferecer o lote
criaria um desfecho parcial a narrar para uma ação que ninguém pediu. Falha na
revogação mostra a frase da PRÓPRIA api e a linha **continua** na lista.

- **Código:** `apps/web/src/routes/settings/RunnerDeviceKeysSection.tsx:76`
  (a seção inteira; o papel efetivo em `:107`, a consulta em `:130`, a
  confirmação por espécie em `:326`);
  `apps/web/src/routes/settings/sumario.ts:62` (a entrada nova, 13ª na ordem de
  render, das 18);
  `apps/web/src/routes/ProjectSettingsTab.tsx:86` (a composição, na MESMA
  ordem); `apps/web/src/locales/{en,pt-BR}/settings.json`
  (`runnerDeviceKeys.*`). Consome `listRunnerDeviceKeys`/
  `revokeRunnerDeviceKey` (`apps/web/src/lib/api-client.ts:431`) e
  `podeLerChavesDeDispositivo` (`apps/web/src/lib/agente-de-maquina.ts:68`) sem
  alterar nenhum dos dois
- **Teste:** `apps/web/src/routes/settings/chaves-de-dispositivo.test.tsx` — as
  duas espécies marcadas na mesma lista; a revogada que fica, marcada e sem
  botão; a órfã com texto próprio e a explicação que NÃO aparece sem ela; vazio
  e falha com textos diferentes; a ressalva de que uso registrado não é agente
  de pé; o aviso de alcance nas DUAS espécies, com a chamada saindo só depois
  de confirmar; cancelar sem revogar; a falha trazendo a frase da api com a
  chave ainda na lista; `viewer` sem chamar a rota e com o motivo em texto; a
  sobreposição do papel de projeto nos DOIS sentidos; e o papel ausente que
  diz "verificando" em vez de acusar
- **Fica declarado e NÃO fecha:** (1) o **alvo da revogação** continua sendo
  `{projeto, usuário}` e nunca `{chave}` — a tela DIZ isso e não muda, porque
  mudar exige coluna nova em `runner_socket_tickets` e contrato novo de auth
  (RN-520), frente própria com ADR; (2) numa instalação **sem PROJETO**, a
  chave de máquina recém-criada pela [RN-552](api.md#rn-552) segue **inalcançável**:
  as duas rotas são de projeto, e sem projeto não há a quem perguntar — FECHOU
  na [RN-611](api.md#rn-611), com rota e seção por CONTA; (3) a
  visão de `maintainer` (listar/revogar de qualquer usuário) continua FORA por
  decisão da RN-519, não por omissão desta tela; (4) sem E2E de navegador — o
  que se prova aqui é o que a tela AFIRMA, e isso a suíte de componente prova
- **Origem:** AT-012 (EP-003/HS-007)

---

### RN-568 — A presença de QA, SecOps e dos membros de área no painel do time é decidida pela sessão INTEIRA, não pela janela de 200 eventos {#rn-568}

A Visão geral e a aba Executores montam a roster com `deriveAgentRoster` sobre
os ÚLTIMOS 200 eventos da sessão (`useSessionEvents`, `latest: true`). Dois dos
fatos de presença saíam dessa janela: `gatesEverOpened` (qa e secops entram
quando algum `pr.gate_changed`/`infra.gate_changed` já aconteceu) e
`delegatedSubagents` (membro de área entra com delegação registrada). Os dois
eventos são dos primeiros de uma execução — numa sessão longa eles saem da
janela, e QA, SecOps e `qa-automacao` **sumiam do painel** de uma execução que
continuava rodando. É a mesma classe de defeito que já tinha sido fechada para
`executionActivated`, e o resumo do workspace ([RN-090](api.md#rn-090)) já agregava
os dois fatos sobre a sessão inteira (`bool_or` e `selectDistinct` em
`projects-summary.repository.ts`) — as duas telas o carregavam e ignoravam
esses dois campos.

**A regra:** `deriveAgentRoster`/`rosterFactsFromEvents` aceitam um
`agregado` OPCIONAL (`AgregadoDaSessao`), e as duas telas o preenchem com o
resumo. Quatro decisões, cada uma com motivo:

1. **Ausente é "não li", nunca "não houve".** Sem resumo carregado (primeiro
   paint, erro), o fato sai só da janela, exatamente como antes. Leitura
   ausente nunca vira "QA não está aqui".
2. **O agregado SOMA à janela, não a substitui** (OU lógico no gate, união nas
   delegações). Os dois fatos são MONÓTONOS dentro de uma sessão — gate que
   abriu não desabre, delegação registrada não some —, então a janela só
   produz falso NEGATIVO, nunca falso positivo. Um `false` agregado que
   discorde de um gate VISTO na janela é resumo atrasado (as duas leituras
   têm cadências próprias de poll), e não pode esconder QA.
3. **Só vale quando o resumo é da MESMA sessão que a tela lê**
   (`latestSessionId === sessionId`). O resumo agrega a sessão mais RECENTE
   do projeto; a Visão geral lê essa mesma sessão, mas a aba Executores lê a
   sessão de EXECUÇÃO vigente ([RN-139](api.md#rn-139)). Uma ideação aberta depois
   faz as duas divergirem, e aí o agregado seria de OUTRA sessão — a tela
   volta a decidir só pela janela.
4. **Só a PRESENÇA muda.** `rosterFromFacts` (a regra única, compartilhada com
   o card do dashboard) fica intacto, e o STATUS de cada agente (`gateStatus`,
   `subagentStatus`) continua lido da janela. Nenhuma requisição nova e o teto
   de 200 não muda.

`delegatedSubagents` entrou pelo MESMO molde porque cabe sem mudar regra: a
tabela `delegations` que o resumo lê e os eventos `delegation.*` que a janela
lê nascem juntos em `RecordDelegationUseCase` (uma linha, um evento, os três
desfechos), então os dois conjuntos descrevem a mesma coisa.

**`executionActivated` (AT-130).** É o terceiro fato do mesmo molde: a aba
Executores o lia do resumo SEM a guarda do item 3, então com uma sessão mais
nova que a de execução o resumo (dela) dizia `false` e os dev agents sumiam —
ou `true`, e apareciam sem prova. Agora ele vai em `agregado.executionActivated`
só quando `latestSessionId === sessionId`, e `deriveAgentRoster` o SOMA (OU
lógico, monótono) à janela e ao parâmetro, que também passa a olhar
`execution.activated` nos eventos. Sem campo novo na API. Testes:
`ProjectExecutorsTab.test.tsx` (resumo de OUTRA sessão, nos dois sentidos).
**Segue aberto:** com a sessão de execução longa E o resumo de outra sessão, o
evento pode ter saído da janela e a aba volta a decidir só por ela — é o custo
da guarda, o mesmo dos outros dois fatos.

- **Código:** `apps/web/src/lib/agent-status.ts:324` (`AgregadoDaSessao`),

- **Código:** `apps/web/src/lib/agent-status.ts:324` (`AgregadoDaSessao`),
  `:296` (o parâmetro opcional de `rosterFactsFromEvents`), `:304` (a união das
  delegações), `:312` (o OU do gate), `:410` (o parâmetro repassado por
  `deriveAgentRoster`); `apps/web/src/routes/ProjectOverviewTab.tsx:97` e
  `apps/web/src/routes/ProjectExecutorsTab.tsx:111` (o agregado com a guarda
  de sessão)
- **Teste:** `apps/web/src/lib/agent-status.test.ts:628` (o bloco inteiro:
  `:633` gate fora da janela traz QA/SecOps com status da janela, `:658` sem
  agregado a janela decide sozinha, `:676` `false` agregado não esconde gate
  visto na janela); `apps/web/src/routes/ProjectExecutorsTab.test.tsx:385`
  (QA e membro de área voltam pelo resumo), `:397` (resumo de outra sessão não
  decide); `apps/web/src/routes/ProjectOverviewTab.test.tsx:301` (SecOps volta
  pelo resumo)
- **Origem:** AT-047 — a lacuna declarada no `CLAUDE.md` e nos comentários das
  duas telas

### RN-572 — A árvore do time traduz todo tipo `dev.*` que o engine emite, e só diz trabalho em curso onde o painel diz `trabalhando` {#rn-572}

Numa instalação real (14/09) os dev agents "não saíram do *começou a task*".
O event log tinha `dev.started` seguido de `dev.blocked_by_container`, com o
`reason` por extenso ([RN-502](engine.md#rn-502)). A árvore do time
(`timeline-tree.ts`) não tinha tradução para o bloqueio — o que não está em
`TRADUCAO` é descartado —, então o ramo parava no marco anterior e a frase do
presente afirmava trabalho sobre um agente parado. O painel do time, na mesma
tela de execução, já dizia `aguardando` para o mesmo evento
(`DEV_STATUS_EVENTS`, [RN-411](ci.md#rn-411)): duas telas, duas tabelas, e só uma
delas estava coberta pela comparação com o vocabulário do engine.

**A regra**, em três partes:

1. **Todo tipo `dev.*` que o engine emite tem decisão na árvore** — traduzido
   em `TRADUCAO` ou declarado em `TRADUCAO_FORA` com o motivo (vazia hoje).
   Omitir deixou de ser possível: `scripts/ci/vocabulario-de-eventos-dev.spec.ts`
   deriva o vocabulário do engine pelo mesmo extrator do inventário de eventos
   e reprova, nomeando o tipo, o que faltar; e reprova também o tipo `dev.*`
   traduzido que o engine não emite. Na primeira rodada ele achou DOIS
   faltando (`dev.blocked_by_container` e `dev.error`) e UM sobrando
   (`dev.rearmed`, que a api grava com ator `user` e que por isso nunca chegou
   a ramo nenhum — a árvore só pendura marco de ator `agent`).
2. **Se o último marco de um dev agent é trabalho em curso não se decide na
   árvore.** Para marco `dev.*`, o ramo só fica ATIVO quando o painel dá
   `trabalhando` ao mesmo evento (`statusDoEventoDev`, lido de
   `DEV_STATUS_EVENTS`). `aguardando`, `ocioso`, `falhou` e `travado` deixam o
   ramo parado — e com eles `dev.idle`, `dev.blocked`, `dev.awaiting_gate`,
   `dev.awaiting_approval` e `dev.idle_tripped`, que antes também contavam
   como ativos. Tipo `dev.*` que o painel não decidiu NÃO vira ativo: na
   dúvida a tela não afirma trabalho.
3. **O bloqueio por container é marco próprio** (`espera`, cor de
   `warning`, a mesma do gate), com o `reason` do engine como detalhe — é ele
   que diz o que fazer. E `dev.started` deixa de dizer "começou a task":
   medido no engine, ele sai ao RECEBER a ordem de trabalhar, antes de
   `try_claim` (`DevAgentServer.handle_cast(:work)`); passa a dizer
   "procurando task", e quem afirma a task é `dev.working`, que agora mostra o
   título dela.

**O que esta regra NÃO faz, e por quê:**

- **`container.start_failed` não entra na árvore.** É a razão do bloqueio,
  mas o ator é `system` (`action-executor`): pendurá-lo no ramo de um dev
  agent seria inventar autoria, e o único outro lugar da estrutura, o
  `tronco`, NÃO É RENDERIZADO por consumidor nenhum (medido:
  `AgentTimelineTree` e a seção Atividades do `Shell` leem só `ramos`). O
  evento continua no log cronológico, a um clique, e o ramo bloqueado já diz,
  pelo `reason`, que falta subir o container.
- **Os rótulos da árvore ficaram em pt-BR fixo nesta correção** — migrá-los
  era mudança da tela inteira. A AT-134 fez essa migração depois, e ela NÃO
  mexeu na regra acima: a DECISÃO por tipo (se vira nó, que `MarcoTipo`, que
  detalhe) continua em `TRADUCAO`, no código, e é ela que o spec compara com o
  engine; só o TEXTO saiu, como CHAVE (`ChaveDeRotulo`) resolvida em
  `executors:timelineTree.label.*`, com a frase do presente em
  `timelineTree.now.*` e o detalhe de origem em `timelineTree.detail.origin`,
  nos dois idiomas (`en` é o default, [RN-425](api.md#rn-425)). `montarArvore`
  recebe o idioma como argumento (`getFixedT`), e os dois consumidores
  (`AgentTimelineTree` e a seção Atividades do `Shell`) o passam do
  `useTranslation` — trocar de idioma refaz a árvore. Uma chave que a tabela
  usa sem texto em um dos dois locales reprova em `timeline-tree.test.ts`.

- **Código:** `apps/web/src/lib/timeline-tree.ts:161` (`TRADUCAO`), `:205`
  (`dev.started`), `:206` (`dev.working` com o título), `:222`
  (`dev.blocked_by_container`), `:227` (`dev.error`), `:246`
  (`TRADUCAO_FORA`), `:307` (o `ativo` lido do painel), `:96`
  (`ChaveDeRotulo`, AT-134), `:135` (`tradutorDaArvore`);
  `apps/web/src/locales/{en,pt-BR}/executors.json` (`timelineTree.label`,
  `timelineTree.now`, `timelineTree.detail`);
  `apps/web/src/lib/agent-status.ts:134` (`statusDoEventoDev`);
  `apps/web/src/components/AgentTimelineTree.module.css` (`.espera`)
- **Teste:** `scripts/ci/vocabulario-de-eventos-dev.spec.ts:300` (o bloco da
  árvore: `:308` todo tipo do engine decidido, `:324` nada traduzido que o
  engine não emite, `:342` nada nos dois lados);
  `apps/web/src/lib/timeline-tree.test.ts:130` (a sequência medida:
  `dev.started` + `dev.blocked_by_container` deixa o ramo parado com o
  motivo — caso de falha), `:149` (`dev.started` não afirma task), `:156`
  (estados que o painel não chama de trabalho deixam o ramo parado; `dev.working`
  segue ativo com o título), `:168` (`dev.error` encerra com o motivo), `:367`
  (AT-134: toda chave usada tem texto nos dois locales, as subárvores têm as
  mesmas chaves, e o idioma passado vence o ativo)
- **Origem:** AT-087 — instalação real de 14/09; o i18n dos rótulos, AT-134

## O repositório nasce no aceite do handoff ao Arquiteto, e a execução não começa sem ele (RN-582)

### RN-600 — A criação de projeto pela tela não manda o corpo que a api já se sabe que recusa, uma criação por vez, e a recusa aparece na tela {#rn-600}

No teste do dono em 26/09 a api registrou 11 `POST /workspaces/:id/projects →
400` em ~4 s, e o mesmo projeto `runner`, criado pela api com caminho, saiu 201.
Medido por leitura e reproduzido no vitest do assistente: não há retry
automático (`createProject` é chamada direto, sem `useMutation`), então cada
POST foi um CLIQUE. A causa provável é o "Procurar pasta..." do modo `runner`,
que CRIA o projeto antecipadamente ([RN-437](#rn-437)): no passo de detalhes o
campo de caminho fica ACIMA do nome, e clicar antes de digitar o nome mandava
`{ name: '', slug: '', executionMode: 'runner', workspacePath:
'/workspace-a-confirmar' }` — o `CreateProjectDto` recusa `name` com menos de 2
caracteres e `slug` fora do kebab-case —, e a falha virava só o toast "Não deu
para preparar a navegação de pasta agora", sem motivo; clicar de novo era a
única resposta que a tela sugeria. Um nome de UMA letra passava no `Continuar`
e voltava 400 no "Provisionar" pelo mesmo `MinLength(2)`.

Três metades, todas na tela (a api está certa em recusar):

1. **Não mandar o que já se sabe recusado.** `nomeAceitoPelaApi` espelha o DTO
   (2+ caracteres, recortado, e slug não vazio) e passa a ser o gate de nome do
   passo de detalhes. No modo `runner`, "Procurar pasta..." fica INERTE enquanto
   o nome não passa, ou enquanto um caminho DIGITADO não é plausível
   (`caminhoLocalParecePlausivel`), e o motivo é dito em texto abaixo do campo
   (`procurar-bloqueado`, ADR 0064). Caminho VAZIO continua não bloqueando — o
   placeholder provisório da [RN-437](#rn-437) cobre. É a revisão da frase
   "nunca bloqueando o clique" da RN-437, que falava do CAMINHO e não previu o
   nome vazio. O nome vai recortado no corpo.
2. **Uma criação por vez.** `criacaoEmVoo` (um `useRef`) trava os DOIS caminhos
   que criam — "Procurar pasta..." e "Provisionar" —, porque o `disabled` só
   chega ao botão no render seguinte. No jsdom o `disabled` já segura o segundo
   clique; a ref é o que segura dois eventos no mesmo quadro do navegador.
3. **A recusa na tela.** A falha 400 da criação antecipada passa a pôr a frase
   da api (`mensagemDaApi`, lista do `class-validator` juntada) no MESMO
   `Alert` do passo que o "Provisionar" já usava ([RN-170](api.md#rn-170)); outros
   erros seguem só com o toast.

**O que não foi medido:** o log da api do teste do dono não sobreviveu ao
reinício do container, então o CORPO de cada um dos 11 POSTs não foi visto — a
causa acima é a única que a leitura do código e o vitest reproduzem, e não
prova que foi ela. A adjacência ([RN-437](#rn-437)) segue como era: o projeto
criado antecipadamente com o caminho provisório não recebe o caminho refinado
depois no "Provisionar" (ele é REUSADO, não atualizado) — quem o corrige é o
runner ao conectar (RN-423).

- **Código:** `apps/web/src/lib/wizard.ts:108` (`nomeAceitoPelaApi`);
  `apps/web/src/routes/NewProjectWizard.tsx:112` (`montarPayloadDeCriacao`),
  `:202` (`criacaoEmVoo`), `:321` (`bloqueioDoProcurarNoRunner`), `:486`
  (`handleProcurarPasta`), `:536` (`handleConfirm`)
- **Teste:** `apps/web/src/routes/NewProjectWizard.test.tsx:850` (describe
  `criar projeto sem rajada de 400` — sem nome, 11 cliques e nenhum POST;
  caminho relativo; nome de uma letra; nome recortado; três cliques no mesmo
  quadro criam um; a recusa da api na tela); `apps/web/src/lib/wizard.test.ts:210`
  (`nomeAceitoPelaApi`)
- **Origem:** AT-215 (teste do dono, 26/09), irmã da AT-214

## A conversão de modo deixa de ser um salto no escuro (RN-559, RN-560)

### RN-612 — Converter para `runner` é converte, DEPOIS onboarda: salvar monta o painel de onboarding do projeto agora `runner`, e o navegador de pastas fica fora por construção {#rn-612}

O ramo `runner` da conversão era digitado no escuro ([RN-559](#rn-559)) porque a
ordem estava indecidida: onboardar ANTES de salvar registra chave num projeto
que ainda não é `runner`, e `ConfirmProjectWorkspaceUseCase` recusa a
confirmação com 400. A decisão do mantenedor foi **medir** a outra ordem com a
chave de MÁQUINA ([RN-543](produto.md#rn-543)/[RN-548](#rn-548)) e implementar se o
atrito fosse aceitável. A medição foi feita no CÓDIGO (sem subir o ambiente) e
deu isto:

| quem vai atender o projeto | o que acontece depois de salvar | gestos |
|---|---|---|
| agente de MÁQUINA esperando (zero projetos `runner`, [RN-550](runner.md#rn-550)) | a próxima consulta de `GET /runner/projects` o lista e o agente conecta sozinho — cadência 15/30/60 s de `espera-de-projetos.ts` | **zero**, em até 60 s |
| agente de MÁQUINA já atendendo OUTRO projeto | a lista é lida UMA vez, no start, com conexão viva (RN-550) — o projeto novo **não** entra | **um**: reiniciar o serviço |
| nenhuma chave de máquina | o mesmo pareamento da criação de projeto ([RN-473](#rn-473)) | parear + um comando |

Nos três casos o atrito é o da criação de projeto ou menor, então a conversão
passa a ser **dois passos na mesma seção**: salvar para `runner` monta, logo
abaixo, o MESMO `RunnerOnboardingPanel` da aba Código e do wizard, com o
`projectId` de um projeto que agora É `runner` — o reconhecimento da máquina
pareada, a `EsperaDoRunner` e o pareamento do ADR 0118 vêm junto, sem régua
nova. Acima do painel a seção DIZ a assimetria do agente de máquina (espera
sozinho × reinício), com o comando de reinício das duas plataformas
(`systemctl --user restart brabo-runner.service`,
`launchctl kickstart -k gui/$(id -u)/dev.brabo.runner`): a tela não sabe se o
agente tem outra conexão viva, então nomeia os dois casos em vez de afirmar um.

O painel aparece quando o projeto SALVO é `runner`, sem troca de modo pendente
no seletor, e com a pasta ainda não confirmada — ou até o fim da visita em que
a conversão salvou, para a `EsperaDoRunner` mostrar a confirmação em vez de
sumir no instante em que ela chega. Um projeto `runner` já confirmado não o
ganha.

**O caminho digitado é PROVISÓRIO, e a tela diz isso.** Quem decide a pasta de
um projeto `runner` é o runner: a confirmação SOBRESCREVE `workspacePath`
([RN-423](runner.md#rn-423)), e o agente de máquina nem olha o valor digitado — ele usa
`<base>/<workspaceDirName>` ([RN-544](runner.md#rn-544)). O campo continua obrigatório
porque o CHECK do banco pede caminho não-nulo fora de `container`; a seção não
inventa placeholder.

**O navegador de pastas continua FORA do ramo `runner`, e agora pelo motivo
certo.** Não é mais a ordem: é que o transporte `{ tipo: 'runner', projectId }`
exige um runner conectado a ESTE projeto, e um runner conectado já confirmou a
PRÓPRIA pasta (`--dir`, ou a derivada da base). Escolher outra ali seria uma
segunda conversão `runner → runner` que a próxima reconexão desfaria. Oferecer o
botão seria um controle que não controla nada; a seção diz isso em texto
([ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)).

- **Código:** `apps/web/src/routes/settings/ExecutionModeSection.tsx:304`
  (`mostrarProximoPasso`), `:317` (`setConvertidoParaRunner`, a visita em que a
  conversão salvou), `:452` (o bloco do próximo passo), `:487`
  (`RunnerOnboardingPanel`, o mesmo da aba Código);
  `apps/web/src/locales/pt-BR/settings.json:249` e
  `apps/web/src/locales/en/settings.json:249` (`executionMode.nextStep.*`) e
  `:238` (`executionMode.path.runnerTyped`, reescrito); a cadência medida em
  `apps/runner/src/espera-de-projetos.ts:60` (`CADENCIA_DA_ESPERA_MS`) e a
  lista lida uma vez em `apps/runner/src/index.ts` (`rodarComoAgenteDeMaquina`)
- **Teste:** o describe `RN-612` em
  `apps/web/src/routes/settings/conversao-de-modo.test.tsx` — o caminho feliz
  (antes de salvar não há painel; salvar monta o próximo passo, com o comando de
  reinício, e o painel pergunta pelas chaves DESTE projeto), a chave de máquina
  reconhecida, o caso de falha (projeto `runner` já confirmado não ganha o
  passo), o rascunho de outro modo escondendo o passo, e o texto em `en`
- **Lacuna DECLARADA:** o reinício do agente de máquina que já atende outro
  projeto continua sendo um gesto no terminal — repesquisar a lista com conexão
  viva foi recusado pela RN-550, e esta regra não reabre isso. E a medição é de
  CÓDIGO, não de tela: o ambiente não foi subido
- **ADR:** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md),
  [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **Origem:** AT-143 (EP-021/HS-033)

---

## O repositório nasce no aceite do handoff ao Arquiteto, e a execução não começa sem ele (RN-582)

### RN-614 — A tela mostra o motivo da política e a raiz do escopo, numa frase só, nos dois lugares {#rn-614}

A [RN-567](api.md#rn-567) pôs no `proposed_action.created` a regra que decidiu
(`reason`) e a [RN-609](api.md#rn-609) pôs a raiz do escopo (`scopeRoot`, só em
`terminal`) — e as duas declararam que a tela não mudava. Quem auditava pela
tela uma ação que PASSOU continuava sem saber qual regra a deixou passar.

**A regra:** o dado aparece em DOIS lugares (decisão do mantenedor), e os dois
dizem a MESMA frase, montada por UMA função, `fraseDaDecisaoDaPolitica`:

- a **linha do evento no painel de log** — `classifyEvent` ganha o ramo de
  `proposed_action.created` (tipo `permission`, `bad` quando negada), com o
  desfecho da política e, depois do travessão, a frase;
- o **`ApprovalCard`**, numa linha própria logo abaixo da frase do que
  acontece ([RN-096](produto.md#rn-096)) — nunca dentro do payload colapsado.

A ação (`proposed_actions`) não guarda nenhum dos dois campos: a tela os lê do
EVENTO, que ela já carrega (`decisaoDaPoliticaDaAcao`, pelo `actionId`). Por
isso o card tem TRÊS estados, que não colapsam: tela que não lê o event log
(o painel "precisa de você", PRs, containers) não passa o dado e o card CALA;
tela que lê (o chat da sessão e a fila da aba Aprovações, ambos sobre a sessão
mais recente) e não achou o evento na janela carregada diz *"fora dos eventos
carregados nesta tela"*; e o evento achado dá a frase. A aba Insights não tem
`ApprovalCard` — hipótese do Psicólogo não é `proposed_action`.

**Desde a AT-336 ([RN-656](api.md#rn-656)), cada card da aba Aprovações tem o
PRÓPRIO motivo**, lido pela ação quando o log carregado não o cobre; o
parágrafo seguinte é o estado da AT-333, que ela substituiu — a nota única
sobra só para a leitura que FALHA. Desde a AT-340 o mesmo vale para os cards
das pendências de OUTRAS sessões no chat ([RN-626](#rn-626)), que antes
calavam: o log do fio nunca cobre ação de outra sessão.

**Na AT-333, a fila da aba Aprovações passou a dizer a lacuna UMA vez.** A fila é a
do PROJETO ([RN-638](#rn-638)) e os eventos são os de UMA sessão, então ali o
*"fora dos eventos carregados"* saía em quase todo card — verdade repetida por
card, a ferramenta se explicando. A api não expõe o motivo por ação (a ação
não o guarda, e a leitura de eventos não filtra por `actionId`: medido), e
buscar sem janela exigiria endpoint novo. A aba passa então a CONTAR as
pendentes sem o evento e a dizer, numa nota acima da fila, quantas são e por
quê (*"destas N ações"*, ou *"de N das M ações abaixo"*), no molde da
[RN-180](#rn-180); o card dessas cala (o estado "tela que não lê"), e o card
cujo evento está carregado continua mostrando a frase. A nota só conta com o
log em mãos: antes de os eventos chegarem ela não afirma nada. O chat da
sessão segue com os três estados por card — ali o recorte é o do próprio fio.

**Ausente não é "sem motivo", e o absoluto nunca aparece.** Evento anterior à
RN-567 diz *"motivo da política não registrado"*; `terminal` anterior à RN-609
diz *"raiz do escopo não registrada"*; outro tipo, sem `scopeRoot`, não fala de
raiz (o escopo só é consultado em `terminal`). As quatro âncoras têm texto
próprio — pasta gerenciada, segmento dentro da base de projetos, nome da pasta
na máquina do runner, e `indisponivel` (*"sem forma relativa"*, sem segmento).
Âncora que a tela não conhece diz que não conhece, e não imprime o segmento: a
tela não reconstrói caminho nenhum. As frases estão em `en` e `pt-BR`
(`approvals.json`, chave `politica`).

- **Código:** `apps/web/src/lib/decisao-da-politica.ts:111`
  (`fraseDaDecisaoDaPolitica`), `:65` (`lerDecisaoDaPolitica`), `:124`
  (`decisaoDaPoliticaDaAcao`), `:145` (`linhaDoEventoDePolitica`);
  `apps/web/src/lib/activity.ts:721` (o ramo de `proposed_action.created`);
  `apps/web/src/components/ApprovalCard.tsx:272` (a linha do card);
  `apps/web/src/routes/session-timeline-montagem.tsx:825` e
  `apps/web/src/routes/ProjectApprovalsTab.tsx:311` (`decisoesDaPolitica`, desde a
  AT-336 por `useDecisoesDaPolitica`) e `:499` (quem passa o dado)
- **Teste:** `apps/web/src/lib/decisao-da-politica.test.ts:43` (as âncoras,
  `:43`/`:54`/`:65`/`:76`), `:87` (evento antigo), `:102` (âncora desconhecida
  sem vazar caminho), `:114` (os dois idiomas), `:144` (a linha do log É a
  frase do card); `apps/web/src/components/ApprovalCard.test.tsx:733` (o card
  usa a mesma função, e os três estados);
  `apps/web/src/routes/ProjectApprovalsTab.test.tsx:304` (desde a AT-336, a nota
  conta só a leitura que falha)
- **Origem:** AT-148 (EP-025/HS-043); a nota da fila, AT-333; o motivo por cartão, AT-336

---

## O idioma das respostas dos agentes (RN-618..620, RN-622..624, ADR 0177)

### RN-620 — A barra da sessão mostra o idioma das respostas de QUEM VÊ, com a origem, e trocar ali é o override só daquela pessoa naquela sessão {#rn-620}

1. **Ao lado do seletor de modelo, em outro escopo.** O modelo da barra é da
   SESSÃO e vale para todos; o idioma é da PESSOA (`GET
   .../sessions/:sessionId/response-language`, resolvido para quem chama,
   [RN-618](api.md#rn-618)). Trocar ali é o override por sessão — decisão do
   mantenedor, AT-169 resposta 2 — e nunca mexe no de outro participante nem
   na Conta.
2. **Nunca o valor sem a origem** (a régua da [RN-470](#rn-470)): "fixado
   por você nesta sessão", "escolhido por você na Conta", "detectado pelas
   suas mensagens e confirmado por você" e "o idioma da interface" são
   quatro textos, e nenhum colapsa em outro. Carregando e falhou também têm
   texto próprio — a falha não finge um idioma. O detectado nunca vira
   afirmação sobre a pessoa ("você é brasileiro"), só sobre as mensagens
   (AT-080).
3. **"Seguir a Conta" solta o override** (`language: null`) e diz em QUE
   idioma isso dá — a mesma cadeia sem o degrau da sessão, derivada no
   cliente da cadeia que a rota já devolve, sem endpoint novo. "Outro
   código…" abre um campo que só fixa no botão (RN-469), e a recusa da api
   chega no toast com a frase dela. Um link leva à Conta, onde mora a
   escolha que vale em todas as sessões.
4. **Quem troca**: o mínimo do `PUT` (`developer`), por `roleAtLeast` sobre o
   papel de WORKSPACE (a lacuna declarada das telas que não buscam
   `project_members`). Abaixo dele o valor e a origem continuam na barra, o
   seletor fica inerte e o motivo vem em texto.
5. **O que a barra NÃO afirma**: nunca "os agentes respondem em X" como fato
   sobre a pessoa — só o efetivo e a origem. Desde a [RN-622](engine.md#rn-622) esse
   efetivo chega ao modelo nas mensagens de quem vê, e o aviso "ainda não
   chega aos agentes" saiu da linha de origem. A linha trunca nos 60px da
   barra e leva o texto inteiro no `title` — o texto está na tela, o `title`
   só devolve o que as reticências cortaram.
6. **Na barra estreita, o idioma MUDA de lugar e não some** (AT-317). A barra
   se arruma pela PRÓPRIA largura (`modoDaBarra`, medida por
   `ResizeObserver`; largura desconhecida é a barra completa): a partir de
   1720px tudo fica em linha; abaixo disso modelo, idioma e orçamento viram UM
   controle cujo gatilho resume o modelo e o código do idioma (abaixo de 920px
   só o ícone, com nome acessível), e o painel dele traz o indicador inteiro
   com a origem QUEBRANDO em vez de cortar. A pergunta da detecção
   ([RN-624](api.md#rn-624)) mora no painel, e enquanto existe o gatilho ganha uma
   marca e o nome acessível a anuncia. O título da sessão é o único item que
   encolhe (com piso e o nome inteiro no `title`), e os botões não quebram
   linha — "Encerrar" vira ícone com nome acessível só na barra mínima.

- **Código:** `apps/web/src/routes/SessionLanguageIndicator.tsx:84`
  (`SessionLanguageIndicator`), `:40` (`idiomaSemOverride`), `:175`
  (`origemPorExtenso`), `:224` (`podeTrocar`);
  `apps/web/src/routes/SessionTopbar.tsx:260` (`SessionLanguageIndicator`),
  `:128` (`modoDaBarra`), `:377` (`AjustesAgrupados`);
  `apps/web/src/lib/modo-da-barra-da-sessao.ts:35` (`modoDaBarra`)
- **Teste:** `apps/web/src/routes/SessionTopbar.test.tsx:174` (a barra de
  1440px não é completa), `:191` (agrupa, e o painel traz idioma com origem),
  `:236` (barra mínima com nome acessível), `:256` (pergunta pendente marca o
  controle), `:273` (leitura do idioma falhada — caso de falha);
  `apps/web/src/routes/SessionLanguageIndicator.test.tsx:99`
  (efetivo com origem e o link, sem o aviso antigo), `:112` (o detectado não vira
  "escolhido"), `:126` (trocar fixa só nesta sessão), `:151` ("Seguir a
  Conta" manda `null`), `:180` (recusa da api — caso de falha), `:202`
  (abaixo de `developer`), `:213` (leitura falhada), `:225` (a cadeia sem a
  sessão)
- **Origem:** AT-165, sobre as decisões das AT-169 (resposta 2) e AT-168
  (resposta 7)

## Decidir no chat, onde o dono está (RN-626)

### RN-626 — O chat da sessão decide o que os agentes propuseram noutra sessão, mostra o turno que estava em curso e propõe o merge — sem mudar teto nenhum {#rn-626}

O uso real de 2026-09-29 mediu o custo de o dono conversar numa sessão e os dev
agents proporem noutra: as aprovações deles nunca apareciam onde ele estava, 45
de 173 cliques em "Sempre permitir" voltaram 409 (o card continuava clicável
depois de a ação já ter saído de `pending`), e reabrir a sessão com um turno em
curso devolvia o composer livre e o 409. As quatro correções são de TELA — a
api, o engine e todo teto ficam como estão.

1. **O card fica inerte e diz a frase da api (AT-256).** `ApprovalCard` segura
   os botões enquanto a decisão está em voo (o duplo clique era um 409 certo) e,
   quando a chamada devolve promessa que rejeita, mostra a frase que a api
   mandou NO card — nunca um toast genérico. Um 409 (a ação já não está
   `pending`) deixa os botões inertes com o motivo em texto até a lista trocar o
   card pela linha de desfecho. Quem chama devolve a promessa e refaz a lista
   MESMO na recusa (`finally`): é UMA invalidação por clique, sem poll novo, e a
   invalidação usa o canal e o orçamento da [RN-579](engine.md#rn-579).
2. **Reabrir a sessão retoma o turno do log (AT-268).** O estado do turno da tela
   é `useState` local e se perdia ao sair. Na primeira leitura dos eventos de
   uma sessão `active`, `turnoEmCursoNoLog` olha o `agent.status` persistido
   mais recente de cada agente (a mesma leitura de `turnoTerminouNoLog`, da
   [RN-578](engine.md#rn-578)); o que estiver `working` reabre a faixa e trava o composer
   pelas mesmas entradas de um turno aceito (`iniciarTurnoDoAgente` +
   `acompanharTurnoPeloLog`), e a leitura da cauda do log o fecha. Roda UMA vez
   por sessão montada (um efeito recorrente rearmaria a faixa com o `working`
   antigo ainda no cache). O `working` que o reinício do engine deixou é fechado
   por evento novo no boot ([RN-586](engine.md#rn-586)), então o que sobra é turno vivo.
   **Não enfileira mensagem:** mensagem com turno em curso segue recusada com
   409 nomeado — a fila é decisão pendente do dono (AT-267).
3. **As pendências de OUTRAS sessões do projeto aparecem no chat (AT-265).**
   `PendenciasDeOutrasSessoes` lê `GET /projects/:id/actions?status=pending`
   (o mesmo endpoint da aba PRs e do painel "precisa de você") e desenha as que
   NÃO nasceram nesta sessão — as desta o fio já decide. É ATALHO e nunca
   substituto ([RN-467](#rn-467)): o MESMO `ApprovalCard`, os mesmos endpoints,
   com o `sessionId` que a própria ação carrega; `onActivateAutoMode` fica de
   fora (é política, não decisão). As duas filas — aprovações e merges de PR —
   têm título e contagem PRÓPRIOS e nunca são somadas, e cada linha diz a sessão
   de origem. O desenho tem teto de 20 cards, e o excedente é dito ("Mostrando N
   de M"): recorte declarado, como na [RN-180](#rn-180). O poll é o da sessão
   (5 s com o canal caído, o fallback de 15 s com ele vivo — `intervaloDaSessao`),
   porque o canal da sessão não avisa escrita de outra.
4. **"Mergear" no card da PR aberta (AT-266).** Sob o card de um `pr_open`
   executado, e só quando o evento `action.pr_open` traz o id da PR e não há
   `git_merge` vivo (pendente, aprovado ou auto-aprovado) para ela, o botão
   PROPÕE o `git_merge` pelo mesmo endpoint da aba PRs (ator `user`, nesta
   sessão). A proposta aparece no fio como o card de sempre, com Aprovar/Negar:
   **a confirmação é a mesma e é do humano** — o merge em branch protegida
   continua `require_approval` incondicional ([RN-418](api.md#rn-418)), sem auto-aprovar,
   sem "sempre permitir", sem o modo automático. O dedupe e as recusas da api
   (PR já mergeada, merge já proposto — [RN-663](api.md#rn-663)) chegam ao dono como
   a frase da api; gate pendente não é recusa, é aviso em texto ao lado do botão.
5. **O papel é o do ENDPOINT, e a lacuna é declarada.** Decidir ação e propor
   ação pedem `developer` (`actions.controller.ts`); a tela usa `roleAtLeast`
   sobre o papel de WORKSPACE, porque a Sessão não busca `project_members` — a
   mesma lacuna única da [RN-471](#rn-471), aqui declarada e não fechada. Quem não
   alcança VÊ a pendência e o botão, com os controles inertes e o motivo em
   texto (`bloqueio` do `ApprovalCard`): o que se tira é o controle, nunca a
   informação.

**O que esta regra NÃO fecha, declarado:** (a) o "Mergear" não propõe E aprova
num clique só — são dois cliques, a proposta e a confirmação, e é de propósito;
(b) a retomada do turno lê a janela dos eventos já carregada, e um `agent.status`
fora dela não é visto (não saber não é "está trabalhando"); (c) a lista de
pendências de outras sessões tem o teto de 20 cards, e o resto continua na aba
Aprovações; (d) as pendências de arquitetura e as hipóteses do Psicólogo
continuam SEM decisão inline (não há `ApprovalCard` para elas).

- **Código:** `apps/web/src/components/ApprovalCard.tsx:236` (`decidir`, a
  decisão em voo e a recusa no card); `apps/web/src/lib/session-turno.ts:59`
  (`turnoEmCursoNoLog`), `:536` (`useRetomarTurnoDoLog`);
  `apps/web/src/lib/pendencias-do-projeto.ts:24` (`usePendenciasDoProjeto`),
  `:56` (`separarPendenciasDeOutrasSessoes`);
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:71`
  (`PendenciasDeOutrasSessoes`); `apps/web/src/routes/MergearNoChat.tsx:28`
  (`prAbertaDaAcao`), `:56` (`jaHaMergeDaPr`), `:89` (`MergearNoChat`);
  `apps/web/src/routes/SessionPage.tsx:155` (`podeDecidir`), `:277`
  (`useRetomarTurnoDoLog`), `:771` (`PendenciasDeOutrasSessoes`)
- **Teste:** `apps/web/src/components/ApprovalCard.decisao-em-voo.test.tsx:37`
  (duplo clique), `:52` (409 no card e botões inertes — caso de falha), `:67`
  (erro que não é 409 devolve os botões); `apps/web/src/lib/turno-em-curso-no-log.test.ts:18`
  (working), `:22` (idle e awaiting_approval fecham), `:38` (sem status na
  janela — caso de falha); `apps/web/src/routes/SessionPage.retomar-turno.test.tsx:159`
  (a tela retoma e o log destrava), `:182` (idle não inventa turno — caso de
  falha); `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx:71`
  (filas separadas, sessionId da ação), `:99` (papel abaixo de developer — caso
  de falha), `:109` (409 no card), `:126` (recorte);
  `apps/web/src/routes/MergearNoChat.test.tsx:62` (PR do evento), `:75`
  (dedupe), `:100` (propõe como usuário, sem aprovar), `:121` (recusa da api —
  caso de falha), `:134` (papel — caso de falha)
- **Origem:** AT-256, AT-268, AT-265 e AT-266, da análise do uso real de
  2026-09-29 (itens 4, 5 e 10a), rodada 27, lane web-sessao

### RN-631 — O destinatário do chat é escolhido e visível, e a oferta de handoff é casada pelo `handoffId` {#rn-631}

O destinatário da mensagem do composer era DERIVADO: "o `agent.activated` mais
recente dentro da janela de 200 eventos" (achado 9-fix). Era um destinatário
padrão do lado da TELA — a classe de defeito que a [RN-584](engine.md#rn-584) fechou no
engine — e era INVISÍVEL: o composer não dizia a quem a mensagem ia, e aceitar
um handoff nesta tela não mudava nada além do log. No uso real de 29/09 a
sessão teve `handoff.accepted` para a Infra e depois para o Arquiteto, e o "oi"
do usuário foi respondido pelo Arquiteto sem que a tela avisasse. E o card de
aceite casava a oferta com o evento pelo par ATOR/`toAgent` (`e.actor.id ===
offeredHandoff.fromAgent`), embora o `handoff.offered` carregue o `handoffId`
desde sempre (AT-251).

**A regra:**

1. **As OPÇÕES** são os agentes que conversam (`AGENTES_DE_CHAT`) e que já
   estão na sessão: `agent.activated` na janela, `roster.activatedAgents` do
   resumo do projeto ([RN-630](api.md#rn-630), sessão INTEIRA, só com o resumo da
   MESMA sessão, no molde da [RN-568](#rn-568)) ou handoff ACEITO (a lista de
   handoffs não tem janela). Os dois últimos termos são a [RN-180](#rn-180): o
   agente não some do seletor porque a ativação saiu dos 200 eventos. Na sessão
   criativa o Criativo é opção antes de ativado, porque a primeira mensagem o
   ativa (achado 3).
2. **O destinatário é o que a pessoa ESCOLHEU** — no seletor "Para" do
   composer, ou aceitando um handoff NESTA tela (o gesto de chamar aquele
   agente; aceite que falha não troca nada). Nada do log escolhe por ela: um
   aceite feito em outra aba ou por outro caminho só acrescenta uma opção.
3. **Opção ÚNICA é o destinatário, e o composer a nomeia antes do envio.** Não
   é um padrão no sentido da [RN-584](engine.md#rn-584) — não há outro agente a quem a
   mensagem pudesse ir.
4. **Duas ou mais opções e nenhuma escolha válida: sem destinatário.** O
   "Enviar" (e o Enter) fica travado e a tela diz em TEXTO que é preciso
   escolher — nunca "a mais recente". Zero opções é o chat da sessão sem agente
   (SSE), e a tela também o diz. **Revisado pela [RN-682](api.md#rn-682):** zero
   opções também trava o envio — a consultiva sem agente pede um agente, e o
   SSE ao modelo cru deixou de ser chamado pela tela.
5. **A escolha é lembrada por sessão no `localStorage`** — conforto de quem vê
   (sem armazenamento a tela só volta a pedir a escolha), nunca estado do
   produto.
6. **"Parar" para o agente DO TURNO** (`turnoAgentRef`, `streamingAgent`,
   `statusAgent`), e só na falta dele o destinatário: trocar o seletor no meio
   do turno de outro agente não pode parar o errado. O modelo exibido na topbar
   segue o destinatário.
7. **A oferta é casada pelo `handoffId` do payload**, nunca pelo ator: cada
   `handoff.offered` é o card da oferta dele, sem par para confundir nem "mais
   recente" para escolher. As ofertas a agente já ativado (janela OU
   `roster.activatedAgents`) não voltam a ser aceitáveis.

8. **Toda oferta pendente é acionável, e nenhuma esconde outra** (AT-253). O
   card elegia UMA oferta (`handoffs.find`, a pendente mais antiga), e o
   handoff MANUAL ([ADR 0109](../adr/0109-handoff-manual-a-agente-a-escolha.md),
   [RN-441](api.md#rn-441)) — gravado com a PESSOA como ator, e por isso nunca
   casado pelo ator — ficava sem "Aceitar" e escondia as ofertas seguintes.
   Agora cada oferta pendente a um agente que conversa (fora a da Infra, que
   tem card próprio, [RN-499](#rn-499)) tem o botão no evento dela; duas
   pendentes ao MESMO agente dão um botão só, o da mais recente, e aceitá-la
   tira a outra pelo `activeFor`. A pílula do handoff manual diz "Handoff
   manual" em vez do id da pessoa.
9. **"Já está na sessão" se lê de fontes SEM janela escopadas à sessão PEDIDA**
   (revisão do PR #759). O `roster.activatedAgents` do resumo é da sessão MAIS
   RECENTE do projeto, e ativar a execução CRIA uma sessão nova que passa a ser
   ela: a sessão do chat perdia a fonte inteira e voltava a depender da janela
   de 200. A soma agora tem TRÊS fontes — o resumo, só quando é desta sessão; os
   handoffs DESTA sessão (quem recebeu um aceito e quem OFERECEU um, que estava
   nela); e o gasto por agente DESTA sessão (`GET .../token-usage`, agregado sem
   janela: agente com linha ali rodou turno, e só roda turno quem foi ativado).
   Cada fonte só corrige falso negativo, e o gasto é prova de PRESENÇA, nunca de
   ausência. **Lacuna declarada:** agente ativado por `start` direto, sem
   handoff, que nunca rodou turno, numa sessão que já não é a mais recente,
   continua dependendo da janela — e quem tem papel abaixo de `developer` (o
   mínimo da rota de gasto) fica sem a terceira fonte. Fechar pede o agregado
   de ativação POR SESSÃO na api; não foi feito aqui.
10. **Oferta pendente cujo evento saiu da janela ganha botão na faixa fixa
    acima do composer** (revisão do PR #759). O card acionável pertence ao
    `handoff.offered`, e a lista de handoffs não tem janela: numa sessão longa a
    oferta seguia `offered` e sem botão em lugar nenhum. O critério é o CORTE,
    não a ausência — a oferta é mais antiga que o evento mais antigo da janela
    (uma oferta recém-criada cujo evento ainda não chegou não pisca na faixa), e
    janela vazia não afirma corte. A faixa tem só o aceite; o atalho "Ativar
    execução" do card do Dev Lead fica no fio.

A guarda da [RN-584](engine.md#rn-584) (`scripts/ci/destinos-do-composer.spec.ts`)
passa a ler `DESTINATARIO_DA_SESSAO_CRIATIVA` em vez do literal de
`SessionPage.tsx`: todo destino que o composer pode dar continua tendo
cláusula própria no engine. Nenhuma mudança de api nem de engine.

- **Onde:** `apps/web/src/lib/session-destinatario.ts:228` (`agentesEmConversa`),
  `:255` (`resolverDestinatario`), `:290` (`useDestinatarioDoChat`), `:116`
  (`useAtivadosNaSessaoInteira`), `:141` (`ativadosSemJanela`);
  `apps/web/src/routes/SessionComposer.tsx:380` (`destinatarioRow`), `:278`
  (`ofertasForaDaJanela`); `apps/web/src/routes/SessionPage.tsx:354`
  (`aceitarHandoff`); `apps/web/src/routes/session-timeline-montagem.tsx:580`
  (`handoffIdDoEvento`), `:588` (`origem`); `apps/web/src/lib/session-handoffs.ts:68`
  (`activeFor`), `:120` (`ofertasAcionaveis`), `:142` (`ofertasForaDaJanela`)
- **Teste:** `apps/web/src/routes/SessionPage.destinatario-do-chat.test.tsx`
  (escolha → envio ao escolhido; dois agentes sem escolha não enviam e dizem
  por quê; opção única; handoff aceito fora da janela; resumo da mesma sessão
  e de outra; aceite que troca e aceite que falha; escolha lembrada; sessão sem
  agente; sessão de execução mais recente com a ativação lida dos handoffs e
  do gasto desta sessão, e o gasto recusado; oferta fora da janela na faixa, e
  oferta na janela ou mais nova que ela fora dela),
  `apps/web/src/lib/session-destinatario.test.ts` (`ativadosSemJanela`),
  `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx` (oferta
  antiga de OUTRO `handoffId` fica muda),
  `apps/web/src/routes/SessionPage.handoff-manual.test.tsx` (o manual ganha
  "Aceitar"; o manual pendente não esconde a oferta seguinte; duas ao mesmo
  agente viram um botão)
- **Origem:** AT-251, AT-253

### RN-632 — Leitura de PROJETO polla no ritmo de projeto, e toda tela que ouve o canal da sessão invalida pela MESMA janela {#rn-632}

O uso real de 29/09 bateu o teto de 300 req/min do usuário ([RN-579](engine.md#rn-579))
com duas abas abertas: 192 × 429 às 07:14, 106 deles em
`GET /projects/:id/sessions` e 20 em `GET /projects/:id`, e três cliques de
`approve_always` recusados no meio (AT-278). A RN-579 tinha posto sob o canal
as leituras da tela de SESSÃO; as de PROJETO e as outras telas que ouvem o
canal ficaram de fora. O teto NÃO muda: o que cai é o pedido.

**A regra:**

1. **Leitura de projeto que nenhum canal avisa polla a 15s**
   (`INTERVALO_DO_PROJETO_MS`), INCONDICIONAL. O canal `session:<id>` só avisa
   escritas da própria sessão; a lista de sessões do projeto e os contadores do
   trilho (aprovações da sessão mais recente, merges pendentes do projeto,
   histórias a promover, pendências de arquitetura, hipóteses) mudam por escrita
   de QUALQUER sessão — não há aviso para esperar, então o mecanismo é poll
   longo, no mesmo fallback que a RN-579 já aceita para a sessão. Vale para
   `useProjectSessions`/`useLatestSession` (eram 5s), para os cinco contadores
   da moldura `ProjectPage` e para a arquitetura da aba Executores. A aba que
   mostra o dado como ASSUNTO (Backlog, Arquitetura, PRs) mantém o poll dela, e
   o observador mais rápido dita o ritmo da chave. Quem escreve nesta aba
   continua invalidando a chave na hora.
2. **Quem só precisa do dado no clique não polla.** Cada linha de
   `/containers` lê a sessão mais recente do seu projeto para PROPOR
   parar/remover/subir; em poll de 5s eram 12 req/min POR PROJETO — nove
   projetos, 108/min só dessa página, o número que casa com os 106 do log.
   `useLatestSession(projectId, false)`: montagem e foco da janela bastam.
3. **Toda tela que ouve o canal passa por `criarInvalidadorDoCanal`.** As abas
   Executores e Visão geral invalidavam os eventos a CADA `event.appended`,
   sem janela: um dev agent em rajada (10 avisos/s) fazia 630 GET de eventos
   por minuto só na aba Executores. Agora as duas usam o MESMO invalidador da
   tela de Sessão (janela por alvo, o TIPO decide o alvo), e ganham de brinde o
   que faltava: a proposta de ação do dev agent invalida as ações na hora, em
   vez de esperar o fallback de 15s. A Visão geral pede o backlog a cada aviso
   (as tasks bloqueadas vêm dele) pelo parâmetro `extras`, com a mesma janela.
4. **A espera pelo runner para quando acaba.** `EsperaDoRunner` só parava a
   sonda de `GET /projects/:id` (3s) no TETO; confirmada a conexão, o efeito do
   teto saía cedo e a sonda seguia para sempre — 20 req/min enquanto o painel
   estivesse na tela, e, sendo o observador mais rápido de `['project', id]`,
   arrastando a chave inteira da página. Agora para no teto OU na confirmação.

**Números** (`duas-abas.orcamento.test.tsx`, as telas de verdade — `Shell`,
`SessionPage`, `ProjectPage` na aba Executores, `ContainersPage` — sobre um
`fetch` que conta por rota; cada aba medida sozinha, porque duas abas são dois
contextos JS, e somadas; req/min, `dev` → esta regra):

| Cenário | Antes | Depois |
|---|---|---|
| chat da sessão + Executores, canal vivo | 70 + 138 = 208 | 70 + 72 = 142 |
| idem, dev agent em rajada (10 avisos/s) | 70 + 764 = 834 | 70 + 97 = 167 |
| idem, canal que nunca conecta | 155 + 186 = 341 | 155 + 120 = 275 |
| `/containers` com 9 projetos | 132 (108 de `/sessions`) | 24 |

**O que esta regra NÃO fecha:** com o canal CAÍDO nas duas abas, 275/min ainda
é perto do teto — a tela de Sessão volta aos 3s de sempre (RN-579: nunca pior
que era), e 25 req/min de folga somem com uma rajada de cliques. O `Shell`
segue pollando `projects-summary` e `execution/session` a 5s e, na aba do chat,
os eventos da sessão de EXECUÇÃO a 3s (a aba não tem o canal dela) — 44 das 70
req/min da aba do chat. Uma lista de sessões criada noutra aba aparece aqui em
até 15s (eram 5s). O número do incidente foi CASADO, não reproduzido: o log
não dizia quais abas estavam abertas, e a leitura de que `/containers` estava
numa delas é inferência pelos 106 ≈ 9 × 12.

- **Código:** `apps/web/src/lib/canal-vivo.ts:54` (`INTERVALO_DO_PROJETO_MS`),
  `:255` (`aoEvento`, os `extras`); `apps/web/src/lib/hooks.ts:127`
  (`useProjectSessions`), `:158` (`useLatestSession`);
  `apps/web/src/routes/ProjectPage.tsx:77` (os contadores do trilho);
  `apps/web/src/components/AcoesDoContainer.tsx:52` (`useLatestSession`, sem poll);
  `apps/web/src/routes/ProjectExecutorsTab.tsx:203` (`invalidador`),
  `apps/web/src/routes/ProjectOverviewTab.tsx:202` (`invalidador`);
  `apps/web/src/components/EsperaDoRunner.tsx:73` (`confirmadoPor`)
- **Teste:** `apps/web/src/routes/duas-abas.orcamento.test.tsx` (as duas abas
  com canal vivo, com rajada, com o canal que nunca conecta, e `/containers`;
  os quatro reprovam na `dev`); `apps/web/src/components/EsperaDoRunner.test.tsx`
  ("confirmada a espera, a sonda PARA" e o caso de falha: sem confirmação ela
  segue); `apps/web/src/routes/ContainersPage.test.tsx` ("a linha lê a sessão
  mais recente SEM poll")
- **Origem:** AT-278 (extensão da [RN-579](engine.md#rn-579); não muda a RN-108 — o
  ticket de uso único e a reconexão manual seguem como estão)

### RN-633 — O handoff manual não declara prontidão, e "já ativo" para a oferta é do projeto {#rn-633}

Duas leituras da tela de Sessão deixavam o handoff obsoleto (AT-293, AT-294):

1. **O handoff MANUAL não esconde "Estou pronto para produzir" nem "Confirmar
   arquitetura pronta"** (AT-293). `prontidaoJaDeclarada` e
   `arquiteturaJaDeclarada` perguntavam só "existe handoff saindo do
   Criativo/Arquiteto?", e o handoff manual
   ([ADR 0109](../adr/0109-handoff-manual-a-agente-a-escolha.md),
   [RN-441](api.md#rn-441)) grava como `fromAgent` o ÚLTIMO agente ativado
   (`request-manual-handoff.use-case.ts`): pedir um handoff manual ao Staff com
   o Criativo ativo escondia o botão de prontidão sem prontidão nenhuma
   declarada. O manual se reconhece pelo ATOR humano do `handoff.offered`
   (casado pelo `handoffId`, [RN-631](#rn-631)) — o `Handoff` da api não
   carrega o ator. Fora da janela de 200 o ator é desconhecido, e aí: para o
   Criativo vale o `artifactId` (o handoff da prontidão leva o
   `product_brief`, `criativo_server.ex`; o manual nunca leva artefato); para o
   Arquiteto os dois automáticos não levam artefato, então o de origem
   desconhecida segue contando, como antes. **Lacuna declarada:** a marca
   durável seria o ator (ou uma marca de manual) no próprio `Handoff` da api;
   não foi feita aqui (a api é da lane do ciclo de vida, ADR 0182).
2. **Oferta a agente já ATIVO em outra sessão do projeto não é acionável**
   (AT-294). "Ativo" era da SESSÃO: depois de "Ativar execução", o Dev Lead
   roda na sessão de execução, e a oferta a ele na sessão do chat seguia com
   "Aceitar". Agora a oferta (o card do fio, a faixa fora da janela e o card da
   Infra) soma ao "já entrou nesta sessão" o `roster.activatedAgents` do
   resumo, que é a sessão MAIS RECENTE do projeto — a de execução, depois de
   ativada. `activeFor` continua sendo DESTA sessão, porque é ele que o
   seletor do handoff manual usa. **Lacuna declarada:** sessões que não são
   nem esta nem a mais recente não são vistas; fechar pede um agregado de
   ativação POR PROJETO na api, que não existe.

Nenhuma mudança de api nem de engine.

- **Onde:** `apps/web/src/lib/session-handoffs.ts:41` (`origemDoHandoff`),
  `:108` (`jaAtivo`), `:180` (`prontidaoJaDeclarada`), `:192`
  (`arquiteturaJaDeclarada`); `apps/web/src/lib/session-destinatario.ts:156`
  (`useAtivosNoProjeto`)
- **Teste:** `apps/web/src/routes/SessionPage.handoff-obsoleto.test.tsx`
  (manual com o Criativo ativo não esconde "Estou pronto"; manual com o
  Arquiteto ativo não esconde "Confirmar arquitetura pronta"; o handoff do
  agente continua escondendo — caso de falha; fora da janela o do Criativo
  com brief conta; Dev Lead ativo na sessão de execução deixa a oferta muda;
  sem ele, a oferta segue acionável — caso de falha)
- **Origem:** AT-293, AT-294

### RN-634 — Depois de "Ativar execução", a tela vai à sessão de execução {#rn-634}

A execução roda numa sessão NOVA (RN-135, RN-139), e a de chat de onde o
clique partiu pode até fechar. O atalho "Ativar execução" do card do handoff
ao Dev Lead (RN-137) — e a fusão com o aceite (RN-161) — deixava a pessoa na
sessão de chat, olhando o lugar de onde o trabalho saiu (AT-295). Agora
`handleActivateExecution` lê o `sessionId` que `POST .../execution/activate`
devolve e leva a tela até ele, com o aviso "Levando você à sessão de
execução.". Sem `sessionId` na resposta, com o mesmo id da sessão atual, ou
sem quem navegue (a tela montada fora da rota), só o aviso de sempre, e a tela
fica. Ativação recusada não navega e mostra a frase da api. Quem navega é a
ROTA (`irParaSessao`, o `navigate` do router): a tela não depende do router.

- **Onde:** `apps/web/src/lib/session-acoes-de-handoff.ts:147`
  (`handleActivateExecution`); `apps/web/src/router.tsx:376` (`irParaSessao`)
- **Teste:** `apps/web/src/routes/SessionPage.handoff-obsoleto.test.tsx`
  (navega para o `sessionId` devolvido, com aviso; recusa não navega — caso de
  falha; sem quem navegue, só avisa)
- **Origem:** AT-295

### RN-638 — Quem pergunta "o que espera decisão" lê a fila do PROJETO, nunca a sessão mais recente {#rn-638}

O contador de Aprovações do trilho, o painel "precisa de você" ([RN-467](#rn-467)),
a aba Aprovações, o roster da Visão geral e a aba Código liam as pendentes de
`useLatestSession` — a sessão CRIADA por último —, que só é a de execução por
coincidência. Uma ideação ou um chat aberto depois da execução zerava o
contador e escondia do roster os dev agents esperando decisão (AT-297). E o
bloco de pendências de outras sessões do chat ([RN-626](#rn-626)) só existia em
sessão ativa, enquanto o `container_start` que o Infra Lead propõe no CHAT
destrava o `dev.blocked_by_container` que aparece na EXECUÇÃO (AT-298).

**A regra:**

1. **A fila é a do projeto.** Essas telas leem `useProjectPendingActions`
   (`GET /projects/:projectId/actions?status=pending`, em qualquer sessão),
   todas pela MESMA chave `['project-pending-actions', projectId, undefined]`
   — no ritmo de projeto da [RN-632](#rn-632), e a 3s só na aba Aprovações, que
   a tem como assunto. A moldura `ProjectPage` tira o contador de PRs
   (`git_merge`) da MESMA leitura, em vez de uma segunda consulta. As filas
   continuam separadas, com o selo próprio — nada se soma (RN-467).
2. **Cada card decide pela sessão que a PRÓPRIA ação carrega.** Na aba
   Aprovações, aprovar, negar, "sempre permitir" e o lote chamam o endpoint com
   `action.sessionId`, e invalidam a fila do projeto por prefixo e as ações da
   sessão da ação. Os blocos de PR e gate da aba leem eventos e ações da sessão
   de EXECUÇÃO vigente (RN-139), e só sem ela da mais recente.
3. **As pendências de outras sessões aparecem em qualquer estado.** O bloco do
   chat sai também em sessão encerrada e técnica — decidir é sobre a ação da
   OUTRA sessão, não conversa nesta (a RN-581 segue recusando conversa) —, e a
   aba Executores ganha o MESMO bloco para a sessão de execução: o
   `container_start` do chat fica visível onde o bloqueio aparece.
4. **A proposta chega pelo canal, sem esperar o poll.** Todo aviso
   `proposed_action.*`/`action.*` de qualquer canal de sessão que uma tela ouve
   invalida também a fila do projeto (`pendenciasDoProjeto` em
   `criarInvalidadorDoCanal`, janela de 2s), e o `dev.blocked_by_container`
   também — a proposta que o destrava nasce noutra sessão, cujo canal ninguém
   ali ouve (AT-299). Nenhum poll subiu.
5. **O bloco cabe na coluna e mostra todos (AT-318).** Na medida do fio e do
   composer (780px), recolhível, com a PRESENÇA de cada fila no cabeçalho —
   "Aprovações 3 · Merges de PR 1", cada uma com o próprio número, nunca a
   soma (RN-467) — visível mesmo recolhido. Os cards nascem com o detalhe
   FECHADO (`detalheRecolhido` no `ApprovalCard`): abertos, cobriam ~60% do fio
   e deixavam um card à vista de três. O rótulo de origem sai UMA vez por
   sessão, com o tempo da mais antiga — por card, ele se repetia entre um card
   e o seguinte. O teto de 20 cards e o recorte declarado (RN-180) seguem.

**O que esta regra NÃO fecha:** o aviso só chega onde há uma tela ouvindo um
canal de sessão (Sessão; Visão geral, a sessão mais recente; Executores, a de
execução). Numa aba sem canal (Aprovações, PRs, Backlog…) ou para uma proposta
feita numa sessão cujo canal nenhuma tela aberta ouve, o contador chega pelo
poll de projeto, em até 15s; abrir um canal de sessão na moldura mudaria o
ciclo de vida da sessão (o canal é o heartbeat da RN-064) e ficou de fora. O
contador de Aprovações continua contando o `git_merge` pendente, como antes —
o painel o deduplica para a fila de PRs. A lacuna do papel de WORKSPACE no
lugar do efetivo (RN-471) vale para o bloco novo dos Executores como vale para
o do chat.

- **Código:** `apps/web/src/routes/ProjectPage.tsx:82` (o contador),
  `:121` (os merges da mesma leitura);
  `apps/web/src/routes/ProjectApprovalsTab.tsx:115` (`pendentesQuery`), `:119`
  (`sessaoDeTrabalho`), `:326` (`handleApprove`);
  `apps/web/src/routes/ProjectOverviewTab.tsx:125` (`pendentesDoProjeto`);
  `apps/web/src/routes/ProjectExecutorsTab.tsx:107` (`pendentesQuery`), `:290`
  (o bloco); `apps/web/src/routes/code/CodeShell.tsx:101` (`pendentesQuery`);
  `apps/web/src/routes/SessionPage.tsx:782` (o bloco sem `isActive`);
  `apps/web/src/lib/canal-vivo.ts:134` (`alvosDoEvento`), `:180`
  (a chave por prefixo); `apps/web/src/components/PendenciasDeOutrasSessoes.tsx`
  (`porSessao`, `presenca`); `apps/web/src/components/ApprovalCard.tsx`
  (`detalheRecolhido`); `apps/web/src/lib/hooks.ts:455`
  (`useProjectPendingActions`); `apps/web/src/lib/precisa-de-voce.ts`
  (`acoesPendentes`)
- **Teste:** `apps/web/src/routes/ProjectApprovalsTab.test.tsx` (a pendente da
  execução com uma ideação mais nova, decidida pela sessão dela; decidida não
  entra — contraste); `apps/web/src/routes/project-tabs.test.tsx` (os selos
  pela fila do projeto); `apps/web/src/routes/ProjectExecutorsTab.test.tsx`
  (o `container_start` do chat na aba da execução; a pendente da própria
  execução não vira bloco — contraste);
  `apps/web/src/routes/SessionPage.sessao-encerrada.test.tsx` (o bloco em
  `closed` e `closed_abnormally`; a da própria sessão não entra);
  `apps/web/src/lib/acoes-da-sessao.test.ts` (o canal invalida a fila do
  projeto por prefixo e com janela; `tool.call` não);
  `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx` (três cards à
  vista com o detalhe fechado e a presença por fila sem soma; recolhido, a
  presença fica no cabeçalho; um rótulo de origem por sessão);
  `apps/web/src/routes/duas-abas.orcamento.test.tsx` (a rajada invalida a fila
  do projeto na aba Executores, dentro do orçamento da RN-632)
- **Origem:** AT-297, AT-298, AT-299 (HS-076), AT-318 (auditoria visual de 30/09)

## Acompanhar ao vivo sem martelar (RN-639)

### RN-639 — O que muda por token não re-renderiza a tela, e o que acompanha o bootstrap polla a 3 s e para no fim {#rn-639}

Três telas faziam trabalho que ninguém via (AT-301/AT-302). A tela de Sessão
re-renderizava INTEIRA a cada token de um turno — o texto em curso morava em
estado do hook chamado por ela. As telas de provisionamento e de adoção pollavam
o status do bootstrap e os eventos da sessão técnica a 1 s, e os eventos nunca
paravam, mesmo com o repositório pronto. E o `/status` batia para sempre num
serviço que não respondia.

1. **O texto em curso mora num store externo.** O texto do chat consultivo e a
   faixa de atividade do turno ficam num store por sessão
   (`criarStoreDoStreaming`), assinado por `useSyncExternalStore` só pelos dois
   componentes que os desenham — a bolha do fio e a faixa. A página assina UMA
   pergunta booleana (o turno já mostrou conteúdo?), que é o que o timer de
   "pensando" ([RN-131](#rn-131)) precisa e que muda uma vez por turno. O
   reducer da faixa é o mesmo; mudou quem guarda o estado.
2. **O bootstrap é acompanhado a 3 s.** Status e eventos, nas duas telas.
3. **E para no fim.** Status e eventos param quando o bootstrap converge
   (`provisioned`) e quando a query erra (`pollQueParaNoErro`). A FALHA
   (`provision_failed`) é terminal na adoção e NÃO no provisionamento: ali o
   "Tentar novamente" dispara um bootstrap novo e a tela precisa ver o
   progresso dele ([RN-477](api.md#rn-477)).
4. **O `/status` para no erro.** Serviço que responde — inclusive com 5xx, que
   vira `status: 'error'` num corpo resolvido — segue a cada 5 s. Serviço que
   não responde deixa de ser perguntado por timer; o foco da janela e a
   remontagem perguntam de novo, e o primeiro sucesso retoma o ritmo.

- **Onde:** `apps/web/src/lib/streaming-do-turno.ts:48` (`criarStoreDoStreaming`),
  `apps/web/src/lib/streaming-do-turno.ts:98` (`useSemConteudoNoTurno`),
  `apps/web/src/lib/poll-do-bootstrap.ts:33` (`pollDoBootstrap`),
  `apps/web/src/lib/poll-do-bootstrap.ts:47` (`bootstrapTerminou`),
  `apps/web/src/routes/ProvisioningPage.tsx:41` (`acompanharBootstrap`),
  `apps/web/src/routes/StatusPage.tsx:62` (`pollQueParaNoErro`)
- **Teste:** `apps/web/src/routes/SessionPage.streaming-isolado.test.tsx` (vinte
  tokens depois do primeiro não re-renderizam a página; o fim do turno
  re-renderiza), `apps/web/src/lib/streaming-do-turno.test.ts`,
  `apps/web/src/lib/poll-do-bootstrap.test.ts`,
  `apps/web/src/routes/StatusPage.test.tsx`
- **Origem:** AT-301, AT-302

## Decidir no chat, onde o dono está (RN-626)

### RN-640 — A paleta neutra fecha a dívida de contraste, e cor da UI só vem de token {#rn-640}

O tema escuro deixa de ser azul-petróleo e vira preto neutro com o acento
terracota suave; o claro vira o neutro da mesma família (ADR 0181). O mecanismo
da [RN-184](#rn-184) não muda — os pares são
medidos nos dois temas, com o mesmo piso —; o que muda é o que se cobra:

1. **A dívida do escuro virou piso.** Os cinco pares que a RN-184 deixava
   travados por número (3,89 / 3,10 / 3,88 / 3,88 / 4,41) passam 4,5:1 nos dois
   temas, e o teste reprova quem os devolver para baixo — não "registra" mais.
   O valor final saiu da MEDIÇÃO: o `--text-muted` do rascunho (`#71717a`)
   repetia a dívida e foi recusado (`#86868f` no escuro, `#696972` no claro), e
   o muted continua ABAIXO do `--text-secondary` nas três superfícies, o que o
   teste também cobra.
2. **O texto sobre fundo sólido de marca/estado passa AA.** `--on-accent` do
   escuro é o preto neutro (5,61:1 sobre o acento, 7,25:1 no hover, 7,65:1
   sobre `--success`, 5,24:1 sobre `--danger`); a "exceção conhecida" do botão
   primário deixa de existir, e o matiz do acento continua terracota (10°–30°)
   nos dois temas.
3. **Cor da UI só vem de token.** Quem pinta por biblioteca de runtime (Mermaid,
   xterm, minimapa) lê o token do tema ativo e, sem ele, cai no padrão de
   `TOKENS_PADRAO` — uma cópia do `:root` que o teste confere contra
   `design/tokens.css`. Cor de agente é sempre `var(--token)`; os três agentes
   sem semântico têm `--agent-*` por tema, medidos a 3:1. E nenhum módulo CSS
   usa `var(--x)` que ninguém declara.

- **Onde:** `design/tokens.css:118`, `design/tokens.css:126`,
  `apps/web/src/lib/tokens-padrao.ts:50` (`lerTokenDoTema`),
  `apps/web/src/lib/agents.ts:90`
- **Teste:** `apps/web/src/lib/contraste.test.ts` ("a antiga dívida de
  contraste agora é piso"), `apps/web/src/design-contraste.test.ts`,
  `apps/web/test/design-contraste.test.ts` ("o botão primário — a exceção que
  deixou de existir"), `apps/web/src/lib/tokens-padrao.test.ts`,
  `apps/web/src/lib/agents.test.ts` ("cor de agente vem do design system"),
  `apps/web/src/design-tokens-existentes.test.ts`
- **ADR:** [0181](../adr/0181-tema-preto-neutro.md)
- **Origem:** AT-283, AT-284

## Acompanhar ao vivo sem martelar (RN-639)

### RN-643 — Abaixo de 768px a sidebar vira gaveta e o trilho do projeto vira barra horizontal; a página nunca rola de lado {#rn-643}

A auditoria visual da Rodada 29 (AT-290, achado S1) mediu que o produto não
tinha layout móvel depois do login: a 390px a sidebar (264px) e o trilho do
projeto (180px) continuavam FIXOS, somando 444px de moldura, e o conteúdo ficava
com 0 a 126px ou estourava para a direita. Configurações chegou a 114 textos
cortados (`validacao-visual.js`).

**A regra:**

1. **Um corte, uma fonte.** O breakpoint é `CONSULTA_MOVEL`
   (`(max-width: 767px)`), lido por `useLayoutMovel`. Quem troca de layout lê
   esse hook e aplica o desenho móvel por uma CLASSE; os módulos CSS não têm
   `@media` próprio para isso. Assim o que o JS decide e o que o CSS desenha
   não divergem num pixel de fronteira, e o teste de componente (jsdom, sem
   CSS) prova o mesmo corte que o navegador aplica. Sem `matchMedia` o
   layout é o de DESKTOP: o móvel só vale quando a consulta o afirma.
2. **A sidebar vira gaveta.** Uma barra no topo traz o botão de menu
   (`aria-expanded`, `aria-controls`) e a marca. A gaveta é um diálogo modal
   (`role="dialog"`, `aria-modal`): ao abrir, o foco entra nela; o Tab não
   sai; o Esc, o X e o fundo a fecham e devolvem o foco ao botão de menu.
   Ela também fecha ao seguir qualquer link de dentro dela (as abas do projeto
   mudam só o `?tab=`) e quando a rota muda por fora. Na gaveta a sidebar
   aparece sempre EXPANDIDA, e o botão "Recolher menu" some: o colapso manual
   ([RN-195](#rn-195)) é preferência do desktop, fica gravado e volta a valer
   quando a janela cruza o corte de novo.
3. **O trilho do projeto vira barra horizontal.** São as mesmas 12 folhas, na
   mesma ordem, com os cabeçalhos de grupo inline e
   `aria-orientation="horizontal"`. As setas que andam são esquerda e
   direita, e a aba ativa é rolada para dentro da faixa visível. A barra rola
   por DENTRO; a página não rola de lado. O corpo do projeto vira coluna (a
   barra acima do painel), e a Visão geral empilha o time e a atividade em
   vez de manter o trilho de 360px ao lado.

**Medido** (390×844, tema escuro, seed da api, `validacao-visual.js` injetado):
`scrollWidth` do documento = 390 em todas as telas autenticadas (dashboard, as
12 abas, `/containers`, `/account`), e `<main>` com os 390px inteiros. Nas
Configurações, `texto-cortado` caiu de 114 para 33. O resto é texto de
componente (tabelas e rótulos das seções), assunto de tipografia e espaço, não
de moldura. O `fora-da-viewport` que sobra na Visão geral e em Aprovações são
abas da barra horizontal além da borda, onde a rolagem interna as alcança.

**Revisto pelo [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
(AT-404):** o item 3 deixou de valer — o trilho do projeto saiu, e com ele a
barra horizontal. No telefone as abas do projeto moram na GAVETA (item 2), com
os grupos, a ativa e os contadores; escolher uma fecha a gaveta. O corpo do
projeto não vira mais coluna: só os respiros encolhem.

**O que esta regra NÃO fecha:** a aba Código mantém o trilho de 48px do
`CodeShell` e o editor em colunas; ela não foi desenhada para telefone. A
tela de Sessão herda a moldura nova, mas a barra superior e o fio seguem com
os achados X1–X3 da auditoria. A duplicação de navegação por abas (gaveta e
barra) fechou no ADR 0211.

- **Código:** `apps/web/src/lib/layout-movel.ts:18` (`CONSULTA_MOVEL`),
  `:39` (`useLayoutMovel`); `apps/web/src/routes/Shell.tsx:444`
  (`movel`), `:463` (`fecharAoSeguirLink`);
  `apps/web/src/routes/ProjectPage.tsx:70` (`movel`);
  `apps/web/src/routes/ProjectOverviewTab.tsx:76` (`movel`)
- **Teste:** `apps/web/src/routes/Shell.test.tsx` ("Shell — layout móvel
  (RN-643)": a gaveta abre com o foco dentro e o Esc a fecha devolvendo o foco;
  fecha pelo link, pelo X, pelo fundo e pela troca de rota; ignora o colapso
  gravado; cruzar o corte volta à sidebar fixa; e o caso de falha, sem
  `matchMedia` não há menu nem diálogo);
  `apps/web/src/routes/Shell.test.tsx` ("no telefone as abas estão na gaveta,
  e escolher uma fecha a gaveta (RN-643)") e
  `apps/web/src/routes/AbasDoProjeto.test.tsx` ("no telefone continua
  VERTICAL"), desde o ADR 0211, sobre o mock
  `apps/web/src/test/match-media.ts`
- **Origem:** AT-316 (achado S1 da AT-290); não muda o ADR 0126, só dá ao
  trilho uma forma para telas estreitas

## Decidir no chat, onde o dono está (RN-626)

### RN-644 — O fio corta por MENSAGEM, nunca parte uma troca e recolhe o histórico na ordem em que aconteceu {#rn-644}

O levantamento visual da Rodada 29 (achado X3, AT-319) mediu três defeitos no
corte do fio da [RN-177](#rn-177), todos na mesma
função: (1) as "últimas 5" contavam **entradas**, e os cards de handoff, de
aprovação e de história contavam como uma mensagem cada — numa conversa curta,
a primeira pergunta e a primeira resposta iam para o histórico recolhido; (2) o
corte caía onde a contagem mandava, podendo deixar a pergunta recolhida e a
resposta aberta; (3) o histórico era agrupado **por origem**, na ordem das
origens, e o grupo "LLM" vinha antes de "Usuário" — expandido, a resposta do
Criativo aparecia ACIMA da pergunta que a gerou.

**A regra, no fio (o painel de log NÃO muda — lá o eixo é a camada):**

1. **O corte conta MENSAGENS**: `chat.message`, `agent.response` e
   `chat.structured_question` (`TimelineEntry.mensagem`). Card e divisor não
   contam; os que vêm depois do corte ficam abertos com as mensagens em volta.
   Um colapso por agente ([RN-138](#rn-138)) e um "Passos do turno" continuam
   sendo UMA entrada, e contam como uma mensagem.
2. **O corte nunca parte um turno** ([RN-172](#rn-172)): ele recua até a
   abertura do turno da mensagem que o marcou, então a pergunta fica sempre
   junto da resposta. Por isso as abertas podem passar de cinco — nunca uma
   troca pela metade. O prólogo (turno `0`) não tem abertura e não recua; se
   recuar chegar ao início, não há histórico.
3. **O histórico é UM bloco, em ordem cronológica**, e DECLARA o recorte
   ([RN-180](#rn-180)): o título diz o que o corte conta ("Antes das últimas 5
   mensagens") e o `trailing` separa o que ficou dentro ("2 mensagens · 2
   outras entradas"). O rótulo "LLM" sai do fio junto com os grupos por origem.

**O que se perdeu, declarado:** reabrir só o que o usuário disse, sem reabrir o
resto, era a razão dos grupos por origem no fio. Ela não sobrevive à ordem
cronológica — o painel de log segue oferecendo esse recorte.

- **Código:** `apps/web/src/routes/session-fio.tsx:119` (`FIO_RECENTES_ABERTAS`),
  `:291` (`dividirFio`), `:141` (`entradaSimples`);
  `apps/web/src/lib/session-timeline.ts:67` (`mensagem`);
  `apps/web/src/routes/session-timeline-montagem.tsx:389`, `:426`, `:673` (as
  três mensagens); `apps/web/src/routes/SessionFio.tsx:139` (o bloco único)
- **Teste:** `apps/web/src/routes/session-fio.test.ts` (cards não contam, o
  corte recua até a abertura, ordem do fio, e o caso de falha do turno maior
  que o corte); `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-177/RN-644": o caso medido com cards intercalados, e o
  histórico expandido na ordem)
- **Origem:** AT-319, achado X3 do levantamento visual "antes" da Rodada 29

## Acompanhar ao vivo sem martelar (RN-639)

### RN-645 — Configuração não se busca de novo a cada montagem, não polla, e a aba Configurações tem três faixas de moldura, não quatro {#rn-645}

O levantamento visual da Rodada 29 (achado G1, AT-321) percorreu as seções de
Configurações em ~40s e a página inteira do projeto virou "Limite de
requisições excedido" — o teto de 300 req/min é do USUÁRIO
([RN-579](engine.md#rn-579)). O roteiro RECARREGAVA a página por seção, e uma carga da
aba custava 55 requisições. Medido com as telas de verdade, o defeito tinha
três partes, e nenhuma delas pede subir o teto:

**A regra:**

1. **Dado de CONFIGURAÇÃO vale um minuto** (`FRESCOR_DA_CONFIGURACAO_MS`). Com o
   `staleTime: 0` do TanStack, toda observadora que MONTA depois da primeira
   refaz a busca. As seções só montam depois que o projeto chega, então
   `GET /projects/:id`, `GET /projects/:id/git/repository` e `GET /workspaces`
   saíam DUAS vezes em toda carga; e trocar de aba e voltar remontava as 19
   seções e refazia 31 buscas. Configuração só muda por MUTAÇÃO, e toda
   mutação da aba invalida a própria chave — invalidar ignora `staleTime`,
   então quem salva vê o valor novo na hora. O que o minuto atrasa é a mudança
   feita por OUTRA pessoa, que segue chegando no foco da janela e na próxima
   montagem depois do minuto. **Estado operacional fica fora** (ciclo de vida
   do container, gasto por agente e por chave, chaves de dispositivo com
   `lastUsedAt`, plano de bootstrap): ali a pergunta é "o que está de pé
   agora".
2. **Configuração não polla.** O perfil de proficiência e o histórico de
   versões de instrução pollavam a 15s — 8 req/min contra o teto para duas
   listas que só mudam pela própria seção (que invalida) ou por patch
   aprovado.
3. **O sumário DEITA acima das seções, em qualquer largura.** Como coluna
   `sticky` ao lado delas ele era a quarta faixa vertical (sidebar 264 +
   trilho 180 + sumário 208): a 1440px sobravam ~740px de conteúdo e a tabela
   de modelos cortava o nome do agente em 79px e o do modelo em 91px (achado
   G2). A coluna não tinha como pagar o próprio preço nem num monitor largo,
   porque `.body` tem teto de 1040px (ADR 0078). Deitado, ele devolve os 208px
   às seções; o preço é o que a janela estreita já pagava — perde-se o "onde
   estou" GRUDADO na tela, não a navegação. Nenhum token mudou.

**Números** (`configuracoes.orcamento.test.tsx`, `Shell` + `ProjectPage` na
aba Configurações sobre um `fetch` que conta por rota; `dev` → esta regra):

| Cenário | Antes | Depois |
|---|---|---|
| carga da aba (2,5s) | 53 | 50 |
| um minuto parado na aba | 76 | 68 |
| Configurações → Visão geral → volta (buscas de configuração) | 31 | 0 |
| carga da aba, com os bindings resolvidos em LOTE ([RN-654](api.md#rn-654), AT-334) | 49 | 30 |

Os "Depois" das três primeiras linhas foram medidos sobre a mesma base do
"Antes"; integrada a `dev` com a [RN-638](#rn-638) (a moldura lê a fila do
projeto uma vez só), a carga ficou em 49 e o minuto em 64. A quarta linha é a
[RN-654](api.md#rn-654), medida sobre a `dev` em 94e5dc721d: os 20 bindings
resolvidos por chave viraram UMA leitura, e o teste guarda a carga em 30 e o
minuto em 64.

**O que esta regra NÃO fecha:** até a [RN-654](api.md#rn-654), 20 das requisições da
carga eram o binding RESOLVIDO de cada agente (17) e de cada área (3), uma rota
por chave (`GET projects/:projectId/agent-bindings/:agentSlug`) — essa parte
fechou com a rota de LOTE. RECARREGAR a página por seção, como o roteiro do
levantamento fazia, ainda custa 30 por carga (~10 cargas por minuto antes do
teto); navegar pelo sumário DENTRO da aba não remonta nada e custa zero. Os 68 do
minuto são todos da MOLDURA (o `Shell` polla `projects-summary` e
`execution/session` a 5s e os eventos da sessão de execução a 3s), comuns a
toda aba — a mesma lacuna que a [RN-632](#rn-632) declara.

- **Código:** `apps/web/src/lib/query-policy.ts:111`
  (`FRESCOR_DA_CONFIGURACAO_MS`); `apps/web/src/lib/hooks.ts:29`
  (`useCurrentWorkspaceWithRole`), `:535` (`useProficiency`);
  `apps/web/src/routes/settings/InstructionVersionsSection.tsx:31`
  (`instruction-versions`, sem poll); as seções de `apps/web/src/routes/settings/`
  e `apps/web/src/components/ModelCatalogSection.tsx`;
  `apps/web/src/routes/settings/sumario.module.css:36` (`.layout`, a faixa)
- **Teste:** `apps/web/src/routes/configuracoes.orcamento.test.tsx` (a carga
  busca cada recurso uma vez; um minuto sem poll de configuração; trocar de
  aba e voltar sem buscas de configuração — os três reprovam na `dev` — e o
  caso de falha: invalidar busca na hora, e passado o minuto a volta busca de
  novo)
- **Origem:** AT-321 (achados G1 e G2 do levantamento visual da Rodada 29;
  extensão da [RN-579](engine.md#rn-579) e da [RN-632](#rn-632))

## Decidir no chat, onde o dono está (RN-626)

### RN-646 — Bloqueio e controle inerte dizem o motivo de QUEM está na tela: a aba PRs fala da lista de PRs, e Parar/Remover sem container dizem que não há container {#rn-646}

Duas telas mostravam um estado certo com o texto de outro lugar (AT-323,
AT-324 — achados P1 e K1/K2 do levantamento visual da Rodada 29).

**A aba PRs e o portão da imagem.** O bloqueio é REAL e fica: a lista de PRs e
o diff passam pelo MESMO funil da aba Código (`ReadProjectCodeUseCase.alvo` →
`portaoDoContainer`), então sem imagem decidida (RN-105, nos três modos pela
[RN-494](broker.md#rn-494)) a api responde 409 também ali — medido, não suposto. O que
estava errado era o texto: a aba PRs mostrava "A aba Code ainda não está
liberada", falando de OUTRA aba e com um nome ("Code") que não é o do trilho
("Código"). Agora `ContainerImageGateNotice` recebe a SUPERFÍCIE bloqueada
(`'code' | 'prs'`), a aba PRs diz "A lista de PRs ainda não está liberada" e
explica que lê o repositório pelo mesmo caminho da aba Código; e o nome das
abas no texto vem de `nav:tabs.*.label`, a MESMA fonte do trilho — nunca um
literal, que é como "Code" e "Código" divergiram. A nota da aba PRs NÃO
promete liberar sozinha: a aba Código pergunta o estado e revalida, a lista de
PRs só descobre o 409 quando a query falha.

**`/containers` sem container.** Parar e Remover já eram `disabled` com
`registrado: null` ([RN-521](api.md#rn-521), "nunca provisionado") e com `removed`,
mas nada dizia por quê, e a variante `danger` do `Button` não tinha estado
desabilitado — "Remover" saía em vermelho cheio, igual ao ativo. Agora a linha
diz o motivo UMA vez em texto (`Nunca provisionado: não há container para
parar nem remover.` / `Container removido: …`), e `.danger:disabled` ganha a
mesma opacidade das outras variantes. Linha com container de pé não ganha
texto nenhum.

**O motivo longo da falta de broker.** O texto que nomeia `BROKER_URL` tinha
nove linhas e triplicava a altura da linha da tabela. A célula mostra agora UMA
frase curta num `<summary>`, e o texto longo (que continua nomeando a variável,
para o operador) abre sob demanda no `<details>` — nativo e acessível por
teclado, nunca `title` num botão desabilitado (ADR 0064). Quando a MESMA falta
de broker trava subir E parar/remover, é UMA linha só ("subir, parar e remover
só terminariam em falha"), com os dois detalhes atrás do mesmo `<details>`.

- **Código:** `apps/web/src/components/ContainerImageGate.tsx:33`
  (`ContainerImageGateNotice`), `:42` (`bloco`);
  `apps/web/src/routes/ProjectPrsTab.tsx:157` (`superficie="prs"`);
  `apps/web/src/components/AcoesDoContainer.tsx:252` (`semContainer`), `:272`
  (`detalhesDoBroker`); `apps/web/src/components/ui/Button.module.css:101`
  (`.danger:disabled`)
- **Teste:** `apps/web/src/routes/ProjectPrsTab.test.tsx` ("409 do portão vira
  o estado dedicado, com o texto da aba PRs e não o da aba Código", "409 no
  diff aberto por id também usa o texto da aba PRs", e o caso de falha: 500
  continua banner com "Tentar de novo"); `apps/web/src/routes/ProjectCodeTab.test.tsx`
  e `apps/web/src/routes/code/CodeDiffPanel.test.tsx` (a aba Código diz
  "Código"); `apps/web/src/routes/ContainersPage.test.tsx`, bloco "Parar/Remover
  sem container e o motivo curto (AT-324)" (nunca provisionado, removido, o
  caso de falha "container de pé: nenhum motivo", o `<details>` fechado com
  `BROKER_URL` só dentro dele, e a linha única quando o broker trava as três)
- **Origem:** AT-323, AT-324. Não muda o portão da RN-105/RN-494 (a lista de
  PRs segue bloqueada sem imagem decidida — se ela DEVE escapar do portão é
  decisão do dono), nem a régua de subida da RN-521/RN-574.

### RN-648 — A sidebar, o card do Dashboard e o painel de artefatos não se contradizem: cada estado vazio diz QUAL sessão leu, e contador e lista contam na mesma unidade {#rn-648}

Três telas afirmavam "nada" ao lado de uma tela que mostrava algo (AT-325 —
achados S2/D2/X6 do levantamento visual da AT-290). A reprodução com o engine
real não foi possível neste ambiente (o egress bloqueia `repo.hex.pm` e o
Alpine, e nenhuma imagem compila); as três contradições foram MEDIDAS no
código e provadas por testes que falham antes da correção. A do Dashboard
nasceu, no levantamento, de um 500 do stub do engine no resumo do workspace —
mas o texto que a transformou em "sem atividade" é do web, e com o engine real
qualquer falha do resumo produziria o mesmo.

**A sidebar lia a sessão de EXECUÇÃO, e só ela.** O bloco Atividades
(RN-198) pedia os eventos da sessão de execução vigente
(`useActiveExecutionSession`). Num projeto só com sessões de conversa ela é
`null`, a lista vinha vazia, e a sidebar dizia "Nenhum agente entrou em ação
ainda" ao lado de uma Visão geral com o Criativo aguardando. Agora: com
execução vigente, a sidebar continua lendo ELA (os dev agents e as instâncias
`-2` são o que o agrupamento da RN-198 existe para mostrar, e a `queryKey` é a
da aba Executores); SEM execução, lê a MESMA sessão da Visão geral e do card do
Dashboard — a mais recente de trabalho (`useLatestSession`, a regra de
`sessaoMaisRecente`). Os estados que colapsavam no mesmo texto se separam
([RN-470](#rn-470)): carregando (nada é afirmado), erro (texto próprio),
projeto sem sessão ("Este projeto ainda não tem sessão."), e a sessão lida sem
agente, com o texto NOMEANDO qual ("…na sessão de execução…" /
"…na sessão mais recente…"). A lista de sessões só é pedida sem execução, e com
o frescor de um ciclo de projeto (`frescorMs` em `useProjectSessions`): quando
a sidebar a habilita a moldura do projeto já a trouxe, e o orçamento de
requisições da [RN-632](#rn-632)/[RN-645](#rn-645) não cresce.

**O card do Dashboard tinha um texto para quatro estados.** "Sem atividade
ainda" saía com o resumo do workspace CARREGANDO, com ele FALHADO (o caso do
levantamento: o resumo respondia 500 e o card de um projeto com dezesseis
eventos dizia que não havia nenhum), com o projeto SEM sessão e com a sessão
mais recente vazia. Agora são quatro textos: "carregando atividade…",
"atividade indisponível", "Nenhuma sessão ainda" e "Sem atividade na sessão
mais recente ainda". A linha continua lendo a sessão mais recente de trabalho
(`latestSessionId`), a mesma da Visão geral e da sidebar sem execução — a api
não mudou.

**"Artefatos gerados 3" sobre um único grupo "PO 1".** O cabeçalho da seção
contava a ÁRVORE do backlog (épico, história e tarefa: 3) e o grupo por agente
contava só as RAÍZES (1). Os dois contam agora na mesma unidade — cada item
carrega `quantos` (1, mais os descendentes quando é raiz do backlog), o
cabeçalho é a soma dos itens e cada grupo é a soma dos seus, então a soma dos
grupos É o cabeçalho, por construção. E o vazio da seção diz o que ela conta
("Nenhuma PR nem item de backlog nesta sessão ainda.") em vez do "Nada ainda."
genérico, que ao lado de um brief ou de uma regra da mesma sessão parecia negar
que eles existissem — o escopo da seção (PR e backlog, [RN-159](#rn-159)) não
muda.

- **Código:** `apps/web/src/routes/Shell.tsx:604` (`execucao`), `:594`
  (`origemDaAtividade`), `:601` (`estadoDaAtividade`);
  `apps/web/src/lib/hooks.ts:127` (`useProjectSessions`, `frescorMs`);
  `apps/web/src/routes/Dashboard.tsx:75` (`lastActivityText`);
  `apps/web/src/routes/ContextAside.tsx:46` (`quantos`), `:340`
  (`totalDeArtefatos`)
- **Teste:** `apps/web/src/routes/Shell.test.tsx` ("Shell — Atividades": sem
  execução lê a sessão da Visão geral e o Criativo aparece; com execução lê a
  de execução e o vazio diz qual; projeto sem sessão; e o caso de falha, a
  lista de sessões que falha vira erro nomeado e nunca "nenhum agente");
  `apps/web/src/routes/Dashboard.test.tsx` ("Dashboard — linha de atividade do
  card (RN-648)": o resumo que falhou diz "indisponível", carregando não afirma,
  sem sessão × sessão vazia têm textos diferentes, e com evento nenhum vazio
  aparece); `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx` (a
  soma dos grupos é o cabeçalho; o vazio diz o que conta);
  `apps/web/src/routes/configuracoes.orcamento.test.tsx` e
  `apps/web/src/routes/duas-abas.orcamento.test.tsx` seguem nos tetos
- **Origem:** AT-325 (achados S2/D2/X6 da AT-290). Não muda o escopo da
  [RN-159](#rn-159) nem o resumo do workspace ([RN-090](api.md#rn-090)); estende a
  [RN-198](api.md#rn-198) (qual sessão a sidebar lê) e aplica a [RN-470](#rn-470)

## Acompanhar ao vivo sem martelar (RN-639)

### RN-651 — No telefone, o painel da Sessão é gaveta, a barra quebra linha, e a tabela vira cartões {#rn-651}

A auditoria visual "depois" da Rodada 29
(`docs/explanation/auditoria-visual-rodada-29.md`, achados N1 e N3 a N8) mediu,
a 390px, o que a [RN-643](#rn-643) não tinha alcançado: na Sessão o painel
"Contexto da sessão" mantinha ~320px e deixava ~70px ao fio (uma palavra por
linha), e a barra jogava "Iniciar ideação" e "Encerrar" para fora da borda; em
`/containers` sete colunas em fração sobrepunham os cabeçalhos e cortavam as
ações; em "Modelos por agente" o nome do agente tinha 6px e o seletor 0px; o
`/status` rolava de lado (413px); a busca do Dashboard virava "Bus"; o nome da
sessão na lista do Criativo tinha 0px; e o trilho móvel deixava a aba ativa
cortada, sem sinal de que rolava.

**A regra** (o corte é o mesmo `useLayoutMovel` da [RN-643](#rn-643), e o
desenho vem por CLASSE ou atributo que o componente põe, nunca por `@media`):

1. **O painel de contexto da Sessão nasce FECHADO no telefone** e abre como
   GAVETA sobre o fio, pela direita: diálogo modal com o nome do painel, foco
   no X ao abrir, Esc, X e fundo fecham e devolvem o foco a quem abriu. No
   desktop ele nasce aberto ao lado do fio, como sempre. Cruzar o corte volta
   ao padrão do lado novo — um painel aberto no desktop não reaparece
   espremendo o fio no telefone. A exceção é a navegação que VEM ao painel
   (`highlightEvent`, o chip de evidência do Psicólogo): aí ele nasce aberto
   também no telefone.
2. **A barra da Sessão quebra linha, nunca corta.** Saída, estado, título e o
   alternador do painel ficam na primeira linha; tipo, ajustes, "Iniciar
   ideação" e "Encerrar" descem, e descem de novo se precisar. O que a barra
   mostra continua decidido pela largura dela ([RN-620](#rn-620) item 6).
3. **Toda `Table` vira pilha de cartões no telefone.** Cada linha é um cartão
   e cada célula leva o rótulo da coluna ao lado do valor; o cabeçalho some.
   Coluna sem rótulo, ou marcada `largaNoMovel` (um seletor, um bloco de
   ações), ocupa a largura do cartão com o rótulo em cima.
4. **A página não rola de lado, e o que identifica a linha não some.** O
   `/status` rola a tabela por dentro de um invólucro próprio; a busca do
   Dashboard ganha linha inteira; a linha da lista de sessões quebra com o nome
   em cima, inteiro.
5. **O trilho móvel acompanha a aba ativa e diz que rola.** A ativa é trazida
   para a faixa ao montar, ao trocar, quando o CONTEÚDO do trilho muda (os
   contadores chegam depois e alargam as abas anteriores) e quando as fontes
   terminam de carregar — nunca a cada render, senão quem rolou a faixa à mão
   seria puxado de volta. A borda que esconde abas esmaece
   (`data-rola-inicio`/`data-rola-fim`).

**Medido** (390×844, os dois temas, api nativa com o seed, `validacao-visual.js`
injetado): `scrollWidth` 390 em todas as sete telas; zero `texto-cortado` no
Dashboard, na lista do Criativo, na Sessão (com e sem a gaveta), em
`/containers` e no `/status`; nas Configurações os 33 caíram para zero, e a aba
ativa do trilho ficou inteira dentro da faixa nas três abas medidas.

**O que esta regra NÃO fecha:** na barra mínima "Encerrar" continua só com o
ícone e o nome acessível (a [RN-620](#rn-620) decide isso pela largura da
barra). O alternador do painel sobe para a linha do título só na PINTURA
(`order`): a ordem do Tab segue a do DOM. O `fora-da-viewport` que o
verificador ainda relata nas Configurações e em Aprovações são ícones decorativos com
`position: absolute` dentro de controles abaixo da dobra, não algo cortado.

- **Código:** `apps/web/src/lib/painel-de-contexto.ts:16`
  (`usePainelDeContexto`); `apps/web/src/routes/GavetaDoContexto.tsx:14`
  (`GavetaDoContexto`); `apps/web/src/routes/SessionTopbar.tsx:134`
  (`movel`); `apps/web/src/components/ui/Table.tsx:24` (`largaNoMovel`),
  `:43` (`movel`); `apps/web/src/routes/Dashboard.tsx:165` (`movel`);
  `apps/web/src/routes/ProjectSessionsTab.tsx:153` (`movel`)
- **Teste:** `apps/web/src/routes/SessionPage.layout-movel.test.tsx` (a gaveta
  nasce fechada, abre com o foco no X e o Esc fecha devolvendo o foco; X e
  fundo fecham; a barra quebra antes das ações; e o caso de falha, no desktop o
  painel fica ao lado do fio sem gaveta nem quebra; cruzar o corte fecha o
  painel); `apps/web/src/components/ui/Table.test.tsx` ("layout estreito");
  `apps/web/src/routes/ContainersPage.test.tsx`,
  `apps/web/src/routes/settings/modelos-por-agente-no-movel.test.tsx`,
  `apps/web/src/routes/StatusPage.test.tsx`,
  `apps/web/src/routes/Dashboard.test.tsx`,
  `apps/web/src/routes/ProjectSessionsTab.test.tsx` (cada um com o móvel e o
  caso de falha do desktop ou da faixa que cabe). A faixa de abas do projeto
  (`ProjectRail`, achado N8) saiu no
  [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md): as abas
  moram na gaveta
- **Origem:** AT-328 (achado N1) e AT-330 (achados N3 a N8) da auditoria
  visual da Rodada 29; completa a [RN-643](#rn-643)

## O autor de cada fala do fio é o ator do evento (RN-652)

### RN-652 — `chat.message` é desenhado sob o ATOR do evento — pessoa, agente ou desconhecido —, nunca sob quem vê a tela {#rn-652}

Até aqui todo `chat.message` saía com o nome e o avatar de quem estava logado:
numa sessão compartilhada, a fala de outra pessoa aparecia com o SEU nome, e a
de um agente com o seu e-mail (achado N2 da auditoria visual da Rodada 29,
escondido enquanto o fio agrupava o histórico por origem). O autor sai agora do
`actor` do evento, que a api grava com o id de quem mandou
(`SendAgentMessageUseCase`, `SendChatMessageUseCase`) e que a rota genérica de
anexar evento aceita de qualquer espécie. Os desfechos não se colapsam:

1. **Quem vê** (`actor.id` igual ao `sub` do token; sem ele, pelo e-mail da
   linha de membro) — o nome ou e-mail da linha de membro, senão o e-mail da
   sessão, e só na falta dos dois "Você".
2. **Outra pessoa que a tela sabe nomear** — o nome dela, senão o e-mail, de
   DUAS leituras compostas numa lista só (`comporMembros`), a de PROJETO antes
   da de WORKSPACE: `GET projects/:id/members` (mínimo `viewer`), sob a MESMA
   `queryKey` da aba de Configurações, e desde a AT-335
   `GET workspaces/:id/members` ([RN-655](api.md#rn-655)), do workspace DO PROJETO.
   Quem tem as duas linhas aparece uma vez, pela de projeto — a mesma ordem da
   sobreposição de papel ([RN-471](#rn-471)).
3. **Outra pessoa que a tela NÃO sabe nomear** — "Outro membro": sem linha de
   projeto nem de workspace (quem saiu do workspace e ainda tem fala no log),
   ou as duas leituras falharam ou ainda não chegaram. A leitura que falha não
   apaga a outra, e nenhuma delas quebra o fio. Até a AT-335 esta era a LACUNA
   declarada de quem entra só pelo papel de workspace, que não tinha rota de
   leitura; a rota nasceu por decisão do dono.
4. **Agente** — `nomeDoAgente` e o avatar/cor do agente, como `agent.response`.
5. **Ator desconhecido** (ausente, sem id, `system` ou espécie fora de
   pessoa/agente) — "Autor desconhecido", nunca "Você".

A narração `backlog.story_promotion_returned`, que tinha o mesmo defeito
(o nome de quem vê sobre quem devolveu a história), passa pela mesma função.
A mensagem OTIMISTA do composer continua com o e-mail de quem vê — ela é
sempre dele.

- **Código:** `apps/web/src/lib/autor-da-mensagem.ts:52` (`autorDaMensagem`);
  `apps/web/src/lib/autoria-da-sessao.ts:45` (`useAutoriaDaSessao`), `:18`
  (`comporMembros`);
  `apps/web/src/routes/session-timeline-montagem.tsx:186` (`rotuloDoAutor`),
  `:405` (o `chat.message`), `:687` (a devolução de história);
  `apps/web/src/routes/SessionPage.tsx:133` (`autoria`)
- **Teste:** `apps/web/src/routes/SessionPage.autor-da-mensagem.test.tsx:147`
  (duas pessoas e um agente, cada mensagem sob o próprio autor — caminho
  feliz), `:168` (ator desconhecido e pessoa fora dos membros com texto
  próprio — caso de falha), `:186` (quem entra só pelo papel de workspace é
  nomeado — AT-335), `:205` (a leitura do workspace recusada não apaga a do
  projeto), `:219` (leitura de membros recusada);
  `apps/web/src/lib/autoria-da-sessao.test.ts:15` (a linha de projeto antes da
  de workspace), `:22` (falha de uma leitura não apaga a outra);
  `apps/web/src/lib/autor-da-mensagem.test.ts:58` (ator ausente, sem id ou de
  espécie desconhecida nunca vira "você")
- **Origem:** AT-329 (achado N2 de `docs/explanation/auditoria-visual-rodada-29.md`);
  a lista do workspace, AT-335

## O motivo da política em cada cartão de Aprovações (RN-656)

### RN-661 — O modo automático é OFERECIDO em lote para o time no início da execução, e a oferta diz o que ele não libera {#rn-661}

Na aba Executores, com a execução ativa e o time de execução na tela, um cartão
oferece ligar o modo automático (RN-153) para os agentes do time de uma vez
(AT-315). É UM controle, e é oferta: os agentes que ainda não estão em
automático vêm marcados, a pessoa desmarca quem não quer, e nada é gravado sem
o clique em "Ligar". O clique grava a MESMA curinga (`agent_autonomy`,
`actionType: "*"`, `auto_approve`) pelo MESMO endpoint do toggle por agente
(`PUT .../agent-autonomy`, `maintainer`) — um PUT por agente, em série, sem
abortar na primeira recusa, com desfecho POR agente nos três casos da RN-469
(todos, nenhum com a frase da api, alguns com quem ficou em manual). Desligar
continua no toggle manual/auto do card de cada agente; não há "desligar em
lote". Quando todos já estão em automático, o cartão some.

O cartão DIZ, antes do clique, o que o modo automático NÃO libera — os tetos
absolutos seguem pedindo aprovação (RN-154, RN-418): merge em branch protegida;
`git push`, abertura de PR e deploy; `sudo`/`doas`; `container_remove`;
`instruction_patch`; paralelizar ou subir o teto de paralelismo. Sem
`maintainer` o controle fica inerte e o motivo é dito em texto; o papel lido é
o de WORKSPACE, com a mesma lacuna declarada das outras telas de modo
automático (RN-471).

- **Código:** `apps/web/src/components/ModoAutomaticoDoTime.tsx:77`
  (`ModoAutomaticoDoTime`), `:113` (`ligar`), `:48`
  (`agentesEmModoAutomatico`); `apps/web/src/routes/ProjectExecutorsTab.tsx:93`
  (`podeLigarModoAutomatico`), `:308` (onde a oferta monta)
- **Teste:** `apps/web/src/components/ModoAutomaticoDoTime.test.tsx:54` (nada
  gravado ao montar; o clique grava a curinga para cada escolhido — caminho
  feliz), `:85` (a api recusa um agente e o desfecho nomeia quem ficou em
  manual — caso de falha), `:74` (o que não libera), `:102` (sem
  `maintainer`), `:108` (todos em automático, nada a oferecer)
- **Origem:** AT-315 (levantamento da AT-309, linha "Modo automático")

## O fluxo do runner pelo navegador é aposentado (RN-687, ADR 0203)

### RN-687 — O painel do runner manda para o instalador; o navegador não gera chave, não baixa binário e não grava pasta {#rn-687}

O fluxo do [ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
([RN-464](api.md#rn-464)..[466](runner.md#rn-466)) foi APOSENTADO por decisão do dono
(01/10, `BRB-031`): era o único caminho de instalação que terminava em
`chmod +x` manual, e o `install.sh` já faz as três coisas dele do lado certo —
baixa o binário conferido contra o `checksums.txt` assinado e o instala com
`install -m 0755` ([RN-531](produto.md#rn-531)), e cria a chave NA MÁQUINA e a registra
([RN-547](produto.md#rn-547), [RN-551](runner.md#rn-551), [RN-552](api.md#rn-552)).

**A regra:**

1. **O `RunnerOnboardingPanel` mostra o comando do instalador**
   (`curl -fsSLO …/install.sh && bash install.sh`, a MESMA frase do runbook e
   do `install.sh`, [RN-526](produto.md#rn-526)), copiável, com o que ele faz dito em
   texto, a ressalva de que ele serve a máquina da instalação, e a
   `EsperaDoRunner` ([RN-474](#rn-474)) embaixo. O comando no web é uma CÓPIA,
   e a cópia é conferida contra a constante do instalador.
2. **Reconhecida uma chave ativa que serve o projeto** — de máquina
   ([RN-548](#rn-548)) ou de projeto (AT-107) —, o bloco do instalador SAI e o
   gesto é conferir o serviço. O comando manual com PAT (`--token`) fica sempre
   no `<details>`, nomeado como o caminho de OUTRA máquina.
3. **Não há botão de configurar pasta, de baixar arquivos, nem seletor de
   plataforma**, e o web não chama mais Web Crypto, File System Access nem o
   proxy do binário. `runner-bootstrap.ts` saiu inteiro.
4. **A api não tem mais `POST /projects/:projectId/runner-device-keys`.** Ele
   ficou sem chamador. `GET` e `DELETE` ficam (listar e revogar); a rota
   interna de máquina (`POST /internal/machine-device-keys`) fica.
5. **Chave de projeto JÁ registrada continua valendo e revogável**: nada no
   banco muda, o `PatAuthGuard` segue aceitando-a ([RN-465](api.md#rn-465)) e o CLI
   segue lendo a pasta configurada ([RN-466](runner.md#rn-466)). O runner configurado
   pelo navegador antes do ADR 0203 não quebra.

Fica de fora, declarado: instalação com TIME perde o caminho sem PAT para
parear uma segunda máquina (a rota de chave de máquina é 409 com duas ou mais
pessoas), e passa a usar o comando manual; `GET /runner-releases/binary` fica
sem consumidor de produção e NÃO foi removido — é decisão à parte.

- **Onde:** `apps/web/src/components/RunnerOnboardingPanel.tsx:68`
  (`COMANDO_DO_INSTALADOR`), `:124` (`RunnerOnboardingPanel`);
  `apps/api/src/interfaces/http/runner/runner-device-keys.controller.ts:75`
  (`RunnerDeviceKeysController`), `:96` (`listDeviceKeys`), `:119`
  (`revokeDeviceKey`); `apps/api/src/interfaces/http/auth/pat-auth.guard.ts:152`
  (`autenticarChaveDeDispositivo`)
- **Teste:** `apps/web/src/components/RunnerOnboardingPanel.test.tsx:91`
  (caminho feliz: o comando do instalador, copiado, e a espera), `:119` (o
  fluxo do navegador saiu: nenhum botão dele, nenhum `chmod`), `:134` (caso de
  falha: clipboard recusado não quebra a tela), `:211` (chave de máquina ativa:
  o instalador sai); `apps/api/test/interfaces/http/runner/runner-device-keys.controller.spec.ts:43`
  (não há handler de `POST`); `apps/api/test/interfaces/pat-auth.guard.spec.ts:345`
  (chave de projeto segue aceita); `scripts/dev/install-invocacao.spec.ts:162`
  (o comando do painel é a frase do instalador);
  `scripts/ci/alvos-do-runner.spec.ts:70` (a lista de alvos do navegador não
  volta)
- **Decisão arquitetural:** [ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md)
- **Origem:** AT-014 (`BRB-031`), decisão do dono em 01/10

## O teto da RN-418 vale também pela porta tipada (RN-689)

### RN-693 — Ativar o agente não é conversa: a dica de abertura fica no fio até a primeira mensagem, e os campos de texto da sessão não convidam o autofill {#rn-693}

Medido no uso real da v7.0.0: "Iniciar ideação" grava `agent.activated` (e
`agent.status`), o Criativo só fala depois da primeira mensagem, e o convite
— com a dica "Comece contando o que você quer construir…" — sumia no clique,
porque a pergunta "a conversa começou?" era `events.length > 0`. O fio ficava
vazio por ~25 s.

**A regra:** eventos de CICLO DE VIDA do agente (`agent.activated`,
`agent.status`) não contam como conversa. Qualquer outro evento continua
contando, para o convite não cobrir a sessão do git-bootstrap nem a de
execução ([RN-131](#rn-131)). Com o Criativo ativo e sem mensagem, o convite
fica sem o botão "Iniciar ideação" e com a dica; a primeira mensagem o tira.

E o composer e os campos de texto das perguntas estruturadas levam
`autocomplete="off"` e os atributos que os gerenciadores de senha respeitam
(`data-1p-ignore`, `data-lpignore="true"`, `data-bwignore`,
`data-form-type="other"`): cada foco abria o popup de autofill do navegador.

- **Onde:** `apps/web/src/lib/conversa-comecou.ts:15` (`conversaComecou`),
  `:29` (`SEM_AUTOFILL`); `apps/web/src/routes/SessionPage.tsx:440`
  (`conversaComecou`); `apps/web/src/routes/SessionComposer.tsx:524`
  (`SEM_AUTOFILL`); `apps/web/src/routes/StructuredQuestionCard.tsx:242`
  (`SEM_AUTOFILL`)
- **Teste:** `apps/web/src/routes/SessionPage.sessao.test.tsx:316` (Criativo
  ativado sem mensagem mantém a dica; com mensagem ela some — caso de falha;
  atributos do composer); `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx:201`
  (atributos dos campos das perguntas)
- **Origem:** AT-353

### RN-694 — O catálogo de modelos tem busca, a credencial oferece o sync, e o primeiro modelo vai ao time num clique {#rn-694}

Três atalhos sobre ações que já existiam, nenhum endpoint novo (AT-357):

1. **Busca.** O catálogo tem um campo de busca que casa o nome de exibição, o
   `name` ou o `id` do modelo, sem diferenciar maiúsculas. Com termo, todo
   grupo e subgrupo de hub com resultado abre sozinho; busca sem resultado DIZ
   que nada casou, com o termo — nunca uma lista vazia muda.
2. **Sync ao lado da credencial.** O card de credencial cujo provider tem chave
   e NENHUM modelo no catálogo diz isso e oferece "Atualizar catálogo" — a
   MESMA ação do catálogo (`POST .../models/sync`). O botão só aparece para
   `owner` (o mínimo do endpoint, RN-102); ler o catálogo pede `maintainer`.
   O predicado é UM só, `providersSemCatalogo`, também usado pelo aviso do
   catálogo.
3. ~~Ativar e aplicar ao time.~~ **Retirado pela RN-911** (AT-597): o catálogo
   saiu das Configurações do projeto e mora em `/providers`, onde não há projeto
   para receber o binding. Ativar é curadoria de provider; a escolha por
   projeto segue pelo "aplicar a todos" da RN-476.

- **Onde:** `apps/web/src/lib/models.ts:244` (`casaComBusca`),
  `apps/web/src/lib/models.ts:491` (`providersSemCatalogo`),
  `apps/web/src/lib/models.ts:507` (`algumModeloAtivo`),
  `apps/web/src/routes/settings/CredentialsSection.tsx:123` (`handleSync`)
- **Teste:** `apps/web/src/components/catalogo-com-busca.test.tsx`
  (busca por id e sem resultado; sem atalho "ativar e aplicar"; sync no card,
  com e sem catálogo, e a falha)
- **Origem:** AT-357

## O instalador oferece os modelos locais, e não confunde o dev com uma instalação (RN-691, RN-692)

### RN-701 — O painel de contexto não afirma "0" sobre regras que saíram da janela {#rn-701}

O painel "Contexto da sessão" lê os eventos já baixados (RN-180). Numa sessão
com mais eventos do que a janela, as regras de negócio emitidas no começo ficam
ANTES dela, e o contador dizia **0** com "Nada ainda." — afirmando sobre o que
não leu (medido na sessão de 268 eventos de 02/10: 5 regras viraram 0). Com
eventos anteriores à janela, o contador passa a dizer "N na janela · há mais
antes" e a seção vazia diz que não há nenhuma NOS EVENTOS CARREGADOS. Sem
leitura nova: o número de anteriores continua saindo da subtração sobre o
`seq`.

A outra metade do AT-365 — o cartão de aprovação já executado voltando a pedir
decisão — NÃO foi corrigida aqui: o card do fio já decide pelo `status` da
AÇÃO (`ApprovalCard`, `isPending`), e a leitura de ações é a cauda mais as
pendentes (RN-637); o defeito não reproduz pelo código do web.

Medição (02/10, no ambiente da AT-015): `GET .../actions?latest=true` da
sessão 17d41c20 devolve as duas `open_adr_pr` como `executed`, e recarregar a
sessão (com os blocos recolhidos abertos) não mostra nenhum "Aprovar". O
cartão pendente apareceu só DURANTE a sessão ao vivo — estado transitório da
tela, não da api nem da janela. A próxima rodada da AT-015 captura a rede no
momento em que ele aparecer, antes de qualquer correção.

- **Onde:** `apps/web/src/routes/ContextAside.tsx:393` (`trailing`), `:415`
  (`nadaNaJanela`)
- **Teste:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  ("RN-701 (AT-365): com as regras fora da janela, o contador não afirma 0";
  o caso de falha evitado é o "alcançando o começo da sessão" ao lado)
- **Origem:** AT-365

### RN-708 — O projeto novo diz o próximo passo, derivado do que já se lê {#rn-708}

A Visão geral de um projeto recém-criado não dizia o que fazer: sem chave de
provedor, sem modelo e sem sessão, nada na tela apontava o caminho, e a
credencial e o catálogo moravam no fim de Configurações (medido no teste real
de 02/10, instalação nova). Desde a AT-372 a Visão geral abre com o cartão
"Primeiros passos", com TRÊS passos, cada um com o link para o lugar exato:

- **credencial** — a conta tem ao menos uma credencial de LLM (a mesma
  leitura `['credentials']` da seção de Credenciais, com o frescor de
  configuração e sem poll, RN-645). A Visão geral não fazia essa leitura, e a
  carga dela tem orçamento: ela só roda quando o time ainda não tem modelo;
  com modelo resolvido, o passo conta como coberto;
- **modelo** — o binding resolvido do Criativo não é nulo (o lote da RN-654,
  a mesma `queryKey` de Configurações);
- **ideação** — o projeto tem ao menos uma sessão (a lista que a página já
  polla).

Nenhuma rota nova. Insumo ainda não lido (ou com erro) é "não sei" (RN-470), e
o cartão NÃO aparece enquanto houver um — afirmar "falta credencial" sem ter
lido seria a tela mentindo. Com os três feitos, ele some. Junto, a aba
Configurações passou a abrir pelo grupo de modelos, com a credencial à frente,
e o sumário acompanha a ordem.

**Destinos (revisão da RN-911, AT-597):** o passo da credencial leva a `/providers`
(a chave é do usuário e deixou as Configurações do projeto) e o do modelo leva a
`?tab=settings&section=models`; o catálogo, que o passo antigo abria, também é
de `/providers`.

- **Onde:** `apps/web/src/lib/primeiros-passos.ts:37` (`derivarPrimeirosPassos`),
  `apps/web/src/components/PrimeirosPassos.tsx:22` (`PrimeirosPassos`)
- **Teste:** `apps/web/src/lib/primeiros-passos.test.ts` (caminho feliz e "insumo
  não lido não vira pendente") e `apps/web/src/routes/ProjectOverviewTab.test.tsx`
  ("primeiros passos (RN-708, AT-372)")
- **Origem:** AT-372

### RN-709 — O cartão diz o tempo certo do verbo, o teto não oferece "sempre permitir", e o plano diz quanto custa e só sobe agente com tarefa {#rn-709}

Medido no projeto de teste de 02/10. Quatro defeitos de um mesmo cartão de
decisão, fechados juntos:

- **O verbo segue o estado da ação (AT-371).** O cartão pendente de PR dizia
  "abriu pull request (de ADR)" antes de abrir. `VERBO_DA_ACAO` fala da
  PROPOSTA ("quer abrir pull request…") e `VERBO_DA_ACAO_EXECUTADA` dá o verbo
  do que já aconteceu, só para os tipos cujo tempo muda; `verboDaAcao` recebe o
  `status` e é a fonte única.
- **PR de ADR e de infra são teto da RN-418 (AT-371).** `open_adr_pr` e
  `open_infra_pr` entram em `TIPOS_SEM_SEMPRE_PERMITIR` (api e a cópia do web,
  conferida por teste), como `pr_open` — "sempre permitir" recusa gravar o
  padrão e o cartão não oferece o botão nem o "Modo automático". Fora do
  terminal, as notas não falam mais de comando ("npm test", "roda qualquer
  comando"): o tipo tipado tem nota própria.
- **O plano mostra a estimativa (AT-381).** Ao propor `propose_execution_plan`
  a api acrescenta ao payload `orcamentoPorTarefaMicros` — o orçamento por
  tarefa VIGENTE, o mesmo que a ativação usa (setting do projeto ou o default
  de US$ 0,50) —, e a frase do cartão diz "até US$ X (N tarefas × US$ Y) — é o
  teto por tarefa, não o preço". Sem rota nova.
- **Módulo sem tarefa não ganha agente (AT-381).** Aplicar o plano passa à
  ativação os módulos com ≥ 1 tarefa (`modulosDoPlano`); os do `module_map`
  sem tarefa ficam de fora e são ditos no resultado (`modulosSemTarefa`), ao
  lado de `tarefasPorModulo`. O botão "Ativar execução" (sem plano) e o plano
  sem `tarefas` seguem subindo o mapa inteiro. O resumo calculado chega ao
  Dev Lead no texto do resultado da ferramenta (`resumo_do_plano/1`), para ele
  citar os números em vez de recontar.

- **Onde:** `apps/web/src/lib/aprovacoes.ts:450` (`verboDaAcao`),
  `apps/api/src/domain/actions/sempre-permitir.ts:33` (`TIPOS_SEM_SEMPRE_PERMITIR`),
  `apps/api/src/application/use-cases/actions/propose-action.use-case.ts:84` (`execute`),
  `apps/api/src/application/use-cases/execution/execute-execution-plan.use-case.ts:89` (`execute`),
  `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:123` (`execute`),
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:587` (`resumo_do_plano`)
- **Teste:** `apps/web/src/lib/aprovacoes.test.ts` ("AT-371 — o verbo segue o
  estado da ação", "AT-381 — o plano mostra a estimativa de gasto"),
  `apps/web/src/components/ApprovalCard.test.tsx` ("open_adr_pr pendente"),
  `apps/api/test/domain/actions/sempre-permitir.spec.ts`,
  `apps/api/test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  ("módulos do plano"), `apps/api/test/application/use-cases/execution/execute-execution-plan.use-case.spec.ts`,
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs` (`resumo_do_plano/1`)
- **Origem:** AT-371, AT-381

### RN-712 — O fio da sessão mostra o que acabou de acontecer, uma vez e legível {#rn-712}

Medido no teste real de 02/10 (`loja-teste`): a faixa do turno mostrava
Markdown cru, a resposta do formulário estruturado aparecia duas vezes, o
seletor de handoff manual oferecia Dev Lead, QA e Infra desde o primeiro
minuto da ideação, o "Para" ficava no PO com o Arquiteto já trabalhando, o
botão "Iniciar ideação" reaparecia no meio da sessão e um docker-compose de 80
linhas empurrava a conversa para fora da tela. Desde a AT-375:

- **faixa do turno** — a prévia e as linhas expandidas passam por
  `textoPlanoDoMarkdown`: `**`, `##`, réguas, tabelas e crases viram texto
  corrido. A faixa é prévia; a resposta renderizada continua sendo a bolha do
  fim do turno (RN-460), e o store do streaming não muda (RN-639);
- **formulário respondido** — a api reenvia as respostas ao agente como
  `chat.message` do usuário; a bolha cujo texto é EXATAMENTE o que a api monta
  (`"<n>. <rótulo>: <resposta>"`), primeira mensagem de usuário depois da
  resposta, sai do fio, porque o card respondido já as mostra. Mensagem
  digitada que só pareça uma lista fica;
- **destinatário** — a escolha feita no SELETOR do composer é manual e nunca é
  sobrescrita. A que veio de um gesto (aceitar handoff nesta tela, "Estou
  pronto") segue o destino do último handoff ACEITO, inclusive o aceito pelo
  sistema (RN-660). Revisa a cláusula da RN-631 de que um aceite por outro
  caminho "só acrescenta a opção" — só para escolha que não foi manual. Sem
  escolha nenhuma e com duas opções o envio continua travado;
- **handoff manual** — o seletor nasce recolhido atrás de um botão; a lista de
  agentes não mudou;
- **"Iniciar ideação"** — some do cabeçalho assim que algum agente entrou na
  sessão (evento de agente ou handoff);
- **cabeçalho** — o horário vira "iniciada às HH:MM:SS", e a origem do idioma
  quebra em até duas linhas antes de elipsar, com o texto inteiro no `title`;
- **bloco de código** — acima de 20 linhas nasce recolhido nas 8 primeiras,
  com "Mostrar as N linhas".

Fica de fora, medido: a primeira bolha do Criativo "modelo não registrado" vem
do ENGINE — `criativo_server.ex` grava o texto acumulado com `modelName` nulo
quando o turno termina entregando um formulário (`gravar_texto_do_turno(state,
"", nil)`), não da tela.

- **Onde:** `apps/web/src/lib/texto-plano.ts:7` (`textoPlanoDoMarkdown`),
  `apps/web/src/lib/eco-de-formulario.ts:17` (`ecosDeRespostaEstruturada`),
  `apps/web/src/lib/session-destinatario.ts:255` (`resolverDestinatario`),
  `apps/web/src/components/ui/MarkdownMessage.tsx:99` (`CodeFence`)
- **Teste:** `apps/web/src/lib/texto-plano.test.ts`,
  `apps/web/src/lib/eco-de-formulario.test.ts`,
  `apps/web/src/lib/session-destinatario.test.ts` ("RN-712"),
  `apps/web/src/components/ui/MarkdownMessage.test.tsx` ("RN-712")
- **Origem:** AT-375

## Uma chave de cache, uma pergunta (RN-718)

### RN-718 — Quem grava as ações de uma sessão no cache faz a MESMA leitura do fio {#rn-718}

`['session-actions', projectId, sessionId]` é UMA entrada do cache do TanStack
Query, e a aba Sessões gravava nela o resultado de outra pergunta: a PRIMEIRA
página crescente (`listActions({ limit: 200 })`, sem `latest`), enquanto o fio
da Sessão lê a cauda das 200 mais novas mais as pendentes que ela empurrou
([RN-637](api.md#rn-637)). As duas telas trocavam o recorte uma da outra — depois de
abrir a aba, o fio podia desenhar as 200 ações mais ANTIGAS da sessão, o
defeito que a RN-637 fechou, reaberto pela porta do cache (AT-365).

**A regra:** a chave e a função andam juntas, em `consultaDasAcoesDaSessao`
(`apps/web/src/lib/acoes-da-sessao.ts`). Quem LÊ as ações de uma sessão para
pôr no cache usa esse par — `usePendingActions` e o resumo por sessão da aba
Sessões. Chave própria para a aba foi considerada e descartada: pararia a troca
de cache, mas manteria a aba resumindo o recorte errado. Com a mesma leitura, o
resumo ganha — a pendente nova de uma sessão longa passa a contar em
"aguardando". Quem só INVALIDA a chave (decisão nas telas de aprovação, o canal
vivo) continua escrevendo a lista à mão: invalidar não grava dado.

- **Onde:** `apps/web/src/lib/acoes-da-sessao.ts:76` (`chaveDasAcoesDaSessao`),
  `:80` (`consultaDasAcoesDaSessao`); `apps/web/src/lib/hooks.ts:432`
  (`usePendingActions`); `apps/web/src/routes/ProjectSessionsTab.tsx:274`
  (`acoesPorSessao`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` (describe "a
  leitura de ações é a mesma do fio": com o fio tendo gravado a cauda, montar a
  aba deixa a cauda + pendente no cache e nenhuma chamada sem `latest` — falha
  no código antigo, que gravava as 200 mais antigas; e a pendente empurrada
  para fora da cauda conta em "aguardando")
- **Lacuna declarada:** o cartão de uma ação cujo `proposed_action.created`
  saiu da janela de 200 eventos ainda SALTA para o topo do fio
  (`ordemDaAcaoNaTimeline` degrada para `createdAt` e ancora em 0.5) — fixado
  como comportamento atual em
  `apps/web/src/routes/SessionPage.acao-fora-da-janela.test.tsx`, cuja
  correção é decisão separada. O mesmo teste prova que o cartão decidido não
  volta a pedir decisão: o que pareceu "voltar" no AT-365 era OUTRA ação.
- **Origem:** AT-365

## A Anamnese não paga duas vezes pela mesma janela, e o resgate de gate não reinicia ciclo que espera alguém (RN-722)

### RN-728 — A mensagem do usuário tem uma bolha só, e o card do Dev Lead tem um primário só {#rn-728}

- **Regra:** (1) a bolha OTIMISTA da mensagem enviada a um agente sai do fio
  assim que o `chat.message` com o `mensagemId` que a api devolveu no aceite
  está no log — casamento por id, nunca por texto, e sem esperar o fim do
  turno; o nome dela sai do MESMO `autorDaMensagem` da bolha do log
  ([RN-652](#rn-652)), com o e-mail do token só como fallback. Antes as duas
  conviviam durante o turno, uma com o nome e outra com o e-mail. (2) No card
  "passou o bastão ao Dev Lead", aceitar o handoff é o gesto primário e
  "Ativar execução" é SECUNDÁRIO, com o aviso do que pula: sem plano, os devs
  pegam as tarefas como estão ([RN-677](api.md#rn-677)).
- **Onde:** `apps/web/src/lib/mensagem-otimista.ts:14` (`otimistaJaNoLog`),
  `apps/web/src/lib/mensagem-otimista.ts:22` (`nomeDaMensagemOtimista`),
  `apps/web/src/routes/SessionPage.tsx:798` (`otimistaJaNoLog`),
  `apps/web/src/routes/session-timeline-montagem.tsx:644`
  (`handleActivateExecution`)
- **Teste:** `apps/web/src/lib/mensagem-otimista.test.ts` (feliz: o id no log
  tira a otimista; falha: id ausente ou de outro tipo a mantém; o nome é o da
  linha de membro), `apps/web/src/routes/SessionPage.cancelar-turno.test.tsx`
  ("com o turno em curso, a otimista sai quando o chat.message do aceite chega
  ao log"),
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`
  ("o aceite é o primário; "Ativar execução" é secundário e diz o que pula")
- **Origem:** AT-409 e AT-410 (TP-01 de 03/10); a forma do card é decisão do
  dono ("Secundário com aviso")

### RN-736 — O campo "Nome do projeto" não ganha foco sozinho nem se chama "name" {#rn-736}

- **Regra:** no passo de detalhes do assistente de projeto, o campo "Nome do
  projeto" NÃO recebe `autoFocus` e usa `id`/`name` `project-title` (desde a RN-834, `projeto-slug`), nunca
  "name" puro; os atributos que desligam gerenciadores de senha
  (`data-1p-ignore`, `data-lpignore`, `data-bwignore`, `data-form-type="other"`)
  continuam vindo da fonte única `SEM_AUTOFILL` (RN-729). Decisão: sem foco
  automático em caso nenhum (nem por teclado) — o menu "Contact Info" dessas
  extensões abre no FOCO, ignora `autocomplete="off"` e cobria a página; um
  clique ou Tab a mais é o preço. Os nomes dos atributos são os documentados
  publicamente por 1Password, LastPass, Bitwarden e Dashlane, não medidos
  contra cada extensão aqui.
- **Onde:** `apps/web/src/routes/NewProjectWizard.tsx:746` (`projeto-slug`),
  `apps/web/src/lib/conversa-comecou.ts:29` (`SEM_AUTOFILL`)
- **Teste:** `apps/web/src/routes/NewProjectWizard.test.tsx` ("RN-736: o campo
  de nome não ganha foco sozinho nem se chama \"name\"" e o de RN-729, que
  confere os quatro atributos)
- **Origem:** AT-418 (TP-01, 2ª rodada de 03/10)

### RN-740 — O campo "Nome do projeto" declara que não sugere nada, e o resto da lacuna é da extensão {#rn-740}

- **Regra:** `SEM_AUTOFILL` acrescenta `aria-autocomplete="none"` (a árvore
  acessível diz que o campo não oferece sugestão) e `data-protonpass-ignore`
  (o atributo que o Proton Pass documenta). O rótulo visível e o nome
  acessível continuam "Nome do projeto": trocar só o `aria-label` quebraria o
  "rótulo no nome" (WCAG 2.5.3), e trocar o rótulo visível é decisão de
  produto, não tomada. Medido no TP-01 de 03/10: o menu "Contact Info" abre ao
  focar/digitar mesmo com os atributos da RN-736 — a extensão provavelmente
  classifica pelo TEXTO do rótulo. Se o próximo TP-01 reproduzir com estes
  atributos, a lacuna é da EXTENSÃO e fica declarada aqui.
- **Onde:** `apps/web/src/lib/conversa-comecou.ts:29` (`SEM_AUTOFILL`)
- **Teste:** `apps/web/src/routes/NewProjectWizard.test.tsx` ("RN-740: …")
- **Origem:** AT-425 (TP-01, 3ª rodada de 03/10)

### RN-747 — O plano do Dev Lead diz quantos dev agents sobem, não quantos pede {#rn-747}

- **Regra:** aprovar `propose_execution_plan` ativa a execução (RN-677), e a
  ativação sobe UM dev agent por módulo; o `agentes` por módulo do plano é
  recomendação. O cartão de aprovação diz "sobe N dev agent(s), um por
  módulo" e, quando o plano pede mais que isso, que os agentes a mais só sobem
  se o usuário aceitar paralelizar depois — paralelizar é teto da RN-154 e
  nunca é auto-aprovado nem embutido na aprovação do plano. O resultado da
  ferramenta que volta ao Dev Lead diz o mesmo, e a descrição de `agentes`
  pede para não prometer ganho de paralelismo. A aspa do modelo nas pontas do
  resumo é removida antes de a frase citá-lo, para não sobrar `coberto."`.
- **Onde:** `apps/web/src/lib/aprovacoes.ts:327` (`propose_execution_plan`),
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:254` (`sobem`), `:245`
  (`classificar`), `:97` (`spec`)
- **Teste:** `apps/web/src/lib/aprovacoes.test.ts` ("plano com 2 agentes num
  módulo único diz que sobe 1…"; "plano sem agente a mais não fala de
  paralelizar"), `apps/engine/test/engine/agents/dev_lead_tools_test.exs`
  ("agente a mais no plano é dito como NÃO subindo")
- **Origem:** AT-437 (08/10: o plano aprovado prometia "2 agentes no módulo
  único… ~40% de ganho" e a execução subiu 1 dev)

### RN-748 — A espera por aprovação fecha a faixa do turno e leva o cartão à vista {#rn-748}

- **Regra:** quando o agente suspende o turno esperando aprovação humana
  (`agent.status: awaiting_approval`, hoje o Dev Lead no
  `propose_execution_plan`, RN-284), a tela de Sessão trata isso como FIM de
  turno também pelo CANAL — não só pela leitura do log (`turnoTerminouNoLog`,
  que já o fazia): a faixa de atividade sai, e com ela "Pôr na fila" e
  "Parar". E, quando uma espera NOVA aparece no log (o `seq` da espera mais
  recente muda depois da abertura), o fio rola até o fim SEM a guarda dos
  120px da RN-173, porque o cartão de aprovação é o que a pessoa precisa ver.
  Reabrir a sessão com uma espera antiga não rola nada além da abertura de
  sempre.
- **Onde:** `apps/web/src/lib/session-channel.ts:239` (`awaiting_approval`),
  `apps/web/src/lib/session-turno.ts:422` (`awaiting_approval`),
  `seqDaEsperaPorAprovacao` (removido na RN-951, `apps/web/src/lib/session-rolagem.ts`),
  `esperaPorAprovacao` (removido)
- **Teste:** `apps/web/src/lib/session-channel.test.ts` (`onAgentStatus repassa
  awaiting_approval (RN-748)`), `apps/web/src/lib/session-rolagem.test.ts`
  (`seqDaEsperaPorAprovacao (RN-748)`: espera mais recente; sem espera, `null`)
- **Origem:** AT-432 (TP-01: o Dev Lead em `awaiting_approval` com a faixa
  "Montando o plano de execução" ativa e o cartão fora da vista)

### RN-749 — A resposta cortada pelo teto oferece a continuação num clique {#rn-749}

- **Regra:** a bolha do agente cujo fecho termina na linha que o engine
  acrescenta à resposta cortada pelo teto de saída (RN-737, nos dois idiomas)
  mostra, com a sessão ativa, o botão "Continuar de onde parou". O clique manda
  ao MESMO agente o texto "Continue de onde parou." (no idioma da interface)
  pelo mesmo envio do composer — com turno em curso, entra na fila dele
  (RN-673) —, e o rascunho que a pessoa está escrevendo não é tocado. Só o
  fecho tem o botão; os passos do turno não. A tela reconhece a linha pelo
  texto, e as duas frases são o contrato com `Engine.Harness.RespostaCortada`.
- **Onde:** `apps/web/src/lib/resposta-cortada.ts:14` (`respostaCortada`),
  `apps/web/src/routes/session-timeline-montagem.tsx:950` (`respostaCortada`),
  `apps/web/src/routes/SessionPage.tsx:451` (`continuarRespostaCortada`),
  `:692` (`enviarMensagem`)
- **Teste:** `apps/web/src/lib/resposta-cortada.test.ts` (`respostaCortada
  (RN-749)`: as duas linhas reconhecidas; resposta inteira e a frase no meio do
  texto não)
- **Origem:** AT-434 (TP-01: a resposta cortada não oferecia ação, e o usuário
  teve de adivinhar "continue")

### RN-750 — O colapso por agente deixa o fecho de cada agente aberto {#rn-750}

- **Regra:** o colapso de mensagens por agente depois que ele passa o bastão
  (RN-138) nunca recolhe a ÚLTIMA mensagem daquele agente no fio — o fecho,
  que no handoff é o resumo que a pessoa acabou de ler. Recolhe-se o que veio
  antes dele na mesma sequência, e só com duas ou mais entradas (uma sozinha
  não vira cabeçalho, a régua de sempre da RN-138). Sequências anteriores do
  mesmo agente, separadas por outra fala, colapsam como antes. O corte do fio
  (RN-644) não muda: ele roda sobre a lista já agrupada.
- **Onde:** `apps/web/src/routes/session-fio.tsx:155` (`fechoDeCadaAgente`),
  `:181` (`fechoPorAgente`), `:190` (`indiceDoFecho`)
- **Teste:** `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`
  (`duas mensagens consecutivas do PO colapsam...`: duas recolhidas e o fecho
  aberto; `RN-750: com duas mensagens, o fecho fica aberto e a outra, sozinha,
  não vira grupo`)
- **Origem:** AT-435 (TP-01: no handoff o fio recolhia a resposta inteira do
  Criativo, "Criativo · 2 mensagens", escondendo o resumo)

### RN-751 — A Sessão e o catálogo não saltam: composer, aba ativa, barra de lote e rolagem {#rn-751}

- **Regra:** quatro correções de layout, cada uma uma regra de tela.
  (1) O composer não espreme o campo durante o turno: os botões não encolhem
  nem quebram texto, e descem de linha quando não cabem. (2) Sem a moldura do
  projeto montada, a aba que a sidebar marca é a que a ROTA implica — na tela
  de Sessão, o Chat —, e só fora disso a padrão. (3) A barra de ação em lote
  do catálogo de modelos SOBREPÕE a lista, presa ao pé da janela, e a seção
  ganha um respiro no fim enquanto ela está aberta; inserida no fluxo, ela
  empurrava a lista e o checkbox fugia do cursor. (4) O fio "acompanha o fim"
  (RN-173) também quando a pessoa ESTAVA no fim antes de a altura mudar — a
  intenção é medida no gesto de rolar, e a rolagem grampeada com conteúdo
  menor que a janela não a muda. A guarda dos 120px continua: quem rolou para
  cima não é arrastado. A causa do topo no aceite do handoff da Infra não foi
  reproduzida no navegador; a correção cobre a classe (conteúdo que encolhe e
  volta).
- **Onde:** `apps/web/src/routes/project-tabs.ts:383` (`abaDaRota`),
  `apps/web/src/routes/Shell.tsx:509` (`abaDaRota`),
  `estaPertoDoFim` (removido na RN-951, `apps/web/src/lib/session-rolagem.ts`),
  `estavaNoFimRef`, `aoRolarOFio` (removidos),
  `apps/web/src/components/ModelCatalogSection.module.css` (`.barraDeLote`),
  `apps/web/src/routes/SessionPage.module.css` (`.composer`)
- **Teste:** `apps/web/src/lib/session-rolagem-fim.test.ts` (`estaPertoDoFim`
  e `abaDaRota`: caminho feliz e falha), `apps/web/src/routes/Shell.test.tsx`
  (`sem a moldura montada (ex.: tela de Sessão)`: Chat marcado),
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx` (`não arrasta
  quem rolou pra cima`)
- **Origem:** AT-442 (TP-01, levantamento visual)

### RN-755 — Ligar o modo automático não aprova o cartão onde foi ligado {#rn-755}

- **Regra:** no `ApprovalCard` (o mesmo nas quatro superfícies), o botão
  "Modo automático" grava a curinga do agente (RN-153) e NÃO decide a ação
  do próprio cartão: ela segue pendente, com "Aprovar" como ação principal.
  Onde o botão sai, sai junto uma nota dizendo isso antes do clique ("Ligar o
  modo automático não aprova esta ação: ela continua esperando o seu
  Aprovar."). Aprovar o cartão junto com a ligação do modo seria decisão do
  dono e NÃO foi feito.
- **Onde:** `apps/web/src/components/ApprovalCard.tsx:211` (`ApprovalCard`)
- **Teste:** `apps/web/src/components/ApprovalCard.test.tsx` (`ligar o
  "Modo automático" não aprova o card, e o card diz isso`; sem o botão, a nota
  não sai)
- **Origem:** AT-443 (TP-01: o modo ligado num cartão pendente não o
  aprovava, e nada na tela dizia por quê)

### RN-766 — O gate parado esperando clique é dito, e a oferta em lote cobre os subagentes de QA {#rn-766}

- **Regra:** no painel "precisa de você" ([RN-467](#rn-467)), a ação pendente
  proposta por agente de GATE (área de QA — `qa`, `qa-*` — ou SecOps) ganha,
  acima do MESMO `ApprovalCard`, a frase de que aquele gate está PARADO até a
  decisão; é uma frase por card, nunca uma soma de filas. E a oferta em lote
  do modo automático na aba Executores ([RN-661](#rn-661)) lista os agentes da
  área de QA (`AREAS.qa`) desde a ativação, sem esperar que eles apareçam no
  roster — antes o `qa-automacao` só entrava na oferta depois do primeiro
  evento dele, quando a primeira ação já esperava clique. O `allow` padrão do
  `permissions.json` NÃO muda (decisão do dono).
- **Onde:** `apps/web/src/lib/precisa-de-voce.ts:256` (`gateEsperandoClique`)
  e `apps/web/src/components/ModoAutomaticoDoTime.tsx:67`
  (`agentesDaOfertaEmLote`)
- **Teste:** `apps/web/src/lib/precisa-de-voce.test.ts` (gate de QA e SecOps
  nomeados; dev agent e humano não) e
  `apps/web/src/components/ModoAutomaticoDoTime.test.tsx` (a oferta cobre os
  subagentes de QA antes do roster, sem repetir)
- **Origem:** AT-449 (TP-01 de 09/10: o `qa-automacao` propôs
  `ls; cat; for f in test/*.js…`, um segmento fora do `allow`, sem modo
  automático, e ficou 25 min pendente com só o contador de Aprovações como
  sinal)

### RN-768 — Na aba PRs, o texto ao lado do Merge diz a verdade do botão {#rn-768}

- **Regra:** gate pendente continua AVISO e não trava o merge
  ([RN-663](api.md#rn-663)). Tarefa BLOQUEADA (`task.blocked`) é outra coisa e
  desabilita o botão; nesse caso a linha da PR NÃO mostra "o merge segue
  disponível": diz, em texto, que o merge está indisponível porque a tarefa
  está bloqueada (nomeando o gate pendente, se houver, ou o motivo do
  bloqueio). Sem sessão no projeto, o mesmo: o motivo vai em texto, nunca só
  no `title` do botão `disabled`, que não abre no Chromium. Se tarefa
  bloqueada deve ou não travar o merge é pergunta do dono, não decidida aqui.
- **Onde:** `apps/web/src/routes/ProjectPrsTab.tsx:280` (`avisoDaLinha`)
- **Teste:** `apps/web/src/routes/ProjectPrsTab.test.tsx` ("AT-451: tarefa
  bloqueada com gate pendente NÃO diz que o merge segue disponível")
- **Origem:** AT-451 (TP-01 de 09/10: "O merge segue disponível — a decisão é
  sua" ao lado de um "Merge" desabilitado)

### RN-769 — Encerrar sessão com execução ativa pergunta antes, e o estado aparece traduzido {#rn-769}

- **Regra:** "Encerrar" numa sessão com execução ativa (evento
  `execution.activated` na janela, ou um `dev-<modulo>` entre os ativados da
  sessão inteira — o Dev Lead não conta, ele planeja antes da execução) abre
  uma confirmação que diz o que para: os agentes da sessão param na hora, o
  comando em andamento é cortado, o turno em curso não é gravado, e sessão com
  execução não reabre ([RN-650](api.md#rn-650)). Sem execução, o clique encerra
  direto, como antes. A frase de sessão encerrada no composer interpola o
  estado TRADUZIDO (`pontoDaSessao(...).rotuloKey`), nunca o enum cru
  (`closed`). E isso é guardado no CÓDIGO, não só no locale: a régua de
  vocabulário lê os JSON, e o enum entrava pela interpolação em runtime;
  `i18n-enum-cru.test.ts` reprova `t(…, { status: x.status })`.
- **Onde:** `apps/web/src/routes/ConfirmarEncerramento.tsx:13`
  (`useEncerrarComConfirmacao`) e `apps/web/src/routes/SessionComposer.tsx:614`
  (`statusGenerico`)
- **Teste:** `apps/web/src/routes/ConfirmarEncerramento.test.tsx` (sem
  execução encerra direto; com execução só encerra ao confirmar; cancelar não
  encerra) e `apps/web/src/lib/i18n-enum-cru.test.ts` (reprovava o
  `SessionComposer.tsx` antes da correção)
- **Origem:** AT-452 (TP-01 de 09/10: "Encerrar" fechou a sessão de execução
  em 3 s com o dev agent no meio de um `npm install`, e a barra disse "Sessão
  closed")

### RN-788 — Decisões e linha do tempo do time não afirmam sobre o que não leram {#rn-788}

- **Regra:** no painel "Contexto da sessão", "Decisões registradas" segue o
  mesmo recorte declarado das regras ([RN-701](#rn-701)): com eventos antes da
  janela, o contador diz "N na janela · há mais antes" e o vazio diz que pode
  haver decisões nos anteriores, nunca "Nenhuma decisão registrada nesta
  sessão". Na Visão geral, a "Linha do tempo do time" lê a sessão de EXECUÇÃO
  quando ela existe (a mesma da sidebar) e diz isso no subtítulo quando ela
  não é a mais recente. Nenhuma requisição a mais: as chaves são as que a
  sidebar já assina, e `useActiveExecutionSession` ganha `staleTime` igual ao
  intervalo, para o segundo assinante não refazer a busca ([RN-632](#rn-632)).
- **Onde:** `apps/web/src/routes/ContextAside.tsx:393` (`trailing`),
  `apps/web/src/routes/ProjectOverviewTab.tsx:97` (`linhaDoTempoNaExecucao`)
- **Teste:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (decisão fora da janela não vira 0; sessão inteira na janela diz vazio),
  `apps/web/src/routes/ProjectOverviewTab.test.tsx` (lê a sessão de execução e
  diz; sem execução, lê a mais recente), `apps/web/src/routes/duas-abas.orcamento.test.tsx`
  (a carga da Visão geral segue no teto)
- **Origem:** AT-463 (TP-01 de 09/10)

### RN-789 — Na tela de Sessão, a sidebar marca a aba onde a sessão está listada {#rn-789}

- **Regra:** a tela de Sessão publica a aba que o TIPO da sessão implica —
  criativa em "Criativo" (a lista de ideações), consultiva em "Chat" —, e a
  sidebar a marca em vez de sempre "Chat" ([RN-751](#rn-751)); o clique leva à
  lista onde a sessão aparece, que é o caminho de volta a ela. Sessão ainda
  carregando, ou aba publicada de outro projeto, cai em "Chat". Sem leitura
  nova: o tipo já veio com a sessão.
- **Onde:** `apps/web/src/routes/project-tabs.ts:383` (`abaDaRota`),
  `apps/web/src/lib/session-kind.ts:94` (`usePublicarAbaDaSessao`)
- **Teste:** `apps/web/src/lib/session-rolagem-fim.test.ts` (criativa marca
  "Criativo"; aba de outro projeto ou inválida não vale)
- **Origem:** AT-463 (TP-01 de 09/10)

### RN-794 — Sem execução vigente, a tela diz o que ficou pendente e religa pelo mesmo caminho {#rn-794}

- **Regra:** quando a leitura da sessão de execução vigente ([RN-139](api.md#rn-139))
  CONFIRMA que não há nenhuma e o backlog tem tarefa que não está `done`
  (`todo` — inclusive a devolvida pelo gate —, `in_progress`, `in_review`,
  bloqueada), a aba Executores e a seção Execução da Visão geral dizem
  quantas são e oferecem "Religar execução", que chama o MESMO
  `POST .../execution/activate` (`ActivateExecutionUseCase`) do botão
  "Ativar execução", sem `originSessionId` (como a Visão geral sempre
  chamou: não há sessão de chat para a api fechar, [RN-135](api.md#rn-135)). A
  recusa (409 sem repositório, sessão consultiva, papel) aparece com a frase
  da api. "Desbloquear" sem execução vigente avisa que a tarefa só roda
  quando a execução for religada — o botão está na mesma seção. Na aba
  Executores o backlog só é lido com a ausência confirmada (query desligada
  com execução de pé, ritmo de projeto quando ligada, [RN-632](#rn-632)).
- **Onde:** `apps/web/src/components/ReligarExecucao.tsx:23` (`ReligarExecucao`),
  `apps/web/src/lib/execution.ts:21` (`contarTarefasPendentes`),
  `apps/web/src/routes/ProjectExecutorsTab.tsx:99` (`semExecucaoVigente`),
  `apps/web/src/routes/ProjectOverviewTab.tsx:518` (`semExecucaoVigente`)
- **Teste:** `apps/web/src/routes/ProjectExecutorsTab.test.tsx` (religar a
  execução), `apps/web/src/routes/ProjectOverviewTab.test.tsx` (religar a
  execução encerrada)
- **Origem:** AT-469

### RN-800 — A linha do tempo do time filtra por família, não pela roster da sessão mais recente {#rn-800}

- **Regra:** a árvore "Linha do tempo do time" da Visão geral lê a sessão de
  EXECUÇÃO quando há uma vigente (AT-463), e tira dela os eventos de dev agent
  e de QA pela FAMÍLIA do ator (`isExecutorAgentId`, a mesma régua da aba
  Executores, RN-121) — nunca pela roster, que é derivada da sessão mais
  recente. Filtrar pela roster apagava todo agente que só agiu na execução (o
  Infra Lead cujo handoff foi aceito lá), e com uma ideação aberta depois a
  árvore dizia "Nenhum agente entrou em ação nesta sessão ainda" sobre um time
  trabalhando. Sem leitura nova.
- **Onde:** `apps/web/src/routes/ProjectOverviewTab.tsx:275` (`overviewEvents`)
- **Teste:** `apps/web/src/routes/ProjectOverviewTab.test.tsx` ("AT-471: agente
  que só agiu na execução aparece na árvore…"; o caso sem execução segue lendo
  a mais recente)
- **Origem:** AT-471 (TP-01 de 10/10)

### RN-801 — O nome da nova sessão não convida o gerenciador de senhas {#rn-801}

- **Regra:** o campo "Nome (opcional)" do formulário de nova sessão (aba
  Criativo e aba Chat) recebe o MESMO `SEM_AUTOFILL` do composer e do
  assistente ([RN-736](#rn-736)/[RN-740](#rn-740)): `autocomplete="off"`,
  `aria-autocomplete="none"` e os ignores de 1Password, LastPass, Bitwarden e
  Proton Pass. O composer da Sessão já o tinha. A constante NÃO tem atributo de
  ignore do NordPass, e nenhum foi inventado: se o NordPass segue se anexando,
  o resto da lacuna é da extensão, como na RN-740.
- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx:325` (`SEM_AUTOFILL`),
  `apps/web/src/lib/conversa-comecou.ts:29` (`SEM_AUTOFILL`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` ("AT-472: o nome
  da nova ideação não convida o gerenciador de senhas")
- **Origem:** AT-472 (TP-01 de 10/10)

### RN-803 — A oferta em lote do modo automático fica inerte até saber quem já está ligado {#rn-803}

- **Regra:** enquanto a leitura de `agent_autonomy` do projeto não chegou, o
  "Ligar para N agentes" da aba Executores ([RN-661](#rn-661)) e as caixas dos
  agentes ficam `disabled`, com o motivo em texto ("Lendo quais agentes já
  estão em modo automático…"); o clique nesse intervalo não grava nada. Antes,
  a lista nascia com TODOS os agentes como palpite e encolhia quando a leitura
  chegava, e o primeiro clique depois de navegar caía em outro elemento sem
  gravar nem dizer nada. O desfecho do lote (todos, nenhum com a frase da api,
  alguns) é dito mesmo que a releitura depois das gravações falhe. Declarado:
  o mesmo sintoma no "Merge" da aba PRs, em "Nova ideação" e no "Aplicar a
  todos os agentes" NÃO foi reproduzido nem corrigido aqui.
- **Onde:** `apps/web/src/components/ModoAutomaticoDoTime.tsx:102` (`carregando`)
- **Teste:** `apps/web/src/components/ModoAutomaticoDoTime.test.tsx` ("AT-477
  (RN-803): antes de a leitura de agent_autonomy chegar, o botão fica inerte e
  diz por quê")
- **Origem:** AT-477 (TP-01 de 10/10)

### RN-804 — O cartão do plano do Dev Lead oferece o modo automático em lote antes de aprovar {#rn-804}

- **Regra:** o `ApprovalCard` de `propose_execution_plan` pendente mostra,
  acima de "Aprovar", o MESMO controle de oferta em lote da aba Executores
  ([RN-661](#rn-661)): os `dev-<modulo>` que o plano sobe (mesma derivação de
  `devAgentId` da api) mais os subagentes de gate, todos marcados, e nada
  gravado sem o clique em "Ligar". Mesmo endpoint (`PUT .../agent-autonomy`,
  curinga `*`), um PUT por agente, desfecho por agente e a mesma lista do que o
  modo automático não libera. Aprovar ativa a execução ([RN-677](api.md#rn-677)) e o
  dev pede o primeiro comando logo depois; ligar depois não aprova o pendente
  ([RN-755](#rn-755)). Só aparece onde quem chama passou o callback do modo
  automático (papel `maintainer`) e há `QueryClient`. O cartão segue único
  (AT-322): é um bloco a mais do tipo, não variante de aparência.
- **Onde:** `apps/web/src/components/ApprovalCard.tsx:363`
  (`ModoAutomaticoDoPlano`), `apps/web/src/components/ModoAutomaticoDoPlano.tsx:17`
  (`agentesDoPlano`)
- **Teste:** `apps/web/src/components/ApprovalCard.modo-automatico-do-plano.test.tsx`
- **Origem:** AT-476 (TP-01 de 10/10)

### RN-815 — O "Parar execução" conta as tarefas em curso E em revisão, lidas do backlog {#rn-815}

- **Regra:** a confirmação de "Parar execução" ([RN-763](engine.md#rn-763)) conta as
  tarefas pelo BACKLOG, lido só com a confirmação aberta, e não pela janela de
  eventos: `in_progress` e `in_review` (gate de QA rodando) em frases
  separadas, cada uma dizendo o que acontece com ela ao parar — a em curso é
  bloqueada com o trabalho preservado; a em revisão tem o gate parado e é
  bloqueada com a PR aberta; as duas voltam à fila quando liberadas. Antes a
  contagem saía dos dev agents com task na janela, e a tarefa em revisão (sem
  dev trabalhando nela) fazia a tela afirmar "Nenhuma tarefa está em curso".
  Backlog carregando ou com erro é dito em texto próprio, nunca como "nenhuma".
  Junto, o cartão do plano do Dev Lead ([RN-804](#rn-804)) abre a oferta em
  lote com texto próprio ("Ao aprovar o plano, a execução começa"), porque ali
  a execução ainda não começou ([RN-677](api.md#rn-677)).
- **Onde:** `apps/web/src/lib/execution.ts:37` (`contarTarefasAfetadasAoParar`),
  `apps/web/src/components/PararExecucao.tsx:26` (`PararExecucao`),
  `apps/web/src/components/ModoAutomaticoDoTime.tsx:77` (`ModoAutomaticoDoTime`)
- **Teste:** `apps/web/src/components/PararExecucao.test.tsx` ("RN-815 (AT-488):
  a tarefa em revisão de QA conta…"; "RN-815: sem backlog lido não afirma…"),
  `apps/web/src/components/ModoAutomaticoDoTime.test.tsx` ("RN-816 (AT-488): no
  cartão do plano não afirma que a execução começou")
- **Origem:** AT-488 (TP-01 de 10/10)

### RN-816 — O botão não muda de lugar quando um bloco tardio chega {#rn-816}

- **Regra:** bloco que chega DEPOIS do primeiro paint não fica acima do botão
  que a pessoa vai clicar, e o que precisa ficar acima tem o espaço reservado
  enquanto carrega. Na Sessão as pendências de outras sessões
  ([RN-626](#rn-626)) moram ACIMA do fio — entre o fio e o composer elas o
  encolhiam por baixo e, com o "acompanha o fim" ([RN-751](#rn-751)), o card
  final ("Aceitar handoff e iniciar…") subia sob o cursor. Na aba Executores
  elas vêm DEPOIS de "Parar execução" e da oferta em lote. Na aba PRs o Merge
  vem primeiro na coluna da linha, e a esteira do gate, que depende do backlog,
  tem altura reservada (esqueleto) enquanto ele carrega. Declarado: a reserva
  da esteira é a altura de uma esteira de uma linha de etapas, não medida no
  navegador, e jsdom não faz layout — o teste prova a ORDEM e a reserva, não o
  deslocamento em pixels.
- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`PendenciasDeOutrasSessoes`
  antes de `styles.messages`), `apps/web/src/routes/ProjectExecutorsTab.tsx`,
  `apps/web/src/routes/ProjectPrsTab.tsx:103` (`ProjectPrsTab`),
  `apps/web/src/routes/ProjectPrsTab.module.css` (`.reservaDaEsteira`)
- **Teste:** `apps/web/src/routes/salto-de-layout.test.ts`,
  `apps/web/src/routes/ProjectPrsTab.test.tsx` ("RN-816 (AT-480): o Merge não
  muda de lugar quando o backlog chega")
- **Origem:** AT-480 (TP-01 de 10/10)

### RN-821 — Registrado rodando e observado parado oferece "Subir de novo" {#rn-821}

- **Regra:** na `/containers`, a linha com registro `running` e estado
  OBSERVADO `exited` deixa de ser "já está de pé" e oferece a ação de subida do
  modo (`acaoDeSubidaDoModo`), sem exigir Parar antes, com a ressalva
  `registrado_rodando_observado_parado` em texto. Só o observado destrava: sem
  observação, ou observado `running`, o registro continua valendo. A api já
  aceitava: `ExecuteContainerStartUseCase` com linha `running` não transiciona
  nada (a máquina de estados do ADR 0081 não muda) e o broker faz `docker
  start` no container parado.
- **Onde:** `apps/web/src/routes/containers-subida.ts:125` (`caiuPorFora`)
- **Teste:** `apps/web/src/routes/containers-subida.test.ts` ("AT-494:
  registrado running e observado exited oferece subir de novo, com a ressalva"
  e "AT-494: registrado running e observado running (ou não observado) continua
  já de pé")
- **Origem:** AT-494

### RN-822 — O primeiro clique em Merge abre o cartão sem esperar a fila {#rn-822}

- **Regra:** extensão da [RN-816](#rn-816). Na aba PRs, o clique em "Merge"
  que cria a `proposed_action` de `git_merge` mostra o cartão de decisão com a
  ação que a api DEVOLVEU, na hora, em vez de esperar a fila do projeto
  (`useProjectPendingActions`) voltar. Antes, entre a resposta da proposta e o
  refetch da fila, o botão voltava sem cartão nenhum e a pessoa lia "o clique
  não pegou". A ação local vale por id da PR só enquanto a fila não tiver
  leitura MAIS NOVA que a proposta (`dataUpdatedAt`); com leitura mais nova,
  quem diz se ela segue pendente é a fila. Decidir (aprovar, negar, sempre
  permitir) a esquece. Declarado: a causa foi medida no CÓDIGO (o cartão
  dependia do refetch), não no navegador; que o refetch demore o bastante para
  o clique parecer perdido é inferência do TP-01.
- **Onde:** `apps/web/src/routes/ProjectPrsTab.tsx:125` (`acaoDaPr`)
- **Teste:** `apps/web/src/routes/ProjectPrsTab.test.tsx` ("RN-822 (AT-493):
  o 1º clique em Merge abre o cartão sem esperar a fila do projeto voltar" e
  "RN-822: a fila lida DEPOIS da proposta, sem ela, vence o cartão local")
- **Origem:** AT-493 (TP-01 de 10/10)

### RN-824 — Depois do mapa de módulos, o composer diz que o próximo passo é confirmar a arquitetura {#rn-824}

- **Regra:** a oferta da Infra continua sendo um clique HUMANO ("Confirmar
  arquitetura pronta"); o que muda é que a tela AVISA. Com o Arquiteto ativo,
  sem turno em curso, sem o handoff dele já oferecido e com um
  `artifact.module_map` gravado na sessão, o composer mostra em texto visível
  que a arquitetura pode ser confirmada para o sistema oferecer a Infra. Sem
  história promovida, o mesmo lugar diz o motivo de o botão estar inerte, uma
  vez, em texto (o `title` de botão desabilitado não abre no Chromium,
  [RN-102](api.md#rn-102)); o botão habilitado ganha a explicação no `title`. A
  derivação lê os `events` que a tela já tem — nenhuma query nova
  ([RN-579](engine.md#rn-579)).
- **Onde:** `apps/web/src/lib/session-readiness.ts:149` (`temMapaDeModulos`),
  `apps/web/src/routes/SessionComposer.tsx:136` (`hasModuleMap`)
- **Teste:** `apps/web/src/routes/SessionPage.proximo-passo-arquitetura.test.tsx`
  ("mapa gravado + história promovida + Arquiteto parado: o texto aparece";
  falhas: "com o handoff do Arquiteto já oferecido, o texto some", "com turno
  em curso (streaming), o texto não aparece", "sem história promovida, o
  motivo vem em texto visível")
- **Origem:** AT-491 (opção a: o gesto humano é desenho, o defeito era a tela
  não avisar)

### RN-825 — O chat mostra as PRs prontas para merge e propõe o merge ali {#rn-825}

- **Regra:** acima do fio da sessão, ao lado das pendências de outras sessões
  ([RN-626](#rn-626)), a fila "PRs prontas para merge" lista as PRs ABERTAS do
  projeto cuja tarefa teve os gates aprovados (`gateStatus: awaiting_user`) ou
  que não têm tarefa (ADR, infra), e que não têm `git_merge` pendente de OUTRA
  sessão (essa já está em "Merges de PR"). "Mergear" PROPÕE o merge nesta
  sessão, pelo mesmo endpoint da aba PRs, e o cartão de aprovação aparece na
  linha da PR com a ação devolvida pela api ([RN-822](#rn-822)); o merge segue
  manual ([RN-418](api.md#rn-418)). Cada fila tem título e contagem próprios, nunca
  somados ([RN-467](#rn-467)), e as leituras são as que a aba PRs e o backlog
  já fazem (mesmas `queryKey`s, backlog a 15 s), sem poll novo apertado
  ([RN-579](engine.md#rn-579)).
- **Onde:** `apps/web/src/lib/prontas-e-bloqueadas.ts:30` (`prsProntasParaMerge`),
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:116` (`prontas`)
- **Teste:** `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`
  ("a PR com os gates aprovados aparece, a com gate pendente não, e Mergear
  mostra o cartão ali")
- **Origem:** AT-497 (TP-01 conduzido pelo chat do Criativo)

### RN-826 — O chat lista as tarefas bloqueadas e desbloqueia ali {#rn-826}

- **Regra:** na mesma área, a fila "Tarefas bloqueadas" lista as tarefas
  `blocked` do backlog com título e motivo (`blockedReason`, ou "sem motivo
  registrado"), e "Desbloquear" chama o mesmo `unblock` da Visão geral
  ([RN-794](#rn-794)) com a sessão aberta. O retorno é dito na linha da
  tarefa: sucesso em texto, e a recusa com a frase da api. Papel abaixo de
  `developer` vê a fila com o botão inerte e o motivo em texto.
- **Onde:** `apps/web/src/lib/prontas-e-bloqueadas.ts:53` (`tarefasBloqueadas`),
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:201` (`desbloquear`)
- **Teste:** `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`
  ("CASO DE FALHA: desbloquear com erro diz o erro da api na linha da tarefa")
- **Origem:** AT-497

### RN-829 — O avatar de quem fala no fio é o do agente, no streaming e depois dele {#rn-829}

- **Regra:** a bolha do agente em streaming e a bolha persistida da resposta
  (`agent.response`) desenham o MESMO avatar, `AvatarDoAgente`, pelo id do
  agente. Antes a bolha em curso mostrava o ícone do agente e a persistida o
  ícone de modelo, e o avatar trocava na cara da pessoa quando o turno fechava.
  O modelo que gerou a resposta continua só no chip ao lado do nome.
  Agente fora do roster (ou sem id) degrada para o ícone
  genérico, nunca para caixa vazia.
- **Onde:** `apps/web/src/components/ui/AvatarDoAgente.tsx:22` (`AvatarDoAgente`),
  `apps/web/src/routes/SessionFio.tsx:264` (`BolhaDoStreaming`),
  `apps/web/src/routes/session-timeline-montagem.tsx:151` (`montarTimeline`)
- **Teste:** `apps/web/src/routes/SessionFio.at503.test.tsx` ("a bolha
  persistida usa o avatar do agente, não o do modelo; o modelo segue no chip",
  "a bolha em streaming usa o MESMO avatar"; degradação: "sem agente
  identificado, degrada para o avatar genérico")
- **Origem:** AT-503 (TP-01 11ª, nota de UX do chat §2.1)

### RN-830 — O composer respeita a composição de acento, e o fio fala com o leitor de tela {#rn-830}

- **Regra:** Enter só envia quando não há composição em curso
  (`nativeEvent.isComposing`) — no meio de um acento por IME ou tecla morta,
  ele confirma o caractere. O contêiner do fio é `role="log"` (com nome), e a
  faixa de atividade do turno ([RN-460](#rn-460)) é `role="status"` com
  `aria-live="polite"`: o leitor de tela anuncia a resposta nova e o que o
  agente está fazendo sem interromper quem está lendo. A checagem mora no
  composer, não na página, que está no teto de linhas ([ADR 0176](../adr/0176-sessionpage-abaixo-de-mil-linhas.md)).
- **Onde:** `apps/web/src/routes/SessionComposer.tsx:97` (`ignorarComposicaoIme`),
  `apps/web/src/components/TurnActivityStrip.tsx:47` (`TurnActivityStrip`)
- **Teste:** `apps/web/src/routes/SessionFio.at503.test.tsx` ("Enter sem
  composição chega ao handler de envio", "a faixa do turno é uma região de
  status educada"; falha: "Enter no meio da composição de acento NÃO envia")
- **Origem:** AT-503 (nota de UX do chat §3)

### RN-831 — A mensagem que não foi enviada fica no fio, com "tentar de novo" {#rn-831}

- **Regra:** quando o envio da mensagem ao agente falha (exceto a recusa por
  sessão encerrada, que devolve o texto ao campo — AT-154), a bolha otimista
  não some: o texto fica no fio com o selo "não enviada" e o botão "Tentar de
  novo", que reenvia o MESMO texto ao MESMO destinatário pelo caminho de
  sempre. Há uma só por vez; um envio novo (ou o próprio reenvio) a substitui.
  O toast com o motivo continua.
- **Onde:** `apps/web/src/lib/mensagem-nao-enviada.ts:29`
  (`marcarMensagemNaoEnviada`), `apps/web/src/routes/SessionFio.tsx:56`
  (`SessionFio`)
- **Teste:** `apps/web/src/routes/SessionFio.at503.test.tsx` ("mostra o texto
  com \"não enviada\" e reenvia ao clicar em tentar de novo", "um envio novo
  (otimista acesa) substitui a não enviada");
  `apps/web/src/routes/SessionPage.turno-preso.test.tsx` (falha: "CASO DE
  FALHA: erro no envio desarma o turno e a mensagem fica \"não enviada\"
  (RN-831)")
- **Origem:** AT-503 (nota de UX do chat §3)

### RN-833 — Todo socket Phoenix do web se descarta, e o substituído não age {#rn-833}

- **Regra:** todo socket Phoenix do web nasce por `criarSocket` e morre por
  `descartar()`, que faz `disconnect()` e remove os três ouvintes que o
  construtor do `phoenix@1.8.9` registra em `window` (`pagehide`, `pageshow`,
  `visibilitychange`) — `disconnect()` sozinho os deixava, e o
  `visibilitychange` reabria o socket velho. No canal da sessão cada
  `conectar()` é uma GERAÇÃO: a anterior é descartada (leave, `descartar()` e
  o ping DELA) antes de a nova nascer, e todo callback de geração antiga é
  no-op — o `onClose` de um socket substituído não agenda reconexão, não
  limpa o ping do atual e não marca morto o canal vivo. O canal vivo
  ([RN-579](engine.md#rn-579)) é CONTAGEM de conexões por sessão, não booleano. A
  neutralização do auto-reconnect ([RN-108](#rn-108))
  continua obrigatória no tipo de `criarSocket`.
- **Onde:** `apps/web/src/lib/socket-phoenix.ts:31` (`criarSocket`),
  `apps/web/src/lib/session-channel.ts:92` (`descartarGeracao`),
  `apps/web/src/lib/session-channel.ts:136` (`ehAtual`),
  `apps/web/src/lib/canal-vivo.ts:70` (`marcarCanalDaSessao`)
- **Teste:** `apps/web/src/lib/socket-phoenix.test.ts` (Phoenix real: "50×
  criar + descartar deixa saldo líquido 0 nos três ouvintes de window";
  falha: "socket só desconectado (sem descartar) deixa os três ouvintes"),
  `apps/web/src/lib/session-channel.test.ts` ("gerações (AT-500, RN-833)"),
  `apps/web/src/lib/canal-vivo.test.ts`
- **Origem:** AT-500

### RN-834 — O nome do projeto no assistente não se chama "title" {#rn-834}

- **Regra:** o campo "Nome do projeto" do assistente de criação usa `id`/`name`
  `projeto-slug`, que não casam com nenhum token de dado de contato (`name`,
  `nome`, `title`, `first`, `last`, `company`, `contact`). O `project-title` da
  [RN-736](#rn-736) tirou o "name", mas "title" é pronome de tratamento
  (Sr./Sra.) no preenchimento de contato, e o NordPass seguiu abrindo a lista
  de contatos sobre o campo. O rótulo visível "Nome do projeto" (ligado por
  `htmlFor`) e o `SEM_AUTOFILL` da [RN-740](#rn-740) ficam. É HEURÍSTICA, não
  medida: o NordPass não documenta atributo de ignore, e nenhum foi
  acrescentado ao `SEM_AUTOFILL`; a prova é o TP-01.
- **Onde:** `apps/web/src/routes/NewProjectWizard.tsx:746` (`projeto-slug`)
- **Teste:** `apps/web/src/routes/NewProjectWizard.test.tsx` ("RN-834: id e
  name do nome do projeto não parecem dado de contato…")
- **Origem:** AT-501 (TP-01 de 10/10)

### RN-835 — O "Desbloquear" da Visão geral não se move e diz o que aconteceu {#rn-835}

- **Regra:** extensão da [RN-816](#rn-816) e da [RN-794](#rn-794). Na seção de
  execução da Visão geral, a lista de tarefas bloqueadas vem PRIMEIRO, antes do
  "Religar execução" (que depende da leitura da execução vigente) e do grid dos
  dev agents (que depende dos eventos) — blocos que chegavam depois do primeiro
  paint e empurravam o botão sob o cursor. O desbloqueio tem retorno POR
  TAREFA: em voo o botão fica inerte e diz "Desbloqueando…" (um clique, uma
  chamada), o sucesso diz "Tarefa desbloqueada" até o backlog relido tirar a
  linha, e a recusa mostra a frase da api na própria linha. Sem sessão lida, o
  botão fica inerte com o motivo em texto — antes o clique retornava calado.
  Declarado: o que fica ACIMA da seção (o time e a árvore de atividade) não tem
  altura reservada, e jsdom não faz layout — o teste prova a ORDEM, não o
  deslocamento em pixels; qual das duas causas (salto ou sessão não lida) fez o
  1º clique do TP-01 se perder não foi medido no navegador.
- **Onde:** `apps/web/src/routes/ProjectOverviewTab.tsx:498` (`desbloqueio`),
  `apps/web/src/routes/ProjectOverviewTab.tsx:630` (`blockedTasks`)
- **Teste:** `apps/web/src/routes/ProjectOverviewTab.test.tsx` ("RN-835
  (AT-502): o desbloqueio chama uma vez, fica em voo e diz quando terminou";
  falha: "RN-835: a recusa do desbloqueio mostra a frase da api na linha"),
  `apps/web/src/routes/salto-de-layout.test.ts` ("RN-835 (AT-502): Visão
  geral — as tarefas bloqueadas vêm antes…")
- **Origem:** AT-502 (TP-01 de 10/10)

### RN-836 — O fio oferece "ir ao fim" quando chega conteúdo para quem subiu {#rn-836}

- **Regra:** com a pessoa longe do fim do fio (a guarda dos 120px da
  [RN-173](#rn-173)) e o fio tendo ganho mensagem ou cartão de aprovação PENDENTE
  desde que ela saiu do fim, um botão flutuante no rodapé da área que rola
  oferece o salto ao fim, contando as mensagens novas ("3 mensagens novas",
  plural do i18next com `_zero`/`_one`/`_other`). Cartão de aprovação PENDENTE novo
  não soma ao número: REALÇA o botão e troca o rótulo por "Há uma aprovação
  esperando" (só o fio marca ação `pending`, comparada por CONJUNTO de ids ao sair do fim; ação já decidida não realça e a pendente decidida apaga o realce). O botão tem rótulo acessível próprio, some ao chegar ao fim e
  nunca aparece para quem está no fim — ali a rolagem automática da RN-173
  continua mandando, e o botão só observa.
- **Onde:** `estadoDoIrAoFim` (removido na RN-951, `apps/web/src/lib/session-rolagem.ts`),
  `useIrAoFimDoFio` (removido),
  `IrAoFimDoFio` (componente removido)
- **Teste:** `apps/web/src/routes/IrAoFimDoFio.test.tsx` ("caminho feliz: fora
  do fim e com mensagens novas, mostra o contador…", "aprovação nova realça o
  botão", "pendente decidida apaga o realce", "troca de uma pendente por outra realça"; falha: "no fim, conteúdo novo não mostra botão")
- **Origem:** AT-506 (Melhorias de UX do Chat, item 1.3)

### RN-837 — Markdown do fio: blocos novos e prefixo de stream sem marcador cru {#rn-837}

- **Regra:** o Markdown leve do chat (parser próprio, sem dependência) também
  reconhece régua (`---`, `***`, `___`; logo depois de texto de parágrafo
  continua texto), citação (linhas `>` seguidas, miolo reprocessado pelo
  mesmo parser), cabeçalho `####`, lista aninhada de UM nível (item recuado em
  2+ espaços vai para o item anterior; mais fundo achata) e checklist
  (`- [ ]`/`- [x]`, caixa só visual, desabilitada). No modo stream
  (`MarkdownMessage` com `emCurso`), o texto passa antes por
  `fecharMarcadoresAbertos`, que fecha fence, crase e `**` pendentes e tira um
  marcador solto na ponta — nenhum prefixo lança nem mostra marcador cru. O
  texto final nunca passa por ele. Continua sem `dangerouslySetInnerHTML`.
- **Onde:** `apps/web/src/lib/markdown.ts:122` (`HR_RE`),
  `apps/web/src/lib/markdown.ts:123` (`CITACAO_RE`),
  `apps/web/src/lib/markdown.ts:124` (`TAREFA_RE`),
  `apps/web/src/lib/markdown.ts:374` (`fecharMarcadoresAbertos`),
  `apps/web/src/components/ui/MarkdownMessage.tsx:336` (`MarkdownMessage`)
- **Teste:** `apps/web/src/lib/markdown.blocos-e-stream.test.ts` ("checklist
  marca cada item…"; falha: "`---` logo depois de texto continua texto"),
  `apps/web/src/components/ui/MarkdownMessage.stream.test.tsx` ("nenhum
  prefixo lança nem mostra marcador cru"; falha: "o texto final (sem
  emCurso) não é alterado")
- **Origem:** AT-507 (Melhorias de UX do Chat, 10/10, item 1.2-a)

### RN-841 — A fila "PRs prontas" se relê sem recarregar a página {#rn-841}

- **Regra:** extensão da [RN-825](#rn-825). A lista de PRs abertas continua
  sem poll próprio, e é relida em dois momentos: (1) quando a leitura do
  backlog que o chat já faz a 15 s traz alguma tarefa com `status` ou
  `gateStatus` diferente da leitura anterior (a PR do dev nasce na sessão de
  EXECUÇÃO, cujo canal o chat não ouve, e os gates aprovando aparecem ali); e
  (2) quando o canal desta sessão avisa `adr.pr_opened`, `infra.pr_opened`,
  `action.pr_open`, `action.git_merge` ou `action.failed`, pelo
  invalidador com janela de 2 s ([RN-579](engine.md#rn-579), [RN-632](#rn-632)). A
  primeira leitura e a leitura igual não releem nada: o custo é zero de poll
  novo. Fica de fora, declarado: PR de infra aberta noutra sessão sem mudar
  tarefa nem passar por este canal só aparece na próxima leitura disparada por
  outro motivo.
- **Onde:** `apps/web/src/lib/prontas-e-bloqueadas.ts:66` (`assinaturaDoBacklog`),
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:97` (`assinaturaAnterior`),
  `apps/web/src/lib/canal-vivo.ts:134` (`alvosDoEvento`)
- **Teste:** `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`
  ("RN-841: a tarefa que entra em awaiting_user relê as PRs…" e "CASO DE FALHA
  RN-841…"), `apps/web/src/lib/acoes-da-sessao.test.ts`
- **Origem:** AT-510

### RN-842 — O rótulo do nome do projeto não diz "Nome" {#rn-842}

- **Regra:** o rótulo visível do campo de nome do assistente de criação é
  "Projeto" (en: "Project"), não "Nome do projeto"/"Project name": com o
  `id`/`name` `projeto-slug` da [RN-834](#rn-834) o NordPass seguiu abrindo
  "Contact info" sobre o campo (TP-01, 12ª), e o texto do `<label>` é o sinal
  que sobrava. O rótulo segue visível e ligado por `htmlFor`, o campo segue
  fora de `<form>` e com o `SEM_AUTOFILL` da [RN-740](#rn-740). É HEURÍSTICA:
  a busca (central de ajuda do NordPass, loja da extensão, fóruns) não achou
  atributo de ignore documentado pelo NordPass (nada como `data-np-ignore`),
  então nenhum foi acrescentado ao `SEM_AUTOFILL`. Já tentados antes: tirar
  `autoFocus` (RN-736), `aria-autocomplete`/`data-protonpass-ignore` (RN-740),
  `id`/`name` sem token de contato (RN-834). A prova é o TP-01.
- **Onde:** `apps/web/src/routes/NewProjectWizard.tsx:749` (`projeto-slug`),
  `apps/web/src/locales/pt-BR/newProject.json` (`nameLabel`)
- **Teste:** `apps/web/src/routes/NewProjectWizard.test.tsx` ("RN-842: o
  rótulo visível do campo não traz \"nome\"…")
- **Origem:** AT-511 (TP-01 de 11/10)

### RN-843 — Um cartão de decisão por ação no chat {#rn-843}

- **Regra:** extensão da [RN-822](#rn-822). O `git_merge` PENDENTE que o bloco
  de pendências desenha na linha da PR ("PRs prontas para merge") é o ÚNICO
  `ApprovalCard` dele na tela: o bloco registra os ids que desenha num registro
  leve do cliente, e o fio da sessão, enquanto a ação estiver pendente e
  registrada, mostra só uma linha apontando para a fila. Decidida, o fio volta
  ao cartão (histórico); sem o bloco montado (outra tela, PR fora da fila), o
  fio mostra o cartão completo. O registro vale só enquanto o cartão está
  MONTADO: com o bloco recolhido (o `Disclosure` desmonta o conteúdo), o fio
  mostra o cartão. Nenhum endpoint nem teto muda.
- **Onde:** `apps/web/src/lib/acoes-no-bloco.ts:48` (`useAcaoEstaNoBloco`),
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:504` (`useRegistrarAcoesNoBloco`),
  `apps/web/src/components/CartaoOuReferenciaNoFio.tsx:11` (`CartaoOuReferenciaNoFio`),
  `apps/web/src/routes/session-timeline-montagem.tsx:1286` (`CartaoOuReferenciaNoFio`)
- **Teste:** `apps/web/src/components/CartaoOuReferenciaNoFio.test.tsx`,
  `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx` ("a PR com os
  gates aprovados aparece…")
- **Origem:** AT-512

### RN-855 — A Visão geral mostra como rodar o entregável, declarado e não verificado {#rn-855}

- **Regra:** a Visão geral ganha o cartão "Rodar na sua máquina", logo abaixo
  do de primeiros passos, com o que a Infra declarou na PR dela
  (`artifact.run_instructions`, RN-852): o comando num bloco de código com
  botão "Copiar", as URLs como links que abrem em aba nova
  (`target="_blank"`, `rel="noopener noreferrer"`) — só `http://localhost:<porta>`
  e `http://127.0.0.1:<porta>`; outra URL não vira link, mesmo a api já a
  recusando —, a lembrança de `cp .env.example .env` quando `envExample` e a
  nota "Declarado pela Infra na PR, não verificado na sua máquina" (RN-468:
  nunca verde, nunca "rodando"). Sem declaração (`null`) o cartão não
  aparece, como o de primeiros passos some quando não há o que dizer. A
  leitura é de configuração (`FRESCOR_DA_CONFIGURACAO_MS`, sem poll) e o
  aviso `infra.pr_opened` do canal da sessão a relê.
- **Onde:** `apps/web/src/components/RodarNaSuaMaquina.tsx:32` (`RodarNaSuaMaquina`), `:20` (`urlLocalSegura`),
  `:13` (`releSeInfraAbriuPr`),
  `apps/web/src/routes/ProjectOverviewTab.tsx:210` (`releSeInfraAbriuPr`),
  `apps/web/src/lib/api-client.ts:882` (`getRunInstructions`)
- **Teste:** `apps/web/src/components/RodarNaSuaMaquina.test.tsx` ("mostra
  comando, copiar, link local e a nota de não verificado"; "sem declaração
  (null) o cartão não aparece"; "só localhost/127.0.0.1 com porta vira link";
  "infra.pr_opened relê o cartão; outro evento não")
- **Origem:** AT-517 (ADR 0213)

### RN-861 — As perguntas em aberto são fila própria no chat, e o aviso de prontidão não bloqueia {#rn-861}

- **Regra:** o bloco de pendências do chat ganha a fila "Perguntas em
  aberto", com título e contagem PRÓPRIOS (o `total` da api, nunca somado às
  outras filas — RN-467) e recorte declarado quando a lista vem com teto
  (RN-180). Cada cartão diz a pergunta, o agente que perguntou, o que ela
  afeta, a sugestão com "Aceitar sugestão" e um campo curto com "Responder";
  a tarefa que o gate de QA estacionou pela pergunta (RN-860) aparece no
  próprio cartão como "esperando sua resposta". Só o autor da sessão de
  origem (`autorDaSessao`) tem os controles; os outros veem o cartão com o
  controle inerte e o motivo em texto (ADR 0064). A recusa mostra a frase da
  api; o sucesso relê a fila e a pergunta sai. A leitura NÃO polla: o canal
  relê a fila em `artifact.open_question`, `open_question.answered` e
  `pr.gate_changed` (alvo `perguntas`, janela de 2 s). Junto de "Estou pronto"
  e de "Confirmar arquitetura pronta", o composer avisa "N perguntas em
  aberto" com atalho até a fila, lendo a MESMA query — só avisa, os botões
  seguem habilitados (ADR 0214).
- **Onde:** `apps/web/src/components/PerguntasEmAberto.tsx:47`
  (`PerguntasEmAberto`), `:127` (`eAutor`), `:297`
  (`AvisoDePerguntasEmAberto`), `apps/web/src/lib/canal-vivo.ts:135`
  (`alvosDoEvento`)
- **Teste:** `apps/web/src/components/PerguntasEmAberto.test.tsx` ("fila
  própria com contagem própria; o autor responde e aceita a sugestão", "o
  aviso do composer diz N e não bloqueia nada; some sem perguntas"; falha: "a
  recusa 409 mostra a frase da api", "quem não é o autor da sessão vê o
  cartão com o controle inerte e o motivo em texto")
- **Origem:** AT-521

### RN-867 — O aviso do gate estacionado diz o motivo gravado, e a pergunta em aberto aponta o cartão dela {#rn-867}

- **Regra:** o `gate.rescue_parked` tem dois emissores: o resgate por tempo
  (`GateRescuer`, RN-722), que grava `idadeSegundos`, e o QA estacionado
  esperando a resposta a uma pergunta em aberto, que não o grava. O fio
  distingue os dois pela PRESENÇA de `idadeSegundos` (o `motivo` é texto
  pt-BR fixo e não é lido como chave): "parado mais de 2 h" só no resgate por
  tempo; no outro, o aviso diz que o gate espera a resposta e aponta o cartão
  "Perguntas em aberto" (RN-861). O botão "Retomar gate" (RN-724) segue nos
  dois.
- **Onde:** `apps/web/src/routes/RetomarGateEstacionado.tsx:18`
  (`cicloEstacionado`), `apps/web/src/routes/session-timeline-montagem.tsx`
  (`gateEstacionado.avisoPergunta`)
- **Teste:** `apps/web/src/routes/RetomarGateEstacionado.test.tsx` ("o
  resgate por tempo grava idadeSegundos e lê como tempo"; falha: "a pergunta
  em aberto não tem idadeSegundos e não fala em 2 h")
- **Origem:** AT-528

### RN-882 — O composer da Sessão não perde tecla na digitação rápida {#rn-882}

- **Regra:** o campo do composer é NÃO controlado (AT-539, revisão): `defaultValue`
  + `ref`, e o `onChange` só emite o valor ao `draft` da página (envio, fila e
  botões seguem lendo dele). Re-render da página nunca reescreve o DOM do campo;
  a prop só vira atribuição imperativa no nó (esvaziar depois do envio, o texto
  devolvido na falha, o exemplo do convite) quando difere do DOM E não é eco de
  um valor que o campo emitiu. Antes o `<textarea>` era controlado (primeiro pelo
  `draft`, depois por um estado local) e um commit com valor mais velho que o do
  DOM o reescrevia: 991 de 1 010 caracteres no TP-01 (AT-533) e 1 tecla a cada
  53 numa rajada de CDP (AT-539, causa não isolada; aceite no Chrome real).
  Enter, Shift+Enter e a composição de acento (RN-830) não mudam.
- **Onde:** `apps/web/src/components/CampoDoComposer.tsx:22` (`CampoDoComposer`);
  `apps/web/src/routes/SessionComposer.tsx`
- **Teste:** `apps/web/src/components/CampoDoComposer.test.tsx` ("digitação
  rápida com a página atrasada não perde tecla nenhuma"; falha/borda: "a
  escrita de fora (esvaziar depois do envio) é adotada pelo campo"; "um re-render
  da página nunca reescreve o que já está no DOM do campo"; "rajada de 300
  teclas com a página atrasada chega inteira")
- **Origem:** AT-533, AT-539

### RN-883 — A oferta em lote do modo automático também no chat da Sessão {#rn-883}

- **Regra:** com a sessão ativa e com execução (`sessaoTemExecucao`), o chat
  mostra a MESMA oferta em lote da aba Executores (RN-661) — o mesmo
  componente, o mesmo endpoint (um PUT por agente), o mesmo texto do que o
  modo automático não libera, e nada é gravado sem o clique. Os agentes são os
  `dev-<modulo>` que entraram na sessão inteira mais os subagentes de gate
  (`agentesDaOfertaEmLote`); papel `maintainer` (o do endpoint). Sem execução,
  nada aparece e `agent_autonomy` nem é lido. Some quando todos já estão em
  automático.
- **Onde:** `apps/web/src/components/ModoAutomaticoNoChat.tsx:41`
  (`ModoAutomaticoNoChat`), `:18` (`agentesDoChat`)
- **Teste:** `apps/web/src/components/ModoAutomaticoNoChat.test.tsx` ("caminho
  feliz: com execução, a oferta aparece e só o clique grava"; falha: "sem
  execução, nada aparece e nem a leitura acontece")
- **Origem:** AT-537

### RN-884 — A pergunta respondida oferece "Corrigir a história" {#rn-884}

- **Regra:** a pergunta respondida pelo painel "Perguntas em aberto" do chat
  (RN-861) fica como cartão respondido até ser dispensada, e cada história de
  `afeta.historias` que o backlog traz ganha "Corrigir a história" quando ainda
  é corrigível pela régua da RN-727 (`draft`, sem tarefa
  `in_progress`/`in_review`, papel `developer`) — o link leva à aba Histórias
  com ela aberta (`?historia=`). Não aciona o PO (decisão do dono, 14/10). Não
  corrigível: o link não existe e o motivo é dito em texto (RN-102). A régua é
  a MESMA função da aba Histórias, movida para `lib/`.
- **Onde:** `apps/web/src/components/PerguntasEmAberto.tsx:232`
  (`CartaoRespondido`); `apps/web/src/lib/correcao-de-historia.ts`
  (`motivoDeCorrecaoInerte`); `apps/web/src/routes/ProjectBacklogTab.tsx:402`
  (`useHistoriaInicial`)
- **Teste:** `apps/web/src/components/PerguntasRespondidas.test.tsx` ("caminho
  feliz: história draft sem tarefa em execução ganha o link para a aba
  Histórias"; falha: "com tarefa em execução o botão não existe e o motivo é
  dito em texto")
- **Origem:** AT-538

### RN-887 — O bloqueio da tarefa é ortogonal ao status, e quem mostra lê os dois {#rn-887}

- **Regra:** tarefa bloqueada continua `todo`/`in_progress` com
  `tasks.blocked = true` (e `blocked_reason`/`blocked_origin`) — não há status
  `blocked` no enum, por decisão do dono (14/10). Quem CONTA ou MOSTRA tarefa
  lê os dois campos, e `blocked` vence `status`: a aba Histórias mostra o selo
  "Bloqueada" (tom de perigo) com o motivo em texto, e os demais pelo status
  (a fazer, em curso, em revisão, concluída); a lista de tarefas do backlog que
  o Dev Lead lê marca a linha com `| BLOQUEADA: <motivo, até 120 caracteres>`,
  e a tarefa segue na lista. Claim, desbloqueio e retomada não mudam.
- **Onde:** `apps/web/src/lib/execution.ts:10` (`estadoDaTarefa`);
  `apps/web/src/routes/ProjectBacklogTab.tsx` (o selo da lista de tarefas);
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:410` (`bloqueio`)
- **Teste:** `apps/web/src/lib/execution.test.ts` ("blocked vence o status";
  falha: "sem bloqueio, o status"); `apps/web/src/routes/ProjectBacklogTab.test.tsx`
  ("a bloqueada mostra \"Bloqueada\" e o motivo, sem o selo \"a fazer\"");
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs` ("a tarefa
  bloqueada diz BLOQUEADA e o motivo; a todo normal não")
- **Origem:** AT-536

### RN-889 — A oferta em lote do modo automático aparece no chat de qualquer sessão ativa do projeto em execução {#rn-889}

- **Regra:** estende a RN-883. Aprovar o plano do Dev Lead cria a sessão de
  EXECUÇÃO, separada da do Criativo, e é no chat do Criativo que o usuário
  conduz. A oferta em lote (RN-661) aparece no chat de toda sessão ATIVA
  quando o PROJETO tem execução — `roster.executionActivated` do resumo de
  projetos (a sessão mais recente, a de execução), a MESMA leitura e `queryKey`
  que o chat já fazia (`useAtivosNoProjeto`, RN-633), sem query nova nem poll
  novo. Os dev agents de lá (`roster.activatedAgents`) somam aos desta sessão.
  Mesmo componente, mesmo endpoint, mesmo texto, nada gravado sem o clique,
  espera saber quem já está ligado (RN-803) e some com o time todo em
  automático. Sem execução no projeto, nada aparece e `agent_autonomy` nem é
  lido. Lacuna declarada: o sinal é `roster.executionActivated` da sessão mais
  recente, que diz que ela TEVE `execution.activated`, não que segue aberta;
  com a sessão de execução já encerrada, a oferta ainda aparece no chat do
  Criativo — declarado, não corrigido, porque distinguir exigiria uma leitura
  nova (o orçamento de requisições).
- **Onde:** `apps/web/src/components/ModoAutomaticoNoChat.tsx:29`
  (`ofertaDoChat`); `apps/web/src/lib/session-destinatario.ts:174`
  (`useExecucaoNoProjeto`)
- **Teste:** `apps/web/src/components/ModoAutomaticoNoChat.test.tsx` ("caminho
  feliz: execução ativa noutra sessão do projeto, time em manual — a oferta
  aparece no chat do Criativo"; falhas: "time todo já em automático: nada
  aparece", "sem execução no projeto: nada aparece e nem a leitura acontece")
- **Origem:** AT-540

### RN-901 — A oferta de modo automático do chat inclui os dev agents do plano aprovado {#rn-901}

- **Regra:** estende a RN-889. `roster.activatedAgents` do resumo de projetos
  NUNCA traz dev agent: o dev não grava `agent.activated`, só `dev.started`. A
  oferta em lote do chat (RN-883/889) lia só essa lista e não listava o
  `dev-<modulo>` da execução ativa, que o usuário precisava ligar pela aba
  Executores. A execução do projeto (`execucaoDoRoster`) passa a somar, só com
  `roster.executionActivated`, os `dev-<modulo>` dos `roster.moduleNames` (o
  `module_map` vigente), pela MESMA `devAgentId` que a aba Executores usa
  (RN-661, `rosterFromFacts`), sem derivação nova. Sem execução ativa, nenhum
  dev entra. Lacuna declarada: a lista sai do `module_map` VIGENTE; se o plano
  aprovado usou um subconjunto dos módulos, a oferta herda essa divergência.
  Nenhum teto se move e nada é gravado sem o clique.
- **Onde:** `apps/web/src/lib/session-destinatario.ts:194` (`execucaoDoRoster`),
  chamado por `useExecucaoNoProjeto` (`apps/web/src/lib/session-destinatario.ts:175`)
- **Teste:** `apps/web/src/lib/session-destinatario.test.ts` ("CAMINHO FELIZ:
  execução ativa soma o dev-<modulo> do module_map aos ativados"; falha: "sem
  execução ativa, o módulo do plano NÃO vira dev agent"), e
  `apps/web/src/components/ModoAutomaticoNoChat.test.tsx` (fixture derivada do
  roster real, "caminho feliz")
- **Origem:** AT-573 (TP-01 18ª, 19/10: a 1ª tarefa parou em `dev.awaiting_approval`
  porque o dev não estava no modo automático)

### RN-911 — Provider é global; Configurações do projeto só escolhem modelo; a matriz mora na Conta {#rn-911}

- **Regra:** credencial de LLM, catálogo de modelos (curadoria, preços, sync e o navegador do Hugging Face) e o relatório de gasto por chave saíram das Configurações do projeto. Moram em `/providers` (as três peças) e o gasto por chave também na aba Gastos, só para `owner` (RN-060). O projeto guarda só a ESCOLHA: modelo por agente e por área, o "aplicar a todos" (RN-476), o critério de roteamento e "melhores modelos". A matriz "Quem pode aprovar o quê" saiu das Configurações e é uma seção da Conta (`/account`), para qualquer pessoa logada. O atalho "Ativar e aplicar aos N agentes" (RN-694 item 3) deixou de existir. Link antigo `?section=credentials`, `model-catalog`, `key-spend` ou `approval-matrix` abre a aba no topo, sem erro. O vazio de "Modelos por agente", o subtítulo de "melhores modelos" e os Primeiros passos (RN-708) apontam para `/providers`. Revisa a RN-694 (item 3) e a RN-708 (destinos). Sem ADR: é fronteira de tela.
- **Onde:** `apps/web/src/routes/settings/sumario.ts:48` (`SECOES_DE_CONFIGURACOES`), `apps/web/src/routes/ProjectSettingsTab.tsx:62` (`ProjectSettingsTab`), `apps/web/src/routes/AccountPage.tsx:36` (`AccountPage`)
- **Teste:** `apps/web/src/routes/settings/sumario.test.ts` (as quatro chaves não existem); `apps/web/src/routes/settings/SumarioDeConfiguracoes.test.tsx` (a aba não monta as quatro seções, nem para `owner`); `apps/web/src/routes/AccountPage.test.tsx` (a matriz, e o caso de falha no idioma); `apps/web/src/routes/configuracoes.orcamento.test.tsx` (a volta à aba não busca credencial); `apps/web/src/components/catalogo-com-busca.test.tsx` (sem atalho)
- **Origem:** AT-597 e AT-598 (EP-031), pedidos do dono de 22/10.

### RN-912 — O modelo da área é uma caixa na linha do lead, em "Modelos por agente" {#rn-912}

- **Regra:** a seção "Modelo por área" deixou de existir. O padrão da área (RN-102, escopo `area` da RN-470) liga-se por uma caixa **só na linha do lead** de cada área (`dev-lead`, `qa`, `infra`): "Valer para a área X inteira (lead + subagentes)". O binding de área é um valor por área e não guarda o agente de origem, então a caixa em toda linha deixaria duas disputarem o valor. Marcada ⇔ o vigente do lead vem da área (`origin: 'area'`), lido do lote da RN-654, sem consulta nova. **Marcar** grava a área com o vigente do lead e o critério de roteamento dele (`PUT .../area-bindings/:area`) e DEPOIS apaga o binding próprio do lead (`DELETE .../agent-bindings/:lead`; copiar o deixaria para trás, RN-102). São duas chamadas e o desfecho é por passo (RN-469): se a área recusa (inclusive o 422 da RN-040) nada mudou e o toast traz a frase da api; se a área gravou e o DELETE falha, a tela diz que o padrão da área foi gravado e o modelo próprio do lead não foi removido (404 do DELETE conta como já removido). **Desmarcar** apaga a área (`DELETE .../area-bindings/:area`) e não grava nada no lead; 404 vira "já herdava". Com a caixa marcada, o seletor e o critério de roteamento do lead gravam a ÁREA. O agente com binding próprio vence a área (RN-470) e NÃO segue: a tela lista, com plural, os subagentes conhecidos nessa situação (recorte declarado, RN-180; os `dev-<modulo>` dinâmicos não entram e a tela diz isso) e não apaga a decisão deles. O "aplicar a todos" (RN-476) grava binding próprio nos 17 e, por isso, tira os subagentes do padrão da área; o aviso dele diz isso. **Papel:** a caixa e, enquanto marcada, o seletor do lead pedem `maintainer` (o mínimo do endpoint de área, RN-102), comparado por `roleAtLeast`; abaixo disso ficam inertes e o motivo é dito UMA vez em texto na legenda da seção (ADR 0064). As demais linhas seguem em `developer`. A caixa nasce desabilitada se o lead não tem vigente para copiar, e diz o motivo em texto na própria caixa (AT-601, chave `modelsSection.areaBox.needsModel`). Revisa a UI das RN-040, RN-102 e RN-470; a cascata, o escopo e os endpoints não mudam (sem ADR).
- **Onde:** `apps/web/src/routes/settings/ModelsSection.tsx:98` (`podeEditarArea`), `:432` (`areaDoLead`), `:450` (`handleMarcarArea`), `:490` (`handleDesmarcarArea`)
- **Teste:** `apps/web/src/routes/settings/ModelsSection.caixa-da-area.test.tsx` (AT-601: motivo sem vigente no lead); `apps/web/src/routes/ProjectSettingsTab.test.tsx` (marcar, a área recusando, FALHA PARCIAL, desmarcar com e sem 404, seletor do lead na área, não-seguidores, `developer` inerte); `apps/web/src/routes/settings/papel-na-tabela-de-agentes.test.tsx` (os dois mínimos); `bindings-em-lote.test.tsx` (lote único); `cascata.test.tsx`; `heranca.test.tsx`; `filtro-de-aptos.test.tsx` (RN-040); `preferencia-de-roteamento.test.tsx` (ADR 0166)
- **Origem:** AT-600 (EP-031), pedido do dono de 22/10.

### RN-925 — Cada container tem página de detalhe com o estado registrado e o observado separados e as URLs declaradas {#rn-925}

- **Regra:** `/containers/$projectId` (carregada sob demanda) abre a partir de cada linha de `/containers`. Só lê o que já existe: a linha da visão geral (a [RN-486](api.md#rn-486): registrado e observado nunca se fundem; projeto "nunca provisionado" tem texto próprio, a imagem/versão, os recursos, a postura de rede da decisão vigente e o modo de execução) e as URLs de `GET projects/:projectId/run-instructions`, que a tela diz serem declaradas pela Infra e não verificadas, nunca verdes ([RN-855](#rn-855)); sem declaração, texto próprio. A leitura da página polla no ritmo de projeto (15 s, [RN-632](#rn-632)), nunca nos 5 s da lista. Subir, parar e remover são o MESMO componente da lista (`AcoesDoContainer`), com as mesmas recusas locais em texto ([RN-521](api.md#rn-521), [RN-574](api.md#rn-574), [RN-610](engine.md#rn-610)) e o papel do endpoint por `roleAtLeast`.
- **Onde:** `apps/web/src/routes/ContainerDetalhePage.tsx:20` (`ContainerDetalhePage`), `apps/web/src/components/AcoesDoContainer.tsx:40` (`AcoesDoContainer`)
- **Teste:** `apps/web/src/routes/ContainerDetalhePage.test.tsx:92` (caminho feliz com ritmo de 15 s, nunca provisionado com URLs vazias, projeto fora da lista); `apps/web/src/routes/ContainersPage.test.tsx` cobre as ações extraídas
- **Origem:** AT-609 (EP-030), fatia da AT-608.

### RN-931 — As telas de providers e do catálogo mostram só o que tem chave do TITULAR, com a cor do provider {#rn-931}

- **Regra:** "ativo" é o provider LOCAL ou o que tem chave do titular do workspace (RN-058), lida da rota da [RN-926](api.md#rn-926). A tabela "O que cada provider sabe fazer" lista só os ativos, com o nome humano e a mesma cor do card de credencial (`COR_DO_PROVIDER`, fonte única) e uma linha dizendo quantos ficaram de fora e quais. O catálogo de modelos vira um painel com UMA ABA por provider ativo (o hub continua repartido por fabricante); busca, facetas e a barra de lote são globais e a seleção sobrevive à troca de aba. Provider SEM chave que ainda tem modelo ATIVO aparece como aba marcada "sem chave do titular", para dar para desativar o modelo (RN-043); os demais sem chave entram na linha "de fora" (RN-180). Carregando ou falhando a rota, mostra TODOS: "não sei" não é "não tem". Revisa o item 1 da [RN-694](#rn-694): o catálogo não tem mais os grupos Local, APIs diretas e Hubs, e a busca que não casa na aba nomeia as abas que casam. O relatório do sync segue com todos os providers.
- **Onde:** `apps/web/src/lib/models.ts:363` (`providerAtivo`), `apps/web/src/lib/models.ts:371` (`catalogoDoProvider`), `apps/web/src/components/ModelCatalogSection.tsx:132` (`useMemo`), `apps/web/src/routes/ProvidersPage.tsx:33` (`deFora`)
- **Teste:** `apps/web/src/routes/ProvidersPage.test.tsx:102` (só os com chave do titular, e a falha que mostra todos), `apps/web/src/components/ModelCatalogSection.test.tsx:399` (aba "sem chave" com modelo ativo; seleção entre abas; busca nomeia a aba que casa), `apps/web/src/lib/models.test.ts:126` (`providerAtivo`)
- **Origem:** AT-607 (EP-026), tela; a rota é a RN-926.

### RN-939 — A página do container edita a rede só para `maintainer`, valida antes e recria por `container_recreate` {#rn-939}

- **Regra:** a seção "Rede" da página de detalhe lê `GET projects/:projectId/container/network` (sem poll, `staleTime` de configuração; `null` tem texto próprio) e salva num PUT só, por botão. O controle fica inerte abaixo de `maintainer` (papel efetivo, `roleAtLeast`) com o motivo dito uma vez em texto. O cliente espelha a régua da api (RN-932) só para poupar a ida e volta; a recusa `400 rede_invalida` aparece com o campo e a mensagem da api e `409 sem_sessao` tem texto próprio. A tela diz que a porta é publicada só em `127.0.0.1` e que a configuração só vale com o container recriado. "Aplicar e subir de novo" PROPÕE `container_recreate` (RN-934: teto absoluto, sempre pede aprovação humana) e fica inerte em `runner` ("runner depois"), sem container registrado, sem sessão e com rede editada e não salva. As portas publicadas que o daemon observa (`portasPublicadas`) saem como `http://127.0.0.1:<porta>` com a ressalva de que nada garante que algo escute (RN-468): sem sonda e nunca verde.
- **Onde:** `apps/web/src/components/RedeDoContainer.tsx:25` (`RedeDoContainer`), `apps/web/src/lib/rede-do-container.ts:30` (`validarRedeEmTexto`).
- **Teste:** `apps/web/src/components/RedeDoContainer.test.tsx` (rede nula, salvar, recusa no cliente, 400 com campo, 409, papel, `container_recreate`, `runner`, portas observadas).
- **Origem:** AT-608 (EP-030), ADR 0228.

### RN-943 — O bloco de pendências do chat se chama "Pendências deste projeto"; só a aba Executores diz "de outras sessões" {#rn-943}

- **Regra:** refina a RN-626, a RN-825, a RN-826 e a RN-861. Dentro do bloco do chat moram cinco filas, e só aprovações e merges são filtradas por "outra sessão"; perguntas em aberto, PRs prontas e tarefas bloqueadas são do projeto inteiro (a pergunta da PRÓPRIA sessão aparece ali de propósito, porque o aviso do composer lê a mesma query). Por isso, com `filasDoChat` (o chat) o título é "Pendências deste projeto" (`pendencias.tituloDoProjeto`, nos quatro locales); com `filasDoChat={false}` (aba Executores, só aprovações e merges) o título segue "Pendências de outras sessões deste projeto". Nenhuma fila é filtrada, nenhum teto muda e o `data-testid` não muda.
- **Onde:** `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:338` (`tituloDoProjeto`).
- **Teste:** `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx` (pergunta da própria sessão: cabeçalho "Pendências deste projeto", sem "outras sessões"; `filasDoChat={false}` mantém o título antigo).
- **Origem:** AT-619 (EP-031).

### RN-951 — O fio da Sessão acompanha SEMPRE a última mensagem {#rn-951}

- **Regra:** revê a [RN-173](#rn-173), o item 4 da [RN-751](#rn-751) e a [RN-836](#rn-836) (decisão do dono de 31/10). Cada evento ou ação nova no fio o leva à última mensagem, mesmo que a pessoa tenha rolado para cima: a guarda dos 120 px e a "intenção de estar no fim" saíram, e o botão "↓ N novas" (com o realce de aprovação) foi aposentado. O acompanhamento dispara por IDENTIDADE (`seq` do último evento e ids das ações, não pelo tamanho das listas, que não muda no teto de 200), pelo texto do streaming e por `ResizeObserver` no CONTEÚDO e no CONTAINER (faixa de atividade, composer e pendências mudam a altura). `?highlightEvent` segue levando ao evento citado na abertura, mas não desliga o acompanhamento: a primeira mudança depois o devolve ao fim. A rolagem é instantânea (`block: 'end'`) e o foco não se move. Entre duas mensagens a pessoa pode rolar e ler; a próxima a traz de volta.
- **Onde:** `apps/web/src/lib/session-rolagem.ts:20` (`identidadeDoFio`), `apps/web/src/lib/session-rolagem.ts:36` (`useRolagemDoFio`).
- **Teste:** `apps/web/src/lib/session-rolagem.test.tsx` (mensagem nova com a pessoa acima, `length` igual com `seq` novo, ação nova, container que encolhe, `highlightEvent`, rajada, streaming, sem conteúdo).
- **Origem:** AT-635 (EP-031).

### RN-963 — O gasto tem página GLOBAL e aba do PROJETO, e o orçamento tem editor {#rn-963}

Revisa a [RN-212](#rn-212) no destino do botão "Definir orçamento" e convive com a [RN-060](api.md#rn-060), a [RN-952](api.md#rn-952), a [RN-953](api.md#rn-953) e a [RN-954](api.md#rn-954).

1. **Página global.** `/spend`, no menu global ao lado de Containers e Providers, serve todo papel: o `owner` vê o workspace inteiro (janela 30/90/180, por modelo, provider, projeto e ator), os orçamentos de todos os projetos e a fatura por chave (`CredentialSpendSection`, que saiu de Providers); quem não é `owner` vê só o PRÓPRIO consumo por projeto (`spend/me` do workspace) e nunca provider nem credencial.
2. **Aba do projeto.** A aba Gastos é SÓ do projeto: o `owner` lê `spend-report?projectId=` (com a quebra por sessão), o membro lê o total e o custo por agente e por área (`spend/team`) e, abaixo, o próprio consumo. O consumo do Criativo (`CriativoKpis`) passou a mostrar o total do projeto.
3. **Orçamento.** A aba traz o editor do teto (`PUT projects/:projectId/budget`, `maintainer` pela `roleAtLeast`); abaixo do papel o controle fica inerte e o motivo é dito em texto. O botão "Definir orçamento" do card do projeto abre `?tab=spend` (antes `?tab=settings`, onde nenhuma tela gravava o orçamento).
4. **Assinatura.** `assinaturaMicros` aparece num destaque separado; linha de modelo marcado `subscription` com custo zero mostra "assinatura — sem preço registrado", nunca "US$ 0".

- **Código:** `apps/web/src/components/SpendPaineis.tsx:153` (`GastoDoWorkspace`); `apps/web/src/components/SpendPaineis.tsx:354` (`GastoDoTimeNoProjeto`); `apps/web/src/routes/ProjectSpendTab.tsx:172` (`EditorDoOrcamento`); `apps/web/src/routes/Dashboard.tsx:98` (`onDefineBudget`)
- **Teste:** `apps/web/src/routes/SpendPage.test.tsx` (owner × não-owner, sem provider para quem não é owner); `apps/web/src/routes/ProjectSpendTab.test.tsx` (owner só do projeto, membro por agente e área, editor grava, teto inválido e papel baixo recusados)
- **Origem:** AT-632

### RN-967 — A faixa do turno mostra o plano que o agente registrou no turno em curso {#rn-967}

- **Regra:** a faixa de atividade do turno (RN-460) mostra, acima dos passos, o último `agent.plan` do agente do turno com `seq` posterior à abertura dele (o último `agent.status: working`), derivado dos eventos JÁ carregados: nenhuma requisição nova (RN-632) e nenhum estado por token (RN-639). Ferramentas e plano seguem os padrões Tool e Plan; a fila de uma mensagem segue o Queue, com o cancelar inerte enquanto cancela (RN-673, não otimista).
- **Onde:** `apps/web/src/lib/plano-do-turno.ts:9` (`planoDoTurno`), `apps/web/src/components/TurnActivityStrip.tsx:47` (`TurnActivityStrip`).
- **Teste:** `apps/web/src/lib/plano-do-turno.test.ts`, `apps/web/src/components/ai-elements/passos.test.tsx`.
- **Origem:** AT-652 (EP-031).

### RN-968 — O formulário de perguntas estruturadas é um questionário passo a passo {#rn-968}

- **Regra:** o formulário aberto de `chat.structured_question` (RN-162) é o Questionnaire do shadcn: uma pergunta por vez, com "Pergunta N de T", Anterior/Próxima e "Enviar respostas" no último passo (desabilitado até TODAS estarem respondidas, a régua da api). A lista (`select`) vira escolhas (radio) e a saída por texto livre (RN-171) é um campo AO LADO delas, sem sentinela: escrever no campo é a resposta e escolher uma opção descarta o texto; `allowOther: false` não tem o campo. `textarea` usa o `QuestionnaireInput` com `render` de textarea. O estado segue controlado pelo card, então o que viaja para a api é o mesmo `Record<id, texto>` (RN-712), a ordem do envio é a de sempre (RN-174, RN-578) e as respostas ficam na tela no 409 `sessao_encerrada` (RN-581). Enter que confirma o IME não avança nem envia (RN-830). O cartão `respondida` e o painel de pendências (`artifact.open_question`) não mudam. Revisa a apresentação da RN-162/RN-171, não a regra.
- **Onde:** `apps/web/src/routes/StructuredQuestionCard.tsx:73` (`StructuredQuestionCard`), `apps/web/src/components/shadcn/questionnaire.tsx:8` (`Questionnaire`).
- **Teste:** `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`, `apps/web/src/components/shadcn/registro.test.tsx`.
- **Origem:** AT-653 (EP-031).

### RN-970 — Na árvore do time, cada delegação de um lead aparece como subagente {#rn-970}

- **Regra:** na árvore do time (Visão geral/Executores), cada delegação gravada por um lead (`delegation.*`) aparece no ramo dele como subagente — nome, desfecho (efetivada/falhou/dispensada, falha com a origem) e se o subagente está trabalhando agora —, derivada dos eventos já carregados, sem requisição nova; delegação fora da janela não aparece. O ramo próprio do subagente continua.
- **Onde:** `apps/web/src/lib/timeline-tree.ts:287` (`subagenteDoMarco`), `apps/web/src/components/AgentTimelineTree.tsx:51` (`AgentTimelineTree`).
- **Teste:** `apps/web/src/lib/timeline-tree.test.ts`, `apps/web/src/components/ai-elements/passos.test.tsx`.
- **Origem:** AT-655 (EP-031).

### RN-971 — A paleta de comandos Ctrl+K/⌘K busca projetos, sessões e ações só do que já está em memória {#rn-971}

- **Regra:** Ctrl+K (⌘K no macOS) abre a paleta de qualquer tela autenticada, menos com o foco no terminal xterm, durante composição de IME (RN-830) ou com o evento já tratado. Ela lista projetos, abas do projeto aberto, a sessão mais recente de cada projeto, as sessões do projeto aberto que já estão no cache e as ações da sidebar (novo projeto, tema, gastos, containers, providers, conta, sair), lendo SÓ o que o Shell já tem e o cache do TanStack Query: abrir, filtrar e fechar a paleta não faz requisição (RN-632). O grupo de sessões diz que é recorte (RN-180). Sem dependência nova: `Autocomplete` do Base UI dentro do `Dialog`, carregada por `React.lazy`.
- **Onde:** `apps/web/src/lib/paleta-de-comandos.ts:33` (`itensDaPaleta`), `apps/web/src/lib/paleta-de-comandos.ts:70` (`deveAbrirPaleta`), `apps/web/src/components/PaletaDeComandos.tsx:38` (`PaletaDeComandos`).
- **Teste:** `apps/web/src/lib/paleta-de-comandos.test.ts`, `apps/web/src/components/PaletaDeComandos.test.tsx` (zero `fetch`).
- **Origem:** AT-656 (EP-031).

### RN-972 — O código no chat e na aba Código é realçado pelo shiki {#rn-972}

- **Regra:** o bloco de código do chat (`CodeFence`, agora o Code Block do shadcn com botão Copiar) e o arquivo da aba Código são realçados pelo shiki com o tema próprio dos `--syntax-*` (sem hex; os dois temas saem do `data-theme` e o contraste dos oito papéis segue medido, RN-185). O shiki é carregado sob demanda (`import()` dinâmico, motor de regex em JS, gramática por linguagem) e fica fora do JS inicial; enquanto carrega, e para linguagem sem gramática, vale o realce por regex da RN-158. Só o tokenizador troca: o recolher de 20/8 linhas (RN-712), a virtualização e o minimapa da aba Código (RN-239..242) não mudam. Copiar diz "Copiado" por 2 s e a falha da área de transferência vira texto, nunca silêncio.
- **Onde:** `apps/web/src/lib/realce-shiki.ts:61` (`carregarRealce`), `apps/web/src/lib/tema-shiki-brabo.ts:19` (`temaShikiBrabo`).
- **Teste:** `apps/web/src/lib/realce-shiki.test.ts`.
- **Origem:** AT-657 (EP-031).

### RN-973 — A série diária do gasto é desenhada pelo Chart, carregado sob demanda, e também existe como tabela {#rn-973}

Por decisão do dono (31/10, AT-636 decisão 4), a página de Gastos ganha o Chart do shadcn (`recharts@3.8.0`, ADR 0234), sem mexer em quem vê o quê ([RN-952](api.md#rn-952), [RN-953](api.md#rn-953), [RN-963](#rn-963)).

1. **Só as três séries diárias** (owner, não-owner e membro) viram gráfico: barras (soma por dia), eixo em US$, tooltip com dia, US$ e chamadas, cor `var(--accent)` pelo `ChartConfig` (nenhuma variável nova). Os rankings seguem barras com o número ao lado, e o empilhado por provider segue fora ([RN-211](#rn-211)).
2. **Carga sob demanda.** O gráfico mora em `GraficoDeGastoPorDia.tsx`, carregado por `React.lazy` em `GastoPorDia.tsx`, com o SVG de `BarrasPorDia` como fallback. `SpendCharts.tsx` não importa o recharts, porque a aba Sessões importa o `Destaque` dali.
3. **Recorte dito e alternativa em texto** ([RN-180](#rn-180)): o título diz a janela, a figura tem `aria-label` igual a ele, e `<details>` "Ver como tabela" traz dia, gasto e chamadas. Zero requisição nova ([RN-632](#rn-632)).

- **Código:** `apps/web/src/components/GraficoDeGastoPorDia.tsx:13` (`GraficoDeGastoPorDia`); `apps/web/src/components/GastoPorDia.tsx:16` (`GastoPorDia`)
- **Teste:** `apps/web/src/components/GraficoDeGastoPorDia.test.tsx` (figura com janela, tabela com os dias, série vazia)
- **Origem:** AT-658

### RN-974 — O fio mostra os passos do turno encerrado, recolhidos, sem os args {#rn-974}

- **Regra:** antes de cada `agent.response` o fio mostra um `ChainOfThought` recolhido, "Passos do turno · N passos", com um `Tool` por `tool.result` do MESMO ator desde a resposta anterior: nome, estado (ok ou falha) e o `resultado` (RN-589), com aviso quando há `resultadoTotal` (corte de 2.000 caracteres). Quando o `tool.result` não traz `resultado` mas traz `result` (formato do `ToolLoop` dos dev agents e dos gates, AT-718), a saída é esse `result` (objeto vira JSON), com o MESMO teto de 2.000 caracteres e o MESMO aviso de corte; o evento gravado não muda. Nunca os `args` (RN-096). Turno sem ferramenta não ganha bloco. O bloco é só do turno ENCERRADO (a faixa narra o turno em curso, RN-460), vai junto da resposta e não conta como mensagem no corte do histórico recolhido (RN-644); lê só a janela de eventos já carregada (RN-180).
- **Onde:** `apps/web/src/lib/passos-do-turno.ts:16` (`passosDoTurno`), `apps/web/src/routes/session-timeline-montagem.tsx:969` (`passosDoTurno`), `apps/web/src/components/ai-elements/passos-encerrados.tsx:8` (`PassosEncerrados`).
- **Teste:** `apps/web/src/components/ai-elements/passos-encerrados.test.tsx`.
- **Origem:** AT-675 (EP-031).

### RN-975 — O painel de pendências do chat é uma faixa de abas, e cada fila pagina de 3 em 3 {#rn-975}

- **Regra:** o painel "Pendências deste projeto" tem uma faixa de abas, uma por fila (perguntas em aberto, aprovações, merges de PR, PRs prontas, tarefas bloqueadas), que SÓ aparece com contagem maior que zero e traz o total da PRÓPRIA fila, nunca somado (RN-467). Nenhuma aba nasce aberta; clicar abre a fila, clicar de novo fecha (`aria-pressed`). O conteúdo das abas fechadas continua montado, só escondido (`hidden`): o "Responder perguntas" do composer abre a aba Perguntas e rola até ela (`rolarAteAsPerguntas`), e o cartão de merge segue registrado no fio (RN-843). Dentro da aba, a fila desenha no máximo 3 itens (`ITENS_POR_PAGINA_DA_FILA`), com "anterior / x–y de N / próxima" no fim, só com mais de uma página (RN-178), a faixa em `role="status"` (RN-180) e o `aria-label` nomeando a fila. A página é ajustada em render: decidir o último item da última página a faz voltar. O teto antigo de 20 cards compartilhado e a frase "as demais estão na aba Aprovações" saem (revisam a RN-626/AT-318); a paginação é sobre a lista já lida, sem query nova (RN-579/632). As perguntas respondidas (RN-884) ficam fora da paginação.
- **Onde:** `apps/web/src/lib/paginacao-de-fila.ts:16` (`paginar`), `apps/web/src/components/PaginadorDaFila.tsx:11` (`PaginadorDaFila`), `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:71` (`PendenciasDeOutrasSessoes`).
- **Teste:** `apps/web/src/lib/paginacao-de-fila.test.ts`, `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`, `apps/web/src/components/PerguntasEmAberto.test.tsx`.
- **Origem:** AT-680 (EP-031).

### RN-976 — As ações de passo da conversa são sugestões acima do destinatário, com o mesmo predicado e o mesmo endpoint, e a inércia é dita em texto {#rn-976}

- **Regra:** "Estou pronto", "Confirmar arquitetura pronta", "Responder N perguntas em aberto" e "Endereçar handoff a outro agente…" saem de dentro e de cima do composer e viram uma fileira de sugestões fixa, ACIMA da linha "Para". O predicado de cada uma e o handler (e o endpoint) são os de antes (RN-142, RN-657, RN-672, RN-861, RN-712); a caixa de mensagem fica sozinha na linha e ocupa a largura do fio (780px, antes ~448px). O clique só chama o handler da página, nunca escreve no campo (RN-882), e nada é clicado sozinho; merge nunca vira sugestão. Ação inerte diz o motivo em TEXTO visível, nunca em `title` (RN-102, ADR 0064); as de prontidão e o handoff manual ficam inertes sem o papel `developer`, o mínimo do endpoint, com o motivo de papel dito uma vez. A ordem no DOM (a fileira antes do "Para", e o Enviar como primeiro botão do composer) é contrato do E2E `turno-pelo-canal`.
- **Onde:** `apps/web/src/routes/SessionComposer.tsx:150` (`acoes`), `apps/web/src/components/ai-elements/suggestion.tsx:50` (`SugestoesDeAcao`).
- **Teste:** `apps/web/src/routes/SessionPage.sugestoes-no-chat.test.tsx`, `apps/web/src/components/ai-elements/suggestion.test.tsx`.
- **Origem:** AT-681 (EP-031).

### RN-977 — O fio da Sessão para de seguir quando a pessoa sobe e oferece "Ir ao fim" {#rn-977}

- **Regra:** revisa a [RN-951](#rn-951), que não é editada (decisão do dono de 02/11, AT-683). O fio acompanha a última mensagem — por identidade de evento/ação, texto do streaming e `ResizeObserver` — SÓ enquanto a pessoa está no fim. Rolou para mais de 80 px do fim: o acompanhamento PAUSA (nenhum gatilho rola) e aparece o botão "Ir ao fim" (`afastado`); o clique, ou voltar ao fim rolando à mão, retoma e rola ao fim. Rolagem instantânea (`block: 'end'`), foco intocado, `?highlightEvent` como na RN-951. O texto por token continua fora do estado da página (RN-639): `SessionPage.streaming-isolado.test.tsx` segue verde.
- **Onde:** `apps/web/src/lib/session-rolagem.ts:36` (`useRolagemDoFio`), `apps/web/src/components/ai-elements/conversation.tsx:10` (`ConversationScrollButton`).
- **Teste:** `apps/web/src/lib/session-rolagem.test.tsx` (para ao subir, mostra o botão, o clique retoma; perto do fim não pausa), `apps/web/src/routes/SessionPage.streaming-isolado.test.tsx`.
- **Origem:** AT-683 (EP-031).

### RN-978 — As mensagens na fila de um agente aparecem num painel acima da caixa, e a cancelada some {#rn-978}

- **Regra:** revisa a apresentação da [RN-673](engine.md#rn-673): o selo sob cada mensagem sai e o `PainelDaFila` lista, acima da caixa, TODAS as pendentes (`estadosNaFila` em `naFila`), uma linha "Agente: texto" por mensagem. O painel só existe com pendente. Cancelar chama o MESMO endpoint (`cancelQueuedAgentMessage`), só aparece para quem ENVIOU e com a sessão ativa, não é otimista (o item sai quando o log disser `chat.message_cancelled`) e a recusa é dita no toast. Decisão do dono (02/11): a mensagem CANCELADA (e a entregue) deixa de aparecer em qualquer lugar; o log a guarda.
- **Onde:** `apps/web/src/routes/PainelDaFila.tsx:20` (`PainelDaFila`).
- **Teste:** `apps/web/src/routes/SessionPage.fila-de-mensagens.test.tsx` (lista as pendentes e só quem enviou cancela; sem pendente não há painel).
- **Origem:** AT-683 (EP-031).

### RN-979 — Decisão, mapa de módulos, C4, imagem e parecer de QA/SecOps ganham cartão no fio {#rn-979}

- **Regra:** os eventos `artifact.decision_record`, `artifact.module_map`, `artifact.c4_diagram`, `artifact.project_image`, `artifact.qa_verdict` e `artifact.secops_verdict` aparecem no fio com o MESMO cartão do épico/história, com link para a aba (Arquitetura ou PRs). Título e descrição saem dos campos REAIS do payload: decisão (`choice`, `context`), mapa de módulos (sem título; descrição = `modules[].name`), C4 (`systemName`, `systemDescription`), imagem (`image`, `rationale`), pareceres (`veredito` traduzido, `resumo`). Campo ausente cai no rótulo do tipo; descrição passa de 200 caracteres é cortada. Leitura do payload, sem query nova.
- **Onde:** `apps/web/src/lib/artefato-do-fio.ts:11` (`camposDoArtefato`), `apps/web/src/routes/session-timeline-montagem.tsx:138` (`ARTEFATOS_DO_FIO`).
- **Onde:** `apps/web/src/lib/artefato-do-fio.ts:11` (`camposDoArtefato`), `apps/web/src/routes/session-timeline-montagem.tsx:141` (`ARTEFATOS_DO_FIO`).
- **Teste:** `apps/web/src/lib/artefato-do-fio.test.ts` (um caso por tipo e payload sem campo opcional).
- **Origem:** AT-683 (EP-031).

### RN-980 — As Configurações do projeto são uma página por grupo, com os grupos como abas dentro da página; só o grupo aberto monta {#rn-980}

- **Regra:** revisa a [RN-645](#rn-645) no item 3. O sumário lateral deixa de existir: cada grupo do registro (`modelos`, `projeto`, `pessoas`, `avancado`) é uma PÁGINA, e os quatro são ABAS numa faixa no topo da página de Configurações (setas, Home e End; `aria-selected`/`aria-controls`); "Configurações" segue UM item só da barra lateral, sem sub-itens (decisão do dono, 03/11). O endereço é `?tab=settings&group=<grupo>`; Modelos é a página padrão. `?section=` continua valendo: abre a página do grupo da seção e rola até ela, e vence um `group` incoerente; chave aposentada ([RN-911](#rn-911)) ou desconhecida abre Modelos no topo. O grupo é derivado do campo `grupo` do registro, nunca de outra lista. Só as seções do grupo aberto montam, então a carga busca só o que é da página (abrindo em Modelos, no máximo 21 requisições, contra 30; teto em `configuracoes.orcamento.test.tsx`). Os itens 1 e 2 da RN-645 (frescor de um minuto, sem poll) não mudam, e trocar de página dentro do minuto não refaz busca. Trocar de página descarta rascunho não salvo, como trocar de aba.
- **Onde:** `apps/web/src/routes/settings/sumario.ts:110` (`grupoDaSecao`), `apps/web/src/routes/settings/sumario.ts:115` (`resolverGrupo`), `apps/web/src/routes/ProjectSettingsTab.tsx:63` (`ProjectSettingsTab`).
- **Teste:** `apps/web/src/routes/settings/paginas-por-grupo.test.tsx` (página só com as seções do grupo; todo `?section=` antigo cai no seu grupo; rola até a seção), `apps/web/src/routes/configuracoes.orcamento.test.tsx` (carga de Modelos não busca o resto), `apps/web/src/routes/settings/paginas-por-grupo.test.tsx` (a faixa de abas e o teclado).
- **Origem:** AT-719 (EP-031).

### RN-981 — Na Sessão, as caixas de pergunta e de aprovação ficam na borda do fio, e o contexto e o esqueleto de carregamento ganham o tratamento R3 {#rn-981}

- **Regra:** revisa a [RN-171](engine.md#rn-171) e a [RN-173](#rn-173) no alinhamento: a caixa de pergunta estruturada e o contêiner da ação no fio deixam de ser centralizados (`margin: auto`) e ficam encostados na borda esquerda do fio, mantendo o teto de 560px. Decisão do dono (03/11/2026). O resto da RN-171 (texto livre) e da RN-173 (um só `ApprovalCard`) fica. Junto: o botão do contexto tem só ícone, com legenda "Recolher contexto"/"Abrir contexto" e `aria-expanded`; o fio mostra "Carregando sessão…" com esqueleto na mesma condição que adia o convite (RN-131); "Arquivos tocados" é um `Disclosure` com a contagem; a faixa de sessão encerrada tem ícone, título e explicação, e "Reabrir sessão" segue com a regra de papel da RN-650.
- **Onde:** `apps/web/src/routes/SessionPage.module.css:1261` (`.acaoNoFio`), `apps/web/src/routes/SessionFio.tsx:59` (`SessionFio`), `apps/web/src/routes/SessionTopbar.tsx:101` (`SessionTopbar`).
- **Teste:** `apps/web/src/routes/SessionPage.layout-movel.test.tsx` (legenda e `aria-expanded`), `apps/web/src/routes/SessionPage.sessao-encerrada.test.tsx`.
- **Origem:** AT-720 (EP-031).

### RN-992 — O composer interpreta `@` e `/` só na tela: `@` escolhe destinatários entre os agentes da sessão, `/` dispara a ação do botão ou insere um prompt, e nenhum comando decide por teto {#rn-992}

- **Regra:** `@` e `/` no início de uma palavra abrem a lista de sugestões (`Command` do shadcn dentro de um `Popover`); o campo segue NÃO controlado (RN-882) e o texto depois do gatilho só filtra a lista. O `@` lista SÓ os agentes que já estão na sessão e vira chip; um chip usa a rota por agente de hoje, dois ou mais usam `POST .../messages` com `destinatarios`. O `/` tem nome localizado e aceita o id interno: `/pronto`, `/arquitetura`, `/handoff`, `/perguntas` e `/parar` chamam o handler e o predicado do botão (RN-976); `/resumo` e `/plano` inserem um texto fixo traduzido para a pessoa editar; `/ajuda` lista os comandos; `/skills` lista as ferramentas e a instrução vigente do destinatário (catálogo da RN-995, `queryKey` `['agent-catalog', projectId]` da RN-645; engine fora diz "não sei", nunca "sem ferramentas") e `/buscar` pesquisa no RAG (`POST .../rag/search`, sem rota nova) o texto do campo, e ambos só LEEM e dizem o motivo quando falham (AT-724). `/aprovar` com UMA pendência pede confirmação e chama o endpoint do `ApprovalCard`; com várias, ou com teto (`git_merge`, `instruction_patch`, `parallelize`, `raise_max_parallel`, deploy, `sudo`/`doas`, RN-154/RN-418), só leva ao card. Enter e Tab escolhem, Esc fecha, e com o menu aberto Enter NÃO envia; composição de acento (RN-830) é ignorada. Nenhum comando cria `proposed_action`.
- **Onde:** `apps/web/src/lib/comandos-do-composer.ts:115` (`gatilhoNoCursor`), `apps/web/src/lib/comandos-do-composer.ts:132` (`destinoDoAprovar`), `apps/web/src/lib/use-menu-do-composer.ts:25` (`useMenuDoComposer`), `apps/web/src/lib/use-menu-do-composer.ts:97` (`listarSkills`), `apps/web/src/lib/use-menu-do-composer.ts:125` (`buscar`), `apps/web/src/components/ai-elements/menu-do-composer.tsx:15` (`MenuDoComposer`).
- **Teste:** `apps/web/src/routes/SessionComposer.menu.test.tsx` (menu, filtro, Enter sem enviar, Esc, `/aprovar` comum e de teto, `/resumo`, `@` da sessão, chips e rota nova, `/skills` e `/buscar` no caminho feliz e na falha), `apps/web/src/lib/comandos-do-composer.test.ts`.
- **Origem:** AT-717 (EP-031), lane web.

### RN-994 — Na Sessão, a pergunta estruturada vem depois da mensagem do agente que a introduz {#rn-994}

- **Regra:** revisa a [RN-162](engine.md#rn-162) só na posição. O agente pergunta no meio do turno e fecha com o `agent.response`, então o `chat.structured_question` tem `seq` menor que a resposta; o fio põe o cartão (aberto ou já respondido) logo DEPOIS da bolha de `agent.response` do MESMO agente com `seq` maior, antes da próxima `chat.message` do usuário. Sem resposta depois (turno em curso), o cartão fica onde está. Move-se o item, não o evento, e o item mantém a flag `mensagem` do corte da [RN-644](#rn-644). Raciocínio e "Passos do turno" seguem antes da resposta. Decisão do dono (03/11/2026).
- **Onde:** `apps/web/src/routes/session-timeline-montagem.tsx:151` (`montarTimeline`).
- **Teste:** `apps/web/src/routes/session-timeline-montagem.perguntas.test.tsx` (resposta antes do cartão; turno em curso; duas perguntas na ordem; não pula para a resposta do turno seguinte).
- **Origem:** pedido do dono, 03/11/2026.
