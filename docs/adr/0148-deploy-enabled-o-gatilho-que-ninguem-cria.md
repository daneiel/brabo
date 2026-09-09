# 0148 — `DEPLOY_ENABLED`: o gatilho que dez documentos citam e nenhum cria

## Status

**Proposed.** Aguarda decisão do dono do produto sobre a Etapa B (abaixo), que
não é uma escolha de engenharia. Este documento não muda `status` de papel nem
de gate por si só.

## Context

`DEPLOY_ENABLED` é o gatilho declarado de tudo o que falta na camada de
plataforma. Ele é citado em **dez documentos**:

- [ADR 0091](0091-secops-runtime-relatorio-de-abuso.md) e
  [ADR 0092](0092-platform-relatorio-de-telemetria-sob-demanda.md), no próprio
  campo Status — *"its activation stays synchronized with `DEPLOY_ENABLED`,
  which doesn't exist"*;
- [ADR 0089](0089-analytics-e-delivery-metricas-como-relatorio.md);
- `docs/fluxo.yml`, em três lugares — `platform.ativacao` ("sincronizada com
  DEPLOY_ENABLED"), `area-infra.gate_saida` (`deployavel`, `status: planned`,
  com o comentário `# DEPLOY_ENABLED`) e os DOIS entregáveis de lacuna do
  `secops-runtime` (`resposta-a-incidente` e `postmortem-de-seguranca`, ambos
  com `motivo: exige tráfego de produção real (pós DEPLOY_ENABLED + platform
  ativo)`);
- `docs/gates.yml`, no gate `operavel` (`backlog: deploy (DEPLOY_ENABLED +
  Environments)`);
- e ainda `business-rules.md`, `backlog.md`, `modelo-de-time.md`,
  `auditoria-fluxo-vs-codigo.md`, `historico-de-fases.md` e o `CLAUDE.md`.

