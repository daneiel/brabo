import type { SessionEvent } from './api-types';

/**
 * Progresso ao vivo de um dev agent, derivado do event log (Fase 4a).
 *
 * O painel não tem uma fonte transacional pra isto: o que existe é a narrativa
 * que o engine emite (`dev.started`/`dev.working` do DevAgentServer e
 * `agent.response` do ToolLoop a cada turno de LLM). Reduzir aqui, puro, deixa
 * a regra testável sem montar a árvore de providers do React.
 */
export interface AgentProgress {
  module: string;
  branch?: string;
  taskId?: string;
  taskTitle?: string;
  iteration?: number;
  tokensSpentMicros?: number;
}

interface DevPayload {
  agentId?: string;
  module?: string;
  branch?: string;
  taskId?: string;
  taskTitle?: string;
}

interface ResponsePayload {
  iteration?: number;
  tokensSpentMicros?: number;
}

/**
 * Reduz o event log ao estado atual de cada dev agent. Eventos posteriores
 * sobrescrevem os anteriores — a última `dev.working` é a task corrente, e o
 * último `agent.response` é a iteração/custo do ciclo em andamento.
 */
export function deriveExecutionProgress(
  events: SessionEvent[],
): Map<string, AgentProgress> {
  const agents = new Map<string, AgentProgress>();

  for (const e of events) {
    const p = e.payload as DevPayload;

    if (e.type === 'dev.started' && p.agentId) {
      agents.set(p.agentId, {
        ...agents.get(p.agentId),
        module: p.module ?? agents.get(p.agentId)?.module ?? '',
      });
    }

    if (e.type === 'dev.working' && p.agentId) {
      agents.set(p.agentId, {
        ...agents.get(p.agentId),
        module: agents.get(p.agentId)?.module ?? '',
        branch: p.branch,
        taskId: p.taskId,
        taskTitle: p.taskTitle,
      });
    }

    // Fase 12b: sem isto, um agente que termina uma task e volta a idle
    // (ou trava no circuit breaker) continuava mostrando a task/branch da
    // ANTERIOR pra sempre — o card dizia "ocioso" ao lado de "Implementar
    // X", uma task que já não existe mais pra ele. `dev.awaiting_gate` NÃO
    // limpa: a mesma task segue em aberto, só esperando o gate.
    if ((e.type === 'dev.idle' || e.type === 'dev.idle_tripped') && p.agentId) {
      agents.set(p.agentId, {
        ...agents.get(p.agentId),
        module: agents.get(p.agentId)?.module ?? '',
        branch: undefined,
        taskId: undefined,
        taskTitle: undefined,
      });
    }

    if (e.type === 'agent.response' && agents.has(e.actor.id)) {
      const rp = e.payload as ResponsePayload;
      agents.set(e.actor.id, {
        ...(agents.get(e.actor.id) as AgentProgress),
        iteration: rp.iteration,
        tokensSpentMicros: rp.tokensSpentMicros,
      });
    }
  }

  return agents;
}

/** US$ com 4 casas — o custo de uma task fica na casa dos centavos. */
export function formatMicros(micros: number): string {
  return `US$ ${(micros / 1_000_000).toFixed(4)}`;
}
