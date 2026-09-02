# 0128 — A porta de Docker, e a prova de empacotamento que escolheu a implementação

## Context

O plano de execução em container real tem dois lugares que precisam falar com um
daemon Docker: o **runner** (o Docker da máquina do usuário, para projeto em
modo `runner`) e um **broker** servidor a nascer (PR 1.2, para projeto em modo
`container`). A api nunca recebe o socket, e isso é decisão fechada.

A escolha da biblioteca estava condicionada a uma prova, não a uma preferência.
`dockerode` é o cliente Node de fato para Docker, mas o runner é distribuído por
TRÊS caminhos — clonar o monorepo, `npm install -g @brabo/runner` (ADR 0106) e um
binário standalone via `bun build --compile` (ADR 0112) — e o terceiro é o mais
frágil dos três: ele já precisou de um gerador de manifesto próprio
(`scripts/build-bin.mjs`) para embutir o `.node` de `node-pty`, porque o Bun só
embute arquivo alcançado por especificador ESTÁTICO.

A árvore que `dockerode@5` arrasta é grande — `docker-modem`, `ssh2`,
`@grpc/grpc-js`, `protobufjs`, `tar-fs` — e `ssh2` carrega um binding nativo
OPCIONAL (`cpu-features`). Daí a ordem que o dono do produto fixou: **provar
primeiro, desenhar depois**, com a decisão já escrita para os dois desfechos —
verde, `dockerode` fica; quebrou, o runner cai para `execFile('docker', …)` e
este ADR registra o erro exato como motivo. Nada de patch de bundler ou shim: um
workaround criativo aqui vira dívida que ninguém entende depois.

## Decision

### A prova, e o que ela devolveu

`dockerode@5.0.1` + `@types/dockerode@4.0.1` entraram em `apps/runner`, com um
adaptador que IMPORTA, INSTANCIA (`new Docker()`) e CHAMA (`ping()`) — exercitado
por uma flag `--self-test-docker` rodada contra os artefatos, nunca por um
`import` que o bundler pudesse apagar.

| passo | resultado |
|---|---|
| `pnpm --filter runner build` (tsup) | **passou** — mas o `tsup` deixa `dependencies` como `require` externo (é assim que `jose` já vive hoje), então `dockerode` nem entrava no bundle |
| `pnpm --filter runner smoke` | **passou** — `node dist/index.cjs --self-test-docker` resolveu `dockerode` do `node_modules` e falou com o daemon |
| `pnpm --filter runner build:bin` (`bun build --compile`) | **REPROVOU** |

O erro, colado inteiro:

```
3 | const binding = require('../build/Release/cpufeatures.node');
                            ^
error: Could not resolve: "../build/Release/cpufeatures.node"
    at /…/node_modules/.pnpm/cpu-features@0.0.10/node_modules/cpu-features/lib/index.js:3:25
```

A cadeia é obrigatória, não acidental — foi lida no código instalado, não
suposta:

```
dockerode → docker-modem (lib/modem.js, linha 6: require('./ssh'))
          → ssh2 (lib/protocol/constants.js, linha 7: require('cpu-features'))
          → cpu-features/lib/index.js → require('../build/Release/cpufeatures.node')
```

`lib/modem.js` faz `require('./ssh')` no topo do módulo: o transporte SSH entra
no grafo mesmo neste runner, que só fala com o socket unix local. O `require` do
`cpu-features` é envolvido por `try/catch` dentro do `ssh2` e degrada
graciosamente **em runtime** — mas quem resolve o grafo aqui é o BUNDLER, em
tempo de build, e bundler não tem `try/catch`. É a mesma classe de problema que
o ADR 0112 documentou com `node-pty`, com uma diferença que decide: ali o
binding é ESSENCIAL (sem ele não há terminal, e por isso valeu construir o
mecanismo de embutir), e aqui é aceleração opcional de um transporte que não
usamos.

**Medido e NÃO adotado, para o registro:** `bun build --compile --external
cpu-features` compila (280 módulos contra 79), produz um binário de 84 473 032 B
(+1,7 MB) e o `dockerode` FUNCIONA lá dentro — o `ping` responde contra o daemon
real, porque o `try/catch` do `ssh2` engole o stub que o Bun deixa no lugar. Isto
está escrito para que ninguém precise refazer a investigação, e é exatamente o
workaround que a decisão do dono do produto excluiu de antemão: ele arrasta um
`.node` opcional de uma árvore SSH morta para dentro de cinco binários por
plataforma, e a dívida ficaria ilegível seis meses depois.

