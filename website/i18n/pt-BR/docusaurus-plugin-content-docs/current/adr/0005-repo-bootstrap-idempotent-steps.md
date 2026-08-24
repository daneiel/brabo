# 0005 — Bootstrap de Gitflow idempotente e retomável

## Contexto

Fase 2, sessão 3 ("o coração"): `ProvisionRepositoryUseCase` passa a, além
de criar o repositório, executar o bootstrap de Gitflow completo (branches
dev/qa/rc, proteções conforme capabilities, template de PR,
docs/branching-policy.md) como uma sequência de passos que precisa:
convergir sempre pro mesmo estado rodando N vezes (idempotência), retomar
de onde parou depois de um crash no meio (persistência de progresso), e
narrar cada mutação como `proposed_action` auto_approved no event log da
sessão — tudo isso sem nenhum precedente no código (primeira feature de
"matar o processo no meio e retomar" neste repositório).

Duas decisões foram explicitamente confirmadas com o usuário antes da
implementação; o resto foi resolvido durante a implementação, à medida
que a integração com o código existente (sessões, proposed_actions,
`GitProviderContract`) revelou restrições reais.

## Decisões

**1. `getFileContent` como 9ª operação do `GitProviderContract`.**
A checagem "arquivo já commitado com mesmo conteúdo" (idempotência dos
passos de commit) não tem como ser feita com as 8 operações originais —
nenhuma lê conteúdo de arquivo. Confirmado com o usuário: adicionar
`getFileContent(externalId, branch, path): Promise<string | null>`,
implementada nos 3 providers (LocalGitProvider via `git show`,
GithubProvider via Octokit `repos.getContent`, GitlabProvider via
Gitbeaker `RepositoryFiles.show`), com cobertura na suite de contrato
única. Os backends fake do GitHub/GitLab (msw) precisaram passar a
rastrear conteúdo de verdade (antes só metadados de branch/PR) — grafo
blob→tree→commit pro GitHub (espelha a API real), mapa path→conteúdo por
branch pro GitLab (a API de commit manda o estado completo por vez).

**2. Sessão dedicada, criada uma vez e reaproveitada em toda retomada.**
`proposed_actions`/`session_events` exigem um `sessionId` existente — não
há suporte a ação/evento "sem sessão". Confirmado com o usuário:
`ProvisionRepositoryUseCase` cria UMA sessão por projeto na primeira
tentativa (mesmo mecanismo barato de `CreateSessionUseCase` — só INSERT +
evento de outbox, nunca chama o engine), guarda o id em
`repo_bootstraps.session_id`, e a REAPROVEITA em toda retomada — a
história do bootstrap (sucesso, falha, retomada, skips) fica narrada
numa timeline contínua, não fragmentada entre sessões. A sessão nunca
transiciona pra `active` via `TransitionSessionUseCase` (que chamaria o
engine via `ApiToEngineClient.startSession` — errado pra uma sessão que
nunca roda comando nenhum): a transição `created→active` é feita direto
via `SessionRepository.updateStatus`, guardada por `assertTransition`.
Pela mesma razão, a sessão NUNCA vai pra `closed_abnormally` numa falha
de passo — esse é um estado terminal (sem transições de saída,
`session-state-machine.ts`) e quebraria a reutilização em retomadas
futuras; ela fica `active` durante qualquer número de tentativas
falhas/retomadas, só fechando (`closing→closed`, sem tocar o engine
nesses dois hops) quando os 6 passos convergem na mesma execução.

**3. Cursor único por projeto, revalidação total em toda execução.**
`repo_bootstraps` é uma linha por projeto (não um log por passo) —
`{project_id, session_id, step, status, attempts, last_error}`. A
idempotência NÃO vem de pular passos com base nesse cursor: TODA
execução (fresca ou retomada) percorre os 6 passos desde o início,
chamando `check()` de cada um contra o estado real no provider — só
quando `check()` reporta "não satisfeito" é que uma mutação de verdade
acontece. O cursor é só um diagnóstico (último passo tocado + resultado),
nunca um gate. Essa única regra dá de graça: idempotência (rodar N vezes
= todos os `check()` retornam satisfeito, zero mutação), retomada após
falha (os passos já feitos continuam satisfeitos, só o que faltou
executa), e retomada após "matar o processo no meio de uma mutação" (a
linha fica com `status=running`; na próxima execução o `check()`
descobre que a mutação na verdade já aconteceu e pula) — os 3 cenários
do critério de teste (item 6) são o MESMO mecanismo, não três
implementações separadas.

