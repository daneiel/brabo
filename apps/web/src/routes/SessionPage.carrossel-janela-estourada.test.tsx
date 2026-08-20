import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Epic, PromoteStoriesResult, Session, Story } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';

/**
 * O bug: `promocoesPendentes`/`ehLevaDeHistorias` eram calculadas só a
 * partir da JANELA de `useSessionEvents` (últimos 200 eventos da sessão,
 * `latest: true`). Numa sessão longa, o `backlog.story_promotion_proposed`
 * que abriu a leva sai da janela enquanto a história continua pendente de
 * verdade — o carrossel encolhia silenciosamente (ou sumia por completo).
 * Mesma classe de bug que a RN-180 já corrigiu para `ContextAside`.
 *
 * A correção troca a fonte de CONTEÚDO/CONTAGEM pra `useBacklog`
 * (`Story.proposedReady`, completo e por sessão, sem janela). Estes testes
 * mockam `useBacklog` com dados REAIS — ao contrário dos outros arquivos de
 * carrossel/promoção, que mockam `[]` de propósito pra exercitar o fallback
 * de janela.
 */

const getSession = vi.fn();
const promoteStories = vi.fn<(projectId: string, ids: string[]) => Promise<PromoteStoriesResult>>();
const returnStory = vi.fn<(projectId: string, storyId: string, reason: string) => Promise<{ ok: true }>>();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const backlog = vi.fn<() => Epic[]>(() => []);

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
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: backlog() }),
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
const PROJECT_ID = 'proj-1';

