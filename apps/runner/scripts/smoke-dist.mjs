#!/usr/bin/env node
/**
 * Smoke do artefato EMPACOTADO (ADR 0106) — os testes unitários de
 * `src/*.spec.ts` só chamam funções exportadas de `src/`, nunca o
 * `dist/index.cjs` que de fato vai pro registry. Este script é o único que
 * exercita o binário publicado de ponta a ponta: confere que ele existe, tem
 * bit de execução, e roda como CLI de verdade (exec direto do shebang — o
 * que `node dist/index.cjs` sozinho NUNCA testaria, porque ignora o shebang
 * completamente).
 *
 * ADR 0112 mudou ONDE `node-pty` é resolvido: antes (ADR 0106) `pty.ts`
 * importava `node-pty` no topo do módulo — hoisted antes de qualquer parsing
 * de argumento —, então só IMPORTAR `dist/index.cjs` já provava que o
 * binding nativo carregava. Agora a resolução é LAZY
 * (`native-pty-loader.ts#carregarNodePty`, chamada dentro de `main()`, DEPOIS
 * de `lerArgumentos` validar os argumentos) — necessário pro binário
 * standalone do `bun build --compile` (que precisa extrair os arquivos
 * embutidos antes de importar), mas isso significa que o teste de "uso" logo
 * abaixo (zero args, sai antes de `main()`) não prova mais nada sobre
 * `node-pty`. `verificarNodePtyCarrega` fecha essa lacuna: roda o CLI com
 * argumentos válidos (token/projeto/dir fictícios — nunca chega a conectar
 * de verdade) e espera a linha `node-pty carregado com sucesso` aparecer no
 * stdout antes de matar o processo.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/index.cjs', import.meta.url));
const USO = 'uso: brabo-runner --project';

function assertUso(rotulo, rodar) {
  let erroDeSaida;
  try {
    rodar();
  } catch (erro) {
    erroDeSaida = erro;
  }
  if (!erroDeSaida) {
    throw new Error(`${rotulo}: esperava saída com código != 0, saiu com sucesso`);
  }
  if (erroDeSaida.status !== 2) {
    throw new Error(`${rotulo}: exit code ${erroDeSaida.status}, esperava 2`);
  }
  if (!String(erroDeSaida.stderr).includes(USO)) {
    throw new Error(
      `${rotulo}: stderr não contém a mensagem de uso.\nstderr:\n${erroDeSaida.stderr}`,
    );
  }
  console.log(`ok: ${rotulo}`);
}

if (!existsSync(dist)) {
  throw new Error('dist/index.cjs não existe — rode `pnpm --filter runner build` antes do smoke.');
}

if (process.platform !== 'win32') {
  const modo = statSync(dist).mode;
  if ((modo & 0o111) === 0) {
    throw new Error(
      `dist/index.cjs não é executável (mode ${modo.toString(8)}) — tsup deveria ` +
        'ter aplicado chmod 755 por causa do shebang.',
    );
  }
  // Exercita o shebang + o bit de execução de verdade — `node dist/index.cjs`
  // abaixo NUNCA testa isso, porque ignora o shebang completamente.
  assertUso('exec direto (shebang)', () => execFileSync(dist, [], { encoding: 'utf8' }));
}

assertUso('via `node dist/index.cjs`', () =>
  execFileSync(process.execPath, [dist], { encoding: 'utf8' }),
);

/**
 * Roda o CLI com argumentos válidos (mas sem api/engine reais do outro
 * lado) e espera a linha que só aparece DEPOIS de `carregarNodePty()`
 * resolver com sucesso — prova o binding nativo sem precisar de rede.
 * `--api-url http://127.0.0.1:1` falha rápido (porta 1 nunca tem listener)
 * quando o processo tenta pedir o ticket — o que acontece DEPOIS da linha
 * que este teste procura, então nunca chegamos a esperar por rede de verdade.
 */
async function verificarNodePtyCarrega() {
  // Dentro de `$HOME`, nunca `os.tmpdir()` — RN-434 recusa `--dir` fora do
  // diretório de usuário no Linux (checagem de startup do próprio CLI).
  // Fora do Linux a restrição não existe, mas `$HOME` é sempre um destino
  // válido, então usar o mesmo caminho nos três SOs não custa nada.
  const dirTemporario = mkdtempSync(join(homedir(), '.brabo-runner-smoke-'));
  try {
    await executarComArgumentosValidos(dirTemporario);
  } finally {
    rmSync(dirTemporario, { recursive: true, force: true });
  }
}

async function executarComArgumentosValidos(dirTemporario) {
  const args = [
    dist,
    '--project',
    'smoke-test',
    '--dir',
    dirTemporario,
    '--token',
    // >= 20 chars (`validarFormatoDoToken`, `auth.ts`) — só formato, nunca
    // validado de verdade (não há api real do outro lado neste smoke).
    'brb_smoketestesmoketeste',
    '--api-url',
    'http://127.0.0.1:1',
  ];

  const processo = spawn(process.execPath, args, { encoding: 'utf8' });
  let stdout = '';
  processo.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  let stderr = '';
  processo.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const ALVO = 'node-pty carregado com sucesso';
  const TIMEOUT_MS = 15_000;

  await new Promise((resolve, reject) => {
    const temporizador = setTimeout(() => {
      processo.kill('SIGKILL');
      reject(
        new Error(
          `node-pty não carregou em ${TIMEOUT_MS}ms.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, TIMEOUT_MS);

    processo.stdout.on('data', () => {
      if (stdout.includes(ALVO)) {
        clearTimeout(temporizador);
        processo.kill('SIGTERM');
        resolve();
      }
    });

    processo.on('error', (erro) => {
      clearTimeout(temporizador);
      reject(erro);
    });

    processo.on('exit', (codigo) => {
      // Se o processo morreu ANTES de imprimir a linha alvo, é falha real —
      // provavelmente `node-pty` não carregou (erro fatal e `process.exit(1)`).
      if (!stdout.includes(ALVO)) {
        clearTimeout(temporizador);
        reject(
          new Error(
            `processo saiu (código ${codigo}) antes de "${ALVO}".\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
      }
    });
  });

  console.log(`ok: node-pty carrega via \`node dist/index.cjs\` (native addon real)`);
}

await verificarNodePtyCarrega();

console.log('smoke ok');
