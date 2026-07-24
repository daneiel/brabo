import { useMemo, useState } from 'react';
import type { SessionEvent } from '../lib/api-types';
import { classifyEvent, type ActivityKind } from '../lib/activity';
import { EventItem } from './EventItem';
import { Select } from './ui/Select';
import { ClockIcon } from './ui/icons';
import styles from './ActivityFeed.module.css';

const KIND_LABEL: Record<ActivityKind, string> = {
  commit: 'Commits',
  pr: 'Pull requests',
  hypothesis: 'Hipóteses',
  session: 'Sessão',
  permission: 'Permissões',
  terminal: 'Comandos',
  generic: 'Outros',
};

interface ActivityFeedProps {
  events: SessionEvent[];
  agentOptions?: { id: string; label: string }[];
  /** Evento a destacar (navegação de evidência do Psicólogo, Fase 4b). */
  highlightEventId?: string;
}

export function ActivityFeed({
  events,
  agentOptions = [],
  highlightEventId,
}: ActivityFeedProps) {
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [kindFilter, setKindFilter] = useState<ActivityKind | null>(null);

  const kindsPresent = useMemo(() => {
    const kinds = new Set<ActivityKind>();
    for (const event of events) kinds.add(classifyEvent(event).kind);
    return Array.from(kinds);
  }, [events]);

  const filtered = useMemo(() => {
    return events.filter((event) => {
      if (agentFilter && event.actor.id !== agentFilter) return false;
      if (kindFilter && classifyEvent(event).kind !== kindFilter) return false;
      return true;
    });
  }, [events, agentFilter, kindFilter]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.filters}>
        {agentOptions.length > 0 && (
          <div className={styles.select}>
            <Select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
              <option value="">Todos os agentes</option>
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className={styles.chips}>
          {kindsPresent.map((kind) => (
            <button
              key={kind}
              type="button"
              className={[styles.chip, kindFilter === kind && styles.active].filter(Boolean).join(' ')}
              onClick={() => setKindFilter((current) => (current === kind ? null : kind))}
            >
              {KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <ClockIcon size={22} />
          Nenhuma atividade por aqui ainda.
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map((event) => (
            <EventItem
              key={event.id}
              event={event}
              highlighted={event.id === highlightEventId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
