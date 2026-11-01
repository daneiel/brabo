import { describe, expect, it } from 'vitest';

/**
 * AT-452 (RN-769): `i18n-vocabulario.test.ts` lê só os LOCALES, e o enum cru
 * entrava pela INTERPOLAÇÃO, em runtime — "Sessão {{status}}" com
 * `session.status` virava "Sessão closed" sem nenhuma frase do JSON mudar.
 * Esta régua lê o CÓDIGO: um `t(…)` que interpola o campo `status` de um
 * objeto direto (`{ status: x.status }`) é enum do banco na frase. O certo é
 * traduzir antes (`t(pontoDaSessao(x.status).rotuloKey)`).
 */
const fontes = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const ENUM_CRU_INTERPOLADO = /\bt\(\s*'[^']+'\s*,\s*\{[^}]*\bstatus:\s*[\w?.]+\.status\b\s*[,}]/;

function achados(arquivos: Record<string, string>): string[] {
  return Object.entries(arquivos)
    .filter(([, codigo]) => ENUM_CRU_INTERPOLADO.test(codigo))
    .map(([caminho]) => caminho);
}

describe('enum cru interpolado em frase de tela (AT-452)', () => {
  it('nenhum t() interpola o `status` cru de um objeto', () => {
    expect(achados(fontes)).toEqual([]);
  });

  it('a régua acusa o que diz acusar', () => {
    expect(
      achados({
        a: "t('ativacao.statusGenerico', { status: session?.status })",
        b: "t('ativacao.statusGenerico', { status: t(pontoDaSessao(session?.status).rotuloKey) })",
      }),
    ).toEqual(['a']);
  });
});
