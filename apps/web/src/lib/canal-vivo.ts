import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';

/**
 * O poll da Sessão com o canal Phoenix vivo — AT-093, RN-579.
 *
 * ## O que foi medido
 *
 * Na instalação (v6.1.0, 14/09), UM navegador fez 7.088 requisições em 56 min:
 * mediana de 118/min, pico de 263/min, contra os 300/min do `RATE_LIMIT_USER`.
 * Quase tudo era poll de 3–5s da tela de Sessão sobre dados que MUDAM RARO
 * (ações 99% 304, handoffs 99%, backlog 99%, eventos 95%). A tela já tem um
 * canal aberto com o engine (`session:<id>`); ele só não era usado para dizer
 * QUANDO buscar.
 *
 * ## A regra
 *
 * Com o canal da sessão VIVO (join confirmado, socket de pé), as queries da
 * sessão deixam o poll curto e passam a ser INVALIDADAS por aviso do canal
 * (`event.appended`, que desde a RN-579 o engine emite para toda escrita que a
 * api confirmou). O poll não some: vira um FALLBACK longo
 * (`INTERVALO_COM_CANAL_MS`), porque há escrita que NÃO passa pelo engine —
 * a decisão de um humano noutra aba, uma transição que a api faz sozinha — e
 * sem ele a tela ficaria parada para sempre nesses casos. Canal caído (ou
 * nunca conectado, ou sessão que não está `active`) devolve o intervalo
 * curto de sempre: a tela nunca fica pior do que era.
 *
 * O estado é por SESSÃO e por aba (módulo, não React), porque o intervalo é
 * de cada OBSERVADOR, não da query: `SessionPage`, `ContextAside` e o `Shell`
 * observam a MESMA chave de eventos, e um único observador em 3s manteria a
 * query em 3s. Os três lêem daqui e concordam.
 */

/** O fallback enquanto o canal está vivo — o poll que sobra. */
export const INTERVALO_COM_CANAL_MS = 15_000;
/** O orçamento muda com gasto de token, não com decisão; pode esperar mais. */
export const INTERVALO_DO_ORCAMENTO_COM_CANAL_MS = 30_000;

const vivos = new Set<string>();
const ouvintes = new Set<() => void>();

function avisar() {
  for (const ouvinte of ouvintes) ouvinte();
}

/** Chamado SÓ por `connectSessionHeartbeat` (join ok / queda / cleanup). */
export function marcarCanalDaSessao(sessionId: string, vivo: boolean): void {
  const estava = vivos.has(sessionId);
  if (vivo === estava) return;
  if (vivo) vivos.add(sessionId);
  else vivos.delete(sessionId);
  avisar();
}

export function canalDaSessaoVivo(sessionId: string | undefined): boolean {
  return !!sessionId && vivos.has(sessionId);
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function useCanalDaSessaoVivo(sessionId: string | undefined): boolean {
  return useSyncExternalStore(
    assinar,
    () => canalDaSessaoVivo(sessionId),
    () => false,
  );
}

/**
 * O intervalo de um poll da sessão: o de sempre com o canal caído, e nunca
 * MENOS que o fallback com ele vivo. `Math.max` e não substituição: quem já
 * pollava mais devagar que o fallback não passa a pollar mais rápido.
 */
export function intervaloDaSessao(
  baseMs: number,
  vivo: boolean,
  comCanalMs: number = INTERVALO_COM_CANAL_MS,
): number {
  return vivo ? Math.max(baseMs, comCanalMs) : baseMs;
}

/** O que um aviso do canal pode deixar desatualizado. */
export type AlvoDoCanal = 'eventos' | 'acoes' | 'handoffs' | 'backlog' | 'orcamento';

/**
 * Tipo de evento → queries que ele invalida. Os prefixos são os tipos
 * DURÁVEIS que a api grava (`proposed_action.*`/`action.*`, `handoff.*`,
 * `backlog.*`). Todo evento invalida a lista de eventos (é ela que o fio, a
 * árvore do time e o roster derivam) e o orçamento (gasto de token não tem
 * evento próprio; qualquer atividade de agente é o melhor gatilho que há, e
 * a janela do orçamento é longa).
 */
export function alvosDoEvento(type: string): AlvoDoCanal[] {
  const alvos: AlvoDoCanal[] = ['eventos', 'orcamento'];
  if (type.startsWith('proposed_action.') || type.startsWith('action.')) alvos.push('acoes');
  if (type.startsWith('handoff.')) alvos.push('handoffs');
  if (type.startsWith('backlog.')) alvos.push('backlog');
  return alvos;
}

/**
 * Janela mínima entre duas invalidações do MESMO alvo. Sem ela, uma rajada de
 * `tool.call`/`tool.result` de um dev agent viraria uma busca por evento — o
 * pico de 263/min é compatível com isso, e trocar o poll por invalidação sem
 * teto só mudaria a forma do excesso. A primeira invalidação sai NA HORA; as
 * seguintes dentro da janela viram UMA, no fim dela. Então o teto por alvo é
 * `60_000 / janela` buscas por minuto, com o canal mais ativo possível.
 */
export const JANELA_DE_INVALIDACAO_MS: Record<AlvoDoCanal, number> = {
  eventos: 3_000,
  acoes: 2_000,
  handoffs: 2_000,
  backlog: 2_000,
  orcamento: 10_000,
};

export interface InvalidadorDoCanal {
  /** Um aviso do canal. `emStreaming` segura só os EVENTOS (achado C). */
  aoEvento(type: string, emStreaming: boolean): void;
  encerrar(): void;
}

export function criarInvalidadorDoCanal(
  queryClient: QueryClient,
  projectId: string,
  sessionId: string,
  agora: () => number = Date.now,
): InvalidadorDoCanal {
  const chaves: Record<AlvoDoCanal, readonly unknown[]> = {
    eventos: ['session-events', projectId, sessionId],
    acoes: ['session-actions', projectId, sessionId],
    handoffs: ['session-handoffs', projectId, sessionId],
    backlog: ['backlog', projectId],
    orcamento: ['session-budget', projectId, sessionId],
  };
  const ultimo = new Map<AlvoDoCanal, number>();
  const pendentes = new Map<AlvoDoCanal, ReturnType<typeof setTimeout>>();

  function invalidar(alvo: AlvoDoCanal) {
    ultimo.set(alvo, agora());
    void queryClient.invalidateQueries({ queryKey: chaves[alvo] });
  }

  function agendar(alvo: AlvoDoCanal) {
    if (pendentes.has(alvo)) return;
    const espera = (ultimo.get(alvo) ?? -Infinity) + JANELA_DE_INVALIDACAO_MS[alvo] - agora();
    if (espera <= 0) {
      invalidar(alvo);
      return;
    }
    pendentes.set(
      alvo,
      setTimeout(() => {
        pendentes.delete(alvo);
        invalidar(alvo);
      }, espera),
    );
  }

  return {
    aoEvento(type, emStreaming) {
      for (const alvo of alvosDoEvento(type)) {
        // Achado C: durante um turno em streaming, trazer o `agent.response`
        // persistido ANTES do `agent.done` põe a bolha ao vivo e a definitiva
        // na tela juntas. `agent.done` invalida os eventos logo em seguida.
        if (alvo === 'eventos' && emStreaming) continue;
        agendar(alvo);
      }
    },
    encerrar() {
      for (const timer of pendentes.values()) clearTimeout(timer);
      pendentes.clear();
    },
  };
}
