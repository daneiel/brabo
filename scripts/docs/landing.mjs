#!/usr/bin/env node
// Gera a raiz de https://daneiel.github.io/brabo/ — a página que escolhe entre
// os três degraus — e o `404.html` que segura os links antigos.
//
// POR QUE EXISTE: até o ADR 0071, `main` publicava na RAIZ e só `qa` e `dev`
// tinham sufixo. Com os três simétricos em `/brabo/<branch>/`, a raiz ficou
// sem dono. Ela poderia redirecionar para `main`, mas uma página que mostra os
// três — e a versão publicada em cada um — responde a pergunta que o
// redirecionamento engoliria: "a `qa` já tem o que eu preciso?".
//
// O `404.html` é a outra metade, e é ele que evita quebrar a internet: todo
// link antigo para `/brabo/architecture` deixaria de existir. O GitHub Pages
// serve o `404.html` da raiz para caminho desconhecido, então ele reencaminha
// `/brabo/<algo>` para `/brabo/prd/<algo>` sem manter uma cópia do site.
//
// DESDE O ADR 0073 o degrau estável é endereçado por `prd`, e não pelo nome da
// branch. Aqui isso aparece em dois lugares que não podem discordar: o
// diretório na árvore (`caminho`) e a branch de onde sai a TAG da versão
// (`branch`). Eram a mesma string; deixaram de ser.
//
// Sem dependência nova: só `node:fs` e `node:child_process`.
//
// Uso:
//   node scripts/docs/landing.mjs <diretório-de-saída>
//   pnpm docs:landing publicacao

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// `caminho` é o diretório publicado (e o que aparece na URL); `branch` é de
// onde vem a TAG que carimba a versão daquele degrau. Para `qa` e `dev` os dois
// coincidem; para o estável, não — `/prd/` é construído da `main`.
const DEGRAUS = [
  {
    caminho: 'prd',
    branch: 'main',
    titulo: 'prd',
    selo: 'estável',
    descricao: 'A documentação publicada. É esta que o Google indexa.',
  },
  {
    caminho: 'qa',
    branch: 'qa',
    titulo: 'qa',
    selo: 'candidata',
    descricao: 'O que está em validação, a caminho da próxima release.',
  },
  {
    caminho: 'dev',
    branch: 'dev',
    titulo: 'dev',
    selo: 'em desenvolvimento',
    descricao: 'O estado mais recente. Pode descrever o que ainda não saiu.',
  },
];

// O caminho do degrau estável, num lugar só: a raiz canoniza para ele, o 404
// reencaminha para ele, e o diretório aposentado (`main`) é reescrito para ele.
const ESTAVEL = 'prd';

// O diretório que o degrau estável ocupava antes do ADR 0073. Ele deixa de
// existir na árvore montada, então todo link salvo para `/brabo/main/…`
// precisa ser reescrito — não basta cair no reencaminhamento genérico, porque
// senão `/brabo/main/architecture` viraria `/brabo/prd/main/architecture`.
const CAMINHO_APOSENTADO = 'main';

/**
 * A versão publicada num degrau, lida das tags do próprio repositório.
 *
 * Recebe a BRANCH, não o caminho: quem carimba tag é a esteira, que só conhece
 * `main`/`qa`/`dev`. `main` carimba `vX.Y.Z`; `dev` e `qa` carimbam
 * `vX.Y.Z-<estagio>.N` (ver scripts/ci/tag-release.ts). Sem tag ainda, devolve
 * null — e a página diz "sem versão carimbada" em vez de inventar uma.
 */
