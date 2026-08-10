import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';

/**
 * Achado 10: a sessão deve abrir sempre na última mensagem.
 *
 * Não existia NENHUM scroll automático — o único `useEffect` de scroll era
 * específico pro chip de evidência do Psicólogo (`highlightEvent`), e uma
 * sessão com histórico abria no TOPO (mensagens mais antigas primeiro).
 *
 * `HTMLElement.prototype.scrollIntoView` não existe em jsdom (ambiente de
 * teste) — o próprio componente guarda essa chamada (`rolarParaOFim`), então
 * o teste substitui o método por um espião pra observar SE e COM QUE
 * argumento ele foi chamado. `{ block: 'end' }` é a marca do scroll de
 * abertura (achado 10); `{ block: 'center', behavior: 'smooth' }` é a marca
 * da navegação de evidência do Psicólogo — os dois nunca deveriam disparar
 * na mesma visita.
 */

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
  sendAgentMessage: vi.fn(),
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

function mensagem(seq: number) {
  return {
    id: `evt-${seq}`,
    seq,
    type: 'chat.message',
    actor: { kind: 'user', id: 'user-1' },
    payload: { text: `mensagem ${seq}` },
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

function montar(highlightEvent?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SessionPage projectId="proj-1" sessionId={ID} highlightEvent={highlightEvent} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

let espiao: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(sessao());
  espiao = vi.fn();
  // jsdom não implementa `scrollIntoView` — o componente guarda a chamada
  // (`rolarParaOFim`), então o espião só precisa existir pra ser observável.
  HTMLElement.prototype.scrollIntoView = espiao as unknown as typeof HTMLElement.prototype.scrollIntoView;
});

describe('SessionPage — abre sempre na última mensagem', () => {
  it('caminho feliz: sessão com histórico rola pro FIM ao montar', async () => {
    eventos.mockReturnValue({
      items: Array.from({ length: 30 }, (_, i) => mensagem(i + 1)),
    });

    montar();

    await waitFor(() =>
      expect(espiao).toHaveBeenCalledWith(expect.objectContaining({ block: 'end' })),
    );
  });

  it('sessão SEM histórico não tenta rolar (nada pra rolar)', async () => {
    eventos.mockReturnValue({ items: [] });

    montar();
    await new Promise((r) => setTimeout(r, 50));

    expect(espiao).not.toHaveBeenCalledWith(expect.objectContaining({ block: 'end' }));
  });

  it('CASO DE FALHA evitado: com highlightEvent, a evidência do Psicólogo manda — sem scroll pro fim', async () => {
    eventos.mockReturnValue({
      items: Array.from({ length: 30 }, (_, i) => mensagem(i + 1)),
    });

    montar('evt-15');
    await new Promise((r) => setTimeout(r, 50));

    expect(espiao).not.toHaveBeenCalledWith(expect.objectContaining({ block: 'end' }));
  });
});
