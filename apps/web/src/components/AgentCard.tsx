import type { CSSProperties } from 'react';
import type { AgentDef } from '../lib/agents';
import { BranchIcon, ModelIcon } from './ui/icons';
import styles from './AgentCard.module.css';

// `travado` (Fase 12b — RN-047): circuit breaker do dev agent disparado.
// A derivação real (dev.idle_tripped → travado) é da Fase 12b-7; o tipo e o
// botão de rearmar chegam antes, inertes, porque nada ainda produz esse
// status.
export type AgentStatus = 'trabalhando' | 'aguardando' | 'ocioso' | 'falhou' | 'travado';

const STATUS_LABEL: Record<AgentStatus, string> = {
  trabalhando: 'trabalhando',
  aguardando: 'aguardando',
  ocioso: 'ocioso',
  falhou: 'falhou',
  travado: 'travado',
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  trabalhando: 'var(--success)',
  aguardando: 'var(--warning)',
  ocioso: 'var(--text-muted)',
  falhou: 'var(--danger)',
  travado: 'var(--danger)',
};

export type AutonomyMode = 'manual' | 'auto';

interface AgentCardProps {
  agent: AgentDef;
  status: AgentStatus;
  model?: { name: string; provider: string };
  autonomy?: AutonomyMode;
  onAutonomyChange?: (mode: AutonomyMode) => void;
  /** Task/atividade corrente — o que o agente está fazendo AGORA. */
  activity?: { label: string; branch?: string };
  /** Custo acumulado do agente NESTA sessão, em micro-USD. */
  tokensMicros?: number;
  /** Selo curto ao lado do nome — hoje só "Lead" (área, Fase 8d). */
  badge?: string;
  /** Estilo reduzido pra card de subagente aninhado sob o lead da área. */
  compact?: boolean;
  /**
   * Rearma um dev agent travado pelo circuit breaker (Fase 12b — RN-047).
   * Só renderiza com `status === 'travado'` — é a ÚNICA saída de
   * `idle_tripped`, e a primeira ação do card condicionada a status (o
   * toggle de autonomia, a única precedente, aparece incondicional).
   */
  onRearm?: () => void;
}

function formatMicros(micros: number): string {
  return `US$ ${(micros / 1_000_000).toFixed(4)}`;
}

export function AgentCard({
  agent,
  status,
  model,
  autonomy,
  onAutonomyChange,
  activity,
  tokensMicros,
  badge,
  compact,
  onRearm,
}: AgentCardProps) {
  const Icon = agent.icon;
  const style = { ['--agent-color' as string]: agent.color } as CSSProperties;
  const statusStyle = { ['--status-color' as string]: STATUS_COLOR[status] } as CSSProperties;

  return (
    <div className={[styles.card, compact && styles.compact].filter(Boolean).join(' ')} style={style}>
      <div className={styles.top}>
        <div className={styles.avatar}>
          <Icon size={compact ? 16 : 20} />
        </div>
        <div className={styles.info}>
          <div className={styles.name}>
            {agent.name}
            {badge && <span className={styles.badge}>{badge}</span>}
          </div>
          <div className={styles.role}>{agent.role}</div>
          <span className={styles.status} style={statusStyle}>
            <span className={[styles.statusDot, status === 'trabalhando' && styles.pulsing].filter(Boolean).join(' ')} />
            {STATUS_LABEL[status]}
          </span>
        </div>
      </div>

      {activity && (
        <div className={styles.activity}>
          <span className={styles.activityLabel} title={activity.label}>
            {activity.label}
          </span>
          {activity.branch && (
            <span className={styles.branch}>
              <BranchIcon size={11} />
              {activity.branch}
            </span>
          )}
        </div>
      )}

      {(model || tokensMicros !== undefined) && (
        <div className={styles.footer}>
          {model && (
            <span className={styles.model}>
              <span className={styles.modelIcon}>
                <ModelIcon size={13} />
              </span>
              {model.name} · {model.provider}
            </span>
          )}
          {tokensMicros !== undefined && (
            <span className={styles.tokens}>{formatMicros(tokensMicros)}</span>
          )}
        </div>
      )}

      {autonomy && onAutonomyChange && (
        <div className={styles.autonomy}>
          <button
            type="button"
            className={[styles.autonomyOption, autonomy === 'manual' && styles.active].filter(Boolean).join(' ')}
            onClick={() => onAutonomyChange('manual')}
          >
            manual
          </button>
          <button
            type="button"
            className={[styles.autonomyOption, autonomy === 'auto' && styles.active].filter(Boolean).join(' ')}
            onClick={() => onAutonomyChange('auto')}
          >
            auto
          </button>
        </div>
      )}

      {status === 'travado' && onRearm && (
        <div className={styles.autonomy}>
          <button type="button" className={styles.autonomyOption} onClick={onRearm}>
            rearmar
          </button>
        </div>
      )}
    </div>
  );
}
