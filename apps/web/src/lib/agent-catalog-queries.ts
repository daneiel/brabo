import { useQuery } from '@tanstack/react-query';
import { getAgentCatalog } from './api-client';
import { FRESCOR_DA_CONFIGURACAO_MS } from './query-policy';

// Uma queryKey por projeto, lida por todos os cards (RN-645): dado de
// configuração, sem poll. `habilitada` só liga quando alguém abre uma seção.
export const useCatalogoDeAgentes = (projectId: string | undefined, habilitada: boolean) =>
  useQuery({
    queryKey: ['agent-catalog', projectId],
    queryFn: () => getAgentCatalog(projectId as string),
    enabled: !!projectId && habilitada,
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
