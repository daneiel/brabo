# Changelog

Gerado dos conventional commits por `scripts/changelog.mjs`.

## Unreleased

### Novidades

- **engine**: um ciclo de gate (QA/SecOps) morto no meio — por um restart do
  processo, entre o veredito já gravado na api e a chamada em processo que
  aplicaria o próximo passo — não prendia mais a PR pra sempre (RN-140).
  `gate_states` grava o ciclo em voo nos mesmos pontos onde as transições já
  aconteciam, e `Engine.Gates.GateRescuer` (chamado no boot e por um tick
  Oban a cada 5 min) reinicia a área do zero ou reenvia exatamente a chamada
  perdida — sem intervenção manual. Fecha o limite que o ADR 0057 já
  declarava ("restart no meio da espera perde o laço"); ver ADR 0067
- **web**: o botão "Voltar" da sessão passa a levar de volta ao PROJETO
  (`/projects/:projectId`), não mais ao dashboard raiz — a sessão sempre
  nasce dentro de um projeto, e é lá que quem sai dela quer estar.
  Separadamente, a promoção de história (RN-048) ganha um segundo lugar
  pra ser decidida: `backlog.story_promotion_proposed` vira um card
  acionável INLINE no fio da sessão do PO, com os botões "Promover" e
  "Devolver" chamando os mesmos endpoints que a aba Backlog já usa
  (RN-126); "Devolver" pede o motivo e a devolução narra no fio, com o
  motivo, quando decidida
- **web**: o aceite de handoff passa a viver DENTRO do fio da sessão
  (RN-125) — o divisor "X passou o bastão ao Y" vira um card acionável,
  com o botão embutido, quando representa a oferta pendente ATUAL; o
  botão da topbar saiu, pra não duplicar o mesmo texto na tela. O card
  pro **Dev Lead** ganha um link extra, "Acompanhe a execução em
  Executores". Separadamente, criar épico ou história pelo PO
  (`backlog.epic_created`/`backlog.story_created`) passa a narrar no
  fio, com um link "Ver no Backlog" (RN-124) — antes, criar história não
  deixava rastro nenhum na conversa
- **api,engine,web**: botão **"Parar"** no composer da sessão cancela DE
  VERDADE o turno em curso do agente conversacional (RN-122) — não só para de
  renderizar no cliente. O engine parava de atender qualquer mensagem
  (inclusive cancelar) enquanto processava um turno, porque o turno inteiro
  rodava dentro de um `GenServer.call` síncrono; os quatro agentes
  conversacionais (Criativo, PO, Arquiteto, Dev Lead) passaram a rodar o
  turno numa Task supervisionada (`Engine.Agents.TurnoAssincrono`), liberando
  o processo pra atender `:cancel` enquanto o turno roda. Cancelar mata a
  Task (`Task.shutdown/2`, `:brutal_kill`), o que derruba a conexão SSE com a
  api no meio — é isso que economiza token de verdade — e grava um
  `agent.error` terminal com origem "politica"

