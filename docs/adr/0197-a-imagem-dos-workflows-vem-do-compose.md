# 0197 — A imagem dos workflows vem do compose, e o Dependabot de imagem é ligado

## Status

**Accepted.** 2026-10-01 (AT-246, história HS-024, épico EP-016, rodada 36;
decisão do dono em 01/10: *"tirar o literal dos workflows"* — o `image:` dos
`services:` passa a vir de um job anterior que lê o compose, uma fonte só de
digest, e o Dependabot `docker`/`docker-compose` é ligado). Sobre o
[ADR 0159](0159-imagem-de-terceiro-por-digest.md) (imagem de terceiro por
digest do índice) e o [ADR 0178](0178-tag-inline-na-imagem-de-terceiro.md) (a
tag dentro da referência), sem editá-los: os dois continuam valendo em tudo;
este fecha a metade que o 0178 declarou NÃO feita em *"O que este ADR NÃO faz"*.

## Context

O ADR 0178 pôs a tag dentro da referência — a forma que o Dependabot lê — e
deixou o Dependabot de imagem desligado por UM bloqueio: `pgvector` e `ollama`
moravam duas vezes, no compose e como literal nos `services:` dos workflows.
Nenhum ecossistema lê `services:` de workflow, então todo PR do bot que subisse
uma das duas no compose nasceria vermelho pela regra "mesma tag, dois digests"
de `scripts/ci/imagens-pinadas.ts`; e o passo que alinharia o workflow no PR
do bot teria de empurrar commit em `.github/workflows/`, que o `GITHUB_TOKEN`
não pode, nem por `permissions:`. O ADR listou quatro saídas; o dono escolheu
a segunda.

Medido em `origin/dev` (d89f77714e) antes de mudar — todo `image:` de
terceiro em `.github/workflows/`, e de onde cada um deveria ler:

| workflow | job → serviço | imagem | lê de |
|---|---|---|---|
| `ci.yml` | `test-api-shard` → `postgres` | `pgvector/pgvector:pg16@sha256:ccc6e83d…` | serviço `postgres` de `docker/docker-compose.yml` |
| `ci.yml` | `test-engine` → `postgres` | idem | idem |
| `golden-set-rag.yml` | `golden-set-rag` → `postgres` | idem | idem |
| `golden-set-rag.yml` | `golden-set-rag` → `ollama` | `ollama/ollama:0.33.1@sha256:075246f7…` | serviço `ollama` de `docker/docker-compose.yml` |
| `golden-set-qa.yml` | `golden-set-qa` → `postgres` | pgvector, idem | serviço `postgres` |
| `golden-set-qa.yml` | `golden-set-qa` → `ollama` | ollama, idem | serviço `ollama` |

Seis literais, duas imagens, todos com o mesmo digest do compose de DEV. Nenhum
`container:` de job e nenhum outro `image:` nos workflows. O compose de dev, e
não o de produção ou o de instalação, é a fonte certa pelas duas razões que já
existiam: é contra ele que as suítes de api e engine rodam em dev, e é ele que
o `golden-set-rag.yml` prometia acompanhar (o piso do golden-set é chaveado
por MODELO, não por ambiente). Os três composes carregam hoje o mesmo digest, e
o lint garante que continuem.

E o lint tinha um ponto cego que a forma nova abriria se ninguém olhasse: o
padrão de `image:` era `(\S+)`, e uma linha com expressão (`${{ … }}`, que tem
espaço) NÃO casava — sumia do check em vez de ser julgada. Pior: o que casava
com `$` era tratado como interpolação e pulado. `image: ${{ 'postgres:16' }}`
passaria verde.

## Decision

**1. Os `services:` dos workflows leem a imagem do compose.** Um workflow
reutilizável novo, `.github/workflows/imagens-do-compose.yml` (só
`workflow_call`), roda `scripts/ci/imagens-do-compose.ts`, que lê o `image:`
filho direto de cada serviço listado em `IMAGENS_DOS_WORKFLOWS` e o devolve como
`output`. Quem chama faz:

```yaml
jobs:
  imagens:
    uses: ./.github/workflows/imagens-do-compose.yml
  test-engine:
    needs: imagens
    if: ${{ !cancelled() }}
    services:
      postgres:
        image: ${{ needs.imagens.outputs.pgvector }}
```

