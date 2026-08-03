---
id: git-providers
title: Providers de git
sidebar_label: Providers de git
sidebar_position: 5
description: O contrato de dez operações que torna Local, GitHub e GitLab intercambiáveis, com capabilities, erros normalizados e política de retry.
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

`GitProviderContract`, em `packages/shared/src/index.ts`. **Dez operações** — a
décima entrou na Fase 4a, com os gates de PR:

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

Mais dois campos: `name` e `capabilities`.

## Capabilities

Nem todo backend faz tudo, e isso é **declarado**, não descoberto na falha:

```ts
interface GitProviderCapabilities {
  readonly protectBranch: boolean;
  readonly pullRequests: boolean;
}
```

| provider | `protectBranch` | `pullRequests` |
|---|---|---|
| Local | ❌ | ✅ |
| GitHub | ✅ | ✅ |
| GitLab | ✅ | ✅ |

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
| `GitCredentialConnectionTestFailedError` | teste de conexão da credencial falhou |
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
esquecido, são decisão. Adicionar um provider novo significa implementar as dez
operações, declarar as capabilities honestamente e passar na suite de contrato.
