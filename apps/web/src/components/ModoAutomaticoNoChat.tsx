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

/**
 * RN-889 (AT-540): estende a RN-883. Aprovar o plano do Dev Lead cria a sessão
 * de EXECUÇÃO, separada da do Criativo — e é no chat do Criativo que o usuário
 * conduz. Com a execução ativa no PROJETO (o roster do resumo, a sessão mais
 * recente), a oferta aparece em qualquer sessão ativa dele, com os dev agents
 * de lá somados aos desta.
 */
export function ofertaDoChat(
  comExecucao: boolean,
  ativados: readonly string[],
  execucaoNoProjeto?: { ativa: boolean; ativados: readonly string[] },
): { mostra: boolean; ativados: string[] } {
  const doProjeto = execucaoNoProjeto?.ativa === true;
  return {
    mostra: comExecucao || doProjeto,
    ativados: [...new Set([...ativados, ...(doProjeto ? execucaoNoProjeto.ativados : [])])],
  };
}

export function ModoAutomaticoNoChat({
  projectId,
  comExecucao,
  ativados,
  podeLigar,
  execucaoNoProjeto,
  sessaoAtiva = true,
}: {
  projectId: string;
  /** A sessão está ativa E tem execução (`sessaoTemExecucao`). */
  comExecucao: boolean;
  ativados: readonly string[];
  /** `maintainer` no endpoint (RN-102). */
  podeLigar: boolean;
  /** RN-889: a execução do projeto, de outra sessão (o resumo). */
  execucaoNoProjeto?: { ativa: boolean; ativados: readonly string[] };
  /** A sessão lida está ativa (a oferta nunca aparece em sessão encerrada). */
  sessaoAtiva?: boolean;
}) {
  const oferta = ofertaDoChat(comExecucao, ativados, execucaoNoProjeto);
  const mostra = sessaoAtiva && oferta.mostra;
  const { data: autonomyRules } = useQuery({
    queryKey: ['agent-autonomy', projectId],
    queryFn: () => listAgentAutonomy(projectId),
    enabled: mostra,
  });
  if (!mostra) return null;
  return (
    <ModoAutomaticoDoTime
      projectId={projectId}
      agentes={agentesDoChat(oferta.ativados)}
      autonomyRules={autonomyRules}
      podeLigar={podeLigar}
    />
  );
}
