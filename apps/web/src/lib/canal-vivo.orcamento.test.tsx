import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  useQuery,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * AT-093 (RN-579) — o ORÇAMENTO de requisições de uma aba na tela de Sessão.
 *
 * A medição na instalação (v6.1.0, 14/09) deu, para um navegador, mediana de
 * 118 req/min e pico de 263/min, contra os 300/min do `RATE_LIMIT_USER`. Este
 * teste monta os MESMOS observadores que a tela monta — o `Shell` (resumo dos
 * projetos, sessão de execução e os eventos dela), a `SessionPage` (sessão,
 * orçamento, eventos, ações, handoffs, backlog) e o `ContextAside` (histórico,
 * mesma chave dos eventos) —, com os MESMOS defaults de query de `main.tsx`,
 * e conta as chamadas por rota em 60s de relógio falso.
 *
 * Os números saem daqui, não de estimativa: é o "antes/depois" da AT-093, e é
 * a guarda de que ninguém devolve um poll de 3s a uma query da sessão sem
 * passar pelo canal.
 *
 * O que ele NÃO mede: requisições de ação (mutations), o refetch de foco da
 * janela e as rotas fora da tela de Sessão — por isso o "antes" daqui (123)
 * fica perto, e não igual, da mediana medida (118, que inclui tempo de turno
 * em streaming, quando o poll de eventos pausa).
 */

const { contagem } = vi.hoisted(() => ({ contagem: new Map<string, number>() }));

function contar(rota: string) {
  contagem.set(rota, (contagem.get(rota) ?? 0) + 1);
}

vi.mock('./api-client', async () => {
  const real = await vi.importActual<typeof import('./api-client')>('./api-client');
  return {
    ...real,
    getProjectsSummary: vi.fn(async () => (contar('projects-summary'), [])),
    getActiveExecutionSession: vi.fn(async () => (contar('execution/session'), { id: 'sess-1' })),
    listSessionEvents: vi.fn(async () => (contar('events'), { items: [], nextCursor: null })),
    listActions: vi.fn(async () => (contar('actions'), { items: [], nextCursor: null })),
    listHandoffs: vi.fn(async () => (contar('handoffs'), [])),
    listBacklog: vi.fn(async () => (contar('backlog'), [])),
    getSession: vi.fn(async () => (contar('session'), { id: 'sess-1', status: 'active' })),
    getSessionBudget: vi.fn(async () => (contar('budget'), null)),
  };
});

const hooks = await import('./hooks');
const api = await import('./api-client');
const { OPCOES_PADRAO_DAS_QUERIES, pollQueParaNoErro } = await import('./query-policy');
const {
  INTERVALO_DO_ORCAMENTO_COM_CANAL_MS,
  criarInvalidadorDoCanal,
  intervaloDaSessao,
  marcarCanalDaSessao,
  useCanalDaSessaoVivo,
} = await import('./canal-vivo');

const P = 'proj-1';
const S = 'sess-1';

/** Os observadores da tela de Sessão, com os argumentos que ela passa. */
function TelaDeSessao() {
  // Shell
  hooks.useProjectsSummary('ws-1');
  const { session: exec } = hooks.useActiveExecutionSession(P);
  hooks.useSessionEvents(P, exec?.id);
  // SessionPage — `session` e `budget` são `useQuery` inline lá; a expressão
  // do intervalo é a mesma.
  const canalVivo = useCanalDaSessaoVivo(S);
  useQuery({
    queryKey: ['session', P, S],
    queryFn: () => api.getSession(P, S),
    refetchInterval: pollQueParaNoErro(intervaloDaSessao(5000, canalVivo)),
  });
  useQuery({
    queryKey: ['session-budget', P, S],
    queryFn: () => api.getSessionBudget(P, S),
    refetchInterval: pollQueParaNoErro(
      intervaloDaSessao(5000, canalVivo, INTERVALO_DO_ORCAMENTO_COM_CANAL_MS),
    ),
  });
  hooks.useSessionEvents(P, S, 3000);
  hooks.usePendingActions(P, S, 3000);
  hooks.useHandoffs(P, S, 3000);
  hooks.useBacklog(P, undefined, S);
  // ContextAside
  hooks.useSessionEventHistory(P, S, 3000);
  return null;
}

