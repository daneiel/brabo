import type { ComponentType } from 'react';
import { ProjectOverviewTab } from './ProjectOverviewTab';
import { ProjectSessionsTab } from './ProjectSessionsTab';
import { ProjectBacklogTab } from './ProjectBacklogTab';
import { ProjectApprovalsTab } from './ProjectApprovalsTab';
import { ProjectInsightsTab } from './ProjectInsightsTab';
import { ProjectSettingsTab } from './ProjectSettingsTab';

/**
 * As abas do projeto, num registro só.
 *
 * O defeito que isto fecha: a mesma lista estava escrita em QUATRO lugares, e
 * nada obrigava os quatro a concordarem —
 *
 * 1. `router.tsx`, na lista que valida o deep-link `?tab=`;
 * 2. `ProjectPage.tsx`, no `type TabKey`;
 * 3. `ProjectPage.tsx`, no array de itens passado à régua;
 * 4. `ProjectPage.tsx`, na cadeia de `&&` que renderiza.
 *
 * Os dois primeiros são a divergência PERIGOSA: uma chave aceita pelo
 * `validateSearch` sem painel correspondente abre o projeto numa aba em branco
 * — e uma chave com painel mas fora do router faz o deep-link cair silenciosa
 * na Visão geral. Nenhum dos dois quebra compilação, porque as duas listas nem
 * se enxergam.
 *
 * O que NÃO muda: `?tab=` continua sendo só deep-link inicial, e a aba
 * continua estado local da página. Este arquivo é o registro, não roteamento.
 */

/**
 * As três filas de decisão que ganham contador na régua.
 *
 * Ficam separadas de propósito (achado #15): somá-las esconderia QUAL delas
 * está pedindo atenção.
 */
export interface ContagensDeAba {
  /** Histórias esperando promoção do usuário (Fase 12c — RN-048). */
  promocoesPendentes: number;
  /** Ações propostas aguardando decisão. */
  aprovacoesPendentes: number;
  /** Hipóteses do Psicólogo esperando aceitar/descartar. */
  hipotesesPendentes: number;
}

export interface AbaDoProjeto {
  /** O valor que aparece em `?tab=` e o que a régua usa como identidade. */
  key: string;
  label: string;
  /** O painel. Toda aba recebe o mesmo e único prop. */
  component: ComponentType<{ projectId: string }>;
  /**
   * De onde sai o selo numérico, quando existe. Devolver `undefined` esconde o
   * selo — zero pendência não é informação, é ruído.
   */
  count?: (contagens: ContagensDeAba) => number | undefined;
  /** Posição na régua. Explícita para que inserir uma aba no meio seja um número, não um diff de array. */
  ordem: number;
}

/**
 * O registro. `satisfies` em vez de anotação de tipo: é o que preserva as
 * chaves como literais e deixa `ChaveDeAba` ser DERIVADA daqui em vez de
 * reescrita à mão — o item 2 da lista lá em cima.
 */
const REGISTRO = [
  {
    key: 'overview',
    label: 'Visão geral',
    component: ProjectOverviewTab,
    ordem: 10,
  },
  {
    key: 'sessions',
    label: 'Sessões',
    component: ProjectSessionsTab,
    ordem: 20,
  },
  {
    key: 'backlog',
    label: 'Backlog',
    component: ProjectBacklogTab,
    count: (c: ContagensDeAba) => c.promocoesPendentes || undefined,
    ordem: 30,
  },
  {
    key: 'approvals',
    label: 'Aprovações',
    component: ProjectApprovalsTab,
    count: (c: ContagensDeAba) => c.aprovacoesPendentes || undefined,
    ordem: 40,
  },
  {
    key: 'insights',
    label: 'Insights',
    component: ProjectInsightsTab,
    count: (c: ContagensDeAba) => c.hipotesesPendentes || undefined,
    ordem: 50,
  },
  {
    key: 'settings',
    label: 'Configurações',
    component: ProjectSettingsTab,
    ordem: 60,
  },
] as const satisfies readonly AbaDoProjeto[];

export type ChaveDeAba = (typeof REGISTRO)[number]['key'];

/** As abas na ordem em que aparecem. */
export const ABAS_DO_PROJETO: readonly AbaDoProjeto[] = [...REGISTRO].sort(
  (a, b) => a.ordem - b.ordem,
);

/** A primeira aba é o default de quem abre o projeto sem `?tab=`. */
export const ABA_PADRAO: ChaveDeAba = 'overview';

export const CHAVES_DE_ABA: readonly ChaveDeAba[] = ABAS_DO_PROJETO.map(
  (aba) => aba.key as ChaveDeAba,
);

/**
 * O guarda que o `validateSearch` do router usa.
 *
 * Mora aqui, e não no router, porque é ele que precisa concordar com o
 * registro: enquanto morava lá, concordar era responsabilidade de quem
 * lembrasse.
 */
export function ehChaveDeAba(valor: unknown): valor is ChaveDeAba {
  return (
    typeof valor === 'string' &&
    (CHAVES_DE_ABA as readonly string[]).includes(valor)
  );
}

/** A aba pedida, ou a padrão quando a chave não existe. */
export function abaPorChave(chave: string | undefined): AbaDoProjeto {
  return (
    ABAS_DO_PROJETO.find((aba) => aba.key === chave) ??
    ABAS_DO_PROJETO.find((aba) => aba.key === ABA_PADRAO)!
  );
}
