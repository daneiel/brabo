import type { SessionEvent } from './api-types';

/** `dev-<modulo>`; o Dev Lead planeja antes da execução e não conta. */
export const ehDevAgent = (a: string) => a.startsWith('dev-') && a !== 'dev-lead';

/**
 * A sessão tem execução ativa? (AT-452, RN-769) — o evento
 * `execution.activated` na janela, ou um `dev-*` entre os ativados da sessão
 * inteira (fonte sem janela, RN-630), para o caso de o evento ter saído da
 * cauda de 200. É ESTADO, não o `kind` (que segue `criativa`, RN-097).
 */
export function sessaoTemExecucao(
  events: readonly Pick<SessionEvent, 'type'>[],
  ativados: readonly string[],
): boolean {
  return (
    events.some((e) => e.type === 'execution.activated') ||
    ativados.some(ehDevAgent)
  );
}
