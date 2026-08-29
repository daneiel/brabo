# 0032 — O corte do Keycloak: emissor próprio, service token e sessão em cookie

## Contexto

O [ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) construiu
o auth first-party **em paralelo** ao Keycloak: argon2id, access token EdDSA,
rotação de refresh com detecção de reuso, lockout, tokens de conta. Ficou
pronto, testado e sem nenhum consumidor — o `JwtAuthGuard` global continuava
validando token do Keycloak, e as rotas de `/auth/*` existiam sem que ninguém
as usasse.

Este ADR registra o corte: a troca do emissor, a substituição do
client-credentials no tráfego interno, o login próprio na web e a remoção do
Keycloak de compose, manifests, scripts e docs.

Três descobertas da exploração redefiniram o desenho, e vale registrá-las
porque cada uma invalidava um plano razoável:

1. **Nenhuma decisão de RBAC lê claim de token.** `RolesGuard`,
   `ResolveEffectiveRoleUseCase` e `decide()` dependem de `request.user.id` e
   de linhas no banco; `realm_access` e `resource_access` nunca foram
   consumidos. A matriz de permissões é estruturalmente imune à troca de
   emissor — o que transformou o critério "matriz idêntica" de um trabalho de
   auditoria numa verificação barata.
2. **`request.clientId` era o único claim que sobrevivia até a autorização.**
   Ele vinha do `azp` do Keycloak e governava duas coisas: o
   `EngineServiceGuard` das 26 rotas `/internal/*` e a isenção de rate limit do
   engine. O token first-party não tem `azp`, e sem tratar isso o corte
   fecharia as 26 rotas de uma vez.
3. **Reaproveitar o `SyncUserUseCase` daria 500, não 401.** O `sub` do token
   novo é o próprio `users.id`, mas `upsertFromKeycloak` faz conflito em
   `keycloak_sub` — a inserção violaria `users_email_lower_idx`, e o throw
   acontece FORA do `try/catch` que envolve só a verificação do token.

## Decisão

### O corte é atômico: não há período de coexistência

Num único release o emissor troca e o Keycloak sai. Todo mundo é deslogado;
quem já tinha conta define senha pela primeira vez.

A alternativa — o guard aceitando os dois emissores por algumas semanas —
custaria dois caminhos de sessão na web, duas configurações de rede e dois
conjuntos de teste, todos precisando funcionar todo dia até alguém decidir
encerrar. O custo do corte é um logout coletivo anunciado, uma vez; o da
coexistência é uma dívida sem prazo. Vai como **breaking change** no
CHANGELOG.

### O guard lê, não sincroniza

`FirstPartyTokenVerifier` delega ao `Ed25519AccessTokenIssuer` e devolve
`{ sub: userId, email }`. O `JwtAuthGuard` passa a `UserRepository.findById`,
com **401** quando não encontra — um token válido cujo `sub` sumiu é sessão
órfã (conta apagada dentro da janela de 15 min), e 401 manda o cliente para o
login em vez de virar alerta de infraestrutura.

`SyncUserUseCase`, `upsertFromKeycloak` e `KeycloakTokenVerifier` foram
**removidos**. Some uma escrita no banco por requisição autenticada.

`users.keycloak_sub` **fica** nesta entrega. É a única evidência de
procedência que resta, e é o que o script de migração usa para distinguir
"conta migrada esperando senha" de "registro abandonado". A migração que a
remove vem depois de o corte assentar.

### `/internal/*` sai do JWT

Novo decorator `@ServiceRoute()`, honrado pelo `JwtAuthGuard` (não exige
Bearer) e pelo `RateLimitGuard` (isenta). A isenção precisa vir do **metadado**
e não de um guard: `RateLimitGuard` é `APP_GUARD` e roda antes de qualquer
guard de controller, então quando ele decide o `EngineServiceGuard` ainda não
rodou.

`EngineServiceGuard` **manteve o nome da classe** e trocou o corpo: valida
`X-Brabo-Service-Token` em tempo constante. Manter o nome não é apego — é o
que faz o `route-surface.spec.ts` continuar classificando as 26 rotas como
`engine-service`, e o que evita 26 linhas de churn em
`docs/security-surface.md` escondendo, no meio do diff, qualquer mudança real
de exposição.

