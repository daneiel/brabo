import { useMemo } from 'react';
import type { Epic, SessionEvent } from './api-types';

/**
 * Agentes que participam do fluxo de CHAT do composer (achado 9-fix) —
 * quem tem rota de `message` wireada no engine, não só `start`.
 *
 * Conferido em `agent_command_controller.ex`: há cláusula própria pra
 * po/dev-lead/arquiteto/ux-designer/staff, e a última cláusula (sem guarda
 * de agente) trata qualquer outro valor — incluindo `"infra"` — como se
 * fosse o Criativo. Infra Lead nunca teve `message` wireada, só `start`;
 * incluí-lo aqui faria o composer mandar mensagens que o engine rotearia em
 * silêncio pro agente errado. Ele é propositivo (CLAUDE.md Fase 4), não
 * conversacional pelo composer.
 *
 * `ux-designer` e `staff` entraram aqui pelo handoff manual (ADR 0109/
 * RN-440): as duas cláusulas já existiam no engine (ADR 0087/0088) sem
 * NENHUM jeito de um humano chegar até elas pela tela — só pela rota
 * interna. `infra`/`qa` continuam de fora: são leads de ÁREA sem
 * `kickoff/1` nem cláusula de `message`, o mesmo padrão já documentado
 * acima para Infra.
 *
 * Movida para cá na extração do hook `useSessionReadiness` (PR 5/5, ADR
 * 0122) porque o loop de `activeAgent` é quem a usa — `SessionPage.tsx`
 * importa de volta este mesmo símbolo pro `offeredHandoff` (que fica lá,
 * fora do escopo desta extração): uma fonte só, nunca cópia.
 */
export const AGENTES_DE_CHAT = [
  'criativo',
  'po',
  'arquiteto',
  'dev-lead',
  'ux-designer',
  'staff',
] as const;

export interface SessionReadiness {
  criativoActive: boolean;
  arquitetoActive: boolean;
  hasBusinessRule: boolean;
  hasPromotedStory: boolean;
  hasProductBrief: boolean;
  activeAgent: string | null;
}

/**
 * As seis derivações de "prontidão" da sessão (RN-160/RN-161) — os gates que
 * habilitam "Estou pronto para produzir", "Confirmar arquitetura pronta" e
 * "Validar necessidade", mais o agente que recebe a mensagem do composer.
 * Extraídas de `SessionPage.tsx` (PR 5/5, ADR 0122) — a única fatia do plano
 * que não é um move mecânico de arquivo: os seis `useMemo` liam direto do
 * closure do componente, então aqui viram um contrato explícito de
 * parâmetros.
 *
 * **Contrato de parâmetros, e por quê:**
 * - `events`: mesmo tipo que `SessionPage.tsx` já usa
 *   (`eventsQuery.data?.items ?? []`, isto é, `SessionEvent[]`) — nenhum
 *   tipo novo, só o que `api-types.ts` já declara.
 * - `backlogData`: o hook recebe o valor JÁ DESEMBRULHADO
 *   (`backlogQuery.data`, `Epic[] | undefined`), não a query inteira nem
 *   `projectId` — `SessionPage.tsx` continua sendo o único dono da chamada
 *   `useBacklog(projectId)` (mesma `queryKey` que a aba Backlog e o restante
 *   da tela usam); o hook fica uma função pura dos dois valores, sem acoplar
 *   a nenhum client de query.
 *
 * `activeFor`, o helper que `criativoActive`/`arquitetoActive` chamam, é
 * redefinido aqui como uma cópia LOCAL de uma linha — não exportado. A
 * versão original em `SessionPage.tsx` também alimentava `offeredHandoff`
 * (fora desta extração, RN-136), então ela continua lá, inalterada, só para
 * esse outro consumidor; duplicar esta única linha evita acoplar
 * `offeredHandoff` a este módulo por um parâmetro que ele não precisaria do
 * resto do contrato.
 */
