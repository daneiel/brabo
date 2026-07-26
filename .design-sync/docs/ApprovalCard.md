---
category: Dominio
keywords: [aprovação, ação proposta, permissão, diff, autoridade]
---

# ApprovalCard

O card de uma `proposed_action` esperando decisão. É o componente onde a
autoridade final do usuário acontece: toda ação com efeito externo (terminal,
git, gasto, patch de instrução) nasce aqui.

## Como usar

```tsx
<ApprovalCard
  action={action}
  urgency="critico"
  meta="dev-backend · há 30 segundos"
  onApprove={aprovar}
  onDeny={(motivo) => negar(motivo)}
  onAlwaysAllow={gravarRegra}
/>
```

## O que respeitar

- **Os três handlers são obrigatórios.** `onDeny` recebe um motivo opcional
  digitado pelo usuário — o textarea só aparece depois do clique em "Negar".
- O corpo do card muda por `action.actionType`: comando para `terminal`, diff
  para `git_commit` e `instruction_patch`, e assim por diante. Não há prop de
  layout; o tipo da ação decide.
- **`actor.id` tem que ser uma chave de agente** (`dev-backend`, `qa`,
  `anamnese`…). O card resolve nome e ícone por ela; um id de modelo cai no
  fallback e o card perde a identidade.
- Quando `status` sai de `pending`, os botões desaparecem e o card vira
  registro da decisão — com o motivo, quando houve.
- Em `instruction_patch` o "Sempre permitir" **não** é oferecido: a política do
  domínio força aprovação sempre, então o botão prometeria um efeito que não
  existe.
- `variant="queue"` com `selectable` habilita decisão em lote na fila.
