---
id: cadeia-de-suprimentos-do-ci
title: A cadeia de suprimentos do CI
sidebar_label: Cadeia de suprimentos do CI
description: O que roda dentro dos nossos runners de CI que não fomos nós que escrevemos, como isso é pinado, e o que ainda é aceito na confiança.
---

# A cadeia de suprimentos do CI

Todo job deste repositório roda código de terceiros numa máquina que tem
um checkout do código-fonte e, nos workflows de release, credenciais do
registry GHCR, do registry npm e das próprias refs de git do repositório.
Esse código chega por dois caminhos: **GitHub Actions** (`uses:`) e
**binários baixados com `curl`** (os scanners). Nenhum dos dois é escrito
aqui, e nenhum dos dois é revisado por uma PR.

Esta página trata da parte disso que controlamos. Ela existe porque o
mecanismo morava só em comentários de workflow — um lugar onde a regra
pode ser lida mas não auditada, e onde as duas metades divergiram
exatamente por esse motivo.

## A ameaça, dita sem rodeios {#the-threat-stated-plainly}

Uma tag é um ponteiro. `actions/checkout@v4` não é uma versão, é um nome
que o dono da action pode apagar e recriar apontando para outro commit, a
qualquer momento, sem sinal nenhum neste repositório. Quem move essa tag
roda o código dele no nosso runner, no nosso checkout, com os segredos
que aquele workflow recebeu.

O mesmo vale para um `curl` de um asset de GitHub Release: uma release
comprometida, ou um MITM entre o runner e a CDN, nos entrega outro binário
e nada percebe — até o scanner não conseguir subir, ou pior, até ele
"funcionar".

Nenhuma das duas é hipótese sobre o nosso repositório especificamente. São
as duas formas documentadas de o CI ser comprometido no mundo real, e a
defesa para as duas é a mesma ideia: **referir-se ao conteúdo, não a um
nome**.

## Os dois mecanismos {#the-two-mechanisms}

### Binários: checksum depois de todo download {#binaries-checksum-after-every-download}

Todo `curl` de asset de release no `ci.yml` e nos dois Dockerfiles do
engine é seguido de `sha256sum -c` contra um hash escrito no próprio
workflow:

```yaml
GITLEAKS_SHA256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
```

Os hashes vêm do `checksums.txt` publicado com cada release, num download
independente. Uma divergência reprova o job antes de o binário ser sequer
executado.

O `propriedades.yml` (as provas de propriedade agendadas, BRB-009) segue a
mesma regra para os três binários de que precisa para subir um cluster —
`k3d`, `helm` e `kubectl`, cada um com seu hash no `env:` do workflow. Ele
os instala **antes** de rodar `deploy/k8s/bootstrap.sh`, e essa ordem é o
ponto: o `ensure_k3d` do próprio bootstrap baixa o k3d **sem** checksum, e
achar o binário já no `PATH` é o que o impede de baixar. Um passo reprova o
job se as versões pinadas ali divergirem das que o bootstrap instalaria. O
que esse workflow ainda aceita na confiança, declarado: os charts do Helm
vêm dos repositórios deles por **versão**, não por digest
(`deploy/k8s/helm/charts.env`), com as imagens que esses charts
referenciam; e o `k3d` baixa a imagem de nó `rancher/k3s` e a imagem do
load balancer dele pela **tag embutida no binário do k3d** — pinadas,
então, só até onde o checksum do k3d as pina.

