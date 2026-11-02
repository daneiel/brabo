# ADR 0021 — Fechamento da Fase 4a: gate de infra que valida, e painel que diz a verdade

- Status: aceito — critério de aceite NÃO fechado (ver a seção própria)
- Data: 2026-07-25
- Fase: 4a (fechamento — auditoria do ADR 0014)

## Contexto

O ADR 0014 entregou o InfraAgent, os gates de PR de infra e o painel do time.
Como nos ADRs 0019 e 0020, **o critério de aceite nunca rodou**: não existia
demo de infra (`grep` por `InfraAgent|open_infra_pr|handoff-infra` nos quatro
scripts de demo devolvia 0 em todos).

A auditoria por leitura achou que os DOIS lados do critério de aceite estavam
comprometidos — o gate de QA não validava nada, e o painel mostrava estado
errado para a maioria dos agentes.

O que estava correto e não foi mexido: a negação de terminal ao InfraAgent
(estrutural pelo tool registry + policy `agent_autonomy deny`, com o
curto-circuito provado em `decide.spec.ts` e o caminho completo em
`propose-action.use-case.spec.ts`), a máquina de gates compartilhada, o ciclo
de correção sem PR nova, e a recusa do `docker build --check` (o container do
engine não tem o `docker` CLI nem o socket montado — confirmado por inspeção).

## Decisões

### 1. O gate de QA de infra aprovava QUALQUER Dockerfile (o achado central)

`hadolint` **não estava instalado no container do engine**. E
`InfraGateRunner.lint_dockerfiles/1` trata a ausência como degradação
graciosa: devolve `{[], ["hadolint indisponível, pulado"]}` → `findings == []`
→ `veredito = "approved"`.

O critério de aceite ("PR com Dockerfile válido que passa os gates") passaria
sem que nada tivesse sido verificado. Mesma classe do gitleaks do ADR 0020: o
gate parecia verde justamente porque não checava nada, e a degradação
graciosa — que existe por bons motivos — escondia isso.

`hadolint` entrou no Dockerfile no MESMO bloco do gitleaks, pra aproveitar o
`curl` do grupo virtual antes dele ser removido.

### 2. Compose e CI não passavam por validação nenhuma

`lint_dockerfiles/1` filtra por `dockerfile?/1`, e havia até um teste fixando
que "sem Dockerfile entre os arquivos, aprova sem rodar hadolint". Mas o
InfraAgent propõe TAMBÉM um `docker-compose.yml` e um `.github/workflows/ci.yml`,
e o enunciado pede "validação sintática" das PRs de infra.

`Engine.Actions.YamlLintDetector` (novo) espelha o `HadolintDetector` —
conteúdo em vez de path, `available?/0` + `lint/1`, `.Live`/`.Fake`, mesma
degradação. Usa `yamllint` via pip, aproveitando o python3 que já veio com o
semgrep: não há parser de YAML nas deps do Elixir, e o padrão da casa pra
validação é ferramenta externa com detecção opcional, não dependência nova.

### 3. Severidade: só `error` reprova — senão o gate é inútil

Descoberto testando os binários antes de escrever o código, e é o que decide
se o gate é usável:

