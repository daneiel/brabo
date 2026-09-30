import { useMemo } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { getResolvedModelBindings } from './api-client';
import { AGENT_LIST, AREAS } from './agents';
import type { ResolvedBinding } from './api-types';
import { FRESCOR_DA_CONFIGURACAO_MS } from './query-policy';

/**
 * Os bindings RESOLVIDOS de todos os agentes e áreas de um projeto, numa
 * leitura só (RN-654, AT-334).
 *
 * As três seções de Configurações que precisam deles — modelos por agente,
 * modelos por área e melhores modelos por capacidade — liam uma rota POR
 * chave: 17 agentes e 3 áreas, 20 requisições a cada carga da aba (RN-645).
 * Agora leem esta UMA `queryKey`, e o React Query serve as três com uma
 * requisição.
 *
 * ## A invalidação é uma só, e alcança também as outras abas
 *
 * Toda escrita de binding de agente ou de área passa por
 * `invalidarBindingsResolvidos`: o lote inteiro é relido, porque mudar a área
 * muda o vigente de todo agente que a herda, e mudar um agente pode mudar a
 * coluna de quem herda do Criativo (`herdarModeloDeStart`). A mesma função
 * invalida o PREFIXO `['agent-binding', projectId]`, que a Visão geral e a aba
 * Executores seguem lendo por agente (poucos, e só os do roster) — sem isso,
 * trocar o modelo aqui deixaria as outras abas mostrando o anterior até o
 * frescor vencer.
 */
export const QUERY_KEY_BINDINGS_RESOLVIDOS = 'model-bindings-resolved';

export function bindingsResolvidosQueryKey(projectId: string) {
  return [QUERY_KEY_BINDINGS_RESOLVIDOS, projectId] as const;
}

export function invalidarBindingsResolvidos(
  queryClient: QueryClient,
  projectId: string,
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: bindingsResolvidosQueryKey(projectId) }),
    queryClient.invalidateQueries({ queryKey: ['agent-binding', projectId] }),
  ]).then(() => undefined);
}

const CHAVES_DE_AGENTE = AGENT_LIST.map((a) => a.key);
const CHAVES_DE_AREA = Object.keys(AREAS);

/**
 * Três estados, e eles não colapsam (RN-470): `carregando` (ainda não há
 * resposta), `erro` (a leitura falhou — nada se sabe sobre nenhuma chave) e a
 * resposta, em que `null` é uma afirmação da api ("sem modelo em nível
 * nenhum"). Por isso `doAgente`/`daArea` devolvem `undefined` enquanto não há
 * resposta: `undefined` é "não sei", nunca "não tem".
 */
export function useBindingsResolvidos(projectId: string) {
  const query = useQuery({
    queryKey: bindingsResolvidosQueryKey(projectId),
    queryFn: () => getResolvedModelBindings(projectId, CHAVES_DE_AGENTE, CHAVES_DE_AREA),
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });

  const { porAgente, porArea } = useMemo(
    () => ({
      porAgente: new Map<string, ResolvedBinding | null>(
        (query.data?.agents ?? []).map((e) => [e.key, e.binding]),
      ),
      porArea: new Map<string, ResolvedBinding | null>(
        (query.data?.areas ?? []).map((e) => [e.key, e.binding]),
      ),
    }),
    [query.data],
  );

  return {
    carregando: query.isPending,
    temResposta: query.data !== undefined,
    erro: query.isError ? query.error : null,
    tentarDeNovo: () => void query.refetch(),
    doAgente: (agentKey: string): ResolvedBinding | null | undefined =>
      query.data ? (porAgente.get(agentKey) ?? null) : undefined,
    daArea: (areaKey: string): ResolvedBinding | null | undefined =>
      query.data ? (porArea.get(areaKey) ?? null) : undefined,
  };
}