As versões dos scanners têm uma segunda restrição: precisam bater com o
`docker/engine/Dockerfile.prod`, porque testar contra um scanner diferente
do que roda em produção é verde falso. O comentário que prometia isso
estava lá desde a Fase 5; o passo que o *cobra*
(`Versões dos scanners batem com o Dockerfile.prod do engine`, no job
`lint`) só chegou com a [#408](https://github.com/daneiel/brabo/pull/408).

### Actions: SHA de commit, com a versão ao lado {#actions-commit-sha-with-the-version-alongside}

Todo `uses:` é pinado num SHA de commit de 40 caracteres, com a tag de
onde ele veio preservada num comentário ao fim da linha:

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262  # v4
```

O comentário é **obrigatório**, e não como enfeite. É a única coisa que diz
a um humano — e ao Dependabot, que lê exatamente esse comentário — qual
versão um hash é. Um SHA sem versão ao lado é um pin que ninguém consegue
auditar e ninguém consegue atualizar.

Para resolver uma tag no SHA a anotar:

```bash
gh api repos/actions/checkout/commits/v4 --jq .sha
```

## Por que há uma checagem e não só uma regra {#why-theres-a-check-and-not-just-a-rule}

A #408 pinou as actions do `ci.yml` e só dele. Os outros quinze workflows
ficaram em tags mutáveis por meses — inclusive `release.yml` (empurra
imagens para o GHCR), `publish-runner.yml` (publica no npm),
`tag-release.yml` (cria tags) e `docs-deploy.yml` (empurra para o
`gh-pages`). A metade que ficou sem pin era, precisamente, a metade que
tem credenciais.

Isso não é descuido, é a forma previsível de uma regra sem mecanismo: um
workflow novo é escrito copiando um vizinho, e o vizinho tinha uma tag.
Então a regra agora tem um mecanismo — `scripts/ci/actions-pinadas.ts`,
rodado no job `lint`, que reprova qualquer `uses:` que não seja SHA de
commit, e qualquer SHA sem o comentário de versão. É o mesmo raciocínio
[das contagens de RN e ADR](documentation-workflow.md): um número mantido
certo à mão fica velho no momento em que alguém esquece, então o artefato
é lido em vez de confiado.

Uma referência a uma action **dentro deste repositório** (`./.github/...`)
passa: é código nosso, revisado pela PR que o muda, sem terceiro capaz de
mover nada.

## O navegador do Playwright {#the-playwright-browser}

O E2E de navegador ([ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md))
baixa o chromium na hora do CI, da CDN do Playwright — um terceiro
download que não é action nem asset de GitHub Release, então nenhum dos
dois mecanismos acima o cobre.

O que o pina é a versão **exata** de `@playwright/test` em
`e2e/pnpm-lock.yaml`: cada release do pacote está amarrada a um build do
navegador, e `playwright install` busca esse. Então o pin é o lockfile, e
o `--frozen-lockfile` no job é o que o torna um pin e não uma sugestão.

Não há `sha256sum -c` aqui, e essa é a descrição honesta: a ferramenta
baixa e verifica por conta própria, e reproduzir a tabela de checksums
dela à mão seria uma cópia que envelhece. Mais fraco que os binários dos
scanners, dito em vez de subentendido.

## O que o job de imagens guarda em cache, e o que o cache não pode mudar {#images-job-caches}

Desde a AT-304 o job `images` do `ci.yml` guarda três coisas entre
execuções com `actions/cache` (pinada por SHA como toda action), e cada
uma foi escolhida para que o cache economize tempo sem mover um veredito:

| cache | chave | o que decide o conteúdo |
|---|---|---|
| o navegador do Playwright (`~/.cache/ms-playwright`) | versão exata de `@playwright/test` + hash de `e2e/pnpm-lock.yaml` | o pin do lockfile acima — Playwright novo é chave nova, nunca um acerto velho |
| o store do pnpm de `e2e/` (`setup-node`, `cache-dependency-path: e2e/pnpm-lock.yaml`) | hash de `e2e/pnpm-lock.yaml` | `pnpm install --frozen-lockfile`, que continua conferindo a integridade de todo tarball contra o lockfile |
| o banco de vulnerabilidades do Trivy (`/tmp/trivy-cache/seed/db`) | versão do Trivy + dia UTC, restaurando o dia anterior mais recente | **o próprio Trivy**: `--download-db-only` continua rodando, lê o `NextUpdate` do próprio banco e baixa de novo quando ele passou |

A última linha é a que poderia ter afrouxado um gate, e não afrouxa: o
cache só *semeia* o diretório, e o frescor é julgado pela mesma regra que
o Trivy aplica num notebook. O que o cache tira é o download de ~110 MB do
registry a cada execução — que era também a origem da falha ocasional
`TOOMANYREQUESTS`. O `release.yml` não usa esse cache: uma tag escaneia
com um banco que ela mesma baixa.

O cache do navegador guarda **só** o navegador. As bibliotecas de sistema
que o `--with-deps` instala vão para o apt do runner, que nenhum cache de
diretório consegue guardar, então uma execução quente ainda as instala
(`playwright install-deps`).

O escopo é do GitHub, não nosso: o `ci.yml` só roda em `pull_request`,
então esses caches são gravados no escopo da própria PR e lidos de volta
pelos pushes seguintes dessa PR (e do escopo da branch base, que este
workflow nunca grava). Uma PR não consegue semear o cache de outra PR.

## Imagens de container: digest, com a tag dentro da referência {#container-images-digest-with-the-tag-alongside}

Imagens de terceiros são pinadas por **digest**, com a tag de onde vieram
escrita **dentro da referência**, antes do digest —
`image:tag@sha256:<index>`
([ADR 0178](../adr/0178-tag-inline-na-imagem-de-terceiro.md)):

```yaml
image: neo4j:5.26-community@sha256:d9cfe82983d27f5a75b3aaae8f316d04f9a698a3b7f6103a508f7caf8362f255
```

```dockerfile
FROM node:26.11.1-alpine3.24@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a AS deps
```

Com as duas presentes, o Docker baixa pelo digest: a tag é informação para
quem lê a linha, e o digest decide os bytes.

**Até o ADR 0178 a tag morava num comentário** (`neo4j@sha256:…  # 5.26-community`,
e num Dockerfile na linha de cima), espelhando as actions. Ela mudou de
lugar por causa de uma medição (AT-139, 2026-09-27): o Dependabot não lê
esse comentário em formato nenhum, e um pin só de digest é "atualizado"
para o digest de `latest` — o que teria levado pgvector, neo4j e node a
outro major com o comentário ainda afirmando a tag antiga e o lint verde.
Com a tag inline, o Docker, o Dependabot e um humano leem todos a mesma
tag. O `imageName` do CloudNativePG já tinha essa forma, por outro motivo:
o webhook dele recusa referência só com digest, porque lê a versão do
Postgres da tag.

