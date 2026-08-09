import { useMemo, useState } from 'react';
import type { SessionEvent } from '../lib/api-types';
import { classifyEvent, isMachineEvent, type ActivityKind } from '../lib/activity';
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
  delegation: 'Delegações',
  generic: 'Outros',
};

interface ActivityFeedProps {
  events: SessionEvent[];
  agentOptions?: { id: string; label: string }[];
  /** Evento a destacar (navegação de evidência do Psicólogo, Fase 4b). */
  highlightEventId?: string;
  /**
   * Paginação do histórico (RN-099) — OPCIONAL, e é isso que mantém o outro
   * call site (a tela de sessão) sem mudança nenhuma: sem estas props o feed
   * renderiza exatamente o que recebe, como sempre fez.
   */
  onLoadOlder?: () => void;
  hasOlder?: boolean;
  loadingOlder?: boolean;
}

export function ActivityFeed({
  events,
  agentOptions = [],
  highlightEventId,
  onLoadOlder,
  hasOlder = false,
  loadingOlder = false,
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
      // O evento CITADO por uma hipótese nunca é escondido: a evidência do
      // Psicólogo aponta com frequência pra `agent.response`/`tool.result`,
      // que são exatamente o ruído de máquina que o feed corta — e um
      // destaque invisível é uma navegação que não chega em nada.
      if (highlightEventId && event.id === highlightEventId) return true;
      // Ruído de máquina fica fora do feed — ver isMachineEvent.
      if (isMachineEvent(event)) return false;
      if (agentFilter && event.actor.id !== agentFilter) return false;
      if (kindFilter && classifyEvent(event).kind !== kindFilter) return false;
      return true;
    });
  }, [events, agentFilter, kindFilter, highlightEventId]);

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

      {/* O controle de "mais antigos" fica ACIMA da lista porque a lista é
          crescente: o passado está em cima, e um botão no rodapé pediria para
          rolar na direção contrária à que ele carrega.

          "N de M carregados" é a resposta honesta ao filtro: ele roda sobre a
          PÁGINA, não sobre a sessão, e um "12 resultados" seco afirmaria sobre
          um total que esta tela não conhece. Levar o filtro ao servidor daria
          o total verdadeiro — e mexeria no repositório de eventos, que não é
          desta fase. */}
      {onLoadOlder && (
        <div className={styles.pager}>
          <span className={styles.pagerCount}>
            {filtered.length} de {events.length} carregados
          </span>
          {hasOlder && (
            <button
              type="button"
              className={styles.pagerButton}
              onClick={onLoadOlder}
              disabled={loadingOlder}
            >
              {loadingOlder ? 'Carregando…' : 'Carregar mais antigos'}
            </button>
          )}
        </div>
      )}

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
