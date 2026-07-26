---
category: Primitivas
keywords: [tabela, lista, colunas, grid, backlog]
---

# Table

Tabela em CSS grid, genérica na linha. Cada coluna declara `render(row)`, então
a célula pode ser qualquer nó — Badge, texto mono, link.

## Como usar

```tsx
const colunas = [
  { key: 'titulo', label: 'Tarefa', width: '2fr', render: (t) => t.titulo },
  { key: 'status', label: 'Status', width: '140px',
    render: (t) => <Badge tone={TOM[t.status]}>{ROTULO[t.status]}</Badge> },
];

<Table columns={colunas} rows={tarefas} rowKey={(t) => t.id}
  emptyMessage="Nenhuma ação aguardando sua decisão." />
```

## O que respeitar

- `width` alimenta o `grid-template-columns` (default `1fr`). Misture `fr` para
  a coluna que estica e px para as de largura fixa.
- `rowKey` é obrigatório e tem que ser estável — é a key do React.
- O estado vazio preserva o cabeçalho de propósito: a tabela não colapsa e o
  usuário continua vendo o que estaria ali.
- **Cuidado com overlay dentro de célula.** Dropdown aberto na última linha é
  recortado pelo container da tabela se não for posicionado em relação à
  viewport — foi um bug real do produto.
