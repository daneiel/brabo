---
id: validacao-real
title: A validação real — GitHub remoto e modelo de verdade
sidebar_label: Validação real (13b)
sidebar_position: 6
description: A execução contra um repositório remoto de verdade, com dev agent real e modelo de API — o que ela provou, o que ela reprovou, e por que reprovar aqui vale mais que passar.
keywords: [validação, dogfooding, GitHub, dev agent, medição, FASE 13b]
---

# A validação real — GitHub remoto e modelo de verdade

A [validação da Fase 12](./validacao-fase-12.md) declara os próprios limites com
todas as letras: `LocalGitProvider`, `NoopDevAgent`, veredito de gate escrito
pelo próprio script. Ela existe para provar a **cadeia** sem depender de rede
nem de julgamento de modelo, e faz isso bem.

Esta aqui troca exatamente as três coisas que aquela deixou de fora — GitHub
remoto, dev agent real, modelo de API — e o resultado é o que se espera de um
dogfooding honesto: **a metade barata passou inteira, e a metade cara falhou de
um jeito que nenhum teste tinha mostrado.**

O script é `pnpm --filter api validacao:real -- --repo <owner/repo>`.

## O que passou, e é mais do que parece

Tudo abaixo rodou contra `daneiel/test` no GitHub de verdade, e **sem gastar um
centavo** — é a fase `--ate backlog`.

