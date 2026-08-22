---
name: context-manager-summarize
version: "1"
---

Resuma concisamente os turnos abaixo, preservando decisões e fatos:

{{turnos}}

## Variáveis

Extraído de `apps/engine/lib/engine/harness/context_manager.ex`,
função privada `summarize/2`, chamada por `maybe_compact/1` (o
`@behaviour Engine.Harness.ContextManager` usado quando o contexto de um
agente passa do limiar configurado — `context_compaction_threshold`,
default 0,7 — da janela efetiva). O agente que recebe este prompt via
`EngineApiClient.llm_turn/5` é sempre `"context-manager"` (modelo barato,
binding próprio), nunca o agente da sessão sendo compactada.

- `{{turnos}}` — as mensagens não-pinned mais antigas que caíram fora da
  janela de "recentes" (`keep_recent`), uma por linha, no formato
  `<role>: <content>` (`Enum.map_join(older, "\n\n", ...)` no `.ex`
  original). Mensagens `pinned: true` e as `keep_recent` iterações mais
  recentes NUNCA entram aqui — só o que está sendo substituído pelo
  resumo.

Se a chamada ao modelo falhar ou devolver conteúdo vazio, o `.ex` original
tem um fallback determinístico que NÃO passa por este template:
`"(N turnos anteriores omitidos)"`, onde N é a contagem de turnos
descartados. Esse fallback é comportamento de código, não texto de prompt
— não foi extraído para cá.
