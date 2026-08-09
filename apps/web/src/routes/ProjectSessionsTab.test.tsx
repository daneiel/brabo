import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProjectSessionsTab } from './ProjectSessionsTab';
import type { ProposedAction, Session } from '../lib/api-types';

const listSessions = vi.fn();
const listActions = vi.fn();
const createSession = vi.fn();
const transitionSession = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../lib/api-client', () => ({
  listSessions: (...args: unknown[]) => listSessions(...args),
  listActions: (...args: unknown[]) => listActions(...args),
  createSession: (...args: unknown[]) => createSession(...args),
  transitionSession: (...args: unknown[]) => transitionSession(...args),
}));

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

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectSessionsTab projectId="proj-1" />
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

  it('o total do projeto separa clique humano de política', async () => {
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
        /3 ação\(ões\) proposta\(s\) no projeto · 1 decidida\(s\) por você · 1 auto-aprovada\(s\) pela política · 1 aguardando/,
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
 * FASE 20 — a escolha do tipo acontece ANTES de a sessão existir.
 *
 * O pedido do usuário foi de clareza: "o processo de ter que selecionar o
 * botão acima para iniciar o criativo não ficou claro o suficiente". A
 * resposta não é um texto de ajuda ao lado do botão antigo — é a escolha mudar
 * de lugar, para o momento em que ela é feita.
 */
describe('ProjectSessionsTab — tipo e nome na criação', () => {
  beforeEach(() => {
    listSessions.mockResolvedValue([]);
    listActions.mockResolvedValue({ items: [], nextCursor: null });
    createSession.mockResolvedValue({ id: 'nova-sessao' });
    transitionSession.mockResolvedValue({});
  });

  it('as duas opções aparecem EXPLICADAS antes de a sessão existir', async () => {
    montar();
    await screen.findByText('Sessões');

    fireEvent.click(screen.getByRole('button', { name: '+ Nova sessão' }));

    // O rótulo sozinho ("Criativa") não bastaria: o que faltava era saber o
    // que a escolha implica.
    expect(screen.getByLabelText(/Criativa/)).toBeTruthy();
    expect(screen.getByText(/abre a ideação com o Criativo/)).toBeTruthy();
    expect(screen.getByText(/Nenhum agente é ativado sozinho/)).toBeTruthy();
  });

  it('caminho feliz: o tipo escolhido e o nome vão no corpo', async () => {
    montar();
    await screen.findByText('Sessões');
    fireEvent.click(screen.getByRole('button', { name: '+ Nova sessão' }));

    fireEvent.click(screen.getByLabelText(/Consultiva/));
    fireEvent.change(screen.getByLabelText('Nome (opcional)'), {
      target: { value: 'Dúvidas de billing' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Abrir sessão consultiva/ }),
    );

    await vi.waitFor(() => expect(createSession).toHaveBeenCalled());
    expect(createSession).toHaveBeenCalledWith('proj-1', {
      kind: 'consultiva',
      name: 'Dúvidas de billing',
    });
  });

  it('nome em branco NÃO vai no corpo — ausência é null no banco', async () => {
    montar();
    await screen.findByText('Sessões');
    fireEvent.click(screen.getByRole('button', { name: '+ Nova sessão' }));
    fireEvent.change(screen.getByLabelText('Nome (opcional)'), {
      target: { value: '   ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Abrir sessão criativa/ }),
    );

    await vi.waitFor(() => expect(createSession).toHaveBeenCalled());
    expect(createSession).toHaveBeenCalledWith('proj-1', {
      kind: 'criativa',
      name: undefined,
    });
  });

  it('a lista mostra o nome COM a hashtag, e o tipo de cada sessão', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z', {
        kind: 'criativa',
        name: 'Checkout do carrinho',
      }),
      sessao('22222222-bbbb', '2026-08-02T00:00:00.000Z'),
    ]);

    montar();

    // A hashtag NUNCA some (RN-098): é ela que se cola numa URL.
    expect(
      await screen.findByText('Checkout do carrinho · #11111111'),
    ).toBeTruthy();
    // E sem nome, degrada para a hashtag sozinha.
    expect(await screen.findByText('#22222222')).toBeTruthy();
    expect(screen.getByText('Criativa')).toBeTruthy();
    expect(screen.getByText('Consultiva')).toBeTruthy();
  });
});