| o que | resultado |
|---|---|
| adoção remota (`getRepo` de verdade) | `origin: adopted`, branch padrão `main` |
| plano em dry-run | 6 mutações, 6 diagnósticos, **decisão nula** |
| repositório intocado até a decisão | verificado pela API: **zero branches, zero conteúdo** |
| readoção converge | 6 mutações na 1ª passada, **3 na 2ª** ([RN-046](../business-rules.md#rn-046)) |
| story única fica `draft` + proposta | sim, sem promoção automática |
| `claimNext` antes da promoção | `null` — nada pegável |
| promoção | registrada com o **usuário** como ator |

A RN-045 deixa de ser provada só contra um bare local: o repositório remoto foi
conferido **depois** da adoção e estava literalmente vazio.

### O achado D aconteceu de verdade

O bootstrap parou em `protect_branches` com
`Upgrade to GitHub Pro or make this repository public` — repositório privado no
plano gratuito. É exatamente o cenário que a Fase D documentou, agora observado
fora de teste.

E a premissa da [RN-078](../business-rules.md#rn-078) se confirmou: conferido o
repositório logo depois, `dev`, `main` e `qa` existiam e os arquivos estavam
commitados. É o **último** passo, e o único cuja falha deixa um repositório
utilizável. O script reconhece a falha e segue, que é a saída desenhada para
isso.

## O que a execução paga mostrou

Modelo `openai/gpt-5-mini` via OpenRouter, dev agent real, uma story com uma
task: *"Expor GET /saudacao"*.

**A task foi bloqueada por `limite de iterações atingido`, com origem
`modelo`.** Nenhuma PR foi aberta, e portanto nenhum gate chegou a julgar.

O diagnóstico gravado é de uma clareza incômoda: `(nenhum terminal rodado)`.

### A medição

Extraída por `pnpm --filter api medir:execucao`, nunca anotada à mão:

| | |
|---|---|
| janela | 1m36s |
| sessões · eventos | 3 · 59 |
| **restart do engine no meio** | **não** |
| voltas de gate | nenhuma (não houve PR) |
| turnos mudos | nenhum |
| intervenções do usuário | nenhuma |

| agente | chamadas | in | out | custo | modelo |
|---|---|---|---|---|---|
| dev-api | 8 | 5.671 | 205 | < US$ 0,01 | `openai/gpt-5-mini` |
| anamnese | 1 | 6.779 | 967 | < US$ 0,01 | deepseek-v4-flash |
| psicologo | 1 | 3.212 | 1.981 | < US$ 0,01 | deepseek-v4-flash |

O critério **zero restarts** fechou. E o custo é a parte menos interessante:
205 tokens de saída em oito chamadas é um agente que não escreveu nada.

### O que o produto descobriu sozinho

O Psicólogo rodou em tier pesado e produziu três hipóteses. A primeira e a
segunda são o diagnóstico correto, sem ninguém apontar:

> O dev-api não tinha (ou não utilizou) um ambiente terminal funcional […] em
> toda a sessão não existe nenhum tool.call de execução de comando […] apenas
> `search_workspace`/`read_file`.

> A ferramenta `search_workspace` está sub-indexada ou mal configurada para
> este repositório: não encontrou nenhum arquivo de código ou manifesto […]
> Isso enganou o agente, que ficou tentando entender "onde está o projeto".

Isto merece registro separado: a introspecção do produto **funcionou**. O
Psicólogo leu o event log de uma execução fracassada e nomeou a causa com
precisão maior que a de qualquer asserção do script.

## Os achados, para a triagem da 13c

A disciplina da fase vale aqui como em todo lugar: **achado novo entra como
item, nunca como fix**.

### X. O dev agent queima o teto de iterações explorando repositório vazio

Dada uma task num repositório recém-provisionado — que tem só o template do
Gitflow, sem código —, o agente gastou as oito iterações em
`search_workspace`/`read_file` procurando "onde está o projeto", e nunca rodou
um comando nem escreveu um arquivo.

O sintoma é `limite de iterações atingido` com origem `modelo`, o que é
tecnicamente verdade e praticamente inútil: o modelo não errou um julgamento,
ele nunca chegou a julgar nada. A causa é a ausência de sinal de que **não há
o que procurar** — um repositório vazio é indistinguível, pelas ferramentas
disponíveis, de um repositório onde a busca falhou.

Vale notar que este é o **primeiro** cenário do produto em que o dev agent
começa do zero absoluto. Todo teste e toda demo partiram de um workspace com
código.

### Y. `search_workspace` não distingue "vazio" de "não encontrei"

Consequência direta do anterior, e provavelmente a peça acionável: as cinco
primeiras chamadas devolveram `nenhum resultado`, o que o agente leu como
"procure melhor" em vez de "não há nada aqui". O Psicólogo chegou à mesma
conclusão sozinho.

## A segunda execução: a correção do Y NÃO fechou o X

Depois de fechar o achado Y, a mesma execução rodou de novo — mesma story,
mesmo repositório, mesmo modelo. **Só a frase da ferramenta mudou entre as
duas.**

| | 1ª execução | 2ª execução |
|---|---|---|
| chamadas do dev-api | 8 | 8 |
| tokens de saída | 205 | 248 |
| desfecho | `limite de iterações atingido` | `limite de iterações atingido` |
| PR | nenhuma | nenhuma |

O comportamento mudou de forma observável — **uma** busca em vez de cinco,
seguida de `read_file` — e o desfecho não. A mensagem nova chegou ao agente e
foi a correta para o caso (`o workspace tem 2 arquivo(s), então a busca
funcionou`), porque o repositório tinha o template do Gitflow e não estava
vazio.

**A hipótese registrada aqui estava errada.** O texto anterior dizia *"a
correção é a frase, não o teto"*. A evidência diz outra coisa: das oito
iterações, sete foram exploração. Sobra UMA para escrever o arquivo, commitar,
dar push e abrir a PR — nem um agente perfeito fecharia isso.

`TOOL_LOOP_MAX_ITERATIONS` é `8` por default
(`apps/engine/config/runtime.exs:100`). O número nasceu para agente
conversacional, e nunca foi reavaliado para um dev agent que precisa explorar
um repositório antes de agir.

O Psicólogo, de novo, foi mais preciso que a asserção do script:

> o workspace não contém o código do projeto: não há package.json, nem src,
> nem README

> ficou apenas em modo leitura/exploração

### O que isso ensina sobre medir

Registrar o resultado negativo é o ponto. Se a segunda execução não tivesse
sido feita, o achado Y — que é real e está coberto por teste — seria fácil de
confundir com a solução do X. Foi uma correção correta que **não** produziu o
efeito esperado, e só a execução mostrou isso.

## O que esta validação ainda NÃO prova

Honestidade sobre o alcance, como na irmã dela:

- **Os gates por LLM.** Sem PR, nada chegou a QA ou SecOps. O julgamento real
  de gate continua sem execução remota que o prove.
- **A PR remota.** `pr_open` nunca foi proposta.
- **Merge.** Continua fora por desenho ([RN-014](../business-rules.md#rn-014)),
  e continuará.

A cadeia até a promoção está provada contra rede real. Do dev agent em diante,
não — e a razão não é a rede, é o achado X.

## Referências

- [validacao-fase-12.md](./validacao-fase-12.md) — a irmã determinística
- [achados-execucao-real.md](./achados-execucao-real.md) — a colheita
- [backlog.md](./backlog.md) — para onde X e Y vão
