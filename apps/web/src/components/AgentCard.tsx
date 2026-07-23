import type { CSSProperties } from 'react';
import type { AgentDef } from '../lib/agents';
import { ModelIcon } from './ui/icons';
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
}

export function AgentCard({ agent, status, model, autonomy, onAutonomyChange }: AgentCardProps) {
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

      {model && (
        <div className={styles.footer}>
          <span className={styles.modelIcon}>
            <ModelIcon size={13} />
          </span>
          {model.name} · {model.provider}
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
