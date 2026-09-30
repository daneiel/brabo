import { useQuery } from '@tanstack/react-query';
import { getProjectPendingActions } from './api-client';
import type { ProposedAction } from './api-types';
import { intervaloDaSessao, useCanalDaSessaoVivo } from './canal-vivo';
import { pollQueParaNoErro } from './query-policy';

/**
 * As pendências do PROJETO que NÃO nasceram nesta sessão — AT-265, RN-626.
 *
 * O chat já decide inline o que foi proposto NAQUELA sessão. O dono conversa
 * numa sessão e os dev agents propõem noutra (a de execução); as aprovações
 * deles nunca apareciam onde ele estava. Esta leitura é a mesma project-wide
 * que a aba PRs e o painel "precisa de você" já fazem (`GET
 * /projects/:id/actions?status=pending`) — nenhum endpoint novo.
 *
 * O canal da sessão só avisa escritas da PRÓPRIA sessão, então ele não diz
 * QUANDO buscar aqui: o intervalo é o de sempre com o canal caído e o fallback
 * de 15 s com ele vivo (`intervaloDaSessao`, RN-579) — uma leitura barata que
 * não devolve o poll de 3 s à tela. A decisão invalida a chave na hora.
 */
export const CHAVE_DAS_PENDENCIAS_DO_PROJETO = (projectId: string) =>
  ['project-pending-actions', projectId] as const;

export function usePendenciasDoProjeto(projectId: string, sessionId: string) {
  const canalVivo = useCanalDaSessaoVivo(sessionId);
  return useQuery({
    // Mesmo prefixo das outras leituras project-wide (`['project-pending-actions',
    // projectId, <tipo>]`): invalidar por prefixo alcança todas.
    queryKey: [...CHAVE_DAS_PENDENCIAS_DO_PROJETO(projectId), undefined],
    queryFn: () => getProjectPendingActions(projectId),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervaloDaSessao(5000, canalVivo)),
  });
}

/** O teto de cards desenhados: a lista é recorte e a tela diz que é. */
export const TETO_DE_PENDENCIAS_NO_CHAT = 20;

export interface PendenciasDeOutrasSessoes {
  /** Aprovações comuns (terminal, commit, ...): a fila `aprovacoes`. */
  aprovacoes: ProposedAction[];
  /** `git_merge` pendente: a fila `prs`. NUNCA somada à de cima. */
  merges: ProposedAction[];
}

function maisAntigaPrimeiro(a: ProposedAction, b: ProposedAction): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

/**
 * Separa as pendências do projeto em duas filas, sem a sessão atual (essas o
 * fio já desenha com o próprio card). As filas ficam separadas — somá-las
 * esconderia qual delas pede atenção (RN-467) — e a ordem é a espera mais
 * longa primeiro.
 */
export function separarPendenciasDeOutrasSessoes(
  acoes: readonly ProposedAction[] | undefined,
  sessionId: string,
): PendenciasDeOutrasSessoes {
  const deOutras = (acoes ?? []).filter(
    (a) => a.status === 'pending' && a.sessionId !== sessionId,
  );
  return {
    aprovacoes: deOutras.filter((a) => a.actionType !== 'git_merge').sort(maisAntigaPrimeiro),
    merges: deOutras.filter((a) => a.actionType === 'git_merge').sort(maisAntigaPrimeiro),
  };
}
