#!/usr/bin/env node
/**
 * Guarda de renderização da referência de API.
 *
 *   node scripts/docs/api-render-check.mjs [<dir-do-build>]
 *
 * Sem argumento, usa `website/build`. Roda DEPOIS de `pnpm docs:build`.
 *
 * POR QUE ISTO EXISTE — o buraco que custou duas releases. As 117 páginas de
 * operação subiram mortas em v1.0.0 e v1.0.1: `website/docusaurus.config.ts`
 * não declarava `docItemComponent: '@theme/ApiItem'`, então o Docusaurus usava
 * o `@theme/DocItem` padrão e o `ApiItem` — o único lugar do tema que monta o
 * `<Provider>` do redux — nunca era montado. O
 * `@theme/ApiExplorer/MethodEndpoint` que os `.api.mdx` importam lê esse store
 * com `useSelector`, achava contexto nulo, e o error boundary do Docusaurus
 * trocava a página inteira por "Esta página deu erro.".
 *
 * E NENHUM CHECK VIU. O modo de falha explica por quê:
 *
 *   - o MDX compila — os componentes de tema existem e resolvem;
 *   - o SSR renderiza — o HTML servido tem o conteúdo da rota;
 *   - `pnpm docs:build` fica VERDE;
 *   - a quebra é na HIDRATAÇÃO, só no navegador.
 *
 * "Build verde" nunca foi prova de que a página renderiza, e é essa distinção
 * que este script fecha. Ele não substitui abrir o navegador: afirma a marca
 * ESTRUTURAL que só o `ApiItem` produz. Se alguém tirar a linha do config, ou
 * se o tema mudar de wrapper, isto reprova antes de publicar.
 *
 * ESCOPO, declarado: pega ESTA classe de regressão, não toda falha de
 * hidratação. Um smoke com navegador headless pegaria mais, e custaria uma
 * dependência de Playwright — não se paga para o risco que sobra. Se um dia
 * outra falha de hidratação escapar, é aí que a conversa do headless começa.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DIR_MDX = join(RAIZ, 'docs/reference/api');
const DIR_BUILD = resolve(RAIZ, process.argv[2] ?? 'website/build');
const DIR_ROTAS = join(DIR_BUILD, 'reference/api');

/**
 * As duas marcas que SÓ o `ApiItem` emite — conferidas na fonte do tema
 * instalado (`docusaurus-theme-openapi-docs/lib/theme/ApiItem/index.js`), não
 * escolhidas por palpite. O `DocItem` padrão não produz nenhuma das duas.
 *
 * `openapi-tabs` NÃO serve de marca: ele vem do próprio MDX e estava presente
 * mesmo com a página quebrada. Foi o que fez o HTML parecer certo.
 */
const MARCAS = ['openapi-left-panel__container', 'openapi-right-panel__container'];

/** Operações que o gerador produziu — a lista do que DEVE renderizar. */
function operacoesEsperadas() {
  if (!existsSync(DIR_MDX)) {
    erroFatal(
      `não encontrei ${DIR_MDX}.`,
      'Rode `pnpm docs:generate` antes — a referência de API é gerada, nunca escrita à mão.',
    );
  }
  return readdirSync(DIR_MDX)
    .filter((f) => f.endsWith('.api.mdx'))
    .map((f) => basename(f, '.api.mdx'))
    .sort();
}

function erroFatal(...linhas) {
  console.error(`\n[api-render] ${linhas.join('\n              ')}`);
  process.exit(2);
}

// ------------------------------------------------------------------ avaliação

const esperadas = operacoesEsperadas();

if (esperadas.length === 0) {
  erroFatal(
    'nenhum `*.api.mdx` em docs/reference/api.',
    'Ou o gerador não rodou, ou a spec ficou sem rotas — os dois são defeito.',
  );
}

if (!existsSync(DIR_ROTAS)) {
  erroFatal(
    `não encontrei ${DIR_ROTAS}.`,
    'Rode `pnpm docs:build` antes deste check — ele confere o BUILD, não a fonte.',
  );
}

const ausentes = [];
const semPainel = [];

for (const id of esperadas) {
  // `trailingSlash: false` no config produz `<id>.html`; um dia que isso mude,
  // o diretório com index.html também vale.
  const candidatos = [join(DIR_ROTAS, `${id}.html`), join(DIR_ROTAS, id, 'index.html')];
  const pagina = candidatos.find((c) => existsSync(c));

  if (!pagina) {
    ausentes.push(id);
    continue;
  }

  const html = readFileSync(pagina, 'utf8');
  const faltando = MARCAS.filter((m) => !html.includes(m));
  if (faltando.length > 0) semPainel.push({ id, faltando });
}

// ------------------------------------------------------------------ relatório

const linhas = [];
linhas.push('### Renderização da referência de API\n');
linhas.push(
  `${esperadas.length} operação(ões) esperada(s) em \`docs/reference/api\`, ` +
    `conferidas em \`${DIR_ROTAS.replace(`${RAIZ}/`, '')}\`.\n`,
);

if (ausentes.length === 0 && semPainel.length === 0) {
  linhas.push(`\nTodas as ${esperadas.length} páginas de operação montam o \`ApiItem\`. ✅`);
} else {
  if (ausentes.length > 0) {
    linhas.push(`\n**Sem página no build (${ausentes.length})**\n`);
    for (const id of ausentes.slice(0, 10)) linhas.push(`- \`${id}\``);
    if (ausentes.length > 10) linhas.push(`- …e mais ${ausentes.length - 10}`);
  }
  if (semPainel.length > 0) {
    linhas.push(`\n**Renderizada pelo \`DocItem\`, não pelo \`ApiItem\` (${semPainel.length})**\n`);
    for (const { id, faltando } of semPainel.slice(0, 10)) {
      linhas.push(`- \`${id}\` — sem ${faltando.map((f) => `\`${f}\``).join(' e ')}`);
    }
    if (semPainel.length > 10) linhas.push(`- …e mais ${semPainel.length - 10}`);
  }
}

const relatorio = linhas.join('\n');
console.log(relatorio);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${relatorio}\n`);
}

if (ausentes.length > 0 || semPainel.length > 0) {
  console.error(
    '\n[api-render] a referência de API construiu, mas não RENDERIZA.\n' +
      '             Esta é a falha que sobe verde e morre no navegador: o SSR\n' +
      '             escreve o conteúdo, o build passa, e o error boundary apaga\n' +
      '             a página na hidratação.\n' +
      '\n' +
      '             Primeira coisa a conferir: `docItemComponent: \'@theme/ApiItem\'`\n' +
      '             no bloco `docs` de website/docusaurus.config.ts. Sem ela, o\n' +
      '             store do redux não existe e todo `.api.mdx` cai.',
  );
  process.exit(1);
}
