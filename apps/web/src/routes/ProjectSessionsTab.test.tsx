import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  ProjectChatTab,
  ProjectCriativoTab,
  ProjectSessionsTab,
} from './ProjectSessionsTab';
import type { ProposedAction, Session, SessionKind } from '../lib/api-types';

const listSessions = vi.fn();
const listActions = vi.fn();
const createSession = vi.fn();
const transitionSession = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../lib/api-client', async () => {
  // `ApiError`/`mensagemDaApi` REAIS: é deles que sai a frase da api no estado
  // de erro (RN-088). Dublê deles provaria só que o componente chama uma
  // função.
  const real =
    await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    listSessions: (...args: unknown[]) => listSessions(...args),
    listActions: (...args: unknown[]) => listActions(...args),
    createSession: (...args: unknown[]) => createSession(...args),
    transitionSession: (...args: unknown[]) => transitionSession(...args),
  };
});

function sessao(
  id: string,
  createdAt: string,
  over: Partial<Session> = {},
): Session {
  return {
    id,
    projectId: 'proj-1',
    createdBy: 'user-1',
    status: 'closed',
    // FASE 20: `kind` e `name` são campos reais da sessão, e o `as Session`
    // do fim deixaria de pegar a ausência deles — a lista lê os dois.
    kind: 'consultiva',
    name: null,
    nextSeq: 1,
    createdAt,
    updatedAt: createdAt,
    closedAt: null,
    ...over,
  } as Session;
}

function acao(over: Partial<ProposedAction>): ProposedAction {
  return {
    id: 'act',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'git_commit',
    payload: {},
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...over,
  } as ProposedAction;
}

function montar(kind: SessionKind = 'consultiva') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectSessionsTab projectId="proj-1" kind={kind} />
    </QueryClientProvider>,
  );
}

function montarAba(Aba: typeof ProjectChatTab) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Aba projectId="proj-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Achado #16 do primeiro dogfooding: nenhuma tela somava aprovações por
 * sessão. `usePendingActions` exige um `sessionId`, e os três chamadores
 * passavam o da sessão MAIS RECENTE — uma decisão esquecida numa sessão
 * anterior ficava invisível para sempre.
 */
describe('ProjectSessionsTab — aprovações por sessão', () => {
  it('soma cada sessão, não só a última', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z'),
      sessao('22222222-bbbb', '2026-08-02T00:00:00.000Z'),
    ]);
    listActions.mockImplementation((_p: string, sessionId: string) =>
      Promise.resolve({
        items:
          sessionId === '11111111-aaaa'
            ? [acao({ id: 'a', status: 'pending' })]
            : [acao({ id: 'b', status: 'executed', decidedBy: 'user-1' })],
        nextCursor: null,
      }),
    );

    montar();

    // A sessão ANTIGA tem uma pendência — e ela aparece, que é o ponto.
    expect(
      await screen.findByText('1 aguardando · 0 decidida(s) por você'),
    ).toBeTruthy();
    // E a mais recente mostra a decisão que já foi tomada, na mesma lista.
    expect(
      await screen.findByText('1 decidida(s) por você · 0 auto'),
    ).toBeTruthy();
  });

  it('o total separa clique humano de política', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z'),
    ]);
    listActions.mockResolvedValue({
      items: [
        acao({ id: 'a', status: 'executed', decidedBy: 'user-1' }),
        acao({ id: 'b', status: 'executed', resolvedPolicy: 'auto_approve' }),
        acao({ id: 'c', status: 'pending' }),
      ],
      nextCursor: null,
    });

    montar();

    expect(
      await screen.findByText(
        /3 ação\(ões\) proposta\(s\) nestas sessões · 1 decidida\(s\) por você · 1 auto-aprovada\(s\) pela política · 1 aguardando/,
      ),
    ).toBeTruthy();
  });

  it('sessão sem ação nenhuma não ganha resumo', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z'),
    ]);
    listActions.mockResolvedValue({ items: [], nextCursor: null });

    montar();

    expect(await screen.findByText('#11111111')).toBeTruthy();
    expect(screen.queryByText(/decidida\(s\) por você/)).toBeNull();
  });
});

/**
 * FASE 24 — o tipo da sessão virou LUGAR (RN-104).
 *
 * O pedido do usuário: "deveriam ser duas abas distintas, ou seja uma
 * Criativo/Chat". O que estes testes prendem é a consequência dele: cada aba
 * lista o `kind` GRAVADO (RN-097) e cria naquele `kind`, sem perguntar.
 *
 * O teste que mata a mutação óbvia é o par de baixo: apagar o `.filter` faz os
 * dois primeiros morrerem, porque cada um afirma tanto o que APARECE quanto o
 * que NÃO aparece.
 */
