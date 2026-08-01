import { AGENTS, AREAS, areaFor, type AgentDef } from './agents';
import type { AgentStatus } from '../components/AgentCard';
import type { DelegationEventPayload, SessionEvent, ModuleMap, Handoff } from './api-types';

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

// Subagentes de área (Fase 8b/8c/8d) não broadcastam `agent.status` próprio
// — rodam síncronos dentro do processo do lead, e o lead é quem narra
// working/idle. O que existe pra eles é o DESFECHO da delegação mais
// recente da sessão: `completed`/`dispensed` não é "trabalhando" (já
// terminou), só `failed` merece destaque (`falhou`) — o resto é `ocioso`,
// mesma disciplina de "sem liveness inventada" do resto do painel.
function delegationEventsFor(events: SessionEvent[], subagentId: string): SessionEvent[] {
  return events.filter(
    (e) =>
      e.type.startsWith('delegation.') &&
      (e.payload as DelegationEventPayload).subagent === subagentId,
  );
}

function subagentStatus(events: SessionEvent[], subagentId: string): AgentStatus {
  const last = delegationEventsFor(events, subagentId).at(-1);
  return last?.type === 'delegation.failed' ? 'falhou' : 'ocioso';
}

// Rótulo curto do desfecho mais recente — vira `activity.label` no card
// (Fase 8d). `undefined` quando não há delegação nenhuma ainda (não deveria
// acontecer aqui: só chamamos isto pra subagente já presente na roster, e
// presença exige pelo menos uma delegação — ver `deriveAgentRoster`).
export function subagentOutcomeLabel(events: SessionEvent[], subagentId: string): string | undefined {
  const last = delegationEventsFor(events, subagentId).at(-1);
  if (!last) return undefined;
  const payload = last.payload as DelegationEventPayload;
  switch (last.type) {
    case 'delegation.completed':
      return 'concluiu a delegação';
    case 'delegation.failed':
      return `falhou — origem: ${payload.failureOrigin ?? '?'}`;
    case 'delegation.dispensed':
      return `dispensada — ${payload.justification ?? ''}`;
    default:
      return undefined;
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

// Subagente só entra no painel quando há EVIDÊNCIA de atividade nesta
// sessão — pelo menos uma delegação registrada (qualquer desfecho,
// inclusive dispensada: dispensa é decisão registrada, não silêncio, e o
// painel deve mostrar isso). Mesmo critério que já vale pra `qa`/`secops`/
// `infra` (só aparecem quando algo realmente aconteceu).
function pushAreaMembers(roster: RosterEntry[], events: SessionEvent[], areaKey: string): void {
  const area = AREAS[areaKey];
  if (!area) return;

  for (const member of area.members) {
    const teveDelegacao = events.some(
      (e) => e.type.startsWith('delegation.') && (e.payload as DelegationEventPayload).subagent === member,
    );
    if (teveDelegacao) {
      roster.push({ id: member, def: AGENTS[member], status: subagentStatus(events, member) });
    }
  }
}

/**
 * Monta o roster REAL de agentes instanciados numa sessão (Fase 4a —
 * painel do time ao vivo): criativo/po/arquiteto sempre; dev-<modulo> por
 * módulo do module_map quando a execução foi ativada; qa/secops quando
 * algum gate de PR (dev ou infra) já abriu alguma vez; infra quando o
 * handoff foi aceito. Substitui o AGENT_LIST estático + status uniforme.
 *
 * Fase 8d: `qa`/`infra` continuam sendo os LEADS de área (ADR 0038); os
 * SUBAGENTES (`qa-automacao`, `qa-performance-seguranca`,
 * `infra-workflows`) entram no MESMO roster flat, logo depois do lead,
 * quando há uma delegação registrada pra eles nesta sessão
 * (`pushAreaMembers`). Quem AGRUPA visualmente (lead + membros recolhíveis)
 * é o componente que renderiza, via `areaFor` — este módulo só decide QUEM
 * está na roster e o status de cada um.
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
    pushAreaMembers(roster, events, 'qa');
  }

  const infraActive = handoffs.some((h) => h.toAgent === 'infra' && h.status === 'accepted');
  if (infraActive) {
    roster.push({ id: 'infra', def: AGENTS.infra, status: conversationalStatus(events, 'infra') });
    pushAreaMembers(roster, events, 'infra');
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

export type RosterGroup =
  | { kind: 'solo'; entry: RosterEntry }
  | { kind: 'area'; areaKey: string; lead: RosterEntry; members: RosterEntry[] };

/**
 * Agrupa a roster FLAT por área (Fase 8d, ADR 0038): cada lead de área
 * (`qa`/`infra`) vira o topo de um grupo com os membros presentes na MESMA
 * roster (via `areaFor`); quem não tem área (Criativo/PO/Arquiteto/dev-*)
 * continua solo.
 *
 * Devolve ENTRADAS, não índices — extraído do painel do time
 * (`ProjectOverviewTab.tsx`), que originalmente indexava porque precisa
 * alinhar com `bindingQueries`/`tokenUsage` (arrays paralelos à roster
 * inteira); esse acoplamento é problema de QUEM CONSOME o agrupamento, não
 * do agrupamento em si — o card do dashboard (Fase de fidelidade da UI),
 * por exemplo, só precisa de `lead.def`/`members.length`, sem índice
 * nenhum. Chamador que precisar de índice usa `roster.indexOf(entry)`
 * (roster é sempre pequena, de dígito único).
 */
export function groupRosterByArea(roster: RosterEntry[]): RosterGroup[] {
  const groups: RosterGroup[] = [];
  const agrupados = new Set<string>();

  for (const entry of roster) {
    if (agrupados.has(entry.id)) continue;
    const area = AREAS[entry.id];
    if (area && area.lead === entry.id) {
      const members = roster.filter((r) =>
        (area.members as string[]).includes(r.id),
      );
      members.forEach((m) => agrupados.add(m.id));
      groups.push({ kind: 'area', areaKey: area.key, lead: entry, members });
    } else if (!areaFor(entry.id)) {
      groups.push({ kind: 'solo', entry });
    }
  }

  return groups;
}
