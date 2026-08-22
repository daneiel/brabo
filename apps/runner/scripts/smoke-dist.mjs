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
 * Efeito colateral que vale registrar: como `pty.ts` importa `node-pty` no
 * topo do módulo (hoisted antes de qualquer parsing de argumento), rodar
 * este smoke também prova que o binding nativo resolve e carrega no
 * ambiente atual — não é só teste de bundling, é um smoke real do native
 * addon.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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

console.log('smoke ok');
