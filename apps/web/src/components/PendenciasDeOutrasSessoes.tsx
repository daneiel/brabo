import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveAction,
  approveAlwaysAction,
  denyAction,
  getCodePullRequests,
  mensagemDaApi,
  proposeAction,
  unblockTask,
} from '../lib/api-client';
import type { CodePullRequestSummary, ProposedAction, Task } from '../lib/api-types';
import { userIdDaSessao } from '../lib/auth';
import { useBacklog } from '../lib/hooks';
import { assinaturaDoBacklog, prsProntasParaMerge, tarefasBloqueadas } from '../lib/prontas-e-bloqueadas';
import { Button } from './ui/Button';
import {
  CHAVE_DAS_PENDENCIAS_DO_PROJETO,
  TETO_DE_PENDENCIAS_NO_CHAT,
  separarPendenciasDeOutrasSessoes,
  usePendenciasDoProjeto,
} from '../lib/pendencias-do-projeto';
import { hashtagDaSessao } from '../lib/session-label';
import { formatRelativeTime } from '../lib/time';
import { useDecisoesDaPolitica } from '../lib/decisao-da-politica-queries';
import { ApprovalCard } from './ApprovalCard';
import { useRegistrarAcoesNoBloco } from '../lib/acoes-no-bloco';
import { Disclosure } from './ui/Disclosure';
import styles from './PendenciasDeOutrasSessoes.module.css';

