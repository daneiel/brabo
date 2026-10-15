# ADR 0026 — Fase 5 (sessão 3): graceful shutdown, OpenTelemetry, métricas, logs e dashboards

- Status: aceito
- Data: 2026-07-26
- Fase: 5 (sessão 3 — itens 4 e 5 do escopo)
- Sucede: [ADR 0025](0025-fase5-deploy-kubernetes-kustomize.md), cuja limitação
  1 ("não há drenagem de sessões no shutdown") é resolvida aqui.

## Contexto

As sessões 1 e 2 entregaram imagens de produção, CI e o deploy Kubernetes com
HPA do engine por profundidade de fila. Ficaram para depois, explicitamente, o
graceful shutdown e a observabilidade.

Esta sessão entrega os dois. O critério de aceite era duplo e executável: um
rollout com sessões ativas sem nenhuma órfã, e no Grafana local seguir uma
sessão da trace raiz até um tool call específico, vendo o custo dela no
dashboard.

**O trabalho grande não foi escrever instrumentação — foi descobrir que escalar
o engine estava quebrado desde a sessão passada.** Seis defeitos apareceram, e
nenhum deles quebrava teste: cinco eram silenciosos por construção.

## Decisões

### 1. Uma sessão tem UM dono no cluster: registro `:global`

`Engine.Sessions.SessionServer` era registrado num `Registry` **local ao nó**, e
`Engine.Sessions.Rehydrator` recria no boot um processo para toda linha de
`engine.session_states` — que é tabela global. Com N réplicas cada sessão
passava a existir N vezes; o websocket do browser chega em UMA (o Service
balanceia) e as outras N−1 cópias, sem receber `ping`, estouravam o heartbeat de
30s e mandavam a api encerrar **uma sessão viva em outro pod**.

Ou seja: escalar o engine matava as sessões dos usuários em 30 segundos, e o
`make hpa-test` aprovado na sessão 2 escala para 3.

O nome passou para `:global`. Isso deduplica entre nós e, de quebra, faz
`heartbeat/1` alcançar o dono onde ele estiver — antes o `join` do canal falhava
quando o websocket caía no pod "errado". O `Registry` permanece na árvore
porque os servers de agente (`po:`, `criativo:`, `arquiteto:`, `infra:`) o usam
com chaves prefixadas.

### 2. `:global` resolve conflito de nome MATANDO um processo — e isso explicava tudo

Este foi o defeito mais difícil da sessão, e vale registrar o método porque a
evidência apontava para o lugar errado por várias rodadas.

Sintoma: o drain funcionava perfeitamente quando chamado à mão (`5 sessões, 5
com node_shutdown`) e **não drenava nada durante um rollout de verdade** — o
`preStop` reportava `total: 0` e a api registrava as sessões como `killed`.

Causa: num rollout (`maxSurge: 1`) o pod novo sobe enquanto o antigo ainda
hospeda as sessões. Ele reidratava antes de o `:global` ter **sincronizado as
tabelas de nomes**, `whereis_name` devolvia `:undefined` para nomes que existiam
no outro nó, e ele criava uma segunda cópia de cada sessão. Quando a
sincronização terminava, o `:global` resolvia o conflito com o resolvedor
default `random_exit_name`, que **mata um dos dois processos com
`exit(pid, :kill)`**. O sorteio matava a cópia do pod antigo, que chegava no
`preStop` sem nada local para drenar.

`Node.list()` não-vazio diz **conectado**, não "tabelas trocadas". Falta
`:global.sync()`, e é ele que fecha a janela. O `Rehydrator` passou a esperar o
cluster e sincronizar antes de reidratar — e só quando há sessão para reidratar,
para não penalizar boot com a tabela vazia.

### 3. Drain proativo no `preStop`, não `terminate/2`

Quando o supervisor desce, cada `SessionServer` recebe `exit(:shutdown)` e morre
instantaneamente — não trapa exits, não tem `terminate/2`. Acrescentar
`trap_exit` resolveria pela metade: o supervisor concede 5s por filho, e o drain
precisa de rede (evento na api, handoff para outro nó).

Então o `preStop` chama `Engine.Shutdown.drain()` com o BEAM inteiro ainda de pé.
Para cada sessão local: emite `session.draining`, solta o nome global, e oferece
a sessão a um par por `:erpc`. As **não adotadas** viram `active → closing`
(causa `node_shutdown`) e depois `closed_abnormally`.

Sessão adotada continua `active` e nunca vira `closing` — a máquina de estados
não permite voltar de `closing` para `active`, então anunciar `closing` para
tudo tornaria a adoção impossível. É a resposta ao "closing/node_shutdown **OU**
reidratadas" do enunciado: as duas metades, decididas por sessão.

`drain/0` devolve um resumo (`%{total:, adopted:, terminated:}`) em vez de `:ok`
porque o stdout do hook é o único registro que sobra depois que o pod some — foi
esse resumo que permitiu diagnosticar a decisão 2.

