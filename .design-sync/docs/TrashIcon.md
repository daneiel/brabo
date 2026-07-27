---
category: Icones
keywords: [remover, excluir, lixeira]
---

# TrashIcon

Ícone outline do set do Brabo: desenha uma lixeira. Na app aparece em remover credencial, agente ou projeto.

## Como usar

```tsx
// O componente vem do bundle: window.BraboDS.TrashIcon

// Ao lado de um rótulo — decorativo, então esconda do leitor de tela.
<button>
  <TrashIcon size={14} aria-hidden />
  Continuar
</button>

// Sozinho e significativo — dê a ele um nome acessível.
<TrashIcon size={16} aria-label="uma lixeira" />
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
