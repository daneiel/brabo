import { useSyncExternalStore } from 'react';
import {
  ESTADO_INICIAL_DA_ATIVIDADE,
  reduzirAtividadeDoTurno,
  type AcaoDeAtividadeDoTurno,
  type EstadoDaAtividadeDoTurno,
} from './atividade-do-turno';

/**
 * O que muda a cada TOKEN de um turno (AT-301), fora do estado da `SessionPage`.
 *
 * Até aqui os dois acumuladores de texto do turno — `streamingText` (bolha do
 * chat consultivo, SSE) e o reducer da faixa de atividade (turno de agente,
 * canal) — eram `useState`/`useReducer` dentro de `useTurnoDoAgente`, e o hook
 * é chamado pela `SessionPage`. Cada delta, portanto, re-renderizava a PÁGINA
 * INTEIRA: fio, topbar, painel lateral, composer, e toda derivação que roda no
 * corpo dela. Um turno de mil tokens era mil renders da página.
 *
 * Agora os dois moram num store externo por sessão, e só os DOIS componentes
 * que desenham texto em curso o assinam (`useSyncExternalStore`): a bolha do
 * fio e a faixa. A página assina uma única pergunta BOOLEANA — "o turno já
 * mostrou algum conteúdo?" —, que é o que o timer de "pensando" (RN-131)
 * precisa, e ela muda uma vez por turno, não por token.
 *
 * O reducer (`reduzirAtividadeDoTurno`) é o MESMO, puro e testado à parte;
 * este arquivo só troca QUEM guarda o estado.
 */
export interface EstadoDoStreaming {
  /** O texto em curso do chat consultivo sem agente (SSE). */
  texto: string;
  /** A faixa de atividade do turno de agente (canal). */
  atividade: EstadoDaAtividadeDoTurno;
}

export interface StoreDoStreaming {
  subscribe(ouvinte: () => void): () => void;
  ler(): EstadoDoStreaming;
  /** Aceita valor ou função, como o `setState` que substitui. */
  definirTexto(proximo: string | ((atual: string) => string)): void;
  despacharAtividade(acao: AcaoDeAtividadeDoTurno): void;
}

const ESTADO_INICIAL: EstadoDoStreaming = {
  texto: '',
  atividade: ESTADO_INICIAL_DA_ATIVIDADE,
};

export function criarStoreDoStreaming(): StoreDoStreaming {
  let estado = ESTADO_INICIAL;
  const ouvintes = new Set<() => void>();

  const publicar = (proximo: EstadoDoStreaming) => {
    // Mesmo valor não notifica — o equivalente do bailout do `setState`.
    if (proximo === estado) return;
    estado = proximo;
    for (const ouvinte of ouvintes) ouvinte();
  };

  return {
    subscribe(ouvinte) {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
    ler: () => estado,
    definirTexto(proximo) {
      const texto = typeof proximo === 'function' ? proximo(estado.texto) : proximo;
      if (texto === estado.texto) return;
      publicar({ ...estado, texto });
    },
    despacharAtividade(acao) {
      const atividade = reduzirAtividadeDoTurno(estado.atividade, acao);
      if (atividade === estado.atividade) return;
      publicar({ ...estado, atividade });
    },
  };
}

/** O turno ainda não mostrou NADA — nem texto de SSE, nem linha na faixa. */
export function semConteudoNoTurno({ texto, atividade }: EstadoDoStreaming): boolean {
  return !texto && !atividade.corrente && atividade.linhas.length === 0;
}

export function useTextoDoStreaming(store: StoreDoStreaming): string {
  return useSyncExternalStore(store.subscribe, () => store.ler().texto);
}

export function useAtividadeDoStreaming(store: StoreDoStreaming): EstadoDaAtividadeDoTurno {
  return useSyncExternalStore(store.subscribe, () => store.ler().atividade);
}

/**
 * A ÚNICA assinatura que a página faz: um booleano. O `useSyncExternalStore`
 * compara o snapshot com `Object.is`, então um token que não muda a resposta
 * não re-renderiza quem pergunta.
 */
export function useSemConteudoNoTurno(store: StoreDoStreaming): boolean {
  return useSyncExternalStore(store.subscribe, () => semConteudoNoTurno(store.ler()));
}
