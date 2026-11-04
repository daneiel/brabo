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
      const paginas = [path.join(dir, 'api.html'), ...readdirSync(path.join(dir, 'api')).map((f) => path.join(dir, 'api', f))];
      expect(paginas.length).toBe(r[l].tags + 1);
      for (const p of paginas) expect(readFileSync(p, 'utf8')).not.toContain('otel.cloud.redocly.com');
    }
    expect(operacoesDoSpec(JSON.parse(readFileSync(path.join(saida, 'reference/openapi.json'), 'utf8')))).toBe(r['pt-BR'].esperadas);
  }, 300_000);

  it('relativiza links de tag e de operação e põe id na seção', () => {
    const html = '<a href="/reference/api/auth">t</a><a href="/reference/api/auth/op_x">o</a><div data-section-id="/reference/api/auth/op_x">';
    expect(relativizar(html, '/reference/api')).toBe('<a href="auth.html">t</a><a href="auth.html#op_x">o</a><div data-section-id="/reference/api/auth/op_x" id="op_x">');
  });
});
