import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Handoff, Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app: as asserções abaixo esperam texto em pt-BR.
import i18n from '../lib/i18n';

/**
 * RN-633 (AT-293, AT-294) e RN-634 (AT-295) — o handoff que a tela deixava
 * obsoleto.
 *
 * - AT-293: o handoff MANUAL grava como `fromAgent` o último agente ativado, e
 *   `prontidaoJaDeclarada`/`arquiteturaJaDeclarada` o tomavam pela prontidão
 *   declarada, escondendo "Estou pronto"/"Confirmar arquitetura pronta".
 * - AT-294: "ativo" era da SESSÃO; oferta a agente que já roda noutra sessão
 *   do projeto (a de execução) continuava acionável.
 * - AT-295: "Ativar execução" deixava a tela na sessão de chat, e a execução
 *   corria numa sessão NOVA.
 */

const acceptHandoff = vi.fn();
const activateExecution = vi.fn();
const getSession = vi.fn();
const getProjectsSummary = vi.fn();
const irParaSessao = vi.fn();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const handoffsMock = vi.fn<() => Handoff[]>(() => []);

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: handoffsMock() }),
  useCurrentWorkspaceWithRole: () => ({
    data: { workspace: { id: 'ws-1' }, role: 'developer' },
  }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));
vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => {},
}));
vi.mock('../lib/auth', () => ({ emailDaSessao: () => 'eu@brabo.dev' }));

vi.mock('../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../lib/api-client')>(
    '../lib/api-client',
  );
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'core' }),
    getSession: (...args: unknown[]) => getSession(...args),
    getProjectsSummary: (...args: unknown[]) => getProjectsSummary(...args),
    getSessionTokenUsage: vi.fn().mockResolvedValue([]),
    getRepository: vi.fn().mockResolvedValue({ id: 'repo-1' }),
    getSessionBudget: vi.fn().mockResolvedValue(null),
    getSessionModelBinding: vi.fn().mockResolvedValue(null),
    listModels: vi.fn().mockResolvedValue(null),
    renameSession: vi.fn(),
    acceptHandoff: (...args: unknown[]) => acceptHandoff(...args),
    activateExecution: (...args: unknown[]) => activateExecution(...args),
    approveAction: vi.fn(),
    approveAlwaysAction: vi.fn(),
    confirmReadiness: vi.fn(),
    denyAction: vi.fn(),
    sendAgentMessage: vi.fn(),
    setSessionModelBinding: vi.fn(),
    startAgent: vi.fn(),
    transitionSession: vi.fn(),
  };
});

const { SessionPage } = await import('./SessionPage');
const { ToastProvider } = await import('../components/ui/ToastProvider');

const ID = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';
const USUARIO = '9b2f6a1e-1111-4222-8333-444455556666';

function sessao(): Session {
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
  } as Session;
}