`request.clientId` foi **removido** de `AuthenticatedRequest`. Sem `azp` e sem
consumidor, um campo de identidade que nunca vale nada é um convite a alguém
reintroduzi-lo numa checagem de autorização.

**Um segredo, `BRABO_SERVICE_TOKEN`, nos dois sentidos.** Dois segredos
separados limitariam o estrago de um vazamento a uma direção — mas as duas
pontas rodam no mesmo cluster, são implantadas juntas e leem o mesmo Secret:
quem lê um lê o outro. O segundo daria a impressão de compartimentar sem
compartimentar nada, dobrando o que precisa ser rotacionado em sincronia.
`BRABO_SERVICE_TOKEN_PREVIOUS` é aceito só na verificação, então as duas
pontas podem ser atualizadas em qualquer ordem.

Cabeçalho próprio em vez de `Authorization: Bearer` porque naquele cabeçalho
"JWT de usuário" é o significado estabelecido no resto da api, e a ambiguidade
levaria alguém a mandar o token de serviço para uma rota de usuário.

Do lado Elixir: `VerifyServiceToken` substitui `VerifyApiToken` **preservando o
contrato de 401 + JSON + `halt()`** (três asserções de `route_surface_test.exs`
dependem disso), as oito montagens de header viram uma, e caem `joken`,
`joken_jwks`, `jose` e `tesla`.

### A sessão da web vive em cookie httpOnly

`POST /auth/login` deixa de devolver `refreshToken` no corpo. O refresh vai
num cookie `httpOnly`, `SameSite=Strict`, `Path=/auth`, `Secure` em produção;
o access token continua em memória JS e no `Authorization: Bearer`.

Devolver o refresh **também** no corpo anularia a proteção inteira: bastaria
um XSS ler a resposta do login. E era o que aconteceria com a alternativa
óbvia — `localStorage` —, com o agravante de que o XSS levaria a sessão longa
(30 dias de família), não os 15 minutos do access.

Manter o access token FORA do cookie é o que evita exigir CSRF em toda rota
autenticada: só as de `/auth/*` precisam.

**CSRF por double-submit, mesmo com `SameSite=Strict`.** O atributo sozinho já
impede o browser de anexar o cookie numa requisição partindo de outro site, o
que fecha o CSRF nestas rotas. A segunda camada paga por três coisas que ele
não cobre: browser que ignora o atributo, um subdomínio comprometido (que é
"same site" para efeito de cookie), e o dia em que alguém precisar afrouxar
para `Lax` por causa de um fluxo de redirect. O par é um cookie legível por JS
(`brabo_csrf`) ecoado em `X-CSRF-Token`: quem está em outra origem não
consegue LER o cookie, então não consegue montar o cabeçalho.

A falha de CSRF é **403, não 401**: 401 diria "sua credencial não serve" e o
cliente tentaria renovar a sessão, entrando em laço.

### Refresh em single-flight é requisito, não otimização

O ADR 0031 já havia registrado isso, e aqui ele foi implementado: uma única
promessa em voo compartilhada por todos os chamadores.

Sem ele o sistema desloga o usuário pelo uso normal. Duas chamadas que levem
401 ao mesmo tempo disparariam dois refreshes; o segundo apresentaria um token
que o primeiro já consumiu — que, do lado do servidor, é a assinatura EXATA de
um roubo. A família é revogada e o usuário volta para o login por ter aberto
duas requisições em paralelo.

### O usuário migrado não é distinguível

O login de uma conta importada do Keycloak (existe em `users`, sem linha em
`auth_credentials`) responde o **401 uniforme**, idêntico ao de e-mail
inexistente, e dispara em silêncio o link de "definir senha".

