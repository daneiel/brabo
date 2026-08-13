---
id: git-providers
title: Providers de git
sidebar_label: Providers de git
sidebar_position: 5
description: O contrato de quinze operações que torna Local, GitHub e GitLab intercambiáveis, com capabilities, erros normalizados e política de retry.
keywords: [git, GitProvider, GitHub, GitLab, capabilities, retry]
---

# Providers de git

O Brabo trabalha sobre um repositório git real, e três backends servem esse
papel: **Local** (bare repos no disco), **GitHub** e **GitLab**. O código de
domínio não sabe qual está em uso — fala com um contrato só.

Decisões nos ADRs [0001](../adr/0001-git-provider-contract-shape.md) a
[0005](../adr/0005-repo-bootstrap-idempotent-steps.md) e
[0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md).

## O contrato

`GitProviderContract`, em `packages/shared/src/index.ts`. **Quinze operações** —
a décima entrou na Fase 4a, com os gates de PR; a 11ª e a 12ª na FASE 26, com a
aba Code (só leitura); a 13ª, a 14ª e a 15ª na FASE 26b, fundação das
pendências declaradas da mesma aba (blame, PRs navegáveis, branch rica —
nenhuma UI consumindo ainda):

| operação | devolve |
|---|---|
| `createRepo` | `GitRepo` |
| `getRepo` | `GitRepo` |
| `createBranch` | `GitBranch` |
| `protectBranch` | — |
| `listBranches` | `GitBranch[]` |
| `commitFiles` | `GitCommitResult` |
| `getFileContent` | `string \| null` — `null` se o arquivo (ou a branch) não existe |
| `openPullRequest` | `GitPullRequest` |
| `mergePullRequest` | `GitPullRequest` |
| `commentOnPullRequest` | — (parecer de QA/SecOps na PR) |
| `listTree` | `GitTree \| null` — `null` se a ref ou o caminho não existem |
| `getPullRequestDiff` | `GitPullRequestDiff \| null` — `null` se a PR não existe |
| `blame` | `GitBlame \| null` — `null` se o arquivo (ou a ref) não existe |
| `listPullRequests` | `GitPullRequestList` — resumo por PR, não `GitPullRequest[]` |
| `listBranchesDetailed` | `GitBranchDetailList` — `ahead`/`behind`/PR associada por branch |

Mais dois campos: `name` e `capabilities`.

### As duas operações de leitura (FASE 26)

`listTree` lista **um nível** da árvore, nunca a árvore inteira: a aba Code
navega sob demanda, e pedir tudo de um repositório grande é o amplificador de
tráfego que a fase proíbe. `path` ausente ou `""` é a raiz; cada entrada traz
`path` completo e `name` (a folha).

`getPullRequestDiff` normaliza o diff em `status`
(`added|modified|removed|renamed`), `additions`, `deletions` e `patch`. O
`patch` é `string | null`, e a distinção importa: `null` significa **não veio**
(binário, ou patch grande demais para a resposta), enquanto `""` significaria
"veio vazio". Colapsar os dois faria a tela dizer "sem mudanças" para um
binário alterado.

As duas ausências seguem o vocabulário que `getFileContent` já usava — `null`,
não exceção — para que a aba Code trate "não existe" de um jeito só.

**Tetos.** Ambas cortam, e avisam por `truncated: true`. Os números vivem em
`apps/api/src/domain/git/git-read-limits.ts` (1000 entradas por nível, 300
arquivos por diff) e **não** em `packages/shared`, que é 100% tipo — um
`export const` lá sobrevive ao `tsc` e quebra o boot da api em produção
(travado por `apps/api/test/packages-shared-so-tipos.spec.ts`).

### As três operações de fundação (FASE 26b — RN-110/111/112)

Fundação das três pendências declaradas da aba Code (blame, dropdown rico de
branches, lista navegável de PRs) — a UI de cada uma é onda seguinte, em três
agentes separados. As três seguem o vocabulário de ausência que `getFileContent`/
`listTree`/`getPullRequestDiff` já usavam: `null`, nunca exceção, quando o
recurso não existe.

