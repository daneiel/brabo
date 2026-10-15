# 0004 — Cadastro de credenciais de git do usuário

## Contexto

Item 3 da Fase 2 (ver CLAUDE.md): credenciais de git do usuário
(tokens do GitHub/GitLab usados pelo `GithubProvider`/`GitlabProvider`
pra operar em nome dele) precisam viver na mesma tabela
`user_credentials` das API keys de LLM (Fase 1), com a mesma envelope
encryption, e com teste de conexão obrigatório no cadastro.

Duas questões de shape:

1. `user_credentials.provider` já era `llm_provider` enum
   (`ollama`/`anthropic`/...). Um token de git não é um provider de LLM
   — alargar `llm_provider` misturaria dois domínios num enum só usado
   também por `models`/`token_usage` (LLM-only de verdade).
   Reaproveitar `git_provider` (usado por `project_git_connections`)
   também não serve: ele inclui `'local'`, que não faz sentido como
   provider de uma *credencial* (não existe token pra git local).
2. Um token inválido/revogado só é descoberto ao tentar usá-lo — sem
   teste de conexão, o cadastro "sucede" e a falha só aparece no
   primeiro bootstrap de Gitflow, bem mais tarde e mais caro de
   diagnosticar.

## Decisão

**Enum dedicado** `credential_provider` (migration `0007`), com
`CredentialProviderName = LLMProviderName | GitCredentialProviderName`
em `packages/shared` — união dos dois domínios só no tipo que
`UserCredentialRepository` usa, sem misturar os enums de banco.
`GitCredentialProviderName` é `Extract<GitProviderName, 'github' |
'gitlab'>` — deriva do enum de provider de git, não duplica a lista,
mas exclui `'local'` estruturalmente.

**Teste de conexão SÍNCRONO e OBRIGATÓRIO antes de cifrar/persistir.**
`RegisterGitCredentialUseCase.execute` (novo) chama
`GitCredentialConnectionTester.test(provider, token)` primeiro; só se
isso resolver é que o token é cifrado
(`EncryptionService.encrypt`) e gravado
(`UserCredentialRepository.upsert`). Numa falha, nada é escrito — ver
`GitCredentialConnectionTestFailedError` em
`domain/git/git-errors.ts`. A implementação real
(`GitCredentialConnectionTesterImpl`) faz a chamada mais barata
possível em cada API pra confirmar que o token autentica:
`GET /user` (Octokit `users.getAuthenticated`) no GitHub,
`GET /user` (Gitbeaker `Users.showCurrentUser`) no GitLab — nenhuma
tenta listar repos ou qualquer coisa que dependa de escopo além de
autenticação básica.

**PAT sempre via `token:` no Gitbeaker, nunca `oauthToken:`.** O
GitLab valida os dois de formas diferentes (header `PRIVATE-TOKEN` vs.
`Authorization: Bearer`) — não são intercambiáveis. `oauthToken` fica
reservado pro fluxo de OAuth de projeto
(`project_git_connections`, Fase 2 item 4+), que essa sessão não
altera.

**Endpoint próprio só pro registro; GET/DELETE reaproveitados.**
`POST /users/me/git-credentials` (novo,
`GitCredentialsController`) é o único caminho nesta sessão, porque só
o registro precisa do teste de conexão síncrono. Listagem e remoção
já existiam em `CredentialsController` (Fase 1, LLM) sobre a mesma
tabela/repositório — `UserCredentialRepository` foi alargado de
`LLMProviderName` pra `CredentialProviderName` (era o `LLMProviderName`
solto que sobrou e quebrava o build, ver `delete()` em
`user-credential.repository.ts`) em vez de duplicar
list/delete pra git. Nenhum `@RequireRole` no controller novo: é sobre
a credencial do próprio usuário autenticado, mesmo padrão do endpoint
LLM equivalente.

**Falha de conexão mapeia pra 422, não 400 nem 409**
(`git-provider-error.filter.ts`): não é payload malformado (400) nem
conflito com estado existente (409) — é uma entidade semanticamente
inválida (token que nunca autenticou), o caso clássico de 422.

## Consequências

- Cadastrar uma credencial de git agora faz uma chamada de rede
  síncrona à API do provider antes de responder — o endpoint é mais
  lento que um cadastro "cego", de propósito (ver Decisão).
- `UserCredentialRepository` (e sua migration `0007`) agora serve dois
  domínios (LLM e git) pela mesma tabela/enum de tipo — qualquer
  provider de credencial futuro (git ou não) entra por
  `CredentialProviderName`, não por um enum novo.
- O teste de conexão não é retentado (`GitCredentialConnectionTester`
  não usa `withRetry`, ver 0003) — uma falha transitória de rede no
  cadastro exige que o usuário tente de novo manualmente; aceitável
  porque é uma ação interativa única, não uma operação de background.
