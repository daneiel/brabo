# ADR 0105 — Personal Access Token (`brb_…`) pro runner, escopado por construção a uma rota

- **Status:** Aceito
- **Data:** 2026-08-22
- **Contexto:** backlog do [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  ("token de conta de longa duração (PAT) substituindo o replay de login...
  ANTES da distribuição"), RN-424/425/426
- **Companheiro de:** [ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md)

## Contexto

`apps/runner/src/auth.ts` replicava manualmente o que um browser faz
sozinho: e-mail/senha interativos na primeira execução, cookies
`brabo_refresh`/`brabo_csrf` extraídos e persistidos em
`~/.brabo/runner-credentials.json`, renovação via `/auth/refresh` a cada
tentativa de reconexão. O próprio ADR 0103 já registrava isso como "a
forma possível com o que existe hoje", sinalizado no código como o módulo
a trocar. `npm publish @brabo/runner` nunca rodou — e publicar o CLI nesse
estado distribuiria um fluxo de senha+cookie salvo em disco, o bloqueio
que esta entrega existe pra fechar.

Dois mecanismos existentes foram considerados e descartados:

- **`account_tokens`** — construído pra links de e-mail de USO ÚNICO
  (verificação, reset de senha, senha inicial pós-migração do Keycloak).
  Não tem conceito de múltiplos tokens vivos por usuário, nem de escopo a
  um recurso — reaproveitá-lo exigiria alargar a tabela e o caso de uso
  pra um formato que não é o dele.
- **Rotação de família de refresh token** — refresh é CONSUMIDO e
  reemitido a cada uso, com revogação de família em caso de reuso
  detectado (ADR 0031). PAT é o oposto: apresentado repetidamente SEM
  MUDAR, por design (é isso que permite ao usuário colar o valor uma vez
  no `--token` e nunca mais tocar nele). Herdar o modelo de rotação
  inventaria uma garantia que o PAT não precisa e complicaria sem ganho o
  que devia ser simples.

## Decisão

**Tabela nova, `personal_access_tokens`** (migração `0049`): `id`,
`user_id`, `project_id` (NOT NULL — o único formato de escopo que esta
entrega precisa), `name`, `token_hash` (índice único), `expires_at`
opcional, `revoked_at`/`revoked_reason`, `last_used_at`, `created_at`.
**Sem coluna `scope_kind`.** Um enum com um valor só populado hoje não
compra nada — se um formato de escopo não-projeto aparecer no futuro,
`project_id NOT NULL` não serviria de qualquer jeito e a tabela precisaria
de migração própria ali também. Adiar o enum pro dia em que um segundo
formato for trabalho real agendado, não antes.

**Hash: HMAC-SHA256 + pepper via `hashDeToken()`/`TokenFactory`, não
argon2.** O padrão real do produto pra segredo de ALTA entropia (256 bits
de CSPRNG) já é esse — o mesmo mecanismo de refresh tokens e account
tokens. Argon2 é reservado pra segredo de BAIXA entropia (senha), onde
resistência a ataque de dicionário importa; usá-lo aqui só quebraria a
busca indexada `WHERE token_hash = $1` sem ganhar nada, porque não há
dicionário a resistir contra um valor de 256 bits gerado por CSPRNG. O
token bruto é `brb_<32 bytes em base64url>`; o hash é calculado sobre a
string COM o prefixo (`hashDe('brb_' + bruto)`), não sobre o valor que
`TokenFactory.gerar()` devolve — aquele hash é calculado sem o prefixo e
seria o hash errado.

**A decisão de segurança central: um PAT nunca autentica em nenhuma rota
além de `POST /projects/:projectId/runner-ticket`, por CONSTRUÇÃO — não
por um `if` que uma rota nova amanhã poderia esquecer de checar.**

A alternativa mais simples — o `JwtAuthGuard` global reconhecer o prefixo
`brb_` e popular `request.user` para QUALQUER rota — foi considerada e
recusada: uma vez que `request.user` está setado, `RolesGuard`/
`@RequireRole` autorizariam esse PAT pra tudo que o papel real do usuário
permite no resto da api. O escopo "só pede ticket de runner" viraria
decorativo — um PAT vazado passaria a valer como sessão completa.

A saída espelha um padrão que já existe no código pro mesmo problema
estrutural (tráfego que não deve passar pela autenticação de usuário
padrão): `IS_SERVICE_ROUTE_KEY`/`@ServiceRoute()`/`EngineServiceGuard`.
Um terceiro branch, `IS_PAT_ROUTE_KEY`/`@RequirePatAuth()`, foi
adicionado ao lado dos dois existentes em `JwtAuthGuard`: quando setado,
o guard global devolve `true` sem tentar `verify()` de JWT, delegando
inteiramente pro `PatAuthGuard` de rota (`@UseGuards(PatAuthGuard)`), que
roda só no handler `runnerTicket` — nunca em `terminalTicket`, que
continua exclusivamente JWT de sessão (nenhum lugar da web chama
`runner-ticket`; só o CLI chama).

`PatAuthGuard` extrai o bearer; se não começar com `brb_`, 401 — nunca
tenta dual-auth com JWT nessa rota. Chama
`PersonalAccessTokenRepository.validarEUsar(hash)`: UMA query
`UPDATE ... WHERE token_hash = $1 AND revoked_at IS NULL AND
(expires_at IS NULL OR expires_at > now()) RETURNING id, user_id,
project_id`, mesmo padrão de `AccountTokenRepository.consumir()`. Zero
linhas cobre "não existe", "revogado" e "expirado" com a MESMA resposta
(401) — não dar a quem apresenta um token roubado/expirado a informação
de qual dos três é o motivo. Escopo de projeto errado (`project_id`
devolvido ≠ `:projectId` da rota) é 403, categoria diferente: o token
autenticou, só não tem direito a ESTE projeto.

`last_used_at` é `SET ... = now()` INCONDICIONAL, na mesma query de
validação — sem throttle. A alternativa considerada (só tocar quando
"NULL ou >5min velho", com essa condição no MESMO `WHERE`) tinha um bug
real: um PAT reapresentado duas vezes em menos de 5 minutos cairia fora
do `WHERE` na segunda vez, e a consulta devolveria zero linhas pra um
token VÁLIDO — rejeitando com 401 uma reconexão legítima (o laço de
retry do runner reconecta em segundos, não minutos). O custo de não
throttlar é um `UPDATE` de uma linha por índice único; o pior caso real
(até 10 tentativas seguidas, teto do runner) não chega perto de ser
problema de carga. Mais simples e sem essa classe de bug.

`RolesGuard`/`ResolveEffectiveRoleUseCase` continuam rodando depois do
`PatAuthGuard`, inalterados — cinto e suspensório: se o dono do PAT
perder acesso ao projeto pela via normal (`ProjectMember`/workspace), o
token para de autorizar mesmo sem ser revogado explicitamente.

**Emitir/listar/revogar é escopado ao PRÓPRIO usuário**, no `WHERE` da
query — nunca filtro em memória depois de trazer tudo. Revogação por
`maintainer` do PAT de OUTRO usuário (resposta a incidente — dev
desligado com token vazando) fica fora desta entrega, declarado.

## Consequências

- Desbloqueia a próxima linha do backlog do ADR 0104: `npm publish
  @brabo/runner` deixa de distribuir um fluxo de senha+cookie salvo em
  disco. `apps/runner/src/auth.ts` perde por completo o login
  interativo, os cookies e o arquivo de credenciais — o PAT chega pronto
  via `--token`/`BRABO_ACCOUNT_TOKEN`, nunca gravado em disco pelo CLI.
- `route-surface.spec.ts` continua classificando `runner-ticket` como
  `role:developer` — correto, é a mesma exigência de papel de sempre, só
  o mecanismo de estabelecer identidade mudou. `docs/security-surface.md`
  ganhou uma nota em prosa dizendo que esta rota aceita só PAT, porque a
  tabela automática não distingue os dois mecanismos.
- Nenhuma mudança no engine (Elixir) — todo o trabalho é api + runner +
  web + docs.
- Um usuário pode ter vários PATs vivos ao mesmo tempo no mesmo projeto
  (um por máquina, de propósito) — ao contrário de `account_tokens`, não
  há supersede: emitir um novo não invalida os anteriores.
