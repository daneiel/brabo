import { useCallback, useEffect, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { getActiveExecutionSession, getArchitecture, getCoverage, getProjectPendingActions, getProjectsStatus, getProjectsSummary, getSessionEvent, getWorkspaceSummary, listActions, listBacklog, listHandoffs, listHypotheses, listInfraArtifacts, listProficiency, listProjects, listPsychologistAnalyses, listSessionEvents, listSessions, listWorkspaces, getSessionTokenUsage } from './api-client';
import type { ActionType, SessionEvent } from './api-types';
// Todo poll deste arquivo passa por aqui: um `refetchInterval` numérico não
// sabe parar, e a api limita 300 req/min por usuário (ver `query-policy.ts`).
import { pollQueParaNoErro } from './query-policy';

// App opera sobre o primeiro workspace do usuário — sem UI de troca de
// workspace ainda (nunca especificado nos mockups, ver design/COMPONENTS.md).
export function useCurrentWorkspace() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
    select: (list) => list[0]?.workspace,
  });
}

// Irmão de `useCurrentWorkspace()`: aquele descarta `role` no `select`
// (call sites atuais só querem o `Workspace`) — este devolve o par
// completo, pro rodapé da sidebar mostrar o papel RBAC de quem chamou.
// MESMA queryKey ['workspaces']: o React Query deduplica com o hook acima
// quando os dois estão montados juntos, sem round-trip extra.
export function useCurrentWorkspaceWithRole() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
    select: (list) => list[0],
  });
}

export function useProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => listProjects(workspaceId!),
    enabled: !!workspaceId,
  });
}

// Resumo do topo do dashboard: N projetos · M agentes · gasto do mês. Sem
// refetchInterval — não é um número que precisa de frescor de segundos, e um
// erro aqui não pode derrubar a grade de cards (que vem de queries à parte).
export function useWorkspaceSummary(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['workspace-summary', workspaceId],
    queryFn: () => getWorkspaceSummary(workspaceId!),
    enabled: !!workspaceId,
  });
}

// Contagem de tasks bloqueadas por projeto, pro dot de status da sidebar —
// UMA chamada pro workspace inteiro (não uma por projeto). Sem
// refetchInterval de propósito: o Shell é montado em TODA rota, e o dot é
// leitura periférica, não painel ao vivo — mount + refetch no foco (mesma
// cadência do `budget`) já é atualização suficiente.
export function useProjectsStatus(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['projects-status', workspaceId],
    queryFn: () => getProjectsStatus(workspaceId!),
    enabled: !!workspaceId,
  });
}

/**
 * A GRADE INTEIRA de cards do dashboard numa requisição (RN-090).
 *
 * Substitui sete consultas em POLL por card — repositório, orçamento,
 * bootstrap, sessões, último evento, arquitetura, handoffs, ações pendentes e
 * backlog. Com 23 projetos aquilo dava 3.824 req/min contra um limite de 300,
 * e a tela inteira voltava 429 (a PR #193 fez a app PARAR de sangrar; esta
 * reduz o pedido).
 *
 * 5s, a cadência mais lenta entre as que ele substitui: o card é leitura
 * periférica — quem quer o segundo a segundo abre o projeto, e lá as queries
 * por sessão continuam exatamente como eram.
 */
