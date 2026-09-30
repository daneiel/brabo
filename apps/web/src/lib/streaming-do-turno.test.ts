import { describe, expect, it, vi } from 'vitest';
import { criarStoreDoStreaming, semConteudoNoTurno } from './streaming-do-turno';
import { renderHook } from '@testing-library/react';
import { unirPaginasDeEventos, useUniaoDePaginasDeEventos } from './uniao-de-paginas';
import type { SessionEvent } from './api-types';

describe('store do streaming do turno (AT-301)', () => {
  it('caminho feliz: acumula texto e atividade e avisa quem assina', () => {
    const store = criarStoreDoStreaming();
    const ouvinte = vi.fn();
    store.subscribe(ouvinte);

    store.definirTexto('Olá');
    store.definirTexto((t) => t + ', mundo');
    store.despacharAtividade({ tipo: 'delta', texto: 'pensando' });
    store.despacharAtividade({ tipo: 'tool_call', frase: 'Registrando a regra' });

    expect(store.ler().texto).toBe('Olá, mundo');
    expect(store.ler().atividade.linhas).toEqual([
      { tipo: 'narracao', texto: 'pensando' },
      { tipo: 'ferramenta', texto: 'Registrando a regra' },
    ]);
    expect(ouvinte).toHaveBeenCalledTimes(4);
  });

  it('o mesmo valor NÃO avisa ninguém — o bailout do setState', () => {
    const store = criarStoreDoStreaming();
    const ouvinte = vi.fn();
    store.subscribe(ouvinte);

    store.definirTexto('');
    store.despacharAtividade({ tipo: 'reset' });

    expect(ouvinte).not.toHaveBeenCalled();
  });

  it('cancelar a assinatura para de avisar', () => {
    const store = criarStoreDoStreaming();
    const ouvinte = vi.fn();
    const cancelar = store.subscribe(ouvinte);
    cancelar();
    store.definirTexto('x');
    expect(ouvinte).not.toHaveBeenCalled();
  });

  it('`semConteudoNoTurno` só vira false com texto ou linha — e volta com o reset', () => {
    const store = criarStoreDoStreaming();
    expect(semConteudoNoTurno(store.ler())).toBe(true);
    store.despacharAtividade({ tipo: 'tool_call', frase: 'lendo' });
    expect(semConteudoNoTurno(store.ler())).toBe(false);
    store.despacharAtividade({ tipo: 'reset' });
    expect(semConteudoNoTurno(store.ler())).toBe(true);
    store.definirTexto('a');
    expect(semConteudoNoTurno(store.ler())).toBe(false);
  });
});

function ev(id: string, seq: number, conteudo = id): SessionEvent {
  return {
    id,
    seq,
    type: 'chat.message',
    actor: { kind: 'user', id: 'u' },
    payload: { content: conteudo },
    createdAt: '2026-09-30T00:00:00.000Z',
  } as SessionEvent;
}

describe('união das páginas do histórico (AT-301, RN-099)', () => {
  it('deduplica por id, ordena por seq, e a cauda (última) vence no mesmo id', () => {
    const antiga = [ev('b', 2), ev('a', 1)];
    const cauda = [ev('b', 2, 'novo'), ev('c', 3)];
    const todos = unirPaginasDeEventos([antiga, cauda]);
    expect(todos.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect((todos[1].payload as { content: string }).content).toBe('novo');
  });

  it('página ainda não carregada (`undefined`) não quebra nem some com as outras', () => {
    expect(unirPaginasDeEventos([undefined, [ev('a', 1)]]).map((e) => e.id)).toEqual(['a']);
    expect(unirPaginasDeEventos([undefined])).toEqual([]);
  });

  it('sob memo: mesmas páginas (mesmas referências) devolvem a MESMA lista; página nova recalcula', () => {
    const antiga = [ev('a', 1)];
    const cauda = [ev('b', 2)];
    const { result, rerender } = renderHook(
      ({ paginas }) => useUniaoDePaginasDeEventos(paginas),
      { initialProps: { paginas: [antiga, cauda] as (SessionEvent[] | undefined)[] } },
    );
    const primeira = result.current;
    // Array de páginas NOVO a cada render (como `antigas.map(...)`), itens iguais.
    rerender({ paginas: [antiga, cauda] });
    expect(result.current).toBe(primeira);

    rerender({ paginas: [antiga, [...cauda, ev('c', 3)]] });
    expect(result.current).not.toBe(primeira);
    expect(result.current.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});
