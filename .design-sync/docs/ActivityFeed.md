---
category: Dominio
keywords: [feed, atividade, eventos, sessão, filtro, timeline]
---

# ActivityFeed

O feed de atividade de uma sessão ou projeto: filtro por agente, chips por tipo
de atividade, e uma linha (`EventItem`) por evento.

## Como usar

```tsx
<ActivityFeed
  events={events}
  agentOptions={[{ id: 'dev-backend', label: 'Dev Backend' }, { id: 'qa', label: 'QA' }]}
  highlightEventId={eventoCitado}
/>
```

## O que respeitar

- **O feed ESCONDE ruído de máquina.** `agent.status`, `agent.response`,
  `agent.delta`, `tool.call`, `tool.result` e `context.compacted` não aparecem —
  são internos do ciclo do agente. Um feed montado só com esses tipos renderiza
  "Nenhuma atividade por aqui ainda".
- **`highlightEventId` vence o filtro**, inclusive o de ruído de máquina. É a
  navegação de evidência do Psicólogo, que cita justamente `tool.result` e
  `agent.response` — um destaque invisível seria uma navegação que não chega a
  nada.
- Os chips de tipo são derivados dos eventos presentes. Um feed de um tipo só
  mostra um chip só.
- Sem `agentOptions` a barra de filtro de agente desaparece.
