import { useState } from 'react';
import type { SessionEvent } from '../lib/api-types';
import { EventItem } from './EventItem';
import { BellIcon } from './ui/icons';
import styles from './NotificationBell.module.css';

export interface NotificationGroup {
  projectId: string;
  projectName: string;
  events: SessionEvent[];
}

interface NotificationBellProps {
  groups: NotificationGroup[];
  unreadCount: number;
  onMarkRead: () => void;
}

export function NotificationBell({ groups, unreadCount, onMarkRead }: NotificationBellProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.button}
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificações"
      >
        <BellIcon size={17} />
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.header}>
            <span className={styles.headerTitle}>Notificações</span>
            <button type="button" className={styles.markRead} onClick={onMarkRead}>
              marcar lidas
            </button>
          </div>

          {groups.length === 0 && <div className={styles.empty}>Nenhuma notificação por aqui ainda.</div>}

          {groups.map((group) => (
            <div key={group.projectId} className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={styles.groupDot} />
                {group.projectName}
                <span className={styles.groupCount}>{group.events.length}</span>
              </div>
              <div className={styles.list}>
                {group.events.map((event) => (
                  <EventItem key={event.id} event={event} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
