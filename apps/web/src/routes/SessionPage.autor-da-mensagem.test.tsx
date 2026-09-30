import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ProjectMemberWithUser, Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
import i18n from '../lib/i18n';

/**
 * RN-652 (AT-329, achado N2 da auditoria visual da Rodada 29): todo
 * `chat.message` era desenhado com o nome e o avatar de quem VÊ a tela. Numa
 * sessão compartilhada, a fala de outra pessoa saía com o SEU nome, e a de um
 * agente com o seu e-mail. O autor sai agora do ator do EVENTO.
 */

const getSession = vi.fn();
const listProjectMembers = vi.fn<() => Promise<ProjectMemberWithUser[]>>();
const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));

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
    listProjectMembers: () => listProjectMembers(),
    renameSession: vi.fn(),
    acceptHandoff: vi.fn(),
    activateExecution: vi.fn(),
    approveAction: vi.fn(),
    approveAlwaysAction: vi.fn(),
    confirmArchitectureReadiness: vi.fn(),
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

function sessao(): Session {
  return {
    id: ID,
    projectId: 'proj-1',
    createdBy: 'eu',
    status: 'active',
    kind: 'criativa',
    name: null,
    nextSeq: 1,
    createdAt: '2026-09-30T12:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
    closedAt: null,
  } as Session;
}

function mensagem(seq: number, actor: { kind: string; id: string }, text: string) {
  return {
    id: `ev-${seq}`,
    seq,
    type: 'chat.message',
    actor,
    payload: { text },
    createdAt: '2026-09-30T12:00:00.000Z',
  };
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

/** O nome no cabeçalho da bolha que contém `texto`. */
function autorDa(texto: string): { nome: string; tipo: string | null } {
  const bolha = screen.getByText(texto).closest('[data-autor]') as HTMLElement;
  const nome = bolha.querySelector('[class*="messageName"]')?.textContent ?? '';
  return { nome, tipo: bolha.getAttribute('data-autor') };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  getSession.mockResolvedValue(sessao());
  listProjectMembers.mockResolvedValue([
    { userId: 'eu', role: 'owner', name: null, email: 'eu@brabo.dev' },
    { userId: 'ana', role: 'developer', name: 'Ana Souza', email: 'ana@brabo.dev' },
  ]);
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('SessionPage — autor de cada chat.message (RN-652)', () => {
  it('duas pessoas e um agente: cada mensagem sob o próprio autor', async () => {
    eventos.mockReturnValue({
      items: [
        mensagem(1, { kind: 'user', id: 'eu' }, 'mensagem minha'),
        mensagem(2, { kind: 'user', id: 'ana' }, 'mensagem da Ana'),
        mensagem(3, { kind: 'agent', id: 'po' }, 'mensagem do PO'),
      ],
    });
    montar();

    // A Ana só ganha nome quando os membros chegam — antes é "Outro membro".
    await screen.findByText('Ana Souza');

    expect(autorDa('mensagem minha')).toEqual({ nome: 'eu@brabo.dev', tipo: 'voce' });
    expect(autorDa('mensagem da Ana')).toEqual({ nome: 'Ana Souza', tipo: 'membro' });
    expect(autorDa('mensagem do PO')).toEqual({ nome: 'PO', tipo: 'agente' });
    // O e-mail de quem vê aparece UMA vez — na mensagem dele, e só nela.
    const fio = screen.getByText('mensagem minha').closest('main') ?? document.body;
    expect(within(fio as HTMLElement).getAllByText('eu@brabo.dev')).toHaveLength(1);
  });

  it('falha: ator desconhecido e pessoa fora dos membros têm texto próprio, nunca o de quem vê', async () => {
    eventos.mockReturnValue({
      items: [
        mensagem(1, { kind: 'system', id: 'system' }, 'fala sem dono'),
        mensagem(2, { kind: 'user', id: 'carla' }, 'fala da Carla'),
      ],
    });
    montar();

    await screen.findByText('fala sem dono');
    expect(autorDa('fala sem dono')).toEqual({
      nome: 'Autor desconhecido',
      tipo: 'desconhecido',
    });
    expect(autorDa('fala da Carla')).toEqual({ nome: 'Outro membro', tipo: 'outroMembro' });
    expect(screen.queryByText('eu@brabo.dev')).not.toBeInTheDocument();
  });

  it('falha: a leitura de membros recusada não quebra o fio — a outra pessoa vira "Outro membro"', async () => {
    listProjectMembers.mockRejectedValue(new Error('403'));
    eventos.mockReturnValue({
      items: [
        mensagem(1, { kind: 'user', id: 'eu' }, 'mensagem minha'),
        mensagem(2, { kind: 'user', id: 'ana' }, 'mensagem da Ana'),
      ],
    });
    montar();

    await screen.findByText('mensagem da Ana');
    expect(autorDa('mensagem minha')).toEqual({ nome: 'eu@brabo.dev', tipo: 'voce' });
    expect(autorDa('mensagem da Ana')).toEqual({ nome: 'Outro membro', tipo: 'outroMembro' });
  });
});
