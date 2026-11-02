# ADR 0059 — A chave que assina o `state` do OAuth de git não tem default

- **Status:** aceito
- **Data:** 2026-08-08
- **Contexto anterior:** [ADR 0024](0024-fase5-imagens-producao-ci.md) (segredos
  do compose de produção), [ADR 0058](0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)
  (foi ao dispensar um alerta sobre esta chave que o defeito apareceu)

## Contexto

Ao fechar os alertas de segurança do ADR 0058, um deles (`js/insufficient-password-hash`,
sobre `oauth-state.ts`) foi dispensado com o argumento de que ali não há senha:
o "password" é `GIT_OAUTH_STATE_SECRET`, uma chave HMAC de servidor, e
HMAC-SHA256 é o primitivo certo para assinar um `state` de OAuth.

O argumento está certo e continua valendo. O que ele não considerou é que uma
chave de servidor **com valor padrão conhecido não assina nada** — e era esse o
caso. Os dois pontos de leitura faziam:

```ts
process.env.GIT_OAUTH_STATE_SECRET ?? 'dev-oauth-state-secret-change-me'
```

É o mesmo modo de falha que o `WEB_ORIGIN` já tivera fechado em
`cors-origins.ts`: default de desenvolvimento valendo igual em produção. Aqui
ele é pior por duas razões.

**A primeira é que o valor é público.** Está no `.env.example` de um
repositório open source. Não é um default fraco que um atacante precisaria
adivinhar; é um segredo publicado.

**A segunda é o que a chave protege.** O `state` é o que impede o callback do
OAuth de ser forjado (ver `docs/security-surface.md`). Com a chave conhecida,
qualquer um assina um `state` válido para `{projectId, userId, provider}` à
escolha, e o callback grava — no projeto apontado por esse payload — o token de
git obtido do provider. É CSRF no fluxo de conexão, com credencial de git como
prêmio.

E o caminho para isso acontecer não era hipotético. O `docker-compose.prod.yml`
supria o literal como fallback:

```yaml
GIT_OAUTH_STATE_SECRET: ${GIT_OAUTH_STATE_SECRET:-dev-oauth-state-secret-change-me}
```

Quem esquecesse a variável subia produção assinando com a chave do exemplo, sem
nenhum sinal. Esse detalhe decide o formato da correção, e é o mais importante
deste ADR: **exigir apenas que a variável "não esteja vazia" não teria pego
nada**, porque no caminho real de erro ela estava definida — com o valor errado.

## Decisão

A resolução da chave sai dos casos de uso e vira função única em
`apps/api/src/infrastructure/security/oauth-state-secret.ts`, ao lado do
`cors-origins.ts` que resolveu o problema equivalente. Em produção
(`NODE_ENV === 'production'`) ela **derruba o boot** em três situações:

1. variável ausente ou só com espaços;
2. variável igual ao literal de exemplo do repositório;
3. variável com menos de 16 caracteres.

Fora de produção o default continua valendo, porque `docker compose up` sem
`.env` tem que funcionar.

A verificação roda no **boot**, em `main.ts`, e não no primeiro uso. Uma api que
só falhasse quando alguém tentasse conectar git poderia passar semanas de pé
aceitando `state` assinado com chave pública — o erro precisa aparecer no start,
onde é barulhento e reversível.

### Por que uma função, e não a checagem em cada chamador

Pela mesma razão que fez `projectScopeRoot()` existir
([RN-092](../business-rules/custo.md#rn-092)): eram duas cópias do mesmo literal, em
arquivos diferentes (`start-git-oauth.use-case.ts` e
`handle-git-oauth-callback.use-case.ts`). Uma checagem duplicada é uma checagem
que um dia diverge — e divergindo aqui, o callback recusaria todo `state`
legítimo. Há teste cobrindo especificamente que as duas pontas assinam e
verificam com a mesma chave.

### Por que um piso de tamanho

A tabela de `docs/reference/configuration.md` sempre disse, sobre esta variável,
"fraco = CSRF no fluxo de conexão de git". O piso transforma a frase em
verificação. Ele é baixo de propósito: reprova `senha123` e não opina sobre uma
chave gerada por qualquer meio sério — `openssl rand -base64 32` dá 44
caracteres.

### O que mudou fora do código

- `docker-compose.prod.yml` deixa de suprir o literal. A linha continua lá, com
  valor vazio, porque omiti-la esconderia que a variável existe.
- `docker/smoke.sh` gera a própria chave e a descarta com o stack. Um valor fixo
  no script seria mais um literal público — exatamente o que a checagem existe
  para impedir.
- O README passa a mostrar a geração da chave junto do comando que sobe o
  compose de produção.

## Consequências

**Quebra deliberada:** uma produção que hoje sobe sem `GIT_OAUTH_STATE_SECRET`
(ou com a de exemplo) **deixa de subir**, com mensagem dizendo o que gerar. Isso
é o objetivo, não um efeito colateral: essa produção já estava vulnerável, e
antes não havia como saber. Vale para o `docker compose -f
docker/docker-compose.prod.yml` documentado no README.

Em Kubernetes nada muda: `deploy/k8s/base/common/externalsecrets.yaml` já
buscava a variável de um cofre.

**Fica aberto, e é maior que este ADR:** o mesmo padrão vale para
`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` e
`SECRET_KEY_BASE`, todos com default de desenvolvimento no compose de produção.
Nenhum foi tocado aqui — o escopo desta mudança foi a chave do OAuth, e tratar
os outros de passagem esconderia que são quatro decisões independentes, cada uma
com seu raio de quebra. Está registrado em
[docs/explanation/backlog.md](../explanation/backlog.md).