Um comentário continua **permitido**, mas só se disser a mesma coisa: um
comentário que afirma uma tag (um único token com dígito) diferente da
inline reprova a checagem — é exatamente a sobra que uma troca de versão
deixaria largada. **Num Dockerfile, comentário no fim da linha `FROM`
continua reprovando**: o parser do Docker só reconhece `#` no *início* da
linha, então `FROM alpine:3.20@sha256:… # 3.20` é um `FROM` com três
argumentos, e o build morre com *"FROM requires either one or three
arguments"*. Isso foi achado do jeito certo sob o ADR 0159 — o passo
`bake` do job `images` falhou no primeiro push, em 27 segundos — e o
`hadolint` tinha passado o mesmo arquivo: linter concordar não é build
concordar.

Esta página já disse o contrário — pinar por tag era "uma parada
deliberada, não um descuido", comprando reprodutibilidade do dia a dia
"sem o custo de manutenção de digests em imagens que não publicamos". Esse
raciocínio está **revogado**, e a medição é o porquê: as 37 referências de
terceiros no repositório estavam em tags, e três dos lugares onde elas
rodam são piores que um `docker compose pull` ficando velho.

- As linhas `FROM` são a base das imagens que **publicamos** no GHCR —
  cinco desde o [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md).
  Uma tag movida vira bytes dentro de uma imagem que assinamos e
  entregamos a outras pessoas.
- `docker/docker-compose.install.yml` roda na máquina de quem instalou o
  produto, ao lado do Postgres dela. Nesse mesmo arquivo as nossas
  **próprias** imagens já chegam por digest, por uma variável que o
  instalador preenche — as de terceiros chegavam por tag, ao lado delas.