function ativou(agent: string, seq: number) {
  return {
    id: `evt-${seq}`,
    seq,
    type: 'agent.activated',
    actor: { kind: 'agent', id: agent },
    payload: { agent },
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

function oferecido(seq: number, handoffId: string, toAgent: string, actor: { kind: string; id: string }) {
  return {
    id: `evt-${seq}`,
    seq,
    type: 'handoff.offered',
    actor,
    payload: { handoffId, toAgent },
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

function regra(seq: number) {
  return {
    id: `evt-${seq}`,
    seq,
    type: 'artifact.business_rule',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { title: 'R', description: 'd', origin: [] },
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

function handoff(over: Partial<Handoff>): Handoff {
  return {
    id: 'h-1',
    sessionId: ID,
    projectId: 'proj-1',
    fromAgent: 'criativo',
    toAgent: 'po',
    artifactId: null,
    status: 'offered',
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    ...over,
  };
}

function montar(comNavegacao = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SessionPage
          projectId="proj-1"
          sessionId={ID}
          irParaSessao={comNavegacao ? irParaSessao : undefined}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** O resumo do projeto: a sessão MAIS RECENTE e quem foi ativado nela. */
function sessaoMaisRecente(latestSessionId: string, activatedAgents: string[]) {
  getProjectsSummary.mockResolvedValue([
    { projectId: 'proj-1', latestSessionId, roster: { activatedAgents } },
  ]);
}

beforeEach(async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  await i18n.changeLanguage('pt-BR');
  getSession.mockResolvedValue(sessao());
  acceptHandoff.mockResolvedValue({ ok: true });
  handoffsMock.mockReturnValue([]);
  eventos.mockReturnValue({ items: [] });
  getProjectsSummary.mockResolvedValue([]);
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('AT-293 — o handoff MANUAL não declara prontidão (RN-633)', () => {
  it('caminho feliz: manual pedido com o Criativo ativo não esconde "Estou pronto para produzir"', async () => {
    eventos.mockReturnValue({
      items: [ativou('criativo', 1), regra(2), oferecido(3, 'h-man', 'staff', { kind: 'user', id: USUARIO })],
    });
    handoffsMock.mockReturnValue([handoff({ id: 'h-man', fromAgent: 'criativo', toAgent: 'staff' })]);

    montar();
    expect(
      await screen.findByRole('button', { name: 'Estou pronto para produzir' }),
    ).toBeInTheDocument();
  });

  it('manual pedido com o Arquiteto ativo não esconde "Confirmar arquitetura pronta"', async () => {
    eventos.mockReturnValue({
      items: [ativou('arquiteto', 1), oferecido(2, 'h-man', 'staff', { kind: 'user', id: USUARIO })],
    });
    handoffsMock.mockReturnValue([handoff({ id: 'h-man', fromAgent: 'arquiteto', toAgent: 'staff' })]);

    montar();
    expect(
      await screen.findByRole('button', { name: 'Confirmar arquitetura pronta' }),
    ).toBeInTheDocument();
  });

  it('CASO DE FALHA: o handoff do AGENTE continua escondendo o botão — a prontidão foi declarada', async () => {
    eventos.mockReturnValue({
      items: [ativou('criativo', 1), regra(2), oferecido(3, 'h-po', 'po', { kind: 'agent', id: 'criativo' })],
    });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-po', fromAgent: 'criativo', toAgent: 'po', artifactId: 'brief-1' }),
    ]);

    montar();
    await screen.findByRole('button', { name: 'Aceitar handoff e iniciar PO' });
    expect(
      screen.queryByRole('button', { name: 'Estou pronto para produzir' }),
    ).not.toBeInTheDocument();
  });

  it('fora da janela, o handoff do Criativo com o brief ainda conta (o manual nunca leva artefato)', async () => {
    eventos.mockReturnValue({ items: [ativou('criativo', 300), regra(301)] });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-po', fromAgent: 'criativo', toAgent: 'po', artifactId: 'brief-1', status: 'accepted' }),
    ]);

    montar();
    await screen.findByLabelText('Para');
    expect(
      screen.queryByRole('button', { name: 'Estou pronto para produzir' }),
    ).not.toBeInTheDocument();
  });
});

describe('AT-294 — oferta a agente ativo em OUTRA sessão do projeto não é acionável (RN-633)', () => {
  const ofertaAoDevLead = () => {
    eventos.mockReturnValue({
      items: [ativou('arquiteto', 1), oferecido(2, 'h-dl', 'dev-lead', { kind: 'agent', id: 'arquiteto' })],
    });
    handoffsMock.mockReturnValue([handoff({ id: 'h-dl', fromAgent: 'arquiteto', toAgent: 'dev-lead' })]);
  };

  it('caminho feliz: o Dev Lead já roda na sessão de execução — a oferta vira divisor mudo', async () => {
    ofertaAoDevLead();
    sessaoMaisRecente('sessao-de-execucao', ['dev-lead']);

    montar();
    await waitFor(() => expect(getProjectsSummary).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Aceitar handoff e iniciar Dev Lead' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('CASO DE FALHA: sem o Dev Lead ativo em sessão nenhuma, a oferta segue acionável', async () => {
    ofertaAoDevLead();
    sessaoMaisRecente('sessao-de-execucao', ['criativo']);

    montar();
    await waitFor(() => expect(getProjectsSummary).toHaveBeenCalled());
    expect(
      await screen.findByRole('button', { name: 'Aceitar handoff e iniciar Dev Lead' }),
    ).toBeInTheDocument();
  });
});

describe('AT-295 — depois de "Ativar execução", a tela vai à sessão de execução (RN-634)', () => {
  const ofertaAoDevLead = () => {
    eventos.mockReturnValue({
      items: [ativou('arquiteto', 1), oferecido(2, 'h-dl', 'dev-lead', { kind: 'agent', id: 'arquiteto' })],
    });
    handoffsMock.mockReturnValue([handoff({ id: 'h-dl', fromAgent: 'arquiteto', toAgent: 'dev-lead' })]);
  };

  it('caminho feliz: navega para o `sessionId` devolvido, com aviso', async () => {
    ofertaAoDevLead();
    activateExecution.mockResolvedValue({ sessionId: 'sessao-exec', modules: ['core'] });

    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar execução' }));

    await waitFor(() => expect(irParaSessao).toHaveBeenCalledWith('sessao-exec'));
    expect(activateExecution).toHaveBeenCalledWith('proj-1', ID);
    expect(await screen.findByText('Levando você à sessão de execução.')).toBeInTheDocument();
  });

  it('CASO DE FALHA: a ativação recusada não navega e diz a frase da api', async () => {
    ofertaAoDevLead();
    activateExecution.mockRejectedValue(new Error('Papel insuficiente para esta ação'));

    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar execução' }));

    await waitFor(() => expect(activateExecution).toHaveBeenCalled());
    await screen.findByText(/Papel insuficiente|Não foi possível ativar/);
    expect(irParaSessao).not.toHaveBeenCalled();
  });

  it('sem quem navegue (a tela montada fora da rota), só avisa e fica', async () => {
    ofertaAoDevLead();
    activateExecution.mockResolvedValue({ sessionId: 'sessao-exec', modules: [] });

    montar(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar execução' }));

    expect(await screen.findByText('Execução ativada')).toBeInTheDocument();
    expect(screen.queryByText('Levando você à sessão de execução.')).not.toBeInTheDocument();
  });
});
