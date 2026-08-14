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
// `/brabo/<algo>` para `/brabo/main/<algo>` sem manter uma cópia do site.
//
// Sem dependência nova: só `node:fs` e `node:child_process`.
//
// Uso:
//   node scripts/docs/landing.mjs <diretório-de-saída>
//   pnpm docs:landing publicacao

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEGRAUS = [
  {
    branch: 'main',
    titulo: 'main',
    selo: 'estável',
    descricao: 'A documentação publicada. É esta que o Google indexa.',
  },
  {
    branch: 'qa',
    titulo: 'qa',
    selo: 'candidata',
    descricao: 'O que está em validação, a caminho da próxima release.',
  },
  {
    branch: 'dev',
    titulo: 'dev',
    selo: 'em desenvolvimento',
    descricao: 'O estado mais recente. Pode descrever o que ainda não saiu.',
  },
];

/**
 * A versão publicada num degrau, lida das tags do próprio repositório.
 *
 * `main` carimba `vX.Y.Z`; `dev` e `qa` carimbam `vX.Y.Z-<estagio>.N`
 * (ver scripts/ci/tag-release.ts). Sem tag ainda, devolve null — e a página
 * diz "sem versão carimbada" em vez de inventar uma.
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
      (d) => `      <a class="degrau" href="./${d.branch}/">
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
<meta name="description" content="Documentação do Brabo, publicada por degrau da esteira: main, qa e dev.">
<!-- A raiz não é conteúdo: é um índice. Quem indexa é /main/. -->
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="https://daneiel.github.io/brabo/main/">
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
  // caminho dentro de /brabo/main/.
  //
  // A guarda `main|qa|dev` evita o laço: um 404 DENTRO de um degrau (página que
  // realmente não existe) não pode ser reencaminhado para /main/ de novo.
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
    // Já está dentro de um degrau: a página realmente não existe.
    if (/^(main|qa|dev)(\\/|$)/.test(resto)) return;
    window.location.replace(
      raiz + 'main/' + resto + window.location.search + window.location.hash
    );
  })();
</script>
</head>
<body>
  <p>Esta página mudou de endereço. Indo para
     <a href="/brabo/main/">a documentação estável</a>…</p>
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
    const dir = join(destino, d.branch);
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
    .map((d) => `${d.branch}${d.publicado ? ` (${d.versao ?? 'sem tag'})` : ' — ausente'}`)
    .join(', ');
  console.log(`[landing] ${destino}: ${resumo}`);
}

principal();