`Engine.Sessions.Adopter` cobre o que o `preStop` não alcança: `kill -9`,
OOMKill, nó evictado. Sem ele, "zero órfãs" só valeria para o desligamento
educado.

### 4. Quatro bloqueios na fronteira api↔engine

- O DTO interno rejeitava `to: "closing"` (`@IsIn(['closed','closed_abnormally'])`);
  a única rota que aceitava `closing` era a humana, atrás de RBAC de usuário.
- `termination_reason` só era persistido em estado terminal, então a causa
  `node_shutdown` seria descartada exatamente onde o `TerminationClassifier` do
  Psicólogo vai lê-la.
- O classificador não conhecia `node_shutdown`. Entrou **antes** do catch-all de
  `closed_abnormally`, senão o drain apareceria como `:crash` e o Psicólogo
  levantaria hipótese sobre um defeito que não existe.
- O DTO de hipóteses rejeitaria a causa nova, e o modo de falha é ruim: o 400
  volta ao modelo como resultado de tool e o ToolLoop gira até estourar
  `max_iterations`, gastando orçamento sem registrar nada.

### 5. `force_ssl` respondia 301 em todo `/internal/*`

A exclusão do `Plug.SSL` casa **caminho exato** (`conn.path_info in paths`),
então `paths: ["/health", ...]` nunca cobriria as mais de vinte rotas de
`/internal`. A api não manda `x-forwarded-proto: https`, e o engine não tem
listener HTTPS — TLS termina no ingress. Resultado: **api→engine estava quebrado
desde a sessão 2**.

E nenhum smoke via, porque **criar sessão não chama o engine — ativá-la é que
chama**. Os dois smokes passaram a ativar, e o comentário que afirmava provar
esse caminho deixou de ser falso. A decisão de exclusão virou uma função
(`EngineWeb.ForceSslExclusions`), porque uma lista de caminhos exatos se
desatualiza no primeiro endpoint novo.

### 6. Modelo de trace: a sessão é a raiz, persistida

Uma sessão dura minutos ou horas, e uma span OTel só chega ao backend quando
**termina**: uma raiz aberta esse tempo todo seria invisível no Tempo justamente
enquanto a sessão acontece, e desapareceria de vez se a sessão nunca encerrasse
direito — que é o caso que o item 4 trata.

Então a raiz é curta (`session.create`) e o `traceparent` dela é persistido em
`sessions.trace_parent`. Todo trabalho posterior o usa como **parent remoto**,
compartilha o `trace_id`, e a sessão inteira é recuperável por um id só.

Propagação em três caminhos, cada um num ponto único:

| caminho | ponto de injeção |
|---|---|
| api → engine | `buildHeaders()` — antes eram quatro blocos idênticos inline |
| engine → api | `post_returning/3`, funil de todo POST do engine |
| outbox → Oban | `DrizzleOutboxRepository.append()` lê o contexto ativo; os **18 call-sites não mudaram** |

`outbox_events` ganhou coluna `metadata jsonb`, não uma chave no `payload`: o
engine desserializa payload por tipo de evento, e misturar transporte com
domínio envenenaria todos os produtores. O engine guarda sua própria cópia do
traceparent em `engine.session_states` — cópia e não join, porque ler a tabela
da api a cada turno de agente para buscar um valor imutável troca uma escrita
por N leituras.

O contexto do OTel vive no dicionário do processo, e o engine dispara trabalho
por `cast` e `Task`. `Span.capture/0` e `Span.attach/1` levam o contexto na mão —
sem esse par, a trace se parte exatamente nos pontos mais interessantes.

### 7. Contador para taxa, gauge para estado

- "tokens/min" e "custo/hora" são **taxas**: contador monotônico com `rate()`
  derivando a janela. O dashboard pede por minuto, o alerta por hora, e nenhum
  precisa de métrica própria; `rate()` também trata reinício de processo.
- "sessões ativas" e "tasks bloqueadas" são **estado**: não há evento de "deixou
  de estar ativa" que sobreviva a restart. Consulta periódica ao banco, com
  `reset()` antes de reescrever — sem o reset a série fica grudada e o painel
  mostra trabalho que já acabou.

Dois detalhes do domínio que mudariam a query: "tasks blocked" é a coluna
**booleana** `tasks.blocked` (uma task bloqueada volta para `todo`), e `tasks`
não tem `project_id` — o caminho é `story_id → stories`. Taxa de aprovação é
contador na decisão, não `count(status='approved')`: uma ação aprovada que
executa vira `executed`.

`/metrics` da api precisa de `@Public()`: o `JwtAuthGuard` é global, e sem isso o
scrape recebe 401 com o sintoma sendo um target `down` e todo o resto verde.

### 8. Logs JSON: `trace_id` por `mixin`, e o nome é contrato

Na api, o `mixin` do pino é avaliado a cada linha, lendo o contexto ativo
naquele instante — é o que faz uma linha emitida dentro de um tool call carregar
o trace daquele tool call, sem que nenhum ponto de log passe id.