- `ci.yml`, `golden-set-rag.yml` e `golden-set-qa.yml` rodam imagens de
  terceiros como `services:` do job. É literalmente o runner que a regra
  das actions existe para proteger, alcançado pela outra porta. Desde o
  [ADR 0197](../adr/0197-a-imagem-dos-workflows-vem-do-compose.md) eles
  não guardam literal nenhum: ver *Os workflows leem o compose* abaixo.

Para resolver uma tag no digest a anotar — o digest do **índice**, para o
pin continuar funcionando em `linux/arm64` além de `linux/amd64`:

```bash
docker manifest inspect neo4j:5.26-community | head -3   # confirms it is an index
docker buildx imagetools inspect neo4j:5.26-community --format '{{.Manifest.Digest}}'
```

A tag é **obrigatória**, pelo mesmo motivo de o comentário de versão ser
obrigatório nas actions: `sha256:22ec5cd0…` não diz a ninguém que aquilo é
o Neo4j 5.26. E, como nas actions, a regra tem um mecanismo em vez de boa
vontade — `scripts/ci/imagens-pinadas.ts`, rodado no job `lint`, que
reprova qualquer `image:`/`imageName:`/`FROM` que não seja digest, qualquer
digest sem tag inline (a forma antiga só com comentário incluída), um
comentário de tag que discorda da tag inline, um comentário no fim de um
`FROM`, e a mesma tag inline carregando dois digests diferentes em dois
arquivos. Ele é **irmão** do `actions-pinadas.ts`, não uma extensão dele:
`uses:` mora em YAML de workflow com uma sintaxe, imagens moram em
composes, manifestos kustomize e Dockerfiles com outras três, e uma função
respondendo às duas perguntas responderia mal às duas.

O que a checagem deliberadamente **não** cobre:

- **As imagens que nós mesmos construímos** (`brabo-api`, `brabo-engine`,
  `brabo-web`, `brabo-backup` e `brabo-broker` — a última publicada desde o
  [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)).
  Não há terceiro que pudesse mover nada, e `brabo-api:prod` é uma tag
  *local* cujo digest não existe antes do build. Onde elas atravessam um
  registry, **já** vão por digest, pelo mecanismo que é dono delas:
  `.release/images.json` escrito pelo `release.yml` e aplicado por
  `make imagens-do-release`
  ([ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)). O
  overlay do repositório guarda o *marcador*, não uma release congelada —
  exigir um digest literal ali brigaria com esse mecanismo em vez de
  reforçá-lo.
- **Referências interpoladas** (`${BRABO_API_IMAGE:?…}`), que são o mesmo
  caso visto do outro lado.
- **Estágios de build multi-stage** (`FROM deps AS build`, `FROM scratch`),
  que não são imagens de registry.

A lista de exceções é por *nome* e falha fechada: uma imagem de terceiro
nova nunca casa com `brabo-`, então ela nasce sob a regra.

### Os workflows leem o compose {#the-workflows-read-the-compose}

Até o [ADR 0197](../adr/0197-a-imagem-dos-workflows-vem-do-compose.md)
`pgvector` e `ollama` moravam em dois lugares: nos composes e, como
literais, nos `services:` do `ci.yml` e dos dois workflows de golden-set.
Nenhum ecossistema do Dependabot lê os `services:` de um workflow, então
toda PR do bot subindo uma delas no compose teria nascido vermelha pela
regra "mesma tag, dois digests", e o passo que alinharia o workflow na PR
do bot não consegue empurrar com o `GITHUB_TOKEN`, que nunca tem permissão
de mudar `.github/workflows/`.

