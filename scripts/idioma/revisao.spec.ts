import { describe, expect, it } from 'vitest';
import {
  acertou,
  chaveDe,
  erroDoClassificador,
  lerRotulos,
  relatorioRevisado,
  rotular,
  veredictoRevisado,
  wilson,
  type Rotulo,
} from './revisao.ts';
import type { Resposta } from './validacao.ts';

function resp(p: Partial<Resposta> & Pick<Resposta, 'caso' | 'rodada'>): Resposta {
  return {
    braco: 'tratamento',
    modelo: 'm/a',
    sessao: 0,
    turno: 0,
    esperado: 'pt',
    veredito: 'pt',
    revisar: false,
    noLimiar: true,
    texto: 'x',
    usouFerramenta: [],
    upstream: [],
    ...p,
  };
}

const CAB = (r: Resposta) => `## ${r.caso} · ${r.modelo} · ${r.braco} · rodada ${r.rodada} · sessão ${r.sessao} · turno ${r.turno}`;

describe('lerRotulos', () => {
  it('lê o cabeçalho de revisao.md e a linha de revisão', () => {
    const r = resp({ caso: 'C11', rodada: 2, revisar: true, veredito: 'indeterminado' });
    const md = [CAB(r), 'esperado: en · classificador: indeterminado', 'revisão: idioma=pt · correta=c11 · traducao=ausente · motivo: moldura em português', ''].join('\n');
    const m = lerRotulos(md);
    expect(m.get(chaveDe(r))).toEqual({ idioma: 'pt', correta: 'c11', traducao: 'ausente', motivo: 'moldura em português' });
  });

  it('LANÇA em linha malformada, em rótulo duplicado e em c11 sem tradução declarada', () => {
    const r = resp({ caso: 'C01', rodada: 0 });
    expect(() => lerRotulos([CAB(r), 'revisão: idioma=pt · correta=talvez · motivo: x'].join('\n'))).toThrow(/malformada/);
    const ok = [CAB(r), 'revisão: idioma=pt · correta=sim · motivo: x'].join('\n');
    expect(() => lerRotulos(`${ok}\n${ok}`)).toThrow(/duplicado/);
    expect(() => lerRotulos([CAB(r), 'revisão: idioma=pt · correta=c11 · motivo: x'].join('\n'))).toThrow(/traducao/);
  });
});

describe('rotular', () => {
  it('a concordante não marcada vale pelo classificador; a marcada exige rótulo', () => {
    const solta = resp({ caso: 'C01', rodada: 0 });
    expect(rotular([solta], new Map())[0]?.fonte).toBe('classificador');
    const marcada = resp({ caso: 'C01', rodada: 1, revisar: true });
    expect(() => rotular([marcada], new Map())).toThrow(/revisão incompleta/);
  });

  it('LANÇA na divergente sem marca (o instrumento nunca marca menos do que devia)', () => {
    expect(() => rotular([resp({ caso: 'C01', rodada: 0, veredito: 'es' })], new Map())).toThrow(/divergente/);
  });
});

describe('leituras', () => {
  it('o c11 e o formulário mudam o veredito, o certo e o errado não', () => {
    expect(acertou('sim', { c11: false, formulario: false })).toBe(true);
    expect(acertou('nao', { c11: true, formulario: true })).toBe(false);
    expect(acertou('c11', { c11: true, formulario: false })).toBe(true);
    expect(acertou('c11', { c11: false, formulario: true })).toBe(false);
    expect(acertou('formulario', { c11: false, formulario: true })).toBe(true);
    expect(acertou('formulario', { c11: true, formulario: false })).toBe(false);
  });

  it('o veredito do limiar vira com o c11 e reprova com UM espanhol, mesmo a 100%', () => {
    const rs: Resposta[] = Array.from({ length: 20 }, (_, i) => resp({ caso: 'C11', rodada: i, revisar: i < 2 }));
    const rot: Record<string, Rotulo> = {};
    for (const r of rs.slice(0, 2)) rot[chaveDe(r)] = { idioma: 'pt', correta: 'c11', traducao: 'presente', motivo: '' };
    const juntas = rotular(rs, new Map(Object.entries(rot)));
    expect(veredictoRevisado(juntas, 'm/a', { c11: true, formulario: true })).toMatchObject({ acerto: 20, n: 20, aprovado: true });
    expect(veredictoRevisado(juntas, 'm/a', { c11: false, formulario: true })).toMatchObject({ acerto: 18, n: 20, aprovado: false });
    const comEspanhol = juntas.map((x, i) => (i === 5 ? { ...x, rotulo: { ...x.rotulo, idioma: 'es' } } : x));
    expect(veredictoRevisado(comEspanhol, 'm/a', { c11: true, formulario: true })).toMatchObject({ espanholQuandoPt: 1, aprovado: false });
  });

  it('só o braço tratado e só o que está no limiar entram', () => {
    const base = resp({ caso: 'C01', rodada: 0, braco: 'baseline', veredito: 'pt' });
    const fora = resp({ caso: 'C05', rodada: 0, noLimiar: false });
    const v = veredictoRevisado(rotular([base, fora], new Map()), 'm/a', { c11: true, formulario: true });
    expect(v.n).toBe(0);
    expect(v.aprovado).toBe(false);
  });
});

describe('wilson', () => {
  it('bate com valores conhecidos', () => {
    const [lo0, hi0] = wilson(0, 74);
    expect(lo0).toBe(0);
    expect(hi0).toBeGreaterThan(0.048);
    expect(hi0).toBeLessThan(0.05);
    const [lo, hi] = wilson(93, 95);
    expect(lo).toBeCloseTo(0.926, 2);
    expect(hi).toBeCloseTo(0.994, 2);
    expect(wilson(0, 0)).toEqual([0, 0]);
  });
});

describe('erroDoClassificador e relatório', () => {
  it('conta o falso positivo, o falso negativo e o indeterminado resolvido', () => {
    const fp = resp({ caso: 'C01', rodada: 0, revisar: true, veredito: 'pt' });
    const fn = resp({ caso: 'C06', rodada: 0, revisar: true, esperado: 'en', veredito: 'indeterminado' });
    const cx = resp({ caso: 'C12', rodada: 0, revisar: true, esperado: 'en', veredito: 'indeterminado' });
    const rotulos = new Map<string, Rotulo>([
      [chaveDe(fp), { idioma: 'es', correta: 'nao', traducao: null, motivo: '' }],
      [chaveDe(fn), { idioma: 'en', correta: 'sim', traducao: null, motivo: '' }],
      [chaveDe(cx), { idioma: 'misto', correta: 'formulario', traducao: null, motivo: '' }],
    ]);
    const rot = rotular([fp, fn, cx], rotulos);
    expect(erroDoClassificador(rot)).toMatchObject({
      lidas: 3,
      falsosPositivos: 1,
      falsosNegativos: 1,
      definitivasLidas: 1,
      definitivasContrariadas: 1,
      indeterminados: { sim: 1, nao: 0, formulario: 1, c11: 0 },
    });
    const md = relatorioRevisado(rot, new Map());
    expect(md).toContain('| m/a | sim | sim |');
    expect(md).toContain('| m/a | não | não |');
  });
});
