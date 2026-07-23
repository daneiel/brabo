import type { SessionEvent } from '../lib/api-types';
import { classifyEvent } from '../lib/activity';
import { formatRelativeTime } from '../lib/time';
import styles from './EventItem.module.css';

interface EventItemProps {
  event: SessionEvent;
}

export function EventItem({ event }: EventItemProps) {
  const display = classifyEvent(event);
  const Icon = display.icon;

  return (
    <div className={styles.row}>
      <span className={styles.icon} style={{ ['--item-color' as string]: display.color }}>
        <Icon size={14} />
      </span>
      <span className={styles.text}>{display.text}</span>
      <span className={styles.time}>{formatRelativeTime(event.createdAt)}</span>
    </div>
  );
}
