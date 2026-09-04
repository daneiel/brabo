# 0138 — O golden-set do RAG passa a rodar em CI, agendado — e continua `warn`

## Context

O [ADR 0132](0132-golden-set-de-acerto-do-rag.md) (Etapa 2 do programa de RAG
mensurável) fechou com uma Consequência declarada:

> **CI wiring é `TODO(humano)`, igual ao QA.** Sem segredo de LLM de API ou
> infra nova (Ollama de verdade em CI), o golden-set roda MANUAL —
> `mix golden_set.rag` — e nunca em `mix test` normal.

E o gate `rag-acertivo` (`docs/gates.yml`) nasceu `severidade: warn`, com o
comentário dizendo exatamente por quê: "não há CI com LLM... `block`
prometeria um travamento automático que não existe".

Esta é a Etapa 3, decidida pelo dono do produto nesta sessão: **ligar o
golden-set do RAG em CI**. A pergunta que ainda era aberta — todo PR ou
agendado — foi decidida também nesta sessão: **agendado**, dado o custo de
puxar `nomic-embed-text` (~274MB) e rodar a busca de verdade contra o corpus
curado (alguns minutos) em toda janela de CI. O golden-set do QA
([ADR 0123](0123-golden-set-regressao-qa-automacao.md)) **não muda nada
aqui** — continua exatamente `TODO(humano)`, pelo motivo que a seção
seguinte torna preciso.

### Por que o do RAG é tratável e o do QA continua não sendo

O `TODO(humano)` do ADR 0123 lista a alternativa que faltava: "um runner com
GPU, um passo de pull do Ollama". Essa frase esconde uma diferença que
importa: o golden-set do QA chama um modelo de **chat** fazendo
**julgamento** — caro, mede algo inerentemente não-determinístico (o próprio
ADR 0123 registra rodadas reais com `qwen2.5-coder:latest` variando 1 a 5
acertos em 6, entre execuções). O golden-set do RAG só chama o modelo de
**embedding** (`nomic-embed-text`, ~137M parâmetros) — CPU é suficiente,
sem GPU, e embedding não amostra: a mesma entrada produz o mesmo vetor
sempre. `ubuntu-latest`, sem GPU nenhuma, é infraestrutura suficiente para
este golden-set — não seria para o do QA.

### O obstáculo que não existia: nenhum segredo precisa ser gerado

`apps/api/scripts/seed-golden-set-rag.ts` abre seu próprio
`NestFactory.createApplicationContext(AppModule)` — nunca fala com uma api
já rodando como servidor. Os quatro segredos que a api recusaria com
literal de exemplo em produção (`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`,
`CREDENTIALS_MASTER_KEY`, `GIT_OAUTH_STATE_SECRET` — RN-114,
[ADR 0059](0059-segredo-do-state-de-oauth-sem-default.md)) só são
checados quando `NODE_ENV === 'production'`
(`apps/api/src/infrastructure/security/{oauth-state-secret,auth-key-material,service-token}.ts`,
`envelope-encryption.service.ts`). O script nunca define `NODE_ENV` — nem
ele, nem `mix golden_set.rag`, que o invoca via `System.cmd` — então os
quatro caem no ramo de desenvolvimento e usam o literal de dev sem
reclamar. Diferente de `docker/smoke.sh`, que sobe
`docker-compose.prod.yml` com `NODE_ENV=production` DE PROPÓSITO e por isso
precisa gerar os quatro com `openssl rand` — este workflow não precisa de
segredo nenhum gerado.

## Decision

**Workflow novo, separado de `ci.yml`.** `.github/workflows/ci.yml` é
deliberadamente só `pull_request` (comentário no topo do próprio arquivo):
misturar `schedule` ali afetaria todo job existente, sem filtro por job.
`.github/workflows/golden-set-rag.yml` nasce com `schedule` (cron diário) +
`workflow_dispatch` (roda sob demanda — útil pra validar esta própria
mudança e pra depois de calibrar peso/limiar da busca, ADR 0080, ou o
corpus curado).

