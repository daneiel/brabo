import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Handoff, Session } from '../lib/api-types';
import type { SessionChannelHandlers } from '../lib/session-channel';

/**
 * Dois achados confirmados por investigação real, ambos em `SessionPage.tsx`:
 *
 * A) `conviteVisivel` depende de `!conversaComecou`, que nunca volta a
 *    `false`. Quem manda uma mensagem ANTES de clicar "Iniciar ideação"
 *    nunca vê o texto do convite — só sobra o botão pelado da topbar, sem
 *    explicação nenhuma ao lado. A correção põe uma pista (ícone + nota)
 *    junto do botão. Separadamente, o contador de regras de negócio no
 *    `ContextAside` passa a usar `<Disclosure trailing={n}>`, o mesmo padrão
 *    do Log de eventos.
 *
 * B) O engine emite `agent.status` "working" bem antes do primeiro delta
 *    quando o turno nasce de um kickoff ASSÍNCRONO (handoff aceito). Sem
 *    plugar `onAgentStatus`, a tela ficava muda entre aceitar o handoff e a
 *    primeira palavra do agente. A correção reaproveita o indicador de
 *    digitação já existente.
 */

const getSession = vi.fn();
const acceptHandoff = vi.fn();
let canalHandlers: SessionChannelHandlers | undefined;

const HANDOFF: Handoff = {
  id: 'handoff-1',
  sessionId: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7',
  projectId: 'proj-1',
  fromAgent: 'criativo',
  toAgent: 'po',
  artifactId: 'brief-1',
  status: 'offered',
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:00.000Z',
};

// O evento `handoff.offered` correspondente a HANDOFF (RN-125): desde que o
// aceite virou um card inline no fio, o botão só existe quando este evento
// está no event log — não basta o registro de `handoffs` sozinho.
const HANDOFF_OFERECIDO_EVENT = {
  id: 'ev-handoff-1',
  seq: 1,
  type: 'handoff.offered',
  actor: { kind: 'agent', id: 'criativo' },
  payload: { toAgent: 'po' },
  createdAt: '2026-08-10T12:00:00.000Z',
};

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
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: handoffsMock() }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));

vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: (
    _projectId: string,
    _sessionId: string,
    handlers: SessionChannelHandlers,
  ) => {
    canalHandlers = handlers;
    return () => {
      canalHandlers = undefined;
    };
  },
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
  canalHandlers = undefined;
  eventos.mockReturnValue({ items: [] });
  handoffsMock.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — achado A: pista no botão pelado da topbar', () => {
  it('mandar mensagem antes de "Iniciar ideação" esconde o convite mas mantém uma pista visível junto do botão', async () => {
    montar();

    const campo = await screen.findByPlaceholderText(
      'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
    );

    // O convite está visível antes de qualquer mensagem.
    expect(screen.getByText('A vez é sua')).toBeInTheDocument();

    // A conversa "começa" — sem clicar em "Iniciar ideação" — assim que o
    // evento `chat.message` aparece no event log (é isso que `conversaComecou`
    // observa).
    eventos.mockReturnValue({
      items: [
        {
          id: 'e1',
          seq: 1,
          type: 'chat.message',
          actor: { kind: 'user', id: 'user-1' },
          payload: { text: 'oi' },
          createdAt: '2026-08-10T12:00:01.000Z',
        },
      ],
    });
    fireEvent.change(campo, { target: { value: 'gatilho' } });
    fireEvent.change(campo, { target: { value: '' } });

    await waitFor(() =>
      expect(screen.queryByText('A vez é sua')).not.toBeInTheDocument(),
    );

    // O botão pelado continua na topbar...
    const botao = await screen.findByRole('button', { name: 'Iniciar ideação' });
    expect(botao).toBeInTheDocument();
    // ...mas agora com uma pista textual explicando o que ele faz, mesmo sem
    // o texto do convite.
    expect(botao).toHaveAttribute(
      'title',
      expect.stringContaining('Criativo'),
    );
    expect(screen.getByText('traz o Criativo pra conversa')).toBeInTheDocument();
  });
});

