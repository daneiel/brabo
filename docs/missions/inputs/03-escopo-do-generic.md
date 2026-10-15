# Insumo 3 — GenericGitProvider: capabilities mínimas e degradação

Material de entrada do PO para a Fase 10.

O `GenericGitProvider` é o provider para "um servidor git qualquer, sem API de
plataforma": Gitea auto-hospedado, um bare repo atrás de SSH, um Forgejo, um
servidor que fala só o protocolo git. Ele é o oposto do Bitbucket como
problema — lá o desafio é traduzir uma API rica; aqui é **declarar honestamente
o que não dá para fazer**, e garantir que o resto do sistema degrade em vez de
quebrar.

O contrato a satisfazer está em `inputs/01-contrato-gitprovider.md`.

---

## O precedente já existe: `LocalGitProvider`

Não é um provider novo em espírito — é o `LocalGitProvider` com o remoto em
outro lugar. Tudo que o épico precisa decidir já tem resposta ali, e o caminho
mais barato é ler aquele arquivo antes de projetar qualquer coisa
(`apps/api/src/infrastructure/git/local-git-provider.ts`, 467 linhas).

O que ele estabelece:

- **Declara `protectBranch: false`** e `pullRequests: true`
  (`apps/api/src/infrastructure/git/local-git-provider.ts:55-58`).
- **Recusa a operação não suportada com `GitNotSupportedError`**, nunca em
  silêncio (`:137`, e também em `:290` e `:323` para caminhos de merge sem PR
  real).
- **Implementa PR de verdade sem plataforma**: um PR store leve num sidecar do
  bare repo, feito para os dev agents da Fase 4a (`:51-54`). Ou seja,
  `pullRequests: true` sem servidor de PR **é possível** — a questão é onde o
  estado mora.
- **Fala git de verdade**, via `execFile` do binário, não uma reimplementação.

---

## A pergunta central: onde mora o estado que o servidor não guarda

Um servidor git puro sabe de refs, objetos e nada mais. Ele não tem PR, não tem
comentário, não tem proteção de branch. As dez operações do contrato precisam de
uma resposta para cada uma dessas ausências.

| operação | o servidor git puro sabe? | resposta esperada |
|---|---|---|
| `createRepo` | depende — criar repo remoto exige API ou acesso ao disco | investigar; pode ser a capability que falta |
| `getRepo` | parcialmente — dá para descobrir `defaultBranch` por `ls-remote` | provavelmente sim |
| `createBranch` | **sim** — é push de ref | sim |
| `protectBranch` | **não** | `false` + `GitNotSupportedError` |
| `commitFiles` | **sim** | sim |
| `listBranches` | **sim** — `ls-remote --heads` | sim, com `protected: false` sempre |
| `openPullRequest` | **não** nativamente | decisão: store próprio (como o Local) ou `false` |
| `mergePullRequest` | **não** nativamente | idem |
| `commentOnPullRequest` | **não** | idem — e é o que os gates usam |
| `getFileContent` | **sim** — `git show ref:path` | sim, com `null` nos dois casos de ausência |

**A decisão de arquitetura é uma só:** o Generic reusa o mecanismo de PR do
`LocalGitProvider` (e então declara `pullRequests: true`), ou declara `false` e
aceita a degradação em cascata? As duas são defensáveis. O que não é defensável é
declarar `true` e lançar `GitNotSupportedError` — a suite de contrato reprova
isso, de propósito.

---

## O que "declarar `false`" custa, em cascata

Antes de escolher, é preciso saber o que se perde. Declarar `pullRequests: false`
não é um detalhe de provider — desliga parte do produto.

- Os **gates de QA e SecOps** postam parecer no PR
  (`commentOnPullRequest`, a décima operação, nasceu para isso na Fase 4a).
  Sem PR, o parecer existe como artefato no event log mas não aparece no
  repositório.
- O **fluxo dos dev agents** abre PR ao terminar a task.
- A **trava de merge protegido** (`decide.ts:149-160`) continua valendo — ela é
  do domínio, não da plataforma. Isso é importante: **não ter proteção no
  servidor não afrouxa nada**, porque quem impede merge indevido é o teto no
  domínio.

