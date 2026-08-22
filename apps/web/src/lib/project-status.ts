import i18n from './i18n';

// Dot de status do projeto na sidebar (RN-039): verde = saudável e ativo;
// âmbar = orçamento ≥70%; vermelho = orçamento ≥90% OU task bloqueada;
// cinza = sem atividade nos últimos 7 dias. Quando um sinal de risco
// (âmbar/vermelho) e o de inatividade (cinza) se aplicam ao mesmo tempo, o
// de risco VENCE — um projeto estourado e parado ainda é algo a olhar, não
// algo a esconder atrás de "sem atividade".
export type ProjectStatus = 'saudavel' | 'atencao' | 'risco' | 'inativo';

export interface ProjectStatusInput {
  /** Percentual do orçamento consumido — 0 quando não há orçamento definido. */
  budgetPct: number;
  blockedTaskCount: number;
  /** `true` quando houve atividade na sessão mais recente nos últimos 7 dias. */
  hasRecentActivity: boolean;
}

export function deriveProjectStatus({
  budgetPct,
  blockedTaskCount,
  hasRecentActivity,
}: ProjectStatusInput): ProjectStatus {
  if (budgetPct >= 90 || blockedTaskCount > 0) return 'risco';
  if (budgetPct >= 70) return 'atencao';
  if (!hasRecentActivity) return 'inativo';
  return 'saudavel';
}

export const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  saudavel: 'var(--success)',
  atencao: 'var(--warning)',
  risco: 'var(--danger)',
  inativo: 'var(--text-muted)',
};

// Getters, não valores fixados na criação do objeto: este módulo não-React
// só é reavaliado uma vez, no import — um valor fixo congelaria a tradução
// no idioma vigente no boot (mesmo padrão de `session-kind.ts`). O
// consumidor (`Shell.tsx`, RN-039) indexa `PROJECT_STATUS_LABEL[status]`
// direto, sem `useTranslation` — o getter resolve via `i18n.t()` a cada
// ACESSO, então a tela acompanha a troca de idioma sem precisar de hook.
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  get saudavel() {
    return i18n.t('projectStatus.saudavel', { ns: 'dashboard' });
  },
  get atencao() {
    return i18n.t('projectStatus.atencao', { ns: 'dashboard' });
  },
  get risco() {
    return i18n.t('projectStatus.risco', { ns: 'dashboard' });
  },
  get inativo() {
    return i18n.t('projectStatus.inativo', { ns: 'dashboard' });
  },
};

export const ATIVIDADE_RECENTE_JANELA_MS = 7 * 24 * 60 * 60 * 1000;