O literal saiu. Um workflow reutilizável,
`.github/workflows/imagens-do-compose.yml`, roda
`scripts/ci/imagens-do-compose.ts`, que lê o `image:` de cada serviço de
`docker/docker-compose.yml` (e recusa um que não seja
`image:tag@sha256:<index>`), e os chamadores escrevem
`image: ${{ needs.imagens.outputs.pgvector }}`. Uma duplicata que não
existe não consegue divergir: a PR do bot toca só o compose, e o CI dessa
mesma PR já roda contra a imagem nova. O que o `golden-set-rag.yml`
*prometia* num comentário — o mesmo Ollama do dev, porque o piso do
golden-set é chaveado por modelo e não por ambiente — agora é verdade por
construção.

O `imagens-pinadas.ts` aprendeu a forma nova e fecha a porta que ela abre.
Num workflow ele reprova qualquer **literal** de terceiro (pinado ou não);
qualquer expressão que não seja exatamente
`${{ needs.<job>.outputs.<name> }}` — um literal dentro da expressão, um
default por `||`, `env.`, `vars.`, `format()` são todos lugares onde uma
referência mutável poderia se esconder, e o padrão antigo nem casava com
uma linha com espaços; e um `needs.<job>` cujo job não chama o workflow
reutilizável, ou uma saída que ele não declara. Cada regra é provada por
mutação no spec dela.

