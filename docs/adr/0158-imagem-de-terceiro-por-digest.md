# 0158 — Imagem de terceiro entra por digest, e o lint reprova quem esquecer

## Status

**Accepted.** REVISA uma decisão declarada por escrito em
`docs/explanation/cadeia-de-suprimentos-do-ci.md` — *"pinagem por tag é uma
parada deliberada, não um descuido"* — e a revoga com medição. Não toca o
[ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md), que continua sendo o
dono das quatro imagens que o produto publica. Corresponde ao `BRB-004`, P2 do
registro do mantenedor.

## Context

O [ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md) fez as quatro
imagens PRÓPRIAS irem por digest, e o `#419` deu ao repositório um mecanismo
para o outro lado da mesma família: `scripts/ci/actions-pinadas.ts`, que reprova
`uses:` preso a tag. O docblock dele enuncia o argumento:

> Tag é um ponteiro que o dono da action pode remover e recriar apontando para
> outro commit (…). Quem move a tag executa código no runner que tem o checkout
> e, nos workflows de release, as credenciais do GHCR e do npm.

Esse argumento **nunca foi aplicado a `image:`**, e a página de cadeia de
suprimentos dizia por quê:

> Third-party images are pinned by tag, not by digest (…) so this is weaker
> than the action pins — a deliberate stop, not an oversight. It buys the
> reproducibility that matters day to day (…) without the maintenance cost of
> digests on images we don't publish.

A frase tem duas premissas, e a medição derruba as duas.

**"Imagens que não publicamos".** Medido em 2026-09-12: são **37** referências
de terceiro, e três dos lugares onde elas rodam não são "o dia a dia".

