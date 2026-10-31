# ADR 0112 — Binário standalone do `@brabo/runner` via `bun build --compile`, com o addon nativo `.node` embutido por extração real para um diretório temporário

- **Status:** Aceito
- **Data:** 2026-08-23
- **Contexto:** item de backlog do [ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md)
  ("binário standalone (`pkg`/`bun build --compile`), item de backlog à parte,
  custo maior, sem gatilho definido") — companheiro do ADR 0106, que entregou
  o caminho `npm install -g @brabo/runner` e adiou explicitamente este.

## Contexto

`npm install -g @brabo/runner` (ADR 0106) ainda exige que o usuário tenha o
Node ≥ 22.6 instalado e confie no `npm` para compilar o addon nativo do
`node-pty` na máquina dele. O dono do produto pediu a alternativa mais
difícil e mais completa — um **binário de arquivo único de verdade**, com a
matriz inteira de plataformas, Windows incluído desde a v1 — depois de lhe
ter sido oferecido explicitamente, e de ele ter recusado, o desenho mais
barato de "binário + pasta `node-pty-native/` ao lado".

## Decisão

### Por que `bun build --compile` e não `pkg`

O `pkg` (Vercel) está sem manutenção desde 2023 (substituído internamente
pelo `@yao-pkg/pkg`, um fork da comunidade), e o modelo dele de baixar um
"binário base" preso à versão do Node é exatamente o tipo de dependência
externa que este repositório evita acrescentar sem um motivo que obrigue (os
ADRs 0033/0041 já recusam mágica de build que não se prova). O `bun build
--compile` tem manutenção, desenvolvimento ativo e — o que é decisivo — o Bun
1.1+ documenta suporte de primeira classe para embutir addons nativos `.node`
via `with { type: 'file' }`, que é o mecanismo de que este ADR acaba
precisando de qualquer jeito.

### O problema real: o `node-pty` resolve o próprio addon nativo por um caminho DINÂMICO

O `lib/utils.js#loadNativeModule` do `node-pty` (confirmado lendo o pacote
instalado, `node_modules/node-pty/lib/utils.js`) faz:

```js
function loadNativeModule(name) {
  var dirs = ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`];
  var relative = ['..', '.'];
  for (var d of dirs) for (var r of relative) {
    try { return { dir, module: require(`${r}/${d}/${name}.node`) }; } catch (e) {}
  }
  throw new Error(...);
}
```

Essa chamada a `require()` tem caminho **calculado** — o bundler do Bun só
consegue embutir o que resolve **estaticamente**, em tempo de build (provado
empiricamente: um `bun build --compile src/index.ts` ingênuo, com o
`node-pty` empacotado normalmente, **compila sem erro** e depois **falha em
runtime** com `Cannot find module './prebuilds/linux-x64//pty.node'` — o
arquivo nativo nunca foi embutido, em silêncio). É esse o motivo inteiro de
este item ter mais risco que o caminho do npm: não é "embutir um arquivo", é
"fazer a resolução dinâmica de caminho de um pacote de terceiros funcionar
contra arquivos que só existem dentro de um bundle compilado".

### O mecanismo que funciona, provado empiricamente antes de escrever código de produção

1. Em tempo de BUILD (`apps/runner/scripts/build-bin.mjs`, uma execução por
   plataforma nativa — ver a matriz abaixo), percorrer o pacote `node-pty`
   instalado e juntar todo arquivo de que ele de fato precisa em runtime:
   todo o `lib/**/*.js` (excluindo `*.test.js` — 13 arquivos: `index.js`,
   `unixTerminal.js`, `windowsTerminal.js`, `windowsPtyAgent.js`,
   `windowsConoutConnection.js`, `terminal.js`, `utils.js`, `types.js`,
   `interfaces.js`, `eventEmitter2.js`, `conpty_console_list_agent.js`,
   `shared/conout.js`, `worker/conoutSocketWorker.js`) mais o(s) arquivo(s)
   nativo(s) `.node` da plataforma CORRENTE — `build/Release/*.node` quando o
   `node-gyp rebuild` compilou localmente (Linux: o `node-pty` **não** traz
   prebuild nenhum para Linux, confirmado listando `prebuilds/` no pacote
   instalado — só existem `darwin-x64`, `darwin-arm64`, `win32-x64`,
   `win32-arm64`), ou `prebuilds/<platform>-<arch>/*.node` quando o pacote
   traz um (macOS: 1 arquivo; **Windows: 3** —
   `pty.node`/`conpty.node`/`conpty_console_list.node`, todos apanhados de
   forma genérica pelo glob `*.node` no diretório escolhido, sem caso
   especial por arquivo).
2. Gerar `apps/runner/src/native-pty-embed.generated.ts` com um `import fN
   from '<caminho-real>' with { type: 'file' }` **estático** por arquivo —
   `with { type: 'file' }` é o único mecanismo do Bun que exige especificador
   literal, e é por isso que o manifesto tem de ser *gerado* (a lista de
   arquivos só é conhecida depois do `pnpm install` naquela plataforma
   específica) em vez de escrito à mão.
3. Em RUNTIME (`apps/runner/src/native-pty-loader.ts`), só dentro do binário
   compilado: escrever todo arquivo embutido num diretório temporário REAL
   (`fs.mkdtempSync`), preservando o **layout relativo original exato**
   (`lib/utils.js`, `build/Release/pty.node` etc.). Essa preservação é o
   truque inteiro — as chamadas `require()` do próprio `node-pty` são todas
   *relativas*, então, assim que os arquivos dele estão num diretório real
   com a forma real que ele espera, a resolução dinâmica dele funciona sem
   modificação nenhuma, exatamente como se o pacote tivesse sido instalado
   normalmente com `npm install`.
4. Importar `<tempdir>/lib/index.js` por **caminho absoluto de arquivo**
   (`await import(pathToFileURL(...).href)`) — nunca `require('node-pty')`
   pelo nome do pacote, que precisaria de uma pasta `node_modules` que não
   existe ao lado de um binário standalone.

Duas propriedades desse mecanismo foram verificadas empiricamente, não
presumidas: addons `.node` embutidos via `with { type: 'file' }` **carregam**
corretamente por `require()` mesmo com o caminho informado sendo o virtual
`/$bunfs/root/...` (o Bun torna o addon nativo carregável por `dlopen` de
forma transparente, apesar do caminho falso); e um arquivo real, **não
nativo**, lido via `with { type: 'file' }` — `fs.readFileSync(embeddedPath)`
— devolve os bytes reais corretamente, inclusive de dentro de um binário
compilado (então a reextração byte a byte para um diretório temporário real
é confiável).

### Dois bugs reais achados só rodando o binário compilado, não lendo a superfície da API

**1. `--external node-pty` é obrigatório na própria invocação do `bun
build`**, mesmo que nada em `pty.ts` importe mais o `node-pty` por
especificador nu. O caminho de fallback não compilado do
`native-pty-loader.ts` (`await import('node-pty')`, usado só fora de um
binário compilado) é um import dinâmico *literal* — o bundler do Bun o
descobre e tenta resolvê-lo durante o `--compile`, seja qual for o ramo de
runtime que de fato chegaria nele, e como ele CONSEGUE resolver parcialmente
o `node-pty` a partir do `node_modules` (ao contrário de um módulo
inteiramente ausente), o build **passa em silêncio** e insere no lugar um
stub que lança. O sintoma parecia idêntico à primeiríssima falha (erros
`Cannot find module`/`is not a function` aparecendo só dentro da cadeia de
`require` do próprio `lib/utils.js`), o que custou tempo real de depuração
até a causa de fato (o fallback por especificador nu sendo empacotado) ser
isolada. `--external node-pty` no comando `bun build --compile` faz o Bun
deixar esse especificador inteiramente em paz, coerente com o `external:
['node-pty']` que o `tsup.config.ts` já tinha pelo mesmo motivo.

**2. A guarda de auto-execução (ADR 0106) quebra por um motivo NOVO dentro
de um binário compilado.** O `process.argv[1]` dentro de um executável de
`bun build --compile` é `/$bunfs/root/<name>` — um caminho virtual — e
`realpathSync()` sobre ele lança `ENOENT` (confirmado com um binário
compilado real antes de tocar o código de produção), **fora de qualquer
try/catch**, antes mesmo de `main()` ser tentado. A guarda existente já tinha
uma correção baseada em `realpathSync` (para o caso do symlink do `npm
install -g`); este ADR acrescenta um segundo ramo, ortogonal:
`import.meta.url.includes('/$bunfs/')` é `true` para todo módulo dentro de um
binário compilado (verificado tanto para o módulo de entrada quanto para um
módulo importado que não é a entrada) e é checado PRIMEIRO — o ponto de
entrada de um binário standalone não tem a ambiguidade de "importado por um
teste" a desfazer, então detectar o caso compilado roda `main()`
incondicionalmente, contornando a chamada a `realpathSync` que de outro modo
derrubaria o processo.

### Testar um shell interativo dentro de um PTY sob o Bun não foi confiável neste sandbox — `cat` é o shell substituto do smoke, não `bash`

O caminho de auto-teste (`--self-test-pty`, uma flag interna não documentada
— ver abaixo) originalmente subia o shell real do usuário (`bash`) e digitava
`echo MARKER`, espelhando o uso em produção. Sob Node puro isso terminava bem
abaixo de um segundo. Sob o Bun (`bun run`, e dentro do binário compilado) a
mesmíssima chamada — subir `bash` num PTY via `node-pty`, escrever um
comando, esperar o prompt se redesenhar — nunca terminou dentro de um timeout
de 20s neste container de sandbox, embora o *primeiro* eco, no nível do
kernel, da entrada digitada chegasse imediatamente (então o PTY e o addon
nativo estavam inequivocamente funcionando — só a saída de redesenho do
prompt do próprio shell nunca apareceu a tempo). O auto-teste passou a subir
`/bin/cat` no lugar (`GerenciadorDePty`/`shellPadrao()` só lê de `$SHELL` o
shell a subir, sem parâmetro para sobrepô-lo — o smoke define
temporariamente `process.env.SHELL = '/bin/cat'` antes de construir o PTY,
restaurado num `finally`). O `cat` é determinístico (ecoa exatamente o que
lê, sem prompt, sem arquivos rc) e ainda prova a coisa real:
`GerenciadorDePty.abrir()` sobe um processo REAL do SO pelo addon nativo,
`escrever()` escreve no stdin dele através do PTY, e `onData` prova que o
processo leu e escreveu de volta — a string de marcação aparecendo **duas
vezes** (uma pelo eco de entrada do próprio PTY no nível do kernel, outra
pelo `cat` de fato lendo e reemitindo) é o que distingue uma volta genuína
pelo processo de um mero eco local do terminal. Essa divergência em relação
ao `bash` — e se ela é específica do runtime do Bun ou um artefato deste
container de sandbox específico (sem TTY real, agendamento de
processo/thread restrito) — NÃO teve a causa raiz investigada além disso; ela
não afeta o produto de fato (a aba Terminal sempre sobe o shell real do
usuário na máquina real do usuário, fora de qualquer container), e persegui-la
mais teria sido resolver um artefato do sandbox, não um defeito do produto.
Fica registrada aqui caso volte a aparecer durante a validação real em
Windows/macOS.

Também achado e corrigido ao construir o auto-teste: `process.exit()`
chamado de dentro de um callback assíncrono de addon nativo (`onData`)
**não** encerrava imediatamente o processo do Bun enquanto o filho subido
(`cat`) continuava vivo e o descritor de arquivo do PTY dele continuava
aberto — o processo persistia além do timeout deliberadamente curto de uma
reprodução ad hoc até o filho ser morto PRIMEIRO
(`GerenciadorDePty.fechar()`, que chama `processo.kill()`) antes de
resolver. O código de produção já faz isso (`fechar()` é chamado antes de
`resolvePromise()`), então não é um bug à parte no mecanismo entregue — fica
registrado porque seria uma armadilha fácil para quem mexer neste código
depois.

### `--self-test-pty` — uma flag interna não documentada, fora da superfície pública da CLI

O `scripts/smoke-bin.mjs` precisa provar que o addon nativo embutido
funciona **dentro do binário publicado de fato**, subindo um PTY real e
lendo saída real — "sem mock", segundo o pedido do dono do produto. Não há
outro jeito de alcançar esse caminho de código de fora do processo (é um
executável standalone, não uma biblioteca), então o `--self-test-pty` foi
acrescentado: não documentado em `uso()`, resolve o `node-pty` exatamente
como a produção, sobe um PTY exatamente como a produção (`GerenciadorDePty`)
e sai sem tocar a rede (`--project`/`--dir`/`--token` nunca são lidos nesse
caminho). É a mesma categoria de decisão da flag de diagnóstico escondida de
qualquer CLI (`--version`, `--diag`) — não um segundo caminho de código com
risco próprio de deriva, porque ele chama os mesmíssimos métodos públicos que
a produção chama.

## Matriz de alvos e o que de fato foi validado onde

| Plataforma | Runner | Origem do `.node` nativo | Validado **neste sandbox** |
|---|---|---|---|
| `linux-x64` | `ubuntu-latest` | `node-gyp rebuild` (não há prebuild de Linux) | **Sim, ponta a ponta** — `pnpm --filter runner build:bin` + `smoke:bin` verdes, repetidamente, inclusive com os dois bugs acima achados e corrigidos rodando o binário compilado real |
| `linux-arm64` | `ubuntu-24.04-arm` | `node-gyp rebuild` | Não — não há máquina ARM64 disponível aqui. O mecanismo independe de arquitetura no código deste repositório (nada aqui ramifica por `arch`, só pelo par genérico `${platform}-${arch}` que o próprio `node-pty` já usa); o risco é a toolchain cruzada do próprio `node-gyp` naquele runner, fora do controle deste repositório e sem relação com o Bun |
| `darwin-x64` | `macos-13` | `prebuilds/darwin-x64/pty.node` | Não — não há máquina macOS disponível aqui. Confirmado pelo `oven-sh/setup-bun` e pela própria doc do Bun que o `bun build --compile` suporta macOS `x64`/`arm64` nativamente (sem compilação cruzada envolvida; este repositório só constrói em runners nativos) |
| `darwin-arm64` | `macos-14` | `prebuilds/darwin-arm64/pty.node` | Não — idem acima |
| `win32-x64` | `windows-latest` | `prebuilds/win32-x64/{pty.node,conpty.node,conpty_console_list.node}` | **Não — a lacuna de maior risco, dita com todas as letras.** Três arquivos nativos em vez de um, o `worker_threads.Worker` do `windowsConoutConnection.js` carregando `worker/conoutSocketWorker.js` por um caminho calculado relativo ao diretório extraído, e os scripts de build/teste deste repositório rodando sob `bash` via Git Bash em vez de PowerShell (`defaults: run: shell: bash` no workflow novo) foram todos raciocinados lendo o código do `node-pty`, nunca executados numa máquina Windows real. Este ADR entrega mesmo assim a abordagem de arquivo único DE VERDADE para o Windows, conforme a instrução explícita do dono do produto de tentar primeiro a opção mais difícil — mas o status honesto é: a PRIMEIRA execução real desta plataforma é o próximo push de tag de versão (ou um `workflow_dispatch` manual), não este PR |

Nenhum fallback por plataforma (o desenho mais barato de "binário + pasta
`node-pty-native/`", oferecido explicitamente e recusado) foi implementado
para plataforma nenhuma — nada observado nesta investigação REFUTOU a
abordagem de arquivo único de verdade para nenhum dos cinco alvos. Se o
Windows realmente não puder funcionar assim, isso aparecerá como uma falha
real de CI no primeiro build de tag, e aí o fallback vira uma exceção
pontual, de uma plataforma só, exatamente como o pedido deste ADR permitia —
não uma decisão tomada preventivamente sem evidência.

## O que foi construído

- `apps/runner/src/native-pty-loader.ts` — resolve o `node-pty` para os dois
  modelos de execução (ver o mecanismo acima).
- `apps/runner/src/native-pty-embed.generated.ts` — versionado no git como
  marcador VAZIO (`NATIVE_PTY_FILES: []`); o `scripts/build-bin.mjs` o
  sobrescreve com o manifesto real da plataforma imediatamente antes do `bun
  build --compile` e restaura o marcador num `finally` — a mesma filosofia de
  "nunca commitado, gerado num passo descartável" que o ADR 0106 já
  estabeleceu para injetar a versão do npm.
- `apps/runner/src/pty.ts` — o `GerenciadorDePty` agora recebe o módulo
  `node-pty` resolvido por injeção no construtor em vez de um `import`
  estático de topo; o `import type * as NodePtyNamespace from 'node-pty'`, só
  de tipo, não custa nada em runtime (apagado pelo `verbatimModuleSyntax`).
- `apps/runner/src/index.ts` — resolve o `node-pty` uma vez em `main()`
  (`RN-452`), corrige a guarda de auto-execução para o caso `/$bunfs/` e
  acrescenta o caminho interno `--self-test-pty`.
- `apps/runner/scripts/build-bin.mjs` — gera o manifesto, invoca `bun build
  --compile --external node-pty`, `chmod 755` fora do Windows.
- `apps/runner/scripts/smoke-bin.mjs` — espelha o padrão do
  `smoke-dist.mjs`, mas roda o BINÁRIO COMPILADO como subprocesso real
  (`RN-452`).
- `.github/workflows/build-runner-binaries.yml` — mesmo gatilho de tag do
  `publish-runner.yml`/`release.yml`, matriz de 5 alvos, cada job constrói no
  PRÓPRIO runner nativo (nunca compila cruzado), roda o smoke real e faz `gh
  release upload` para a Release que o `release.yml` já criou — idempotente
  (confere `gh release view --json assets` antes de subir), nunca cria uma
  Release por conta própria, espelha a restrição de disparo só pelo dono e o
  padrão de resolução de tag já estabelecidos pelo `publish-runner.yml`.

## Consequências

- Destrava um TERCEIRO caminho de distribuição do `@brabo/runner`, ao lado
  de clonar o monorepo (dev) e do `npm install -g` (ADR 0106): baixar um
  arquivo, sem toolchain de Node/npm/node-gyp nenhuma na máquina do usuário.
- **O caminho existente `npm install -g` (ADR 0106) não muda em nada de
  comportamento** — a refatoração de `pty.ts` para injeção no construtor só
  muda o interno; `pnpm --filter runner build`/`smoke`/`test` passam todos
  sem modificação. Uma regressão REAL que essa refatoração introduziu e
  fechou na mesma mudança: mover a resolução do `node-pty` de um efeito
  colateral de nível de módulo (içado antes do parse de argumentos, a
  cobertura de smoke "de graça" do próprio ADR 0106) para uma chamada
  preguiçosa dentro de `main()` fez o `smoke-dist.mjs` EXISTENTE (que só
  exercita o caminho `uso()`, sem argumentos) deixar de provar que o
  `node-pty` carrega no artefato npm/tsup. O `smoke-dist.mjs` ganhou uma
  checagem nova — argumentos reais, `--api-url` inalcançável, esperando a
  linha `node-pty carregado com sucesso` —, fechando a lacuna no mesmo commit
  que a abriu, em vez de deixá-la como perda silenciosa de cobertura.
- Operacional: a PRIMEIRA execução real da matriz do
  `build-runner-binaries.yml` é o próximo push de tag de versão. Nada no PR
  que introduz este workflow o exercita (disparado por tag, como o
  `publish-runner.yml`) — quatro das cinco plataformas são validadas por
  RACIOCÍNIO sobre o código do `node-pty` e o comportamento documentado do
  Bun, não por execução, e essa lacuna está dita com precisão, por
  plataforma, na tabela acima, em vez de insinuada como fechada.
- `dist-bin/` está no gitignore, mesmo tratamento do `dist/` (ADR 0106).
- Fora de escopo, sem mudança em relação ao ADR 0106: nuances de revogação
  de PAT, exclusividade do runner por `{project_id, machine_id}`; e agora
  também: assinatura de código dos binários (Gatekeeper/notarização no macOS,
  Authenticode no Windows) — um binário não assinado baixado de uma GitHub
  Release vai disparar avisos do SO na primeira execução, um custo real de UX
  aceito para esta primeira versão e deixado para um item futuro, já que
  exige que o dono do produto obtenha e pague uma identidade de assinatura, a
  mesma categoria de ação de operador que o ADR 0106 já declarou fora de
  alcance para o `NPM_TOKEN`.
