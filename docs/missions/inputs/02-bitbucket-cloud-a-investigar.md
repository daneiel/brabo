# Insumo 2 — Bitbucket Cloud: o que investigar antes de codar

Material de entrada do PO e do Arquiteto para a Fase 10.

**Este arquivo é uma lista de perguntas, não de respostas.** Nada aqui afirma
como o Bitbucket Cloud funciona. Cada item aponta uma semântica que precisa ser
**verificada na documentação oficial** antes de virar código — e o resultado da
verificação é o que o Arquiteto registra no ADR das semânticas, via PR real.

A regra vem de dor registrada: a Fase 9b parou justamente por não conseguir
verificar `baseUrl`, auth e formato de `usage` na doc oficial, e a decisão foi
não adivinhar
(`docs/adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md:147-156`).
Provider codado contra contrato adivinhado passa no mock e falha no real — que é
o pior lugar para descobrir.

O contrato a satisfazer está em `inputs/01-contrato-gitprovider.md`.

---

## 1. Autenticação

O que decidir aqui muda o schema, não só o provider.

- Quais mecanismos o Bitbucket Cloud oferece hoje, e quais estão **depreciados**?
  (App passwords, API tokens, OAuth 2.0, access tokens de repositório/workspace —
  quais existem, quais têm data de fim anunciada?)
- Qual deles cabe no formato atual: um único `accessToken?: string` por chamada
  (`packages/shared/src/index.ts`, todos os `*Input`)? Se o mecanismo exigir
  **par usuário+senha** em vez de token único, isso **não cabe** no contrato —
  e a decisão é do Arquiteto: adaptar no provider ou mudar o contrato.
- Qual escopo mínimo cobre as dez operações? Ler, escrever, administrar PR e
  administrar branch restrictions são escopos distintos?
- Como o teste de conexão deve ser feito? O padrão existente é uma chamada de
  "quem sou eu" (`apps/api/src/infrastructure/git/git-credential-connection-tester.ts`),
  síncrona e obrigatória antes de cifrar
  (`docs/adr/0004-git-credential-registration.md`).

**Impacto no schema:** `credentialProviderEnum`
(`apps/api/src/db/schema.ts:198-203`) hoje tem `ollama`, `anthropic`, `openai`,
`github`, `gitlab`. Acrescentar `bitbucket` exige migração. Se o mecanismo de
auth precisar de dois campos, a tabela `user_credentials` guarda **um** segredo
cifrado por linha — o que também é decisão de arquitetura, não detalhe.

---

## 2. Identidade do repositório (`externalId`)

O contrato trata `externalId` como string opaca, e os dois providers atuais a
interpretam de formas diferentes (GitHub usa `owner/repo`; ver
`splitFullName` em `apps/api/src/infrastructure/git/github-provider.ts`).

- Qual é a identidade canônica de um repositório no Bitbucket Cloud —
  `workspace/repo_slug`, UUID, ou os dois?
- O slug é estável quando o repositório é renomeado? Se não, o `externalId`
  persistido em `provisioned_repositories` apodrece — e isso precisa estar no
  ADR.
- O que preenche `namespace` de `CreateRepoInput`: workspace, projeto (o
  Bitbucket tem um nível de "project" que GitHub e GitLab não têm), ou ambos?
  Se houver um nível a mais na hierarquia, ele cabe em `namespace` sozinho?

---

## 3. Branch restrictions — o análogo de `protectBranch`

O ponto mais delicado, porque é onde os três providers atuais já divergem
(`docs/adr/0028-protecao-de-branch-divergencia-entre-providers.md`).

- Como o Bitbucket Cloud modela restrição de branch? É **uma** entidade com
  vários campos, como o GitHub, ou **várias** regras independentes que precisam
  ser criadas uma a uma?
- Se forem várias, aplicar "proteção" vira N chamadas. `protectBranch` devolve
  `void` e não é transacional — o que acontece se a terceira falhar? Qual é o
  estado observável depois disso?
- Existe algo equivalente a `enforce_admins`? Se existir, **não repita o erro do
  GitHub**: `github-provider.ts:170-175` aplica `enforce_admins: true` +
  1 revisor sem ler o estado atual, e isso pode travar o merge manual do dono
  (ADR 0028:83-84). Está registrado como achado P1 da fase.
- Aplicar restrição sobre uma branch que já tem restrição **sobrescreve** ou
  **acumula**? A resposta muda se o passo é idempotente ou destrutivo — e RN-029
  exige idempotência.
- `GitBranch` carrega `protected: boolean`
  (`packages/shared/src/index.ts:195-199`). Como `listBranches` descobre esse
  booleano no Bitbucket? É um campo da branch, ou exige uma segunda chamada
  listando restrições e cruzando? Se exigir N+1 chamadas, isso é custo a
  declarar.

**Pergunta de fundo:** as duas flags de `GitProviderCapabilities` bastam para
descrever o Bitbucket honestamente? Se a resposta for não, a decisão é do
Arquiteto e vai a ADR — não se resolve declarando `true` e torcendo.

