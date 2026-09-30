import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AGENTS } from '../lib/agents';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Disclosure } from '../components/ui/Disclosure';
import { ModelIcon, UserIcon } from '../components/ui/icons';
import { FIO_RECENTES_ABERTAS, type dividirFio } from './session-fio';
import styles from './SessionPage.module.css';

/**
 * O conteúdo do fio da Sessão, dentro da área que rola: o convite da sessão
 * que ainda não começou (RN-097/RN-104), o histórico recolhido e as
 * entradas recentes (RN-177/RN-644), a mensagem otimista do usuário e a bolha do chat
 * consultivo em streaming (RN-131/RN-156). A sentinela do fim do fio e os refs
 * da rolagem ficam no `SessionPage`, que é quem rola.
 *
 * Moveu de `SessionPage.tsx` no PR 4 do programa do ADR 0176, sem mudar uma
 * linha do JSX: os valores chegam com os MESMOS nomes que o bloco lia do
 * escopo do `SessionPage`, e nenhum estado mudou de dono.
 */
export interface SessionFioProps {
  conviteVisivel: boolean;
  sessaoCriativa: boolean;
  criativoActive: boolean;
  isActive: boolean;
  handleStartIdeation: () => Promise<void>;
  setDraft: Dispatch<SetStateAction<string>>;
  fio: ReturnType<typeof dividirFio>;
  optimisticUser: string | null;
  user: { name: string | null };
  turnoViaCanal: boolean;
  streamingText: string;
  pensandoVisivel: boolean;
  streaming: boolean;
  statusAgent: string | null;
  agenteExibido: (typeof AGENTS)[keyof typeof AGENTS] | undefined;
}

