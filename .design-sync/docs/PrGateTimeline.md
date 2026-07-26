---
category: Dominio
keywords: [pr, gate, qa, secops, merge, cobertura, revisão]
---

# PrGateTimeline

A linha do tempo de uma PR de agente: o stepper **dev → qa → secops → você** e
os pareceres de cada gate, expansíveis.

## Como usar

```tsx
<PrGateTimeline task={task} prAction={acaoDaPr} verdicts={pareceres} />
```

## O que respeitar

- **A última etapa é sempre o usuário.** Merge em branch protegida é decisão
  manual, garantida por teste no domínio — nenhuma composição deve sugerir
  merge automático.
- `task.gateStatus` diz onde a PR está (`awaiting_qa`, `awaiting_secops`,
  `awaiting_user`); `null` significa que nenhum gate começou.
- `verdicts` são os pareceres já emitidos, em ordem de `seq`. Cada um traz
  `resumo` e `itens`; o do QA pode trazer `coverageMatrix`.
- **Os pareceres nascem colapsados.** A `coverageMatrix` só aparece expandindo o
  parecer — em preview ou teste, é preciso clicar no header dele.
- Uma regra da matriz com `covered: false` é o ponto de existir a matriz: ela
  fica visível como "sem teste", não escondida.
- `task.blocked` com `blockedReason` desenha o bloqueio. Bloqueio sem motivo
  deixa o usuário sem saída.
