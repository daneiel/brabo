#!/usr/bin/env node
/**
 * Drift check: cruza os arquivos alterados com o docs/.docmap.yml e cobra a
 * documentação que aquela mudança deveria ter atualizado.
 *
 *   node scripts/docs/drift.mjs [<base>...<head>]
 *
 * Sem argumento, usa `origin/dev...HEAD`.
 *
 * ESCAPE HATCH — obrigatório, e não é frouxidão: sem saída legítima, o time
 * aprende a burlar a regra (commit vazio na doc, texto de enfeite) em vez de
 * cumpri-la, e aí o check passa a mentir. As duas saídas:
 *   - label `docs-not-needed` no PR
 *   - linha `docs-not-needed: <motivo>` no corpo do PR
 * Ambas exigem um humano dizendo por quê, e ficam registradas no PR.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import picomatch from 'picomatch';
import { lerDocmap, RAIZ, regrasAcionadas } from './docmap.mjs';

/** Arquivos alterados que dispararam uma regra — o "por que estou vendo isto". */
function gatilhosDe(regra, alterados) {
  return alterados.filter((a) =>
    (regra.watch ?? []).some((glob) => picomatch(glob, { dot: true })(a)),
  );
}

const RANGE = process.argv[2] ?? 'origin/dev...HEAD';

function git(...args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' }).trim();
}

let alterados;
try {
  alterados = git('diff', '--name-only', RANGE).split('\n').filter(Boolean);
} catch {
  console.error(`[drift] não consegui resolver o range "${RANGE}".`);
  console.error('        Em CI, garanta fetch-depth: 0 e o fetch da branch base.');
  process.exit(2);
}

if (alterados.length === 0) {
  console.log(`[drift] nenhum arquivo alterado em ${RANGE}.`);
  process.exit(0);
}

// --------------------------------------------------------------- escape hatch

const corpoPr = process.env.PR_BODY ?? '';
const labelsPr = (process.env.PR_LABELS ?? '').split(',').map((l) => l.trim());
const motivoNoCorpo = corpoPr.match(/^docs-not-needed:\s*(.+)$/m)?.[1]?.trim();
const dispensado = labelsPr.includes('docs-not-needed') || Boolean(motivoNoCorpo);

// ----------------------------------------------------------------- avaliação

const docmap = lerDocmap();
const acionadas = regrasAcionadas(docmap, alterados);
const docsAlterados = new Set(alterados.filter((a) => a.startsWith('docs/') || a === 'README.md'));
const temAdrNovo = alterados.some((a) => /^docs\/adr\/\d{4}-.+\.md$/.test(a));

const bloqueios = [];
const avisos = [];

for (const regra of acionadas) {
  if (regra.requires_adr) {
    if (!temAdrNovo) {
      avisos.push({
        regra,
        texto: 'mudança estrutural sem ADR novo — provavelmente merece um.',
      });
    }
    continue;
  }

  const pendentes = (regra.docs ?? []).filter((d) => !docsAlterados.has(d));
  if (pendentes.length === 0) continue;

  const item = { regra, pendentes, gatilhos: gatilhosDe(regra, alterados) };
  (regra.severity === 'block' ? bloqueios : avisos).push(item);
}

// ------------------------------------------------------------------ relatório

const linhas = [];
linhas.push(`### Drift check da documentação\n`);
linhas.push(`\`${RANGE}\` — ${alterados.length} arquivo(s) alterado(s), ${acionadas.length} regra(s) acionada(s).\n`);

function bloco(titulo, itens) {
  if (itens.length === 0) return;
  linhas.push(`\n**${titulo}**\n`);
  for (const item of itens) {
    if (item.texto) {
      linhas.push(`- \`${item.regra.id}\` — ${item.texto}`);
      continue;
    }
    linhas.push(`- \`${item.regra.id}\` → revisar ${item.pendentes.map((d) => `\`${d}\``).join(', ')}`);
    if (item.regra.note) linhas.push(`  - ${item.regra.note}`);
    if (item.regra.generated) {
      linhas.push('  - gerado: rode `pnpm docs:generate` em vez de editar à mão.');
    }
    const g = item.gatilhos.slice(0, 4);
    linhas.push(`  - disparado por: ${g.map((x) => `\`${x}\``).join(', ')}${item.gatilhos.length > 4 ? ` e mais ${item.gatilhos.length - 4}` : ''}`);
  }
}

bloco('Bloqueia o PR', bloqueios);
bloco('Vale revisar', avisos);

if (bloqueios.length === 0 && avisos.length === 0) {
  linhas.push('\nNenhuma pendência. ✅');
}

if (bloqueios.length > 0 && dispensado) {
  linhas.push(
    `\n> Dispensado por escape hatch${motivoNoCorpo ? `: _${motivoNoCorpo}_` : ' (label `docs-not-needed`)'}.`,
  );
}

const relatorio = linhas.join('\n');
console.log(relatorio);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, relatorio + '\n');
}

if (bloqueios.length > 0 && !dispensado) {
  console.error(
    '\n[drift] o PR toca código cuja documentação é obrigatória e não a atualizou.\n' +
      '        Atualize os documentos acima, ou justifique com a label `docs-not-needed`\n' +
      '        ou a linha `docs-not-needed: <motivo>` no corpo do PR.',
  );
  process.exit(1);
}
