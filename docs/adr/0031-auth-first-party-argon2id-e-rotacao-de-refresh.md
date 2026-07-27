# 0031 — Auth first-party: argon2id, EdDSA e rotação de refresh

## Contexto

O Brabo autentica por Keycloak desde a Fase 1: um container a mais no compose,
um StatefulSet a mais no Kubernetes, um realm em JSON para manter, e uma
dependência de rede no caminho de toda requisição. Em troca, usa-se um
subconjunto pequeno do que ele oferece — login por senha, um cliente público
para a web e dois service accounts para o tráfego interno. Nada de MFA, nada de
federação, nada de login social.

A conta não fecha. O que o Keycloak resolve de verdade neste sistema cabe em
um módulo do domínio da api; o que ele cobra é operação permanente. A FASE 7a
troca os dois lados: auth no domínio, Keycloak removido.

Esta entrega (7.1) constrói o módulo **em paralelo**, sem tocar no guard. O
`JwtAuthGuard` global segue verificando token do Keycloak, e o RBAC da Fase 1
não é tocado. A razão é que o guard é `APP_GUARD` e todo o resto da api depende
do `request.user` que ele popula: construir o auth novo e trocar o emissor na
mesma entrega não deixaria nenhum estado intermediário testável. Com as rotas
novas em `@Public()`, o módulo é exercitável de ponta a ponta enquanto o
sistema atual continua de pé.

## Decisão

### Senha: argon2id com parâmetros fixos no código

`m = 19456 KiB (19 MiB)`, `t = 2`, `p = 1`, saída de 32 bytes — o segundo
perfil recomendado pelo OWASP. Roda em ~50 ms e cabe no limite de memória do
container mesmo com verificações concorrentes.

Os parâmetros ficam em **constante**, não em variável de ambiente. Mudar custo
de hash não é ajuste de tuning: exige plano de re-hash do acervo. Exposto como
env, viraria a alavanca que alguém baixa em produção para "melhorar a latência
do login", sem que ninguém perceba que a proteção caiu.

Biblioteca: `@node-rs/argon2`, escolhida sobre `argon2` por trazer binário
pré-compilado — o `Dockerfile.prod` é multi-stage sobre Alpine (ADR 0024), e a
alternativa exigiria toolchain de compilação no builder.

### Access token: EdDSA (Ed25519), 15 minutos, chave derivada

A alternativa era HS256 com segredo em env. EdDSA foi escolhido porque a chave
pública pode ser publicada em `/.well-known/jwks.json` e verificada por
qualquer serviço sem receber o segredo que **assina** — com HMAC, quem verifica
também pode forjar.

A chave **não é gerada, é derivada**: o seed de 32 bytes sai de
`scryptSync(AUTH_JWT_SECRET, 'brabo-auth-jwt-seed', 32)`, o mesmo formato que o
`EnvelopeEncryptionService` já usa para a chave mestra das credenciais
(Fase 1). Isso resolve três problemas de uma vez — nenhuma chave privada é
commitada, o par é idêntico entre réplicas e entre reinícios (um
`generateKeyPairSync` no boot daria uma chave por processo, e o sintoma seria
login intermitente atrás do load balancer), e a rotação copia o padrão que já
existe em vez de inventar um segundo.

O `kid` é o thumbprint RFC 7638 da própria JWK: sai da chave, então não há
variável para desincronizar do que ela nomeia.

Rotação por `AUTH_JWT_SECRET_PREVIOUS`, aceita **só na verificação** e
publicada no JWKS, nunca usada para assinar — mesmo desenho do
`CREDENTIALS_MASTER_KEY_PREVIOUS`, com o mesmo aviso ruidoso no boot lembrando
que a rotação precisa terminar.

### Refresh: token opaco de 256 bits, hash HMAC-SHA256, rotação obrigatória

O token são 32 bytes de `randomBytes` em base64url. O banco guarda
`hmac-sha256(pepper, token)`.

**Não é argon2, e a escolha oposta à da senha é deliberada.** Argon2 existe
para encarecer o ataque de dicionário contra segredo de baixa entropia; contra
256 bits de CSPRNG não há dicionário, então o custo compraria zero bit. Pior:
argon2 tem salt por registro, o que faria o hash deixar de ser função só do
token — e `where token_hash = $1` ficaria impossível, transformando cada
refresh numa varredura da tabela. O pepper (em vez de SHA-256 puro) é de graça
e faz um dump do banco, sem o ambiente do processo, não valer nada.

Cada refresh consome o token apresentado (`rotated_at`) e emite um filho com o
**mesmo `family_id`** e o **mesmo `family_started_at`**. Apresentar um token já
rotacionado é a assinatura do roubo: revoga-se a família inteira e grava-se
evento de segurança.

`family_started_at` é o teto absoluto da sessão. Sem ele, rotação a cada 15
minutos produz sessão eterna — e ninguém percebe até uma auditoria perguntar
quanto tempo uma sessão pode viver.

