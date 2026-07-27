---
category: Primitivas
keywords: [badge, status, tag, contador, pílula]
---

# Badge

Pílula curta de status ou contagem. Texto em `var(--font-mono)` a 10px — é
etiqueta, não frase.

## Como usar

```tsx
// Status, com o ponto que marca estado vivo.
<Badge tone="success" dot>active</Badge>

// Contador — square dá o radius menor.
<Badge tone="accent" square>7</Badge>

// Algo acontecendo agora.
<Badge tone="accent" dot pulse>dev-backend implementando</Badge>
```

## Escolhendo o tom

`success` concluído ou aprovado · `warning` esperando ou perto de um limite ·
`danger` negado, bloqueado ou falho · `accent` em andamento ou em destaque ·
`muted` neutro, rascunho, contagem sem urgência.

## O que respeitar

- **`pulse` só para o que muda sozinho.** Num status parado, ele mente.
- Conteúdo é uma palavra ou um número. Frase dentro de Badge estoura o layout
  da linha em que ele vive.
