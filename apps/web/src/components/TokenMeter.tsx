import { AlertIcon, ArrowUpIcon } from './ui/icons';
import styles from './TokenMeter.module.css';

export type TokenMeterVariant = 'default' | 'compact' | 'live';
export type TokenThreshold = 'ok' | 'warning' | 'danger';

export interface TokenMeterProps {
  used: number;
  limit: number;
  costBRL: number;
  costUSD: number;
  savingsBRL?: number;
  savingsPct?: number;
  variant?: TokenMeterVariant;
  /** Unidade exibida na linha de topo — "tokens" por padrão; passar algo
   * como "USD" quando o meter é alimentado por orçamento monetário (que
   * é o que o backend efetivamente rastreia hoje, ver Budget.limitMicros). */
  unitLabel?: string;
}

const numberFmt = new Intl.NumberFormat('pt-BR');
const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const usdFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });

export function tokenThreshold(pct: number): TokenThreshold {
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warning';
  return 'ok';
}

const THRESHOLD_COLOR: Record<TokenThreshold, string> = {
  ok: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

export function TokenMeter({
  used,
  limit,
  costBRL,
  costUSD,
  savingsBRL,
  savingsPct,
  variant = 'default',
  unitLabel = 'tokens',
}: TokenMeterProps) {
  const pct = limit > 0 ? Math.min(999, Math.round((used / limit) * 100)) : 0;
  const barPct = Math.min(100, pct);
  const threshold = tokenThreshold(pct);
  const isDanger = threshold === 'danger';

  if (variant === 'live') {
    const remaining = Math.max(0, limit - used);
    return (
      <div className={[styles.card, styles.live].join(' ')} data-testid="token-meter" data-threshold={threshold}>
        <span className={styles.liveIndicator}>
          <span className={styles.liveDot} />
          ao vivo
        </span>
        <div className={styles.liveMain}>
          <div className={styles.liveTopRow}>
            <span className={styles.liveUsage}>
              {numberFmt.format(used)}/{numberFmt.format(limit)}
            </span>
            <span className={styles.liveRemaining}>falta {numberFmt.format(remaining)}</span>
          </div>
          <span className={styles.liveCost}>{brlFmt.format(costBRL)}</span>
        </div>
      </div>
    );
  }

  const compact = variant === 'compact';

  return (
    <div
      className={[styles.card, isDanger && styles.danger, compact && styles.compact].filter(Boolean).join(' ')}
      data-testid="token-meter"
      data-threshold={threshold}
    >
      <div className={styles.topRow}>
        <span className={styles.usage}>
          {numberFmt.format(used)} / {numberFmt.format(limit)} {unitLabel}
        </span>
        <span className={styles.pct} style={{ ['--pct-color' as string]: THRESHOLD_COLOR[threshold] }} data-testid="token-meter-pct">
          {isDanger ? (
            <span className={styles.pctAlert}>
              <span className={styles.alertIcon} data-testid="token-meter-alert-icon">
                <AlertIcon size={13} />
              </span>
              {pct}%
            </span>
          ) : (
            `${pct}%`
          )}
        </span>
      </div>

      <div className={styles.barTrack}>
        <div
          className={[styles.barFill, isDanger && styles.danger].filter(Boolean).join(' ')}
          style={{ width: `${barPct}%` }}
        />
      </div>

      {!compact && (
        <div className={styles.markers}>
          <span className={styles.marker} style={{ left: '70%' }}>
            70%
          </span>
          <span className={styles.marker} style={{ left: '90%' }}>
            90%
          </span>
          <span className={styles.marker} style={{ left: '100%' }}>
            100%
          </span>
        </div>
      )}

      {isDanger && !compact && <span className={styles.alertLabel}>{pct}% do limite mensal</span>}

      {!compact && (
        <div className={styles.footer}>
          <span className={styles.cost}>
            {brlFmt.format(costBRL)} · {usdFmt.format(costUSD)}
          </span>
          {savingsBRL !== undefined && savingsBRL > 0 && (
            <span className={styles.savings}>−{brlFmt.format(savingsBRL)}</span>
          )}
        </div>
      )}

      {!compact && savingsPct !== undefined && savingsPct > 0 && (
        <span className={styles.savingsBadge}>
          <ArrowUpIcon size={12} />
          {savingsPct}% de tokens poupados este ciclo
        </span>
      )}
    </div>
  );
}
