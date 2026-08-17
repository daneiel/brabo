---
id: artifacts
title: Artefatos
sidebar_label: Artefatos
sidebar_position: 4
description: Os dez schemas de artefato validados no engine, quem pode emitir cada um, e por que a maioria não é emitível pelo modelo.
keywords: [artefato, schema, emit_artifact, qa_verdict, business_rule]
---

# Artefatos

Um artefato é a saída **estruturada e validada** de um agente. Concretamente:
um evento `artifact.<tipo>` no log, com o payload validado contra um schema
fechado antes de ser gravado.

Não há tabela de artefatos. A validação acontece num lugar só —
`Engine.Harness.ArtifactSchemas` — e campo obrigatório faltando **reprova a
emissão**, em vez de gravar um artefato pela metade.

## Quem pode emitir o quê

Esta é a distinção mais importante da página, e é fácil passar batido:

| origem | significa |
|---|---|
| **ferramenta** | o modelo decide emitir, chamando `emit_artifact` |
| **servidor** | o código emite quando o desfecho acontece; o modelo não escolhe |

**Só dois tipos são emitíveis por ferramenta:** `note` e `business_rule`. Todo o
resto é emitido pelo servidor.

O motivo é o mesmo em todos os casos: quando o artefato é o **registro de um
desfecho**, deixar o modelo escolher emiti-lo significa deixar que ele omita. Um
DevAgent que desiste não deveria poder decidir não registrar que desistiu.

