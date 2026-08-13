import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '../lib/api-types';

/**
 * RN-162: o Criativo pode emitir `chat.structured_question` (ferramenta
 * `ask_structured_questions`, engine) quando faz VÁRIAS perguntas na mesma
 * resposta — o fio renderiza um formulário com um campo por pergunta
 * (`type` decide o input), em vez de o usuário responder item por item em
 * texto livre. Depois de enviado, o card vira somente leitura e não pode
 * ser reenviado.
 */

const getSession = vi.fn();
const answerStructuredQuestion =
  vi.fn<
    (
      projectId: string,
      sessionId: string,
      agent: string,
      questionSetId: string,
      answers: Record<string, string>,
    ) => Promise<{ ok: true }>
  >();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    className,
    'aria-label': ariaLabel,
    title,
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
    className?: string;
    'aria-label'?: string;
    title?: string;
  }) => {
    const projectId = params?.projectId ?? '';
    const destino = to.replace('$projectId', projectId);
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
  answerStructuredQuestion: (
    ...args: [string, string, string, string, Record<string, string>]
  ) => answerStructuredQuestion(...args),
  approveAction: vi.fn(),
  approveAlwaysAction: vi.fn(),
  confirmReadiness: vi.fn(),
  denyAction: vi.fn(),
  promoteStories: vi.fn(),
  returnStory: vi.fn(),
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

const PERGUNTA = {
  id: 'ev-perguntas',
  seq: 1,
  type: 'chat.structured_question',
  actor: { kind: 'agent', id: 'criativo' },
  payload: {
    questions: [
      { id: 'nome', label: 'Qual o nome do produto?', type: 'text', options: [] },
      { id: 'usuarios', label: 'Quem são os usuários?', type: 'textarea', options: [] },
      {
        id: 'plataforma',
        label: 'Qual plataforma?',
        type: 'select',
        options: ['Web', 'Mobile', 'Ambos'],
      },
    ],
  },
  createdAt: '2026-08-11T12:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  eventos.mockReturnValue({ items: [] });
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — perguntas estruturadas do Criativo (RN-162)', () => {
  it('renderiza um campo por pergunta, do tipo certo', async () => {
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    expect(await screen.findByLabelText('Qual o nome do produto?')).toBeInTheDocument();
    expect(screen.getByLabelText('Quem são os usuários?').tagName).toBe('TEXTAREA');

    const select = screen.getByLabelText('Qual plataforma?');
    expect(select).toBeInTheDocument();
    expect(
      Array.from(select.querySelectorAll('option')).map((o) => o.textContent),
    ).toEqual(['Selecione', 'Web', 'Mobile', 'Ambos']);

    expect(screen.getByRole('button', { name: 'Enviar respostas' })).toBeDisabled();
  });

  it('Enviar respostas fica desabilitado até todos os campos estarem preenchidos', async () => {
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    const nome = await screen.findByLabelText('Qual o nome do produto?');
    const botao = screen.getByRole('button', { name: 'Enviar respostas' });

    fireEvent.change(nome, { target: { value: 'Checkout Fácil' } });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Quem são os usuários?'), {
      target: { value: 'Lojistas de pequeno porte' },
    });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Qual plataforma?'), { target: { value: 'Web' } });

    expect(botao).not.toBeDisabled();
  });

  it('envia as respostas com answerStructuredQuestion(projectId, sessionId, agent, questionSetId, answers)', async () => {
    answerStructuredQuestion.mockResolvedValue({ ok: true });
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    fireEvent.change(await screen.findByLabelText('Qual o nome do produto?'), {
      target: { value: 'Checkout Fácil' },
    });
    fireEvent.change(screen.getByLabelText('Quem são os usuários?'), {
      target: { value: 'Lojistas de pequeno porte' },
    });
    fireEvent.change(screen.getByLabelText('Qual plataforma?'), { target: { value: 'Web' } });

    fireEvent.click(screen.getByRole('button', { name: 'Enviar respostas' }));

    await waitFor(() => {
      expect(answerStructuredQuestion).toHaveBeenCalledWith(
        'proj-1',
        ID,
        'criativo',
        'ev-perguntas',
        {
          nome: 'Checkout Fácil',
          usuarios: 'Lojistas de pequeno porte',
          plataforma: 'Web',
        },
      );
    });
  });

  it('já respondido (chat.structured_question_answered posterior): vira somente leitura, sem formulário', async () => {
    eventos.mockReturnValue({
      items: [
        PERGUNTA,
        {
          id: 'ev-resposta',
          seq: 2,
          type: 'chat.structured_question_answered',
          actor: { kind: 'user', id: 'user-1' },
          payload: {
            questionSetId: 'ev-perguntas',
            answers: {
              nome: 'Checkout Fácil',
              usuarios: 'Lojistas de pequeno porte',
              plataforma: 'Web',
            },
          },
          createdAt: '2026-08-11T12:05:00.000Z',
        },
      ],
    });

    montar();

    await screen.findByText('perguntas do Criativo — respondidas');

    // O formulário sumiu — nada pra reenviar.
    expect(screen.queryByLabelText('Qual o nome do produto?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar respostas' })).not.toBeInTheDocument();

    // As respostas aparecem, lado a lado com a pergunta.
    expect(screen.getByText('Qual o nome do produto?')).toBeInTheDocument();
    expect(screen.getByText('Checkout Fácil')).toBeInTheDocument();
    expect(screen.getByText('Quem são os usuários?')).toBeInTheDocument();
    expect(screen.getByText('Lojistas de pequeno porte')).toBeInTheDocument();
    expect(screen.getByText('Qual plataforma?')).toBeInTheDocument();
    expect(screen.getByText('Web')).toBeInTheDocument();
  });
});
