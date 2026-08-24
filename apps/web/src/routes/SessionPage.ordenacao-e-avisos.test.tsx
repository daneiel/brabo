import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, act, waitFor, within, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Handoff, ProposedAction, Session } from '../lib/api-types';
import type { SessionChannelHandlers } from '../lib/session-channel';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

/**
 * Três problemas confirmados por investigação de código + observação ao vivo,
 * TODOS em `SessionPage.tsx`:
 *
 * 1. **Ordenação da timeline (RN-155, o mais crítico)** — `timeline` misturava
 *    `event.seq` (gapless, POR SESSÃO) com `action.seq` (bigserial ÚNICO e
 *    GLOBAL da tabela `proposed_actions` inteira, contraste DELIBERADO com
 *    `session_events.seq` — ver `apps/api/src/db/schema.ts`) no mesmo
 *    `.sort((a, b) => a.seq - b.seq)`. `ordemDaAcaoNaTimeline` resolve pelo
 *    vínculo real: toda ação criada por `ProposeActionUseCase` grava, na
 *    MESMA transação, um evento `proposed_action.created` com
 *    `payload.actionId` apontando pra ela — o `seq` DESSE evento é o eixo
 *    certo, não o `action.seq` cru.
 * 2. **Texto do indicador de 5s (RN-156)** — "{Agente} está escrevendo…"
 *    virou frase fixa sem o nome do agente (hoje "Pensando…", na faixa de
 *    atividade do turno — ver o teste "RN-156 — indicador de 5s" abaixo).
 * 3. **Aviso compacto do PO ao criar épico/história (RN-157)** —
 *    `backlog.epic_created`/`backlog.story_created` deixam de virar bolha
 *    completa (`.message`/`.bubble`, avatar 32px) e passam a usar o mesmo
 *    formato de `.handoffDivider`/`.handoffPill` da passagem de bastão,
 *    mantendo o link "Ver no Backlog".
 *
 * A RN-172 entrou DEPOIS, no mesmo arquivo e sobre o mesmo assunto, e por
 * isso mora aqui: a ordenação da RN-155 estava certa (fiel ao event log) e o
 * fio continuava se lendo errado, porque o engine emite o handoff e a
 * proposta de ação ANTES da última fala do turno. A regra nova é de
 * APRESENTAÇÃO, não de ordenação — e um dos testes da RN-155 abaixo mudou de
 * expectativa por causa dela, com o porquê escrito no lugar.
 */

const getSession = vi.fn();
const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const acoes = vi.fn<() => ProposedAction[]>(() => []);
const handoffsMock = vi.fn<() => Handoff[]>(() => []);
const acceptHandoff = vi.fn();
let canalHandlers: SessionChannelHandlers | undefined;

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
  useSessionEvents: () => ({ data: eventos(), isPending: false }),
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: acoes() } }),
  useHandoffs: () => ({ data: handoffsMock() }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));

vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: (
    _projectId: string,
    _sessionId: string,
    handlers: SessionChannelHandlers,
  ) => {
    canalHandlers = handlers;
    return () => {
      canalHandlers = undefined;
    };
  },
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
  denyAction: vi.fn(),
  confirmReadiness: vi.fn(),
  sendAgentMessage: vi.fn(),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: vi.fn(),
}));

const {
  SessionPage,
  ordemDaAcaoNaTimeline,
  aberturasDeTurno,
  turnoDoSeq,
  afundarDesfechos,
  agruparNarracoesDoTurno,
} = await import('./SessionPage');
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

