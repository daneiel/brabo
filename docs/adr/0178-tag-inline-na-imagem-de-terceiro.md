# 0178 — A tag da imagem de terceiro mora DENTRO da referência, antes do digest

## Status

**Accepted.** 2026-09-29 (AT-139, história HS-024, épico EP-016). Sobre o
[ADR 0159](0159-imagem-de-terceiro-por-digest.md), que continua valendo em
tudo o que não é a FORMA da referência: digest do índice, as três árvores, o
que o check não cobre e por quê. Decisão do mantenedor de 2026-09-27, escrita na
nota da AT-139, que a chamava de "ADR 0171" — número que ficou reservado e nunca
foi escrito; **este ADR é aquele**, e o 0171 continua vago.

A decisão tinha duas metades. Este ADR registra a que entrou — a forma e o lint
— e declara por que a outra, ligar o Dependabot para imagens, **não** entrou
(ver *O que este ADR NÃO faz*).

## Context

O ADR 0159 prendeu as 39 referências de imagem de terceiro por digest, com a tag
num comentário ao lado (`neo4j@sha256:…  # 5.26-community`; em Dockerfile, na
linha de cima), espelhando a forma das actions (`uses: x@<sha>  # v4`). E
declarou o preço: digest congela, e *"ligar o ecossistema `docker` do Dependabot
é decisão à parte"*.

A decisão veio em 2026-09-27 — Dependabot `docker` — com uma condição: medir
antes se os PRs dele passam no lint de pin. A medição (lane da rodada 15, que
parou no portão, sem PR) derrubou a forma do ADR 0159:

- **O Dependabot não lê a tag em comentário, em formato nenhum.** O comentário
  que o `github-actions` dele lê é convenção DAQUELE ecossistema; o `docker`
  não tem equivalente.
- **Pin só de digest é atualizado para o digest da `latest`**
  (`update_checker.rb`). pgvector, neo4j e node iriam para outra major, com o
  comentário ainda afirmando a tag antiga e o lint VERDE — o check conferia a
  presença do comentário, não a verdade dele.
- **As duplicatas compose × workflow** (pgvector e ollama nos `services:` de
  `ci.yml`/`golden-set-*.yml`) fariam todo PR do bot nascer vermelho pela regra
  "mesma tag, dois digests" do próprio ADR 0159: nenhum ecossistema lê
  `services:` de workflow.
- O `imageName` do CloudNativePG também fica fora de qualquer ecossistema.

E havia no repositório uma referência que já tinha a outra forma, por outro
motivo: o `imageName` do CNPG é `postgresql:16.10@sha256:…` porque o webhook do
operador RECUSA referência só com digest — lê da tag a versão do Postgres. Ou
seja, a forma `imagem:tag@sha256:` já estava provada no repositório pelo
Kubernetes, pelo `kubeconform` e pelo bootstrap do k3d.

## Decision

**1. A referência de imagem de terceiro passa a ser `imagem:tag@sha256:<índice>`.**

```yaml
image: neo4j:5.26-community@sha256:22ec5cd0…
```

```dockerfile
FROM node:24.11.1-alpine3.21@sha256:b8f7c905… AS deps
```

Com os dois presentes, o Docker puxa pelo digest: a tag é informação para quem
lê, e o digest decide os bytes — a imutabilidade do ADR 0159 fica intacta. O que
muda é que a tag agora é lida pela MESMA sintaxe por quem executa (Docker), por
quem atualiza (Dependabot) e por quem revisa. O digest continua sendo o do
ÍNDICE, nunca o de uma plataforma.

As 39 referências das três árvores migraram sem trocar nenhum digest — 29 em
`docker/` (16 em compose, 13 `FROM`), 4 em `deploy/k8s/` e 6 em
`.github/workflows/`. Os comentários de tag saíram: a referência é a fonte, e
um comentário igual seria uma segunda cópia para envelhecer.

**2. O lint deriva a tag da referência e reprova o que a contradiz.**
`scripts/ci/imagens-pinadas.ts` reprova, além da referência mutável:

- **digest sem tag inline** — inclusive a forma do ADR 0159, com a tag só no
  comentário, porque é a que o bot atualizaria para a `latest`;
