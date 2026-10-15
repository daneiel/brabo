import { describe, expect, it } from 'vitest';
import { classificar, dadosDaFaixa, medirDocs, medirInterface, relatorio, traducaoDe } from './paridade-de-traducao.mjs';

/**
 * AT-550 (ADR 0216 itens 6–7). Cada reprovação é uma MUTAÇÃO de um caso certo:
 * a forma certa sai "em dia"/completa, a mutada não.
 */

const SHA = 'a'.repeat(40);
const pagina = (sha: string | null) => (sha ? `---\ntitle: x\ntraducao_de: ${sha}\n---\n# X\n` : '---\ntitle: x\n---\n# X\n');
const commits: Record<string, string> = { [SHA]: '2026-10-10T12:00:00Z' };
const commitDe = (s: string) => commits[s] ?? null;
const fonte = (data: string, suja = false) => ({ chars: 100, data, suja });

describe('classificar', () => {
  it('em dia: a fonte não mudou depois do traducao_de', () => {
    expect(classificar(pagina(SHA), fonte('2026-10-10T12:00:00Z'), commitDe).estado).toBe('em-dia');
  });
  it('mutação: fonte com commit mais novo → defasada', () => {
    expect(classificar(pagina(SHA), fonte('2026-10-11T00:00:00Z'), commitDe).estado).toBe('defasada');
  });
  it('mutação: fonte com mudança não commitada → defasada', () => {
    expect(classificar(pagina(SHA), fonte('2026-10-01T00:00:00Z', true), commitDe).estado).toBe('defasada');
  });
  it('mutação: SHA inexistente → defasada', () => {
    expect(classificar(pagina('b'.repeat(40)), fonte('2026-10-01T00:00:00Z'), commitDe).estado).toBe('defasada');
  });
  it('mutação: sem traducao_de → sem procedência', () => {
    expect(classificar(pagina(null), fonte('2026-10-01T00:00:00Z'), commitDe).estado).toBe('sem-procedencia');
    expect(traducaoDe('# sem frontmatter\ntraducao_de: ' + SHA)).toBeNull();
  });
});

describe('medirDocs', () => {
  const fontes = new Map([
    ['a.md', fonte('2026-10-01T00:00:00Z')],
    ['b.md', { chars: 300, data: '2026-10-01T00:00:00Z', suja: false }],
  ]);
  it('conta páginas, caracteres, ausentes e órfãs', () => {
    const r = medirDocs(fontes, { en: new Map([['a.md', pagina(SHA)], ['velha.md', pagina(SHA)]]) }, commitDe);
    expect(r.en).toMatchObject({ paginas: 2, traduzidas: 1, chars: 400, charsTraduzidos: 100, emDia: ['a.md'], ausentes: ['b.md'], orfas: ['velha.md'] });
    expect(r.ru.ausentes).toEqual(['a.md', 'b.md']);
    expect(JSON.parse(dadosDaFaixa(r)).en['a.md']).toEqual({ defasada: false, data: '2026-10-10' });
  });
  it('o relatório é determinístico e nomeia a defasada', () => {
    const f = new Map([['a.md', fonte('2026-10-12T00:00:00Z')]]);
    const r = medirDocs(f, { en: new Map([['a.md', pagina(SHA)]]) }, commitDe);
    const ui = medirInterface({ 'pt-BR': {} });
    const md = relatorio(r, ui, '> aviso');
    expect(md).toBe(relatorio(r, ui, '> aviso'));
    expect(md).toContain('- `a.md` (tradução de 2026-10-10)');
  });
});

describe('medirInterface', () => {
  const pt = { ns: { titulo: 'T', item_zero: 'nenhum', item_one: 'um', item_many: 'muitos', item_other: 'vários' } };
  it('completo: chaves simples e as formas de plural de cada locale', () => {
    const r = medirInterface({
      'pt-BR': pt,
      en: { ns: { titulo: 'T', item_one: 'one', item_other: 'many' } },
      ru: { ns: { titulo: 'T', item_one: '1', item_few: '2', item_many: '5', item_other: 'x' } },
      'zh-Hans': { ns: { titulo: 'T', item_other: 'x' } },
    });
    for (const l of ['en', 'ru', 'zh-Hans'] as const) {
      expect(r[l].presentes).toBe(r[l].chaves);
      expect(r[l].pluraisIncompletos).toEqual([]);
    }
    expect(new Set(r.ru.categorias)).toEqual(new Set(['one', 'few', 'many', 'other']));
  });
  it('mutação: falta a forma few no ru → plural incompleto', () => {
    const r = medirInterface({ 'pt-BR': pt, ru: { ns: { titulo: 'T', item_one: '1', item_many: '5', item_other: 'x' } } });
    expect(r.ru.pluraisIncompletos).toEqual(['ns:item (few)']);
    expect(r.ru.presentes).toBe(r.ru.chaves - 1);
  });
  it('mutação: falta chave simples e catálogo ausente', () => {
    const r = medirInterface({ 'pt-BR': pt, en: { ns: { item_one: 'one', item_other: 'x' } } });
    expect(r.en.presentes).toBe(r.en.chaves - 1);
    expect(r['zh-Hans'].existe).toBe(false);
    expect(r['zh-Hans'].presentes).toBe(0);
  });
});