function acao(over: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'acao-1',
    projectId: 'proj-1',
    sessionId: ID,
    // Global, GRANDE de propósito — é exatamente o valor que o código antigo
    // usava direto pra ordenar, e que a comparação viciava.
    seq: 999_999,
    actionType: 'git_commit',
    payload: {},
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'po' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-08-10T12:00:02.000Z',
    updatedAt: '2026-08-10T12:00:02.000Z',
    ...over,
  } as ProposedAction;
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
  canalHandlers = undefined;
  eventos.mockReturnValue({ items: [] });
  acoes.mockReturnValue([]);
  handoffsMock.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('RN-155 — ordemDaAcaoNaTimeline (unidade)', () => {
  const EVENTOS = [
    {
      id: 'ev-1',
      sessionId: ID,
      seq: 1,
      type: 'agent.response',
      actor: { kind: 'agent' as const, id: 'po' },
      payload: { content: 'A' },
      createdAt: '2026-08-10T12:00:00.000Z',
    },
    {
      id: 'ev-2',
      sessionId: ID,
      seq: 2,
      type: 'proposed_action.created',
      actor: { kind: 'agent' as const, id: 'po' },
      payload: { actionId: 'acao-vinculada', actionType: 'git_commit', status: 'pending', resolvedPolicy: 'require_approval' },
      createdAt: '2026-08-10T12:00:01.000Z',
    },
    {
      id: 'ev-3',
      sessionId: ID,
      seq: 3,
      type: 'agent.response',
      actor: { kind: 'agent' as const, id: 'po' },
      payload: { content: 'B' },
      createdAt: '2026-08-10T12:00:02.000Z',
    },
  ];

  it('com vínculo (proposed_action.created com o MESMO actionId): usa o seq DESSE evento, não action.seq', () => {
    const a = acao({ id: 'acao-vinculada', seq: 555_555, createdAt: '2026-08-10T12:00:01.500Z' });
    expect(ordemDaAcaoNaTimeline(a, EVENTOS)).toBe(2);
  });

  it('sem vínculo: degrada pra createdAt, ancorando no último evento anterior', () => {
    const a = acao({ id: 'acao-solta', seq: 1, createdAt: '2026-08-10T12:00:01.500Z' });
    // Entre ev-2 (seq 2, 12:00:01) e ev-3 (seq 3, 12:00:02) — ancora em 2.
    expect(ordemDaAcaoNaTimeline(a, EVENTOS)).toBe(2.5);
  });

  it('sem vínculo e criada ANTES de qualquer evento: ancora em zero', () => {
    const a = acao({ id: 'acao-antes-de-tudo', seq: 1, createdAt: '2026-08-10T11:00:00.000Z' });
    expect(ordemDaAcaoNaTimeline(a, EVENTOS)).toBe(0.5);
  });
});

describe('RN-155 — a timeline inteira, renderizada', () => {
  it('ação PENDENTE proposta NO MEIO do turno vai pro FIM do turno (RN-172), mesmo com action.seq global gigante', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { content: 'Resposta A' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
        {
          id: 'ev-2',
          seq: 2,
          type: 'proposed_action.created',
          actor: { kind: 'agent', id: 'po' },
          payload: {
            actionId: 'acao-1',
            actionType: 'git_commit',
            status: 'pending',
            resolvedPolicy: 'require_approval',
          },
          createdAt: '2026-08-10T12:00:01.000Z',
        },
        {
          id: 'ev-3',
          seq: 3,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { content: 'Resposta B' },
          createdAt: '2026-08-10T12:00:02.000Z',
        },
      ],
    });
    // `action.seq` GLOBAL enorme (a tabela inteira do sistema, não desta
    // sessão): o EIXO da RN-155 continua sendo o `seq` de ev-2, e não os
    // 999.999 — é o que este teste continua provando, porque um card ancorado
    // no `action.seq` cru cairia num turno que não existe.
    //
    // O que MUDOU de expectativa é a POSIÇÃO final, e é a RN-172: até aqui o
    // card era exigido ENTRE "Resposta A" e "Resposta B", o que é justamente
    // o defeito relatado no exp001 ("a aprovação apareceu acima do chat do
    // arquiteto até ele terminar a resposta"). Decidir é o DESFECHO do turno,
    // então o card desce para depois da última fala dele.
    acoes.mockReturnValue([acao({ id: 'acao-1', seq: 999_999 })]);

    const { container } = montar();

    await screen.findByText('Resposta A');
    await screen.findByText('propõe alteração');
    await screen.findByText('Resposta B');

    const texto = container.textContent ?? '';
    const posA = texto.indexOf('Resposta A');
    const posCard = texto.indexOf('propõe alteração');
    const posB = texto.indexOf('Resposta B');

    expect(posA).toBeGreaterThanOrEqual(0);
    expect(posB).toBeGreaterThan(posA);
    expect(posCard).toBeGreaterThan(posB);
  });

  it('a bolha de streaming/"pensando" continua SEMPRE por último, mesmo com uma ação pendente no meio do turno', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'proposed_action.created',
          actor: { kind: 'agent', id: 'po' },
          payload: {
            actionId: 'acao-1',
            actionType: 'git_commit',
            status: 'pending',
            resolvedPolicy: 'require_approval',
          },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });
    acoes.mockReturnValue([acao({ id: 'acao-1', seq: 42 })]);

    const { container } = montar();

    await waitFor(() => expect(canalHandlers?.onAgentDelta).toBeTypeOf('function'));
    act(() => canalHandlers!.onAgentDelta!('texto chegando ao vivo', 'po'));

    await screen.findByText('propõe alteração');
    await screen.findByText('texto chegando ao vivo');

    const texto = container.textContent ?? '';
    const posCard = texto.indexOf('propõe alteração');
    const posStreaming = texto.indexOf('texto chegando ao vivo');
    expect(posStreaming).toBeGreaterThan(posCard);
  });
});

