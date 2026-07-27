---
description: Compara o código com a documentação e corrige o drift factual
argument-hint: "[range de git, ex.: origin/dev...HEAD ou HEAD~5...HEAD]"
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

Compare o código atual com a documentação e corrija o drift.

Range: `$ARGUMENTS` — se vazio, use `origin/dev...HEAD`.

## Passos

1. `git diff --name-only <range>` para saber o que mudou.

2. Rode `node scripts/docs/drift.mjs <range>`. Ele já cruza os arquivos
   alterados com o `docs/.docmap.yml` e diz quais documentos foram afetados,
   quais bloqueiam e quais são só aviso. **Não refaça esse trabalho à mão.**

3. Para cada documento afetado: leia, compare com a realidade do código, e
   corrija **apenas o que está factualmente errado ou faltando**.

   Não reescreva estilo. Não "melhore" prosa que está correta. Não reorganize
   seções. O objetivo é fechar a distância entre o que a doc afirma e o que o
   código faz — nada além disso.

   Onde a doc cita `arquivo:linha`, **confira a linha**. Referência que aponta
   para o lugar errado é pior que referência ausente.

4. Rode `pnpm docs:generate`. Ele reescreve `docs/reference/scripts.md` e os
   blocos entre `<!-- BEGIN:GENERATED:... -->` em `configuration.md` e
   `events.md`. Se ele marcar algo como "sem descrição acima" ou "não descrito
   acima", **essa é uma lacuna real**: escreva a descrição na prosa em vez de
   deixar só o inventário.

5. Se houve mudança de comportamento observável, adicione entrada em
   `CHANGELOG.md` na seção Unreleased.

6. Verifique se algum ADR é necessário — fronteira de camada, banco, modelo de
   consistência, dependência estrutural. Se sim, **proponha o texto**; não
   escreva o ADR sem confirmação. **Nunca edite um ADR já aceito**: a
   substituição é sempre um ADR novo que referencia o antigo.

7. Rode `pnpm docs:build` e conserte o que quebrar. Link quebrado e âncora
   inexistente reprovam o build de propósito.

## Regras

- Sem informação suficiente para afirmar algo, escreva
  `> **TODO(humano):** <pergunta específica>`. Nunca invente.
- Arquivos `generated: true` no docmap não se editam à mão — o próximo build
  sobrescreve. Conserte o gerador ou a fonte.
- Regra de negócio nova ou alterada exige a entrada `RN-XXX` em
  `docs/business-rules.md`, com `arquivo:linha` e o teste que a cobre.

## Relatório final

Três listas, nesta ordem:

1. **O que mudou** — documento por documento, o que foi corrigido e por quê.
2. **O que ficou como `TODO(humano)`** — e a pergunta exata que cada um faz.
3. **O que você deliberadamente NÃO mudou, e por quê** — esta é a parte mais
   útil. Doc que parece errada mas está certa, aviso do drift check que não se
   aplica, referência que preferi não tocar. Sem isso, a próxima rodada
   reexamina tudo do zero.
