---
sidebar_position: 7
---

# Os gates, e como eles são medidos

Um **gate** é um ponto do fluxo onde o trabalho para até alguém — pessoa, agente
ou script — dizer que pode seguir. O produto tem treze, e até a FASE 15a nenhum
deles existia como lista: estavam espalhados entre regra pura, use case, teste e
workflow de CI. Responder "quais gates existem" exigia ler seis arquivos.

`docs/gates.yml` é essa lista. Este documento explica o que ela é, e — o mais
importante — o que ela **não** é.

## O registro descreve; ele não executa

Nenhum gate passa a ser aplicado por causa do arquivo. Trocar `severidade` nele
não muda comportamento nenhum: quem barra um merge continua sendo
`decide.ts`, quem julga uma PR continua sendo o agente de QA, quem reprova um
backmerge continua sendo o workflow.

É a suposição mais fácil de fazer errado, então vale repetir: **o registro é
índice, não política.** A política de branches continua morando em
[branching-policy.md](branching-policy.md); os campos `entrada` e `entregavel`
são uma frase em português, e `onde` aponta para o código que manda de verdade.

O que o registro compra é outra coisa: tornar os gates **enumeráveis**. A lição
das Fases 10 e 13 — métrica extraída por script, nunca anotada à mão — não tem
como ser aplicada ao que não dá para listar.

## Os dois campos que envelhecem se não forem definidos

**`verificacao`** responde *como se prova que este gate passou*, e não quem
julga. `script` quer dizer que existe artefato mecânico — um evento, um teste,
um job — que serve de prova. Por isso `qa-verificada` é `script` mesmo sendo um
LLM que emite o veredito: o artefato é o `pr.gate_changed` com `veredito`. Quem
julga está em `dono`.

**`aprovacao_humana: true`** quer dizer que a decisão é do usuário — direta no
clique, **ou** delegada por uma política que ele mesmo escreveu. É isso que
deixa `acao-aprovada` conviver com `status: auto_approved`: a política decidindo
sozinha é o usuário tendo decidido antes. `merge-protegida` é o caso onde nem a
delegação existe, porque o teto rebaixa `auto_approve` para `require_approval`
mesmo com autonomia ligada.

Nos quatro gates que a constituição declara manuais, esse campo é invariante e
está travado por teste ([RN-071](../business-rules.md#rn-071)).

## Três formas de evidência, porque nem toda prova está no log

| tipo | quando | o que o localizador traz |
|---|---|---|
| `event_log` | o desfecho vira evento de domínio | tipos de evento + filtro de payload |
| `teste` | a garantia é uma asserção | caminho do spec |
| `ci` | o gate vive no repositório | workflow + spec |

Os dois casos que forçaram o campo a existir:

- **`merge-protegida`** não emite evento próprio. É um teto aplicado por último
  sobre o veredito já calculado, que rebaixa `auto_approve` para
  `require_approval`; o desfecho aparece como um `proposed_action.created`
  pendente, indistinguível de qualquer outra pendência. O que garante a trava é
  o teste.
- **`backmerge`** vive fora da aplicação: é check required, com estado
  versionado em `.release/gate.json` na `main`.

Sem `evidencia`, a regra "gate `block` sem prova reprova" tornaria as duas
travas mais duras do produto vermelhas para sempre.

## A armadilha do tipo compartilhado

`qa-verificada` e `secops-segura` **não são dois tipos de evento**: os dois
gravam `pr.gate_changed`, discriminados por `payload.gate`. Pior — o mesmo tipo
é gravado na **abertura** do gate, sem `veredito`.

Um registro que guardasse só o nome do tipo contaria abertura como passagem e
mediria o dobro do que aconteceu. Daí o filtro, e daí a sentinela
`veredito: presente`. O mesmo vale para os dois gates de PR de infra, que
compartilham `infra.gate_changed`.

O teste afirma que **nenhum par (`event_types` + `filtro`) se repete** no
registro. É essa unicidade que faz a medição significar alguma coisa.

O filtro só alcança o **payload**, de propósito: aceitar coluna arbitrária no
YAML abriria a consulta inteira. Quem promoveu uma story — pessoa ou o PO — vive
na coluna `actor_kind` e fica de fora do vocabulário declarativo.

## Medir

```bash
pnpm --filter api validacao:gates                    # relatório completo
pnpm --filter api validacao:gates -- --sem-banco     # só registro e localizadores
pnpm --filter api validacao:gates -- --projeto <uuid>
```

Três fases, nesta ordem: **registro** (carrega e valida), **localizadores**
(alvo de `teste`/`ci` existe?) e **event log** (última passagem, com event id).
As duas primeiras não tocam o banco — é o que torna o script útil em CI sem
Postgres.

| saída | quando |
|---|---|
| `0` | registro válido e localizadores no lugar |
| `1` | invariante violada, alvo inexistente, ou gate sem passagem **quando `--projeto` foi dado** |
| `2` | uso inválido |

A assimetria é deliberada. Registro e localizadores são afirmações sobre o
**repositório**: valem sempre. Evidência no event log é afirmação sobre uma
**execução**, e só existe se houver uma — sem `--projeto`, a fase 3 é relatório.
Cobrar passagem num banco recém-criado faria o script sair `1` sempre, e um
script que reprova sempre vira ruído que ninguém lê.

## O que enumerar já rendeu

Antes de medir qualquer coisa, escrever a lista encontrou duas coisas que
ninguém estava vendo:

- o julgamento de QA e SecOps sobre PR de **infra**, que tem caminho próprio
  (`infra.gate_changed`, sem task de backlog por trás) e não estava na
  especificação;
- `promotion-check` é check required **sem spec própria**, ao contrário de
  `pr-police` e `approval-ladder`. A evidência dele aponta para o script, com a
  lacuna escrita ali, e o item foi para a triagem — a fase declara e mede, não
  conserta.

O terceiro achado veio da primeira execução do medidor: o filtro de
`story-promovida` apontava para `actor_kind`, que é **coluna** e não payload, e
o gate aparecia como "nunca passou" num banco onde ele tinha passado horas
antes. Um registro que ninguém roda é um registro que mente.

## Referências

- [ADR 0054](../adr/0054-gates-como-registro-declarativo.md) — a decisão
- [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md) — a decisão no
  event log, sem a qual não haveria o que medir
- [RN-070](../business-rules.md#rn-070), [RN-071](../business-rules.md#rn-071)
