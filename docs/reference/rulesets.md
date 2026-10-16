---
id: rulesets
title: Rulesets do repositório
sidebar_label: Rulesets
sidebar_position: 8
description: A configuração exata dos rulesets das três branches permanentes e das tags, para aplicação manual — o repositório versiona a fonte, o GitHub recebe a aplicação.
keywords: [rulesets, proteção de branch, checks obrigatórios, tags, release]
---

# Rulesets do repositório

Esta página é a **fonte versionada** da proteção. Aplicá-la no GitHub é um
passo **manual** — o repositório não tem como proteger a si mesmo, e essa
assimetria é intencional: quem afrouxa a proteção tem de ser uma pessoa, com
registro.

A política que estas regras aplicam está em
[Política de branches](../explanation/branching-policy.md).

> **Estado atual:** `gh api repos/daneiel/brabo/rulesets` devolve **0**.
> Nada aplicado ainda. Até lá, tudo aqui é intenção declarada, não proteção
> real.

## Pré-requisito: as três branches precisam existir

A escada tem três degraus, e um ruleset não mira o que não existe.

```bash
git fetch origin
git push origin origin/dev:refs/heads/qa
```

`dev` e `main` já existem. `qa` nasce de `dev` — a escada começa vazia e é
preenchida pelas promoções.

> A branch `rc` foi **removida** da escada. Se ela ainda existir no remoto de
> um clone antigo, apague-a: `git push origin --delete rc`. Uma branch
> permanente que não está na escada é um convite para uma PR mirar um degrau
> que não existe mais.

## Ruleset 1 — as três branches permanentes

**Nome:** `permanentes`
**Enforcement:** `Active`
**Alvo:** Branch → `Include by pattern`, três entradas: `dev`, `qa`, `main`

> Um ruleset para as três, não três rulesets: a exigência é idêntica em todas.
> O que difere entre degraus é **quem aprova**, e isso é decidido pelo
> `approval-ladder` a partir do destino, não pela proteção.

### Regras a marcar

| regra | valor | por quê |
|---|---|---|
| **Restrict deletions** | ✅ | apagar a `main` por acidente é irreversível pela interface |
| **Block force pushes** | ✅ | force-push numa branch permanente reescreve o que já foi promovido; a tag do degrau acabaria apontando para um commit inexistente |
| **Require a pull request before merging** | ✅ | esta é a regra central: nenhuma mudança entra sem PR |
| ↳ Required approvals | **0** | quem conta é o `approval-ladder`, que conhece o modo e o destino. O número nativo do GitHub não distingue `dev` de `main` |
| ↳ Dismiss stale approvals on push | ✅ | aprovação de um commit antigo não conta — o que foi aprovado não é o que vai ser mergeado |
| ↳ Require review from Code Owners | ✅ | o `CODEOWNERS` põe o dono como revisor de tudo |
| **Require status checks to pass** | ✅ | ver a lista abaixo |
| ↳ Require branches to be up to date | ❌ | forçaria um rebase a cada merge na `dev`; a CI já roda sobre o merge commit |
| **Block merge queue** | — | não usado |

**Required approvals = 0 não é afrouxamento.** O GitHub só sabe contar; ele
não sabe que a `main` exige PO + gestão e a `dev` exige um dev, nem que no modo
`solo` a PR do próprio dono passa sem revisão. Pôr `1` aqui **quebraria** o
modo solo: o dono não consegue aprovar a própria PR pela interface, e a PR
ficaria presa para sempre. A exigência real mora no `approval-ladder`, que é
check obrigatório — e check obrigatório não se burla.

### As duas configurações, lado a lado

O ruleset é o **mesmo** nos dois modos. O que muda é a variável — e é por isso
que a migração não passa por Settings → Rules.

| | `solo` (hoje) | `community` (futuro) |
|---|---|---|
| **Required approvals no ruleset** | **0** | **0** |
| quem exige | o check `Escada de aprovação` | o mesmo check |
| variáveis | `APPROVAL_MODE=solo`, `OWNER_HANDLE` | `APPROVAL_MODE=community`, `APROVADORES_*` |
| `dev` | 1 do dono | 1 × devs |
| `qa` | 1 do dono | 2 × devs |
| `main` | 1 do dono | 1 × PO + 1 × gestão |
| a PR do próprio dono | passa sem revisão | segue a escada como a de qualquer um |
| pessoas distintas | suspenso | vale na `main` |

**Required approvals fica em 0 nos dois casos, e isso é deliberado.** O
GitHub só sabe contar: não distingue `dev` de `main`, não conhece papéis e não
sabe que no modo solo a PR do próprio dono passa sem revisão. Pôr `1` ali
**quebraria o modo solo** — o dono não consegue aprovar a própria PR pela
interface, e toda PR dele ficaria presa para sempre. A exigência real mora no
check, que é obrigatório e não se burla.

Copie e cole para ativar cada modo:

