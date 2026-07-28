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

A coluna de duração é **medida**, não estimada — três execuções reais, cache
frio e quente. Ela existe para que "otimizar o CI" comece pelo número e não pelo
palpite.

| check | workflow | frio | quente |
|---|---|---|---|
| `Build, scan e smoke das imagens de produção` | `ci.yml` | **295s** | 109s |
| `Testes TS (api + web)` | `ci.yml` | 159s | **159s** |
| `Testes do engine (ExUnit)` | `ci.yml` | 124s | 39s |
| `Auditoria de dependências` | `ci.yml` | 99s | 85s |
| `Lint` | `ci.yml` | 66s | 69s |
| `Drift, gerados e build` | `docs-check.yml` | 53s | 51s |
| `Manifests de Kubernetes` | `ci.yml` | 14s | 13s |
| `Gitleaks no repositório` | `ci.yml` | 5s | 7s |
| `Política de branches` | `pr-police.yml` | 7s | 7s |
| `Escada de aprovação` | `approval-ladder.yml` | 13s | 15s |
| `Check de promoção` | `promotion-check.yml` | 9s | 9s |
| `Backmerge gate` | `backmerge-gate.yml` | 7s | 7s |

**O `ci.yml` já é 100% paralelo** — nenhum job dele tem `needs:`. Não existe
grafo serial para desatar, e o veredito completo do PR custa o job mais LENTO,
não a soma (que é ~12min de CPU). Quem quiser encurtar o PR tem dois alvos, e só
dois:

- **cache frio: o job de imagens**, onde 195s dos 295s são o `docker buildx bake`
  — o maior item isolado de todo o CI, 3× o segundo. O bakefile já constrói as
  quatro em paralelo com cache `type=gha` por imagem, e o comentário no topo dele
  mede por que quebrar em matriz de jobs seria PIOR: 1,7 GB de imagens por
  artifact custa mais que o build, e o smoke precisa das quatro no mesmo daemon;
- **cache quente: `Testes TS`**, onde 91s dos 159s são `pnpm --filter api test`,
  serializado por `fileParallelism: false` em `apps/api/vitest.config.ts` — os
  specs compartilham a `brabo_test` e dão TRUNCATE entre testes. Paralelizar
  exige banco ou schema por worker, não a flag.

> **Dividir job para paralelizar tem dois custos que o número não mostra.** O
> primeiro: o nome do job **é** o nome do check required, então dividir
> `Testes TS (api + web)` em três apagaria um check required — que nunca mais
> reporta e trava todo PR para sempre (é a mesma armadilha da nota mais abaixo).
> Preservar o nome exigiria um job de fan-in com `needs:`, ou mexer em Settings.
>
> O segundo: **medido, o ganho não estava lá.** Cada job novo repaga `checkout` +
> `setup-node` + `pnpm install` (~25s) e, no caso da api, o container de Postgres
> (13s). Dividir os 159s dá ~150s, porque os 91s do teste da api continuam
> inteiros e carregam o setup de qualquer jeito. **~7s** de ganho para gastar um
> check required e um job a mais — não se paga. O que paga é atacar os 91s.

> **`pull_request_target` exige o workflow na branch PADRÃO.** Não basta estar
> na branch base do PR. Isso foi medido, não suposto: com `pull_request_target`
> o `pr-police` teve **zero execuções**, enquanto `approval-ladder` e
> `docs-check` — que usam `pull_request` — rodaram normalmente do mesmo commit.
> Como a padrão é `main` e ela só avança pela escada que o próprio check
> guarda, o gatilho seria ovo e galinha. Os dois usam `pull_request`.

