#!/usr/bin/env node
/**
 * `pnpm docs:generate` — o que pode ser gerado nunca é escrito à mão.
 *
 * Dois modos de saída:
 *
 *   1. ARQUIVO INTEIRO — `docs/reference/scripts.md`. Não há prosa a preservar:
 *      a lista de scripts É o conteúdo.
 *
 *   2. BLOCO MARCADO — um trecho entre `<!-- BEGIN:GENERATED:<id> -->` e
 *      `<!-- END:GENERATED:<id> -->` dentro de um arquivo escrito à mão. É o
 *      caso de `configuration.md` e `events.md`, onde a prosa ("quando dá
 *      errado") vale mais que a lista, mas a LISTA precisa estar completa. O
 *      bloco é o inventário; a prosa em volta é a explicação.
 *
 * `--check` não escreve nada e sai 1 se algo estaria diferente — é o modo do
 * CI.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ } from './docmap.mjs';

const CHECAR = process.argv.includes('--check');
const AVISO =
  '> ⚠️ Arquivo gerado por `pnpm docs:generate`. Não edite à mão — o próximo build sobrescreve.';
const AVISO_BLOCO =
  '> ⚠️ Bloco gerado por `pnpm docs:generate`. Não edite à mão — o próximo build sobrescreve.';

/**
 * Nomes citados na prosa, incluindo a abreviação `PREFIXO_A` / `_B`, que é
 * idioma legítimo de tabela ("`POSTGRES_HOST` / `_USER` / `_PASSWORD`").
 * Sem expandir isso o checker acusa falso-positivo, e falso-positivo treina
 * quem lê a ignorar o aviso — que é o pior resultado possível pra um check.
 */
function nomesCitados(doc) {
  const citados = new Set();
  for (const m of doc.matchAll(/`([A-Z][A-Z_0-9]{2,})`((?:\s*\/\s*`_[A-Z_0-9]+`)+)/g)) {
    const base = m[1];
    citados.add(base);
    for (const s of m[2].matchAll(/`(_[A-Z_0-9]+)`/g)) {
      // `PSYCHOLOGIST_BUDGET_MICROS_LEVE` / `_PESADA` → troca o último trecho.
      citados.add(base.replace(/_[A-Z0-9]+$/, s[1]));
      // `POSTGRES_HOST` / `_USER` → também vale como prefixo + sufixo.
      citados.add(base.split('_')[0] + s[1]);
    }
  }
  for (const m of doc.matchAll(/`([A-Z][A-Z_0-9]{2,})`/g)) citados.add(m[1]);
  return citados;
}

const pendencias = [];

// --------------------------------------------------------------- utilidades

function ler(rel) {
  return readFileSync(join(RAIZ, rel), 'utf8');
}

function escrever(rel, conteudo) {
  const atual = (() => {
    try {
      return ler(rel);
    } catch {
      return null;
    }
  })();

  if (atual === conteudo) {
    console.log(`  ok        ${rel}`);
    return;
  }
  if (CHECAR) {
    pendencias.push(rel);
    console.log(`  DESATUAL. ${rel}`);
    return;
  }
  writeFileSync(join(RAIZ, rel), conteudo);
  console.log(`  ${atual === null ? 'criado   ' : 'atualizado'} ${rel}`);
}

/** Substitui o conteúdo entre os marcadores, preservando o resto do arquivo. */
/** O documento sem o bloco gerado `id` — o que a PROSA de fato diz. */
function semBlocoGerado(doc, id) {
  const i = doc.indexOf(`<!-- BEGIN:GENERATED:${id} -->`);
  const f = doc.indexOf(`<!-- END:GENERATED:${id} -->`);
  return i === -1 || f === -1 ? doc : doc.slice(0, i) + doc.slice(f);
}

