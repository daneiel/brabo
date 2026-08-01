# Insumo 1 — o contrato de GitProvider que já existe

Material de entrada do PO para a Fase 10. Descreve **o que já está pronto**, para
que o épico não reinvente nem contradiga. Tudo aqui foi lido do código; cada
afirmação tem `arquivo:linha`.

Adicionar um provider novo significa três coisas, nesta ordem: implementar as dez
operações, declarar as capabilities **honestamente**, e passar na suite de
contrato única sem escrever cenário próprio.

---

## As dez operações

Definidas em `packages/shared/src/index.ts:287-303`. Um provider é um objeto que
satisfaz esta interface — nada mais, nada menos.

| # | operação | entrada → saída |
|---|---|---|
| 1 | `createRepo` | `CreateRepoInput` → `GitRepo` |
| 2 | `getRepo` | `GetRepoInput` → `GitRepo` |
| 3 | `createBranch` | `CreateBranchInput` → `GitBranch` |
| 4 | `protectBranch` | `ProtectBranchInput` → `void` |
| 5 | `commitFiles` | `CommitFilesInput` → `GitCommitResult` |
| 6 | `listBranches` | `ListBranchesInput` → `GitBranch[]` |
| 7 | `openPullRequest` | `OpenPullRequestInput` → `GitPullRequest` |
| 8 | `mergePullRequest` | `MergePullRequestInput` → `GitPullRequest` |
| 9 | `getFileContent` | `GetFileContentInput` → `string \| null` |
| 10 | `commentOnPullRequest` | `CommentOnPullRequestInput` → `void` |

Mais dois campos obrigatórios: `name: GitProviderName`
(`packages/shared/src/index.ts:288`) e `capabilities: GitProviderCapabilities`
(`:289`).

A nona (`getFileContent`) nasceu com o bootstrap de Gitflow
(`docs/adr/0005-repo-bootstrap-idempotent-steps.md`) e devolve `null` — não
lança — quando o arquivo ou a branch não existe
(`packages/shared/src/index.ts:298`). A décima (`commentOnPullRequest`) nasceu
com os gates de PR da Fase 4a e respeita `capabilities.pullRequests` como as
demais operações de PR (`packages/shared/src/index.ts:300-302`).

### Formatos de saída

Definidos em `packages/shared/src/index.ts:187-218`:

- `GitRepo` — `externalId`, `name`, `url`, `defaultBranch`, `visibility`
- `GitBranch` — `name`, `commitSha`, `protected`
- `GitCommitResult` — `sha`, `branch`
- `GitFileChange` — `path`, `content`
- `GitPullRequest` — `id`, `number`, `url`, `sourceBranch`, `targetBranch`,
  `state` (`"open" | "merged" | "closed"`)

### Formatos de entrada

`packages/shared/src/index.ts:220-285`. Todos carregam `accessToken?: string`
opcional — o token vem decriptado de quem chama, e o provider nunca o persiste.

| tipo | campos além do `accessToken` |
|---|---|
| `CreateRepoInput` | `name`, `visibility`, `namespace?` |
| `GetRepoInput` | `externalId` |
| `CreateBranchInput` | `externalId`, `branchName`, `fromRef` |
| `ProtectBranchInput` | `externalId`, `branchName` |
| `CommitFilesInput` | `externalId`, `branch`, `message`, `files: GitFileChange[]` |
| `ListBranchesInput` | `externalId` |
| `OpenPullRequestInput` | `externalId`, `sourceBranch`, `targetBranch`, `title`, `body?` |
| `MergePullRequestInput` | `externalId`, `pullRequestId` |
| `CommentOnPullRequestInput` | `externalId`, `pullRequestId`, `body` |
| `GetFileContentInput` | `externalId`, `branch`, `path` |

Note que `ProtectBranchInput` **não carrega configuração de proteção** — só qual
branch. Cada provider decide o que "protegido" significa, e essa divergência é
tratada no `docs/adr/0028-protecao-de-branch-divergencia-entre-providers.md`.

---

## Capabilities: duas flags, e elas são o portão

```ts
interface GitProviderCapabilities {
  readonly protectBranch: boolean;
  readonly pullRequests: boolean;
}
```

`packages/shared/src/index.ts:182-185`. **São só duas.** Um provider novo que
precise expressar uma terceira dimensão está pedindo mudança de contrato — o que
é decisão de arquitetura, não detalhe de implementação.

