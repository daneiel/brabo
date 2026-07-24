# 0001 — Formato do contrato normalizado do GitProvider

## Contexto

A Fase 2 (CLAUDE.md) pede uma interface `GitProvider` normalizada em
`packages/shared` cobrindo 8 operações (`createRepo`, `getRepo`,
`createBranch`, `protectBranch`, `commitFiles`, `listBranches`,
`openPullRequest`, `mergePullRequest`), com tipos que nunca vazem o
shape de Octokit (GitHub) ou do cliente REST do GitLab (`@gitbeaker`),
e um objeto `capabilities` por onde o domínio degrada quando uma
operação não é suportada por um provider.

Antes desta sessão, `apps/api` já tinha uma `GitProvider` — mas como
`abstract class` usada como token de injeção de dependência do NestJS,
com uma única operação (`createRepository`), consumida pelo pipeline de
provisionamento de repositório já em produção
(`ProvisionRepositoryUseCase`, `GitProviderRegistry`,
`GitInfrastructureModule`). Essa sessão está escopada só à "fundação"
(tipos + suite de contrato + `LocalGitProvider` completo) — completar
`GithubProvider`/`GitlabProvider` pras 8 operações fica pra uma sessão
futura.

## Decisão

**Dois contratos coexistem deliberadamente por agora**:

1. `GitProvider` (inalterada, `apps/api/src/application/ports/git-provider.port.ts`)
   — continua sendo o token de DI do Nest, com `createRepository`. Nada
   nela muda nesta sessão; `GithubProvider`/`GitlabProvider`/o registry/
   o use-case de provisionamento não são tocados.
2. `GitProviderContract` (nova, `packages/shared/src/index.ts`) — a
   interface normalizada de 8 operações + `capabilities`, tipos `GitRepo`/
   `GitBranch`/`GitPullRequest`/`GitCommitResult`. Não está ligada a
   nenhum token de DI ainda. Só `LocalGitProvider` a implementa por
   enquanto (além de continuar implementando a `GitProvider` antiga,
   inalterada).

Nomeada `GitProviderContract` em vez de reaproveitar o identificador
`GitProvider` — evita colisão de nome no arquivo que implementa as duas
(`LocalGitProvider`) e casa com o vocabulário "suite de CONTRATO" que o
próprio CLAUDE.md já usa pra descrever os testes.

Todo campo de identificação de repositório usa `externalId` (não `id`
nem `repoId`) — mesmo nome já usado por `CreateRepositoryResult`/
`ProvisionedRepository`, pra ficar consistente com o que já é
persistido.

**`capabilities`**: `{ protectBranch: boolean; pullRequests: boolean }`
— duas flags booleanas, introspectáveis em tempo de execução
(`provider.capabilities.protectBranch`), sem granularidade por-operação
além disso (ex.: não existe "protectBranch parcial"). `LocalGitProvider`
declara as duas como `false` — um bare repo local não tem plataforma por
trás pra hospedar proteção de branch ou pull requests. Quando uma
operação gated por uma capability ausente é chamada, o provider lança
`GitNotSupportedError` (nunca um crash cru) — ver 0002.

**Merge/PR no local**: `openPullRequest` e `mergePullRequest` no
`LocalGitProvider` lançam `GitNotSupportedError` incondicionalmente —
não existe simulação de PR via branch+merge direto nesta sessão. Uma
sessão futura de bootstrap de Gitflow provavelmente vai precisar de uma
operação de merge direto (não uma "PR falsa") pra providers sem
`pullRequests` — essa operação ainda não está modelada aqui, de
propósito, pra não inventar uma superfície de API que ninguém consome
ainda.

## Consequências

- Zero risco de regressão no pipeline de provisionamento já em
  produção — `GitProvider`/`GithubProvider`/`GitlabProvider` continuam
  exatamente como estavam.
- Dívida explícita: os dois contratos (`GitProvider` e
  `GitProviderContract`) precisam convergir numa sessão futura, quando
  `GithubProvider`/`GitlabProvider` também implementarem
  `GitProviderContract` — nesse ponto faz sentido `GitProvider` (a
  antiga) ser aposentada em favor da nova, ou uma delas passar a
  estender a outra.
- A suite de contrato (`apps/api/test/contract/git-provider.contract.ts`)
  já é escrita de um jeito reaproveitável — ramifica em
  `provider.capabilities.*` pra decidir a asserção certa — então não
  precisa mudar quando Github/Gitlab entrarem, só o harness que a
  invoca muda.