**Portanto: o runner usa `execFile('docker', …)`.** `dockerode` foi removido do
`package.json` e do lockfile; nada dele sobrou na árvore. O broker (PR 1.2) NÃO
herda esta decisão — ele roda numa imagem que nós construímos e nunca vira
binário standalone, então `dockerode` segue candidato lá, e é precisamente para
isso que a porta abaixo existe.

### Tamanhos, medidos

| artefato | antes | depois | delta |
|---|---|---|---|
| `dist/index.cjs` | 91 843 B | 106 221 B | +14 378 B (+15,7 %) |
| `dist-bin/brabo-runner-linux-x64` | 82 777 288 B | 82 789 576 B | +12 288 B (+0,015 %) |

O crescimento é o código novo (porta + adaptador + auto-teste), não dependência:
`execFile` vem de `node:child_process`, e não há árvore a embutir. Para
comparação, a alternativa recusada custava **+1,7 MB por binário, vezes cinco
plataformas**.

### A porta

`apps/runner/src/docker-port.ts`, na mesma forma dos dois contratos que o
repositório já usa para isolar fornecedor externo (`LLMProvider` do ADR 0041 e o
`GitProviderContract` da Fase 2): classe abstrata, tipos próprios do domínio,
erros normalizados por CLASSE — quem consome decide pelo tipo do erro, nunca por
substring de mensagem de vendor.

**Cinco operações, e não seis:** `start`, `stop`, `remove`, `inspect`, `exec`.

**A contenção é o TIPO, não a disciplina de quem chama.** O que a porta não
deixa ESCREVER é a metade que importa:

- `privileged` e `cap_add` — não existe campo, e nenhum tipo de biblioteca
  atravessa a porta: a especificação é FECHADA e o adaptador é quem monta o
  payload. Não há de onde copiar a opção;
- `network: host` — `RedeDoContainer` é a união `'none' | 'egress'`, a mesma
  postura de fronteira do ADR 0065. `host` não é um valor do tipo, então não é
  uma frase que se possa dizer;
- **bind-mount livre** — não há LISTA de mounts. Há UMA pasta, o destino é a
  constante `PONTO_DE_MONTAGEM` (`/work`), e o tipo da pasta é de MARCA
  (`RaizDeProjeto`): só `raizDeProjetoValidada()` produz um valor desse tipo, e
  ela recusa caminho relativo, com `..`, com NUL, a raiz do filesystem e as
  pastas de sistema (`/etc`, `/var` — que é onde mora o socket do próprio
  Docker —, `/dev`, e as outras). Montar `/` não é "desaconselhado" aqui: não
  compila.

**Nenhuma operação recebe id de container.** Todas partem do `workspaceDirName`
(RN-109, congelado na criação), derivam `brabo-<workspace_dir_name>` e resolvem
por `docker ps` FILTRADO por nome **e** pelo rótulo `brabo.managed=true`. "Pare o
container X", com X arbitrário, não é uma frase que esta porta saiba ouvir — e
homônimo sem o rótulo devolve `ContainerNaoGerenciadoError`, nunca `null`:
tratá-lo como ausente faria o `start` tentar criar por cima e falhar com "name
already in use", uma mensagem que não diz nada sobre a única coisa que de fato
aconteceu.

