#!/usr/bin/env node
/**
 * Smoke do BINÁRIO STANDALONE (`dist-bin/brabo-runner-<platform>-<arch>`,
 * ADR 0109) — espelha `scripts/smoke-dist.mjs` (ADR 0106), mas roda o
 * binário COMPILADO em vez de `node dist/index.cjs`. As duas checagens de
 * "uso" (zero args) já provam que o binário executa como CLI de verdade;
 * a que importa de verdade é `--self-test-pty`, que executa `main()`
 * inteiro até `carregarNodePty()` resolver, spawna um PTY REAL via
 * `GerenciadorDePty` (o mesmo caminho que produção usa em
 * `tratarPtyOpen`/`onPtyInput`), escreve nele e lê a resposta de volta —
 * a prova de que o `.node` nativo embutido (via `with { type: 'file' }`,
 * ver `scripts/build-bin.mjs` e o ADR 0109) carrega e FUNCIONA de verdade
 * dentro do binário, não só que o processo não lança na largada. Nenhum
 * mock: é o binário publicável de verdade, rodando como subprocesso real.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NOME_DA_PLATAFORMA = `${process.platform}-${process.arch}`;
const EXTENSAO = process.platform === 'win32' ? '.exe' : '';
const binario = fileURLToPath(
  new URL(`../dist-bin/brabo-runner-${NOME_DA_PLATAFORMA}${EXTENSAO}`, import.meta.url),
);
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

if (!existsSync(binario)) {
  throw new Error(
    `${binario} não existe — rode \`pnpm --filter runner build:bin\` antes do smoke.`,
  );
}

if (process.platform !== 'win32') {
  const modo = statSync(binario).mode;
  if ((modo & 0o111) === 0) {
    throw new Error(
      `${binario} não é executável (mode ${modo.toString(8)}) — ` +
        '`scripts/build-bin.mjs` deveria ter aplicado chmod 755.',
    );
  }
}

assertUso('uso (zero args)', () => execFileSync(binario, [], { encoding: 'utf8' }));

/**
 * `--self-test-pty` roda `main()` até `carregarNodePty()` resolver e
 * spawna um `cat` real dentro de um PTY real — sem precisar de rede
 * (engine/api) nem de argumentos de projeto/dir/token. Ver o docblock da
 * função em `src/index.ts` para o porquê de `cat` (não um shell
 * interativo — achado empírico da investigação do ADR 0109: bash sob o
 * runtime do Bun neste sandbox nunca terminava de redesenhar o prompt
 * dentro do timeout, embora o mesmo funcionasse sob Node puro).
 */
async function verificarPtyReal() {
  const ALVO = 'SELF_TEST_PTY_OK:';
  const CARREGOU = 'node-pty carregado com sucesso';
  const TIMEOUT_MS = 20_000;

  const processo = spawn(binario, ['--self-test-pty'], { encoding: 'utf8' });
  let stdout = '';
  processo.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  let stderr = '';
  processo.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const codigo = await new Promise((resolve, reject) => {
    const temporizador = setTimeout(() => {
      processo.kill('SIGKILL');
      reject(
        new Error(
          `--self-test-pty não terminou em ${TIMEOUT_MS}ms.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, TIMEOUT_MS);

    processo.on('error', (erro) => {
      clearTimeout(temporizador);
      reject(erro);
    });

    processo.on('exit', (codigoDeSaida) => {
      clearTimeout(temporizador);
      resolve(codigoDeSaida);
    });
  });

  if (codigo !== 0) {
    throw new Error(`--self-test-pty saiu com código ${codigo}.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  if (!stdout.includes(CARREGOU)) {
    throw new Error(`stdout não contém "${CARREGOU}" — o .node nativo pode não ter carregado.\nstdout:\n${stdout}`);
  }
  if (!stdout.includes(ALVO)) {
    throw new Error(`stdout não contém "${ALVO}" — o PTY real não completou o round-trip.\nstdout:\n${stdout}`);
  }

  console.log('ok: node-pty nativo embutido carrega e um PTY real spawna/lê/escreve dentro do binário');
}

await verificarPtyReal();

console.log('smoke (binário) ok');
