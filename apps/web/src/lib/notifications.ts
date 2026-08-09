import { useQuery } from '@tanstack/react-query';
import { getUnreadEvents } from './api-client';
import { getLastSeenSeq } from './read-state';
import { pollQueParaNoErro } from './query-policy';
import type {
  Project,
  ProjectCardSummary,
  UnreadCursor,
} from './api-types';

export interface ProjectUnread {
  project: Project;
  latestSessionId: string | null;
  latestSeq: number;
  unreadCount: number;
}

/**
 * Quantos eventos cada projeto tem além do último que o usuário viu.
 *
 * PURO — nenhuma consulta. `latestSeq` chega pronto no resumo do workspace
 * (RN-090); antes este hook baixava TODAS as sessões de CADA projeto a cada
 * 5s só para ordenar por data e ficar com a mais recente. Como o Shell é
 * montado em toda rota, aquilo pollava o workspace inteiro até em telas que
 * não mostram card nenhum.
 */
export function useProjectsUnread(
  projects: Project[] | undefined,
  summaries: ProjectCardSummary[] | undefined,
): ProjectUnread[] {
  const porProjeto = new Map(
    (summaries ?? []).map((s) => [s.projectId, s] as const),
  );

  return (projects ?? []).map((project) => {
    const summary = porProjeto.get(project.id);
    const latestSeq = summary?.latestSeq ?? 0;
    const seen = getLastSeenSeq(project.id);
    return {
      project,
      latestSessionId: summary?.latestSessionId ?? null,
      latestSeq,
      unreadCount: Math.max(0, latestSeq - seen),
    };
  });
}

/**
 * Quantas histórias esperam a promoção do usuário, somando todos os projetos
 * (Fase 12c — RN-048).
 *
 * Deliberadamente SEPARADO da contagem de não lidos, e não somado ao
 * `unreadCount`: aquele contador é derivado de `seq` e o `onMarkRead` do sino
 * o zera gravando o último `seq` visto. Uma promoção pendente não é uma
 * mensagem não lida — ela continua pendente depois de vista, e some só quando
 * o usuário decide. Misturar as duas faria abrir o sino cancelar a fila de
 * decisões. Somam-se apenas no número exibido.
 *
 * Virou função pura pelo mesmo motivo do hook acima: a contagem vem do resumo
 * do workspace, e não de um `listBacklog` por projeto — que baixava a árvore
 * inteira de épicos, histórias e tarefas para contar uma flag.
 */
export function storiesAwaitingPromotion(
  summaries: ProjectCardSummary[] | undefined,
): number {
  return (summaries ?? []).reduce(
    (total, s) => total + s.storiesAwaitingPromotion,
    0,
  );
}

export interface NotificationGroupData {
  projectId: string;
  projectName: string;
  /** Do MAIS RECENTE para o mais antigo, como a api devolve (RN-100). */
  events: import('./api-types').SessionEvent[];
  /** Total de não lidos do projeto, incluindo o que não coube na janela. */
  unreadCount: number;
  /**
   * Quantos não lidos ficaram FORA da janela de 50 — sempre os mais antigos.
   *
   * Subtração, não requisição: `unreadCount` já vem do resumo do workspace
   * (RN-090) e a janela é o que a gaveta devolveu. É este número que impede a
   * gaveta de mentir por omissão quando o teto por projeto corta.
   */
  olderCount: number;
}

/**
 * O conteúdo da gaveta do sino: os eventos não lidos, por projeto — numa
 * requisição só, quantos projetos forem (RN-091).
 *
 * Isto era a última leitura do dashboard que crescia com N. O obstáculo era
 * real: o corte de onde começar a ler é o `seq` que cada navegador guarda em
 * `read-state`, e o servidor não o conhece. A saída não foi o servidor
 * adivinhar — foi o cliente MANDAR o mapa `projeto → afterSeq` no corpo. Os
 * dados que voltam são exatamente os mesmos, na mesma cadência: é batelamento
 * puro, e nada muda para quem olha a tela.
 *
 * `aberto` continua valendo. A gaveta só é RENDERIZADA quando aberta, então
 * buscar antes disso é pagar por uma lista que ninguém está vendo. O badge não
 * depende daqui: o número vem de `latestSeq`, que já está no resumo.
 *
 * A ORDEM dos eventos vem da api e é usada como veio (RN-100). Não há
 * `.sort()` aqui, e não pode haver: a consulta corta em 50 POR PROJETO, então
 * ordenar do lado de cá reordenaria uma janela já escolhida — e num projeto
 * com 300 não lidos mostraria o 251º evento como se fosse o mais recente.
 */
export function useNotificationGroups(
  unread: ProjectUnread[],
  aberto: boolean,
  workspaceId: string | undefined,
): NotificationGroupData[] {
  const withUnread = unread.filter(
    (u) => u.unreadCount > 0 && u.latestSessionId,
  );

  const cursors: UnreadCursor[] = withUnread.map((u) => ({
    projectId: u.project.id,
    afterSeq: getLastSeenSeq(u.project.id),
  }));

  const query = useQuery({
    // O corte de cada projeto entra na CHAVE: "marcar lidas" grava um `seq`
    // novo no `read-state`, e sem isso o React Query devolveria a resposta
    // anterior — os mesmos eventos que acabaram de ser dados por lidos.
    queryKey: ['unread-events', workspaceId, chaveDosCursores(cursors)],
    queryFn: () => getUnreadEvents(workspaceId!, cursors),
    // Lista vazia não vira requisição: o servidor responderia vazio de todo
    // jeito, e pedir isso a cada 5s é tráfego por nada.
    enabled: aberto && !!workspaceId && cursors.length > 0,
    refetchInterval: pollQueParaNoErro(5000),
  });

  const eventosDe = new Map(
    (query.data ?? []).map((g) => [g.projectId, g.events] as const),
  );

  // O agrupamento e os nomes continuam vindo do cliente: a api responde só o
  // que aconteceu em cada projeto, não como a gaveta se desenha. A ORDEM
  // dentro do grupo, não — essa é da api, ver o cabeçalho.
  return withUnread.map((u) => {
    const events = eventosDe.get(u.project.id) ?? [];
    return {
      projectId: u.project.id,
      projectName: u.project.name,
      events,
      unreadCount: u.unreadCount,
      olderCount: Math.max(0, u.unreadCount - events.length),
    };
  });
}

/** Chave estável para o React Query — mesmo conteúdo, mesma string. */
function chaveDosCursores(cursors: UnreadCursor[]): string {
  return cursors
    .map((c) => `${c.projectId}:${c.afterSeq}`)
    .sort()
    .join('|');
}
