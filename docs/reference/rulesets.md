---
id: rulesets
title: Rulesets do repositório
sidebar_label: Rulesets
sidebar_position: 8
description: A configuração exata dos rulesets das três branches permanentes e das tags, para aplicação manual — o repositório versiona a fonte, o GitHub recebe a aplicação.
keywords: [rulesets, proteção de branch, required checks, tags, release]
---

# Rulesets do repositório

Esta página é a **fonte versionada** da proteção. Aplicá-la no GitHub é passo
**manual** — o repositório não tem como se auto-proteger, e essa assimetria é
proposital: quem afrouxa a proteção precisa ser uma pessoa, com registro.

A política que estas regras aplicam está em
[Política de branches](../explanation/branching-policy.md).

> **Estado atual:** `gh api repos/daneiel/brabo/rulesets` devolve **0**. Nada
> aplicado ainda. Enquanto isso, tudo aqui é intenção declarada, não proteção
> real.

## Pré-requisito: as três branches precisam existir

A escada tem três degraus, e um ruleset não pode mirar o que não existe.

```bash
git fetch origin
git push origin origin/dev:refs/heads/qa
```

`dev` e `main` já existem. `qa` nasce de `dev` — a escada começa vazia e é
preenchida por promoções.

> A branch `rc` foi **removida** da escada. Se ela ainda existir no remoto de
> um clone antigo, apague: `git push origin --delete rc`. Branch permanente que
> não está na escada é convite a PR mirando um degrau que não existe mais.

## Ruleset 1 — as três permanentes

**Nome:** `permanentes`
**Enforcement:** `Active`
**Target:** Branch → `Include by pattern`, três entradas: `dev`, `qa`, `main`

> Um ruleset só para as três, e não três rulesets: a exigência é idêntica em
> todas. O que difere entre degraus é **quem aprova**, e isso é decidido pelo
> `approval-ladder` a partir do destino, não pela proteção.

### Regras a marcar

| regra | valor | por quê |
|---|---|---|
| **Restrict deletions** | ✅ | apagar `main` por engano é irreversível pela interface |
| **Block force pushes** | ✅ | force-push em permanente reescreve o que já foi promovido; a tag do degrau passaria a apontar para commit inexistente |
| **Require a pull request before merging** | ✅ | é a regra central: nenhuma mudança entra sem PR |
| ↳ Required approvals | **0** | a contagem quem faz é o `approval-ladder`, que sabe o modo e o destino. O número nativo do GitHub não distingue `dev` de `main` |
| ↳ Dismiss stale approvals on push | ✅ | aprovação de commit antigo não vale — o que foi aprovado não é o que vai ser mergeado |
| ↳ Require review from Code Owners | ✅ | o `CODEOWNERS` põe o owner como reviewer de tudo |
| **Require status checks to pass** | ✅ | ver a lista abaixo |
| ↳ Require branches to be up to date | ❌ | forçaria rebase a cada merge em `dev`; o CI já roda no merge commit |
| **Block merge queue** | — | não usado |

**Required approvals = 0 não é afrouxamento.** O GitHub só sabe contar; ele não
sabe que `main` exige PO + gestor e `dev` exige um dev, nem que no modo `solo`
o PR do próprio owner passa sem review. Pôr `1` aqui **quebraria** o modo solo:
o owner não consegue aprovar o próprio PR pela interface, e o PR ficaria
travado para sempre. A exigência real vive no `approval-ladder`, que é um check
required — e check required não se burla.

### As duas configurações, lado a lado

O ruleset é o **mesmo** nos dois modos. O que muda é a variável — e é por isso
que a migração não passa por Settings → Rules.

| | `solo` (hoje) | `community` (futuro) |
|---|---|---|
| **Required approvals no ruleset** | **0** | **0** |
| quem exige | o check `Escada de aprovação` | o mesmo check |
| variáveis | `APPROVAL_MODE=solo`, `OWNER_HANDLE` | `APPROVAL_MODE=community`, `APROVADORES_*` |
| `dev` | 1 do owner | 1 × devs |
| `qa` | 1 do owner | 2 × devs |
| `main` | 1 do owner | 1 × PO + 1 × gestão |
| PR do próprio owner | passa sem review | segue a escada como qualquer um |
| pessoas distintas | suspensa | vale em `main` |

**Required approvals fica em 0 nos dois casos, e isso é deliberado.** O GitHub
só sabe contar: ele não distingue `dev` de `main`, não sabe de papéis, e não
sabe que no modo solo o PR do próprio owner passa sem review. Pôr `1` ali
**quebraria o modo solo** — o owner não consegue aprovar o próprio PR pela
interface, e todo PR dele ficaria travado para sempre. A exigência real vive no
check, que é required e não se burla.

Copy-paste para ativar cada modo:

```bash
# solo — o que vale hoje
gh variable set APPROVAL_MODE --body solo
gh variable set OWNER_HANDLE  --body daneiel

# community — preencher as listas ANTES de virar a chave
gh variable set APROVADORES_DEVS   --body "ana,bruno,carla"
gh variable set APROVADORES_PO     --body "paula"
gh variable set APROVADORES_GESTAO --body "gustavo"
gh variable set APPROVAL_MODE      --body community
```

