import { describe, expect, it } from 'vitest';
import { acertou, curva, limiarSugerido, percentil, porAgente, relatorio, resumo, wilson, type Registro } from './medicao.ts';
import { RESPONDER_SEM_FERRAMENTA } from './passos.ts';
import { dentroDoRepositorio, lerChave, lerOpcoes } from './replay.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function reg(p: Partial<Registro>): Registro {
  return {
    id: 'x',
    ator: 'po',
    rotulos: ['a'],
    chamadas: ['a'],
    suspeitas: [],
    anterior: null,
    opcoes: 3,
    status: 'ok',
    escolha: 'a',
    confianca: 0.9,
    latenciaMs: 300,
    custoUsd: 0.00001,
    tokensDeEntrada: 300,
    ...p,
  };
}

describe('acertou', () => {
  it('passo heterogêneo acerta com qualquer ferramenta do conjunto; passo sem ferramenta só com a reservada', () => {
    expect(acertou(reg({ rotulos: ['a', 'b'], escolha: 'b' }))).toBe(true);
    expect(acertou(reg({ rotulos: [], escolha: RESPONDER_SEM_FERRAMENTA }))).toBe(true);
    expect(acertou(reg({ rotulos: [], escolha: 'a' }))).toBe(false);
    expect(acertou(reg({ escolha: null, status: 'timeout' }))).toBe(false);
  });
});

describe('wilson', () => {
  it('bate com o valor de referência (7/7 → ~65%–100%; 0/0 não afirma nada)', () => {
    const [lo, hi] = wilson(7, 7);
    expect(lo).toBeCloseTo(0.646, 2);
    expect(hi).toBe(1);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});

describe('curva', () => {
  it('responder_sem_ferramenta NÃO restringe (resposta 12 da AT-236): cai para o catálogo inteiro', () => {
    const rs = [
      reg({ escolha: 'a', confianca: 0.9 }),
      reg({ escolha: RESPONDER_SEM_FERRAMENTA, confianca: 0.99 }),
      reg({ escolha: 'b', confianca: 0.5 }),
    ];
    const [zero, alto] = curva(rs, [0, 0.8]);
    expect(zero).toMatchObject({ total: 3, restritos: 2, errados: 1 });
    expect(alto).toMatchObject({ restritos: 1, errados: 0 });
  });

  it('o limiar sugerido exige o LIMITE INFERIOR do IC, não a estimativa pontual', () => {
    const poucos = [reg({ confianca: 0.9 }), reg({ confianca: 0.9 })];
    expect(limiarSugerido(curva(poucos, [0.5]), 0.9)).toBeNull();
    const muitos = Array.from({ length: 60 }, () => reg({ confianca: 0.9 }));
    expect(limiarSugerido(curva(muitos, [0.5]), 0.9)?.limiar).toBe(0.5);
  });
});

describe('porAgente e resumo', () => {
  it('a linha de base "repetir anterior" só conta passo com anterior', () => {
    const [l] = porAgente([reg({ anterior: 'a' }), reg({ anterior: 'b' }), reg({ anterior: null })]);
    expect(l!.repetirAnterior).toMatchObject({ n: 2, acertos: 1 });
  });

  it('latência acima do teto conta o timeout; percentil é o do rank', () => {
    const r = resumo([reg({ latenciaMs: 100 }), reg({ latenciaMs: 2500 }), reg({ status: 'timeout', escolha: null, latenciaMs: 10_000, custoUsd: null })]);
    expect(r.latencia.acimaDoTeto).toBe(2);
    expect(r.custo.semCusto).toBe(1);
    expect(percentil([1, 2, 3, 4], 50)).toBe(2);
  });

  it('o relatório não carrega texto de sessão, só contagens e ids de agente', () => {
    const txt = relatorio([reg({ id: 'sessao-secreta:po:0' })]);
    expect(txt).not.toContain('sessao-secreta');
    expect(txt).toContain('| po |');
  });
});

describe('opções do replay', () => {
  it('recusa --saida dentro do repositório e exige uma fonte do banco', () => {
    expect(() => lerOpcoes(['--container', 'c', '--saida', 'scripts/jev/x.jsonl'])).toThrow(/dentro do repositório/);
    expect(() => lerOpcoes([])).toThrow(/diga de onde ler/);
    expect(lerOpcoes(['--so-relatorio']).soRelatorio).toBe(true);
    expect(dentroDoRepositorio('/tmp/x')).toBe(false);
  });

  it('lê a chave de um arquivo KEY=valor sem depender do ambiente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-'));
    const arq = join(dir, 'k.env');
    writeFileSync(arq, 'OUTRA=1\nOPENROUTER_TEST_KEY="sk-teste"\n');
    expect(lerChave({ ...lerOpcoes(['--so-relatorio']), arquivoDeChave: arq }, {})).toBe('sk-teste');
    expect(() => lerChave(lerOpcoes(['--so-relatorio']), {})).toThrow(/ausente/);
  });
});
