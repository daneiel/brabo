# 0002 — Normalização de erros do GitProvider

## Contexto

A suite de contrato do `GitProviderContract` (ver 0001) precisa de
erros normalizados e estáveis pras 8 operações — em particular os 3
cenários citados no pedido original (repositório já existe, branch
inexistente, permissão negada) mais o caso de capability ausente, que
nunca pode ser um crash cru.

O resto do código já tem uma convenção de erro de domínio: cada erro é
uma `class X extends Error` avulsa, com `this.name` setado
explicitamente e campos de contexto tipados (nunca um enum de `code`
genérico) — ver `apps/api/src/domain/git/git-provider-errors.ts`
(`GitProviderAuthError`, `InvalidOauthStateError`, focados em OAuth) e
os erros de máquina de estado de sessão/ação.

## Decisão

**Sem classe-base comum.** Considerado introduzir uma `GitError extends
Error` abstrata pras 6 classes novas convergirem (facilitaria um futuro
`@Catch(GitError)` único), e rejeitado: nenhum filtro HTTP novo é
registrado nesta sessão (nenhum endpoint expõe as 8 operações ainda —
isso é dos itens 4-6 da Fase 2, futuros), então uma base comum não tem
uso imediato, e destoaria da convenção "sem base" já estabelecida em
todo o resto do domínio sem motivo concreto agora.

Seis classes avulsas em `apps/api/src/domain/git/git-errors.ts` (arquivo
novo, separado do `git-provider-errors.ts` de OAuth):

- `GitRepoAlreadyExistsError(repoId)`
- `GitRepoNotFoundError(repoId)`
- `GitBranchNotFoundError(repoId, ref)`
- `GitBranchAlreadyExistsError(repoId, branchName)` — cai de graça da
  semântica de compare-and-swap do `git update-ref` usada em
  `createBranch`; não fazia parte da lista original de 3 cenários, mas
  é o comportamento natural de rejeitar sobrescrever uma branch
  existente.
- `GitPermissionDeniedError(path)`
- `GitNotSupportedError(provider, operation)`

**Teste de permissão negada e containers rodando como root.** Os
containers de dev da api rodam como root
(`docker/api/Dockerfile`, sem `USER`). Root ignora checagem de
permissão Unix (DAC), então um teste que faz `chmod(dir, 0o000)` e
espera `EACCES` não reproduz nada real rodando como root — o teste
"passaria" sem exercitar nenhum código de tratamento de erro, o que é
pior que não ter o teste. Considerado (e adiado, desproporcional pro
escopo desta sessão) usar as opções `uid`/`gid` do `child_process` do
Node pra derrubar privilégio de propósito antes de tentar a operação —
isso exigiria assumir um uid não-privilegiado específico (`nobody` ou
similar) presente em todo ambiente onde a suite roda, e adicionaria uma
via de override de identidade só pra benefício de teste. Decisão: a
suite detecta `process.getuid?.() === 0` e pula (`it.skipIf`) o teste
de permissão negada quando rodando como root, com comentário explícito
no código — nunca finge que passou.

## Consequências

- Nenhum filtro HTTP (`@Catch(...)`) é adicionado nesta sessão — fica
  pendente pra quando uma sessão futura expuser as 8 operações via
  endpoint (itens 4-6 da Fase 2). Até lá, essas 6 classes só circulam
  dentro do processo da api (chamadas diretas ao provider, testes).
- Em ambientes onde os testes rodam como usuário não-root (ex.: CI
  configurado sem root, ou uma imagem de dev futura com `USER`
  não-root), o teste de permissão negada passa a ser exercitado de
  verdade — nenhuma mudança de código é necessária pra isso acontecer,
  só o ambiente.
