# ADR 0096 — SMTP real no `MailSender`, atrás de um toggle explícito

- **Status:** aceito
- **Data:** 2026-08-18
- **Contexto anterior:** [ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
  (o `MailSender` log-only nasceu aqui), [ADR 0032](0032-corte-do-keycloak-e-sessao-em-cookie.md)
  (registrou "SMTP real continua sendo config futura" como consequência
  aceita), [ADR 0059](0059-segredo-do-state-de-oauth-sem-default.md) (o padrão
  de validação de segredo em produção que este ADR reusa)

## Contexto

Desde a Fase 7a o `MailSender` (`apps/api/src/application/ports/mail-sender.port.ts`)
tem uma única implementação, `LogMailSender`: verificação de e-mail, reset de
senha, definição inicial de senha (contas migradas do Keycloak) e aviso de
registro duplicado nunca saem da api — só vão para o log. Isso bastou para
provar o fluxo de auth de ponta a ponta, mas deixou um item aberto desde então
em `docs/explanation/backlog.md`: "SMTP real no MailSender".

O item não é uma feature nova — é fechar uma lacuna já registrada, com a porta
já pronta desde o corte do Keycloak: `MailSender.enviar(email)` não carrega
opinião nenhuma sobre transporte, só sobre payload (`para`/`tipo`/`token?`/
`expiraEm?`). O trabalho de verdade é a implementação SMTP e a decisão de
COMO ligar uma sem quebrar quem já roda o produto hoje.

## Decisão

### `nodemailer`, via transporte SMTP puro

`createTransport({ host, port, secure, auth })`. Diferente das APIs JSON
sobre HTTP que o resto do produto integra (providers de LLM, sobre
`node:http` puro — ADR 0041), SMTP é protocolo de LINHA, com estado, MIME,
STARTTLS e múltiplos mecanismos de AUTH. Reimplementar isso à mão seria
reinventar uma roda sensível a segurança sem ganho nenhum. `nodemailer` é o
padrão de fato do ecossistema Node, sem SDK de provider (SES/SendGrid/
Mailgun) e sem árvore de dependência pesada — zero dependências próprias.

### `MAIL_TRANSPORT`: toggle explícito, nunca inferência

`log` (default, **inclusive em produção**) ou `smtp`. Enviar e-mail de
verdade é opt-in do operador — sem `MAIL_TRANSPORT=smtp` explícito o
comportamento continua exatamente o de hoje, mesmo em produção, e quem já
roda o produto não quebra ao atualizar. `docker-compose.prod.yml`/
`docker-compose.yml` não têm fallback público nenhum para as cinco variáveis
`SMTP_*`: cada uma resolve para string vazia quando ausente
(`${SMTP_HOST:-}`), o mesmo padrão que `AUTH_JWT_SECRET`/`BRABO_SERVICE_TOKEN`
já usam ali.

### Validação no padrão da RN-114, com uma diferença

As RN-114 originais (`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`,
`CREDENTIALS_MASTER_KEY`, `SECRET_KEY_BASE`) derrubam o boot em produção
porque a variável TEM um default de desenvolvimento público, e "não vazia"
não pegaria o defeito. Aqui não existe esse default: `SMTP_HOST` fica em
branco se ninguém setar. A régua (ausente/só espaços/valor de exemplo do
repositório/formato inválido) só é aplicada quando `NODE_ENV=production` —
fora de produção, `MAIL_TRANSPORT=smtp` sem as variáveis não derruba o boot,
porque é um caminho opt-in que um desenvolvedor pode estar testando contra um
SMTP local (MailHog, por exemplo) sem valores ainda definidos.

`apps/api/src/infrastructure/mail/smtp-config.ts` (`resolverConfigSmtp`)
segue o mesmo formato de `apps/api/src/infrastructure/security/
auth-key-material.ts`/`service-token.ts`: `SMTP_HOST`/`SMTP_USER`/
`SMTP_PASSWORD`/`SMTP_FROM` são obrigatórias em produção quando o modo é
`smtp`; `SMTP_HOST` é adicionalmente recusado se igual ao literal publicado
(comentado) em `.env.example`; `SMTP_FROM` precisa casar
`"Nome <email@dominio>"` ou `email@dominio`. `SMTP_PORT` (default `587`) e
`SMTP_SECURE` (default `false`) não são segredo — têm default de PRODUTO, não
de desenvolvimento, e não passam pela régua de "obrigatória em produção".

A validação roda dentro do construtor de `SmtpMailSender`, exercitada no
`useFactory` de `AuthUseCasesModule` — não numa chamada eager em `main.ts`
como os quatro segredos da RN-114. A diferença é deliberada: `AuthUseCasesModule`
é importado incondicionalmente (via `AuthHttpModule`) e o `useFactory`
resolve o `MailSender` durante `NestFactory.create()`, então a validação
ainda acontece no BOOT — só não antes dele, porque ela só importa quando o
operador optou por `smtp`. É o mesmo desenho que `CREDENTIALS_MASTER_KEY` já
usa (validada no construtor de `EnvelopeEncryptionService`, exercitado pela
montagem do grafo de providers).

### Seleção via `useFactory`

`AuthUseCasesModule` troca `{ provide: MailSender, useClass: LogMailSender }`
por um `useFactory` que lê `resolverModoDeTransporte()` e instancia
`SmtpMailSender` ou `LogMailSender`. Nenhum caso de uso (`RegisterUseCase`,
`RequestPasswordResetUseCase`, `LoginUseCase`, o script
`migrate-keycloak-users.ts`) muda — todos continuam injetando `MailSender` e
chamando `.enviar()`.

### Corpo em texto puro, nunca HTML

A porta não carrega estrutura para corpo rico, e um template engine seria
superfície de injeção/XSS por um ganho que ninguém pediu. Cada `tipo` tem um
texto fixo em pt-BR, com o link quando fizer sentido, montado a partir de
`WEB_ORIGIN` (mesma leitura crua que `auth.controller.ts`/`git.controller.ts`
já fazem para redirects) + a rota web certa + `?token=`.

### O token bruto e o corpo nunca vão para o log

Mesma régua do `LogMailSender`: sucesso e falha de envio citam `tipo` e
destinatário, nunca o token nem o texto do e-mail.

### A lacuna do link de verificação, fechada junto

Investigando os call sites antes de implementar: a rota web `/definir-senha`
já existe e atende `password_reset`/`set_initial_password`
(`SetPasswordPage.tsx`), mas **não havia rota nem tela para
`email_verification`** — a api já expunha `POST /auth/verify-email` e o
cliente web (`apps/web/src/lib/auth.ts`, `verificarEmail`) já existia, mas
sem chamador nenhum. Com `LogMailSender`, essa lacuna era invisível: o link
nunca saía do log e ninguém clicava nele. Com SMTP real, o e-mail chegaria
com um link morto.

`/verificar-email?token=...` (`VerifyEmailPage.tsx`) fecha isso, espelhando
`SetPasswordPage.tsx`/`setPasswordRoute`: mesmo padrão de `validateSearch` no
`router.tsx`, mesma resposta única para link inexistente/expirado/já usado, e
o mesmo desfecho de não logar ninguém — só que aqui não há formulário: a
confirmação dispara sozinha ao montar (não há dado nenhum para o usuário
preencher), e por isso a tela precisa dos três estados da RN-088
(carregando/erro/sucesso), não só dois.

## Consequências

**Quebra deliberadamente nenhuma.** `MAIL_TRANSPORT` não setado — em
qualquer ambiente, inclusive produção — mantém o comportamento de hoje
(log-only). Quem quer e-mail de verdade faz um opt-in explícito e passa a ter
as cinco variáveis validadas no boot quando roda em produção.

**Nova dependência de produção:** `nodemailer` (+ `@types/nodemailer` como
dev dependency). Zero dependências transitivas próprias.

**Novo segredo de infraestrutura:** `SMTP_PASSWORD` — mesma família de
`AUTH_JWT_SECRET`/`GIT_OAUTH_STATE_SECRET` (variável de ambiente simples,
validada no boot), não segredo de usuário (não passa por
`EncryptionService`/envelope encryption, que é só para credencial de LLM/git
por REGISTRO no banco).

**Novo caminho de rede externo** num fluxo de autenticação sensível — RN-030
a RN-033 (anti-enumeração) continuam intocadas: a implementação SMTP não
muda NENHUM call site nem o payload que os casos de uso decidem mandar, só a
entrega.

**Fica registrado, não fechado aqui:** não existe mecanismo de retentativa
para e-mail que falha no envio SMTP (timeout, credencial recusada pelo
provedor). `LoginUseCase.enviarDefinicaoDeSenha` já engolia a falha de
propósito (não muda a resposta HTTP); `RegisterUseCase`/
`RequestPasswordResetUseCase` propagam a exceção, e um provedor SMTP fora do
ar vira 500 na rota de auth. Isso já era verdade com qualquer implementação
síncrona de `MailSender` e não piora com esta — outbox/fila de envio, se um
dia for preciso, é decisão de produto separada, fora do escopo deste ADR.
