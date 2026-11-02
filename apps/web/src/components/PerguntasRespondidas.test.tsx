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

/**
 * RN-884 (AT-538): a pergunta respondida fica como cartão respondido, e a
 * história afetada ainda corrigível ganha "Corrigir a história" — que só
 * leva à aba Histórias, nunca aciona o PO.
 */
function backlogCom(status: string, tarefas: { status: string }[] = []) {
  return [
    {
      id: 'ep-1',
      title: 'Épico',
      stories: [
        {
          id: 'st-1',
          title: 'Cadastro de membros',
          status,
          tasks: tarefas.map((t, i) => ({ id: `t-${i}`, title: `T${i}`, ...t })),
        },
      ],
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  usuario = 'user-autor';
  getProjectPendingActions.mockResolvedValue([]);
  listSessionEvents.mockResolvedValue({ items: [], nextCursor: null });
  getCodePullRequests.mockResolvedValue({ items: [] });
  answerOpenQuestion.mockResolvedValue({});
});

async function responderA() {
  const p = pergunta('a', { afeta: { regras: [], historias: ['st-1'], tarefas: [] } });
  getOpenQuestions.mockResolvedValueOnce({ itens: [p], total: 1 });
  getOpenQuestions.mockResolvedValue({ itens: [], total: 0 });
  montar(pendencias());
  fireEvent.click(await screen.findByRole('button', { name: 'Aceitar sugestão' }));
  return screen.findByTestId('pergunta-respondida');
}

describe('Corrigir a história no cartão respondido (RN-884)', () => {
  it('caminho feliz: história draft sem tarefa em execução ganha o link para a aba Histórias', async () => {
    listBacklog.mockResolvedValue(backlogCom('draft', [{ status: 'todo' }]));
    const cartao = await responderA();
    const link = await within(cartao).findByTestId('corrigir-historia');
    expect(link.getAttribute('href')).toBe('/projects/proj-1?tab=backlog&historia=st-1');
    expect(link.textContent).toBe('Corrigir a história');
    expect(answerOpenQuestion).toHaveBeenCalledTimes(1);
  });

  it('falha: com tarefa em execução o botão não existe e o motivo é dito em texto', async () => {
    listBacklog.mockResolvedValue(backlogCom('draft', [{ status: 'in_progress' }]));
    const cartao = await responderA();
    await waitFor(() =>
      expect(within(cartao).getByTestId('corrigir-historia-inerte').textContent).toMatch(
        /tarefa em execução/,
      ),
    );
    expect(within(cartao).queryByTestId('corrigir-historia')).toBeNull();
  });
});
