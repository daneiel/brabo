import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { trocarVersaoNoReadme } from './readme-version.ts';

/** Caminho a partir DESTE arquivo: o vitest roda com cwd em `scripts/`. */
const daRaiz = (relativo: string) =>
  fileURLToPath(new URL(`../../${relativo}`, import.meta.url));

/**
 * A versão do README é GERADA no PR do CHANGELOG (ADR 0029 — gerar > verificar
 * > lembrar). Estes testes guardam as duas pontas: a troca em si, e o acordo
 * com o check que confere a mesma frase do outro lado.
 */
describe('trocarVersaoNoReadme', () => {
  const readme = '# Brabo\n\n**Fases 1 a 12 concluídas**, versão **v2.1.0** (CHANGELOG).\n';

  it('troca a versão anunciada e diz qual estava lá', () => {
    const { texto, anterior } = trocarVersaoNoReadme(readme, 'v2.2.0');

    expect(anterior).toBe('2.1.0');
    expect(texto).toContain('versão **v2.2.0**');
    expect(texto).not.toContain('v2.1.0');
  });

  it('aceita a tag com ou sem o `v`', () => {
    expect(trocarVersaoNoReadme(readme, '3.0.0').texto).toContain('versão **v3.0.0**');
  });

  it('não mexe em mais nada do arquivo', () => {
    const { texto } = trocarVersaoNoReadme(readme, 'v2.2.0');

    expect(texto).toContain('**Fases 1 a 12 concluídas**');
    expect(texto.split('\n')).toHaveLength(readme.split('\n').length);
  });

  /**
   * Frase não encontrada devolve `null` em vez de lançar — e o CLI reprova o
   * release com isso. Trocar em silêncio seria o mesmo defeito do check que
   * fica verde para sempre porque a regex parou de casar.
   */
  it('frase ausente devolve `anterior: null` e não inventa troca', () => {
    const { texto, anterior } = trocarVersaoNoReadme('# Sem versão aqui\n', 'v2.2.0');

    expect(anterior).toBeNull();
    expect(texto).toBe('# Sem versão aqui\n');
  });

  it('outra ocorrência de versão no texto não é atingida — só a frase do anúncio', () => {
    const comRuido =
      'Rode a v1.0.0 do script.\n\nversão **v2.1.0**\n\nA v1.0.0 continua suportada.\n';
    const { texto } = trocarVersaoNoReadme(comRuido, 'v2.2.0');

    expect(texto).toContain('Rode a v1.0.0 do script.');
    expect(texto).toContain('A v1.0.0 continua suportada.');
    expect(texto).toContain('versão **v2.2.0**');
  });

  /**
   * Os dois lados do contrato: este script ESCREVE a frase que
   * `scripts/docs/generate.mjs` CONFERE. Se um mudar sem o outro, o release
   * escreveria o que o check não encontra — e o drift voltaria calado.
   */
  it('o README de verdade tem a frase que os dois lados esperam', () => {
    const { anterior } = trocarVersaoNoReadme(readFileSync(daRaiz('README.md'), 'utf8'), 'v9.9.9');

    expect(anterior).not.toBeNull();
  });

  it('o check em generate.mjs procura exatamente este padrão', () => {
    const gerador = readFileSync(daRaiz('scripts/docs/generate.mjs'), 'utf8');

    expect(gerador).toContain('versão \\*\\*v(\\d+\\.\\d+\\.\\d+)\\*\\*');
  });
});
