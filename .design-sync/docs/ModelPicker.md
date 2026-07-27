---
category: Dominio
keywords: [modelo, llm, provider, preço, seletor, ollama, nuvem]
---

# ModelPicker

O seletor de modelo de LLM. Agrupa por categoria (local / nuvem) e por provider,
mostrando o custo de cada modelo — a escolha de modelo é decisão de custo.

## Como usar

```tsx
<ModelPicker
  models={modelosPorCategoria}
  selectedModelId={modelo?.id}
  onSelect={(m) => vincular(m)}
  variant="topbar"
/>
```

## O que respeitar

- `models` é `Record<'local' | 'cloud', Record<provider, Model[]>>`. Categoria
  vazia não desenha cabeçalho órfão — é o caso de não haver chave de API.
- Preços em `Model` são **micro-USD por milhão de tokens**: 3_000_000 é
  US$ 3,00/M. Modelos locais custam 0 e aparecem como "grátis".
- **O catálogo está no dropdown**, que é estado interno sem prop que o abra.
  Montar o componente mostra só o chip do modelo atual.
- O dropdown é posicionado em relação à viewport de propósito: dentro de uma
  tabela, um dropdown posicionado no fluxo é recortado nas últimas linhas — foi
  um bug real do produto.
- `variant`: `topbar` na barra superior, `inline` na configuração de um agente,
  `standalone` numa tela própria.