`blame(ref, path)` anota cada linha com o commit que a tocou por último — sha,
autor, data, primeira linha da mensagem. É a **única** operação que fala
GraphQL: a REST do GitHub não tem blame, só a GraphQL API
(`repository.object(expression:).blame(path:)`). GitLab usa
`RepositoryFiles.allFileBlames`; o Local, `git blame --porcelain`. Corta em
`GIT_BLAME_LINE_LIMIT` (2000 linhas).

`listPullRequests(state?)` devolve `GitPullRequestSummary[]` — id, número,
título, autor, estado, branches, `updatedAt` — **não** `GitPullRequest[]`, que
é o tipo de ESCREVER (abrir/mesclar) e nunca teve título nem autor. O `local`
lista a partir do MESMO store de PR sidecar da Fase 4a. Corta em
`GIT_PR_LIST_LIMIT` (100, uma página, sem paginação de seguimento).

`listBranchesDetailed(defaultBranch)` é operação **própria**, não extensão de
`listBranches` — ver a tabela de capabilities abaixo para o porquê. Cada
branch enriquecida ganha `ahead`/`behind` (relativos a `defaultBranch`, que
o CHAMADOR já sabe e passa — pedi-lo de novo ao provider seria uma chamada a
mais) e a PR aberta associada, se houver. `null` nos dois números quando o
provider não consegue computar (branch órfã, histórico não relacionado) —
degradação honesta, nunca um número inventado. Corta em
`GIT_BRANCH_DETAIL_LIMIT` (30 branches).

### O teto da CHAMADA, e o teto do CONSUMO (FASE 26b)

Os dois números acima limitam o que um provider devolve em **uma** chamada. A
superfície HTTP que os consome tem tetos próprios, no mesmo arquivo, e eles
respondem outra pergunta: quantas CHAMADAS uma requisição do cliente pode
provocar. `listTree` é barato uma vez e caro mil vezes.

Quem obriga a distinção é a **busca da aba Code**, que **não é operação deste
contrato** — nenhum dos três providers a tem. GitHub e GitLab têm code search
de plataforma, com semânticas e limites próprios; o `LocalGitProvider` é um
bare repo e não tem nada disso. Declará-la aqui seria ou uma 13ª operação com
capability `false` no local (uma aba que some num provider), ou o vocabulário
de uma plataforma vazando para dentro do contrato normalizado que existe
justamente para impedir isso.

