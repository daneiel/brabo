import { listActions } from './api-client';
import type { Page, ProposedAction } from './api-types';

/**
 * As ações de UMA sessão que a tela lê — AT-296, RN-637.
 *
 * Era `listActions(…, { limit: 200 })`: a PRIMEIRA página, em `seq`
 * crescente, e ninguém paginava. Numa sessão de execução real (um dev agent
 * propõe dezenas de comandos por tarefa) a ação 201 em diante nunca era
 * lida — a pendente NOVA sumia do fio, dos Executores e de Aprovações
 * justamente quando havia alguém esperando por ela.
 *
 * Agora são duas perguntas, e a segunda só é feita quando precisa:
 *
 * 1. a CAUDA (`latest`): as 200 mais novas, que é o que o fio e o painel
 *    derivam — estado atual, como os eventos (ADR 0021);
 * 2. só quando a cauda veio CHEIA (a sessão pode ter mais do que ela
 *    mostra), as PENDENTES (`status=pending&latest`): uma pendente antiga que
 *    a cauda empurrou para fora continua sendo decisão a tomar, e não pode
 *    sumir por ter esperado demais.
 *
 * A sessão curta — o caso comum — continua custando UMA requisição.
 */
export const TETO_DA_JANELA_DE_ACOES = 200;

/**
 * União por `id`, em `seq` crescente — a ordem que o fio sempre recebeu.
 * Pura, para o teste provar a regra sem rede.
 */
export function juntarCaudaEPendentes(
  cauda: readonly ProposedAction[],
  pendentes: readonly ProposedAction[],
): ProposedAction[] {
  const porId = new Map<string, ProposedAction>();
  for (const acao of pendentes) porId.set(acao.id, acao);
  // A cauda vence: se a mesma ação veio nas duas, a leitura mais completa é
  // a da cauda (a de pendentes pode ter sido feita um instante antes).
  for (const acao of cauda) porId.set(acao.id, acao);
  return [...porId.values()].sort((a, b) => a.seq - b.seq);
}

export async function buscarAcoesDaSessao(
  projectId: string,
  sessionId: string,
): Promise<Page<ProposedAction>> {
  const cauda = await listActions(projectId, sessionId, {
    limit: TETO_DA_JANELA_DE_ACOES,
    latest: true,
  });
  if (cauda.items.length < TETO_DA_JANELA_DE_ACOES) return cauda;
  const pendentes = await listActions(projectId, sessionId, {
    limit: TETO_DA_JANELA_DE_ACOES,
    latest: true,
    status: 'pending',
  });
  return { items: juntarCaudaEPendentes(cauda.items, pendentes.items), nextCursor: null };
}
