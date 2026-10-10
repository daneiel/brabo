import { useQuery } from '@tanstack/react-query';
import { listAgentAutonomy } from '../lib/api-client';
import { devAgentId } from '../lib/agent-status';
import { ModoAutomaticoDoTime, agentesDaOfertaEmLote } from './ModoAutomaticoDoTime';

/**
 * AT-476 (RN-804): a oferta em lote do modo automático (RN-661) também no
 * cartão do plano do Dev Lead, ANTES de aprovar — aprovar ativa a execução
 * (RN-677) e o dev pede o primeiro comando logo em seguida; ligar depois não
 * aprova o que já está pendente (RN-755). É o MESMO controle dos Executores:
 * mesmo endpoint, um PUT por agente, só com o clique, e a mesma lista do que o
 * modo automático não libera.
 *
 * Os agentes são os `dev-<modulo>` que o plano sobe (mesma derivação da api),
 * mais os subagentes de gate (`agentesDaOfertaEmLote`).
 */
export function agentesDoPlano(payload: Record<string, unknown>): string[] {
  const modulos = Array.isArray(payload.modulos) ? payload.modulos : [];
  const ids = modulos
    .map((m: unknown) =>
      m && typeof m === 'object' && typeof (m as { modulo?: unknown }).modulo === 'string'
        ? devAgentId((m as { modulo: string }).modulo)
        : null,
    )
    .filter((id): id is string => id !== null && id !== 'dev-');
  return agentesDaOfertaEmLote(ids);
}

export function ModoAutomaticoDoPlano({
  projectId,
  payload,
}: {
  projectId: string;
  payload: Record<string, unknown>;
}) {
  const { data: autonomyRules } = useQuery({
    queryKey: ['agent-autonomy', projectId],
    queryFn: () => listAgentAutonomy(projectId),
  });
  const agentes = agentesDoPlano(payload);
  if (agentes.length === 0) return null;
  return (
    <ModoAutomaticoDoTime
      projectId={projectId}
      agentes={agentes}
      autonomyRules={autonomyRules}
      podeLigar
    />
  );
}
