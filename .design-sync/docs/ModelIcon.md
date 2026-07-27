---
category: Icones
keywords: [modelo, llm, provider]
---

# ModelIcon

Ícone outline do set do Brabo: desenha um cubo de modelo. Na app aparece em o seletor de modelo de LLM.

## Como usar

```tsx
// O componente vem do bundle: window.BraboDS.ModelIcon

// Ao lado de um rótulo — decorativo, então esconda do leitor de tela.
<button>
  <ModelIcon size={14} aria-hidden />
  Continuar
</button>

// Sozinho e significativo — dê a ele um nome acessível.
<ModelIcon size={16} aria-label="um cubo de modelo" />
```

## O que respeitar

- **Tamanho**: `size` em px, sempre 1:1 sobre um grid de 24. A app usa de 12 a
  22; 16 é o default e o valor mais comum.
- **Cor**: o traço é `currentColor`. A cor vem do contexto — herde do
  container ou defina `color` no pai. Não existe prop de cor de traço.
- **Traço**: `strokeWidth` é 1.6 em todo o set. Mudar num ícone só quebra a
  consistência óptica dos 37.
- Todos os ícones do set têm exatamente esta mesma assinatura, então trocar um
  pelo outro nunca exige mexer nas props.
