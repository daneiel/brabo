#!/usr/bin/env node
// @ts-check
/**
 * Constrói o binário standalone do runner para a plataforma ATUAL —
 * `dist-bin/brabo-runner-<platform>-<arch>[.exe]` — via `bun build
 * --compile` (ADR 0112, item do backlog do ADR 0104: "binário standalone
 * (pkg/bun build --compile)").
 *
 * NUNCA cross-compila um addon nativo: cada plataforma do backlog builda
 * no seu próprio runner (ver `.github/workflows/build-runner-binaries.yml`).
 * Este script só entende a plataforma em que está rodando — `process.
 * platform`/`process.arch`, o par que `node-pty` já usa pra nomear
 * `prebuilds/<platform>-<arch>`.
 *
 * O mecanismo (documentado por inteiro no ADR 0112, provado empiricamente
 * antes de codar — ver o ADR pra o histórico da investigação):
 *
 * 1. `node-pty` resolve o `.node` nativo por um `require()` com CAMINHO
 *    COMPUTADO em runtime (`lib/utils.js#loadNativeModule`) — o
 *    `bun build --compile` só embute o que enxerga por especificador
 *    ESTÁTICO (`with { type: 'file' }`), então esse require nunca embute
 *    sozinho (testado: compila, mas falha em runtime com "Cannot find
 *    module").
 * 2. A saída: embutir os arquivos REAIS de `node-pty` que a plataforma
 *    atual precisa (todo `lib/**\/*.js`, exceto `*.test.js`, mais o(s)
 *    `.node` nativo(s) de `build/Release/` OU `prebuilds/<platform>-
 *    <arch>/`, o que existir) como imports estáticos `with { type: 'file'
 *    }` — a única forma de embutir arquivo que o `bun build --compile`
 *    aceita — e reescrever `src/native-pty-embed.generated.ts` (rastreado
 *    no git como PLACEHOLDER vazio) com esses imports antes de compilar.
 * 3. Em runtime (`src/native-pty-loader.ts`), os arquivos embutidos são
 *    extraídos pra um diretório TEMPORÁRIO REAL (`fs.mkdtempSync`),
 *    preservando o caminho relativo original — é essa preservação que faz
 *    os `require()` relativos internos do `node-pty` (`./utils`,
 *    `../build/Release/pty.node`) resolverem sozinhos, sem reescrever nada
 *    dentro do pacote. `lib/index.js` é então importado por CAMINHO
 *    ABSOLUTO a partir desse diretório — nunca por `require('node-pty')`,
 *    que exigiria resolução por nome de pacote (sem `node_modules` nenhum
 *    do lado de quem baixou só o binário).
 *
 * O placeholder é restaurado no `finally` — este script nunca deixa
 * `native-pty-embed.generated.ts` committável com conteúdo gerado.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const raizDoPacote = fileURLToPath(new URL('..', import.meta.url));
const arquivoGerado = join(raizDoPacote, 'src', 'native-pty-embed.generated.ts');
const conteudoPlaceholder = readFileSync(arquivoGerado, 'utf8');

const NOME_DA_PLATAFORMA = `${process.platform}-${process.arch}`;
const EXTENSAO = process.platform === 'win32' ? '.exe' : '';
const SAIDA = join(raizDoPacote, 'dist-bin', `brabo-runner-${NOME_DA_PLATAFORMA}${EXTENSAO}`);

function encontrarBun() {
  const candidato = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  if (candidato.status === 0) return 'bun';
  throw new Error(
    'bun não encontrado no PATH. Instale com `curl -fsSL https://bun.sh/install | bash` ' +
      '(ver https://bun.sh) antes de rodar `build:bin` — o build EXISTENTE via tsup ' +
      '(`pnpm --filter runner build`) não precisa de bun e continua funcionando sem ele.',
  );
}

/** Todo `.js` de `dir`, recursivo, exceto `*.test.js` — os arquivos reais que `node-pty` carrega em runtime. */
function listarJsRecursivo(dir, raizRelativaA) {
  const resultado = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...listarJsRecursivo(caminho, raizRelativaA));
      continue;
    }
    if (entrada.name.endsWith('.js') && !entrada.name.endsWith('.test.js')) {
      resultado.push({ abs: caminho, rel: relative(raizRelativaA, caminho) });
    }
  }
  return resultado;
}

/**
 * Onde estão os `.node` nativos desta plataforma: `build/Release` quando
 * `node-gyp rebuild` compilou localmente (o caso de `linux-x64`/
 * `linux-arm64` — `node-pty` não publica prebuild pra Linux, confirmado
 * lendo `prebuilds/` do pacote instalado), ou `prebuilds/<platform>-
 * <arch>` quando o pacote já trouxe binário pronto (o caso de
 * `darwin-x64`/`darwin-arm64`/`win32-x64`, confirmado do mesmo jeito).
 * `scripts/prebuild.js` do próprio `node-pty` (rodado no `install` do
 * pacote) já decide isso — este script só REPETE a mesma checagem pra
 * saber o que embutir.
 */
