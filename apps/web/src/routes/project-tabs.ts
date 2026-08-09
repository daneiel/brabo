import type { ComponentType } from 'react';
import { ProjectOverviewTab } from './ProjectOverviewTab';
import { ProjectChatTab, ProjectCriativoTab } from './ProjectSessionsTab';
import { ProjectCodeTab } from './ProjectCodeTab';
import { ProjectBacklogTab } from './ProjectBacklogTab';
import { ProjectApprovalsTab } from './ProjectApprovalsTab';
import { ProjectInsightsTab } from './ProjectInsightsTab';
import { ProjectSpendTab } from './ProjectSpendTab';
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
  /**
   * A aba desenha até a borda e cuida do próprio respiro/rolagem.
   *
   * O default (`false`) é a moldura pôr 24px em volta e rolar o painel
   * inteiro — o que serve para as abas em forma de documento. A Visão geral
   * não é uma: ela tem três regiões, e a da direita é um TRILHO com divisória
   * à esquerda e rolagem própria (handoff, seção 4). Com o respiro da moldura
   * esse trilho vira um card flutuando a 24px da borda.
   *
   * Mora no registro em vez de num `tab === 'overview'` dentro da moldura pelo
   * mesmo motivo do resto deste arquivo: quem sabe como a aba se desenha é a
   * aba, e uma condição escrita na moldura envelhece calada.
   */
  semRespiro?: boolean;
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
    semRespiro: true,
    ordem: 10,
  },
  // FASE 24 — o tipo da sessão vira LUGAR (RN-104). Era uma aba só, "Sessões",
  // listando os dois tipos misturados; o tipo é imutável depois de criado
  // (RN-097), então ele serve como coordenada de navegação e não como campo
  // escondido num passo de criação.
  //
  // Criativo vem antes de Chat pelo mesmo motivo que `KIND_PRE_SELECIONADO` é
  // `criativa`: é o caminho que produz, e o outro é o de tirar dúvidas.
  {
    key: 'criativo',
    label: 'Criativo',
    component: ProjectCriativoTab,
    ordem: 20,
  },
  {
    // A CHAVE continua `sessions`, e o rótulo é que mudou para "Chat". É isto
    // que faz um `?tab=sessions` guardado num link antigo abrir no Chat — com
    // a aba MARCADA na régua, não só com o painel certo.
    //
    // A alternativa seria `key: 'chat'` com `sessions` resolvido como alias em
    // `abaPorChave`. Ela abre o painel certo e deixa a régua SEM seleção
    // nenhuma: `Tabs` compara `active` com `key`, e quem escreve `active` é o
    // `ProjectPage`, que recebe a chave crua do `validateSearch`. Corrigir por
    // ali exigiria normalizar em `router.tsx`/`ProjectPage.tsx` — os dois
    // arquivos que esta onda mantém fechados, e cuja disputa é a razão de a
    // FASE 16 ter criado este registro.
    //
    // Chat é a aba consultiva: uma entrada por tipo, e nenhuma terceira
    // listando os dois de novo.
    key: 'sessions',
    label: 'Chat',
    component: ProjectChatTab,
    ordem: 25,
  },
  // FASE 26 — a aba Code, só leitura. Fica logo depois do Chat, antes do
  // Backlog: é onde o código que os agentes escreveram vira leitura navegável,
  // e o "quarto estado" (RN-107, bloqueado por decisão pendente do Arquiteto)
  // mora dentro do próprio painel — não no registro.
  {
    key: 'code',
    label: 'Code',
    component: ProjectCodeTab,
    semRespiro: true,
    ordem: 27,
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
  // FASE 22 — o mesmo gasto para duas audiências (ADR 0063): o owner vê a
  // conta do workspace, o membro vê o que ele consumiu. Antes de Configurações
  // porque é leitura, não ajuste.
  {
    key: 'spend',
    label: 'Gastos',
    component: ProjectSpendTab,
    ordem: 55,
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
