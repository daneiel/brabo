---
id: cadeia-de-suprimentos-do-ci
title: A cadeia de suprimentos do CI
sidebar_label: Cadeia de suprimentos do CI
description: O que roda dentro dos nossos runners de CI sem ter sido escrito aqui, como está preso, e o que ainda é confiado na fé.
---

# A cadeia de suprimentos do CI

Todo job deste repositório roda código de terceiro numa máquina que tem
um checkout do código-fonte e, nos workflows de release, credenciais do
registry GHCR, do registry npm e das próprias refs git do repositório.
Esse código chega por dois caminhos: **GitHub Actions** (`uses:`) e
**binários baixados por `curl`** (os scanners). Nenhum dos dois é escrito
aqui, e nenhum dos dois passa por PR.

Esta página é sobre a parte disso que a gente controla. Ela existe porque
o mecanismo morava só em comentário de workflow — um lugar onde a regra
pode ser lida mas não auditada, e onde as duas metades divergiram
exatamente por isso.

## A ameaça, dita sem rodeio

Tag é um ponteiro. `actions/checkout@v4` não é uma versão, é um nome que
o dono da action pode apagar e recriar apontando para outro commit, a
qualquer momento, sem nenhum sinal neste repositório. Quem move essa tag
roda o código dele no nosso runner, sobre o nosso checkout, com quaisquer
segredos que aquele workflow tenha recebido.

O mesmo vale para um `curl` de asset de GitHub Release: um release
comprometido, ou um MITM entre o runner e a CDN, entrega um binário
diferente e ninguém percebe — até o scanner falhar em rodar, ou pior, até
ele "funcionar".

Nenhuma das duas é hipótese sobre este repositório em particular. São os
dois caminhos documentados pelos quais CI é comprometido no mundo real, e
a defesa dos dois é a mesma ideia: **referenciar conteúdo, não nome**.

## Os dois mecanismos

### Binários: checksum depois de todo download

Todo `curl` de asset de release no `ci.yml` e nos dois Dockerfiles do
engine é seguido de `sha256sum -c` contra um hash escrito no próprio
workflow:

```yaml
GITLEAKS_SHA256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
```

Os hashes vêm do `checksums.txt` publicado com cada release, por download
independente. Divergência reprova o job antes de o binário chegar a ser
executado.

As versões dos scanners têm uma segunda amarra: têm que bater com
`docker/engine/Dockerfile.prod`, porque testar contra um scanner
diferente do que roda em produção é verde falso. O comentário que
prometia isso estava lá desde a Fase 5; o passo que de fato o EXIGE
(`Versões dos scanners batem com o Dockerfile.prod do engine`, no job
`lint`) só chegou com o [#408](https://github.com/daneiel/brabo/pull/408).

### Actions: commit SHA, com a versão ao lado

Todo `uses:` está preso a um commit SHA de 40 caracteres, com a tag de
onde ele veio preservada num comentário ao final:

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262  # v4
```

O comentário é **obrigatório**, e não é decoração. É a única coisa que
diz a um humano — e ao Dependabot, que lê exatamente esse comentário —
que versão é aquele hash. SHA sem versão ao lado é pin que ninguém
consegue auditar nem atualizar.

Para resolver uma tag no SHA que se escreve:

```bash
gh api repos/actions/checkout/commits/v4 --jq .sha
```

## Por que existe um check, e não só uma regra

O #408 pinou as actions do `ci.yml` e só dele. Os outros quinze workflows
ficaram meses em tag mutável — entre eles `release.yml` (empurra imagens
no GHCR), `publish-runner.yml` (publica no npm), `tag-release.yml` (cria
tags) e `docs-deploy.yml` (empurra na `gh-pages`). A metade que ficou sem
pin era, justamente, a metade que tem credencial.

Isso não é descuido, é o formato previsível de uma regra sem mecanismo:
workflow novo nasce copiando o vizinho, e o vizinho estava com tag. Então
a regra passou a ter mecanismo — `scripts/ci/actions-pinadas.ts`, rodado
no job `lint`, que reprova qualquer `uses:` que não seja commit SHA, e
qualquer SHA sem o comentário de versão. É o mesmo raciocínio das
[contagens de RN e ADR](documentation-workflow.md): número mantido correto
à mão envelhece no instante em que alguém esquece, então o artefato é
LIDO em vez de acreditado.

Referência a uma action DENTRO deste repositório (`./.github/...`) passa:
é código nosso, revisado pela PR que o muda, sem terceiro nenhum podendo
mover coisa alguma.

## O navegador do Playwright

O E2E de navegador ([ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md))
baixa o chromium no CI, da CDN do Playwright — um terceiro download que não
é action e não é asset de GitHub Release, então nenhum dos dois mecanismos
acima o cobre.

Quem o prende é a versão EXATA do `@playwright/test` no
`e2e/pnpm-lock.yaml`: cada release do pacote está amarrado a uma build de
navegador, e `playwright install` busca aquela. O pin, portanto, é o
lockfile — e é o `--frozen-lockfile` do job que faz dele um pin, e não uma
sugestão.

Não há `sha256sum -c` aqui, e essa é a descrição honesta: a ferramenta baixa
e verifica por conta própria, e reproduzir a tabela de checksum dela à mão
seria uma cópia que envelhece. Mais fraco que os binários dos scanners,
dito em vez de subentendido.

## Imagens de container

Imagem de terceiro está presa por tag, não por digest:
`neo4j:5.26-community`, `pgvector/pgvector:pg16`, `ollama/ollama:0.33.1`.
Tag em registry também é mutável, então isso é mais fraco que o pin das
actions — parada deliberada, não descuido. Compra a reprodutibilidade que
importa no dia a dia (`latest` mudando o comportamento do provider local
de LLM entre dois `docker compose pull` iguais) sem o custo de manter
digest de imagem que não publicamos.

As imagens que a gente **publica** são o oposto: as quatro de produção vão
para o GHCR e o overlay as prende **por digest**, registrado por tag em
`.release/images.json` ([ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)).

## O que ainda é confiado na fé

Declarado, não corrigido:

- **Sem Dependabot.** Os SHAs se atualizam à mão. Os comentários de versão
  já estão no formato que o Dependabot espera, então ligá-lo é um arquivo
  de configuração — mas ele não existe hoje, e pin que ninguém atualiza é
  pin que envelhece até virar versão com vulnerabilidade conhecida.
- **Dependências npm/pnpm sem atestação.** O lockfile prende versão e
  hash de integridade, o que é real, mas não há checagem de proveniência
  (`npm audit signatures` ou equivalente) em job nenhum.
- **Sem assinatura ou atestação dos nossos próprios artefatos.** Nem as
  imagens publicadas nem os binários do runner são assinados — isso anda
  junto com o item de code-signing do runner no
  [backlog](backlog.md), e esta página não muda nada disso.
- **Imagem de terceiro presa por tag, não por digest** (acima).
- **As permissões dos próprios workflows** não entram aqui; isso é o bloco
  `permissions:` de cada um, e é auditoria à parte.