```bash
# solo — what's in effect today
gh variable set APPROVAL_MODE --body solo
gh variable set OWNER_HANDLE  --body daneiel

# community — fill in the lists BEFORE flipping the switch
gh variable set APROVADORES_DEVS   --body "ana,bruno,carla"
gh variable set APROVADORES_PO     --body "paula"
gh variable set APROVADORES_GESTAO --body "gustavo"
gh variable set APPROVAL_MODE      --body community
```

### Checks obrigatórios

Nome **exato**, como o GitHub o registra (é o `name:` do job, não o do
workflow):

A coluna de duração é **medida**, não estimada — três execuções reais, cache
frio e quente. Ela existe para que "otimizar a CI" comece pelo número, não
pelo palpite. `*` marca uma linha medida a partir de uma única execução real
em vez de três — o job é novo (ou acabou de ser renomeado) e ainda não foi
reamostrado frio × quente; o mesmo número preenche as duas colunas até ser.

| check | workflow | frio | quente |
|---|---|---|---|
| `Build, scan e smoke das imagens de produção` | `ci.yml` | **295s** | 109s |
| `Testes TS (api)` | `ci.yml` | 177s\* | **177s**\* |
| `Testes TS (web)` | `ci.yml` | 169s\* | **169s**\* |
| `Testes TS (pacotes)` | `ci.yml` | 56s\* | **56s**\* |
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

**Depois da AT-303..306 (só mudanças gratuitas, sem runner pago).** Os nomes
da tabela acima **não** mudaram — um check obrigatório renomeado trava toda
PR — e os números acima são o ANTES. O que mudou por baixo:

- **`Build, scan e smoke das imagens de produção` pula os passos pesados
  quando o diff não toca imagem** (AT-303). O primeiro passo classifica o
  diff da PR com `scripts/ci/diff-toca-imagem.ts` (uma lista de permitidos do
  que nunca entra numa imagem, no smoke ou no E2E: `docs/` exceto
  `docs/gates.yml`, `website/`, `scripts/docs/`, `deploy/k8s/`, `.github/`
  exceto `ci.yml`, `*.md` da raiz exceto `THIRD_PARTY_NOTICES.md`,
  `design/*.md`; o spec prova a lista contra os Dockerfiles reais, por
  mutação). Bake, Trivy, broker, smoke e E2E levam `if:` **por passo**, e o
  job sempre termina — verde, dizendo por quê no resumo do job. Nunca
  `paths:` no gatilho nem `if:` no job: os dois deixariam o check obrigatório
  pendente ou colado num veredito velho. Na dúvida (diff vazio, HEAD que não é
  o merge commit da PR, `git diff` falhando) roda tudo.
