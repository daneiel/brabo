import type { ProposedAction, SessionEvent } from './api-types';

export function urlDaPr(action: ProposedAction): string | null {
  // `executionResult` no tipo do web é `TerminalExecutionResult | null`
  // (o único payload de execução tipado hoje), mas `pr_open`/`open_adr_pr`
  // gravam outra forma — mesmo cast que `ProjectOverviewTab.tsx` já faz pra
  // ler `pullRequestUrl` de uma PR de dev.
  return (action.executionResult as { pullRequestUrl?: string } | null)?.pullRequestUrl ?? null;
}

/**
 * Um nó da árvore de backlog do painel de artefatos (RN-179) — épico, história
 * ou tarefa, ligados pelo que o event log JÁ carrega:
 * `backlog.epic_created` grava `{ epicId, title }`, `backlog.story_created`
 * grava `{ storyId, epicId, … }` e `backlog.task_created` grava
 * `{ taskId, storyId, … }`.
 *
 * A hierarquia é derivada desses vínculos, nunca adivinhada por proximidade no
 * log: nó cujo pai não está entre os eventos carregados sobe para a raiz em vez
 * de ser pendurado no épico mais próximo — inventar parentesco seria pior que
 * mostrá-lo solto.
 */
export interface NoDeBacklog {
  id: string;
  evento: SessionEvent;
  /**
   * `null` quando o evento não trouxe título (fallback de exibição) — a
   * função é pura e não tem acesso ao `t()` do React, então quem RESOLVE o
   * texto de fallback é o componente que consome a árvore
   * ({@link ItemDeBacklog}), com a chave `compartilhado.semTitulo`.
   */
  titulo: string | null;
  /** A CHAVE de tradução (namespace `sessionPage`) do que está PENDURADO
   *  nele, quando há — `ItemDeBacklog` resolve com `t()`. */
  rotuloDosFilhosKey: string;
  filhos: NoDeBacklog[];
}

const ROTULO_DOS_FILHOS: Record<string, string> = {
  'backlog.epic_created': 'artefatos.historias',
  'backlog.story_created': 'artefatos.tarefas',
  'backlog.task_created': '',
};

/** O id PRÓPRIO e o id do PAI de um evento de backlog, quando ele os tem. */
function vinculoDeBacklog(e: SessionEvent): { id?: string; paiId?: string } {
  const p = e.payload as {
    epicId?: unknown;
    storyId?: unknown;
    taskId?: unknown;
  };
  const texto = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  if (e.type === 'backlog.epic_created') return { id: texto(p?.epicId) };
  if (e.type === 'backlog.story_created') {
    return { id: texto(p?.storyId), paiId: texto(p?.epicId) };
  }
  return { id: texto(p?.taskId), paiId: texto(p?.storyId) };
}

/**
 * Monta a árvore épico → história → tarefa a partir dos eventos carregados.
 *
 * Duas passadas de propósito: a primeira cria TODOS os nós, a segunda os
 * pendura. Pendurar na mesma passada exigiria que o pai já existisse, e o
 * event log não garante isso — uma tarefa criada numa sessão cuja história
 * nasceu antes da janela carregada é caso normal, não erro.
 */
export function montarArvoreDeBacklog(events: SessionEvent[]): NoDeBacklog[] {
  const porId = new Map<string, NoDeBacklog>();
  const ordem: NoDeBacklog[] = [];

  for (const e of events) {
    if (!(e.type in ROTULO_DOS_FILHOS)) continue;
    const { id } = vinculoDeBacklog(e);
    if (!id) continue;
    const payload = e.payload as { title?: unknown };
    const no: NoDeBacklog = {
      id,
      evento: e,
      titulo: typeof payload?.title === 'string' ? payload.title : null,
      rotuloDosFilhosKey: ROTULO_DOS_FILHOS[e.type],
      filhos: [],
    };
    porId.set(id, no);
    ordem.push(no);
  }

  const raizes: NoDeBacklog[] = [];
  for (const no of ordem) {
    const { paiId } = vinculoDeBacklog(no.evento);
    const pai = paiId ? porId.get(paiId) : undefined;
    if (pai) pai.filhos.push(no);
    else raizes.push(no);
  }
  return raizes;
}

/** Quantos descendentes o nó tem, contando os netos — é o número do colapso. */
export function totalDeDescendentes(no: NoDeBacklog): number {
  return no.filhos.reduce((soma, f) => soma + 1 + totalDeDescendentes(f), 0);
}