export function SessionFio({
  conviteVisivel,
  sessaoCriativa,
  criativoActive,
  isActive,
  handleStartIdeation,
  setDraft,
  fio,
  optimisticUser,
  user,
  turnoViaCanal,
  streamingText,
  pensandoVisivel,
  streaming,
  statusAgent,
  agenteExibido,
}: SessionFioProps) {
  const { t } = useTranslation('sessionPage');
  return (
    <>
      {/* O Criativo é ativado e NÃO fala primeiro: ele espera a sua
          mensagem. Sem isto a tela ficava em branco depois de "Iniciar
          ideação", e quem chega não tem como saber que a vez é dele.
          Convite em vez de turno automático: informa sem gastar token. */}
      {/* O convite fala do tipo que a sessão É (RN-097). Ele era um só,
          e prometia o Criativo em toda sessão — inclusive nas que
          nunca o teriam. */}
      {conviteVisivel && (
        sessaoCriativa ? (
          <Card padding="lg" className={styles.convite}>
            <h2 className={styles.conviteTitulo}>{t('convite.criativa.titulo')}</h2>
            <p className={styles.conviteTexto}>
              <Trans
                i18nKey="convite.criativa.texto"
                ns="sessionPage"
                components={{ b: <strong /> }}
              />
            </p>
            {/* A AÇÃO, e não uma seta apontando para ela (FASE 24).
                Ativar o Criativo continua sendo um clique explícito:
                é a partir dele que a chave do owner passa a ser
                gasta (RN-058), e ninguém entra na sessão sozinho. */}
            {!criativoActive && (
              <div className={styles.conviteAcao}>
                <Button onClick={handleStartIdeation} disabled={!isActive}>
                  {t('convite.criativa.iniciarIdeacao')}
                </Button>
                <span className={styles.conviteAcaoNota}>
                  {t('convite.criativa.iniciarIdeacaoNota')}
                </span>
              </div>
            )}
            <p className={styles.conviteTexto}>
              {t('convite.criativa.exemploIntro')}
            </p>
            <button
              type="button"
              className={styles.conviteExemplo}
              onClick={() =>
                setDraft(t('convite.criativa.exemplo'))
              }
            >
              “{t('convite.criativa.exemplo')}”
            </button>
            <p className={styles.conviteRodape}>
              <Trans
                i18nKey="convite.criativa.rodape"
                ns="sessionPage"
                components={{ b: <strong /> }}
              />
            </p>
          </Card>
        ) : (
          <Card padding="lg" className={styles.convite}>
            <h2 className={styles.conviteTitulo}>{t('convite.consultiva.titulo')}</h2>
            <p className={styles.conviteTexto}>
              <Trans
                i18nKey="convite.consultiva.texto"
                ns="sessionPage"
                components={{ b: <strong /> }}
              />
            </p>
            <p className={styles.conviteRodape}>
              <Trans
                i18nKey="convite.consultiva.rodape"
                ns="sessionPage"
                components={{ b: <strong /> }}
              />
            </p>
          </Card>
        )
      )}

      {/* RN-177/RN-644 — o histórico recolhido, no topo do fio, porque o
          fio é crescente. Nasce FECHADO: a conversa que importa é a
          recente. É UM bloco na ordem em que as coisas aconteceram (nunca
          grupos por origem, que punham a resposta acima da pergunta), e o
          cabeçalho DECLARA o recorte (RN-180): o que o corte conta (as
          últimas N mensagens) e o que ficou dentro, mensagens e o resto
          separados. */}
      {fio.historico && (
        <div className={styles.fioHistorico}>
          <Disclosure
            titulo={t('fio.historico.titulo', { count: FIO_RECENTES_ABERTAS })}
            trailing={
              fio.historico.outras > 0
                ? t('fio.historico.conteudoComOutras', {
                    mensagens: t('artefatos.mensagensCount', {
                      count: fio.historico.mensagens,
                    }),
                    outras: t('fio.historico.outrasCount', {
                      count: fio.historico.outras,
                    }),
                  })
                : t('artefatos.mensagensCount', { count: fio.historico.mensagens })
            }
            classNameCabecalho={styles.fioHistoricoCabecalho}
          >
            <div className={styles.fioHistoricoRegiao}>
              {fio.historico.itens.map((entry) => (
                <div key={entry.key}>{entry.node}</div>
              ))}
            </div>
          </Disclosure>
        </div>
      )}

      {fio.recentes.map((entry) => (
        <div key={entry.key}>{entry.node}</div>
      ))}

      {optimisticUser && (
        <div
          className={styles.message}
          style={{ ['--msg-color' as string]: 'var(--accent)' } as CSSProperties}
        >
          <span className={[styles.avatar, styles.user].join(' ')}>
            <UserIcon size={15} />
          </span>
          <div className={styles.messageBody}>
            <div className={styles.messageHeader}>
              <span className={styles.messageName}>{user.name ?? t('compartilhado.voce')}</span>
            </div>
            <div className={styles.bubble}>{optimisticUser}</div>
          </div>
        </div>
      )}

      {/* `statusAgent` cobre o intervalo entre o `agent.status`
          "working" (achado B) e o primeiro delta — sem ele, aceitar
          um handoff cujo kickoff é assíncrono no engine não mostrava
          nada até o agente terminar de pensar. Reaproveita o MESMO
          indicador do streaming por delta; `agenteExibido` escolhe a
          fonte mais recente entre os dois.

          RN-131: a bolha só aparece SEM texto depois de 5s
          (`pensandoVisivel`, armado pelo efeito acima) — texto de
          verdade (`streamingText`) sempre aparece na hora, nunca
          espera o timer. É por isso que a condição é "tem texto OU
          já passou o prazo", nunca só "tem texto".

          `!turnoViaCanal`: esta bolha ficou EXCLUSIVA do chat
          consultivo sem agente ativo (SSE, `streamChatMessage`) — um
          turno de agente conversacional narra pela faixa de
          atividade (`TurnActivityStrip`, logo abaixo do fio), nunca
          pelos dois ao mesmo tempo. */}
      {!turnoViaCanal && (streamingText || (pensandoVisivel && (streaming || statusAgent))) && (
        <div
          className={styles.message}
          style={
            {
              ['--msg-color' as string]:
                agenteExibido?.color ?? 'var(--accent)',
            } as CSSProperties
          }
        >
          <span className={styles.avatar}>
            {agenteExibido ? <agenteExibido.icon size={15} /> : <ModelIcon size={15} />}
          </span>
          <div className={styles.messageBody}>
            <div className={styles.messageHeader}>
              {/*
                Quem fala é o AGENTE (achado C). O modelo é detalhe de
                execução e aparecia aqui como se fosse o interlocutor —
                depois trocava para o agente quando o evento persistido
                chegava, o que também mudava o nome na cara do usuário.
                Sem o agente no delta, degrada para "agente" genérico,
                nunca para o nome do modelo.

                RN-156: "Reunindo informações..." só antes de haver
                texto — é o que deixa explícito que o silêncio é
                trabalho em curso, não ausência de resposta (achado
                B). Frase fixa, sem o nome do agente interpolado: o
                nome já aparece no cabeçalho assim que o streaming
                real começa, e repeti-lo aqui não ajudava a leitura.
              */}
              <span className={styles.messageName}>
                {streamingText
                  ? (agenteExibido?.name ?? t('compartilhado.agenteGenerico'))
                  : t('mensagens.reunindoInformacoes')}
              </span>
            </div>
            {streamingText ? (
              <div className={styles.bubble}>{streamingText}</div>
            ) : (
              <div className={styles.typing}>
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
