import type { SessionEvent } from '../lib/api-types';
import { classifyEvent } from '../lib/activity';
import { formatRelativeTime } from '../lib/time';
import styles from './EventItem.module.css';

interface EventItemProps {
  event: SessionEvent;
  /** Alvo da navegação de evidência (Fase 4b) — destaca e recebe o scroll. */
  highlighted?: boolean;
}

export function EventItem({ event, highlighted }: EventItemProps) {
  const display = classifyEvent(event);
  const Icon = display.icon;

  return (
    <div
      id={`event-${event.id}`}
      className={[styles.row, highlighted && styles.highlighted]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.icon} style={{ ['--item-color' as string]: display.color }}>
        <Icon size={14} />
      </span>
      <span className={styles.text}>{display.text}</span>
      <span className={styles.time}>{formatRelativeTime(event.createdAt)}</span>
    </div>
  );
}
