import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
// `conteudoDoMarco`/`detalheExpandido` são funções PURAS fora do componente
// (chamadas de dentro do render, mas não hooks) — mesmo padrão de
// `lib/agent-status.ts#descreverStatus`: `i18n.t()` direto, com `ns`
// explícito, em vez de `useTranslation` (que só vale dentro de componente).
import i18n from '../lib/i18n';
import { AvatarDoAgente } from './ui/AvatarDoAgente';
import { Disclosure } from './ui/Disclosure';
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
 *
 * O cabeçalho de cada ramo e o detalhe expandido de cada marco usam o MESMO
 * skin visual do chat do Criativo (`SessionPage.tsx`): avatar do agente
 * (`AvatarDoAgente`) e bolha de mensagem, compartilhados via
 * `../components/ui/ChatBubble.module.css`. A estrutura continua sendo
 * ÁRVORE — a decisão de "agente primeiro, tempo depois" não muda; só a
 * aparência de "isto é o que um agente disse/fez" deixou de divergir entre
 * as duas telas.
 */
export function AgentTimelineTree({
  events,
  projectId,
}: {
  events: SessionEvent[];
  projectId: string;
}) {
  const { t } = useTranslation('executors');
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
        {t('timelineTree.empty')}
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
          // A cor por agente vive na CSS var no wrapper, não no botão do
          // `Disclosure` — o mesmo padrão de `SessionPage.tsx` (agrupamento
          // de artefatos por agente): o componente compartilhado não expõe
          // `style`, e não precisa: a variável herda para dentro.
          <div
            key={ramo.agente}
            className={styles.ramo}
            style={{ ['--msg-color' as string]: corDo(ramo.agente) }}
          >
            <Disclosure
              aberto={aberto}
              onAlternar={() => alternar(ramo.agente)}
              classNameCabecalho={styles.cabecalho}
              testId={`ramo-cabecalho-${ramo.agente}`}
              titulo={
                <span className={styles.tituloRamo}>
                  <AvatarDoAgente id={ramo.agente} />
                  <span className={styles.nome}>{rotuloDo(ramo.agente)}</span>
                  <span
                    className={[styles.agora, ramo.ativo && styles.agoraAtivo]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {ramo.agora}
                  </span>
                </span>
              }
              trailing={
                <span
                  className={[styles.contagem, naoVistos > 0 && styles.contagemNova]
                    .filter(Boolean)
                    .join(' ')}
                  title={
                    naoVistos > 0
                      ? t('timelineTree.newSinceLastVisit', { count: naoVistos })
                      : undefined
                  }
                >
                  {naoVistos > 0 ? `+${naoVistos}` : ramo.marcos.length}
                </span>
              }
            >
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
                          {t('timelineTree.iteration', { n: m.iteracao })}
                        </li>
                      )}
                      <li
                        className={[styles.marco, expansivel && styles.marcoComDetalhe]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {expansivel ? (
                          // `className={styles.marcoBloco}` restaura o `gap`
                          // de 6px que antes vinha do `<li>` flex-column com
                          // DOIS filhos diretos (botão + região) — agora os
                          // dois moram dentro do wrapper do `Disclosure`, que
                          // não declara gap nenhum por padrão.
                          <Disclosure
                            className={styles.marcoBloco}
                            classNameCabecalho={styles.marcoLinha}
                            aberto={expandido}
                            onAlternar={() => alternarMarco(m.eventId)}
                            testId={`marco-cabecalho-${m.eventId}`}
                            titulo={
                              <>
                                <span className={[styles.bolinha, styles[m.tipo]].join(' ')} />
                                <span className={styles.rotulo}>{m.rotulo}</span>
                                {m.detalhe && (
                                  <span className={styles.detalhe}>{m.detalhe}</span>
                                )}
                              </>
                            }
                            trailing={<span className={styles.hora}>{hora(m)}</span>}
                          >
                            <div className={styles.marcoDetalhe}>
                              {detalheExpandido(m, ramo.agente)}
                            </div>
                          </Disclosure>
                        ) : (
                          <span className={styles.marcoLinhaEstatica}>
                            <span className={[styles.bolinha, styles[m.tipo]].join(' ')} />
                            <span className={styles.rotulo}>{m.rotulo}</span>
                            {m.detalhe && <span className={styles.detalhe}>{m.detalhe}</span>}
                            <span className={styles.hora}>{hora(m)}</span>
                          </span>
                        )}
                      </li>
                    </Fragment>
                  );
                })}
              </ol>
            </Disclosure>
          </div>
        );
      })}
    </div>
  );
}

/**
 * O detalhe expandido de um marco — um por `eventType`, os únicos
 * expansíveis (`marcoExpansivel`, lib/timeline-tree.ts).
 *
 * Porta o mesmo skin do chat do Criativo (`SessionPage.tsx`): avatar do
 * agente + corpo com cabeçalho e bolha (`.detalheMensagem`/`.detalheCorpo`/
 * `.detalheCabecalho`/`.detalheBolha`, compostas de
 * `../components/ui/ChatBubble.module.css`) — o texto cru que antes vivia
 * num `<pre>` ganha a mesma aparência de fala que o resto do produto já usa
 * para "isto é o que um agente disse". A estrutura de ÁRVORE não muda: isto
 * é só o conteúdo de UM marco já expandido, dentro do ramo do agente.
 */
function detalheExpandido(m: Marco, agente: string) {
  const conteudo = conteudoDoMarco(m);
  if (!conteudo || (!conteudo.rotulo && !conteudo.texto && !conteudo.erro)) return null;
  const { rotulo, texto, erro } = conteudo;
  return (
    <div
      className={styles.detalheMensagem}
      style={{ ['--msg-color' as string]: corDo(agente) }}
    >
      <AvatarDoAgente id={agente} />
      <div className={styles.detalheCorpo}>
        {rotulo && (
          <div className={styles.detalheCabecalho}>
            <span className={styles.detalheRotulo}>{rotulo}</span>
          </div>
        )}
        {texto && <div className={styles.detalheBolha}>{texto}</div>}
        {erro && (
          <div className={styles.detalheErro}>
            {i18n.t('timelineTree.marker.error', { ns: 'executors', error: erro })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Extrai rótulo/texto/erro do payload cru de um marco expansível. */
function conteudoDoMarco(m: Marco): { rotulo?: string; texto?: string; erro?: string } | null {
  switch (m.eventType) {
    case 'tool.call':
      return {
        rotulo: i18n.t('timelineTree.marker.args', { ns: 'executors' }),
        texto: formatar(m.payload.args),
      };
    case 'tool.result': {
      const ok = m.payload.ok !== false;
      return {
        rotulo: i18n.t(
          ok ? 'timelineTree.marker.result' : 'timelineTree.marker.resultFailed',
          { ns: 'executors' },
        ),
        texto: formatar(m.payload.result),
      };
    }
    case 'agent.response': {
      const content = m.payload.content;
      const error = m.payload.error;
      const iteration = m.payload.iteration;
      return {
        rotulo:
          typeof iteration === 'number'
            ? i18n.t('timelineTree.iteration', { ns: 'executors', n: iteration })
            : undefined,
        texto: typeof content === 'string' && content.trim() !== '' ? content : undefined,
        erro: error != null && error !== '' ? formatar(error) : undefined,
      };
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
