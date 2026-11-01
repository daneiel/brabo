import { describe, expect, it } from 'vitest';

/**
 * Paridade dos idiomas da interface contra a FONTE pt-BR (AT-289; fonte
 * pt-BR desde o ADR 0216, RN-891). Os locales são DESCOBERTOS por glob em
 * `locales/*`: cada pasta que existir é comparada com o pt-BR, chave por
 * chave, nos dois sentidos. Locale previsto sem pasta (hoje `ru` e
 * `zh-Hans`, cujos catálogos são outra rodada) NÃO reprova — a tela cai no
 * pt-BR, que é a decisão do item 4 do ADR 0216.
 *
 * Sufixo de plural é normalizado para a raiz na comparação de chaves, e as
 * formas de plural são conferidas POR LOCALE contra
 * `Intl.PluralRules(lng).resolvedOptions().pluralCategories`: todo sufixo tem
 * de ser categoria do idioma (o pt-BR soma o `_zero` da AT-331).
 */
type Arvore = { [chave: string]: unknown };
type ModuloJson = { default: Arvore };

const FONTE = 'pt-BR';
const PREVISTOS = ['pt-BR', 'en', 'ru', 'zh-Hans'];

const modulos = import.meta.glob<ModuloJson>('../locales/*/*.json', { eager: true });

const SUFIXO_DE_PLURAL = /_(zero|one|two|few|many|other)$/;

function porLocale(): Map<string, Map<string, Arvore>> {
  const mapa = new Map<string, Map<string, Arvore>>();
  for (const [caminho, modulo] of Object.entries(modulos)) {
    const partes = caminho.split('/');
    const locale = partes[partes.length - 2];
    const ns = (partes.pop() ?? '').replace(/\.json$/, '');
    const doLocale = mapa.get(locale) ?? new Map<string, Arvore>();
    doLocale.set(ns, modulo.default);
    mapa.set(locale, doLocale);
  }
  return mapa;
}

function folhas(arvore: Arvore, prefixo = ''): string[] {
  const saida: string[] = [];
  for (const [chave, valor] of Object.entries(arvore)) {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave;
    if (valor !== null && typeof valor === 'object' && !Array.isArray(valor)) {
      saida.push(...folhas(valor as Arvore, caminho));
    } else {
      saida.push(caminho);
    }
  }
  return saida;
}

function chavesAchatadas(arvore: Arvore): Set<string> {
  return new Set(folhas(arvore).map((c) => c.replace(SUFIXO_DE_PLURAL, '')));
}

function faltando(de: Set<string>, em: Set<string>): string[] {
  return [...de].filter((chave) => !em.has(chave)).sort();
}

/** Sufixos de plural que não são categoria do idioma. */
function pluraisForaDoIdioma(arvore: Arvore, lng: string): string[] {
  const categorias = new Set<string>(new Intl.PluralRules(lng).resolvedOptions().pluralCategories);
  if (lng === 'pt-BR') categorias.add('zero');
  return folhas(arvore)
    .filter((c) => {
      const m = SUFIXO_DE_PLURAL.exec(c);
      return m !== null && !categorias.has(m[1]);
    })
    .sort();
}

/**
 * Plural da fonte sem as formas do idioma. A comparação de chaves normaliza
 * o sufixo, então `x` simples no locale "casava" com `x_one/x_other` da fonte
 * e a falta passava (AT-549): aqui toda raiz plural da fonte exige, no
 * locale, cada categoria do `Intl.PluralRules` dele.
 */
function pluraisIncompletos(fonteNs: Arvore, lngNs: Arvore, lng: string): string[] {
  const categorias = new Intl.PluralRules(lng).resolvedOptions().pluralCategories;
  const doLocale = new Set(folhas(lngNs));
  const raizes = new Set(
    folhas(fonteNs)
      .filter((c) => SUFIXO_DE_PLURAL.test(c))
      .map((c) => c.replace(SUFIXO_DE_PLURAL, '')),
  );
  return [...raizes]
    .flatMap((r) => categorias.map((cat) => `${r}_${cat}`))
    .filter((c) => !doLocale.has(c))
    .sort();
}

const locales = porLocale();
const fonte = locales.get(FONTE) ?? new Map<string, Arvore>();
const traduzidos = [...locales.keys()].filter((l) => l !== FONTE).sort();
const doLocale = (lng: string) => locales.get(lng) ?? new Map<string, Arvore>();

describe('paridade de chaves contra a fonte pt-BR (AT-289, RN-891)', () => {
  it('a fonte pt-BR existe, e só há pastas de locales previstos', () => {
    expect(fonte.size).toBeGreaterThan(0);
    expect([...locales.keys()].filter((l) => !PREVISTOS.includes(l))).toEqual([]);
  });

  it.each(traduzidos)('o locale "%s" tem os mesmos namespaces da fonte', (lng) => {
    expect([...doLocale(lng).keys()].sort()).toEqual([...fonte.keys()].sort());
  });

  const pares = traduzidos.flatMap((lng) => [...fonte.keys()].sort().map((ns) => [lng, ns] as const));
  it.each(pares)('"%s" / namespace "%s": mesmas chaves da fonte', (lng, ns) => {
    const chavesFonte = chavesAchatadas(fonte.get(ns) ?? {});
    const chavesLng = chavesAchatadas(doLocale(lng).get(ns) ?? {});
    expect({
      faltamNoLocale: faltando(chavesFonte, chavesLng),
      sobramNoLocale: faltando(chavesLng, chavesFonte),
    }).toEqual({ faltamNoLocale: [], sobramNoLocale: [] });
  });

  it.each(pares)('"%s" / namespace "%s": todo plural da fonte tem as formas do idioma', (lng, ns) => {
    expect(pluraisIncompletos(fonte.get(ns) ?? {}, doLocale(lng).get(ns) ?? {}, lng)).toEqual([]);
  });

  it.each([...locales.keys()].sort())('"%s": plurais só nas categorias do Intl.PluralRules', (lng) => {
    const fora = [...doLocale(lng).values()].flatMap((arvore) => pluraisForaDoIdioma(arvore, lng));
    expect(fora).toEqual([]);
  });

  it('acusa a chave que falta e o plural fora do idioma (o instrumento mede)', () => {
    const a = chavesAchatadas({ x: { y: 'a', z_one: '1', z_other: 'n' } });
    const b = chavesAchatadas({ x: { y: 'a', z_one: '1', z_many: 'm', z_other: 'n', w: 'só aqui' } });
    expect(faltando(a, b)).toEqual([]);
    expect(faltando(b, a)).toEqual(['x.w']);
    expect(pluraisForaDoIdioma({ k_few: 'x', k_other: 'y' }, 'en')).toEqual(['k_few']);
    expect(pluraisForaDoIdioma({ k_zero: 'x', k_other: 'y' }, 'pt-BR')).toEqual([]);
    expect(pluraisForaDoIdioma({ k_few: 'x' }, 'ru')).toEqual([]);
    const fontePlural = { k_zero: '0', k_one: '1', k_other: 'n' };
    expect(pluraisIncompletos(fontePlural, { k: 'sem plural' }, 'en')).toEqual(['k_one', 'k_other']);
    expect(pluraisIncompletos(fontePlural, { k_one: '1', k_other: 'n' }, 'en')).toEqual([]);
  });

  it('locale previsto sem pasta não reprova (declarado: catálogo de ru/zh-Hans é outra rodada)', () => {
    expect(PREVISTOS.filter((l) => !locales.has(l))).not.toContain(FONTE);
  });
});
