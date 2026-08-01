# 0040 — Moeda do dashboard: USD por ora, câmbio manual por workspace adiado

## Contexto

A fidelidade do dashboard de projetos ao mock aprovado (`design/SCREENS.md`,
`design/COMPONENTS.md`) pediu que a linha de resumo e o `TokenMeter` compacto
do card mostrassem gasto e saldo — algo que o `TokenMeter` `compact` nem
tinha até aqui (a variante existia só com a barra/percentual, sem rodapé de
custo nenhum).

O mock base mostra a dupla `"R$ X · US$ Y"` em todo lugar onde aparece custo
— é o padrão do `TokenMeter` `default`/`live`, usados hoje em
`ProjectPage.tsx` (header do projeto) e `SessionPage.tsx` (topbar do chat).
Mas não existe fonte de câmbio nenhuma no sistema: `costBRL` sempre chegou
como `0` do lado do dashboard (`ProjectCardContainer` em `Dashboard.tsx`
nunca calculou um valor real pra ele), e não há preferência de moeda por
workspace nem taxa de conversão configurável em lugar nenhum do domínio. O
"R$" que aparecia era, na prática, sempre zero — um dado fantasma.

## Decisão

1. **A linha de resumo do dashboard e o rodapé novo do `TokenMeter`
   `compact` mostram só USD.** É a moeda de origem: os preços de modelo em
   `apps/api/src/domain/llm/` (`MODEL_SEEDS` do seed, tabela `models`) são
   micro-USD nativamente — não há conversão nenhuma envolvida, só
   formatação (`apps/web/src/lib/currency.ts`, `usdFmt`).
2. **Divergência ISOLADA a essa superfície.** `TokenMeter` `default` (header
   de projeto) e `live` (topbar de sessão) continuam mostrando `"R$ X · US$
   Y"` exatamente como hoje — não foram tocados. A mudança de moeda é
   escopo do card do dashboard e da linha de resumo, não do componente
   inteiro.
3. **Preferência de moeda por workspace, com taxa de câmbio manual
   editável, fica REGISTRADA e ADIADA.** Não implementada nesta entrega.
   Quando existir, o desenho natural é um campo em `workspaces` (ou tabela
   própria) com `currency` + `manualExchangeRate`, resolvido na formatação
   do lado do backend ou do cliente — mas commitar a essa forma agora, sem
   um segundo caso de uso pressionando o design, seria adivinhação.

## Consequências

- O `"R$ 0,00"` fantasma que aparecia no card do dashboard some — o valor
  que sobra (USD) é o único que o sistema de fato sabe calcular hoje.
- Quem quiser ver o custo em R$ continua tendo isso no header do projeto e
  no chat (`default`/`live`), só não no card da listagem nem no resumo.
- Câmbio manual por workspace é trabalho real, não fechado por este ADR:
  quando alguém precisar dele, o ponto de partida é este documento, não uma
  decisão nova do zero.
