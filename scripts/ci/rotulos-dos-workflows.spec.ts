import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Todo `--label X` de um workflow precisa de `gh label create X ... --force`
 * no MESMO arquivo. Sem ele, o `gh issue create` falha em repositório novo
 * (ou onde o rótulo foi apagado) e o alarme nunca abre. O `--force` torna o
 * create idempotente: rótulo que já existe não derruba o job.
 */

export function rotulosSemCreate(conteudo: string): string[] {
  const usados = [...conteudo.matchAll(/--label[ =]([A-Za-z0-9_.-]+)/g)].map((m) => m[1] ?? '');
  const criados = new Set(
    [...conteudo.matchAll(/gh label create ([A-Za-z0-9_.-]+)([^\n]*)/g)]
      .filter((m) => /--force/.test(m[2] ?? ''))
      .map((m) => m[1] ?? ''),
  );
  return [...new Set(usados)].filter((r) => !criados.has(r));
}

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '.github', 'workflows');

describe('rotulosSemCreate', () => {
  it('aceita --label com gh label create --force no mesmo arquivo', () => {
    const yml = 'run: |\n  gh label create docs --force\n  gh issue create --label docs\n';
    expect(rotulosSemCreate(yml)).toEqual([]);
  });

  it('MUTAÇÃO: reprova --label sem create', () => {
    const yml = 'run: gh issue create --label docs --title x\n';
    expect(rotulosSemCreate(yml)).toEqual(['docs']);
  });

  it('MUTAÇÃO: create sem --force não conta', () => {
    const yml = 'run: |\n  gh label create docs\n  gh issue create --label docs\n';
    expect(rotulosSemCreate(yml)).toEqual(['docs']);
  });
});

describe('workflows reais', () => {
  it('todo --label tem create --force no mesmo arquivo, e o escaneio não é cego', () => {
    const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.yml'));
    let extraidos = 0;
    const falhas: string[] = [];
    for (const f of arquivos) {
      const conteudo = readFileSync(join(DIR, f), 'utf8');
      extraidos += [...conteudo.matchAll(/--label[ =]([A-Za-z0-9_.-]+)/g)].length;
      for (const r of rotulosSemCreate(conteudo)) falhas.push(`${f}: --label ${r}`);
    }
    expect(extraidos, 'escaneio cego: nenhum --label extraído').toBeGreaterThan(0);
    expect(falhas).toEqual([]);
  });
});
