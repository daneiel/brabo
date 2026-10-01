import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIPOS_SEM_SEMPRE_PERMITIR, podeOferecerSemprePermitir } from './sempre-permitir';

/**
 * A lista do web é CÓPIA da do backend (o web não importa `apps/api`). Este
 * teste lê o arquivo da api, como `aprovacoes.test.ts` faz com `decide.ts`, e
 * reprova qualquer divergência (AT-320).
 */
const FONTE = join(process.cwd(), '..', 'api', 'src', 'domain', 'actions', 'sempre-permitir.ts');

function tiposDoBackend(): string[] {
  const conteudo = readFileSync(FONTE, 'utf8');
  const inicio = conteudo.indexOf('export const TIPOS_SEM_SEMPRE_PERMITIR');
  if (inicio === -1) {
    throw new Error(
      `Não achei "export const TIPOS_SEM_SEMPRE_PERMITIR" em ${FONTE} — se a constante mudou, ` +
        `este teste acompanha, nunca é removido.`,
    );
  }
  const fim = conteudo.indexOf('];', inicio);
  const bloco = conteudo.slice(inicio, fim).replace(/\/\/.*$/gm, '');
  return [...bloco.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('"Sempre permitir" — tipos do teto (AT-320)', () => {
  it('a cópia do web é IGUAL à lista da api', () => {
    const doBackend = tiposDoBackend();
    expect(doBackend.length).toBeGreaterThan(3);
    expect([...TIPOS_SEM_SEMPRE_PERMITIR].sort()).toEqual([...doBackend].sort());
  });

  it('não oferece para git tipado; oferece para terminal e git_commit', () => {
    expect(podeOferecerSemprePermitir('git_push')).toBe(false);
    expect(podeOferecerSemprePermitir('pr_open')).toBe(false);
    expect(podeOferecerSemprePermitir('git_merge')).toBe(false);
    expect(podeOferecerSemprePermitir('terminal')).toBe(true);
    expect(podeOferecerSemprePermitir('git_commit')).toBe(true);
  });
});