O épico precisa dizer explicitamente o que acontece com cada um desses no
Generic. "Degrada" não é resposta — degrada **para o quê** é.

---

## Degradação no bootstrap: o mecanismo já está pronto

**RN-029** — o bootstrap de Gitflow é idempotente e retomável; são seis passos,
cada um verifica antes de agir, e `skip` **é sucesso**
(`apps/api/src/application/use-cases/git/bootstrap-steps.ts`).

Para um provider sem `protectBranch`, o passo `protect_branches` não falha:
sai **`degraded`**, que também é sucesso. O evento
`bootstrap.step_degraded` existe exatamente para "concluiu sem uma capability do
provider" — ver `docs/reference/events.md`, seção "Git e bootstrap". Com o
provider Local isso já acontece hoje, em toda execução.

Ou seja: **a degradação não precisa ser construída, precisa ser declarada.**
O sistema já sabe lidar com capability ausente; o que ele não perdoa é
capability mentida.

---

## O que "mínimo" significa, concretamente

Um provider é aceito quando:

1. As dez operações existem — mesmo que algumas só lancem
   `GitNotSupportedError` (`apps/api/src/domain/git/git-errors.ts:51`).
2. As duas capabilities refletem a realidade
   (`packages/shared/src/index.ts:182-185`).
3. Os **19 cenários** da suite única passam, sem cenário próprio escrito
   (`apps/api/test/contract/git-provider.contract.ts`). Os cenários de
   `protectBranch`, `openPullRequest`, `mergePullRequest` e
   `commentOnPullRequest` verificam justamente a coerência entre a flag
   declarada e o comportamento — funcionar quando `true`, recusar quando
   `false`.

**RN-028** fecha a regra: capability decide, não o nome do provider. Nenhum
consumidor pode ganhar um `if (provider.name === 'generic')`. Se algum precisar,
o problema é a modelagem das capabilities, não o consumidor — e aí é ADR.

---

## Perguntas em aberto para o Arquiteto

- **Configuração.** O Generic precisa de URL do remoto, e provavelmente de
  credencial. Como isso entra? `CreateRepoInput` tem `name`, `visibility`,
  `namespace` e `accessToken` — nenhum deles é "URL do servidor". Onde a URL
  mora: no `externalId`, numa coluna nova de `provisioned_repositories`, ou em
  configuração de projeto?
- **Autenticação.** Token em HTTPS, chave SSH, ou os dois? Chave SSH não cabe em
  `accessToken?: string` da mesma forma que um token cabe, e o
  `credentialProviderEnum` (`apps/api/src/db/schema.ts:198-203`) precisaria de
  entrada nova de qualquer jeito.
- **`visibility`.** `GitRepo` exige `"public" | "private"`
  (`packages/shared/src/index.ts:187-193`). Um servidor git puro pode não ter o
  conceito. O que se devolve — um default declarado, ou isso vira campo
  opcional no contrato?
- **`createRepo`.** Se o Generic não souber criar repositório remoto, ele é
  inútil para o wizard atual, que sempre chama `createRepo`
  (`provision-repository.use-case.ts:144`). Isso conecta com o achado P1 da
  missão: o produto não sabe adotar repositório existente. **O Generic pode ser
  exatamente o provider que torna esse achado urgente** — vale o Arquiteto
  avaliar se os dois se resolvem juntos.
- **Segurança.** URL de servidor arbitrário fornecida pelo usuário é superfície
  de SSRF. Vale checar como `docs/security-surface.md` trata saída de rede antes
  de decidir.

---

## O que NÃO fazer

- Não implementar as dez operações "de qualquer jeito" para poder declarar tudo
  `true`. Honestidade na capability é o requisito; completude não é.
- Não copiar o `LocalGitProvider` por cópia literal. O que se reusa é a
  **decisão** (onde mora o estado de PR), não necessariamente o código.
- Não criar `if` por nome de provider em consumidor nenhum.
