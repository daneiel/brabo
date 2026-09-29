import { describe, expect, it } from 'vitest';
import { chaveDoGrupo, dividir } from './divisao.ts';
import type { Evento, Passo } from './passos.ts';

const passo = (sessao: string, ator: string, i: number, em: string): Passo => ({
  id: `${sessao}:${ator}:${i}`,
  sessao,
  projetoId: 'p',
  ator,
  em,
  chamadas: [],
  texto: null,
  rotulos: [],
  suspeitas: [],
});
const trabalho = (sessao: string, ator: string, em: string): Evento => ({ sessao, seq: 1, tipo: 'dev.working', atorTipo: 'agent', ator, em, projetoId: 'p', payload: {} });

function cenario() {
  const passos: Passo[] = [];
  const eventos: Evento[] = [];
  // 6 tarefas de dev, 10 passos cada, na mesma sessão, cada uma aberta por um dev.working
  for (let k = 0; k < 6; k++) {
    const ator = `dev-m${k}`;
    eventos.push(trabalho('s1', ator, `2026-09-29T06:0${k}:00.000000Z`));
    for (let i = 0; i < 10; i++) passos.push(passo('s1', ator, i, `2026-09-29T06:0${k}:${String(10 + i)}.000000Z`));
  }
  return { passos, eventos };
}

describe('dividir', () => {
  it('é por execução, nunca por passo: os passos de uma tarefa ficam todos na mesma metade', () => {
    const { passos, eventos } = cenario();
    const { metade } = dividir(eventos, passos);
    for (let k = 0; k < 6; k++) {
      const doGrupo = passos.filter((p) => p.ator === `dev-m${k}`).map((p) => metade.get(p.id));
      expect(new Set(doGrupo).size).toBe(1);
    }
  });

  it('é determinística e as duas metades saem com tamanho parecido (o desempate é o tamanho, não um resultado)', () => {
    const { passos, eventos } = cenario();
    const a = dividir(eventos, passos).metade;
    const b = dividir(eventos, [...passos].reverse()).metade;
    for (const p of passos) expect(b.get(p.id)).toBe(a.get(p.id));
    const tuning = passos.filter((p) => a.get(p.id) === 'tuning').length;
    expect(Math.abs(tuning - (passos.length - tuning))).toBeLessThanOrEqual(10);
    expect(tuning).toBeGreaterThan(0);
    expect(tuning).toBeLessThan(passos.length);
  });

  it('o grupo é (sessão, ator, início da execução): outra tarefa do mesmo agente é outro grupo', () => {
    const eventos = [trabalho('s1', 'dev-a', '2026-09-29T06:00:00.000000Z'), trabalho('s1', 'dev-a', '2026-09-29T07:00:00.000000Z')];
    const p1 = passo('s1', 'dev-a', 0, '2026-09-29T06:10:00.000000Z');
    const p2 = passo('s1', 'dev-a', 1, '2026-09-29T07:10:00.000000Z');
    expect(chaveDoGrupo(eventos, [p1, p2], p1)).not.toBe(chaveDoGrupo(eventos, [p1, p2], p2));
  });

  it('a lista de fim da DIVISÃO não inclui as ferramentas da Anamnese: ela só entrou depois dos primeiros pedidos', async () => {
    const { FERRAMENTAS_DE_FIM, FERRAMENTAS_DE_FIM_DA_DIVISAO } = await import('./variantes.ts');
    expect(FERRAMENTAS_DE_FIM_DA_DIVISAO.has('skip_proficiency')).toBe(false);
    expect(FERRAMENTAS_DE_FIM.has('skip_proficiency')).toBe(true);
    for (const f of FERRAMENTAS_DE_FIM_DA_DIVISAO) expect(FERRAMENTAS_DE_FIM.has(f)).toBe(true);
  });
});
