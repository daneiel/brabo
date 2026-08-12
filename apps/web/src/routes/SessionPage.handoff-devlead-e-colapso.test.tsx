import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Handoff, ProposedAction, Session } from '../lib/api-types';

/**
 * Três problemas confirmados por investigação + teste ao vivo no Chrome, TODOS
 * em `SessionPage.tsx`:
 *
 * 1. **Prioridade de handoff no card do chat** (RN-136) — `OfferInfraHandoffUseCase`
 *    oferece o handoff pro Infra ANTES do Dev Lead, na MESMA confirmação. Como
 *    `handoffs` vem ordenado por `createdAt` ASC, um `.find()` sem filtro
 *    resolvia sempre pro mais antigo ainda `offered` — o de Infra, que nunca é
 *    aceito por esta tela (não é conversacional). O card do Dev Lead só devia
 *    ficar acionável DEPOIS de alguém aceitar o de Infra em outro lugar: na
 *    prática, nunca.
 * 2. **"Ativar execução" inline no card do Dev Lead** (RN-137) — atalho pra
 *    quem já sabe o que quer, sem passar pela conversa. Usa a MESMA
 *    `activateExecution`, agora com `sessionId` como `originSessionId`.
 * 3. **Colapso de mensagens por agente** (RN-138) — depois que um agente passa
 *    o bastão (handoff aceito) E não tem ação `pending`, suas mensagens
 *    CONSECUTIVAS colapsam num cabeçalho com nome + contagem.
 */

const getSession = vi.fn();
const acceptHandoff = vi.fn();
const activateExecution = vi.fn();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const handoffsMock = vi.fn<() => Handoff[]>(() => []);
const actionsMock = vi.fn<() => ProposedAction[]>(() => []);

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
    const tab = (search as { tab?: string } | undefined)?.tab ?? '';
    const destino = to.replace('$projectId', projectId);
    return (
      <a href={`${destino}?tab=${tab}`} className={className}>
        {children}
      </a>
    );
  },
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos(), isPending: false }),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: actionsMock() } }),
  useHandoffs: () => ({ data: handoffsMock() }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));

vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => {},
}));

vi.mock('../lib/auth', () => ({ emailDaSessao: () => 'eu@brabo.dev' }));

vi.mock('../lib/api-client', async () => {
  // `ApiError`/`mensagemDaApi` REAIS (problema 2, autorização): é a frase da
  // api ("Papel insuficiente para esta ação") que o teste precisa ver chegar.
  const real = await vi.importActual<typeof import('../lib/api-client')>(
    '../lib/api-client',
  );
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'core' }),
    getSession: (...args: unknown[]) => getSession(...args),
    getSessionBudget: vi.fn().mockResolvedValue(null),
    getSessionModelBinding: vi.fn().mockResolvedValue(null),
    listModels: vi.fn().mockResolvedValue(null),
    renameSession: vi.fn(),
    acceptHandoff: (...args: unknown[]) => acceptHandoff(...args),
    activateExecution: (...args: unknown[]) => activateExecution(...args),
    approveAction: vi.fn(),
    approveAlwaysAction: vi.fn(),
    confirmReadiness: vi.fn(),
    denyAction: vi.fn(),
    sendAgentMessage: vi.fn(),
    setSessionModelBinding: vi.fn(),
    startAgent: vi.fn(),
    transitionSession: vi.fn(),
  };
});

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
  eventos.mockReturnValue({ items: [] });
  handoffsMock.mockReturnValue([]);
  actionsMock.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — problema 1: prioridade do handoff pro Dev Lead sobre Infra', () => {
  const HANDOFF_INFRA: Handoff = {
    id: 'handoff-infra',
    sessionId: ID,
    projectId: 'proj-1',
    fromAgent: 'arquiteto',
    toAgent: 'infra',
    artifactId: null,
    status: 'offered',
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
  };
  const HANDOFF_DEVLEAD: Handoff = {
    id: 'handoff-devlead',
    sessionId: ID,
    projectId: 'proj-1',
    fromAgent: 'arquiteto',
    toAgent: 'dev-lead',
    artifactId: null,
    status: 'offered',
    createdAt: '2026-08-10T12:00:01.000Z',
    updatedAt: '2026-08-10T12:00:01.000Z',
  };

  it('com Infra (mais antigo) e Dev Lead ambos offered, o card acionável é o do Dev Lead', async () => {
    // A ordem do array espelha `findBySession` (createdAt ASC): Infra vem
    // primeiro — é exatamente o cenário que fazia o `.find()` sem filtro
    // travar no handoff errado.
    handoffsMock.mockReturnValue([HANDOFF_INFRA, HANDOFF_DEVLEAD]);
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-infra',
          seq: 1,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'arquiteto' },
          payload: { handoffId: 'handoff-infra', toAgent: 'infra' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
        {
          id: 'ev-devlead',
          seq: 2,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'arquiteto' },
          payload: { handoffId: 'handoff-devlead', toAgent: 'dev-lead' },
          createdAt: '2026-08-10T12:00:01.000Z',
        },
      ],
    });

    montar();

    // O card acionável é o do Dev Lead...
    expect(
      await screen.findByRole('button', { name: 'Aceitar handoff e iniciar dev-lead' }),
    ).toBeInTheDocument();
    // ...e o de Infra NUNCA aparece como botão nesta tela.
    expect(
      screen.queryByRole('button', { name: /Aceitar handoff e iniciar infra/ }),
    ).not.toBeInTheDocument();

    // Os dois continuam NARRADOS no fio (a frase de passagem de bastão).
    const divisores = screen.getAllByText('passou o bastão ao');
    expect(divisores).toHaveLength(2);
  });

  it('só o handoff de Infra offered (Dev Lead ainda não ofertado): nenhum card acionável', async () => {
    handoffsMock.mockReturnValue([HANDOFF_INFRA]);
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-infra',
          seq: 1,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'arquiteto' },
          payload: { handoffId: 'handoff-infra', toAgent: 'infra' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });

    montar();

    await screen.findByText('passou o bastão ao');
    expect(
      screen.queryByRole('button', { name: /Aceitar handoff/ }),
    ).not.toBeInTheDocument();
  });
});

