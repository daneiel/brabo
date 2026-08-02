import type { CSSProperties } from 'react';
import type { GitProviderName, ProvisioningStatus } from '../lib/api-types';
import type { RosterGroup } from '../lib/agent-status';
import { TokenMeter } from './TokenMeter';
import { Badge } from './ui/Badge';
import type { BadgeTone } from './ui/Badge';
import { Skeleton } from './ui/Skeleton';
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

const PROVISIONING_BADGE: Record<
  Exclude<ProvisioningStatus, 'provisioned'>,
  { tone: BadgeTone; label: string; pulse?: boolean }
> = {
  provisioning: { tone: 'warning', label: 'Provisionando', pulse: true },
  provision_failed: { tone: 'danger', label: 'Falha' },
  // Fase 12a: repo adotado com plano gerado e ainda não decidido — nada roda
  // até o usuário aprovar ou dispensar (RN-045). O estado entrou no tipo e
  // este mapa ficou para trás, o que quebrava o BUILD de produção (`tsc -b`
  // vê o `Record` exaustivo; o `--noEmit` da checagem local não via).
  // `pulse` porque é pendência de decisão, não trabalho em andamento.
  awaiting_plan_decision: {
    tone: 'warning',
    label: 'Aguardando sua decisão',
    pulse: true,
  },
};

const MAX_CHIPS = 4;

interface ProjectCardProps {
  name: string;
  provider: GitProviderName;
  provisioningStatus?: ProvisioningStatus | null;
  rosterGroups: RosterGroup[];
  tokensUsed: number;
  tokensLimit: number;
  costBRL: number;
  costUSD: number;
  noBudget?: boolean;
  onDefineBudget?: () => void;
  lastActivityText: string;
  unreadCount?: number;
  onClick: () => void;
}

export function ProjectCard({
  name,
  provider,
  provisioningStatus,
  rosterGroups,
  tokensUsed,
  tokensLimit,
  costBRL,
  costUSD,
  noBudget,
  onDefineBudget,
  lastActivityText,
  unreadCount,
  onClick,
}: ProjectCardProps) {
  const ProviderIcon = PROVIDER_ICON[provider];
  const provisioningBadge =
    provisioningStatus && provisioningStatus !== 'provisioned'
      ? PROVISIONING_BADGE[provisioningStatus]
      : null;

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
        {provisioningBadge && (
          <Badge
            tone={provisioningBadge.tone}
            dot
            pulse={provisioningBadge.pulse}
            className={styles.unreadBadge}
          >
            {provisioningBadge.label}
          </Badge>
        )}
        {!!unreadCount && (
          <Badge tone="accent" className={styles.unreadBadge}>
            {unreadCount}
          </Badge>
        )}
      </div>

      {rosterGroups.length > 0 && (
        <div className={styles.avatars}>
          {rosterGroups.slice(0, MAX_CHIPS).map((group) => {
            // Área vira UM chip pro lead — a contagem inclui o lead, então
            // "QA ×3" = qa + qa-automacao + qa-performance-seguranca. É o
            // que faz a subespecialidade aparecer sem virar um avatar à
            // parte (critério de aceite: área de QA como chip único).
            const def = group.kind === 'area' ? group.lead.def : group.entry.def;
            const key = group.kind === 'area' ? group.areaKey : group.entry.id;
            // Só ganha o badge de contagem quando há de fato subagente
            // presente — um lead de área sem nenhuma subespecialidade
            // delegada nesta sessão (roster sem membros) é visualmente um
            // chip solo comum, sem "×1" enganoso.
            const count =
              group.kind === 'area' && group.members.length > 0
                ? group.members.length + 1
                : undefined;
            const Icon = def.icon;
            return (
              <span
                key={key}
                className={styles.avatar}
                style={{ ['--agent-color' as string]: def.color } as CSSProperties}
                title={count ? `${def.name} ×${count}` : def.name}
              >
                <Icon size={13} />
                {count !== undefined && (
                  <span className={styles.avatarCount}>×{count}</span>
                )}
              </span>
            );
          })}
          {rosterGroups.length > MAX_CHIPS && (
            <span className={styles.avatarOverflow}>
              +{rosterGroups.length - MAX_CHIPS}
            </span>
          )}
        </div>
      )}

      <TokenMeter
        used={tokensUsed}
        limit={tokensLimit}
        costBRL={costBRL}
        costUSD={costUSD}
        noBudget={noBudget}
        onDefineBudget={onDefineBudget}
        variant="compact"
        unitLabel="USD"
      />

      <div className={styles.footer}>
        <span className={styles.activityDot} />
        <span className={styles.activityText}>{lastActivityText}</span>
      </div>
    </button>
  );
}

/** Placeholder no formato do card, enquanto a lista de projetos carrega. */
export function ProjectCardSkeleton() {
  return (
    <div className={styles.card} data-testid="project-card-skeleton">
      <div className={styles.header}>
        <Skeleton width={34} height={34} radius={8} />
        <div className={styles.titleBlock}>
          <Skeleton width="70%" height={15} />
          <Skeleton width="40%" height={11} />
        </div>
      </div>
      <Skeleton height={26} radius={8} />
      <Skeleton height={44} radius={8} />
    </div>
  );
}