function versaoDoDegrau(branch) {
  const padrao = branch === 'main' ? 'v[0-9]*.[0-9]*.[0-9]*' : `v*-${branch}.*`;
  try {
    const saida = execFileSync(
      'git',
      ['tag', '--list', padrao, '--sort=-v:refname'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const tags = saida
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      // `main` não pode pegar uma pré-release: o glob dela casa o prefixo de
      // `v1.2.3-qa.4` também.
      .filter((t) => (branch === 'main' ? !t.includes('-') : true));
    return tags[0] ?? null;
  } catch {
    // Sem git (tarball, sandbox) a página continua útil: ela é sobre os links.
    return null;
  }
}

function escapar(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paginaIndice(degraus) {
  const publicados = degraus.filter((d) => d.publicado);

  const cartoes = publicados
    .map(
      (d) => `      <a class="degrau" href="./${d.caminho}/">
        <span class="nome">${escapar(d.titulo)}</span>
        <span class="selo">${escapar(d.selo)}</span>
        <span class="versao">${escapar(d.versao ?? 'sem versão carimbada')}</span>
        <span class="descricao">${escapar(d.descricao)}</span>
      </a>`,
    )
    .join('\n');

  // Antes de a esteira rodar uma vez, nenhum degrau existe. Dizer isso é melhor
  // que servir uma página com três links quebrados.
  const corpo =
    publicados.length > 0
      ? cartoes
      : `      <p class="vazio">Nenhum degrau publicado ainda. A documentação aparece aqui
      no primeiro push em <code>dev</code>, <code>qa</code> ou <code>main</code>.</p>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brabo — documentação</title>
<meta name="description" content="Documentação do Brabo, publicada por degrau da esteira: prd, qa e dev.">
<!-- A raiz não é conteúdo: é um índice. Quem indexa é /prd/. -->
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="https://daneiel.github.io/brabo/${ESTAVEL}/">
<style>
  :root {
    color-scheme: dark;
    --fundo: #061b24;
    --superficie: #0a2e3d;
    --borda: #1c4a5a;
    --texto: #f5ede0;
    --suave: #aec6ce;
    --tenue: #6e8a94;
    --destaque: #d6633a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 48px 24px;
    background: var(--fundo);
    color: var(--texto);
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex;
    justify-content: center;
  }
  main { width: 100%; max-width: 720px; }
  h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -0.02em; }
  .tagline { color: var(--tenue); margin: 0 0 32px; font-size: 14px;
             text-transform: uppercase; letter-spacing: .12em; }
  .degrau {
    display: grid;
    grid-template-columns: auto auto 1fr;
    grid-template-areas: "nome selo versao" "descricao descricao descricao";
    gap: 4px 12px;
    align-items: baseline;
    padding: 16px 20px;
    margin-bottom: 12px;
    background: var(--superficie);
    border: 1px solid var(--borda);
    border-radius: 12px;
    text-decoration: none;
    color: inherit;
  }
  .degrau:hover { border-color: var(--destaque); }
  .nome { grid-area: nome; font-size: 18px; font-weight: 600; }
  .selo { grid-area: selo; color: var(--destaque); font-size: 12px;
          text-transform: uppercase; letter-spacing: .08em; }
  .versao { grid-area: versao; color: var(--tenue); font-size: 13px;
            text-align: right; font-family: ui-monospace, monospace; }
  .descricao { grid-area: descricao; color: var(--suave); font-size: 14px; }
  .vazio { color: var(--suave); }
  footer { margin-top: 32px; color: var(--tenue); font-size: 13px; }
  footer a { color: var(--suave); }
  @media (max-width: 520px) {
    .degrau { grid-template-columns: 1fr auto;
              grid-template-areas: "nome selo" "versao versao" "descricao descricao"; }
    .versao { text-align: left; }
  }
</style>
</head>
<body>
  <main>
    <h1>Brabo</h1>
    <p class="tagline">Documentação por degrau da esteira</p>
${corpo}
    <footer>
      Cada degrau publica a própria documentação a cada merge.
      <a href="https://github.com/daneiel/brabo">Repositório</a>.
    </footer>
  </main>
</body>
</html>
`;
}

function pagina404() {
  // Sem framework e sem dependência: o Pages serve este arquivo para qualquer
  // caminho desconhecido sob /brabo/, e o script reencaminha para o mesmo
  // caminho dentro de /brabo/prd/.
  //
  // São DOIS casos, e confundi-los quebra um dos dois:
  //
  // 1. `/brabo/main/<algo>` — link salvo para o caminho que o ADR 0073
  //    aposentou. O diretório não existe mais na árvore publicada, então ele é
  //    REESCRITO: o prefixo `main/` sai e `prd/` entra. Cair no
  //    reencaminhamento genérico produziria `/brabo/prd/main/<algo>`.
  //
  // 2. `/brabo/{prd,qa,dev}/<algo>` — 404 DENTRO de um degrau que existe: a
  //    página realmente não existe, e reencaminhar giraria o navegador em
  //    laço. A guarda cobre exatamente os caminhos publicados, e é por isso
  //    que `main` saiu dela ao deixar de ser publicado.
  const guarda = DEGRAUS.map((d) => d.caminho).join('|');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Redirecionando…</title>
<meta name="robots" content="noindex, nofollow">
<script>
  (function () {
    var raiz = '/brabo/';
    var caminho = window.location.pathname;
    if (caminho.indexOf(raiz) !== 0) return;
    var resto = caminho.slice(raiz.length);
    var cauda = window.location.search + window.location.hash;
    // O caminho aposentado: /brabo/main/<algo> -> /brabo/${ESTAVEL}/<algo>.
    var aposentado = /^${CAMINHO_APOSENTADO}(?:\\/(.*))?$/.exec(resto);
    if (aposentado) {
      window.location.replace(raiz + '${ESTAVEL}/' + (aposentado[1] || '') + cauda);
      return;
    }
    // Já está dentro de um degrau publicado: a página realmente não existe.
    if (/^(${guarda})(\\/|$)/.test(resto)) return;
    window.location.replace(raiz + '${ESTAVEL}/' + resto + cauda);
  })();
</script>
</head>
<body>
  <p>Esta página mudou de endereço. Indo para
     <a href="/brabo/${ESTAVEL}/">a documentação estável</a>…</p>
</body>
</html>
`;
}

function principal() {
  const destino = process.argv[2];
  if (!destino) {
    console.error('uso: node scripts/docs/landing.mjs <diretório-de-saída>');
    process.exit(2);
  }

  mkdirSync(destino, { recursive: true });

  const degraus = DEGRAUS.map((d) => {
    // O diretório é o CAMINHO; a tag é da BRANCH. É a única linha onde os dois
    // aparecem juntos, e trocá-los faria `/prd/` parecer nunca publicado.
    const dir = join(destino, d.caminho);
    // "Publicado" é o diretório EXISTIR com conteúdo na árvore que vai ao ar —
    // não uma lista fixa. Assim a página nunca oferece um link que dá 404.
    const publicado = existsSync(dir) && readdirSync(dir).length > 0;
    return { ...d, publicado, versao: publicado ? versaoDoDegrau(d.branch) : null };
  });

  writeFileSync(join(destino, 'index.html'), paginaIndice(degraus));
  writeFileSync(join(destino, '404.html'), pagina404());
  // O Pages serve com Jekyll por default, que ignora diretório começado por
  // `_`. O Docusaurus gera alguns; sem este arquivo eles somem no ar.
  writeFileSync(join(destino, '.nojekyll'), '');

  const resumo = degraus
    .map((d) => `${d.caminho}${d.publicado ? ` (${d.versao ?? 'sem tag'})` : ' — ausente'}`)
    .join(', ');
  console.log(`[landing] ${destino}: ${resumo}`);
}

principal();
