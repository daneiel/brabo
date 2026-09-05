import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Handoff, Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de `SessionPage.handoff-inline-e-links.
// test.tsx`): as asserções abaixo esperam texto em pt-BR, e `en` é o idioma
// DEFAULT.
import i18n from '../lib/i18n';

/**
 * D0 / RN-499 — o handoff da INFRA passa a ser aceitável por uma tela.
 *
 * O bug: `offeredHandoff` (`SessionPage.tsx`) filtra por `AGENTES_DE_CHAT`
 * (RN-136), que não inclui `infra`, e `acceptHandoff` tinha UM consumidor
 * só — o card do fio, atrás desse filtro. O comentário do próprio código
 * dizia, com todas as letras, que Infra "nunca é aceito por AQUI … na
 * prática, nunca". Consequência: `OfferInfraHandoffUseCase` oferecia o
 * handoff, ele ficava `offered` para sempre, o Infra Lead nunca era
 * ativado e `propose_container_start` nunca acontecia — a cadeia inteira
 * até um container `running` era inalcançável.
 *
 * A correção NÃO alarga `AGENTES_DE_CHAT` (o filtro está certo: Infra não
 * tem cláusula de `message` no engine). É um card PRÓPRIO, fora do fio, na
 * faixa que já hospeda o handoff manual — a mesma que declara ser o lugar
 * das ações de handoff que não são conversa.
 */

const getSession = vi.fn();
const acceptHandoff = vi.fn();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const handoffsMock = vi.fn<() => Handoff[]>(() => []);

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
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: handoffsMock() }),
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
  acceptHandoff: (...args: unknown[]) => acceptHandoff(...args),
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
    createdAt: '2026-09-04T12:00:00.000Z',
    updatedAt: '2026-09-04T12:00:00.000Z',
    closedAt: null,
    ...over,
  } as Session;
}