- Um Dockerfile perfeitamente razoável (`FROM node:24-alpine` +
  `RUN apk add --no-cache git`) já colhe `warning` DL3018 ("pin versions in
  apk add"). Se `warning` reprovasse, **nenhum Dockerfile gerado por LLM
  passaria** e o InfraAgent circularia até estourar o teto de correções —
  exatamente o loop que travou o aceite do ADR 0020.
- No yamllint, filtrar por nível não bastava: no perfil `relaxed` ele
  classifica `new-line-at-end-of-file` como `[error]`, e YAML gerado por LLM
  raramente termina com quebra de linha. A saída foi rodar com **regras
  vazias** (`-d "{rules: {}}"`): sem nenhuma regra ativa, o yamllint só reporta
  falha de PARSE, que é o que "validação sintática" quer dizer. Verificado:
  YAML válido sem newline final sai limpo, `ports: [` sem fechar sai
  `[error] syntax error (syntax)`.

Os achados não-bloqueantes continuam no parecer como informação — o resumo
distingue "N achado(s)" de "N aviso(s) não bloqueante(s)", pra o parecer não
sugerir que um nit de estilo barrou a PR.

### 4. `agent.status` nunca era persistido — 4 agentes presos em "ocioso"

No engine o `agent.status` existia só como `EngineWeb.Endpoint.broadcast`. Mas
`deriveAgentRoster` lê `agent.status` do event log buscado por HTTP — então
Criativo, PO, Arquiteto e Infra apareciam **permanentemente "ocioso"**,
inclusive no meio de um turno. Pior: o handler `onAgentStatus` da web
invalidava uma query que, por construção, nunca conteria o dado que o push
acabara de carregar.

`Engine.Sessions.LiveBroadcast.agent_status/4` (novo) broadcasta E persiste.
Os quatro servidores passaram a rotear pela cláusula de `broadcast/3` em vez
de terem 20 call sites alterados. Broadcast primeiro (é o caminho ao vivo, não
deve esperar o round-trip HTTP); falha no append não derruba o turno — status
é narrativa, não decisão.

### 5. O painel lia os 200 PRIMEIROS eventos da sessão

`listPaginated` ordena `asc(seq)` com `limit`. O painel do time, a seção de
execução e o feed de atividade derivavam estado do COMEÇO da sessão pra
sempre, assim que ela passava de 200 eventos — o que uma execução real faz
com folga. Sozinho, isto invalidava "estados corretos durante uma execução
real".

`ListPaginatedOptions.latest` (opt-in) pega do fim pelo banco e reverte na
memória, devolvendo em ordem crescente pra não mudar a leitura de quem
consome. `nextCursor` é `null`: não existe página mais recente que a última —
quem varre a sessão inteira continua usando `afterSeq`, que `latest` ignora.

### 6. Heurísticas de status que nunca diziam a verdade

- `devStatus` devolvia `trabalhando` para tudo que não fosse bloqueio,
  inclusive com `dev.idle` no log e inclusive **sem nenhum evento do agente**:
  um dev parado aparecia trabalhando pra sempre. Agora `dev.idle` e o silêncio
  total dizem `ocioso`.
- **Nenhum caminho produzia `aguardando`** — o contador do header era sempre 0.
  Agora um agente com `proposed_action` pendente entra como `aguardando`, que
  é o estado mais informativo que ele pode ter no painel. `falhou` continua
  vencendo: uma task bloqueada é o que o usuário precisa ver primeiro.

### 7. O AgentCard não mostrava autonomia, task nem tokens

- O toggle de autonomia **nunca renderizava**: o `AgentCard` exige
  `autonomy && onAutonomyChange`, e o `ProjectOverviewTab` nunca passou o
  handler. `setAgentAutonomy` existia no `api-client.ts` desde a Fase 4a como
  **código morto**. Além disso `autonomyActionTypeFor` só mapeava `infra` e
  `dev-*` — criativo/po/arquiteto/qa/secops nem recebiam a prop.
- Task e tokens não tinham prop nem slot. A task já era derivada por
  `deriveExecutionProgress` mas só alimentava a `ExecutionSection`: o mesmo
  `dev-<modulo>` aparecia duas vezes na tela, uma com o dado e outra sem.
- **Tokens por agente não existiam no backend.** `token_usage` tem
  `session_id`/`actor_id`/`cost_micros`, mas o port só expunha
  `sumBySessionAndActorIds`, consumido apenas pelo custo do Psicólogo, e não
  havia rota. Novos: `sumBySessionGroupedByActor`, `GetSessionTokenUsageUseCase`
  e `GET projects/:id/sessions/:id/token-usage`. Nenhuma instrumentação nova —
  `RecordLlmUsageUseCase` já gravava pra qualquer agente.

### 8. Recuperação de tool call não valia pros agentes conversacionais

Achado na execução do critério de aceite. O InfraAgent escreveu o
`propose_infra_pr` CERTO, mas como bloco de texto em vez de tool call nativa —
e o turno terminou com resposta vazia e o agente foi pra ocioso sem propor
nada. `Engine.Harness.ToolCallRecovery` existia desde o ADR 0020 e resolve
exatamente isso, mas vive dentro do `ToolLoop`, e os quatro agentes
conversacionais (Criativo/PO/Arquiteto/Infra) têm **loop próprio** — ficaram
de fora da correção sem que ninguém notasse, porque nenhum deles tinha rodado
contra um modelo local desde então.

`tool_calls/2` dos quatro agora consulta a recuperação quando `toolCalls` vem
vazio, ancorada nos `tool_specs` do próprio agente (mesma precisão do ToolLoop:
só recupera nome que é ferramenta registrada de verdade).

### 9. O gate de QA aprovava PR de infra SEM NENHUM arquivo válido

Segunda forma de aprovação vazia, e também só apareceu rodando: o modelo
produziu `files` malformados — os `path` eram blobs de JSON —, então nenhum
Dockerfile nem YAML foi reconhecido, `lint_dockerfiles/1` e `lint_yamls/1`
devolveram lista vazia, e o veredito saiu **`approved`** com o resumo dizendo
literalmente "nenhum Dockerfile encontrado na PR nenhum YAML encontrado na PR".
A PR chegou a `awaiting_user` sem conter um único artefato de infra.

A asserção do demo pegou (exigindo um Dockerfile); o GATE não. Agora uma PR de
infra sem nenhum arquivo reconhecível é `changes_requested`, com um item que
explica o formato esperado de `path`/`content`. **Invalidável não é o mesmo que
válido** — e o teste que existia (`"sem Dockerfile entre os arquivos, aprova
sem rodar hadolint"`) estava fixando justamente o defeito.

### 10. O feed não narrava a fase de execução

`classifyEvent` cobria pareceres, gates e infra, mas os eventos que o enunciado
lista nominalmente caíam no genérico:

- `backlog.task_claimed` → "atualizou o backlog", sem dizer QUAL task
- **a PR de um dev** → a api grava `action.pr_open`, que caía no ramo de
  `action.*` e era narrado como "executou um comando", junto de qualquer
  terminal
- `backlog.task_blocked`/`task_unblocked`/`task_status_changed` → genérico

### 11. Caminho absoluto derrubava a PR, e a branch órfã travava a sessão

Dois defeitos encadeados, ambos nossos, achados na execução:

- O modelo escolheu `path: "/api/Dockerfile"`. O `commitFiles` do provider
  local passa o path direto pro `git update-index --cacheinfo`, que recusa
  caminho absoluto — a PR inteira morria com um `Command failed: git ...
  update-index` opaco. `normalizeInfraPath` (nova, pura, testada) tira a barra
  à esquerda (intenção inequívoca de "raiz do repo") e **recusa** travessia
  (`..`) com mensagem clara: conteúdo vindo de LLM nunca tem motivo legítimo
  pra escrever fora do repositório.
- Com a primeira tentativa falhando DEPOIS de `createBranch` e ANTES do
  artefato ser gravado (ele só nasce no sucesso), toda tentativa seguinte caía
  em `createBranch` de novo e morria com "branch já existe" — a sessão ficava
  **permanentemente** incapaz de abrir a PR de infra. Cinco tentativas seguidas
  assim no log. `createBranch` agora tolera a branch existente.

`ExecuteInfraPrUseCase` não tinha teste nenhum; ganhou seis.

## Estado do critério de aceite: NÃO FECHADO

Quatro execuções, nenhuma completou. As três primeiras falharam por **defeitos
nossos** (itens 8, 9 e 11) — e é por isso que valeu insistir: cada execução
pagou um defeito real que nenhuma leitura tinha achado.

A quarta falhou por **limite do modelo**: o `qwen2.5-coder:7b` produziu o
`propose_infra_pr` com JSON malformado (aspas desbalanceadas) e conteúdo sem
sentido (`node_modules/@express·require` como conteúdo de Dockerfile). A
recuperação de tool call corretamente devolveu vazio — ela recusa adivinhar
sobre JSON quebrado, e essa recusa é o comportamento certo.

A tarefa do InfraAgent é mais dura que a do DevAgent: três tipos de artefato
(Dockerfile por módulo + compose + CI), com conteúdo real, numa única chamada
de ferramenta com payload aninhado. Um 7B local não sustenta isso de forma
confiável.

**O que falta**: apontar `DEMO_MODEL` do demo de infra pra um modelo de API.
Mesma conclusão do ADR 0020 sobre o gate semântico do QA, e o binding por
agente já existe pra isso.

O que ESTÁ verificado em execução real, apesar disso:

- `agent.status` persistido (`working`/`idle` no event log — item 4)
- a recuperação de tool call nos agentes conversacionais funcionando (item 8):
  numa das execuções o InfraAgent propôs a PR e os dois gates rodaram até
  `awaiting_user`
- os gates de infra disparando na ordem e registrando parecer com `prActionId`
- o gate recusando PR sem artefato válido (item 9) e o hadolint/yamllint
  instalados e respondendo no container

## Consequências

- Suites: engine 237, api 445, web 72 (baseline 227/433/47).
- Testes: `hadolint_detector_test` e `yamllint_detector_test` contra os
  BINÁRIOS reais (tags `:hadolint`/`:yamllint`, excluídas automaticamente
  quando ausentes — mesmo mecanismo do `:gitleaks`), fixando que sintaxe
  quebrada reprova e nit de estilo não; `session-event-latest.repository`
  (primeiros × últimos); `token-usage.repository` (agregação por ator);
  `agent-status.test.ts` e `activity.test.ts` — **`deriveAgentRoster` e
  `classifyEvent` não tinham teste NENHUM**, e são exatamente os itens 3 e 4
  do enunciado; `AgentCard.test.tsx` (os cinco campos + o toggle).
- `apps/api/scripts/demo-infra-agent.ts` (`pnpm --filter api demo:infra-agent`)
  é o critério de aceite executável. Ele falha explicitamente se o resumo do
  parecer disser "hadolint indisponível" ou "yamllint indisponível" — um gate
  que aprova sem validar não conta como aprovação.

## Escopo & assunções

`docker build --check` continua fora (sem `docker` CLI nem socket no container
do engine) — o enunciado acomoda com "quando disponíveis no container".

O canal Phoenix segue como GATILHO de refetch, não fonte de dados: o payload
de `event.appended` é descartado e o que atualiza a tela é a invalidação da
query. Com `agent.status` agora persistido, o dado que o push anuncia existe de
fato no log — que era o elo quebrado. Um relay que use o payload direto
continua fora de escopo.

Status de dev/qa/secops segue heurístico sobre o event log (best-effort, nunca
usado por decisão de gate). O demo não é determinístico: o InfraAgent gera os
arquivos via LLM, e o que se exige é a PR com Dockerfile e os dois pareceres —
não que o modelo escreva um Dockerfile específico.
