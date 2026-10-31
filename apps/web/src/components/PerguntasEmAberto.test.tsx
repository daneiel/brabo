import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { OpenQuestion } from '../lib/api-types';
import i18n from '../lib/i18n';

const getOpenQuestions = vi.fn();
const answerOpenQuestion = vi.fn();
const getProjectPendingActions = vi.fn();
const listSessionEvents = vi.fn();
const getCodePullRequests = vi.fn();
const listBacklog = vi.fn();
let usuario: string | null = 'user-autor';

vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...original,
    getOpenQuestions: (...a: unknown[]) => getOpenQuestions(...a),
    answerOpenQuestion: (...a: unknown[]) => answerOpenQuestion(...a),
    getProjectPendingActions: (...a: unknown[]) => getProjectPendingActions(...a),
    listSessionEvents: (...a: unknown[]) => listSessionEvents(...a),
    getCodePullRequests: (...a: unknown[]) => getCodePullRequests(...a),
    listBacklog: (...a: unknown[]) => listBacklog(...a),
  };
});
vi.mock('../lib/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/auth')>();
  return { ...original, userIdDaSessao: () => usuario };
});

const { PendenciasDeOutrasSessoes } = await import('./PendenciasDeOutrasSessoes');
const { AvisoDePerguntasEmAberto } = await import('./PerguntasEmAberto');
const { ApiError } = await import('../lib/api-client');

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});
afterAll(() => {
  void i18n.changeLanguage('en');
});

function pergunta(id: string, over: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    questionId: id,
    eventId: `ev-${id}`,
    sessionId: 'sess-1',
    pergunta: `Pergunta ${id}?`,
    sugestao: `Sugestão ${id}`,
    afeta: { regras: ['r1'], historias: [], tarefas: [] },
    autor: 'criativo',
    criadaEm: new Date().toISOString(),
    status: 'open',
    autorDaSessao: 'user-autor',
    resposta: null,
    ...over,
  };
}

function montar(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const pendencias = () => (
  <PendenciasDeOutrasSessoes projectId="proj-1" sessionId="sess-1" podeDecidir />
);

beforeEach(() => {
  vi.clearAllMocks();
  usuario = 'user-autor';
  getProjectPendingActions.mockResolvedValue([]);
  listSessionEvents.mockResolvedValue({ items: [], nextCursor: null });
  getCodePullRequests.mockResolvedValue({ items: [] });
  listBacklog.mockResolvedValue([]);
  getOpenQuestions.mockResolvedValue({ itens: [pergunta('a'), pergunta('b')], total: 2 });
  answerOpenQuestion.mockResolvedValue({});
});

describe('Perguntas em aberto no chat (RN-861)', () => {
  it('fila própria com contagem própria; o autor responde e aceita a sugestão', async () => {
    montar(pendencias());
    const fila = await screen.findByTestId('fila-perguntas-em-aberto');
    expect(within(fila).getByRole('heading').textContent).toContain('Perguntas em aberto');
    expect(within(fila).getByRole('heading').textContent).toContain('2');
    expect(screen.getByText(/Perguntas em aberto 2/)).toBeTruthy();
    expect(getOpenQuestions).toHaveBeenCalledWith('proj-1', 'open');

    const [primeira, segunda] = screen.getAllByTestId('pergunta-em-aberto');
    expect(within(primeira!).getByText(/Criativo perguntou/)).toBeTruthy();
    fireEvent.change(within(primeira!).getByLabelText('Sua resposta'), {
      target: { value: 'Use Postgres' },
    });
    fireEvent.click(within(primeira!).getByRole('button', { name: 'Responder' }));
    await waitFor(() =>
      expect(answerOpenQuestion).toHaveBeenCalledWith('proj-1', 'a', { resposta: 'Use Postgres' }),
    );

    fireEvent.click(within(segunda!).getByRole('button', { name: 'Aceitar sugestão' }));
    await waitFor(() =>
      expect(answerOpenQuestion).toHaveBeenCalledWith('proj-1', 'b', { aceitarSugestao: true }),
    );
  });

  it('quem não é o autor da sessão vê o cartão com o controle inerte e o motivo em texto', async () => {
    usuario = 'outra-pessoa';
    montar(pendencias());
    const [primeira] = await screen.findAllByTestId('pergunta-em-aberto');
    expect(within(primeira!).getByText('Pergunta a?')).toBeTruthy();
    expect(
      (within(primeira!).getByRole('button', { name: 'Aceitar sugestão' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((within(primeira!).getByLabelText('Sua resposta') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(within(primeira!).getByText(/Só quem criou a sessão/)).toBeTruthy();
  });

  it('a recusa 409 mostra a frase da api', async () => {
    answerOpenQuestion.mockRejectedValue(
      new ApiError(409, { reason: 'pergunta_ja_respondida', message: 'A pergunta já foi respondida.' }),
    );
    montar(pendencias());
    const [primeira] = await screen.findAllByTestId('pergunta-em-aberto');
    fireEvent.click(within(primeira!).getByRole('button', { name: 'Aceitar sugestão' }));
    expect((await within(primeira!).findByRole('alert')).textContent).toBe(
      'A pergunta já foi respondida.',
    );
  });

  it('a tarefa que o gate estacionou aparece como esperando a resposta', async () => {
    getOpenQuestions.mockResolvedValue({
      itens: [pergunta('q', { autor: 'qa-agent', afeta: { regras: [], historias: [], tarefas: ['t1'] } })],
      total: 1,
    });
    listBacklog.mockResolvedValue([
      { id: 'e1', stories: [{ id: 's1', tasks: [{ id: 't1', title: 'Tela de login' }] }] },
    ]);
    montar(pendencias());
    expect((await screen.findByTestId('tarefa-esperando-resposta')).textContent).toContain(
      'Tela de login',
    );
  });

  it('o aviso do composer diz N e não bloqueia nada; some sem perguntas', async () => {
    montar(<AvisoDePerguntasEmAberto projectId="proj-1" />);
    const aviso = await screen.findByTestId('aviso-perguntas-em-aberto');
    expect(aviso.textContent).toContain('2 perguntas em aberto');
    expect((within(aviso).getByRole('button') as HTMLButtonElement).disabled).toBe(false);

    getOpenQuestions.mockResolvedValue({ itens: [], total: 0 });
    montar(<AvisoDePerguntasEmAberto projectId="proj-2" />);
    await waitFor(() => expect(getOpenQuestions).toHaveBeenCalledWith('proj-2', 'open'));
    expect(screen.getAllByTestId('aviso-perguntas-em-aberto')).toHaveLength(1);
  });
});
