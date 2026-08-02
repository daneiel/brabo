import type {
  BootstrapDiagnostic,
  BootstrapPlan,
  BootstrapPlanStep,
} from './api-types';

/**
 * O plano de adoção lido por SEÇÃO (Fase 12a).
 *
 * A tela precisa de "branches / proteções / arquivos", mas o plano chega
 * na ordem de EXECUÇÃO do bootstrap (commits primeiro, porque
 * `createRepo` não faz commit inicial). Reagrupar é da UI; o backend
 * manda a verdade na ordem em que ela acontece.
 */
export type SecaoDoPlano = 'branches' | 'protecoes' | 'arquivos';

export interface GrupoDoPlano {
  secao: SecaoDoPlano;
  titulo: string;
  itens: string[];
}

const TITULOS: Record<SecaoDoPlano, string> = {
  branches: 'Branches',
  protecoes: 'Proteções',
  arquivos: 'Arquivos',
};

const ORDEM: SecaoDoPlano[] = ['branches', 'protecoes', 'arquivos'];

function secaoDe(step: BootstrapPlanStep): SecaoDoPlano {
  if (step.actionType === 'git_branch_create') return 'branches';
  if (step.actionType === 'git_branch_protect') return 'protecoes';
  return 'arquivos';
}

function descrever(step: BootstrapPlanStep): string {
  const { branchName, fromRef, path } = step.payload as {
    branchName?: string;
    fromRef?: string;
    path?: string;
  };
  if (step.actionType === 'git_branch_create') {
    return `criar \`${branchName}\` a partir de \`${fromRef}\``;
  }
  if (step.actionType === 'git_branch_protect') {
    return `proteger \`${branchName}\``;
  }
  return `criar \`${path}\``;
}

/**
 * Grupo sem item NÃO aparece — um plano só de branches não deve mostrar
 * "Proteções (nenhuma)", que é ruído com cara de problema.
 */
export function agruparPlano(plan: BootstrapPlan): GrupoDoPlano[] {
  return ORDEM.map((secao) => ({
    secao,
    titulo: TITULOS[secao],
    itens: plan.steps.filter((s) => secaoDe(s) === secao).map(descrever),
  })).filter((g) => g.itens.length > 0);
}

/**
 * As divergências que NÃO viram passo — o que o repositório tem de
 * próprio e o bootstrap não vai tocar. Informativo, nunca bloqueante:
 * repositório adotado tem a política que tem.
 */
export function divergencias(plan: BootstrapPlan): string[] {
  return plan.diagnostics
    .filter((d) => d.kind === 'extra_branch' || d.kind === 'capability_unsupported')
    .map(descreverDivergencia);
}

function descreverDivergencia(d: BootstrapDiagnostic): string {
  if (d.kind === 'extra_branch') {
    return `\`${String(d.detail.branchName)}\` — o template não conhece esta branch, e o bootstrap não a toca`;
  }
  return `o provider não sabe proteger branch — o passo \`${String(d.detail.step)}\` seria pulado`;
}

/** Um plano sem passo nenhum: não há o que aprovar. */
export function planoVazio(plan: BootstrapPlan): boolean {
  return plan.steps.length === 0;
}
