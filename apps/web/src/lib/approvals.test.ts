import { describe, expect, it } from 'vitest';
import { resumirAcoes, somarResumos, RESUMO_VAZIO } from './approvals';
import type { ProposedAction } from './api-types';

function acao(over: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'act-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'git_commit',
    payload: {},
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...over,
  } as ProposedAction;
}

describe('resumirAcoes (achado #16)', () => {
  it('sem ações, tudo zero', () => {
    expect(resumirAcoes([])).toEqual(RESUMO_VAZIO);
    expect(resumirAcoes(undefined)).toEqual(RESUMO_VAZIO);
  });

  it('conta clique humano por decidedBy, não por status', () => {
    // O ponto: uma ação aprovada por alguém e já EXECUTADA tem status
    // `executed`. Contar por status a perderia — e era exatamente a métrica
    // que a Fase 10 não conseguiu colher.
    const resumo = resumirAcoes([
      acao({ id: 'a', status: 'executed', decidedBy: 'user-1' }),
      acao({ id: 'b', status: 'denied', decidedBy: 'user-1' }),
      acao({ id: 'c', status: 'pending' }),
    ]);

    expect(resumo.decididasPorVoce).toBe(2);
    expect(resumo.pendentes).toBe(1);
    expect(resumo.total).toBe(3);
  });

  it('auto-aprovada pela política nunca vira clique humano', () => {
    const resumo = resumirAcoes([
      acao({
        id: 'a',
        status: 'executed',
        resolvedPolicy: 'auto_approve',
        decidedBy: null,
      }),
    ]);

    expect(resumo.autoAprovadas).toBe(1);
    expect(resumo.decididasPorVoce).toBe(0);
  });

  it('deny da política não conta como decisão sua', () => {
    const resumo = resumirAcoes([
      acao({ id: 'a', status: 'denied', resolvedPolicy: 'deny', decidedBy: null }),
    ]);

    expect(resumo.decididasPorVoce).toBe(0);
    expect(resumo.autoAprovadas).toBe(0);
    expect(resumo.total).toBe(1);
  });
});

describe('somarResumos', () => {
  it('lista vazia devolve o resumo vazio', () => {
    expect(somarResumos([])).toEqual(RESUMO_VAZIO);
  });

  it('soma sessão a sessão — é o total do projeto', () => {
    const a = resumirAcoes([acao({ id: 'a', decidedBy: 'user-1' })]);
    const b = resumirAcoes([
      acao({ id: 'b' }),
      acao({ id: 'c', resolvedPolicy: 'auto_approve' }),
    ]);

    expect(somarResumos([a, b])).toEqual({
      total: 3,
      pendentes: 3,
      decididasPorVoce: 1,
      autoAprovadas: 1,
    });
  });
});
