# ADR 0022 — Fechamento da Fase 4b (sessão 1): evidência que chega, custo que aparece, análise que sobrevive ao kill

- Status: aceito
- Data: 2026-07-25
- Fase: 4b (fechamento da sessão 1 — o Psicólogo real em si é o ADR 0015)

## Contexto

O ADR 0015 entregou o Psicólogo real: consumer de `session.closed`,
contexto montado, hipóteses estruturadas via ToolLoop, evidência validada no
domínio, idempotência por índice parcial único, triagem de custo por tier.
Nada disso foi desfeito aqui.

O que faltava era o passo que os ADRs 0019/0020/0021 deram pra Fase 4a:
rodar o critério de aceite e descobrir o que só aparece rodando. Uma
auditoria dos três apps contra o enunciado achou desvios concretos — três
deles quebravam o critério de aceite ao pé da letra, e o critério nunca
tinha sido executado (todas as fases anteriores têm um `demo:*`; o Psicólogo
não tinha).

## Decisões

### 1. Evidência navegável exige buscar o evento por ID

O chip de evidência navegava pra `/projects/:id/sessions/:sid?highlightEvent=:eid`
e o `SessionPage` rolava até `#event-<id>`. Duas coisas faziam esse destino
não existir:

- `ActivityFeed` esconde ruído de máquina (`agent.response`, `tool.call`,
  `tool.result`, `agent.status`, `agent.delta`, `context.compacted`) e ainda
  aplica filtros de agente/tipo. São EXATAMENTE os eventos que o Psicólogo
  mais cita — é onde está o comportamento dos agentes. O chip navegava e a
  tela não mostrava nada.
- `useSessionEvents` busca `{ limit: 200, latest: true }`. Evidência fora
  dos últimos 200 eventos era inalcançável — e o comentário do próprio
  `activity.ts` registra um log real com 193 eventos.

Duas correções, deliberadamente diferentes em natureza:

**`GET /projects/:projectId/sessions/:sessionId/events/:eventId`** (novo,
`viewer`) sobre `GetSessionEventUseCase`, que reusa
`SessionEventRepository.findById` com a MESMA checagem de pertencimento de
`ProposeHypothesesUseCase.resolveKnownEventIds` (existe E é desta sessão;
id de outra sessão é 404). O `SessionPage` renderiza o evento citado
**fixado no topo** do painel de log. Isso é independente de paginação e de
filtro — é a garantia estrutural de que a evidência chega.

**`ActivityFeed` nunca esconde o evento destacado**, mesmo sendo ruído de
máquina, mesmo com filtro ativo. Um destaque invisível é uma navegação que
não chega em nada.

Por que os dois e não só um: o evento fixado resolve o caso geral; a exceção
no filtro mantém o destaque coerente quando o evento TAMBÉM está na janela —
sem ela o usuário veria o evento no topo e não veria o realce no log.

### 2. O custo por análise existia e não aparecia em lugar nenhum

`GetPsychologistAnalysisCostUseCase` estava registrado no módulo de DI e
**nenhum controller o injetava**. O docstring dele afirmava ser "o número
que a UI mostra no card de Insight" — não havia rota, não havia UI, não
havia teste. "Custos distintos entre triagem leve e pesada visíveis no
metering" não era verificável por ninguém.

`GET /projects/:projectId/psychologist/analyses` (`viewer`) sobre
`ListPsychologistAnalysesUseCase`, que combina as análises current com a
contagem de hipóteses (uma query agrupada, não N) e o custo somado de
`token_usage`. A UI ganhou uma faixa de análises no topo da seção Insights:
tier, contagem de eventos, hipóteses, custo e link pra sessão.

O custo é por SESSÃO analisada, não por linha de análise — `token_usage`
grava por sessão + ator, sem referência à análise. Numa sessão reanalisada
o número é o acumulado das passadas, o que é o certo pra "quanto o
Psicólogo gastou nesta sessão"; daí o campo se chamar `costMicros` e não
`analysisCostMicros`.

### 3. Sem Lifeline, "análise pós-restart" era impossível

`config :engine, Oban` tinha `plugins: [Oban.Plugins.Pruner]`. Com o
`Oban.Engines.Basic`, um job SIGKILLado enquanto estava `executing` não
volta: o nó morreu sem marcar desfecho, a linha fica órfã em `executing`
para sempre, e o `max_attempts: 5` do worker nunca é exercido. O requisito
"kill do engine gerando análise pós-restart" não tinha como valer.

`{Oban.Plugins.Lifeline, rescue_after: :timer.minutes(5)}` entrou nos
plugins. Vale pra TODOS os workers de propósito (Psicólogo, Anamnese, drain
do outbox) — a orfandade é do mecanismo, não de um worker.

O teste que guarda isso (`Engine.ObanDurabilityTest`) afirma a config, não o
comportamento: todo teste de worker chama `perform/1` direto, então o
cenário de orfandade só existe rodando o engine de verdade. Um teste de
config é o que impede a regressão silenciosa; o cenário real fica no
runbook de verificação.

### 4. `:ok` num branch de falha matava a retentativa

