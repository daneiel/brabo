import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ProposedAction, SessionEvent } from './api-types';
import { identidadeDoFio, useRolagemDoFio } from './session-rolagem';
import { criarStoreDoStreaming } from './streaming-do-turno';

const ev = (seq: number) => ({ id: `e${seq}`, seq, type: 'chat.message' }) as unknown as SessionEvent;
const ac = (id: string) => ({ id }) as unknown as ProposedAction;

let observadores: Array<{ cb: () => void; alvos: unknown[] }> = [];
class RO {
  o = { cb: () => {}, alvos: [] as unknown[] };
  constructor(cb: () => void) {
    this.o.cb = cb;
    observadores.push(this.o);
  }
  observe(el: unknown) {
    this.o.alvos.push(el);
  }
  disconnect() {}
}

type Props = { events: SessionEvent[]; actions: ProposedAction[]; highlightEvent?: string };

function montar(inicial: Props) {
  const store = criarStoreDoStreaming();
  const rolar = vi.fn();
  const hook = renderHook(
    (p: Props) => {
      const r = useRolagemDoFio({ logOpen: true, streamingStore: store, highlightEvent: undefined, ...p });
      // Os refs ficam prontos antes dos efeitos (no DOM real o React os liga).
      r.messagesEndRef.current ??= { scrollIntoView: rolar } as unknown as HTMLDivElement;
      r.messagesInnerRef.current ??= {} as HTMLDivElement;
      r.scrollContainerRef.current ??= document.createElement('div');
      return r;
    },
    { initialProps: inicial },
  );
  return { hook, rolar, store, rolagem: () => hook.result.current };
}

beforeEach(() => {
  observadores = [];
  vi.stubGlobal('ResizeObserver', RO);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('identidadeDoFio (RN-951)', () => {
  it('muda com o seq do último evento mesmo com length igual', () => {
    expect(identidadeDoFio([ev(1), ev(2)], [])).not.toBe(identidadeDoFio([ev(2), ev(3)], []));
  });
  it('muda com a troca de ação de mesmo tamanho', () => {
    expect(identidadeDoFio([ev(1)], [ac('a')])).not.toBe(identidadeDoFio([ev(1)], [ac('b')]));
  });
});

describe('useRolagemDoFio (RN-951, revisada na RN-977)', () => {
  it('abre no fim e cada mensagem nova vai ao fim enquanto a pessoa está no fim', () => {
    const { hook, rolar } = montar({ events: [ev(1)], actions: [] });
    expect(rolar).toHaveBeenCalledTimes(1);
    expect(rolar).toHaveBeenLastCalledWith({ block: 'end' });
    hook.rerender({ events: [ev(1), ev(2)], actions: [] });
    expect(rolar).toHaveBeenCalledTimes(2);
  });

  it('troca de evento com length igual (teto de 200) segue o fim', () => {
    const { hook, rolar } = montar({ events: [ev(1), ev(2)], actions: [] });
    hook.rerender({ events: [ev(2), ev(3)], actions: [] });
    expect(rolar).toHaveBeenCalledTimes(2);
  });

  it('ação nova (cartão de aprovação) vai ao fim', () => {
    const { hook, rolar } = montar({ events: [ev(1)], actions: [] });
    hook.rerender({ events: [ev(1)], actions: [ac('a')] });
    expect(rolar).toHaveBeenCalledTimes(2);
  });

  it('container que encolhe (ResizeObserver) vai ao fim, e o container é observado', () => {
    const { rolar } = montar({ events: [ev(1)], actions: [] });
    rolar.mockClear();
    expect(observadores[0]!.alvos).toHaveLength(2);
    observadores[0]!.cb();
    expect(rolar).toHaveBeenCalledTimes(1);
  });

  it('highlightEvent: não rola ao fim na abertura, mas segue na primeira mudança', () => {
    const { hook, rolar } = montar({ events: [ev(1)], actions: [], highlightEvent: 'x' });
    expect(rolar).not.toHaveBeenCalled();
    observadores[0]!.cb();
    expect(rolar).not.toHaveBeenCalled();
    hook.rerender({ events: [ev(1), ev(2)], actions: [], highlightEvent: 'x' });
    expect(rolar).toHaveBeenCalledTimes(1);
  });

  it('rajada de eventos novos rola a cada um', () => {
    const { hook, rolar } = montar({ events: [ev(1)], actions: [] });
    for (let i = 2; i <= 5; i++) hook.rerender({ events: [ev(i - 1), ev(i)], actions: [] });
    expect(rolar).toHaveBeenCalledTimes(5);
  });

  it('streaming: texto novo rola na volta seguinte; texto igual não', () => {
    const { rolar, store } = montar({ events: [ev(1)], actions: [] });
    rolar.mockClear();
    act(() => store.definirTexto('oi'));
    expect(rolar).not.toHaveBeenCalled();
    act(() => {
      vi.runAllTimers();
    });
    expect(rolar).toHaveBeenCalledTimes(1);
  });

  it('CASO DE FALHA evitado: sem eventos nem ações não rola', () => {
    const { rolar } = montar({ events: [], actions: [] });
    expect(rolar).not.toHaveBeenCalled();
  });

  function rolarContainer(el: HTMLElement, distanciaDoFim: number) {
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
    el.scrollTop = 600 - distanciaDoFim;
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
  }

  it('RN-977: acima do limite o fio PARA de seguir e mostra "ir ao fim"; o clique retoma', () => {
    const { hook, rolar, rolagem } = montar({ events: [ev(1)], actions: [] });
    expect(rolagem().afastado).toBe(false);
    rolar.mockClear();
    rolarContainer(rolagem().scrollContainerRef.current!, 300);
    expect(rolagem().afastado).toBe(true);
    hook.rerender({ events: [ev(1), ev(2)], actions: [] });
    observadores[0]!.cb();
    expect(rolar).not.toHaveBeenCalled();
    act(() => rolagem().irAoFim());
    expect(rolar).toHaveBeenCalledTimes(1);
    expect(rolagem().afastado).toBe(false);
    hook.rerender({ events: [ev(1), ev(2), ev(3)], actions: [] });
    expect(rolar).toHaveBeenCalledTimes(2);
  });

  it('RN-977: voltar ao fim rolando à mão também retoma, e perto do fim (<=80px) não pausa', () => {
    const { rolagem } = montar({ events: [ev(1)], actions: [] });
    rolarContainer(rolagem().scrollContainerRef.current!, 60);
    expect(rolagem().afastado).toBe(false);
    rolarContainer(rolagem().scrollContainerRef.current!, 300);
    expect(rolagem().afastado).toBe(true);
    rolarContainer(rolagem().scrollContainerRef.current!, 0);
    expect(rolagem().afastado).toBe(false);
  });
});
