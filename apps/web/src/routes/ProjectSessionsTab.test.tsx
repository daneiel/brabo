import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  ProjectChatTab,
  ProjectCriativoTab,
  ProjectSessionsTab,
} from './ProjectSessionsTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import type { ProposedAction, Session, SessionKind } from '../lib/api-types';

const listSessions = vi.fn();
const listActions = vi.fn();
const createSession = vi.fn();
const transitionSession = vi.fn();
const renameSession = vi.fn();
const getActiveExecutionSession = vi.fn();

// Um SÓ mock de navegação, compartilhado entre chamadas de `useNavigate` —
// é o que permite os testes de "não navega ao editar" / "navega fora do
// controle" afirmarem sobre a MESMA função que o componente chamou.
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
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
    renameSession: (...args: unknown[]) => renameSession(...args),
    getActiveExecutionSession: (...args: unknown[]) => getActiveExecutionSession(...args),
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
      <ToastProvider>
        <ProjectSessionsTab projectId="proj-1" kind={kind} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function montarAba(Aba: typeof ProjectChatTab) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Aba projectId="proj-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // `navigateMock` também é `vi.fn()`: `clearAllMocks` já limpa as chamadas
  // dele entre testes.
  vi.clearAllMocks();
  // Default: nenhuma execução vigente. Os testes de RN-141 sobrescrevem isto
  // quando precisam de uma sessão de execução de verdade.
  getActiveExecutionSession.mockResolvedValue(null);
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
 * A lacuna que RN-098 deixava: renomear só era alcançável DENTRO da sessão
 * (`SessionPage.tsx`). Aqui o mesmo mecanismo — rascunho inline, Enter
 * confirma, Esc desiste — fica alcançável a partir da LISTA, sem abrir a
 * sessão primeiro. `renameSession` é o mesmo `PATCH` que `SessionPage.tsx`
 * já chama; nenhum endpoint novo.
 */
describe('ProjectSessionsTab — renomear direto da lista', () => {
  beforeEach(() => {
    listActions.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('editar e confirmar com Enter chama renameSession e o rótulo novo aparece', async () => {
    listSessions
      .mockResolvedValueOnce([
        sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z'),
      ])
      // Depois de renomear, a invalidação refaz a busca — é ESTE retorno
      // que prova que a tela lê a mesma fonte que `SessionPage` usaria.
      .mockResolvedValueOnce([
        sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z', {
          name: 'Onboarding',
        }),
      ]);
    renameSession.mockResolvedValue({ id: '11111111-aaaa' });

    montar();

    const botao = await screen.findByTitle(/clique para renomear/);
    fireEvent.click(botao);

    const campo = screen.getByLabelText('Nome da sessão');
    fireEvent.change(campo, { target: { value: 'Onboarding' } });
    fireEvent.keyDown(campo, { key: 'Enter' });

    await vi.waitFor(() =>
      expect(renameSession).toHaveBeenCalledWith(
        'proj-1',
        '11111111-aaaa',
        'Onboarding',
      ),
    );
    expect(await screen.findByText('Onboarding · #11111111')).toBeTruthy();
  });

  it('clicar no controle de edição (nome ou lápis) NÃO navega pra dentro da sessão', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z'),
    ]);

    montar();

    const botao = await screen.findByTitle(/clique para renomear/);
    fireEvent.click(botao);
    expect(navigateMock).not.toHaveBeenCalled();

    // O campo aberto também não navega ao ser clicado — é o que evita
    // posicionar o cursor E entrar na sessão no mesmo clique.
    const campo = screen.getByLabelText('Nome da sessão');
    fireEvent.click(campo);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('clicar fora do controle de edição (na linha) continua navegando', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z'),
    ]);

    montar();

    // `status` do dublê de sessão é `closed` por padrão — clicar no badge
    // é clicar na LINHA, fora do controle de renomear.
    fireEvent.click(await screen.findByText('closed'));

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/projects/$projectId/sessions/$sessionId',
      params: { projectId: 'proj-1', sessionId: '11111111-aaaa' },
    });
  });

  it('Esc desiste da edição sem chamar renameSession', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z'),
    ]);

    montar();

    fireEvent.click(await screen.findByTitle(/clique para renomear/));
    const campo = screen.getByLabelText('Nome da sessão');
    fireEvent.change(campo, { target: { value: 'Rascunho perdido' } });
    fireEvent.keyDown(campo, { key: 'Escape' });

    expect(screen.queryByLabelText('Nome da sessão')).toBeNull();
    expect(renameSession).not.toHaveBeenCalled();
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
 * RN-141 — a sessão de execução VIGENTE não aparece na aba Criativo.
 *
 * Ela nasce `kind: 'criativa'` (RN-097 exige isso para `execution.activated`
 * ser aceito), então o filtro por `kind` sozinho não bastava: uma sessão com
 * dezenas de eventos de tool-call de dev agent aparecia misturada na lista ao
 * lado de ideações de verdade, parecendo "o dev escrevendo no chat do
 * Criativo" — achado de investigação de código + teste ao vivo. A correção
 * reusa `useActiveExecutionSession`/`GET /projects/:projectId/execution/session`
 * (RN-139, já existente para a aba Executores) em vez de o backend calcular
 * um campo novo por sessão: mais barato, e cobre a vigente, que é o caso que
 * confunde de verdade — uma execução ANTIGA já `closed` aparece com o badge
 * `closed`, bem menos ambígua.
 */