**4. Sem `decide()` no caminho do bootstrap — status nasce hardcoded
`auto_approved`.** O pedido diz "decisão auto_approved para o bootstrap".
Chamar `decide()` de verdade (como `ProposeActionUseCase` faz pra ações
de usuário/agente) NÃO produziria isso por padrão: o fallback de
`decide()` sem regra aplicável em `permissions.json` é `require_approval`,
nunca `auto_approve`. Ou seja, bootstrap-sempre-auto-aprovado só faz
sentido como uma categoria estrutural separada do pipeline discricionário,
não como "o resultado típico de decide() pra um projeto novo".
Estruturalmente seguro: `auto_approved` nunca é destino de transição em
`action-state-machine.ts` (só estado inicial), então hardcodar na criação
não viola a máquina de estados. Consequência aceita: um `deny` em
`permissions.json` mirando `git_branch_create` etc. não bloqueia o
bootstrap — é infraestrutura de projeto novo, não uma ação discricionária
de agente/usuário.

**5. Ordem de EXECUÇÃO dos passos difere da ordem listada no pedido.**
O pedido lista "criar dev a partir de main" primeiro, commits por último.
Impossível como está: `createRepo` cria um repo bare vazio, sem commit
inicial, nos 3 providers (`auto_init: false` — "provisionado" precisa
significar a mesma coisa em todos), e uma ref sem nenhum commit não pode
ser origem de `createBranch`. Os dois commits em `main` (template de PR,
`branching-policy.md`) precisam vir PRIMEIRO — são eles que dão a `main`
seu primeiro commit. Ordem de execução real
(`BOOTSTRAP_STEP_SEQUENCE`/`BOOTSTRAP_STEPS`, mantidas em sincronia):
`commit_pr_template → commit_branching_policy → create_dev_branch →
create_qa_branch → create_rc_branch → protect_branches`. Cascata de
branch é dev←main, qa←dev, rc←qa (default meu — o pedido não especifica a
origem de qa/rc; segue o pipeline de promoção dev→qa→rc→main descrito no
CLAUDE.md). O enum `bootstrap_step` no schema (ordem de declaração) não
precisou mudar — nunca é comparado por ordem, só por igualdade.

**6. Sem 409 pra reprovisionar um projeto já convergido.** A versão
anterior de `ProvisionRepositoryUseCase` lançava `ConflictException` se
já havia um repo pro projeto. Mantido esse guard teria quebrado a
idempotência: "rodar o use-case N vezes converge sem erro" (item 2 do
pedido) é incompatível com "a 2ª chamada lança 409". Resolvido: nenhum
guard de conflito nesse sentido — um projeto já convergido só faz todos
os 6 `check()`s reportarem satisfeito (puro skip), nunca erro.

**7. Credencial de github/gitlab por usuário (PAT), não mais por projeto
(OAuth).** A versão anterior resolvia o token via `project_git_connections`
(conexão OAuth por projeto, usada pelo `createRepository` legado). O novo
contrato (`createRepo` etc.) espera um PAT (`token:` no construtor do
Gitbeaker — `PRIVATE-TOKEN`), não um token OAuth (`oauthToken:` —
`Authorization: Bearer`); os dois não são intercambiáveis (docs/adr/0004).
Resolvido: credencial agora vem de `UserCredentialRepository` (PAT
registrado pelo usuário, ver docs/adr/0004), decriptado direto (string
crua, sem o wrapper JSON `{accessToken,refreshToken}` do fluxo OAuth).

**8. Aposentado o contrato legado `GitProvider`/`createRepository`.**
Confirmado por grep que `ProvisionRepositoryUseCase` era o único
consumidor de `.createRepository()` em todo `src/` — `GitProviderRegistry`
agora retorna `GitProviderContract` diretamente. Fecha a "dívida
explícita" registrada em docs/adr/0001.

## Consequências

- Nenhuma coluna de status em `projects` — `provisioning|provisioned|
  provision_failed` é derivado puramente de `repo_bootstraps`
  (`repo-bootstrap-status.ts`, mesma filosofia framework-free de
  `action-state-machine.ts`), evitando duas fontes de verdade.
- `repo_bootstraps` não usa `SELECT ... FOR UPDATE` — provisionamento
  concorrente pro MESMO projeto não é serializado nesta sessão (mesma
  simplificação implícita que o guard antigo de `findByProjectId` já
  fazia). Se isso virar problema real, a decisão futura é sobre lock
  otimista/pessimista na linha, não sobre redesenhar o cursor.
- Risco real, não implementado nesta sessão: `GithubProvider.protectBranch`
  hardcoda `enforce_admins: true`, o que bloquearia os commits em `main`
  se a ordem fosse invertida (proteger antes de commitar) — não é o
  caso aqui (commits vêm primeiro), mas um GitHub real com `main` já
  protegida por fora do bootstrap poderia rejeitar um push administrativo
  depois. Fora do escopo desta sessão (critério de aceite testado contra
  LocalGitProvider, sem conceito de proteção).
- `apps/api/scripts/demo-repo-bootstrap.ts` demonstra o critério de
  aceite fim a fim: provisiona com LocalGitProvider, injeta uma falha na
  2ª chamada de `createBranch` (equivalente observável a matar o processo
  no passo 4 de 6), roda de novo, converge, e imprime o event log
  completo mostrando os `bootstrap.step_skipped` dos passos 1-3 na
  retomada.
