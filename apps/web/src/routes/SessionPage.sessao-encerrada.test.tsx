import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app: as asserções esperam pt-BR, e `en` é o default.
import i18n from '../lib/i18n';

/**
 * AT-154 (RN-581): a api recusa conversa em sessão terminal com 409
 * `sessao_encerrada`, e a tela diz por quê em vez do erro genérico, refaz a
 * leitura da sessão (o composer some) e não perde o texto digitado.
 * AT-155: o botão "Encerrar" fica inerte nos DOIS estados terminais.
 */

const getSession = vi.fn();
const sendAgentMessage = vi.fn();
const confirmReadiness = vi.fn();
const transitionSession = vi.fn();

const EVENTOS_CRIATIVO_ATIVO = [
  {
    id: 'e0',
    seq: 1,
    type: 'agent.activated',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { agent: 'criativo' },
    createdAt: '2026-08-11T12:00:00.000Z',
  },
  {
    id: 'e1',
    seq: 2,
    type: 'artifact.business_rule',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { title: 'Só maiores de 18', description: 'Idade >= 18', origin: [1] },
    createdAt: '2026-08-11T12:00:30.000Z',
  },
];

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: EVENTOS_CRIATIVO_ATIVO }));

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
  useHandoffs: () => ({ data: [] }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));
vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => undefined,
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
  confirmReadiness: (...args: unknown[]) => confirmReadiness(...args),
  listSessionEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  denyAction: vi.fn(),
  sendAgentMessage: (...args: unknown[]) => sendAgentMessage(...args),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: (...args: unknown[]) => transitionSession(...args),
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
    createdAt: '2026-08-11T12:00:00.000Z',
    updatedAt: '2026-08-11T12:00:00.000Z',
    closedAt: null,
    ...over,
  } as Session;
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

const RECUSA = Object.assign(new Error('409'), {
  status: 409,
  body: { message: 'A sessão está encerrada.', reason: 'sessao_encerrada', status: 'closed' },
});

const PLACEHOLDER = 'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)';
const FRASE = 'Esta sessão foi encerrada e não aceita mais mensagens. Abra uma sessão nova para continuar.';

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  eventos.mockReturnValue({ items: EVENTOS_CRIATIVO_ATIVO });
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('SessionPage — 409 de conversa em sessão encerrada (AT-154)', () => {
  it('enviar mensagem: diz que a sessão fechou, esconde o composer e guarda o texto', async () => {
    sendAgentMessage.mockRejectedValue(RECUSA);

    montar();
    const campo = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.change(campo, { target: { value: 'minha resposta importante' } });

    // A sessão fecha por baixo: a próxima leitura já vem `closed`.
    getSession.mockResolvedValue(sessao({ status: 'closed', closedAt: '2026-08-11T13:00:00.000Z' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText(FRASE)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument());
    // O texto NÃO se perdeu.
    expect(
      screen.getByLabelText('Sua mensagem não enviada') as HTMLTextAreaElement,
    ).toHaveValue('minha resposta importante');
    // Não promete o que não existe.
    expect(screen.queryByText(/reabrir/i)).not.toBeInTheDocument();
  });

  it('confirmar prontidão: mesma frase, e não o erro genérico', async () => {
    confirmReadiness.mockRejectedValue(RECUSA);

    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Estou pronto para produzir' }));

    expect(await screen.findByText(FRASE)).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível confirmar prontidão')).not.toBeInTheDocument();
  });

  it('CASO DE CONTRASTE: outro 409 (turno em andamento) segue com a frase do engine', async () => {
    sendAgentMessage.mockRejectedValue(
      Object.assign(new Error('409'), {
        status: 409,
        body: { message: 'O agente ainda está no meio de um turno.' },
      }),
    );

    montar();
    fireEvent.change(await screen.findByPlaceholderText(PLACEHOLDER), { target: { value: 'oi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('O agente ainda está no meio de um turno.')).toBeInTheDocument();
    expect(screen.queryByText(FRASE)).not.toBeInTheDocument();
  });
});

describe('SessionPage — botão Encerrar inerte nos estados terminais (AT-155)', () => {
  it.each(['closed', 'closed_abnormally'] as const)('%s: o botão fica desabilitado', async (status) => {
    getSession.mockResolvedValue(sessao({ status }));

    montar();
    const botao = await screen.findByRole('button', { name: 'Encerrar' });
    await waitFor(() => expect(botao).toBeDisabled());
    fireEvent.click(botao);
    expect(transitionSession).not.toHaveBeenCalled();
  });

  it('CASO DE CONTRASTE: em `active` o botão está habilitado', async () => {
    montar();
    const botao = await screen.findByRole('button', { name: 'Encerrar' });
    await waitFor(() => expect(botao).toBeEnabled());
  });
});
