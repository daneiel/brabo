import type { ComponentType } from 'react';
import i18n from '../lib/i18n';
import { ProjectOverviewTab } from './ProjectOverviewTab';
import { ProjectCriativoTab } from './ProjectSessionsTab';
import { ProjectChatShell } from './ProjectChatShell';
import { ProjectCodeTab } from './ProjectCodeTab';
import { ProjectPrsTab } from './ProjectPrsTab';
import { ProjectExecutorsTab } from './ProjectExecutorsTab';
import { ProjectBacklogTab } from './ProjectBacklogTab';
import { ProjectArchitectureTab } from './ProjectArchitectureTab';
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
 *
 * PROGRAMA 28 — moldura de tela (ADR 0078): o handoff de design prevê 7 abas
 * (Visão geral, Criativo, Código, Chat, Gastos, Aprovações, Configurações);
 * este registro tem mais. `executores`, `backlog` e `insights` nasceram
 * DEPOIS do handoff, com dado real e RN própria (RN-121, RN-048, e as
 * hipóteses do Psicólogo), e FICAM: o handoff é referência de fidelidade
 * visual, não teto de produto (RN-203).
 *
 * PROGRAMA de abas agrupadas — Onda 1: a régua ganhou um segundo nível
 * (`grupo`, abaixo) e duas chaves novas ainda em placeholder (`prs`,
 * `arquitetura` — Ondas 2/3 entregam o conteúdo real). A fusão mais visível
 * desta onda: `sessions` ("Chat") e `rag` ("Chat RAG") viraram UMA aba só,
 * `chat`, com um controle segmentado por dentro (`ProjectChatShell.tsx`) —
 * fusão de CONTÊINER DE UI, não de lógica. `ProjectChatTab` (ativa agente,
 * gasta a chave do owner — RN-058) e `ProjectRagTab` (busca read-only sobre
 * o índice, sem agente — RN-202/ADR 0082) continuam os dois caminhos de
 * dados de sempre, intocados, só remontados dentro do mesmo painel. Os links
 * antigos `?tab=sessions` e `?tab=rag` continuam abrindo alguma coisa —
 * `resolverChaveDeAba`, abaixo, é o alias que os dois passaram a precisar
 * (a chave `sessions` não existe mais para virar ela mesma, como nas fases
 * anteriores).
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
  /**
   * PRs abertas com um `git_merge` PENDENTE de decisão (Onda 2 do programa
   * de abas agrupadas) — cruzamento project-wide (`useProjectPendingActions`,
   * `ProjectPrsTab.tsx`), não escopado a nenhuma sessão específica.
   */
  prsPendentes: number;
  /**
   * Idem, para a aba `arquitetura` — placeholder até a Onda 3.
   */
  arquiteturaPendente: number;
}

export interface AbaDoProjeto {
  /** O valor que aparece em `?tab=` e o que a régua usa como identidade. */
  key: string;
  /**
   * `REGISTRO`, abaixo, preenche isto com um GETTER (`get label()`), não um
   * valor fixo — módulo não-React só é reavaliado uma vez, no import; um
   * valor fixo congelaria a tradução no idioma vigente no boot. O getter
   * resolve via `i18n.t()` a cada ACESSO (mesmo padrão de
   * `lib/session-kind.ts`), então o consumidor acompanha a troca de idioma
   * sem precisar de `useTranslation` aqui, que não é componente React.
   */
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
  /**
   * O grupo da régua a que esta aba pertence (PROGRAMA de abas agrupadas,
   * Onda 1). Ausente = aba SOLTA no nível do topo, junto dos grupos.
   *
   * `ordem` aqui é a posição do GRUPO entre os itens de topo — grupos e abas
   * soltas compartilham o mesmo espaço de ordenação (ver `GRUPOS_DO_PROJETO`)
   * — nunca a posição desta aba DENTRO do grupo, que continua sendo o
   * `ordem` de fora deste campo. Toda aba do mesmo `grupo.chave` declara o
   * MESMO `label`/`ordem` de grupo; é redundante por design (o registro
   * continua sendo uma lista plana, sem árvore para editar à mão) e a
   * derivação usa o primeiro valor que encontrar.
   */
  grupo?: { chave: string; label: string; ordem: number };
}

