# 0140 — Timeout repetido do `pnpm audit` é risco assumido; achado continua reprovando

## Context

Em 2026-09-04 o endpoint de advisories do npm
(`POST registry.npmjs.org/-/npm/v1/security/advisories/bulk`) ficou intermitente
por horas. O job `Auditoria de dependências` reprovou em **quatro PRs
distintas** (#464, #466, #396, #468), sempre com a mesma assinatura:

```
[WARN] POST .../security/advisories/bulk error (23). Will retry in 10 seconds. 2 retries left.
[WARN] POST .../security/advisories/bulk error (503). Will retry in 1 minute. 1 retries left.
TimeoutError: The operation was aborted due to timeout
```

Não era a árvore de dependências, não era o runner e não era nenhuma das PRs.
Foi **reproduzido fora do CI**, batendo direto no endpoint a partir de outra
máquina: mesma ausência de resposta em 20s, enquanto um `GET` comum no mesmo
registry respondia em 130ms. O `pnpm audit` já retenta três vezes por dentro
(as duas linhas de `retry` acima); o serviço simplesmente não respondia.

O custo não foi só o tempo. Foi o comportamento que a situação ensina: cada
falha dessas se resolve re-rodando o job até passar, e **quem aprende a
re-rodar até passar re-roda também quando o vermelho é de verdade**. Um gate
que grita sem motivo não fica neutro — ele corrói a confiança nos gates que
gritam com motivo.

## Decision

**Decisão do dono do produto: três tentativas sem resposta do registry são
RISCO ASSUMIDO.** O job segue verde, com aviso alto no resumo.

O que a decisão **não** afrouxa, e é o que a torna defensável:

| situação | veredito | retentativa |
|---|---|---|
| `pnpm audit` sai 0 | passa | — |
| relatório de vulnerabilidade | **reprova** | nenhuma — a resposta já veio, e é não |
| requisição não completou (timeout/5xx/DNS/socket) | infra | até 3 |
| 3 infras seguidas | passa, **declarado** | — |
| saída não reconhecida | **reprova** | nenhuma |

**A precedência é o coração disto.** `scripts/ci/auditoria-de-dependencias.ts`
classifica a saída, e as marcas de ACHADO são testadas **antes** das de rede:
um relatório que por acaso mencione `timeout` — um pacote com esse nome, um CVE
de timeout — não pode ser perdoado como indisponibilidade. Há teste para
exatamente esse caso.

**Falha desconhecida reprova (fail closed).** Se a saída não casa com nenhuma
das duas assinaturas, o veredito é `achado`. A única coisa pior que um gate que
reprova demais é um que aprova o que não entendeu.

**O aviso diz o que a execução NÃO afirma.** Quando o risco é assumido, o
resumo do job registra que a árvore *não foi auditada* — nunca que está limpa.
Verde por indisponibilidade e verde por auditoria limpa são estados diferentes,
e o job não os confunde no texto.

**A lógica mora em script testável**, não em `bash` dentro do YAML: a
classificação é função pura com 11 casos, incluindo as saídas REAIS do run
33838507158 (a que motivou tudo) em vez de paráfrases.

## Consequences

**Existe uma janela real de risco, e ela está declarada.** Numa indisponibilidade
longa do npm, PRs entram sem auditoria de dependências. Isso está registrado em
[cadeia-de-suprimentos-do-ci.md](../explanation/cadeia-de-suprimentos-do-ci.md),
na seção "What is still trusted on faith", ao lado das outras confianças
assumidas — não escondido no comentário de um workflow.

**A alternativa foi medida antes de ser recusada.** Manter vermelho por queda de
terceiro custou, no dia, quatro PRs travadas e várias re-execuções de ~5min cada,
sem que nenhuma delas descobrisse coisa alguma sobre o código. O que se compra
com essa rigidez é a aparência de rigor; o que se paga é o hábito de ignorar
vermelho.

**Só o lado pnpm muda.** `mix hex.audit` e `mix deps.audit` (Elixir) continuam
como estavam — o incidente foi do endpoint do npm, e alargar a exceção para
quem não a pediu seria transformar uma decisão pontual em política geral.

**O que continua sem resposta:** não há alerta quando o risco é assumido com
frequência. Três timeouts numa PR isolada é ruído de terceiro; três timeouts em
toda PR de uma semana é o gate desligado na prática, e hoje nada distingue os
dois casos além de alguém reparar. Fica como lacuna declarada, não resolvida
aqui.