function handoff(over: Partial<Handoff> = {}): Handoff {
  return {
    id: 'handoff-infra',
    sessionId: ID,
    projectId: 'proj-1',
    fromAgent: 'arquiteto',
    toAgent: 'infra',
    artifactId: null,
    status: 'offered',
    createdAt: '2026-09-04T12:00:00.000Z',
    updatedAt: '2026-09-04T12:00:00.000Z',
    ...over,
  } as Handoff;
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

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  eventos.mockReturnValue({ items: [] });
  handoffsMock.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
  acceptHandoff.mockResolvedValue(undefined);
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('SessionPage — card acionável do handoff da Infra (RN-499)', () => {
  const EVENTO_OFERTA = {
    id: 'ev-1',
    seq: 1,
    type: 'handoff.offered',
    actor: { kind: 'agent', id: 'arquiteto' },
    payload: { toAgent: 'infra' },
    createdAt: '2026-09-04T12:00:00.000Z',
  };

  it('com handoff `offered` pra infra e o agente não ativo, o card aparece e o clique aceita com os ids certos', async () => {
    handoffsMock.mockReturnValue([handoff()]);
    eventos.mockReturnValue({ items: [EVENTO_OFERTA] });

    montar();

    const botao = await screen.findByRole('button', {
      name: 'Aceitar handoff da Infra',
    });

    // O card DIZ o que o aceite significa — a consequência não é óbvia, e
    // aceitar não sobe container nenhum sozinho.
    expect(screen.getByText(/vai PROPOR a subida do container/)).toBeInTheDocument();
    expect(screen.getByText('Arquiteto passou o bastão à Infra')).toBeInTheDocument();

    fireEvent.click(botao);
    expect(acceptHandoff).toHaveBeenCalledWith('proj-1', ID, 'handoff-infra');
  });

  it('o handoff da Infra continua NARRADO no fio como divisor mudo — o card novo não vira card no fio', async () => {
    handoffsMock.mockReturnValue([handoff()]);
    eventos.mockReturnValue({ items: [EVENTO_OFERTA] });

    montar();

    // O divisor do fio segue lá, com a frase de sempre...
    expect(await screen.findByText('passou o bastão ao')).toBeInTheDocument();
    // ...e sem o botão do card do FIO (`aceitarEIniciar`), que continua
    // restrito a `AGENTES_DE_CHAT` (RN-136).
    expect(
      screen.queryByRole('button', { name: /Aceitar handoff e iniciar/ }),
    ).not.toBeInTheDocument();
  });

  it('com o Infra já ativo (handoff aceito e `agent.activated`), o card não aparece', async () => {
    handoffsMock.mockReturnValue([handoff({ status: 'accepted' })]);
    eventos.mockReturnValue({
      items: [
        EVENTO_OFERTA,
        {
          id: 'ev-2',
          seq: 2,
          type: 'agent.activated',
          actor: { kind: 'agent', id: 'infra' },
          payload: { agent: 'infra' },
          createdAt: '2026-09-04T12:00:01.000Z',
        },
      ],
    });

    montar();

    await screen.findByText('passou o bastão ao');
    expect(
      screen.queryByRole('button', { name: 'Aceitar handoff da Infra' }),
    ).not.toBeInTheDocument();
  });

  it('handoff da Infra ainda `offered` mas com o agente JÁ ativo nesta sessão não reabre o convite', async () => {
    // O status do handoff e o roster derivado dos eventos podem divergir por
    // um poll; `activeFor` é o mesmo predicado que o card do fio usa, e ele
    // é quem fecha o card.
    handoffsMock.mockReturnValue([handoff()]);
    eventos.mockReturnValue({
      items: [
        EVENTO_OFERTA,
        {
          id: 'ev-2',
          seq: 2,
          type: 'agent.activated',
          actor: { kind: 'agent', id: 'infra' },
          payload: { agent: 'infra' },
          createdAt: '2026-09-04T12:00:01.000Z',
        },
      ],
    });

    montar();

    await screen.findByText('passou o bastão ao');
    expect(
      screen.queryByRole('button', { name: 'Aceitar handoff da Infra' }),
    ).not.toBeInTheDocument();
  });

  it('sessão não-ativa não oferece o card (não há o que aceitar numa sessão fechada)', async () => {
    getSession.mockResolvedValue(sessao({ status: 'closed' }));
    handoffsMock.mockReturnValue([handoff()]);
    eventos.mockReturnValue({ items: [EVENTO_OFERTA] });

    montar();

    await screen.findByText('passou o bastão ao');
    expect(
      screen.queryByRole('button', { name: 'Aceitar handoff da Infra' }),
    ).not.toBeInTheDocument();
  });
});

describe('SessionPage — não-regressão: o card do Dev Lead segue como era (RN-136)', () => {
  /**
   * `OfferInfraHandoffUseCase` oferece Infra ANTES de Dev Lead, na mesma
   * confirmação, e `handoffs` vem ordenado por `createdAt` ASC. É
   * literalmente o cenário que a RN-136 consertou: um `.find()` mal
   * ajustado voltaria a resolver `offeredHandoff` pro mais antigo pendente
   * (Infra) e o card do Dev Lead sumiria de novo.
   */
  const HANDOFF_INFRA = handoff({
    id: 'handoff-infra',
    createdAt: '2026-09-04T12:00:00.000Z',
  });
  const HANDOFF_DEV_LEAD = handoff({
    id: 'handoff-devlead',
    toAgent: 'dev-lead',
    createdAt: '2026-09-04T12:00:01.000Z',
  });

  it('com Infra (mais antigo) e Dev Lead (mais novo) pendentes, os DOIS cards aparecem, cada um com seu botão', async () => {
    handoffsMock.mockReturnValue([HANDOFF_INFRA, HANDOFF_DEV_LEAD]);
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'arquiteto' },
          payload: { toAgent: 'infra' },
          createdAt: '2026-09-04T12:00:00.000Z',
        },
        {
          id: 'ev-2',
          seq: 2,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'arquiteto' },
          payload: { toAgent: 'dev-lead' },
          createdAt: '2026-09-04T12:00:01.000Z',
        },
      ],
    });

    montar();

    // O card do fio continua resolvendo pro DEV LEAD, não pro Infra.
    const botaoDevLead = await screen.findByRole('button', {
      name: 'Aceitar handoff e iniciar dev-lead',
    });
    // ...com o link de Executores que a RN-125 embutiu nele.
    expect(
      screen.getByRole('link', { name: /Acompanhe a execução em Executores/ }),
    ).toHaveAttribute('href', '/projects/proj-1?tab=executores');

    // E o card NOVO da Infra convive com ele, sem substituí-lo.
    const botaoInfra = screen.getByRole('button', {
      name: 'Aceitar handoff da Infra',
    });

    fireEvent.click(botaoInfra);
    expect(acceptHandoff).toHaveBeenCalledWith('proj-1', ID, 'handoff-infra');

    fireEvent.click(botaoDevLead);
    expect(acceptHandoff).toHaveBeenCalledWith('proj-1', ID, 'handoff-devlead');
  });
});
