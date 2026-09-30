import { describe, expect, it, vi, beforeEach, afterAll, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session, SessionEvent } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
import { simularLayoutMovel } from '../test/match-media';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

/**
 * AT-328 (achado N1 da auditoria da Rodada 29): a tela de Sessão não tinha
 * layout móvel. Em 390px o painel "Contexto da sessão" ficava com ~320px e o
 * fio com ~70px (uma palavra por linha), e "Iniciar ideação"/"Encerrar" saíam
 * pela borda direita da barra.
 *
 * No móvel (RN-643, `useLayoutMovel`) o painel nasce FECHADO e abre como
 * GAVETA sobre o fio — diálogo modal, X, fundo e Esc fecham, o foco volta a
 * quem abriu —, e a barra QUEBRA linha em vez de cortar ação.
 */

const getSession = vi.fn();
const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const historico = vi.fn(() => historicoFalso(eventos().items));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
    children: ReactNode;
    className?: string;
  }) => {
    const destino = to.replace('$projectId', params?.projectId ?? '');
    const tab = (search as { tab?: string } | undefined)?.tab ?? '';
    return (
      <a href={`${destino}?tab=${tab}`} className={className}>
        {children}
      </a>
    );
  },
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEventHistory: () => historico(),
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

function evento(over: Partial<SessionEvent> & { seq: number }): SessionEvent {
  return {
    id: `ev-${over.seq}`,
    sessionId: ID,
    type: 'agent.response',
    actor: { kind: 'agent', id: 'po' },
    payload: {},
    createdAt: '2026-08-10T12:00:00.000Z',
    ...over,
  } as SessionEvent;
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  await i18n.changeLanguage('pt-BR');
  // Uma mensagem do usuário: a conversa começou, então o convite sai do fio e
  // "Iniciar ideação" mora na BARRA — que é onde ela era cortada.
  eventos.mockReturnValue({
    items: [
      evento({
        seq: 1,
        type: 'chat.message',
        actor: { kind: 'user', id: 'user-1' },
        payload: { content: 'oi' },
      }),
    ],
  });
  historico.mockImplementation(() => historicoFalso(eventos().items));
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const TITULO_DO_PAINEL = 'Contexto da sessão';
const ALTERNAR = 'Alternar painel de contexto';

describe('SessionPage — layout móvel (AT-328)', () => {
  let largura: ReturnType<typeof simularLayoutMovel> | null = null;
  afterEach(() => {
    largura?.restaurar();
    largura = null;
  });

  it('o painel nasce fechado, abre como gaveta sobre o fio, e o Esc fecha devolvendo o foco', async () => {
    largura = simularLayoutMovel(true);
    montar();

    const alternar = await screen.findByRole('button', { name: ALTERNAR });
    expect(screen.queryByText(TITULO_DO_PAINEL)).toBeNull();
    expect(alternar).toHaveAttribute('aria-pressed', 'false');

    alternar.focus();
    fireEvent.click(alternar);

    const gaveta = screen.getByRole('dialog', { name: TITULO_DO_PAINEL });
    expect(gaveta).toHaveAttribute('aria-modal', 'true');
    expect(gaveta).toHaveTextContent(TITULO_DO_PAINEL);
    const fechar = screen.getByRole('button', { name: 'Fechar painel de contexto' });
    expect(document.activeElement).toBe(fechar);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: TITULO_DO_PAINEL })).toBeNull();
    expect(document.activeElement).toBe(alternar);
  });

  it('o X e o fundo também fecham a gaveta', async () => {
    largura = simularLayoutMovel(true);
    montar();
    const alternar = await screen.findByRole('button', { name: ALTERNAR });

    fireEvent.click(alternar);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel de contexto' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(alternar);
    fireEvent.click(screen.getByTestId('fundo-da-gaveta-do-contexto'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a barra quebra linha: título em cima, e "Iniciar ideação" e "Encerrar" continuam na tela', async () => {
    largura = simularLayoutMovel(true);
    montar();

    const iniciar = await screen.findByRole('button', { name: 'Iniciar ideação' });
    const encerrar = screen.getByRole('button', { name: /Encerrar/ });
    const quebra = screen.getByTestId('quebra-da-barra');
    const barra = quebra.parentElement as HTMLElement;
    expect(barra).toHaveAttribute('data-layout', 'movel');
    expect(barra).toContainElement(iniciar);
    // As ações vêm DEPOIS da quebra: é ela que as manda para a linha de baixo.
    const depois = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(depois(quebra, iniciar.closest('span') ?? iniciar)).toBe(true);
    expect(depois(quebra, encerrar)).toBe(true);
    expect(depois(screen.getByRole('button', { name: /Sessão #/ }), quebra)).toBe(true);
  });

  it('caso de falha: no desktop o painel continua ao lado do fio, aberto, sem gaveta nem quebra', async () => {
    montar();

    expect(await screen.findByText(TITULO_DO_PAINEL)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('quebra-da-barra')).toBeNull();
    expect(screen.getByRole('button', { name: ALTERNAR })).toHaveAttribute('aria-pressed', 'true');
  });

  it('cruzar para o móvel com o painel aberto o fecha — ele não reaparece espremendo o fio', async () => {
    largura = simularLayoutMovel(false);
    montar();
    expect(await screen.findByText(TITULO_DO_PAINEL)).toBeInTheDocument();

    act(() => largura!.mudar(true));

    expect(screen.queryByText(TITULO_DO_PAINEL)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
