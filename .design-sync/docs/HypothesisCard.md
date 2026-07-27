---
category: Dominio
keywords: [hipótese, psicólogo, evidência, confiança, anamnese]
---

# HypothesisCard

Uma hipótese do Psicólogo sobre o comportamento de um agente, com a evidência
que a sustenta e a decisão do usuário.

## Como usar

```tsx
<HypothesisCard
  hypothesis={hipotese}
  projectId={projeto.id}
  onAccept={aceitar}
  onDismiss={descartar}
/>
```

## O que respeitar

- Os campos do domínio são em **pt-BR**: `observacao` (o que foi observado),
  `hipotese` (a explicação proposta), `sugestao` (o que fazer), `agenteAlvo`.
- `confiancaPercent` fica visível sempre, inclusive quando é baixo — esconder
  incerteza é o oposto do propósito do componente.
- `evidenceEventIds` é o que torna a hipótese navegável até o event log. Lista
  vazia deixa a hipótese sem lastro; prefira não propor.
- `terminationAnalysis` só quando a hipótese nasceu de uma sessão encerrada. Ela
  distingue comportamento do agente de causa operacional (um `node_shutdown`,
  por exemplo, não é culpa do agente).
- Com `status` diferente de `proposed` os botões saem e o card vira registro.
