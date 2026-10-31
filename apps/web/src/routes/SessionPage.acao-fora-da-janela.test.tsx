import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ProposedAction, Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app: as asserções esperam texto em pt-BR, e `en` é o
// idioma DEFAULT (mesmo padrão de SessionPage.carrossel-janela-estourada).
import i18n from '../lib/i18n';

/**
 * AT-365 — "o cartão aprovado voltou a pedir decisão".
 *
 * Na Sessão ao vivo, um `open_adr_pr` aprovado e executado PARECEU voltar com
 * Aprovar/Negar e o texto `politica.foraDoRecorte`. A investigação não achou
 * caminho nenhum que leve `executed` de volta a `pending` — os botões só
 * existem com `action.status === 'pending'` (`ApprovalCard`). A hipótese é que
 * eram DOIS cartões: o antigo, cujo `proposed_action.created` saiu da janela
 * de 200 eventos, e um SEGUNDO `open_adr_pr`, pendente de verdade.
 *
 * Este arquivo reproduz as três fases e fixa o que o fio faz em cada uma:
 *
 * 1. o evento de A está na janela → A mostra "Aprovado", sem botão;
 * 2. a janela anda e o evento de A sai → A continua sem botão; o motivo vira
 *    a frase de fora-do-recorte (o card DIZ que não leu, RN-614);
 * 3. chega B pendente, também sem evento na janela → dois cartões, e os
 *    botões são SÓ do B.
 */

const getSession = vi.fn();
const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const acoes = vi.fn<() => ProposedAction[]>(() => []);

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={to.replace('$projectId', params?.projectId ?? '')} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: acoes() } }),
  useHandoffs: () => ({ data: [] }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));

vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => {},
}));

vi.mock('../lib/auth', () => ({
  emailDaSessao: () => 'eu@brabo.dev',
  userIdDaSessao: () => 'eu',
}));

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
  promoteStories: vi.fn(),
  returnStory: vi.fn(),
  sendAgentMessage: vi.fn(),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: vi.fn(),
}));

const { SessionPage } = await import('./SessionPage');
const { ToastProvider } = await import('../components/ui/ToastProvider');

const ID = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';
const PROJECT_ID = 'proj-1';
const FORA_DO_RECORTE = 'Motivo da política fora dos eventos carregados nesta tela';

function sessao(): Session {
  return {
    id: ID,
    projectId: PROJECT_ID,
    createdBy: 'user-1',
    status: 'active',
    kind: 'criativa',
    name: null,
    nextSeq: 1,
    createdAt: '2026-08-11T12:00:00.000Z',
    updatedAt: '2026-08-11T12:00:00.000Z',
    closedAt: null,
  } as Session;
}

function acaoAdr(over: Partial<ProposedAction>): ProposedAction {
  return {
    id: 'acao-a',
    projectId: PROJECT_ID,
    sessionId: ID,
    seq: 10,
    actionType: 'open_adr_pr',
    payload: { title: 'ADR do módulo de pagamentos', slug: '0200-pagamentos' },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'arquiteto' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    // Sem `pullRequestId`: o "Mergear" sob a PR (AT-266) não entra na conta.
    executionResult: null,
    createdAt: '2026-08-11T12:00:01.000Z',
    updatedAt: '2026-08-11T12:00:01.000Z',
    ...over,
  } as ProposedAction;
}

const A_EXECUTADA = acaoAdr({
  id: 'acao-a',
  status: 'executed',
  decidedBy: 'user-1',
  decidedAt: '2026-08-11T12:00:05.000Z',
  payload: { title: 'ADR antiga', slug: '0200-antiga' },
});

const B_PENDENTE = acaoAdr({
  id: 'acao-b',
  seq: 11,
  payload: { title: 'ADR nova', slug: '0201-nova' },
  // Depois de TODOS os eventos da janela: ancora no fim do fio.
  createdAt: '2026-08-11T13:00:00.000Z',
  updatedAt: '2026-08-11T13:00:00.000Z',
});

function mensagemDoUsuario(seq: number, texto: string, createdAt: string) {
  return {
    id: `ev-msg-${seq}`,
    seq,
    type: 'chat.message',
    actor: { kind: 'user', id: 'user-1' },
    payload: { text: texto },
    createdAt,
  };
}

/** Janela da fase 1: o `proposed_action.created` de A está nela. */
function janelaComA() {
  return [
    mensagemDoUsuario(1, 'escreva a ADR', '2026-08-11T12:00:00.000Z'),
    {
      id: 'ev-criada-a',
      seq: 2,
      type: 'proposed_action.created',
      actor: { kind: 'agent', id: 'arquiteto' },
      payload: {
        actionId: 'acao-a',
        actionType: 'open_adr_pr',
        status: 'pending',
        resolvedPolicy: 'require_approval',
        reason: 'abrir PR é efeito externo',
      },
      createdAt: '2026-08-11T12:00:01.000Z',
    },
  ];
}

/**
 * Janela da fase 2: 200 eventos MAIS NOVOS que A, nenhum deles o dele — a
 * janela andou (`useSessionEvents` é `latest: true`, teto 200).
 */
function janelaSemA() {
  return Array.from({ length: 200 }, (_, i) =>
    mensagemDoUsuario(
      1001 + i,
      `mensagem ${1001 + i}`,
      new Date(Date.parse('2026-08-11T12:10:00.000Z') + i * 1000).toISOString(),
    ),
  );
}