describe('SessionPage — problema 2: "Ativar execução" inline no card do Dev Lead', () => {
  const HANDOFF_DEVLEAD: Handoff = {
    id: 'handoff-devlead',
    sessionId: ID,
    projectId: 'proj-1',
    fromAgent: 'arquiteto',
    toAgent: 'dev-lead',
    artifactId: null,
    status: 'offered',
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
  };

  function montarComCardDevLead() {
    handoffsMock.mockReturnValue([HANDOFF_DEVLEAD]);
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-devlead',
          seq: 1,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'arquiteto' },
          payload: { handoffId: 'handoff-devlead', toAgent: 'dev-lead' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });
    return montar();
  }

  it('caminho feliz: clique chama activateExecution com projectId e sessionId (originSessionId)', async () => {
    activateExecution.mockResolvedValue({ sessionId: 'sessao-exec-1', modules: ['api'] });
    montarComCardDevLead();

    const botao = await screen.findByRole('button', { name: 'Ativar execução' });
    fireEvent.click(botao);

    await waitFor(() => {
      expect(activateExecution).toHaveBeenCalledWith('proj-1', ID);
    });
    expect(await screen.findByText('Execução ativada')).toBeInTheDocument();
  });

  it('falha (403 de papel insuficiente): mostra a frase real da api, não um erro genérico', async () => {
    const { ApiError } = await import('../lib/api-client');
    activateExecution.mockRejectedValue(
      new ApiError(403, { message: 'Papel insuficiente para esta ação' }),
    );
    montarComCardDevLead();

    const botao = await screen.findByRole('button', { name: 'Ativar execução' });
    fireEvent.click(botao);

    expect(
      await screen.findByText('Papel insuficiente para esta ação'),
    ).toBeInTheDocument();
  });

  it('o botão de "Ativar execução" convive com o de aceitar o handoff e o link de Executores', async () => {
    montarComCardDevLead();

    expect(await screen.findByRole('button', { name: 'Ativar execução' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Aceitar handoff e iniciar dev-lead' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Acompanhe a execução em Executores/ }),
    ).toBeInTheDocument();
  });
});

