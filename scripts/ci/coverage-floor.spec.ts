import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extrairCoberturaTotal, lerPisoGravado, verificarPiso } from './coverage-floor.ts';

/** Caminho a partir DESTE arquivo: o vitest roda com cwd em `scripts/`. */
const daRaiz = (relativo: string) => fileURLToPath(new URL(`../../${relativo}`, import.meta.url));

/**
 * Recorte real de `mix test --cover` (`apps/engine`, medido em 2026-08-27):
 * a tabela por módulo, a linha `Total` e o rodapé do `:cover`. O parser só
 * precisa da última linha — o resto prova que ele ignora o ruído em volta.
 */
const SAIDA_REAL = `Running ExUnit with seed: 123456, max_cases: 40

.....................................................................

Finished in 42.1 seconds (10.2s async, 31.9s sync)
1234 tests, 0 failures

Generating cover results ...

| Percentage | Module                                        |
|------------|-----------------------------------------------|
|     93.33% | Engine.Agents.TurnoAssincronoCase             |
|     94.05% | Engine.Harness.ToolLoop.Default               |
|    100.00% | EngineWeb.Router                              |
|------------|-----------------------------------------------|
|     79.88% | Total                                         |

Generated HTML coverage results in "cover" directory
`;

describe('extrairCoberturaTotal — lê a linha `Total` do `:cover`', () => {
  it('extrai a % total de uma saída real de `mix test --cover`', () => {
    expect(extrairCoberturaTotal(SAIDA_REAL)).toBe(79.88);
  });

  it('devolve `null` quando a linha `Total` não aparece — nunca inventa número', () => {
    // Formato mudou, ou o comando rodou sem `--cover`: aprovar em silêncio
    // seria pior que reprovar por um motivo errado.
    expect(extrairCoberturaTotal('mix test rodou sem --cover, sem tabela nenhuma.\n')).toBeNull();
  });

  it('pega a cobertura de 100%, sem casar com a linha de um módulo no meio da tabela', () => {
    const saida = `
| Percentage | Module                                        |
|------------|-----------------------------------------------|
|     50.00% | Engine.Foo                                    |
|------------|-----------------------------------------------|
|    100.00% | Total                                         |
`;
    expect(extrairCoberturaTotal(saida)).toBe(100);
  });
});

describe('verificarPiso — o veredito é sempre explícito', () => {
  it('cobertura ACIMA do piso aprova', () => {
    expect(verificarPiso(80, 78)).toEqual({ ok: true, atual: 80, piso: 78 });
  });

  it('cobertura EXATAMENTE no piso aprova — bater o piso não é regressão', () => {
    expect(verificarPiso(78, 78)).toEqual({ ok: true, atual: 78, piso: 78 });
  });

  it('cobertura ABAIXO do piso reprova — este é o caminho de falha que o script existe para pegar', () => {
    expect(verificarPiso(77.9, 78)).toEqual({ ok: false, atual: 77.9, piso: 78 });
  });
});

describe('lerPisoGravado — o contrato do JSON', () => {
  it('lê o campo `engine` de um JSON gravado', () => {
    expect(lerPisoGravado('{"engine": 78}')).toEqual({ engine: 78 });
  });

  it('o `coverage-floor.json` de verdade no repositório tem o campo `engine`', () => {
    // Este teste é o que faz o arquivo real fazer parte do contrato: editar o
    // JSON para algo sem `engine` quebraria o CLI em produção sem quebrar
    // nenhum teste, se não fosse por esta asserção.
    const piso = lerPisoGravado(readFileSync(daRaiz('scripts/ci/coverage-floor.json'), 'utf8'));

    expect(typeof piso.engine).toBe('number');
    expect(piso.engine).toBeGreaterThan(0);
    expect(piso.engine).toBeLessThanOrEqual(100);
  });

  /**
   * O piso é um RATCHET sobre o valor medido em 2026-08-27 (79,88%/79,90%
   * conforme a execução — variação de décimo por ordem de teste), nunca uma
   * meta maior que o real. Um piso acima de ~80% reprovaria o CI hoje sem
   * ninguém ter regredido nada.
   */
  it('o piso do engine não é maior que a cobertura real medida', () => {
    const piso = lerPisoGravado(readFileSync(daRaiz('scripts/ci/coverage-floor.json'), 'utf8'));

    expect(piso.engine).toBeLessThanOrEqual(79.88);
  });
});
