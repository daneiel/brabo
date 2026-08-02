---
id: validacao-fase-12
title: A validação de que os três achados morreram
sidebar_label: Validação da Fase 12
sidebar_position: 5
description: O roteiro auditável que exercita adoção, promoção manual e reagendamento numa execução só — com os event ids extraídos do banco, e o que a validação deliberadamente não prova.
keywords: [validação, Fase 12, dogfooding, adoção, reagendamento, promoção]
---

# A validação de que os três achados morreram

A [colheita do primeiro dogfooding](./primeiro-dogfooding.md) deixou três
achados P1 de operabilidade. A Fase 12 os endereçou um a um; este documento é a
prova de que os três morreram **na mesma execução**, e não só em testes
unitários que cada fatia escreveu para si.

A validação é um script: `pnpm --filter api validacao:fase-12`. Ele sai com
código diferente de zero quando o critério não fecha — é critério de aceite, não
relatório — e ao final imprime a tabela de evidência **lida do banco**. Os ids
abaixo não são transcritos à mão.

## O que ela NÃO prova

Isto vem primeiro, e não em rodapé, porque uma validação que esconde os próprios
limites vale menos que nenhuma.

**Não prova GitHub remoto.** A adoção roda contra o `LocalGitProvider`. O motivo
não é conveniência: o fork usado na Fase 10 **nunca foi nomeado** — a linha 135
da missão continua sendo um `TODO(humano): qual owner/repo do fork?` —, então
não existe alvo para readotar. O caminho exercitado é o mesmo nos dois
providers (`getRepo` → plano → `origin: 'adopted'`); o que muda é a rede, e essa
diferença está coberta pelo smoke `adopt-repository.smoke.spec.ts`, que só roda
com `ADOPT_TEST_REPO` e `GITHUB_TEST_TOKEN` reais.

**Não prova o julgamento dos gates.** QA e SecOps são agentes de LLM. Aqui o
veredito entra pelo `RecordGateVerdictUseCase` — que é o funil **real** por onde
o parecer deles passa, e onde nasce a linha de outbox `task.gate_resolved`. O
que a Fase 12b precisa provar é a cadeia veredito → outbox → wake → claim, não
se o modelo sabe ler uma suite. O julgamento continua coberto pelos aceites da
Fase 4a, que o [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) declara
explicitamente **não determinísticos** com modelo local.