- **O mesmo job guarda em cache o navegador do Playwright, o store do pnpm de
  `e2e/` e o banco do Trivy** (AT-304) — ver
  [o que o job de imagens guarda em cache](../explanation/cadeia-de-suprimentos-do-ci.md#images-job-caches).
- **`Testes TS (api)` e `Testes TS (web)` viraram AGREGADORES de dois shards
  cada** (AT-305). Os jobs `Testes TS (api) — shard N/2` e `Testes TS
  (web) — shard N/2` rodam metade dos arquivos cada, com cobertura mas com o
  piso zerado, e escrevem um relatório `blob` do vitest; o agregador — que
  mantém o nome obrigatório — confere que os dois shards terminaram `success`,
  que os dois relatórios chegaram, e roda `vitest --merge-reports --coverage`,
  que aplica os `coverage.thresholds` INALTERADOS de
  `vitest.config.ts`/`vite.config.ts` à cobertura mesclada (medido
  localmente: cobertura mesclada idêntica à da execução única). O agregador
  tem `if: always()` de propósito: sem ele um shard vermelho o deixaria
  `skipped`, e `skipped` conta como verde para um check obrigatório. Os nomes
  dos shards **não** são checks obrigatórios e não devem ser listados num
  ruleset. O typecheck roda só no shard 1.
- **`Testes do engine (ExUnit)` e os shards da api esperam um job novo,
  `imagens / Ler as imagens do compose`** (ADR 0197): ele lê a referência do
  pgvector de `docker/docker-compose.yml` e a entrega aos `services:` deles,
  então nenhum workflow guarda literal de imagem. Ele **não** é check
  obrigatório e não deve ser listado num ruleset — o que ele decidir aparece
  nos jobs que dependem dele. Esses jobs levam `if: ${{ !cancelled() }}` pelo
  mesmo motivo dos agregadores acima: se `imagens` falhasse, o padrão PULARIA
  `Testes do engine (ExUnit)`, e `skipped` conta como verde para um check
  obrigatório; com ele o job roda, recebe uma imagem vazia e falha.
- `claude-code-review.yml` ganhou `concurrency` (cancel-in-progress, por PR) e
  `timeout-minutes: 30`; `docs-check.yml` ganhou `timeout-minutes` nos dois
  jobs (AT-306).

| check | antes, frio | antes, quente | depois, frio | depois, quente | depois, PR só de docs |
|---|---|---|---|---|---|
| `Build, scan e smoke das imagens de produção` | 295s | 109s | TODO(humano) | TODO(humano) | TODO(humano) |
| `Testes TS (api)` (shards + agregador, tempo de relógio) | 177s | 177s | TODO(humano) | TODO(humano) | — |
| `Testes TS (web)` (shards + agregador, tempo de relógio) | 169s | 169s | TODO(humano) | TODO(humano) | — |

> **TODO(humano):** preencher as colunas "depois" com as execuções desta
> própria PR (frio: o primeiro push; quente: uma reexecução do mesmo commit;
> só de docs: uma PR que só toca `docs/`), e então levar os números para a
> tabela principal.

**Consequência para o critério de `edited` abaixo:** o job de imagens agora
depende também da BASE (o diff é tirado contra ela), enquanto o `ci.yml` segue
sem reexecutar em `edited`. A única direção insegura é uma PR que pulou as
imagens contra uma base e depois é redirecionada para uma base onde o diff
dela tocaria imagem — raro, já que promoções rodam a partir das pontas das
branches permanentes (cujo diff sempre toca algo) e redirecionamentos costumam
encolher o diff. O próximo push reclassifica.

**O `ci.yml` é paralelo, exceto pelos dois agregadores** — `test-api` e
`test-web` têm `needs` nos seus shards, nada mais tem `needs:`.
O veredito completo da PR custa a cadeia MAIS LENTA, não a soma (que é ~12min
de CPU). Antes da AT-303..305, quem quisesse encurtar a PR tinha dois alvos, e
só dois:

- **cache frio: o job de imagens**, onde 195s dos 295s são o
  `docker buildx bake` — o maior item isolado de toda a CI, 3× o segundo. O
  bakefile já constrói as quatro em paralelo com cache `type=gha` por imagem,
  e o comentário no topo dele mede por que quebrá-lo numa matriz de jobs
  seria PIOR: 1,7 GB de imagens por artefato custa mais que o build, e o smoke
  precisa das quatro no mesmo daemon;
- **o antigo job `Testes TS (api + web)`**, onde 91s dos 159s eram
  `pnpm --filter api test`, serializado por `fileParallelism: false` em
  `apps/api/vitest.config.ts` porque os ~80 specs que tocam o banco
  compartilhavam UM `brabo_test` e rodavam TRUNCATE entre testes — chegadas em
  paralelo colidiriam. Isso foi corrigido
  (`perf/banco-por-worker-nos-testes-da-api`, CHANGELOG): cada worker do
  Vitest ganha o PRÓPRIO banco — `test/support/global-setup.ts` migra um
  TEMPLATE uma vez e clona um banco por worker via
  `CREATE DATABASE ... TEMPLATE` (barato, uma cópia de páginas, não uma
  reexecução de migrations), `test/support/test-db-name.ts` resolve a qual
  deles um spec se conecta a partir de `VITEST_POOL_ID`, e `vitest.config.ts`
  liga `fileParallelism: true` com `maxWorkers: 4` (fixo nas 4 vCPU do runner,
  não autodetectado — o número tem de ser o MESMO numa máquina de dev com mais
  núcleos e no runner, senão o comportamento medido localmente não é o que
  roda lá). Medido localmente: a duração da própria suíte da api caiu de
  792,58s para 471,23s numa execução limpa (~40%, três repetições sem
  instabilidade). Reamostrado no runner hospedado do GitHub de verdade (PR
  #491, `ci.yml`): o próprio passo `pnpm --filter api test` caiu para **96s**
  — bem no piso de `91s` de cache quente que esta tabela citava como o melhor
  caso teórico, não um ponto fora da curva de sorte.

  Essa correção mudou a forma do job onde ela rodava, e foi isso que tornou
  possível o SEGUNDO corte. O passo de testes do próprio `apps/web` tinha
  crescido para 125s na mesma execução que mediu os `343s` totais do job (PR
  #494, job `101317149006`) — não mais a cauda pequena que o destaque abaixo
  descrevia, mas um par do da api. `perf/paraleliza-testes-ts` (CHANGELOG)
  dividiu o job em três paralelos — `test-api` (mantém o serviço `postgres` e
  o ambiente `DATABASE_URL`/`TEST_DATABASE_URL`, já que é o único que toca o
  banco), `test-web` e `test-packages` (scripts de CI, porta de Docker,
  broker, runner — os seis componentes que nunca precisaram de Postgres) —,
  cada um com o próprio `checkout` + `setup-node` + `pnpm install`. Medido no
  runner hospedado do GitHub de verdade (PR #495, `ci.yml`): **177s**
  (`test-api`), **169s** (`test-web`), **56s** (`test-packages`), contra
  **343s** do job que eles substituíram — o check que segurava a PR agora é o
  MAIS LENTO dos três, não a soma deles, um corte real de **~48%**.

  `test-web` e `test-packages` foram estáveis em todas as execuções desta PR
  (164–169s e 55–56s). `test-api` não: um segundo push o mediu em **388s** —
  pior que os 343s totais do job antigo — com todos os passos ainda verdes, e
  depois uma simples reexecução do MESMO commit mediu **172s**. Três amostras
  reais de `test-api` nesta PR: 177s, 388s, 172s. Duas de três caem onde
  `test-web` e `test-packages` caem (com folga dentro da meta de ~4min); a
  execução de 388s é coerente com disputa de runner compartilhado do lado do
  GitHub, e não com uma regressão da divisão — nada no job mudou entre aquela
  execução e a reexecução que mediu 172s. Registrado como observado, não
  suavizado: quem for atrás da próxima execução lenta de `test-api` deve saber
  que essa variação já existia no dia em que o job foi dividido, e conferir
  disputa antes de supor uma regressão nova.

> **O aviso dos "dois custos" que morava aqui não vale mais — as duas
> premissas mudaram.** Ele dizia que dividir `Testes TS (api + web)` iria (1)
> apagar um check obrigatório ao renomeá-lo, travando toda PR para sempre a
> menos que um job de fan-in ou uma mudança em Settings preservasse o nome, e
> (2) não compensar, porque os 91s da api carregariam o setup não importa em
> quantos jobs fosse dividido, por um ganho líquido de ~7s.
>
> A premissa 2 deixou de ser verdade quando a suíte do web cresceu até custar
> o mesmo que a da api — dividir três componentes de tamanho comparável, e não
> um grande mais caudas pequenas, é o que transforma "≈150s contra 159s" em
> "177s contra 343s". A premissa 1 deixou de valer por um motivo ortogonal:
> **nenhum ruleset está aplicado a este repositório ainda** — `gh api
> repos/daneiel/brabo/branches/dev/protection` ainda devolve `404`, igual à
> nota de "Estado atual" no topo desta página —, então não havia check
> obrigatório a apagar. A tabela de checks obrigatórios acima já reflete o
> novo nome. **Se um ruleset for aplicado algum dia**, liste `Testes TS (api)`,
> `Testes TS (web)` e `Testes TS (pacotes)` — nunca o nome aposentado `Testes TS
> (api + web)`, que não casaria com nada em silêncio e travaria toda PR
> futura, exatamente como o aviso geral mais abaixo descreve.

> **O nome do check é menor do que aquilo que ele guarda.** `Drift, gerados e
> build` são três coisas no título e **cinco** gates no job: integridade do
> `.docmap.yml`, gerados em dia, drift, build do site e — desde que a
> referência da API foi publicada quebrada em duas releases — **a referência
> da API renderiza** (`scripts/docs/api-render-check.mjs`).
>
> Este último existe porque build verde não é página que renderiza: o MDX
> compila, o SSR escreve o conteúdo, o `docs:build` passa, e a página morre na
> hidratação no navegador. O mecanismo inteiro está em
> `docs/explanation/documentation-workflow.md`. Ao acrescentar um gate a este
> job, o nome do check **não** muda — e é por isso que ele não precisa ser
> reinscrito na tabela acima, mas precisa estar escrito em algum lugar. Está
> aqui.

> **`pull_request_target` exige que o workflow esteja na branch DEFAULT.**
> Estar na branch de base da PR não basta. Isso foi medido, não suposto: com
> `pull_request_target`, o `pr-police` teve **zero execuções**, enquanto o
> `approval-ladder` e o `docs-check` — que usam `pull_request` — rodaram
> normalmente a partir do mesmo commit. Como a default é a `main` e ela só
> avança pela escada que o próprio check guarda, o gatilho seria um problema
> de ovo e galinha. Os dois usam `pull_request`.

> **De onde o GitHub lê cada workflow — três famílias, três respostas.** Isso
> custou três descobertas separadas durante esta fase, e não está óbvio em
> lugar nenhum:
>
> | gatilho | lê o workflow de | consequência aqui |
> |---|---|---|
> | `pull_request`, `push` | a **branch do evento** | funciona desde a primeira PR |
> | `pull_request_target` | a **branch default** | não rodava: a `main` está atrás |
> | `workflow_dispatch` | a **branch default** | nem aparece na lista de workflows |
>
> Os dois últimos criam um problema de ovo e galinha quando a branch default
> está desatualizada: o workflow que faz a esteira andar precisa já estar na
> `main` para poder ser disparado. O contorno foi rodar o script `promote` à
> mão na primeira promoção — o mesmo script, só o gatilho manual. Depois que a
> `main` recebe os workflows, o dispatch funciona para sempre.

> **Um check obrigatório que nunca roda trava a PR para sempre.** É por isso
> que o gatilho do `ci.yml` cobre as três branches permanentes — antes da
> FASE 6 ele só disparava em PRs para a `dev`, e exigir estes checks numa
> promoção `dev→qa` produziria uma PR eternamente pendente. O gatilho `push`
> foi removido: com `pull_request` cobrindo tudo, ele só duplicava execuções.
> Ao acrescentar um job novo à CI, ou ele entra nesta lista, ou fica de fora
> de propósito e alguém escreve por quê.

> **E um check obrigatório que não REEXECUTA fica colado num veredito
> velho.** Este é o outro lado da lição acima, e custou a uma PR uma falha
> equivocada.
>
> Os padrões de `pull_request` são `opened`, `reopened` e `synchronize` —
> nenhum deles cobre **mudar a base**. E mudar a base é rotina: o GitHub abre
> a PR contra a branch default, e o autor depois a corrige para a `dev`. Na PR
> #71, `Drift, gerados e build` rodou nos primeiros meia dúzia de segundos,
> contra `origin/main...HEAD`, e falhou em sete arquivos que já tinham sido
> revisados e mergeados na #70. O redirecionamento não o reexecutou; o
> vermelho ficou.
>
> O critério para saber quem precisa de `edited` é **do que o check
> depende**:
>
> | o check depende de… | precisa de `edited`? | quem |
> |---|---|---|
> | só do HEAD | não | `ci.yml` — testa o commit, e a base não muda o resultado (exceto a decisão de pular do job de imagens desde a AT-303 — ver "Consequência para o critério de `edited`" acima) |
> | da BASE, ou do CORPO da PR | **sim** | `pr-police`, `approval-ladder`, `promotion-check`, `backmerge-gate`, `docs-check` |
>
> No `docs-check` são as duas coisas: o drift compara um intervalo que começa
> na base, e lê o corpo atrás da linha `docs-not-needed:`. Sem `edited`, a
> válvula de escape documentada logo abaixo era inalcançável — escrever a
> justificativa no corpo não reavaliava nada, e só um commit falso destravaria
> a PR.

**O `claude-review` fica de fora desta lista de propósito**, e este é o
"alguém escreve por quê": revisão por LLM é opinativa e custa tokens, então
ela informa a PR sem poder bloqueá-la. Como não é obrigatório, o job pode ser
pulado sem deixar a PR pendente — e ele é pulado em toda PR aberta por um
**bot**. A action se recusa a rodar com ator não humano (*"Workflow initiated
by non-human actor: &lt;name&gt; (type: Bot)"*), então sem esse `if` o check falha
toda vez. Isso aconteceu duas vezes: nas PRs #64 e #65 do ciclo `v0.3.1`
(promoção, abertas por `github-actions[bot]`) e de novo na PR #526
(Dependabot).

A segunda vez foi consequência de **como** a condição estava escrita. Ela
enumerava um login — `github-actions[bot]` —, o que está certo até o conjunto
mudar, e errado em silêncio no dia em que aparece um bot novo; o
`dependabot.yml` chegou na PR #520 e a PR seguinte do Dependabot reproduziu a
falha cuja lição já estava escrita. A condição agora testa o `type` do autor,
espelhando `ehAutorBot` (`scripts/ci/pr-police.ts`), com o sufixo `[bot]` do
login como rede de segurança — o GitHub não permite `[` num login humano,
então ele não se forja.

Para PRs de promoção há um segundo motivo, independente: seria o mesmo diff
revisado de novo, já que a promoção só leva commits já revisados na PR para a
`dev`. E para o Dependabot há um terceiro, que fecha a porta sozinho — as PRs
dele rodam com o **cofre de segredos do Dependabot**, separado do das
Actions, então `CLAUDE_CODE_OAUTH_TOKEN` chega vazio. Mesmo permitindo o ator,
a revisão não teria credencial, e um check que falha por falta de segredo é
pior que um pulado: ele se lê como defeito de código.

### O que uma PR entre branches permanentes não consegue cumprir

`Drift, gerados e build` **é** obrigatório, então roda em toda PR — mas o
passo de **drift** se declara inaplicável quando o head é uma branch
permanente do próprio repositório (promoção `dev→qa`, `qa→main`; back-merge
`main→qa`, `qa→dev`). Os outros passos do job — docmap, gerados e build do
site — continuam rodando: só dependem do HEAD, e valem em qualquer degrau.

O motivo é o mesmo do `claude-review`, com um agravante. Redundância,
primeiro: uma PR entre branches permanentes não tem **autoria**, ela empacota
commits cujo drift já foi cobrado na PR para a `dev`, arquivo por arquivo.
Cobrar de novo é cobrar a mesma dívida em cada degrau. Mas, ao contrário da
revisão por LLM, aqui a exigência era **impossível de cumprir** — e foi o que
reprovou a #72, a promoção do ciclo `v1.0.1`, por arquivos de `docker/**` que
vieram da #70:

| a saída aparente | por que ela não existe |
|---|---|
| atualizar a doc na PR de promoção | o `promotion-check` exige um **intervalo limpo** — o head tem de ser a ponta da origem. Commitar ali reprova o outro check obrigatório |
| repetir o `docs-not-needed:` da PR original | o corpo da PR de promoção é gerado pelo `promote`; a justificativa da #70 não atravessa o degrau |
| pôr o rótulo em toda promoção | é ensinar a usar a válvula de escape por reflexo, até ela não significar mais nada — o contrário do que o `.docmap.yml` pede |

O filtro mora **dentro** do passo, não num `if:` no job, seguindo o mesmo
princípio que o `promotion-check` registra: um check obrigatório indexado por
sha que não roda deixa a PR pendente para sempre. O passo roda, decide que não
se aplica e escreve isso no resumo — em vez de sumir.

> **Um head chamado `main` vindo de um fork não é promoção.** É a branch de
> trabalho de um terceiro, e passa pelo drift como qualquer outra. É por isso
> que a condição casa o nome **e** exige o mesmo repositório — a mesma
> ressalva que o `pr-police` aplica ao classificar a família da PR.

### Bypass

| quem | modo | para quê |
|---|---|---|
| o ator do `BRABO_BOT_TOKEN` | `Always` | escrever `.release/gate.json` na `main` |

**Nenhuma pessoa tem bypass** — nem o dono. Este é do bot, e existe por um
motivo sem contorno: o gate trava as branches, e uma PR para abrir a trava
seria bloqueada pelo próprio gate. O commit fica no `git log`, com data e
conteúdo, e o `tag-release` o reconhece pelo que ele toca (`.release/` e nada
mais), não por quem ele diz ser.

> **Aviso sobre o alcance do bypass.** Os rulesets do GitHub concedem bypass
> ao **ator**, não a um caminho: quem consegue escrever `.release/gate.json`
> na `main` consegue, tecnicamente, escrever qualquer coisa. Não há como
> restringir por caminho na interface. O que de fato limita é o workflow — ele
> só escreve aquele arquivo — e o histórico, onde qualquer outro commit direto
> salta aos olhos na hora. Registrado pelo que é: uma limitação da ferramenta,
> não uma decisão.

### O segredo `BRABO_BOT_TOKEN`

PAT clássico com os escopos `repo` + `workflow`, em **Settings → Secrets and
variables → Actions**:

```bash
gh secret set BRABO_BOT_TOKEN --body '<token>'
```

Não é conveniência. Duas coisas dependem dele, e as duas falham em silêncio
sem ele:

| o quê | por quê |
|---|---|
| a tag disparar o `Release` | **uma tag criada com `GITHUB_TOKEN` não dispara workflow** |
| as PRs de back-merge nascerem com checks | **uma PR aberta com `GITHUB_TOKEN` não dispara workflow** |

É a regra do GitHub contra recursão, e ela já cobrou o preço: a Release da
`v0.2.0` nunca foi publicada por causa dela. O segundo caso é pior — uma PR de
back-merge sem check nunca ficaria verde, e a cadeia travaria para sempre. É
por isso que o job do gate **falha alto** quando o segredo não existe, em vez
de seguir e deixar o repositório num beco sem saída.

O escopo `workflow` não é exagero: as PRs de back-merge levam a branch
inteira, e ela pode conter uma mudança em `.github/workflows/**`. Sem esse
escopo o push é recusado exatamente no caso que mais importa — propagar uma
correção de CI.

> **Estado atual: configurado e exercitado.** Na `v1.1.1` a esteira fechou
> sozinha pela primeira vez — o `tag-release` pulou o passo de aviso, empurrou
> a tag com o PAT, e isso **disparou** o `release.yml`, que publicou a Release.
> Uma tag empurrada com `GITHUB_TOKEN` não o dispararia; esse disparo é a prova
> de que o token é válido e tem escopo de push.
>
> **Seis tags seguem órfãs** — `v0.2.0`, `v0.3.0`, `v0.3.1`, `v1.0.0`,
> `v1.0.1` e `v1.1.0` — do período em que o segredo não existia. O PAT não as
> recupera: ele só vale para tags novas. Para elas, o procedimento está abaixo.

### Republicando uma tag que ficou órfã {#republishing-a-tag-that-was-orphaned}

O `release.yml` tem `workflow_dispatch` com uma entrada de tag, e ele existe
por causa das seis acima. Só o gatilho `push: tags` tornaria a falha
**irreversível**: republicar exigiria apagar e recriar a tag, isto é,
reescrever o registro para corrigir o efeito dele.

```bash
gh workflow run release.yml -f tag=v1.1.0
```

Três guardas, e cada uma existe por causa de um modo de falha concreto:

| guarda | contra o quê |
|---|---|
| só o `OWNER_HANDLE` pode dispará-lo (modo `solo`) | mesma restrição do `promote`; o gatilho de push não passa por aqui, porque ali quem autorizou foi a tag |
| a entrada tem de casar `^v[0-9]+\.[0-9]+\.[0-9]+$` | `workflow_dispatch` aceita texto livre. Sem isso, `-qa.1` publicaria uma Release de algo que ninguém validou como final |
| recusa se a Release já existe | uma nota publicada é um registro; sobrescrevê-la em silêncio apagaria o que alguém já leu ou linkou |

E o `checkout` é feito **na tag**, não na ref do evento. Num dispatch,
`github.ref_name` é a branch default — sem esse cuidado, republicar geraria
uma Release chamada `main`, com o changelog da `main`, sem erro nenhum.

> **O dispatch só funciona depois que isto chega à `main`.** É o problema de
> ovo e galinha da tabela de gatilhos acima: `workflow_dispatch` lê o workflow
> da branch **default**. Enquanto a mudança está só na `dev`, a entrada nem
> aparece.

## Ruleset 2 — tags de versão

**Nome:** `tags-de-release`
**Enforcement:** `Active`
**Alvo:** Tag → `Include by pattern` → `v*`

| regra | valor |
|---|---|
| **Restrict creations** | ✅ |
| **Restrict updates** | ✅ |
| **Restrict deletions** | ✅ |

O padrão `v*` cobre as três formas que a esteira cria: `-dev.N`, `-qa.N` e a
final. Só o `tag-release` pode criá-las.

> **O que uma tag final roda, e por que nada disso é check obrigatório.**
> Empurrar `vX.Y.Z` dispara `release.yml`, `build-runner-binaries.yml` e
> `publish-runner.yml` em paralelo. Os jobs deles nunca aparecem na tabela de
> checks obrigatórios acima, e isso é estrutural e não omissão: checks
> obrigatórios seguram uma **pull request**, e quando uma tag existe a PR já
> foi mergeada. O que segura a tag é o ruleset — só o `tag-release` a cria, e
> só depois da esteira ao fim da qual ele roda.
>
> Uma tag final também dispara o `install-e2e.yml`, que exercita o
> `install.sh` publicado numa **máquina limpa** — que é o que um runner
> efêmero das Actions é. Desde a [RN-549](../business-rules.md#rn-549) ele vai
> até o fim: os cinco elos que fecham a instalação, o agente local de pé e
> esperando, e o primeiro projeto `runner` sendo pego. Ele não roda em
> `pull_request`, e o motivo é o mesmo que mantém a assinatura fora das PRs: o
> manifesto assinado só existe depois de uma tag final, e fazer o script rodar
> ali seria dar a ele uma porta para pular a verificação
> ([RN-534](../business-rules.md#rn-534)). A consequência é dita em vez de
> escondida — **a PR que escreve uma mudança neste workflow não o roda** —, e o
> que roda em toda PR é `scripts/dev/install-e2e.spec.ts`, que reprova se o
> gatilho ganhar `pull_request` ou se uma frase que o workflow procura com grep
> deixar de existir no `install.sh`.
>
> Desde o [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md), o
> `build-runner-binaries.yml` tem **dois** jobs em vez de um: a matriz `build`
> (quatro alvos, `fail-fast: false`) e um job `checksums`. Desde a
> [RN-565](../business-rules.md#rn-565) o segundo não tem `needs:` na matriz —
> ele espera, com teto, pelos **assets** da Release e não pelo job mais lento —,
> então um alvo que falhou no build, ou nunca ganhou runner, não nega aos
> outros um manifesto assinado. Ele nomeia no log quais alvos o manifesto
> **não** cobre, porque um `checksums.txt` que lista três e se cala sobre o
> quarto é pior que nenhum: quem verifica os três conclui que verificou a
> release.
>
> O alvo `darwin-x64` (Mac Intel) **saiu da matriz** no
> [ADR 0174](../adr/0174-runner-sem-binario-darwin-x64.md), e a causa é medida
> (AT-065, 2026-09-13): o rótulo `macos-13` dele apontava para uma imagem que o
> GitHub aposentou em dezembro de 2025, e o substituto Intel,
> `macos-15-intel`, é agendado em segundos e constrói, mas reprova o
> `--self-test-pty` sob o Bun (o `onData` do `node-pty` nunca dispara —
> oven-sh/bun#25822, aberto). A mesma prova passa sob o Node, então um Mac
> Intel instala o runner com `npm install -g @brabo/runner`. Uma execução do
> workflow com a entrada `tag` vazia é um ensaio: constrói e faz o smoke sem
> anexar nada, e foi assim que isso foi medido sem cortar uma tag.

### Bypass

| quem | modo |
|---|---|
| o app/bot que roda o workflow de release | `Always` |

Esta é a exceção de push que a política prevê: **uma versão nasce de um
workflow, nunca à mão**. Uma tag criada à mão não passa pela verificação de
que a tag final aponta para o mesmo commit do último `-qa.N`, e é exatamente
essa verificação que impede publicar algo diferente do que foi validado.

## Como aplicar

Interface: **Settings → Rules → Rulesets → New ruleset**.

Pela API, se preferir versionar o comando:

```bash
gh api -X POST repos/daneiel/brabo/rulesets --input ruleset-permanentes.json
gh api repos/daneiel/brabo/rulesets --jq '.[] | "\(.name): \(.enforcement)"'
```

> **TODO(humano):** os dois arquivos `.json` de payload não são versionados
> aqui porque a API de rulesets exige `repository_id` e ids de app que variam
> por instalação — um arquivo fixo seria copiado errado. Se quiser
> versioná-los, gere com
> `gh api repos/daneiel/brabo/rulesets/<id> > docs/reference/...` depois de
> aplicar pela interface, e este documento passará a apontar para eles.

## Settings → Pages: a fonte é a branch `gh-pages`

Aplicação **manual**, pelo mesmo motivo dos rulesets: o repositório versiona a
fonte, o GitHub recebe a aplicação.

**Settings → Pages → Build and deployment → Source:
`Deploy from a branch`**, com a branch **`gh-pages`** e a pasta
**`/ (root)`**.

**Já aplicado.** `gh api repos/daneiel/brabo/pages` devolve
`"build_type": "legacy"` com `source.branch: "gh-pages"`, e os três degraus
respondem no ar.

O passo intermediário vale o registro, porque confunde: enquanto o
`build_type` era `"workflow"`, o `docs-deploy.yml` commitava na `gh-pages`
**e o Pages não servia nada dali** — a publicação ficava no repositório sem ir
ao ar, com o site antigo ainda respondendo a partir do último artefato do
`actions/deploy-pages`. Nada na CI fica vermelho nesse estado.

Por que a troca é obrigatória e não preferência: o `actions/deploy-pages`
publica **um artefato como o site inteiro** e não sabe atualizar parte de uma
árvore, o que é incompatível com um subdiretório por degrau. O desenho
completo, as alternativas descartadas e a exceção de push que isso abre estão
no
[ADR 0034](../explanation/../adr/0034-documentacao-publicada-por-degrau.md).

| branch | URL | indexado |
|---|---|---|
| — (índice dos três) | `https://daneiel.github.io/brabo/` | ❌ `noindex, follow` |
| `main` | `https://daneiel.github.io/brabo/prd/` | ✅ |
| `qa` | `https://daneiel.github.io/brabo/qa/` | ❌ `noIndex` |
| `dev` | `https://daneiel.github.io/brabo/dev/` | ❌ `noIndex` |

Os três ficaram simétricos no
[ADR 0071](../adr/0071-publicacao-simetrica-por-degrau.md), que também explica
a raiz gerada e o `404.html` que encaminha links antigos ao degrau estável. O
[ADR 0073](../adr/0073-o-caminho-publicado-nomeia-o-ambiente.md) separou o
CAMINHO da BRANCH: a `main` publica em `/prd/`, porque o endereço nomeia o
ambiente para quem lê. O `404.html` passou a reescrever
`/brabo/main/<algo>` para `/brabo/prd/<algo>` — o diretório antigo sai da
árvore, e `keep_files: false` o remove.

**A configuração do Pages não muda com nenhum dos dois** — a fonte continua
sendo a branch `gh-pages` na pasta `/ (root)`; o que mudou é o conteúdo que o
workflow monta antes de empurrar. E `prd` **não é** uma branch: não está em
ruleset nenhum, não existe no `git`, e é só o nome de um diretório na
`gh-pages`.

> **A `gh-pages` NÃO entra no ruleset das branches permanentes.** Ela não é
> permanente, e o bot precisa empurrar nela — incluí-la travaria a própria
> publicação. É também por isso que o `GITHUB_TOKEN` basta ali, sem bypass e
> sem `BRABO_BOT_TOKEN`.

> **E ela fica fora do escopo do Gitleaks, por um motivo que só apareceu
> depois.** O `gitleaks detect` varre **todo commit alcançável**, não só o
> histórico do HEAD — e `fetch-depth: 0` traz todas as refs. Assim que a
> `gh-pages` nasceu, o site construído entrou na varredura: **112 achados
> `generic-api-key`** num único commit, todos em `dev/assets/js/*.js`, que são
> nomes de arquivo de avatar dentro de um bundle minificado com entropia alta
> demais para a regra. Isso reprovou a PR de promoção **#78**, a primeira
> varrida depois da estreia dela.
>
> O `ci.yml` agora apaga `refs/remotes/origin/gh-pages` antes de varrer.
> **Não** por uma allowlist de caminho no `.gitleaks.toml`: ela valeria para
> todo commit, e um `dev/` que um dia aparecesse no código-fonte deixaria de
> ser varrido em silêncio. Excluir a ref exclui exatamente os commits que não
> são fonte.
>
> Medido com o gitleaks 8.30.1, a versão da CI: 133 commits e 112 achados
> antes, 132 e nenhum depois — e um PAT do GitHub com entropia real plantado
> em `apps/api/src/` continua sendo detectado, o que prova que não se abriu um
> buraco.

## Os rótulos de família precisam existir

O `pr-police` aplica um dos quatro rótulos, e `gh pr edit --add-label`
**falha** se o rótulo não existe — o que deixaria a PR sem classificação, em
silêncio.

```bash
gh label create trabalho        --color 0E8A16 --description "Work PR: taxonomy prefix for dev"
gh label create promocao        --color 1D76DB --description "Promotion between adjacent rungs, going up"
gh label create retropropagacao --color 5319E7 --description "Back-propagation between adjacent rungs, going down"
gh label create correcao-alta   --color D93F0B --description "hotfix: a fix that's born high on the ladder"
```

Sem `|| true` de propósito: se o comando falhar, você precisa ver.

## Conferir que está de pé

```bash
# do the rulesets exist and are they active?
gh api repos/daneiel/brabo/rulesets --jq '.[] | "\(.name): \(.enforcement)"'

# does the protection respond? (should be REJECTED)
git push origin HEAD:dev
```

O segundo comando é o teste que importa. Um ruleset configurado mas não
conferido é indistinguível de um ruleset ausente — e a diferença só aparece no
dia em que alguém empurra direto na `main`.
