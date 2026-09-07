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
| o `kid` da chave de dispositivo (RN-475) | `crypto.subtle.generateKey({name:'Ed25519'})` **não existe em jsdom** — `runner-bootstrap.test.ts` dubla `crypto.subtle` inteiro, então a suite do web nunca gerou uma chave nem exportou uma JWK de verdade. Aqui o par é real, e quem diz se ele serve é o `PatAuthGuard` respondendo 201 em `runner-ticket` |

## Convenções

- **Seletor estrutural, nunca texto.** O idioma da interface é decisão do
  SERVIDOR; um teste preso a "Sign in" quebraria ao mudar o idioma da conta,
  e essa falha não fala sobre o produto.
- **Asserção sobre mecanismo, não sobre tela.** Um indicador de "conectado"
  muda de cor, rótulo e idioma sem que o socket mude nada.
- **Semeadura por HTTP** (`suporte/api.ts`), espelhando `docker/smoke.sh`. O
  navegador é caro, e preparo lento é preparo que fica desligado.

## Só UM spec por execução pode usar o estado do `setup`

O `brabo_refresh` gravado em `suporte/.estado-autenticado.json` vale **uma
vez**. `RefreshUseCase` rotaciona e tem **detecção de reuso**, que revoga a
FAMÍLIA inteira — então um segundo contexto de navegador carregando o app com
o mesmo cookie não apenas falha: ele derruba a sessão para todos os specs
seguintes, que passam a cair no login.

A punição é enganosa, como a do lockout: o spec vermelho é o **próximo** da
ordem alfabética, e ele acusa o mecanismo dele (um socket que não subiu),
nunca o cookie. Foi assim que apareceu, ao acrescentar
`chave-de-dispositivo.spec.ts`.

Regra prática: quem precisa de sessão de NAVEGADOR fica com o estado
(`socket-da-sessao.spec.ts`); quem só precisa da ORIGEM `:8088` e fala com a
api por Bearer opta por sair, com
`test.use({ storageState: { cookies: [], origins: [] } })` e um comentário
dizendo por quê — são DOIS motivos diferentes de optar por sair, e o de
`autenticacao.spec.ts` (precisa de origem limpa para provar o login) não é
este.

## Se o login começar a falhar rodando várias vezes seguidas

Não é bug de credencial, e a senha não mudou. É o **lockout progressivo por
IP** do próprio produto (`AUTH_LOCKOUT_IP_THRESHOLDS`, default
`20:30,30:120`, janela de 15 minutos), que responde com o **mesmo 401
uniforme** de senha errada — de propósito: distinguir os dois diria ao
atacante quando ele acertou o e-mail.

Cada execução gasta exatamente **3 logins** (o `setup`, o spec de
autenticação e a semeadura por HTTP), e continuará gastando 3 por mais specs
que existam: `autenticar()` memoiza o token pela execução inteira, e com
`workers: 1` os arquivos rodam no mesmo processo. Uma execução por vez, como
no CI, fica muito longe do teto; iterar dez vezes em quinze minutos, não.

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

E, no spec da chave de dispositivo, uma metade nomeada: **a INTERFACE do
onboarding do runner**. `configurarPastaAutomaticamente` começa por
`showDirectoryPicker` (File System Access API), e o Playwright não tem como
conceder esse handle — então o fluxo não é dirigido pelo
`RunnerOnboardingPanel`, e o código de `apps/web/src/lib/runner-bootstrap.ts`
**não é o código que roda ali**: os passos são reproduzidos na página, na
mesma ordem e com as mesmas chamadas de Web Crypto.

A divisão fica assim, e é de propósito: este spec prova que a CADEIA
(navegador → registro → `kid` → JWT → `PatAuthGuard`) aceita uma chave feita
assim; `runner-bootstrap.test.ts`, com o dublê, prova que o MÓDULO a faz
assim. Nenhuma das duas cobre sozinha o que as duas cobrem juntas. Fora
também, pelo mesmo motivo, a gravação dos três arquivos em disco (RN-466):
sem handle de pasta não há disco onde escrever.
