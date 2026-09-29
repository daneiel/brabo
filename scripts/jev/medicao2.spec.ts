import { describe, expect, it } from 'vitest';
import { TODAS_AS_CAMADAS, classificarChamada } from './equivalencia.ts';
import {
  acerto1,
  acertoAnterior,
  acertoK,
  acertoUniao,
  cascata,
  curvaPorLimiar,
  pares,
  porAgente,
  ranking,
  taxaDe,
  type Linha,
} from './medicao2.ts';

const chamada = (f: string, command?: string) => classificarChamada(f, command ? { command } : {});
function linha(p: Partial<Linha> & { chamadas: Linha['chamadas']; escolha: string | null }): Linha {
  return {
    id: 'x',
    ator: 'dev-a',
    metade: 'validacao',
    novo: false,
    status: 'ok',
    confianca: 0.5,
    probabilidades: null,
    suspeitas: [],
    tokensDeEntrada: 100,
    latenciaMs: 300,
    custoUsd: 0.0001,
    anterior: null,
    ...p,
  };
}

describe('top-1, top-k e a régua', () => {
  const probs = { write_file: 0.2, terminal: 0.5, read_file: 0.25, responder_sem_ferramenta: 0.05 };
  const l = linha({ chamadas: [chamada('read_file')], escolha: 'terminal', probabilidades: probs });

  it('ranking ignora a opção reservada e ordena por probabilidade', () => {
    expect(ranking(l)).toEqual(['terminal', 'read_file', 'write_file']);
  });

  it('top-1 erra e top-2 acerta quando a ferramenta certa é a segunda', () => {
    expect(acerto1([])(l)).toBe(false);
    expect(acertoK(2, [])(l)).toBe(true);
    expect(acertoK(1, [])(l)).toBe(false);
  });

  it('sem probabilidades o ranking é só a escolha', () => {
    expect(ranking(linha({ chamadas: [], escolha: 'terminal' }))).toEqual(['terminal']);
  });

  it('passo sem ferramenta: top-k é o mesmo que top-1 (responder_sem_ferramenta)', () => {
    const s = linha({ chamadas: [], escolha: 'responder_sem_ferramenta', probabilidades: probs });
    expect(acertoK(2, [])(s)).toBe(true);
    expect(acertoK(2, [])(linha({ chamadas: [], escolha: 'terminal', probabilidades: probs }))).toBe(false);
  });

  it('a equivalência conta o terminal de leitura que o Jev mandou ler pela ferramenta', () => {
    const t = linha({ chamadas: [chamada('terminal', 'ls -la')], escolha: 'search_workspace' });
    expect(acerto1([])(t)).toBe(false);
    expect(acerto1(TODAS_AS_CAMADAS)(t)).toBe(true);
  });
});

describe('linha de base e união', () => {
  it('"repetir a anterior" acerta quando o passo repete a ferramenta; a união soma as duas apostas', () => {
    const l = linha({ chamadas: [chamada('write_file')], escolha: 'terminal', anterior: 'write_file' });
    expect(acertoAnterior([])(l)).toBe(true);
    expect(acertoUniao([])(l)).toBe(true);
    const outro = linha({ chamadas: [chamada('report_done')], escolha: 'terminal', anterior: 'write_file' });
    expect(acertoUniao([])(outro)).toBe(false);
  });

  it('sem anterior a linha de base não acerta', () => {
    expect(acertoAnterior([])(linha({ chamadas: [chamada('read_file')], escolha: 'read_file' }))).toBe(false);
  });
});

describe('curva, agentes, pares e cascata', () => {
  const ls = [
    linha({ chamadas: [chamada('read_file')], escolha: 'read_file', confianca: 0.9 }),
    linha({ chamadas: [chamada('write_file')], escolha: 'terminal', confianca: 0.9 }),
    linha({ chamadas: [chamada('write_file')], escolha: 'write_file', confianca: 0.2, ator: 'dev-b' }),
    linha({ chamadas: [chamada('write_file')], escolha: 'responder_sem_ferramenta', confianca: 0.99 }),
  ];

  it('a curva restringe só com ferramenta escolhida e confiança ≥ limiar; responder_sem_ferramenta nunca restringe', () => {
    const c = curvaPorLimiar(ls, [], [0, 0.5]);
    expect(c[0]).toMatchObject({ limiar: 0, restritos: 3 });
    expect(c[0]!.acerto).toMatchObject({ n: 3, acertos: 2 });
    expect(c[1]).toMatchObject({ limiar: 0.5, restritos: 2 });
    expect(c[1]!.acerto.acertos).toBe(1);
  });

  it('por agente e por par', () => {
    expect(porAgente(ls).map((a) => [a.ator, a.n])).toEqual([['dev-a', 3], ['dev-b', 1]]);
    expect(pares(ls, []).map((p) => p.par).sort()).toEqual(['write_file → responder_sem_ferramenta', 'write_file → terminal']);
  });

  it('a cascata imprime n e intervalo por degrau', () => {
    const tabela = cascata([{ nome: 'degrau', linhas: ls, camadas: [] }]);
    expect(tabela).toContain('| degrau | 4 | 2/4 = 50%');
  });

  it('respostas que não vieram ficam fora da conta', () => {
    const c = cascata([{ nome: 'd', linhas: [...ls, linha({ chamadas: [chamada('read_file')], escolha: null, status: 'timeout' })], camadas: [] }]);
    expect(c).toContain('| d | 4 |');
    expect(taxaDe(ls, acerto1([])).n).toBe(4);
  });
});
