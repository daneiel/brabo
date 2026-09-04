import type {
  ArchitecturePendency,
  Epic,
  ProposedAction,
  PsychologistHypothesis,
  Story,
} from './api-types';

/**
 * As CINCO filas de decisão do projeto, num lugar só — e separadas.
 *
 * O painel "precisa de você" (`components/PainelPrecisaDeVoce.tsx`) existe
 * porque hoje as cinco filas só aparecem como cinco contadores em cinco abas
 * diferentes do trilho: quem abre o projeto vê CINCO números e nenhuma frase.
 * O que faltava não era um número a mais — era o quadro inteiro num lugar só.
 *
 * O que este módulo NÃO faz, de propósito: somar. As filas continuam
 * SEPARADAS, cada uma com o próprio total, do mesmo jeito e pelo mesmo motivo
 * que os contadores do trilho continuam separados desde o ADR 0126 — somar
 * apaga QUAL fila está pedindo atenção, e é a pergunta que o usuário tem
 * quando olha para cá. Não há função de total neste arquivo, e isso é
 * deliberado.
 *
 * O módulo é PURO: recebe o que os cinco hooks já buscaram (nenhum deles muda
 * de forma por causa disto) e devolve a estrutura ordenada. Ele não conhece
 * React, i18n nem rota — o rótulo de cada fila é resolvido por quem renderiza,
 * e o destino de cada linha é uma CHAVE de aba, nunca uma URL montada aqui.
 */
export type ChaveDeFila =
  | 'aprovacoes'
  | 'prs'
  | 'promocoes'
  | 'arquitetura'
  | 'hipoteses';

/**
 * As abas para onde uma linha NÃO acionável leva. String literal em vez de
 * `ChaveDeAba`: `routes/project-tabs.ts` importa os 12 painéis do projeto, e
 * um import daqui para lá arrastaria a aplicação inteira para dentro deste
 * módulo (e de todo teste que o toca). O acoplamento que interessa —
 * "esta chave existe?" — é conferido no ponto onde as duas se encontram,
 * `ProjectPage.tsx`, que é quem já tem o tipo em mãos.
 */
export type AbaDeDestino = 'backlog' | 'insights' | 'arquitetura';

export interface ItemDaFila {
  /** Único DENTRO da fila e entre filas — as linhas vivem numa lista só. */
  id: string;
  /** O que a linha diz quando não é um `ApprovalCard`. */
  titulo: string;
  /** Uma segunda linha de contexto, quando a fila tem o que dizer. */
  detalhe?: string;
  /**
   * Desde quando isto espera, em ISO — ou `null` quando não há data alguma
   * a mostrar. NUNCA um "agora" inventado: a tela prefere não dizer a dizer
   * errado.
   */
  desde: string | null;
  /**
   * A data acima foi EMPRESTADA de outro registro (hoje só a pendência de
   * arquitetura, que não tem data própria — ver `montarFilas`). Quem
   * renderiza é obrigado a dizer isso na tela; é por existir esta flag que
   * a tela consegue.
   */
  dataEmprestada?: boolean;
  /** A ação a decidir — presente só nas duas filas acionáveis no painel. */
  acao?: ProposedAction;
  /** A aba que abre a decisão — presente só nas três filas que linkam. */
  aba?: AbaDeDestino;
}

export interface FilaPrecisaDeVoce {
  chave: ChaveDeFila;
  itens: ItemDaFila[];
}

export interface EntradaDasFilas {
  /** Ações pendentes da sessão mais recente (`usePendingActions`). */
  acoesDaSessao: ProposedAction[] | undefined;
  /** `git_merge` pendente em QUALQUER sessão (`useProjectPendingActions`). */
  merges: ProposedAction[] | undefined;
  /** O backlog inteiro (`useBacklog`) — histórias e a data de cada uma. */
  epicos: Epic[] | undefined;
  /** Pendências de validação cruzada (`useArchitecture().pendencies`). */
  pendenciasDeArquitetura: ArchitecturePendency[] | undefined;
  /** Hipóteses do Psicólogo (`useHypotheses`). */
  hipoteses: PsychologistHypothesis[] | undefined;
}

/**
 * A ordem das filas é por URGÊNCIA, e é uma decisão de produto escrita aqui em
 * vez de deduzida de dado nenhum:
 *
 * 1. `aprovacoes` — pode haver um turno de agente SUSPENSO esperando esta
 *    decisão (ADR 0086/RN-284). É a única fila em que ninguém mais anda
 *    enquanto ela não é resolvida.
 * 2. `prs` — a entrega parada na última porta. Vem logo depois porque o
 *    trabalho já está feito, só não chegou.
 * 3. `promocoes` — enquanto a história não é promovida, NENHUMA tarefa dela é
 *    pegável (RN-048): trava o começo, não o fim.
 * 4. `arquitetura` — inconsistência já registrada; ninguém está bloqueado.
 * 5. `hipoteses` — conselho do Psicólogo sobre execução passada. Nada espera.
 */
export const ORDEM_DAS_FILAS: readonly ChaveDeFila[] = [
  'aprovacoes',
  'prs',
  'promocoes',
  'arquitetura',
  'hipoteses',
];

/** As duas filas que se decidem DENTRO do painel, com `ApprovalCard`. */
export const FILAS_ACIONAVEIS: ReadonlySet<ChaveDeFila> = new Set<ChaveDeFila>([
  'aprovacoes',
  'prs',
]);

