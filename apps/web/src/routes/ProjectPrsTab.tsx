import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveAction,
  approveAlwaysAction,
  denyAction,
  getProjectPendingActions,
  mensagemDaApi,
  proposeAction,
} from '../lib/api-client';
import { useBacklog, useLatestSession, useProjectPendingActions } from '../lib/hooks';
import { userIdDaSessao } from '../lib/auth';
import { gatePendenteNoMerge } from '../lib/gate-do-merge';
import type { CodePullRequestSummary, Epic, ProposedAction, Task } from '../lib/api-types';
import { ApprovalCard } from '../components/ApprovalCard';
import { PrGateTimeline } from '../components/PrGateTimeline';
import { Skeleton } from '../components/ui/Skeleton';
import { Button } from '../components/ui/Button';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { useToast } from '../components/ui/ToastProvider';
import { PrListAndDiff } from './code/PrListAndDiff';
import styles from './ProjectPrsTab.module.css';

const PREFIXO_BRANCH_DE_TASK = 'feature/task-';

/**
 * A task de dev agent que produziu a branch desta PR, se houver — mesmo
 * esquema de nome que RN-152 já usa (`feature/task-XXXXXXXX`, os 8
 * primeiros chars do id da task, `Engine.Dev.AgentIo`). `undefined` quando a
 * PR não veio de um dev agent (infra, aberta a mão, outro provider) — sem
 * gate nenhum a mostrar, e o Merge não fica bloqueado por falta de dado.
 */
function taskDaBranch(epics: Epic[] | undefined, sourceBranch: string): Task | undefined {
  if (!sourceBranch.startsWith(PREFIXO_BRANCH_DE_TASK)) return undefined;
  const prefixo = sourceBranch.slice(PREFIXO_BRANCH_DE_TASK.length);
  if (!prefixo) return undefined;
  for (const epic of epics ?? []) {
    for (const story of epic.stories) {
      const task = story.tasks.find((t) => t.id.startsWith(prefixo));
      if (task) return task;
    }
  }
  return undefined;
}

/** A `proposed_action` de `git_merge` pendente para ESTE pr, se alguém já
 *  clicou "Merge" antes — cruzamento project-wide (`useProjectPendingActions`),
 *  não escopado a nenhuma sessão específica. */
function acaoDeMergeParaPr(
  acoes: ProposedAction[] | undefined,
  pr: CodePullRequestSummary,
): ProposedAction | undefined {
  return (acoes ?? []).find((a) => {
    const payload = a.payload as { pullRequestId?: unknown };
    return String(payload.pullRequestId ?? '') === pr.id;
  });
}

/**
 * A última recusa de execução de merge DESTA PR (RN-705) — o conflito de merge
 * do provider local, por exemplo. Lida da fila de ações FALHAS do projeto
 * (`status=failed`), a mais recente por `updatedAt`. A recusa só vale enquanto
 * não houver merge pendente: a nova tentativa toma o lugar dela.
 */
export function ultimaRecusaDeMerge(
  falhas: ProposedAction[] | undefined,
  pr: CodePullRequestSummary,
): { motivo: string; arquivos: string[] } | undefined {
  const daPr = (falhas ?? [])
    .filter((a) => String((a.payload as { pullRequestId?: unknown }).pullRequestId ?? '') === pr.id)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const ultima = daPr[0];
  if (!ultima) return undefined;
  const r = (ultima.executionResult ?? {}) as { error?: unknown; conflictingFiles?: unknown };
  return {
    motivo: typeof r.error === 'string' ? r.error : '',
    arquivos: Array.isArray(r.conflictingFiles)
      ? r.conflictingFiles.filter((f): f is string => typeof f === 'string')
      : [],
  };
}

/**
 * Aba `prs` — PRs do projeto INTEIRO, direto do provider de git (Onda 2 do
 * programa de abas agrupadas).
 *
 * Resolve o bug de raiz de `ProjectApprovalsTab.tsx` (seção "PRs em
 * revisão", escopada a `usePendingActions(projectId, latestSession?.id)` —
 * só a sessão mais recente): a listagem aqui vem de
 * `GET /projects/:id/code/pull-requests`, que é por PROJETO e nunca olha
 * sessão nenhuma — uma PR proposta há três sessões continua aparecendo. O
 * cruzamento com a `proposed_action` de `git_merge` (pra achar o card de
 * decisão) também é project-wide (`useProjectPendingActions`), pelo MESMO
 * motivo — e a decisão (aprovar/negar/sempre permitir) usa o `sessionId` que
 * a própria ação carrega, nunca `latestSession`, porque a ação pode ter
 * nascido numa sessão diferente da atual.
 *
 * `ProjectApprovalsTab` continua existindo como está: ela é o lugar de
 * decisão para o que NÃO é PR (promoção de história, `instruction_patch`,
 * paralelismo). Esta aba é listagem + gestão de PR, project-wide.
 */
