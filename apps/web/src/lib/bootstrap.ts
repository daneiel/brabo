import type { BootstrapStepName, SessionEvent } from './api-types';

// Passos do bootstrap de Gitflow em ordem de EXECUÇÃO (igual
// BOOTSTRAP_STEP_SEQUENCE em apps/api/.../bootstrap-steps.ts): os dois
// commits em main vêm ANTES das branches — createRepo não faz commit
// inicial em nenhum provider, então nada pode nascer de um main sem commit.
export interface BootstrapStepDef {
  name: BootstrapStepName;
  label: string;
}

export const BOOTSTRAP_STEPS: readonly BootstrapStepDef[] = [
  { name: 'commit_pr_template', label: 'Commit do template de PR' },
  { name: 'commit_branching_policy', label: 'Commit da política de branches' },
  { name: 'create_dev_branch', label: 'Criar branch dev' },
  { name: 'create_qa_branch', label: 'Criar branch qa' },
  // `create_rc_branch` saiu com o degrau `rc` (ADR 0030, achado #3). O nome
  // continua no VOCABULÁRIO (`BootstrapStepName`, e o enum do banco), porque
  // projetos bootstrapados antes têm eventos e cursor com ele — o que esta
  // lista descreve é o que o bootstrap FAZ hoje, e listar um passo que nunca
  // vai rodar o deixaria `pendente` para sempre no painel.
  { name: 'protect_branches', label: 'Proteger branches' },
];

// pendente = sem evento ainda; rodando = step_started sem terminal;
// ok = step_completed; skip = step_skipped OU step_degraded (o sub-motivo
// distingue "já satisfeito" de "não suportado"); falha = step_failed.
export type StepUiState = 'pendente' | 'rodando' | 'ok' | 'skip' | 'falha';

export interface StepUi {
  state: StepUiState;
  // Só preenchido em skip degradado (capability_unsupported) ou falha.
  note?: string;
}

const EVENT_TO_STATE: Record<string, StepUiState> = {
  'bootstrap.step_started': 'rodando',
  'bootstrap.step_completed': 'ok',
  'bootstrap.step_skipped': 'skip',
  'bootstrap.step_degraded': 'skip',
  'bootstrap.step_failed': 'falha',
};

interface BootstrapEventPayload {
  step?: BootstrapStepName;
  reason?: string;
  error?: string;
}

function isBootstrapStep(value: unknown): value is BootstrapStepName {
  return BOOTSTRAP_STEPS.some((s) => s.name === value);
}

/**
 * Reducer PURO: mapeia os session_events do bootstrap pro estado de UI de
 * cada um dos 6 passos. Aplica em ordem de `seq`, last-wins por passo —
 * um `step_started` (rodando) é sobrescrito pelo terminal que vier depois
 * (ok/skip/falha). protect_branches emite vários `step_completed` (um por
 * branch): last-wins resolve pra ok. Passos sem nenhum evento ficam
 * 'pendente'. Não depende de rede — é o núcleo testável da tela de progresso.
 */
export function deriveStepStates(
  events: SessionEvent[],
): Record<BootstrapStepName, StepUi> {
  const result = {} as Record<BootstrapStepName, StepUi>;
  for (const step of BOOTSTRAP_STEPS) result[step.name] = { state: 'pendente' };

  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const event of ordered) {
    const state = EVENT_TO_STATE[event.type];
    if (!state) continue;
    const payload = (event.payload ?? {}) as BootstrapEventPayload;
    if (!isBootstrapStep(payload.step)) continue;

    const note =
      event.type === 'bootstrap.step_degraded'
        ? 'não suportado'
        : event.type === 'bootstrap.step_failed'
          ? payload.error
          : undefined;
    result[payload.step] = { state, note };
  }

  return result;
}
