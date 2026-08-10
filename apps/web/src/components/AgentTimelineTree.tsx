import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  marcoExpansivel,
  montarArvore,
  ramosAbertosPorPadrao,
  type Marco,
  type RamoDeAgente,
} from '../lib/timeline-tree';
import type { SessionEvent } from '../lib/api-types';
import { AGENTS } from '../lib/agents';
import { getAgentLastSeenSeq, setAgentLastSeenSeq } from '../lib/read-state';
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
 * Quem está ATIVO abre sozinho — prioridade sobre tudo, porque quem olha
 * quer saber de quem está trabalhando. Além disso, os "5 últimos" (maior
 * `seq` de atividade) também abrem, pra sessão com muitos agentes já
 * terminados não nascer com um mural de ramos fechados; o resto nasce
 * colapsado (`ramosAbertosPorPadrao`, lib/timeline-tree.ts).
 *
 * Cada ramo colapsado que ganhou marco novo desde a última vez que foi
 * aberto mostra a contagem de NOVIDADE no cabeçalho, em vez do total — o
 * "visto" é por agente, dentro do projeto (`read-state.ts`).
 */
export function AgentTimelineTree({
  events,
  projectId,
}: {
  events: SessionEvent[];
  projectId: string;
}) {
  const { ramos } = useMemo(() => montarArvore(events), [events]);
  const abertosPadrao = useMemo(() => ramosAbertosPorPadrao(ramos), [ramos]);
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  function alternar(agente: string) {
    setFechados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(agente)) proximo.delete(agente);
      else proximo.add(agente);
      return proximo;
    });
  }

  function alternarMarco(eventId: string) {
    setExpandidos((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(eventId)) proximo.add(eventId);
      return proximo;
    });
  }

  // Ramo VISÍVEL (aberto) é ramo VISTO: quem está olhando o conteúdo não tem
  // marco "novo" escondido. Cobre tanto o clique manual quanto os que já
  // nascem abertos por padrão — sem isto o contador de novidade nunca some
  // sozinho, mesmo com o ramo aberto na tela.
  useEffect(() => {
    for (const ramo of ramos) {
      const abertoPorPadrao = abertosPadrao.has(ramo.agente);
      const aberto = abertoPorPadrao ? !fechados.has(ramo.agente) : fechados.has(ramo.agente);
      if (aberto) setAgentLastSeenSeq(projectId, ramo.agente, ramo.ultimoSeq);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ramos, abertosPadrao, fechados, projectId]);

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
        const abertoPorPadrao = abertosPadrao.has(ramo.agente);
        const aberto = abertoPorPadrao ? !fechados.has(ramo.agente) : fechados.has(ramo.agente);
        const naoVistos = aberto
          ? 0
          : ramo.marcos.filter((m) => m.seq > getAgentLastSeenSeq(projectId, ramo.agente)).length;
        return (
          <div key={ramo.agente} className={styles.ramo}>
            <button
              type="button"
              className={styles.cabecalho}
              aria-expanded={aberto}
              data-testid={`ramo-cabecalho-${ramo.agente}`}
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
              <span
                className={[styles.contagem, naoVistos > 0 && styles.contagemNova]
                  .filter(Boolean)
                  .join(' ')}
                title={naoVistos > 0 ? `${naoVistos} marco(s) novo(s) desde a última vez` : undefined}
              >
                {naoVistos > 0 ? `+${naoVistos}` : ramo.marcos.length}
              </span>
            </button>

            {aberto && (
              <ol className={styles.marcos}>
                {ramo.marcos.map((m, i) => {
                  const anterior = ramo.marcos[i - 1];
                  const novaIteracao = m.iteracao !== undefined && m.iteracao !== anterior?.iteracao;
                  const expansivel = marcoExpansivel(m);
                  const expandido = expandidos.has(m.eventId);
                  return (
                    <Fragment key={m.eventId}>
                      {novaIteracao && (
                        <li className={styles.marcoIteracao} aria-hidden="true">
                          iteração {m.iteracao}
                        </li>
                      )}
                      <li
                        className={[styles.marco, expansivel && styles.marcoComDetalhe]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {expansivel ? (
                          <button
                            type="button"
                            className={styles.marcoLinha}
                            aria-expanded={expandido}
                            aria-controls={`marco-detalhe-${m.eventId}`}
                            data-testid={`marco-cabecalho-${m.eventId}`}
                            onClick={() => alternarMarco(m.eventId)}
                          >
                            <span className={styles.marcoChevron} aria-hidden="true">
                              {expandido ? (
                                <ChevronDownIcon size={11} />
                              ) : (
                                <ChevronRightIcon size={11} />
                              )}
                            </span>
                            <span className={[styles.bolinha, styles[m.tipo]].join(' ')} />
                            <span className={styles.rotulo}>{m.rotulo}</span>
                            {m.detalhe && <span className={styles.detalhe}>{m.detalhe}</span>}
                            <span className={styles.hora}>{hora(m)}</span>
                          </button>
                        ) : (
                          <span className={styles.marcoLinhaEstatica}>
                            <span className={[styles.bolinha, styles[m.tipo]].join(' ')} />
                            <span className={styles.rotulo}>{m.rotulo}</span>
                            {m.detalhe && <span className={styles.detalhe}>{m.detalhe}</span>}
                            <span className={styles.hora}>{hora(m)}</span>
                          </span>
                        )}

                        {expansivel && expandido && (
                          <div
                            id={`marco-detalhe-${m.eventId}`}
                            role="region"
                            className={styles.marcoDetalhe}
                          >
                            {detalheExpandido(m)}
                          </div>
                        )}
                      </li>
                    </Fragment>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** O conteúdo do detalhe expandido — um por `eventType`, os únicos expansíveis. */
function detalheExpandido(m: Marco) {
  switch (m.eventType) {
    case 'tool.call': {
      const args = m.payload.args;
      return (
        <>
          <div className={styles.detalheRotulo}>argumentos</div>
          <pre className={styles.detalhePre}>{formatar(args)}</pre>
        </>
      );
    }
    case 'tool.result': {
      const ok = m.payload.ok !== false;
      const result = m.payload.result;
      return (
        <>
          <div className={styles.detalheRotulo}>{ok ? 'resultado' : 'resultado (falhou)'}</div>
          <pre className={styles.detalhePre}>{formatar(result)}</pre>
        </>
      );
    }
    case 'agent.response': {
      const content = m.payload.content;
      const error = m.payload.error;
      const iteration = m.payload.iteration;
      return (
        <>
          {typeof iteration === 'number' && (
            <div className={styles.detalheRotulo}>iteração {iteration}</div>
          )}
          {typeof content === 'string' && content.trim() !== '' && (
            <pre className={styles.detalhePre}>{content}</pre>
          )}
          {error != null && error !== '' && (
            <div className={styles.detalheErro}>erro: {formatar(error)}</div>
          )}
        </>
      );
    }
    default:
      return null;
  }
}

function formatar(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
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