Então ela fica **composta na camada de aplicação**
(`application/use-cases/git/read-project-code.use-case.ts`), sobre `listTree` +
`getFileContent`, com três orçamentos — diretórios percorridos, arquivos
abertos e casamentos devolvidos — mais um cache de TTL curto
(`domain/git/git-read-cache.ts`) para navegar e buscar não repetirem as mesmas
chamadas. Quem paga é a credencial do **owner do workspace**
([RN-058](../business-rules.md#rn-058)/[RN-082](../business-rules.md#rn-082)),
e o rate limit é do provider — ver [RN-095](../business-rules.md#rn-095) e o
[ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md).

## Capabilities

Nem todo backend faz tudo, e isso é **declarado**, não descoberto na falha:

```ts
interface GitProviderCapabilities {
  readonly protectBranch: boolean;
  readonly pullRequests: boolean;
  readonly listTree: boolean;
  readonly pullRequestDiff: boolean;
  readonly blame: boolean;
  readonly pullRequestsList: boolean;
  readonly branchesDetailed: boolean;
}
```

| provider | `protectBranch` | `pullRequests` | `listTree` | `pullRequestDiff` | `blame` | `pullRequestsList` | `branchesDetailed` |
|---|---|---|---|---|---|---|---|
| Local | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GitHub | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GitLab | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

As duas capabilities da FASE 26, e as três da FASE 26b, são `true` nos três
porque a **suite de contrato as exercita nos três** — é o critério dos ADRs
0041/0042, que vale para git: capability só é declarada quando provada, e sem
prova declara-se `false` e degrada. O Local as cumpre com `git ls-tree`/`git
diff`/`git blame --porcelain`/`git rev-list --left-right --count` no bare
repo, sem plataforma nenhuma por trás — é o único dos três providers testado
contra git DE VERDADE (`local-git-provider.contract.spec.ts`); GitHub e GitLab
rodam contra os backends fake do msw, e os smokes reais
(`{github,gitlab}-provider.smoke.spec.ts`) seguem pulados sem
`GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` no ambiente — mesma situação já
documentada na FASE 13a para os providers de LLM.

`pullRequestsList` merece nota à parte: a suposição original era que o
`local` não teria PR, "conceito de repositório único não tem PR" — não se
sustentou. O store de PR sidecar da Fase 4a (self-contained pros dev agents)
já é a fonte, e as três capabilities do `local` acabaram `true`.

Uma degradação declarada, e ela é de DADO, não de operação: o GitLab não traz
tamanho de arquivo na listagem da árvore (`RepositoryTreeSchema` não tem o
campo, e pedi-lo por entrada custaria uma requisição por arquivo), então
`size` vem `null` ali. A operação existe e funciona; o que falta é uma coluna.

O provider Local implementa PRs internamente (não há servidor para hospedá-las,
mas o fluxo existe) e **não** implementa proteção de branch — não há plataforma
para aplicá-la. Chamar `protectBranch` nele levanta `GitNotSupportedError`, um
erro explícito, nunca um no-op silencioso
([RN-028](../business-rules.md#rn-028)).

> **Capability não é o portão.** A proteção de branch da plataforma é defesa em
> profundidade. Quem impede um merge indevido é o **teto no domínio**, que
> funciona igual nos três providers, inclusive no Local que não tem proteção
> nenhuma ([RN-006](../business-rules.md#rn-006)). O
> [ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md)
> documenta a divergência entre GitHub e GitLab e por que ela não muda a
> garantia.

## Erros normalizados

Cada provider traduz o erro da própria plataforma para uma destas classes. O
domínio nunca vê um 422 do GitHub ou um `fatal:` do git:

| erro | quando |
|---|---|
| `GitRepoAlreadyExistsError` | criar repositório que já existe |
| `GitRepoNotFoundError` | repositório inexistente ou sem acesso |
| `GitBranchNotFoundError` | branch inexistente |
| `GitBranchAlreadyExistsError` | criar branch que já existe |
| `GitPermissionDeniedError` | credencial válida, permissão insuficiente |
| `GitNotSupportedError` | operação fora das `capabilities` daquele provider |
| `GitCredentialConnectionTestFailedError` | teste de conexão da credencial falhou — **não** chega a HTTP: `TestStoredCredentialUseCase` o captura e devolve `recusado` ([ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)) |
| `GitProviderAuthError` | credencial inválida ou expirada |
| `InvalidOauthStateError` | `state` do OAuth não confere |

**Não há classe-base comum**, e isso foi decidido, não esquecido: o
[ADR 0002](../adr/0002-git-error-normalization.md) registra que uma
`GitError` abstrata foi considerada e rejeitada por não pagar o próprio custo
enquanto nenhum filtro HTTP único precisa dela.

A distinção que mais importa na prática é `GitPermissionDeniedError` versus
`GitProviderAuthError`: a primeira significa "o token é válido mas não pode
isso", a segunda "o token não serve". Confundir as duas manda o usuário
reautenticar quando o problema era escopo.

## Retry

**Só em leituras, nunca em mutações**
([ADR 0003](../adr/0003-git-provider-retry-policy.md)).

O algoritmo é Full Jitter, o da AWS:
`sleep = random(0, min(maxDelay, base · 2^tentativa))`, com 4 tentativas por
default. `apps/api/src/infrastructure/git/retry.ts`.

A assimetria é a decisão inteira: repetir um `listBranches` que deu timeout é
inócuo; repetir um `commitFiles` que talvez tenha chegado cria commit
duplicado. Quando não dá para saber se a mutação aconteceu, a resposta certa é
falhar e deixar o humano olhar.

## A suite de contrato

Uma suite única — `apps/api/test/contract/git-provider.contract.ts` — roda
contra os **três** providers. É o que garante que "funciona no Local" não vira
"funciona só no Local".

Ela também é o mecanismo que mantém as `capabilities` honestas: um provider que
declara `protectBranch: true` precisa passar nos testes de proteção; um que
declara `false` precisa levantar `GitNotSupportedError`. Declarar errado quebra
a suite nos dois sentidos.

Duas travas acompanham a suite, em
`apps/api/test/contract/git-provider-contract-callers.spec.ts`. A primeira
verifica que o cabeçalho da suite lista exatamente quem a invoca. A segunda é
o item 33 da FASE 26: **operação de contrato sem consumidor em `src/` reprova
o CI** — operação que os três providers implementam e ninguém chama é peso
permanente, e nada prova que ela funciona no caminho real.

A saída para uma fase entregar contrato antes das rotas é estreita e nomeada:
o mapa `SEM_CONSUMIDOR_AINDA`, com a fase que consome escrita ao lado de cada
operação. Ela se fecha sozinha — assim que a operação ganha consumidor, a
entrada passa a **reprovar**, obrigando quem escreveu a rota a apagá-la.

**O mapa está vazio desde a FASE 26b**, e foi esvaziado pelo mecanismo e não
pela memória de alguém: assim que
`application/use-cases/git/read-project-code.use-case.ts` passou a chamar
`listTree` e `getPullRequestDiff`, o segundo teste reprovou apontando as duas
entradas pelo nome. Vazio, e não removido — a saída continua disponível para o
próximo contrato que nascer antes do consumidor.

:::caution O fake precisa mentir igual ao remoto
A suite roda contra backends falsos (msw) nos providers remotos, e um fake mais
GENEROSO que a API real deixa a suite verde enquanto o produto quebra. Foi o
que aconteceu com o repositório vazio: o fake do GitHub respondia `404` a uma
ref inexistente, o GitHub responde **`409 Git Repository is empty`**, e o
bootstrap morria no primeiro passo de todo projeto GitHub novo — com a suite
inteira verde. Ao acrescentar caso ao fake, confira a resposta contra a API
viva, não contra o que parece razoável.
:::

### O primeiro commit num repositório vazio

Repositório recém-criado no GitHub não tem commit nenhum (`auto_init: false`), e
aí a **Git Data API inteira** responde `409` — refs, blobs, trees, commits. Não
há como montar o primeiro commit por ela. Quem funciona é a Contents API
(`PUT /repos/:owner/:repo/contents/:path`), que cria arquivo, commit e branch de
uma vez; é o que `commitFiles` usa quando detecta o repo vazio.

Com **um** arquivo — o caso do bootstrap, que commita um por passo — sai
exatamente um commit, como o contrato promete. Com mais de um, o primeiro nasce
pela Contents API (é ele que cria a branch) e o resto vai num segundo commit
pelo caminho normal: dois commits em vez de um, degradação declarada porque a
alternativa seria recusar o commit inicial multiarquivo.

O `LocalGitProvider` não passa por nada disso: o `git init --bare` dele aceita o
primeiro commit pelo caminho comum.

## Bootstrap de Gitflow

Cinco passos que preparam o repositório do projeto: branches permanentes
(`dev`, `qa`, `main`), proteções onde o provider suporta, e arquivos base.

Eram seis: havia um passo `create_rc_branch`, que criava o degrau `rc` entre
`qa` e `main`. O degrau saiu da política pelo
[ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) e o passo saiu do
bootstrap depois, quando o descompasso foi notado — o produto criava, protegia
e **documentava no repositório do usuário** uma escada de quatro degraus que
ele mesmo tinha abandonado. O valor `create_rc_branch` continua no enum
`bootstrap_step` do banco: bootstraps antigos têm linhas com ele, e um passo
que realmente aconteceu não se apaga.

Duas propriedades, ambas testadas
([ADR 0005](../adr/0005-repo-bootstrap-idempotent-steps.md),
[RN-029](../business-rules.md#rn-029)):

**Idempotente** — cada passo verifica antes de agir. Rodar duas vezes não
duplica nada.

**Retomável** — falhou no passo 4? A retomada começa no 4, não no 1.

Cada passo emite seu próprio evento, e são cinco desfechos possíveis:

| evento | significa |
|---|---|
| `bootstrap.step_started` | começou |
| `bootstrap.step_completed` | fez o trabalho |
| `bootstrap.step_skipped` | já estava feito — **é sucesso** |
| `bootstrap.step_degraded` | concluiu sem uma capability (proteção de branch no Local) |
| `bootstrap.step_failed` | falhou; a retomada começa aqui |

`skipped` e `degraded` existem separados de `completed` de propósito: um
bootstrap que pulou tudo porque o repositório já estava pronto é um resultado
diferente de um que fez tudo, e um que rodou sem proteção de branch é diferente
dos dois. Colapsar os três em "ok" perderia exatamente a informação que alguém
vai querer depois.

## Adotar um repositório existente (Fase 12a)

Um projeto pode apontar para um repositório que **já existe**, em vez de criar
um. `project_repositories.origin` diz qual dos dois foi
([RN-046](../business-rules.md#rn-046)).

A adoção usa **só o que o contrato já tinha**: `getRepo` valida o acesso —
existia desde a Fase 2 e nenhum caso de uso o chamava —, e o diagnóstico usa
`listBranches` e `getFileContent`. **Nenhum método novo entrou no contrato, e a
suite de contrato ficou intocada.**

O bootstrap NÃO roda na adoção. O que sai é um **plano**: a lista serializada
do que ele faria, obtida chamando o `check()` de cada passo — o mesmo que dá
idempotência — sem executar nada. O usuário então aprova o plano inteiro, ou
adota como está e dispensa o bootstrap
([RN-045](../business-rules.md#rn-045)).

| evento | significa |
|---|---|
| `bootstrap.repository_adopted` | o repositório passou a ser o do projeto; nada foi alterado nele |
| `bootstrap.plan_approved` | o usuário aprovou — **é só daqui que o bootstrap roda num repo adotado** |
| `bootstrap.adopted_as_is` | o usuário dispensou o bootstrap; o plano fica guardado como evidência do que não foi aplicado |

**Proteção divergente é presença × ausência, e só.** O contrato expõe
`GitBranch.protected` como booleano, e o
[ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md) adiou
um `ProtectionPolicy` normalizado — então o plano sabe dizer "`qa` está sem
proteção → aplicaria" e "`main` já está protegida → não toca", mas não sabe
dizer que a proteção existente exige dois revisores e a nossa exigiria um. Uma
branch com proteção PARCIAL conta como desprotegida, e pode ser sobrescrita —
sempre dentro de um plano aprovado.

Branch que o template não conhece (`develop`, `release/*`) vira **diagnóstico
informativo** e nunca é tocada: repositório adotado tem a política que tem.

Decisão em [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md).

## Credenciais

Tokens de git são segredos do usuário: cifrados com envelope encryption, DEK
por registro, nunca em texto plano no banco ou em log. A tabela é
`project_git_connections`, e ela entra na rotação da chave mestra junto com as
credenciais de LLM — ver o
[runbook](../runbook.md#rotacao-da-chave-mestra).

O cadastro usa um enum dedicado no banco (`credential_provider`), unido aos
providers de LLM **apenas no tipo** TypeScript, sem misturar os enums
([ADR 0004](../adr/0004-git-credential-registration.md)).

Dois caminhos de conexão: **PAT** (token colado) e **OAuth** (GitHub e GitLab).
O OAuth exige `GITHUB_OAUTH_CLIENT_ID`/`_SECRET` ou o par do GitLab
configurados; sem eles, só PAT
([configuração](configuration.md#git)).

## O que não existe

Bitbucket e um `GenericGitProvider` estão **fora de escopo** — não são backlog
esquecido, são decisão. Adicionar um provider novo significa implementar as
quinze operações, declarar as capabilities honestamente e passar na suite de
contrato.

**Escrita pela aba Code também não existe.** As sete operações de leitura
(`listTree`, `getPullRequestDiff`, `blame`, `listPullRequests`,
`listBranchesDetailed`, mais `getFileContent` e a busca composta) são
leitura, e só. Salvar arquivo pela aba é fase seguinte, e quando vier, escrita
é efeito externo: nasce `proposed_action`, como toda mutação de git. O que
torna isso verificável em vez de intenção é o `CodeController` não ter **um
único** verbo de escrita — nem `@Post`, nem `@Put`, nem `@Patch`, nem
`@Delete` — mesmo depois da FASE 26b acrescentar três rotas a ele.