function escreverBloco(rel, id, corpo) {
  const inicio = `<!-- BEGIN:GENERATED:${id} -->`;
  const fim = `<!-- END:GENERATED:${id} -->`;
  const atual = ler(rel);

  const i = atual.indexOf(inicio);
  const f = atual.indexOf(fim);
  if (i === -1 || f === -1) {
    throw new Error(
      `${rel}: marcadores ${inicio} / ${fim} não encontrados. ` +
        'Bloco gerado só existe onde o arquivo o declara.',
    );
  }

  const novo =
    atual.slice(0, i + inicio.length) + '\n' + corpo.trimEnd() + '\n' + atual.slice(f);
  escrever(rel, novo);
}

function git(...args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' });
}

function arquivos(glob) {
  return git('ls-files', glob).split('\n').filter(Boolean);
}

function grepTodos(padrao, caminhos) {
  const achados = new Map(); // valor -> Set(arquivos)
  for (const caminho of caminhos) {
    let texto;
    try {
      texto = ler(caminho);
    } catch {
      continue;
    }
    for (const m of texto.matchAll(padrao)) {
      const valor = m[1];
      if (!achados.has(valor)) achados.set(valor, new Set());
      achados.get(valor).add(caminho);
    }
  }
  return achados;
}

// ------------------------------------------------------- 1. scripts.md