O que cada provider declara hoje:

| provider | `protectBranch` | `pullRequests` | onde |
|---|---|---|---|
| `LocalGitProvider` | `false` | `true` | `apps/api/src/infrastructure/git/local-git-provider.ts:55-58` |
| `GithubProvider` | `true` | `true` | `apps/api/src/infrastructure/git/github-provider.ts:39-42` |
| `GitlabProvider` | `true` | `true` | `apps/api/src/infrastructure/git/gitlab-provider.ts:41-44` |

O `pullRequests: true` do Local não é simulação: é um PR store leve num sidecar
do bare repo, feito para os dev agents da Fase 4a
(`apps/api/src/infrastructure/git/local-git-provider.ts:51-54`). O
`protectBranch: false` permanece porque não há plataforma para aplicar proteção.

**RN-028 — capability decide, não o nome do provider.** Operação não suportada é
declarada em `capabilities` e recusada com `GitNotSupportedError`, nunca falha em
silêncio. O `LocalGitProvider` faz exatamente isso em `protectBranch`
(`apps/api/src/infrastructure/git/local-git-provider.ts:137`). Nenhum consumidor
tem `if (provider.name === 'local')`.

---

## Erros normalizados

Sete classes, em `apps/api/src/domain/git/git-errors.ts`. Deliberadamente **sem
classe-base comum** — decisão registrada no
`docs/adr/0002-git-error-normalization.md`.

| classe | construtor | linha |
|---|---|---|
| `GitRepoAlreadyExistsError` | `(repoId)` | `:10` |
| `GitRepoNotFoundError` | `(repoId)` | `:17` |
| `GitBranchNotFoundError` | `(repoId, ref)` | `:24` |
| `GitBranchAlreadyExistsError` | `(repoId, branchName)` | `:34` |
| `GitPermissionDeniedError` | `(path)` | `:44` |
| `GitNotSupportedError` | `(provider, operation)` | `:51` |
| `GitCredentialConnectionTestFailedError` | `(provider, reason?)` | `:64` |

Não confundir com `apps/api/src/domain/git/git-provider-errors.ts`, que tem duas
classes de **OAuth** (`GitProviderAuthError`, `InvalidOauthStateError`) e não faz
parte do contrato normalizado. A distinção importa: `GitPermissionDeniedError` é
"o token não pode fazer isso"; `GitProviderAuthError` é "o fluxo de OAuth
falhou".

O filtro HTTP que traduz essas classes em status vive em
`apps/api/src/interfaces/http/shared/git-provider-error.filter.ts`.

### Como cada provider mapeia o erro cru do vendor

Este é o trabalho real de um provider novo: o vendor fala o dialeto dele, e o
contrato só conhece as sete classes acima.

- **GitHub** (Octokit) — status `422` + `/already exists/i` →
  `GitRepoAlreadyExistsError` (`github-provider.ts:69-74`); `403` sem rate-limit
  → `GitPermissionDeniedError` (`:75-77`).
- **GitLab** (Gitbeaker) — status `400` + `/already (exists|been taken)/i` →
  `GitRepoAlreadyExistsError` (`gitlab-provider.ts:73-75`); `401`/`403` →
  `GitPermissionDeniedError` (`:76-78`).
- **Local** (git CLI via `execFile`) — código `EEXIST` →
  `GitRepoAlreadyExistsError` (`local-git-provider.ts:71`); `EACCES`/`EPERM` →
  `GitPermissionDeniedError` (`:72-74`).

O padrão a copiar: **decidir por status + marcador do corpo**, nunca por
substring da mensagem inteira, que muda sem aviso.

---

## Retry

`apps/api/src/infrastructure/git/retry.ts` — Full Jitter, 4 tentativas, **só em
leituras** (`docs/adr/0003`). O `LocalGitProvider` não usa; GitHub e GitLab usam.
Um provider novo que fale HTTP deve usar o mesmo helper, e pela mesma regra:
repetir uma escrita não idempotente é como se cria duplicata.

---

## A suite de contrato única

`apps/api/test/contract/git-provider.contract.ts`. Exporta a interface
`GitProviderContractHarness` (`:20`) e a função `runGitProviderContract(label,
makeHarness)` (`:35`). São **19 cenários**, e o provider novo não escreve nenhum
deles — só fornece o harness.

Os cenários, por operação:

