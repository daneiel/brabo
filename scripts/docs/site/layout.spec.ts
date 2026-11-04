import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { copiarAssets, layout } from './layout.mjs';

const base = {
  locale: 'en',
  slug: 'guides/x.html',
  titulo: 'X <b>',
  conteudo: '<p>oi</p>',
  nav: [{ rotulo: 'G', itens: [{ rotulo: 'X', href: 'guides/x.html' }] }],
  degrau: 'dev',
  degraus: ['dev', 'prd'],
};

describe('layout do site', () => {
  it('caminhos relativos, noindex fora de prd, nada de fora e escape do título', () => {
    const h: string = layout(base);
    expect(h).toContain('href="../../assets/site.css"');
    expect(h).toContain('noindex');
    expect(h).toContain('X &lt;b&gt; | Brabo');
    expect(h).toContain('aria-current="page"');
    expect(h).not.toMatch(/(src|href)="https?:/);
    expect(h).not.toMatch(/<script>/);
    expect(layout({ ...base, degrau: 'prd' })).not.toContain('noindex');
  });

  it('falha: seletor de idioma leva ao mesmo slug nos outros locales', () => {
    const h: string = layout({ ...base, locale: 'pt-BR', slug: 'a.html' });
    expect(h).toContain('value="en/a.html"');
  });

  it('copiarAssets grava tokens, fontes relativas e scripts', () => {
    const d = mkdtempSync(join(tmpdir(), 'site-'));
    copiarAssets(d);
    for (const f of ['site.css', 'tema.js', 'site.js', 'tokens.css', 'fonts/archivo-latin.woff2'])
      expect(existsSync(join(d, 'assets', f)), f).toBe(true);
    expect(readFileSync(join(d, 'assets/fonts.css'), 'utf8')).not.toContain("url('/fonts/");
  });
});
