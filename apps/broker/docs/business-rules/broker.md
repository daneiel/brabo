---
id: rn-broker
title: 'Regras de negócio — Broker'
sidebar_label: Broker
description: 'As RNs hospedadas na raiz broker.'
keywords: [regras de negócio, broker]
---

# Broker

## A busca do RAG deixa rastro, e o rastro congela os pesos (RN-479..481)

### RN-494 — O portão da imagem (RN-105) vale nos TRÊS modos de execução {#rn-494}

**REVISA a [RN-169](api.md#rn-169) (item 1) e a
[RN-421](api.md#rn-421)**: a dispensa do portão RN-105 para projeto `mounted`/
`runner` — "esses modos não sobem container próprio, então a decisão do
Arquiteto nunca vai acontecer" — está REVOGADA. `ReadProjectCodeUseCase
.portaoDoContainer` deixa de checar `executionMode`: os TRÊS modos agora
exigem `artifact.project_image` decidido (pelo Arquiteto, `choose_project_image`,
ou pela Infra elegendo uma candidata, `container_start` — ADR 0133/RN-491)
antes de liberar as sete rotas de leitura da aba Code.

A dispensa original confundia duas perguntas: "este projeto sobe container
no SERVIDOR?" (não, em `mounted`/`runner`, e isso não muda aqui) e "faz
sentido exigir que ALGUÉM tenha decidido a imagem do projeto antes de abrir
a leitura de código?" (sim, nos três modos — a decisão é sobre o que o
projeto EXECUTA, não sobre onde o container físico sobe). Manter a dispensa
deixava a aba Code de `mounted`/`runner` abrir sem que ninguém tivesse
pensado na imagem do projeto; a regra uniforme fecha essa lacuna.

**Custo aceito, com todas as letras**: todo projeto `mounted`/`runner`
EXISTENTE sem `artifact.project_image` decidido — inclusive projetos reais
de dogfooding como `exp001`/`exp002` — PERDE acesso à aba Code no instante
em que este PR é deployado, até que o Arquiteto (ou a Infra) decida uma
imagem para ele. Essa é uma AÇÃO DO OPERADOR exigida depois do deploy, não
uma correção transparente — por isso a branch nasce `breaking/`, e a versão
sobe MAJOR.

**O ciclo de vida (`project_containers`) também para de recusar por modo**:
`RegistrarTransicaoDeContainerUseCase` não responde mais 400 para
`mounted`/`runner` — a tabela pode registrar linha para os três modos, o
mesmo funil de `provisioning` (que já lia a decisão de imagem, agora exigida
também para eles). O que continua IMPOSSÍVEL para `mounted`/`runner` é
chegar em `running` DE VERDADE: isso é aplicado num lugar só,
`ContainerBrokerPort.start()`, que recusa
(`ModoDeExecucaoNaoSuportadoError`, política deliberada — o broker, no
servidor, não enxerga a pasta do usuário onde o código de `mounted`/
`runner` mora) — e `ExecuteContainerStartUseCase` já trata essa recusa
como falha normal (`container.start_failed`, motivo nomeado), nunca crash,
nunca silêncio. Na prática, pelo caminho normal (aprovação de
`container_start`), NENHUMA linha chega a nascer em `project_containers`
para esses dois modos, porque o broker recusa ANTES de qualquer transição
ser chamada. Duplicar essa checagem de modo em `propose-action.use-case.ts`
ou em `ExecuteContainerStartUseCase` foi considerado e DESCARTADO: o
broker já falha alto e nomeado, e a checagem duplicada só criaria um
segundo lugar para divergir do primeiro — mesmo raciocínio do comentário de
`ModoDeExecucaoNaoSuportadoError` (`apps/broker/src/operacoes.ts`), que já
apontava para este PR.

O lado web deixa de tratar `mounted`/`runner` como caso à parte:
`ProjectCodeTab` perguntava o modo do projeto e abria o shell direto,
sem sequer chamar `GET /projects/:id/container`, quando o modo não era
`container`. Isso SIMPLIFICOU o componente — os três modos agora seguem o
mesmo caminho de `useQuery`/estados (carregando, erro, `sem_decisao`,
decidido), sem `modoLocal` nem `enabled` condicional por modo.

- **Onde:** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`portaoDoContainer`, dispensa removida),
  `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
  (400 por modo removido), `apps/api/src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
  (comentário de ordenação corrigido), `apps/web/src/routes/ProjectCodeTab.tsx`
  (gate uniforme, `modoLocal` removido)
- **Teste:**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (bloco "o portão do container": `mounted`/`runner` respondem 409 sem
  decisão e leem normalmente decididos),
  `apps/api/test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  (`mounted`/`runner` registram `provisioning` em vez de 400),
  `apps/web/src/routes/ProjectCodeTab.test.tsx` (os três modos tratados
  igual)
- **Decisão arquitetural:** [ADR 0135](../adr/0135-portao-de-imagem-nos-tres-modos.md)
- **Origem:** plano do dono do produto, Parte 1 / PR 1.7 — decisão #5 do
  plano original ("Portão RN-105 passa a valer nos TRÊS modos"), já aceita
  antes deste PR existir
