/**
 * destravar-gate — no merge de uma retropropagação: tira a branch da trava.
 * Fonte da política: docs/explanation/branching-policy.md
 *
 * Roda no push da branch que RECEBEU o backmerge (`qa` ou `dev`), mas escreve
 * o gate na `main`, que é onde ele mora. A última destrava limpa o `awaiting`.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import { CAMINHO_DO_GATE, destravar, escreverGate, lerGate } from './gate.ts';
import { ESCADA, type Permanente } from './pr-police.ts';

async function principal(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const { appendFileSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname } = await import('node:path');

  const branch = (process.env.BRANCH ?? '').trim();
  const sha = process.env.SHA ?? '';
  // Ver `hotfix-gate.ts`: escreve fora da árvore, o workflow commita em `main`.
  const destino = process.env.GATE_OUT ?? CAMINHO_DO_GATE;

  if (!(ESCADA as readonly string[]).includes(branch)) {
    console.log(`[destravar-gate] ${branch} não é permanente — nada a fazer.`);
    return;
  }

  const git = (...args: string[]): string =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();

  let bruto: string | null = null;
  try {
    bruto = git('show', `origin/main:${CAMINHO_DO_GATE}`);
  } catch {
    bruto = null;
  }

  const gate = lerGate(bruto);

  if (!gate.locked.includes(branch as Permanente)) {
    console.log(`[destravar-gate] \`${branch}\` não está travada — nada a fazer.`);
    return;
  }

  // Só destrava se o commit veio MESMO de `main`. Um merge qualquer em `qa`
  // durante a trava não deveria acontecer (o check barra), mas se acontecesse,
  // destravar aqui apagaria a trava sem a correção ter descido.
  const pais = git('rev-list', '--parents', '-n1', sha).split(/\s+/).slice(1);
  const tipDaMain = git('rev-parse', 'origin/main');
  const veioDaMain = pais.includes(tipDaMain);

  if (!veioDaMain) {
    console.log(
      `::warning::o commit em \`${branch}\` não tem \`main\` como pai — ` +
        'a trava NÃO foi removida. Destravar aqui apagaria a trava sem a ' +
        'correção ter descido.',
    );
    return;
  }

  const novo = destravar(gate, branch as Permanente);

  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, escreverGate(novo));

  const acabou = novo.locked.length === 0;
  console.log(
    acabou
      ? `[destravar-gate] \`${branch}\` destravada — a cadeia FECHOU, gate limpo.`
      : `[destravar-gate] \`${branch}\` destravada. Ainda travadas: ${novo.locked.join(', ')}`,
  );

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### destravar-gate\n\n` +
        `\`${branch}\` saiu da trava.\n\n` +
        (acabou
          ? '**A cadeia fechou.** O gate está limpo e os PRs voltam a passar.\n'
          : `Ainda travadas: ${novo.locked.map((b) => `\`${b}\``).join(', ')}\n`),
    );
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `destravou=true\n`);
  }
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}
