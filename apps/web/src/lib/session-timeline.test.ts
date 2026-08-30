import { describe, expect, it } from 'vitest';
import {
  aberturasDeTurno,
  afundarDesfechos,
  ordemDaAcaoNaTimeline,
  pontoDaSessao,
  turnoDoSeq,
  type TimelineEntry,
} from './session-timeline';
import type { ProposedAction, SessionEvent, SessionStatus } from './api-types';

/**
 * O ponto da barra de topo era `background: var(--success)` fixo, e só o PULSO
 * dependia do estado: uma sessão encerrada exibia exatamente o mesmo sinal de
 * "ao vivo" de uma em curso — o verde é justamente o que se olha primeiro.
 *
 * O teste varre a máquina de estados inteira em vez de checar dois casos: é o
 * que faz um estado novo (`closing` foi o último a entrar) precisar de uma
 * decisão explícita aqui, em vez de herdar calado a aparência de ativa.
 */
const ESTADOS: SessionStatus[] = [
  'created',
  'active',
  'closing',
  'closed',
  'closed_abnormally',
];

describe('ponto de estado da sessão', () => {
  it('só a sessão ATIVA pulsa em verde', () => {
    expect(pontoDaSessao('active').classe).toBe('pulsing');
    for (const estado of ESTADOS.filter((e) => e !== 'active')) {
      expect(pontoDaSessao(estado).classe, estado).not.toBe('pulsing');
    }
  });

  it('término anormal se distingue de término normal', () => {
    expect(pontoDaSessao('closed_abnormally').classe).toBe('statusDotFalha');
    expect(pontoDaSessao('closed').classe).toBe('statusDotParado');
  });

  it('todo estado da máquina tem aparência e rótulo próprios', () => {
    const rotulos = ESTADOS.map((e) => pontoDaSessao(e).rotuloKey);
    expect(new Set(rotulos).size).toBe(ESTADOS.length);
    for (const rotulo of rotulos) expect(rotulo).not.toBe('');
  });

  /** Sem sessão carregada não é "encerrada" — é desconhecido, e o ponto apaga. */
  it('sessão que ainda não chegou não finge estado nenhum', () => {
    expect(pontoDaSessao(undefined).classe).toBe('statusDotParado');
    expect(pontoDaSessao(undefined).rotuloKey).toBe('status.loading');
  });
});

function evento(seq: number, kind: 'user' | 'agent' | 'system', id = 'x'): SessionEvent {
  return {
    id: `ev-${seq}`,
    sessionId: 's-1',
    seq,
    type: 'agent.response',
    actor: { kind, id },
    payload: {},
    // Um segundo por `seq`: `ordemDaAcaoNaTimeline` ancora por `createdAt`
    // quando não há vínculo, e precisa de tempos distintos pra isso ter algo
    // pra ancorar em.
    createdAt: `2026-08-10T12:00:0${seq}.000Z`,
  };
}

describe('aberturasDeTurno', () => {
  it('só o ator USUÁRIO abre turno — agente e system nunca abrem', () => {
    expect(
      aberturasDeTurno([
        evento(1, 'user'),
        evento(2, 'agent'),
        evento(3, 'system'),
        evento(4, 'user'),
      ]),
    ).toEqual([1, 4]);
  });

  /** O retorno é ordenado por `seq`, mesmo que os eventos não cheguem ordenados. */
  it('devolve as aberturas ordenadas, independente da ordem de entrada', () => {
    expect(aberturasDeTurno([evento(9, 'user'), evento(2, 'user')])).toEqual([2, 9]);
  });
});

describe('turnoDoSeq', () => {
  it('ancora na última abertura que não é posterior ao seq', () => {
    const aberturas = [3, 7];
    expect(turnoDoSeq(aberturas, 5)).toBe(3);
    expect(turnoDoSeq(aberturas, 99)).toBe(7);
  });

  /** `turno === 0` é o PRÓLOGO: antes de qualquer abertura de turno. */
  it('antes da primeira abertura, o turno é 0 (prólogo)', () => {
    expect(turnoDoSeq([3, 7], 1)).toBe(0);
  });
});

// `origem` (RN-177) entra aqui como valor fixo de propósito: `afundarDesfechos`
// não a lê — quem decide o afundamento são `turno`, `autor` e `desfecho`.
function entrada(
  seq: number,
  over: { autor?: string; turno?: number; desfecho?: boolean } = {},
): TimelineEntry {
  return {
    seq,
    node: null,
    autor: 'agent:po',
    turno: 1,
    origem: 'agente',
    ...over,
  };
}

describe('afundarDesfechos', () => {
  it('o desfecho desce até o fim do trecho do mesmo autor no mesmo turno', () => {
    const ordenada = afundarDesfechos([entrada(1), entrada(2, { desfecho: true }), entrada(3)]);
    expect(ordenada.map((e) => e.seq)).toEqual([1, 3, 2]);
  });

  /**
   * A parada é na fronteira de TURNO, mesmo sem entrada visível ali —
   * `agent.activated` abre turno e nunca vira item do fio.
   */
  it('para na fronteira de turno, ainda que ela não tenha entrada visível', () => {
    const ordenada = afundarDesfechos([
      entrada(1, { turno: 1 }),
      entrada(2, { turno: 1, desfecho: true }),
      entrada(3, { turno: 3 }),
    ]);
    expect(ordenada.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

describe('ordemDaAcaoNaTimeline', () => {
  const EVENTOS: SessionEvent[] = [
    evento(1, 'agent'),
    {
      ...evento(2, 'agent'),
      type: 'proposed_action.created',
      payload: { actionId: 'acao-vinculada' },
    },
    evento(3, 'agent'),
  ];

  function acao(over: Partial<ProposedAction> = {}): ProposedAction {
    return {
      id: 'acao-1',
      projectId: 'p-1',
      sessionId: 's-1',
      seq: 1,
      actionType: 'git_commit',
      payload: {},
      status: 'pending',
      resolvedPolicy: 'require_approval',
      actor: { kind: 'agent', id: 'po' },
      decidedBy: null,
      decidedAt: null,
      rejectionReason: null,
      executionResult: null,
      createdAt: '2026-08-10T12:00:01.000Z',
      updatedAt: '2026-08-10T12:00:01.000Z',
      ...over,
    };
  }

  it('com vínculo (proposed_action.created com o MESMO actionId): usa o seq DESSE evento, não action.seq', () => {
    const a = acao({ id: 'acao-vinculada', seq: 999_999 });
    expect(ordemDaAcaoNaTimeline(a, EVENTOS)).toBe(2);
  });

  /**
   * Sem vínculo (rota de bootstrap de Gitflow, que não grava
   * `proposed_action.created`): degrada pra `createdAt`, ancorando no último
   * evento anterior — `+ 0.5` pra nunca empatar com um seq de verdade.
   */
  it('sem vínculo: degrada pra createdAt, ancorando no último evento anterior', () => {
    // Entre ev-1 (seq 1, 12:00:01) e ev-2 (seq 2, 12:00:02) — ancora em 1.
    const a = acao({ id: 'acao-solta', createdAt: '2026-08-10T12:00:01.500Z' });
    expect(ordemDaAcaoNaTimeline(a, EVENTOS)).toBe(1.5);
  });
});
