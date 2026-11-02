import type { SessionEvent } from '../lib/api-types';
import { classifyEvent } from '../lib/activity';
import { formatRelativeTime } from '../lib/time';
import { Item, ItemContent, ItemMedia } from '@/components/shadcn/item';
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
    <Item
      size="xs"
      id={`event-${event.id}`}
      className={[styles.row, highlighted && styles.highlighted]
        .filter(Boolean)
        .join(' ')}
    >
      <ItemMedia className={styles.icon} style={{ ['--item-color' as string]: display.color }}>
        <Icon size={14} />
      </ItemMedia>
      <ItemContent className={styles.text}>{display.text}</ItemContent>
      <span className={styles.time}>{formatRelativeTime(event.createdAt)}</span>
    </Item>
  );
}