`PsychologistWorker.perform/1` devolvia `:ok` quando o contexto não vinha,
com um comentário dizendo "deixa o Oban retentar". No Oban, `:ok` marca o
job `completed`. Se a api estivesse fora no momento do drain, a análise
sumia em silêncio.

Agora devolve `{:error, reason}`. Sem narrar `analysis_failed` nesse branch
de propósito: o caminho de narração é a própria api, que é justamente quem
está fora — quem registra o desfecho enquanto isso é a linha do job.

`reason_for/1` também passou a olhar `ctx.last_error`, que o ToolLoop
preenche em falha de provider. Sem isso, timeout de provider era narrado
como "encerrou sem emitir hipóteses" — a mesma armadilha já fechada no QA e
no Dev (ADR 0019), que são código mais novo que o Psicólogo.

### 5. A causa de término vem do MOTIVO, não do status

`Monitor.classify/1` manda `heartbeat_timeout` fechar como `"closed"` de
propósito (ninguém do outro lado é um jeito normal de a sessão acabar, não
uma falha do engine). Mas `TerminationClassifier.classify(_, "closed")`
devolvia `:normal`, então:

- a causa `:timeout` era **inalcançável em produção**, apesar de o enunciado
  nomear timeout ao lado de crash e kill;
- sessão morta por timeout aparecia no prompt como "encerramento normal" e
  nunca ganhava a seção de análise de término;
- o teste do classificador travava o comportamento errado
  (`classify("heartbeat_timeout", "closed") == :normal`).

O classificador passou a ler o motivo primeiro. Descartamos mudar
`Monitor.classify/1` pra `heartbeat_timeout` fechar como
`closed_abnormally`: resolveria na origem, mas mexe na máquina de estados da
Fase 1/4a e nos testes dela, fora do escopo desta sessão — e a decisão de
que timeout é um fecho *não-anormal do ponto de vista do engine* continua
correta. Quem precisa de outra opinião é o Psicólogo, e é ele que a expressa.

Consequência de contrato: o engine passa a mandar `cause` no payload de
`emit_hypotheses`, e a api exige `terminationAnalysis` quando
`cause !== 'normal'` (`requiresTerminationAnalysis`) em vez de olhar
`session.status === 'closed_abnormally'`. `cause` é opcional no DTO — sem
ela, cai no comportamento anterior, então um engine mais antigo não quebra
em rolling deploy.

Também nasceu uma causa honesta pra `{"normal", "closed_abnormally"}` (o
processo saiu limpo mas a api não esperava a parada): `:unknown`, com o
rótulo "parada inesperada, sem causa identificada". Antes cairia em
`:crash`, que mentiria sobre haver exceção.

### 6. O log do prompt precisa de teto — pinned não compacta

O event log inteiro ia numa única mensagem `:pinned`, e o `ContextManager`
nunca compacta pinned. Isso é CORRETO (um resumo não preserva os event ids
que a evidência tem que citar), mas significa que o corte tem que acontecer
antes: com `Event.list/1` sem `LIMIT` e `inspect(payload)` por evento, uma
sessão longa estourava a janela de 128k e a análise morria em erro de
provider.

Três mudanças:

- `Event.count/1` (COUNT no banco) e `Event.list_recent/2`. A triagem passou
  a decidir sobre a contagem real sem carregar o log; só depois, já sabendo
  o tier, os eventos são lidos com o teto daquele tier.
- Teto de eventos por tier (`max_prompt_events`) e de tamanho de payload por
  evento (`max_payload_chars`). A CAUDA é o que entra: é onde está o estado
  da sessão no momento do término, que é justamente o que a seção de término
  precisa descrever. Mesmo raciocínio do `latest: true` do feed.
- O corte é **visível pro modelo**: o prompt diz quantos eventos foram
  omitidos e manda citar só ids presentes. Sem isso o modelo concluiria que
  leu a sessão inteira, e citaria ids que não viu — que a api rejeitaria,
  queimando iteração.

### 7. Ciclo de vida da hipótese vira compare-and-swap

`updateStatus` não tinha `WHERE status = 'proposed'` — a proteção contra
double-accept era só a checagem read-then-write do use case, então dois
cliques simultâneos passavam os dois e o segundo sobrescrevia a decisão do
primeiro. Virou `updateStatusIfProposed`, que devolve `null` quando não casa
e o use case traduz em 400.

A checagem de domínio (`assertHypothesisTransition`) continua antes do CAS,
de propósito: é ela que dá a mensagem boa pro caso comum ("já foi aceita").
O CAS é a exclusão mútua, não a explicação.

`AcceptHypothesisUseCase` também passou a rodar em UMA transação. Eram
quatro (update, dois eventos, enqueue da Anamnese): um crash no meio deixava
uma hipótese `accepted` que nunca chegou na fila — quebrando exatamente o
loop fechado que o accept existe pra alimentar.

### 8. Corrida de análise concorrente é conflito, não 500

