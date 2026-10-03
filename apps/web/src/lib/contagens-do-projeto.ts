import { useSyncExternalStore } from 'react';
import {
  useArchitecture,
  useBacklog,
  useHypotheses,
  useProjectPendingActions,
} from './hooks';
import { INTERVALO_DO_PROJETO_MS } from './canal-vivo';
import type { ContagensDeAba } from '../routes/project-tabs';

/**
 * As CINCO filas de decisão do projeto, lidas por quem as mostra (ADR 0211):
 * a moldura do projeto (o painel "precisa de você", RN-467) e a lista de abas
 * do projeto na sidebar (os contadores por aba). As duas chamam este hook com
 * o MESMO `projectId`, e as `queryKey`s são as de sempre — o React Query
 * deduplica, e nenhuma requisição nem poll nasce aqui (os orçamentos
 * `*.orcamento.test.tsx` guardam isso).
 *
 * Os cinco números seguem SEPARADOS, um por aba — nunca somados (RN-467):
 * somar apaga qual fila está pedindo atenção.
 */
export function useContagensDoProjeto(projectId: string | undefined) {
  // Ritmo de projeto (AT-278, RN-632): nenhum canal desta moldura avisa
  // quando estas filas mudam. As aprovações são as do PROJETO, em qualquer
  // sessão (AT-297, RN-638).
  const pendingActionsQuery = useProjectPendingActions(projectId, undefined, INTERVALO_DO_PROJETO_MS);
  const backlogQuery = useBacklog(projectId, INTERVALO_DO_PROJETO_MS);
  const hypothesesQuery = useHypotheses(projectId, INTERVALO_DO_PROJETO_MS);
  const architectureQuery = useArchitecture(projectId, INTERVALO_DO_PROJETO_MS);

  const pendentesDoProjeto = pendingActionsQuery.data?.filter((a) => a.status === 'pending');
  // Os `git_merge` saem da MESMA leitura de pendentes do projeto (AT-297).
  const merges = pendentesDoProjeto?.filter((a) => a.actionType === 'git_merge');
  // `proposedReady` é o predicado de `aguardandoPromocao` (RN-048), repetido
  // aqui para a sidebar não puxar o chunk da aba Backlog para o bundle inicial.
  const promocoesPendentes = (backlogQuery.data ?? []).flatMap((e) =>
    e.stories.filter((s) => s.proposedReady),
  ).length;

  const contagens: ContagensDeAba = {
    promocoesPendentes,
    aprovacoesPendentes: pendentesDoProjeto?.length ?? 0,
    hipotesesPendentes: (hypothesesQuery.data ?? []).filter((h) => h.status === 'proposed').length,
    prsPendentes: merges?.length ?? 0,
    // `architecture.pendencies`: a validação cruzada história × módulo, a
    // única fila de decisão do usuário na Arquitetura (Onda 3).
    arquiteturaPendente: architectureQuery.data?.pendencies.length ?? 0,
  };

  return {
    contagens,
    pendentesDoProjeto,
    merges,
    epicos: backlogQuery.data,
    pendenciasDeArquitetura: architectureQuery.data?.pendencies,
    hipoteses: hypothesesQuery.data,
  };
}

/**
 * A aba que a moldura do projeto está MOSTRANDO, publicada para a sidebar
 * marcar a ativa (ADR 0211). A URL (`?tab=`) não basta: o painel "precisa de
 * você" troca de aba sem passar pelo router. Estado de módulo, e não
 * contexto, porque a sidebar mora ACIMA do `Outlet` onde a moldura monta.
 */
export type AbaPublicada = { projectId: string; tab: string } | null;
let abaPublicada: AbaPublicada = null;
const ouvintes = new Set<() => void>();

export function publicarAbaAtiva(valor: AbaPublicada) {
  if (abaPublicada?.projectId === valor?.projectId && abaPublicada?.tab === valor?.tab) return;
  abaPublicada = valor;
  for (const ouvinte of ouvintes) ouvinte();
}

/**
 * O caminho inverso, como EVENTO e não como estado: a sidebar PEDE a aba
 * clicada à moldura antes de navegar. Sem isso, clicar na aba que a URL já
 * tem (depois de um salto pelo painel "precisa de você", que não passa pelo
 * router) não trocaria nada. Evento, para que duas molduras do mesmo projeto
 * nunca se puxem uma à outra pelo estado publicado.
 */
type PedidoDeAba = { projectId: string; tab: string };
const pedidos = new Set<(pedido: PedidoDeAba) => void>();

export function pedirAba(pedido: PedidoDeAba) {
  for (const ouvinte of pedidos) ouvinte(pedido);
}

export function ouvirPedidosDeAba(ouvinte: (pedido: PedidoDeAba) => void): () => void {
  pedidos.add(ouvinte);
  return () => {
    pedidos.delete(ouvinte);
  };
}

export function useAbaPublicada(): AbaPublicada {
  return useSyncExternalStore(
    (ouvinte) => {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
    () => abaPublicada,
    () => abaPublicada,
  );
}