**Onde a porta mora, e por quê.** Em `apps/runner/src/`, porque o runner é o
único consumidor que existe hoje. `packages/shared` foi considerado e recusado
por um invariante que o próprio pacote declara e um teste da api mantém honesto
(`packages-shared-so-tipos.spec.ts`): ele é 100 % TIPO, nada ali pode sobreviver
ao `tsc`, porque o `main` aponta para `.ts` cru e a imagem de produção da api
morreria com `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Uma porta com classes
de erro e uma função de validação é código de runtime. Partir o contrato em
"tipos lá, erros aqui" criaria duas fontes para uma coisa só — que é o defeito
que a porta existe para evitar. Quando `apps/broker` nascer, o arquivo **MOVE**
para um pacote de workspace; ele não é COPIADO, e isso está escrito no docblock
dele, porque um segundo arquivo com as mesmas cinco operações e uma sexta "só no
broker" é o começo do fim da contenção acima.

### Classificação de falha

Três desfechos nomeados, no vocabulário do produto (`infra | modelo | código |
política`), e um quarto deliberadamente SEM origem:

| classe | origem | quando |
|---|---|---|
| `DockerIndisponivelError` | `infra` | o daemon não atendeu. A mensagem diz o que FAZER (`docker info`, grupo `docker` no Linux) e que nenhum container foi tocado |
| `DockerCliAusenteError` | `infra` | o executável `docker` não está no `PATH`. É erro PRÓPRIO e não "daemon fora": os dois se consertam de formas diferentes, e colapsá-los é a lição da RN-475 um andar abaixo |
| `ContainerNaoGerenciadoError` | `política` | existe container com o nome derivado e SEM o rótulo `brabo.managed=true` |
| `ComandoDeDockerFalhouError` | *nenhuma* | o daemon está vivo e recusou o comando. A mensagem dele vai inteira |

O quarto não declara origem de propósito: escolher entre infra e código para
"No such image" seria diagnóstico por eliminação, que é o defeito que o ADR 0020
registra como o a não repetir. Ele diz que é o resto, e mostra o que o daemon
disse.

A separação entre "daemon fora" e "daemon recusou" é feita pelo COMANDO, não por
substring: qualquer saída não-zero dispara um `docker version` de confirmação, e
é o resultado DELE que decide a classe. Custa uma chamada a mais e só no caminho
de falha — o preço de não classificar por texto de vendor, que o ADR 0002 (git) e
o ADR 0041 (LLM) já proíbem dos outros dois lados.

## Consequences

**Nada sobe container ainda, e isso é o escopo.** A porta existe, o adaptador
existe, e ninguém os chama: nenhuma mensagem nova no canal Phoenix, nenhuma
mudança de comportamento observável. `start`/`stop`/`remove`/`inspect`/`exec`
estão cobertos por duplo em `docker-cli.spec.ts` e **nenhum deles foi exercitado
contra um daemon de verdade** — só o `ping` foi, pelo `--self-test-docker`. É a
mesma disciplina de "capability só é declarada quando provada": quem prova as
cinco é a PR 1.3, que as liga ao canal.

**O runner passa a exigir o BINÁRIO `docker` no `PATH`, não só o socket.** Na
máquina de quem roda Docker isso é praticamente sempre verdade, e a ausência tem
erro próprio. É a diferença mais visível entre esta escolha e a recusada:
`dockerode` fala com o socket direto e não precisaria do CLI.

**A saída do CLI é texto, e texto não é contrato versionado.** Toda leitura usa
`--format '{{json .}}'` com `JSON.parse` tolerante (linha ilegível vira `null`,
nunca exceção), nunca corte de coluna. A versão do CLI é a da máquina do
usuário, então nenhuma flag exótica é usada — só opções que existem há muitas
versões. Ainda assim: uma mudança de formato do `docker ps` quebraria a leitura,
e isso é risco que o `dockerode` não teria.

**O timeout de `exec` mata o cliente, não o comando.** `docker exec` encerrado
por timeout deixa o processo rodando DENTRO do container, e não há como matá-lo
sem um segundo exec e um PID que este caminho não conhece. A saída DIZ isso, em
vez de deixar quem lê supor que o comando morreu.

**Nenhuma RN nasce aqui, e é declarado.** Não há comportamento observável para
uma regra descrever: o produto não chama a porta. A regra a registrar — só o
container com `brabo.managed=true` é parado, removido ou usado como destino de
`exec` — nasce na PR que faz um container subir de verdade, junto com a evidência
de teste que a cobre.

**A prova fica viva.** `--self-test-docker` roda nos dois smokes
(`pnpm --filter runner smoke` e `smoke:bin`) e passa nos DOIS desfechos do
auto-teste — daemon respondeu, daemon não atendeu —, porque a pergunta é sobre o
ARTEFATO e não sobre a máquina: exigir daemon faria o smoke parar de rodar
exatamente onde ele mais precisa rodar (o CI, que não tem Docker para o runner).
O que ele garante daqui pra frente é que a porta chega inteira no `dist` e no
binário, e que Docker ausente vira erro NOMEADO em vez de stack trace cru.

**O que ninguém deve refazer.** Se um dia alguém propuser `dockerode` no runner
de novo, a resposta já está medida acima: ele quebra o `build:bin`, e o único
caminho conhecido para fazê-lo caber é o `--external cpu-features` que foi
recusado. No BROKER a pergunta é outra e continua aberta — lá não há binário
standalone, e a porta é o que torna essa segunda resposta uma implementação em
vez de uma reescrita.
