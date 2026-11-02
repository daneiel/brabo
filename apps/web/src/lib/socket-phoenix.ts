import { Socket } from 'phoenix';

/**
 * Socket Phoenix que se descarta de verdade — AT-500, RN-833.
 *
 * `phoenix@1.8.9` registra, no construtor de TODO `Socket`, três ouvintes em
 * `window` (`pagehide`, `pageshow`, `visibilitychange`) e nunca os remove:
 * `disconnect()` não os toca. Cada socket criado e "desligado" seguia vivo
 * por eles — o `visibilitychange` de voltar à aba reabria a conexão do
 * socket velho. Por isso todo socket do web nasce por `criarSocket`, que
 * captura esses ouvintes durante o `new Socket` (o phoenix.js guarda a
 * referência ao MESMO `window`) e os remove em `descartar()`.
 *
 * `reconnectAfterMs` é OBRIGATÓRIO no tipo (RN-108): o auto-reconnect
 * embutido repetiria o ticket de uso único, e quem o neutraliza é o
 * chamador, com a política própria de reconexão.
 */
export interface OpcoesDoSocketPhoenix {
  params: Record<string, unknown>;
  reconnectAfterMs: (tentativa: number) => number;
}

export interface SocketDescartavel {
  socket: Socket;
  /** `disconnect()` + remove os ouvintes de `window`. Idempotente. */
  descartar(): void;
}

type Ouvinte = [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined];

export function criarSocket(url: string, opcoes: OpcoesDoSocketPhoenix): SocketDescartavel {
  const capturados: Ouvinte[] = [];
  const temJanela = typeof window !== 'undefined';
  const original = temJanela ? window.addEventListener : undefined;
  let socket: Socket;
  if (temJanela && original) {
    window.addEventListener = function (
      this: Window,
      tipo: string,
      ouvinte: EventListenerOrEventListenerObject | null,
      opts?: boolean | AddEventListenerOptions,
    ) {
      if (!ouvinte) return;
      capturados.push([tipo, ouvinte, opts]);
      return original.call(this, tipo, ouvinte, opts);
    } as typeof window.addEventListener;
  }
  try {
    socket = new Socket(url, opcoes);
  } finally {
    if (temJanela && original) window.addEventListener = original;
  }
  let descartado = false;
  return {
    socket,
    descartar() {
      if (descartado) return;
      descartado = true;
      socket.disconnect();
      for (const [tipo, ouvinte, opts] of capturados) {
        window.removeEventListener(tipo, ouvinte, opts);
      }
      capturados.length = 0;
    },
  };
}