function gerarScripts() {
  const pacotes = [
    ['raiz', 'package.json'],
    ['api', 'apps/api/package.json'],
    ['web', 'apps/web/package.json'],
    ['website', 'website/package.json'],
    ['scripts', 'scripts/package.json'],
  ];

  let out = `---
id: scripts
title: Scripts e comandos
sidebar_label: Scripts
sidebar_position: 7
description: Todos os scripts pnpm e alvos do Makefile do repositório, extraídos da fonte.
keywords: [scripts, pnpm, make, comandos]
---

# Scripts e comandos

${AVISO}

Fonte: os \`package.json\` de cada pacote e o \`Makefile\` da raiz.
`;

  let total = 0;
  for (const [rotulo, caminho] of pacotes) {
    let pkg;
    try {
      pkg = JSON.parse(ler(caminho));
    } catch {
      continue;
    }
    const scripts = Object.entries(pkg.scripts ?? {});
    if (scripts.length === 0) continue;
    total += scripts.length;

    const prefixo =
      rotulo === 'raiz' ? 'pnpm ' : rotulo === 'website' ? 'pnpm --filter website ' : `pnpm --filter ${rotulo} `;

    out += `\n## ${rotulo === 'raiz' ? 'Raiz' : rotulo} — \`${caminho}\`\n\n`;
    out += '| comando | executa |\n|---|---|\n';
    for (const [nome, cmd] of scripts) {
      out += `| \`${prefixo}${nome}\` | \`${cmd.replace(/\|/g, '\\|')}\` |\n`;
    }
  }

  // Makefile: alvos anotados com `## descrição` viram a coluna da direita.
  const mk = ler('Makefile');
  const alvos = [...mk.matchAll(/^([a-z0-9_-]+):[^\n]*?##\s*(.+)$/gm)];
  if (alvos.length > 0) {
    out += `\n## Makefile\n\n| alvo | faz |\n|---|---|\n`;
    for (const [, alvo, desc] of alvos) {
      out += `| \`make ${alvo}\` | ${desc.trim()} |\n`;
    }
    total += alvos.length;
  }

  out += `\n---\n\n${total} comandos no total. Alvo do Makefile sem anotação \`## descrição\` não aparece aqui — anote na fonte.\n`;
  escrever('docs/reference/scripts.md', out);
}

// ------------------------------------- 2. inventário de variáveis de ambiente

function gerarEnv() {
  const fontes = [
    ['api', arquivos('apps/api/src/**/*.ts').filter((f) => !f.includes('.spec.')),
      /process\.env\.([A-Z_0-9]{3,})/g],
    ['engine', [...arquivos('apps/engine/lib/**/*.ex'), ...arquivos('apps/engine/config/*.exs')],
      /System\.(?:get_env|fetch_env!?)\("([A-Z_0-9]{3,})"/g],
    ['web', arquivos('apps/web/src/**/*.ts*'), /import\.meta\.env\.(VITE_[A-Z_0-9]+)/g],
  ];

  // Sem `semBlocoGerado` o check se auto-satisfaz: a variável nova entra no
  // inventário com a marca de lacuna, e na execução SEGUINTE o próprio nome
  // dentro do bloco conta como citação — a lacuna some sem ninguém escrever
  // uma linha de prosa.
  const citados = nomesCitados(
    semBlocoGerado(ler('docs/reference/configuration.md'), 'env-inventario'),
  );
  let corpo = '';
  let total = 0;
  let naoDocumentadas = 0;

  for (const [app, caminhos, padrao] of fontes) {
    const achados = [...grepTodos(padrao, caminhos).entries()].sort(([a], [b]) => a.localeCompare(b));
    total += achados.length;
    corpo += `\n**${app}** — ${achados.length} variáveis\n\n`;
    for (const [nome, arqs] of achados) {
      // A prosa acima documenta? Se não, a lacuna aparece aqui em vez de
      // passar em silêncio.
      const documentada = citados.has(nome);
      if (!documentada) naoDocumentadas++;
      corpo += `- \`${nome}\`${documentada ? '' : ' — ⚠️ **sem descrição acima**'} <sub>(${[...arqs][0]})</sub>\n`;
    }
  }

  const cabecalho =
    `\n${AVISO_BLOCO}\n\nInventário extraído do código: **${total} variáveis** lidas em tempo de execução.` +
    (naoDocumentadas > 0
      ? ` **${naoDocumentadas}** ainda não têm descrição nas tabelas acima.`
      : ' Todas têm descrição nas tabelas acima.') +
    '\n';

  escreverBloco('docs/reference/configuration.md', 'env-inventario', cabecalho + corpo);
}

// ------------------------------------------- 3. inventário de tipos de evento

function gerarEventos() {
  const api = arquivos('apps/api/src/**/*.ts').filter((f) => !f.includes('.spec.'));
  const engine = arquivos('apps/engine/lib/**/*.ex');

  const achados = new Map();
  for (const [caminhos, padrao] of [
    [api, /(?:type|eventType):\s*'([a-z_]+\.[a-z_]+)'/g],
    [engine, /"([a-z_]+\.[a-z_]+)"/g],
  ]) {
    for (const [valor, arqs] of grepTodos(padrao, caminhos)) {
      if (!PREFIXOS_DE_EVENTO.some((p) => valor.startsWith(`${p}.`))) continue;
      if (!achados.has(valor)) achados.set(valor, new Set());
      for (const a of arqs) achados.get(valor).add(a);
    }
  }

  // Mesmo cuidado do inventário de env: o bloco gerado não pode se citar.
  const doc = semBlocoGerado(ler('docs/reference/events.md'), 'eventos-inventario');
  const ordenados = [...achados.keys()].sort();
  const faltando = ordenados.filter((t) => !doc.includes(`\`${t}\``));

  let corpo = `\n${AVISO_BLOCO}\n\nExtraído dos pontos de emissão: **${ordenados.length} identificadores**`;
  corpo +=
    faltando.length > 0
      ? `, dos quais **${faltando.length}** não aparecem descritos acima.\n\n`
      : ', todos descritos acima.\n\n';

  for (const tipo of ordenados) {
    const marca = faltando.includes(tipo) ? ' — ⚠️ **não descrito acima**' : '';
    corpo += `- \`${tipo}\`${marca} <sub>(${[...achados.get(tipo)][0]})</sub>\n`;
  }

  escreverBloco('docs/reference/events.md', 'eventos-inventario', corpo);
}

const PREFIXOS_DE_EVENTO = [
  'session', 'agent', 'action', 'artifact', 'chat', 'handoff', 'backlog',
  'bootstrap', 'permission', 'gate', 'budget', 'readiness', 'psychologist',
  'anamnese', 'instruction', 'execution', 'project', 'proposed_action',
  'infra', 'pr', 'architecture', 'llm', 'tool', 'event',
];

// ----------------------------------------------------------- 4. índice de ADR

/**
 * NÃO gera o índice: ele tem uma linha curada por ADR, que nenhum script
 * escreve. Verifica que todo ADR está linkado — a lacuna que importa.
 */
function verificarIndiceAdr() {
  const indice = ler('docs/adr/index.md');
  const orfaos = arquivos('docs/adr/[0-9]*.md')
    .map((f) => f.replace('docs/adr/', ''))
    .filter((f) => !indice.includes(f));

  if (orfaos.length > 0) {
    pendencias.push('docs/adr/index.md');
    console.log(`  DESATUAL. docs/adr/index.md — ${orfaos.length} ADR sem link: ${orfaos.join(', ')}`);
  } else {
    console.log('  ok        docs/adr/index.md (todos os ADRs linkados)');
  }
}

/**
 * As contagens de ADR escritas em prosa.
 *
 * Elas não são geráveis — moram no meio de frases — mas são VERIFICÁVEIS, e
 * é essa a diferença que o ADR 0029 chama de `gerar > verificar > lembrar`.
 * Sem isto elas envelhecem em silêncio: encontradas no site com "28 deles" e
 * "as 29 decisões" quando já eram 30, e "o próximo é 0030" com o 0030 pronto.
 *
 * Padrão que não casa também REPROVA. Um check cuja regex parou de encontrar
 * a frase é pior que check nenhum: ele fica verde para sempre dizendo que
 * conferiu algo que não olhou.
 */
function verificarContagensDeAdr() {
  const numeros = arquivos('docs/adr/[0-9]*.md')
    .map((f) => Number(f.replace('docs/adr/', '').slice(0, 4)))
    .filter((n) => Number.isFinite(n));

  const total = String(numeros.length);
  const proximo = String(Math.max(...numeros) + 1).padStart(4, '0');

  const afericoes = [
    {
      arquivo: 'docs/adr/index.md',
      padrao: /o próximo é \*\*(\d{4})\*\*/,
      esperado: proximo,
      oque: 'o próximo número de ADR',
    },
    {
      arquivo: 'docs/architecture.md',
      padrao: /\[ADRs\]\([^)]*\) — (\d+) deles/,
      esperado: total,
      oque: 'a contagem de ADRs',
    },
    {
      arquivo: 'README.md',
      padrao: /as (\d+) decisões e o porquê/,
      esperado: total,
      oque: 'a contagem de ADRs',
    },
  ];

  let problemas = 0;
  for (const { arquivo, padrao, esperado, oque } of afericoes) {
    const achado = padrao.exec(ler(arquivo));

    if (achado === null) {
      problemas++;
      console.log(
        `  CEGO      ${arquivo} — não achei ${oque}. A frase mudou, e o check\n` +
          `            deixou de conferir. Ajuste o padrão em generate.mjs.`,
      );
      continue;
    }

    if (achado[1] !== esperado) {
      problemas++;
      console.log(`  DESATUAL. ${arquivo} — ${oque}: diz ${achado[1]}, são ${esperado}.`);
    }
  }

  if (problemas > 0) pendencias.push('contagens de ADR');
  else console.log(`  ok        contagens de ADR (${total} ADRs, próximo ${proximo})`);
}

// ------------------------------------------------------------------- main

console.log(CHECAR ? '[docs:generate] verificando…' : '[docs:generate] gerando…');
gerarScripts();
gerarEnv();
gerarEventos();
verificarIndiceAdr();
verificarContagensDeAdr();

if (CHECAR && pendencias.length > 0) {
  console.error(
    `\n[docs:generate] ${pendencias.length} arquivo(s) fora de dia.\n` +
      'Rode `pnpm docs:generate` e commite o resultado.',
  );
  process.exit(1);
}
console.log('[docs:generate] pronto.');