**No código ele aparece duas vezes, as duas como comentário** —
`apps/api/src/domain/actions/external-effect.ts:144` ("Estes não têm ação
tipada ainda (DEPLOY_ENABLED está no backlog)") e
`apps/engine/lib/engine/harness/tools/listar_metricas_de_produto.ex:185`.
Nenhuma definição, nenhuma leitura, em `apps/`, `docker/`, `deploy/`,
`scripts/`, `.env.example` ou `Makefile`.

Dez documentos apontam para um interruptor que não tem parede.

### O que fica preso nisso

| preso | onde | consequência |
|---|---|---|
| `platform` | `fluxo.yml`, `status: planned` | o dono do loop de retorno não existe; SLO, dashboard, runbook e postmortem não têm autor |
| gate `operavel` | `gates.yml:312-321`, `status: planned` | declarado, nunca avaliado |
| gate `deployavel` | `fluxo.yml:247` | **não está no registro** — ver o achado abaixo |
| `resposta-a-incidente` e `postmortem-de-seguranca` | `fluxo.yml:223-226` | os dois entregáveis de lacuna do `secops-runtime`, que é `status: active` |

### Um achado que não é sobre deploy

O gate **`deployavel` é declarado como `gate_saida` de `area-infra` em
`docs/fluxo.yml:247` e não existe em `docs/gates.yml`.** O
[ADR 0054](0054-gates-como-registro-declarativo.md) define o registro como o
lugar onde os gates que existem são declarados; um gate nomeado por uma peça do
modelo de time e ausente da outra é exatamente a inconsistência que o teste de
cruzamento entre `agent-areas.ts`, `gates.yml` e `fluxo.yml` pegaria — e esse
teste é backlog declarado no `CLAUDE.md`, não algo que exista hoje.

Isso é reparável **sem** decidir nada sobre deploy, e é a única parte deste
documento que não depende de ninguém comprar servidor.

### A tensão que ordena a decisão

Ligar a flag sem ambiente de produção com tráfego real **não** ativa os papéis:
cria gates que passam vazios. Um gate que aprova porque não tem o que reprovar
é pior que um gate declarado `planned`, porque ensina quem o lê que o loop
fechou. É a mesma razão pela qual os ADRs 0091 e 0092 recusaram criar agente e
entregaram script sob demanda — e aquela recusa continua certa.

## Decision

Duas etapas, com uma fronteira dura entre o que é engenharia e o que não é.

### Etapa A — o que é decidível hoje, e é pouco de propósito

> **O que já foi aplicado nesta entrega:** apenas o item 1. Ele conserta um
> buraco do REGISTRO e não depende da decisão sobre deploy — é a única parte
> deste documento que vale mesmo que a Etapa B nunca aconteça. Os itens 2 e 3
> descrevem o que a aceitação implica; o item 3 (a prosa dos dez documentos)
> não foi aplicado, porque mudar a redação antes da decisão seria afirmar uma
> escolha que ainda não foi feita.

1. **`deployavel` entra em `docs/gates.yml`** com `status: planned`, `dono:
   area-infra`, `severidade: warn` e `aprovacao_humana: false`, no molde exato
   do `operavel` (`gates.yml:312-321`). Fecha o buraco do registro. `warn` e
   não `block` porque a regra do registro (RN-070/RN-071) exige
   `verificacao: script` para promover, e não há script.
2. **Os dois scripts antecipados não mudam.**
   `apps/api/scripts/relatorio-telemetria.ts` e
   `apps/api/scripts/relatorio-seguranca-runtime.ts` já são `active`, já rodam
   sob demanda e já entregam o que os ADRs 0091/0092 prometeram.
3. **A prosa para de tratar `DEPLOY_ENABLED` como variável.** Onde hoje se lê
   "sincronizado com `DEPLOY_ENABLED`", passa-se a nomear o **marco** que a
   expressão sempre significou, com critério objetivo: *existe um ambiente de
   destino operado, recebendo tráfego real, cujo pipeline de entrega alguém
   mantém.*

### Etapa B — bloqueada por operador, não por código

Um ambiente de produção com tráfego. Só depois disso `platform` sai de
`planned`, `operavel` e `deployavel` deixam de ser `planned`, e os dois
entregáveis de lacuna do `secops-runtime` passam a ser possíveis.

A infraestrutura **já está pronta e não é o gargalo**: `deploy/k8s/` com
overlays `local`/`staging`/`prod`, as quatro imagens publicadas no GHCR por
digest desde o [ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md),
`make imagens-do-release`, `bootstrap.sh`, `smoke.sh`, `rollout-test.sh` e
`test-restore.sh`. O que falta é alguém **rodar e manter** — e nada disso faz
deploy sozinho.

### A alternativa considerada e recusada

**Criar `DEPLOY_ENABLED` agora, como variável de ambiente com default `false`.**
Foi o primeiro desenho, e ele se paga mal: uma variável que nenhum código lê é
a mesma promessa vazia que este ADR existe para denunciar, só que agora com
uma linha de configuração para sustentá-la. O repositório já tem a regra que
resolve isso — *capability só é declarada quando provada pela suite; sem prova,
declara-se `false` e degrada* (ADRs 0041/0042). A flag nasce no PR que tiver o
**primeiro consumidor real**, e esse PR é o da Etapa B.

O nome `DEPLOY_ENABLED` fica reservado: dez documentos já o usam, e renomear o
marco agora só trocaria a dívida de lugar.

## O que este ADR recusa explicitamente

- **Criar agente `platform` ou `secops-runtime` no engine.** Seria inventar
  autoridade sobre um loop que não fecha — a recusa dos ADRs 0091/0092,
  repetida aqui porque a pergunta volta.
- **Promover `operavel` ou `deployavel` a `block`** sem script de verificação
  (RN-070/RN-071).
- **Marcar como "não medido para sempre"** o que só depende de ambiente: MTTR e
  change failure rate continuam declarados como lacuna com motivo, não como
  impossibilidade.

## Consequences

- O registro de gates passa a conter todos os gates que o modelo de time
  nomeia — `deployavel` deixa de existir só de um lado.
- Nada muda em runtime. Nenhuma variável nova, nenhum default alterado,
  nenhum gate avaliado que não fosse antes.
- A camada de plataforma continua parada, **e agora diz honestamente por quê**:
  não falta uma flag, falta um ambiente. Quem ler `fluxo.yml` para de procurar
  no código uma variável que nunca esteve lá.
- Fica registrado que a distância entre "declarado" e "existente" já custou uma
  vez: dez documentos combinaram entre si sobre um mecanismo, e a combinação
  sobreviveu porque nada os cruzava com o código. O teste de cruzamento entre
  as três peças do modelo de time segue no backlog, e este é o segundo achado
  que ele teria pego.