**O tipo da sessão não filtra artefato nenhum.** A [RN-097](../business-rules.md#rn-097)
deu à sessão um `kind` (`consultiva` | `criativa`) e pôs uma trava no append de
eventos, mas ela alcança **um** tipo — `execution.activated` — e artefato não é
ele. Uma sessão consultiva grava `artifact.business_rule` igual: o que ela não
faz é entrar em execução. Quem chega pela regra do tipo tende a supor o
contrário, e a suposição errada aqui apagaria o registro de uma conversa
inteira.

## Os schemas

### `note` — ferramenta

| campo | obrigatório |
|---|---|
| `title` | ✅ |
| `body` | ✅ |

### `business_rule` — ferramenta

| campo | obrigatório |
|---|---|
| `title` | ✅ |
| `description` | ✅ |
| `origin` | ✅ — **lista não vazia** |

`origin` referencia os eventos da conversa que originaram a regra. Lista vazia
reprova: é a rastreabilidade da regra até onde ela foi dita, e sem ela a regra
vira afirmação sem procedência.

:::caution O modelo precisa SABER os nomes dos campos
A descrição da ferramenta `emit_artifact` é gerada a partir destes schemas
(`ArtifactSchemas.required/1`) e nomeia cada campo obrigatório, em inglês, com
um exemplo preenchido.

Não é zelo: a descrição anterior dizia apenas "emite um artefato tipado" e
listava os tipos. Numa execução real o modelo — conversando em português —
adivinhou `titulo`/`descricao`/`comportamento`, e as **quatro regras de negócio
daquela conversa foram recusadas em silêncio**. `origin` como texto livre
também reprova: precisa ser lista, e a descrição diz isso com todas as letras
([RN-061](../business-rules.md#rn-061)).
:::

### `product_brief` — servidor

| campo | obrigatório |
|---|---|
| `title` | ✅ |
| `summary` | ✅ |
| `rules` | ✅ |

Validável, mas **não** emitível por ferramenta. O servidor do Criativo o emite
apenas depois que você confirma a prontidão — nunca por uma tool call do
modelo.

### `task_blocked` — servidor

| campo | obrigatório |
|---|---|
| `taskId` | ✅ |
| `agentId` | ✅ |
| `reason` | ✅ |
| `diagnosis` | ✅ |

Emitido quando o DevAgent desiste da task: suite que não fecha, teto de
iterações, orçamento estourado, ou parada sem sinalizar. É o registro do
desfecho.

### `qa_verdict` e `secops_verdict` — servidor

| campo | obrigatório |
|---|---|
| `veredito` | ✅ — `approved` ou `changes_requested`, nada mais |
| `resumo` | ✅ |
| `itens` | ✅ |
| `taskId` **ou** `prActionId` | ✅ — exatamente um |
| `coverageMatrix` | opcional, só no QA |

Três validações extras vivem aqui:

**O veredito é fechado** nos mesmos dois valores da máquina de estados de gate
da api. Um valor fora disso faria o caso de uso estourar mais adiante — recusar
o artefato na emissão é o lugar certo de falhar.

**O sujeito é exclusivo.** Um parecer é sobre **uma** task de dev (`taskId`) ou
sobre **uma** PR de infra (`prActionId`) — nunca sobre as duas, nunca sobre
nenhuma. Mesmo tipo de artefato, consumidores diferentes.

**A `coverageMatrix` é opcional de propósito.** Um parecer de QA sem matriz de
cobertura ainda é um parecer válido; perdê-lo inteiro por causa de um campo
ausente seria pior do que registrá-lo incompleto.

O SecOps é determinístico — não tem LLM. O parecer do QA nasce da ferramenta
`emit_qa_verdict`, que é enforçada à parte. Em nenhum dos dois o modelo escolhe
emitir.

### `infra_delegation_files` — servidor

| campo | obrigatório |
|---|---|
| `files` | ✅ — lista **não vazia** |
| `summary` | ✅ |

Resultado de UM delegado da área de Infra (Fase 8c, ADR 0038) — o próprio
lead (Dockerfiles/compose) ou o subagente Workflows (pipeline de CI). O
`InfraLeadServer` emite isto depois que cada delegado termina, só pra ter
um `parecer_artifact_id` pra referenciar na tabela `delegations` — nunca
visto de fora da área. O que a api enxerga é a PR consolidada, via
`open_infra_pr` (mesmo mecanismo de sempre, intocado pela Fase 8c).

`files` vazia reprova pela mesma razão de `nada_a_validar/1` em
`InfraGateRunner` (ADR 0021): um delegado sem nenhum arquivo não terminou
nada, e "vazio" nunca deve passar por "concluído".

### `prototipo_navegavel` — ferramenta (`propose_prototype`, não `emit_artifact`)

| campo | obrigatório |
|---|---|
| `personas` | ✅ — lista **não vazia** |
| `jornadas` | ✅ — lista **não vazia** |
| `prototipo` | ✅ — `telas` não vazia |
| `resumo` | ✅ |

O protótipo que o UX Designer produz (ADR 0087), a partir da
`necessidade-de-negocio` do Criativo. Não é `note`/`business_rule` — o
UX Designer emite via `propose_prototype`, uma ferramenta PRÓPRIA
(`Engine.Agents.UxDesignerTools`), e este módulo só valida a FORMA, mesmo
mecanismo de `product_brief`: validável aqui sem estar na lista de tipos
emitíveis por `emit_artifact`.

`personas`/`jornadas` vazias, ou `prototipo` sem nenhuma tela, reprovam
pela mesma régua de `business_rule.origin` (linha 59): um artefato sem
conteúdo não vale registrar. Um `propose_prototype` bem-sucedido encerra o
turno (mesmo raciocínio do `propose_execution_plan`/`propose_infra_pr`) —
sem `proposed_action`, sem suspensão: propor um protótipo não tem efeito
externo.

### `plano_de_teste` — servidor

| campo | obrigatório |
|---|---|
| `storyId` | ✅ |
| `planoDeTeste` | ✅ |
| `criteriosExecutaveis` | ✅ — lista **não vazia** |
| `estrategiaDeAutomacao` | ✅ |

O entregável da QA-estratégia (ADR 0090; `docs/fluxo.yml`, papel
`qa-estrategia`, segundo momento do `qa-lead`): o plano de teste de UMA
story, emitido ANTES do dev agent escrever código — o gate `implementavel`
(`docs/gates.yml`) o consome. Nasce de `emit_plano_de_teste`, mas o modelo
não emite o artefato diretamente — `Engine.Gates.QaEstrategiaAgent` extrai o
resultado da tool call e chama `ArtifactEmitter.emit/5`, mesmo padrão de
`qa_verdict`/`task_blocked`.

`criteriosExecutaveis` vazia reprova pela mesma razão de
`infra_delegation_files`: um plano sem nenhum critério não é plano.

### `threat_model` — servidor

| campo | obrigatório |
|---|---|
| `storyId` | ✅ |
| `threatModel` | ✅ |
| `requisitosDeSeguranca` | ✅ |

O "segundo momento" do SecOps (RN-360, ADR 0090) — checklist STRIDE-lite
sobre o DESENHO de uma story, antes de existir código, mesmo padrão de
segundo-momento do `qa-estrategia`. `Engine.Gates.SecOpsAgentServer.run_design/2`
emite depois que `Engine.Gates.AppSecAgent.run/3` (sem `Terminal`, sem
`Diff`/`Scanner`/`DevAgentState`) termina o laço com `emit_threat_model` —
o modelo não escolhe emitir, o servidor emite quando o laço termina.

`riscos` fica de fora das obrigatórias: lista vazia é resposta válida (nem
toda story carrega risco residual) e a ferramenta já garante que a CHAVE
existe — não há "esquecido" pra distinguir de "nenhum".

## Artefatos que não passam por aqui

Dois tipos de evento `artifact.*` existem no log sem estar neste registro,
porque são emitidos pela **api**, não pelo engine:

| evento | origem |
|---|---|
| `artifact.module_map` | o Arquiteto, via caso de uso na api |
| `artifact.insight` | análise, via caso de uso na api |
| `artifact.project_image` | o Arquiteto, via caso de uso na api ([ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md), [RN-105](../business-rules.md#rn-105)) |

Eles têm as próprias validações no domínio da api. A assimetria é histórica, e
está anotada como
[dívida técnica](../architecture.md#divida-tecnica): idealmente todo
`artifact.*` passaria por um registro só.

## Quando a validação falha

| erro | causa |
|---|---|
| `{:unknown_type, tipo}` | tipo fora dos dez |
| `{:missing_keys, [...]}` | campos obrigatórios ausentes, todos nomeados |
| `:origem_invalida` | `business_rule.origin` vazia ou não é lista |
| `{:sujeito_invalido, chaves}` | parecer com os dois sujeitos, ou com nenhum |
| `{:veredito_invalido, valor}` | veredito fora de `approved` / `changes_requested` |
| `:invalid_payload` | payload não é um map |

A falha volta para o agente como resultado da ferramenta. Um modelo que emite
um artefato malformado recebe o erro e pode corrigir — dentro do teto de
iterações do ToolLoop.
