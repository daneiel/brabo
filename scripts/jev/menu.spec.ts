import { describe, expect, it } from 'vitest';
import { classificarChamada, TODAS_AS_CAMADAS } from './equivalencia.ts';
import { ESTRITA, type Linha } from './medicao2.ts';
import { bytesDoMenu, chegaA90, menuDe, medir, POLITICAS, tabelaDePoliticas } from './menu.ts';
import type { Catalogo } from './passos.ts';

const CAT = ['read_file', 'search_workspace', 'write_file', 'terminal', 'rag_search', 'rag_feedback', 'report_done', 'report_blocked'];
const catalogo: Catalogo = {
  agentes: { 'dev-*': CAT },
  ferramentas: {},
  identidades: {},
  definicoes: Object.fromEntries(CAT.map((t) => [t, 400])),
};

function linha(o: Partial<Linha> & { rotulo?: string; cmd?: string }): Linha {
  const { rotulo, cmd, ...resto } = o;
  return {
    id: 'p',
    ator: 'dev-x',
    metade: 'validacao',
    novo: false,
    chamadas: rotulo ? [classificarChamada(rotulo, cmd ? { command: cmd } : {})] : [],
    status: 'ok',
    escolha: 'write_file',
    confianca: 0.6,
    probabilidades: { write_file: 0.5, terminal: 0.3, read_file: 0.1, responder_sem_ferramenta: 0.1 },
    suspeitas: [],
    tokensDeEntrada: 1000,
    latenciaMs: 300,
    custoUsd: 0,
    anterior: 'read_file',
    ...resto,
  };
}

describe('menuDe — as políticas escritas antes de rodar', () => {
  const l = linha({ rotulo: 'terminal' });
  it('P0 é o catálogo inteiro', () => expect(menuDe('P0', l, CAT)).toEqual(CAT));
  it('P1 é o top-2 por probabilidade, sem a opção reservada', () => {
    expect(menuDe('P1', l, CAT)).toEqual(['write_file', 'terminal']);
    const r = linha({ probabilidades: { responder_sem_ferramenta: 0.6, read_file: 0.3, terminal: 0.1 }, escolha: 'responder_sem_ferramenta' });
    expect(menuDe('P1', r, CAT)).toEqual(['read_file', 'terminal']);
  });
  it('P2 é {escolha, anterior}; sem duplicar quando são a mesma', () => {
    expect(menuDe('P2', l, CAT)).toEqual(['write_file', 'read_file']);
    expect(menuDe('P2', linha({ anterior: 'write_file' }), CAT)).toEqual(['write_file']);
  });
  it('P2 com responder_sem_ferramenta fica só com a anterior; P3 abre o catálogo inteiro (AT-236)', () => {
    const r = linha({ escolha: 'responder_sem_ferramenta' });
    expect(menuDe('P2', r, CAT)).toEqual(['read_file']);
    expect(menuDe('P3', r, CAT)).toEqual(CAT);
  });
  it('P3 sem ferramenta anterior também abre o catálogo inteiro', () => {
    expect(menuDe('P3', linha({ anterior: null }), CAT)).toEqual(CAT);
    expect(menuDe('P2', linha({ anterior: null }), CAT)).toEqual(['write_file']);
    expect(menuDe('P3', l, CAT)).toEqual(['write_file', 'read_file']);
  });
  it('P4 é {escolha, anterior, 2ª do Jev}, até 3', () => {
    expect(menuDe('P4', l, CAT)).toEqual(['write_file', 'read_file', 'terminal']);
  });
  it('resposta do Jev que falhou = catálogo inteiro, em todas as políticas', () => {
    for (const p of POLITICAS) expect(menuDe(p, linha({ status: 'timeout', escolha: null }), CAT)).toEqual(CAT);
  });
  it('anterior fora do catálogo é ignorada; menu que sairia vazio vira o catálogo inteiro', () => {
    expect(menuDe('P2', linha({ anterior: 'outra' }), CAT)).toEqual(['write_file']);
    expect(menuDe('P3', linha({ anterior: 'outra' }), CAT)).toEqual(CAT);
    const vazio = linha({ probabilidades: { responder_sem_ferramenta: 1 }, escolha: 'responder_sem_ferramenta', anterior: null });
    expect(menuDe('P1', vazio, CAT)).toEqual(CAT);
    expect(menuDe('P2', vazio, CAT)).toEqual(CAT);
  });
});

describe('medir', () => {
  const ls = [
    linha({ id: 'a', rotulo: 'write_file' }), // escolha certa; menu de P2 {write_file, read_file}: disputado, só o Jev acerta
    linha({ id: 'b', rotulo: 'read_file', escolha: 'terminal' }), // a anterior é a certa: disputado, só a anterior
    linha({ id: 'c', rotulo: 'report_done' }), // fora do menu de P2
    linha({ id: 'd', rotulo: 'terminal', cmd: 'ls -la', escolha: 'read_file', anterior: 'read_file' }), // E1; menu de 1
    linha({ id: 'e' }), // sem ferramenta
  ];
  const p2 = medir('P2', ls, catalogo, TODAS_AS_CAMADAS);
  it('cobertura, restrição e disputados', () => {
    expect(p2.n).toBe(4);
    expect(p2.cobertura.acertos).toBe(3);
    expect(p2.coberturaEstrita.acertos).toBe(2);
    expect(p2.restricao.acertos).toBe(4);
    expect(p2.coberturaNosRestringidos.acertos).toBe(3);
    expect(p2.disputadosSoJev).toBe(1);
    expect(p2.disputadosSoAnterior).toBe(1);
    expect(p2.garantido.acertos).toBe(1);
    expect(p2.falhas[0]!.rotulo).toBe('report_done');
    expect(p2.semFerramenta).toBe(1);
  });
  it('a âncora P0 cobre tudo e não restringe nada', () => {
    const p0 = medir('P0', ls, catalogo, ESTRITA);
    expect(p0.cobertura.acertos).toBe(4);
    expect(p0.restricao.acertos).toBe(0);
    expect(p0.ferramentasDepois).toBe(8);
    expect(p0.tokensAntes).toBe(p0.tokensDepois);
  });
  it('conta ferramentas expostas e tokens de definição (bytes/4)', () => {
    expect(p2.ferramentasAntes).toBe(8);
    expect(p2.ferramentasDepois).toBe((2 + 2 + 2 + 1) / 4);
    expect(p2.tokensAntes).toBe((8 * 400) / 4);
    expect(bytesDoMenu(['read_file', 'terminal'], catalogo)).toBe(800);
  });
  it('a linha do "sim": só o LIMITE INFERIOR em 90% conta', () => {
    expect(chegaA90({ n: 160, acertos: 150, ic: [0.9, 0.96] })).toBe(true);
    expect(chegaA90({ n: 160, acertos: 152, ic: [0.86, 0.97] })).toBe(false);
  });
  it('a tabela tem uma linha por política', () => {
    const t = tabelaDePoliticas(POLITICAS.map((p) => medir(p, ls, catalogo, TODAS_AS_CAMADAS)));
    expect(t.split('\n')).toHaveLength(2 + POLITICAS.length);
  });
});
