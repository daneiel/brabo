> Parte do `CLAUDE.md` da raiz, importada por ele e lida em toda sessão.
> Edite aqui; o `CLAUDE.md` só guarda o índice das partes.

## Convenções (continuação: agentes, telas, testes e segredos)
- Agentes rodam SEMPRE dentro de um Harness; nenhuma chamada de LLM ou
  ferramenta fora dele.
  Argumento de ferramenta passa por `ArgumentosDeFerramenta.executar/4`:
  lista/objeto em string JSON vira valor (RN-719), texto com `\uXXXX`
  literal é decodificado (e só então `\n`/`\t`/`\"`/`\\` da mesma string —
  texto sem `\u` fica intacto, senão o `write_file` corromperia código), e
  recusa "exige X" leva as CHAVES recebidas, nunca os valores (RN-725).
- Agente que ESCREVE tem de poder LER o que já existe, e tem de poder
  PERGUNTAR quando falta informação. As duas são a mesma lição (RN-164/165):
  um agente só com ferramenta de escrita age sobre um retrato tirado uma vez,
  no kickoff, e diante de uma lacuna escolhe entre inventar e parar. Leitura
  de agente é escopada ao PROJETO quando o recurso é do projeto, e CONTIDA
  (ADR 0060): sem parâmetro onde o modelo escreva o que quiser, custo constante
  por chamada, teto de linhas declarando o total real quando trunca.
- Laço de agente NÃO termina calado. O teto de iterações emite
  `toolloop.limit_reached` — o mesmo tipo para o `ToolLoop` e para os agentes
  conversacionais, que têm laço próprio (RN-166) — e obrigação não cumprida
  vira desfecho explícito no padrão da RN-059, durável e com origem.
- Handoff externo endereça só LEAD de área ou agente sem área;
  delegação interna é privada da área; falha de subagente NUNCA é
  silenciosa — reporta origem ao lead, que decide e registra evento.
- O contrato externo dos gates é estável: quem consome vê um veredito
  por gate, independente da estrutura interna da área.
- Validação que fala do REPOSITÓRIO não roda em RUNTIME (RN-070). O registro
  de gates é validado em DUAS camadas, e a divisão não é cosmética:
  `validarRegistro` afirma sobre o CONTEÚDO (vale onde quer que o registro
  seja lido, e é a única que `gate-registry.loader.ts` chama) e
  `validarLocalizadores` afirma que o arquivo de prova existe no disco — só
  faz sentido dentro de um checkout, e quem a cobra é o teste do arquivo real
  e a fase 2 do `validacao-gates.ts`. Juntas numa função só custaram `GET
  /gates` respondendo 500 em TODA instalação: a imagem de produção leva
  `/app/docs/gates.yml` e nada de `apps/api/test/`, `scripts/ci/` ou
  `.github/`, então os onze alvos "não existiam". NÃO devolva a checagem ao
  loader — há teste que reconstrói a árvore da imagem em disco e fica
  vermelho —, e não a troque por `try/catch` devolvendo registro vazio:
  registro inválido por conteúdo continua LANÇANDO. A lição é geral: suíte
  que roda de um checkout não prova nada sobre o que a IMAGEM carrega, e
  quem faz essa pergunta é `docker/smoke.sh`.
- A lista de áreas tem UMA fonte —
  `apps/api/src/domain/agents/agent-areas.ts`. As cópias do web e do
  engine são GERADAS por `pnpm --filter api gerar:areas` e reprovam em
  teste se estiverem velhas; nunca as edite à mão (FASE 18). O mesmo
  gerador escreve `SOLO_CONVERSATIONAL_AGENTS` (RN-440) SÓ no web, porque
  o engine não a lê — não o estenda para lá sem consumidor. Área nova
  continua sendo decisão de produto, com ADR. A lista é o CATÁLOGO; a
  tabela `agent_areas` é o ESTADO por projeto, e nasce com ele (RN-094).
- `docs/fluxo.yml` é a terceira peça do modelo de time, ao lado do
  CATÁLOGO (`agent-areas.ts`) e do CONTROLE (`docs/gates.yml`, ADR
  0054): declara as RELAÇÕES entre papéis — quem entrega o quê a quem
  (ADR 0085). Papel `proposto` diz quem o absorve hoje e o critério
  objetivo de separação; o docmap cobre mudança em `agent-areas.ts`/
  `gates.yml` só em `warn`, até existir o teste de cruzamento entre os
  três (backlog).
- Merge em branch protegida (dev/qa/main) é SEMPRE manual do
  usuário — sem opção de automatizar, garantido por teste.
- Socket Phoenix da sessão (`session:<id>`) exige ticket opaco de uso
  único (TTL de 30s, `POST .../sessions/:sessionId/socket-ticket`) em
  `connect/3` — NÃO o JWT reaproveitado. O engine consome o ticket lendo
  `session_socket_tickets` direto (mesmo padrão de `outbox_events`);
  reconexão, inclusive automática, sempre busca ticket novo (RN-108).
  A consequência prática vale para TODO construtor de `Socket` do
  repositório, o do `/runner` inclusive: o auto-reconnect embutido do
  `phoenix.js` repete os MESMOS `params`, então ele é NEUTRALIZADO na
  construção (`reconnectAfterMs: () => NUNCA_RECONECTAR_SOZINHO_MS`, 24h) e a
  reconexão é sempre a política PRÓPRIA do módulo, com ticket fresco. Isso já
  falhou em DOIS dos quatro (`apps/runner/src/channel.ts` e
  `apps/web/src/lib/fs-browser-channel.ts`), e no runner o docblock AFIRMAVA a
  neutralização que o código não fazia — 530 req/min contra o teto de 300 do
  `RATE_LIMIT_USER`, com o 429 aparecendo no navegador do usuário dono da
  conta. Por isso a opção é OBRIGATÓRIA no tipo (`OpcoesDoSocket` do runner) e
  é asserida por teste sobre a OPÇÃO passada ao construtor: teste que só
  verifica "conecta" passa com o defeito de pé, e passou. Comentário não é
  mecanismo. No web, nenhum arquivo chama `new Socket` direto: todo socket nasce por
  `criarSocket` (`apps/web/src/lib/socket-phoenix.ts`) e morre por `descartar()`,
  porque o construtor do `phoenix@1.8.9` registra três ouvintes em `window` que
  `disconnect()` não remove; e o canal da sessão é por GERAÇÃO — callback de
  socket substituído não age (RN-833).
