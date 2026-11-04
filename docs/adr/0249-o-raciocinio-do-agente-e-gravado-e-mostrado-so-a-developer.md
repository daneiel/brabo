# ADR 0249 — O raciocínio do agente é gravado e mostrado só a developer ou mais

- **Status:** aceito
- **Data:** 2026-11-03
- **Referencia:** o ADR [0224](0224-raciocinio-abortado-no-stream.md) (o raciocínio é CONTADO no stream, não guardado) e o [0041](0041-contrato-de-llm-provider.md) (capability só com prova). Nenhum ADR é editado.

## Contexto

AT-676 (EP-031): o bloco "Raciocínio" do fio não tinha dado. O texto já chegava em `delta.reasoning` e era descartado. O dono decidiu em 03/11: gravar INTEIRO, mostrar também ao vivo, só `developer` ou mais vê, e valer para OpenRouter, Anthropic e `reasoning_content`.

## Decisão

1. **Contrato.** `ChatStreamChunk` ganha `{ type: 'reasoning', text }` e `LLMProviderCapabilities` ganha `reasoningText`, `false` em todos até haver smoke (o código de leitura existe nos providers; a flag diz só o que foi PROVADO).
2. **`stream-llm-turn`** emite o frame `raciocinio` com o delta e o `final` leva `raciocinio` completo, sem corte; `llm-turn` devolve o mesmo campo. O texto nunca entra no `content`.
3. **Anthropic.** Manda `thinking` (`budget_tokens` = orçamento do modelo, no mínimo 1024) e o teto de saída sobe desse valor. Os blocos `thinking`/`redacted_thinking` assinados saem no chunk `tool_calls` (`thinkingBlocks`) e no `final` (`message.thinkingBlocks`); o engine os guarda entre as voltas do laço e os devolve em `ChatMessage.thinkingBlocks`, que o provider põe ANTES do texto e do `tool_use`.
4. **Gravação.** O engine grava `payload.raciocinio` em `agent.response`, sem teto. Nunca volta ao modelo (reidratação), ao RAG nem ao grafo.
5. **Quem lê.** A api tira `payload.raciocinio` das leituras HTTP de evento para quem tem papel efetivo abaixo de `developer`, por um filtro único de saída; o canal ao vivo do engine precisa do mesmo papel, emitido no ticket do socket.

## Consequências

- O raciocínio pode repetir o que o agente leu; a restrição por papel é a contenção, no mesmo molde do `tool.result` (RN-589) com um degrau a mais.
- Sem teto, o evento cresce (até o orçamento por volta, em até 14 voltas). O tamanho vai declarado no payload pela lane do engine.
- Os providers sem smoke ficam `reasoningText: false` e degradam sem bloco.
