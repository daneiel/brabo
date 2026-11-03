import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

/**
 * A garantia de VERDADE é o guardrail no engine: `CriativoServer` recusa
 * `confirm_readiness` (e narra a recusa como `agent.error` no fio, com
 * origem "politica") quando a sessão não tem nenhuma
 * `artifact.business_rule` — ver criativo_server.ex. Este arquivo cobre só a
 * UX complementar: o botão "Estou pronto — a necessidade está validada" nasce `disabled`
 * (com a dica em `title`) sem regra nenhuma, e libera assim que a MESMA
 * fonte que já alimenta o painel "Regras de negócio" (session-events) tem
 * pelo menos uma.
 */

const getSession = vi.fn();
const papel = vi.fn(() => 'developer');

const EVENTO_CRIATIVO_ATIVO = {
  id: 'e0',
  seq: 1,
  type: 'agent.activated',
  actor: { kind: 'agent', id: 'criativo' },
  payload: { agent: 'criativo' },
  createdAt: '2026-08-11T12:00:00.000Z',
};

const EVENTO_REGRA_DE_NEGOCIO = {
  id: 'e1',
  seq: 2,
  type: 'artifact.business_rule',
  actor: { kind: 'agent', id: 'criativo' },
  payload: { title: 'Só maiores de 18', description: 'Idade >= 18', origin: [1] },
  createdAt: '2026-08-11T12:00:30.000Z',
};

const eventos = vi.fn<() => { items: unknown[] }>(() => ({
  items: [EVENTO_CRIATIVO_ATIVO],
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
  useCurrentWorkspaceWithRole: () => ({ data: { role: papel(), workspace: { id: 'ws-1' } } }),
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

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  papel.mockReturnValue('developer');
  eventos.mockReturnValue({ items: [EVENTO_CRIATIVO_ATIVO] });
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('SessionPage — ações de passo são sugestões acima do destinatário (RN-976, AT-681)', () => {
  it('a sugestão vem antes do "Para", e o Enviar é o primeiro botão do composer (contrato do E2E)', async () => {
    eventos.mockReturnValue({ items: [EVENTO_CRIATIVO_ATIVO, EVENTO_REGRA_DE_NEGOCIO] });
    montar();
    const pronto = await screen.findByRole('button', {
      name: 'Estou pronto — a necessidade está validada',
    });
    const para = screen.getByTestId('destinatario-do-chat');
    expect(
      pronto.compareDocumentPosition(para) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const composer = para.nextElementSibling as HTMLElement;
    const enviar = within(composer).getAllByRole('button')[0];
    // AT-713: Enviar é só ícone; o nome vem da legenda e o ícone é aria-hidden.
    expect(enviar).toHaveAccessibleName('Enviar');
    expect(enviar.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(composer).not.toContainElement(pronto);
  });

  it('viewer: a sugestão fica inerte e o motivo de papel aparece em texto', async () => {
    papel.mockReturnValue('viewer');
    eventos.mockReturnValue({ items: [EVENTO_CRIATIVO_ATIVO, EVENTO_REGRA_DE_NEGOCIO] });
    montar();
    const pronto = await screen.findByRole('button', {
      name: 'Estou pronto — a necessidade está validada',
    });
    expect(pronto).toBeDisabled();
    expect(screen.getByText('Esta ação exige o papel developer neste workspace.')).toBeVisible();
  });
});
