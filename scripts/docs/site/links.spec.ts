import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { construir } from './build.mjs';
// @ts-expect-error módulo .mjs sem tipos
import { carregaDeFora, verificarLinks } from './links.mjs';
// @ts-expect-error módulo .mjs sem tipos
import { renderizarPagina } from './layout.mjs';

/** Site de mentira: `a.html` linka para `sub/b.html#sec`, que tem id="sec". */
function site(mutar: (f: Record<string, string>) => void = () => {}) {
  const f: Record<string, string> = {
    'a.html': '<a href="sub/b.html#sec">b</a><a href="#topo" id="topo">x</a><a href="https://github.com/x">fora</a>',
    'sub/b.html': '<h2 id="sec">S</h2><a href="../a.html">a</a>',
  };
  mutar(f);
  const d = mkdtempSync(path.join(tmpdir(), 'links-'));
  for (const [k, v] of Object.entries(f)) {
    mkdirSync(path.dirname(path.join(d, k)), { recursive: true });
    writeFileSync(path.join(d, k), v);
  }
  return d;
}

describe('verificarLinks (mutação)', () => {
  it('site íntegro: sem erro, conta links e âncoras; externo é ignorado', () => {
    const r = verificarLinks(site());
    expect(r.erros).toEqual([]);
    expect(r).toMatchObject({ paginas: 2, links: 3, ancoras: 2 });
  });

  it('link quebrado reprova', () => {
    const r = verificarLinks(site((f) => { f['a.html'] += '<a href="sub/nao-existe.html">x</a>'; }));
    expect(r.erros).toEqual(['a.html: link quebrado -> sub/nao-existe.html']);
  });

  it('âncora quebrada reprova', () => {
    const r = verificarLinks(site((f) => { f['a.html'] = '<a href="sub/b.html#outra">b</a>'; }));
    expect(r.erros).toEqual(['a.html: âncora quebrada -> sub/b.html#outra']);
  });

  it('pendência declarada não reprova, mas é listada; o que não está na lista reprova', () => {
    const d = site((f) => { f['a.html'] += '<a href="reference/api.html">api</a><a href="reference/outra.html">o</a>'; });
    const r = verificarLinks(d);
    expect(r.pendentes).toEqual(['a.html: link quebrado -> reference/api.html']);
    expect(r.erros).toEqual(['a.html: link quebrado -> reference/outra.html']);
  });
});

describe('carregaDeFora', () => {
  it('limpo: <a> externo e caminho relativo passam', () => {
    expect(carregaDeFora(site())).toEqual([]);
  });

  it('falha: script, link e @import com http(s):// reprovam', () => {
    const d = site((f) => {
      f['a.html'] += '<script src="https://cdn.x/a.js"></script><link rel="stylesheet" href="//fonts.x/c.css"><style>@import url("https://x/y.css");</style>';
      f['s.css'] = "@import 'http://x/z.css';";
    });
    expect(carregaDeFora(d)).toHaveLength(4);
  });
});

describe('renderizarPagina', () => {
  const ctx = {
    locale: 'en',
    pagina: { url: 'en/guides/x.html', titulo: 'X', traduzida: true },
    corpo: { html: '<p>oi</p>', toc: [], temH1: false },
    navegacao: [],
    urlDe: (s: string) => `${s}.html`,
    rotuloDe: (s: string) => s,
    anterior: { slug: 'ant', rotulo: 'Ant' },
    proximo: null,
    degrau: 'dev',
    edicao: { url: 'https://github.com/o/r/blob/dev/docs/x.md', atualizadoEm: null, autor: null },
  };

  it('feliz: título, h1 gerado e pager relativo à profundidade da página', () => {
    const h: string = renderizarPagina(ctx);
    expect(h).toContain('lang="en"');
    expect(h).toContain('<h1>X</h1>');
    expect(h).toContain('href="../ant.html"');
    expect(h).not.toContain('site-faixa');
  });

  it('falha: página sem tradução mostra a faixa; título é escapado', () => {
    const h: string = renderizarPagina({ ...ctx, pagina: { ...ctx.pagina, titulo: 'A<b>', traduzida: false } });
    expect(h).toContain('class="site-faixa"');
    expect(h).toContain('A&lt;b&gt;');
  });
});

describe('404.html do build', () => {
  it('feliz: existe, é pt-BR e não carrega nada de fora; falha: a guarda pega um recurso de fora injetado', async () => {
    const raiz = mkdtempSync(path.join(tmpdir(), 'site404-'));
    mkdirSync(path.join(raiz, 'docs/adr'), { recursive: true });
    writeFileSync(path.join(raiz, 'docs/adr/temas.yml'), 'temas:\n  - id: docs\n    titulo: Documentação\n    descricao: x\nadrs:\n  "0001": docs\n');
    writeFileSync(path.join(raiz, 'docs/adr/0001-x.md'), '# ADR 0001\n');
    writeFileSync(path.join(raiz, 'docs/intro.md'), '---\ntitle: I\nslug: /\n---\n# I\n');
    const saida = path.join(raiz, 'out');
    await construir({ raiz, saida, degrau: 'dev', git: false });
    const h = readFileSync(path.join(saida, '404.html'), 'utf8');
    expect(h).toContain('lang="pt-BR"');
    expect(h).toContain('noindex');
    expect(carregaDeFora(saida)).toEqual([]);
    writeFileSync(path.join(saida, '404.html'), `${h}<script src="https://evil/x.js"></script>`);
    expect(carregaDeFora(saida)).toEqual(['404.html: <script src> https://evil/x.js']);
  });
});