### Checks obrigatórios

Nome **exato**, como o GitHub o registra (é o `name:` do job, não o do
workflow):

| check | workflow |
|---|---|
| `Política de branches` | `pr-police.yml` |
| `Escada de aprovação` | `approval-ladder.yml` |
| `Lint` | `ci.yml` |
| `Testes TS (api + web)` | `ci.yml` |
| `Testes do engine (ExUnit)` | `ci.yml` |
| `Auditoria de dependências` | `ci.yml` |
| `Gitleaks no repositório` | `ci.yml` |
| `Manifests de Kubernetes` | `ci.yml` |
| `Build, scan e smoke das imagens de produção` | `ci.yml` |
| `Drift, gerados e build` | `docs-check.yml` |

> **`pull_request_target` exige o workflow na branch PADRÃO.** Não basta estar
> na branch base do PR. Isso foi medido, não suposto: com `pull_request_target`
> o `pr-police` teve **zero execuções**, enquanto `approval-ladder` e
> `docs-check` — que usam `pull_request` — rodaram normalmente do mesmo commit.
> Como a padrão é `main` e ela só avança pela escada que o próprio check
> guarda, o gatilho seria ovo e galinha. Os dois usam `pull_request`.

> **Um check required que nunca roda trava o PR para sempre.** É por isso que o
> gatilho do `ci.yml` cobre as três permanentes — antes da FASE 6 ele só
> disparava em PR para `dev`, e exigir estes checks numa promoção `dev→qa`
> produziria um PR eternamente pendente. O gatilho de `push` foi removido: com
> `pull_request` cobrindo tudo, ele só duplicava execução. Ao
> acrescentar job novo ao CI, ou ele entra nesta lista, ou fica de fora de
> propósito e alguém escreve por quê.

### Bypass

**Vazio.** Nem o owner. A exceção que existe é a de **tags**, no ruleset
abaixo, e ela é do bot — não de pessoa.

> **TODO(humano):** o item 7 da FASE 6 prevê o bot do gate escrevendo
> `.release/gate.json` direto em permanente. Quando esse workflow existir, ele
> entra aqui como bypass **por app**, restrito a esse caminho. Enquanto não
> existe, o bypass fica vazio.

## Ruleset 2 — tags de versão

**Nome:** `tags-de-release`
**Enforcement:** `Active`
**Target:** Tag → `Include by pattern` → `v*`

| regra | valor |
|---|---|
| **Restrict creations** | ✅ |
| **Restrict updates** | ✅ |
| **Restrict deletions** | ✅ |

### Bypass

| quem | modo |
|---|---|
| o app/bot que roda o workflow de release | `Always` |

Esta é a exceção de push que a política prevê: **versão nasce de workflow,
nunca da mão**. Uma tag criada manualmente não passa pela verificação de que a
final aponta para o mesmo commit da última `-qa.N`, e é justamente essa
verificação que impede publicar algo diferente do que foi validado.

## Como aplicar

Interface: **Settings → Rules → Rulesets → New ruleset**.

Por API, se preferir versionar o comando:

```bash
gh api -X POST repos/daneiel/brabo/rulesets --input ruleset-permanentes.json
gh api repos/daneiel/brabo/rulesets --jq '.[] | "\(.name): \(.enforcement)"'
```

> **TODO(humano):** os dois `.json` de payload não estão versionados aqui
> porque a API de rulesets exige `repository_id` e ids de app que variam por
> instalação — um arquivo fixo seria copiado errado. Se quiser versioná-los,
> gere com `gh api repos/daneiel/brabo/rulesets/<id> > docs/reference/...` após
> aplicar pela interface, e este documento passa a apontar para eles.

## As labels de família precisam existir

O `pr-police` aplica uma das quatro labels, e `gh pr edit --add-label` **falha**
se a label não existir — o que deixaria o PR sem classificação em silêncio.

```bash
gh label create trabalho        --color 0E8A16 --description "PR de trabalho: prefixo da taxonomia para dev"
gh label create promocao        --color 1D76DB --description "Promoção entre degraus adjacentes, subindo"
gh label create retropropagacao --color 5319E7 --description "Retropropagação entre degraus adjacentes, descendo"
gh label create correcao-alta   --color D93F0B --description "hotfix: correção que nasce alta na escada"
```

Sem `|| true` de propósito: se o comando falhar, você precisa ver.

## Verificar que ficou de pé

```bash
# os rulesets existem e estão ativos?
gh api repos/daneiel/brabo/rulesets --jq '.[] | "\(.name): \(.enforcement)"'

# a proteção responde? (deve ser REJEITADO)
git push origin HEAD:dev
```

O segundo comando é o teste que importa. Ruleset configurado e não verificado é
indistinguível de ruleset ausente — e a diferença só aparece no dia em que
alguém empurrar direto para `main`.
