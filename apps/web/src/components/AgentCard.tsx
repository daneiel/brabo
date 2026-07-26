import type { CSSProperties } from 'react';
import type { AgentDef } from '../lib/agents';
import { BranchIcon, ModelIcon } from './ui/icons';
import styles from './AgentCard.module.css';

export type AgentStatus = 'trabalhando' | 'aguardando' | 'ocioso' | 'falhou';

const STATUS_LABEL: Record<AgentStatus, string> = {
  trabalhando: 'trabalhando',
  aguardando: 'aguardando',
  ocioso: 'ocioso',
  falhou: 'falhou',
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  trabalhando: 'var(--success)',
  aguardando: 'var(--warning)',
  ocioso: 'var(--text-muted)',
  falhou: 'var(--danger)',
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
}: AgentCardProps) {
  const Icon = agent.icon;
  const style = { ['--agent-color' as string]: agent.color } as CSSProperties;
  const statusStyle = { ['--status-color' as string]: STATUS_COLOR[status] } as CSSProperties;

  return (
    <div className={styles.card} style={style}>
      <div className={styles.top}>
        <div className={styles.avatar}>
          <Icon size={20} />
        </div>
        <div className={styles.info}>
          <div className={styles.name}>{agent.name}</div>
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
    </div>
  );
}