- Nove são `FROM` de Dockerfile — `node:24.11.1-alpine3.21`,
  `hexpm/elixir:1.17.3-…`, `nginx:1.27.5-alpine`, `alpine:3.20`/`3.20.3`,
  `node:24-alpine`. Essas são a **base das imagens que publicamos**: bytes de
  terceiro que assinamos com `cosign` ([RN-524](../business-rules.md#rn-524)) e
  entregamos a outras pessoas. O `alpine:3.20` do `docker/backup/Dockerfile.prod`
  é, aliás, o único `FROM` que o próprio `BRB-004` já nomeava.
- Quatro estão em `docker/docker-compose.install.yml`, que é o que sobe **na
  máquina de quem instalou o produto**, ao lado do Postgres dessa pessoa
  ([RN-527](../business-rules.md#rn-527)). No **mesmo arquivo**, as quatro
  imagens próprias chegam por variável já resolvida por digest, e as de terceiro
  chegavam por tag.
- Quatro estão em `.github/workflows/ci.yml` e `golden-set-rag.yml`, como
  `services:` de job. Isso é **literalmente o runner** que a regra das actions
  existe para proteger, alcançado pela outra porta — e nenhum dos dois arquivos
  tinha sido olhado sob essa luz. O `BRB-004` também não os enumerava.

**"Custo de manutenção".** É real e não some, mas é o MESMO custo que o
repositório já aceitou nas actions, cujo pin também é movido à mão. O que ele
compra é a mesma coisa: referir-se a conteúdo, e não a um nome que outra pessoa
controla.

Há ainda uma armadilha registrada por escrito no `docs/reference/brb.md`, e ela
explica por que o item ficou aberto tanto tempo: lido pelo id, o `BRB-004`
parece a pinagem de `ollama:latest` que os PRs `#401`/`#419` fecharam. *"An id
is not a description"* — aqueles PRs trocaram `latest` por versão; este pede
**digest**.

## Decision

**1. Toda imagem de terceiro é presa por digest, com a tag num comentário ao
lado** — a mesma forma que as actions usam:

```yaml
image: neo4j@sha256:22ec5cd0…  # 5.26-community
```

O digest é o do **índice** (manifest list), nunca o de uma plataforma: pinar o
manifesto de `linux/amd64` quebraria `linux-arm64` sem aviso. O comentário é
**obrigatório**, pelo motivo idêntico ao das actions — `sha256:22ec5cd0…` não
diz a ninguém que aquilo é o Neo4j 5.26.

**2. Um check IRMÃO, não uma extensão.** `scripts/ci/imagens-pinadas.ts` roda no
job `lint`, ao lado de `actions-pinadas.ts`, e reprova três coisas: referência
mutável, digest sem a tag em comentário, e a **mesma tag com dois digests
diferentes** em arquivos diferentes. São dois scripts e não um porque são duas
perguntas: `uses:` mora em YAML de workflow com uma sintaxe; imagem mora em
compose, em manifest do kustomize e em Dockerfile, com outras três. Uma função
que responde às duas responde mal a ambas — é o mesmo raciocínio que o
`docs/.docmap.yml` já usa para separar `politica-de-branches` de
`checks-e-rulesets`.

O terceiro motivo existe por uma promessa concreta: o `golden-set-rag.yml` diz
em comentário rodar a *"MESMA versão pinada de docker/docker-compose.yml"*,
porque o piso do golden-set é chaveado por modelo e não por ambiente
([ADR 0138](0138-golden-set-do-rag-em-ci-agendado.md)). Com tag isso era uma
promessa; com digest vira verificável.

**3. O check NÃO cobre as imagens que o produto publica**, e a decisão é
deliberada, com três razões independentes:

- **Não são de terceiro.** Não existe dono fora deste repositório que possa
  mover ponteiro nenhum.
- **É impossível.** `brabo-api:prod` é uma tag LOCAL produzida por
  `docker compose build`: o digest não existe antes do build e muda a cada
  build. Um literal ali seria exigir o inexistente.
- **Brigaria com o mecanismo que já as resolve.** Onde elas atravessam um
  registry, o [ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md) já as
  põe por digest — `.release/images.json` gravado pelo `release.yml`, aplicado
  por `make imagens-do-release`. O overlay guarda o MARCADOR
  (`REPLACE_WITH_DIGEST`) e não uma release congelada, de propósito: o
  repositório não declara que produção roda a v3.2.0. Um check exigindo digest
  literal no overlay reprovaria justamente o estado correto.

Pelas mesmas razões ficam fora as referências **interpoladas**
(`${BRABO_API_IMAGE:?…}`) — o `install.sh` grava as quatro no `.env` já por
digest — e os **estágios de multi-stage** (`FROM deps AS build`,
`FROM scratch`), que não são imagens de registry.

A lista de exceções é por **nome** e falha fechado: imagem de terceiro nova
nunca casa com `brabo-`, então nasce cobrada.

**4. O compose de observabilidade entra**, e essa era uma pergunta aberta na
atividade (`TODO(humano)`: entra no escopo do check, ou fica de fora por não
subir em instalação de usuário?). A resposta é o custo de cada lado. Incluir
custa quatro digests. Excluir custa uma **exceção nomeada dentro de `docker/`**,
que é exatamente o formato de buraco que o docblock do `actions-pinadas.ts`
diagnostica: *"workflow novo nasce copiando o vizinho, e o vizinho estava com
tag"*. Um arquivo isento no meio da pasta é o vizinho errado.

## Consequences

**O digest congela, e o preço é declarado.** Uma imagem presa por digest não
recebe correção de segurança até alguém trocar o digest à mão — a mesma dívida
que os SHAs das actions carregam (`BRB-006`). Este ADR **não** resolve isso:
declara. O `.github/dependabot.yml` liga o ecossistema `github-actions` por esse
motivo; o ecossistema `docker` **não** é ligado aqui, e ligá-lo é decisão à
parte, porque muda a cadência de PRs de um monorepo que já desligou os *version
updates* de npm por inundação.

**As imagens de dev congelam mais que as de produção.** `node:24-alpine` era uma
tag rolante de propósito, e o digest a prende a um 24.x específico. É a
consequência menos confortável desta decisão, e ela é aceita pelo mesmo
argumento: a imagem de dev do broker roda `pnpm install` no build, e uma base
que muda embaixo é uma variável a mais quando algo quebra só na máquina de
alguém.

**37 linhas mudaram e nenhuma mudou de conteúdo.** Cada digest foi resolvido
contra o registry a partir da tag que já estava escrita, e é o digest do índice
— os builds continuam multi-arch. O que o repositório perdeu foi a capacidade de
receber conteúdo diferente sem que ninguém visse.

**O `BRB-004` deixa de reproduzir**, e fechá-lo formalmente segue sendo de quem
o levantou, no vault — a régua que o `docs/reference/brb.md` já enuncia.

**O que este ADR NÃO faz:**

- **Não estende para assinatura.** Digest é integridade do que se pegou;
  procedência é o `BRB-005`, cuja metade aberta (o proxy verificar a assinatura
  do manifesto) foi medida e recusada com número
  ([RN-525](../business-rules.md#rn-525)).
- **Não cobre `deploy/k8s/helm/otel-collector-values.yaml`**, onde `image:` abre
  um mapa com `repository:` e nenhuma tag: quem escolhe a tag ali é o chart, e
  pinar exigiria decidir também a versão do chart. Fica DECLARADO, não coberto.
- **Não cria RN.** A regra é irmã da que proíbe `uses:` por tag, e aquela
  também não tem RN: as duas moram no `CLAUDE.md` (seção de CI/CD de release) e
  em `docs/explanation/cadeia-de-suprimentos-do-ci.md`, que o `docs/.docmap.yml`
  vigia em `block`. Pôr uma das duas em `docs/business-rules.md` daria dois
  endereços à mesma política.
