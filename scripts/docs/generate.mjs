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
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** O documento sem o bloco gerado `id` — o que a PROSA de fato diz. */
function semBlocoGerado(doc, id) {
  const i = doc.indexOf(`<!-- BEGIN:GENERATED:${id} -->`);
  const f = doc.indexOf(`<!-- END:GENERATED:${id} -->`);
  return i === -1 || f === -1 ? doc : doc.slice(0, i) + doc.slice(f);
}

/** Substitui o conteúdo entre os marcadores, preservando o resto do arquivo. */
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
  'infra', 'pr', 'architecture', 'llm', 'tool', 'event', 'delegation',
];



// ------------------------------- 6. catálogo de providers de LLM (Fase 9c)

/**
 * Cabeçalho (ou prefixo dele) da seção de prosa de cada provider em
 * `docs/reference/llm-providers.md`, usado só pra achar a lista de quirks já
 * escrita à mão — a fonte é a prosa, a lista curta do bloco gerado é
 * DERIVADA dela, nunca duplicada à parte. Provider sem seção própria
 * (`ollama`/`anthropic`/`openai`, cobertos só pela tabela "Divergências
 * normalizadas") fica sem quirks resumidos — isso é esperado, não um erro.
 *
 * Provider novo com seção de prosa própria precisa de uma entrada aqui.
 */
const CABECALHO_DA_SECAO_DO_PROVIDER = {
  openrouter: 'OpenRouter',
  'nvidia-nim': 'NVIDIA NIM',
  together: 'Together AI',
  deepinfra: 'DeepInfra',
  bitdeer: 'Bitdeer',
  vultr: 'Vultr Serverless Inference',
};

