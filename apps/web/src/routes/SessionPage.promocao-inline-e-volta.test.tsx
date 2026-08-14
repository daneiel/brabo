import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { PromoteStoriesResult, Session } from '../lib/api-types';

/**
 * Dois itens que colidiriam se fossem agentes separados (ambos em
 * `SessionPage.tsx`):
 *
 * 1. **"Voltar" volta pro PROJETO**, não pro dashboard raiz.
 * 2. **Promoção de história INLINE no fio** (RN-048, RN-126) —
 *    `backlog.story_promotion_proposed` vira card acionável com
 *    "Promover"/"Devolver", reusando `promoteStories`/`returnStory`
 *    (os mesmos endpoints da aba Backlog); `backlog.story_promotion_returned`
 *    narra a devolução com o motivo.
 */

const getSession = vi.fn();
const promoteStories = vi.fn<(projectId: string, ids: string[]) => Promise<PromoteStoriesResult>>();
const returnStory = vi.fn<(projectId: string, storyId: string, reason: string) => Promise<{ ok: true }>>();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));

// `Link` captura `to`/`params`/`search` explicitamente — o `href` codifica os
// três, o suficiente pra afirmar o DESTINO (mesmo padrão do teste de handoff
// inline já existente neste arquivo de rota).
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    className,
    'aria-label': ariaLabel,
    title,
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
    children: ReactNode;
    className?: string;
    'aria-label'?: string;
    title?: string;
  }) => {
    const projectId = params?.projectId ?? '';
    const tab = (search as { tab?: string } | undefined)?.tab;
    let destino = to.replace('$projectId', projectId);
    if (tab) destino += `?tab=${tab}`;
    return (
      <a href={destino} className={className} aria-label={ariaLabel} title={title}>
        {children}
      </a>
    );
  },
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
  promoteStories: (...args: [string, string[]]) => promoteStories(...args),
  returnStory: (...args: [string, string, string]) => returnStory(...args),
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
    createdAt: '2026-08-11T12:00:00.000Z',
    updatedAt: '2026-08-11T12:00:00.000Z',
    closedAt: null,
    ...over,
  } as Session;
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
  eventos.mockReturnValue({ items: [] });
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — item 1: "Voltar" leva ao projeto, não ao dashboard', () => {
  it('o botão da topbar aponta pra /projects/$projectId', async () => {
    montar();

    const link = await screen.findByRole('link', { name: 'Voltar ao projeto' });
    expect(link).toHaveAttribute('href', '/projects/proj-1');
    expect(link).toHaveAttribute('title', 'Voltar ao projeto');
  });
});

describe('SessionPage — item 2: promoção de história inline no fio (RN-126)', () => {
  const PROPOSTA = {
    id: 'ev-proposta',
    seq: 1,
    type: 'backlog.story_promotion_proposed',
    actor: { kind: 'agent', id: 'po' },
    payload: { storyId: 'story-1', epicId: 'epic-1', title: 'Login com e-mail e senha' },
    createdAt: '2026-08-11T12:00:00.000Z',
  };

  it('o card aparece com título e os botões Promover/Devolver', async () => {
    eventos.mockReturnValue({ items: [PROPOSTA] });

    montar();

    expect(
      await screen.findByText('história "Login com e-mail e senha" pronta, aguardando sua promoção'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promover' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Devolver' })).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /Ver no Backlog/ });
    expect(link).toHaveAttribute('href', '/projects/proj-1?tab=backlog');
  });

  it('Promover chama promoteStories com projectId e o storyId do payload', async () => {
    promoteStories.mockResolvedValue({ promoted: ['story-1'], failed: [] });
    eventos.mockReturnValue({ items: [PROPOSTA] });

    montar();

    const botao = await screen.findByRole('button', { name: 'Promover' });
    fireEvent.click(botao);

    await waitFor(() => {
      expect(promoteStories).toHaveBeenCalledWith('proj-1', ['story-1']);
    });
  });

  it('Devolver pede o motivo e chama returnStory só depois de preenchido', async () => {
    returnStory.mockResolvedValue({ ok: true });
    eventos.mockReturnValue({ items: [PROPOSTA] });

    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Devolver' }));

    const confirmar = await screen.findByRole('button', { name: 'Devolver ao PO' });
    // Vazio: o botão de confirmação fica desabilitado.
    expect(confirmar).toBeDisabled();

    const textarea = screen.getByLabelText('Motivo');
    fireEvent.change(textarea, {
      target: { value: 'os critérios de aceite não cobrem a recusa do pagamento' },
    });
    expect(confirmar).not.toBeDisabled();

    fireEvent.click(confirmar);

    await waitFor(() => {
      expect(returnStory).toHaveBeenCalledWith(
        'proj-1',
        'story-1',
        'os critérios de aceite não cobrem a recusa do pagamento',
      );
    });
  });

  it('história já resolvida (story_transitioned posterior) some com os botões', async () => {
    eventos.mockReturnValue({
      items: [
        PROPOSTA,
        {
          id: 'ev-transicao',
          seq: 2,
          type: 'backlog.story_transitioned',
          actor: { kind: 'user', id: 'user-1' },
          payload: { storyId: 'story-1', from: 'draft', to: 'ready' },
          createdAt: '2026-08-11T12:05:00.000Z',
        },
      ],
    });

    montar();

    await screen.findByText('história "Login com e-mail e senha" esteve aguardando sua promoção');
    expect(screen.queryByRole('button', { name: 'Promover' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Devolver' })).not.toBeInTheDocument();
  });

  it('backlog.story_promotion_returned narra a devolução com o motivo', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-devolvida',
          seq: 1,
          type: 'backlog.story_promotion_returned',
          actor: { kind: 'user', id: 'user-1' },
          payload: {
            storyId: 'story-1',
            title: 'Login com e-mail e senha',
            reason: 'faltam critérios de aceite',
          },
          createdAt: '2026-08-11T12:00:00.000Z',
        },
      ],
    });

    montar();

    expect(await screen.findByText('devolveu ao PO')).toBeInTheDocument();
    expect(
      screen.getByText('"Login com e-mail e senha": faltam critérios de aceite'),
    ).toBeInTheDocument();
  });

  /**
   * RN-174 — devolver não é só gravar a recusa: `ReturnStoryUseCase` chama
   * `reviseStory`, que é `handle_call({:revise, …})` no `po_server`, e a
   * chamada só resolve depois de o PO reescrever a história. A tela ficava
   * MUDA esse tempo inteiro.
   */
  describe('devolver arma o indicador de turno (RN-174)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function devolver() {
      eventos.mockReturnValue({ items: [PROPOSTA] });
      montar();
      fireEvent.click(await screen.findByRole('button', { name: 'Devolver' }));
      fireEvent.change(screen.getByLabelText('Motivo'), {
        target: { value: 'faltam critérios de aceite' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Devolver ao PO' }));
      await waitFor(() => expect(returnStory).toHaveBeenCalled());
    }

    it('mostra que o PO está trabalhando enquanto a revisão não volta', async () => {
      let resolver: () => void = () => {};
      returnStory.mockImplementation(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            resolver = () => resolve({ ok: true });
          }),
      );

      await devolver();

      expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.getByText('Reunindo informações...')).toBeInTheDocument();

      await act(async () => {
        resolver();
      });
      await waitFor(() =>
        expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument(),
      );
    });

    it('CASO DE FALHA: erro ao devolver não deixa o indicador preso', async () => {
      returnStory.mockRejectedValue(new Error('rede caiu'));

      await devolver();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument();
    });
  });
});
