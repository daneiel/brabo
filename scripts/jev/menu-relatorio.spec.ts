import { describe, expect, it } from 'vitest';
import type { Universo } from './analise.ts';
import { TODAS_AS_CAMADAS } from './equivalencia.ts';
import type { Linha } from './medicao2.ts';
import { conjuntos, relatorio, veredito } from './menu-relatorio.ts';
import { medir, POLITICAS } from './menu.ts';
import type { Catalogo } from './passos.ts';

const universo = (ids: Record<string, 'tuning' | 'validacao'>): Universo =>
  ({ elegiveis: Object.keys(ids).map((id) => ({ id })), metade: new Map(Object.entries(ids)) }) as unknown as Universo;

const linha = (id: string, o: Partial<Linha> = {}): Linha => ({
  id,
  ator: 'dev-x',
  metade: 'validacao',
  novo: false,
  chamadas: [{ ferramenta: 'write_file', classe: null }],
  status: 'ok',
  escolha: 'write_file',
  confianca: 0.5,
  probabilidades: { write_file: 0.6, read_file: 0.3, responder_sem_ferramenta: 0.1 },
  suspeitas: [],
  tokensDeEntrada: 1,
  latenciaMs: 1,
  custoUsd: 0,
  anterior: 'read_file',
  ...o,
});

const catalogo: Catalogo = { agentes: { 'dev-*': ['read_file', 'write_file', 'terminal'] }, ferramentas: {}, identidades: {}, definicoes: { read_file: 100, write_file: 100, terminal: 100 } };

describe('conjuntos', () => {
  it('a divisão é a da fotografia BASE; o que ela não conhecia é "novo" e nunca entra em tuning nem em validação', () => {
    const base = universo({ a: 'tuning', b: 'validacao' });
    // O snapshot atual sortearia `a` para a validação: a divisão usada continua a da base.
    const atual = universo({ a: 'validacao', b: 'validacao', c: 'tuning' });
    const cj = conjuntos(atual, base, [linha('a'), linha('b'), linha('c')]);
    expect(cj.tuning.map((l) => l.id)).toEqual(['a']);
    expect(cj.validacao.map((l) => l.id)).toEqual(['b']);
    expect(cj.novos.map((l) => l.id)).toEqual(['c']);
  });
});

describe('veredito', () => {
  it('só "sim" com o LIMITE INFERIOR do IC em 90%; restringir a metade dos passos é condição à parte', () => {
    const boas = Array.from({ length: 300 }, (_, i) => linha(`ok${i}`));
    const rs = POLITICAS.map((p) => medir(p, boas, catalogo, TODAS_AS_CAMADAS));
    const v = veredito(rs);
    expect(v.map((x) => x.politica)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(v.every((x) => x.sim && x.restringe)).toBe(true);
    const ruins = [...boas.slice(0, 250), ...Array.from({ length: 50 }, (_, i) => linha(`x${i}`, { chamadas: [{ ferramenta: 'terminal', classe: 'execucao' }] }))];
    expect(veredito(POLITICAS.map((p) => medir(p, ruins, catalogo, TODAS_AS_CAMADAS))).find((x) => x.politica === 'P2')!.sim).toBe(false);
  });
});

describe('relatorio', () => {
  it('sai com as três seções de conjunto e a régua estrita, sem lançar quando um conjunto está vazio', () => {
    const texto = relatorio({ validacao: [linha('v')], tuning: [], novos: [] }, catalogo);
    expect(texto).toContain('## Validação');
    expect(texto).toContain('## Passos novos');
    expect(texto).toContain('régua ESTRITA');
  });
});