/** Rótulos em negrito (`- **Rótulo**: ...`) da seção de prosa de um provider. */
function extrairQuirksResumidos(docLlmProviders) {
  const secoes = docLlmProviders.split(/^## /m).slice(1);
  const porProvider = new Map();

  for (const [provider, prefixo] of Object.entries(CABECALHO_DA_SECAO_DO_PROVIDER)) {
    const secao = secoes.find((s) => s.startsWith(prefixo));
    if (!secao) continue;

    const rotulos = [];
    for (const m of secao.matchAll(/^-\s+\*\*(.+?)\*\*/gm)) {
      // `listModels`/"Teste de conexão" já têm coluna própria — não duplica.
      if (/^`?listModels|^Teste de conexão/.test(m[1])) continue;
      // `|` cru quebraria a tabela markdown (é o separador de coluna) — um
      // rótulo citando código com `|` dentro (ex.: `a | b`) precisa escapar.
      rotulos.push(m[1].replace(/\|/g, '\\|'));
    }
    porProvider.set(provider, rotulos);
  }
  return porProvider;
}

function contarLinhasDeSeed(seedTs, provider) {
  const padrao = new RegExp(`provider:\\s*'${provider}'`, 'g');
  return (seedTs.match(padrao) ?? []).length;
}

/**
 * Providers × origem × capabilities × credencial × quirks, lidos do CÓDIGO
 * (e da prosa já escrita, pro resumo de quirks — ver `extrairQuirksResumidos`).
 *
 * A tabela existia à mão e envelhecia calada: a Fase 9c acrescentou
 * `listModels` às capabilities e nenhuma doc cobrou nada. As capabilities vêm
 * do literal que cada provider declara — se alguém trocar `true` por `false`,
 * o bloco muda e o `--check` reprova até a regeneração entrar no mesmo commit.
 * Fase 11c ampliou pra credencial/origem/quirks, todos DERIVADOS (nunca
 * hand-typed) — nenhum arquivo de provider precisou ganhar campo novo só
 * pra alimentar doc.
 */
function gerarProvidersDeLlm() {
  const fontes = arquivos('apps/api/src/infrastructure/llm/*.ts');
  const achados = new Map();

  for (const caminho of fontes) {
    const conteudo = ler(caminho);
    // Casa tanto `readonly capabilities: X = { ... }` (Ollama, Anthropic)
    // quanto `capabilities: { ... }` dentro da config (base compatível).
    // Slug pode ter hífen (`nvidia-nim`, Fase 11b).
    const nome = /name:\s*LLMProviderName\s*=\s*'([a-z-]+)'|name:\s*'([a-z-]+)'/.exec(conteudo);
    // Ancorado em `capabilities:` de verdade (com o dois-pontos colado) —
    // um comentário citando "capabilities.toolCalling" ou "capabilities em
    // duas camadas" não tem dois-pontos ali, então não confunde o match.
    const caps = /capabilities:\s*(?:LLMProviderCapabilities\s*=\s*)?\{([^}]*)\}/.exec(conteudo);
    if (!nome || !caps) continue;

    const provider = nome[1] ?? nome[2];
    if (achados.has(provider)) continue;

    const flag = (chave) => {
      const m = new RegExp(`${chave}:\\s*(true|false)`).exec(caps[1]);
      return m ? m[1] === 'true' : null;
    };
    achados.set(provider, {
      arquivo: caminho,
      streaming: flag('streaming'),
      toolCalling: flag('toolCalling'),
      listModels: flag('listModels'),
    });
  }

  const seedTs = ler('apps/api/src/db/seed.ts');
  const quirksPorProvider = extrairQuirksResumidos(ler('docs/reference/llm-providers.md'));

  const marca = (v) => (v === null ? '?' : v ? 'sim' : 'não');
  // Toda credencial de LLM tem a MESMA forma hoje — uma chave de API cifrada
  // por envelope encryption (`user_credentials`); não existe "tipo" diferente
  // por provider. `ollama` roda local, sem chave.
  const credencial = (provider) => (provider === 'ollama' ? 'nenhuma (local)' : 'chave de API');
  const origem = (provider, c) => {
    if (!c.listModels) return 'seed';
    return contarLinhasDeSeed(seedTs, provider) > 0 ? 'sync + seed' : 'sync';
  };
  const quirks = (provider) => {
    const lista = quirksPorProvider.get(provider);
    return lista && lista.length > 0 ? lista.join('; ') : '—';
  };

  const ordenados = [...achados.entries()].sort(([a], [b]) => a.localeCompare(b));

  let corpo = `\n${AVISO_BLOCO}\n\n`;
  corpo += `Lido dos literais de \`capabilities\` em \`apps/api/src/infrastructure/llm/\` — `;
  corpo += `**${ordenados.length} providers**.\n\n`;
  corpo += '| provider | streaming | tool calling | list_models | credencial | origem dos modelos | quirks resumidos | fonte |\n';
  corpo += '| --- | --- | --- | --- | --- | --- | --- | --- |\n';
  for (const [provider, c] of ordenados) {
    corpo +=
      `| \`${provider}\` | ${marca(c.streaming)} | ${marca(c.toolCalling)} | ${marca(c.listModels)} | ` +
      `${credencial(provider)} | ${origem(provider, c)} | ${quirks(provider)} | \`${c.arquivo}\` |\n`;
  }
  corpo += '\nProvider sem `list_models` é PULADO pelo sync de catálogo, com o motivo\n';
  corpo += 'registrado no relatório — nunca tratado como "o catálogo ficou vazio".\n';
  corpo += '"Origem dos modelos": `sync` descobre sozinho, `seed` só entra por\n';
  corpo += '`apps/api/src/db/seed.ts`, `sync + seed` tem os dois (seed é só bootstrap\n';
  corpo += 'antes do primeiro sync). "Quirks resumidos" são os RÓTULOS em negrito da\n';
  corpo += 'seção de prosa do provider abaixo — o porquê de cada um está lá, não aqui.\n';

  escreverBloco('docs/reference/llm-providers.md', 'providers-capabilities', corpo);
}

// ------------------------------------------- 4. documento OpenAPI da api

/**
 * Exporta o OpenAPI da api para `docs/reference/api/openapi.json`.
 *
 * O JSON vem pelo STDOUT de `apps/api/src/scripts/export-openapi.ts` e quem
 * grava é o `escrever()` daqui. Essa divisão é o que dá o `--check` de graça:
 * mudou um `@ApiProperty` e ninguém regerou, o arquivo commitado difere e o
 * `docs-check.yml` reprova. Se o script da api gravasse sozinho, o modo check
 * teria de reimplementar a comparação — e passaria a MEXER no working tree,
 * que é justamente o que ele promete não fazer.
 *
 * Sobe o `AppModule` inteiro, mas **não precisa de Postgres**: o `Pool` do
 * `pg` é preguiçoso e nada consulta o banco de forma bloqueante no boot. É
 * isso que permite este passo rodar no `docs-check.yml`, que não tem service
 * container.
 */
function gerarOpenapi() {
  const json = execFileSync(
    'pnpm',
    ['--filter', 'api', 'exec', 'ts-node', 'src/scripts/export-openapi.ts'],
    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  escrever(SPEC, json);
}

/**
 * Onde mora cada peça da referência.
 *
 * A spec fica FORA de `DIR_API` de propósito: o `clean-api-docs` do plugin
 * apaga aquele diretório inteiro antes de regerar, e um gerador que apaga a
 * própria entrada é armadilha — a primeira execução funciona e a segunda
 * falha com ENOENT.
 */
const SPEC = 'docs/reference/openapi.json';
const DIR_API = 'docs/reference/api';
const MANIFESTO = `${DIR_API}/.openapi-manifest.json`;

function sha256(texto) {
  return createHash('sha256').update(texto).digest('hex');
}

/** {arquivo: sha256} de tudo que o plugin escreve, exceto o próprio manifesto. */
function hashesDaReferencia() {
  const ignorar = new Set(['.openapi-manifest.json']);
  const arquivos = readdirSync(join(RAIZ, DIR_API))
    .filter((nome) => !ignorar.has(nome))
    .sort();

  const hashes = {};
  for (const nome of arquivos) {
    hashes[nome] = sha256(ler(`${DIR_API}/${nome}`));
  }
  return hashes;
}

/**
 * Materializa `docs/reference/api/` a partir do `openapi.json`.
 *
 * ## Por que um manifesto em vez de regerar no `--check`
 *
 * O modo check NÃO ESCREVE — é a promessa dele. Então não dá para rodar o
 * `gen-api-docs` e comparar: ele escreveria no working tree. A saída é um
 * manifesto com o sha256 de cada arquivo gerado mais o do `openapi.json` que
 * os produziu, e ele mesmo passa pelo `escrever()`.
 *
 * Em check, os hashes são recalculados DO DISCO e comparados com o commitado.
 * Isso pega as quatro derivas que importam:
 *
 *   - `.mdx` editado à mão            → hash do arquivo diverge
 *   - `.mdx` velho para spec nova     → `openapiSha256` diverge
 *   - rota nova sem o gerado commitado → arquivo some da lista
 *   - rota removida com gerado órfão   → arquivo sobra na lista
 *
 * Rodar o Docusaurus no check custaria minutos para dizer a mesma coisa.
 *
 * ## `clean` antes de `gen`
 *
 * Sem limpar, uma rota removida deixaria o `.mdx` dela para trás e o
 * diretório acumularia órfãos que ninguém nota.
 */
function gerarReferenciaApi() {
  if (!CHECAR) {
    for (const comando of ['clean-api-docs', 'gen-api-docs']) {
      execFileSync(
        'pnpm',
        ['--filter', 'website', 'exec', 'docusaurus', comando, 'all'],
        { cwd: RAIZ, encoding: 'utf8', stdio: 'pipe' },
      );
    }
  }

  const conteudo =
    JSON.stringify(
      {
        _: 'Gerado por `pnpm docs:generate`. Não edite — é a trava do que está em docs/reference/api/.',
        openapiSha256: sha256(ler(SPEC)),
        arquivos: hashesDaReferencia(),
      },
      null,
      2,
    ) + '\n';

  escrever(MANIFESTO, conteudo);
}

// ----------------------------------------------------------- 5. índice de ADR

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

/**
 * A versão anunciada em prosa contra a ÚLTIMA release do CHANGELOG.
 *
 * O README ficou preso em `v0.1.0` da Fase 5 até a v2.1.0 — sete releases
 * anunciando a errada, na primeira coisa que quem chega lê. É o mesmo modo de
 * falha das contagens de ADR ("gerar > verificar > lembrar", ADR 0029): número
 * no meio de uma frase que ninguém tem obrigação de lembrar de trocar.
 *
 * E acontece uma vez por lugar: o `docs/intro.md` — a primeira página do SITE
 * publicado, que nem todo mundo alcança pelo README — anunciava "Fases 1 a 5,
 * v0.1.0" com o produto na 26. Conferir só o README nunca protegeu a segunda
 * porta de entrada, então a aferição virou uma LISTA: cada arquivo que escreve
 * a versão em prosa entra aqui, com o padrão que a encontra.
 *
 * Padrão que não casa também REPROVA, pelo mesmo motivo das contagens de ADR:
 * um check cuja regex parou de achar a frase fica verde para sempre dizendo
 * que conferiu algo que não olhou.
 *
 * O badge não entra aqui de propósito — ele passou a ler a release do GitHub
 * direto (`shields.io/github/v/release`) e se atualiza sozinho. Verifica-se só
 * o que não dá para gerar.
 *
 * Fonte da verdade: o primeiro `## vX.Y.Z` do CHANGELOG, que é escrito pelo
 * workflow de release e volta por PR — não uma tag lida do git, que pode não
 * existir num checkout raso de CI.
 */
function verificarVersaoAnunciada() {
  const ultima = /^## v(\d+\.\d+\.\d+) — /m.exec(ler('CHANGELOG.md'));

  if (ultima === null) {
    pendencias.push('versão anunciada');
    console.log(
      '  CEGO      CHANGELOG.md — não achei nenhuma seção `## vX.Y.Z — data`.\n' +
        '            Sem ela não há com o que comparar a prosa.',
    );
    return;
  }

  const afericoes = [
    {
      arquivo: 'README.md',
      padrao: /versão \*\*v(\d+\.\d+\.\d+)\*\*/,
    },
    {
      // A primeira página do site publicado. O padrão exige a frase INTEIRA
      // ("Fases 1 a NN concluídas**, versão **vX.Y.Z**") de propósito: as duas
      // metades envelhecem juntas, e casar só a versão deixaria a contagem de
      // fases mentindo do lado dela sem nada reprovar.
      arquivo: 'docs/intro.md',
      padrao: /\*\*Fases 1 a \d+ concluídas\*\*, versão \*\*v(\d+\.\d+\.\d+)\*\*/,
    },
  ];

  let problemas = 0;
  for (const { arquivo, padrao } of afericoes) {
    const anunciada = padrao.exec(ler(arquivo));

    if (anunciada === null) {
      problemas++;
      console.log(
        `  CEGO      ${arquivo} — não achei a versão anunciada. A frase mudou, e o\n` +
          '            check deixou de conferir. Ajuste o padrão em generate.mjs.',
      );
      continue;
    }

    if (anunciada[1] !== ultima[1]) {
      problemas++;
      console.log(
        `  DESATUAL. ${arquivo} — a versão anunciada: diz v${anunciada[1]}, ` +
          `a última release é v${ultima[1]}.`,
      );
    }
  }

  if (problemas > 0) pendencias.push('versão anunciada');
  else console.log(`  ok        versão anunciada (v${ultima[1]}, em ${afericoes.length} arquivos)`);
}

// ------------------------------------------------------------------- main

console.log(CHECAR ? '[docs:generate] verificando…' : '[docs:generate] gerando…');
gerarScripts();
gerarEnv();
gerarEventos();
gerarOpenapi();
gerarReferenciaApi();
gerarProvidersDeLlm();
verificarIndiceAdr();
verificarContagensDeAdr();
verificarVersaoAnunciada();

if (CHECAR && pendencias.length > 0) {
  console.error(
    `\n[docs:generate] ${pendencias.length} arquivo(s) fora de dia.\n` +
      'Rode `pnpm docs:generate` e commite o resultado.',
  );
  process.exit(1);
}
console.log('[docs:generate] pronto.');
