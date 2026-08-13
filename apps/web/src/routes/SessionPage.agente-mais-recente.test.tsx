import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';

/**
 * Achado 9-fix: roteamento errado depois do handoff pro Dev Lead.
 *
 * `activeAgent` usava uma cadeia de PRECEDÊNCIA fixa (arquiteto > po >
 * criativo) baseada em EXISTÊNCIA histórica ("já ativou alguma vez"), não em
 * "quem está ativo AGORA". Uma vez que o Arquiteto atuasse, ele ficava com
 * prioridade PARA SEMPRE — então mesmo depois de aceitar um handoff pro Dev
 * Lead (que nem estava na cadeia), a mensagem seguinte continuava indo pro
 * Arquiteto.
 *
 * A correção: o agente que recebe a mensagem é o de `agent.activated` mais
 * RECENTE (por `seq`) entre os que participam do fluxo de chat — sem ordem
 * fixa nenhuma.
 */

const sendAgentMessage = vi.fn();
const getSession = vi.fn();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
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
vi.mock('../lib/auth', () => ({ emailDaSessao: () => 'eu@brabo.dev' }));

vi.mock('../lib/api-client', () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'core' }),
  getSession: (...args: unknown[]) => getSession(...args),
  getSessionBudget: vi.fn().mockResolvedValue(null),
  getSessionModelBinding: vi.fn().mockResolvedValue(null),
  listModels: vi.fn().mockResolvedValue(null),
  renameSession: vi.fn(),
  acceptHandoff: vi.fn(),
  approveAction: vi.fn(),
  approveAlwaysAction: vi.fn(),
  confirmReadiness: vi.fn(),
  denyAction: vi.fn(),
  sendAgentMessage: (...args: unknown[]) => sendAgentMessage(...args),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: vi.fn(),
}));

const { SessionPage } = await import('./SessionPage');
const { ToastProvider } = await import('../components/ui/ToastProvider');

const ID = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';

function sessao(over: Partial<Session> = {}): Session {
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
    ...over,
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

async function mandarMensagem(texto: string) {
  const campo = await screen.findByPlaceholderText(
    'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
  );
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.keyDown(campo, { key: 'Enter' });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(sessao());
  sendAgentMessage.mockResolvedValue({ ok: true });
});

describe('SessionPage — o agente ATIVO é o mais RECENTE, não uma cadeia fixa', () => {
  it('caminho feliz: depois do handoff pro Dev Lead, a mensagem vai pro Dev Lead', async () => {
    // Cadeia real: Criativo → PO → Arquiteto → Dev Lead. A cadeia fixa antiga
    // (arquiteto > po > criativo) mandaria pro Arquiteto — ele nem "desligava"
    // depois de atuar, e `dev-lead` não estava na lista.
    eventos.mockReturnValue({
      items: [ativou('criativo', 1), ativou('po', 2), ativou('arquiteto', 3), ativou('dev-lead', 4)],
    });

    montar();
    await mandarMensagem('e agora?');

    await waitFor(() => expect(sendAgentMessage).toHaveBeenCalled());
    expect(sendAgentMessage).toHaveBeenCalledWith('proj-1', ID, 'dev-lead', 'e agora?');
  });

  it('CASO DE FALHA: a cadeia fixa antiga mandaria pro Arquiteto mesmo com o PO mais recente', async () => {
    // Arquiteto ativou primeiro (seq 1); o PO ativou DEPOIS (seq 2) — um
    // handoff de volta, por exemplo. A cadeia fixa (arquiteto > po > criativo)
    // ignorava `seq` e escolhia sempre o Arquiteto por ele estar mais "no
    // fundo" da precedência. "Mais recente vence" escolhe o PO.
    eventos.mockReturnValue({
      items: [ativou('arquiteto', 1), ativou('po', 2)],
    });

    montar();
    await mandarMensagem('oi de novo');

    await waitFor(() => expect(sendAgentMessage).toHaveBeenCalled());
    expect(sendAgentMessage).toHaveBeenCalledWith('proj-1', ID, 'po', 'oi de novo');
    expect(sendAgentMessage).not.toHaveBeenCalledWith('proj-1', ID, 'arquiteto', 'oi de novo');
  });
});