**O preço é real, e o Dependabot agora paga parte dele.** Uma imagem
pinada por digest não recebe atualização de segurança até alguém trocar o
digest — a mesma dívida que os SHAs das actions carregam. O
`.github/dependabot.yml` liga `github-actions` por esse motivo e, desde o
ADR 0197, `docker-compose` (`/docker`) e `docker` (`/docker/*` e
`/deploy/k8s/**`), cada um agrupado numa PR semanal para a `dev`. O ignore
temporário do MAJOR do `node` (AT-360) saiu com a mudança para o Node 26
(decisão do dono, 2026-10-02): os dois ecossistemas de imagem agora
propõem majors do `node` como qualquer outra atualização.
Ainda manual, e declarado no ADR 0197: `neo4j` e `ollama` moram também em
`deploy/k8s/base/`, os dois ecossistemas nunca compartilham uma PR, e um
re-roll de digest com a mesma tag faz as duas PRs falharem até um humano
juntá-las; o `imageName` do CloudNativePG e o `IMAGEM_DO_GOLDEN_SET_QA` não
são lidos por ecossistema nenhum. Esses seguem o
[procedimento do runbook](../runbook.md#subindo-imagem-de-terceiro).

**Um digest garante imutabilidade, não disponibilidade.** O pin protege
contra o dono de uma tag movê-la; não protege contra o publicador apagar o
repositório. Isso aconteceu com o MinIO: o servidor S3 do overlay local
estava pinado por digest de índice em `quay.io/minio/minio`, o MinIO parou
de publicar a imagem community, e o mesmo digest passou a responder 401
(Docker Hub: 404). O bootstrap morria no `rollout status` e nenhuma prova
de propriedade rodou até o servidor ser trocado pelo SeaweedFS
([ADR 0169](../adr/0169-seaweedfs-no-lugar-do-minio-no-overlay-local.md)).
O sintoma, se acontecer de novo com qualquer imagem pinada, é
`ImagePullBackOff` num digest que não mudou — a correção é uma imagem nova
de um publicador que ainda a serve, nunca tirar o pin.

## O cache de build não pode esconder um pacote velho {#the-build-cache-cannot-hide-a-stale-package}

O estágio final (`runtime`) de todo `Dockerfile.prod` roda `apk upgrade`.
O BuildKit chaveia uma camada por instrução mais camada-mãe, nunca por
tempo, então com `cache-from` ligado um build de PR reaproveitava uma
camada de `apk upgrade` congelada no primeiro build daquela PR (medido:
`CACHED` em 5 de 5 imagens), e o Trivy escaneava um openssl antigo que a
tag, construída a frio, não levaria. Por isso o `docker-bake.hcl` define
`no-cache-filter = ["runtime"]` no alvo base compartilhado: o estágio
final e o que vem depois dele são reconstruídos toda vez, os estágios de
build mantêm o cache deles (é onde está o tempo), e o scan olha o que a
tag publicaria. Não é uma allowlist do Trivy. O custo é de cerca de 7–9 s
por imagem, em paralelo.

Isso corrigiu o que a **PR** escaneia. Não podia corrigir o que a **tag**
publica: uma tag constrói a frio, numa outra execução, e até o
[ADR 0172](../adr/0172-trivy-no-release-antes-de-assinar.md) nada a
escaneava.

## A release escaneia o que publica, antes de assinar {#the-release-scans-what-it-publishes-before-signing-it}

O `release.yml` roda o Trivy em cada imagem **por digest**, direto do
registry (`--image-src remote`), depois de o bake empurrar e gravar
`.release/images.json` e **antes** do `cosign sign`. A ordem é o
mecanismo: uma imagem que reprova nunca é assinada, e o `install.sh` não
instala imagem não assinada. O push já aconteceu a essa altura (é ele que
cria o digest), então uma tag reprovada deixa as tags dela no GHCR sem
assinatura e sem Release — o estado correto, já que nada as instala.

O gate é a **mesma** regra do job do `ci.yml`, flag por flag:
`--scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1` e
o mesmo `.trivyignore.yaml`, em que toda entrada leva um `expired_at`. Um
HIGH ou CRITICAL **com correção disponível** reprova a release. O que
**não** tem correção é relatado, sem bloquear: um segundo scan sem
`--ignore-unfixed` e com `--exit-code 0` alimenta
`scripts/ci/trivy-do-release.ts`, que escreve o resumo do job e o asset de
Release `trivy-sem-correcao.md`. Esse script nunca decide o veredito —
quem decide é o código de saída do Trivy —, porque uma segunda regra para
"tem correção" divergiria da do próprio Trivy na primeira vez que ele
acrescentasse um status. **Não há allowlist nova**: o passo não aceita
arquivo de ignore além do que a PR já usa.

O binário é o mesmo `v0.70.0` com o mesmo `sha256` do `ci.yml`, declarado
duas vezes porque o `env:` de um workflow não pode ser importado. A
duplicação é vigiada: `scripts/ci/trivy-do-release.spec.ts` reprova quando
versão, hash ou as flags do gate divergem entre os dois workflows, quando
o gate vai para depois da assinatura, ou quando aparece um segundo arquivo
de ignore. Como o `install-e2e.yml`, a release só roda numa tag final,
então esse spec é a prova que uma PR consegue dar.

Medido em 2026-09-27 contra os digests da última release (`v6.1.0`, quatro
imagens, publicada em 2026-09-14), com as mesmas flags: `api` e `web`
**reprovariam** — `CVE-2026-45447` (HIGH, `libcrypto3`/`libssl3`
`3.3.7-r0`, corrigido em `3.3.7-r1`), uma CVE publicada depois daquela
tag —, `engine` e `backup` passam, e nada HIGH/CRITICAL sem correção
aparece depois de aplicado o `.trivyignore.yaml`. Sem ele, o `engine`
carregaria 56 achados corrigíveis nos binários de scanner de terceiros que
aquele arquivo documenta. Os quatro scans mais o download do banco levaram
cerca de 30 s.

## Uma dependência pinada num commit de git: `bandit`, temporária {#bandit-pinned-to-a-commit}

Toda dependência do engine vem do hex.pm, com uma exceção TEMPORÁRIA. O
advisory EEF-CVE-2026-105659 (GHSA-69m6-wcv4-rwcf, HIGH, o HTTP/2 do
Bandit) afeta todo Bandit `>= 1.4.0`, inclusive o 1.12.5, a última release
no hex, e o `mix hex.audit` do CI reprova por ele em toda PR. A correção
existe só como o commit `d88b21953c65061f21136ea76a89a4f95a2ac7a1` de
`mtrudel/bandit` (mergeado em 2026-10-12), sem release. Desde 2026-10-14 o
`apps/engine/mix.exs` aponta `bandit` para esse commit, por SHA completo e
nunca por branch, com `override: true` porque `phoenix` e
`opentelemetry_bandit` pedem o pacote do hex (medido: sem isso o
`mix deps.get` para com "Dependencies have diverged"). O SHA faz o papel
que o checksum faz para um pacote do hex: o lock o grava e ninguém
consegue movê-lo. Os dois Dockerfiles do engine já instalam `git` no
estágio de build.

O caminho de volta: voltar a `{:bandit, "~> 1.12"}` do hex assim que for
publicada uma release que contenha esse commit, e apagar esta seção junto.

## O que ainda é aceito na confiança {#what-is-still-trusted-on-faith}

Declarado, não corrigido:

- ~~**Sem Dependabot.**~~ **Metade fechada, e a outra metade não cabe a
  nós fechar.** A afirmação também tinha deixado de ser verdade: as
  atualizações de *segurança* são ligadas na **interface** do
  repositório, em arquivo nenhum, e estavam rodando diariamente contra
  `npm_and_yarn in /., /website` — e **falhando**, todo dia, com
  `Dependabot::DependabotError`. Causa medida: os pacotes que ele persegue
  (`multer`, `esbuild`, e a lista ao lado deles) são os que este
  repositório corrige por **overrides** no `pnpm-workspace.yaml`, um
  mecanismo que o Dependabot não consegue manipular. O alerta que ele
  persegue já está fechado; o que sobra é o erro.

  O `.github/dependabot.yml` agora existe e faz as duas coisas que um
  arquivo consegue fazer: **liga `github-actions`** — a dívida nomeada
  aqui mesmo, já que os SHAs são movidos à mão e *um pin que ninguém
  atualiza é um pin que envelhece até uma versão sabidamente vulnerável* —
  e declara as duas árvores npm com `open-pull-requests-limit: 0`, o que
  desliga as atualizações rotineiras de versão sem tocar nas de
  segurança. **Desligar as atualizações de segurança é um interruptor da
  interface**, alcançável só pelo dono do repositório; até alguém decidir,
  esse job continua falhando em alertas que os overrides já fecharam.

  Toda PR do Dependabot entra pela `dev` (`target-branch: dev` nas cinco
  entradas — os dois ecossistemas de imagem incluídos, desde o ADR 0197).
  As atualizações de segurança ignoram essa chave e abrem contra a branch
  default, então o `dependabot-para-dev.yml` fecha as que a `dev` já
  corrige e redireciona o resto — ver *Dependabot enters through dev* em
  `branching-policy.md`.
- **Dependências npm/pnpm não são atestadas.** O lockfile pina versões e
  hashes de integridade, o que é real, mas não há checagem de proveniência
  (`npm audit signatures` ou equivalente) em job nenhum.
- ~~**Sem assinatura nem atestação dos nossos próprios artefatos.**~~
  **Fechado pelo [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md)**
  (BRB-005). O `release.yml` assina as imagens que publica **por digest**
  com `cosign` keyless — a identidade OIDC do workflow, sem chave sob
  custódia em lugar nenhum — e o `build-runner-binaries.yml` ganhou um job
  consolidador que publica **um `checksums.txt` assinado** cobrindo os
  binários do runner (quatro alvos desde o
  [ADR 0174](../adr/0174-runner-sem-binario-darwin-x64.md), que tirou o
  `darwin-x64`), em vez de uma assinatura por binário.
  Os dois workflows **verificam o que acabaram de assinar**, na mesma
  execução: uma assinatura que ninguém tenta verificar é mais um arquivo
  na release, e a falha, do contrário, apareceria na máquina de quem
  instala — o pior lugar para achá-la.

  Desde o [ADR 0160](../adr/0160-o-compose-do-instalador-viaja-assinado.md)
  esse manifesto cobre mais que binários: o `install.sh` e os quatro
  arquivos de que ele precisa para subir uma instalação — o compose de
  instalação e os três arquivos que ele usa por caminho relativo,
  publicados como assets `brabo-install-*` a partir do checkout da tag —
  são linhas do **mesmo** `checksums.txt`, e o job roda
  `sha256sum -c --strict` sobre ele antes de anexar qualquer coisa. O
  instalador confere cada um dos quatro contra esse manifesto antes de
  perguntar ou gravar qualquer coisa ([RN-570](../business-rules.md#rn-570)).
  Até então o compose era a única coisa que o instalador usava que nada
  verificava — nem sequer baixava. A lista mora em
  `scripts/ci/assets-do-instalador.ts`, e o spec dela reprova quando a
  cópia do próprio instalador diverge ou quando o compose ganha um
  bind-mount relativo que não está nela.

  **A imagem do broker é a quinta, e é a que mais importa**
  ([ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)).
  Ninguém a construía até então: o `Dockerfile.prod` existia e passava no
  `hadolint`, mas nenhum alvo do bake o construía, então ela nunca foi
  escaneada nem publicada, e a instalação não tinha como oferecer o
  serviço. Agora ela passa por todo gate que as outras quatro passam — o
  `ci.yml` a constrói em toda PR, a recusa rodando como root, roda o Trivy
  nela e a sobe saudável com rootfs somente leitura e sem rede; o
  `release.yml` a publica, grava, assina e verifica por digest sem linha a
  mais, porque os dois laços leem `.release/images.json`. O motivo de ela
  precisar disso mais que qualquer outra: numa instalação que consente, é
  o único serviço que recebe o socket do Docker do host, então uma
  vulnerabilidade nela é um caminho para a máquina inteira. Publicá-la a
  torna um alvo público estudável; esse preço está declarado no ADR, não
  escondido. O overlay do Kubernetes não a conhece
  (`argumentosDeSetImage` emite só as quatro imagens que a base do
  kustomize declara) — não há Deployment do broker, por decisão.

  O que isso **não** cobre, e é outro item: **assinatura de código dos
  binários do runner** para o sistema operacional (notarização do macOS,
  Authenticode do Windows), que exige uma identidade de assinatura paga e
  fica no [backlog](backlog.md).
- ~~**Imagens de terceiros pinadas por tag, não por digest.**~~ **Fechado**
  (acima): todas as 33 referências de terceiros — composes, manifestos
  kustomize e linhas `FROM` de Dockerfile — estão pinadas por digest com a
  tag dentro da referência (ADR 0178), os `services:` dos workflows leem as
  deles do compose (ADR 0197), e o `scripts/ci/imagens-pinadas.ts` reprova
  o job `lint` na próxima regressão. O que **não** está fechado, e é o
  preço do pin e não uma sobra: um digest não recebe atualização de
  segurança até alguém subi-lo. Os ecossistemas `docker`/`docker-compose`
  do Dependabot propõem essas subidas desde o ADR 0197; o que eles não
  alcançam está listado lá.
- **As permissões dos próprios workflows** não são cobertas aqui; isso é o
  bloco `permissions:` de cada workflow, e é uma auditoria à parte.
- **Timeout repetido do `pnpm audit` é RISCO ASSUMIDO, por decisão.**
  Quando o endpoint de advisories do npm deixa de responder três vezes
  seguidas, o job fica verde com um aviso alto em vez de vermelho — ver o
  [ADR 0140](../adr/0140-timeout-do-audit-como-risco-assumido.md). O que
  isso custa é dito sem rodeios: nessas execuções a árvore de dependências
  **não** é auditada, e a execução diz isso em vez de sugerir um
  resultado limpo. O que isso não toca: uma vulnerabilidade de fato
  relatada continua reprovando na primeira tentativa, sem retry, e uma
  falha não reconhecida também reprova (falha fechada). A alternativa —
  ficar vermelho com o terceiro fora do ar — foi medida no dia em que
  aconteceu (quatro PRs bloqueadas pelo mesmo 503) e recusada, porque um
  gate que grita lobo ensina as pessoas a rodar de novo até ficar verde, e
  esse hábito não distingue um vermelho real de um falso.
