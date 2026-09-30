import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { approveAction, approveAlwaysAction, denyAction } from '../lib/api-client';
import type { ProposedAction } from '../lib/api-types';
import {
  CHAVE_DAS_PENDENCIAS_DO_PROJETO,
  TETO_DE_PENDENCIAS_NO_CHAT,
  separarPendenciasDeOutrasSessoes,
  usePendenciasDoProjeto,
} from '../lib/pendencias-do-projeto';
import { hashtagDaSessao } from '../lib/session-label';
import { formatRelativeTime } from '../lib/time';
import { ApprovalCard } from './ApprovalCard';
import { Disclosure } from './ui/Disclosure';
import styles from './PendenciasDeOutrasSessoes.module.css';

interface PendenciasDeOutrasSessoesProps {
  projectId: string;
  /** A sessão em que o dono está: as ações dela o fio já desenha. */
  sessionId: string;
  /**
   * O papel alcança o mínimo do ENDPOINT de decisão (`developer`, RN-102)?
   * Quem não alcança VÊ a pendência e o controle fica inerte com o motivo em
   * texto — o que se tira é o controle, nunca a informação (ADR 0064).
   */
  podeDecidir: boolean;
}

/**
 * As pendências que os agentes propuseram em OUTRAS sessões do mesmo projeto
 * (tipicamente a de execução), decididas aqui, onde o dono está — AT-265,
 * RN-626.
 *
 * É ATALHO e nunca substituto (RN-467): renderiza o MESMO `ApprovalCard` e
 * chama os MESMOS endpoints, com o `sessionId` que a PRÓPRIA ação carrega. As
 * duas filas (aprovações e merges de PR) ficam com título e contagem
 * separados, nunca somadas. Nenhum teto muda: `git_merge` em branch protegida
 * segue `require_approval` incondicional (RN-418) — o clique é do humano —, e
 * `onActivateAutoMode` é omitido de propósito (ligar o modo automático é mudar
 * política, não decidir a ação que está na frente).
 */
export function PendenciasDeOutrasSessoes({
  projectId,
  sessionId,
  podeDecidir,
}: PendenciasDeOutrasSessoesProps) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const consulta = usePendenciasDoProjeto(projectId, sessionId);
  const { aprovacoes, merges } = separarPendenciasDeOutrasSessoes(consulta.data, sessionId);
  const total = aprovacoes.length + merges.length;
  if (total === 0) return null;

  function invalidar(acao: ProposedAction) {
    void queryClient.invalidateQueries({
      queryKey: CHAVE_DAS_PENDENCIAS_DO_PROJETO(projectId),
    });
    void queryClient.invalidateQueries({
      queryKey: ['session-actions', projectId, acao.sessionId],
    });
  }
  // Devolvem a promessa: o card segura os botões e diz a frase da api (AT-256),
  // e a lista se refaz MESMO na recusa.
  async function decidir(acao: ProposedAction, chamada: () => Promise<unknown>) {
    try {
      await chamada();
    } finally {
      invalidar(acao);
    }
  }

  // Recorte declarado (RN-180): o teto vale para as DUAS filas juntas em
  // desenho, mas cada fila diz o seu próprio total no cabeçalho.
  let restante = TETO_DE_PENDENCIAS_NO_CHAT;
  const desenhadas = (fila: ProposedAction[]) => {
    const visiveis = fila.slice(0, restante);
    restante -= visiveis.length;
    return visiveis;
  };
  const aprovacoesVisiveis = desenhadas(aprovacoes);
  const mergesVisiveis = desenhadas(merges);
  const cortadas = total - aprovacoesVisiveis.length - mergesVisiveis.length;

  // AT-318: o rótulo de origem sai UMA vez por sessão, não por card — com
  // três cards da mesma sessão ele se repetia entre um card e o seguinte e
  // parecia dizer respeito aos dois. A lista já vem na ordem da espera mais
  // longa; o grupo herda a ordem da primeira ação dele, e o tempo do rótulo é
  // o da mais antiga (é a espera que importa).
  const porSessao = (visiveis: ProposedAction[]) => {
    const grupos = new Map<string, ProposedAction[]>();
    for (const acao of visiveis) {
      const grupo = grupos.get(acao.sessionId);
      if (grupo) grupo.push(acao);
      else grupos.set(acao.sessionId, [acao]);
    }
    return [...grupos.entries()];
  };

  const fila = (
    chave: 'aprovacoes' | 'merges',
    lista: ProposedAction[],
    visiveis: ProposedAction[],
  ) =>
    lista.length === 0 ? null : (
      <section className={styles.fila} aria-label={t(`pendencias.filas.${chave}`)}>
        <h4 className={styles.filaTitulo}>
          {t(`pendencias.filas.${chave}`)}
          {/* A contagem é DESTA fila e só dela. */}
          <span className={styles.contagem}>{lista.length}</span>
        </h4>
        {porSessao(visiveis).map(([origem, acoes]) => (
          <div key={origem} className={styles.grupo}>
            <div className={styles.origem}>
              {t('pendencias.origem', {
                count: acoes.length,
                hashtag: hashtagDaSessao(origem),
                tempo: formatRelativeTime(acoes[0]!.createdAt),
              })}
            </div>
            {acoes.map((acao) => (
              <ApprovalCard
                key={acao.id}
                action={acao}
                // AT-318: detalhe fechado — empilhados, os detalhes abertos
                // deixavam um card à vista de três.
                detalheRecolhido
                bloqueio={podeDecidir ? undefined : t('pendencias.semPapel')}
                onApprove={() => decidir(acao, () => approveAction(projectId, acao.sessionId, acao.id))}
                onDeny={() => decidir(acao, () => denyAction(projectId, acao.sessionId, acao.id))}
                onAlwaysAllow={() =>
                  decidir(acao, async () => {
                    await approveAlwaysAction(projectId, acao.sessionId, acao.id);
                    void queryClient.invalidateQueries({ queryKey: ['permissions', projectId] });
                  })
                }
              />
            ))}
          </div>
        ))}
      </section>
    );

  // Presença POR FILA no cabeçalho, visível com o bloco recolhido — cada fila
  // com o próprio número, nunca uma soma (RN-467).
  const presenca = (['aprovacoes', 'merges'] as const)
    .map((chave) => ({ chave, n: chave === 'aprovacoes' ? aprovacoes.length : merges.length }))
    .filter(({ n }) => n > 0)
    .map(({ chave, n }) => `${t(`pendencias.filas.${chave}`)} ${n}`)
    .join(' · ');

  return (
    <div className={styles.wrapper} data-testid="pendencias-de-outras-sessoes">
      <Disclosure
        titulo={t('pendencias.titulo')}
        trailing={<span className={styles.presenca}>{presenca}</span>}
        padraoAberto
        className={styles.disclosure}
        classNameCabecalho={styles.cabecalho}
      >
        <p className={styles.nota}>{t('pendencias.nota')}</p>
        <div className={styles.lista}>
          {fila('aprovacoes', aprovacoes, aprovacoesVisiveis)}
          {fila('merges', merges, mergesVisiveis)}
          {cortadas > 0 && (
            <p className={styles.recorte}>
              {t('pendencias.recorte', { mostradas: total - cortadas, total })}
            </p>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
