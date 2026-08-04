---
category: Dominio
keywords: [skeleton, projeto, card, carregando, dashboard]
---

# ProjectCardSkeleton

A silhueta de um `ProjectCard`, com as mesmas medidas do card real. Não recebe
props.

## Como usar

```tsx
// Enquanto a lista de projetos carrega, no lugar dos cards.
{carregando
  ? Array.from({ length: 3 }, (_, i) => <ProjectCardSkeleton key={i} />)
  : projetos.map((p) => <ProjectCard key={p.id} {...p} />)}
```

## O que respeitar

- **As medidas são o contrato.** Ele existe para que a troca skeleton → card
  não mova nada na tela. Mexer no `ProjectCard` sem mexer aqui devolve o salto
  que ele foi feito para eliminar.
- Repita-o na quantidade que você espera receber, não numa fixa: três skeletons
  seguidos de um card só é pior que um skeleton só.
