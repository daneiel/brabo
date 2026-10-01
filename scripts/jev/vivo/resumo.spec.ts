import { describe, expect, it } from 'vitest';
import type { Passo } from './laco.ts';
import { comparar, estimar, falhaDeInfra, gastoDe, linhas, tabela, type RegistroDeExecucao } from './resumo.ts';

const passo = (p: Partial<Passo> = {}): Passo => ({
  iteracao: 0,
  latenciaMs: 1000,
  latenciaDoChatMs: 900,
  custoDoChatUsd: 0.001,
  chamadasDeChat: 1,
  promptTokens: 100,
  completionTokens: 10,
  cachedTokens: 0,
  ferramentas: ['terminal'],
  recuperado: false,
  erro: null,
  roteamento: null,
  ...p,
});

const roteado = (aplicado: boolean, motivo: 'timeout' | null = null) => ({
  aplicado,
  menuDepois: [],
  escolha: motivo ? null : 'terminal',
  confianca: motivo ? null : 0.9,
  anterior: null,
  motivoDaQueda: motivo,
  origemDaQueda: motivo ? ('infra' as const) : null,
  latenciaMs: 300,
  custoUsd: 0.0001,
  foraDoCardapio: [],
  repetidoComCatalogoInteiro: false,
});

function exec(modelo: string, braco: 'ligado' | 'desligado', ok: boolean, passos: Passo[], latenciaMs = 10_000): RegistroDeExecucao {
  return { data: 'd', sha: 's', modelo, tarefa: 'T1-media', rodada: 0, braco, fim: 'report_done', passos, latenciaMs, mensagens: 0, verificacao: { ok, motivo: '' } };
}

describe('linhas', () => {
  it('agrega por modelo e braço: sucesso, passos recuperados, custo do Jev à parte, quedas por motivo', () => {
    const rs = [
      exec('m', 'ligado', true, [passo({ roteamento: roteado(false) }), passo({ roteamento: roteado(true), recuperado: true })]),
      exec('m', 'ligado', false, [passo({ roteamento: roteado(false, 'timeout') })]),
      exec('m', 'desligado', true, [passo(), passo(), passo()]),
      { ...exec('m', 'desligado', false, [passo()]), fim: 'teto_de_gasto' as const },
    ];
    const l = linhas(rs).find((x) => x.braco === 'ligado')!;
    const d = linhas(rs).find((x) => x.braco === 'desligado')!;
    expect(l).toMatchObject({ execucoes: 2, sucesso: 1, passosRecuperados: 1, passosTotais: 3, consultados: 3, aplicados: 1, semRestricao: 1, quedas: 1, motivosDaQueda: { timeout: 1 } });
    expect(l.custoMedioDoJevUsd).toBeCloseTo(0.00015);
    // A interrompida pelo teto fica fora da tabela, mas o gasto dela conta.
    expect(d).toMatchObject({ execucoes: 1, sucesso: 1, passosMediana: 3 });
    expect(gastoDe(rs)).toBeCloseTo(0.0073);
    expect(tabela(linhas(rs))).toContain('| `m` | ligado | 2 | 1/2 = 50%');
  });
});

describe('comparar (a regra de decisão)', () => {
  const lote = (modelo: string, braco: 'ligado' | 'desligado', sucessos: number, custoPorPasso: number, latencia: number) =>
    Array.from({ length: 10 }, (_, i) => exec(modelo, braco, i < sucessos, [passo({ custoDoChatUsd: custoPorPasso })], latencia));

  it('manter ligado: qualidade dentro da margem, mais barato e latência ≤ 1,2× em todos os modelos', () => {
    const rs = [...lote('a', 'ligado', 9, 0.8, 11_000), ...lote('a', 'desligado', 9, 1, 10_000)];
    expect(comparar(linhas(rs)).veredito).toBe('manter_ligado');
  });

  it('restringir: passa num modelo e não no outro; desligar: qualidade cai além da margem em todos', () => {
    const misto = [...lote('a', 'ligado', 9, 0.8, 10_000), ...lote('a', 'desligado', 9, 1, 10_000), ...lote('b', 'ligado', 9, 0.8, 20_000), ...lote('b', 'desligado', 9, 1, 10_000)];
    expect(comparar(linhas(misto))).toMatchObject({ veredito: 'restringir', passaram: ['a'] });
    const pior = [...lote('a', 'ligado', 5, 0.8, 10_000), ...lote('a', 'desligado', 9, 1, 10_000)];
    expect(comparar(linhas(pior)).veredito).toBe('desligar');
  });

  it('menos de 10 execuções por braço nunca vira veredito', () => {
    const rs = [exec('a', 'ligado', true, [passo()]), exec('a', 'desligado', true, [passo()])];
    expect(comparar(linhas(rs)).veredito).toBe('amostra_insuficiente');
    expect(comparar([]).veredito).toBe('amostra_insuficiente');
  });
});

describe('estimar', () => {
  it('soma o contexto crescente, a saída e o Jev só no braço ligado', () => {
    const e = estimar({ base: 1000, crescimento: 0, saida: 0, passos: 2, preco: { entrada: 1, saida: 5 }, execucoesPorBraco: 1 });
    // desligado: 2 × 1000 × 1/1e6 = 0,002; ligado: + 2 × 0,0000727
    expect(e.totalUsd).toBeCloseTo(0.002 + 0.002 + 2 * 0.0000727, 8);
    expect(e.chamadas).toBe(6);
  });
});

describe('falhaDeInfra (a execução que não mediu nada não é gravada)', () => {
  it('chave sem limite, proxy que recusa e transporte caído são da conta/rede, em qualquer passo', () => {
    expect(falhaDeInfra({ passos: [passo({ erro: 'HTTP 403: corpo não é JSON' })] })).toBe('passo 0: HTTP 403: corpo não é JSON');
    expect(falhaDeInfra({ passos: [passo(), passo({ iteracao: 4, erro: 'HTTP 402: sem crédito' })] })).toBe('passo 4: HTTP 402: sem crédito');
    expect(falhaDeInfra({ passos: [passo({ erro: 'transporte: TimeoutError' })] })).toMatch(/transporte/);
    expect(falhaDeInfra({ passos: [passo({ erro: 'HTTP 429: rate limit' })] })).not.toBeNull();
  });

  it('erro do PROVIDER (corpo 200 com `error`) e 5xx seguem sendo desfecho do braço', () => {
    expect(falhaDeInfra({ passos: [passo({ erro: 'Provider returned error' })] })).toBeNull();
    expect(falhaDeInfra({ passos: [passo({ erro: 'HTTP 502: upstream' })] })).toBeNull();
    expect(falhaDeInfra({ passos: [passo()] })).toBeNull();
    // A queda do JEV (403 no roteador) é caminho do produto, não da conta do chat.
    expect(falhaDeInfra({ passos: [passo({ roteamento: { ...roteado(false), motivoDaQueda: 'erro_http' } as never })] })).toBeNull();
  });
});
