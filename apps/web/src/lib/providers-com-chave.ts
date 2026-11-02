import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listCredentialedProviders } from './api-client';
import type { LLMProviderName } from './api-types';
import { FRESCOR_DA_CONFIGURACAO_MS } from './query-policy';

/**
 * Providers com chave do TITULAR do workspace (AT-607). `undefined` enquanto
 * carrega ou se a leitura falhar: "não sei" não é "não tem", e quem consome
 * trata como "todos" (`providerAtivo`). Configuração: sem poll (RN-645).
 */
export function useProvidersComChave(workspaceId: string | undefined) {
  const { data } = useQuery({
    queryKey: ['credentialed-providers', workspaceId],
    queryFn: () => listCredentialedProviders(workspaceId!),
    enabled: !!workspaceId,
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  return useMemo(() => (data ? new Set<LLMProviderName>(data.providers) : undefined), [data]);
}
