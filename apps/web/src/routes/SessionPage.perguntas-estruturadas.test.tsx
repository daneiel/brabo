import { describe, expect, it, vi, afterEach, afterAll, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
/** A cauda do log que a rede de segurança lê depois do aceite (ADR 0163). */
const cauda = vi.fn();

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

vi.mock('../lib/auth', () => ({
  emailDaSessao: () => 'eu@brabo.dev',
  userIdDaSessao: () => 'eu',
}));

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
    listSessionEvents: (...args: unknown[]) => cauda(...args),
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

/** AT-653: o formulário é um questionário passo a passo; este helper anda por ele. */
const campo = async (rotulo: string) =>
  within(await screen.findByRole('group', { name: rotulo })).getByRole('textbox');
const proxima = () => fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
async function preencherNomeEUsuarios(nome = 'Checkout Fácil', usuarios = 'Lojistas de pequeno porte') {
  fireEvent.change(await campo('Qual o nome do produto?'), {
    target: { value: nome },
  });
  proxima();
  fireEvent.change((await campo('Quem são os usuários?')), { target: { value: usuarios } });
  proxima();
}

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
  it('mostra uma pergunta por vez, com progresso, e o campo do tipo certo', async () => {
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    expect(await campo('Qual o nome do produto?')).toBeInTheDocument();
    expect(screen.getByText('Pergunta 1 de 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anterior' })).not.toBeInTheDocument();
    // Só o último passo oferece o envio.
    expect(screen.queryByRole('button', { name: 'Enviar respostas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    fireEvent.change((await campo('Qual o nome do produto?')), { target: { value: 'x' } });
    proxima();
    expect(screen.getByText('Pergunta 2 de 3')).toBeInTheDocument();
    expect((await campo('Quem são os usuários?')).tagName).toBe('TEXTAREA');

    fireEvent.change((await campo('Quem são os usuários?')), { target: { value: 'y' } });
    proxima();
    // RN-171: a lista vira escolhas (radio) e a saída livre é um campo ao lado.
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
      'Web',
      'Mobile',
      'Ambos',
    ]);
    expect(screen.getByLabelText('Sua resposta — Qual plataforma?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar respostas' })).toBeDisabled();
  });

  it('a textarea aceita várias linhas e só conta como respondida com texto', async () => {
    eventos.mockReturnValue({ items: [PERGUNTA] });
    montar();
    fireEvent.change(await campo('Qual o nome do produto?'), { target: { value: 'x' } });
    proxima();
    const area = (await campo('Quem são os usuários?'));
    proxima();
    expect(screen.getByText('Pergunta 2 de 3')).toBeInTheDocument();
    fireEvent.change(area, { target: { value: 'linha 1\nlinha 2' } });
    expect(area).toHaveValue('linha 1\nlinha 2');
    proxima();
    expect(screen.getByText('Pergunta 3 de 3')).toBeInTheDocument();
  });

  it('RN-693: os campos de texto não convidam o autofill nem o gerenciador de senhas', async () => {
    eventos.mockReturnValue({ items: [PERGUNTA] });
    montar();
    const nome = await campo('Qual o nome do produto?');
    fireEvent.change(nome, { target: { value: 'x' } });
    proxima();
    const area = await campo('Quem são os usuários?');
    fireEvent.change(area, { target: { value: 'y' } });
    proxima();
    const livre = screen.getByLabelText('Sua resposta — Qual plataforma?');
    for (const c of [nome, area, livre]) {
      expect(c.getAttribute('autocomplete')).toBe('off');
      expect(c.getAttribute('data-1p-ignore')).not.toBeNull();
      expect(c.getAttribute('data-lpignore')).toBe('true');
      expect(c.getAttribute('data-bwignore')).not.toBeNull();
      expect(c.getAttribute('data-form-type')).toBe('other');
    }
  });

  it('RN-830: Enter que confirma a composição do IME não avança nem envia', async () => {
    eventos.mockReturnValue({ items: [PERGUNTA] });
    montar();
    const nome = await campo('Qual o nome do produto?');
    fireEvent.change(nome, { target: { value: 'x' } });
    expect(fireEvent.keyDown(nome, { key: 'Enter', isComposing: true })).toBe(false);
    expect(screen.getByText('Pergunta 1 de 3')).toBeInTheDocument();
  });

  it('Próxima e Enviar respostas ficam desabilitados até a pergunta do passo estar respondida', async () => {
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    const nome = await campo('Qual o nome do produto?');
    // Pergunta vazia não avança.
    proxima();
    expect(screen.getByText('Pergunta 1 de 3')).toBeInTheDocument();
    fireEvent.change(nome, { target: { value: 'Checkout Fácil' } });
    proxima();
    expect(screen.getByText('Pergunta 2 de 3')).toBeInTheDocument();

    fireEvent.change((await campo('Quem são os usuários?')), {
      target: { value: 'Lojistas de pequeno porte' },
    });
    proxima();

    const botao = screen.getByRole('button', { name: 'Enviar respostas' });
    expect(botao).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Web' }));
    expect(botao).not.toBeDisabled();
  });

  it('envia as respostas com answerStructuredQuestion(projectId, sessionId, agent, questionSetId, answers)', async () => {
    answerStructuredQuestion.mockResolvedValue({ ok: true });
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    await preencherNomeEUsuarios();
    fireEvent.click(screen.getByRole('radio', { name: 'Web' }));

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

  it('AT-154: 409 sessao_encerrada diz que a sessão fechou, refaz a leitura dela e mantém o que foi digitado', async () => {
    answerStructuredQuestion.mockRejectedValue(
      Object.assign(new Error('409'), {
        status: 409,
        body: { message: 'A sessão está encerrada.', reason: 'sessao_encerrada', status: 'closed' },
      }),
    );
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    await preencherNomeEUsuarios('Checkout Fácil', 'Lojistas');
    fireEvent.click(screen.getByRole('radio', { name: 'Web' }));

    const leiturasAntes = getSession.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Enviar respostas' }));

    expect(
      await screen.findByText(
        'Esta sessão foi encerrada e não aceita mais mensagens. Abra uma sessão nova para continuar.',
      ),
    ).toBeInTheDocument();
    // Não é o erro genérico, e a sessão foi relida.
    expect(screen.queryByText('Não foi possível enviar as respostas')).not.toBeInTheDocument();
    await waitFor(() => expect(getSession.mock.calls.length).toBeGreaterThan(leiturasAntes));
    // As respostas continuam nos campos (o estado é do card).
    expect(screen.getByRole('radio', { name: 'Web' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await campo('Qual o nome do produto?')).toHaveValue('Checkout Fácil');
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
  it('escrever no campo ao lado das opções é a resposta, e nenhum sentinela viaja', async () => {
    answerStructuredQuestion.mockResolvedValue({ ok: true });
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    await preencherNomeEUsuarios('Checkout Fácil', 'Lojistas');
    expect(screen.getByRole('button', { name: 'Enviar respostas' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Sua resposta — Qual plataforma?'), {
      target: { value: 'Terminal de PDV' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar respostas' }));

    await waitFor(() => {
      expect(answerStructuredQuestion).toHaveBeenCalledWith('proj-1', ID, 'criativo', 'ev-perguntas', {
        nome: 'Checkout Fácil',
        usuarios: 'Lojistas',
        plataforma: 'Terminal de PDV',
      });
    });
  });

  it('escolher uma opção da lista descarta o texto livre', async () => {
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    await preencherNomeEUsuarios();
    const livre = screen.getByLabelText('Sua resposta — Qual plataforma?');
    fireEvent.change(livre, { target: { value: 'Terminal de PDV' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Web' }));

    expect(livre).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Web' })).toBeChecked();
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

    expect(await screen.findByRole('radio', { name: 'Sim' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Sua resposta/)).not.toBeInTheDocument();
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
function statusDoCriativo(seq: number, status: string) {
  return {
    id: `st-${seq}`,
    seq,
    type: 'agent.status',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { status },
    createdAt: '2026-08-10T12:00:02.000Z',
  };
}

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

    await preencherNomeEUsuarios('Checkout Fácil', 'Lojistas');
    fireEvent.click(screen.getByRole('radio', { name: 'Web' }));

    fireEvent.click(screen.getByRole('button', { name: 'Enviar respostas' }));
    await waitFor(() => expect(answerStructuredQuestion).toHaveBeenCalled());

    // Antes dos 5s nada aparece — a regra do indicador (RN-131) não mudou.
    expect(screen.queryByText('Pensando…')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText('Pensando…')).toBeInTheDocument();

    // A chamada resolve: é o ACEITE (ADR 0163), não o fim do turno — o log
    // ainda diz `working`, e o indicador fica. Até o ADR 0163 era aqui que
    // ele saía.
    cauda.mockResolvedValue({ items: [statusDoCriativo(3, 'working')], nextCursor: null });
    await act(async () => {
      resolver();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByText('Pensando…')).toBeInTheDocument();

    // O turno termina no log: o indicador sai.
    cauda.mockResolvedValue({
      items: [statusDoCriativo(3, 'working'), statusDoCriativo(7, 'idle')],
      nextCursor: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    await waitFor(() =>
      expect(screen.queryByText('Pensando…')).not.toBeInTheDocument(),
    );
  });

  it('CASO DE FALHA: erro no envio não deixa o indicador preso', async () => {
    answerStructuredQuestion.mockRejectedValue(new Error('rede caiu'));
    eventos.mockReturnValue({ items: [PERGUNTA] });

    montar();

    await preencherNomeEUsuarios('Checkout Fácil', 'Lojistas');
    fireEvent.click(screen.getByRole('radio', { name: 'Web' }));

    fireEvent.click(screen.getByRole('button', { name: 'Enviar respostas' }));
    await waitFor(() => expect(answerStructuredQuestion).toHaveBeenCalled());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.queryByText('Pensando…')).not.toBeInTheDocument();
  });
});