| operação | cenários |
|---|---|
| `createRepo` | cria; rejeita nome usado (`GitRepoAlreadyExistsError`); rejeita permissão negada (`GitPermissionDeniedError`, pulado quando roda como root) |
| `getRepo` | retorna o criado; rejeita id inexistente (`GitRepoNotFoundError`) |
| `commitFiles` | primeiro commit em branch nova; segundo commit gera sha novo; rejeita branch inexistente (`GitBranchNotFoundError`) |
| `getFileContent` | retorna conteúdo; `null` para arquivo inexistente; `null` para branch inexistente |
| `createBranch` | cria a partir de ref existente; rejeita `fromRef` inexistente; rejeita nome já existente |
| `listBranches` | lista as existentes |
| `protectBranch` | **respeita `capabilities.protectBranch`** |
| `openPullRequest` / `mergePullRequest` / `commentOnPullRequest` | **respeitam `capabilities.pullRequests`** |

Os quatro últimos são os mais importantes para um provider novo: a suite não
exige que a operação funcione — exige que ela **funcione ou lance
`GitNotSupportedError`, de acordo com a flag declarada**. Declarar `true` e não
implementar reprova; declarar `false` e implementar também.

Quem roda a suite hoje:

| harness | arquivo |
|---|---|
| `local` — provider real + diretório temporário | `apps/api/test/infrastructure/git/local-git-provider.contract.spec.ts:12` |
| `github (mockado)` — provider real + backend HTTP via `msw` | `apps/api/test/infrastructure/git/github-provider.contract.spec.ts:23` |
| `gitlab (mockado)` — idem | `apps/api/test/infrastructure/git/gitlab-provider.contract.spec.ts:23` |
| `github (API real)` — só com `GITHUB_TEST_TOKEN` | `apps/api/test/infrastructure/git/github-provider.smoke.spec.ts:40` |
| `gitlab (API real)` — só com `GITLAB_TEST_TOKEN` | `apps/api/test/infrastructure/git/gitlab-provider.smoke.spec.ts:31` |

O par mock + smoke é o modelo a seguir: a suite roda no CI contra um backend
falso, e a **mesma** suite roda contra a API real atrás de env var, pulada por
padrão.

> ⚠️ O comentário no topo de `apps/api/test/contract/git-provider.contract.ts:12-18`
> ainda diz que só o Local exercita a suite. Está desatualizado desde a Fase 2 —
> registrado como achado P3 na missão, a ser corrigido nesta fase.

---

## Registry

`apps/api/src/infrastructure/git/git-provider-registry.ts` — um `switch` por
`GitProviderName` que devolve a instância injetada. Provider novo entra aqui, no
módulo `apps/api/src/infrastructure/git/git-infrastructure.module.ts`, e no tipo
`GitProviderName` em `packages/shared/src/index.ts`.

Atenção a um detalhe que já mordeu antes: `packages/shared` é **100% tipo**. Uma
lista em runtime não pode morar lá — o pacote é resolvido pelo `.ts` cru e a
imagem de produção da api não sobe. Há teste guardando isso
(`apps/api/test/packages-shared-so-tipos.spec.ts`).

---

## Onde o provider aparece fora do backend

O épico precisa cobrir estes pontos, senão o provider existe e ninguém consegue
escolhê-lo:

- `apps/web/src/routes/NewProjectWizard.tsx:28-37` — o array `PROVIDERS` do
  wizard
- `apps/web/src/lib/wizard.ts` — `providerNeedsCredential`, que decide se o passo
  de credencial aparece
- `apps/web/src/components/wizard/CredentialStep.tsx:19-21` — rótulos
- `apps/web/src/components/ProjectCard.tsx:11-19` e
  `apps/web/src/routes/ProjectPage.tsx:16` — ícone e rótulo por provider
- `apps/web/src/components/ui/icons.tsx` — os ícones
- `credentialProviderEnum` em `apps/api/src/db/schema.ts:198-203` — precisa de
  migração se o provider aceitar credencial

---

## Duas regras de negócio que o épico não pode contrariar

- **RN-028** — capability decide, não o nome do provider. Verificada pela suite
  de contrato rodada contra todos os providers.
- **RN-029** — o bootstrap de Gitflow é idempotente e retomável; são seis passos,
  cada um verifica antes de agir, e `skip` **é sucesso**. Um provider sem
  `protectBranch` faz o passo sair `degraded`, que também é sucesso —
  `bootstrap.step_degraded` existe exatamente para isso.