---

## 4. Merge strategies

- Quais estratégias o Bitbucket Cloud aceita no merge de PR, e **qual é o
  default** quando nenhuma é informada?
- `MergePullRequestInput` (`packages/shared/src/index.ts:267-271`) carrega só
  `externalId` e `pullRequestId` — não há campo de estratégia. O default do
  Bitbucket é aceitável para o fluxo do Brabo, ou o provider precisa fixar uma
  explicitamente?
- O merge pode falhar por conflito, por restrição de branch não satisfeita, ou
  por aprovação faltando. Cada um desses vira qual das sete classes de erro
  normalizado? Se nenhuma servir, isso é um erro novo — e acrescentar classe ao
  contrato é decisão, não detalhe.
- O retorno precisa preencher `GitPullRequest.state` com `"merged"`. O Bitbucket
  informa isso na resposta do merge, ou exige releitura?

---

## 5. Pull requests, comentários e o resto

- `openPullRequest` — como o Bitbucket identifica origem e destino? Aceita nome
  de branch direto, ou exige objeto com repositório junto (relevante para PR
  entre forks)?
- `GitPullRequest` precisa de `id` **e** `number`
  (`packages/shared/src/index.ts:211-218`). O Bitbucket tem os dois conceitos
  separados, ou um só? Se for um só, o que vai em cada campo?
- `commentOnPullRequest` — qual endpoint, e o comentário precisa ser de nível de
  PR (não de linha de diff)? Os gates de QA/SecOps postam parecer no PR inteiro.
- `getFileContent` — qual endpoint devolve conteúdo cru de um arquivo numa
  branch? Ele devolve 404 para arquivo ausente e para branch ausente
  igualmente? O contrato exige `null` nos **dois** casos, sem lançar.
- `commitFiles` — o contrato commita **vários arquivos numa mensagem só**
  (`CommitFilesInput.files`). O Bitbucket suporta isso numa chamada, ou exige
  uma por arquivo? Se exigir, o resultado não é atômico, e isso precisa estar no
  ADR.

---

## 6. Erros: o mapa de status → classe

Repetindo o padrão que os providers atuais seguem: **decidir por status HTTP +
marcador do corpo**, nunca por substring da mensagem inteira.

Levantar, com evidência da doc oficial:

| situação | status que o Bitbucket devolve | classe normalizada |
|---|---|---|
| repositório com nome já usado | ? | `GitRepoAlreadyExistsError` |
| repositório inexistente | ? | `GitRepoNotFoundError` |
| branch/ref inexistente | ? | `GitBranchNotFoundError` |
| branch já existe | ? | `GitBranchAlreadyExistsError` |
| token sem permissão | ? | `GitPermissionDeniedError` |
| rate limit | ? | **não é** `GitPermissionDeniedError` — ver o cuidado do GitHub em `github-provider.ts:75-77` |

Atenção especial ao par 404-ambíguo: se "repositório não existe" e "token não
enxerga o repositório" devolvem o **mesmo** 404, o provider não consegue
distinguir `GitRepoNotFoundError` de `GitPermissionDeniedError`. Isso é uma
limitação legítima — e a decisão de qual das duas lançar precisa estar escrita,
não implícita.

---

## 7. Retry

`apps/api/src/infrastructure/git/retry.ts` faz Full Jitter, 4 tentativas, **só em
leituras** (`docs/adr/0003`).

- O Bitbucket sinaliza rate limit de forma distinguível (header, status
  dedicado)? Vale respeitar `Retry-After` se ele existir?
- Alguma escrita do Bitbucket é idempotente a ponto de valer retry? A resposta
  padrão é não — repetir escrita é como se cria duplicata.

---

## 8. Como validar sem credencial real

O modelo já existe e deve ser copiado: mock no CI, smoke atrás de env var.

- O backend falso vai em `apps/api/test/support/msw/` (ver
  `github-fake-backend.ts` e `fake-repo-store.ts` como referência).
- O smoke roda a **mesma** suite com `describe.skipIf(!token)`, no padrão de
  `apps/api/test/infrastructure/git/github-provider.smoke.spec.ts:37`.

> A env var do smoke seguiria o padrão `BITBUCKET_TEST_TOKEN`. Se o mecanismo de
> auth escolhido no item 1 exigir mais de um valor, o nome e a forma mudam — e
> isso também é decisão a registrar.

---

## O que NÃO fazer

- Não inferir comportamento a partir do GitHub ou do GitLab por analogia. Os
  dois já divergem entre si em proteção de branch; supor um terceiro pelo padrão
  dos outros dois é como se acumula dívida silenciosa.
- Não declarar capability `true` sem cenário da suite passando contra ela.
- Não deixar pergunta sem resposta e codar assim mesmo. Se a doc oficial não
  responder, **isso é a resposta** — e vira uma limitação declarada no ADR, como
  a Fase 9b fez ao declarar `listModels: false` em vez de adivinhar o parsing.
