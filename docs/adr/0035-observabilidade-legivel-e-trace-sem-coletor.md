# 0035 — Trace sem coletor, e o caminho entre camadas no log

## Contexto

O [ADR 0026](0026-fase5-observabilidade-e-graceful-shutdown.md) projetou a
correlação ponta a ponta: uma sessão é uma trace raiz, o `traceparent` viaja pelos
três pontos de injeção, e os três serviços logam JSON com o mesmo `trace_id`.
Nada disso estava errado. O problema é que, **em desenvolvimento, nada disso
existia** — e desenvolvimento é onde se lê log com os olhos.

A decisão 9 daquele ADR condicionou a instrumentação a
`OTEL_EXPORTER_OTLP_ENDPOINT`, com a justificativa de que um exportador
entregando para lugar nenhum enche o log de falha de conexão. A justificativa é
verdadeira. A implementação confundiu duas coisas diferentes: **criar** telemetria
e **entregar** telemetria.

Na api, sem a variável o `NodeSDK` não era construído. Sem `start()` não há
context manager nem propagador registrados, então:

- `currentTraceId()` devolvia `undefined` e o `mixin` do pino não estampava
  `trace_id` em nenhuma linha;
- o `traceparent` que a web manda em **toda** requisição era descartado em
  silêncio;
- `injectTraceHeaders` não injetava nada nas chamadas para o engine.

No engine o gate estava pior: **invertido**. Não existe (nem existia) config
`:opentelemetry` no projeto, então o SDK subia com o default do
`otel_configuration`, que é `{opentelemetry_exporter, %{}}` apontando para
`localhost:4318`. O engine pagava por um batch condenado em desenvolvimento **e em
`mix test`** — exatamente o custo que o gate dizia evitar. E o que o gate
desligava era `OpentelemetryBandit.setup()`, ou seja a **extração** do
`traceparent` que chega: a única peça que faz a span do engine ser filha da span
da api. O moduledoc de `Engine.Telemetry.Span` afirmava que sem coletor tudo virava
no-op; era falso, e o teste ao lado agora prova o contrário.

Três furos de correlação apareceram ao investigar, todos silenciosos:

1. `Engine.Outbox.Event` não declarava a coluna `metadata`. O struct não tinha a
   chave, a primeira cláusula de `Drain.traceparent/1` era **inalcançável**, e
   todo job do Oban nascia com `traceparent: nil`. A api gravava a coluna
   corretamente desde a Fase 5. Nenhum worker lia o argumento, então corrigir só o
   schema deixaria o dado inerte.
2. O `traceparent` engine→api era injetado dentro de `post_returning/3`, funil só
   dos POSTs. Os seis `Req.get` e o `llm_turn_stream` iam sem trace — toda a
   metade de leitura da conversa entre os serviços aparecia como trace órfã.
3. `chat-stream.ts` contorna o `api-client.ts` e não mandava `traceparent`. Era o
   único caminho da web sem trace, e o pior possível: o turno de LLM.

Somado a isso, o pedido original que originou este trabalho: o log era difícil de
ler para gente, não dizia de onde a linha saiu, e não mostrava por onde a ação do
usuário passou entre as camadas.

## Decisão

**1. Instrumentar e exportar são decisões separadas.** O SDK sobe sempre, nos dois
serviços. `OTEL_EXPORTER_OTLP_ENDPOINT` passa a controlar só o destino:

| | com endpoint | sem endpoint |
|---|---|---|
| api | `traceExporter` OTLP | `spanProcessors: [NoopSpanProcessor]` |
| engine | default do `opentelemetry_exporter` | `traces_exporter: :none` |
| contexto e propagação | registrados | **registrados** |

O `spanProcessors` explícito na api não é decoração: sem ele o SDK cai em
`getSpanProcessorsFromEnv()`, que com `OTEL_TRACES_EXPORTER` vazio monta um
exportador para `localhost:4318` — o mesmo defeito que o gate tentava evitar. E a
lista precisa ter pelo menos um elemento, porque `sdk.start()` só registra o
tracer provider global quando `spanProcessors.length > 0`; sem provider a span
nasce inválida e o propagador não injeta nada.

As duas escolhas são seguras para memória, e por construção: o `NoopSpanProcessor`
não retém no `onEnd`, e o `otel_batch_processor` do Erlang chama `disable/1`
quando o exporter é `none` e passa a devolver `dropped` sem tocar a ETS. As
alternativas não seriam — `BatchSpanProcessor` com exportador morto retém 2048
spans e fica retentando, e `InMemorySpanExporter` cresce sem limite.