- O teto de 300 req/min é do USUÁRIO, não da aba, e NÃO se resolve subindo o
  teto (RN-579, AT-093: um navegador na Sessão fazia 118/min de mediana e 263
  de pico). Com o canal `session:<id>` VIVO (join confirmado), as queries da
  sessão pollam no fallback de 15s (30s o orçamento) e quem diz QUANDO buscar
  é o `event.appended` — que a fachada `EngineApiClient` emite para TODA
  escrita que a api confirmou, só com `type`/`actorId`. Query nova de sessão
  passa por `intervaloDaSessao` (`apps/web/src/lib/canal-vivo.ts`), senão um
  único observador em 3s segura a chave inteira em 3s; invalidação pelo canal
  passa por `criarInvalidadorDoCanal`, que tem janela por alvo — invalidar por
  aviso SEM janela só troca poll por rajada. O número é guardado por
  `canal-vivo.orcamento.test.tsx` (uma aba: 123/min caído, 46 vivo). Leitura
  de PROJETO (lista de sessões, contadores do trilho) nenhum canal avisa, e
  polla no ritmo de projeto, `INTERVALO_DO_PROJETO_MS` (15s, incondicional);
  quem só precisa do dado no CLIQUE não polla (`useLatestSession(id, false)`,
  as linhas de `/containers`); e TODA tela que ouve `session:<id>` — não só a
  de Sessão: Executores e Visão geral também — passa pelo MESMO
  `criarInvalidadorDoCanal` (RN-632, AT-278: a aba Executores fazia 630 GET de
  eventos/min com um dev agent em rajada). O número de DUAS abas, com as telas
  de verdade, é guardado por `duas-abas.orcamento.test.tsx`. Dado de
  CONFIGURAÇÃO (as seções de Configurações, o workspace/papel) nasce com
  `staleTime: FRESCOR_DA_CONFIGURACAO_MS` (`query-policy.ts`, um minuto) e sem
  poll (RN-645, AT-321): com `staleTime: 0` cada seção que montava depois da
  moldura refazia a busca dela, e voltar à aba refazia 31. Estado operacional
  (container, gasto, `lastUsedAt`) fica fora, com o default. Os bindings
  RESOLVIDOS de agentes e áreas vêm num LOTE só
  (`GET .../model-bindings/resolved`, RN-654), sob UMA `queryKey` que as três
  seções de modelo, a Visão geral e a aba Executores leem (os `dev-<modulo>`
  fora do catálogo numa leitura em lote a mais, sob o mesmo prefixo, AT-339) —
  não volte a uma query por chave. Guardado por
  `configuracoes.orcamento.test.tsx`. Escrita
  que NÃO passa pelo engine (humano noutra aba, transição feita pela api)
  também avisa desde a AT-157: a api pede ao engine
  `POST /internal/sessions/:id/event-appended` DEPOIS do commit
  (`SessionChannelNotifier`, `aposCommit`), e não pede para escrita vinda do
  engine (`/internal/*`), que a fachada já avisou. É melhor esforço: o aviso
  perdido cai no fallback de 15s. Caso de uso novo que grave em
  `session_events` sem `AppendSessionEventUseCase` chama o notifier. E 304 não reduz a contagem do rate limit —
  o guard conta antes do handler —, mas corpo `null` agora tem `ETag`
  (`etag-do-corpo-vazio.ts`): sem ele, a rota que responde vazio nunca
  voltava 304. A leitura de 4s da cauda que acompanha um turno aceito
  (RN-578) NÃO vira fallback de 15s: ela é a rede contra o `agent.done`
  perdido, e o aviso pode se perder junto; o que o canal faz é ANTECIPÁ-LA
  (`avisoPedeVerificacaoDoTurno`, só o `agent.status` do agente acompanhado).
- O que muda por TOKEN não mora no estado da `SessionPage` (RN-639, AT-301):
  o texto em curso e a faixa de atividade ficam no store de
  `lib/streaming-do-turno.ts`, assinado por `useSyncExternalStore` só por quem
  os desenha (a bolha em `SessionFio.tsx`, `TurnActivityStripDoStore`), e a
  página assina booleanos. Estado novo de streaming entra no store, nunca num
  `useState` do `useTurnoDoAgente` — `SessionPage.streaming-isolado.test.tsx`
  conta os renders da página e reprova o token que a re-renderiza.