O campo é `trace_id` com underscore nos **três** serviços, porque é o que o
`stage.json` do Alloy extrai e o `derivedFields` do Loki procura. Renomear
compila, passa na suite, e destrói a correlação clicável.

No engine, formatter escrito à mão (~30 linhas) em vez de biblioteca: as opções
trazem formatadores para três nuvens e um esquema de configuração próprio, e
nenhuma injeta o contexto do OTel sem cola de todo jeito. Ele **nunca levanta** —
uma exceção ali aconteceria dentro do logger, perdendo a linha e podendo entrar
em recursão ao tentar logar a falha.

Na web, sem SDK de browser: `@opentelemetry/sdk-trace-web` custa ~90 kB e exige
CORS no coletor e entrada no CSP. A web **gera** um `traceparent` por
requisição, que a api adota como parent (é o propagador padrão), e loga com o
mesmo `trace_id`. São ~20 linhas, e trocar pelo SDK depois é substituir uma
função. O `ApiError` passou a carregar o `traceId`, então "deu erro" virou relato
acionável.

Ganchos globais que não existiam: `QueryCache`/`MutationCache` `onError` e
`window.error`/`unhandledrejection` — sem eles, exceção de render era tela em
branco sem registro.

### 9. Collector no meio, e o que NÃO passa por ele

`OTEL_EXPORTER_OTLP_ENDPOINT` aponta para o OpenTelemetry Collector, não para o
Tempo: as três apps conhecem um endpoint só, e trocar backend, amostrar ou
filtrar atributo vira mudança de pipeline.

Métricas e logs **não** passam por ele: métrica é scrape (modelo pull, sobrevive
a reinício do coletor) e log é lido do stdout dos pods pelo Alloy. Mandar as três
coisas pelo mesmo caminho faria do coletor ponto único de falha da
observabilidade inteira.

**A NetworkPolicy `allow-otlp-egress` é obrigatória**: o `default-deny` de egress
do namespace `brabo` (ADR 0025) bloqueia OTLP para `monitoring`, e o modo de
falha é o pior possível — as apps sobem, os spans são criados, o envio falha, e
todo o resto fica verde com o Tempo vazio.

### 10. Alertas do Grafana, não do Prometheus — desvio registrado

O enunciado pede "alertas Prometheus". Estão implementados como **regras
unificadas do Grafana**, provisionadas como código, por escolha explícita do
usuário. A contrapartida aceita: deixam de ser avaliados se o Grafana cair, o
que não aconteceria com regras carregadas pelo Prometheus. Não há Alertmanager
nem receiver — rotear é decisão de operação.

## Consequências

- O engine suporta mais de uma réplica **de fato**, e um rollout preserva as
  sessões dos usuários em vez de matá-las.
- Uma sessão é rastreável ponta a ponta: `session.create` na api, `agent.turn`,
  `tool.call`, `llm.turn` e `gate.scanner` no engine, tudo num `trace_id`.
- Os logs dos três serviços são JSON com o mesmo `trace_id`, clicável do Tempo
  para o Loki e de volta.
- `pnpm-workspace.yaml` passou a declarar `protobufjs: false`: ele entra como
  dependência transitiva do exporter OTLP e o exporter que usamos é HTTP/JSON —
  não rodar postinstall de dependência transitiva é a mesma disciplina de pin e
  checksum do resto da fase.

## Limitações conhecidas (registradas, não resolvidas)

1. **Os servers de agente continuam node-local.** `po:`, `criativo:`,
   `arquiteto:` e `infra:` seguem num `Registry` local, com a mesma forma do
   defeito da decisão 1: um comando de agente que caia no pod "errado" não
   encontra o processo. Não apareceu no critério de aceite desta sessão, mas é a
   próxima peça a migrar para `:global`.
2. **O `Adopter` tem janela de partição.** Ele sincroniza o `:global` antes de
   adotar, mas com 1 réplica `Node.list()` é legitimamente vazio e não há como
   distinguir "sozinho porque é réplica única" de "sozinho porque particionado".
   Numa partição real, dois lados poderiam adotar a mesma sessão.
3. **`tool.call` de agente real não foi exercitado ponta a ponta.** A verificação
   usou o mecanismo de span diretamente (`Span.with_session` via `rpc`), porque
   rodar um agente de verdade exige LLM — Ollama ou chave de API — e não havia
   nenhum disponível no ambiente. O caminho de código é o mesmo; o que não foi
   observado é um turno real de agente produzindo a árvore.
4. **O chart `grafana/grafana` está marcado como deprecado** no repositório
   upstream, e o único substituto é o `grafana-operator` (CRDs, modelo de
   provisionamento diferente).
5. **Itens 6 e 7 da Fase 5 seguem abertos**: backup/restore com `pg_dump`
   agendado e runbook testado; rate limit, headers de segurança, CORS estrito e
   auditoria de dependências no CI.
6. **Publicação das imagens em registry** continua pendente desde a sessão 2, e
   é pré-requisito dos overlays de staging/prod.