**2. `tracing.ts` exporta função, e o efeito colateral mora em `tracing-boot.ts`.**
`startTracing()` como função permite um spec importar o módulo sem registrar
estado global — o que quebraria `trace-context.spec.ts`, que afirma o oposto de
propósito. Mas a chamada não pode ficar no corpo do `main.ts`: TypeScript e SWC
elevam todos os `require` para o topo, então uma linha entre imports rodaria
**depois** de `pg` e `express` carregarem, e o monkey-patch não pega em módulo
carregado. Um módulo separado resolve porque `require` é síncrono.

**3. O caminho entre camadas vem de `AsyncLocalStorage`, não de span.** Um
decorator `@Traced('<camada>')` nas fronteiras registra classe, método, camada e
duração num contexto por requisição; um interceptor global emite **uma** linha no
fim. Span também é aberta, mas o caminho não depende dela — é o que faz a feature
funcionar sem coletor.

O padrão é o mesmo do `drizzle-context.ts`, que já carregava a transação ativa
pela pilha de chamadas. O contexto tem **teto de 64 passos**: sem isso, um caso de
uso que chama repositório em laço cresceria o array pela vida da requisição e
depois serializaria tudo numa linha de log.

Os passos são registrados na **entrada** do método, não na saída. Registrar na
saída daria ordem de término — a chamada mais interna termina primeiro, e o
caminho sairia de dentro para fora.

**4. `@Traced` é proibido sob `apps/api/src/interfaces/http/**`.** Regra dura, e o
motivo é de segurança. Os decorators do Nest (`SetMetadata` e derivados) gravam
metadata **no objeto função** do método; decorators legacy aplicam de baixo para
cima, então trocar `descriptor.value` descarta a metadata escrita abaixo. Num
controller isso é um `@RequireRole` que desaparece — compila, passa na suite, e é
buraco de autorização.

Não há nada a ganhar decorando controller: o interceptor cobre a fronteira HTTP de
graça, lendo `ExecutionContext.getClass()` e `getHandler()`. A opção sem diff em
30 arquivos é também a segura. (O decorator copia a metadata adiante de todo jeito,
como cinto e suspensório.)

Duas exclusões pela mesma razão técnica: **nada que devolva `Observable` ou seja
gerador**. A heurística "é thenable?" classificaria os dois como síncronos e
fecharia a span antes de o stream produzir. `traced-llm-provider.chat` é gerador
assíncrono e ficou de fora; handler `@Sse` fica com o interceptor, que usa
`finalize`.

**5. `ownSpan: true` para quem já gerencia a própria span.**
`CreateSessionUseCase.execute` abre `session.create`, que o ADR 0026 designa raiz
da trace da sessão e que `docs/reference/events.md` documenta como raiz. Envolvê-la
faria da span do decorator a raiz: o `trace_id` continuaria certo, e a doc
passaria a ser falsa sem nada quebrar. Com `ownSpan` o passo do caminho é
registrado e nenhuma span nova é aberta.

**6. Pretty em desenvolvimento, uma linha de JSON em produção.** Em produção
`transport` fica ausente e o pino escreve um `JSON.stringify` por evento — é
requisito, não estética: o Alloy lê o stdout do pod linha a linha.

Em desenvolvimento o `pino-pretty` roda **em processo**, como stream, e não via
`transport`. O motivo é concreto: `transport` executa numa worker thread e as
opções passam por structured clone, então `messageFormat` e `customPrettifiers`
**como função** não podem ser passados — e são eles que desenham a árvore de
camadas. O `require` é guardado em try/catch, porque `pino-pretty` é
devDependency e não existe na imagem de produção; o fallback é JSON, que é o modo
de falha certo para um logger.

No engine, `Engine.Telemetry.LogFields` passou a ser a fonte única dos campos, o
`JsonLogFormatter` só serializa, e um `PrettyLogFormatter` novo cobre dev — onde
`dev.exs` jogava fora timestamp e toda a metadata, deixando `trace_id`,
`session_id` e `mfa` invisíveis.

