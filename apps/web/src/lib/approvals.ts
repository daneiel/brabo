import type { ProposedAction } from './api-types';

/**
 * Resumo de aprovações de uma sessão.
 *
 * As três contagens vêm de colunas que NÃO são reescritas pela execução, e é
 * isso que as torna comparáveis entre sessões:
 *
 * - `pendentes` — `status = 'pending'`, o que ainda espera decisão sua;
 * - `decididasPorVoce` — tem `decidedBy`, ou seja, alguém clicou. É a contagem
 *   que o primeiro dogfooding queria e não teve (achado #17);
 * - `autoAprovadas` — `resolvedPolicy = 'auto_approve'`, a política decidindo
 *   sozinha. Nunca foi clique de ninguém.
 *
 * `status` sozinho não serve para as duas últimas: uma ação auto-aprovada que
 * executou fica `executed`, e contá-la por status a perderia. `resolvedPolicy`
 * e `decidedBy` são fixados na criação e na decisão, e não mudam depois.
 */
export interface ResumoDeAprovacoes {
  total: number;
  pendentes: number;
  decididasPorVoce: number;
  autoAprovadas: number;
}

export const RESUMO_VAZIO: ResumoDeAprovacoes = {
  total: 0,
  pendentes: 0,
  decididasPorVoce: 0,
  autoAprovadas: 0,
};

export function resumirAcoes(
  actions: readonly ProposedAction[] | undefined,
): ResumoDeAprovacoes {
  const items = actions ?? [];
  return {
    total: items.length,
    pendentes: items.filter((a) => a.status === 'pending').length,
    decididasPorVoce: items.filter((a) => a.decidedBy !== null).length,
    autoAprovadas: items.filter((a) => a.resolvedPolicy === 'auto_approve')
      .length,
  };
}

/** Soma dos resumos de várias sessões — o total do projeto. */
export function somarResumos(
  resumos: readonly ResumoDeAprovacoes[],
): ResumoDeAprovacoes {
  return resumos.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      pendentes: acc.pendentes + r.pendentes,
      decididasPorVoce: acc.decididasPorVoce + r.decididasPorVoce,
      autoAprovadas: acc.autoAprovadas + r.autoAprovadas,
    }),
    RESUMO_VAZIO,
  );
}