function sessao(over: Partial<Session> = {}): Session {
  return {
    id: ID,
    projectId: PROJECT_ID,
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

function storiaFalsa(over: Partial<Story> = {}): Story {
  return {
    id: 'story-x',
    epicId: 'epic-1',
    projectId: PROJECT_ID,
    sessionId: ID,
    title: 'sem título',
    description: '',
    rf: [],
    rnf: [],
    businessRuleIds: [],
    dod: [],
    dor: [],
    status: 'draft',
    proposedReady: true,
    returnedReason: null,
    returnedAt: null,
    createdAt: '2026-08-11T12:00:00.000Z',
    updatedAt: '2026-08-11T12:00:00.000Z',
    tasks: [],
    ...over,
  };
}

function epicoFalso(stories: Story[]): Epic {
  return {
    id: 'epic-1',
    projectId: PROJECT_ID,
    sessionId: ID,
    title: 'Épico único',
    description: '',
    createdAt: '2026-08-11T12:00:00.000Z',
    updatedAt: '2026-08-11T12:00:00.000Z',
    stories,
  };
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

/** Um evento qualquer de preenchimento — sem relação com backlog. */
function ruido(seq: number) {
  return {
    id: `ev-ruido-${seq}`,
    seq,
    type: 'chat.message',
    actor: { kind: 'user', id: 'user-1' },
    payload: { text: `mensagem ${seq}` },
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
        <SessionPage projectId={PROJECT_ID} sessionId={ID} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  eventos.mockReturnValue({ items: [] });
  backlog.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — carrossel de histórias sobrevive à janela de eventos estourada', () => {
  it('leva inteira some da janela (>200 eventos entre a proposta mais antiga e o fim da sessão) mas o carrossel aparece com as 3 histórias, via useBacklog', async () => {
    // A JANELA que `useSessionEvents` devolveria numa sessão longa: nenhum
    // `backlog.story_promotion_proposed` sobrevive nela — todos saíram,
    // exatamente o caso da RN-180/RN-148. 220 eventos de ruído representam
    // o que ficou entre a proposta mais antiga e o fim da sessão.
    const janela = Array.from({ length: 220 }, (_, i) => ruido(i + 1));
    eventos.mockReturnValue({ items: janela });

    // O backlog (project-wide, sem janela) continua sabendo a verdade: as
    // três histórias seguem com `proposedReady: true` nesta sessão.
    backlog.mockReturnValue([
      epicoFalso([
        storiaFalsa({ id: 'story-1', title: 'Login com e-mail e senha' }),
        storiaFalsa({ id: 'story-2', title: 'Cadastro de usuário' }),
        storiaFalsa({ id: 'story-3', title: 'Checkout com cartão' }),
      ]),
    ]);

    montar();

    // A leva foi ancorada no `seq` sentinela mais antigo de todos — cai no
    // histórico recolhido POR ORIGEM (RN-177), junto do resto do que saiu
    // das últimas 5 entradas abertas. `Disclosure` nasce FECHADO e não monta
    // os filhos (docstring do componente): é preciso abrir "Log de eventos"
    // pra ele aparecer — o mesmo passo que uma pessoa faria na tela. Duas
    // seções concorrem pelo mesmo nome acessível (o fio E o painel de
    // contexto, RN-177 nos dois lugares) — a do FIO é a que mora dentro de
    // `.fioHistorico`.
    const cabecalhoDoFio = await waitFor(() => {
      const achado = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button[class*="fioHistoricoCabecalho"]'),
      ).find((el) => el.textContent?.includes('Log de eventos'));
      if (!achado) throw new Error('cabeçalho "Log de eventos" do fio não encontrado');
      return achado;
    });
    fireEvent.click(cabecalhoDoFio);

    expect(
      await screen.findByRole('group', { name: '3 histórias aguardando promoção' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('história "Login com e-mail e senha" pronta, aguardando sua promoção'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Aprovar todas' })).toBeInTheDocument();
  });

  it('só 1 das 3 propostas sobrevive na janela — o carrossel continua mostrando as 3, não degrada pra card simples', async () => {
    // Só a proposta da story-2 segue na janela; story-1 e story-3 saíram —
    // exatamente o segundo cenário do bug relatado ("degrada pro card
    // simples mesmo havendo mais de uma pendente de verdade").
    eventos.mockReturnValue({ items: [proposta(50, 'story-2', 'Cadastro de usuário')] });

    backlog.mockReturnValue([
      epicoFalso([
        storiaFalsa({ id: 'story-1', title: 'Login com e-mail e senha' }),
        storiaFalsa({ id: 'story-2', title: 'Cadastro de usuário' }),
        storiaFalsa({ id: 'story-3', title: 'Checkout com cartão' }),
      ]),
    ]);

    montar();

    // O que importa pro bug é a CONTAGEM: 3 pendentes de verdade, mesmo só
    // 1 delas tendo sobrevivido como evento na janela — nunca degradar pra
    // 1 (o segundo cenário relatado). Qual slide abre primeiro é detalhe de
    // ancoragem, não o que este teste garante.
    expect(
      await screen.findByRole('group', { name: '3 histórias aguardando promoção' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);

    // As três histórias estão representadas nos dots/slides — navega até
    // achar as três, inclusive a que só existe no backlog (sem evento na
    // janela).
    const titulos = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const pill = screen.getByText(/pronta, aguardando sua promoção/);
      titulos.add(pill.textContent ?? '');
      if (i < 2) fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));
    }
    expect(titulos).toEqual(
      new Set([
        'história "Login com e-mail e senha" pronta, aguardando sua promoção',
        'história "Cadastro de usuário" pronta, aguardando sua promoção',
        'história "Checkout com cartão" pronta, aguardando sua promoção',
      ]),
    );
  });

  it('"Aprovar todas" com a leva fora da janela ainda chama promoteStories com os 3 ids certos', async () => {
    promoteStories.mockResolvedValue({
      promoted: ['story-1', 'story-2', 'story-3'],
      failed: [],
    });
    eventos.mockReturnValue({ items: [] });
    backlog.mockReturnValue([
      epicoFalso([
        storiaFalsa({ id: 'story-1', title: 'Login com e-mail e senha' }),
        storiaFalsa({ id: 'story-2', title: 'Cadastro de usuário' }),
        storiaFalsa({ id: 'story-3', title: 'Checkout com cartão' }),
      ]),
    ]);

    montar();

    const botao = await screen.findByRole('button', { name: 'Aprovar todas' });
    fireEvent.click(botao);

    await waitFor(() => {
      expect(promoteStories).toHaveBeenCalledWith(PROJECT_ID, ['story-1', 'story-2', 'story-3']);
    });
  });

  it('promovida no backlog (proposedReady: false) não aparece mais, mesmo com o evento de proposta ainda na janela', async () => {
    // A proposta de story-1 continua no log (imutável), mas o backlog diz
    // que ela já foi promovida — não deve sobrar card nem slide pra ela.
    eventos.mockReturnValue({
      items: [
        proposta(1, 'story-1', 'Login com e-mail e senha'),
        proposta(2, 'story-2', 'Cadastro de usuário'),
      ],
    });
    backlog.mockReturnValue([
      epicoFalso([
        storiaFalsa({ id: 'story-1', title: 'Login com e-mail e senha', status: 'ready', proposedReady: false }),
        storiaFalsa({ id: 'story-2', title: 'Cadastro de usuário' }),
      ]),
    ]);

    montar();

    await screen.findByText('história "Cadastro de usuário" pronta, aguardando sua promoção');

    // 1 pendente de verdade — card simples, não carrossel.
    expect(screen.queryByRole('group', { name: /histórias aguardando promoção/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Login com e-mail e senha.*pronta, aguardando/)).not.toBeInTheDocument();
  });

  it('uma única história pendente, sem evento nenhum na janela, ainda aparece como card simples', async () => {
    eventos.mockReturnValue({ items: [ruido(1), ruido(2)] });
    backlog.mockReturnValue([
      epicoFalso([storiaFalsa({ id: 'story-9', title: 'Recuperação de senha' })]),
    ]);

    montar();

    await screen.findByText('história "Recuperação de senha" pronta, aguardando sua promoção');
    expect(screen.queryByRole('group', { name: /histórias aguardando promoção/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promover' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Devolver' })).toBeInTheDocument();
  });
});