`findCurrentBySession` não toma lock, então dois runs `auto` simultâneos veem
"sem análise current" e inserem os dois. O índice parcial único sempre foi a
rede de segurança certa — o que faltava era traduzir a violação (23505 no
índice nomeado) num `ConflictException` em vez de deixar escapar como 500.
Não pusemos `SELECT ... FOR UPDATE`: quem perde a corrida não perde trabalho
(a análise vencedora já está gravada), então bloquear seria custo sem ganho.

`superseded_at` (migração `0020`) responde QUANDO a análise foi substituída.
A cadeia `supersedes` já respondia por quem, mas "substitui a versão anterior
com histórico" não é auditável sem a data.

### 9. Triagem virou knob de operador

Limiar, tetos de iteração, orçamento por tier e os tetos de prompt eram
atributos de módulo. Foram pra `config/runtime.exs` com os valores do ADR
0015 como default, alinhados aos outros knobs do harness — controle de custo
é coisa que se aperta por ambiente, não recompilando.

### 10. Limpeza

`ActionPipeline` estava registrado como `:pre_tool_use` nos hooks do
Psicólogo, mas o registry tem uma tool só, `emit_hypotheses`, que é
`:direct` (o Psicólogo é read-only, nunca propõe ação com efeito externo) —
no-op permanente, removido. `listCurrentByProject`/
`listNonDismissedByProject` ganharam `ORDER BY created_at DESC` (sem isso o
Postgres não promete ordem e o agrupamento do Insights trocava de ordem
entre polls). O `reanalyzeSession` do `api-client` existia sem chamador
nenhum: ganhou botão na faixa de análises. E o comentário do
`internal-sessions.controller` que ainda falava do "PsychologistWorker
(placeholder, fase 3+ traz a análise real)" foi corrigido.

## Consequências

- **Critério de aceite executável**: `apps/api/scripts/demo-psicologo.ts`
  (`pnpm --filter api demo:psicologo`) encerra 3 sessões — normal com log
  curto (triagem leve), kill (`closed_abnormally`, causa `kill`), e erro com
  log longo (triagem pesada) — e verifica estruturalmente: uma análise
  current por sessão, o tier esperado, ao menos uma hipótese, TODA evidência
  resolvendo pelo endpoint por id na própria sessão, `terminationAnalysis`
  nas duas anormais, custo da leve abaixo do da pesada, e reprocessamento
  que supersede sem apagar (com data). Sai com código 1 e lista as falhas se
  algo não bate. O TEXTO das hipóteses não é verificado — sai de um LLM.

- **Os dois modelos ollama são semeados com preço ZERO**, e custo zero nos
  dois tiers não provaria nada sobre "custos distintos". O script atribui
  preços nominais distintos a eles (o seed diz explicitamente que preço é
  editável) e liga cada tier a um. O custo continua saindo do caminho real
  (`RunLlmTurnUseCase` grava `token_usage.cost_micros` do preço do modelo) —
  sem nenhum mecanismo de custo paralelo. Rodando contra provider pago,
  `DEMO_MODEL_LEVE`/`DEMO_MODEL_PESADO` dispensam isso.

- **O kill do script é o report do Monitor**, não um SIGKILL de processo: o
  que o Psicólogo consome é `sessions.termination_reason` + status, e é
  exatamente isso que um kill real produziria. Matar o container do engine
  no meio de uma análise é o OUTRO cenário (resgate do job órfão pelo
  Lifeline) e se verifica à mão: com o job em `executing`, `docker kill` no
  engine, subir de novo, e a análise conclui depois do `rescue_after`.

- **Primeiros testes de web da Fase 4b**: `HypothesisCard` (confiança,
  navegação de evidência apontando pra sessão ANALISADA, seção de término,
  ações só enquanto proposta), `ActivityFeed` (o destacado nunca é
  escondido, nem sendo ruído de máquina, nem com filtro de agente) e os
  branches `psychologist.*` de `activity.ts` — que existiam sem nenhum teste.

- No engine entraram testes de triagem pesada ponta a ponta (todos os
  anteriores rodavam com log vazio, `event_count == 0`), falha de contexto
  devolvendo `{:error, _}`, correção bem-sucedida DEPOIS de uma rejeição da
  api (o ciclo "até M tentativas" nunca tinha sido exercido até o sucesso),
  timeout classificado a partir de `heartbeat_timeout` com status `"closed"`,
  e o corte do log. Na api, `AcceptHypothesisUseCase`/
  `DismissHypothesisUseCase` (que não tinham teste nenhum), o CAS barrando
  double-accept, `ListPsychologistAnalysesUseCase` (leve < pesada),
  `GetSessionEventUseCase` e a exigência de término guiada por `cause`.

## Escopo & assunções

Fora deste fechamento: `SELECT ... FOR UPDATE` em `findCurrentBySession`
(ver decisão 8); `Oban unique:` no nível do job (a constraint + o pré-check
bastam, e o Lifeline resolve o caso que motivaria); reanálise em lote;
dashboard de custo além da faixa de análises; qualquer mudança em
`Monitor.classify/1` ou na máquina de estados de sessão.

O `superseded_at` é aditivo e nullable — análises substituídas ANTES desta
migração ficam com `superseded = true` e data nula, e isso é honesto: não
existe registro de quando aconteceu.
