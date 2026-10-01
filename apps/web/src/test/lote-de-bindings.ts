import type { BindingsResolvidosEmLote, ResolvedBinding } from '../lib/api-types';

type LeituraPorChave = (
  projectId: string,
  chave: string,
) => Promise<ResolvedBinding | null | undefined> | ResolvedBinding | null | undefined;

/**
 * Dublê de `getResolvedModelBindings` (RN-654) montado sobre os dublês POR
 * CHAVE que os testes das seções de modelo já configuram
 * (`getAgentModelBinding`/`getAreaModelBinding`).
 *
 * É a forma de o lote responder, para cada chave, exatamente o que a rota
 * individual responderia — o contrato que a api prova do lado dela
 * (`model-bindings-em-lote.integration.spec.ts`). Assim cada teste continua
 * descrevendo o cenário por agente e por área, e uma leitura que falhe numa
 * chave derruba o lote inteiro, como no servidor.
 */
export function loteSobreLeiturasPorChave(
  doAgente: LeituraPorChave,
  daArea: LeituraPorChave,
) {
  return async (
    projectId: string,
    agents: readonly string[],
    areas: readonly string[],
  ): Promise<BindingsResolvidosEmLote> => ({
    agents: await Promise.all(
      agents.map(async (key) => ({ key, binding: (await doAgente(projectId, key)) ?? null })),
    ),
    areas: await Promise.all(
      areas.map(async (key) => ({ key, binding: (await daArea(projectId, key)) ?? null })),
    ),
  });
}
