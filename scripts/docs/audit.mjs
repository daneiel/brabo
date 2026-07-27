#!/usr/bin/env node
/**
 * Auditoria periódica: o drift check pega doc que ficou ERRADA num PR; isto
 * pega doc que ficou VELHA sem ninguém encostar. Roda mensal e escreve um
 * relatório em Markdown no stdout.
 *
 * Quatro perguntas:
 *   1. Que página não é tocada há meses enquanto o código que ela descreve
 *      mudou depois? (drift silencioso — o pior tipo)
 *   2. Onde há `TODO(humano)` pendente?
 *   3. Que referência `arquivo:linha` não resolve mais?
 *   4. Que ADR ainda está `proposed` há muito tempo?
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import picomatch from 'picomatch';
import { lerDocmap, RAIZ } from './docmap.mjs';

const MESES_PARA_VELHA = Number(process.env.AUDIT_MESES ?? 3);
const DIAS_PROPOSED = Number(process.env.AUDIT_DIAS_PROPOSED ?? 60);

function git(...args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' }).trim();
}

function ultimaMudanca(caminho) {
  const iso = git('log', '-1', '--format=%cI', '--', caminho);
  return iso ? new Date(iso) : null;
}

// A missão de documentação e o CLAUDE.md FALAM sobre `TODO(humano)` — citar o
// marcador não é ter uma pendência. Sem esta exclusão a auditoria reporta a si
// mesma, e relatório com ruído é relatório que ninguém lê.
const META = ['docs/missions/', 'CLAUDE.md', 'CONTRIBUTING.md'];

function arquivos(...globs) {
  return git('ls-files', ...globs)
    .split('\n')
    .filter(Boolean)
    .filter((f) => !META.some((m) => f.startsWith(m)));
}

const agora = new Date();
const seccoes = [];

// ------------------------------------------------- 1. doc velha, código novo

const docmap = lerDocmap();
const desatualizadas = [];

for (const regra of docmap.rules) {
  for (const doc of regra.docs ?? []) {
    const dataDoc = ultimaMudanca(doc);
    if (!dataDoc) continue;

    const mesesParado = (agora - dataDoc) / (1000 * 60 * 60 * 24 * 30);
    if (mesesParado < MESES_PARA_VELHA) continue;

    // O código que esta regra observa mudou DEPOIS da doc?
    const observados = arquivos().filter((a) =>
      (regra.watch ?? []).some((g) => picomatch(g, { dot: true })(a)),
    );
    let maisRecente = null;
    for (const a of observados) {
      const d = ultimaMudanca(a);
      if (d && (!maisRecente || d > maisRecente)) maisRecente = d;
    }

    if (maisRecente && maisRecente > dataDoc) {
      desatualizadas.push({
        doc,
        regra: regra.id,
        docEm: dataDoc.toISOString().slice(0, 10),
        codigoEm: maisRecente.toISOString().slice(0, 10),
        meses: mesesParado.toFixed(1),
      });
    }
  }
}

if (desatualizadas.length > 0) {
  const vistos = new Set();
  seccoes.push(
    `## Documentação parada enquanto o código andou\n\n` +
      `| documento | regra | doc parada desde | código mudou em |\n|---|---|---|---|\n` +
      desatualizadas
        .filter((d) => !vistos.has(`${d.doc}|${d.regra}`) && vistos.add(`${d.doc}|${d.regra}`))
        .map((d) => `| \`${d.doc}\` | \`${d.regra}\` | ${d.docEm} (${d.meses} meses) | ${d.codigoEm} |`)
        .join('\n'),
  );
}

// -------------------------------------------------------- 2. TODO(humano)

const todos = [];
for (const doc of arquivos('docs/**/*.md', '*.md')) {
  const linhas = readFileSync(join(RAIZ, doc), 'utf8').split('\n');
  linhas.forEach((linha, i) => {
    if (linha.includes('TODO(humano)') || linha.includes('ATENÇÃO(humano)')) {
      todos.push({ doc, linha: i + 1, texto: linha.replace(/^[>\s*]*/, '').slice(0, 110) });
    }
  });
}

if (todos.length > 0) {
  seccoes.push(
    `## Pendências marcadas (\`TODO(humano)\`)\n\n` +
      todos.map((t) => `- \`${t.doc}:${t.linha}\` — ${t.texto}`).join('\n'),
  );
}

// ------------------------------------------- 3. referências arquivo:linha

const quebradas = [];
const PADRAO_REF = /`((?:apps|packages|docker|deploy|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|ex|exs|tsx|sh|yaml|yml|json))(?::(\d+))?`/g;

for (const doc of arquivos('docs/**/*.md')) {
  const texto = readFileSync(join(RAIZ, doc), 'utf8');
  for (const m of texto.matchAll(PADRAO_REF)) {
    const [, alvo, linhaStr] = m;
    if (!existsSync(join(RAIZ, alvo))) {
      quebradas.push({ doc, ref: m[0], motivo: 'arquivo não existe' });
      continue;
    }
    if (linhaStr) {
      const total = readFileSync(join(RAIZ, alvo), 'utf8').split('\n').length;
      if (Number(linhaStr) > total) {
        quebradas.push({ doc, ref: m[0], motivo: `arquivo tem só ${total} linhas` });
      }
    }
  }
}

if (quebradas.length > 0) {
  seccoes.push(
    `## Referências \`arquivo:linha\` que não resolvem\n\n` +
      quebradas.map((q) => `- \`${q.doc}\` → ${q.ref} — ${q.motivo}`).join('\n'),
  );
}

// ------------------------------------------------------- 4. ADR proposed

const propostos = [];
for (const adr of arquivos('docs/adr/[0-9]*.md')) {
  const texto = readFileSync(join(RAIZ, adr), 'utf8');
  if (!/^\s*[-*]?\s*\**Status\**:?\s*propos/im.test(texto)) continue;
  const data = ultimaMudanca(adr);
  const dias = data ? (agora - data) / (1000 * 60 * 60 * 24) : 0;
  if (dias > DIAS_PROPOSED) {
    propostos.push(`- \`${adr}\` — proposto há ${Math.round(dias)} dias`);
  }
}

if (propostos.length > 0) {
  seccoes.push(`## ADRs em \`proposed\` há mais de ${DIAS_PROPOSED} dias\n\n` + propostos.join('\n'));
}

// ------------------------------------------------------------- relatório

console.log(`# Auditoria de documentação — ${agora.toISOString().slice(0, 10)}\n`);
if (seccoes.length === 0) {
  console.log('Nada a reportar. Documentação em dia, sem pendência marcada e sem referência quebrada. ✅');
} else {
  console.log(seccoes.join('\n\n---\n\n'));
  console.log(
    `\n---\n\n<sub>Gerado por \`node scripts/docs/audit.mjs\`. ` +
      `Esta issue é ATUALIZADA a cada rodada, nunca duplicada.</sub>`,
  );
}
