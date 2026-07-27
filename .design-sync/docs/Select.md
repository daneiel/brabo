---
category: Primitivas
keywords: [seleção, dropdown, opções, filtro]
---

# Select

Um `<select>` nativo estilizado com os tokens do DS. As opções são children —
`<option>` e `<optgroup>` comuns.

## Como usar

```tsx
<Select value={agente} onChange={(e) => setAgente(e.target.value)}>
  <option value="">Todos os agentes</option>
  <option value="dev-backend">Dev Backend</option>
  <option value="qa">QA</option>
</Select>
```

## Quando NÃO usar

Se cada opção precisa de mais de uma linha de informação — preço, provider,
descrição, estado de seleção rico — o `Select` não dá conta: `<option>` só
aceita texto. É exatamente por isso que existe o `ModelPicker` em vez de um
`Select` de modelos.
