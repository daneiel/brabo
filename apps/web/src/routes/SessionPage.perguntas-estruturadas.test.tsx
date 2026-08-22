import { describe, expect, it, vi, afterEach, afterAll, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

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
  useSessionEventHistory: () => historicoFalso(eventos().items),
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

// `mensagemDaApi`/`ApiError` vêm do módulo REAL: o caminho de erro do card
// (`handleSubmit`) os chama, e um mock que não os exporta transforma a falha
// de rede simulada numa rejeição não tratada — que passa despercebida no
// resumo do vitest (todos os testes "passam") e reprova o CI.
vi.mock('../lib/api-client', async () => {
  const real =
    await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
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

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  eventos.mockReturnValue({ items: [] });
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('SessionPage — perguntas estruturadas do Criativo (RN-162)', () => {
  it('renderiza um campo por pergunta, do tipo certo', async () => {
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    expect(await screen.findByLabelText('Qual o nome do produto?')).toBeInTheDocument();
    expect(screen.getByLabelText('Quem são os usuários?').tagName).toBe('TEXTAREA');

    const select = screen.getByLabelText('Qual plataforma?');
    expect(select).toBeInTheDocument();
    // RN-171: a saída por texto livre entra no FIM da lista — `allowOther`
    // ausente vale `true`, como no engine.
    expect(
      Array.from(select.querySelectorAll('option')).map((o) => o.textContent),
    ).toEqual(['Selecione', 'Web', 'Mobile', 'Ambos', 'Outra (escrever)']);

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

/**
 * RN-171 — o relato do uso real foi literal: "sempre dê a opção de input do
 * usuário quando ele seleciona Escreva". O modelo oferecia uma opção do tipo
 * "escreva você mesmo" e o formulário não tinha onde escrever, porque o schema
 * do tool não sabia dizer "além destas, o que você quiser".
 */
describe('SessionPage — saída por texto livre no select (RN-171)', () => {
  it('escolher "Outra (escrever)" revela um campo de texto, e é ele que vale como resposta', async () => {
    answerStructuredQuestion.mockResolvedValue({ ok: true });
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    fireEvent.change(await screen.findByLabelText('Qual o nome do produto?'), {
      target: { value: 'Checkout Fácil' },
    });
    fireEvent.change(screen.getByLabelText('Quem são os usuários?'), {
      target: { value: 'Lojistas' },
    });

    // Nenhum campo de texto livre antes de escolher a saída.
    expect(screen.queryByLabelText(/^Sua resposta/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Qual plataforma?'), {
      target: { value: '__outra__' },
    });

    const livre = screen.getByLabelText('Sua resposta — Qual plataforma?');
    // O sentinela NÃO é resposta: enquanto o campo está vazio, o envio segue
    // travado (e o backend recusaria com 400 de qualquer forma).
    expect(screen.getByRole('button', { name: 'Enviar respostas' })).toBeDisabled();

    fireEvent.change(livre, { target: { value: 'Terminal de PDV' } });
    expect(screen.getByRole('button', { name: 'Enviar respostas' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar respostas' }));

    await waitFor(() => {
      expect(answerStructuredQuestion).toHaveBeenCalledWith(
        'proj-1',
        ID,
        'criativo',
        'ev-perguntas',
        {
          nome: 'Checkout Fácil',
          usuarios: 'Lojistas',
          // O sentinela nunca sai da tela — o que viaja é o TEXTO.
          plataforma: 'Terminal de PDV',
        },
      );
    });
  });

  it('voltar de "Outra" para uma opção da lista descarta o texto livre', async () => {
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    const select = await screen.findByLabelText('Qual plataforma?');
    fireEvent.change(select, { target: { value: '__outra__' } });
    fireEvent.change(screen.getByLabelText('Sua resposta — Qual plataforma?'), {
      target: { value: 'Terminal de PDV' },
    });

    fireEvent.change(select, { target: { value: 'Web' } });

    expect(screen.queryByLabelText('Sua resposta — Qual plataforma?')).not.toBeInTheDocument();
    expect((select as HTMLSelectElement).value).toBe('Web');
  });

  it('allowOther: false fecha a lista — a saída não é oferecida', async () => {
    eventos.mockReturnValue({
      items: [
        {
          ...PERGUNTA,
          payload: {
            questions: [
              {
                id: 'cobranca',
                label: 'Vai cobrar?',
                type: 'select',
                options: ['Sim', 'Não'],
                allowOther: false,
              },
            ],
          },
        },
      ],
    });

    montar();

    const select = await screen.findByLabelText('Vai cobrar?');
    expect(
      Array.from(select.querySelectorAll('option')).map((o) => o.textContent),
    ).toEqual(['Selecione', 'Sim', 'Não']);
  });
});

/**
 * RN-174 — responder o formulário INICIA um turno de agente
 * (`AnswerStructuredQuestionUseCase` reusa `SendAgentMessageUseCase`, síncrono
 * no engine), e a tela não dizia nada enquanto ele durava: o indicador de
 * "pensando" depende de `streaming`/`statusAgent`, e este caminho não ligava
 * nenhum dos dois. O canal Phoenix não cobre o buraco — quando ele ainda não
 * terminou de conectar (ticket + join, RN-108), o `agent.status` "working" se
 * perde.
 */
describe('SessionPage — responder o formulário arma o indicador de turno (RN-174)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('depois de 5s sem resposta, o fio mostra que o agente está trabalhando', async () => {
    let resolver: () => void = () => {};
    answerStructuredQuestion.mockImplementation(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolver = () => resolve({ ok: true });
        }),
    );
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    fireEvent.change(await screen.findByLabelText('Qual o nome do produto?'), {
      target: { value: 'Checkout Fácil' },
    });
    fireEvent.change(screen.getByLabelText('Quem são os usuários?'), {
      target: { value: 'Lojistas' },
    });
    fireEvent.change(screen.getByLabelText('Qual plataforma?'), { target: { value: 'Web' } });

    fireEvent.click(screen.getByRole('button', { name: 'Enviar respostas' }));
    await waitFor(() => expect(answerStructuredQuestion).toHaveBeenCalled());

    // Antes dos 5s nada aparece — a regra do indicador (RN-131) não mudou.
    expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText('Reunindo informações...')).toBeInTheDocument();

    // A chamada resolve: o turno acabou, e o indicador sai junto.
    await act(async () => {
      resolver();
    });
    await waitFor(() =>
      expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument(),
    );
  });

  it('CASO DE FALHA: erro no envio não deixa o indicador preso', async () => {
    answerStructuredQuestion.mockRejectedValue(new Error('rede caiu'));
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    fireEvent.change(await screen.findByLabelText('Qual o nome do produto?'), {
      target: { value: 'Checkout Fácil' },
    });
    fireEvent.change(screen.getByLabelText('Quem são os usuários?'), {
      target: { value: 'Lojistas' },
    });
    fireEvent.change(screen.getByLabelText('Qual plataforma?'), { target: { value: 'Web' } });

    fireEvent.click(screen.getByRole('button', { name: 'Enviar respostas' }));
    await waitFor(() => expect(answerStructuredQuestion).toHaveBeenCalled());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument();
  });
});