export function ProjectPrsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('approvals');
  const { latest: latestSession } = useLatestSession(projectId);
  const backlogQuery = useBacklog(projectId);
  const mergeActionsQuery = useProjectPendingActions(projectId, 'git_merge');
  // RN-705: as recusas de merge (sob o MESMO prefixo da fila do projeto, então
  // o aviso do canal que invalida a fila alcança esta leitura também).
  const mergesFalhosQuery = useQuery({
    queryKey: ['project-pending-actions', projectId, 'git_merge', 'failed'],
    queryFn: () => getProjectPendingActions(projectId, { actionType: 'git_merge', status: 'failed' }),
  });
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [propondo, setPropondo] = useState<string | null>(null);
  // RN-822 (AT-493): a ação que ESTE clique acabou de criar, por id da PR, com
  // o instante em que a api a devolveu. O cartão aparece com ela na hora, sem
  // depender de a fila do projeto voltar — antes o 1º clique terminava com o
  // botão de volta e nenhum cartão até o refetch, e lia-se "não pegou". Vale
  // só enquanto a fila não tem leitura MAIS NOVA que a proposta: aí quem diz
  // se ela segue pendente é a fila.
  const [propostas, setPropostas] = useState<Record<string, { acao: ProposedAction; em: number }>>({});

  function acaoDaPr(pr: CodePullRequestSummary): ProposedAction | undefined {
    const daFila = acaoDeMergeParaPr(mergeActionsQuery.data, pr);
    if (daFila) return daFila;
    const local = propostas[pr.id];
    if (!local) return undefined;
    return (mergeActionsQuery.dataUpdatedAt ?? 0) > local.em ? undefined : local.acao;
  }

  function esquecerProposta(acao: ProposedAction) {
    setPropostas((atual) => {
      const resto = { ...atual };
      for (const [id, p] of Object.entries(atual)) if (p.acao.id === acao.id) delete resto[id];
      return resto;
    });
  }

  function invalidateMergeActions() {
    // Por prefixo do PROJETO: alcança a fila pendente, a das recusas
    // (RN-705) E a fila inteira que a sidebar conta (RN-729) — só com o
    // prefixo de `git_merge`, o contador "PRs" da sidebar seguia mostrando o
    // merge já executado até o próximo poll de projeto.
    queryClient.invalidateQueries({
      queryKey: ['project-pending-actions', projectId],
    });
    // O merge aprovado executa na hora: a lista de PRs muda (a PR sai de
    // "Abertas") — sem isto ela seguia aberta com o botão até recarregar.
    queryClient.invalidateQueries({ queryKey: ['code-pull-requests', projectId] });
    queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
  }

  async function proporMerge(pr: CodePullRequestSummary) {
    if (!latestSession) return;
    setPropondo(pr.id);
    try {
      const acao = await proposeAction(projectId, latestSession.id, {
        actionType: 'git_merge',
        actor: { kind: 'user', id: userIdDaSessao() ?? 'usuário' },
        payload: {
          pullRequestId: pr.id,
          sourceBranch: pr.sourceBranch,
          targetBranch: pr.targetBranch,
          title: pr.title,
        },
      });
      setPropostas((atual) => ({ ...atual, [pr.id]: { acao, em: Date.now() } }));
      invalidateMergeActions();
    } catch (erro) {
      showToast({
        title: t('prsTab.mergeErrorTitle'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setPropondo(null);
    }
  }

  async function aprovar(acao: ProposedAction) {
    try {
      await approveAction(projectId, acao.sessionId, acao.id);
    } finally {
      esquecerProposta(acao);
      invalidateMergeActions();
    }
  }
  async function negar(acao: ProposedAction) {
    try {
      await denyAction(projectId, acao.sessionId, acao.id);
    } finally {
      esquecerProposta(acao);
      invalidateMergeActions();
    }
  }
  async function sempreAprovar(acao: ProposedAction) {
    try {
      await approveAlwaysAction(projectId, acao.sessionId, acao.id);
    } finally {
      esquecerProposta(acao);
      invalidateMergeActions();
    }
    queryClient.invalidateQueries({ queryKey: ['permissions', projectId] });
  }

  return (
    <div>
      <div className={styles.cabecalho}>
        <h2 className={styles.titulo}>{t('prsTab.title')}</h2>
        <p className={styles.subtitulo}>{t('prsTab.subtitle')}</p>
      </div>

      {backlogQuery.isError && (
        <ErroDeCarregamento
          titulo={t('prsTab.gateStatusError')}
          erro={backlogQuery.error}
          onTentarDeNovo={() => void backlogQuery.refetch()}
        />
      )}

      <PrListAndDiff
        projectId={projectId}
        superficie="prs"
        renderItemExtra={(pr) => {
          if (pr.state !== 'open') return null;

          const task = taskDaBranch(backlogQuery.data, pr.sourceBranch);
          // AT-249 (RN-663): gate pendente é AVISO, nunca trava — o botão e o
          // card seguem ativos, e o texto diz qual gate falta.
          const gatePendente = gatePendenteNoMerge(task);
          const aviso = gatePendente ? (
            <p className={styles.avisoDeGate} data-testid="aviso-gate-pendente">
              {t('prsTab.gatePendente', { gate: gatePendente })}
            </p>
          ) : null;

          const acaoPendente = acaoDaPr(pr);
          // RN-705: a recusa é AVISO em texto (como o gate pendente, RN-663) —
          // o botão segue ativo, a decisão continua humana.
          const recusa = acaoPendente ? undefined : ultimaRecusaDeMerge(mergesFalhosQuery.data, pr);
          const avisoDeRecusa = recusa ? (
            <div className={styles.avisoDeGate} data-testid="aviso-merge-recusado">
              <p>{t('prsTab.mergeRecusado', { reason: recusa.motivo })}</p>
              {recusa.arquivos.length > 0 && (
                <p>
                  {t('prsTab.mergeRecusadoArquivos', {
                    count: recusa.arquivos.length,
                    files: recusa.arquivos.join(', '),
                  })}
                </p>
              )}
              <p>{t('prsTab.mergeResolverAntes')}</p>
            </div>
          ) : null;
          if (acaoPendente) {
            return (
              <div className={styles.decisaoInline}>
                {aviso}
                <ApprovalCard
                  action={acaoPendente}
                  detalheRecolhido
                  onApprove={() => aprovar(acaoPendente)}
                  onDeny={() => negar(acaoPendente)}
                  onAlwaysAllow={() => sempreAprovar(acaoPendente)}
                />
              </div>
            );
          }

          const bloqueado = task?.blocked === true;
          // AT-451: o texto diz a verdade do BOTÃO. Gate pendente é aviso
          // (RN-663), mas tarefa BLOQUEADA desabilita o merge — e o motivo
          // vai em texto, porque `title` em botão `disabled` não abre.
          const avisoDaLinha = bloqueado ? (
            <p className={styles.avisoDeGate} data-testid="aviso-merge-indisponivel">
              {gatePendente
                ? t('prsTab.gatePendenteBloqueada', { gate: gatePendente })
                : t('prsTab.mergeIndisponivelBloqueada', {
                    reason: task?.blockedReason ?? t('prsTab.mergeBlockedFallback'),
                  })}
            </p>
          ) : !latestSession ? (
            <p className={styles.avisoDeGate} data-testid="aviso-merge-indisponivel">
              {t('prsTab.mergeIndisponivelSemSessao')}
            </p>
          ) : (
            aviso
          );

          return (
            <div className={styles.extraLinha}>
              <Button
                variant="primary"
                disabled={!latestSession || bloqueado}
                loading={propondo === pr.id}
                title={
                  bloqueado
                    ? (task?.blockedReason ?? t('prsTab.mergeBlockedFallback'))
                    : !latestSession
                      ? t('prsTab.mergeNoSession')
                      : undefined
                }
                onClick={() => void proporMerge(pr)}
              >
                {t('prsTab.mergeButton')}
              </Button>
              {avisoDaLinha}
              {avisoDeRecusa}
              {/* RN-816 (AT-480): o botão vem PRIMEIRO, e a esteira do gate —
                  que depende do backlog, lido depois — tem o espaço reservado
                  enquanto ele carrega: chegando depois, ela empurrava o Merge
                  desta linha e o das linhas de baixo. */}
              {backlogQuery.isPending ? (
                <div className={styles.reservaDaEsteira} data-testid="reserva-da-esteira" aria-busy="true">
                  <Skeleton height="100%" />
                </div>
              ) : (
                task && <PrGateTimeline task={task} verdicts={[]} />
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