/** Nenhum evento local: estas ações são sempre de OUTRA sessão (AT-340). */
const SEM_EVENTOS_LOCAIS: readonly never[] = [];

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
  /**
   * Mostra as filas de PR pronta e de tarefa bloqueada (RN-825/826)? Só o chat
   * da sessão as quer; a aba Executores tem a própria leitura do backlog e o
   * orçamento dela (RN-794) passa `false`.
   */
  filasDoChat?: boolean;
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
  filasDoChat = true,
}: PendenciasDeOutrasSessoesProps) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const consulta = usePendenciasDoProjeto(projectId, sessionId);
  const { aprovacoes, merges } = separarPendenciasDeOutrasSessoes(consulta.data, sessionId);
  // RN-825/826 (AT-497): as PRs prontas e as tarefas bloqueadas, pelas MESMAS
  // leituras da aba PRs (`['code-pull-requests', id, 'open']`) e do backlog
  // (`['backlog', id]`) — cache compartilhado, sem poll novo apertado (o
  // backlog no ritmo de projeto, 15 s; a lista de PRs sem poll, o canal e a
  // mudança do backlog a invalidam — RN-841).
  const prsQuery = useQuery({
    queryKey: ['code-pull-requests', projectId, 'open'],
    queryFn: () => getCodePullRequests(projectId, { state: 'open' }),
    enabled: !!projectId && filasDoChat,
  });
  const backlogQuery = useBacklog(filasDoChat ? projectId : undefined, 15_000, sessionId);
  // RN-841 (AT-510): a lista de PRs não tem poll; a PR do dev nasce na sessão
  // de EXECUÇÃO, cujo canal esta página não ouve. A tarefa que muda de status
  // ou de gate (a PR aberta, os gates aprovando) aparece na leitura de 15 s do
  // backlog que já existe — e é ela que relê a lista. Primeira leitura e
  // leitura igual não custam nada.
  const assinaturaAnterior = useRef<string | undefined>(undefined);
  const assinatura = backlogQuery.data ? assinaturaDoBacklog(backlogQuery.data) : undefined;
  useEffect(() => {
    if (assinatura === undefined) return;
    const anterior = assinaturaAnterior.current;
    assinaturaAnterior.current = assinatura;
    if (anterior !== undefined && anterior !== assinatura) {
      void queryClient.invalidateQueries({ queryKey: ['code-pull-requests', projectId] });
      // RN-847 (AT-518): o resumo do contexto lê os arquivos das mesmas PRs.
      void queryClient.invalidateQueries({ queryKey: ['session-context-summary', projectId] });
    }
  }, [assinatura, projectId, queryClient]);
  const [propostas, setPropostas] = useState<Record<string, ProposedAction>>({});
  const [propondo, setPropondo] = useState<string | null>(null);
  const [erroDoMerge, setErroDoMerge] = useState<Record<string, string>>({});
  const [desbloqueio, setDesbloqueio] = useState<
    Record<string, { tom: 'ok' | 'erro'; texto: string } | 'enviando'>
  >({});
  const prontas = prsProntasParaMerge(
    prsQuery.data?.items,
    backlogQuery.data,
    consulta.data,
    sessionId,
  );
  const bloqueadas = tarefasBloqueadas(backlogQuery.data);
  const total = aprovacoes.length + merges.length;

  // Recorte declarado (RN-180): o teto vale para as DUAS filas juntas em
  // desenho, mas cada fila diz o seu próprio total no cabeçalho.
  const aprovacoesVisiveis = aprovacoes.slice(0, TETO_DE_PENDENCIAS_NO_CHAT);
  const mergesVisiveis = merges.slice(
    0,
    TETO_DE_PENDENCIAS_NO_CHAT - aprovacoesVisiveis.length,
  );
  const cortadas = total - aprovacoesVisiveis.length - mergesVisiveis.length;
  const desenhadas = total - cortadas;

  // AT-340 (RN-656): o motivo da política de CADA card desenhado, lido pela
  // ação (`?actionId=`) na sessão que a própria ação carrega — a MESMA leitura
  // e o MESMO cache (`staleTime: Infinity`) da aba Aprovações, então a ação
  // que uma das duas telas já leu não custa nada à outra. Nenhuma destas ações
  // é da sessão aberta (é o que as separa), então o log da tela não cobre
  // nenhuma: `[]` e não `null`, que esperaria por um log que não vem. Só os
  // cards DESENHADOS pedem — o recorte segura o número de leituras no teto.
  const { decisoes, falhas } = useDecisoesDaPolitica(
    projectId,
    [...aprovacoesVisiveis, ...mergesVisiveis],
    SEM_EVENTOS_LOCAIS,
  );

  if (total === 0 && prontas.length === 0 && bloqueadas.length === 0) return null;

  async function proporMerge(pr: CodePullRequestSummary) {
    setPropondo(pr.id);
    setErroDoMerge((e) => ({ ...e, [pr.id]: '' }));
    try {
      const acao = await proposeAction(projectId, sessionId, {
        actionType: 'git_merge',
        actor: { kind: 'user', id: userIdDaSessao() ?? 'usuário' },
        payload: {
          pullRequestId: pr.id,
          sourceBranch: pr.sourceBranch,
          targetBranch: pr.targetBranch,
          title: pr.title,
        },
      });
      setPropostas((p) => ({ ...p, [pr.id]: acao }));
      invalidar(acao);
    } catch (erro) {
      setErroDoMerge((e) => ({ ...e, [pr.id]: mensagemDaApi(erro) }));
    } finally {
      setPropondo(null);
    }
  }

  async function desbloquear(task: Task) {
    setDesbloqueio((d) => ({ ...d, [task.id]: 'enviando' }));
    try {
      await unblockTask(projectId, sessionId, task.id);
      setDesbloqueio((d) => ({ ...d, [task.id]: { tom: 'ok', texto: t('pendencias.bloqueadas.ok') } }));
      void queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
    } catch (erro) {
      setDesbloqueio((d) => ({
        ...d,
        [task.id]: { tom: 'erro', texto: mensagemDaApi(erro, t('pendencias.bloqueadas.erro')) },
      }));
    }
  }

  function cardDeDecisao(acao: ProposedAction) {
    return (
      <ApprovalCard
        key={acao.id}
        action={acao}
        detalheRecolhido
        decisaoDaPolitica={decisoes.get(acao.id)}
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
    );
  }

  function invalidar(acao: ProposedAction) {
    void queryClient.invalidateQueries({
      queryKey: CHAVE_DAS_PENDENCIAS_DO_PROJETO(projectId),
    });
    void queryClient.invalidateQueries({
      queryKey: ['session-actions', projectId, acao.sessionId],
    });
    void queryClient.invalidateQueries({ queryKey: ['code-pull-requests', projectId] });
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
                // Carregando ou com a leitura falha, `undefined`: o card cala,
                // e a falha é dita UMA vez no topo (RN-180).
                decisaoDaPolitica={decisoes.get(acao.id)}
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
  const contagens = {
    aprovacoes: aprovacoes.length,
    merges: merges.length,
    prontas: prontas.length,
    bloqueadas: bloqueadas.length,
  };
  const presenca = (['aprovacoes', 'merges', 'prontas', 'bloqueadas'] as const)
    .map((chave) => ({ chave, n: contagens[chave] }))
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
        {falhas > 0 && (
          <p className={styles.nota} data-testid="motivo-nao-lido">
            {t(
              falhas === desenhadas
                ? 'pendencias.motivoNaoLido.todas'
                : 'pendencias.motivoNaoLido.algumas',
              { count: falhas, total: desenhadas },
            )}
          </p>
        )}
        <div className={styles.lista}>
          {fila('aprovacoes', aprovacoes, aprovacoesVisiveis)}
          {fila('merges', merges, mergesVisiveis)}
          {prontas.length > 0 && (
            <section
              className={styles.fila}
              aria-label={t('pendencias.filas.prontas')}
              data-testid="fila-prs-prontas"
            >
              <h4 className={styles.filaTitulo}>
                {t('pendencias.filas.prontas')}
                <span className={styles.contagem}>{prontas.length}</span>
              </h4>
              {prontas.map(({ pr, mergeDaSessao }) => {
                // RN-822: a proposta que ESTE clique criou aparece na hora; a
                // fila do projeto, quando volta, diz se ela segue pendente.
                const acao = mergeDaSessao ?? propostas[pr.id];
                return (
                  <div key={pr.id} className={styles.grupo} data-testid="pr-pronta">
                    <div className={styles.origem}>
                      #{pr.number} {pr.title} · {pr.sourceBranch} → {pr.targetBranch}
                    </div>
                    {acao && acao.status === 'pending' ? (
                      <>
                        {/* RN-843: registra só enquanto o cartão está MONTADO
                            (o Disclosure recolhido desmonta e desregistra). */}
                        <RegistroDoBloco ids={[acao.id]} />
                        {cardDeDecisao(acao)}
                      </>
                    ) : (
                      <div className={styles.acoesDaLinha}>
                        <Button
                          variant="primary"
                          disabled={!podeDecidir}
                          loading={propondo === pr.id}
                          onClick={() => void proporMerge(pr)}
                        >
                          {t('mergearNoChat.botao')}
                        </Button>
                        <span className={styles.nota}>
                          {podeDecidir ? t('mergearNoChat.nota') : t('mergearNoChat.semPapel')}
                        </span>
                      </div>
                    )}
                    {erroDoMerge[pr.id] && (
                      <p className={styles.erro} role="alert">
                        {t('mergearNoChat.erroTitulo')}: {erroDoMerge[pr.id]}
                      </p>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {bloqueadas.length > 0 && (
            <section
              className={styles.fila}
              aria-label={t('pendencias.filas.bloqueadas')}
              data-testid="fila-tarefas-bloqueadas"
            >
              <h4 className={styles.filaTitulo}>
                {t('pendencias.filas.bloqueadas')}
                <span className={styles.contagem}>{bloqueadas.length}</span>
              </h4>
              {bloqueadas.map((task) => {
                const estado = desbloqueio[task.id];
                return (
                  <div key={task.id} className={styles.grupo} data-testid="tarefa-bloqueada">
                    <div className={styles.origem}>{task.title}</div>
                    <p className={styles.nota}>
                      {task.blockedReason ?? t('pendencias.bloqueadas.semMotivo')}
                    </p>
                    <div className={styles.acoesDaLinha}>
                      <Button
                        variant="secondary"
                        disabled={!podeDecidir}
                        loading={estado === 'enviando'}
                        onClick={() => void desbloquear(task)}
                      >
                        {t('pendencias.bloqueadas.botao')}
                      </Button>
                      {!podeDecidir && (
                        <span className={styles.nota}>{t('pendencias.bloqueadas.semPapel')}</span>
                      )}
                    </div>
                    {estado && estado !== 'enviando' && (
                      <p
                        className={estado.tom === 'erro' ? styles.erro : styles.nota}
                        role={estado.tom === 'erro' ? 'alert' : 'status'}
                        data-testid="retorno-desbloqueio"
                      >
                        {estado.texto}
                      </p>
                    )}
                  </div>
                );
              })}
            </section>
          )}
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

/** RN-843 (AT-512): o cartão montado na linha da PR se registra para o fio. */
function RegistroDoBloco({ ids }: { ids: readonly string[] }) {
  useRegistrarAcoesNoBloco(ids);
  return null;
}