Responder um `password_pending` explícito seria a UX óbvia e está descartado:
confirmaria que o endereço existe **e** que é conta legada — o sinal de
enumeração mais valioso do sistema, e exatamente o que a
[RN-032](../business-rules/autenticacao.md#rn-032) fecha.

Para o custo ser igual nos três desfechos, `findByEmail` virou um LEFT JOIN de
`users` para `auth_credentials`: uma consulta só. Duas consultas encadeadas
fariam o ramo pendente pagar uma ida a mais ao banco, e o relógio distinguiria
conta migrada de e-mail que não existe.

"Pendente" é estado **derivado**, não coluna: não há `password_pending` para
dessincronizar, e a idempotência do script de migração sai de graça.

### A migração não conecta no Keycloak

Porque não há o que importar. O `JwtAuthGuard` fazia upsert de todo usuário em
`users` a cada requisição desde a Fase 1 — id, e-mail e os vínculos de RBAC
sempre estiveram no banco da api. O Keycloak nunca foi a fonte da verdade do
RBAC; era o emissor do token. O que falta a essas contas é uma senha, que ele
também não daria (hash de senha não migra, decisão do CLAUDE.md).

## Consequências

**Todo mundo é deslogado no release.** É o preço declarado do corte atômico, e
está no CHANGELOG como mudança incompatível.

**Os links de "definir senha" saem no log da api, não em caixa de entrada.** O
`MailSender` segue log-only, e SMTP real continua sendo config futura. Para a
instalação de dono único isso basta; o runbook explica como extraí-los com
`AUTH_MAIL_LOG_TOKENS=true`. É a limitação mais visível desta entrega.

**Rotacionar `AUTH_TOKEN_PEPPER` ou `BRABO_SERVICE_TOKEN` tem efeitos opostos e
igualmente abruptos.** O primeiro desloga todo mundo e invalida os links em
aberto; o segundo, se feito só de um lado, corta o tráfego interno. Os dois
estão no runbook, com o `_PREVIOUS` documentado como a forma de fazer sem
downtime.

**A web não pode dizer "esse e-mail já está em uso".** Consequência herdada do
ADR 0031, agora com tela: o formulário diz "se o endereço estiver disponível".

**O smoke test depende de um usuário provisionado.** Sem IdP externo não existe
mais credencial pronta, e registrar pela API esbarra na verificação de e-mail.
O `bootstrap.sh` roda o seed, que cria uma conta com senha conhecida e e-mail
já verificado — e `provisionarUsuario` **recusa rodar com
`NODE_ENV=production`** sem override explícito. É ferramenta de
desenvolvimento, e está marcada como tal no código.

**`users.keycloak_sub` continua no schema** sem nenhum emissor por trás. É
dívida consciente, com propósito (§ decisão) e com prazo: a migração que a
remove entra depois de o corte assentar.

**A superfície pública não mudou.** Continuam 12 rotas, e as 26
`engine-service` continuam 26 — `route-surface.spec.ts` fechou com diff vazio,
que era o resultado esperado e a prova de que o contrato dos controllers não
foi tocado.

### O que foi verificado, e o que não foi

A matriz de RBAC é provada por três travas: `decide.spec.ts` (24 casos) e
`resolve-effective-role.use-case.spec.ts` seguiram **inalterados e verdes**;
`route-surface.spec.ts` fechou com diff vazio; e dois specs novos —
`roles.guard.spec.ts`, com a matriz 4×4 escrita por extensão, e
`jwt-auth.guard.spec.ts`, que afirma que nenhuma linha nova aparece em `users`
— cobrem o salto identidade → `user.id`, que não tinha teste nenhum antes e é
o único ponto que o corte mexe.

**A suíte do engine não foi executada nesta entrega.** O ambiente de
desenvolvimento usado não alcança `hex.pm` (bloqueio de política de rede), e
sem `mix deps.get` não há `mix compile` nem `mix test`. O código Elixir foi
escrito e verificado por análise sintática de cada arquivo alterado; a
execução real acontece no CI, que tem rede. Está registrado aqui em vez de
omitido porque é exatamente o tipo de lacuna que o ADR 0020 mandou nunca
diagnosticar por eliminação.

### Backlog consciente (reafirmado)

Segue fora de escopo, agora com o corte feito: **MFA** (TOTP, WebAuthn),
**login social**, **federação OIDC** e a **api como provedor OIDC**. Somam-se:
SMTP real, dicionário de senhas vazadas, re-hash oportunista do argon2, a
poda das tabelas de auth e a migração que remove `users.keycloak_sub`.

A claim de versão de credencial — que tornaria o access token revogável — fica
anotada com um detalhe novo: o `JwtAuthGuard` **deixou** de fazer escrita por
requisição neste corte, então o argumento "já vai ao banco mesmo" que a
tornaria barata não vale mais. Se voltar à mesa, volta pelo próprio mérito.
