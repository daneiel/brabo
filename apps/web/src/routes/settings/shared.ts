import type { ModelBindingScope } from '../../lib/api-types';
import { microsParaUsd, usdFmt } from '../../lib/currency';
import type { BadgeTone } from '../../components/ui/Badge';

export const ORIGIN_TONE: Record<ModelBindingScope, BadgeTone> = {
  workspace: 'muted',
  project: 'warning',
  area: 'accent',
  agent: 'success',
  session: 'success',
};

/**
 * Custo em USD. O mockup mostra `R$ 640,10 · US$ 116`, mas converter exigiria
 * uma taxa de câmbio — e "preferência de moeda com taxa manual" é backlog
 * declarado no CLAUDE.md. Um número em reais tirado de taxa inventada seria
 * pior que um número honesto em dólar.
 *
 * Abaixo de um centavo NÃO vira `US$ 0,00`. Preço de token é da ordem de 10⁻⁶,
 * e na primeira versão desta tela um agente que gastou 1811 micro-USD aparecia
 * com o mesmo `US$ 0,00` de um agente que não gastou nada — a coluna afirmava
 * ausência de consumo onde havia consumo. `< US$ 0,01` diz a verdade sem
 * encher a coluna de casas decimais que ninguém compara.
 */
export function formatarCustoMicros(micros: number): string {
  if (micros === 0) return usdFmt.format(0);
  const usd = microsParaUsd(micros);
  if (usd < 0.01) return `< ${usdFmt.format(0.01)}`;
  return usdFmt.format(usd);
}
