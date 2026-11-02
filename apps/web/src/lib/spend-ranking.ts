import { numberFmt } from './currency';
import { ROTULO_DO_PROVIDER } from './models';
import type { LLMProviderName } from './api-types';
import { tokensDe, type SpendLinha } from './spend';
import type { LinhaDeRanking } from '../components/SpendCharts';
import { formatarUsd } from '../components/CredentialSpendSection';

type T = (chave: string, opcoes?: Record<string, unknown>) => string;

/** As janelas que a tela oferece; a api aceita qualquer uma delas (RN-952). */
export const JANELAS = [30, 90, 180] as const;

/** O rótulo humano do provider — a MESMA tabela de `CredentialSpendSection`. */
export function rotuloDoProvider(linha: SpendLinha): string {
  return ROTULO_DO_PROVIDER[linha.chave as LLMProviderName] ?? linha.chave;
}

/**
 * Linha de ranking. Assinatura com preço 0 aparece "assinatura — sem preço
 * registrado", nunca "US$ 0" (RN-954); a parte de assinatura de uma linha
 * paga vai no detalhe.
 */
export function comoRanking(
  linhas: SpendLinha[],
  rotulo: (linha: SpendLinha) => string,
  t: T,
  assinaturas?: Set<string>,
): LinhaDeRanking[] {
  return linhas.map((linha) => {
    const assin = linha.assinaturaMicros ?? 0;
    const detalhe = t('shared.rankingDetail', {
      tokens: numberFmt.format(tokensDe(linha)),
      calls: linha.chamadas,
    });
    return {
      chave: linha.chave,
      rotulo: rotulo(linha),
      costMicros: linha.costMicros,
      detalhe:
        assin > 0
          ? `${detalhe} · ${t('subscription.inRow', { valor: formatarUsd(assin) })}`
          : detalhe,
      valor:
        linha.costMicros === 0 && assinaturas?.has(linha.chave)
          ? t('subscription.noPrice')
          : undefined,
    };
  });
}

