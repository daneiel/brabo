import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Todo `var(--x)` dos módulos CSS do web aponta para um token que EXISTE —
 * AT-284, ADR 0181.
 *
 * `--surface-3` (FolderBrowserModal) e `--radius-pill` (RagCitationCard) eram
 * usados e nunca foram definidos: o navegador caía no fallback do `var()` em
 * silêncio, e a tela pintava com um valor que ninguém escolheu e que nenhuma
 * mudança de tema alcançava. Este teste pega a próxima: uma custom property
 * só passa se for declarada em algum CSS (`design/tokens.css` ou o próprio
 * módulo) ou escrita em runtime pelo TS/TSX (`style={{ '--agent-color': … }}`).
 */

const RAIZ_WEB = process.cwd();
const SRC = resolve(RAIZ_WEB, 'src');

function arquivos(dir: string, filtro: (nome: string) => boolean): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && filtro(d.name))
    .map((d) => join(d.parentPath, d.name));
}

/** Nomes usados em `var(--x…)` que não estão em `definidos`. */
function tokensIndefinidos(css: string, definidos: ReadonlySet<string>): string[] {
  const usados = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
  return [...new Set(usados)].filter((nome) => !definidos.has(nome));
}

function declarados(css: string): string[] {
  return [...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
}

describe('custom properties usadas nos módulos CSS existem', () => {
  const folhas = [
    resolve(RAIZ_WEB, '../../design/tokens.css'),
    ...arquivos(SRC, (n) => n.endsWith('.css')),
  ];
  const codigo = arquivos(SRC, (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n));

  const definidos = new Set<string>();
  for (const f of folhas) for (const nome of declarados(readFileSync(f, 'utf8'))) definidos.add(nome);
  // Escritas em runtime: qualquer literal `'--x'` no código de produção.
  for (const f of codigo) {
    for (const m of readFileSync(f, 'utf8').matchAll(/['"`](--[\w-]+)['"`]/g)) definidos.add(m[1]);
  }

  it('o inventário foi lido — não passa vazio', () => {
    expect(folhas.length).toBeGreaterThan(50);
    expect(definidos.has('--surface-0')).toBe(true);
    expect(definidos.has('--agent-color')).toBe(true);
  });

  it('caminho feliz: nenhum módulo usa token inexistente', () => {
    const achados = folhas.flatMap((f) =>
      tokensIndefinidos(readFileSync(f, 'utf8'), definidos).map((nome) => `${f.replace(SRC, 'src')}: ${nome}`),
    );
    expect(achados).toEqual([]);
  });

  it('falha: os dois tokens que não existiam seriam pegos', () => {
    const css = '.a { background: var(--surface-3, var(--surface-1)); border-radius: var(--radius-pill, 999px); }';
    expect(tokensIndefinidos(css, definidos)).toEqual(['--surface-3', '--radius-pill']);
  });
});
