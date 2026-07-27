/*
 * Previews do BootstrapSteps — o progresso do bootstrap de Gitflow.
 *
 * `stepStates` precisa dos SEIS passos (é um Record completo de
 * BootstrapStepName), na ordem em que o pipeline os executa. Os estados vêm de
 * StepUiState, em pt-BR: 'pendente' | 'rodando' | 'ok' | 'skip' | 'falha'.
 */
import { BootstrapSteps } from 'web';

type Estados = Parameters<typeof BootstrapSteps>[0]['stepStates'];

const estados = (
  parcial: Partial<Record<keyof Estados, { state: string; note?: string }>>,
): Estados =>
  ({
    commit_pr_template: { state: 'pendente' },
    commit_branching_policy: { state: 'pendente' },
    create_dev_branch: { state: 'pendente' },
    create_qa_branch: { state: 'pendente' },
    create_rc_branch: { state: 'pendente' },
    protect_branches: { state: 'pendente' },
    ...parcial,
  }) as Estados;

/** Recém-disparado: nada rodou ainda. */
export function Pendente() {
  return <BootstrapSteps stepStates={estados({})} />;
}

/** Em andamento — o passo corrente é o único 'rodando'. */
export function EmAndamento() {
  return (
    <BootstrapSteps
      stepStates={estados({
        commit_pr_template: { state: 'ok' },
        commit_branching_policy: { state: 'ok' },
        create_dev_branch: { state: 'ok' },
        create_qa_branch: { state: 'rodando' },
      })}
    />
  );
}

/** Concluído, com um passo pulado — `skip` não é falha. */
export function Concluido() {
  return (
    <BootstrapSteps
      stepStates={estados({
        commit_pr_template: { state: 'ok' },
        commit_branching_policy: { state: 'skip', note: 'o arquivo já existia no repositório' },
        create_dev_branch: { state: 'ok' },
        create_qa_branch: { state: 'ok' },
        create_rc_branch: { state: 'ok' },
        protect_branches: { state: 'ok' },
      })}
    />
  );
}

/** Falha: `failedStep` é o que o wizard usa para oferecer a retomada. */
export function ComFalha() {
  return (
    <BootstrapSteps
      stepStates={estados({
        commit_pr_template: { state: 'ok' },
        commit_branching_policy: { state: 'ok' },
        create_dev_branch: { state: 'ok' },
        create_qa_branch: { state: 'ok' },
        create_rc_branch: { state: 'ok' },
        protect_branches: {
          state: 'falha',
          note: 'o token não tem permissão de administração no repositório',
        },
      })}
      failedStep="protect_branches"
    />
  );
}