> **De onde o GitHub lê cada workflow — três famílias, três respostas.** Isto
> custou três descobertas separadas nesta fase, e não está óbvio em lugar
> nenhum:
>
> | gatilho | lê o workflow de | consequência aqui |
> |---|---|---|
> | `pull_request`, `push` | a **branch do evento** | funciona desde o primeiro PR |
> | `pull_request_target` | a **branch padrão** | não rodava: `main` está atrás |
> | `workflow_dispatch` | a **branch padrão** | nem aparece na lista de workflows |
>
> Os dois últimos criam um ovo-e-galinha quando a padrão está desatualizada: o
> workflow que faz a esteira andar precisa já estar na `main` para poder ser
> disparado. A saída foi rodar o script do `promote` à mão na primeira
> promoção — o mesmo script, só o gatilho manual. Depois que a `main` recebe os
> workflows, o dispatch funciona para sempre.

> **Um check required que nunca roda trava o PR para sempre.** É por isso que o
> gatilho do `ci.yml` cobre as três permanentes — antes da FASE 6 ele só
> disparava em PR para `dev`, e exigir estes checks numa promoção `dev→qa`
> produziria um PR eternamente pendente. O gatilho de `push` foi removido: com
> `pull_request` cobrindo tudo, ele só duplicava execução. Ao
> acrescentar job novo ao CI, ou ele entra nesta lista, ou fica de fora de
> propósito e alguém escreve por quê.

> **E um check required que não RE-roda cola um veredito velho.** É o outro
> lado da lição acima, e custou um PR reprovado por engano.
>
> Os default do `pull_request` são `opened`, `reopened` e `synchronize` — nada
> ali cobre **mudar a base**. E mudar a base é rotina: o GitHub abre o PR
> contra a branch padrão, o autor corrige para `dev` em seguida. No PR #71 o
> `Drift, gerados e build` correu na primeira meia dúzia de segundos, contra
> `origin/main...HEAD`, e reprovou por sete arquivos que já tinham sido
> revisados e mesclados no #70. O retarget não o reexecutou; o vermelho ficou.
>
> O critério para saber quem precisa de `edited` é **de que o check depende**:
>
> | o check depende de… | precisa de `edited`? | quem |
> |---|---|---|
> | só o HEAD | não | `ci.yml` — testa o commit, e a base não muda o resultado |
> | a BASE, ou o CORPO do PR | **sim** | `pr-police`, `approval-ladder`, `promotion-check`, `backmerge-gate`, `docs-check` |
>
> No `docs-check` são as duas coisas: o drift compara um range que começa na
> base, e lê o corpo atrás da linha `docs-not-needed:`. Sem `edited`, o escape
> hatch documentado logo abaixo era inalcançável — escrever a justificativa no
> corpo não reavaliava nada, e só um commit de mentira destravava o PR.