describe('RN-172 — turno e desfecho (unidade)', () => {
  const evento = (seq: number, kind: 'user' | 'agent' | 'system', id: string) => ({
    id: `ev-${seq}`,
    sessionId: ID,
    seq,
    type: 'agent.response',
    actor: { kind, id },
    payload: {},
    createdAt: '2026-08-10T12:00:00.000Z',
  });

  it('abertura de turno é evento de ator USUÁRIO — nunca agente, nunca system', () => {
    expect(
      aberturasDeTurno([
        evento(1, 'user', 'u-1'),
        evento(2, 'agent', 'po'),
        evento(3, 'system', 'engine'),
        evento(4, 'user', 'u-1'),
      ]),
    ).toEqual([1, 4]);
  });

  it('turnoDoSeq ancora na última abertura anterior, e no prólogo devolve 0', () => {
    const aberturas = [3, 7];
    expect(turnoDoSeq(aberturas, 1)).toBe(0);
    expect(turnoDoSeq(aberturas, 3)).toBe(3);
    expect(turnoDoSeq(aberturas, 5)).toBe(3);
    expect(turnoDoSeq(aberturas, 99)).toBe(7);
  });

  // `origem` (RN-177) entra aqui como valor fixo de propósito:
  // `afundarDesfechos` não a lê — quem decide o afundamento são `turno`,
  // `autor` e `desfecho` —, e variá-la por caso sugeriria uma influência que
  // ela não tem.
  const entrada = (
    seq: number,
    over: { autor?: string; turno?: number; desfecho?: boolean } = {},
  ) => ({
    seq,
    node: null,
    autor: 'agent:po',
    turno: 1,
    origem: 'agente' as const,
    ...over,
  });

  it('o desfecho desce até o fim do trecho do MESMO autor no MESMO turno', () => {
    const ordenada = afundarDesfechos([
      entrada(1),
      entrada(2, { desfecho: true }),
      entrada(3),
    ]);
    expect(ordenada.map((e) => e.seq)).toEqual([1, 3, 2]);
  });

  it('PARA na fronteira de turno, mesmo quando ela não tem entrada visível', () => {
    // `agent.activated` abre turno e NÃO vira item do fio: a entrada 3 já é do
    // turno seguinte, e o handoff do turno 1 não pode alcançá-la.
    const ordenada = afundarDesfechos([
      entrada(1, { turno: 1 }),
      entrada(2, { turno: 1, desfecho: true }),
      entrada(3, { turno: 3 }),
    ]);
    expect(ordenada.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('PARA na troca de autor — sessão de execução tem vários agentes no mesmo turno', () => {
    const ordenada = afundarDesfechos([
      entrada(1, { autor: 'agent:dev-core' }),
      entrada(2, { autor: 'agent:dev-core', desfecho: true }),
      entrada(3, { autor: 'agent:dev-web' }),
    ]);
    expect(ordenada.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('dois desfechos seguidos preservam a ordem entre si (Infra antes do Dev Lead)', () => {
    const ordenada = afundarDesfechos([
      entrada(1),
      entrada(2, { desfecho: true }),
      entrada(3, { desfecho: true }),
      entrada(4),
    ]);
    expect(ordenada.map((e) => e.seq)).toEqual([1, 4, 2, 3]);
  });
});

describe('RN-172 — a sequência REAL do engine, renderizada', () => {
  /**
   * `po_server.ex#run_turn/2` emite, na MESMA iteração: `agent.response`,
   * depois o `tool.call` de `offer_handoff` (que grava `handoff.offered`) e só
   * então recursa para o `agent.response` de fechamento. O `seq` do handoff é
   * honestamente MENOR que o da última fala — o defeito relatado no exp001
   * ("a passagem de bastão apareceu acima da última mensagem do PO") é essa
   * ordem certa lida errada.
   */
  const TURNO_DO_PO = [
    {
      id: 'ev-1',
      seq: 1,
      type: 'chat.message',
      actor: { kind: 'user', id: 'u-1' },
      payload: { text: 'pode seguir' },
      createdAt: '2026-08-10T12:00:00.000Z',
    },
    {
      id: 'ev-2',
      seq: 2,
      type: 'agent.response',
      actor: { kind: 'agent', id: 'po' },
      payload: { content: 'Backlog montado' },
      createdAt: '2026-08-10T12:00:01.000Z',
    },
    {
      id: 'ev-3',
      seq: 3,
      type: 'handoff.offered',
      actor: { kind: 'agent', id: 'po' },
      payload: { toAgent: 'arquiteto' },
      createdAt: '2026-08-10T12:00:02.000Z',
    },
    {
      id: 'ev-4',
      seq: 4,
      type: 'agent.response',
      actor: { kind: 'agent', id: 'po' },
      payload: { content: 'Fechando: passo a bola' },
      createdAt: '2026-08-10T12:00:03.000Z',
    },
  ];

  it('o handoff aparece ABAIXO da última fala do agente que passou o bastão', async () => {
    eventos.mockReturnValue({ items: TURNO_DO_PO });

    const { container } = montar();

    // `agruparNarracoesDoTurno`: duas `agent.response` SEGUIDAS do mesmo
    // turno/autor ("Backlog montado" e "Fechando: passo a bola") — a
    // primeira colapsa num "Passos do turno", a última fica intacta. Abrir o
    // Disclosure é o que revela "Backlog montado" antes de checar a ordem —
    // o teste continua provando o mesmo fato de sempre (RN-172), só que
    // agora com um clique a mais até o texto ficar visível.
    await screen.findByText('Fechando: passo a bola');
    fireEvent.click(screen.getByRole('button', { name: /Passos do turno/ }));

    await screen.findByText('Backlog montado');
    await screen.findByText('passou o bastão ao');

    const texto = container.textContent ?? '';
    const posPrimeira = texto.indexOf('Backlog montado');
    const posUltima = texto.indexOf('Fechando: passo a bola');
    const posHandoff = texto.indexOf('passou o bastão ao');

    expect(posUltima).toBeGreaterThan(posPrimeira);
    expect(posHandoff).toBeGreaterThan(posUltima);
  });

  it('o handoff do turno N NÃO pula para dentro do turno N+1 (fronteira visível)', async () => {
    eventos.mockReturnValue({
      items: [
        ...TURNO_DO_PO,
        {
          id: 'ev-5',
          seq: 5,
          type: 'chat.message',
          actor: { kind: 'user', id: 'u-1' },
          payload: { text: 'mais uma coisa' },
          createdAt: '2026-08-10T12:00:04.000Z',
        },
        {
          id: 'ev-6',
          seq: 6,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { content: 'Fala do turno seguinte' },
          createdAt: '2026-08-10T12:00:05.000Z',
        },
      ],
    });

    const { container } = montar();

    await screen.findByText('Fala do turno seguinte');

    const texto = container.textContent ?? '';
    expect(texto.indexOf('passou o bastão ao')).toBeGreaterThan(
      texto.indexOf('Fechando: passo a bola'),
    );
    expect(texto.indexOf('passou o bastão ao')).toBeLessThan(
      texto.indexOf('mais uma coisa'),
    );
  });

  it('e nem quando a fronteira é INVISÍVEL — `agent.activated` abre turno e não vira item do fio', async () => {
    eventos.mockReturnValue({
      items: [
        ...TURNO_DO_PO,
        {
          id: 'ev-5',
          seq: 5,
          type: 'agent.activated',
          actor: { kind: 'user', id: 'u-1' },
          payload: { agent: 'po' },
          createdAt: '2026-08-10T12:00:04.000Z',
        },
        {
          id: 'ev-6',
          seq: 6,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { content: 'Fala do turno seguinte' },
          createdAt: '2026-08-10T12:00:05.000Z',
        },
      ],
    });

    const { container } = montar();

    await screen.findByText('Fala do turno seguinte');

    const texto = container.textContent ?? '';
    expect(texto.indexOf('passou o bastão ao')).toBeGreaterThan(
      texto.indexOf('Fechando: passo a bola'),
    );
    expect(texto.indexOf('passou o bastão ao')).toBeLessThan(
      texto.indexOf('Fala do turno seguinte'),
    );
  });

  it('card de aprovação do turno N também não invade o turno N+1', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'chat.message',
          actor: { kind: 'user', id: 'u-1' },
          payload: { text: 'pode seguir' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
        {
          id: 'ev-2',
          seq: 2,
          type: 'proposed_action.created',
          actor: { kind: 'agent', id: 'po' },
          payload: {
            actionId: 'acao-1',
            actionType: 'git_commit',
            status: 'pending',
            resolvedPolicy: 'require_approval',
          },
          createdAt: '2026-08-10T12:00:01.000Z',
        },
        {
          id: 'ev-3',
          seq: 3,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { content: 'Terminei de explicar' },
          createdAt: '2026-08-10T12:00:02.000Z',
        },
        {
          id: 'ev-4',
          seq: 4,
          type: 'chat.message',
          actor: { kind: 'user', id: 'u-1' },
          payload: { text: 'ainda estou lendo' },
          createdAt: '2026-08-10T12:00:03.000Z',
        },
        {
          id: 'ev-5',
          seq: 5,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { content: 'Fala do turno seguinte' },
          createdAt: '2026-08-10T12:00:04.000Z',
        },
      ],
    });
    acoes.mockReturnValue([acao({ id: 'acao-1', seq: 999_999 })]);

    const { container } = montar();

    await screen.findByText('propõe alteração');
    await screen.findByText('Fala do turno seguinte');

    const texto = container.textContent ?? '';
    expect(texto.indexOf('propõe alteração')).toBeGreaterThan(
      texto.indexOf('Terminei de explicar'),
    );
    expect(texto.indexOf('propõe alteração')).toBeLessThan(
      texto.indexOf('ainda estou lendo'),
    );
  });
});

describe('RN-173 — o fio acompanha o que cresce', () => {
  let rolou: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom não implementa `scrollIntoView` — sem isto `rolarParaOFim` cai no
    // `?.` e o teste não teria o que observar.
    rolou = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: rolou,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('um ApprovalCard novo (que chega por OUTRA query, sem evento novo) rola o fio', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { content: 'Resposta A' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
        {
          id: 'ev-2',
          seq: 2,
          type: 'proposed_action.created',
          actor: { kind: 'agent', id: 'po' },
          payload: {
            actionId: 'acao-1',
            actionType: 'git_commit',
            status: 'pending',
            resolvedPolicy: 'require_approval',
          },
          createdAt: '2026-08-10T12:00:01.000Z',
        },
      ],
    });
    // A ação ainda NÃO chegou: `usePendingActions` é uma query separada, e é
    // exatamente essa defasagem que o defeito expunha.
    acoes.mockReturnValue([]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const arvore = (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SessionPage projectId="proj-1" sessionId={ID} />
        </ToastProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(arvore);

    await screen.findByText('Resposta A');
    rolou.mockClear();

    // Nenhum evento novo, nenhum delta de streaming: só a ação pendente
    // chegando. Com as dependências antigas (`[events.length, streamingText]`)
    // isto não rolava nada, e o card empurrava a conversa pra fora da tela.
    acoes.mockReturnValue([acao({ id: 'acao-1', seq: 999_999 })]);
    rerender(arvore);

    await screen.findByText('propõe alteração');
    await waitFor(() => expect(rolou).toHaveBeenCalled());
  });

  it('não arrasta quem rolou pra cima — a guarda dos 120px do fim continua valendo', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { content: 'Resposta A' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });
    acoes.mockReturnValue([]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const arvore = (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SessionPage projectId="proj-1" sessionId={ID} />
        </ToastProvider>
      </QueryClientProvider>
    );
    const { container, rerender } = render(arvore);

    await screen.findByText('Resposta A');

    // O container de rolagem, longe do fim: jsdom devolve 0 em todas as
    // métricas de layout, então elas são declaradas aqui à mão.
    const rolavel = container.querySelector('[class*="messages"]') as HTMLElement;
    Object.defineProperty(rolavel, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(rolavel, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(rolavel, 'scrollTop', { value: 0, configurable: true });

    rolou.mockClear();
    acoes.mockReturnValue([acao({ id: 'acao-1', seq: 999_999 })]);
    rerender(arvore);

    await screen.findByText('propõe alteração');
    expect(rolou).not.toHaveBeenCalled();
  });
});

describe('RN-156 — indicador de 5s', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('depois de 5s sem texto, a faixa de atividade mostra "Pensando…"', async () => {
    // Mesmo gatilho de `SessionPage.pista-e-status.test.tsx` (achado B): o
    // `agent.status` "working" chega pelo canal ANTES de qualquer delta
    // quando o turno nasce de um handoff aceito — é o caminho real que arma
    // o indicador de 5s.
    handoffsMock.mockReturnValue([
      {
        id: 'handoff-1',
        sessionId: ID,
        projectId: 'proj-1',
        fromAgent: 'criativo',
        toAgent: 'po',
        artifactId: 'brief-1',
        status: 'offered',
        createdAt: '2026-08-10T12:00:00.000Z',
        updatedAt: '2026-08-10T12:00:00.000Z',
      },
    ]);
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'criativo' },
          payload: { toAgent: 'po' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });
    let resolverAceite: () => void = () => {};
    acceptHandoff.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolverAceite = () => resolve();
        }),
    );

    montar();

    const botaoAceitar = await screen.findByRole('button', {
      name: 'Aceitar handoff e iniciar po',
    });
    act(() => {
      botaoAceitar.click();
    });

    await waitFor(() => expect(canalHandlers?.onAgentStatus).toBeTypeOf('function'));
    act(() => canalHandlers!.onAgentStatus!({ status: 'working' }));

    expect(screen.queryByText('Pensando…')).not.toBeInTheDocument();
    expect(screen.queryByText(/está escrevendo/)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText('Pensando…')).toBeInTheDocument();

    resolverAceite();
  });
});

