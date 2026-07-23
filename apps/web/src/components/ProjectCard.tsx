import type { CSSProperties } from 'react';
import type { GitProviderName } from '../lib/api-types';
import type { AgentDef } from '../lib/agents';
import { TokenMeter } from './TokenMeter';
import { Badge } from './ui/Badge';
import { GitHubIcon, GitLabIcon, LocalRepoIcon } from './ui/icons';
import styles from './ProjectCard.module.css';

const PROVIDER_ICON: Record<GitProviderName, typeof GitHubIcon> = {
  github: GitHubIcon,
  gitlab: GitLabIcon,
  local: LocalRepoIcon,
};

const PROVIDER_LABEL: Record<GitProviderName, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  local: 'Repositório local',
};

interface ProjectCardProps {
  name: string;
  provider: GitProviderName;
  agents: AgentDef[];
  tokensUsed: number;
  tokensLimit: number;
  costBRL: number;
  costUSD: number;
  lastActivityText: string;
  unreadCount?: number;
  onClick: () => void;
}

export function ProjectCard({
  name,
  provider,
  agents,
  tokensUsed,
  tokensLimit,
  costBRL,
  costUSD,
  lastActivityText,
  unreadCount,
  onClick,
}: ProjectCardProps) {
  const ProviderIcon = PROVIDER_ICON[provider];

  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <div className={styles.header}>
        <span className={styles.providerIcon}>
          <ProviderIcon size={17} />
        </span>
        <div className={styles.titleBlock}>
          <div className={styles.name}>{name}</div>
          <div className={styles.providerLabel}>{PROVIDER_LABEL[provider]}</div>
        </div>
        {!!unreadCount && (
          <Badge tone="accent" className={styles.unreadBadge}>
            {unreadCount}
          </Badge>
        )}
      </div>

      {agents.length > 0 && (
        <div className={styles.avatars}>
          {agents.map((agent) => {
            const Icon = agent.icon;
            return (
              <span key={agent.key} className={styles.avatar} style={{ ['--agent-color' as string]: agent.color } as CSSProperties}>
                <Icon size={13} />
              </span>
            );
          })}
        </div>
      )}

      <TokenMeter used={tokensUsed} limit={tokensLimit} costBRL={costBRL} costUSD={costUSD} variant="compact" unitLabel="USD" />

      <div className={styles.footer}>
        <span className={styles.activityDot} />
        <span className={styles.activityText}>{lastActivityText}</span>
      </div>
    </button>
  );
}
