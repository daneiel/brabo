import { AGENTS, type AgentDef } from './agents';
import type { AgentStatus } from '../components/AgentCard';
import type { SessionEvent, ModuleMap, Handoff } from './api-types';

export interface RosterEntry {
  id: string;
  def: AgentDef;
  status: AgentStatus;
}

// agent_id/branch slug a partir do nome do módulo — mesma regra de
// `devAgentId` em activate-execution.use-case.ts (api).
function devAgentId(moduleName: string): string {
  return `dev-${moduleName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}`;
}

// dev-<modulo> não está no roster fixo (AGENTS) — sintetiza um AgentDef
// reaproveitando ícone/cor do "dev-backend" genérico.
function syntheticDevDef(agentId: string, moduleName: string): AgentDef {
  const base = AGENTS['dev-backend'];
  return {
    ...base,
    key: base.key,
    name: agentId,
    role: `Implementação do módulo "${moduleName}"`,
  };
}

function lastEventFor(events: SessionEvent[], predicate: (e: SessionEvent) => boolean) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (predicate(events[i])) return events[i];
  }
  return undefined;
}

// Agentes conversacionais (criativo/po/arquiteto/infra) narram
// `agent.status` (working/idle) nos limites de turno — status ao vivo direto.
function conversationalStatus(events: SessionEvent[], actorId: string): AgentStatus {
  const last = lastEventFor(events, (e) => e.actor.id === actorId && e.type === 'agent.status');
  const status = last ? (last.payload as { status?: string }).status : undefined;
  return status === 'working' ? 'trabalhando' : 'ocioso';
}

// Dev agents não emitem agent.status — aproxima via o último evento próprio.
//
// A versão anterior devolvia `trabalhando` para TUDO que não fosse bloqueio,
// inclusive quando o log dizia `dev.idle` e inclusive sem nenhum evento do
// agente: um dev parado aparecia trabalhando para sempre. `dev.idle` (emitido
// quando não há task pegável) e o silêncio total agora dizem a verdade.
const DEV_STATUS_EVENTS = [
  'dev.started',
  'dev.working',
  'dev.idle',
  'dev.blocked',
  'agent.response',
  'backlog.task_blocked',
];

function devStatus(events: SessionEvent[], agentId: string): AgentStatus {
  const last = lastEventFor(
    events,
    (e) => e.actor.id === agentId && DEV_STATUS_EVENTS.includes(e.type),
  );

  if (!last) return 'ocioso';

  switch (last.type) {
    case 'backlog.task_blocked':
    case 'dev.blocked':
      return 'falhou';
    case 'dev.idle':
      return 'ocioso';
    default:
      return 'trabalhando';
  }
}

// Um agente com ação pendente de aprovação está BLOQUEADO esperando o humano,
// não trabalhando — é o estado `aguardando` do design, que antes nenhum
// caminho produzia (o contador do header era sempre 0).
function awaitingApproval(pendingActionAgentIds: Set<string>, agentId: string): boolean {
  return pendingActionAgentIds.has(agentId);
}

// QA/SecOps são singletons por projeto — o `gateStatus` do parecer MAIS
// RECENTE (dev OU infra) diz qual dos dois está com a bola: awaiting_qa =
// QA trabalhando, awaiting_secops = SecOps trabalhando, awaiting_user/blocked
// = nenhum dos dois.
function gateStatus(events: SessionEvent[], gate: 'qa' | 'secops'): AgentStatus {
  const last = lastEventFor(
    events,
    (e) => e.type === 'pr.gate_changed' || e.type === 'infra.gate_changed',
  );
  if (!last) return 'ocioso';
  const current = (last.payload as { gateStatus?: string }).gateStatus;
  const expected = gate === 'qa' ? 'awaiting_qa' : 'awaiting_secops';
  return current === expected ? 'trabalhando' : 'ocioso';
}

/**
 * Monta o roster REAL de agentes instanciados numa sessão (Fase 4a —
 * painel do time ao vivo): criativo/po/arquiteto sempre; dev-<modulo> por
 * módulo do module_map quando a execução foi ativada; qa/secops quando
 * algum gate de PR (dev ou infra) já abriu alguma vez; infra quando o
 * handoff foi aceito. Substitui o AGENT_LIST estático + status uniforme.
 */
export function deriveAgentRoster(
  events: SessionEvent[],
  moduleMap: ModuleMap | null | undefined,
  executionActivated: boolean,
  handoffs: Handoff[],
  pendingActionAgentIds: ReadonlySet<string> = new Set(),
): RosterEntry[] {
  const pendentes = new Set(pendingActionAgentIds);

  const roster: RosterEntry[] = [
    { id: 'criativo', def: AGENTS.criativo, status: conversationalStatus(events, 'criativo') },
    { id: 'po', def: AGENTS.po, status: conversationalStatus(events, 'po') },
    { id: 'arquiteto', def: AGENTS.arquiteto, status: conversationalStatus(events, 'arquiteto') },
  ];

  if (executionActivated && moduleMap) {
    for (const m of moduleMap.modules) {
      const id = devAgentId(m.name);
      roster.push({ id, def: syntheticDevDef(id, m.name), status: devStatus(events, id) });
    }
  }

  const gatesEverOpened = events.some(
    (e) => e.type === 'pr.gate_changed' || e.type === 'infra.gate_changed',
  );
  if (gatesEverOpened) {
    roster.push({ id: 'qa', def: AGENTS.qa, status: gateStatus(events, 'qa') });
    roster.push({ id: 'secops', def: AGENTS.secops, status: gateStatus(events, 'secops') });
  }

  const infraActive = handoffs.some((h) => h.toAgent === 'infra' && h.status === 'accepted');
  if (infraActive) {
    roster.push({ id: 'infra', def: AGENTS.infra, status: conversationalStatus(events, 'infra') });
  }

  // Aplicado por último e sobrepondo: esperar aprovação humana é o estado mais
  // informativo que um agente pode ter no painel. `falhou` continua vencendo —
  // uma task bloqueada é o que o usuário precisa ver primeiro.
  return roster.map((entry) =>
    entry.status !== 'falhou' && awaitingApproval(pendentes, entry.id)
      ? { ...entry, status: 'aguardando' }
      : entry,
  );
}