export function useSessionReadiness(
  events: SessionEvent[],
  backlogData: Epic[] | undefined,
): SessionReadiness {
  // Um agente está ativo se houve um agent.activated pra ele nesta sessão.
  // Isto é EXISTÊNCIA histórica ("já entrou alguma vez"), não "é ele quem
  // fala AGORA" — os dois viram perguntas diferentes logo abaixo.
  const activeFor = (agent: string) =>
    events.some(
      (e) =>
        e.type === 'agent.activated' &&
        (e.payload as { agent?: string })?.agent === agent,
    );
  const criativoActive = useMemo(() => activeFor('criativo'), [events]);
  // Mesmo padrão do Criativo, para o botão de prontidão da arquitetura
  // (achado do problema 1) — o Arquiteto não tinha NENHUM jeito de o usuário
  // disparar `OfferInfraHandoffUseCase`: o endpoint já existia
  // (`POST .../agents/arquiteto/handoff-infra`), mas nenhum lugar do
  // frontend o chamava.
  const arquitetoActive = useMemo(() => activeFor('arquiteto'), [events]);

  // A garantia de VERDADE é o guardrail no engine — `CriativoServer` recusa
  // `confirm_readiness` (e narra a recusa como `agent.error` no fio) quando
  // a sessão não tem nenhuma `artifact.business_rule` (ver
  // criativo_server.ex). Isto é só a UX complementar: desabilita o botão
  // ANTES do clique, com a MESMA fonte que já alimenta o painel "Regras de
  // negócio" em `ContextAside` — sem buscar de novo.
  const hasBusinessRule = useMemo(
    () => events.some((e) => e.type === 'artifact.business_rule'),
    [events],
  );

  // RN-160: mirror do gate acima, para "Confirmar arquitetura pronta" — não
  // basta ter regra de negócio capturada, precisa existir pelo menos 1
  // história já PROMOVIDA (RN-048: `PromoteStoriesUseCase` move `draft` para
  // `ready` via `TransitionStoryUseCase`; `in_progress`/`done` também contam,
  // porque só se chega lá tendo passado por `ready`). A fonte é a MESMA que a
  // aba Backlog já usa (`useBacklog`, `ProjectBacklogTab.tsx`, mesma
  // queryKey `['backlog', projectId]`) — sem round-trip novo.
  const hasPromotedStory = useMemo(
    () =>
      (backlogData ?? []).some((epic) =>
        epic.stories.some((s) => s.status !== 'draft'),
      ),
    [backlogData],
  );

  // Gate `necessidade-validada` (Criativo → PO — auditoria fluxo.yml x
  // código, achado B2, RN-406/ADR 0095): só faz sentido "validar" um
  // `product_brief` que já existe — a consolidação que `confirm_readiness`
  // já produziu. Por isso o botão de validação só habilita DEPOIS que o de
  // "Estou pronto para produzir" já rodou, nunca antes dele.
  const hasProductBrief = useMemo(
    () => events.some((e) => e.type === 'artifact.product_brief'),
    [events],
  );

  // O agente que recebe as mensagens do composer: o de `agent.activated`
  // mais RECENTE (por `seq`) entre os `AGENTES_DE_CHAT` (achado 9-fix).
  // Antes era uma cadeia de PRECEDÊNCIA fixa (arquiteto > po > criativo) que
  // nunca "desligava" — uma vez que o Arquiteto atuasse, ele ficava com
  // prioridade PARA SEMPRE, então mesmo depois de aceitar um handoff pro Dev
  // Lead a mensagem seguinte continuava indo pro Arquiteto. `dev-lead` nem
  // estava na cadeia; acrescentar mais um nome no fim só adiaria o mesmo bug
  // pro próximo agente. "Mais recente vence" não precisa de ordem nenhuma.
  const activeAgent = useMemo(() => {
    let maisRecente: { agent: string; seq: number } | null = null;
    for (const e of events) {
      if (e.type !== 'agent.activated') continue;
      const agent = (e.payload as { agent?: string })?.agent;
      if (
        !agent ||
        !(AGENTES_DE_CHAT as readonly string[]).includes(agent)
      ) {
        continue;
      }
      if (!maisRecente || e.seq > maisRecente.seq) maisRecente = { agent, seq: e.seq };
    }
    return maisRecente?.agent ?? null;
  }, [events]);

  return {
    criativoActive,
    arquitetoActive,
    hasBusinessRule,
    hasPromotedStory,
    hasProductBrief,
    activeAgent,
  };
}