function montar(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: OPCOES_PADRAO_DAS_QUERIES } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<TelaDeSessao />, { wrapper: Wrapper });
  return client;
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Chamadas por rota num minuto, depois de a tela ter carregado. */
async function umMinuto(): Promise<Record<string, number>> {
  await avancar(100);
  const antes = new Map(contagem);
  await avancar(60_000);
  const porRota: Record<string, number> = {};
  for (const [rota, n] of contagem) porRota[rota] = n - (antes.get(rota) ?? 0);
  return porRota;
}

const total = (porRota: Record<string, number>) =>
  Object.values(porRota).reduce((a, b) => a + b, 0);

beforeEach(() => {
  vi.useFakeTimers();
  contagem.clear();
  focusManager.setFocused(true);
});

afterEach(() => {
  marcarCanalDaSessao(S, false);
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe('orçamento de requisições da tela de Sessão (AT-093, RN-579)', () => {
  it('ANTES — canal caído: o poll de sempre, ~123/min por aba (2 abas ≈ 246, e o pico medido passa de 300)', async () => {
    montar();
    const porRota = await umMinuto();

    expect(porRota).toMatchObject({
      events: 20,
      actions: 20,
      handoffs: 20,
      backlog: 15,
      session: 12,
      budget: 12,
      'projects-summary': 12,
      'execution/session': 12,
    });
    expect(total(porRota)).toBe(123);
  });

  it('DEPOIS — canal vivo: fallback de 15s/30s, ~46/min por aba', async () => {
    marcarCanalDaSessao(S, true);
    montar();
    const porRota = await umMinuto();

    expect(porRota).toMatchObject({
      events: 4,
      actions: 4,
      handoffs: 4,
      backlog: 4,
      session: 4,
      budget: 2,
      // O Shell não é da sessão: o canal não sabe do workspace inteiro.
      'projects-summary': 12,
      'execution/session': 12,
    });
    expect(total(porRota)).toBe(46);
    // Duas abas visíveis, com margem de sobra até o teto.
    expect(2 * total(porRota)).toBeLessThan(300 / 3);
  });

  it('CASO DE FALHA coberto: o canal cai no meio e o poll curto volta na hora', async () => {
    marcarCanalDaSessao(S, true);
    montar();
    await avancar(100);
    marcarCanalDaSessao(S, false);
    const porRota = await umMinuto();
    expect(porRota.events).toBe(20);
    expect(porRota.actions).toBe(20);
  });

  it('rajada no canal (10 avisos/s por 60s) vira no máximo UMA busca por janela, não uma por aviso', async () => {
    marcarCanalDaSessao(S, true);
    const client = montar();
    const invalidador = criarInvalidadorDoCanal(client, P, S);
    await avancar(100);
    const antes = new Map(contagem);

    for (let decimo = 0; decimo < 600; decimo += 1) {
      invalidador.aoEvento(decimo % 50 === 0 ? 'proposed_action.created' : 'tool.result', false);
      await avancar(100);
    }
    invalidador.encerrar();

    const eventos = contagem.get('events')! - antes.get('events')!;
    const acoes = contagem.get('actions')! - antes.get('actions')!;
    const orcamento = contagem.get('budget')! - antes.get('budget')!;
    const handoffs = contagem.get('handoffs')! - antes.get('handoffs')!;
    // Janela de 3s nos eventos: ≤ 20 por invalidação + 4 do fallback.
    expect(eventos).toBeLessThanOrEqual(24);
    // 12 propostas espaçadas de 5s — cada uma sai NA HORA (janela de 2s).
    expect(acoes).toBeGreaterThanOrEqual(12);
    expect(acoes).toBeLessThanOrEqual(16);
    // Janela de 10s no orçamento: ≤ 6 + 2.
    expect(orcamento).toBeLessThanOrEqual(8);
    // Tipo que não é de handoff não toca handoffs: só o fallback.
    expect(handoffs).toBe(4);
  });

  it('aba OCULTA não polla nada (refetchIntervalInBackground: false, medido, não suposto)', async () => {
    montar();
    await avancar(100);
    focusManager.setFocused(false);
    const porRota = await umMinuto();
    expect(total(porRota)).toBe(0);
  });
});
