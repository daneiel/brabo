import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';

/**
 * FASE 20 — o que esta tela ganhou, e por que cada asserção existe.
 *
 * 1. **Uma saída.** `SessionPage` não importava `Link` nem `useNavigate`:
 *    entrar numa sessão era um beco sem saída, e o único caminho de volta era
 *    o botão do navegador. A asserção é sobre o DESTINO (`/`), não sobre o
 *    ícone — um botão que não navega passaria por qualquer teste de aparência.
 * 2. **Nome, sem perder a hashtag** (RN-098).
 * 3. **O tipo governa o que a tela OFERECE** (RN-097): "Iniciar ideação" só
 *    existe na sessão criativa. Era esse botão, disponível em qualquer sessão
 *    e descoberto só depois, que o usuário relatou como pouco claro.
 */

const renameSession = vi.fn();
const getSession = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  // `Link` vira uma âncora de verdade: é o `href` que este teste afirma.
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: { items: [] } }),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] }),
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
  renameSession: (...args: unknown[]) => renameSession(...args),
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

// Importado DEPOIS dos mocks — `vi.mock` é içado, mas o import estático da
// tela não pode resolver antes de eles existirem no registro do vitest.
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
    createdAt: '2026-08-09T12:00:00.000Z',
    updatedAt: '2026-08-09T12:00:00.000Z',
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

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(sessao());
  renameSession.mockResolvedValue(sessao({ name: 'Checkout' }));
});

describe('SessionPage — a saída da tela', () => {
  it('há um caminho de volta ao dashboard, e ele aponta para a raiz', async () => {
    montar();
    const voltar = await screen.findByLabelText('Voltar ao dashboard');
    expect(voltar.getAttribute('href')).toBe('/');
  });
});

describe('SessionPage — nome e tipo', () => {
  it('sem nome, o título é a hashtag sozinha', async () => {
    montar();
    expect(await screen.findByText('Sessão #a1b2c3d4')).toBeTruthy();
  });

  it('com nome, o título compõe e PRESERVA a hashtag', async () => {
    getSession.mockResolvedValue(sessao({ name: 'Checkout do carrinho' }));
    montar();
    expect(
      await screen.findByText('Sessão Checkout do carrinho · #a1b2c3d4'),
    ).toBeTruthy();
  });

  it('caminho feliz: clicar no título abre o campo e Enter renomeia', async () => {
    montar();
    // O selo do tipo só existe com a sessão CARREGADA — antes disso o título
    // está `disabled`, porque não há o que renomear.
    await screen.findByText('Criativa');
    fireEvent.click(screen.getByText('Sessão #a1b2c3d4'));

    const campo = screen.getByLabelText('Nome da sessão');
    fireEvent.change(campo, { target: { value: 'Checkout' } });
    fireEvent.keyDown(campo, { key: 'Enter' });

    await vi.waitFor(() => expect(renameSession).toHaveBeenCalled());
    expect(renameSession).toHaveBeenCalledWith('proj-1', ID, 'Checkout');
  });

  it('nome em branco APAGA o nome — é o caminho de desfazer', async () => {
    getSession.mockResolvedValue(sessao({ name: 'Provisório' }));
    montar();
    await screen.findByText('Criativa');
    fireEvent.click(screen.getByText('Sessão Provisório · #a1b2c3d4'));

    const campo = screen.getByLabelText('Nome da sessão');
    fireEvent.change(campo, { target: { value: '  ' } });
    fireEvent.keyDown(campo, { key: 'Enter' });

    await vi.waitFor(() => expect(renameSession).toHaveBeenCalled());
    expect(renameSession).toHaveBeenCalledWith('proj-1', ID, null);
  });

  it('CASO DE FALHA: Esc desiste sem chamar a api', async () => {
    montar();
    await screen.findByText('Criativa');
    fireEvent.click(screen.getByText('Sessão #a1b2c3d4'));

    const campo = screen.getByLabelText('Nome da sessão');
    fireEvent.change(campo, { target: { value: 'Não quero' } });
    fireEvent.keyDown(campo, { key: 'Escape' });

    expect(renameSession).not.toHaveBeenCalled();
    expect(await screen.findByText('Sessão #a1b2c3d4')).toBeTruthy();
  });

  it('a sessão criativa oferece iniciar a ideação e diz que é criativa', async () => {
    montar();
    // Por PAPEL: o convite também menciona "Iniciar ideação" em prosa, e o que
    // se afirma aqui é que existe o BOTÃO.
    expect(
      await screen.findByRole('button', { name: 'Iniciar ideação' }),
    ).toBeTruthy();
    expect(screen.getByText('Criativa')).toBeTruthy();
  });

  it('CASO DE FALHA: a sessão consultiva NÃO oferece iniciar a ideação', async () => {
    // A regra do tipo chegando à tela: oferecer o Criativo numa sessão
    // consultiva seria prometer o que ela não faz — e ativar execução nela é
    // recusado pela api (RN-097).
    getSession.mockResolvedValue(sessao({ kind: 'consultiva' }));
    montar();

    expect(await screen.findByText('Consultiva')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Iniciar ideação' })).toBeNull();
    expect(screen.getByText(/Nenhum agente é ativado/)).toBeTruthy();
  });
});