O script RECUSA serviço inexistente ou sem `image:` (renomear no compose derruba
o CI na hora, em vez de entregar string vazia) e referência fora da forma
`imagem:tag@sha256:<índice>` — segunda porta, porque o job que lê não pode
depender de o `lint` ter rodado antes. Sem `pnpm install`: o script só usa
`node:fs`, com checkout esparso de `docker/` e `scripts/ci/`.

Reutilizável e não um job copiado em cada arquivo: são três chamadores, e três
cópias do mesmo checkout + setup seriam a duplicata que este ADR existe para
remover, um nível acima.

**2. O lint entende a forma nova e fecha a porta que ela abre.** Num arquivo de
`.github/workflows/`, `imagens-pinadas.ts` passa a ler `image:` e a forma curta
`container: <imagem>` com um padrão que aceita espaço, e reprova:

- **`literal no workflow`** — qualquer referência de terceiro literal, MESMO
  presa por digest: é a duplicata que nenhum ecossistema lê;
- **`expressão de imagem fora da forma`** — tudo que não for EXATAMENTE
  `${{ needs.<job>.outputs.<imagem> }}`: literal dentro da expressão, `||`
  com valor padrão (antes ou depois da saída), `env.`, `vars.`, `format()`,
  sufixo depois do `}}`, expressão sem fecho;
- **`imagem do workflow fora do compose`** — `needs.<job>` cujo job não chama
  `./.github/workflows/imagens-do-compose.yml`, ou output que ele não declara.

Imagem do próprio produto (`brabo-*`) continua fora, como nas outras árvores.
Cada regra está provada por MUTAÇÃO em `imagens-pinadas.spec.ts`: desligar o
literal, afrouxar a forma da expressão, não conferir o job, não conferir o
output, ignorar o resto depois do `}}` ou voltar o padrão a `\S+` — cada
mutação derruba pelo menos um teste (medido: 4, 1, 2, 1, 1 e 12). E
`imagens-do-compose.spec.ts` amarra o reutilizável à tabela: as saídas
declaradas são EXATAMENTE as chaves de `IMAGENS_DOS_WORKFLOWS`, cada uma ligada
ao passo que roda o script — um output no meio com literal reprova.

**3. O Dependabot de imagem é ligado** em `.github/dependabot.yml`, com
`target-branch: dev` como os outros:

- `docker-compose` em `/docker` — os cinco composes moram ali, então uma subida
  atualiza dev, produção e instalação no MESMO PR;
- `docker` em `/docker/*` (os `FROM`, uma pasta por imagem) e `/deploy/k8s/**`
  (os manifests). NUNCA `/docker` sem o `/*`: o ecossistema `docker` também lê
  YAML com `image:` (é como ele cobre Kubernetes — o `YAML_REGEXP` do
  `shared_file_fetcher.rb` do dependabot-core, lido em 01/10), e leria os
  composes, abrindo um segundo PR para a mesma imagem;
- cada ecossistema com UM grupo (`patterns: ['*']`): `node:24-alpine` mora em
  três Dockerfiles de dev e `node:24.21.0-alpine3.23` em três de produção, cada
  um numa pasta, e sem grupo seriam três PRs com a mesma tag e digests
  diferentes — vermelhos pela regra;
- `ignore` para `brabo-*` (e `ghcr.io/*/brabo-*`): as imagens que este
  repositório constrói não têm registry de terceiro onde procurar.

**4. A promessa do `golden-set-rag.yml` vira construção.** Ele dizia, em
comentário, rodar "a MESMA versão pinada de docker/docker-compose.yml". Desde o
ADR 0159 o lint VERIFICAVA isso pela regra "mesma tag, dois digests"; agora não
há o que verificar, porque não há segunda cópia: o Ollama do golden-set é, por
construção, a referência do serviço `ollama` do compose de dev. O mesmo vale
para o `golden-set-qa.yml` e para o Postgres das suítes do `ci.yml`.

## Consequences

**O PR do bot só toca o compose, e o CI daquele PR já roda contra a imagem
nova** — o `services:` lê o compose do próprio PR. Não há passo de alinhamento,
nem credencial com `workflows`, nem push do `GITHUB_TOKEN` sem checks.