**`claude-review` fica de fora desta lista de propósito**, e este é o "alguém
escreve por quê": revisão de LLM é opinativa e custa token, então ela informa o
PR sem poder travá-lo. Como não é required, o job pode ser pulado sem deixar PR
pendente — e é pulado em PR de promoção, que o `github-actions[bot]` abre. O
action se recusa a rodar com ator não-humano (*"Workflow initiated by non-human
actor"*), e mesmo que rodasse seria a mesma diff revisada de novo: a promoção
só carrega commits já revisados no PR para `dev`. Sem esse `if`, o check falha
em toda promoção — foi o que aconteceu nos PRs #64 e #65 do ciclo `v0.3.1`.

### O que um PR entre permanentes não pode satisfazer

`Drift, gerados e build` **é** required, então ele roda em todo PR — mas o passo
do **drift** se declara inaplicável quando o head é uma permanente do próprio
repositório (promoção `dev→qa`, `qa→main`; retropropagação `main→qa`, `qa→dev`).
Os outros passos do job — docmap, gerados e build do site — continuam rodando:
dependem só do HEAD, e valem em qualquer degrau.

O motivo é o mesmo do `claude-review`, com um agravante. Redundância, primeiro:
um PR entre permanentes não tem **autoria**, ele empacota commits cujo drift já
foi cobrado no PR para `dev`, arquivo por arquivo. Cobrar de novo é cobrar a
mesma dívida em cada degrau. Mas, diferente da revisão de LLM, aqui a exigência
era **insatisfazível** — e foi ela que reprovou o #72, promoção do ciclo
`v1.0.1`, por arquivos `docker/**` que vieram do #70:

| a saída aparente | por que não existe |
|---|---|
| atualizar a doc no PR de promoção | o `promotion-check` exige **range limpo** — o head tem que ser o tip da origem. Commitar ali reprova o outro check required |
| repetir o `docs-not-needed:` do PR original | o corpo do PR de promoção é gerado pelo `promote`; a justificativa do #70 não atravessa o degrau |
| pôr a label em toda promoção | é ensinar a usar o escape hatch por reflexo, até ele não significar mais nada — o oposto do que o `.docmap.yml` pede |

O filtro fica **dentro** do passo, não num `if:` do job, pelo mesmo princípio
que o `promotion-check` registra: check required indexado por sha que não roda
deixa PR pendente para sempre. O passo roda, decide que não se aplica, e escreve
isso no resumo — em vez de sumir.

> **Head chamado `main` vindo de fork não é promoção.** É branch de trabalho de
> terceiro, e passa pelo drift como qualquer outra. Por isso a condição casa o
> nome **e** exige mesmo repositório — a mesma ressalva que o `pr-police` faz ao
> classificar a família do PR.

### Bypass

| quem | modo | para quê |
|---|---|---|
| o ator do `BRABO_BOT_TOKEN` | `Always` | escrever `.release/gate.json` em `main` |

**Nenhuma pessoa tem bypass** — nem o owner. Este é do bot, e existe por um
motivo que não tem contorno: o gate trava as branches, e um PR para abrir a
trava seria barrado pelo próprio gate. O commit fica no `git log`, com data e
conteúdo, e o `tag-release` o reconhece pelo que ele mexe (`.release/` e nada
mais), não por quem diz ser.

> **Aviso sobre o alcance do bypass.** Rulesets do GitHub concedem bypass ao
> **ator**, não a um caminho: quem pode escrever `.release/gate.json` em `main`
> pode, tecnicamente, escrever qualquer coisa. Não há como restringir por path
> na interface. O que limita de fato é o workflow — ele só escreve aquele
> arquivo — e o histórico, onde qualquer outro commit direto salta aos olhos.
> Registrado como o que é: uma limitação da ferramenta, não uma decisão.

### O segredo `BRABO_BOT_TOKEN`

PAT clássico com escopos `repo` + `workflow`, em **Settings → Secrets and
variables → Actions**:

```bash
gh secret set BRABO_BOT_TOKEN --body '<token>'
```

Ele não é conveniência. Duas coisas dependem dele, e as duas falham em
silêncio sem ele:

| o quê | por quê |
|---|---|
| a tag disparar a `Release` | **tag criada com `GITHUB_TOKEN` não dispara workflow** |
| os PRs de retropropagação nascerem com checks | **PR aberto com `GITHUB_TOKEN` não dispara workflow** |

É a regra do GitHub contra recursão, e ela já cobrou: a Release da `v0.2.0`
nunca publicou por isso. O segundo caso é pior — um PR de retropropagação sem
check nunca ficaria verde, e a cadeia travaria para sempre. Por isso o job da
trava **falha ruidosamente** quando o segredo não existe, em vez de seguir e
deixar o repositório num beco.

## Ruleset 2 — tags de versão

**Nome:** `tags-de-release`
**Enforcement:** `Active`
**Target:** Tag → `Include by pattern` → `v*`

| regra | valor |
|---|---|
| **Restrict creations** | ✅ |
| **Restrict updates** | ✅ |
| **Restrict deletions** | ✅ |

O padrão `v*` cobre as três formas que a esteira cria: `-dev.N`, `-qa.N` e a
final. Só o `tag-release` pode criá-las.

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