**`services: postgres` + `services: ollama`, mesmas versões pinadas do
resto do produto.** `pgvector/pgvector:pg16` (mesmo do `test-engine` de
`ci.yml`) e `ollama/ollama:0.33.1` — a MESMA versão pinada de
`docker/docker-compose.yml`. A paridade de versão do Ollama é o que faz
`test/fixtures/golden_set_rag/floor.json` (chaveado por MODELO, não por
ambiente) continuar válido rodando em CI: um Ollama diferente do que gerou
o piso local poderia produzir embeddings sutilmente diferentes e mudar
rank de caso limítrofe, sem que isso fosse regressão de verdade.

**Health-check do Ollama usa `ollama list`, não `curl`.** `--health-cmd`
roda DENTRO do container de serviço, e a imagem oficial não garante ter
`curl` — só garante ter o próprio binário `ollama`. `docker/ollama/pull-models.sh`
(a lógica de referência, já validada com download real de modelo) usa
exatamente esse padrão de espera (`until ollama list >/dev/null 2>&1`);
este workflow reusa o mesmo comando como health-cmd em vez de inventar um
novo mecanismo de espera.

**O modelo é puxado por uma chamada HTTP direta, `POST /api/pull`, do lado
do RUNNER (não de dentro do container).** `curl` no runner `ubuntu-latest`
é garantido (já usado em vários passos de `ci.yml` pra baixar binário de
gate). `stream:false` faz a chamada bloquear até completar e devolver o
JSON final — sem loop de polling. É o MESMO endpoint que o binário
`ollama pull` chama por baixo (`docker/ollama/pull-models.sh` documenta
isso: "a CLI `ollama` usa HTTP contra `${OLLAMA_HOST}/api/*`"), só sem
passar pelo wrapper da CLI, que não está instalada no runner.

**Migração explícita antes do seed.** `main.ts`/`app.module.ts` não
migram nada sozinhos no boot — confirmado lendo `apps/api/src/db/migrate.ts`,
script separado. O job roda `pnpm --filter api db:migrate` antes de
`mix golden_set.rag`.

**`docs/gates.yml`: `rag-acertivo` continua `severidade: warn`.**
Deliberado, não esquecido — ver Consequences. `evidencia.tipo` muda de
`teste` para `ci` (mesmo formato do gate `backmerge`), com `workflow`
apontando para o novo arquivo.

## Consequences

**`warn` continua `warn` — por decisão de cadência, não por limitação
técnica, e essa diferença é o que este ADR muda em relação ao 0132.** O
gate ROLDA de verdade em CI agora; o que não existe é PR bloqueado por
ele. Uma regressão de acerto de busca aparece até 24h depois de mergeada
(ou na hora, via `workflow_dispatch` manual), nunca na hora do PR —
trade-off aceito explicitamente pelo dono do produto, dado o custo de
~3-6min por execução (pull do modelo + indexação + 17 buscas) que rodar em
todo PR imporia.

**O golden-set do QA (ADR 0123) não muda em nada aqui.** Continua
inteiramente manual, `TODO(humano)` — a assimetria (embedding CPU
determinístico vs. julgamento de chat caro e não-determinístico) é
deliberada e explicada acima, não uma inconsistência a corrigir depois.

**A lacuna do corpus curado continua aberta.** As 17 perguntas seguem
medindo retrieval sobre os mesmos 22 arquivos curados do ADR 0132, não os
+130 ADRs reais — esta etapa liga o MECANISMO em CI, não amplia o que ele
mede. Ampliar o corpus continua decisão de custo de embedding numa rodada
manual, declarada separadamente.

**Risco novo, e onde ele mora.** A lógica de negócio (script de seed,
critério de acerto, teste ExUnit) já estava provada — 17/17, duas vezes,
segundo o ADR 0132. O que é genuinamente novo aqui é a ORQUESTRAÇÃO do
workflow (dois serviços, ordem dos passos, pull do modelo por HTTP direto),
que não há como testar de ponta a ponta fora do GitHub Actions de verdade.
Recomendado ao usuário: disparar um `workflow_dispatch` manual assim que
este PR mergear, pra confirmar o job verde antes de esperar a primeira
janela agendada.
