---
category: Primitivas
keywords: [abas, navegação, tabs, seções]
---

# Tabs

Régua de abas controlada. `active` e `onChange` são de quem usa — o componente
não guarda a aba selecionada.

## Como usar

```tsx
const abas = [
  { key: 'visao', label: 'Visão geral' },
  { key: 'backlog', label: 'Backlog', count: 24 },
  { key: 'aprovacoes', label: 'Aprovações', count: 3 },
];

<Tabs items={abas} active={aba} onChange={setAba} />
```

## O que respeitar

- `count` é para o que exige atenção (pendências, itens a decidir). Contar
  tudo em toda aba tira o sinal do número.
- `trailing` ancora conteúdo à direita da régua — o lugar da ação primária da
  tela, não de mais abas.
- Tabs só desenha a régua. O painel de cada aba é responsabilidade de quem usa.