describe('ProjectSessionsTab — a sessão de execução vigente não aparece', () => {
  beforeEach(() => {
    listActions.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('some da lista quando é a vigente, sessões criativas normais continuam', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z', {
        kind: 'criativa',
        name: 'Ideação de verdade',
      }),
      sessao('22222222-bbbb', '2026-08-02T00:00:00.000Z', {
        kind: 'criativa',
        name: 'Execução em andamento',
        status: 'active',
      }),
    ]);
    getActiveExecutionSession.mockResolvedValue(
      sessao('22222222-bbbb', '2026-08-02T00:00:00.000Z', {
        kind: 'criativa',
        status: 'active',
      }),
    );

    montarAba(ProjectCriativoTab);

    expect(
      await screen.findByText('Ideação de verdade · #11111111'),
    ).toBeTruthy();
    expect(screen.queryByText(/Execução em andamento/)).toBeNull();
  });

  it('sessões de chat continuam aparecendo mesmo com execução vigente no projeto', async () => {
    listSessions.mockResolvedValue([
      sessao('33333333-cccc', '2026-08-03T00:00:00.000Z', {
        kind: 'consultiva',
        name: 'Dúvida rápida',
      }),
      sessao('44444444-dddd', '2026-08-04T00:00:00.000Z', {
        kind: 'criativa',
        status: 'active',
      }),
    ]);
    getActiveExecutionSession.mockResolvedValue(
      sessao('44444444-dddd', '2026-08-04T00:00:00.000Z', {
        kind: 'criativa',
        status: 'active',
      }),
    );

    montarAba(ProjectChatTab);

    expect(await screen.findByText('Dúvida rápida · #33333333')).toBeTruthy();
    // A aba Chat nem deveria ter chamado a busca de execução vigente — ela é
    // só da aba Criativo (query `enabled: false` quando `kind !== 'criativa'`).
    expect(getActiveExecutionSession).not.toHaveBeenCalled();
  });

  it('sem execução vigente (`null`), a lista Criativo mostra tudo normalmente', async () => {
    listSessions.mockResolvedValue([
      sessao('55555555-eeee', '2026-08-05T00:00:00.000Z', {
        kind: 'criativa',
        name: 'Só ideação',
      }),
    ]);
    getActiveExecutionSession.mockResolvedValue(null);

    montarAba(ProjectCriativoTab);

    expect(await screen.findByText('Só ideação · #55555555')).toBeTruthy();
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
