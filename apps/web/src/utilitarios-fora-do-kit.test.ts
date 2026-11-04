import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ADR 0232 / AT-655 V0: o Tailwind só gera as classes que aparecem em
 * `components/shadcn` e `components/ai-elements`. Utilitário em qualquer outro
 * `.tsx` simplesmente NÃO EXISTE no CSS servido.
 *
 * Heurística: fora das duas pastas, `className` com string LITERAL (aspas ou
 * trecho estático de template) é utilitário por construção — o estilo da casa é
 * `className={styles.x}` do CSS Module. Não tenta adivinhar quais tokens são
 * do Tailwind; proíbe a forma. EXCEÇÕES conhecidas: nenhuma.
 */
const RAIZ = __dirname;
const KIT = ['components/shadcn', 'components/ai-elements'];
const EXCECOES: string[] = [];

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? arquivos(p) : [p];
  });
}

function classNamesLiterais(codigo: string): string[] {
  const achados: string[] = [];
  for (const m of codigo.matchAll(/className=(?:"([^"]*)"|\{\s*(?:"([^"]*)"|'([^']*)')\s*\}|\{`([^`]*)`\})/g)) {
    const texto = m[1] ?? m[2] ?? m[3] ?? (m[4] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    if (texto.trim() !== '') achados.push(texto.trim());
  }
  return achados;
}

describe('utilitários do Tailwind fora do kit (ADR 0232)', () => {
  it('prova da heurística por mutação: pega literal e template estático, deixa o módulo passar', () => {
    expect(classNamesLiterais('<a className="mr-2 size-4" />')).toEqual(['mr-2 size-4']);
    expect(classNamesLiterais("<a className={'flex'} />")).toEqual(['flex']);
    expect(classNamesLiterais('<a className={`${styles.a} flex`} />')).toEqual(['flex']);
    expect(classNamesLiterais('<a className={styles.a} />')).toEqual([]);
    expect(classNamesLiterais('<a className={`${styles.a} ${styles.b}`} />')).toEqual([]);
  });

  it('nenhum .tsx fora de components/shadcn e components/ai-elements usa className literal', () => {
    const violacoes = arquivos(RAIZ)
      .filter((f) => f.endsWith('.tsx') && !/\.test\.tsx$/.test(f))
      .map((f) => relative(RAIZ, f).split(sep).join('/'))
      .filter((f) => !KIT.some((k) => f.startsWith(`${k}/`)) && !EXCECOES.includes(f))
      .flatMap((f) => classNamesLiterais(readFileSync(join(RAIZ, f), 'utf8')).map((c) => `${f}: "${c}"`));
    expect(violacoes).toEqual([]);
  });
});