describe('SessionPage — problema 3: colapso de mensagens por agente após passar o bastão', () => {
  function respostaDoPo(seq: number, id: string, texto: string) {
    return {
      id,
      seq,
      type: 'agent.response',
      actor: { kind: 'agent', id: 'po' },
      payload: { content: texto },
      createdAt: '2026-08-10T12:00:00.000Z',
    };
  }

  it('duas mensagens consecutivas do PO colapsam quando ele já passou o bastão e não tem ação pendente', async () => {
    handoffsMock.mockReturnValue([
      {
        id: 'handoff-po-arq',
        sessionId: ID,
        projectId: 'proj-1',
        fromAgent: 'po',
        toAgent: 'arquiteto',
        artifactId: null,
        status: 'accepted',
        createdAt: '2026-08-10T12:00:02.000Z',
        updatedAt: '2026-08-10T12:00:02.000Z',
      },
    ]);
    eventos.mockReturnValue({
      items: [respostaDoPo(1, 'ev-1', 'Primeira mensagem do PO'), respostaDoPo(2, 'ev-2', 'Segunda mensagem do PO')],
    });

    montar();

    // As duas mensagens somem da tela — só o cabeçalho do grupo aparece.
    await screen.findByText('2 mensagens');
    expect(screen.queryByText('Primeira mensagem do PO')).not.toBeInTheDocument();
    expect(screen.queryByText('Segunda mensagem do PO')).not.toBeInTheDocument();

    // Clicar no cabeçalho reabre as duas.
    fireEvent.click(screen.getByRole('button', { name: /2 mensagens/ }));
    expect(await screen.findByText('Primeira mensagem do PO')).toBeInTheDocument();
    expect(screen.getByText('Segunda mensagem do PO')).toBeInTheDocument();
  });

  it('sem handoff.accepted do PO ainda (bastão não passado): as mensagens ficam abertas, sem colapso', async () => {
    handoffsMock.mockReturnValue([]);
    eventos.mockReturnValue({
      items: [respostaDoPo(1, 'ev-1', 'Primeira mensagem do PO'), respostaDoPo(2, 'ev-2', 'Segunda mensagem do PO')],
    });

    montar();

    expect(await screen.findByText('Primeira mensagem do PO')).toBeInTheDocument();
    expect(screen.getByText('Segunda mensagem do PO')).toBeInTheDocument();
    expect(screen.queryByText(/mensagens$/)).not.toBeInTheDocument();
  });

  it('com ação PENDENTE do PO, mesmo depois de ele passar o bastão, não colapsa', async () => {
    handoffsMock.mockReturnValue([
      {
        id: 'handoff-po-arq',
        sessionId: ID,
        projectId: 'proj-1',
        fromAgent: 'po',
        toAgent: 'arquiteto',
        artifactId: null,
        status: 'accepted',
        createdAt: '2026-08-10T12:00:02.000Z',
        updatedAt: '2026-08-10T12:00:02.000Z',
      },
    ]);
    actionsMock.mockReturnValue([
      {
        id: 'acao-1',
        projectId: 'proj-1',
        sessionId: ID,
        seq: 3,
        actionType: 'git_commit',
        payload: {},
        status: 'pending',
        resolvedPolicy: 'require_approval',
        actor: { kind: 'agent', id: 'po' },
        decidedBy: null,
        decidedAt: null,
        rejectionReason: null,
        executionResult: null,
        createdAt: '2026-08-10T12:00:03.000Z',
        updatedAt: '2026-08-10T12:00:03.000Z',
      } as ProposedAction,
    ]);
    eventos.mockReturnValue({
      items: [respostaDoPo(1, 'ev-1', 'Primeira mensagem do PO'), respostaDoPo(2, 'ev-2', 'Segunda mensagem do PO')],
    });

    montar();

    expect(await screen.findByText('Primeira mensagem do PO')).toBeInTheDocument();
    expect(screen.getByText('Segunda mensagem do PO')).toBeInTheDocument();
    expect(screen.queryByText(/mensagens$/)).not.toBeInTheDocument();
  });

  it('uma mensagem do usuário no meio quebra o agrupamento — só a sequência realmente consecutiva colapsa', async () => {
    handoffsMock.mockReturnValue([
      {
        id: 'handoff-po-arq',
        sessionId: ID,
        projectId: 'proj-1',
        fromAgent: 'po',
        toAgent: 'arquiteto',
        artifactId: null,
        status: 'accepted',
        createdAt: '2026-08-10T12:00:04.000Z',
        updatedAt: '2026-08-10T12:00:04.000Z',
      },
    ]);
    eventos.mockReturnValue({
      items: [
        respostaDoPo(1, 'ev-1', 'Primeira mensagem do PO'),
        respostaDoPo(2, 'ev-2', 'Segunda mensagem do PO'),
        {
          id: 'ev-user',
          seq: 3,
          type: 'chat.message',
          actor: { kind: 'user', id: 'user-1' },
          payload: { text: 'Uma pergunta no meio' },
          createdAt: '2026-08-10T12:00:03.000Z',
        },
        respostaDoPo(4, 'ev-4', 'Terceira mensagem do PO'),
      ],
    });

    montar();

    // As duas primeiras colapsam (sequência consecutiva de 2)...
    await screen.findByText('2 mensagens');
    // ...a mensagem do usuário quebra o grupo e aparece direto...
    expect(screen.getByText('Uma pergunta no meio')).toBeInTheDocument();
    // ...e a terceira, sozinha depois da quebra, também aparece direto (só
    // 1 entrada — não vira grupo de 1).
    expect(screen.getByText('Terceira mensagem do PO')).toBeInTheDocument();
  });
});
