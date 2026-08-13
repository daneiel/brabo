import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Achados 2/7 — duplicata de mensagem do usuário e de resposta do agente.
 *
 * Causa raiz: `useSessionEvents` fazia poll INCONDICIONAL a cada 3s, sem
 * nenhuma consciência de turno em andamento. Se o poll caísse DURANTE um
 * turno (comum — turnos costumam durar mais que 3s), ele buscava eventos já
 * persistidos (`chat.message`/`agent.response`) que renderizavam ao lado do
 * estado otimista/streaming ainda em tela — duplicata visual.
 *
 * A correção: `pausarPoll` desliga só o TIMER (`refetchInterval`), nunca a
 * query (`enabled` continua `true`) — é o que garante que a invalidação
 * explícita que `SessionPage` já dispara no fim do turno
 * (`finalizarTurnoDoAgente`) continua buscando o dado fresco na hora certa.
 */

const { contador } = vi.hoisted(() => ({ contador: { n: 0 } }));

vi.mock('./api-client', async () => {
  const real = await vi.importActual<typeof import('./api-client')>('./api-client');
  return {
    ...real,
    listSessionEvents: vi.fn(async () => {
      contador.n += 1;
      return { items: [], nextCursor: null };
    }),
  };
});

const { useSessionEvents } = await import('./hooks');

function montarWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  contador.n = 0;
});

describe('useSessionEvents — pausarPoll', () => {
  it('caminho feliz: sem pausarPoll, o timer refaz a busca sozinho', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useSessionEvents('proj-1', 'sess-1', 20), {
      wrapper: montarWrapper(client),
    });

    await waitFor(() => expect(contador.n).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(contador.n).toBeGreaterThanOrEqual(2), { timeout: 1000 });
  });

  it('CASO DE FALHA (a duplicata): com pausarPoll, o timer NÃO refaz sozinho', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useSessionEvents('proj-1', 'sess-1', 20, true), {
      wrapper: montarWrapper(client),
    });

    await waitFor(() => expect(contador.n).toBe(1));

    // Tempo de sobra pra vários ciclos de 20ms — se o timer estivesse
    // rodando, a contagem já teria subido bem além de 1.
    await esperar(150);
    expect(contador.n).toBe(1);

    // Pausar o TIMER não é desligar a query: a invalidação explícita (o que
    // `finalizarTurnoDoAgente` chama no fim do turno) continua buscando.
    await client.invalidateQueries({ queryKey: ['session-events', 'proj-1', 'sess-1'] });
    await waitFor(() => expect(contador.n).toBe(2));
  });
});