describe('SessionPage — achado A: contador de regras de negócio', () => {
  it('mostra a contagem no MESMO padrão (Disclosure + trailing) do Log de eventos', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'e1',
          seq: 1,
          type: 'artifact.business_rule',
          actor: { kind: 'agent', id: 'criativo' },
          payload: { title: 'Regra 1', description: 'desc', origin: [] },
          createdAt: '2026-08-10T12:00:01.000Z',
        },
        {
          id: 'e2',
          seq: 2,
          type: 'artifact.business_rule',
          actor: { kind: 'agent', id: 'criativo' },
          payload: { title: 'Regra 2', description: 'desc', origin: [] },
          createdAt: '2026-08-10T12:00:02.000Z',
        },
      ],
    });

    montar();

    const cabecalho = await screen.findByRole('button', {
      name: /Regras de negócio/,
    });
    // O número real, sem threshold nenhum.
    expect(cabecalho).toHaveTextContent('2');
    expect(cabecalho).toHaveAttribute('aria-expanded', 'true');

    // Colapsa como o Log de eventos — mesmo componente, mesmo comportamento.
    fireEvent.click(cabecalho);
    expect(cabecalho).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('SessionPage — achado B: indicador entre aceitar o handoff e o primeiro delta', () => {
  // RN-131: o indicador só liga depois de 5s sem texto nenhum — os testes
  // avançam o relógio explicitamente em vez de esperar 5s de parede.
  // `shouldAdvanceTime` mantém o resto (query do react-query, os `findBy`/
  // `waitFor` já existentes) fluindo normalmente enquanto o relógio está
  // fake, e `vi.advanceTimersByTimeAsync` pula direto pro momento em que o
  // `setTimeout` de 5000ms do indicador dispara.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('agent.status "working" NÃO mostra nada antes de 5s, mostra depois, e some no primeiro delta', async () => {
    handoffsMock.mockReturnValue([HANDOFF]);
    eventos.mockReturnValue({ items: [HANDOFF_OFERECIDO_EVENT] });
    let resolverAceite: () => void = () => {};
    acceptHandoff.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolverAceite = () => resolve();
        }),
    );

    montar();

    const botaoAceitar = await screen.findByRole('button', {
      name: 'Aceitar handoff e iniciar po',
    });
    fireEvent.click(botaoAceitar);

    // O kickoff no engine é um `GenServer.cast` assíncrono — o `agent.status`
    // "working" pode chegar pelo canal ANTES de `acceptHandoff` resolver.
    await waitFor(() => expect(canalHandlers?.onAgentStatus).toBeTypeOf('function'));
    act(() => canalHandlers!.onAgentStatus!({ status: 'working' }));

    // Nenhum delta chegou ainda, e ainda não passaram 5s: nada aparece —
    // é exatamente o ruído que RN-131 elimina.
    expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument();

    // Passa dos 5s sem nenhum delta: agora sim o indicador aparece — texto
    // FIXO (RN-156), sem interpolar o nome do agente.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText('Reunindo informações...')).toBeInTheDocument();

    // O primeiro delta chega — o indicador cede lugar ao streaming normal,
    // na hora, sem esperar timer nenhum.
    act(() => canalHandlers!.onAgentDelta!('Olá', 'po'));
    expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument();
    expect(screen.getByText('Olá')).toBeInTheDocument();

    resolverAceite();
    act(() => canalHandlers!.onAgentDone!());
  });

  it('resposta rápida (< 5s): agent.status "idle" antes do timer nunca liga o indicador', async () => {
    handoffsMock.mockReturnValue([HANDOFF]);
    eventos.mockReturnValue({ items: [HANDOFF_OFERECIDO_EVENT] });
    acceptHandoff.mockResolvedValue(undefined);

    montar();

    const botaoAceitar = await screen.findByRole('button', {
      name: 'Aceitar handoff e iniciar po',
    });
    fireEvent.click(botaoAceitar);

    await waitFor(() => expect(canalHandlers?.onAgentStatus).toBeTypeOf('function'));
    act(() => canalHandlers!.onAgentStatus!({ status: 'working' }));
    expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument();

    // O turno acaba ANTES dos 5s (resposta rápida, sem texto nenhum) — o
    // timer é desarmado e o indicador NUNCA chega a aparecer.
    act(() => canalHandlers!.onAgentStatus!({ status: 'idle' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument();
  });

  it('CASO DE FALHA: erro ao aceitar o handoff não deixa indicador nenhum preso', async () => {
    handoffsMock.mockReturnValue([HANDOFF]);
    eventos.mockReturnValue({ items: [HANDOFF_OFERECIDO_EVENT] });
    acceptHandoff.mockRejectedValue(new Error('rede caiu'));

    montar();

    const botaoAceitar = await screen.findByRole('button', {
      name: 'Aceitar handoff e iniciar po',
    });
    fireEvent.click(botaoAceitar);

    await waitFor(() => expect(acceptHandoff).toHaveBeenCalled());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Mesmo que um "working" tardio chegasse depois da falha, não há mais
    // agente esperado (`turnoAgentRef` foi limpo) — mas o teste garante o
    // caminho direto: nenhum indicador aparece, mesmo depois dos 5s.
    expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument();
  });
});
