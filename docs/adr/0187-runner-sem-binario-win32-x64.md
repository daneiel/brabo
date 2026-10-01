# 0187 — O binário standalone do runner deixa de prometer o Windows

## Status

**Accepted.** Decidido pelo mantenedor em 2026-09-30 e confirmado em
2026-10-01 (AT-343). Segue o molde do
[ADR 0174](0174-runner-sem-binario-darwin-x64.md), que tirou o Mac Intel pelo
mesmo caminho, e referencia o
[ADR 0112](0112-binario-standalone-do-runner-via-bun-build-compile.md) (o
binário via `bun build --compile`), o
[ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md) (o pacote
npm, que passa a ser o caminho do Windows) e o
[ADR 0150](0150-instalador-de-uma-linha.md) (o `install.sh`, que já recusava
Windows inteiro). Não edita nenhum deles.

## Context

Desde o ADR 0174 a matriz prometia quatro alvos, e a Release só recebia os
dois Linux. O `win32-x64` tinha correção de build na `dev` nunca exercitada, e
o ensaio por `workflow_dispatch` com `tag` vazia (o modo que não anexa nada) a
exercitou. As camadas foram caindo uma a uma, e a última não é do runner:

1. **Run `36775746724`** — o binário CONSTRÓI, e sai com código 1 no uso sem
   argumentos: `ENOENT` em `realpathSync`. O runner só reconhecia o caminho
   virtual do binário compilado de Linux/macOS (`/$bunfs/root/`); o do Windows
   é `B:/~BUN/root/`. Corrigido (AT-343, `apps/runner/src/binario-compilado.ts`).
2. **Run `36779817686`** — o uso passa, e o `--self-test-pty` reprova com
   `Cannot find package 'node-pty'`: o carregador recebia a forma SEM os
   dois-pontos (`B/~BUN/root/`) e caía no `import('node-pty')` comum.
   Corrigido. Neste mesmo run o `darwin-arm64` e os dois Linux PASSARAM com o
   leitor próprio de PTY da AT-342 ([RN-688](../business-rules.md#rn-688)).
3. **Run `36780804339`** — o `node-pty` carrega, e do `cmd.exe` só chegam as
   sequências iniciais do ConPTY (`ESC[?9001h ESC[?1004h`), sem nem o prompt.
   O auto-teste ganhou uma SONDA que não depende de entrada, para separar
   entrada de leitura.
4. **Run `36781729045`** — a sonda decide: `cmd.exe /c echo` num segundo PTY
   entrega **1 pedaço** (as mesmas duas sequências), o stream de leitura dá
   `end,close`, e o filho sai com `-1073741510` — **0xC000013A**
   (`STATUS_CONTROL_C_EXIT`). Sob o Bun, o `net.Socket` sobre o pipe nomeado
   de saída do ConPTY termina depois do primeiro pedaço; o `node-pty` trata o
   fim do pipe como fim do terminal, fecha o pseudoconsole, e o Windows mata o
   filho. Não há entrada envolvida — até um comando que só escreve morre.

É a mesma família do [oven-sh/bun#25822](https://github.com/oven-sh/bun/issues/25822)
que tirou o Mac Intel: a camada de stream do Bun sob o `node-pty`. Nos Unix ela
tinha contorno (o fd do mestre é um fd comum, e a AT-342 o lê com
`fs.read`, esperando no `EAGAIN`); no Windows o lado de leitura é um pipe
nomeado aberto pelo próprio `node-pty` como `net.Socket`, e não há fd que o
runner possa ler por fora sem reescrever a metade Windows do `node-pty`. Sob
**Node**, o mesmo `node-pty` é o que o VS Code usa no Windows.

## Decision

**A plataforma sai.** O binário standalone passa a prometer TRÊS alvos
(`linux-x64`, `linux-arm64`, `darwin-arm64`), e o Windows fica com o caminho
npm — `npm install -g @brabo/runner`, sob Node. Os mesmos quatro lugares do
ADR 0174 mudam juntos:

- `build-runner-binaries.yml` tira `win32-x64` da matriz e de
  `ALVOS_ESPERADOS`. O `checksums.txt` declara ausência só do que é falha.
- O proxy `GET /runner-releases/binary` aceita os três, e recusa `win32-x64`
  com **400 próprio** — nomeando este ADR e o comando npm, sem chamar o GitHub
  —, na MESMA tabela da recusa do `darwin-x64`
  (`SEM_BINARIO_POR_DECISAO`, nome legível e ADR por plataforma).
- O `install.sh` já recusava Windows inteiro antes de qualquer download
  (ADR 0150), e continua: a recusa passa a DIZER também que o agente local ali
  é o pacote npm, nomeando este ADR. O `case` de `instalar_o_runner` nunca teve
  `win32-x64` e não ganha.
- O navegador continua **detectando** `win32-x64` e não pede o download: ele
  entra em `SEM_BINARIO_PUBLICADO`, que falha de antemão e cai no best-effort
  de sempre (`falhaDoBinario` → comando npm, [RN-473](../business-rules.md#rn-473)).
- `scripts/ci/alvos-do-runner.spec.ts` amarra os quatro lugares e passa a
  reprovar `windows-latest` na matriz.

As correções de Windows que o ensaio produziu (o caminho virtual nas três
formas, o carregador do `node-pty`, o `cmd.exe` no auto-teste e a sonda)
FICAM: são o ponto de partida do caminho de volta, e não custam nada aos
outros alvos.

## Alternatives considered

- **Manter o alvo e publicar o binário que reprova o terminal.** O uso sem
  argumentos passa, mas o terminal interativo da aba Code morreria no primeiro
  pedaço de saída, com o filho morto por Ctrl+C. Publicar um binário que se
  sabe quebrado na função que o justifica é pior que não publicar.
- **Ler o pipe do ConPTY por fora do `node-pty`, como a AT-342 fez nos Unix.**
  Exigiria reimplementar a metade Windows do `node-pty` (o pipe é aberto e
  conectado por dentro dele), e um contorno desse tamanho contra um bug aberto
  do runtime é dívida sem prazo.
- **Trocar o runtime do binário (Node SEA) só para o Windows.** Mudaria o
  mecanismo de distribuição do ADR 0112 para um alvo, com um segundo caminho de
  build e de prova. É decisão maior do que esta, e cabe num ADR próprio se o
  Bun não corrigir.

## Consequences

- A promessa do binário standalone é de **três** alvos, e as três estão
  PROVADAS em ensaio (runs `36779817686` e `36805241339`, este já com a matriz de três). A
  Release continua recebendo dois até a próxima tag final exercitar o
  `darwin-arm64`.
- Quem usa Windows precisa de Node instalado para ter o agente local, e o
  serviço de usuário continua fora (ADR 0147 ponto 5). O painel do navegador
  diz isso em texto; o `install.sh` também.
- **Caminho de volta:** quando o Bun corrigir o stream do pipe nomeado numa
  release, religar o alvo é ADR novo que devolve `win32-x64`/`windows-latest`
  à matriz e aos quatro lugares que o spec amarra, os nomes com `.exe` no
  proxy, e roda o ensaio por `workflow_dispatch` com `tag` vazia — a sonda do
  `--self-test-pty` diz de cara se a leitura voltou.
