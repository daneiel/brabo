---
id: execucao-real-hello-world
title: A execução real — o hello world
sidebar_label: Execução real (hello world)
description: A primeira execução do Brabo com modelo de API de ponta a ponta, os dezesseis achados que ela produziu e o que ainda não foi provado.
keywords: [dogfooding, execução real, achados, fase 13]
---

# A execução real — o hello world

Primeira vez que a cadeia de agentes rodou com **modelo de API** de ponta a
ponta, no lugar do Ollama local. Projeto novo (`Hello API`), repositório real
no GitHub, provider OpenRouter, modelo `~deepseek/deepseek-v4-flash-latest`.

O objetivo não era entregar o hello world. Era descobrir o que quebra quando o
produto é usado como um usuário o usaria — e isso ele fez em quantidade.

:::caution Esta execução NÃO é a medição oficial da FASE 13b
Houve **restart do engine no meio**, várias vezes, para carregar as correções
que a própria execução exigiu. O critério "zero restart" está perdido, e a
tabela abaixo mede uma corrida acidentada de propósito. A medição que vale
ainda precisa ser feita, com tudo já corrigido e sem interrupção.
:::

## Até onde a cadeia chegou

| etapa | resultado |
|---|---|
| Provisionamento GitHub | ✅ `daneiel/hello-api`, 4 de 5 passos do Gitflow |
| Criativo | ✅ 4 regras de negócio, com rastreabilidade |
| Prontidão → brief | ✅ `product_brief` referenciando as 4 regras |
| PO | ✅ 1 épico, 4 histórias com RF/DOR/DOD |
| Promoção manual | ✅ 4 histórias promovidas pelo usuário (RN-048) |
| Arquiteto | ❌ nunca recebeu o bastão |
| Dev, PR, gates | ❌ não alcançados |

O passo 5 do bootstrap (proteger branches) falhou por limitação do **plano** do
GitHub: repositório privado não aceita proteção de branch no plano gratuito.
Não é defeito do produto — mas o produto tratava como falha dura, sem avisar
antes. O wizard passou a avisar na hora da escolha.

## O custo, extraído do `token_usage`

| agente | chamadas | tokens de entrada | saída | custo (micro-USD) |
|---|---|---|---|---|
| **anamnese** | 32 | **392.510** | 18.207 | 38.605 |
| psicologo | 2 | 16.406 | 5.140 | 2.401 |
| po | 5 | 18.777 | 3.492 | 2.318 |
| criativo | 6 | 6.406 | 3.343 | 1.180 |
| psicologo-leve | 1 | 1.947 | 2.039 | 542 |

A Anamnese gastou **8× o Criativo e o PO somados** sem produzir nada — ela não
tinha como dizer "não há nada a emitir" ([RN-063](../business-rules.md#rn-063)).
É o número mais importante desta tabela: o trabalho custou centavos, o
desperdício custou o resto.

## Os dezesseis achados

Numerados na ordem em que apareceram. Os corrigidos foram decididos pelo
usuário, um a um.

### Corrigidos nesta execução

| # | o quê | onde ficou |
|---|---|---|
| 4 | wizard mostrava `brabo/<slug>` como destino do repo, com `brabo/` hardcoded — a api cria em `createForAuthenticatedUser` | aberto |
| 6 | provisionamento falhava e a tela ficava em "Trabalhando…" para sempre, com zero eventos | aberto |
| 8 | bootstrap morria em **todo projeto GitHub novo**: repo vazio responde 409 em toda a Git Data API, e o provider tratava só 404 | PR #125 |
| — | fake do GitHub respondia 404 onde o real responde 409 — a suite ficava verde com o produto quebrado | PR #125 |
| — | plano gratuito não protege branch em repo privado, e a escolha não avisava | PR #125 |
| 13 | **nenhum agente conseguia usar provider com credencial**: o turno procurava a chave pelo slug do agente numa coluna UUID | PR #126 |
| 14 | falha de turno virava `agent.response` vazio no log, com o motivo só em broadcast efêmero | PR #127 |
| — | o chat do Criativo abria em branco, sem dizer que a vez era do usuário | PR #127 |
| 12 | o Criativo decidia tecnologia (`GET` ou `POST`? JSON ou texto?) — a identidade não dizia o que **não** era dele | PR #131 |
| — | falha de FERRAMENTA era descartada com `_ =`: quatro regras recusadas em silêncio | PR #131 |
| — | restart do engine matava a conversa sem nada na tela | PR #131 |
| 15 | Anamnese sem verbo para encerrar: repetia chamada impossível até o teto, a cada tick | PR #132 |
| 16 | heartbeat de 30s matava sessão com handoff pendente — trabalho ficava inalcançável | PR #133 |

### Abertos, para triagem

| # | o quê |
|---|---|
| 1 | "Configurações" do menu lateral não navega; o catálogo (do workspace) só se alcança dentro de um projeto |
| 2 | não existe seção de credencial de **git** nas configurações — só de LLM |
| 3 | wizard promete "selecione uma credencial já cadastrada" e "verifique nas configurações", e nenhuma das duas existe |
| 4 | `brabo/` hardcoded no preview **e na tela de confirmação** do wizard |
| 5 | passo de política anuncia a branch `rc` e a cascata `rc ← qa`, removidas pelo ADR 0030 |
| 6 | falha antes da linha de `repo_bootstraps` deixa a tela girando para sempre, sem evento nenhum |
| 7 | feed de atividade mostra "atividade em system" para todo evento |
| 11 | sessão fecha por inatividade da **aba** (parcialmente resolvido pela RN-064: só protege quando há handoff pendente) |
| — | a Anamnese roda **dentro** da sessão de trabalho, intercalando eventos e disputando orçamento |

## O que esta execução provou, e o que não provou

**Provou** que a cadeia Criativo → PO funciona com modelo de API e produz
artefato de qualidade real: o backlog saiu com rastreabilidade fechada, e o
DOR das histórias dizia "formato e detalhes técnicos definidos pelo Arquiteto"
— a fronteira acrescentada ao Criativo atravessou o brief e chegou ao backlog.

**Provou** que o produto engolia erro em três camadas diferentes (turno,
ferramenta, processo), e que era isso que mantinha os defeitos invisíveis. As
três agora falam.

**Não provou** o Arquiteto, o dev, a PR remota nem os gates. **Não provou**
nada sobre custo real de uma execução completa. E não serve como medição da
FASE 13b, pelo restart no meio.

> **TODO(humano):** a execução limpa — sem restart, com tudo corrigido — ainda
> precisa ser rodada, e é ela que preenche `docs/explanation/validacao-real.md`
> com a tabela extraída por `pnpm --filter api medir:execucao`.
