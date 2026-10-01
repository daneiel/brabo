/**
 * As duas chamadas pagas do teste ao vivo da AT-239, ao OpenRouter, com a
 * chave como argumento (NUNCA impressa, logada nem gravada):
 *
 * - `chamarChat`: `POST /api/v1/chat/completions`, com as mensagens no fio
 *   como a api as põe (`toWireMessage`/`toWireTool` de
 *   `apps/api/src/infrastructure/llm/openai-compatible-provider.ts`, portadas —
 *   o arquivo tem decorador do Nest e o Node não o executa daqui). O custo é o
 *   `usage.cost` da resposta, o número que a RN-665 (ADR 0188) pôs no metering.
 * - `chamarJev`: o adaptador `JevToolRouter`
 *   (`apps/api/src/infrastructure/llm/jev-tool-router.ts`), portado pelo mesmo
 *   motivo, com o MESMO teto (`TOOL_ROUTER_TIMEOUT_MS`, padrão 2 000 ms) e a
 *   MESMA leitura da resposta (`lerRespostaDoJev`, importada do produto).
 *
 * `fetch` é injetável: o `rede.spec.ts` prova o fio e a leitura sem rede.
 */
import type { ChamadaDeFerramenta, Definicao, MensagemDoLaco, RespostaDoChat, ResultadoDoJev } from './laco.ts';
import { ENDPOINT_DO_JEV, lerRespostaDoJev, type PedidoAoJev } from './roteador.ts';

export const URL_DO_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
export const TETO_DO_JEV_MS = 2000;
export const TETO_DO_CHAT_MS = 180_000;

export interface MensagemNoFio {
  role: string;
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}

/** Porta de `toWireMessage` (openai-compatible-provider.ts). */
export function paraOFio(m: MensagemDoLaco): MensagemNoFio {
  if (m.role === 'tool') {
    return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '', ...(m.name ? { name: m.name } : {}) };
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.arguments) } })),
    };
  }
  return { role: m.role, content: m.content };
}

/** Porta de `toWireTool`. */
export const ferramentaNoFio = (t: Definicao) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } });

interface CorpoDoChat {
  error?: { message?: string };
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/** Argumentos que não são JSON de objeto viram `{}` — o que o parser de stream da api faz com fragmento ruim. */
function argumentos(texto: string | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(texto || '{}');
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function lerRespostaDoChat(corpo: unknown, latenciaMs: number): RespostaDoChat {
  const c = (typeof corpo === 'object' && corpo !== null ? corpo : {}) as CorpoDoChat;
  const u = c.usage ?? {};
  const msg = c.choices?.[0]?.message ?? {};
  const toolCalls: ChamadaDeFerramenta[] = (msg.tool_calls ?? []).map((t, i) => ({
    id: t.id ?? `chamada_${i}`,
    name: t.function?.name ?? '',
    arguments: argumentos(t.function?.arguments),
  }));
  return {
    content: msg.content ?? '',
    toolCalls,
    custoUsd: typeof u.cost === 'number' ? u.cost : null,
    promptTokens: u.prompt_tokens ?? null,
    completionTokens: u.completion_tokens ?? null,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? null,
    latenciaMs,
    erro: c.error ? (c.error.message ?? 'erro do provider') : c.choices?.length ? null : 'resposta sem choices',
  };
}

export async function chamarChat(
  chave: string,
  modelo: string,
  mensagens: readonly MensagemDoLaco[],
  ferramentas: readonly Definicao[],
  chamar: typeof fetch = fetch,
): Promise<RespostaDoChat> {
  const t0 = performance.now();
  const latencia = () => Math.round(performance.now() - t0);
  try {
    const r = await chamar(URL_DO_CHAT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelo,
        messages: mensagens.map(paraOFio),
        ...(ferramentas.length > 0 ? { tools: ferramentas.map(ferramentaNoFio) } : {}),
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(TETO_DO_CHAT_MS),
    });
    const texto = await r.text();
    let corpo: unknown;
    try {
      corpo = JSON.parse(texto);
    } catch {
      return { ...lerRespostaDoChat({}, latencia()), erro: `HTTP ${r.status}: corpo não é JSON` };
    }
    const lida = lerRespostaDoChat(corpo, latencia());
    return r.ok ? lida : { ...lida, erro: `HTTP ${r.status}: ${lida.erro ?? 'sem mensagem'}` };
  } catch (e) {
    // Só o NOME do erro: a mensagem de um erro de rede pode carregar a URL.
    return { ...lerRespostaDoChat({}, latencia()), erro: `transporte: ${(e as Error).name}`, transporte: true };
  }
}

/** Porta de `JevToolRouter.decidir/1`. */
export async function chamarJev(
  chave: string,
  pedido: PedidoAoJev,
  opcoes: readonly string[],
  chamar: typeof fetch = fetch,
  timeoutMs = TETO_DO_JEV_MS,
): Promise<ResultadoDoJev> {
  const t0 = performance.now();
  const latenciaMs = () => Math.round(performance.now() - t0);
  try {
    const r = await chamar(ENDPOINT_DO_JEV, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pedido),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const texto = await r.text();
    if (!r.ok) return { status: 'queda', motivo: 'erro_http', detalhe: `${r.status} ${texto.slice(0, 200)}`, custoUsd: null, latenciaMs: latenciaMs() };
    let corpo: unknown;
    try {
      corpo = JSON.parse(texto);
    } catch {
      return { status: 'queda', motivo: 'resposta_invalida', detalhe: texto.slice(0, 200), custoUsd: null, latenciaMs: latenciaMs() };
    }
    const lida = lerRespostaDoJev(corpo, opcoes);
    if (lida.status !== 'ok') return { status: 'queda', motivo: lida.status, detalhe: lida.detalhe, custoUsd: lida.custoUsd, latenciaMs: latenciaMs() };
    return {
      status: 'decidido',
      escolha: lida.escolha,
      confianca: lida.confianca,
      probabilidades: lida.probabilidades,
      custoUsd: lida.custoUsd,
      latenciaMs: latenciaMs(),
    };
  } catch (e) {
    const nome = (e as Error).name;
    return {
      status: 'queda',
      motivo: nome === 'TimeoutError' || nome === 'AbortError' ? 'timeout' : 'erro_de_rede',
      detalhe: nome,
      custoUsd: null,
      latenciaMs: latenciaMs(),
    };
  }
}
