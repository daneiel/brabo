import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '../lib/i18n';
import type { ProposedAction } from '../lib/api-types';

/**
 * AT-476 (RN-804): o cartão do plano do Dev Lead oferece o modo automático em
 * lote ANTES de aprovar — mesmo controle da RN-661, só com o clique.
 */
const setAgentAutonomy = vi.fn();
const listAgentAutonomy = vi.fn();

vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  setAgentAutonomy: (...args: unknown[]) => setAgentAutonomy(...args),
  listAgentAutonomy: (...args: unknown[]) => listAgentAutonomy(...args),
}));

const { ApprovalCard } = await import('./ApprovalCard');
const { agentesDoPlano } = await import('./ModoAutomaticoDoPlano');

function plano(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'a1',
    projectId: 'proj-1',
    sessionId: 's1',
    seq: 1,
    actionType: 'propose_execution_plan',
    payload: {
      modulos: [{ modulo: 'Backend', agentes: 1, porque: 'x' }],
      resumo: 'plano',
      totalAgentes: 1,
      tarefas: [],
    },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-lead' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function montar(action: ProposedAction, comPapel = true) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ApprovalCard
        action={action}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
        onActivateAutoMode={comPapel ? vi.fn() : undefined}
      />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  listAgentAutonomy.mockResolvedValue([]);
  setAgentAutonomy.mockResolvedValue(undefined);
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('ApprovalCard — modo automático no plano do Dev Lead (RN-804)', () => {
  it('deriva os dev agents dos módulos do plano, mais os gates', () => {
    const agentes = agentesDoPlano(plano().payload);
    expect(agentes[0]).toBe('dev-backend');
    expect(agentes).toContain('qa');
  });

  it('caminho feliz: oferece antes de aprovar, nada grava ao montar, o clique grava a curinga', async () => {
    montar(plano());
    const botao = await screen.findByRole('button', { name: /^Ligar para \d+ agentes$/ });
    await waitFor(() => expect(botao).toBeEnabled());
    expect(setAgentAutonomy).not.toHaveBeenCalled();
    fireEvent.click(botao);
    await waitFor(() => expect(setAgentAutonomy).toHaveBeenCalled());
    expect(setAgentAutonomy.mock.calls[0]).toEqual([
      'proj-1',
      { agentId: 'dev-backend', actionType: '*', mode: 'auto_approve' },
    ]);
    expect(await screen.findByRole('status')).toHaveTextContent('Modo automático ligado');
  });

  it('CASO DE FALHA: sem papel (sem callback) ou outro tipo de ação, não oferece', () => {
    montar(plano(), false);
    expect(screen.queryByRole('button', { name: /^Ligar para/ })).toBeNull();
    montar(plano({ actionType: 'terminal', payload: { command: 'ls' } }));
    expect(screen.queryByRole('button', { name: /^Ligar para/ })).toBeNull();
  });
});
