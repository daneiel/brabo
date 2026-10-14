import { useQuery } from '@tanstack/react-query';
import { listAgentAutonomy } from '../lib/api-client';
import { ehDevAgent } from '../lib/sessao-de-execucao';
import { ModoAutomaticoDoTime, agentesDaOfertaEmLote } from './ModoAutomaticoDoTime';

/**
 * RN-883 (AT-537): a oferta em lote do modo automático (RN-661) também no
 * chat da Sessão, com a execução ativa — sem ela, o primeiro `git_push` e o
 * primeiro `pr_open` pediam clique no chat e a oferta só existia na aba
 * Executores. É o MESMO controle (`ModoAutomaticoDoTime`): mesmo endpoint, um
 * PUT por agente, só com o clique, e a mesma lista do que o modo automático
 * não libera. Some quando todos já estão em automático.
 *
 * Os agentes são os `dev-<modulo>` que entraram na sessão inteira mais os
 * subagentes de gate (`agentesDaOfertaEmLote`). Sem execução, nem a leitura
 * de `agent_autonomy` acontece.
 */
export function agentesDoChat(ativados: readonly string[]): string[] {
  return agentesDaOfertaEmLote(ativados.filter(ehDevAgent));
}

export function ModoAutomaticoNoChat({
  projectId,
  comExecucao,
  ativados,
  podeLigar,
}: {
  projectId: string;
  /** A sessão está ativa E tem execução (`sessaoTemExecucao`). */
  comExecucao: boolean;
  ativados: readonly string[];
  /** `maintainer` no endpoint (RN-102). */
  podeLigar: boolean;
}) {
  const { data: autonomyRules } = useQuery({
    queryKey: ['agent-autonomy', projectId],
    queryFn: () => listAgentAutonomy(projectId),
    enabled: comExecucao,
  });
  if (!comExecucao) return null;
  return (
    <ModoAutomaticoDoTime
      projectId={projectId}
      agentes={agentesDoChat(ativados)}
      autonomyRules={autonomyRules}
      podeLigar={podeLigar}
    />
  );
}
