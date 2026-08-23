import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  approveAction,
  approveAlwaysAction,
  denyAction,
  mensagemDaApi,
  proposeAction,
} from '../lib/api-client';
import { useBacklog, useLatestSession, useProjectPendingActions } from '../lib/hooks';
import { userIdDaSessao } from '../lib/auth';
import type { CodePullRequestSummary, Epic, ProposedAction, Task } from '../lib/api-types';
import { ApprovalCard } from '../components/ApprovalCard';
import { PrGateTimeline } from '../components/PrGateTimeline';
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
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [propondo, setPropondo] = useState<string | null>(null);

  function invalidateMergeActions() {
    queryClient.invalidateQueries({
      queryKey: ['project-pending-actions', projectId, 'git_merge'],
    });
  }

  async function proporMerge(pr: CodePullRequestSummary) {
    if (!latestSession) return;
    setPropondo(pr.id);
    try {
      await proposeAction(projectId, latestSession.id, {
        actionType: 'git_merge',
        actor: { kind: 'user', id: userIdDaSessao() ?? 'usuário' },
        payload: {
          pullRequestId: pr.id,
          sourceBranch: pr.sourceBranch,
          targetBranch: pr.targetBranch,
          title: pr.title,
        },
      });
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
    await approveAction(projectId, acao.sessionId, acao.id);
    invalidateMergeActions();
  }
  async function negar(acao: ProposedAction) {
    await denyAction(projectId, acao.sessionId, acao.id);
    invalidateMergeActions();
  }
  async function sempreAprovar(acao: ProposedAction) {
    await approveAlwaysAction(projectId, acao.sessionId, acao.id);
    invalidateMergeActions();
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
        renderItemExtra={(pr) => {
          if (pr.state !== 'open') return null;

          const acaoPendente = acaoDeMergeParaPr(mergeActionsQuery.data, pr);
          if (acaoPendente) {
            return (
              <div className={styles.decisaoInline}>
                <ApprovalCard
                  action={acaoPendente}
                  variant="queue"
                  onApprove={() => void aprovar(acaoPendente)}
                  onDeny={() => void negar(acaoPendente)}
                  onAlwaysAllow={() => void sempreAprovar(acaoPendente)}
                />
              </div>
            );
          }

          const task = taskDaBranch(backlogQuery.data, pr.sourceBranch);
          const bloqueado = task?.blocked === true;

          return (
            <div className={styles.extraLinha}>
              {task && <PrGateTimeline task={task} verdicts={[]} />}
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
            </div>
          );
        }}
      />
    </div>
  );
}
