# 0040 — Uma base OpenAI-compatível, um contrato de LLM providers e capabilities que recusam binding

## Contexto

A Fase 9 vai acrescentar seis providers de LLM (NVIDIA NIM, Deep Infra,
Together AI, Bitdeer AI, Vultr e OpenRouter). Antes de escrever o primeiro, a
exploração do que já existia mostrou que a fundação não sustentava nem os três
atuais:

1. **O `OpenAIProvider` descartava `options.tools` em silêncio.** Cinquenta e
   quatro linhas, o SDK `openai`, e um comentário no próprio arquivo admitindo
   que tool calling "não é suportado neste provider ainda". Quem vinculasse um
   modelo da OpenAI a um agente veria o ToolLoop terminar sem conclusão — o
   mesmo sintoma que o [ADR 0020](0020-destravar-gates-qa-secops.md) levou nove
   execuções para diagnosticar.
2. **Não existia teste nenhum de `OpenAIProvider` nem de `AnthropicProvider`.**
   O único provider testado era o Ollama, e só no transporte.
3. **Não existia taxonomia de erro de LLM.** Os três providers faziam
   `yield { type: 'error', message: (error as Error).message }`. Chave expirada,
   rate limit e modelo inexistente chegavam ao usuário como a mesma string
   opaca do vendor. O lado git resolveu isso no
   [ADR 0002](0002-git-error-normalization.md) e a lição nunca atravessou.
4. **`models` não tinha capabilities e `LLMProvider` não tinha `capabilities`**
   — diferente do `GitProviderContract`, que carrega as suas desde a Fase 2.
   Qualquer modelo podia ser vinculado a qualquer agente.
5. **Não existia suite de contrato de LLM**, embora a de git
   (`test/contract/git-provider.contract.ts`) esteja no CLAUDE.md como
   convenção do projeto desde o [ADR 0001](0001-git-provider-contract-shape.md).

Seis providers novos sobre essa base multiplicariam os cinco problemas por seis.

## Decisão

### A base fala `node:http`, não o SDK

`OpenAICompatibleProvider` implementa o dialeto `/chat/completions` uma vez, e
implementa sobre `node:http` cru — não sobre o SDK `openai`, que sai do
`package.json`.

O motivo é o item que o escopo da fase pede e o SDK não entrega: **timeout de
inatividade**. O SDK fala `fetch`, cujo timeout é da requisição inteira; o que
precisamos é derrubar o socket quando ele fica QUIETO, valendo tanto para
"ainda não mandou os headers" quanto para "parou de mandar chunks no meio do
stream". É exatamente a distinção que o ADR 0020 caçou, e o `postStream` que
ele escreveu para o Ollama foi extraído para `infrastructure/llm/http-stream.ts`
e passou a servir os dois.

O ganho colateral é que as particularidades por provider viram flags de
configuração (`baseUrl`, header de auth, `streamOptionsIncludeUsage`,
`maxTokensField`) em vez de esbarrarem no que o SDK deixa configurar. Cada flag
existe porque um provider real diverge — a regra é não acrescentar flag sem um
provider que precise dela, e a Fase 9b confirma cada uma na doc oficial durante
a implementação.

### O erro normalizado vai no chunk, com `code` obrigatório

`ChatErrorChunk` ganhou `code: LLMErrorCode`, e a taxonomia virou classes em
`domain/llm/llm-provider-errors.ts`. O campo é **obrigatório**, não opcional:
com campo opcional, um provider novo esquece de classificar e o erro dele volta
a ser string opaca sem ninguém perceber.

| status | `code` |
| --- | --- |
| 401, 403 | `auth` |
| 404 | `model_not_found` |
| 429 | `rate_limit` |
| 413, ou 400 com marcador de contexto | `context_length` |
| socket mudo | `timeout` |
| não conectou | `connection` |
| resto | `upstream` |

Diferente de `git-errors.ts`, que é um conjunto de classes avulsas, aqui há uma
classe-base: o destino do erro não é um filtro HTTP com status por tipo, é a
conversão para `ChatErrorChunk`. Quem converte precisa de um ponto único que
sempre expõe `code` e `message`.

### Capabilities em duas camadas, e um binding que é recusado

`LLMProvider` ganhou `capabilities` (o TETO do backend) e `models` ganhou três
colunas `supports_*` (o que aquele modelo específico sabe). Um modelo pode ser
mais pobre que o provider, nunca mais rico.

Colunas discretas, não um `jsonb`: o filtro "aptos para agentes" da Fase 9c
precisa ser um `WHERE`, e uma capability sem coluna é uma capability que
ninguém consegue consultar.

