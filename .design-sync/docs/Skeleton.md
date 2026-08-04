---
category: Primitivas
keywords: [skeleton, carregando, placeholder, esqueleto, loading]
---

# Skeleton

Retângulo pulsante que reserva a MEDIDA do conteúdo que ainda vai chegar.

## Como usar

```tsx
// Linha de texto: largura em % acompanha o container.
<Skeleton width="70%" height={15} />

// Bloco com canto: use o mesmo radius do elemento real.
<Skeleton width={34} height={34} radius={8} />
```

## O que respeitar

- **Meça o conteúdo real.** O ponto do skeleton é a lista não PULAR quando os
  dados chegam. Um retângulo de altura arbitrária troca o salto de lugar em vez
  de eliminá-lo — copie as medidas do componente que ele substitui.
- **Não anime o que não espera.** Skeleton é para carregamento em andamento;
  num estado vazio permanente ele promete algo que nunca vem.
- Para um card inteiro existe `ProjectCardSkeleton`, que já traz a silhueta
  certa — não remonte à mão.