- **comentário que afirma outra tag** — um comentário que é UM token com dígito
  (`# 5.26-community`, `# pg16`) e diverge da tag inline. Comentário continua
  permitido (a decisão diz "comentário fora ou igual"); o que reprova é o que
  sobra de uma subida de versão. Prosa e palavra solta sem dígito não afirmam
  versão e não são julgadas;
- **comentário no fim da linha do `FROM`** — continua reprovado, agora com
  motivo próprio: o parser do Docker não o aceita (ADR 0159);
- **a mesma tag com dois digests** — a chave passa a ser `nome:tag` lida da
  referência.

Cada regra está provada por mutação no `imagens-pinadas.spec.ts`: desligar
qualquer uma das cinco derruba pelo menos um teste.

## Consequences

**A forma do ADR 0159 passa a reprovar.** Quem copiar um exemplo antigo (do ADR
0159, de um PR velho) recebe a mensagem que manda pôr a tag inline, com o
porquê. O runbook (*Bumping a third-party image*), a página de cadeia de
suprimentos e o `CLAUDE.md` passam a mostrar só a forma nova.

**O comentário deixa de ser obrigatório**, e isso é a inversão do argumento do
ADR 0159, não um afrouxamento: lá ele era obrigatório porque era o ÚNICO lugar
da tag; aqui a tag está na referência, e o que o check exige é que ela exista
e que nada ao lado a contradiga.

**Nada muda de versão.** Todo digest é o mesmo de antes; `docker build --check`
passa nos nove Dockerfiles, um build real (`docker/backup/Dockerfile.prod`)
completa, `docker compose config` passa nos composes tocados e
`kubectl kustomize` + `kubeconform` nos overlays.

## O que este ADR NÃO faz

**Não liga o Dependabot para imagens**, e a razão é um bloqueio que a decisão de
27/09 não cobria. A decisão pedia *"um passo que alinha os `services:` dos
workflows no PR do bot"*, no molde de `dependabot-justifica-pin.ts`. Esse passo
teria de EMPURRAR um commit que altera `.github/workflows/*.yml` para a branch do
bot, e o `GITHUB_TOKEN` não pode fazer isso: ele não tem, nem pode receber por
`permissions:`, a permissão `workflows`, e o GitHub recusa o push
(*"refusing to allow a GitHub App to create or update workflow … without
`workflows` permission"*). Documentado pela comunidade do GitHub e não medido
aqui por execução. Há um segundo custo, este já conhecido no repositório: push
feito pelo `GITHUB_TOKEN` não dispara workflow, então o commit de alinhamento
ficaria sem checks até um humano refazer o gatilho.

Ligar o `docker`/`docker-compose` sem o passo faria nascer vermelho todo PR do
bot que toque pgvector ou ollama. Os caminhos que existem — e que são decisão do
mantenedor, não deste ADR — estão no relatório da AT-139: uma credencial com
`workflows` (GitHub App ou token) só para esse passo; tirar o literal dos
workflows (o `image:` de um `services:` aceita o contexto `needs`, e um job
anterior o leria do compose — duplicata que não existe não diverge); o passo
apenas DIAGNOSTICAR e um humano aplicar; ou `ignore` do bot para as duas imagens
duplicadas. Até lá, subir digest é o procedimento do runbook.

**Não estende o `dependabot-justifica-pin.ts` a pin de imagem.** Um PR do bot
que toque `docker/**` esbarraria no drift (`config-e-inferencia`, `block`), e a
decisão da AT-094 limitou a linha escrita pelo bot à troca de pin de ACTION.
Alargar essa classe é decisão à parte.

**Não cobre o que já estava fora**: as imagens do próprio produto, referência
interpolada, estágio de multi-stage e o `otel-collector-values.yaml` do Helm
(ADR 0159). E ficam no procedimento MANUAL, com Dependabot ou sem, as duas
imagens que moram fora das três árvores ou numa chave que nenhum ecossistema lê:
o `imageName` do CNPG e a imagem dos casos do golden-set do QA
(`IMAGEM_DO_GOLDEN_SET_QA`, uma constante TypeScript — já na forma inline).

**Não cria RN.** A regra é irmã da das actions e mora, como ela, no `CLAUDE.md`
e em `docs/explanation/cadeia-de-suprimentos-do-ci.md`.
