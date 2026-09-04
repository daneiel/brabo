import i18n from './i18n';
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
//
// Fase 12b: `dev.awaiting_gate` (PR aberta, esperando o gate — o agente
// mantém task_id/worktree, mas não está "trabalhando" no sentido do
// ToolLoop rodando) e `dev.idle_tripped` (circuit breaker disparado, RN-047)
// entram na mesma lista — são status tão reais quanto os que já existiam.
//
// `dev.rearmed` FICA DE FORA de propósito: quem o grava é a api, com
// `actor: {kind: 'user', ...}` (é o clique do humano, não uma narrativa do
// agente) — o filtro abaixo é por `actor.id === agentId`, então esse evento
// nunca bateria mesmo estando na lista. O `dev.idle`/`dev.working` que
// `try_claim` dispara em seguida (round-trip assíncrono pelo engine) é
// quem efetivamente atualiza o status, poucos instantes depois.
const DEV_STATUS_EVENTS = [
  'dev.started',
  'dev.working',
  'dev.idle',
  'dev.blocked',
  'dev.awaiting_gate',
  'dev.idle_tripped',
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
    case 'dev.awaiting_gate':
      return 'aguardando';
    case 'dev.idle_tripped':
      return 'travado';
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
      return i18n.t('agentStatus.delegation.completed', { ns: 'executors' });
    case 'delegation.failed':
      return i18n.t('agentStatus.delegation.failed', {
        ns: 'executors',
        origin: payload.failureOrigin ?? '?',
      });
    case 'delegation.dispensed':
      return i18n.t('agentStatus.delegation.dispensed', {
        ns: 'executors',
        justification: payload.justification ?? '',
      });
    default:
      return undefined;
  }
}

