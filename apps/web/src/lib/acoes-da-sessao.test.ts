import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ProposedAction } from './api-types';

const listActions = vi.fn();

vi.mock('./api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api-client')>();
  return { ...original, listActions: (...a: unknown[]) => listActions(...a) };
});

const { buscarAcoesDaSessao, juntarCaudaEPendentes, TETO_DA_JANELA_DE_ACOES } = await import(
  './acoes-da-sessao'
);
const { alvosDoEvento, criarInvalidadorDoCanal } = await import('./canal-vivo');

function acao(seq: number, status: ProposedAction['status'] = 'executed'): ProposedAction {
  return {
    id: `a${seq}`,
    projectId: 'p1',
    sessionId: 's1',
    seq,
    actionType: 'terminal',
    payload: {},
    status,
    resolvedPolicy: status === 'pending' ? 'require_approval' : 'auto_approve',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buscarAcoesDaSessao — a pendente nova numa sessão com mais de 200 ações (AT-296)', () => {
  it('sessão curta: UMA requisição, a da cauda', async () => {
    listActions.mockResolvedValue({ items: [acao(1), acao(2, 'pending')], nextCursor: null });

    const pagina = await buscarAcoesDaSessao('p1', 's1');

    expect(listActions).toHaveBeenCalledTimes(1);
    expect(listActions).toHaveBeenCalledWith('p1', 's1', { limit: 200, latest: true });
    expect(pagina.items.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('cauda CHEIA: pede as pendentes e devolve a antiga que a cauda empurrou para fora', async () => {
    // 250 ações; a cauda traz 51..250 (a pendente nova, 250, está nela) e a
    // pendente ANTIGA (3) ficou fora — a leitura de pendentes a traz de volta.
    const cauda = Array.from({ length: TETO_DA_JANELA_DE_ACOES }, (_, i) =>
      acao(51 + i, 51 + i === 250 ? 'pending' : 'executed'),
    );
    listActions
      .mockResolvedValueOnce({ items: cauda, nextCursor: null })
      .mockResolvedValueOnce({ items: [acao(3, 'pending'), acao(250, 'pending')], nextCursor: null });

    const pagina = await buscarAcoesDaSessao('p1', 's1');

    expect(listActions).toHaveBeenLastCalledWith('p1', 's1', {
      limit: 200,
      latest: true,
      status: 'pending',
    });
    const pendentes = pagina.items.filter((a) => a.status === 'pending').map((a) => a.id);
    expect(pendentes).toEqual(['a3', 'a250']);
    expect(pagina.items).toHaveLength(201);
    expect(pagina.items[0].id).toBe('a3');
  });

  it('CASO DE FALHA: a leitura de pendentes que falha derruba a query (nunca finge fila vazia)', async () => {
    const cauda = Array.from({ length: TETO_DA_JANELA_DE_ACOES }, (_, i) => acao(i + 1));
    listActions
      .mockResolvedValueOnce({ items: cauda, nextCursor: null })
      .mockRejectedValueOnce(new Error('429'));

    await expect(buscarAcoesDaSessao('p1', 's1')).rejects.toThrow('429');
  });
});

describe('juntarCaudaEPendentes', () => {
  it('une por id, sem repetir, em seq crescente', () => {
    const juntas = juntarCaudaEPendentes([acao(5), acao(9, 'pending')], [acao(9, 'pending'), acao(2, 'pending')]);
    expect(juntas.map((a) => a.id)).toEqual(['a2', 'a5', 'a9']);
  });
});

describe('o canal avisa a fila do PROJETO (AT-299)', () => {
  it('`proposed_action.*` e `action.*` invalidam as pendências do projeto; evento de outro assunto não', () => {
    expect(alvosDoEvento('proposed_action.created')).toContain('pendenciasDoProjeto');
    expect(alvosDoEvento('action.approved')).toContain('pendenciasDoProjeto');
    expect(alvosDoEvento('dev.blocked_by_container')).toContain('pendenciasDoProjeto');
    expect(alvosDoEvento('tool.call')).not.toContain('pendenciasDoProjeto');
  });

  it('o invalidador bate na chave do projeto por PREFIXO, na hora, e com janela', () => {
    vi.useFakeTimers();
    try {
      const client = new QueryClient();
      const invalidar = vi.spyOn(client, 'invalidateQueries');
      const invalidador = criarInvalidadorDoCanal(client, 'p1', 's1');

      invalidador.aoEvento('proposed_action.created', false);
      invalidador.aoEvento('proposed_action.created', false);

      const doProjeto = () =>
        invalidar.mock.calls.filter(
          ([filtro]) => JSON.stringify(filtro?.queryKey) === JSON.stringify(['project-pending-actions', 'p1']),
        ).length;
      expect(doProjeto()).toBe(1);
      vi.advanceTimersByTime(2_000);
      expect(doProjeto()).toBe(2);
      invalidador.encerrar();
    } finally {
      vi.useRealTimers();
    }
  });
});
