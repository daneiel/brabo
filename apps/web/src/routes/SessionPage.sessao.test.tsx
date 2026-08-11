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
 *    o botão do navegador. A asserção é sobre o DESTINO — um botão que não
 *    navega passaria por qualquer teste de aparência. O destino virou o
 *    PROJETO (não mais a raiz `/`) numa rodada posterior; a cobertura
 *    detalhada mora em `SessionPage.promocao-inline-e-volta.test.tsx`, e o
 *    caso aqui segue só como fumaça.
 * 2. **Nome, sem perder a hashtag** (RN-098).
 * 3. **O tipo governa o que a tela OFERECE** (RN-097): "Iniciar ideação" só
 *    existe na sessão criativa. Era esse botão, disponível em qualquer sessão
 *    e descoberto só depois, que o usuário relatou como pouco claro.
 */

const renameSession = vi.fn();
const getSession = vi.fn();
const startAgent = vi.fn();
/** Os eventos da sessão, controláveis por teste (FASE 24: é `chat.message` que
 *  tira o convite da tela e devolve o botão à topbar). */
const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));

vi.mock('@tanstack/react-router', () => ({
  // `Link` vira uma âncora de verdade: é o `href` que este teste afirma.
  // `params` é resolvido pra o `href` refletir o destino de verdade — o
  // botão de voltar usa `params={{ projectId }}`.
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a href={to.replace('$projectId', params?.projectId ?? '')} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
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
  startAgent: (...args: unknown[]) => startAgent(...args),
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
  eventos.mockReturnValue({ items: [] });
  getSession.mockResolvedValue(sessao());
  renameSession.mockResolvedValue(sessao({ name: 'Checkout' }));
  startAgent.mockResolvedValue({});
});

describe('SessionPage — a saída da tela', () => {
  it('há um caminho de volta, e ele aponta para o PROJETO', async () => {
    montar();
    const voltar = await screen.findByLabelText('Voltar ao projeto');
    expect(voltar.getAttribute('href')).toBe('/projects/proj-1');
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

/**
 * FASE 24 — o veredito sobre "Iniciar ideação" (RN-104).
 *
 * O botão NÃO é redundante: é ele que emite `agent.activated` para o Criativo,
 * e é a partir daí que a chave do owner passa a ser gasta (RN-058). Ninguém
 * entra na sessão sozinho.
 *
 * O que estava errado era o LUGAR. Ele morava só na topbar, e o convite —
 * que ocupa a tela inteira exatamente quando ainda não há Criativo — gastava
 * um parágrafo apontando para lá ("use Iniciar ideação, no alto da tela").
 * Essa é a versão literal do problema que originou a FASE 20: a ação num lugar
 * e a explicação em outro.
 *
 * A regra virou: uma ação, UM lugar de cada vez. Os dois testes abaixo prendem
 * as duas metades — e o `getAllBy` é o que reprova se as duas condições
 * voltarem a ser perguntas independentes e o botão aparecer em dobro.
 */
describe('SessionPage — onde mora "Iniciar ideação"', () => {
  it('com o convite na tela, o botão está NELE, e só uma vez', async () => {
    montar();

    const botoes = await screen.findAllByRole('button', {
      name: 'Iniciar ideação',
    });
    expect(botoes).toHaveLength(1);
    // Dentro do convite, e não na topbar: o ancestral é o mesmo bloco que
    // explica o que o Criativo faz.
    expect(botoes[0].closest('div')?.textContent).toContain(
      'é este clique que o traz',
    );

    fireEvent.click(botoes[0]);
    await vi.waitFor(() => expect(startAgent).toHaveBeenCalled());
    expect(startAgent).toHaveBeenCalledWith('proj-1', ID, 'criativo');
  });

  it('conversa começada sem Criativo: o botão volta à topbar, ainda uma vez só', async () => {
    // O caso que impede simplesmente APAGAR o botão da topbar: dá para digitar
    // numa sessão criativa sem nunca ter chamado o Criativo, e aí o convite
    // sai de cena levando junto a única saída.
    eventos.mockReturnValue({
      items: [
        {
          id: 'e1',
          seq: 1,
          type: 'chat.message',
          actor: { kind: 'user', id: 'user-1' },
          payload: { text: 'oi' },
          createdAt: '2026-08-09T12:00:01.000Z',
        },
      ],
    });

    montar();

    const botoes = await screen.findAllByRole('button', {
      name: 'Iniciar ideação',
    });
    expect(botoes).toHaveLength(1);
    expect(screen.queryByText(/é este clique que o traz/)).toBeNull();
  });
});