/** O `Card` do `ApprovalCard` — o pai da linha do motivo, que todo card do fio tem. */
function cartoes(): HTMLElement[] {
  return screen
    .queryAllByTestId('motivo-da-politica')
    .map((motivo) => motivo.parentElement as HTMLElement);
}

function cartaoCom(texto: string): HTMLElement {
  const achado = cartoes().find((c) => c.textContent?.includes(texto));
  if (!achado) throw new Error(`cartão com "${texto}" não encontrado`);
  return achado;
}

function abrirHistoricoDoFio() {
  const cabecalho = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[class*="fioHistoricoCabecalho"]'),
  ).find((el) => el.textContent?.includes('Antes das últimas'));
  if (!cabecalho) throw new Error('cabeçalho do histórico do fio não encontrado');
  if (cabecalho.getAttribute('aria-expanded') !== 'true') fireEvent.click(cabecalho);
}

// Um elemento NOVO a cada chamada, sobre o MESMO `QueryClient`: `rerender`
// com a mesma referência de elemento é descartado pelo React (bailout), e a
// fase seguinte nunca chegaria à tela.
function arvore(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SessionPage projectId={PROJECT_ID} sessionId={ID} />
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  eventos.mockReturnValue({ items: [] });
  acoes.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('SessionPage — ação decidida cujo evento sai da janela (AT-365)', () => {
  it('nunca volta a pedir decisão; o segundo open_adr_pr é OUTRO cartão', async () => {
    // ── Fase 1: o evento de A está na janela ────────────────────────────
    eventos.mockReturnValue({ items: janelaComA() });
    acoes.mockReturnValue([A_EXECUTADA]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(arvore(client));

    await waitFor(() => expect(cartoes()).toHaveLength(1));
    const a1 = cartaoCom('ADR antiga');
    expect(within(a1).getByText('Aprovado')).toBeInTheDocument();
    expect(within(a1).queryByRole('button', { name: 'Aprovar' })).toBeNull();
    expect(within(a1).queryByRole('button', { name: 'Negar' })).toBeNull();
    // O motivo é o do evento, não a frase de fora-do-recorte.
    expect(within(a1).getByTestId('motivo-da-politica').textContent).not.toBe(FORA_DO_RECORTE);

    // ── Fase 2: a janela anda e o evento de A sai dela ─────────────────
    eventos.mockReturnValue({ items: janelaSemA() });
    acoes.mockReturnValue([A_EXECUTADA]);
    rerender(arvore(client));

    // DEFEITO 6a, AINDA NÃO CORRIGIDO (a correção é decisão separada, fora
    // desta PR): sem o `proposed_action.created`, `ordemDaAcaoNaTimeline`
    // degrada para `createdAt` e, com TODOS os eventos da janela mais novos
    // que A, ancora em 0 → posição 0.5. O cartão SALTA para o topo do fio —
    // e, com mais de 5 mensagens, para dentro do histórico RECOLHIDO, que não
    // monta os filhos. Some da parte aberta do fio. Este bloco fixa o
    // comportamento atual; quando 6a for corrigido, ele muda de expectativa.
    await waitFor(() => expect(cartoes()).toHaveLength(0));
    abrirHistoricoDoFio();
    await waitFor(() => expect(cartoes()).toHaveLength(1));
    const a2 = cartaoCom('ADR antiga');
    const primeiraMensagem = screen.getByText('mensagem 1001');
    expect(
      a2.compareDocumentPosition(primeiraMensagem) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // O que importa ao AT-365: continua decidida, sem botão nenhum, e o
    // motivo DIZ que o evento não está entre os carregados.
    expect(within(a2).getByText('Aprovado')).toBeInTheDocument();
    expect(within(a2).queryByRole('button', { name: 'Aprovar' })).toBeNull();
    expect(within(a2).queryByRole('button', { name: 'Negar' })).toBeNull();
    expect(within(a2).getByTestId('motivo-da-politica').textContent).toBe(FORA_DO_RECORTE);

    // ── Fase 3: chega B, OUTRO open_adr_pr, pendente e sem evento ──────
    acoes.mockReturnValue([A_EXECUTADA, B_PENDENTE]);
    rerender(arvore(client));
    abrirHistoricoDoFio();

    await waitFor(() => expect(cartoes()).toHaveLength(2));
    const a3 = cartaoCom('ADR antiga');
    const b3 = cartaoCom('ADR nova');
    // A segue decidido e inerte.
    expect(within(a3).getByText('Aprovado')).toBeInTheDocument();
    expect(within(a3).queryByRole('button', { name: 'Aprovar' })).toBeNull();
    // Os botões são do B — e os dois cartões dizem a MESMA frase de
    // fora-do-recorte, que é como os dois se confundem a olho.
    expect(within(b3).getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
    expect(within(b3).getByRole('button', { name: 'Negar' })).toBeInTheDocument();
    expect(within(a3).getByTestId('motivo-da-politica').textContent).toBe(FORA_DO_RECORTE);
    expect(within(b3).getByTestId('motivo-da-politica').textContent).toBe(FORA_DO_RECORTE);
    // E só UM par de botões de decisão na tela inteira.
    expect(screen.getAllByRole('button', { name: 'Aprovar' })).toHaveLength(1);
    // B, criado depois de toda a janela, fica ABAIXO de A (que segue no topo).
    expect(a3.compareDocumentPosition(b3) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