**7. `trace_id` continua sendo contrato, e nada mudou nele.** Campos novos
(`path`, `duration_ms`, `layer_count`, `layer`, `class`, `fn`) entram como irmãos
planos. O `stage.json` do Alloy seleciona por expressão, não enumera, então chave
irmã nova é ignorada e o `derivedFields` do Loki segue funcionando. O array
`layers` fica **fora** de produção: como string `path` são ~150 bytes, como array
5-10×, e Loki cobra por byte.

**8. Os três furos, fechados junto.** `field :metadata` no schema do outbox mais
`Span.with_session(args["traceparent"], …)` e `Logger.metadata(session_id:)` nos
dois workers — `Logger.metadata/1` não era chamado em lugar nenhum do engine, e é
por isso que o campo `session_id` do formatter sempre saiu ausente. Um funil
`headers/0` no `EngineApiClient`, cobrindo os 8 call sites. E `traceparent` no
`chat-stream.ts`.

## Consequências

- Com **zero coletor**, `pnpm dev` produz três streams de log com o mesmo
  `trace_id`, gerado no browser. É a diferença entre poder e não poder seguir uma
  ação do usuário atravessando os processos.
- Uma linha por requisição mostra o caminho entre camadas com a duração de cada
  passo. Em dev como árvore indentada; em produção como o campo `path`.
- O trabalho assíncrono dos agentes passou a ser correlacionável de fato: o job do
  Psicólogo disparado pelo fechamento de uma sessão carrega o `trace_id` da sessão
  que o originou. Antes, `traceparent: nil` em todo job.
- A metade de leitura da conversa engine→api saiu da orfandade, incluindo o
  `llm_turn_stream`.
- O engine deixou de gastar um batch de exportação condenado em dev e na suite.
- O log da api ganhou teste de shape, que não existia: uma linha em produção,
  `trace_id` no topo, e a lista de `redact` como contrato. A lista cresceu com o
  token de serviço api↔engine, que **não** era redigido.
- `allowedHeaders` do CORS ficou explícito. Antes a correlação inteira dependia do
  default do pacote `cors`, que reflete o header pedido no preflight — comportamento
  implícito de biblioteca, sem teste cobrindo.
- O engine passou a ter log de acesso (não havia nenhum) e a recusa de token de
  serviço deixou de ser silenciosa.
- `WEB_LOG_LEVEL` ligado no k8s: `logger.debug` era código morto em todo ambiente
  publicado.
- Dois textos que afirmavam o contrário do comportamento foram corrigidos: o
  moduledoc de `Engine.Telemetry.Span` e a causa 1 de "quando não há trace" no
  runbook — esta última já era falsa para o engine antes desta mudança.

## Limitações conhecidas

1. **Guard roda antes de interceptor.** `JwtAuthGuard`, `RateLimitGuard` e
   `RolesGuard` ficam fora do caminho (~1-3ms, já visíveis como spans `pg` no
   Tempo). O caminho de upgrade é aditivo: mover só o `runWithRequestContext` para
   um middleware e manter o interceptor semeando e emitindo.
2. **`depth` sob concorrência é aproximado.** Um `Promise.all` de chamadas
   decoradas interleava as profundidades e a árvore fica torta. Os caminhos
   críticos são sequenciais.
3. **A linha do SSE chega no fechamento do stream**, via `finalize` — possivelmente
   minutos depois de a requisição começar. É consistente com a linha `res` do
   pino-http, que também espera a resposta terminar.
4. **`genReqId` não foi tocado.** Seria uma segunda chave de correlação que nada
   consome, ao lado do campo que o ADR 0026 chama de contrato. Correlaciona-se por
   `trace_id`.
5. **Log da web não chega ao Loki.** O Alloy só lê stdout de pod. O `trace_id` do
   browser serve para um humano casar a linha do console com o span de servidor —
   segue valendo o que o ADR 0026 registrou.
6. **`@Traced` está aplicado só nos caminhos críticos** (sessões, ações, auth e a
   ponte api↔engine). O resto dos repositórios continua fora, por escolha de
   escopo, não por impedimento.
7. **Nenhuma RN foi criada.** As regras de negócio vivem em
   `apps/api/src/domain/`, que é puro; observabilidade não é regra de negócio.
   Registrado aqui para não parecer esquecimento.
8. **A web não ganhou error boundary**, e ~20 `catch {}` mudos seguem mudos fora
   dos caminhos de auth e chat. Boundary é decisão de UI, e a conversão dos
   demais é mecânica — os dois merecem mudança própria.
