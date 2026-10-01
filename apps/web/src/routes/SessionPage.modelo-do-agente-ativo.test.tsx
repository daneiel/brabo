import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { historicoFalso } from '../test/historico-de-eventos';

/**
 * Achado 1: o modelo exibido na topbar não refletia o modelo REAL em uso.
 *
 * `GET .../model-binding` não passava `agentId` — a api só enxergava
 * sessão→projeto→workspace (mais o fallback fixo pro Criativo), então depois
 * de um handoff pro PO/Arquiteto/Dev Lead a topbar continuava mostrando o
 * resultado desse fallback, nunca o modelo do agente que estava REALMENTE
 * respondendo. A correção manda o agente como query param — a cascata
 * completa passa a rodar pro agente certo.
 *
 * Desde a RN-631 esse agente é o DESTINATÁRIO do composer, escolhido pela
 * pessoa — não mais "o ativado mais recente": com dois agentes na sessão e
 * nenhuma escolha, não há agente a pedir.
 */

const getSessionModelBinding = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));
vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => {},
}));
vi.mock('../lib/auth', () => ({
  emailDaSessao: () => 'eu@brabo.dev',
  userIdDaSessao: () => 'eu',
}));

vi.mock('../lib/api-client', () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'core' }),
  // Sessão ATIVA: é só nela que o composer (e o seletor de destinatário,
  // RN-631) existe.
  getSession: vi.fn().mockResolvedValue({
    id: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7',
    projectId: 'proj-1',
    status: 'active',
    kind: 'consultiva',
    name: null,
  }),
  getSessionBudget: vi.fn().mockResolvedValue(null),
  getSessionModelBinding: (...args: unknown[]) => getSessionModelBinding(...args),
  listModels: vi.fn().mockResolvedValue(null),
  renameSession: vi.fn(),
  acceptHandoff: vi.fn(),
  approveAction: vi.fn(),
  approveAlwaysAction: vi.fn(),
  confirmReadiness: vi.fn(),
  denyAction: vi.fn(),
  sendAgentMessage: vi.fn(),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: vi.fn(),
}));

const { SessionPage } = await import('./SessionPage');
const { ToastProvider } = await import('../components/ui/ToastProvider');

const ID = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';

function ativou(agent: string, seq: number) {
  return {
    id: `evt-${seq}`,
    seq,
    type: 'agent.activated',
    actor: { kind: 'agent', id: agent },
    payload: { agent },
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SessionPage projectId="proj-1" sessionId={ID} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getSessionModelBinding.mockResolvedValue({ modelId: 'm1', origin: 'workspace', skipped: [] });
});

describe('SessionPage — o modelo pedido acompanha o agente ativo', () => {
  it('sem agente nenhum ativado ainda, pede sem agentId', async () => {
    eventos.mockReturnValue({ items: [] });
    montar();

    await waitFor(() => expect(getSessionModelBinding).toHaveBeenCalled());
    expect(getSessionModelBinding).toHaveBeenCalledWith('proj-1', ID, undefined);
  });

  it('caminho feliz: escolhido o PO no composer, pede o binding COM agentId: "po"', async () => {
    eventos.mockReturnValue({
      items: [ativou('criativo', 1), ativou('po', 2)],
    });
    montar();
    fireEvent.change(
      within(await screen.findByTestId('destinatario-do-chat')).getByRole('combobox'),
      { target: { value: 'po' } },
    );

    await waitFor(() =>
      expect(getSessionModelBinding).toHaveBeenCalledWith('proj-1', ID, 'po'),
    );
  });

  it('CASO DE FALHA: dois agentes e nenhuma escolha — nenhum agente é presumido (RN-631)', async () => {
    eventos.mockReturnValue({
      items: [ativou('criativo', 1), ativou('po', 2)],
    });
    montar();

    await waitFor(() => expect(getSessionModelBinding).toHaveBeenCalled());
    expect(getSessionModelBinding).toHaveBeenCalledWith('proj-1', ID, undefined);
    expect(getSessionModelBinding).not.toHaveBeenCalledWith('proj-1', ID, 'po');
    expect(getSessionModelBinding).not.toHaveBeenCalledWith('proj-1', ID, 'criativo');
  });
});