describe('RN-157 — aviso compacto do PO ao criar épico/história', () => {
  it('backlog.epic_created NÃO usa mais bolha/avatar grande, e mantém o link pro Backlog', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-epic',
          seq: 1,
          type: 'backlog.epic_created',
          actor: { kind: 'agent', id: 'po' },
          payload: { epicId: 'epic-1', title: 'Autenticação de usuários' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });

    montar();

    const pill = await screen.findByText('criou o épico "Autenticação de usuários"');
    expect(pill).toBeInTheDocument();

    // O nome do agente continua visível, só que dentro da pílula compacta —
    // não mais num avatar de 32px com cabeçalho próprio. Escopado dentro da
    // PRÓPRIA pílula (RN-159): o painel "Artefatos gerados" também passou a
    // mostrar "PO" — como nome do GRUPO que a mesma criação de épico
    // alimenta —, e um `getByText` sem escopo bateria nos dois.
    expect(within(pill).getByText('PO')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /Ver no Backlog/ });
    expect(link).toHaveAttribute('href', '/projects/proj-1?tab=backlog');
  });

  it('backlog.story_created usa o mesmo formato compacto', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-story',
          seq: 1,
          type: 'backlog.story_created',
          actor: { kind: 'agent', id: 'po' },
          payload: {
            storyId: 'story-1',
            epicId: 'epic-1',
            title: 'Login com e-mail e senha',
            status: 'draft',
            businessRuleIds: [],
          },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });

    montar();

    expect(
      await screen.findByText('criou a história "Login com e-mail e senha"'),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Ver no Backlog/ });
    expect(link).toHaveAttribute('href', '/projects/proj-1?tab=backlog');
  });
});

