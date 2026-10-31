import { describe, it, expect, vi, afterEach } from 'vitest';
import { criarSocket } from './socket-phoenix';

/**
 * AT-500 (RN-833): com o Phoenix REAL no jsdom — o vazamento é do construtor
 * do `phoenix@1.8.9`, e só o pacote de verdade o reproduz.
 */
const TIPOS = ['pagehide', 'pageshow', 'visibilitychange'] as const;
const opcoes = { params: { ticket: 't' }, reconnectAfterMs: () => 86_400_000 };

// Conta por atribuição simples em `window`, não por `vi.spyOn`: o spy vira
// acessor, e a atribuição que `criarSocket` faz não o substituiria.
function contarOuvintes() {
  const saldo: Record<string, number> = {};
  const proto = window as unknown as EventTarget;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  proto.addEventListener = function (this: EventTarget, tipo: string, ...resto: unknown[]) {
    saldo[tipo] = (saldo[tipo] ?? 0) + 1;
    return (add as (...a: unknown[]) => void).call(this, tipo, ...resto);
  } as typeof add;
  proto.removeEventListener = function (this: EventTarget, tipo: string, ...resto: unknown[]) {
    saldo[tipo] = (saldo[tipo] ?? 0) - 1;
    return (remove as (...a: unknown[]) => void).call(this, tipo, ...resto);
  } as typeof remove;
  return {
    saldo,
    restaurar: () => {
      proto.addEventListener = add;
      proto.removeEventListener = remove;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('criarSocket (RN-833)', () => {
  it('50× criar + descartar deixa saldo líquido 0 nos três ouvintes de window', () => {
    const { saldo, restaurar } = contarOuvintes();
    for (let i = 0; i < 50; i++) {
      const { socket, descartar } = criarSocket('ws://127.0.0.1:9/socket', opcoes);
      socket.channel('session:x', {});
      descartar();
      descartar(); // idempotente
    }
    restaurar();
    expect(Object.fromEntries(TIPOS.map((t) => [t, saldo[t]]))).toEqual({ pagehide: 0, pageshow: 0, visibilitychange: 0 });
  });

  it('restaura o addEventListener original de window', () => {
    const original = window.addEventListener;
    criarSocket('ws://127.0.0.1:9/socket', opcoes).descartar();
    expect(window.addEventListener).toBe(original);
  });

  it('visibilitychange depois do descarte não abre conexão', () => {
    const { socket, descartar } = criarSocket('ws://127.0.0.1:9/socket', opcoes);
    descartar();
    const connect = vi.spyOn(socket, 'connect');
    window.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(connect).not.toHaveBeenCalled();
  });

  it('falha: socket só desconectado (sem descartar) deixa os três ouvintes', () => {
    const { saldo, restaurar } = contarOuvintes();
    const { socket } = criarSocket('ws://127.0.0.1:9/socket', opcoes);
    socket.disconnect();
    restaurar();
    for (const tipo of TIPOS) expect(saldo[tipo]).toBe(1);
  });
});