`rotated_at` e `revoked_at` são colunas **ortogonais**. Colapsar as duas
destruiria a distinção entre "você apresentou um token já gasto" (sinal de
roubo → cascata) e "você apresentou um token que a cascata de outro matou"
(vítima a jusante → sem novo alarme). Sem ela, cada aba do usuário legítimo
geraria uma detecção de roubo durante o incidente, enchendo o log de segurança
de ruído justamente quando ele precisa estar legível.

### Lockout: janela deslizante em tabela própria, chave no e-mail

`auth_lockout_hits`, estruturalmente idêntica a `rate_limit_hits` (ADR 0027):
INSERT e COUNT num statement só por CTE, sem Redis.

**Tabela separada de `auth_events`**, e não uma coluna a mais nela. A trilha é
append-only por regra do CLAUDE.md, e zerar o contador num login bem-sucedido
exige DELETE. Numa tabela só seria preciso inventar uma marca d'água ("falhas
desde o último sucesso"), que acopla o plano de consulta do throttle ao
conjunto de índices da auditoria para sempre. Separadas, cada uma tem a regra
que lhe cabe — e as retenções também são opostas: o contador vira passivo de
PII em uma hora, a trilha precisa sobreviver.

**A chave do balde é o e-mail normalizado (em HMAC), não o id do usuário.** Com
id, o balde só existiria depois de encontrar a conta: tentativa contra e-mail
inexistente não seria contada nem bloqueada, e o próprio lockout viraria
oráculo de existência. Com o e-mail, conta real e conta imaginária se comportam
igual por construção.

O bloqueio recorta o estado **anterior** à tentativa. Recortar o posterior faria
o limiar valer um a menos: com limiar 5, a quinta tentativa seria recusada
inclusive com a senha certa.

Baldes de e-mail e de IP têm escadas **distintas** (5:30,8:300,12:900 e
20:30,30:120). Um limiar único erraria nas duas pontas: 5 por IP derrubaria
qualquer escritório atrás de NAT, 20 por conta seria generoso demais para um
ataque de senha. O teto do IP é curto porque ali o dano colateral atinge quem
não fez nada.

O teto da escada de e-mail é **igual à janela**, por construção. Teto maior
exigiria um `locked_until` persistente, com fila de destrava e endpoint de
admin — a janela deslizante não representa bloqueio mais longo do que ela
mesma.

### Enumeração de e-mail: uma invariante, não uma lista de casos

> Qualquer resposta diferente da falha uniforme só pode ser alcançada **depois**
> de uma verificação de senha bem-sucedida.

A regra resolve sozinha todos os casos, inclusive os que costumam escapar:
e-mail inexistente, senha errada, conta bloqueada, conta desabilitada e —
o mais traiçoeiro — usuário importado do Keycloak que ainda não tem senha.
Responder "defina sua senha" a esse último confirmaria que o endereço existe
**e** que é conta legada, o sinal de enumeração mais valioso do sistema.

Consequências concretas: a busca da credencial e o `verify` do argon2 rodam
**sempre**, inclusive sem conta (contra um hash dummy de parâmetros idênticos)
e inclusive com o balde já bloqueado. A checagem de bloqueio por e-mail vem
**depois** do verify. Sair mais cedo é o instinto de qualquer revisor e é
exatamente o vazamento — o ramo barato responde em ~1 ms contra ~50 ms do caro.

A única saída antecipada é a do balde de IP, por um motivo oposto: ali nada
está sendo escondido (o histórico é do próprio requisitante), e rodar argon2
seria entregar a exaustão de CPU que o balde existe para impedir.

O registro devolve `202` também para e-mail já cadastrado, com o mesmo custo de
argon2, e avisa o dono do endereço. Um `409 Conflict` — o que o bom senso REST
pediria — entregaria a lista de usuários a quem tiver uma wordlist, e tornaria
inútil todo o cuidado do login.

### Tokens de conta: uma tabela, consumo por UPDATE condicional

`account_tokens` com enum de propósito (`email_verification`,
`password_reset`, `set_initial_password`), não três tabelas: a mecânica é
idêntica e o que muda é dado. Três tabelas significariam três cópias do UPDATE
atômico de consumo, que é a única coisa aqui que não dá para errar duas vezes.
O risco de confundir propósito é fechado na porta, com um método por propósito
— nenhum chamador passa o valor.

O consumo é um único UPDATE condicional com `returning`; o UPDATE **é** a
guarda. Ler-e-depois-escrever deixa dois envios simultâneos passarem os dois, e
isso não é hipótese: scanner de segurança de e-mail corporativo abre todo link
de toda mensagem, então o robô costuma consumir o token antes do humano
clicar. A corrida é o caso normal.

O reset revoga **todas** as famílias do usuário — o inverso da cascata por
reuso, e a diferença é o modelo de ameaça: lá a evidência aponta para uma
família; aqui o usuário disse "acho que entraram na minha conta". E não emite
sessão: logar direto a partir de um link recebido por e-mail faria comprometer
o e-mail equivaler a tomar a conta, sem segundo passo.

