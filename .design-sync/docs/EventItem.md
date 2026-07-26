---
category: Dominio
keywords: [evento, linha, log, narração, timeline]
---

# EventItem

Uma linha do event log. **O ícone, a cor e o texto não vêm por prop**: são
derivados de `event.type` e `event.payload`.

## Como usar

```tsx
<EventItem event={event} highlighted={event.id === citado} />
```

## O que respeitar

- Para mudar como a linha aparece, mude o **tipo** do evento, não estilo. Tipos
  conhecidos ganham narração própria (`backlog.task_claimed` diz qual task,
  `permission.granted` diz qual padrão); tipo desconhecido cai no genérico
  "ator · tipo", sem inventar.
- Eventos de falha são marcados internamente e saem em `danger` — não é preciso
  (nem possível) passar tom.
- O horário é relativo a agora. Em preview ou teste, use `createdAt` como offset
  a partir de `Date.now()`; data fixa faz o rótulo derivar com o tempo.
- `highlighted` é o alvo de navegação de evidência: destaca e recebe o scroll.
