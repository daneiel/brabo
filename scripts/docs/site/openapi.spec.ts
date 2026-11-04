import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { construirReferenciaDaApi, operacoesDoSpec, relativizar } from './openapi.mjs';

const LOCALES = ['pt-BR', 'en', 'ru', 'zh-Hans'];

describe('referência da API (Redoc 3, uma página por tag)', () => {
  it('renderiza todas as operações por locale, sem telemetria', async () => {
    const saida = mkdtempSync(path.join(tmpdir(), 'api-'));
    const r = await construirReferenciaDaApi({ saida, locales: LOCALES });
    for (const l of LOCALES) {
      expect(r[l].operacoes).toBe(r[l].esperadas);
      const dir = path.join(saida, l === 'pt-BR' ? '' : l, 'reference');
      expect(JSON.parse(readFileSync(path.join(dir, 'openapi.json'), 'utf8')).paths).toBeDefined();
      const paginas = [path.join(dir, 'api.html'), ...readdirSync(path.join(dir, 'api')).filter((f) => f.endsWith('.html')).map((f) => path.join(dir, 'api', f))];
      expect(paginas.length).toBe(r[l].tags + 1);
      const ids = new Map(paginas.map((p) => [path.basename(p), new Set([...readFileSync(p, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
      for (const p of paginas) {
        const html = readFileSync(p, 'utf8');
        expect(html).not.toContain('otel.cloud.redocly.com');
        // nenhum href interno aponta para rota inexistente: absoluto sob /reference/api, ou arquivo/âncora que não existe
        expect(html).not.toMatch(/href="\/reference\/api/);
        for (const [, alvo, ancora] of html.matchAll(/href="(?:\.\.\/)?([\w-]+\.html)(?:#([^"]*))?"/g)) {
          expect(ids.has(alvo), `${path.basename(p)} -> ${alvo}`).toBe(true);
          if (ancora) expect(ids.get(alvo)!.has(ancora), `${path.basename(p)} -> ${alvo}#${ancora}`).toBe(true);
        }
      }
    }
    expect(operacoesDoSpec(JSON.parse(readFileSync(path.join(saida, 'reference/openapi.json'), 'utf8')))).toBe(r['pt-BR'].esperadas);
  }, 300_000);

  it('relativiza links de tag e de operação e põe id na seção', () => {
    const html = '<a href="/reference/api/auth">t</a><a href="/reference/api/auth/op_x">o</a><div data-section-id="/reference/api/auth/op_x">';
    expect(relativizar('<a href="/reference/api/auth/op_x#auth/op_x/request">a</a><a href="/reference/api/auth/op_x?t=request&in=path">b</a><a href="/reference/api/section/errors">c</a>', '/reference/api')).toBe('<a href="auth.html#op_x">a</a><a href="auth.html#op_x">b</a><a href="../api.html">c</a>');
    expect(relativizar(html, '/reference/api')).toBe('<a href="auth.html">t</a><a href="auth.html#op_x">o</a><div data-section-id="/reference/api/auth/op_x" id="op_x">');
  });
});
