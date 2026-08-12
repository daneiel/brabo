import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { PromoteStoriesResult, Session } from '../lib/api-types';

/**
 * Carrossel de histórias no fio do PO (RN-148).
 *
 * Decisão de design: uma "leva" é o conjunto de `backlog.story_promotion_proposed`
 * ainda PENDENTES (nenhum `backlog.story_transitioned`/`_promotion_returned`
 * posterior pro mesmo storyId) NO MOMENTO — não "criadas em sequência sem
 * interrupção". 2+ pendentes ao mesmo tempo viram UM carrossel em vez de N
 * cards avulsos; 1 pendente continua o card simples de sempre (RN-126),
 * degradação coberta em `SessionPage.promocao-inline-e-volta.test.tsx`.
 */

const getSession = vi.fn();
const promoteStories = vi.fn<(projectId: string, ids: string[]) => Promise<PromoteStoriesResult>>();
const returnStory = vi.fn<(projectId: string, storyId: string, reason: string) => Promise<{ ok: true }>>();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));

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
    const projectId = params?.projectId ?? '';
    const tab = (search as { tab?: string } | undefined)?.tab;
    let destino = to.replace('$projectId', projectId);
    if (tab) destino += `?tab=${tab}`;
    return (
      <a href={destino} className={className}>
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

function proposta(seq: number, storyId: string, title: string) {
  return {
    id: `ev-${storyId}`,
    seq,
    type: 'backlog.story_promotion_proposed',
    actor: { kind: 'agent', id: 'po' },
    payload: { storyId, epicId: 'epic-1', title },
    createdAt: '2026-08-11T12:00:00.000Z',
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

const TRES_PROPOSTAS = [
  proposta(1, 'story-1', 'Login com e-mail e senha'),
  proposta(2, 'story-2', 'Cadastro de usuário'),
  proposta(3, 'story-3', 'Checkout com cartão'),
];

beforeEach(() => {
  vi.clearAllMocks();
  eventos.mockReturnValue({ items: [] });
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — carrossel de histórias (RN-148)', () => {
  it('3+ histórias pendentes viram UM carrossel, não N cards avulsos', async () => {
    eventos.mockReturnValue({ items: TRES_PROPOSTAS });

    montar();

    // O grupo do carrossel existe, com o rótulo acessível certo.
    expect(
      await screen.findByRole('group', { name: '3 histórias aguardando promoção' }),
    ).toBeInTheDocument();

    // Só o slide ATUAL está montado — a frase de "pronta, aguardando sua
    // promoção" aparece UMA vez, não três.
    expect(
      screen.getAllByText(/pronta, aguardando sua promoção/),
    ).toHaveLength(1);
    expect(screen.getByText('história "Login com e-mail e senha" pronta, aguardando sua promoção')).toBeInTheDocument();
    expect(screen.queryByText(/Cadastro de usuário/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Checkout com cartão/)).not.toBeInTheDocument();

    // Navegação: 3 dots, um por história.
    expect(screen.getAllByRole('tab')).toHaveLength(3);

    // "Aprovar todas" existe no cabeçalho do carrossel.
    expect(screen.getByRole('button', { name: 'Aprovar todas' })).toBeInTheDocument();
  });

  it('navegar pro próximo slide troca a história em exibição', async () => {
    eventos.mockReturnValue({ items: TRES_PROPOSTAS });

    montar();

    await screen.findByText('história "Login com e-mail e senha" pronta, aguardando sua promoção');

    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));

    expect(
      screen.getByText('história "Cadastro de usuário" pronta, aguardando sua promoção'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Login com e-mail e senha/)).not.toBeInTheDocument();
  });

  it('"Aprovar todas" chama promoteStories com os ids das três histórias', async () => {
    promoteStories.mockResolvedValue({
      promoted: ['story-1', 'story-2', 'story-3'],
      failed: [],
    });
    eventos.mockReturnValue({ items: TRES_PROPOSTAS });

    montar();

    const botao = await screen.findByRole('button', { name: 'Aprovar todas' });
    fireEvent.click(botao);

    await waitFor(() => {
      expect(promoteStories).toHaveBeenCalledWith('proj-1', ['story-1', 'story-2', 'story-3']);
    });
  });

  it('promoção UNITÁRIA continua funcionando a partir do slide navegado', async () => {
    promoteStories.mockResolvedValue({ promoted: ['story-2'], failed: [] });
    eventos.mockReturnValue({ items: TRES_PROPOSTAS });

    montar();

    await screen.findByText('história "Login com e-mail e senha" pronta, aguardando sua promoção');
    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));
    await screen.findByText('história "Cadastro de usuário" pronta, aguardando sua promoção');

    fireEvent.click(screen.getByRole('button', { name: 'Promover' }));

    await waitFor(() => {
      expect(promoteStories).toHaveBeenCalledWith('proj-1', ['story-2']);
    });
  });

  it('Devolver a partir de um slide pede o motivo e chama returnStory com o storyId daquele slide', async () => {
    returnStory.mockResolvedValue({ ok: true });
    eventos.mockReturnValue({ items: TRES_PROPOSTAS });

    montar();

    await screen.findByText('história "Login com e-mail e senha" pronta, aguardando sua promoção');
    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));
    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));
    await screen.findByText('história "Checkout com cartão" pronta, aguardando sua promoção');

    fireEvent.click(screen.getByRole('button', { name: 'Devolver' }));

    const modal = await screen.findByText('Devolver "Checkout com cartão" ao PO?');
    expect(modal).toBeInTheDocument();

    const textarea = screen.getByLabelText('Motivo');
    fireEvent.change(textarea, { target: { value: 'falta critério de aceite' } });
    fireEvent.click(screen.getByRole('button', { name: 'Devolver ao PO' }));

    await waitFor(() => {
      expect(returnStory).toHaveBeenCalledWith('proj-1', 'story-3', 'falta critério de aceite');
    });
  });

  it('1 história pendente NÃO vira carrossel — degrada pro card simples de sempre', async () => {
    eventos.mockReturnValue({ items: [TRES_PROPOSTAS[0]] });

    montar();

    await screen.findByText('história "Login com e-mail e senha" pronta, aguardando sua promoção');

    expect(screen.queryByRole('group', { name: /histórias aguardando promoção/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar todas' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Promover' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Devolver' })).toBeInTheDocument();
  });

  it('história já resolvida some da leva — 2 pendentes de 3 ainda formam carrossel', async () => {
    eventos.mockReturnValue({
      items: [
        ...TRES_PROPOSTAS,
        {
          id: 'ev-transicao',
          seq: 4,
          type: 'backlog.story_transitioned',
          actor: { kind: 'user', id: 'user-1' },
          payload: { storyId: 'story-1', from: 'draft', to: 'ready' },
          createdAt: '2026-08-11T12:05:00.000Z',
        },
      ],
    });

    montar();

    // Só 2 seguem pendentes (story-2 e story-3) — ainda é leva (>=2), então
    // continua carrossel, agora com 2 dots.
    expect(
      await screen.findByRole('group', { name: '2 histórias aguardando promoção' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText('história "Cadastro de usuário" pronta, aguardando sua promoção')).toBeInTheDocument();

    // A resolvida narra separado, como divisor — não como slide.
    expect(
      screen.getByText('história "Login com e-mail e senha" esteve aguardando sua promoção'),
    ).toBeInTheDocument();
  });
});