/**
 * O registro. `satisfies` em vez de anotação de tipo: é o que preserva as
 * chaves como literais e deixa `ChaveDeAba` ser DERIVADA daqui em vez de
 * reescrita à mão — o item 2 da lista lá em cima.
 */
const REGISTRO = [
  {
    key: 'overview',
    get label() {
      return i18n.t('tabs.overview.label', { ns: 'nav' });
    },
    component: ProjectOverviewTab,
    semRespiro: true,
    ordem: 10,
  },
  // Grupo "Agentes" — as quatro abas que giram em torno de conversar com um
  // agente ou acompanhar o que ele fez: acompanhamento de execução
  // (Executores), os dois lugares de sessão (Criativo e o Chat fundido,
  // ver `ProjectChatShell.tsx`) e as hipóteses do Psicólogo (Insights).
  {
    key: 'executores',
    get label() {
      return i18n.t('tabs.executors.label', { ns: 'nav' });
    },
    component: ProjectExecutorsTab,
    ordem: 21,
    grupo: {
      chave: 'agentes',
      get label() {
        return i18n.t('groups.agentes.label', { ns: 'nav' });
      },
      ordem: 20,
    },
  },
  // Criativo vem antes de Chat pelo mesmo motivo que `KIND_PRE_SELECIONADO` é
  // `criativa`: é o caminho que produz, e o outro é o de tirar dúvidas.
  {
    key: 'criativo',
    get label() {
      return i18n.t('tabs.criativo.label', { ns: 'nav' });
    },
    component: ProjectCriativoTab,
    ordem: 22,
    grupo: {
      chave: 'agentes',
      get label() {
        return i18n.t('groups.agentes.label', { ns: 'nav' });
      },
      ordem: 20,
    },
  },
  {
    // A CHAVE virou `chat` nesta onda — antes era `sessions` (o rótulo já
    // tinha virado "Chat" na FASE 24, RN-104). A aba agora é a FUSÃO de
    // "Chat" e "Chat RAG": um controle segmentado por dentro do painel
    // alterna entre conversar com um agente (`ProjectChatTab`, RN-058) e
    // buscar no índice sem agente nenhum (`ProjectRagTab`, RN-202/ADR
    // 0082) — os dois caminhos de dados continuam INTOCADOS, só o
    // contêiner de UI fundiu.
    //
    // Trocar a chave quebraria o deep-link `?tab=sessions`/`?tab=rag`
    // antigos se nada mais fizesse nada — é para isso que existe
    // `resolverChaveDeAba` (abaixo): os dois aliases resolvem para `chat`,
    // e o segmento inicial (conversar/buscar) é decidido dentro do próprio
    // `ProjectChatShell`, lendo a URL uma vez no mount (mesmo contrato de
    // "?tab= só vale como deep-link inicial" que o resto do registro já
    // segue).
    key: 'chat',
    get label() {
      return i18n.t('tabs.chat.label', { ns: 'nav' });
    },
    component: ProjectChatShell,
    ordem: 23,
    grupo: {
      chave: 'agentes',
      get label() {
        return i18n.t('groups.agentes.label', { ns: 'nav' });
      },
      ordem: 20,
    },
  },
  {
    key: 'insights',
    get label() {
      return i18n.t('tabs.insights.label', { ns: 'nav' });
    },
    component: ProjectInsightsTab,
    count: (c: ContagensDeAba) => c.hipotesesPendentes || undefined,
    ordem: 24,
    grupo: {
      chave: 'agentes',
      get label() {
        return i18n.t('groups.agentes.label', { ns: 'nav' });
      },
      ordem: 20,
    },
  },
  // Grupo "Dev" — o que sai do trabalho de desenvolvimento: código
  // (só leitura, FASE 26), PRs (Onda 2 — listagem project-wide + merge) e as
  // ações propostas que pedem decisão (Aprovações).
  {
    // O rótulo era "Code" (inglês, sobrado da FASE 26); o handoff pede
    // "Código", e nenhum outro ponto compara pela STRING do rótulo — a chave
    // de deep-link e de registro continua `code` (ADR 0078).
    key: 'code',
    get label() {
      return i18n.t('tabs.code.label', { ns: 'nav' });
    },
    component: ProjectCodeTab,
    semRespiro: true,
    ordem: 31,
    grupo: {
      chave: 'dev',
      get label() {
        return i18n.t('groups.dev.label', { ns: 'nav' });
      },
      ordem: 30,
    },
  },
  {
    // Onda 2 do programa de abas agrupadas: listagem de PRs do PROJETO
    // inteiro (direto do provider de git, não escopada a sessão nenhuma —
    // ver `ProjectPrsTab.tsx`) com merge propondo `git_merge` inline.
    key: 'prs',
    get label() {
      return i18n.t('tabs.prs.label', { ns: 'nav' });
    },
    component: ProjectPrsTab,
    count: (c: ContagensDeAba) => c.prsPendentes || undefined,
    ordem: 32,
    grupo: {
      chave: 'dev',
      get label() {
        return i18n.t('groups.dev.label', { ns: 'nav' });
      },
      ordem: 30,
    },
  },
  {
    key: 'approvals',
    get label() {
      return i18n.t('tabs.approvals.label', { ns: 'nav' });
    },
    component: ProjectApprovalsTab,
    count: (c: ContagensDeAba) => c.aprovacoesPendentes || undefined,
    ordem: 33,
    grupo: {
      chave: 'dev',
      get label() {
        return i18n.t('groups.dev.label', { ns: 'nav' });
      },
      ordem: 30,
    },
  },
  // Grupo "Documentação" — o que registra intenção e conhecimento do
  // produto: Backlog (histórias/épicos) e Arquitetura (Onda 3 — hoje
  // placeholder; é onde o C4 do Arquiteto e o Mapa de Módulos devem
  // aterrissar, hoje espalhados pela Visão geral).
  {
    key: 'backlog',
    get label() {
      return i18n.t('tabs.backlog.label', { ns: 'nav' });
    },
    component: ProjectBacklogTab,
    count: (c: ContagensDeAba) => c.promocoesPendentes || undefined,
    ordem: 41,
    grupo: {
      chave: 'documentacao',
      get label() {
        return i18n.t('groups.documentacao.label', { ns: 'nav' });
      },
      ordem: 40,
    },
  },
  {
    // Placeholder da Onda 1 — ver comentário de `prs` acima; mesma razão.
    // TODO: substituído pela Onda 3 do programa (abas agrupadas).
    key: 'arquitetura',
    get label() {
      return i18n.t('tabs.architecture.label', { ns: 'nav' });
    },
    component: ProjectArchitectureTab,
    count: (c: ContagensDeAba) => c.arquiteturaPendente || undefined,
    ordem: 42,
    grupo: {
      chave: 'documentacao',
      get label() {
        return i18n.t('groups.documentacao.label', { ns: 'nav' });
      },
      ordem: 40,
    },
  },
  // FASE 22 — o mesmo gasto para duas audiências (ADR 0063): o owner vê a
  // conta do workspace, o membro vê o que ele consumiu. Antes de Configurações
  // porque é leitura, não ajuste. Solta — não é conversa com agente nem
  // documentação, e não vale abrir grupo de uma aba só.
  {
    key: 'spend',
    get label() {
      return i18n.t('tabs.spend.label', { ns: 'nav' });
    },
    component: ProjectSpendTab,
    ordem: 55,
  },
  {
    key: 'settings',
    get label() {
      return i18n.t('tabs.settings.label', { ns: 'nav' });
    },
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

/**
 * Chaves de deep-link aposentadas pela fusão da Onda 1 — `sessions`
 * (FASE 24, RN-104) e `rag` (Onda 5, frente G3) viraram segmentos de UMA
 * aba (`chat`), não duas abas. Um link antigo continua abrindo alguma
 * coisa em vez de cair silencioso na Visão geral — mesma garantia que
 * RN-104 já dava, só que agora precisa de um mapa em vez de a chave já
 * ser ela mesma (a chave não é mais a mesma).
 */
const ALIASES_DE_ABA: Readonly<Record<string, ChaveDeAba>> = {
  sessions: 'chat',
  rag: 'chat',
};

/**
 * O guarda ESTENDIDO: aceita a chave atual OU um alias aposentado, sempre
 * resolvendo para o valor de hoje. É esta função, e não `ehChaveDeAba`
 * sozinha, que o `validateSearch` do router usa — `ehChaveDeAba` continua
 * validando só contra o registro atual, e é o que os testes usam para
 * provar que toda `ChaveDeAba` bate com uma aba de verdade.
 */
export function resolverChaveDeAba(valor: unknown): ChaveDeAba | undefined {
  if (ehChaveDeAba(valor)) return valor;
  if (typeof valor === 'string' && valor in ALIASES_DE_ABA) {
    return ALIASES_DE_ABA[valor];
  }
  return undefined;
}

/**
 * A estrutura agrupada da régua (PROGRAMA de abas agrupadas — Onda 1),
 * derivada do `REGISTRO` — nunca escrita à mão em paralelo a ele. Um item é
 * um GRUPO (com as abas-filhas, ordenadas pelo `ordem` de cada uma) ou uma
 * aba SOLTA (sem `grupo`). Os dois tipos de item compartilham o mesmo espaço
 * de ordenação de topo: `ordem` de um grupo é a de qualquer uma das suas
 * abas-membro (`grupo.ordem`, redundante por design — ver o campo em
 * `AbaDoProjeto`); `ordem` de uma aba solta é a dela mesma.
 *
 * Só a ESTRUTURA sai daqui — quem resolve `count` contra `ContagensDeAba` e
 * monta os `TabItem` que `GroupedTabs` consome é `ProjectPage.tsx`, mesma
 * divisão de responsabilidade que já existia entre este arquivo e
 * `ABAS_DO_PROJETO`.
 */
export interface GrupoDoProjeto {
  tipo: 'grupo';
  chave: string;
  label: string;
  ordem: number;
  abas: readonly AbaDoProjeto[];
}

export interface AbaSoltaDoProjeto {
  tipo: 'aba';
  aba: AbaDoProjeto;
}

export type ItemDaReguaDoProjeto = GrupoDoProjeto | AbaSoltaDoProjeto;

function agruparRegistro(
  registro: readonly AbaDoProjeto[],
): readonly ItemDaReguaDoProjeto[] {
  const grupos = new Map<
    string,
    { grupo: NonNullable<AbaDoProjeto['grupo']>; abas: AbaDoProjeto[] }
  >();
  const soltas: AbaDoProjeto[] = [];

  for (const aba of registro) {
    if (!aba.grupo) {
      soltas.push(aba);
      continue;
    }
    const existente = grupos.get(aba.grupo.chave);
    if (existente) {
      existente.abas.push(aba);
    } else {
      grupos.set(aba.grupo.chave, { grupo: aba.grupo, abas: [aba] });
    }
  }

  // `label` continua GETTER até aqui — copiar `g.grupo.label` pra um campo
  // fixo congelaria a tradução no idioma vigente na única vez em que
  // `GRUPOS_DO_PROJETO` é avaliado (módulo não-React, import único). Manter
  // a referência a `g.grupo` (o mesmo objeto de `REGISTRO`) é o que faz o
  // grupo acompanhar troca de idioma, igual toda aba já fazia.
  const itensDeGrupo: ItemDaReguaDoProjeto[] = [...grupos.entries()].map(
    ([chave, g]) => ({
      tipo: 'grupo',
      chave,
      get label() {
        return g.grupo.label;
      },
      ordem: g.grupo.ordem,
      abas: [...g.abas].sort((a, b) => a.ordem - b.ordem),
    }),
  );
  const itensSoltos: ItemDaReguaDoProjeto[] = soltas.map((aba) => ({
    tipo: 'aba',
    aba,
  }));

  return [...itensDeGrupo, ...itensSoltos].sort((a, b) => {
    const ordemA = a.tipo === 'grupo' ? a.ordem : a.aba.ordem;
    const ordemB = b.tipo === 'grupo' ? b.ordem : b.aba.ordem;
    return ordemA - ordemB;
  });
}

export const GRUPOS_DO_PROJETO: readonly ItemDaReguaDoProjeto[] =
  agruparRegistro(REGISTRO);