// Motivo do circuit breaker (Fase 12b — RN-047), pro card não ficar só com
// "travado" sem dizer POR QUÊ — é a única informação nova que o painel
// precisa mostrar pra esse estado (a task/branch já sumiram via
// `deriveExecutionProgress`, e não há nada mais recente a contar).
export function breakerReasonFor(events: SessionEvent[], agentId: string): string | undefined {
  const last = lastEventFor(
    events,
    (e) => e.actor.id === agentId && e.type === 'dev.idle_tripped',
  );
  if (!last) return undefined;
  const n = (last.payload as { consecutiveBlocked?: number }).consecutiveBlocked;
  return n
    ? i18n.t('agentStatus.circuitBreaker.withCount', { ns: 'executors', count: n })
    : i18n.t('agentStatus.circuitBreaker.default', { ns: 'executors' });
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
function pushAreaMembers(
  roster: RosterEntry[],
  delegatedSubagents: readonly string[],
  areaKey: string,
  statusOf: (agentId: string) => AgentStatus,
): void {
  const area = AREAS[areaKey];
  if (!area) return;

  for (const member of area.members) {
    if (delegatedSubagents.includes(member)) {
      roster.push({ id: member, def: AGENTS[member], status: statusOf(member) });
    }
  }
}

/**
 * Os FATOS que decidem QUEM está na roster — separados de qual status cada um
 * tem.
 *
 * A separação existe porque as duas telas que montam roster pedem coisas
 * diferentes: o painel do time precisa de status ao vivo (e por isso paga os
 * eventos da sessão), enquanto o card do dashboard só desenha o chip do agente
 * e nunca lê status nenhum. Com os fatos isolados, o card se alimenta do
 * resumo do workspace (uma requisição para a grade toda) sem que exista uma
 * SEGUNDA regra de presença — `deriveAgentRoster` e o card passam pelo mesmo
 * `rosterFromFacts` abaixo. Duas regras divergiriam no primeiro agente novo.
 */
export interface RosterFacts {
  executionActivated: boolean;
  moduleNames: string[];
  gatesEverOpened: boolean;
  delegatedSubagents: string[];
  infraActive: boolean;
  /**
   * ADR 0087 — mesmo critério de `infraActive`: handoff `accepted`
   * endereçado a "ux-designer" nesta sessão. Ele é SOLO (sem área), então
   * não há `pushAreaMembers` correspondente. Calculado nas DUAS fontes
   * (aqui e em `projects-summary.repository.ts`, RN-090), como `infraActive`.
   */
  uxDesignerActive: boolean;
  /**
   * Staff (docs/fluxo.yml, camada_decisao_tecnica, ADR 0088) — mesmo
   * critério de presença de `infraActive`: só entra no roster quando há
   * handoff `accepted` endereçado a ele NESTA sessão. Dormente para
   * disparo automático (a Anamnese que o dispararia está pausada); o fato
   * aqui só reflete ativação MANUAL já aceita.
   */
  staffActive: boolean;
}

/** Extrai os fatos de presença do event log (caminho do painel do time). */
export function rosterFactsFromEvents(
  events: SessionEvent[],
  moduleMap: ModuleMap | null | undefined,
  executionActivated: boolean,
  handoffs: Handoff[],
): RosterFacts {
  const delegatedSubagents = [
    ...new Set(
      events
        .filter((e) => e.type.startsWith('delegation.'))
        .map((e) => (e.payload as DelegationEventPayload).subagent)
        .filter((s): s is string => !!s),
    ),
  ];

  return {
    executionActivated,
    moduleNames: (moduleMap?.modules ?? []).map((m) => m.name),
    gatesEverOpened: events.some(
      (e) => e.type === 'pr.gate_changed' || e.type === 'infra.gate_changed',
    ),
    delegatedSubagents,
    infraActive: handoffs.some(
      (h) => h.toAgent === 'infra' && h.status === 'accepted',
    ),
    uxDesignerActive: handoffs.some(
      (h) => h.toAgent === 'ux-designer' && h.status === 'accepted',
    ),
    staffActive: handoffs.some(
      (h) => h.toAgent === 'staff' && h.status === 'accepted',
    ),
  };
}

/**
 * A REGRA DE PRESENÇA, única no app: criativo/po/arquiteto sempre;
 * dev-<modulo> por módulo quando a execução foi ativada; qa/secops quando
 * algum gate já abriu; membros de área com delegação registrada;
 * infra/ux-designer/staff quando o handoff foi aceito (ux-designer: ADR
 * 0087; staff: docs/fluxo.yml, ADR 0088 — dormente para disparo automático,
 * presente aqui só por ativação MANUAL).
 *
 * `statusOf` é de quem chama: o painel do time resolve pelo event log, o card
 * do dashboard devolve `ocioso` porque não exibe status.
 */
export function rosterFromFacts(
  facts: RosterFacts,
  statusOf: (agentId: string) => AgentStatus,
): RosterEntry[] {
  const roster: RosterEntry[] = [
    { id: 'criativo', def: AGENTS.criativo, status: statusOf('criativo') },
    { id: 'po', def: AGENTS.po, status: statusOf('po') },
    { id: 'arquiteto', def: AGENTS.arquiteto, status: statusOf('arquiteto') },
  ];

  if (facts.executionActivated) {
    for (const name of facts.moduleNames) {
      const id = devAgentId(name);
      roster.push({ id, def: syntheticDevDef(id, name), status: statusOf(id) });
    }
  }

  if (facts.gatesEverOpened) {
    roster.push({ id: 'qa', def: AGENTS.qa, status: statusOf('qa') });
    roster.push({ id: 'secops', def: AGENTS.secops, status: statusOf('secops') });
    pushAreaMembers(roster, facts.delegatedSubagents, 'qa', statusOf);
  }

  if (facts.infraActive) {
    roster.push({ id: 'infra', def: AGENTS.infra, status: statusOf('infra') });
    pushAreaMembers(roster, facts.delegatedSubagents, 'infra', statusOf);
  }

  // ADR 0087 — SOLO (sem área): nenhum `pushAreaMembers` correspondente.
  if (facts.uxDesignerActive) {
    roster.push({
      id: 'ux-designer',
      def: AGENTS['ux-designer'],
      status: statusOf('ux-designer'),
    });
  }

  if (facts.staffActive) {
    roster.push({ id: 'staff', def: AGENTS.staff, status: statusOf('staff') });
  }

  return roster;
}

/**
 * Monta o roster REAL de agentes instanciados numa sessão (Fase 4a —
 * painel do time ao vivo): criativo/po/arquiteto sempre; dev-<modulo> por
 * módulo do module_map quando a execução foi ativada; qa/secops quando
 * algum gate de PR (dev ou infra) já abriu alguma vez; infra/staff quando o
 * respectivo handoff foi aceito. Substitui o AGENT_LIST estático + status
 * uniforme.
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
  const facts = rosterFactsFromEvents(
    events,
    moduleMap,
    executionActivated && !!moduleMap,
    handoffs,
  );

  // Cada família de agente narra o próprio estado de um jeito, e é isto que o
  // card do dashboard NÃO precisa — ele desenha o chip, não o status.
  const statusOf = (agentId: string): AgentStatus => {
    if (agentId === 'qa') return gateStatus(events, 'qa');
    if (agentId === 'secops') return gateStatus(events, 'secops');
    const area = areaFor(agentId);
    // Membro de área (nunca o lead): quem narra é a delegação, não o agente.
    if (area && area.lead !== agentId) return subagentStatus(events, agentId);
    if (agentId.startsWith('dev-')) return devStatus(events, agentId);
    return conversationalStatus(events, agentId);
  };

  const roster = rosterFromFacts(facts, statusOf);

  // Aplicado por último e sobrepondo: esperar aprovação humana é o estado mais
  // informativo que um agente pode ter no painel. `falhou` continua vencendo —
  // uma task bloqueada é o que o usuário precisa ver primeiro. `travado`
  // (Fase 12b) vence também: o circuit breaker parou o agente de propósito,
  // e isso pesa mais que uma aprovação pendente.
  return roster.map((entry) =>
    entry.status !== 'falhou' && entry.status !== 'travado' && awaitingApproval(pendentes, entry.id)
      ? { ...entry, status: 'aguardando' }
      : entry,
  );
}

// actionType representativo de cada agente, pra resumir a autonomia num
// toggle só (auto_approve vira "auto"). Vivia só em `ProjectOverviewTab.tsx`;
// a FASE 27 move pra cá porque a aba Executores (`ProjectExecutorsTab.tsx`)
// passou a montar o MESMO card de lead pelos mesmos dois lugares.
const AUTONOMY_ACTION_TYPE: Record<string, string> = {
  infra: 'open_infra_pr',
  criativo: 'write_file',
  po: 'write_file',
  arquiteto: 'open_adr_pr',
  qa: 'terminal',
  secops: 'terminal',
};
export function autonomyActionTypeFor(agentId: string): string {
  return AUTONOMY_ACTION_TYPE[agentId] ?? (agentId.startsWith('dev-') ? 'pr_open' : 'terminal');
}

/**
 * "Executor" (FASE 27, RN-121): dev agent (lead sintético `dev-lead` — hoje
 * nunca instanciado na roster, ver `agent-areas.ts` — e os `dev-<modulo>`
 * dinâmicos, que HOJE saem como grupos `solo` porque `dev-lead` não é
 * emitido) e a área `qa` (lead + `qa-automacao`/`qa-performance-seguranca`).
 * É o que separa a aba Executores da Visão geral: implementação e
 * verificação de um lado, o resto do time (Criativo/PO/Arquiteto/Infra) do
 * outro — nenhuma das duas telas edita `AREAS`, só filtra o que ele já
 * devolve.
 */
export function isExecutorAgentId(agentId: string): boolean {
  return agentId === 'dev-lead' || agentId.startsWith('dev-') || areaFor(agentId)?.key === 'qa';
}

export function isExecutorGroup(group: RosterGroup): boolean {
  return group.kind === 'area'
    ? group.areaKey === 'qa' || group.areaKey === 'dev'
    : isExecutorAgentId(group.entry.id);
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