export function useProjectsSummary(
  workspaceId: string | undefined,
  intervalMs = 5000,
) {
  return useQuery({
    queryKey: ['projects-summary', workspaceId],
    queryFn: () => getProjectsSummary(workspaceId!),
    enabled: !!workspaceId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

export function useProjectSessions(projectId: string | undefined) {
  return useQuery({
    queryKey: ['sessions', projectId],
    queryFn: () => listSessions(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(5000),
  });
}

// Sessão mais recente do projeto — usada pra alimentar o feed de
// atividade da Visão geral e o sino de notificações via polling (decisão:
// "polling no frontend, sem mudar o backend" — o canal Phoenix continua
// só heartbeat).
export function useLatestSession(projectId: string | undefined) {
  const sessionsQuery = useProjectSessions(projectId);
  const latest = sessionsQuery.data
    ? [...sessionsQuery.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;
  return { ...sessionsQuery, latest };
}

/**
 * A sessão de execução VIGENTE do projeto (RN-139) — `null` quando não há
 * nenhuma. NÃO é `useLatestSession`: aquela pega a sessão `createdAt` mais
 * recente do projeto, que só É a de execução por COINCIDÊNCIA — assim que
 * outra sessão nasce depois (uma ideação, um chat), `useLatestSession` passa
 * a apontar para ela, silenciosamente vazia de eventos de dev/QA. Esta usa o
 * MESMO critério que o backend usa para reativar (`findActiveExecutionSession`
 * — `active` com `execution.activated` gravado), via
 * `GET /projects/:projectId/execution/session`.
 *
 * `session` é `undefined` enquanto carrega, `null` quando não há execução
 * ativa, e a `Session` vigente nos demais casos — os TRÊS estados que
 * `ProjectExecutorsTab` precisa distinguir (RN-088) vêm prontos de
 * `isPending`/`isError`/`error` do `useQuery` por baixo.
 */
export function useActiveExecutionSession(
  projectId: string | undefined,
  intervalMs = 5000,
) {
  const query = useQuery({
    queryKey: ['execution-session', projectId],
    queryFn: () => getActiveExecutionSession(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
  return { ...query, session: query.data };
}

/**
 * ESTADO ATUAL da sessão: os últimos 200 eventos, em poll.
 *
 * `latest`: os ÚLTIMOS 200, não os primeiros. Os consumidores deste hook
 * (painel do time, linha do tempo em árvore, seção de execução, tab de
 * Aprovações) derivam estado ATUAL — com os primeiros 200 tudo congelava no
 * começo da sessão assim que ela passava desse tamanho, o que uma execução
 * real faz fácil (ver ADR 0021).
 *
 * O que ele NÃO responde mais é "o que aconteceu antes disso": esse é o
 * `useSessionEventHistory` abaixo (RN-099). Eram a mesma query, e por isso o
 * feed de Atividades despejava 200 itens sem fim e ainda assim não alcançava
 * o começo de uma sessão longa.
 *
 * `pausarPoll` (achados 2/7 — duplicata de mensagem): o poll incondicional
 * buscava eventos já persistidos (`chat.message`/`agent.response`) ENQUANTO
 * um turno ainda estava em streaming na tela, e o resultado renderizava ao
 * lado do estado otimista/streaming — duplicata visual. `SessionPage` passa
 * `true` durante o turno; o fim dele já invalida esta query explicitamente
 * (`finalizarTurnoDoAgente`), então pausar o TIMER não perde dado — só evita
 * buscar de novo o que a invalidação vai buscar de qualquer forma. Default
 * `false`: os outros consumidores deste hook (Overview, Code, Provisioning,
 * AdoptionPlan) não têm turno conversacional em andamento e continuam como
 * estavam.
 */
export function useSessionEvents(
  projectId: string | undefined,
  sessionId: string | undefined,
  intervalMs = 3000,
  pausarPoll = false,
) {
  return useQuery({
    queryKey: ['session-events', projectId, sessionId],
    queryFn: () =>
      listSessionEvents(projectId!, sessionId!, { limit: 200, latest: true }),
    enabled: !!projectId && !!sessionId,
    refetchInterval: pausarPoll ? false : pollQueParaNoErro(intervalMs),
  });
}

/** Quantos eventos crus entram em cada página do histórico de Atividades. */
export const EVENTOS_POR_PAGINA = 100;

export interface HistoricoDeEventos {
  /** A janela visível, em ordem crescente de `seq` (o mais novo por último). */
  events: SessionEvent[];
  /**
   * TUDO que já foi baixado — a cauda mais as páginas antigas já pedidas —,
   * sem o recorte da janela (RN-180).
   *
   * A janela existe para o FEED, que pagina item a item. As seções derivadas
   * do painel de contexto (regras de negócio, artefatos, arquivos tocados) não
   * paginam: elas somam sobre o que a sessão trouxe, e cortá-las na janela de
   * 100 mostraria MENOS regra do que o painel já mostrava antes de existir
   * paginação. `carregarMaisAntigos` aumenta as duas, e é isso que faz o
   * botão do feed valer também para elas.
   */
  baixados: SessionEvent[];
  /** Quantos eventos CRUS a janela tem — o `M` do "N de M carregados". */
  carregados: number;
  /** Há sessão anterior à janela, seja já baixada ou ainda por baixar. */
  temMaisAntigos: boolean;
  carregarMaisAntigos: () => void;
  carregandoMaisAntigos: boolean;
  /** RN-088: os três estados, e o erro ANTES do vazio. */
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * HISTÓRICO paginado da sessão, ancorado na cauda (RN-099).
 *
 * Duas perguntas diferentes precisavam de duas queries: `useSessionEvents`
 * responde "como está agora", este responde "o que aconteceu". O feed de
 * Atividades era o único consumidor que fazia a segunda pergunta com a
 * resposta da primeira — 200 itens de uma vez, sem começo nem fim.
 *
 * **Por que a âncora é a CAUDA, e não o começo da sessão.** O endpoint pagina
 * para FRENTE (`afterSeq` devolve o que veio depois, com `nextCursor`), e não
 * existe `beforeSeq` — nem se inventa um aqui, que seria contrato novo. Mas
 * abrir o feed no evento nº 1 de uma sessão de milhares é entregar a tela
 * errada: quem abre Atividades quer o que acabou de acontecer. Então a
 * primeira página é a mesma leitura `latest` que a tela já faz — MESMA
 * `queryKey`, deduplicada pelo React Query, ZERO requisição a mais — e cada
 * clique em "carregar mais antigos" desce uma janela fixa com `afterSeq`.
 *
 * **Por que a janela fecha sem buraco.** O cursor de cada página é
 * `piso - 1 - PAGINA`, e a resposta traz os primeiros `PAGINA` eventos depois
 * dele. Sem lacuna em `seq`, isso é exatamente `[piso - PAGINA, piso - 1]`.
 * Com lacuna (uma transação que reservou `seq` e abortou), a página cobre um
 * intervalo MAIOR e no máximo repete o que já estava carregado — nunca pula,
 * porque o banco devolve os primeiros N depois do corte, não uma fatia por
 * aritmética. Repetição some no `Map` por `id`; e o piso passa a ser
 * `cursor + 1` por construção, o que faz o laço terminar em `0` mesmo quando
 * a página volta vazia.
 *
 * **Custo.** Uma requisição por ciclo de poll, a da cauda — a mesma de antes.
 * Página antiga é uma janela FECHADA de `seq` sobre eventos IMUTÁVEIS
 * (convenção do projeto: nunca UPDATE em tabela de evento), então ela não tem
 * intervalo para guardar: `staleTime: Infinity` e nenhum poll. É esse par que
 * impede a paginação de virar o N+1 que a RN-090 matou.
 */
export function useSessionEventHistory(
  projectId: string | undefined,
  sessionId: string | undefined,
  intervalMs = 3000,
  pausarPoll = false,
): HistoricoDeEventos {
  // A cauda ao vivo. Mesma `queryKey` de `useSessionEvents`: quando os dois
  // estão montados na mesma tela, o React Query serve os dois com UMA busca.
  //
  // `pausarPoll` PRECISA descer até aqui (achados 2/7): o intervalo é de cada
  // OBSERVADOR, não da query. Um segundo observador desta mesma chave com
  // intervalo ligado ressuscitaria o poll que `SessionPage` pausa durante o
  // turno — e com ele a duplicata visual da bolha em streaming.
  const cauda = useSessionEvents(projectId, sessionId, intervalMs, pausarPoll);

  // Cursores das páginas antigas já pedidas, do mais novo para o mais velho.
  const [cursores, setCursores] = useState<number[]>([]);
  // Quantos eventos crus a janela mostra. Cresce de página em página.
  const [janela, setJanela] = useState(EVENTOS_POR_PAGINA);

  // Sessão trocou: a janela é da sessão, não da tela.
  useEffect(() => {
    setCursores([]);
    setJanela(EVENTOS_POR_PAGINA);
  }, [sessionId]);

  const antigas = useQueries({
    queries: cursores.map((afterSeq) => ({
      queryKey: ['session-events-page', projectId, sessionId, afterSeq],
      queryFn: () =>
        listSessionEvents(projectId!, sessionId!, {
          afterSeq,
          limit: EVENTOS_POR_PAGINA,
        }),
      enabled: !!projectId && !!sessionId,
      // Sem `refetchInterval` NENHUM — nem através de `pollQueParaNoErro`:
      // uma janela fechada de eventos imutáveis não muda, e repolá-la seria
      // pagar por N requisições para receber N respostas idênticas.
      staleTime: Infinity,
    })),
  });

  // Deduplicação por `id` + ordenação por `seq`: as páginas podem se sobrepor
  // (ver a nota sobre lacunas acima) e chegam fora de ordem entre si.
  const porId = new Map(
    antigas
      .flatMap((q) => q.data?.items ?? [])
      .concat(cauda.data?.items ?? [])
      .map((e) => [e.id, e] as const),
  );
  const todos = [...porId.values()].sort((a, b) => a.seq - b.seq);

  const events = todos.slice(Math.max(0, todos.length - janela));
  const menorSeqBaixado = todos[0]?.seq ?? 0;
  const menorCursor = cursores.length > 0 ? cursores[cursores.length - 1] : null;

  // Ainda há passado quando a janela não mostra tudo que já veio, OU quando o
  // que já veio não alcança o começo da sessão. `menorCursor === 0` é a prova
  // de que alcançou: aquela página pediu tudo a partir do primeiro `seq`.
  const temMaisAntigos =
    janela < todos.length || (menorCursor !== 0 && menorSeqBaixado > 1);

  const carregarMaisAntigos = useCallback(() => {
    setJanela((atual) => atual + EVENTOS_POR_PAGINA);

    // Uma REQUISIÇÃO só quando a janela já esgotou o que está em memória: a
    // leitura `latest` traz 200 e a janela mostra 100, então o primeiro clique
    // não custa nada — revelar o que já se pagou vem antes de pedir de novo.
    if (janela < todos.length) return;

    setCursores((atuais) => {
      // Depois de uma página com cursor `c`, tudo a partir de `c + 1` está
      // coberto — é daí que sai o piso da próxima, e é o que faz o laço
      // terminar em 0 mesmo se uma página voltar vazia.
      const base =
        atuais.length > 0 ? atuais[atuais.length - 1] + 1 : menorSeqBaixado;
      if (base <= 1) return atuais;
      return [...atuais, Math.max(0, base - 1 - EVENTOS_POR_PAGINA)];
    });
  }, [janela, todos.length, menorSeqBaixado]);

  return {
    events,
    baixados: todos,
    carregados: events.length,
    temMaisAntigos,
    carregarMaisAntigos,
    carregandoMaisAntigos: antigas.some((q) => q.isFetching),
    isPending: cauda.isPending,
    isError: cauda.isError,
    error: cauda.error,
    refetch: () => void cauda.refetch(),
  };
}

// Custo por agente na sessão — alimenta os tokens de cada AgentCard no painel
// do time. Cadência mais lenta que os eventos: é número de exibição, não
// gatilho de decisão.
export function useSessionTokenUsage(
  projectId: string | undefined,
  sessionId: string | undefined,
) {
  return useQuery({
    queryKey: ['session-token-usage', projectId, sessionId],
    queryFn: () => getSessionTokenUsage(projectId!, sessionId!),
    enabled: !!projectId && !!sessionId,
    refetchInterval: pollQueParaNoErro(5000),
  });
}

// `useProjectLastActivity` e `useProjectHasRecentActivity` viviam aqui e
// foram REMOVIDOS com o resumo do workspace (RN-090): os dois buscavam o
// último evento da sessão mais recente de UM projeto, e o card e o dot da
// sidebar — os únicos consumidores — leem isso de `lastEvent`, que já vem na
// linha do projeto. Não voltem: reintroduzi-los é reintroduzir o N+1.

export function usePendingActions(projectId: string | undefined, sessionId: string | undefined, intervalMs = 3000) {
  return useQuery({
    queryKey: ['session-actions', projectId, sessionId],
    queryFn: () => listActions(projectId!, sessionId!, { limit: 200 }),
    enabled: !!projectId && !!sessionId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

/**
 * Ações PENDENTES do PROJETO inteiro, em qualquer sessão (Onda 2 — aba PRs).
 *
 * Irmã de `usePendingActions` (escopada por SESSÃO): esta é a consulta que
 * resolve o bug de visibilidade — a aba PRs usa isto para achar a
 * `proposed_action` correspondente a um PR (ex.: a proposta de `git_merge`
 * do botão "Merge") sem saber de antemão qual sessão a propôs.
 */
export function useProjectPendingActions(
  projectId: string | undefined,
  actionType?: ActionType,
  intervalMs = 3000,
) {
  return useQuery({
    queryKey: ['project-pending-actions', projectId, actionType],
    queryFn: () => getProjectPendingActions(projectId!, { actionType }),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Handoffs entre agentes da sessão (Fase 3b) — poll de 3s, como os eventos.
export function useHandoffs(projectId: string | undefined, sessionId: string | undefined, intervalMs = 3000) {
  return useQuery({
    queryKey: ['session-handoffs', projectId, sessionId],
    queryFn: () => listHandoffs(projectId!, sessionId!),
    enabled: !!projectId && !!sessionId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Backlog do projeto (árvore épico→história→tarefa) — poll pra refletir o PO
// gerando em tempo real.
export function useBacklog(projectId: string | undefined, intervalMs = 4000) {
  return useQuery({
    queryKey: ['backlog', projectId],
    queryFn: () => listBacklog(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Rastreabilidade regra→stories do projeto.
export function useCoverage(projectId: string | undefined, intervalMs = 4000) {
  return useQuery({
    queryKey: ['coverage', projectId],
    queryFn: () => getCoverage(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Arquitetura do projeto (module_map + ADRs + pendências de validação cruzada).
export function useArchitecture(projectId: string | undefined, intervalMs = 4000) {
  return useQuery({
    queryKey: ['architecture', projectId],
    queryFn: () => getArchitecture(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Artefatos de infra do projeto (Fase 4a — InfraAgent) — PRs de infra
// passando pelos mesmos gates de QA/SecOps do dev.
export function useInfraArtifacts(projectId: string | undefined, intervalMs = 3000) {
  return useQuery({
    queryKey: ['infra-artifacts', projectId],
    queryFn: () => listInfraArtifacts(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Perfil de proficiência do projeto (Fase 4b — Anamnese). Muda devagar
// (só quando uma rodada periódica conclui), daí o poll lento.
export function useProficiency(projectId: string | undefined, intervalMs = 15000) {
  return useQuery({
    queryKey: ['proficiency', projectId],
    queryFn: () => listProficiency(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Hipóteses do Psicólogo (Fase 4b) — escopo de PROJETO, não de sessão:
// acumulam a cada sessão encerrada. Poll mais lento que os demais, já que
// só mudam quando uma sessão fecha ou o usuário aceita/descarta.
export function useHypotheses(projectId: string | undefined, intervalMs = 8000) {
  return useQuery({
    queryKey: ['hypotheses', projectId],
    queryFn: () => listHypotheses(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Análises current do Psicólogo com tier e custo — mesma cadência das
// hipóteses (mudam juntas: uma análise nova traz hipóteses novas).
export function usePsychologistAnalyses(
  projectId: string | undefined,
  intervalMs = 8000,
) {
  return useQuery({
    queryKey: ['psychologist-analyses', projectId],
    queryFn: () => listPsychologistAnalyses(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// UM evento pelo id. Existe pro chip de evidência de uma hipótese chegar no
// evento citado mesmo quando ele está fora da janela dos últimos 200 OU é
// um tipo que o feed esconde como ruído de máquina (`agent.response`,
// `tool.call`, `tool.result` — justamente o que o Psicólogo mais cita).
// Sem refetchInterval: evento é imutável, não tem por que repolar.
export function useSessionEvent(
  projectId: string | undefined,
  sessionId: string | undefined,
  eventId: string | undefined,
) {
  return useQuery({
    queryKey: ['session-event', projectId, sessionId, eventId],
    queryFn: () => getSessionEvent(projectId!, sessionId!, eventId!),
    enabled: !!projectId && !!sessionId && !!eventId,
    staleTime: Infinity,
    retry: false,
  });
}
