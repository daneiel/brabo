/**
 * O pedido ao Jev e a leitura da resposta (AT-237), no formato MEDIDO contra a
 * Decisions API em 2026-09-29 — não o da nota do épico, que errava num ponto:
 * `questions` é um OBJETO chaveado pelo id da pergunta, não uma lista (a api
 * respondeu 400 `expected record, received array` à forma da AT-235).
 *
 *   POST https://openrouter.ai/api/alpha/decisions
 *   { model, state, questions: { <id>: { type: "choice", instructions, criteria } } }
 *   → { model, answers: { <id>: { type, choice, probabilities, confidence } },
 *       usage: { input_tokens, output_tokens, cost }, id, provider }
 *
 * Nada aqui toca a rede: `montarPedido` e `lerResposta` são puras; a chamada
 * mora em `replay.ts`.
 */
import { RESPONDER_SEM_FERRAMENTA, type Catalogo, type EstadoDoJev } from './passos.ts';

export const ENDPOINT_DO_JEV = 'https://openrouter.ai/api/alpha/decisions';
export const MODELO_DO_JEV = 'typesafe/jev-1.13';
export const PERGUNTA = 'ferramenta_do_passo';
export const INSTRUCAO =
  'Qual ferramenta o agente deve chamar neste passo, dado o pedido, o contexto e os passos recentes? ' +
  `Escolha "${RESPONDER_SEM_FERRAMENTA}" se o agente deve responder em texto ou encerrar o turno.`;
export const DESCRICAO_SEM_FERRAMENTA =
  'Nenhuma ferramenta: responder ao usuário em texto ou encerrar o turno.';

export interface PedidoAoJev {
  model: string;
  state: EstadoDoJev;
  questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }>;
}

/** `criteria` = `{ nome: descrição }` do catálogo do agente + a opção reservada. */
export function montarPedido(estado: EstadoDoJev, ferramentas: readonly string[], catalogo: Catalogo): PedidoAoJev {
  if (ferramentas.includes(RESPONDER_SEM_FERRAMENTA)) {
    throw new Error(`colisao_de_nome: o catálogo tem ferramenta chamada ${RESPONDER_SEM_FERRAMENTA}`);
  }
  const criteria: Record<string, string> = {};
  for (const f of ferramentas) criteria[f] = catalogo.ferramentas[f] ?? f;
  criteria[RESPONDER_SEM_FERRAMENTA] = DESCRICAO_SEM_FERRAMENTA;
  return {
    model: MODELO_DO_JEV,
    state: estado,
    questions: { [PERGUNTA]: { type: 'choice', instructions: INSTRUCAO, criteria } },
  };
}

export type Resposta =
  | {
      status: 'ok';
      escolha: string;
      confianca: number;
      probabilidades: Record<string, number>;
      custoUsd: number | null;
      tokensDeEntrada: number | null;
      modelo: string | null;
      geracao: string | null;
    }
  | { status: 'resposta_invalida' | 'escolha_fora_das_opcoes'; detalhe: string };

/** Lê a resposta; qualquer desvio de forma vira queda nomeada (AT-235), nunca exceção. */
export function lerResposta(corpo: unknown, opcoes: readonly string[]): Resposta {
  const c = corpo as {
    model?: unknown;
    id?: unknown;
    answers?: Record<string, { choice?: unknown; confidence?: unknown; probabilities?: unknown }>;
    usage?: { cost?: unknown; input_tokens?: unknown };
  } | null;
  const a = c?.answers?.[PERGUNTA];
  if (!a || typeof a.choice !== 'string' || typeof a.confidence !== 'number') {
    return { status: 'resposta_invalida', detalhe: JSON.stringify(corpo)?.slice(0, 300) ?? 'vazio' };
  }
  if (![...opcoes, RESPONDER_SEM_FERRAMENTA].includes(a.choice)) {
    return { status: 'escolha_fora_das_opcoes', detalhe: a.choice };
  }
  const probabilidades: Record<string, number> = {};
  if (a.probabilities && typeof a.probabilities === 'object') {
    for (const [k, v] of Object.entries(a.probabilities as Record<string, unknown>)) {
      if (typeof v === 'number') probabilidades[k] = v;
    }
  }
  return {
    status: 'ok',
    escolha: a.choice,
    confianca: a.confidence,
    probabilidades,
    custoUsd: typeof c?.usage?.cost === 'number' ? c.usage.cost : null,
    tokensDeEntrada: typeof c?.usage?.input_tokens === 'number' ? c.usage.input_tokens : null,
    modelo: typeof c?.model === 'string' ? c.model : null,
    geracao: typeof c?.id === 'string' ? c.id : null,
  };
}
