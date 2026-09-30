import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Handoff, Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app: as asserções abaixo esperam texto em pt-BR.
import i18n from '../lib/i18n';

/**
 * RN-631 (AT-253) — o handoff MANUAL ganha o botão de aceite, e oferta
 * pendente não esconde as seguintes.
 *
 * O handoff manual (ADR 0109/RN-440) é gravado com a PESSOA como ator do
 * `handoff.offered`, e o card casava a oferta pelo ator (`fromAgent`): os dois
 * nunca batiam, o card nunca ganhava "Aceitar" e — sendo a oferta pendente
 * mais antiga, a única que `.find()` elegia — escondia toda oferta seguinte.
 */

const acceptHandoff = vi.fn();
const getSession = vi.fn();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const handoffsMock = vi.fn<() => Handoff[]>(() => []);

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: handoffsMock() }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));
vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => {},
}));
vi.mock('../lib/auth', () => ({ emailDaSessao: () => 'eu@brabo.dev' }));

vi.mock('../lib/api-client', () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'core' }),
  getSession: (...args: unknown[]) => getSession(...args),
  getSessionBudget: vi.fn().mockResolvedValue(null),
  getSessionModelBinding: vi.fn().mockResolvedValue(null),
  listModels: vi.fn().mockResolvedValue(null),
  renameSession: vi.fn(),
  acceptHandoff: (...args: unknown[]) => acceptHandoff(...args),
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
const USUARIO = '9b2f6a1e-1111-4222-8333-444455556666';

function sessao(): Session {
  return {
    id: ID,
    projectId: 'proj-1',
    createdBy: 'user-1',
    status: 'active',
    kind: 'criativa',
    name: null,
    nextSeq: 1,
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    closedAt: null,
  } as Session;
}

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

function oferecido(
  seq: number,
  handoffId: string,
  toAgent: string,
  actor: { kind: string; id: string },
) {
  return {
    id: `evt-${seq}`,
    seq,
    type: 'handoff.offered',
    actor,
    payload: { handoffId, toAgent },
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

function handoff(over: Partial<Handoff>): Handoff {
  return {
    id: 'h-1',
    sessionId: ID,
    projectId: 'proj-1',
    fromAgent: 'criativo',
    toAgent: 'po',
    artifactId: null,
    status: 'offered',
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    ...over,
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

beforeEach(async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  await i18n.changeLanguage('pt-BR');
  getSession.mockResolvedValue(sessao());
  acceptHandoff.mockResolvedValue({ ok: true });
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('SessionPage — o handoff manual tem Aceitar e não esconde as ofertas seguintes (RN-631)', () => {
  it('caminho feliz: o handoff manual ao PO ganha o botão, e a pílula diz "Handoff manual"', async () => {
    eventos.mockReturnValue({
      items: [
        ativou('criativo', 1),
        oferecido(2, 'h-manual', 'po', { kind: 'user', id: USUARIO }),
      ],
    });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-manual', fromAgent: 'criativo', toAgent: 'po' }),
    ]);

    montar();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Aceitar handoff e iniciar po' }),
    );
    await waitFor(() =>
      expect(acceptHandoff).toHaveBeenCalledWith('proj-1', ID, 'h-manual'),
    );
    expect(screen.getByText('Handoff manual')).toBeInTheDocument();
    expect(screen.queryByText(USUARIO)).not.toBeInTheDocument();
  });

  it('CASO DE FALHA (antes): o manual pendente mais antigo escondia a oferta seguinte — agora as duas têm botão', async () => {
    eventos.mockReturnValue({
      items: [
        ativou('criativo', 1),
        ativou('po', 2),
        oferecido(3, 'h-manual', 'staff', { kind: 'user', id: USUARIO }),
        oferecido(4, 'h-arq', 'arquiteto', { kind: 'agent', id: 'po' }),
      ],
    });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-manual', fromAgent: 'po', toAgent: 'staff' }),
      handoff({ id: 'h-arq', fromAgent: 'po', toAgent: 'arquiteto' }),
    ]);

    montar();
    expect(
      await screen.findByRole('button', { name: 'Aceitar handoff e iniciar staff' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Aceitar handoff e iniciar arquiteto' }),
    );
    await waitFor(() =>
      expect(acceptHandoff).toHaveBeenCalledWith('proj-1', ID, 'h-arq'),
    );
  });

  it('duas ofertas pendentes ao MESMO agente viram um botão só — o da mais recente', async () => {
    eventos.mockReturnValue({
      items: [
        ativou('criativo', 1),
        oferecido(2, 'h-manual', 'po', { kind: 'user', id: USUARIO }),
        oferecido(3, 'h-criativo', 'po', { kind: 'agent', id: 'criativo' }),
      ],
    });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-manual', fromAgent: 'criativo', toAgent: 'po' }),
      handoff({ id: 'h-criativo', fromAgent: 'criativo', toAgent: 'po' }),
    ]);

    montar();
    const botoes = await screen.findAllByRole('button', {
      name: 'Aceitar handoff e iniciar po',
    });
    expect(botoes).toHaveLength(1);
    fireEvent.click(botoes[0]!);
    await waitFor(() =>
      expect(acceptHandoff).toHaveBeenCalledWith('proj-1', ID, 'h-criativo'),
    );
  });
});
