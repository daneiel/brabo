# E2E de navegador

A quarta camada da pirâmide. As três de baixo já rodam com `pnpm test`;
esta precisa de um **navegador de verdade** e do **compose de produção de
pé**, porque o que ela prova só existe lá.

Decisão completa: [ADR 0120](../docs/adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md).

## Como rodar

```bash
pnpm e2e:navegadores                      # uma vez: baixa o chromium
SMOKE_KEEP_UP=1 bash docker/smoke.sh      # sobe o stack e DEIXA de pé
pnpm e2e                                  # roda os specs contra ele
docker compose -f docker/docker-compose.prod.yml down -v
```

Da raiz, sempre por `pnpm e2e` / `pnpm --dir e2e ...`. **`pnpm --filter e2e`
não funciona** — e não é bug, é o desenho abaixo.

## Por que fora do workspace

`e2e/` tem `pnpm-workspace.yaml` e `pnpm-lock.yaml` próprios, instalados com
`pnpm install` de dentro desta pasta. É o mesmo desenho do `website/`
([ADR 0117](../docs/adr/0117-lockfile-proprio-para-o-website.md)), pelo mesmo
motivo: a árvore do Playwright não chega a imagem nenhuma, e deixá-la no
lockfile da raiz faria o `pnpm audit` do produto reportar ferramenta de teste
como se fosse superfície do que embarca.

Que este pacote TESTE o produto não muda o argumento — o que decide é para
onde a dependência **vai**, não sobre o que ela fala.

## O que estes testes provam, e por que só aqui

| mecanismo | por que jsdom não alcança |
|---|---|
| refresh em cookie `httpOnly` | `httpOnly` é garantia do BROWSER; em jsdom o cookie seria legível e a asserção passaria mentindo |
| CSRF + origem cruzada (`:8088` → `:3000`) | não há origem de verdade nem preflight — o `main.ts` da api registra: "teste não faz preflight" |
| sessão que sobrevive ao reload | é o único jeito de provar que o access em memória foi RECONSTRUÍDO do cookie, e não que nunca sumiu |
| ticket de uso único do socket (RN-108) | exige handshake de WebSocket real contra o engine, numa TERCEIRA origem |

## Convenções

- **Seletor estrutural, nunca texto.** O idioma da interface é decisão do
  SERVIDOR; um teste preso a "Sign in" quebraria ao mudar o idioma da conta,
  e essa falha não fala sobre o produto.
- **Asserção sobre mecanismo, não sobre tela.** Um indicador de "conectado"
  muda de cor, rótulo e idioma sem que o socket mude nada.
- **Semeadura por HTTP** (`suporte/api.ts`), espelhando `docker/smoke.sh`. O
  navegador é caro, e preparo lento é preparo que fica desligado.

## Se o login começar a falhar rodando várias vezes seguidas

Não é bug de credencial, e a senha não mudou. É o **lockout progressivo por
IP** do próprio produto (`AUTH_LOCKOUT_IP_THRESHOLDS`, default
`20:30,30:120`, janela de 15 minutos), que responde com o **mesmo 401
uniforme** de senha errada — de propósito: distinguir os dois diria ao
atacante quando ele acertou o e-mail.

Cada execução gasta cerca de **3 logins** (o `setup`, o spec de autenticação
e a semeadura por HTTP). Uma execução por vez, como no CI, fica muito longe
do teto; iterar dez vezes em quinze minutos, não.

Saídas, em ordem de preferência:

1. esperar a janela drenar (o primeiro degrau são 30 segundos);
2. subir o compose com o teto mais permissivo só para a sessão de trabalho:
   `AUTH_LOCKOUT_IP_THRESHOLDS=200:5 SMOKE_KEEP_UP=1 bash docker/smoke.sh`.

`suporte/api.ts` já reconhece esse 401 e devolve uma mensagem dizendo isto —
sem ela, a próxima pessoa caça um bug de credencial que não existe. Foi o que
quase aconteceu ao escrever esta camada.

## O que NÃO está coberto

Declarado, não esquecido (ver as Consequências do ADR 0120): diferenças
entre navegadores (só chromium roda), aprovação inline e streaming.
