import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { Session, SessionEvent } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

/**
 * O painel da sessão agrupa, ordena e diz o que não mostra
 * (RN-177/178/180/181).
 *
 * Os quatro vieram do USO no `exp001`, e nenhum sairia de teste: o painel
 * mostrava o começo de uma sessão como se fosse a sessão inteira, o log
 * escondia metade dos eventos sem oferecer alternativa, e o que a área faz por
 * dentro nunca chegava ao fio.
 */

const getSession = vi.fn();
const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const historico = vi.fn(() => historicoFalso(eventos().items));

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
    const destino = to.replace('$projectId', params?.projectId ?? '');
    const tab = (search as { tab?: string } | undefined)?.tab ?? '';
    return (
      <a href={`${destino}?tab=${tab}`} className={className}>
        {children}
      </a>
    );
  },
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEventHistory: () => historico(),
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

function evento(over: Partial<SessionEvent> & { seq: number }): SessionEvent {
  return {
    id: `ev-${over.seq}`,
    sessionId: ID,
    type: 'agent.response',
    actor: { kind: 'agent', id: 'po' },
    payload: {},
    createdAt: '2026-08-10T12:00:00.000Z',
    ...over,
  } as SessionEvent;
}

function regra(seq: number, titulo: string): SessionEvent {
  return evento({
    seq,
    id: `rn-${seq}`,
    type: 'artifact.business_rule',
    payload: { title: titulo, description: `descrição de ${titulo}`, origin: [] },
  });
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SessionPage projectId="proj-1" sessionId={ID} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** A região do `Disclosure` de uma seção do painel, pelo nome do cabeçalho. */
async function regiao(nome: RegExp) {
  const botao = await screen.findByRole('button', { name: nome });
  return within(document.getElementById(botao.getAttribute('aria-controls')!)!);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  eventos.mockReturnValue({ items: [] });
  historico.mockImplementation(() => historicoFalso(eventos().items));
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('RN-178 — as regras de negócio leem do último para o primeiro, e paginam', () => {
  it('a regra mais recente aparece primeiro', async () => {
    eventos.mockReturnValue({
      items: [regra(1, 'Regra antiga'), regra(2, 'Regra nova')],
    });

    montar();
    const secao = await regiao(/Regras de negócio/);
    const titulos = secao
      .getAllByText(/^Regra /)
      .map((el) => el.textContent);

    expect(titulos).toEqual(['Regra nova', 'Regra antiga']);
  });

  it('acima de 5, pagina — e a primeira página traz as 5 MAIS RECENTES', async () => {
    eventos.mockReturnValue({
      items: Array.from({ length: 7 }, (_, i) => regra(i + 1, `Regra ${i + 1}`)),
    });

    montar();
    const secao = await regiao(/Regras de negócio/);

    // Na primeira página não há para onde voltar — e é isso que prova que ela
    // é a página 1 de uma lista que começa pelo mais NOVO.
    expect(
      secao.getByRole('button', { name: /Página anterior/ }).hasAttribute('disabled'),
    ).toBe(true);
    expect(secao.getByText('Regra 7')).toBeTruthy();
    expect(secao.queryByText('Regra 2')).toBeNull();

    await userEvent.setup().click(
      secao.getByRole('button', { name: /Próxima página/ }),
    );
    expect(secao.getByText('Regra 2')).toBeTruthy();
    expect(secao.queryByText('Regra 7')).toBeNull();
  });

  it('com 5 ou menos, nenhum paginador — controle que não pagina nada é ruído', async () => {
    eventos.mockReturnValue({
      items: Array.from({ length: 5 }, (_, i) => regra(i + 1, `Regra ${i + 1}`)),
    });

    montar();
    const secao = await regiao(/Regras de negócio/);

    expect(secao.queryByRole('button', { name: /Próxima página/ })).toBeNull();
  });
});

describe('RN-180 — o painel diz o que não está mostrando', () => {
  it('com eventos anteriores à janela, a nota conta quantos faltam', async () => {
    // A sessão tem 41 eventos; o painel baixou do 42 em diante — os 41
    // primeiros não estão carregados, e o número sai de SUBTRAÇÃO sobre o
    // `seq`, nunca de uma requisição a mais.
    eventos.mockReturnValue({ items: [regra(42, 'Regra carregada')] });

    montar();

    expect(await screen.findByText(/41/)).toBeTruthy();
    expect(screen.getByText(/Carregar mais antigos/)).toBeTruthy();
  });

  it('CASO DE FALHA evitado: alcançando o começo da sessão, a nota não aparece', async () => {
    eventos.mockReturnValue({ items: [regra(1, 'Primeira regra')] });

    montar();
    await screen.findByText('Primeira regra');

    expect(screen.queryByText(/anteriores —/)).toBeNull();
  });

  it('o feed recebe o pager, que este call site nunca passou', async () => {
    eventos.mockReturnValue({ items: [regra(1, 'Uma regra')] });
    historico.mockImplementation(() =>
      historicoFalso(eventos().items, { temMaisAntigos: true }),
    );

    montar();
    await userEvent.setup().click(
      await screen.findByRole('button', { name: /Log de eventos/ }),
    );

    expect(
      screen.getByRole('button', { name: 'Carregar mais antigos' }),
    ).toBeTruthy();
  });
});

describe('RN-177 — o fio recolhe o histórico por origem', () => {
  /** Sete falas do PO, que viram sete entradas no fio. */
  function seteFalas() {
    return Array.from({ length: 7 }, (_, i) =>
      evento({
        seq: i + 1,
        id: `fala-${i + 1}`,
        type: 'agent.response',
        payload: { content: `fala numero ${i + 1}` },
      }),
    );
  }

  it('as últimas 5 ficam abertas; o resto entra num colapso por origem', async () => {
    eventos.mockReturnValue({ items: seteFalas() });

    montar();
    await screen.findByText('fala numero 7');

    expect(screen.getByText('fala numero 3')).toBeTruthy();
    // As duas mais antigas estão dentro de um `Disclosure` FECHADO — e ele não
    // monta o que está fechado, então elas nem existem no DOM.
    expect(screen.queryByText('fala numero 1')).toBeNull();

    const grupo = screen.getByRole('button', { name: /LLM/ });
    expect(grupo.textContent).toContain('2');
    await userEvent.setup().click(grupo);
    expect(screen.getByText('fala numero 1')).toBeTruthy();
  });

  it('conversa curta não ganha colapso nenhum', async () => {
    eventos.mockReturnValue({ items: seteFalas().slice(0, 4) });

    montar();
    await screen.findByText('fala numero 4');

    expect(screen.getByText('fala numero 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^LLM/ })).toBeNull();
  });
});

describe('RN-181 — delegação de área aparece no fio', () => {
  it('conclusão, falha e dispensa de subagente são narradas', async () => {
    eventos.mockReturnValue({
      items: [
        evento({
          seq: 1,
          id: 'del-1',
          type: 'delegation.completed',
          actor: { kind: 'agent', id: 'qa' },
          payload: { subagent: 'qa-automacao', area: 'qa' },
        }),
        evento({
          seq: 2,
          id: 'del-2',
          type: 'delegation.failed',
          actor: { kind: 'agent', id: 'qa' },
          payload: { subagent: 'qa-performance', area: 'qa', failureOrigin: 'infra' },
        }),
        evento({
          seq: 3,
          id: 'del-3',
          type: 'delegation.dispensed',
          actor: { kind: 'agent', id: 'qa' },
          payload: { subagent: 'qa-seguranca', area: 'qa', justification: 'sem código novo' },
        }),
      ],
    });

    montar();

    expect(await screen.findByText(/concluiu a delegação/)).toBeTruthy();
    // A ORIGEM da falha viaja junto — é ela que diz qual é o próximo passo.
    expect(screen.getByText(/falhou — origem: infra/)).toBeTruthy();
    expect(screen.getByText(/dispensada — sem código novo/)).toBeTruthy();
  });
});