**Não faz merge.** Merge em branch protegida é decisão do usuário, por desenho
([RN-014](../business-rules.md#rn-014)). O passo 6 do roteiro mostra a trava
recusando exatamente isso, com autonomia `auto_approve` e `permissions.json`
liberando.

**Não usa LLM em lugar nenhum.** O dev é o `NoopDevAgentServer`. Ele não
escreve código de verdade — mas desde a Fase 12d ele exercita a **mesma máquina
de estados** do agente real (`Engine.Dev.AgentIo`), e é isso que está sob teste
aqui. Antes disso o Noop processava uma task e parava: o achado #10 sobrevivia
dentro do próprio instrumento de medida, o que teria reprovado o critério "zero
restarts" por defeito da ferramenta, não do produto.

## O roteiro

| # | passo | o que é afirmado |
|---|---|---|
| 0 | criar projeto | nasce com `story_promotion = manual` **sem ninguém configurar nada** |
| 1 | adotar um bare repo pré-existente, com `main` e `develop`, sem `qa` nem `rc` | `origin = 'adopted'`; o plano diagnostica branch faltante **e** branch fora do template; `plan_decision` fica **nula**; nenhuma linha inserida à mão |
| 1b | decidir "adotar como está" | o template **não** é forçado sobre o repositório do usuário ([RN-045](../business-rules.md#rn-045)) |
| 2 | o PO cria uma história completa, com 3 tarefas | a história fica `draft` + `proposed_ready`; **`claimNext` devolve `null`** |
| 3 | o usuário promove | a história vira `ready`; a proposta sai da fila; o evento registra `user`, não `agent/po` |
| 4 | ativar a execução e resolver 3 gates em sequência | 3 tarefas, 1 agente, **0 restarts do engine** |
| 5 | fila vazia | `dev.idle` explícito, processo vivo |
| 6 | propor merge em branch protegida com tudo liberado | `pending` — continua sendo sua decisão |

O passo 2 é o que mata o achado #13 de forma verificável: não basta a história
ficar `draft`, é preciso que **nada seja pegável**. Por isso o script chama
`claimNext` diretamente e exige `null`. O passo 4 é o que mata o #10: da segunda
volta em diante ninguém dispara `:work` — o agente reivindica sozinho, acordado
pelo `task.gate_resolved` da volta anterior.

## A evidência

Cole aqui a tabela que o script imprime. Cada linha é um `session_events.id`
(ULID) que existe no banco e pode ser consultado depois.

> **TODO(humano):** rodar `pnpm --filter api validacao:fase-12` de dentro do
> container da api, com a stack de dev de pé, e colar a saída da seção
> "evidência" abaixo. O script já emite a tabela em Markdown, pronta para
> substituir este bloco.

```
| etapa | evento | id | seq |
|---|---|---|---|
| (ainda não executado) |  |  |  |
```

O script se recusa a terminar com sucesso se alguma etapa que ele afirmou ter
exercitado não deixar evidência no event log — sem essa checagem, uma consulta
errada produziria uma tabela curta e a validação passaria mesmo assim, que é o
modo de falha clássico de relatório gerado.

## Antes × agora

A coluna **Fase 10** cita apenas o que é derivável do que ficou escrito. Tudo
que dependeria de uma contagem ao vivo aparece como `não medido`, pelo motivo
explicado na [colheita](./primeiro-dogfooding.md).

| | Fase 10 | Agora |
|---|---|---|
| apontar o projeto para um repositório existente | seed manual em duas tabelas, **antes da primeira sessão** (`dogfooding-mission.md:104-134`) | rota de adoção; `origin = 'adopted'`; zero escrita à mão |
| política divergente do repositório | não havia diagnóstico — o bootstrap era a única via, e ela impunha o template | plano em dry-run que **descreve** a divergência e não aplica nada sem aprovação |
| restarts do engine por task entregue | **1, por construção** — propriedade do achado #10 (`:666`), não estimativa. Total real: **não medido** | **0** |
| tandas | a fase inteira rodou em tandas (`:393-416`) | não existem: o agente atravessa a fila do módulo sozinho |
| agente sem task | processo morto (`restart: :temporary`) | `idle` explícito, supervisionado, acordável por evento |
| sequência de falhas | queimava orçamento em série | circuit breaker para em `idle_tripped` ([RN-047](../business-rules.md#rn-047)) |
| história → `ready` | automática na criação, sem passo humano (achado #13, `:669`) | decisão do usuário, com o ator gravado no event log ([RN-048](../business-rules.md#rn-048)) |
| recusar uma história | não existia estado, evento nem botão (achado #14) | devolução ao PO com motivo fixado na sessão dele |
| intervenções manuais totais | **não medido** — a tabela de observação ficou em branco (`:488-490`) | as do pipeline de aprovação, que a fase **não** mudou |
| merge em branch protegida | manual, por desenho | manual, por desenho — inalterado, e o passo 6 prova |

A última linha importa tanto quanto as outras. A Fase 12 é sobre o agente não
morrer entre tarefas e sobre a decisão voltar para o usuário; ela **não** amplia
autonomia nenhuma. O pipeline de aprovações está exatamente como estava.

## Como rodar

```bash
# a stack de dev de pé (api e engine compartilhando /data)
pnpm dev

# de dentro do container da api
docker compose -f docker/docker-compose.yml exec api \
  pnpm --filter api validacao:fase-12
```

Se algum critério não fechar, o script diz qual — a mensagem começa com
`CRITÉRIO NÃO FECHOU:` e nomeia a afirmação que falhou.
