import type { Task } from './api-types';

/**
 * Qual gate AINDA não julgou a tarefa por trás desta PR, pelo id do registro
 * (`docs/gates.yml`) — ou `null` quando nada está pendente (AT-249, RN-663).
 *
 * Decisão do dono (30/09): merge com gate pendente é só AVISADO, nunca
 * recusado. Quem consome mostra o texto ao lado do botão e o botão continua
 * ativo; nada aqui trava merge, e o teto de branch protegida (RN-418) é da
 * api, não desta função.
 *
 * - `awaiting_qa` → `qa-verificada`; `awaiting_secops` → `secops-segura`;
 * - `gateStatus` nulo numa tarefa não concluída → o gate de QA ainda nem abriu,
 *   e é ele que falta: `qa-verificada`;
 * - `awaiting_user` (os gates passaram) ou tarefa `done` → `null`;
 * - sem tarefa (PR de infra, aberta à mão) → `null`: não há gate de tarefa a
 *   avisar, e inventar um seria afirmar o que a tela não sabe.
 */
export function gatePendenteNoMerge(
  task: Pick<Task, 'status' | 'gateStatus'> | undefined,
): string | null {
  if (!task || task.status === 'done') return null;
  if (task.gateStatus === 'awaiting_secops') return 'secops-segura';
  if (task.gateStatus === 'awaiting_user') return null;
  return 'qa-verificada';
}