Sobre isso vem a regra nova ([RN-038](../business-rules.md#rn-038)):
`assertModelFitsBindingScope` recusa vincular a um **agente** um modelo sem
tool calling nativo, com mensagem que aponta o filtro que o usuário precisa
usar. Só o escopo `agent` valida — `workspace` e `project` são o fallback do
chat humano, e travá-los proibiria modelo chat-only no produto inteiro.

O `ToolCallRecovery` do engine continua existindo e continua sendo **resgate,
não licença**: ele depende de o modelo acertar o formato por acaso e falha em
silêncio quando não acerta. Escolher esse acaso de propósito é o que a regra
recusa.

**Correção de premissa do escopo:** `context-manager` não é um escopo de
binding — é um slug de agente sob `scope='agent'` (ADR 0007). A regra o cobre
por construção, sem enum novo.

### O contrato é dono das asserções; o harness, do dialeto

`test/contract/llm-provider.contract.ts` roda a mesma bateria contra qualquer
`LLMProvider`. O harness de cada provider traduz nove cenários para o seu
formato de fio, e herda os testes: stream com frame partido entre dois
`res.write`, usage presente e ausente, tool calling, os quatro erros, e o
servidor mudo.

O servidor falso é um `node:http` de verdade em porta efêmera — o molde do
teste do Ollama da Fase 4 — e não um mock de `fetch`. O que está sob teste é
justamente o comportamento de socket; um mock responderia bonitinho e não
provaria nada.

Um provider da Fase 9b passa a nascer com trinta asserções sem escrever
nenhuma.

### O Anthropic ganhou tool calling e ficou no SDK

O Anthropic não fala `/chat/completions`, então não deriva da base. Ganhou tool
calling nativo (blocos `tool_use`, e mensagens `role: 'tool'` viram
`tool_result` agrupados num turno de `user` — o formato exige que resultados de
chamadas paralelas venham no mesmo turno), erros normalizados por status, e o
teto de inatividade via `withIdleTimeout`, que envolve o gerador do SDK e
rearma um relógio a cada evento.

## Consequências

### Divergências que ficaram documentadas em vez de escondidas

O contrato tem um eixo parametrizado por harness — `usageFallback` — porque os
três dialetos respondem coisas diferentes à mesma pergunta:

- a **base compatível** conta com o tokenizer local e marca `estimated: true`;
- o **Ollama** não emite `usage` nenhum (sem a linha `done` não há o que reportar);
- o **Anthropic** não sabe omitir contagem — `usage` é obrigatório no
  `message_start`, e um cenário "sem usage" ali seria protocolo inválido.

Esconder isso num teste único que só verifica "tem ou não tem usage" custaria a
distinção entre "o provider disse zero" e "o provider não disse nada" — que é
exatamente o que a marca `estimated` existe para carregar.

### Custos aceitos

- **O `OpenAIProvider` trocou de transporte.** Não é "só mover código": saiu do
  SDK e passou a fazer parsing de SSE próprio. Como não havia teste nenhum dele
  antes, a migração foi validada pela suite de contrato nova, não por testes
  preexistentes. Em compensação, o parsing agora é exercitado por trinta
  asserções e por uma mutação verificada: derrubar o envio de `tools` faz o
  contrato falhar.
- **Uma asserção de teste existente mudou.** O
  `ollama-provider.spec.ts` comparava o chunk de erro com `toEqual` exato; a
  chave `code` a mais quebra isso. Uma linha.
- **Quatro fakes de teste ganharam `capabilities`.** `capabilities` no port é
  abstrato, então os `FakeProvider`/`ThrowingProvider` das use-cases precisaram
  declarar. Sem isso ficariam com tipo inválido e passando — o `tsconfig.build`
  exclui `test/` e o vitest usa SWC sem typecheck, ou seja, o erro seria mudo.
- **O backfill da migração é uma lista literal de sete modelos.** Um `UPDATE`
  cego seria mais simples e mentiria sobre qualquer modelo que o operador tenha
  inserido por SQL — o default `false` precisa continuar valendo para quem não
  foi verificado.

### O que continua aberto

- **`brabo_llm_call_errors_total` praticamente não dispara.** O
  `TracedLLMProvider` só incrementa em exceção *lançada*, e os providers
  *yieldam* chunk de erro em vez de lançar. Agora que o erro tem `code`, o
  contador poderia ganhar um rótulo de motivo e passar a contar de verdade —
  mas isso é mexer em observabilidade de fase concluída sem pedido, e fica
  registrado aqui em vez de feito de passagem.
- **`supports_vision` está na tabela e não é usado por ninguém.** Entrou porque
  o escopo da fase o lista nas capabilities; ganha consumidor no ModelPicker da
  Fase 9c.
- **Os seis providers, o `list_models`, o sync de preços e o ModelPicker
  reagrupado** são 9b e 9c. Esta fase é fundação: nenhum valor novo em
  `llm_provider` ou `credential_provider`.

Referencia [ADR 0020](0020-destravar-gates-qa-secops.md), de onde vêm o
`postStream` e a regra de sempre registrar a origem da falha, e
[ADR 0002](0002-git-error-normalization.md), cuja normalização de erro este ADR
finalmente replica do lado do LLM.