- Arquivo que outro PROGRAMA vai parsear se prova contra o PARSER dele, nunca
  contra uma asserção de string — é a mesma lição do `#` no `FROM` do
  Dockerfile ("linter concordar não é build concordar"), medida uma segunda
  vez e mais cara. A unit de `systemd --user` do `brabo-runner` saía com
  `WorkingDirectory="…"` e NUNCA iniciou, em instalação nenhuma e nas duas
  espécies (`bad-setting`, `path is not absolute`), com a suíte VERDE: cada
  asserção pedia de volta exatamente a forma errada. As TRÊS diretivas que
  carregam valor não têm a mesma sintaxe — `ExecStart=` é unquoted e separado
  em palavras (cada argumento entre aspas, `\`→`\\`, `%`→`%%`, `$`→`$$`),
  `WorkingDirectory=` toma a linha INTEIRA (aspa nenhuma, espaço literal, só
  `%`→`%%`) e `Environment=` é LISTA separada por espaço (a atribuição inteira
  entre aspas, `"VAR=valor"`, com `\`, `"` e `%` escapados — AT-095). Não reuse
  o escape de uma na outra. `systemd-analyze --user verify` sobre a unit GERADA
  (`apps/runner/src/servico-systemd.spec.ts`) prova que ela CARREGA, e não
  basta: `Environment=X=/a/50%off b` carrega e entrega OUTRO valor. O que prova
  o VALOR é o despejo de `systemd --test --user --unit=<u>` sobre uma pasta de
  units temporária, comparado com o gravado; as formas antigas ficam fixadas
  como reprovadas; sem systemd na máquina o teste PULA nomeando o motivo — nunca
  passa em silêncio nem reprova por ambiente, a mesma régua do golden-set. O
  plist do macOS não tinha o defeito (o valor vai num `<string>` de XML), e a
  leitura de volta aceita as DUAS formas, para não tirar `status`/`uninstall`
  de quem tem a unit quebrada em disco — o conserto é REINSTALAR. Terceira vez,
  AT-083: o `.env` do `install.sh` saía com o `SECRET_KEY_BASE` quebrado em duas
  linhas (`openssl rand -base64` quebra aos 64), e o Compose ora recusava, ora
  ACEITAVA cortando o segredo. `scripts/dev/install-env.spec.ts` passa o `.env`
  das funções de verdade por `docker compose config` e cobra cada valor INTEIRO
  do outro lado — "parseia" não basta quando o parser aceita o arquivo errado.
- O produto NUNCA sobrescreve configuração de repositório do usuário
  (proteções, branches) sem plano aprovado explicitamente (regra da
  FASE 12, origem no ADR 0028).
- Commits de agentes usam identidade "<agente>[bot]" com o usuário
  como co-author.
- Todo desfecho de falha de agente registra a ORIGEM da falha
  (infra | modelo | código | política) — nunca diagnóstico por
  eliminação (lição do ADR 0020). Falha NUNCA vira resposta vazia no
  event log, e o motivo NUNCA fica só em broadcast: `agent.error` é
  durável e o agente diz o que houve no fio (RN-059). Falha de UMA
  ferramenta no meio do laço segue a mesma régua (RN-163).
  Toda ferramenta de agente roda por `Engine.Harness.ArgumentosDeFerramenta.executar/4`
  (RN-719): lista/objeto que chega como string JSON é normalizado contra a
  spec (inválido é recusa nomeada), e exceção dentro da ferramenta vira
  `tool.result` `ok: false` com origem `codigo` e ENTRA no laço — servidor novo
  despacha por ele, nunca chamando `run/2` direto.
- Os SETE agentes conversacionais rodam laço bounded de tool use, com
  teto PRÓPRIO no servidor de cada um (Criativo e PO 12, Arquiteto, Dev
  Lead, UX Designer, Staff e Infra Lead 14 — raciocínio, não conversa
  leve) — não o teto do `ToolLoop` (`Engine.Harness.Iteracoes`), que é dos
  agentes de execução e de gate. O Infra Lead é o sétimo desde a RN-617
  (ADR 0175): conversa pelo composer, com os mesmos `TurnoAssincrono`,
  `Reidratacao` e `TurnoOrfao` dos outros, e a correção de gate que chega com
  turno em curso entra numa FILA (`correcoes_pendentes`) em vez de se perder.
  Erro de ferramenta é ENTRADA do laço, não fim de
  linha; teto esgotado é narrado, nunca silêncio, nos SETE (RN-163;
  RN-459 fechou os quatro que ainda terminavam calados — só PO e
  Criativo tinham corrigido antes; o Infra Lead, na RN-617); e o agente não anuncia ação que o
  código não vá executar — o que se promete é decidido pelo teto, nunca
  por texto fixo (RN-163). E o número do que foi
  gravado no turno é do SERVIDOR: o fecho do Criativo, do PO e do Arquiteto
  ganha "Gravado neste turno: …" derivado das escritas `ok` do próprio turno
  (`Engine.Agents.GravadoNoTurno`, RN-731), no idioma do turno (pt-BR, senão
  en), nunca reescrevendo o texto do modelo. O Staff é o único SEM `kickoff/1` — sobe e
  fica ocioso até a primeira `user_message`, porque não há artefato de
  sessão para sintetizar uma abertura (ADR 0088). Durante o turno, a
  tela de Sessão narra em tempo real o que o agente está fazendo numa
  faixa acima do composer — o fio só recebe a bolha de resposta depois
  que o turno termina (RN-460). Os sete reconstroem o histórico por UM
  caminho, `Engine.Agents.Reidratacao` (RN-580) — não reintroduza
  `rehydrate/2` por servidor: lê a CAUDA (`latest`, teto 200 do ADR 0060),
  traz pergunta estruturada e as PRÓPRIAS ferramentas como texto (nunca
  `role: "tool"`: o evento não tem id de chamada), pula
  `chat.structured_question_answered` (a resposta já vem no `chat.message`) e,
  quando a conversa não cabe, abre com o número de omitidos por SUBTRAÇÃO do
  `seq`. Leitura de kickoff é POR TIPO (`eventos_do_tipo/3`), nunca filtro em
  memória sobre a leitura geral. O `tool.result` dos sete leva o TEXTO que a
  ferramenta devolveu (`resultado`, 2.000 caracteres, `resultadoTotal` quando
  corta — RN-589), montado por `Engine.Agents.ResultadoDeFerramenta`; não grave
  o evento à mão num servidor. O Infra Lead passa pelo mesmo módulo, e o Dev
  Lead suspenso grava na RETOMADA (`action_settled`), nunca na suspensão
  (RN-593).
  que o turno termina (RN-460).
- O idioma chega ao modelo por UM caminho (RN-622): a fachada
  `EngineApiClient` (`llm_turn/5`, `llm_turn_stream/6`) acrescenta, no FIM de
  toda chamada de LLM, uma mensagem `system` EFÊMERA montada por
  `Engine.Harness.IdiomaDaResposta` — nunca em `state.messages`, nunca em
  `agent_instructions`, nunca por servidor. Turno COM autor usa o idioma que a
  api resolveu para ele (`idiomaDaResposta` no `agent/message`, posto no
  dicionário só durante o `handle_call` e herdado pela Task do turno); turno
  SEM autor usa `projects.language`; o `context-manager` fica fora. Falha na
  resolução = turno SEM orientação, nunca queda e nunca o idioma do projeto no
  lugar do da pessoa. Teto de 50 tokens de entrada por chamada (AT-169).
  Desde a RN-623 (AT-245), num turno COM autor cuja chamada leva ferramenta
  que grava artefato compartilhado (`ferramentas_de_artefato/0`, lista por
  NOME — ferramenta nova de artefato entra nela no mesmo PR), e com o idioma
  do projeto DIFERENTE do do autor, a MESMA mensagem ganha a cláusula
  "artefatos no idioma do projeto"; só com os dois códigos na forma curta
  (`idioma[-Escrita][-Região]`), que é o que segura o teto. Não mova isso para
  a descrição de cada ferramenta. E descrição de ferramenta NUNCA nomeia idioma
  (RN-667): o "em pt-BR" do `label` de `ask_structured_questions` era uma
  segunda orientação, fixa, que punha o formulário em português para autor
  `en`; ela diz "no idioma da sua resposta", e um teste reprova as 22
  ferramentas do harness se alguma voltar a fixar um.
- O AMBIENTE do agente de execução chega pelo MESMO caminho (RN-706):
  `Engine.Harness.AmbienteDoAgente.com_ambiente/2` roda no `ToolLoop` e a
  fachada acrescenta a mensagem `system` efêmera (pasta real do `terminal`,
  `/work/...` só com container `running`, imagem e rede do
  `artifact.project_image`, git só tipado, o módulo e seus contratos) para
  `dev-*` e `qa-*`. Não repita esses fatos em prompt de servidor.
- O FLUXO do time chega aos sete conversacionais pelo MESMO caminho (RN-711),
  depois do ambiente e antes do perfil e do idioma: `Engine.Harness.FluxoDoTime`
  é a fonte ÚNICA (etapas, próximo passo, quem dispara), conferida por teste
  contra `docs/fluxo.yml`. Não narre o fluxo em prompt de servidor; etapa nova
  ou passagem que muda entra ali. Restrição técnica explícita do usuário vira
  `decision_record` do Criativo, e o kickoff do Arquiteto a lê.
- O idioma DETECTADO nunca troca preferência sozinho (RN-624): a api só
  PERGUNTA (`detectionQuestion` na leitura do idioma da sessão), e só a
  resposta `confirm` grava `users.detected_language`; `decline` grava em
  `detected_language_declines` e o idioma não volta a ser perguntado. A
  detecção roda na LEITURA, fora do envio da mensagem, e falha vira "sem
  pergunta". A heurística tem UMA casa,
  `apps/api/src/domain/iam/heuristica-de-idioma.ts` — sem `import` de
  propósito, porque `scripts/idioma/` a REEXPORTA (type stripping, com
  tsconfig próprio sem `verbatimModuleSyntax`) para medir o mesmo código; não
  a copie de volta para o instrumento, e não a transforme em `.mts` (quebra o
  `ts-node` da api). Os limiares
  (`PARAMETROS_PROVISORIOS`) são PROVISÓRIOS, do corpus sintético, até o dono
  medir o real.
- O clique que dispara turno de agente conversacional responde ao ACEITAR,
  nunca no fim do turno (ADR 0163, RN-578): `TurnoAssincrono.iniciar/3`
  devolve `{:reply, :ok, _}` assim que a Task sobe — DEPOIS de persistir
  `agent.status: working`, e essa ordem é contrato (é ela que deixa a tela,
  lendo a cauda do log depois do aceite, saber que o `agent.status` mais
  recente é do turno novo). O desfecho vai pelo canal e pelo `agent.error`
  durável, NUNCA pelo HTTP (nos SETE conversacionais — o Infra Lead desde a
  RN-617, que tirou o turno dele de dentro do `handle_call`); a recusa ANTES de o turno subir é síncrona e
  NOMEADA (409 `turno_em_andamento`/`aguardando_aprovacao`, 422
  `sem_regra_de_negocio`) e o controller do engine não descarta mais o
  retorno — era esse descarte que fazia mensagem recusada virar 202 calado.
  Na tela, "a chamada resolveu" deixou de significar "o turno acabou": depois
  do aceite chama-se `acompanharTurnoPeloLog`, nunca `finalizarTurnoDoAgente`.
  Não volte a segurar o request pelo turno.
  Desde a RN-673 (ADR 0191) a MENSAGEM do usuário não recebe mais
  `turno_em_andamento`: com turno em curso ela entra na FILA do agente
  (`TurnoAssincrono.receber_mensagem/4`, 202 com `entrega: "enfileirada"`), e
  no fim do turno as pendentes viram UM turno, na ordem. O estado mora no LOG
  (`chat.message_queued`/`_delivered`/`_cancelled`, todos com o id do
  `chat.message`), nunca em tabela — o `init/1` reconstrói a fila e o boot
  acorda quem tem pendente. Teto de 10 por agente e sessão (409
  `fila_de_mensagens_cheia`); quem ENVIOU cancela enquanto pende. A fila é
  UMA, em `TurnoAssincrono` — servidor novo só fornece `turno_de_mensagem/2`,
  nunca fila própria. `turno_em_andamento` segue para o que não é fala
  (revisão, prontidão, oferta de handoff), e o Dev Lead suspenso segue
  recusando com `aguardando_aprovacao`.
  O turno que o REINÍCIO do engine matou no meio (o `working` fica gravado, o
  processo e a Task somem) fecha por evento NOVO — `agent.error` origem `infra`
  + `agent.status: idle` — no boot (`Rehydrator`) e no `init/1` dos sete
  (`Engine.Agents.TurnoOrfao`, RN-586; o Infra Lead desde a RN-617); NUNCA
  reexecuta o turno, e só fecha o que não tem processo vivo em nenhum nó. Sem
  isso a faixa da tela e o sinal de trabalho pendente da RN-064 ficavam presos
  para sempre.
- O turno de um agente conversacional pode SUSPENDER esperando aprovação
  humana (ADR 0086, RN-284) — hoje só o Dev Lead, no `propose_execution_plan`.
  Desde o ADR 0163 o `from` já foi respondido no aceite (como em todo turno);
  o que a suspensão muda é o FECHO: `agent.status: awaiting_approval` em vez
  de `agent.done` quando o `state` devolvido carrega `:aguardando_aprovacao`
  com valor não-nulo. Enquanto suspenso, `user_message` não inicia turno novo
  — vira `agent.error` explicando a pendência, e 409 no clique. Sem tabela de estado própria: restart do engine
  durante a espera perde a inscrição no `Engine.Dev.Wake`, lacuna aceita e
  declarada (a decisão continua registrada em Aprovações).
- A execução é ATIVADA pela APROVAÇÃO do plano do Dev Lead, nunca pelo
  aceite do handoff a ele (RN-677, ADR 0194, revisa a RN-161): aceitar o Dev
  Lead só o traz para PLANEJAR, e o web não encadeia mais
  `execution/activate`. Aprovar (ou auto-aprovar) `propose_execution_plan`
  roda `ExecuteExecutionPlanUseCase`, que grava o módulo das tarefas e chama o
  MESMO `ActivateExecutionUseCase` do botão — não escreva uma segunda régua de
  ativação: o 409 sem repositório, o 409 de sessão consultiva e
  `findActiveExecutionSession` moram ali. O botão explícito "Ativar execução"
  (card do Dev Lead e Visão Geral) continua como gesto próprio. A tarefa tem
  MÓDULO (`tasks.module`, RN-678), atribuído pelo Dev Lead em
  `tarefas: [{ taskId, modulo }]` e validado contra o `module_map` vigente na
  proposta (400 `plano_de_execucao_invalido`) e de novo na aprovação; o claim é
  pelo módulo da TAREFA (`daTarefaDoModulo`, o mesmo predicado na contagem),
  e tarefa sem módulo só é pegável quando a história tem UM módulo — não
  alargue essa ponte para "qualquer módulo da história", que é o defeito que a
  regra fecha.
- A chave de LLM que um agente gasta é a do OWNER do workspace
  (RN-058); o relatório desse gasto é do owner e só dele (RN-060). O
  membro vê o PRÓPRIO consumo por ATOR, em tokens e custo estimado, e
  NUNCA quebrado por provider ou credencial — as duas leituras respondem
  perguntas diferentes e nenhuma é recorte da outra (RN-101/ADR 0063).
- Métrica de execução de agentes é extraída do event log/token_usage
  por script, nunca anotada manualmente (lição da Fase 10/13). A busca do RAG
  segue a mesma régua e acrescenta uma (RN-479..481): quando o instrumento de
  medição não cabe no event log, ele vira TABELA, e a tabela — nunca o evento —
  é a fonte. `session_events.session_id` é `NOT NULL`, e a busca vinda da aba é
  de PROJETO: medir pelo evento perderia justamente as buscas com julgamento
  humano. O evento (`rag.search`/`rag.feedback`, só quando há sessão) é
  NARRAÇÃO da timeline. E o que o instrumento mede vai CONGELADO na linha — os
  pesos da busca, como o preço no metering (ADR 0042) e a `image_version` em
  `project_containers` —, senão a primeira calibração reescreve calada o
  significado de toda medição anterior. Gravar medição NUNCA derruba o que ela
  mede, e também não falha calada: origem `infra` no log e um `null` explícito
  na resposta, que a tela distingue de "não achei nada".
- As CINCO filas de decisão do projeto (aprovações, merges de PR, promoções
  de história, pendências de arquitetura, hipóteses do Psicólogo) nunca são
  SOMADAS — nem nos contadores do trilho (ADR 0126) nem no painel "precisa de
  você" que as reúne (RN-467), cujo chip anuncia PRESENÇA e não quantidade.
  Somar apaga qual fila está pedindo atenção. E o painel é ATALHO para a
  decisão, nunca substituto: ele renderiza o mesmo `ApprovalCard` e chama os
  mesmos endpoints, sem tocar em teto nenhum — em especial o de merge em
  branch protegida (`decide.ts`, `require_approval` incondicional). Tela que
  não tem a data de um registro DIZ de onde tirou a que mostra, ou não mostra
  data: a pendência de arquitetura não tem instante gravado e a linha declara
  que a data é da história relacionada.
  O chat da sessão é o TERCEIRO lugar onde isso vale (RN-626): mostra as
  pendências dos agentes em OUTRAS sessões do projeto com o mesmo `ApprovalCard`
  e os mesmos endpoints, cada fila com o próprio título e contagem, e o
  "Mergear" do card da PR aberta só PROPÕE o merge — quem confirma é o
  clique humano no card, e o teto da RN-418 não se move. O card fica inerte
  enquanto a decisão está em voo e diz a frase da api quando ela recusa (409
  incluído); reabrir a sessão retoma do log o turno em curso. A fila de
  mensagem que esta linha dava como decisão pendente FECHOU na RN-673 (ADR
  0191) — ver a convenção do clique que responde ao aceitar.
  Quem pergunta "o que espera decisão" — contador do trilho, painel, aba
  Aprovações, roster da Visão geral/Executores/Código — lê a fila do PROJETO
  (`useProjectPendingActions`, chave `['project-pending-actions', projectId]`),
  NUNCA a sessão mais recente (RN-638), e cada card decide pelo `sessionId` da
  PRÓPRIA ação; o aviso `proposed_action.*` de qualquer canal invalida essa
  chave. A leitura de ações por SESSÃO é a CAUDA (`latest`) mais as pendentes
  quando a cauda vem cheia (RN-637) — nunca a primeira página.
- Tela que mostra um RECORTE diz que é recorte (RN-180). Toda leitura tem
  teto — `limit: 200` nos eventos e nas ações —, e teto silencioso faz a
  tela afirmar sobre o que não leu. O número que falta sai de SUBTRAÇÃO
  sobre o `seq` (gapless, por sessão), nunca de uma requisição a mais:
  é o mesmo mecanismo do sino (RN-100). Quando houver como carregar o
  resto, o controle mora onde o corte aparece.
- Ação de UI que vira N chamadas não é transação, e a tela DIZ isso (RN-469).
  Salvar uma seção de Configurações é um PUT por linha suja — em série, na
  ordem da tela, sem abortar na primeira recusa. O desfecho é POR LINHA: só o
  rascunho que a api confirmou some, o que falhou fica no campo e a seção
  continua marcada por ele, e os três desfechos não se disfarçam um do outro —
  todas passaram, NENHUMA passou (a mensagem da API, nunca uma contagem),
  ALGUMAS passaram (quantas de quantas, nomeando as que ficaram). Botão de
  seção deve a contagem do que está pendente, senão "Salvar" diz o mesmo com
  uma linha suja e com cinco. E a régua de quando o botão existe é o CONTROLE,
  não a seção: campo DIGITADO precisa de confirmação, escolha de valor NOMEADO
  salva no `onChange` — não converta as seções de autosave. O que essa régua
  mede é de QUEM é o valor, e há UMA exceção, declarada (RN-476): o seletor que
  aplica um modelo a TODOS os agentes tem botão, porque o valor dele não é
  configuração de nada — é o ARGUMENTO de uma ação sobre 17 linhas que a pessoa
  não estava editando, e no `onChange` um clique exploratório num dropdown as
  reescreveria. Ela grava no nível do AGENTE de propósito: pelo projeto os 17
  herdariam, mas o endpoint de projeto pede `maintainer` onde o de agente pede
  `developer`, e o binding de projeto é também o default de SESSÃO, que a RN-040
  deixa livre. O preço — as 17 linhas divergem, com origem `agent` — é
  declarado, não escondido.
- Tela NUNCA repete o enum do banco como se fosse resposta, e não colapsa
  dois estados por eles compartilharem um valor (RN-470). `origin: 'agent'`
  da cascata de modelo quer dizer DUAS coisas — o agente tem binding próprio,
  ou a cascata pousou em `workspace` e `herdarModeloDeStart` trocou o valor
  pelo do Criativo. A api está certa em devolver `agent` nos dois (o valor
  veio mesmo de um agente): quem separa é a TELA, e ela separa mostrando a
  cascata inteira como cadeia — `workspace › projeto › área › agente`, com
  `vigente`/`definido`/`vazio`/`pulado` por nó, o nível que a cascata alcançou
  marcado como definido-e-não-vigente quando o Criativo entrou, e um nó extra
  nomeando o Criativo. A derivação é do CLIENTE, sem endpoint novo; o que ela
  NÃO consegue provar (agente com linha própria igual à do Criativo) fica
  declarado, e a ação que só importa nesse caso continua acionável. Vazio tem
  texto próprio e vazios diferentes têm textos diferentes — um traço que serve
  a três significados não é neutro, é a tela recusando nomear o que sabe.
- Controle que oferece escolha abre oferecendo o que a api ACEITA naquele
  escopo, e quem decide isso é o ESCOPO, nunca a tela (RN-040). O filtro
  "aptos para agentes" do `ModelPicker` vem MARCADO nas duas telas que gravam
  onde `assertModelFitsBindingScope` exige tool calling — `agent` e `area` — e
  DESMARCADO no seletor de sessão, que grava num escopo livre de propósito:
  marcar ali esconderia o que o domínio permite, que é o defeito inverso. É
  estado INICIAL de um checkbox, nunca trava — desmarcar volta a listar tudo —,
  e não elimina o 422: cobre UMA das três causas, e a tela continua devendo o
  desfecho de recusa. Filtro ligado por padrão cria uma dívida própria: o
  vigente que ele esconde da LISTA (herdado de `project`/`workspace`, níveis que
  nunca exigiram tool calling) precisa ser DITO, com o nome do modelo e a causa
  — o gatilho mostrando um nome que a lista não contém é a tela se contradizendo.
- E o controle só é oferecido a QUEM a api deixa usar — a régua acima decide o
  QUE se oferece, esta decide a QUEM. O mínimo é do ENDPOINT, nunca da seção
  (RN-102): modelo por AGENTE pede `developer`, modelo por ÁREA pede
  `maintainer`, e as duas seções são vizinhas na mesma tela. Copiar o gate da
  vizinha por parecerem iguais produz o defeito INVERSO do que corrige, e o
  inverso é PIOR — oferecer o que será recusado ao menos termina num toast,
  enquanto trancar quem podia é invisível para quem perdeu a capacidade. A
  comparação sai de `roleAtLeast` (`apps/web/src/lib/roles.ts`, sobre
  `ROLE_ORDER`; mesmo nome da função do backend porque é a mesma regra dos dois
  lados), nunca de `role === 'x' || role === 'y'` à mão: a lista à mão acerta por
  acidente enquanto o mínimo é alto e erra calada quando é baixo. Papel AUSENTE
  não alcança nada. O que se tira é o CONTROLE, nunca a INFORMAÇÃO (ADR 0064):
  quem não pode editar continua vendo o valor vigente e a cadeia inteira, o
  controle fica inerte no lugar, e o motivo é dito UMA vez em TEXTO na seção —
  `title` em elemento `disabled` não abre no Chromium, então explicar por tooltip
  é não explicar. Nada disso é fronteira de segurança (quem recusa é o
  `RolesGuard`). O papel a LER é o EFETIVO do projeto — `projectRole ??
  workspaceRole`, uma SOBREPOSIÇÃO nos dois sentidos, e nunca "o maior dos dois"
  que três descrições de OpenAPI ainda prometem (RN-471). Onde a tela já busca
  `project_members` ele é DERIVÁVEL e a lacuna se FECHA (a seção de Membros, que
  compõe da lista que já carrega); onde não busca, lê-se o do WORKSPACE e a
  lacuna se DECLARA (as duas seções de modelo). É UMA lacuna vista de dois
  lados, não uma por seção — não a declare de novo onde os dados estão à mão,
  nem invente uma segunda fonte de papel onde não estão.
- Sinal de ambiente diz o que SABE, e proxy nunca vira garantia (RN-468).
  A tela de login é PRÉ-identidade: só cabem ali os dois `/health`, que já
  são públicos nos dois serviços — presença de runner
  (`{user_id, project_id}`) e modelos locais (`projects/:projectId/models`)
  não têm sujeito antes do login, e a tela DECLARA essa ausência em vez de
  omiti-la. Sonda tem TETO, e os três estados (`verificando`/`respondendo`/
  `sem resposta`) nunca colapsam — RN-088 vale aqui também. O formulário
  NUNCA espera pela sonda. Pós-login, `workspaceVerifiedAt` é registro de
  uma confirmação, não batimento: reconectar com o mesmo caminho nem
  regrava o carimbo, então a tela diz "pasta confirmada em <data>" com a
  ressalva, e nunca "de pé" nem bolinha verde. Quem sabe do AGORA é o
  socket do terminal, na aba Código.
- Evento tem DUAS classificações no cliente, e elas não se substituem:
  `ActivityKind` (assunto — decide ícone e cor) e `OrigemDeEvento`
  (camada — `eventos|sistema|llm|harness|agente|usuario`, RN-177). A
  origem tem UMA fonte, `apps/web/src/lib/activity.ts`, e é o eixo dos
  grupos do painel de log — o FIO não agrupa por origem desde a RN-644 (lá o
  histórico recolhido é UM bloco cronológico e o corte conta MENSAGENS,
  recuando até a abertura do turno); a precedência dos `if` é a regra (mecanismo
  vence ator, ator vence prefixo de agente) e tipo desconhecido cai em
  `eventos` — nunca some nem abre categoria nova.
- Testes: vitest (api/web/scripts de CI), ExUnit (engine). Nenhuma
  feature sem teste do caminho feliz + 1 caso de falha. Providers de
  git e de LLM validados por suas suites de contrato únicas. A quarta
  camada é o E2E de navegador em `e2e/` (ADR 0120) e ela responde uma
  pergunta que as outras três NÃO respondem — "um navegador de verdade,
  em outra origem, entra e fica dentro?". Ela não substitui nenhuma:
  comportamento continua sendo coberto embaixo, e teste que caberia na
  suite do web não sobe para cá.
- Capability só é declarada quando provada pela suite; sem prova,
  declara-se false e degrada (regra dos ADRs 0041/0042, vale para git
  e LLM).
- O contrato de LLMProvider tem DUAS operações opcionais, e as duas seguem a
  mesma regra de dois lados: `listModels` (Fase 9c) e `embed` (ADR 0075,
  RN-189..191). Embedding é LOTE e devolve **um vetor por entrada ou erro** —
  nunca lista mais curta, porque a ordem é o único vínculo entre entrada e
  vetor e uma resposta parcial é indetectável depois. O erro LANÇA normalizado
  por `code` em vez de virar chunk: não há turno em andamento cujo gasto
  precise sobreviver. A capability tem duas camadas como as outras, com uma
  diferença que precisou ser nomeada: tool calling é GRADIENTE (modelo sem
  ferramenta ainda conversa) e embedding é EXCLUSÃO — modelo de chat não
  vetoriza e modelo de embedding não conversa (RN-190), conjuntos disjuntos.
  Só o `ollama` declara `embeddings: true`, provado contra o daemon real; os
  outros oito degradam com `false` (RN-191), e virar essa flag exige smoke com
  credencial, nunca leitura de doc. O gasto de embedding NÃO passa pelo
  metering ainda — corte declarado do ADR 0075, porque `token_usage.session_id`
  é `NOT NULL` e indexar repositório não acontece dentro de sessão. A ÚNICA
  exceção é a checagem de duplicata semântica (ADR 0198, RN-681), que roda na
  emissão de história/regra, dentro de sessão, e grava linha própria (ator
  `system`/`duplicata-semantica`); o `uso` que `RagEmbeddingService` devolve é
  ignorado pela indexação e pela busca de propósito — não o "aproveite" lá.
- UI: fidelidade estrita ao design system em design/ (tokens, tipografia
  Space Grotesk/Archivo/IBM Plex Mono, dark mode primário). Contraste é
  medido por teste sobre os tokens e layout é verificado no navegador
  por scripts/dev/validacao-visual.js — as duas validações estão
  explicadas em design/README.md.
- Os DOIS temas são alcançáveis e os DOIS são medidos (ADR 0074,
  RN-182/184). `data-theme` é escrito por `apps/web/public/theme-boot.js`,
  ARQUIVO e não script inline — a imagem serve sob `script-src 'self'`, e
  inline passa em dev e é bloqueado em produção. A preferência mora em
  `localStorage['brabo.theme']` e a API é `apps/web/src/lib/tema.ts`;
  nenhum componente escreve o atributo por conta própria. Desde o ADR 0181
  (RN-640) a paleta é NEUTRA (escuro preto, claro branco, acento terracota) e
  NÃO há dívida de contraste: os cinco pares que o escuro devia desde a FASE 16
  são PISO nos dois temas. Não afrouxe um piso para passar, não reabra dívida
  "registrada", e não deixe o claro nascer pior que o primário. Cor que sai do
  CSS (Mermaid, xterm, minimapa) cai em `lib/tokens-padrao.ts`, conferido
  contra o `:root` por teste — não escreva fallback em hex no chamador; cor de
  agente é `var(--token)`; e `var(--x)` sem declaração reprova
  (`design-tokens-existentes.test.ts`).
- O handoff estabelece a INTENÇÃO; a medição estabelece o NÚMERO, e o
  produto estabelece o MECANISMO. Já valeu três vezes: as fontes (ADR
  0036), o boot de tema inline e cinco dos oito `--syn-*` que reprovam
  4,5:1 contra o próprio `--code-bg` do handoff (ADR 0074). Nome do
  handoff que já existe com outro nome entra como ALIAS, nunca
  renomeação — `--font-display`, `--shadow-modal` e `--r-md`/`--r-lg`/
  `--r-pill`; e `--r-sm` (7px) NÃO é sinônimo de `--radius-sm` (4px).
- Tipo novo de `proposed_action` nasce com FRASE em pt-BR em
  `apps/web/src/lib/aprovacoes.ts` — verbo e frase têm UMA fonte, e as
  três telas de decisão (Aprovações, chat da sessão, Insights) a
  consomem. `apps/web/src/lib/aprovacoes.test.ts` lê `ACTION_TYPES` do
  `decide.ts` e reprova tipo sem frase; payload cru nunca é despejado,
  nasce colapsado (RN-096). Valor de CÓDIGO na frase (comando, branch,
  caminho, imagem) entra por `codigo()`, nunca entre aspas: o card o desenha
  em mono por `trechosDaFraseDaAcao` (AT-322). O `ApprovalCard` tem UMA
  variante nas quatro superfícies — não reintroduza prop de aparência por
  tela; a largura é do contêiner e só o colapso inicial varia
  (`detalheRecolhido`).
- Segredos de usuário (API keys de LLM e tokens de git) criptografados
  com envelope encryption; nunca em plaintext no banco ou em logs. Desde a
  RN-563 (ADR 0158) o envelope carrega `key_id` — a IMPRESSÃO DIGITAL
  (`HMAC-SHA256(chave derivada, rótulo)`, 8 bytes) da chave mestra que o
  embrulhou, nas DUAS tabelas que guardam envelope (`user_credentials` e
  `project_git_connections`, que mudam sempre JUNTAS). Ele existe para
  responder em SQL *"quantas credenciais ainda estão na chave anterior?"* — o
  passo 2 do runbook — e para dar diagnóstico DIFERENTE a "veio de outro
  ambiente", "rótulo incoerente" e "linha sem rótulo". **Ele nunca decide se
  o envelope abre**: `decrypt` continua tentando a atual e caindo para a
  anterior, e `rewrap` continua decidindo "já está na chave atual" pela
  TENTATIVA — quem autentica é o GCM. Não "otimize" isso pulando a tentativa
  quando o rótulo bate: uma linha rotulada "atual" cujo envelope está na chave
  velha seria pulada em silêncio, ficaria fora da contagem, e o passo 3 (que
  descarta a chave velha) a tornaria ilegível para sempre — há teste fixando
  a linha mentirosa sendo re-embrulhada assim mesmo. `key_id` NULO é a linha
  gravada antes da coluna existir, e a consulta usa `IS DISTINCT FROM` e nunca
  `<>` justamente para contá-la como PENDENTE. Não há migração do acervo: o
  rótulo nasce na próxima escrita. E a impressão da chave corrente sai no log
  do boot da api, porque coluna que não se compara contra nada é inútil.
  A rotação inteira tem verificação NOMEADA desde a RN-562
  (`apps/api/test/scripts/rewrap-deks.spec.ts`, contra Postgres de verdade e
  contra as duas tabelas) — e é por ela que `rewrap-deks.ts` tem o núcleo
  exportado (`reenvelopar`) com o `main()` sob `require.main === module`:
  importar o script não pode rodar a rotação. A rotação NUNCA rodou em
  ambiente real (mantenedor, 2026-09-27); desde a AT-146 ela tem um ENSAIO no
  cluster, semanal e último alvo do `propriedades.yml`
  (`make test-rotacao-chave-mestra-k8s`): os três passos do runbook pela fonte
  do `ExternalSecret`, com restart da api e o `rewrap-deks.js` da imagem —
  ensaio, não rotação de ambiente real.
- Decisões arquiteturais relevantes registradas em docs/adr/.
- Subagentes das rodadas do backlog têm DUAS definições em `.claude/agents/`,
  por esforço de raciocínio (decisão do dono, 30/09): `analista` (esforço
  MÉDIO, somente leitura) levanta requisitos e mede antes de uma atividade, e
  `executor` (esforço BAIXO) executa a atividade já especificada. Não troque
  os papéis: esforço médio é só para raciocínio de levantamento.