- **api,engine,web**: o Psicólogo pode ser pausado GLOBALMENTE
  (`PSYCHOLOGIST_ENABLED`, default `false` a partir de agora) — mesma
  decisão de produto já aplicada à Anamnese ("hoje ele não está trazendo
  dados de muito valor"), não bug, e não apaga nada do que já existe
  (RN-117). O gatilho automático (fechamento de sessão) para de enfileirar
  rodada nova; a rota "Reanalisar" na aba Insights responde 503; os botões
  correspondentes descobrem o estado no primeiro clique e mantêm a
  explicação visível na tela

- **web**: a aba **Code** — leitura do repositório do projeto no padrão IDE
  (explorador de arquivos carregado por diretório, busca no conteúdo, abas de
  editor com realce de sintaxe sem dependência nova, e diff de PR por id
  conhecido). Um QUARTO estado, além dos três da RN-088, aparece quando o
  Arquiteto ainda não decidiu a imagem do container: "bloqueada por decisão
  pendente" (RN-107), nem carregando, nem erro, nem vazio. Terminal
  interativo, blame e lista rica de branches ficam de fora, declarados como
  pendência — dependem de fases que ainda não subiram (FASE 26, item 35)
  interativo, blame e lista de PRs ficam de fora, declarados como pendência —
  dependem de fases que ainda não subiram (FASE 26, item 35)

- **web**: a aba Code ganha o dropdown rico de branches (`CodeBranchPicker`),
  substituindo o campo de texto simples — cada linha mostra `ahead`/`behind`
  relativos à branch default e a PR associada, quando houver (RN-112). Ref
  fora da lista (tag ou sha) continua alcançável por um campo manual no
  rodapé do dropdown

- **api**: fundação de blame, PRs navegáveis e branch rica para a aba Code —
  `GET /projects/:id/code/{blame,pull-requests,branches}`. `GitProviderContract`
  ganha a 13ª/14ª/15ª operação, provadas pela suite de contrato nos três
  providers (RN-110/111/112)

- **web**: o painel "Diff de PR" da aba Code ganha lista navegável de pull
  requests (id, título, autor, estado, branches, filtro por estado),
  consumindo `listPullRequests` (RN-111); clicar num item abre o mesmo fluxo
  de diff por id que já existia. Quem já sabe o id continua podendo colar
  direto
- **web**: o editor da aba Code ganha anotação de blame — toggle "Blame" no
  breadcrumb liga a anotação linha a linha (commit, autor e data) SOB
  DEMANDA, nunca em toda leitura de arquivo; linhas consecutivas do mesmo
  commit não repetem o texto, e os três estados (carregando, erro com
  "tentar de novo", vazio) seguem a RN-088 (RN-113)

- **api,web**: aba de Gastos com duas audiências — o owner vê a quebra do workspace por modelo, projeto, ator e dia (mais a fatura por credencial, que já existia); o membro vê só o próprio consumo, por sessão e por dia, sem provider e sem credencial (ADR 0063, RN-101)

- **api,web**: a sessão nasce com tipo escolhido (`consultiva` ou `criativa`),
  pode ser renomeada preservando a hashtag, e a tela dela tem um caminho de
  volta ao dashboard. `execution.activated` numa sessão consultiva passa a
  responder 409 em vez de convertê-la em silêncio (ADR 0061, RN-097/098)

- **web**: o projeto ganha duas abas de sessão, **Criativo** e **Chat**, cada
  uma listando e criando o seu tipo sem perguntar de novo; a aba "Sessões" sai,
  e `?tab=sessions` de um link antigo abre no Chat. "Iniciar ideação" passa a
  morar dentro do convite enquanto ele está na tela — antes o convite apontava
  para a topbar (RN-104)

- **api,web**: o modelo de LLM virou padrão herdável por ÁREA — a cascata
  ganha o nível `sessão > agente > área > projeto > workspace`, o lead e os
  subagentes de uma área compartilham o mesmo modelo até um agente divergir
  explicitamente, e "voltar a herdar" apaga o binding do agente em vez de
  copiar o da área. O binding de agente, que era GLOBAL, passou a ser POR
  PROJETO — pré-condição para a área não competir com um escopo mais amplo
  que ela mesma (ADR 0064, RN-102/103)

- **api,engine**: o Arquiteto decide qual imagem de container sobe para cada
  projeto — artefato versionado no event log (`artifact.project_image`), tag
  OCI explícita obrigatória (`latest` recusado) e teto de recursos que recusa
  em vez de rebaixar em silêncio. Enquanto ele não decide, a aba Code responde
  409 (RN-105). Dentro do container o agente é livre; `git push`, PR e deploy
  continuam nascendo `proposed_action` mesmo pelo terminal, agora garantido por
  `deny` — não só combinado (RN-106). Corte declarado: o ciclo de vida do
  container (provisionar, reciclar, limpar) fica para a fase seguinte, que tem
  o slot de migration desta onda (ADR 0065, revisa o ADR 0055)

- **api,engine**: a pasta do workspace de um projeto NOVO nasce com nome
  legível (`<slug>-<8 chars do id>`) em vez do UUID puro — mais fácil de
  reconhecer abrindo `PROJECT_WORKSPACES_HOST_DIR` no disco. Congelado na
  criação: editar o slug depois não renomeia a pasta. Projeto criado antes
  desta mudança mantém a pasta física que já tinha, sem nenhum rename (ADR
  0066, revisa o ADR 0055, RN-109)

- **api,engine,web**: a Anamnese pode ser pausada GLOBALMENTE
  (`ANAMNESE_ENABLED`, default `false` a partir de agora) — decisão de
  produto do usuário ("hoje ele não está trazendo dados de muito valor"),
  não bug, e não apaga nada do que já existe (RN-115). O scheduler
  periódico para de agendar rodada nova; a rota "reanalisar agora" responde
  503 (distinto do 409 de "projeto sem sessão"); o botão correspondente nas
  Configurações do projeto descobre o estado no primeiro clique e mantém a
  explicação visível na tela

### Correções

- **web**: a aba Criativo listava a sessão de execução VIGENTE misturada com
  ideações de verdade — ela nasce `kind: 'criativa'` (RN-097 exige isso para
  `execution.activated` ser aceito), então o filtro por `kind` sozinho não
  bastava. Abrir essa sessão mostrava uma timeline inteira de tool-calls de
  dev agent, parecendo "o dev escrevendo no chat do Criativo" — achado ao
  vivo numa sessão com 35+ eventos. A aba Criativo agora exclui da lista a
  sessão que `useActiveExecutionSession` devolve (RN-139); a aba Chat nunca
  chama essa busca. Escopo deliberado: execuções ANTIGAS já `closed` não são
  filtradas — o badge `closed` já deixa a diferença clara (RN-144)
- **api,web**: a aba Executores lia a sessão `createdAt` mais recente do
  projeto (`useLatestSession`) para buscar os eventos de dev agent/QA — que
  É a sessão de execução só por COINCIDÊNCIA. Qualquer sessão nova depois
  (uma ideação, um chat) fazia a aba passar a olhar, em silêncio, uma sessão
  vazia de eventos de execução. `GET /projects/:projectId/execution/session`
  (`role:viewer`) expõe por HTTP o MESMO critério que `ActivateExecutionUseCase`
  já usava internamente (`active` com `execution.activated` gravado, ou
  `null`); a aba troca de fonte (`useActiveExecutionSession`) e ganha um
  indicador de QUAL sessão está sendo exibida, nos três estados da RN-088 —
  carregando, erro (com `trace_id`) e "nenhuma execução ativa" (RN-139)
- **web**: três correções no fio da sessão, achadas por investigação de
  código + teste ao vivo no Chrome. (1) O card ACIONÁVEL de handoff
  resolvia sempre pro `offered` mais antigo — como o Arquiteto oferece o
  handoff pro Infra ANTES do Dev Lead na mesma confirmação, e Infra não é
  conversacional nesta tela, o card do Dev Lead nunca ficava acionável na
  prática; agora só handoffs endereçados a quem conversa aqui
  (`AGENTES_DE_CHAT`) viram card, e o de Infra continua narrado como
  divisor mudo (RN-136). (2) O card de aceite do handoff pro Dev Lead
  ganha um botão "Ativar execução" ao lado do link pra Executores — mesma
  `activateExecution` da Visão Geral, agora com `originSessionId` (fecha o
  chat de origem, RN-135); a rota continua exigindo `maintainer`, decisão
  mantida por causa do papel que os dev agents herdam pra abrir PR
  (RN-137). (3) Mensagens consecutivas do mesmo agente colapsam num
  cabeçalho com nome + contagem depois que ele passa o bastão e não tem
  ação pendente — `Disclosure` do design system, fechado por padrão
  (RN-138)
- **api**: `ActivateExecutionUseCase` nunca fechava a sessão de CHAT que
  originou o pedido de ativação — ela ficava `active` para sempre, mesmo
  com a execução já correndo sozinha numa sessão SEPARADA. `execute()`
  ganha `originSessionId` opcional (chamador antigo, sem o parâmetro,
  continua idêntico); informado, fecha a sessão de origem ao final, mas
  nunca a própria sessão de execução, e só quando
  `GetSessionPendingWorkUseCase` — a mesma trava do heartbeat de
  inatividade — confirma que não há handoff/ação/turno pendurado ali
  (RN-135)
- **api**: a sessão que o bootstrap de Git abre automaticamente (Fase 2 —
  criar repositório, `dev`/`qa`, os dois primeiros commits) nasce com o nome
  default `"git-bootstrap"` (RN-130), em vez de `null`. Antes, a lista de
  sessões do Criativo degradava pra hashtag sozinha e não dava pra distinguir
  a sessão automática das abertas pelo usuário sem abrir cada uma. Sessão
  criada manualmente continua sem nome quando o campo vem em branco.
- **api**: quatro alertas CRÍTICOS do CodeQL, duas classes reais de
  vulnerabilidade. `@Query('ref')`/`@Query('path')` da aba Code (RN-095)
  chegam sem DTO no meio, e o `ValidationPipe` global não protege tipo
  primitivo nativo — `?ref=a&ref=b` vira ARRAY no Express, e um array
  escapava de `.includes('..')`/`REF_VALIDO.test(ref)` por ter semântica
  diferente de string; `garantirQueryEscalar` recusa array ANTES de
  qualquer outra checagem, reusada nos dois pontos que tratavam query como
  string (RN-127). Em paralelo, `sessionId`/`projectId`/`agent`/`agentId`
  viravam segmento de URL de requisição interna ao engine sem forma
  validada — `garantirSegmentoDeUrlInterna`, aplicada dentro de
  `postCommand` (cobrindo onze métodos, não só os dois que o CodeQL
  reportou) e nos dois que não passam por ele (RN-128)
- **web**: dois defeitos de UX em `SessionPage.tsx`. Mandar mensagem antes de
  clicar "Iniciar ideação" fazia o convite do Criativo (título, papel, nota)
  sumir PRA SEMPRE — `conviteVisivel` depende de `conversaComecou`, que não
  volta a `false` —, deixando só um botão pelado na topbar sem explicação
  nenhuma; agora uma pista (ícone e nota do Criativo, mesma cor da bolha dele
  no fio, `title` no hover) fica ao lado dele. O contador de regras de
  negócio no painel de contexto passa a usar o mesmo `<Disclosure
  trailing={n}>` do Log de eventos, em vez de um cabeçalho mudo. E entre
  aceitar um handoff e o próximo agente responder a tela não mostrava nada —
  o kickoff do agente no engine é um `GenServer.cast` assíncrono, e o
  `agent.status` "working" que ele já emitia nunca estava plugado
  (`onAgentStatus` existia em `session-channel.ts` desde a RN-108/Fase 4a mas
  nenhum handler de `SessionPage` o usava); agora ele reaproveita o indicador
  de digitação já existente, identificando o agente pelo handoff que acabou
  de ser aceito
- **web**: `write_file` ganha corpo próprio no card de aprovação (RN-096) —
  antes caía no fallback genérico e despejava `path`/`content` como JSON cru
  COLAPSADO, então um write que genuinamente pedia aprovação (fora do
  prefixo `dev-`, ou caminho fora do escopo do agente) exigia um clique
  extra pra ver o que seria escrito. Agora mostra o `path` e um preview do
  `content` (até 25 linhas/4.000 caracteres, com aviso de truncamento),
  aberto por padrão no chat enquanto pendente — mesmo comportamento que
  `terminal` já tinha. Separadamente, `command` (terminal) ou
  `path`/`content` (write_file) vazios — tool-call malformada do modelo —
  agora mostram "o modelo não produziu um X válido para esta ação" em vez
  de um prompt `$ ` ou preview em branco, que lia como bug de renderização

- **engine**: `Engine.Harness.ToolLoop` (o loop compartilhado por dev agents,
  QA Automação/Performance-Segurança, Infra-Workflows, Anamnese e Psicólogo)
  gravava `agent.response` com conteúdo VAZIO — iteração que só chamava
  ferramenta sem texto, ou turno que terminava sem produzir nada — e a tela
  mostrava o balão de compatibilidade da RN-059 como se fosse evento ANTIGO,
  achado ao vivo numa sessão de execução real com dev agents rodando. Falha
  de transporte (provider fora do ar) tinha o mesmo sintoma: virava
  `agent.response` sem `content` em vez de `agent.error`. Estende a RN-059
  (que já cobria os quatro agentes conversacionais, que não passam pelo
  ToolLoop) para este ponto estrutural comum: conteúdo vazio nunca vira
  `agent.response`, e falha de transporte grava `agent.error` durável com a
  origem, pelo mesmo `FalhaDeTurno.origem/1` (RN-129)

- **engine**: `AnamneseSchedulerWorker.perform/1` não conferia a flag
  `ANAMNESE_ENABLED` — só `kickoff/0` (a inserção inicial do job no boot)
  conferia. Uma corrente já agendada ANTES de alguém desativar a flag (ou de
  antes de ela existir) se reagendava pra sempre e rodava rodadas reais da
  Anamnese com a flag dizendo `false`. `perform/1` agora confere `enabled?/0`
  a cada tick: desativado, nem enfileira rodada por projeto nem se reagenda,
  e a corrente morre ali — job antigo que ainda dispara uma vez se auto-cura
  sozinho, sem intervenção manual (RN-115). Conferido: o Psicólogo
  (`PSYCHOLOGIST_ENABLED`) não tem esse problema — o gate dele fica no
  roteamento do evento pelo `Engine.Outbox.Drain`, não numa corrente que se
  reagenda sozinha
- **web**: mensagem duplicada e "Iniciar ideação" preso na topbar depois de
  enviar a primeira mensagem a um agente ativo (Criativo/PO/Arquiteto). A
  conexão do canal Phoenix (ticket + join, RN-108) é assíncrona e podia não
  ter terminado quando o turno acabava — o `agent.done` que a tela dependia
  para resetar `streaming`/a mensagem otimista se perdia sem ninguém ouvindo
  do outro lado, e como nada mais reconciliava esse caminho, o cliente ficava
  preso. `handleSend` passa a reconciliar o mesmo estado quando a própria
  chamada `POST .../agents/:agent/message` resolve — ela só retorna depois
  que o engine termina o turno inteiro (`GenServer.call` síncrono no
  `CriativoServer.user_message/2`), sinal de conclusão tão confiável quanto
  `agent.done`, e idempotente com ele

- **api,engine,web**: o socket Phoenix da sessão (`session:<id>`) exigia só o
  `session_id` existir — quem descobrisse o UUID entrava no canal e recebia
  todos os broadcasts ao vivo. `connect/3` passa a exigir um ticket opaco de
  uso único (TTL de 30s, `POST .../sessions/:sessionId/socket-ticket`),
  consumido atomicamente pelo engine contra o `session_id` do tópico pedido, e
  o join confere também o `project_id` — reconexão (inclusive automática)
  sempre busca um ticket novo (RN-108)

- **api**: o heartbeat podia fechar a sessão com um agente ativado por handoff
  ainda no meio do turno — `AcceptHandoffUseCase` ativa o próximo agente por
  `GenServer.cast` fire-and-forget, e entre a ativação e o agente oferecer o
  handoff seguinte (ou terminar), nem handoff `offered` nem `proposed_action`
  pendente existiam para segurar a sessão. Na cadeia Criativo→PO→Arquiteto
  isso quebrava o encadeamento: o handoff PO→Arquiteto acabava sendo oferecido
  numa sessão já `closed`, que o front não deixa mais aceitar.
  `GetSessionPendingWorkUseCase` ganha um terceiro sinal — o último
  `agent.status` (persistido no event log) de cada ator é `working` sem `idle`
  posterior — genérico por tipo de agente, não hardcoded pro PO (RN-064)

- **api,web**: cinco defeitos de consistência em `SessionPage.tsx`, achados na
  mesma investigação. **(1)** a topbar continuava mostrando o modelo do
  CRIATIVO mesmo depois de um handoff pro PO/Arquiteto/Dev Lead — a rota de
  model-binding da sessão não recebia agente nenhum e caía sempre no fallback
  fixo do Criativo; agora manda `agentId` (o agente REALMENTE ativo) e a
  cascata completa `sessão→agente→área→projeto→workspace` roda pra ele
  (RN-119). **(2/7)** mensagem do usuário e resposta do agente apareciam
  DUPLICADAS quando o poll de 3s de `useSessionEvents` caía no meio de um
  turno em streaming; o hook ganha `pausarPoll` (default `false`, sem afetar
  os outros consumidores), pausado só enquanto o turno está em curso — a
  invalidação explícita no fim do turno continua buscando o dado fresco
  (RN-120). **(3)** sessão criativa exigia o clique separado em "Iniciar
  ideação" antes da primeira mensagem, e digitar direto caía num chat SSE
  genérico sem histórico nem regra de negócio — a primeira mensagem agora
  ativa o Criativo sozinha, pelo caminho real (RN-123). **(9)** depois de
  aceitar um handoff pro Dev Lead, a mensagem seguinte continuava indo pro
  Arquiteto — `activeAgent` usava uma cadeia de precedência FIXA
  (arquiteto > po > criativo) que nunca "desligava"; agora é sempre o
  `agent.activated` mais RECENTE, sem ordem fixa nenhuma (RN-119). **(10)**
  sessão com histórico abria no TOPO (mensagens mais antigas primeiro), sem
  nenhum scroll automático — agora abre sempre no fim

- **web**: três corridas confirmadas AO VIVO navegando `SessionPage.tsx` no
  Chrome (RN-131). **(1)** o convite de boas-vindas do Criativo reaparecia
  por cima de sessões com histórico real — `conversaComecou` olhava só
  `chat.message`/`agent.response`, então uma sessão criada pelo
  `git-bootstrap` (ações de commit/branch já aprovadas) ou a sessão que a
  ativação de execução usa (dezenas de `tool.call`/`tool.result`) mostravam
  o convite por cima do que já tinha acontecido; agora o critério é
  "existe QUALQUER evento". Separadamente, `conviteVisivel` ganha o gate
  `!eventsQuery.isPending`, fechando uma race de cache frio em que o convite
  piscava antes do primeiro fetch de eventos resolver. **(2)** o indicador
  de "pensando" (bolha com os 3 pontinhos) ligava imediatamente a cada
  turno, mesmo nos que respondiam em menos de um segundo — agora só aparece
  depois de 5s sem nenhum texto chegar, e desarma na hora assim que o
  primeiro delta chega ou o turno termina antes do prazo; texto de verdade
  continua aparecendo sem esperar. **(3)** `handleReadiness` (o clique em
  "Estou pronto para produzir") podia deixar a bolha do agente presa vazia
  pra sempre se o canal Phoenix não entregasse `agent.done` a tempo — o
  mesmo bug que `handleSend` já corrigira ganhando uma rede de segurança
  equivalente: chamar `finalizarTurnoDoAgente()` assim que
  `confirmReadiness` resolve, independente do canal

## v2.5.1 — 2026-08-08

### Correções

- **api,docker**: a chave que assina o state do OAuth perde o default (ce212fc5)
- **scripts**: o fixture do teste de promoção sem o campo `branch` (2298a284)
- **api**: CSP fechado na api e escopo de projeto contido na raiz (3ec2cb37)

### Documentação

- **branching**: a ordem do escape da célula, na política (06e3d61c)
- **changelog**: v2.5.0 (b3cc60e6)

## v2.5.0 — 2026-08-08

### Novidades

- **engine,api**: o Dev Lead existe, e e o unico endereco externo da execucao (ba62b6eb)
- **api,engine**: a Anamnese propoe subir o teto, e gastar nunca se auto-aprova (73fb8426)
- **api,web**: o teto de paralelismo configuravel, e enfim consultado (44cdc2f1)
- **api**: o lead decide o paralelismo, e acima do teto você autoriza (daa3ab3f)
- **api,web**: o painel deriva a esteira do registro de gates (d55ccd7d)

### Correções

- **api,docs**: lint da api e o contrato web na arquitetura (87a2d701)
- **web**: renumera as regras para RN-088 e RN-089 (24c168b7)
- **web**: 429 virava tela branca, e a app respondia com mais tráfego (7dfdd8e6)
- **engine**: a corrida do worktree entre dois dev agents (58be13d1)
- **validacao**: a assercao afirma a REGRA, e o Arquiteto decide os modulos (93e4e753)
- **validacao**: --historias nao chegava ao resto do script (a214f593)
- **engine**: o plano do Dev Lead encerra o turno (9bd97241)
- mix format no tool_loop e o inventario de variaveis regenerado (9d34d4da)
- **engine**: o teto de iteracoes e por TIPO de agente (fb3a1975)

### Desempenho

- **web,api**: o sino manda onde parou de ler, e pergunta uma vez só (0eeb87be)
- **web,api**: o dashboard lê o workspace, não um projeto de cada vez (a3cee5ab)

### Documentação

- registra o achado AE e corrige a contabilidade do backlog (6663209c)
- CLAUDE.md com o estado real das fases 14 e 15 (97fa990a)
- a rota de handoff ao Dev Lead na api interna (4ab8e3a8)
- regenera a referencia OpenAPI (43042a88)
- as rotas de area e a assimetria do parallelize (f77bb229)
- **runbook**: o sintoma de teto de iteracoes baixo demais (18ee7233)
- a rota publica de gates e a RN-084 da esteira derivada (88e68500)
- architecture.md registra agent_areas no modelo de dados (04bd39b9)
- permissions.md documenta o tipo de ação parallelize (86e4090b)
- CLAUDE.md com o estado real das fases depois da v2.4.0 (457af4f7)
- **changelog**: v2.4.0 (d266af6e)

### Testes

- **validacao**: --modulos 2, para o paralelismo FAZER sentido (510c5855)
- **validacao**: duas historias no mesmo modulo, e o teto exercitado (80287a06)
- **engine**: restaurar env com nil apagava o default (de0ab417)

### Manutenção

- **deps**: fecha 5 alertas do Dependabot com overrides escopados (50efe887)

## Unreleased

### Novidades

- **api,shared**: o contrato de git ganha `listTree` e `getPullRequestDiff`, a
  11ª e a 12ª operações, que a aba Code (FASE 26) vai precisar. Entram como
  capability, e são `true` nos três providers só porque a **suite de contrato
  única as prova nos três** — o critério dos ADRs 0041/0042, que vale para git:
  sem prova, declara-se `false` e degrada. São LEITURA e só: `listTree` devolve
  UM nível da árvore, nunca a árvore inteira, e `getPullRequestDiff` normaliza o
  diff de uma PR (`status`, `additions`, `deletions`, `patch`). As duas cortam
  com teto e avisam por `truncated`, para a aba não virar amplificador de
  tráfego; os números moram em `apps/api/src/domain/git/git-read-limits.ts`, e
  não no `packages/shared`, que é 100% tipo. Ausência é `null`, o mesmo
  vocabulário de `getFileContent`. Junto vem a trava do item 33 da fase:
  **operação de contrato sem consumidor em `src/` reprova o CI**, com uma saída
  estreita e nomeada para as duas — ela se fecha sozinha, porque passa a
  reprovar assim que a rota da 26b existir. Uma degradação declarada: o GitLab
  não traz tamanho de arquivo na árvore, então `size` vem `null` ali.
- **api**: a superfície HTTP de **leitura** de código que a aba Code consome —
  árvore, arquivo, busca e diff de PR, em quatro `GET` sob
  `/projects/:projectId/code/`, todas `role:viewer`. **Nenhuma escreve, e o
  controller não tem um único verbo de escrita**: ler não é efeito externo e não
  vira `proposed_action`; escrita é fase seguinte, e vai nascer como uma. A
  trava da 26a fechou junto — `listTree` e `getPullRequestDiff` deixaram de
  estar na lista de operações sem consumidor, porque agora têm um.
  **Contenção (RN-095)**: todo caminho vindo do cliente passa por UMA função, no
  mesmo arquivo do `projectScopeRoot` da RN-092, reusando as primitivas de
  escopo do ADR 0055 — `../`, absoluto e byte NUL são recusados com 400
  **antes** de o provider ser chamado, e o que volta é o caminho normalizado,
  porque conferir uma string e mandar outra é o jeito de a contenção existir e
  não valer. Não é sobre ler o arquivo errado: em GitHub/GitLab o caminho vira
  segmento de URL da API do provider, e um `..` troca de **endpoint** com o
  token do owner do workspace na mão. **Teto**: a busca não é operação do
  contrato de git (nenhum dos três providers a tem) — é composta sobre a árvore
  e o conteúdo, com três orçamentos que a param, cache de TTL curto e
  `truncated`/`filesScanned` na resposta, senão a aba viraria a mesma família de
  defeito dos 3.824 req/min do dashboard. A credencial gasta é a do **owner**
  (RN-058/RN-082), como na escrita. Ver [ADR
  0060](docs/adr/0060-superficie-de-leitura-de-codigo.md).

### Correções

- **api,docker**: `GIT_OAUTH_STATE_SECRET` deixa de ter default em produção — a
  api **não sobe** sem ela, com a chave de exemplo do repositório, ou com menos
  de 16 caracteres. Essa chave assina o `state` do OAuth de git, e o `state` é o
  que impede o callback de ser forjado; o default era público (está no
  `.env.example`), e o `docker-compose.prod.yml` o supria como fallback, então
  esquecer a variável subia produção assinando com uma chave conhecida — sem
  nenhum sinal. Rejeitar só o valor vazio não resolveria: no caminho real de
  erro a variável estava definida. **Quebra deliberada**: quem sobe o compose de
  produção precisa exportar a variável (o README mostra como; o `smoke.sh` gera
  a dele). Em Kubernetes nada muda. Ver ADR 0059 e RN-093

- **api**: a api passa a mandar `Content-Security-Policy` em toda resposta, e em
  produção ele nega tudo (`default-src 'none'`, mais `frame-ancestors`,
  `base-uri` e `form-action` em `'none'`). Antes o cabeçalho não era mandado —
  o argumento registrado no ADR 0027 era que o CSP é da web, o que continua
  verdade e não é o ponto: uma rota da api aberta DIRETO no browser (link
  colado, redirect) é renderizada na origem da api, onde o CSP da web não vale,
  e `frame-ancestors` só tem efeito no documento emoldurado. Fora de produção o
  perfil afrouxa apenas o que o Swagger UI de `/docs` exige. Nada muda para a
  web, que consome JSON: `Cross-Origin-Resource-Policy` segue permitindo outra
  origem, agora dito (`cross-origin`) em vez de omitido. Ver ADR 0058

- **api**: um `projectId` malformado deixa de escapar da raiz dos workspaces. O
  id chega do parâmetro de rota já com o percent-encoding decodificado pelo
  Express, então `..%2F..%2Fetc` chegava como `../../etc` e o caminho resolvia
  para fora — o que atingia tanto a leitura e ESCRITA do `permissions.json`
  quanto o escopo que autoriza comando de terminal (ADR 0055), isto é, a
  política de aprovação apontando para o lugar errado. Agora a raiz do escopo
  recusa o que não for segmento de caminho simples. O caminho feliz não muda:
  todo id real é UUID vindo do banco

- **ci**: o corpo do PR de promoção não quebra mais a tabela quando um título de
  PR termina em contrabarra antes de um pipe — escapar só o pipe produzia
  `\\|`, que o GFM lê como contrabarra escapada seguida de delimitador de coluna

- **web,api**: o dashboard não derruba mais a si mesmo quando o workspace tem
  muitos projetos. Cada card pedia sete coisas à api por conta própria e ficava
  repetindo o pedido a cada poucos segundos; com 23 projetos isso dava quase
  3.900 requisições por minuto contra um limite de 300, e a tela voltava cheia
  de erro antes de terminar de carregar — o mesmo valia para a barra lateral,
  que fazia isso em toda tela do app, não só no dashboard. Agora a grade
  inteira chega numa resposta só, e o custo deixa de crescer com o número de
  projetos: medido no navegador, caiu de 3.824 para 12 requisições por minuto.
  A tela mostra exatamente o que mostrava. A gaveta do sino passa a buscar as
  notificações quando você a abre, em vez de o tempo todo

- **web,api**: o painel de notificações também deixa de perguntar um projeto de
  cada vez. Com a gaveta aberta num workspace de 23 projetos ele fazia 286
  requisições por minuto, contra um limite de 300 — passava por pouco, e sumia
  com um projeto a mais. Agora o navegador diz de uma vez até onde já leu cada
  projeto e recebe tudo numa resposta: 12 requisições por minuto, sem mudar nem
  o conteúdo da gaveta nem a rapidez com que ele se atualiza

- **deps**: cinco alertas do Dependabot fechados por `pnpm.overrides` em
  `pnpm-workspace.yaml` — todos transitivos, nenhum tocado por bump direto de
  `package.json`. `js-yaml` (HIGH, GHSA-5p4m-2wfm-xmqj, DoS em `!!omap`) teve
  a faixa existente ampliada de `<4.3.0` para `<4.3.1`; `mermaid` (3
  MODERATE + 1 LOW, via `@docusaurus/theme-mermaid`); `postcss` (MODERATE,
  CVE-2026-69153, via a árvore `@csstools/postcss-*`); `fast-uri` (HIGH,
  CVE-2026-18446, via `ajv`/`@redocly/ajv`); `undici` (HIGH + 3 MODERATE,
  via `cheerio` e `jsdom`). Nenhum dos cinco chega no runtime da api ou do
  web em produção — são tooling do `website` (Docusaurus) e devDependency de
  teste (`jsdom`). Ver `pnpm-workspace.yaml` para o detalhe de cada faixa.

- **deps**: mais dois alertas fechados pelo mesmo mecanismo. `nanoid` (HIGH,
  CVE-2026-67213 — laço infinito com `size` zero), que entra por `postcss`; e
  `dompurify` (MODERATE — `IN_PLACE` deixa subárvore destacada executável,
  reabrindo XSS), que entra por `mermaid`. Os dois pais já eram alvo de override
  próprio. Segue aberto `image-size` (2 HIGH, DoS nos parsers ICNS/JXL/HEIF):
  não há versão corrigida publicada, a última do registry é a vulnerável — entra
  por `@docusaurus/mdx-loader` e só lê imagens versionadas neste repositório

- **api**: as áreas de agentes (`dev`, `qa`, `infra`) passam a existir de fato
  em cada projeto — antes a tabela nunca era gravada. A tela de Configurações
  listava vazio, a proposta da Anamnese para subir o teto de paralelismo era
  recusada com "área não existe neste projeto" em TODO projeto, e o teto que
  decide quantos agentes o produto sobe sem perguntar caía num default que
  ninguém tinha escolhido. Agora a área nasce junto com o projeto, na mesma
  transação, e a ativação da execução acrescenta os membros da área de dev (um
  por módulo). Projetos criados antes disso são corrigidos por migração, sem
  ação sua e sem mexer em teto que você já tenha alterado. Junto vai o fim de
  uma duplicação que sustentava o defeito: a lista de áreas existia escrita à
  mão em três lugares (api, web e engine), e agora tem uma fonte só, com as
  outras duas geradas por `pnpm --filter api gerar:areas`. Ver RN-094

- **web**: a aba Insights deixa de dizer "sem hipóteses ainda" quando a busca
  FALHOU. Era o mesmo `data ?? []` seguido de `length === 0` que a RN-088
  descreve: uma api respondendo 429 ficava indistinguível de um projeto que o
  Psicólogo nunca analisou. Agora a aba distingue carregando, erro (com a frase
  da api, o `trace_id` e o botão de tentar de novo) e vazio — nessa ordem, com o
  erro ANTES do vazio. A aba Aprovações ganha o mesmo tratamento nos seus quatro
  blocos, e o mais caro deles é a fila: "Tudo limpo — nenhuma aprovação
  pendente" sobre uma busca que falhou é a mentira mais cara que essa tela pode
  contar. A busca de regras que não acha nada agora diz "nenhuma regra
  corresponde à busca" em vez de "nenhuma regra configurada ainda"

- **web**: no card de hipótese, a confiança ("62% de confiança") vazava para
  fora do card e era desenhada por cima do card vizinho quando a coluna da grade
  ficava estreita. Achado pela validação visual no navegador, não por teste —
  jsdom não mede layout. Junto, dois alvos de clique que estavam abaixo do piso
  de 24px da WCAG 2.2 AA (os chips de evidência da hipótese e o de diff no
  histórico de instruções)
### Refatorações

- **web**: as telas de **Projeto** e **Sessão** passam a seguir o handoff de
  design (`design_handoff_brabo/`, seções 4 e 5). Nenhuma regra de negócio
  muda, e nenhuma tela ganha ou perde informação — o que muda é a forma. No
  Projeto: cabeçalho e régua de abas viram uma faixa só, com uma divisória em
  vez das duas que apareciam empilhadas; o repositório se apresenta em um chip
  (`local · privado`) e a branch padrão ganha o ícone e o destaque que o desenho
  pede; e a coluna de Atividade deixa de ser um card boiando a 24px da borda
  para virar o trilho de 360px do desenho, com rolagem própria — antes a página
  rolava inteira e o feed sumia de vista assim que a lista de agentes crescia.
  Na Sessão: a barra de topo ganha o fundo que a distinguia do chat, o balão de
  mensagem ganha contorno, o avatar ganha o anel na cor do agente, e a marca de
  passagem de bastão vira a frase que o desenho escreve (`Criativo → passou o
  bastão ao PO`) em vez do `handoff → po` cru — os dois nomes já estavam no
  evento, e metade se perdia. O painel de contexto se nomeia ("Contexto da
  sessão") e separa as seções por divisória. Três correções vieram junto, todas
  achadas ao comparar com o desenho: o **ponto de estado** era verde fixo, então
  uma sessão encerrada exibia o mesmo sinal de "ao vivo" de uma em curso (agora
  ele acompanha a máquina de estados e tem rótulo para quem não vê cor); o
  agente respondendo aparecia pelo **id** (`criativo`) depois de o evento
  persistir e pelo **nome** (`Criativo`) enquanto falava; e o título do convite
  do Criativo pedia `--font-display`, que não existe em `design/tokens.css`, e
  caía na fonte do navegador. Botão "Encerrar" passa a ter a aparência
  destrutiva que o desenho lhe dá. Verificado no navegador com
  `scripts/dev/validacao-visual.js`: nenhum achado de layout nas duas telas

### Manutenção

- **design**: o handoff de design passa a viver no repositório
  (`design_handoff_brabo/`: especificação + 8 telas de alta fidelidade), e
  `design/tokens.css` fecha contra ele. Entra `--violet` (`#9c7be0`, agentes/IA)
  — a última cor do handoff sem token, já hard-coded em quatro lugares do web
  justamente porque não havia o que referenciar — e `--shadow-lg`, a sombra
  grande do login, que cada tela que precisasse dela ia acabar escrevendo por
  conta. **Mudança visível**: `--shadow` estava mais rasa que a especificada
  (`0 8px 24px` a .35) e passa ao valor do handoff (`0 12px 32px` a .45), o que
  aprofunda a sombra de todo card, modal e dropdown. O teste de contraste cobre
  `--violet` nos quatro fundos em que ele é usado e ganha uma trava nova de
  paridade entre os temas: token semântico de cor declarado só no escuro não
  some no claro — ele VAZA, e o defeito aparece longe do commit que o causou. A
  dívida conhecida de contraste segue intocada, nos mesmos 4 pares. As fontes
  continuam **auto-hospedadas**: é a única divergência deliberada em relação ao
  handoff, que pede o `<link>` do Google Fonts — seguir esse item reintroduz a
  falha que o ADR 0036 fechou, porque a CSP do nginx bloqueia a folha e os
  arquivos

- **web**: **Aprovações** e **Configurações** passam a seguir o handoff
  versionado (`design_handoff_brabo`, seções 6 e 7). Só aparência: quem pode
  aprovar, o que a política decide e o pipeline de `proposed_action` não mudam.
  No card de aprovação, o card recorta e cada região traz a sua divisória —
  cabeçalho, corpo e ações deixam de flutuar dentro de uma moldura de 16px; o
  nome do agente ganha peso de título, a faixa que abre o diff vai para
  `--surface-2`, e o resumo da PR sai da caixa de código onde não deveria estar.
  Na fila, o vazio vira a moldura tracejada do desenho e a barra de seleção em
  lote sobe para o cabeçalho da seção, com "Limpar" — a faixa antiga empurrava a
  lista 44px a cada primeiro clique. Em Configurações, o repositório vira um
  card com o caminho em mono, as credenciais viram o **grid de conectores**
  (borda esquerda na cor do provider, sigla de duas letras, tipo e status
  pulsante) e o seletor de modelo ocupa a célula inteira da tabela, com o nome
  completo no `title` porque ali ele elipsa. `--violet` deixa de estar
  hard-coded no card de hipótese. **O que NÃO foi feito, e por quê**: a chave
  mascarada do desenho (é write-only, ADR 0050), "Selecionar todas" na fila
  (transformar aprovação em massa num clique é decisão de produto), a
  ordenação por urgência (nada no domínio classifica urgência de uma ação) e a
  seção "Melhores modelos por capacidade" (não há métrica de qualidade por
  modelo). Estão escritas em `design/SCREENS.md`
- **web**: o login e a lista de projetos passam a seguir o handoff, e o produto
  volta a ter **uma** marca só. A sidebar exibia um cubo isométrico enquanto as
  telas de auth exibiam o monograma B: o símbolo trocava exatamente na passagem
  do login para o app, e agora é o monograma nos dois lugares (o cubo continua
  disponível como ícone genérico, dito no código que não é a marca). No login, o
  campo de e-mail e senha afunda em `--code-bg` como na referência — divergência
  que o ADR 0036 registrara e que não se sustentava, já que afundar separa o
  campo do card igual e ainda melhora o contraste —, o card e o selo passam à
  sombra grande (`--shadow-lg`, que a FASE 16 trouxe justamente para isso) e o
  botão "Entrar" ganha os 44px que o handoff pede para a ação principal de uma
  tela; ele media 33px. Na lista de projetos, o medidor de tokens de cada card
  deixa de ter o mesmo fundo do card que o contém — a caixa desaparecia e
  sobrava a borda —, a última atividade ganha o fio que a separa do medidor e sai
  de `--text-muted` (3.89:1, a dívida conhecida) para `--text-secondary`, e o
  respiro do card, o raio dos avatares e o título da barra de topo (que virou um
  `<h1>` de verdade) alinham com a referência. Nenhuma regra de negócio muda; os
  três estados da RN-088 e a economia de requisições da RN-090/091 seguem como
  estavam. Duas coisas do handoff **não** entraram porque são comportamento e
  não pintura, e seguem declaradas: o "Continuar com GitHub" do login e o
  indicador "N agentes online"

## v2.4.0 — 2026-08-07

### Novidades

- **engine,api**: existe um **Dev Lead**. Quando você confirma que a
  arquitetura está pronta, ele recebe o trabalho junto com o Infra e propõe o
  plano de execução: quantos agentes em cada módulo e por quê. Antes, o
  Arquiteto terminava e a execução subia por um botão, sem ninguém no meio
  avaliando quanto trabalho havia — o teto de agentes já existia, mas a frase
  "quem decide é o lead" não tinha a quem se referir. Ele não escreve código.
  Como consequência, os dev de módulo deixam de receber handoff direto: quem
  fala com a execução de fora passa a ser o lead, como já acontecia com QA e
  Infra


- **engine**: quantas voltas um agente pode dar antes de desistir deixa de ser
  um número só para todos e passa a depender do trabalho que ele faz. O limite
  de 8 tinha nascido para agente de conversa, e era o mesmo do dev agent: numa
  execução real ele gastou as oito procurando onde ficava o projeto num
  repositório recém-criado e não chegou a escrever nada, terminando com uma
  mensagem que culpava o modelo por algo que o modelo nunca teve chance de
  fazer. Agora quem escreve código e quem revisa PR têm folga, e quem conversa
  continua no mesmo lugar — subir o limite de todo mundo teria feito o agente
  de conversa gastar mais sem motivo. Quem ganha folga é só quem já tem um
  teto de custo próprio por baixo

- **api,engine**: a Anamnese passou a reparar quando autorizar mais um agente
  virou rotina. Se você aprovou o mesmo pedido três vezes na janela e não negou
  nenhuma, ela propõe subir o teto daquela área — com o número de aprovações
  como justificativa. Uma única negação derruba a proposta: se você recusou
  alguma vez, o teto está fazendo o trabalho dele. A proposta **nunca se aprova
  sozinha**, e nem a de ultrapassar o teto: as duas ações que mexem em quanto o
  produto gasta sem perguntar agora são intocáveis por qualquer configuração de
  autonomia. Sem isso, um `permissions.json` permissivo tornaria o limite
  decorativo — e o produto poderia elevar o próprio teto de gasto


- **api,web**: o teto de agentes de cada área virou configurável em
  Configurações, e — mais importante — passou a valer de verdade. A regra do
  teto tinha entrado antes, mas nenhuma tela a consultava: o botão de subir mais
  um agente ainda ia direto, sem passar por ela. Agora o pedido passa, e quando
  ele estoura o teto a tela diz que **nada subiu** e que a decisão está
  esperando você em Aprovações — antes ela teria dito que o agente entrou, e
  você só descobriria que não pelo trabalho que não anda

- **api,web**: a esteira de gates no painel deixa de repetir a lista de etapas
  e passa a derivá-la do registro. O ganho não é visual: gate que sai do
  registro sai da tela sozinho — antes, desativar um deixava uma etapa morta
  até alguém lembrar de editar o código, que é exatamente o envelhecimento que
  o registro existe para impedir. A rota nova é do usuário logado e separada da
  interna, que serve o script de medição; ela devolve só os gates ativos,
  porque um gate planejado numa tela que mostra o agora apareceria como se
  estivesse acontecendo

- **api**: quantos agentes sobem numa sessão deixa de ser um número fixo no
  código e passa a ser decisão do lead da área — com um teto acima do qual você
  autoriza. Até o teto (2 por padrão) ele sobe e segue; acima disso vira uma
  ação pendente de aprovação, como toda ação com efeito externo, e a decisão
  fica registrada com o seu nome. O teto é da SESSÃO e não do módulo: contar
  por módulo permitiria muitos agentes sem autorização nenhuma, que era o
  buraco anterior com outro nome. As áreas de agente viram dado por projeto,
  no lugar da lista fixa em código — o que forçou a mudança foi a área de dev,
  cujos membros são um por módulo decidido pelo Arquiteto e portanto
  diferentes em cada projeto

- **engine**: o agente de gate espera a aprovação, como o dev espera (95ae7074)

### Documentação

- **changelog**: v2.3.0 (6f6f5be4)

## v2.3.0 — 2026-08-07

### Novidades

- **api**: amplia o allowlist do roteiro com critério explícito (a2d92a61)
- **api**: as fases backlog e execucao da validação real (e5d0edc9)
- **api**: a validação REAL da 13b começa, e a adoção remota está provada (f2882efa)
- reconhecer a falha ao proteger branches e seguir (Fase D, achado D) (82ef9a7e)
- o engine trabalha em repositório remoto (ADR 0056, achado N) (5efbbc6f)
- **api**: escopo de caminho na política de terminal (ADR 0055, achado U) (7c743982)
- **api**: sem escolha explícita, o modelo é o do Criativo (50ea7136)
- **api**: GET /internal/gates, e o registro dentro da imagem (1422629e)
- **api**: loader e medidor dos gates, com RN-070 e RN-071 (815af274)
- **docs**: os gates de CI no registro, e infra partido em dois (505ed78e)
- **api,docs**: FASE 15 e o registro declarativo de gates (7d766c4d)
- **web**: linha do tempo do time em árvore, e a FASE 14 no CLAUDE.md (19c86b5b)
- **web**: validação automática de contraste e de layout (62298567)
- **api,web**: o owner vê quanto as chaves dele gastaram (1ef1e71b)
- **engine,web**: falha de turno vira evento durável, e o agente fala (53bc32ee)

### Correções

- **api**: ReDoS polinomial no escopo de caminho (CodeQL HIGH) (17edbf9d)
- **api**: remove asserção redundante que o lint do CI pegou (9defddf3)
- **api**: redirecionamento não encadeia comando, e /dev/null não é caminho (67736ddd)
- **engine**: ação pendente num gate é origem POLITICA, não infra (b737874f)
- **api**: a credencial de git é do OWNER, não de quem decidiu a ação (c714d986)
- **engine**: a busca dizia a mesma coisa para "não achei" e "não há o que achar" (4f37e5a4)
- **api**: o medidor reprovava execução passada por restart posterior a ela (2bff2d6c)
- **api**: o aceite do OpenRouter rodou com credencial real, e estava podre (106c697d)
- **engine**: dev agent morria em vez de ir para idle quando a fila esvaziava (1a4c6dc5)
- **engine**: o Noop morria ao receber task.pr_settled, e a validação parava na 2ª task (a3874ffb)
- **api,engine**: o instrumento da validação da Fase 12 não conseguia chegar ao fim (a5867502)
- **engine,api**: os artefatos dos agentes param de nascer duplicados e a análise vazia (3c77de14)
- **api**: ação aguardando decisão segura a sessão (Fase H, achado V) (ef922005)
- **web**: remover `allModels`, que ficou órfão ao sair o `selectedModel` (9846410a)
- **web**: o feed narra o bootstrap, e o card para de inventar o modelo (12641ed7)
- **web,engine**: quem fala é o agente, e o convite e o rodapé param de mentir (26bc9ada)
- **engine**: a origem da falha é sempre uma das quatro (Fase G) (02c48dd1)
- **engine**: teto de bytes na saída de terminal, que sem ele mata a execução (445efb1e)
- **api**: o desfecho da ação nascia num agregado que o engine não lê (2ba5d14e)
- **engine**: a espera perdida no restart bloqueava em silêncio (09cd39f7)
- **api,engine**: o dev agent não conseguia explorar nem retentar (73e30e69)
- **api**: sessão criada fora do use case nascia sem processo no engine (6d665b70)
- **api,engine**: o Arquiteto adivinhava nome de módulo por força bruta (a69d6377)
- **web**: ActionType incompleto derrubava a tela da sessão (0d341cd5)
- **engine**: o turno em streaming caía no timeout default do Req (91d801ee)
- **api**: o medidor lia o ator do evento em vez do agente (a5af9765)
- **api**: o Arquiteto reemitia o module_map em laço (9e13020c)
- **api,engine**: heartbeat matava sessão com trabalho pendente (131c7289)
- **engine**: a Anamnese não tinha como dizer "não há nada a emitir" (b673d886)
- **engine**: três defeitos que só a execução real revelou (fae389c2)
- **api**: nenhum agente conseguia usar provider com credencial (376f53a6)
- **api,web**: o bootstrap morria em todo projeto GitHub novo (ee4f5b13)

### Documentação

- achado AD — o allowlist de verbos não converge, e a 13b conclui isso (b8f451a8)
- achado AC — redirecionamento torna qualquer comando inaprovável (f11dc942)
- a PR abriu no GitHub, e o gate não sabe esperar aprovação (5c5eaca6)
- permissions.md diz com qual credencial a ação auto-aprovada executa (d3837829)
- conserta o link do ADR 0052 que eu inventei (781ef443)
- a 5ª execução chega ao GitHub, e o pr_open auto-aprovado não tem credencial (abc25adf)
- o teto era a causa do achado X, e a Fase F não fecha a escada (9f2840f8)
- a correção do achado Y não fechou o X, e isso está registrado (42829b61)
- a validação real da 13b, executada e medida (41e1fb0b)
- o contrato do claim diz que fila vazia é 201 sem corpo (225f50a2)
- a validação da Fase 12 executada, com os event ids do banco (1d051fad)
- o glossário diz o segundo motivo de recusa de um artefato (549d6947)
- gates.md deixa de afirmar uma lacuna que foi fechada (c3217af3)
- a política e o registro de gates apontam a spec do promotion-check (6ad781f0)
- o remoto de trabalho no contrato api↔engine (86962106)
- ADR 0056 — o engine trabalha em repositório remoto (21b07147)
- a Fase A já estava feita, e o backlog não sabia (e71d6274)
- os dois achados que faltavam, e o quadro cobrindo os 19 (436f25ac)
- o 413 que matou a execução, e a origem que continua fora das quatro (d9f1d2eb)
- ADR 0055 — escopo de caminho na política de terminal (b8de978f)
- o wake precisa chegar, e o restart é a exceção que a página não dizia (baeb39a0)
- o que acontece com o agente enquanto a decisão não vem (592a24e2)
- RN-073, o ADR 0052 aceito, e duas frases podres no índice (1f477e03)
- FASE 13c — a triagem dos achados e o backlog consolidado (b4a5087d)
- ADR 0053 — o Dev Lead é agente conversacional na cadeia de handoff (1369969d)
- ADR 0053 — Dev Lead como área, e paralelismo autorizado (c57f3ad8)
- RN-068 e RN-069, e a allowlist do dev em permissions.md (d325c3fc)
- índice e contagens de ADR com o 0052 (cff3bedd)
- ADR 0052 — o dev agent espera a aprovação no meio do laço (985921b0)
- o link do ADR 0041 tinha o nome de arquivo errado (535c4d24)
- a colheita da primeira execução com modelo de API (62d23221)
- **changelog**: a versão do README acompanha o corte da v2.2.0 (6d2fafd6)
- **changelog**: v2.2.0 (5b83391b)

### Testes

- **ci**: spec do promotion-check, o único check required sem teste (9e0d625e)
- **engine**: a corrente do outbox até o agente, provada de ponta a ponta (fdba5f73)
- **engine**: a suspensão e a retomada do laço, provadas (d3e1e11a)

### Manutenção

- **ci**: o teto do nome de função sobe de 15 para 30 caracteres (344f6089)
- **engine**: postgrex 0.22.4 fecha a advisory EEF-CVE-2026-66838 (cea7e837)
- o inventário de config e a formatação que só o CI pegou (21198d6e)
- os achados da execução real em docs/, e quatro deles corrigidos (4dd7a073)
- **engine,docs**: formato do Elixir e as três docs que o drift cobrava (e01ee61f)
- **ci**: o release passa a escrever a versão do README junto do CHANGELOG (41f02548)

## v2.2.0 — 2026-08-04

### Novidades

- **api,web**: facetas de capability lidas do provider e curadoria por uso (e722470b)
- **web**: catálogo agrupa hub por fabricante, com colapso (88a1169a)
- **web,api**: Configurações segue o mockup e ganha custo por agente (ba0f2d3c)
- **api,web**: credencial sempre cifrada; verificar vira ação à parte (99b9fa72)

### Correções

- **engine**: um agente de gate que esbarra numa aprovação pendente deixa de
  matar o gate. Ele agora **espera** — como o dev agent já fazia — e a decisão o
  retoma de onde parou, com o resultado de verdade no lugar onde estava a
  palavra "pendente". Antes a suspensão era classificada como falha de
  infraestrutura, a tarefa era bloqueada por uma decisão que ninguém tinha
  tomado, e o clique do usuário chegava tarde demais para servir. Enquanto está
  esperando, a área de QA não consolida, não emite veredito e não bloqueia nada.
  Recusa também retoma: o motivo entra no lugar do resultado, e o agente aprende
  que aquele caminho fechou em vez de esperar para sempre

- **api**: comando com redirecionamento deixa de exigir aprovação sempre.
  `2>/dev/null` é idioma — modelos o usam o tempo todo para silenciar erro
  esperado —, mas o parser tratava `>` como se encadeasse um comando novo, e o
  alvo virava um segmento cujo "verbo" era o próprio caminho. Como comando
  composto só é auto-aprovado quando todo segmento está liberado, qualquer
  redirecionamento caía em aprovação, e a autonomia ficava inútil na prática.
  Agora `>`, `>>` e `<` não quebram segmento, e os fluxos padrão e o
  `/dev/null` deixam de contar como caminho de usuário. **O que não mudou:**
  redirecionar para fora da pasta do projeto continua barrado, `/dev` não foi
  liberado inteiro, e `&&`, `|` e `;` continuam separando — cada uma dessas
  três garantias tem teste próprio

- **engine**: um agente de gate que esbarra numa ação pendente de aprovação
  deixa de registrar "falha de infraestrutura". Nada quebrou — a decisão apenas
  não foi tomada, e o log agora diz isso, nomeando a ação e a ferramenta para
  que dê para encontrá-la e decidi-la. O gate ainda bloqueia a task: o laço dos
  agentes de gate é síncrono e não sabe retomar de onde parou, ao contrário do
  dev agent. O que muda é parar de culpar a infraestrutura por uma decisão
  pendente

- **api**: nenhum dev agent conseguia abrir PR em repositório remoto quando a
  autonomia estava ligada. A credencial de git vinha de quem DECIDIU a ação — e
  ação auto-aprovada por política não tem decisor, então o token ficava vazio e
  o GitHub recusava. Agora vem do dono do workspace, pela mesma regra que já
  valia para as chaves de modelo. O contraste que expôs o defeito estava dentro
  de uma execução só: o push funcionava e a PR falhava, porque cada um resolvia
  a credencial por um caminho diferente

- **engine**: a busca no workspace deixa de dizer a mesma coisa quando não
  encontra e quando não há o que encontrar. Num projeto novo, o dev agent lia
  "nenhum resultado" como "refine a busca" e repetia buscas até esgotar o teto
  de iterações — bloqueado sem ter rodado um comando nem escrito uma linha.
  Agora um workspace sem arquivo nenhum responde que está vazio e manda criar;
  um workspace com arquivos responde quantos tem, deixando claro que a busca
  funcionou e o termo é que não aparece. A correção é a frase, não o teto: o
  agente não precisava de mais iterações, precisava saber que não havia o que
  procurar

- **api**: o aceite do OpenRouter contra a API real voltou a funcionar. Ele
  nunca tinha rodado — sem chave, a suite inteira é pulada — e por isso tinha
  apodrecido em silêncio contra a mudança que levou a curadoria de modelo para
  o escopo de workspace: afirmava um campo que não existe mais no catálogo
  global e montava dois casos de uso com assinaturas antigas. Nada disso era
  detectável por CI, porque o typecheck da api não cobre os testes. Agora
  afirma a regra pelo caminho certo — modelo descoberto nasce desligado
  naquele workspace, e desligado é a ausência de linha

- **engine**: o dev agent **morria** quando a fila do módulo esvaziava, em vez
  de ficar ocioso. Com nada a reivindicar, a rota de claim responde `201` sem
  corpo — o caso de uso devolve `null`, mas isso vira resposta vazia, e o
  cliente entregava `""` no lugar de `nil`. O agente tratava a string vazia
  como se fosse uma task e estourava, e como o processo não é reiniciável, ele
  morria de vez, com o estado apagado logo atrás. É o oposto do que a Fase 12b
  entregou: em vez de um agente ocioso, supervisionado e acordável por evento,
  processo morto — e no desfecho mais comum que existe, o da fila acabando.
  Nenhum teste pegava porque o dublê da suite devolvia o valor certo; só
  execução real expôs

- **engine**: o dev agent de validação (sem LLM) não abria o gate depois de
  publicar a PR — marcava a tarefa como em revisão e parava aí, deixando o
  gate sem nada para julgar. E morria ao receber o aviso de que a PR foi
  resolvida, quando o gate já estava aberto. As duas coisas faziam a validação
  da Fase 12 travar sem dizer por quê

- **api**: o roteiro de validação da Fase 12 criava o repositório-cobaia num
  diretório temporário local, invisível para o processo que precisa cloná-lo.
  Passa a criá-lo no volume compartilhado, que é o pré-requisito que o próprio
  roteiro já declarava, e limpa os restos das corridas anteriores

- **web**: fixture do ModelPicker sem as facetas novas quebrava o build (00a23381)
- **api,docs**: o DTO da resposta do teste de credencial e a contagem de ADR (5021192c)
- **web**: corpo vazio da api e rolagem da lista de modelos (7be6b29d)
- **api**: o decorator de tracing perdia listModels e matava o sync de catálogo (429a3228)
- **api**: o CSRF nascia em /auth e o refresh nunca funcionou no browser (b5430acf)

### Refatorações

- **web**: as @font-face saem do index.css para um arquivo próprio (59b78632)

### Documentação

- o README anuncia a versão de verdade, e o CI passa a cobrar isso (265055c0)
- CHANGELOG da rodada e o escopo da FASE 13 (5696bdf0)
- **changelog**: v2.1.0 (becec969)

### Manutenção

- **design-sync**: re-sync do design system — 66 componentes no Claude Design (3c9b6ad8)

## v2.1.0 — 2026-08-03

### Novidades

- **web,docs**: aprovações somadas por sessão (achado #16) (3506970)
- **web,docs**: Insights ganham aba própria, com contador (achado #15) (34ba57f)

### Correções

- **api,web,docs**: destrava a esteira — lint, e o gatilho de drift que eu criei à toa (7382203)
- **api,web,docs**: o bootstrap para de criar a branch rc (achado #3) (a989e87)
- **api,docs**: handoff a subagente é recusado, com o lead no erro (achado #12) (dd3de59)
- **api,engine,docs**: reativar a execução volta a ter efeito (achado #11) (39ab1f6)
- **engine,api,docs**: falha de git sem motivo, e dois comentários que mentiam (4b49b15)

### Documentação

- **changelog**: v2.0.0 (9336246)

## v2.0.0 — 2026-08-03

### ⚠ Mudanças incompatíveis

- **api,web**: a curadoria de modelo passa a ser por workspace (aae747d)

### Novidades

- **api**: Ollama e Anthropic descobrem o próprio catálogo (3b8a54e)

### Correções

- **api**: o preço da Vultr é oficial e nenhuma troca de preço escapa da auditoria (acf0ad1)
- **ci**: PR de workflow nascia sem checks, e quebra não chegava ao changelog (44dec9b)
- **scripts,ci**: o CHANGELOG e as notas de release estavam vazios (9976b70)

### Documentação

- **api**: a rota interna de sync não é "do workspace inteiro" (0962c05)
- **branching**: o CHANGELOG volta por PR depois do release (fc570b6)

## Unreleased

### Novidades

- **api,engine**: o dev agent passa a **esperar** a aprovação em vez de queimar
  iterações. Ferramenta pendente suspendia o agente em nada: o `pending` voltava
  como resultado, o modelo lia como resposta do comando, e cada tentativa
  gastava uma iteração até a task morrer no teto sem uma linha escrita — com as
  aprovações do usuário chegando tarde demais para servir. Agora o laço para
  retendo worktree e histórico, e a decisão o retoma com o resultado de verdade
  no lugar certo. Recusa também retoma, com o motivo: o agente aprende que o
  caminho fechou em vez de esperar para sempre

- **api**: sessão nova e dev agent param de nascer no modelo local do
  workspace. Quando ninguém configurou nada para o projeto, o modelo herdado
  passa a ser o do **Criativo** — ele é a porta de entrada, e o binding dele
  representa o modelo que o projeto usa para pensar. A herança ocupa o vazio e
  nunca sobrepõe: escolha explícita de sessão, agente ou projeto continua
  vencendo. Antes era preciso trocar o modelo à mão em toda sessão aberta, e os
  dev agents subiam em `llama3.2:1b`, que o ADR 0020 proíbe no passo semântico

- **api,docs**: os gates do fluxo viram **registro declarativo** em
  `docs/gates.yml` — treze deles, que até agora só existiam espalhados entre
  regra pura, use case, teste e workflow. O registro descreve e não executa:
  trocar um campo nele não muda comportamento nenhum. O que ele compra é os
  gates ficarem enumeráveis, e com isso mensuráveis por
  `pnpm --filter api validacao:gates`, que extrai do event log a última
  passagem de cada um. Cada gate diz ONDE mora a prova dele
  (`event_log | teste | ci`), porque nem toda prova está no log: a trava de
  merge é garantida por teste e o backmerge é CI. Enumerar já rendeu três
  achados antes de medir qualquer coisa — o gate de PR de infra, que ninguém
  tinha listado; um check required sem teste próprio; e um filtro que apontava
  para coluna em vez de payload, fazendo um gate parecer nunca ter passado
- **api**: `GET /internal/gates` devolve o registro validado. O arquivo passa a
  viajar dentro da imagem de produção — sem isso a rota funcionaria em
  desenvolvimento e responderia erro só em produção, porque `docs/` inteiro é
  ignorado no build

### Correções

- **web**: erro de carregamento parou de virar **tela branca**. Abrir um projeto
  com a api limitando por `429` devolvia a área principal inteiramente vazia —
  sem mensagem, sem estado de erro, sem esqueleto —, porque a tela testava
  `if (!project) return null` e com isso tratava "a api recusou" e "ainda não
  chegou" como a mesma coisa. Agora a tela DIZ o que houve, com a frase que a
  api mandou (é ela que sabe a diferença entre "tente em instantes" e "você não
  tem acesso"), o `trace_id` para quem for investigar e um botão de tentar de
  novo. No dashboard o defeito era pior que branco: `!projects` também era
  verdadeiro no erro, então a tela convidava a **criar o primeiro projeto** de
  um workspace que podia ter vinte. A barra lateral também fala, com o texto
  cabendo nos 248px que ela tem (RN-088)
- **web**: a app parou de responder ao rate limit da api com **mais tráfego**.
  Uma sessão real acumulou 1128 erros `429` num console só: o TanStack Query
  retentava três vezes cada falha e os ~25 polls de 3 a 5 segundos seguiam
  batendo na mesma porta, num laço que impedia a janela deslizante do limite de
  se refazer. Agora 4xx não se retenta — 429 é literalmente o servidor pedindo
  para parar, e 401 já renovou a sessão por dentro — e todo poll para quando a
  query erra, voltando sozinho no foco da janela, na remontagem da tela ou no
  botão de tentar de novo. 5xx e falha de rede continuam com as três
  tentativas, que ali é a reação certa
- **web**: projetos de **mesmo nome** deixam de ser indistinguíveis na barra
  lateral. Uma execução de validação criou vinte `validacao-real`, e as vinte
  linhas eram idênticas. Quem repete nome passa a mostrar o id abreviado e a
  data de criação, que já vinham no payload; nome único não ganha legenda
  nenhuma, porque desempate em toda linha seria ruído no lugar com menos espaço
  da tela
- **engine**: o Psicólogo parou de analisar sessão **sem nada a analisar**. Uma
  sessão cujo log inteiro era provisionamento de repositório passava pelo
  critério de tamanho, ganhava a análise, e o modelo — sem evento algum para
  citar — inventava `seq` inexistentes até a validação de evidência rejeitar e
  ele desistir, com o orçamento já gasto. A contagem que decide se vale a pena
  agora desconta os passos de máquina do bootstrap e o rastro que os próprios
  analistas deixam na sessão: contar o turno anterior do Psicólogo fazia uma
  sessão vazia parecer povoada a partir da primeira análise, e cada retentativa
  a enchia mais. Não havendo material, a análise não roda e o desfecho fica no
  log como `psychologist.analysis_skipped` — inclusive no reprocessamento
  manual, onde quem clicou recebe o motivo em vez de uma hipótese inventada

- **engine**: regra de negócio com título já registrado **no projeto** passa a
  ser recusada na emissão. Rodar o Criativo duas vezes deixava as mesmas regras
  duplicadas, metade delas órfãs; como o artefato é um evento de domínio, e
  evento não é apagado nem editado, a entrada é o único momento em que dá para
  recusar. A checagem é por projeto e não por sessão, que é onde a duplicata
  nasce — a segunda rodada abre sessão nova. O erro volta ao modelo, que segue
  para a próxima regra

- **api**: o PO parou de criar história com título idêntico a uma que já existe
  no projeto, e passa a **avisar** quando uma história nova não acrescenta
  cobertura nenhuma — todas as regras que ela cita já estavam cobertas por
  outra. São respostas diferentes de propósito: título repetido é erro e
  bloqueia; justificativa repetida é suspeita e vira
  `backlog.story_overlap_warned`, porque um segundo recorte da mesma regra pode
  ser legítimo e quem julga isso é o usuário. Sobreposição **semântica** — dois
  títulos diferentes para o mesmo endpoint — continua passando, e há teste
  afirmando esse limite em vez de deixá-lo implícito

- **api**: o bootstrap de Gitflow morria no primeiro passo em **todo projeto
  GitHub novo**. Repositório recém-criado não tem commit nenhum, e aí a Git
  Data API inteira do GitHub responde `409 Git Repository is empty` — o
  provider tratava só `404` e nunca alcançava o próprio caminho de "primeiro
  commit" que já tinha escrito. Agora o commit inicial sai pela Contents API,
  que é a única que funciona em repo vazio. O backend falso dos testes também
  foi corrigido: ele respondia `404` onde o GitHub responde `409`, e era por
  isso que a suite ficava verde enquanto o produto quebrava
- **web**: o wizard avisa, ao escolher **repositório privado no GitHub**, que o
  plano gratuito não aceita proteção de branch — antes a limitação só aparecia
  no último passo do bootstrap, com o repositório já criado e a mensagem crua
  da API na tela

- **ci**: a PR de changelog que o release abre passa a trazer junto a versão
  anunciada no `README.md`. Sem isso, o check de versão (novo nesta rodada)
  reprovaria toda PR de release — que é aberta pelo bot e só toca o CHANGELOG,
  então nasceria vermelha esperando uma mão humana que a política não prevê

### ⚠ Mudanças incompatíveis

- **api**: `GET /models` deixou de existir. A lista do seletor virou
  `GET /projects/:projectId/models` porque a curadoria passou a ser **por
  workspace** (ADR 0049): `models.is_active` era uma coluna para a instalação
  inteira, e um owner do workspace A ligando um modelo o ligava para o B — com
  o gasto caindo no orçamento de quem não decidiu nada. O catálogo em si
  continua global (nome, preço e capabilities são fato do provider); só a
  decisão "aparece no seletor?" mudou de lugar, para a tabela nova
  `workspace_models`. A migração `0034` dá a cada workspace existente
  exatamente o que ele enxergava antes, **antes** de derrubar a coluna. Quem
  consome a api por fora precisa trocar a rota; a UI já foi junto

### Novidades

- **api,web**: o catálogo passa a saber **quais modelos leem imagem, quais
  geram imagem e quais fazem thinking**, e a tela filtra por isso. O sync nunca
  consultava o provider sobre modalidade — lia `supports_vision` do que já
  estava gravado, que tinha nascido `false` —, então os 338 modelos do primeiro
  sync real do OpenRouter ficaram todos sem vision, incluindo os 181 que o
  próprio provider declara multimodais. Aceitar imagem e **produzir** imagem
  viraram eixos distintos: quem lê diagrama e quem desenha resolvem problemas
  diferentes. Modalidade que o provider não declara continua omitida em vez de
  virar `false` — silêncio não apaga o que estava lá (ADR 0051)
- **api,web**: **curadoria por uso** — você marca para que este workspace usa
  cada modelo (código, documentação, análise, imagem, conversa) e filtra o
  catálogo por isso. Nenhum provider publica "bom para código"; isso é opinião
  de quem opera, então vale só no seu workspace, como toda curadoria desde o
  ADR 0049. Marcar uso **não liga** o modelo no seletor, e trocar o uso não
  desliga o que já estava ligado — os dois eixos não se misturam
- **web**: um filtro que zera a lista deixa de ser confundido com catálogo
  vazio: antes a tela mandava cadastrar uma credencial que já existia
- **web**: a aba Sessões passa a somar as **aprovações de cada sessão** — o que
  ainda aguarda você, o que você já decidiu e o que a política auto-aprovou —,
  além do total do projeto. Tudo o que existia vinha de `usePendingActions`,
  que exige um `sessionId`, e os três chamadores passavam o da sessão mais
  recente: uma decisão esquecida numa sessão anterior ficava invisível para
  sempre. A separação entre clique humano e política sai de colunas que a
  execução não reescreve (`decidedBy` e `resolvedPolicy`) — contar por `status`
  perderia a ação aprovada que já executou, que é justamente a métrica que a
  Fase 10 não conseguiu colher
- **web**: os Insights do Psicólogo ganham **aba própria**, com contador de
  hipóteses aguardando decisão. Eles moravam no fim da Visão geral, embaixo do
  painel do time, da execução e da arquitetura — quatro assuntos numa coluna
  só, na aba que abre por padrão, e a fila de decisões do Psicólogo ficava
  fora da tela sem nenhum sinal de que existia. Agora ela fica ao lado das
  outras duas filas de decisão do projeto (backlog e aprovações), cada uma com
  seu próprio contador: somá-las esconderia qual está pedindo atenção
- **api**: Ollama e Anthropic passam a declarar `listModels` e a ter o catálogo
  descoberto pelo sync — o backlog que o ADR 0042 deixou aberto. Os dois
  formatos foram verificados na doc oficial antes de uma linha de código: o
  Anthropic pagina **por cursor** (`has_more`/`last_id`, percorrido pela
  auto-paginação do SDK oficial) e o Ollama lê `GET /api/tags` no host de
  `OLLAMA_HOST`. Nenhum dos dois informa preço, então o modelo entra no catálogo
  **sem preço** em vez de com preço inventado

- **api,web**: cadastrar credencial (chave de LLM ou token de git) passa a
  **sempre cifrar e gravar**, e verificar virou ação própria:
  `POST /users/me/credentials/{provider}/test`, que decifra no servidor e
  devolve só o veredito — `ok`, `recusado` (com o motivo do provider) ou
  `nao_suportado`. Antes o cadastro testava a chave antes de persistir e
  recusava a gravação; como o campo é write-only e a tela nunca reexibe o que
  foi digitado, uma recusa deixava o usuário sem credencial **e** sem o texto
  para corrigir. O terceiro estado existe porque `ollama`/`anthropic`/`openai`
  não têm endpoint de teste verificado: num veredito binário eles voltariam
  `ok`, e a tela afirmaria uma verificação que ninguém fez. A tela de
  configurações ganhou junto o campo de **troca** (antes era preciso remover
  para trocar) e o botão **Testar** (ADR 0050, RN-055)
- **api**: credencial passa a ter teto de **512 caracteres** nas duas rotas de
  cadastro. É proteção contra payload absurdo numa rota que cifra (e portanto
  copia) a entrada — mesma natureza do `@MaxLength` da senha —, **não**
  validação de formato: cabe com folga a maior credencial conhecida (~164, a
  project key da OpenAI) e continua aceitando uma chave pela metade, que quem
  desmascara é a rota de teste

- **web,api**: a tela de **Configurações** passa a seguir o mockup do design
  system (`design/SCREENS.md`). "Modelos por agente" ganha as duas colunas que
  faltavam — **FALLBACK** (o nível da cascata que valeria se o vigente sumisse,
  derivado dos bindings de projeto e workspace) e **EST. MÊS** por agente — mais
  o card de **custo estimado do time**, alimentados por
  `GET /projects/:projectId/agent-costs`, agregação nova de `token_usage` numa
  janela deslizante de 30 dias (só `actor_kind = agent`, RN-038). Agente que
  nunca rodou aparece com traço, não com zero. Avatares, badges, densidade de
  tabela, cabeçalhos de seção e a legenda da matriz de papéis passam a usar as
  métricas do desenho. Duas divergências ficam, e por escrito: o custo aparece
  em **USD** (o mockup mostra BRL, mas converter exigiria uma taxa de câmbio, e
  moeda com taxa manual é backlog) e o convite continua pedindo o **ID do
  usuário** (a api não tem rota que resolva e-mail — um campo prometendo e-mail
  seria um formulário que não funciona)

- **web**: o catálogo de modelos passa a **repartir os hubs por fabricante**. Um
  hub devolve o catálogo de dezenas de fabricantes numa lista só — o OpenRouter
  trouxe **338** —, e uma lista plana desse tamanho não é navegável: achar o
  Claude ali era rolagem, não escolha. O fabricante sai do prefixo do id
  (`anthropic/claude-…`), então não houve mudança de banco; os subgrupos vêm do
  maior para o menor (OpenAI 60, Qwen 49, Google 30, Mistral 18, Anthropic 17…)
  e a contagem aparece ao lado de cada rótulo. Modelo sem namespace cai num
  grupo à parte em vez de sumir. APIs diretas não ganham subgrupo — ali o dono
  do modelo já é o provider. Cada fabricante **abre e fecha**, e todos começam
  fechados: 58 subgrupos abertos de saída devolvem a mesma lista quilométrica
  que o agrupamento existe para evitar, enquanto fechados os cabeçalhos com
  contagem viram um índice. Um subgrupo fechado que contenha itens marcados diz
  isso no cabeçalho — sem esse selo a barra de lote contaria "12 selecionados"
  sem que houvesse como ver quais, e a ativação em lote seria às cegas.
  **Local e APIs diretas também colapsam**, e um botão **Minimizar tudo /
  Expandir tudo** fecha ou abre grupos e subgrupos de uma vez (ele mostra a
  AÇÃO, não o estado). O cabeçalho do hub passa a **nomear quem o serve** —
  `Hubs · OpenRouter` —, porque preço, disponibilidade e credencial pertencem ao
  hub e não ao fabricante do modelo; nas APIs diretas isso não se repete, já que
  a própria linha diz o provider

### Correções

- **api**: o **refresh de sessão voltou a funcionar no browser** — na prática,
  nunca funcionou. O cookie `brabo_csrf` era gravado com `Path=/auth`, junto do
  refresh, mas `document.cookie` só expõe cookies cujo path é prefixo do path da
  PÁGINA: a web vive em `/`, `/login` e `/projects/...`, e nunca enxergou o
  cookie que ela precisa ecoar no `X-CSRF-Token`. O cabeçalho ia vazio e todo
  `POST /auth/refresh` morria em 403, então a sessão caía no primeiro reload —
  ou quando o access token de 15 minutos expirava — e o sintoma (voltar para o
  login) não parecia bug de cookie. Agora cada cookie tem o seu path: o CSRF em
  `/` (é um valor aleatório para ecoar, não credencial) e o refresh onde sempre
  esteve, `/auth` e `httpOnly`. Nenhuma proteção foi afrouxada
- **api**: o **sync de catálogo voltou a funcionar** — estava morto para os
  nove providers. `TracedLLMProvider`, o decorator de tracing por onde o
  registry faz TODO provider passar, encaminhava `name`, `capabilities` e
  `chat` e deixava `listModels` de fora. Como o sync exige os dois lados
  (a capability **e** o método), ele pulava cada provider com
  `pulado: 'sem_capability'` — um relatório que mentia, já que a capability
  estava declarada e quem a perdia era o decorator. Efeito prático: nenhum
  modelo de provider remoto jamais entrava no catálogo, e o seletor só
  oferecia os locais mesmo com credencial válida cadastrada. Com o
  encaminhamento no lugar, um sync trouxe 338 modelos do OpenRouter
- **web**: resposta da api **com corpo vazio** deixa de derrubar a tela. O
  cliente tratava só o `204` e fazia `res.json()` em tudo o mais — mas um
  handler que devolve `null` responde **200 sem corpo**, e `null` é o que o
  domínio diz o tempo todo (projeto sem orçamento, agente sem binding, projeto
  sem repositório: seis funções do cliente já declaravam `| null`). O
  `SyntaxError` cru subia até o `QueryCache.onError` e matava a query inteira,
  então a tela de configurações perdia a lista de modelos por causa de um
  agente sem binding
- **web**: a lista de modelos **fecha ao rolar dentro dela**. O listener de
  `scroll` era de captura e não olhava o alvo, então a primeira volta da roda
  do mouse sobre o dropdown o fechava — e a rolagem seguia para a página
  atrás. Com mais modelos do que cabem na altura máxima, os de baixo eram
  inalcançáveis. Rolar a **página** continua fechando, que é o
  comportamento pretendido (o dropdown é `fixed` e descola do gatilho)
- **web**: a tela de catálogo passa a **avisar quando há credencial de um
  provider e nenhum modelo dele**, apontando o botão "Atualizar catálogo".
  Cadastrar a chave não descobre modelo — quem descobre é o sync —, e nada
  ligava as duas coisas: uma chave de OpenRouter válida e testada convivia com
  um seletor que só oferecia modelos locais
- **web**: o botão Salvar da seção de credenciais **parecia não ter ação**. Ele
  tinha: a api respondia `422` e o `ApiError` escapava do `onClick` para o
  `window.onunhandledrejection`, que só escreve no console. Sem `try/catch`,
  sem toast de erro e sem estado de carregando, seis cliques seguidos não
  produziram nenhum sinal na tela. Todo caminho da seção (salvar, testar,
  remover) passa a reportar a mensagem que a api mandou
- **api,web**: o bootstrap para de criar e proteger a branch `rc`, e o
  `branching-policy.md` que ele **commita no repositório do usuário** passa a
  descrever a escada de três degraus. O `rc` saiu da política pelo ADR 0030
  ("sem ambiente e sem gente para exercê-lo, seria degrau cerimonial") e o
  `pr-police` do CI opera com três desde então — o bootstrap era o último lugar
  que ainda ensinava a escada de quatro, dentro do repositório de quem usa o
  produto. São cinco passos agora, não seis. Duas coisas ficam como estão de
  propósito: o valor `create_rc_branch` continua no enum `bootstrap_step`
  (linhas antigas o referenciam, e passo que aconteceu não se apaga), e `rc`
  continua na lista de merge protegido — desproteger uma branch que ainda
  existe em repositórios antigos custaria caro. Efeito na adoção: um repo com
  `rc` passa a vê-la classificada como branch **extra**, descrita no plano e
  nunca tocada, que é o que ela é hoje
- **api**: handoff endereçado a **subagente** passa a ser recusado, com erro
  que nomeia o lead a quem o chamador devia falar. O ADR 0038 pediu essa
  validação nomeando o lugar — `CreateHandoffUseCase` é o único do sistema que
  grava `toAgent` — e ela nunca tinha sido implementada: a `offer_handoff` do
  engine repassa `to_agent` como string livre, então nada impedia um agente de
  se dirigir direto a `qa-automacao` e furar a hierarquia. A recusa acontece
  **antes** do insert, senão sobraria um handoff fantasma e um
  `handoff.offered` — evento imutável — afirmando uma oferta que a política não
  permite. Área/lead/membros continuam hardcoded (o corte de escopo da Fase 8
  segue de pé); o que impede as cópias de divergirem é teste (RN-054)
- **api,engine**: reativar a execução volta a ter efeito. Ativar um projeto que
  já estava executando era **no-op** para todo agente já vivo (`if origin ==
  :started`), então um dev parado em `idle` — fila vazia no claim anterior — só
  voltava a trabalhar por acidente, quando outra task ficasse pegável e o
  outbox o acordasse por outro caminho. Agora ele recebe um wake, e o guard de
  estado decide: `idle` reivindica, `working`/`awaiting_gate` seguem intactos e
  `idle_tripped` continua exigindo rearm explícito (RN-047 preservada). Junto,
  a ativação deixa de abrir uma **sessão órfã** por clique: ela reusa a sessão
  de execução vigente, porque o engine descarta o `session_id` novo quando o
  agente já existe — a sessão nova nascia ativa, recebia o
  `execution.activated` e nunca mais recebia nada, enquanto os eventos dos
  agentes continuavam na anterior (RN-053)
- **engine**: falha de git deixa de chegar **em branco**. `System.cmd/3` com
  `cd:` apontando para diretório inexistente não levanta exceção — devolve
  `{"", 2}` —, e isso virava `{:error, ""}`: o usuário via a ação falhar sem
  motivo nenhum. Era o buraco de diagnóstico que o ADR 0048 fechou pela causa
  raiz (o gate abrindo antes da PR) e deixou registrado como backlog, porque
  vale para **qualquer** falha de diretório, não só aquela. Toda chamada de git
  do engine passa a nomear comando, status e diretório quando o git não diz
  nada; quando ele diz, a saída continua verbatim — quem lia `nothing to
  commit` continua lendo
- **api**: o preço dos três modelos da Vultr passa a ser o **oficial**
  (`$0.55`/1M de entrada, `$2.75`/1M de saída, tarifa única do serviço). A
  estimativa anterior errava na direção perigosa — `400_000` micros de saída em
  dois dos três modelos, contra `2_750_000` reais: o metering subestimava o
  custo de saída em quase **7×**, e é a saída que domina a conta de um agente
  que escreve código. NVIDIA NIM e Bitdeer seguem estimados, e agora com o
  motivo registrado: a NVIDIA **não cobra por token** (prototipagem gratuita +
  licença por GPU/hora) e a Bitdeer monta a tabela de preço no cliente
- **api**: o sync de catálogo parava de sobrescrever preço marcado como
  `manual_pricing`. O schema sempre disse que quem sincroniza não pode
  sobrescrever essa linha sem decisão explícita; o código deixava o remoto
  vencer sempre que trouxesse preço, e o sync seguinte desfazia a correção de
  quem tinha arrumado um número errado (RN-051)
- **api**: toda troca de preço passa a deixar linha em `model_price_changes`.
  A origem `sync` existia no domínio desde a Fase 9c e **nenhuma escrita a
  produzia** — o sync trocava preço por fora do caminho auditado, e o `seed.ts`
  fazia o mesmo sobre banco já semeado (`BRABO_FORCE_SEED=1` no `bootstrap.sh`
  do k8s). Corrigir um preço no seed mudava o número em silêncio (RN-044)
- **ci**: a PR de promoção nascia com os checks **travados**. `promote.yml`
  abria o PR com o `GITHUB_TOKEN`, e evento criado por esse token não dispara
  workflow de PR — os sete checks nasciam em `action_required`, esperando
  aprovação manual. Na prática o PR chegava a `MERGEABLE` com quatro checks
  herdados do push da origem e **sem o Check de promoção ter rodado**: quem
  mergeasse sem reparar promovia sem o portão que valida range limpo, degrau
  carimbado e merge commit possível. Passa a usar `BRABO_BOT_TOKEN`, o mesmo
  remédio que o `tag-release.yml` já aplicava desde a v0.2.0 — cujo aviso diz,
  literalmente, "nem abre PR com checks". O passo do CHANGELOG no `release.yml`
  tinha o mesmo defeito e foi corrigido junto
- **ci**: o `pr-police` passa a exigir que `breaking/` e o marcador de quebra
  no commit (`!` ou `BREAKING CHANGE:`) andem juntos, nas duas direções. Eram
  dois mecanismos para o mesmo fato, soltos: a versão sai da FUNÇÃO da branch,
  e o CHANGELOG detecta quebra pelo MARCADOR. `breaking/fase-7-auth-e-openapi`
  removeu o Keycloak, subiu MAJOR corretamente — e nenhuma das doze versões
  tem seção de "⚠ Mudanças incompatíveis", porque **nenhum commit do histórico
  jamais usou os marcadores**. As versões já lançadas seguem sem a seção: os
  commits são imutáveis e o gerador não tem de onde inferir; a regra vale daqui
  para frente
- **docs**: o `CONTRIBUTING.md` ensinava `fix/<assunto>`, que **não está na
  taxonomia** — o `pr-police` reprova. É o engano mais comum, e a doc o
  induzia

## v1.4.0 — 2026-08-02

### Novidades

- **engine,api,docs**: fechamento da Fase 12 — a prova de que os três achados morreram (12d) (c366f0a)
- **api,engine,web,docs**: promoção de story volta a ser do usuário (12c-3..12c-7) (28317be)
- **api,engine**: create_story respeita o modo do projeto (12c-2) (6d6e791)
- **api**: o modo de promoção de story entra no domínio (12c-1) (7eafdb3)
- **web**: o painel mostra awaiting_gate, travado e não mais fica preso na task antiga (90e7faf)
- **engine**: reidratação retoma os quatro estados (fa36915)
- **api,engine,web**: rearmar o agente travado é um clique (ef35bde)
- **engine,api,web**: circuit breaker por agente vira configurável de ponta a ponta (c79510b)
- **engine**: o dev agent acorda por evento (22e8fca)
- **api**: a outbox conta gate resolvido e task pegável (2be2c2a)
- **engine**: o estado do dev agent vira explícito (2f17b29)
- **web**: o wizard pergunta criar ou adotar, e a tela do plano decide (ed24393)
- **api**: as quatro rotas da adoção, com a superfície documentada junto (4b098f5)
- **api**: o portão do plano — aprovar roda, adotar como está dispensa (0faa6e0)
- **api**: adoção de repositório existente — o fim do seed manual (ac5ab2c)
- **api**: dry-run do bootstrap — o plano que diagnostica sem agir (a33c1ae)
- **api**: origem do repositório e o plano de bootstrap no schema (4b5fbfd)
- **api,docs**: seis providers de LLM sobre a base OpenAI-compatível — Fase 11 completa (862bab3)

### Correções

- **k8s**: o seed do usuário do smoke nunca rodou — cinco defeitos empilhados (7ccd676)
- **web,ci**: o build de produção da web estava quebrado — e o CI não olhava (c8e3080)
- **api,engine,docs**: a decisão no event log, e o gate que abria sem PR (e3acffc)
- **engine,web,docs**: teste do requisito 4, notificação do breaker e o limite aceito (F1, F2, D5) (7baa7cc)
- **engine**: guard do correct, filtro do worker e rearm honesto (D4, D6, D8) (fd0cc48)
- **api**: outbox do reagendamento volta a ser transacional (D7) (db1b3a7)
- **engine,api**: três travamentos críticos do reagendamento (D1, D2, D3) (51eb0ac)
- **infra,deps**: WEB_ORIGIN deriva de WEB_PORT, e brace-expansion sobe (8fc8dad)

### Refatorações

- **api**: o executor do bootstrap vira colaborador próprio (d6bbf3d)

### Documentação

- permissões, runbook e glossário acompanham as mudanças da leva (0ff55d3)
- RN-047, ADR 0045 e o catálogo de eventos do reagendamento (6fcf4db)
- RN-045/046, ADR 0044 e o smoke do aceite da adoção (96de3bc)
- escopo da FASE 12 no CLAUDE.md, e a 11 fecha no Status (706d48b)
- runbook cobre a derivação de WEB_ORIGIN a partir de WEB_PORT (09f5098)

## v1.3.0 — 2026-08-01

### Novidades

- **web,docs**: ModelPicker reagrupado, curadoria de catálogo e fechamento da Fase 9c (a87ec50)
- **api,engine**: sync de catálogo, ciclo de vida do modelo e preço auditável (0dfb227)
- **api,k8s**: metering por provedor subjacente e preço manual (preparo da Fase 9b) (b1c7e4e)
- **api**: base OpenAI-compatível, contrato de LLM providers e capabilities (Fase 9a) (a04454f)
- **web,api**: dashboard de projetos — fidelidade ao design aprovado (f0ba9bd)

### Correções

- **api**: a lista de providers de LLM sai do packages/shared e vai pro domínio (39bd783)

### Documentação

- kit de colheita da 10c — queries validadas, esqueleto e o achado #17 (f35a8eb)
- runbook de condução da 10b e o texto de entrada da sessão 0 (ed2cd39)
- CLAUDE.md admite o que as Fases 8 e 9 não entregaram (b999249)
- missão de dogfooding da Fase 10 e insumos do PO (0e27ecd)

## v1.2.0 — 2026-07-30

### Novidades

- hierarquia de agentes — QA e Infra viram área, com Lead e subagentes (Fase 8) (c04bfc0)
- a versão da tag chega ao artefato, e o contraste das telas de auth passa AA (f8f9336)
- **web**: as quatro telas de auth ganham a moldura do design aprovado (694f3b6)
- **web**: Alert, loading no Button, campo preenchido e revelável, e foco visível (2d64049)
- **web,api**: trace no chat, span própria na retentativa e fim dos silêncios do browser (3e359a4)
- **api,engine**: log legível e o caminho do usuário entre as camadas (07c6b00)

### Correções

- **ci**: actionlint sobe pra 1.7.12 e ganha aceite no trivy, prettier, e o glossário desatualizado (65a9945)
- o CORS que o engine não tinha, e a porta como parte do contrato (4dfa280)
- **ci**: silencia o DL4006 que a contagem de fontes introduziu no hadolint (8646a36)
- **web**: as três fontes do design system não carregavam em produção (2404d0e)
- **api,engine**: trace correlacionado sem coletor, e a correlação assíncrona que estava morta (b504403)

### Documentação

- ADR 0036, a tela de login no design system, e as contagens que estavam erradas (da71efe)
- corrige as duas citações arquivo:linha que o decorator deslocou (79d8596)
- registra que página nova precisa do sidebars.ts, e que o docmap é piso (4e30cd2)
- ADR 0035, a página de observabilidade e as duas frases que estavam falsas (f4a4b68)

### CI

- reaponta o contrato de trace_id do engine e libera o trace id de exemplo da spec (569d89c)

### Manutenção

- senha do seed vira brabo12345678, nos nove lugares que a citam (c62f436)
- **ci**: aceita CVE-2026-56852 no binário do gitleaks, com prazo (c0bd99d)
- **design-sync**: sincroniza o DS com o Input da Fase 7a (752634a)

## v1.1.2 — 2026-07-28

### Documentação

- corrige o que a doc afirmava sobre estado que mudou nesta sessão (1055e5e)

## v1.1.1 — 2026-07-27

### Manutenção

- **ci**: torna a Release republicável e documenta as seis tags órfãs (bb517ee)

## v1.1.0 — 2026-07-27

### Novidades

- **docs**: publica a documentação de cada degrau no Pages (48c17dd)

### Correções

- **ci**: gitleaks varria a gh-pages e reprovava por site construído (73943cf)
- **docs**: referência de API não renderizava nenhuma das 117 rotas (2c73681)

### Desempenho

- **ci**: paraleliza o build da release e conserta o cache do Elixir (13dd7e0)

## v1.0.1 — 2026-07-27

### Correções

- **ci**: drift cobrava documentação em PR de promoção (1245505)
- **ci**: faz o guardião da documentação reavaliar quando a base ou o corpo mudam (d03259c)
- **deps**: fecha 12 dos 13 alertas do Dependabot com overrides escopados (c50c93a)
- **docker**: faz o smoke semear o usuário do jeito que a imagem permite (795ca89)
- **docker**: devolve os defaults de dev às duas variáveis novas do auth (527ce35)
- **deps**: força js-yaml 5.2.2 e fecha a GHSA-pm4m-ph32-ghv5 na imagem (ae2e12d)

### Manutenção

- **ci**: fecha os três checks que a FASE 7 deixou vermelhos (5f75f93)

## v1.0.0 — 2026-07-27

### Novidades

- **api**: 400, 401 e 429 derivados da cadeia de guards no documento (1d7d4cb)
- **docs**: referência da API gerada do OpenAPI no Docusaurus (68225ee)
- **api**: metadados OpenAPI nas 26 rotas internas — varredura completa (0dc10a2)
- **api**: metadados OpenAPI em llm, git, credenciais e infraestrutura (97a9c08)
- **api**: metadados OpenAPI em backlog, agentes, execução, psicólogo e anamnese (37e7f2c)
- **api**: metadados OpenAPI em sessões, ações e IAM (89d51ce)
- **api**: documento OpenAPI, /docs fora de produção e export determinístico (fc48365)
- **web**: login próprio, sessão em cookie e as quatro telas de auth (8ee0270)
- **api**: sessão da web em cookie httpOnly com CSRF por double-submit (fb502e1)
- **api**: migração dos usuários do Keycloak e login de conta pendente (0cc44b2)
- **api,engine**: service token no tráfego interno e emissor próprio no guard (31aa544)
- **api**: casos de uso, controllers e superfície do auth first-party (805c1c5)
- **api**: domínio, portas e repositórios do auth first-party (5b8492c)
- **api**: fundação do auth first-party — argon2id, Ed25519 e as cinco tabelas (b0274b9)

### Correções

- **ci**: claude-review falhava em todo PR de promoção (e3e0f70)

### Documentação

- regra de docmap, ADR 0033 e as docs afetadas pela referência gerada (4fba9f6)
- ADR 0032 e a documentação do corte do Keycloak (063520a)
- ADR 0031, RN-030..033 e a documentação da Fase 7a (724771c)
- ativar FASE 7 (auth first-party + referência de rotas) no CLAUDE.md (f079258)

### Testes

- **api**: o teste de tabela passa a exigir os metadados de OpenAPI (77cdded)
- **api**: suite de ataque do auth e as duas correções que ela encontrou (f0ca194)

### Manutenção

- remove o Keycloak do compose, dos manifests e dos scripts (796e133)

## v0.3.1 — 2026-07-27

### Correções

- **dev**: pnpm dev explica a colisão de portas em vez de só falhar (c93ab44)

### Documentação

- CI confere as contagens de ADR escritas em prosa (3efb89a)

## v0.3.0 — 2026-07-27

### Novidades

- **ci**: backmerge gate e fechamento da FASE 6 (ADR 0030) (50d7b16)

### Correções

- **ci**: promote tinha o mesmo ciclo vazio do tag-release (39119ed)
- **ci**: ciclo vazio quando o PR entra por merge commit (227769c)

### Documentação

- **pages**: link para o site publicado e um build de site por PR (a05518b)

## v0.2.0 — 2026-07-27

### Novidades

- **ci**: esteira de promoção e versionamento calculado (FASE 6, itens 4 e 5) (#47) (0fdd422)
- **ci**: approval-ladder com os dois modos (FASE 6, item 3) (#45) (7f440a2)
- **ci**: política de branches escrita e aplicada pelo pr-police (FASE 6, itens 1 e 2) (#44) (9d08dff)

### Correções

- **ci**: âncora da tag final era impossível de passar com merge commit (#53) (4e81a75)
- **ci**: promotion-check tratava "não consegui ler" como "está desabilitado" (#49) (996c634)
- **deps**: sobe brace-expansion para 5.0.8 (GHSA-mh99-v99m-4gvg) (#41) (9f36351)

### Documentação

- **policy**: registra a execução da esteira de ponta a ponta (#50) (0307075)
- **security**: volta ao canal privado do GitHub, agora que o repo é público (#43) (1a72fad)
- código de conduta e canal de segurança que existe de verdade (#40) (e5cc19b)
- documentação completa e mecanismo de sincronização contínua (#39) (b57329a)

### CI

- constrói as quatro imagens de produção em paralelo com buildx bake (#42) (e4cd944)

### Manutenção

- **ci**: escada de três degraus e CI sem gatilho de push (#46) (b52bf00)

## v0.1.0 — 2026-07-26

### Novidades

- **k8s,api,docs**: backup testado, hardening da api e release (Fase 5, item 6 e 7) (7794b29)
- **design-sync**: importa os 57 componentes do apps/web para o Claude Design (f340416)
- **api,engine,web**: OpenTelemetry, logs JSON correlacionados e dashboards (Fase 5) (3f6781b)
- **api,engine**: métricas Prometheus de custo, sessões, ações e latência (Fase 5) (e76c74b)
- **k8s**: stack de observabilidade local — Tempo, Loki, Alloy, Collector e Grafana (Fase 5) (9efd832)
- **engine,api,k8s**: graceful shutdown com handoff de sessão e propriedade única no cluster (Fase 5) (8b4614a)
- **k8s**: deploy Kubernetes com Kustomize, HPA por fila do Oban e overlay local (Fase 5) (ec47864)
- **docker,ci**: imagens de produção non-root, compose.prod, CI e smoke test (Fase 5) (6ffac72)
- **api,docs**: critério de aceite executável da Anamnese e ADR 0023 (0bf764c)
- **api,engine,web**: rodada da Anamnese sob demanda e os testes que faltavam (Fase 4b) (5a84add)
- **engine,api**: NoopDevAgent como modo de execução permanente (Fase 4a) (f93e2ef)
- **api,engine,web**: Anamnese — perfil de proficiência e patches de instrução (Fase 4b, sessão 2) (0e23bed)
- **api,engine,web**: Psicólogo real substitui o stub (Fase 4b, sessão 1) (9fa8b68)
- **api,engine,web**: InfraAgent e painel do time ao vivo (fechamento Fase 4a) (fb2513c)
- **api,engine,web**: gates de QA e SecOps pra PR de dev agent (Fase 4a) (c7a8937)
- **api,engine,web**: DevAgent real via ToolLoop, substitui o NoopDevAgent (Fase 4a) (82918aa)
- **api,engine,web**: infraestrutura dos dev agents com NoopDevAgent (Fase 4a) (f1247ca)
- **api,engine,web**: Agente Arquiteto — ADRs via PR real, module_map, validação cruzada (Fase 3b) (3b9a82b)
- **api,engine,web**: Agente PO + backlog + rastreabilidade (Fase 3b) (72b6c01)
- **api,engine,web**: Agente Criativo conversacional + handoffs (Fase 3b) (c97b2c4)
- **engine,api**: ToolLoop, ferramentas, ContextManager e EchoAgent (Fase 3a) (77c05cc)
- **engine,api**: harness de agentes — montagem determinística de contexto (Fase 3a) (f9a6e4e)
- **web,api**: wizard de novo projeto ligado ao fluxo real + tela de progresso do bootstrap (c2a5b05)
- **api,shared**: bootstrap de Gitflow idempotente e retomável (ProvisionRepositoryUseCase) (5d31d4f)
- **api,shared**: credenciais de git, GithubProvider/GitlabProvider completos e suite de contrato mockada (d858982)
- **api,shared**: fundação do contrato normalizado GitProvider (Fase 2) (935f55b)
- **web,api**: implementa apps/web completo e endpoints de suporte (fb630ab)
- **api,engine**: endurece o pipeline de acoes propostas com decide(), permissions.json fisico, agent_autonomy e executor de terminal (d581c88)
- **engine**: endurece o motor de sessoes com persistencia, heartbeat, outbox via Oban e PsychologistStub (74b0c46)
- **api**: abstracao GitProvider + LocalGitProvider/GithubProvider/GitlabProvider e provisionamento de repositorio (02302af)
- **engine**: motor de sessoes em Elixir/OTP com supervisao e evento de termino (e258558)
- **api**: adiciona pipeline de acoes propostas e permissions.json por projeto (5e86ee7)
- **api**: camada de LLM — providers, binding em cascata, metering e budget (b3972b7)
- **api**: núcleo de domínio — auth, IAM, sessões, event log e outbox (968c150)
- **design**: extrai tokens do design system para design/tokens.css (f797899)

### Correções

- **scripts**: changelog perdia os commits de revert, contando meia história (23dc8b2)
- **docker**: troca mc por aws-cli na imagem de backup — 48 CVEs para 0 (533862b)
- **ci**: pina o trivy na versão que a action realmente instala (f7875a1)
- **ci**: mix deps.get antes do format e tag válida do trivy-action (e45cf6a)
- **web**: dropdown de modelo era recortado pela tabela nas últimas linhas (a3fe71c)
- **engine**: janela da Anamnese truncava pra segundo e pulava a rodada calada (4a2bb45)
- **api,web**: perfil de proficiência identifica a pessoa por e-mail (7f11f89)
- **api,web**: três defeitos que só a passada visual pegaria (Fase 4b) (58220b6)
- **api,engine,web**: destrava a Anamnese num projeto real (Fase 4b, sessão 2) (3deaef5)
- **api,docker**: ajusta o demo do Psicólogo ao que a stack local aguenta (Fase 4b) (da25bb3)
- **api,engine,web**: fecha os desvios do Psicólogo e roda o critério de aceite (Fase 4b, sessão 1) (3571634)
- **engine,api,web**: gate de infra que valida e painel que diz a verdade (Fase 4a) (df2573a)
- **engine,api**: destrava os gates de QA e SecOps e roda o critério de aceite (Fase 4a) (5d721bd)
- **engine,api,web**: destrava o DevAgent real e fecha os desvios do enunciado (Fase 4a) (15dc967)
- **engine,api**: corrida do workspace, monitor de dev agents e tetos (Fase 4a) (391f992)

### Documentação

- **adr**: promove a divergência de proteção de branch GitHub×GitLab a ADR (486f402)
- **adr**: registra a verificação executada do fechamento da 4b (5ca75ea)

### Testes

- **ci**: planta CVE crítica para provar o gate de auditoria (77f6b03)

### Revertidos

- **ci**: remove a CVE plantada e corrige a formatação do prettier (64f5ccf)

### Manutenção

- scaffold do monorepo (api, engine, web, packages/shared, docker) (0827e80)
