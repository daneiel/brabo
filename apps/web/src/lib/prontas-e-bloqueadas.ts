import type { CodePullRequestSummary, Epic, ProposedAction, Task } from './api-types';

const PREFIXO_BRANCH_DE_TASK = 'feature/task-';

/** A tarefa cuja branch abriu esta PR (`feature/task-XXXXXXXX`, RN-152), se houver. */
export function tarefaDaBranch(epics: readonly Epic[] | undefined, sourceBranch: string): Task | undefined {
  if (!sourceBranch.startsWith(PREFIXO_BRANCH_DE_TASK)) return undefined;
  const prefixo = sourceBranch.slice(PREFIXO_BRANCH_DE_TASK.length);
  if (!prefixo) return undefined;
  for (const epic of epics ?? []) {
    for (const story of epic.stories ?? []) {
      const task = (story.tasks ?? []).find((t) => t.id.startsWith(prefixo));
      if (task) return task;
    }
  }
  return undefined;
}

function idDaPrDaAcao(acao: ProposedAction): string {
  return String((acao.payload as { pullRequestId?: unknown }).pullRequestId ?? '');
}

/**
 * As PRs abertas prontas para merge — RN-825 (AT-497): PR de tarefa cujos
 * gates aprovaram (`gateStatus: awaiting_user`), ou PR sem tarefa (ADR, infra),
 * que não tem gate de tarefa; em ambos os casos SEM `git_merge` pendente de
 * OUTRA sessão (essa já está na fila "Merges de PR"). O merge pendente DESTA
 * sessão volta junto, para o card de aprovação aparecer na linha da PR.
 */
export function prsProntasParaMerge(
  prs: readonly CodePullRequestSummary[] | undefined,
  epics: readonly Epic[] | undefined,
  pendentes: readonly ProposedAction[] | undefined,
  sessionId: string,
): { pr: CodePullRequestSummary; mergeDaSessao: ProposedAction | undefined }[] {
  const merges = (pendentes ?? []).filter(
    (a) => a.actionType === 'git_merge' && a.status === 'pending',
  );
  return (Array.isArray(prs) ? prs : [])
    .filter((pr) => pr.state === 'open')
    .filter((pr) => {
      const task = tarefaDaBranch(epics, pr.sourceBranch);
      return !task || (task.status !== 'done' && task.gateStatus === 'awaiting_user');
    })
    .filter((pr) => !merges.some((m) => m.sessionId !== sessionId && idDaPrDaAcao(m) === pr.id))
    .map((pr) => ({
      pr,
      mergeDaSessao: merges.find((m) => m.sessionId === sessionId && idDaPrDaAcao(m) === pr.id),
    }));
}

/** As tarefas bloqueadas do backlog (`blocked`), na ordem do backlog — RN-826. */
export function tarefasBloqueadas(epics: readonly Epic[] | undefined): Task[] {
  return (epics ?? []).flatMap((e) =>
    (e.stories ?? []).flatMap((s) => (s.tasks ?? []).filter((t) => t.blocked)),
  );
}

/**
 * A assinatura do que, no backlog, decide se uma PR de tarefa é pronta — RN-841
 * (AT-510): `id:status:gateStatus` de cada tarefa. Quando ela muda entre duas
 * leituras do backlog (a de 15 s que o chat já faz), a lista de PRs abertas é
 * relida: a PR do dev nasce na sessão de EXECUÇÃO, cujo canal o chat não ouve,
 * e a tarefa mudando de status/gate é o sinal que chega aqui sem poll novo.
 */
export function assinaturaDoBacklog(epics: readonly Epic[] | undefined): string {
  return (epics ?? [])
    .flatMap((e) =>
      (e.stories ?? []).flatMap((s) =>
        (s.tasks ?? []).map((t) => `${t.id}:${t.status}:${t.gateStatus ?? ''}:${t.blocked ? 'b' : ''}`),
      ),
    )
    .sort()
    .join('|');
}
