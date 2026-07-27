---
category: Dominio
keywords: [projeto, card, lista, provisionamento, time, custo]
---

# ProjectCard

O card de um projeto na lista: provider do repositório, estado de
provisionamento, o time de agentes, o consumo e a última atividade. O card
inteiro é um `<button>` — `onClick` navega para o projeto.

## Como usar

```tsx
<ProjectCard
  name="plataforma-de-pagamentos"
  provider="github"
  provisioningStatus="provisioned"
  agents={AGENT_LIST}
  tokensUsed={184_320} tokensLimit={500_000}
  costBRL={12.47} costUSD={2.29}
  lastActivityText="dev-backend abriu PR há 18 min"
  unreadCount={3}
  onClick={() => navegar(projeto.id)}
/>
```

## O que respeitar

- `agents` é uma lista de `AgentDef` — os avatares tiram a cor de cada agente
  dali. Ordem importa: é a ordem em que aparecem.
- `provisioningStatus` omitido significa provisionado. `provision_failed` tem
  que levar o usuário a retomar, não a um beco.
- `lastActivityText` já vem formatado por quem chama; o card não formata tempo.
- `unreadCount` acima de zero desenha o badge; omita quando não há pendência.
