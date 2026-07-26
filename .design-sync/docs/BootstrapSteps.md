---
category: Wizard
keywords: [bootstrap, gitflow, provisionamento, passos, progresso]
---

# BootstrapSteps

O progresso do bootstrap de Gitflow: os seis passos que preparam o repositório,
com o estado de cada um.

## Como usar

```tsx
<BootstrapSteps stepStates={estados} failedStep={status.failedStep ?? undefined} />
```

## O que respeitar

- **`stepStates` precisa dos seis passos** — é um `Record` completo de
  `BootstrapStepName`, na ordem em que o pipeline executa:
  `commit_pr_template`, `commit_branching_policy`, `create_dev_branch`,
  `create_qa_branch`, `create_rc_branch`, `protect_branches`.
- Estados em **pt-BR**: `pendente`, `rodando`, `ok`, `skip`, `falha`.
- **`skip` não é falha**: significa que o passo era desnecessário (o arquivo já
  existia, a branch já estava lá). Use `note` para dizer por quê — o bootstrap é
  idempotente e retomável, e o usuário precisa entender que nada quebrou.
- `failedStep` é o que permite oferecer retomada a partir do ponto certo.
- Um passo `rodando` por vez. Dois simultâneos descrevem um estado que o
  pipeline não produz.
