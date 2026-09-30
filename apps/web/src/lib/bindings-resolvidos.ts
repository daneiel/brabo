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
 * ## A Visão geral e a aba Executores leem o MESMO lote (AT-339)
 *
 * As duas abas liam uma rota por agente do roster, pelo prefixo
 * `['agent-binding', projectId]`. Agora leem por `useBindingsDosAgentes`: os
 * agentes do CATÁLOGO vêm desta mesma `queryKey` — o cache que a aba
 * Configurações já aqueceu serve as duas sem requisição —, e os que o
 * catálogo não conhece (os `dev-<modulo>` do `module_map`) vêm de UMA leitura
 * em lote a mais, sob o mesmo prefixo.
 *
 * ## A invalidação é uma só
 *
 * Toda escrita de binding de agente ou de área passa por
 * `invalidarBindingsResolvidos`: o lote inteiro é relido, porque mudar a área
 * muda o vigente de todo agente que a herda, e mudar um agente pode mudar a
 * coluna de quem herda do Criativo (`herdarModeloDeStart`). A invalidação é
 * pelo PREFIXO `[QUERY_KEY_BINDINGS_RESOLVIDOS, projectId]`, que alcança
 * também a leitura dos `dev-<modulo>` — não há outra chave de binding
 * resolvido para lembrar de invalidar.
 */
export const QUERY_KEY_BINDINGS_RESOLVIDOS = 'model-bindings-resolved';

export function bindingsResolvidosQueryKey(projectId: string) {
  return [QUERY_KEY_BINDINGS_RESOLVIDOS, projectId] as const;
}

export function invalidarBindingsResolvidos(
  queryClient: QueryClient,
  projectId: string,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: bindingsResolvidosQueryKey(projectId) });
}

const CHAVES_DE_AGENTE = AGENT_LIST.map((a) => a.key);
const AGENTES_DO_CATALOGO: ReadonlySet<string> = new Set<string>(CHAVES_DE_AGENTE);

/**
 * O teto de chaves de uma leitura em lote — o MESMO da api
 * (`TETO_DE_CHAVES_NO_LOTE`, `resolve-model-bindings-em-lote.use-case.ts`).
 * Acima dele a api recusa com 400; por isso os `dev-<modulo>` vão em fatias
 * deste tamanho, nunca numa lista que a api recusaria inteira.
 */
export const TETO_DE_CHAVES_NO_LOTE = 64;
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

/**
 * O binding resolvido de cada agente de um ROSTER (a Visão geral e a aba
 * Executores), sem uma requisição por agente (AT-339, RN-654).
 *
 * Os agentes do catálogo saem do lote de `useBindingsResolvidos` — a mesma
 * `queryKey` da aba Configurações. Os demais (`dev-<modulo>`) saem de UMA
 * leitura em lote própria, sob o mesmo prefixo, e só existem quando o roster
 * os tem. `undefined` segue sendo "não sei" (carregando ou a leitura falhou),
 * nunca "não tem modelo": o cartão do agente, nos dois casos, não afirma
 * modelo nenhum.
 */
export function useBindingsDosAgentes(projectId: string, agentIds: readonly string[]) {
  const catalogo = useBindingsResolvidos(projectId);
  const chaveDosExtras = [...new Set(agentIds.filter((id) => !AGENTES_DO_CATALOGO.has(id)))]
    .sort()
    .join(',');
  const extras = useQuery({
    queryKey: [...bindingsResolvidosQueryKey(projectId), 'extras', chaveDosExtras] as const,
    queryFn: async () => {
      const chaves = chaveDosExtras.split(',');
      const fatias: string[][] = [];
      for (let i = 0; i < chaves.length; i += TETO_DE_CHAVES_NO_LOTE) {
        fatias.push(chaves.slice(i, i + TETO_DE_CHAVES_NO_LOTE));
      }
      const respostas = await Promise.all(
        fatias.map((fatia) => getResolvedModelBindings(projectId, fatia, [])),
      );
      return new Map<string, ResolvedBinding | null>(
        respostas.flatMap((r) => r.agents.map((e) => [e.key, e.binding] as const)),
      );
    },
    enabled: chaveDosExtras.length > 0,
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });

  return (agentId: string): ResolvedBinding | null | undefined => {
    if (AGENTES_DO_CATALOGO.has(agentId)) return catalogo.doAgente(agentId);
    return extras.data ? (extras.data.get(agentId) ?? null) : undefined;
  };
}