describe('ProjectSessionsTab — cada aba é um tipo', () => {
  beforeEach(() => {
    listActions.mockResolvedValue({ items: [], nextCursor: null });
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z', {
        kind: 'criativa',
        name: 'Checkout do carrinho',
      }),
      sessao('22222222-bbbb', '2026-08-02T00:00:00.000Z', {
        kind: 'consultiva',
        name: 'Dúvidas de billing',
      }),
    ]);
  });

  it('a aba Criativo lista só as criativas', async () => {
    montarAba(ProjectCriativoTab);

    // A hashtag NUNCA some (RN-098): é ela que se cola numa URL.
    expect(
      await screen.findByText('Checkout do carrinho · #11111111'),
    ).toBeTruthy();
    // A consultiva NÃO está aqui — é isto que a aba significa.
    expect(screen.queryByText(/Dúvidas de billing/)).toBeNull();
  });

  it('a aba Chat lista só as consultivas', async () => {
    montarAba(ProjectChatTab);

    expect(
      await screen.findByText('Dúvidas de billing · #22222222'),
    ).toBeTruthy();
    expect(screen.queryByText(/Checkout do carrinho/)).toBeNull();
  });

  it('a aba NÃO pergunta o tipo de novo — ele é o lugar', async () => {
    montarAba(ProjectCriativoTab);
    await screen.findByText('Criativo');

    fireEvent.click(screen.getByRole('button', { name: '+ Nova ideação' }));

    // O `fieldset` de tipo da FASE 20 não existe mais nesta tela: escolher de
    // novo seria oferecer a chance de contradizer a aba em que se está.
    expect(screen.queryByLabelText(/Consultiva/)).toBeNull();
    expect(screen.queryByLabelText(/Criativa/)).toBeNull();
    // O que sobrou é o nome, que continua opcional.
    expect(screen.getByLabelText('Nome (opcional)')).toBeTruthy();
  });

  it('caminho feliz: o CTA cria com o kind da ABA', async () => {
    createSession.mockResolvedValue({ id: 'nova-sessao' });
    transitionSession.mockResolvedValue({});

    montarAba(ProjectCriativoTab);
    await screen.findByText('Criativo');
    fireEvent.click(screen.getByRole('button', { name: '+ Nova ideação' }));
    fireEvent.change(screen.getByLabelText('Nome (opcional)'), {
      target: { value: 'Onboarding' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir sessão criativa' }),
    );

    await vi.waitFor(() => expect(createSession).toHaveBeenCalled());
    expect(createSession).toHaveBeenCalledWith('proj-1', {
      kind: 'criativa',
      name: 'Onboarding',
    });
  });

  it('na aba Chat o mesmo CTA cria CONSULTIVA, e nome em branco não vai no corpo', async () => {
    createSession.mockResolvedValue({ id: 'nova-sessao' });
    transitionSession.mockResolvedValue({});

    montarAba(ProjectChatTab);
    await screen.findByText('Chat');
    fireEvent.click(screen.getByRole('button', { name: '+ Nova conversa' }));
    fireEvent.change(screen.getByLabelText('Nome (opcional)'), {
      target: { value: '   ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir sessão consultiva' }),
    );

    await vi.waitFor(() => expect(createSession).toHaveBeenCalled());
    // Nome em branco é `undefined`: ausência vira `null` no banco (RN-098).
    expect(createSession).toHaveBeenCalledWith('proj-1', {
      kind: 'consultiva',
      name: undefined,
    });
  });
});

/**
 * Os TRÊS estados, com ERRO antes de VAZIO (RN-088).
 *
 * A ordem é a regra, não um detalhe de escrita: a lista filtrada está vazia
 * nos dois casos, e dizer "nenhuma ideação ainda" depois de um 429 seria
 * mentir sobre o que aconteceu.
 */
describe('ProjectSessionsTab — carregando, erro e vazio', () => {
  beforeEach(() => {
    listActions.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('carregando não é vazio: mostra esqueleto e não a frase de vazio', async () => {
    listSessions.mockReturnValue(new Promise(() => {}));

    montarAba(ProjectCriativoTab);
    await screen.findByText('Criativo');

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Nenhuma ideação ainda/)).toBeNull();
  });

  it('CASO DE FALHA: erro DIZ o que a api respondeu, e não vira "nenhuma sessão"', async () => {
    const { ApiError } =
      await vi.importActual<typeof import('../lib/api-client')>(
        '../lib/api-client',
      );
    listSessions.mockRejectedValue(
      new ApiError(
        429,
        { message: 'Limite de requisições excedido, tente em instantes' },
        'trace-abc',
      ),
    );

    montarAba(ProjectChatTab);

    expect(
      await screen.findByText(
        'Não foi possível carregar as sessões deste projeto.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/Limite de requisições excedido/),
    ).toBeTruthy();
    // O vazio é o que ELE não pode ser.
    expect(screen.queryByText(/Nenhuma conversa ainda/)).toBeNull();
  });

  it('vazio de verdade fala do tipo da aba', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z', { kind: 'criativa' }),
    ]);

    montarAba(ProjectChatTab);

    // Há sessão no projeto — só não deste tipo.
    expect(await screen.findByText(/Nenhuma conversa ainda/)).toBeTruthy();
  });
});
