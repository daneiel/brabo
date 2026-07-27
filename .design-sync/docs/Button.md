---
category: Primitivas
keywords: [botão, ação, variante, submit]
---

# Button

O botão do DS. Repassa todos os atributos de `<button>` por spread, então
`type`, `disabled`, `onClick` e `aria-*` funcionam como no elemento nativo.

## Como usar

```tsx
<Button variant="primary" onClick={aprovar}>Aprovar</Button>
<Button variant="secondary" onClick={negar}>Negar</Button>
<Button variant="ghost" disabled>Sempre permitir</Button>
```

## Escolhendo a variante

- **primary** — a ação que o usuário veio fazer. Uma por tela, no máximo.
- **secondary** — a alternativa de mesmo peso (o "Negar" ao lado do "Aprovar").
- **success** / **danger** — quando o resultado da ação é o que importa
  comunicar: confirmar algo irreversível, encerrar uma sessão.
- **ghost** — ação terciária, que não deve competir por atenção.

## O que respeitar

- `fullWidth` é para submit de formulário ou passo de wizard, onde o botão
  ocupa a coluna. Fora disso o botão dimensiona pelo conteúdo.
- Não coloque ícone sozinho dentro de um Button esperando um botão quadrado —
  ele mantém o padding de rótulo. Ícone + texto é o uso previsto.
