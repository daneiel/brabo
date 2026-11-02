# ADR 0236 — O Dependabot dispensa revisão na `dev` e fica mergeável com os outros checks verdes

- **Status:** aceito
- **Data:** 2026-11-02
- **Revisa:** a escada de aprovação do [ADR 0030](0030-politica-de-branches-mecanizada.md)
  (modo `solo`: "PR de terceiro exige 1 aprovação do owner"), só para o
  Dependabot e só no degrau `dev`
- **Contexto anterior:** [ADR 0235](0235-a-qa-e-aposentada-e-a-esteira-fica-dev-e-main.md)
  (a esteira é `dev → main`)

## Contexto

O check `Escada de aprovação` trata o `dependabot[bot]` como terceiro: no modo
`solo`, a PR dele espera a aprovação do owner mesmo com todos os outros checks
verdes. Em 02/11/2026 a #1201 ficou vermelha só por isso, e o dono pediu: "faça
com que o Dependabot não dependa de minha aprovação: se passar em todas as
outras CI/CD, fica mergeável".

## Decisão

1. **PR do Dependabot para a `dev` passa na escada sem revisão**, nos dois modos
   (`solo` e `community`). Os outros checks fazem o papel da revisão: testes,
   build, drift, `pr-police` e a regra dos dois digests.
2. **O Dependabot é reconhecido por autor E branch**, com a MESMA régua do
   `pr-police`: `ehBranchDoDependabot` exige a branch `dependabot/…` e o login do
   bot, e `dependabot` sem sufixo só vale com `user.type == Bot`. Um humano que
   nomeie a branch `dependabot/` continua precisando de aprovação.
3. **Só na `dev`.** Para a `main` a escada continua inteira. O Dependabot já
   entra pela `dev` (`target-branch: dev` e `dependabot-para-dev.yml`), e chega à
   `main` pela promoção, como todo o resto.
4. **Nada é mergeado sozinho.** "Mergeável" quer dizer que nenhum check obriga
   um gesto a mais. Continua valendo que merge em branch protegida é ato
   manual (o merge na `dev` é de quem conduz a rodada; o da `main`, do dono).

## Consequências

- A atualização do Dependabot fica pronta para merge assim que o CI dela termina
  verde, sem esperar o owner abrir a PR para aprovar.
- O risco de uma atualização maliciosa ou quebrada passar sem olhos humanos é
  coberto pelo CI e pela promoção para a `main`, que segue com a escada inteira.
  A PR continua visível e pode ser fechada antes do merge.
- Implementação: `scripts/ci/approval-ladder.ts`
  (`DESTINO_SEM_REVISAO_PARA_O_DEPENDABOT`, `dispensadoPorDependabot`) e o
  `PR_AUTOR_TIPO` no `.github/workflows/approval-ladder.yml`, provados em
  `scripts/ci/approval-ladder.spec.ts`.