/**
 * Mais velho primeiro: quem espera há mais tempo aparece antes. Item sem data
 * alguma vai para o FIM — sem data não há como afirmar que é urgente, e pôr
 * um `null` na frente afirmaria.
 */
function porEsperaMaisLonga(a: ItemDaFila, b: ItemDaFila): number {
  if (a.desde === null && b.desde === null) return 0;
  if (a.desde === null) return 1;
  if (b.desde === null) return -1;
  return new Date(a.desde).getTime() - new Date(b.desde).getTime();
}

/** Todas as histórias do backlog, achatadas — o backlog é épico→história. */
function historias(epicos: Epic[] | undefined): Story[] {
  return (epicos ?? []).flatMap((e) => e.stories);
}

export function montarFilas(entrada: EntradaDasFilas): FilaPrecisaDeVoce[] {
  const merges = (entrada.merges ?? []).filter((a) => a.status === 'pending');
  const idsDeMerge = new Set(merges.map((a) => a.id));

  // A MESMA `proposed_action` de `git_merge` pode chegar pelos dois hooks:
  // `usePendingActions` é da sessão mais recente e não filtra por tipo, e
  // `useProjectPendingActions(_, 'git_merge')` é project-wide. Nas abas isso
  // não incomoda (cada aba responde uma pergunta), mas numa lista só a mesma
  // decisão apareceria DUAS vezes, sob dois títulos — e quem visse dois
  // cards contaria dois trabalhos. Fica no grupo mais ESPECÍFICO (`prs`);
  // isto é deduplicação por identidade, nunca soma de filas.
  const aprovacoes = (entrada.acoesDaSessao ?? [])
    .filter((a) => a.status === 'pending' && !idsDeMerge.has(a.id))
    .map<ItemDaFila>((acao) => ({
      id: acao.id,
      titulo: acao.actionType,
      desde: acao.createdAt,
      acao,
    }));

  const itensDeMerge = merges.map<ItemDaFila>((acao) => ({
    id: acao.id,
    titulo: acao.actionType,
    desde: acao.createdAt,
    acao,
  }));

  const todasAsHistorias = historias(entrada.epicos);

  // `proposedReady` é o mesmo predicado de `aguardandoPromocao`
  // (`routes/ProjectBacklogTab.tsx`) — a fila do contador do trilho, não uma
  // segunda definição de "esperando promoção".
  const promocoes = todasAsHistorias
    .filter((s) => s.proposedReady)
    .map<ItemDaFila>((story) => ({
      id: `promocao:${story.id}`,
      titulo: story.title,
      // `updatedAt`, não `createdAt`: a história foi CRIADA pelo PO quando ele
      // começou a escrevê-la, e virou proposta quando ele terminou. O que
      // espera decisão desde então é a proposta.
      desde: story.updatedAt,
      aba: 'backlog',
    }));

  /*
   * A pendência de arquitetura NÃO TEM DATA — nenhuma, em campo nenhum
   * (`ArchitecturePendency`, `lib/api-types.ts`). Não é esquecimento do
   * cliente: ela é uma visão DERIVADA, recalculada a cada leitura do
   * cruzamento entre história e `module_map`, e nunca foi gravada em lugar
   * onde um instante coubesse.
   *
   * Havia três saídas, e duas eram piores. Renderizar "agora" (ou o instante
   * da consulta) faria a linha mais urgente da tela ser a que menos se sabe —
   * e nada na tela denunciaria a mentira. Acrescentar coluna e migração na
   * api resolveria de verdade, e é trabalho de outra decisão, fora do escopo
   * desta.
   *
   * O que sobra é EMPRESTAR a data da história relacionada — o registro que a
   * pendência descreve — e DIZER que é emprestada (`dataEmprestada`), tanto
   * na tela quanto aqui. História que não está no backlog carregado fica sem
   * data nenhuma (`null`) e vai para o fim da fila: emprestar de um registro
   * que não se tem seria inventar de novo.
   */
  const arquitetura = (entrada.pendenciasDeArquitetura ?? []).map<ItemDaFila>(
    (pendencia) => {
      const story = todasAsHistorias.find((s) => s.id === pendencia.storyId);
      return {
        id: `arquitetura:${pendencia.storyId}`,
        titulo: pendencia.title,
        detalhe: pendencia.missing.join(', ') || undefined,
        desde: story?.updatedAt ?? null,
        dataEmprestada: story !== undefined,
        aba: 'arquitetura',
      };
    },
  );

  const hipoteses = (entrada.hipoteses ?? [])
    .filter((h) => h.status === 'proposed')
    .map<ItemDaFila>((h) => ({
      id: `hipotese:${h.id}`,
      titulo: h.hipotese,
      detalhe: h.agenteAlvo,
      desde: h.createdAt,
      aba: 'insights',
    }));

  const porChave: Record<ChaveDeFila, ItemDaFila[]> = {
    aprovacoes,
    prs: itensDeMerge,
    promocoes,
    arquitetura,
    hipoteses,
  };

  return ORDEM_DAS_FILAS.map((chave) => ({
    chave,
    itens: [...porChave[chave]].sort(porEsperaMaisLonga),
  }));
}

/**
 * Há ALGO esperando decisão? Booleano, nunca número — o chip que abre o painel
 * anuncia presença, e os números continuam nas abas, um por fila. Um total
 * aqui seria a soma que este módulo existe para não fazer.
 */
export function temAlgoEsperando(filas: FilaPrecisaDeVoce[]): boolean {
  return filas.some((fila) => fila.itens.length > 0);
}
