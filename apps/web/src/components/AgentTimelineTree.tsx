import { useState } from 'react';
import { montarArvore, type Marco, type RamoDeAgente } from '../lib/timeline-tree';
import type { SessionEvent } from '../lib/api-types';
import { AGENTS } from '../lib/agents';
import { ChevronDownIcon, ChevronRightIcon } from './ui/icons';
import styles from './AgentTimelineTree.module.css';

/**
 * A linha do tempo do time, em árvore.
 *
 * O feed cronológico responde "o que aconteceu"; não responde "o que cada
 * agente está fazendo AGORA". Com quatro agentes falando numa coluna só, a
 * resposta existia no log e não existia na tela. Aqui o eixo é o agente, e o
 * presente de cada um fica na primeira linha do ramo.
 *
 * Ramos ATIVOS abrem sozinhos; os que já terminaram nascem fechados — o
 * histórico está a um clique, e quem olha quer saber de quem está trabalhando.
 */
export function AgentTimelineTree({ events }: { events: SessionEvent[] }) {
  const { ramos } = montarArvore(events);
  const [fechados, setFechados] = useState<Set<string>>(new Set());

  function alternar(agente: string) {
    setFechados((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(agente)) proximo.add(agente);
      return proximo;
    });
  }

  if (ramos.length === 0) {
    return (
      <div className={styles.vazio}>
        Nenhum agente entrou em ação nesta sessão ainda.
      </div>
    );
  }

  return (
    <div className={styles.arvore}>
      {ramos.map((ramo) => {
        // Ativo aberto, parado fechado — salvo decisão explícita de quem olha.
        const aberto = ramo.ativo ? !fechados.has(ramo.agente) : fechados.has(ramo.agente);
        return (
          <div key={ramo.agente} className={styles.ramo}>
            <button
              type="button"
              className={styles.cabecalho}
              aria-expanded={aberto}
              onClick={() => alternar(ramo.agente)}
            >
              <span className={styles.chevron}>
                {aberto ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
              </span>
              <span
                className={styles.pino}
                style={{ ['--cor-agente' as string]: corDo(ramo.agente) }}
                aria-hidden="true"
              />
              <span className={styles.nome}>{rotuloDo(ramo.agente)}</span>
              <span
                className={[styles.agora, ramo.ativo && styles.agoraAtivo]
                  .filter(Boolean)
                  .join(' ')}
              >
                {ramo.agora}
              </span>
              <span className={styles.contagem}>{ramo.marcos.length}</span>
            </button>

            {aberto && (
              <ol className={styles.marcos}>
                {ramo.marcos.map((m) => (
                  <li key={m.eventId} className={styles.marco}>
                    <span className={[styles.bolinha, styles[m.tipo]].join(' ')} />
                    <span className={styles.rotulo}>{m.rotulo}</span>
                    {m.detalhe && <span className={styles.detalhe}>{m.detalhe}</span>}
                    <span className={styles.hora}>{hora(m)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}

function rotuloDo(agente: string): string {
  return AGENTS[agente as keyof typeof AGENTS]?.name ?? agente;
}

function corDo(agente: string): string {
  return AGENTS[agente as keyof typeof AGENTS]?.color ?? 'var(--text-muted)';
}

function hora(m: Marco): string {
  return new Date(m.em).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export type { RamoDeAgente };
