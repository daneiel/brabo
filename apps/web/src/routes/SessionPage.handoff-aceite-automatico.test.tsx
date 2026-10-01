import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Handoff, Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app: as asserções abaixo esperam texto em pt-BR.
import i18n from '../lib/i18n';

/**
 * RN-660 (ADR 0186, AT-314) — o handoff do PO ao Arquiteto aceito pelo SISTEMA
 * aparece no fio com o critério que dispensou o clique; a falha do aceite
 * automático também é dita, e aí o botão de sempre continua ali.
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
vi.mock('../lib/auth', () => ({
  emailDaSessao: () => 'eu@brabo.dev',
  userIdDaSessao: () => 'eu',
}));

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

const SISTEMA = { kind: 'system', id: 'handoff-auto-accept' };

function aceitoPeloSistema(seq: number, handoffId: string) {
  return {
    id: `evt-${seq}`,
    seq,
    type: 'handoff.accepted',
    actor: SISTEMA,
    payload: {
      handoffId,
      toAgent: 'arquiteto',
      automatico: true,
      criterio: { regras: 4, cobertas: 4, repositorio: 'a_provisionar_local' },
    },
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

describe('SessionPage — o aceite automático do handoff PO → Arquiteto (RN-660)', () => {
  it('caminho feliz: o fio diz que o sistema aceitou, com o critério, e não oferece botão', async () => {
    eventos.mockReturnValue({
      items: [
        ativou('po', 1),
        oferecido(2, 'h-arq', 'arquiteto', { kind: 'agent', id: 'po' }),
        aceitoPeloSistema(3, 'h-arq'),
        ativou('arquiteto', 4),
      ],
    });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-arq', fromAgent: 'po', toAgent: 'arquiteto', status: 'accepted' }),
    ]);

    montar();
    const aviso = await screen.findByTestId('handoff-aceite-automatico');
    expect(aviso).toHaveTextContent('Aceito automaticamente');
    expect(aviso).toHaveTextContent('4 regras de negócio');
    expect(
      screen.queryByRole('button', { name: 'Aceitar handoff e iniciar Arquiteto' }),
    ).not.toBeInTheDocument();
  });

  it('CASO DE FALHA: o aceite automático que falhou é dito, e a oferta segue com botão', async () => {
    eventos.mockReturnValue({
      items: [
        ativou('po', 1),
        oferecido(2, 'h-arq', 'arquiteto', { kind: 'agent', id: 'po' }),
        {
          id: 'evt-3',
          seq: 3,
          type: 'handoff.auto_accept_failed',
          actor: SISTEMA,
          payload: {
            handoffId: 'h-arq',
            toAgent: 'arquiteto',
            origem: 'infra',
            error: 'engine fora',
          },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-arq', fromAgent: 'po', toAgent: 'arquiteto' }),
    ]);

    montar();
    expect(
      await screen.findByTestId('handoff-aceite-automatico-falhou'),
    ).toHaveTextContent('engine fora');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Aceitar handoff e iniciar Arquiteto' }),
    );
    await waitFor(() =>
      expect(acceptHandoff).toHaveBeenCalledWith('proj-1', ID, 'h-arq'),
    );
  });

  it('o aceite HUMANO não ganha o aviso de aceite automático', async () => {
    eventos.mockReturnValue({
      items: [
        ativou('po', 1),
        oferecido(2, 'h-arq', 'arquiteto', { kind: 'agent', id: 'po' }),
        {
          id: 'evt-3',
          seq: 3,
          type: 'handoff.accepted',
          actor: { kind: 'user', id: USUARIO },
          payload: { handoffId: 'h-arq', toAgent: 'arquiteto' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-arq', fromAgent: 'po', toAgent: 'arquiteto', status: 'accepted' }),
    ]);

    montar();
    await screen.findByText('passou o bastão ao');
    expect(screen.queryByTestId('handoff-aceite-automatico')).not.toBeInTheDocument();
  });
});