function localizarArquivosNativos(raizDoNodePty) {
  const buildRelease = join(raizDoNodePty, 'build', 'Release');
  const prebuildDir = join(raizDoNodePty, 'prebuilds', NOME_DA_PLATAFORMA);

  let dirEscolhido;
  let relEscolhido;
  if (existsSync(buildRelease) && statSync(buildRelease).isDirectory()) {
    dirEscolhido = buildRelease;
    relEscolhido = join('build', 'Release');
  } else if (existsSync(prebuildDir) && statSync(prebuildDir).isDirectory()) {
    dirEscolhido = prebuildDir;
    relEscolhido = join('prebuilds', NOME_DA_PLATAFORMA);
  } else {
    throw new Error(
      `nenhum .node nativo encontrado pra ${NOME_DA_PLATAFORMA} — nem ${buildRelease} ` +
        `nem ${prebuildDir} existem. Rode \`pnpm install\` primeiro (o postinstall do ` +
        'node-pty compila/baixa o binário) antes de `build:bin`.',
    );
  }

  const arquivos = readdirSync(dirEscolhido).filter((f) => f.endsWith('.node'));
  if (arquivos.length === 0) {
    throw new Error(`${dirEscolhido} existe mas não tem nenhum .node dentro.`);
  }
  return arquivos.map((f) => ({ abs: join(dirEscolhido, f), rel: join(relEscolhido, f) }));
}

function gerarManifesto(raizDoNodePty) {
  const jsFiles = listarJsRecursivo(join(raizDoNodePty, 'lib'), raizDoNodePty);
  const nativeFiles = localizarArquivosNativos(raizDoNodePty);
  const todos = [...jsFiles, ...nativeFiles];

  const linhas = [
    '/**',
    ' * GERADO por scripts/build-bin.mjs — NÃO editar à mão. Sobrescrito antes de',
    ' * `bun build --compile` e restaurado ao placeholder logo depois (ver o',
    ' * próprio script e o ADR 0112). Se você está lendo isto num diff de PR,',
    ' * algo saiu errado — este arquivo nunca deveria ficar commitado assim.',
    ' */',
  ];
  const entradas = [];
  todos.forEach((arquivo, indice) => {
    // Especificador RELATIVO ao próprio arquivo gerado (`src/`), como
    // `with { type: 'file' }` exige — literal, sem `path.join` em runtime.
    const especificador = `../${relative(raizDoPacote, arquivo.abs).split('\\').join('/')}`;
    const nomeVar = `f${indice}`;
    linhas.push(`import ${nomeVar} from '${especificador}' with { type: 'file' };`);
    entradas.push(`  { relPath: ${JSON.stringify(arquivo.rel.split('\\').join('/'))}, embeddedPath: ${nomeVar} },`);
  });
  linhas.push('');
  linhas.push(
    'export const NATIVE_PTY_FILES: ReadonlyArray<{ relPath: string; embeddedPath: string }> = [',
  );
  linhas.push(...entradas);
  linhas.push('];');
  linhas.push('');
  return linhas.join('\n');
}

function main() {
  const bun = encontrarBun();
  const raizDoNodePty = dirname(require.resolve('node-pty/package.json'));

  console.log(`plataforma: ${NOME_DA_PLATAFORMA}`);
  console.log(`node-pty em: ${raizDoNodePty}`);

  const manifesto = gerarManifesto(raizDoNodePty);
  writeFileSync(arquivoGerado, manifesto, 'utf8');
  const totalArquivos = (manifesto.match(/with \{ type: 'file' \}/g) ?? []).length;
  console.log(`native-pty-embed.generated.ts: ${totalArquivos} arquivo(s) embutido(s)`);

  mkdirSync(dirname(SAIDA), { recursive: true });

  console.log(`compilando (bun build --compile) -> ${SAIDA}`);
  execFileSync(
    bun,
    // `--external node-pty`: o FALLBACK de `native-pty-loader.ts`
    // (`await import('node-pty')`, usado só fora do binário compilado) é um
    // especificador literal — o bundler do Bun tenta RESOLVER e EMBUTIR
    // qualquer coisa assim que consiga, mesmo dentro de um `if` que nunca
    // executa em runtime dentro do binário. Sem este `--external`, o build
    // TERMINA sem erro, mas o binário lança em runtime ("Failed to load
    // native module") assim que qualquer código tenta alcançar aquele
    // import — Bun troca o que não consegue resolver de verdade por um
    // stub que lança, e isso só aparece ao RODAR, nunca ao compilar (achado
    // empírico, documentado por inteiro no ADR 0112).
    ['build', '--compile', '--external', 'node-pty', '--outfile', SAIDA, join('src', 'index.ts')],
    { cwd: raizDoPacote, stdio: 'inherit' },
  );

  if (process.platform !== 'win32') {
    execFileSync('chmod', ['755', SAIDA]);
  }

  console.log(`ok: ${SAIDA}`);
}

try {
  main();
} finally {
  // SEMPRE restaura o placeholder — sucesso ou falha. `native-pty-embed.
  // generated.ts` nunca fica commitável com conteúdo gerado (ver o
  // docblock do próprio placeholder).
  writeFileSync(arquivoGerado, conteudoPlaceholder, 'utf8');
}
