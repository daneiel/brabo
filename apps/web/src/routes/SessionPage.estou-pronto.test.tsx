import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

/**
 * ADR 0185 (AT-311/AT-312): um clique só — "Estou pronto — a necessidade está
 * validada" — fecha a prontidão E o gate `necessidade-validada` (RN-657), e o
 * handoff ao PO que o turno oferecer é aceito em nome de quem clicou
 * (RN-658). O botão separado "Confirmar necessidade validada" (RN-406) saiu,
 * e o gesto de chamar o PO faz dele o destinatário do composer (RN-631).
 */

const getSession = vi.fn();
const confirmReadiness = vi.fn();

const CRIATIVO_ATIVO = {
  id: 'ev-criativo-ativo',
  seq: 1,
  type: 'agent.activated',
  actor: { kind: 'agent', id: 'criativo' },
  payload: { agent: 'criativo' },
  createdAt: '2026-08-17T12:00:00.000Z',
};

const REGRA = {
  id: 'ev-regra',
  seq: 2,
  type: 'artifact.business_rule',
  actor: { kind: 'agent', id: 'criativo' },
  payload: { title: 'Só maiores de 18', description: 'Idade >= 18', origin: [1] },
  createdAt: '2026-08-17T12:01:00.000Z',
};

const eventos = vi.fn<() => { items: unknown[] }>(() => ({
  items: [CRIATIVO_ATIVO],
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos(), isPending: false }),
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));
vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => undefined,
}));
vi.mock('../lib/auth', () => ({
  emailDaSessao: () => 'eu@brabo.dev',
  userIdDaSessao: () => 'eu',
}));

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
    activateExecution: vi.fn(),
    cancelAgentTurn: vi.fn(),
    acceptHandoff: vi.fn(),
    approveAction: vi.fn(),
    approveAlwaysAction: vi.fn(),
    confirmArchitectureReadiness: vi.fn(),
    confirmReadiness: (...args: unknown[]) => confirmReadiness(...args),
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
    createdAt: '2026-08-17T12:00:00.000Z',
    updatedAt: '2026-08-17T12:00:00.000Z',
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

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  window.localStorage.clear();
  eventos.mockReturnValue({ items: [CRIATIVO_ATIVO, REGRA] });
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const ROTULO = 'Estou pronto — a necessidade está validada';
const CHAVE_DO_DESTINATARIO = `brabo.destinatario.${ID}`;

describe('SessionPage — "Estou pronto — a necessidade está validada" (ADR 0185)', () => {
  it('um clique só: chama a prontidão, avisa que a necessidade ficou validada e chama o PO', async () => {
    confirmReadiness.mockResolvedValue({ ok: true });
    montar();

    fireEvent.click(await screen.findByRole('button', { name: ROTULO }));

    await waitFor(() => expect(confirmReadiness).toHaveBeenCalledWith('proj-1', ID));
    expect(
      await screen.findByText(
        'Necessidade validada. O PO entra quando o resumo do produto ficar pronto',
      ),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(CHAVE_DO_DESTINATARIO)).toBe('po');
    // O clique separado da RN-406 não existe mais.
    expect(
      screen.queryByRole('button', { name: 'Confirmar necessidade validada' }),
    ).not.toBeInTheDocument();
  });

  it('recusa do engine (422 sem regra): nada é dito como validado e o destinatário não muda', async () => {
    const { ApiError } = await import('../lib/api-client');
    confirmReadiness.mockRejectedValue(
      new ApiError(422, { message: 'ainda não há nenhuma regra de negócio registrada' }),
    );
    montar();

    fireEvent.click(await screen.findByRole('button', { name: ROTULO }));

    await waitFor(() => expect(confirmReadiness).toHaveBeenCalled());
    await screen.findByText(/ainda não há nenhuma regra de negócio registrada/);
    expect(
      screen.queryByText(
        'Necessidade validada. O PO entra quando o resumo do produto ficar pronto',
      ),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem(CHAVE_DO_DESTINATARIO)).toBeNull();
  });
});