## Consequências

**Reuso de refresh desloga também o usuário legítimo.** Do lado do servidor, um
duplo-submit e um replay de ladrão são byte a byte idênticos — mesmo token,
mesma rota, muitas vezes o mesmo IP. Sem sinal para separar, a política segura
é assumir roubo. A correção mora no cliente: refresh em **single-flight**, uma
única promessa em voo compartilhada por todos os chamadores. Isso é requisito
da 7.2, não detalhe de implementação — sem ele, duas chamadas que levem 401 ao
mesmo tempo deslogam o usuário.

**A web não pode dizer "esse e-mail já está em uso".** O formulário passa a
dizer "se o endereço estiver disponível, enviamos um e-mail de confirmação". É
custo de produto, assumido em troca de fechar a enumeração.

**Um usuário bloqueado não sabe que está bloqueado.** A resposta é idêntica à
de senha errada, porque um 429 ou um "conta bloqueada" contaria ao atacante que
a conta existe e que ele acertou o alvo. A mitigação é do lado do cliente —
depois de N respostas 401 seguidas, a tela de login sugere esperar — e é
derivada de nenhum sinal do servidor, então não vaza nada.

**O access token não é revogável.** São 15 minutos de JWT sem estado, então
existe uma janela de até 15 minutos em que um token roubado continua valendo
após um reset de senha. É o preço de não consultar o banco a cada requisição, e
é justamente por isso que o TTL é curto. Uma claim de versão de credencial
resolveria, e é anotada como backlog — vale reavaliar na 7.2, porque o
`JwtAuthGuard` atual já faz uma ida ao banco por requisição (o `syncUser`), o
que torna o custo marginal muito menor do que o normal.

**Não se afirma tempo constante.** O que os testes provam, de forma
determinística, é que nenhum ramo pula o trabalho caro e que nenhum produz
resposta distinguível: um espião no `PasswordHasher` verifica que os três ramos
de falha do login chamam `verify` exatamente uma vez, com hashes de parâmetros
idênticos. Teste de relógio em CI compartilhado é frágil, e um teste que fica
vermelho uma vez a cada vinte execuções é pior do que teste nenhum — o time
aprende a apertar "re-run". Diferenças remanescentes (uma linha a mais de log,
o INSERT do ramo conhecido no pedido de reset) são ordens de grandeza menores
do que o jitter de rede, e ficam registradas aqui como aceitas.

**Rotacionar `AUTH_TOKEN_PEPPER` desloga todo mundo** e invalida os tokens de
conta em aberto. Os peppers não têm `_PREVIOUS`: aceitar dupla verificação em
todo refresh, para sempre, por um cenário que roda uma vez a cada nunca, não
paga. Está registrado no runbook.

**A superfície pública saltou de quatro rotas para doze.** Cada uma está
justificada em [`docs/security-surface.md`](../security-surface.md), e o
`route-surface.spec.ts` lista as doze literalmente — abrir mais uma continua
exigindo mexer no teste. Vale registrar o que isso expõe: o `RateLimitGuard`
libera rota `@Public()`, então **nenhuma** das rotas de auth é coberta por ele.
Quem segura essa superfície é o lockout progressivo, e só ele.

### Backlog consciente

Fora de escopo por decisão, não por esquecimento:

- **MFA** (TOTP, WebAuthn), **login social** e **federação OIDC**. O Keycloak
  os oferecia e não eram usados; reimplementá-los agora seria pagar o custo sem
  a demanda.
- **A api como provedor OIDC.** Ela autentica os próprios usuários, não é
  emissor para terceiros.
- **Dicionário de senhas vazadas** (HIBP, rockyou). A lista curta no domínio
  pega o óbvio e não se disfarça de mais do que é.
- **Re-hash oportunista** quando os parâmetros do argon2 mudarem.
- **Replay tolerante do refresh** dentro de uma janela de graça, para amaciar o
  duplo-submit. Tem custo real de segurança — um ladrão que replique dentro da
  janela consegue um par válido sem alarme —, e por isso só entra depois do
  single-flight no cliente, se ainda for necessário.
- **Poda das tabelas de auth** (`auth_lockout_hits`, `refresh_tokens`,
  `account_tokens`). O rate limit já tem poda; estas precisam entrar no mesmo
  mecanismo.

### O que ainda falta na FASE 7a

Esta ADR cobre a 7.1. Seguem em aberto: a troca do emissor no `JwtAuthGuard`
(7.2), a colheita do OpenAPI para `docs/reference/api/` (7.3), o service token
entre engine e api, a importação dos usuários do Keycloak e a remoção do
Keycloak de compose, manifests e web. O ADR 0027 classificou a superfície HTTP
e os ADRs 0024 e 0025 desenharam imagem e deploy — os três precisarão ser
referenciados, não editados, quando o Keycloak sair.
