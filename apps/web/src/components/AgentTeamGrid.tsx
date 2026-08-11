import type { UseQueryResult } from '@tanstack/react-query';
import {
  autonomyActionTypeFor,
  breakerReasonFor,
  subagentOutcomeLabel,
  type RosterEntry,
  type RosterGroup,
} from '../lib/agent-status';
import { AREAS } from '../lib/agents';
import type {
  AgentAutonomyRule,
  AgentTokenUsage,
  Model,
  ResolvedBinding,
  SessionEvent,
} from '../lib/api-types';
import type { AgentProgress } from '../lib/execution';
import { AgentCard, type AutonomyMode } from './AgentCard';
import { ChevronDownIcon, ChevronRightIcon } from './ui/icons';
import styles from '../routes/ProjectOverviewTab.module.css';

/**
 * O grid "lead + subespecialidades recolhíveis" (Fase 8d) — extraído de
 * `ProjectOverviewTab.tsx` na FASE 27 para que a aba Executores reuse a MESMA
 * renderização em vez de reinventar o card. Continua importando o CSS module
 * da Visão geral de propósito: as classes (`.grid`/`.areaGroup`/...) são do
 * layout do painel do time, não da tela — duplicá-las teria criado uma
 * segunda folha para o mesmo desenho.
 *
 * Presentational: quem monta `groups`/`roster`/as consultas já resolveu os
 * dados (a Visão geral e a aba Executores fazem cada uma a própria busca,
 * porque são componentes de rota independentes — o cache do react-query já
 * evita a requisição em dobro quando as duas correm na mesma sessão).
 */
export interface AgentTeamGridProps {
  /** A roster INTEIRA da sessão — alinhamento de índice com `bindingQueries`. */
  roster: RosterEntry[];
  /** Os grupos a desenhar, já filtrados por quem chama. */
  groups: RosterGroup[];
  events: SessionEvent[];
  bindingQueries: UseQueryResult<ResolvedBinding | null>[];
  allModels: Model[];
  tokenUsage?: AgentTokenUsage[];
  autonomyRules?: AgentAutonomyRule[];
  progressByAgent: Map<string, AgentProgress>;
  collapsedAreas: Set<string>;
  onToggleArea: (areaKey: string) => void;
  onAutonomyChange: (agentId: string, actionType: string, mode: AutonomyMode) => void;
  onRearm: (agentId: string) => void;
}

export function AgentTeamGrid({
  roster,
  groups,
  events,
  bindingQueries,
  allModels,
  tokenUsage,
  autonomyRules,
  progressByAgent,
  collapsedAreas,
  onToggleArea,
  onAutonomyChange,
  onRearm,
}: AgentTeamGridProps) {
  // Card do LEAD (ou de um agente solo) — com toggle de autonomia (é quem
  // propõe ação/tem policy).
  function renderLeadCard(index: number, badge?: string) {
    const r = roster[index];
    const modelId = bindingQueries[index]?.data?.modelId;
    const model = allModels.find((m) => m.id === modelId);
    const autonomyType = autonomyActionTypeFor(r.id);
    const rule = autonomyRules?.find((a) => a.agentId === r.id && a.actionType === autonomyType);
    const progress = progressByAgent.get(r.id);
    const custo = tokenUsage?.find((u) => u.actorId === r.id)?.costMicros;
    return (
      <AgentCard
        key={r.id}
        agent={r.def}
        status={r.status}
        badge={badge}
        model={model ? { name: model.displayName, provider: model.provider } : undefined}
        // Sem regra gravada o default do domínio é require_approval —
        // "manual". Mostrar o toggle sempre é o que o design pede, e
        // é o que torna a autonomia AJUSTÁVEL daqui.
        autonomy={rule?.mode === 'auto_approve' ? 'auto' : 'manual'}
        onAutonomyChange={(mode) => onAutonomyChange(r.id, autonomyType, mode)}
        onRearm={r.status === 'travado' ? () => onRearm(r.id) : undefined}
        activity={
          r.status === 'travado'
            ? { label: breakerReasonFor(events, r.id) ?? 'circuit breaker disparado' }
            : progress?.taskTitle
              ? { label: progress.taskTitle, branch: progress.branch }
              : undefined
        }
        tokensMicros={custo}
      />
    );
  }

  // Card de SUBAGENTE (Fase 8d) — compacto, sem toggle de autonomia (não
  // propõe ação própria, não tem policy) e sem branch/task corrente (não
  // trabalha em cima de uma) — a "atividade" aqui é o desfecho da
  // delegação mais recente.
  function renderMemberCard(index: number) {
    const r = roster[index];
    const modelId = bindingQueries[index]?.data?.modelId;
    const model = allModels.find((m) => m.id === modelId);
    const custo = tokenUsage?.find((u) => u.actorId === r.id)?.costMicros;
    const outcome = subagentOutcomeLabel(events, r.id);
    return (
      <AgentCard
        key={r.id}
        agent={r.def}
        status={r.status}
        compact
        model={model ? { name: model.displayName, provider: model.provider } : undefined}
        activity={outcome ? { label: outcome } : undefined}
        tokensMicros={custo}
      />
    );
  }

  return (
    <div className={styles.grid} data-testid="agent-team-grid">
      {groups.map((group) => {
        if (group.kind === 'solo') {
          return renderLeadCard(roster.indexOf(group.entry));
        }

        const area = AREAS[group.areaKey];
        const collapsed = collapsedAreas.has(group.areaKey);
        return (
          <div key={group.areaKey} className={styles.areaGroup}>
            {renderLeadCard(roster.indexOf(group.lead), 'Lead')}
            {group.members.length > 0 && (
              <div className={styles.areaMembers}>
                <button
                  type="button"
                  className={styles.areaToggle}
                  onClick={() => onToggleArea(group.areaKey)}
                >
                  {collapsed ? <ChevronRightIcon size={13} /> : <ChevronDownIcon size={13} />}
                  {area.label} · {group.members.length} subespecialidade
                  {group.members.length > 1 ? 's' : ''}
                </button>
                {!collapsed && (
                  <div className={styles.areaMembersList}>
                    {group.members.map((m) => renderMemberCard(roster.indexOf(m)))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
