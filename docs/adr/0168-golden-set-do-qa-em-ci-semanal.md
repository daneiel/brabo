# 0168 — O golden-set do QA passa a rodar em CI, agendado e semanal

## Status

**Accepted.** A cadência foi decidida pelo mantenedor em 2026-09-27 (AT-149):
**semanal**. Referencia o [ADR 0123](0123-golden-set-regressao-qa-automacao.md)
(o golden-set do julgamento semântico do QA, nascido manual) e o
[ADR 0138](0138-golden-set-do-rag-em-ci-agendado.md) (o molde do RAG, que
declarou o do QA "inteiramente manual"). Não edita nenhum dos dois.

## Context

O ADR 0123 deixou o golden-set do QA como `TODO(humano)` para CI, dizendo que
ligá-lo exigia "segredo de LLM de API ou infra nova (GPU)". O ADR 0138 repetiu
a frase ao separar o RAG (embedding, determinístico) do QA (chat, julgamento).
Duas medições mudaram o quadro, e as duas estão em
[`docs/explanation/gates.md`](../explanation/gates.md):

- **AT-067 (2026-09-13):** num `ubuntu-latest` sem GPU, com o `qwen2.5-coder`
  puxado no Ollama do próprio job, o relógio cabe (19–23 min de
  `mix golden_set.qa`). A metade "infra nova" caiu. Mas o placar era 0/6 por
  construção: desde a [RN-502](../business-rules.md#rn-502) o `npm test` de um
  projeto `container` sem container `running` é recusado, e o seed nunca subia
  um.
- **AT-076 (2026-09-27):** o seed passou a subir o container pelo caminho de
  produção (`container_start` proposto e aprovado, broker, máquina de estados),
  sem tocar a RN-502. Duas rodadas em CI: 3/6 e 3/6 contra o piso de 1/6,
  52 e 86 min de job.

Com o instrumento medindo, o que faltava era a cadência.

A rodada de prova deste workflow (run 36327281774, gatilho temporário de
`push`, removido antes do PR) deu 3/6 outra vez, por outro conjunto de casos,
com zero recusas da RN-502, em 13 min 41 s de job — nenhum caso repetiu
comando até o teto desta vez. O tempo vai de 14 a 86 min entre rodadas.

## Decision

**`.github/workflows/golden-set-qa.yml`, separado de `ci.yml` e do RAG,
`schedule` semanal + `workflow_dispatch`, nunca `pull_request`.** O mesmo
argumento do ADR 0138: `ci.yml` é só `pull_request`, e um golden-set que julga
com um modelo de chat não fica no caminho do merge. Sábado, 01:17 UTC: fora da
janela diária do RAG (06:00), do domingo das provas de propriedade (04:00) e da
segunda do check de links (06:00); sábado para o vermelho esperar a semana
começar; o minuto 17 porque o `schedule` do Actions atrasa e pode descartar
disparos no topo da hora.

**Semanal e não noturno.** O do RAG custa ~20 min e é determinístico: uma
regressão de ontem é uma regressão. Este custa 52–86 min medidos e VARIA — as
duas rodadas da AT-076 deram o mesmo total com casos diferentes. Uma rodada por
dia gastaria horas de runner por semana para ler o mesmo sinal de tendência
com mais ruído; uma por semana é o que o piso (ratchet) precisa para acusar uma
queda, e o `workflow_dispatch` cobre quem mexeu no prompt do QA e quer a
resposta na hora.

**`timeout-minutes: 150`.** O maior job medido levou 86 min; a variância é do
modelo (um caso repetiu `npm test` 30 vezes antes de terminar
`blocked(modelo)`). 150 cobre uma rodada em que mais de um caso esbarra no teto
de iterações sem virar vermelho por relógio, que não é o que o job mede.

**O veredito é o do teste.** O ExUnit reprova quando os acertos ficam abaixo do
`passRate` de `floor.json` para o modelo, e quando a api responde mas o seed
falha. O workflow acrescenta duas guardas de instrumento, nenhuma de
julgamento: a linha de placar precisa existir (o teste PULA quando a api não
responde, e pular numa rodada agendada é verde que não mediu), e o event log
não pode ter recusa da RN-502 (a assinatura conhecida da AT-067). Em falha,
faz o que o do RAG faz: imprime os logs. Não abre issue.

**Api, engine e broker nativos no runner, e o socket do Docker só no broker.**
É o desenho medido na AT-076. A mesma pasta gerenciada nos três lados, porque
api e engine rodam no host (`PROJECT_WORKSPACES_ROOT` =
`PROJECT_WORKSPACES_HOST_ROOT`). A imagem dos casos é puxada antes do seed, e a
referência vem do próprio seed (`IMAGEM_DO_GOLDEN_SET_QA`, presa por digest do
índice), não de um segundo literal no workflow: o `docker run` do broker roda
sob o teto de controle de 30 s da porta de Docker
([RN-604](../business-rules.md#rn-604)), e uma divergência entre o que o job
puxa e o que o seed pede poria o pull dentro desse teto.

## Consequences

**O `TODO(humano)` do ADR 0123 para CI fecha.** O que segue com dono humano é o
que o próprio ADR 0123 já dizia: o piso (`floor.json`) só é escrito por humano,
depois de medir. Este ADR não o mexe, nem o modelo.

**Nenhum gate muda.** O golden-set do QA não tem gate próprio no registro
(`docs/gates.yml`); ele é sinal de tendência do passo semântico de
`qa-verificada`, e um job agendado não trava merge nenhum.

**O broker do CI não tem as cinco camadas do compose.** Num runner efêmero não
há rede `internal` nem porta fechada: o que resta de contenção é o que o broker
ACEITA (cinco operações, spec computada pela api a partir do artefato). O
runner é descartado ao fim do job e não guarda segredo nenhum deste workflow
(`permissions: contents: read`, token de serviço literal de CI).

**Declarado, não corrigido aqui:** o heartbeat do engine fecha as sessões do
seed (`heartbeat_timeout`) ~30 s depois de criadas, enquanto o QA segue
propondo comandos nelas (ele roda no processo do `mix`, fora de sessão), sem
efeito visível no placar da AT-076. E `pull_request` que mexe neste workflow
não o executa — verde no PR não é prova; a prova é o `workflow_dispatch` ou o
primeiro sábado.
