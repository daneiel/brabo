import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  EVENTOS_POR_PAGINA,
  useSessionEventHistory,
  useSessionEvents,
} from './hooks';
import type { Page, SessionEvent } from './api-types';

/**
 * O HISTÓRICO de Atividades pagina; o ESTADO ATUAL não (RN-099).
 *
 * Os dois testes que importam aqui são de CUSTO, não de conteúdo: a separação
 * só vale a pena se ela não reintroduzir o fan-out que a RN-090 matou. Por
 * isso o mock conta chamadas e registra os argumentos — o que se afirma é
 * quantas requisições saíram e com que corte, não só o que voltou na tela.
 */

const { chamadas, sessao } = vi.hoisted(() => ({
  chamadas: [] as { afterSeq?: number; limit?: number; latest?: boolean }[],
  sessao: { total: 0 },
}));

function evento(seq: number): SessionEvent {
  return {
    id: `evt-${seq}`,
    sessionId: 'sess-1',
    seq,
    type: 'chat.message',
    actor: { kind: 'user', id: 'user-1' },
    payload: {},
    createdAt: new Date(seq * 1000).toISOString(),
  };
}

vi.mock('./api-client', async () => {
  const real = await vi.importActual<typeof import('./api-client')>('./api-client');
  return {
    ...real,
    listSessionEvents: (
      _p: string,
      _s: string,
      opts: { afterSeq?: number; limit?: number; latest?: boolean } = {},
    ): Promise<Page<SessionEvent>> => {
      chamadas.push(opts);
      const todos = Array.from({ length: sessao.total }, (_, i) => evento(i + 1));
      const limit = opts.limit ?? 50;

      if (opts.latest) {
        return Promise.resolve({ items: todos.slice(-limit), nextCursor: null });
      }
      const depois = todos.filter((e) => e.seq > (opts.afterSeq ?? 0));
      const pagina = depois.slice(0, limit);
      return Promise.resolve({
        items: pagina,
        nextCursor: depois.length > limit ? pagina[pagina.length - 1].seq : null,
      });
    },
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  chamadas.length = 0;
});

describe('useSessionEventHistory — a janela', () => {
  it('abre na CAUDA, não no começo da sessão', async () => {
    sessao.total = 500;

    const { result } = renderHook(
      () => useSessionEventHistory('proj-1', 'sess-1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.events.length).toBeGreaterThan(0));

    // O último evento da sessão está na tela ANTES de qualquer clique — quem
    // abre Atividades quer o que acabou de acontecer, não o evento nº 1.
    expect(result.current.events).toHaveLength(EVENTOS_POR_PAGINA);
    expect(result.current.events[result.current.events.length - 1].seq).toBe(500);
    expect(result.current.events[0].seq).toBe(501 - EVENTOS_POR_PAGINA);
    expect(result.current.temMaisAntigos).toBe(true);
  });

  it('sessão curta não oferece página que não existe', async () => {
    sessao.total = 12;

    const { result } = renderHook(
      () => useSessionEventHistory('proj-1', 'sess-1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.events).toHaveLength(12));
    expect(result.current.temMaisAntigos).toBe(false);
  });

  it('o primeiro clique NÃO custa requisição: revela o que já veio na cauda', async () => {
    sessao.total = 500;

    const { result } = renderHook(
      () => useSessionEventHistory('proj-1', 'sess-1'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.events).toHaveLength(100));

    const antes = chamadas.length;
    act(() => result.current.carregarMaisAntigos());

    await waitFor(() => expect(result.current.events).toHaveLength(200));
    // A leitura `latest` traz 200 e a janela mostrava 100. Pedir de novo o que
    // já está em memória seria pagar duas vezes pelos mesmos eventos.
    expect(chamadas).toHaveLength(antes);
  });

  it('o clique seguinte pagina com afterSeq, sem rota nova', async () => {
    sessao.total = 500;

    const { result } = renderHook(
      () => useSessionEventHistory('proj-1', 'sess-1'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.events).toHaveLength(100));

    act(() => result.current.carregarMaisAntigos());
    await waitFor(() => expect(result.current.events).toHaveLength(200));
    act(() => result.current.carregarMaisAntigos());
    await waitFor(() => expect(result.current.events).toHaveLength(300));

    // A cauda vai de 301 a 500; a página pedida cobre 201..300 — contígua,
    // sem buraco e sem repetir.
    const paginada = chamadas.filter((c) => !c.latest);
    expect(paginada).toEqual([{ afterSeq: 200, limit: EVENTOS_POR_PAGINA }]);
    expect(result.current.events[0].seq).toBe(201);
    expect(result.current.events[result.current.events.length - 1].seq).toBe(500);
  });

  it('desce até o começo da sessão e PARA — o laço termina', async () => {
    sessao.total = 260;

    const { result } = renderHook(
      () => useSessionEventHistory('proj-1', 'sess-1'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.events).toHaveLength(100));

    for (let i = 0; i < 5 && result.current.temMaisAntigos; i++) {
      act(() => result.current.carregarMaisAntigos());
      await waitFor(() => expect(result.current.carregandoMaisAntigos).toBe(false));
    }

    expect(result.current.events).toHaveLength(260);
    expect(result.current.events[0].seq).toBe(1);
    expect(result.current.temMaisAntigos).toBe(false);
  });
});

describe('useSessionEventHistory — o custo', () => {
  it('montado JUNTO com o estado atual, a cauda é UMA busca só', async () => {
    sessao.total = 500;

    // É a situação real da Visão geral: a roster/árvore/execução pedem
    // `useSessionEvents` e a coluna de atividade pede o histórico. Se as duas
    // queries tivessem chaves diferentes, cada ciclo de poll custaria o dobro.
    const { result } = renderHook(
      () => ({
        atual: useSessionEvents('proj-1', 'sess-1'),
        historico: useSessionEventHistory('proj-1', 'sess-1'),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.atual.data?.items).toBeDefined());
    await waitFor(() =>
      expect(result.current.historico.events.length).toBeGreaterThan(0),
    );

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toEqual({ limit: 200, latest: true });
  });

  it('página antiga NÃO repolla — evento é imutável', async () => {
    sessao.total = 500;

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchInterval: false } },
    });
    const { result } = renderHook(
      () => useSessionEventHistory('proj-1', 'sess-1'),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.events).toHaveLength(100));
    act(() => result.current.carregarMaisAntigos());
    await waitFor(() => expect(result.current.events).toHaveLength(200));
    act(() => result.current.carregarMaisAntigos());
    await waitFor(() => expect(result.current.events).toHaveLength(300));

    const depoisDaPagina = chamadas.length;

    // Nenhuma página antiga declara intervalo de poll. A afirmação é sobre a
    // OPÇÃO, não sobre o efeito: um `refetchInterval` numérico aqui só
    // apareceria depois de alguns segundos de relógio, e o teste que espera o
    // efeito passaria enquanto o produto sangra em produção.
    const paginas = client
      .getQueryCache()
      .findAll({ queryKey: ['session-events-page'] });
    expect(paginas.length).toBeGreaterThan(0);
    for (const p of paginas) {
      // `QueryOptions` não declara `refetchInterval` (ele é de
      // `QueryObserverOptions`), e o cache guarda o tipo largo — daí a leitura
      // estrutural em vez de pelo tipo nominal.
      const opcoes = p.options as { refetchInterval?: unknown };
      expect(opcoes.refetchInterval ?? false).toBe(false);
    }

    // `staleTime: Infinity` é o que segura: invalidar TUDO deixa a página
    // antiga quieta, porque uma janela fechada de `seq` sobre eventos
    // imutáveis não tem o que atualizar.
    await act(async () => {
      await client.refetchQueries({ queryKey: ['session-events-page'], stale: true });
    });

    expect(chamadas).toHaveLength(depoisDaPagina);
  });
});