describe('agruparNarracoesDoTurno — "Passos do turno" colapsados', () => {
  const ROTULOS = {
    titulo: 'Passos do turno',
    trailing: (count: number) => `${count} passos`,
  };

  const entradaResposta = (
    seq: number,
    texto: string,
    over: { autor?: string; turno?: number } = {},
  ) => ({
    seq,
    node: <div key={seq}>{texto}</div>,
    autor: 'agent:po',
    turno: 1,
    origem: 'agente' as const,
    agentId: 'po',
    agentResponse: true,
    ...over,
  });

  function montarSaida(entradas: ReturnType<typeof entradaResposta>[]) {
    const resultado = agruparNarracoesDoTurno(entradas, ROTULOS);
    render(<>{resultado.map((e) => <div key={e.seq}>{e.node}</div>)}</>);
    return resultado;
  }

  it('3 respostas seguidas do MESMO turno/autor: as duas primeiras colapsam, a última fica intacta fora do Disclosure', () => {
    const resultado = montarSaida([
      entradaResposta(1, 'Um'),
      entradaResposta(2, 'Dois'),
      entradaResposta(3, 'Três'),
    ]);

    // Duas entradas de saída: o Disclosure compacto + a última intacta.
    expect(resultado).toHaveLength(2);

    // A última fica sempre visível, sem clique nenhum.
    expect(screen.getByText('Três')).toBeInTheDocument();
    // As duas primeiras ficam dentro do Disclosure, fechado por padrão.
    expect(screen.queryByText('Um')).not.toBeInTheDocument();
    expect(screen.queryByText('Dois')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Passos do turno/ }));
    expect(screen.getByText('Um')).toBeInTheDocument();
    expect(screen.getByText('Dois')).toBeInTheDocument();
  });

  it('1 resposta sozinha: fica INTACTA, sem Disclosure nenhum', () => {
    const resultado = montarSaida([entradaResposta(1, 'Única')]);

    expect(resultado).toHaveLength(1);
    expect(screen.getByText('Única')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Passos do turno/ })).not.toBeInTheDocument();
  });

  it('turnos diferentes NUNCA se misturam, mesmo com respostas múltiplas em cada um', () => {
    montarSaida([
      entradaResposta(1, 'T1-a', { turno: 1 }),
      entradaResposta(2, 'T1-b', { turno: 1 }),
      entradaResposta(3, 'T2-a', { turno: 3 }),
      entradaResposta(4, 'T2-b', { turno: 3 }),
    ]);

    // Dois grupos independentes — um por turno.
    const cabecalhos = screen.getAllByRole('button', { name: /Passos do turno/ });
    expect(cabecalhos).toHaveLength(2);

    // As últimas de cada turno ficam sempre visíveis.
    expect(screen.getByText('T1-b')).toBeInTheDocument();
    expect(screen.getByText('T2-b')).toBeInTheDocument();

    // Expandir o grupo do turno 1 NÃO revela nada do turno 3.
    fireEvent.click(cabecalhos[0]);
    expect(screen.getByText('T1-a')).toBeInTheDocument();
    expect(screen.queryByText('T2-a')).not.toBeInTheDocument();
  });

  it('autores diferentes no MESMO turno também não se misturam (sessão de execução, vários agentes)', () => {
    montarSaida([
      entradaResposta(1, 'Dev-a', { autor: 'agent:dev-core' }),
      entradaResposta(2, 'Dev-b', { autor: 'agent:dev-core' }),
      entradaResposta(3, 'Po-a', { autor: 'agent:po' }),
      entradaResposta(4, 'Po-b', { autor: 'agent:po' }),
    ]);

    expect(screen.getAllByRole('button', { name: /Passos do turno/ })).toHaveLength(2);
    expect(screen.getByText('Dev-b')).toBeInTheDocument();
    expect(screen.getByText('Po-b')).toBeInTheDocument();
  });

  it('entradas que NÃO são agent.response passam direto, sem participar de grupo nenhum', () => {
    const divisor = {
      seq: 2,
      node: <div key="divisor">Divisor</div>,
      autor: 'agent:po',
      turno: 1,
      origem: 'agente' as const,
      desfecho: true,
    };
    const resultado = agruparNarracoesDoTurno(
      [entradaResposta(1, 'Um'), divisor, entradaResposta(3, 'Dois')],
      ROTULOS,
    );
    // A entrada não-resposta quebra o agrupamento — as duas respostas ficam
    // SEPARADAS (uma de cada lado do divisor), nenhuma delas com Disclosure
    // (cada grupo tem só 1 entrada).
    expect(resultado).toHaveLength(3);
    expect(resultado[1]).toBe(divisor);
  });
});