**Dois jobs exigidos ganham uma dependência, e não podem virar `skipped`.**
`Testes do engine (ExUnit)` (check exigido) e os shards de api esperam o job
`imagens`. O padrão do GitHub PULARIA o job se `imagens` falhasse, e `skipped`
conta como verde para check exigido — a mesma armadilha que o agregador de api
já evita com `if: always()`. Por isso os dois levam `if: ${{ !cancelled() }}`:
com `imagens` vermelho, o job roda, recebe imagem vazia e reprova. O job novo
(`imagens / Ler as imagens do compose`) NÃO entra em ruleset. Custo medido em
tempo: nenhum medido ainda — é um checkout esparso e um `setup-node` sem
cache, rodando em paralelo com o `lint`; `TODO(humano)` no primeiro run.

**Serviço novo de workflow tem caminho único**: imagem no compose, linha em
`IMAGENS_DOS_WORKFLOWS`, output no reutilizável (o spec reprova se divergirem),
`needs: imagens` no workflow. O runbook (*Bumping a third-party image*) diz isso.

**A contagem do lint cai de 39 para 33** referências literais: as seis dos
workflows deixaram de existir, e a frase de `cadeia-de-suprimentos-do-ci.md`
que a `contagens-do-codigo.mjs` confere acompanha.

## O que este ADR NÃO faz

**Não resolve a duplicata ENTRE ecossistemas.** `neo4j:5.26-community` e
`ollama/ollama:0.33.1` moram também em `deploy/k8s/base/` (`neo4j/statefulset.yaml`,
`ollama/job-model-loader.yaml`), que é do ecossistema `docker`, enquanto os
composes são do `docker-compose` — e o Dependabot não agrupa entre
ecossistemas. Duas consequências, declaradas:

- quando o bot sobe a TAG (o caso comum), saem dois PRs verdes, cada um num
  lugar; até os dois entrarem, compose e cluster rodam versões diferentes — e o
  lint não reprova tags diferentes, só a mesma tag com digests diferentes;
- quando o registry RE-PUBLICA a mesma tag com outro digest (`5.26-community` é
  tag que anda), os dois PRs nascem vermelhos pela regra "mesma tag, dois
  digests", e quem revisa junta as duas subidas num PR só (o procedimento do
  runbook). O mesmo destino é o do digest re-publicado de `node:24-alpine` se
  ele um dia morar num compose E num Dockerfile.

Não foi resolvido aqui porque toda saída é decisão de produto, não deste ADR:
derivar o manifest do compose (um transformador do kustomize ainda guarda
literal), tirar o compose do `docker-compose` e dá-lo ao `docker` (que também
lê YAML, não medido para compose) ou relaxar a regra entre árvores (o que a
regra protege — dev e cluster rodando os mesmos bytes sob a mesma tag — é real).

**Não mede o Dependabot rodando.** Nenhum PR do bot de imagem existe ainda.
Não medido por execução: o `docker-compose` aceitar os cinco nomes de arquivo
(`docker-compose.<sufixo>.yml`) e ignorar as referências interpoladas
(`${BRABO_API_IMAGE:?…}`); o agrupamento por `directories` produzir UM PR entre
pastas. O primeiro PR do bot é a prova, e o que ele contradisser volta aqui num
ADR novo.

**Não estende o `dependabot-justifica-pin.ts` a pin de imagem.** O PR do bot
toca `docker/**`, e o drift (`config-e-inferencia`, `block`) vai pedir
`docs-not-needed:` a um humano — a decisão da AT-094 limitou a linha escrita
pelo bot à troca de pin de ACTION, e o ADR 0178 já declarou isso.

**Não cobre o que já estava fora.** Ficam no procedimento MANUAL do runbook, com
Dependabot ou sem: o `imageName` do CloudNativePG (chave que nenhum ecossistema
lê) e a `IMAGEM_DO_GOLDEN_SET_QA` (constante TypeScript lida pelo
`golden-set-qa.yml` por `sed`). As imagens do produto, referência interpolada
e estágio de multi-stage seguem fora do lint (ADR 0159).

**Não cria RN.** A regra de imagem não tem RN, pelo mesmo motivo das actions:
mora no `CLAUDE.md` e em `docs/explanation/cadeia-de-suprimentos-do-ci.md`.
