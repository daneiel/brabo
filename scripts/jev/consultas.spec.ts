import { describe, expect, it } from 'vitest';
import { comandoPsql as psqlDados, consultas as consultasDados } from './dados.ts';
import { comandoPsql as psqlReplay, consultas as consultasReplay } from './replay.ts';

// O slug de `--projeto` nunca entra no TEXTO do SQL (CodeQL, escape incompleto):
// vai como variável do psql e o SQL cita por `:'slug'`.
const MALICIOSO = "x' OR '1'='1";

describe.each([
  ['dados.ts', consultasDados, psqlDados],
  ['replay.ts', consultasReplay, psqlReplay],
] as const)('%s', (_n, consultas, comandoPsql) => {
  it('com projeto, o SQL usa a variável e o valor viaja só no -v', () => {
    const q = consultas(MALICIOSO);
    for (const sql of Object.values(q)) expect(sql).not.toContain(MALICIOSO);
    expect(q.eventos).toContain(`p.slug = :'slug'`);
    const [bin, args] = comandoPsql({ databaseUrl: 'postgres://x', usuario: 'u', banco: 'b', projeto: MALICIOSO } as never);
    expect(bin).toBe('psql');
    expect(args).toContain(`slug=${MALICIOSO}`);
    expect(args.slice(-2)).toEqual(['-f', '-']);
    expect(args).not.toContain('-c');
  });

  it('sem projeto, não há filtro nem variável', () => {
    expect(consultas().eventos).not.toContain(":'slug'");
    const [, args] = comandoPsql({ databaseUrl: 'postgres://x', usuario: 'u', banco: 'b' } as never);
    expect(args.join(' ')).not.toContain('slug=');
  });
});
