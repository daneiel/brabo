/**
 * A chamada ao Jev e o registro dela (AT-237, segunda rodada). A mesma que
 * `replay.ts` faz na primeira, extraída para as variantes a reusarem; guarda as
 * `probabilities` de cada resposta (a primeira rodada só guardou a escolha).
 * A chave é argumento e NUNCA é impressa, logada nem gravada.
 */
import { ENDPOINT_DO_JEV, lerResposta, type PedidoAoJev } from './jev.ts';
import type { Registro } from './medicao.ts';

export type BaseDoRegistro = Omit<Registro, 'status' | 'escolha' | 'confianca' | 'latenciaMs' | 'custoUsd' | 'tokensDeEntrada'>;

export async function perguntar(
  corpo: PedidoAoJev,
  ferramentas: readonly string[],
  base: BaseDoRegistro,
  chave: string,
  timeoutMs: number,
  chamar: typeof fetch = fetch,
): Promise<Registro> {
  const t0 = performance.now();
  try {
    const r = await chamar(ENDPOINT_DO_JEV, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latenciaMs = Math.round(performance.now() - t0);
    const texto = await r.text();
    const nulo = { escolha: null, confianca: null, custoUsd: null, tokensDeEntrada: null };
    if (!r.ok) return { ...base, ...nulo, status: 'erro_http', latenciaMs, detalhe: `${r.status} ${texto.slice(0, 200)}` };
    const lido = lerResposta(JSON.parse(texto), ferramentas);
    if (lido.status !== 'ok') return { ...base, ...nulo, status: lido.status, latenciaMs, detalhe: lido.detalhe };
    return {
      ...base,
      status: 'ok',
      escolha: lido.escolha,
      confianca: lido.confianca,
      probabilidades: lido.probabilidades,
      latenciaMs,
      custoUsd: lido.custoUsd,
      tokensDeEntrada: lido.tokensDeEntrada,
      geracao: lido.geracao ?? undefined,
      detalhe: lido.modelo ?? undefined,
    };
  } catch (erro) {
    const latenciaMs = Math.round(performance.now() - t0);
    const timeout = (erro as Error).name === 'TimeoutError';
    return {
      ...base,
      status: timeout ? 'timeout' : 'erro_de_rede',
      escolha: null,
      confianca: null,
      latenciaMs,
      custoUsd: null,
      tokensDeEntrada: null,
      detalhe: (erro as Error).name,
    };
  }
}
