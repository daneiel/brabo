import type { QueryClient } from '@tanstack/react-query';

/**
 * As `queryKey`s das listagens de chave de dispositivo, e a ÚNICA forma de
 * invalidá-las depois de uma revogação (RN-611).
 *
 * ## Por que num lugar só
 *
 * Existem DUAS listagens da mesma tabela: a por PROJETO
 * (`['runner-device-keys', projectId]`, lida pelo `RunnerOnboardingPanel` e
 * pela seção `device-keys` das Configurações — RN-548/RN-561) e a por CONTA
 * (`['machine-device-keys']`, lida pela seção da Conta). Uma chave de MÁQUINA
 * aparece nas DUAS — e na por projeto, em TODO projeto do dono. Revogar por
 * uma e invalidar só a própria deixaria a outra anunciando viva a chave
 * recém-revogada: o painel diria "máquina pareada", e a Conta mostraria
 * "ativa" com o botão de revogar de novo.
 *
 * Por isso a invalidação é por PREFIXO na por projeto (`['runner-device-keys']`
 * casa a de TODO projeto no cache, não só a do projeto aberto) e alcança a da
 * Conta sempre. É invalidar a mais — uma leitura extra em cada lista montada —
 * em troca de nunca ter de decidir, em cada chamador, quais listas a espécie
 * revogada alcança.
 */
export const QUERY_KEY_CHAVES_DO_PROJETO = 'runner-device-keys';
export const QUERY_KEY_CHAVES_DE_MAQUINA = ['machine-device-keys'] as const;

export function chavesDoProjetoQueryKey(projectId: string | null | undefined) {
  return [QUERY_KEY_CHAVES_DO_PROJETO, projectId] as const;
}

export function invalidarChavesDeDispositivo(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: [QUERY_KEY_CHAVES_DO_PROJETO] }),
    queryClient.invalidateQueries({ queryKey: QUERY_KEY_CHAVES_DE_MAQUINA }),
  ]).then(() => undefined);
}
