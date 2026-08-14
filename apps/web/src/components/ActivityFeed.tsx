import { useMemo, useState } from 'react';
import type { SessionEvent } from '../lib/api-types';
import {
  agruparPorOrigem,
  classifyEvent,
  isMachineEvent,
  origemDoEvento,
  ROTULO_DA_ORIGEM,
  type ActivityKind,
} from '../lib/activity';
import { EventItem } from './EventItem';
import { Disclosure } from './ui/Disclosure';
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

/**
 * Quantos eventos ficam ABERTOS no topo antes de o resto virar grupo (RN-177).
 *
 * Cinco é o número que o pedido trouxe, e ele só faz sentido porque a lista é
 * DECRESCENTE (RN-178): "as últimas 5" são as cinco primeiras que se lê.
 */
const RECENTES_ABERTOS = 5;

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
  // RN-177: o ruído de máquina deixa de ser invisível e passa a ser uma
  // ESCOLHA. Continua DESLIGADO por padrão — o motivo do filtro não mudou (116
  // de 193 eventos reais eram destes tipos, ver `isMachineEvent`); o que mudou
  // é que "mostrar também o log do sistema" passou a ser possível sem abrir o
  // banco.
  const [mostrarMaquina, setMostrarMaquina] = useState(false);

  // Sobre os eventos que o toggle DEIXA passar, e não sobre a página inteira:
  // com o ruído escondido, um chip "Outros" podia existir para uma categoria
  // em que nada aparecia — filtro que não filtra nada é filtro quebrado.
  const kindsPresent = useMemo(() => {
    const kinds = new Set<ActivityKind>();
    for (const event of events) {
      if (!mostrarMaquina && isMachineEvent(event)) continue;
      kinds.add(classifyEvent(event).kind);
    }
    return Array.from(kinds);
  }, [events, mostrarMaquina]);

  const filtered = useMemo(() => {
    const visiveis = events.filter((event) => {
      // O evento CITADO por uma hipótese nunca é escondido: a evidência do
      // Psicólogo aponta com frequência pra `agent.response`/`tool.result`,
      // que são exatamente o ruído de máquina que o feed corta — e um
      // destaque invisível é uma navegação que não chega em nada.
      if (highlightEventId && event.id === highlightEventId) return true;
      // Ruído de máquina fica fora do feed enquanto o toggle está desligado —
      // ver isMachineEvent e `mostrarMaquina`.
      if (!mostrarMaquina && isMachineEvent(event)) return false;
      if (agentFilter && event.actor.id !== agentFilter) return false;
      if (kindFilter && classifyEvent(event).kind !== kindFilter) return false;
      return true;
    });
    // RN-178: do último para o primeiro. O que se quer saber ao abrir um log é
    // o que ACABOU de acontecer; a lista crescente entregava o começo de uma
    // sessão que pode ter milhares de eventos. Cópia antes do `sort` porque
    // `events` é o array da query — ordená-lo no lugar mutaria o cache.
    return [...visiveis].sort((a, b) => b.seq - a.seq);
  }, [events, agentFilter, kindFilter, highlightEventId, mostrarMaquina]);

  // RN-177: as 5 mais recentes abertas, o resto recolhido POR ORIGEM. O corte
  // é sobre a lista já FILTRADA — quem liga o toggle de máquina vê cinco
  // eventos de máquina no topo se foram eles os últimos, que é a leitura
  // honesta de "as últimas 5".
  const { recentes, grupos } = useMemo(() => {
    const abertos = filtered.slice(0, RECENTES_ABERTOS);
    const antigos = filtered.slice(RECENTES_ABERTOS);
    // O evento CITADO nunca cai dentro de um grupo fechado — `Disclosure` não
    // monta o que está fechado, e o destaque viraria uma navegação que não
    // chega em nada, exatamente o que o filtro acima já protege. Sendo antigo,
    // ele é FIXADO no topo: fora da ordem cronológica de propósito, porque
    // quem chegou aqui por um chip de evidência veio ver ESTE evento.
    const destacado = highlightEventId
      ? antigos.find((e) => e.id === highlightEventId)
      : undefined;
    return {
      recentes: destacado ? [destacado, ...abertos] : abertos,
      grupos: agruparPorOrigem(
        destacado ? antigos.filter((e) => e !== destacado) : antigos,
        origemDoEvento,
      ),
    };
  }, [filtered, highlightEventId]);

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
          <button
            type="button"
            className={[styles.chip, mostrarMaquina && styles.active].filter(Boolean).join(' ')}
            aria-pressed={mostrarMaquina}
            onClick={() => setMostrarMaquina((v) => !v)}
            title="tool.call, tool.result, agent.response/delta, agent.status e context.compacted — o que o agente e o harness trocam entre si"
          >
            Eventos de máquina
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <ClockIcon size={22} />
          Nenhuma atividade por aqui ainda.
        </div>
      ) : (
        <>
          <div className={styles.list}>
            {recentes.map((event) => (
              <EventItem
                key={event.id}
                event={event}
                highlighted={event.id === highlightEventId}
              />
            ))}
          </div>
          {grupos.length > 0 && (
            <div className={styles.grupos}>
              {grupos.map(({ origem, itens }) => (
                <Disclosure
                  key={origem}
                  titulo={ROTULO_DA_ORIGEM[origem]}
                  trailing={itens.length}
                  classNameCabecalho={styles.grupoCabecalho}
                >
                  <div className={styles.list}>
                    {itens.map((event) => (
                      <EventItem
                        key={event.id}
                        event={event}
                        highlighted={event.id === highlightEventId}
                      />
                    ))}
                  </div>
                </Disclosure>
              ))}
            </div>
          )}
        </>
      )}

      {/* O controle de "mais antigos" agora fica ABAIXO da lista, e não acima:
          com a ordem decrescente (RN-178) o passado está no FIM, e um botão no
          topo pediria para rolar na direção contrária à que ele carrega — que
          era exatamente o argumento do comentário anterior, com o sinal
          trocado.

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
    </div>
  );
}
