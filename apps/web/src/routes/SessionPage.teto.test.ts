/// <reference types="node" />
// Lê o filesystem em tempo de teste, como `lib/aprovacoes.test.ts`: a
// referência tripla-barra escopa `@types/node` a este arquivo só.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A TRAVA do programa do ADR 0176: `SessionPage.tsx` não volta a ter 1 000
 * linhas ou mais.
 *
 * A dívida da decomposição (BRB-015) já tinha sido fechada uma vez — ADRs
 * 0122 e 0124, 3 807 linhas reduzidas — e voltou a crescer em silêncio até
 * 2 637, porque nada reprovava o crescimento. Por decisão do mantenedor
 * (2026-09-27, AT-138) a trava nasceu só DEPOIS de o arquivo estar abaixo do
 * teto: travar para cima um arquivo que ninguém decompõe só produziria PR
 * vermelho. Agora que está, ela é o que impede a regressão que a história
 * HS-020 existe para contar.
 *
 * Reprovou? A saída é a do programa: tire um recorte do arquivo (um
 * componente, um hook, uma função pura, com os testes existentes passando sem
 * edição), nunca subir o número. Subir o teto é decisão com ADR novo, que
 * referencia o 0176.
 *
 * `process.cwd()` (não `import.meta.url`) pelo mesmo motivo de
 * `lib/aprovacoes.test.ts`: o vitest deste pacote roda com cwd = `apps/web`.
 */
const TETO_DE_LINHAS = 1000;
const ARQUIVO = join(process.cwd(), 'src', 'routes', 'SessionPage.tsx');

/** Linhas como o `wc -l` conta: a quebra final não abre uma linha a mais. */
function contarLinhas(texto: string): number {
  if (texto === '') return 0;
  const partes = texto.split('\n');
  return texto.endsWith('\n') ? partes.length - 1 : partes.length;
}

describe('o teto de linhas do SessionPage.tsx (ADR 0176)', () => {
  it(`SessionPage.tsx tem menos de ${TETO_DE_LINHAS} linhas`, () => {
    const linhas = contarLinhas(readFileSync(ARQUIVO, 'utf8'));
    expect(
      linhas,
      `SessionPage.tsx tem ${linhas} linhas; o teto do ADR 0176 é ${TETO_DE_LINHAS} ` +
        '(exclusivo). Tire um recorte mecânico do arquivo em vez de subir o número.',
    ).toBeLessThan(TETO_DE_LINHAS);
  });

  // A trava só vale se a contagem for a certa: um contador que devolvesse 0
  // passaria em qualquer arquivo. As duas bordas provam que ela conta como o
  // `wc -l` e que 1 000 linhas exatas REPROVAM.
  it('conta como o wc -l, e 1 000 linhas exatas ficam no teto', () => {
    expect(contarLinhas('')).toBe(0);
    expect(contarLinhas('a\n')).toBe(1);
    expect(contarLinhas('a\nb')).toBe(2);
    expect(contarLinhas('x\n'.repeat(999))).toBeLessThan(TETO_DE_LINHAS);
    expect(contarLinhas('x\n'.repeat(1000))).not.toBeLessThan(TETO_DE_LINHAS);
  });
});
