import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react';
import { Link } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { approveAction, approveAlwaysAction, denyAction } from '../lib/api-client';
import { corDoAgente, nomeDoAgente } from '../lib/agents';
import { classifyEvent, origemDoEvento } from '../lib/activity';
import type {
  Epic,
  Handoff,
  ProposedAction,
  SessionEvent,
  StructuredQuestion,
  StructuredQuestionAnsweredPayload,
  StructuredQuestionPayload,
  Task,
} from '../lib/api-types';
import type { useTurnoDoAgente } from '../lib/session-turno';
import { ApprovalCard } from '../components/ApprovalCard';
import { MarkdownMessage } from '../components/ui/MarkdownMessage';
import { Button } from '../components/ui/Button';
import { Carousel, type CarouselSlide } from '../components/ui/Carousel';
import { lerFalhaDeTurno } from '../lib/session-falha';
import { respostaCortada } from '../lib/resposta-cortada';
import {
  AlertCircleIcon,
  ChevronRightIcon,
  ModelIcon,
  StackIcon,
  UserIcon,
} from '../components/ui/icons';
import styles from './SessionPage.module.css';
import {
  aberturasDeTurno,
  afundarDesfechos,
  ordemDaAcaoNaTimeline,
  turnoDoSeq,
  type TimelineEntry,
} from '../lib/session-timeline';
import { decisaoDaPoliticaDaAcao } from '../lib/decisao-da-politica';
import { StorySlide } from './StorySlide';
import { MergearNoChat, jaHaMergeDaPr, prAbertaDaAcao } from './MergearNoChat';
import { gatePendenteNoMerge } from '../lib/gate-do-merge';
import { StructuredQuestionCard } from './StructuredQuestionCard';
import { ecosDeRespostaEstruturada } from '../lib/eco-de-formulario';
import { agruparNarracoesDoTurno } from './session-fio';
import { autorDaMensagem, type ContextoDeAutoria } from '../lib/autor-da-mensagem';
import { estadosNaFila } from '../lib/fila-de-mensagens';
import { SeloDaFila } from './SeloDaFila';
import { RetomarGateEstacionado, cicloEstacionado } from './RetomarGateEstacionado';

type Turno = ReturnType<typeof useTurnoDoAgente>;

/**
 * Tudo que a montagem da timeline lia do escopo de `SessionPage` — os MESMOS
 * nomes, para o corpo de `montarTimeline` ser o texto que era o corpo do
 * `useMemo`, sem uma linha de lógica trocada (PR 2 do programa do ADR 0176).
 *
 * O `useMemo` que chama esta função continua em `SessionPage.tsx` com a MESMA
 * lista de dependências de antes — inclusive as que ela não lista (os
 * handlers, `t`, `semRepositorio`): quem decide QUANDO a timeline se refaz é o
 * componente, e mudar essa lista seria mudar comportamento, não mover código.
 */
export interface ContextoDaTimeline {
  events: SessionEvent[];
  actions: ProposedAction[];
  backlogQuery: { data: Epic[] | undefined };
  projectId: string;
  sessionId: string;
  t: TFunction<'sessionPage'>;
  /**
   * De onde sai o AUTOR de uma fala humana (RN-652): quem vê e os membros do
   * projeto. Nunca o nome de quem vê aplicado a toda mensagem.
   */
  autoria: ContextoDeAutoria;
  queryClient: QueryClient;
  invalidateActions: () => void;
  ofertasAcionaveis: Handoff[];
  isActive: boolean;
  semRepositorio: boolean;
  promovendoStoryId: string | null;
  promovendoTodas: boolean;
  ativandoExecucao: boolean;
  podeAtivarAutoMode: boolean;
  /** O papel alcança o mínimo do endpoint de decisão (`developer`)? (AT-266) */
  podeDecidir: boolean;
  setRecusandoStory: Dispatch<SetStateAction<{ id: string; title: string } | null>>;
  setMotivoRecusa: Dispatch<SetStateAction<string>>;
  handlePromoteStory: (storyId: string) => Promise<void>;
  handlePromoteAll: (storyIds: string[]) => Promise<void>;
  handleAcceptHandoff: (handoffId: string, toAgent: string) => Promise<void>;
  handleActivateExecution: () => Promise<void>;
  handleActivateAutoMode: (agentId: string) => Promise<void>;
  iniciarTurnoDoAgente: Turno['iniciarTurnoDoAgente'];
  acompanharTurnoPeloLog: Turno['acompanharTurnoPeloLog'];
  finalizarTurnoDoAgente: Turno['finalizarTurnoDoAgente'];
  /**
   * RN-749 (AT-434): manda ao agente "continue de onde parou", pelo MESMO
   * caminho do composer. Estável (não entra nas dependências da montagem).
   */
  continuarRespostaCortada?: (agente: string) => void;
}

/**
 * Monta a timeline do fio da sessão a partir do event log e das ações
 * propostas: um nó por evento que o fio narra, a leva de histórias aguardando
 * promoção (RN-126/RN-148), os cards de aprovação no eixo da RN-155 e as duas
 * passadas de apresentação (RN-172 e o colapso de "Passos do turno").
 */
/** RN-695: o evento é da Anamnese, e por isso fica fora do fio da sessão. */
export function ehDaAnamnese(event: SessionEvent): boolean {
  return event.actor.kind === 'agent' && event.actor.id === 'anamnese';
}

export function montarTimeline(ctx: ContextoDaTimeline): TimelineEntry[] {
  const {
    events,
    actions,
    backlogQuery,
    projectId,
    sessionId,
    t,
    autoria,
    queryClient,
    invalidateActions,
    ofertasAcionaveis,
    isActive,
    semRepositorio,
    promovendoStoryId,
    promovendoTodas,
    ativandoExecucao,
    podeAtivarAutoMode,
    podeDecidir,
    setRecusandoStory,
    setMotivoRecusa,
    handlePromoteStory,
    handlePromoteAll,
    handleAcceptHandoff,
    handleActivateExecution,
    handleActivateAutoMode,
    iniciarTurnoDoAgente,
    acompanharTurnoPeloLog,
    finalizarTurnoDoAgente,
    continuarRespostaCortada,
  } = ctx;
  const items: TimelineEntry[] = [];
  // O rótulo de cada desfecho de `autorDaMensagem` (RN-652). "Você" só quando
  // o ator É quem vê e não há nome nem e-mail; o desconhecido tem frase
  // própria, e a pessoa que a tela não sabe nomear também.
  const rotuloDoAutor = (autor: ReturnType<typeof autorDaMensagem>): string => {
    switch (autor.tipo) {
      case 'voce':
        return autor.nome ?? t('compartilhado.voce');
      case 'membro':
        return autor.nome;
      case 'outroMembro':
        return t('compartilhado.outroMembro');
      case 'agente':
        return nomeDoAgente(autor.id);
      case 'desconhecido':
        return t('compartilhado.autorDesconhecido');
    }
  };
  // As fronteiras de turno (RN-172), calculadas UMA vez para a sessão
  // inteira — é o que impede um desfecho de escorregar para o turno de
  // baixo.
  const aberturas = aberturasDeTurno(events);
  // A oferta ATUAL (ainda não aceita) vira card acionável no evento que a
  // CRIOU, casado pelo `handoffId` do payload (RN-631, AT-251) — o id que
  // `CreateHandoffUseCase` grava no `handoff.offered` desde sempre. Até aqui o
  // casamento era pelo par ATOR/`toAgent` (RN-125), e o ator nem sempre é o
  // `fromAgent`: no handoff MANUAL quem grava o evento é a PESSOA (ADR
  // 0109/RN-440), e o card nunca ganhava o botão (AT-253). Por id não há par
  // para confundir nem "mais recente" para escolher: cada oferta é o evento
  // dela.

  // Carrossel de histórias (RN-148) — a leva é o conjunto de histórias
  // REALMENTE pendentes de promoção NESTA sessão, e essa verdade NÃO PODE
  // depender de quantos eventos aconteceram desde a proposta: numa sessão
  // longa, `backlog.story_promotion_proposed` sai da janela dos últimos
  // 200 eventos de `useSessionEvents` (`latest: true`) enquanto a story
  // continua pendente de verdade — a leva encolhia (ou sumia por completo)
  // silenciosamente. É a MESMA classe de bug que a RN-180 já corrigiu para
  // `ContextAside` trocando a fonte windowed pela completa (RN-XXX).
  //
  // A fonte de CONTEÚDO/CONTAGEM passa a ser `useBacklog` (`backlogQuery`,
  // já usado acima para `hasPromotedStory` — mesma queryKey, sem
  // round-trip novo): `Story.proposedReady` já é o dado COMPLETO e
  // project-wide, sem janela — toda `Story` desta sessão com
  // `proposedReady: true` é uma pendência real, exista ou não o evento de
  // proposta ainda na janela. Quando a story ainda não existe no backlog
  // carregado (query não respondeu, ou mockada vazia — os testes
  // existentes de carrossel/promoção mockam `useBacklog` como `[]` de
  // propósito), degrada story a story pro scan de janela de sempre, o que
  // é o que mantém esses testes passando sem mudança nenhuma.
  const backlogStoriesById = new Map(
    (backlogQuery.data ?? [])
      .flatMap((epic) => epic.stories)
      .filter((s) => s.sessionId === sessionId)
      .map((s) => [s.id, s] as const),
  );

  const resumoDeTextos = (
    description: string | undefined,
    rf: string[] | undefined,
  ): string | undefined => {
    if (description && description !== '') return description;
    if (rf && rf.length > 0) return rf.join(' · ');
    return undefined;
  };

  // Propostas na JANELA: enriquecem título/resumo quando o payload trouxer
  // mais detalhe que a `Story`, dizem ONDE ancorar a leva na timeline, e
  // são o fallback usado quando a story não está no backlog carregado.
  const propostaNaJanelaPorStoryId = new Map<
    string,
    { seq: number; titulo: string; resumo: string | undefined }
  >();
  for (const e of events) {
    if (e.type !== 'backlog.story_promotion_proposed') continue;
    const payload = e.payload as {
      storyId?: unknown;
      title?: unknown;
      description?: unknown;
      rf?: unknown;
    };
    const storyId = typeof payload?.storyId === 'string' ? payload.storyId : undefined;
    if (!storyId) continue;
    const titulo = typeof payload?.title === 'string' ? payload.title : t('compartilhado.semTitulo');
    const description =
      typeof payload?.description === 'string' ? payload.description : undefined;
    const rf =
      Array.isArray(payload?.rf) && payload.rf.every((r) => typeof r === 'string')
        ? (payload.rf as string[])
        : undefined;
    propostaNaJanelaPorStoryId.set(storyId, {
      seq: e.seq,
      titulo,
      resumo: resumoDeTextos(description, rf),
    });
  }

  const windowDizResolvida = (storyId: string, propostaSeq: number) =>
    events.some(
      (e2) =>
        e2.seq > propostaSeq &&
        ((e2.type === 'backlog.story_transitioned' &&
          (e2.payload as { storyId?: unknown })?.storyId === storyId) ||
          (e2.type === 'backlog.story_promotion_returned' &&
            (e2.payload as { storyId?: unknown })?.storyId === storyId)),
    );

  const idsConsiderados = new Set<string>([
    ...propostaNaJanelaPorStoryId.keys(),
    ...[...backlogStoriesById.values()]
      .filter((s) => s.proposedReady)
      .map((s) => s.id),
  ]);

  const promocoesPendentes = [...idsConsiderados]
    .map((storyId) => {
      const story = backlogStoriesById.get(storyId);
      const naJanela = propostaNaJanelaPorStoryId.get(storyId);
      const pendente = story
        ? story.proposedReady
        : naJanela !== undefined && !windowDizResolvida(storyId, naJanela.seq);
      if (!pendente) return null;
      return {
        storyId,
        titulo: naJanela?.titulo ?? story?.title ?? t('compartilhado.semTitulo'),
        resumo: naJanela?.resumo ?? resumoDeTextos(story?.description, story?.rf),
        // `undefined` quando o evento que abriu esta pendência já saiu da
        // janela — é o sinal de que a leva precisa ancorar no topo do
        // trecho visível em vez de sumir (requisito 2 da RN-XXX).
        seq: naJanela?.seq,
      };
    })
    .filter(
      (
        p,
      ): p is { storyId: string; titulo: string; resumo: string | undefined; seq: number | undefined } =>
        p !== null,
    )
    // Mais antiga primeiro — mesma ordem que a janela já dava; quem saiu
    // da janela é, por definição, mais antiga que quem ficou.
    .sort((a, b) => (a.seq ?? -1) - (b.seq ?? -1));

  const pendingStoryIds = new Set(promocoesPendentes.map((p) => p.storyId));
  const seqsDaLevaNaJanela = promocoesPendentes
    .map((p) => p.seq)
    .filter((seq): seq is number => seq !== undefined);
  // `null` quando NENHUMA pendente real tem o evento que a abriu ainda na
  // janela — a leva inteira "saiu" do log visível, mas continua pendente
  // de verdade.
  const primeiraDaLevaNaJanela =
    seqsDaLevaNaJanela.length > 0 ? Math.min(...seqsDaLevaNaJanela) : null;

  // 1 história pendente não ganha nada virando carrossel de um slide só —
  // o card simples de sempre já resolve (RN-148); 2+ viram o carrossel.
  // Nó ÚNICO reaproveitado nos dois pontos possíveis de ancoragem abaixo.
  const construirNoDaLeva = (): ReactNode => {
    if (promocoesPendentes.length === 0) return null;
    if (promocoesPendentes.length === 1) {
      const p = promocoesPendentes[0];
      return (
        <div className={styles.handoffCard} key={`leva-unica-${p.storyId}`}>
          <span className={styles.handoffPill}>
            <StackIcon size={13} />
            {t('historia.pendente', { titulo: p.titulo })}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="success"
              disabled={promovendoStoryId === p.storyId}
              loading={promovendoStoryId === p.storyId}
              onClick={() => handlePromoteStory(p.storyId)}
            >
              {t('historia.promover')}
            </Button>
            <Button
              variant="ghost"
              disabled={promovendoStoryId === p.storyId}
              onClick={() => {
                setRecusandoStory({ id: p.storyId, title: p.titulo });
                setMotivoRecusa('');
              }}
            >
              {t('historia.devolver')}
            </Button>
          </div>
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            search={{ tab: 'backlog' }}
            className={styles.timelineLink}
          >
            {t('compartilhado.verNoBacklog')}
            <ChevronRightIcon size={11} />
          </Link>
        </div>
      );
    }
    const slides: CarouselSlide[] = promocoesPendentes.map((p) => ({
      key: p.storyId,
      label: p.titulo,
      node: (
        <StorySlide
          key={p.storyId}
          projectId={projectId}
          titulo={p.titulo}
          resumo={p.resumo}
          promovendo={promovendoStoryId === p.storyId}
          desabilitado={promovendoStoryId !== null || promovendoTodas}
          onPromover={() => handlePromoteStory(p.storyId)}
          onDevolver={() => {
            setRecusandoStory({ id: p.storyId, title: p.titulo });
            setMotivoRecusa('');
          }}
        />
      ),
    }));
    return (
      <Carousel
        key="carrossel-historias"
        ariaLabel={t('historia.aguardandoPromocao', { count: promocoesPendentes.length })}
        slides={slides}
        headerActions={
          <Button
            variant="success"
            loading={promovendoTodas}
            disabled={promovendoStoryId !== null}
            onClick={() => handlePromoteAll(promocoesPendentes.map((p) => p.storyId))}
          >
            {t('historia.aprovarTodas')}
          </Button>
        }
      />
    );
  };

  // O evento que abriu a leva já saiu da janela inteira — nenhuma pendente
  // tem `seq` (RN-XXX). Nunca esconder um estado real por causa de corte
  // de leitura (mesma régua da RN-180): ancora no TOPO do trecho visível
  // em vez de sumir, com um `seq` sentinela menor que qualquer evento da
  // janela — só a ORDEM importa aqui, `afundarDesfechos` não mexe em
  // entrada sem `desfecho`.
  if (promocoesPendentes.length > 0 && primeiraDaLevaNaJanela === null) {
    const seqDeAncoragem = (events[0]?.seq ?? 1) - 1;
    items.push({
      seq: seqDeAncoragem,
      autor: 'agent:po',
      turno: turnoDoSeq(aberturas, seqDeAncoragem),
      origem: 'eventos',
      node: construirNoDaLeva(),
    });
  }

  // RN-673: o estado de cada mensagem na fila de um agente — derivado do log
  // UMA vez por montagem, como o engine o deriva.
  const filaDasMensagens = estadosNaFila(events);
  // RN-712: a resposta de um formulário estruturado chega ao agente também
  // como `chat.message` do usuário (a api reenvia as respostas como texto).
  // O card respondido já as mostra — a bolha repetida sai do fio.
  const ecosDeFormulario = ecosDeRespostaEstruturada(events);

  for (const event of events) {
    // RN-695 (AT-355): a Anamnese NÃO fala no fio. A análise dela é sobre a
    // PESSOA (e citava o id cru do usuário); mora em Configurações › Perfil de
    // proficiência, e o painel de log continua mostrando os eventos dela.
    // Evento antigo, gravado como `agent.response` antes da correção do engine,
    // também sai daqui.
    if (ehDaAnamnese(event)) continue;
    // Todo item nascido deste evento herda o eixo (`seq`), o AUTOR e o
    // TURNO dele — os três campos que `afundarDesfechos` lê. Passam por
    // aqui em vez de serem repetidos em cada `items.push`: um `push` que
    // esquecesse `autor`/`turno` viraria um item de turno "0" no meio do
    // fio, e o desfecho pararia nele sem que ninguém entendesse por quê.
    const empurrar = (
      entry: Omit<TimelineEntry, 'seq' | 'autor' | 'turno' | 'origem'>,
    ) =>
      items.push({
        seq: event.seq,
        autor: `${event.actor.kind}:${event.actor.id}`,
        turno: turnoDoSeq(aberturas, event.seq),
        // RN-177: a origem sai do MESMO derivador do painel de log — uma
        // classificação só para os dois lugares. Derivá-la aqui de novo,
        // por tipo, garantiria que um dia as duas telas discordassem sobre
        // o que é fala de agente.
        origem: origemDoEvento(event),
        ...entry,
      });

    if (event.type === 'chat.message' && ecosDeFormulario.has(event.id)) {
      continue;
    } else if (event.type === 'chat.message') {
      const text = typeof (event.payload as { text?: unknown })?.text === 'string' ? (event.payload as { text: string }).text : '';
      // RN-652 (AT-329): o autor é o ATOR do evento — pessoa, agente ou
      // desconhecido —, nunca quem está vendo a tela.
      const autor = autorDaMensagem(event.actor, autoria);
      const deAgente = autor.tipo === 'agente';
      const naFila = filaDasMensagens.get(event.id);
      empurrar({
        mensagem: true, // RN-644: conta no corte do fio
        node: (
          <div
            className={styles.message}
            key={event.id}
            data-autor={autor.tipo}
            style={
              deAgente
                ? corDoAgente(autor.id)
                : ({ ['--msg-color' as string]: 'var(--accent)' } as CSSProperties)
            }
          >
            {deAgente ? (
              <span className={styles.avatar}>
                <ModelIcon size={15} />
              </span>
            ) : (
              <span
                className={[styles.avatar, autor.tipo !== 'desconhecido' && styles.user]
                  .filter(Boolean)
                  .join(' ')}
              >
                <UserIcon size={15} />
              </span>
            )}
            <div className={styles.messageBody}>
              <div className={styles.messageHeader}>
                <span className={styles.messageName}>{rotuloDoAutor(autor)}</span>
                {naFila && (
                  <SeloDaFila
                    projectId={projectId}
                    sessionId={sessionId}
                    mensagemId={event.id}
                    estado={naFila}
                    // Só quem ENVIOU cancela (a api recusa os outros com 403),
                    // e só com a sessão aberta.
                    podeCancelar={isActive && autor.tipo === 'voce'}
                  />
                )}
              </div>
              <div className={styles.bubble}>{text}</div>
            </div>
          </div>
        ),
      });
    } else if (event.type === 'chat.structured_question') {
      // RN-162: o Criativo pediu várias respostas de uma vez, num
      // formulário. "respondida" é derivada de existir um
      // `chat.structured_question_answered` posterior referenciando este
      // MESMO evento por `questionSetId` — mesmo padrão de "resolvida" que
      // `backlog.story_promotion_proposed` já usa. `chat.structured_
      // question_answered` não vira um item PRÓPRIO na timeline: as
      // respostas aparecem aqui, no card que virou somente leitura.
      const payload = event.payload as StructuredQuestionPayload;
      const questions: StructuredQuestion[] = Array.isArray(payload?.questions)
        ? payload.questions
        : [];
      const respostaEvento = events.find(
        (e) =>
          e.type === 'chat.structured_question_answered' &&
          (e.payload as StructuredQuestionAnsweredPayload)?.questionSetId === event.id,
      );
      empurrar({
        mensagem: true, // RN-644: conta no corte do fio
        agentId: event.actor.kind === 'agent' ? event.actor.id : undefined,
        node: (
          <StructuredQuestionCard
            key={event.id}
            projectId={projectId}
            sessionId={sessionId}
            agent={event.actor.id}
            questionSetId={event.id}
            questions={questions}
            respondida={!!respostaEvento}
            respostasExistentes={
              respostaEvento
                ? (respostaEvento.payload as StructuredQuestionAnsweredPayload).answers
                : undefined
            }
            // RN-174: quem responde é o agente que PERGUNTOU — o ator do
            // próprio evento, e não `activeAgent`, que pode já ter mudado
            // enquanto o formulário ficava na tela sem resposta.
            onTurnoIniciado={() => iniciarTurnoDoAgente(event.actor.id)}
            onTurnoAceito={() => acompanharTurnoPeloLog(event.actor.id)}
            onTurnoTerminado={finalizarTurnoDoAgente}
          />
        ),
      });
    } else if (event.type === 'handoff.offered') {
      // Quem PASSOU é o ator do evento (`create-handoff.use-case.ts` grava o
      // `fromAgent` como actor); o payload traz só o destino. Os dois já
      // estavam no evento — a régua mostrava um `handoff → po` cru e perdia
      // metade da frase, que é justamente quem largou a bola.
      const payload = event.payload as { toAgent?: string };
      const toAgent = payload?.toAgent;
      // O card fica ACIONÁVEL quando esta é a oferta pendente ATUAL — a
      // mesma pergunta que decidia o botão da topbar antes de sair de lá
      // (RN-125). Dois botões com o texto IDÊNTICO visíveis ao mesmo
      // tempo (um na topbar, um no fio) seria o mesmo problema que
      // `ApprovalCard` já evita ao nunca duplicar a ação fora do fio.
      const handoffIdDoEvento = (event.payload as { handoffId?: string })?.handoffId;
      const oferta = isActive
        ? ofertasAcionaveis.find((h) => h.id === handoffIdDoEvento)
        : undefined;
      const isOfertaAtual = !!oferta;
      // O handoff MANUAL (ADR 0109/RN-440) é gravado com a PESSOA como ator,
      // e o id dela não é nome de agente: a pílula diz "handoff manual" em
      // vez de mostrar um UUID como quem passou o bastão (AT-253).
      const origem =
        event.actor.kind === 'user' ? (
          <span className={styles.handoffAgent}>{t('handoff.manualOrigem')}</span>
        ) : (
          <span className={styles.handoffAgent} style={corDoAgente(event.actor.id)}>
            {nomeDoAgente(event.actor.id)}
          </span>
        );
      empurrar({
        // RN-172: passar o bastão é o DESFECHO do turno, e por isso desce
        // abaixo da última fala do agente que passou — o `seq` do evento o
        // põe antes dela porque o engine emite a ferramenta ANTES de
        // recursar para o fechamento. Vale para as duas formas (card
        // acionável e divisor mudo): a leitura errada é a mesma.
        desfecho: true,
        node: isOfertaAtual ? (
          <div className={styles.handoffCard} key={event.id}>
            <span className={styles.handoffPill}>
              {origem}
              <ChevronRightIcon size={13} />
              {t('handoff.passouOBastaoAo')}
              <span className={styles.handoffAgent} style={corDoAgente(toAgent)}>
                {nomeDoAgente(toAgent)}
              </span>
            </span>
            <Button
              variant="success"
              onClick={() => handleAcceptHandoff(oferta!.id, oferta!.toAgent)}
            >
              {t('handoff.aceitarEIniciar', { agente: nomeDoAgente(oferta!.toAgent) })}
            </Button>
            {/* Handoff pro Dev Lead é o início da EXECUÇÃO — quem aceita
                precisa saber onde acompanhar depois (RN-125). As outras
                ofertas (PO, Arquiteto…) continuam na própria sessão, então
                não ganham o link: não há "onde mais olhar" pra elas. */}
            {toAgent === 'dev-lead' && (
              <>
                {/* Atalho pra quem já sabe o que quer (RN-137): ativa a
                    execução direto daqui, sem passar pela conversa com o
                    Dev Lead — mesma `activateExecution` da Visão Geral.
                    Sem repositório ele SAI (RN-582) e o card diz por quê:
                    o aceite ao lado é a segunda porta que o provisiona, e
                    é o gesto que resolve — ativar daria 409. */}
                {semRepositorio ? (
                  <span className={styles.timelineLink} data-testid="sem-repositorio-no-handoff">
                    {t('handoff.semRepositorio')}
                  </span>
                ) : (
                  // RN-728 (AT-410): o aceite é o primário; ativar daqui é
                  // SECUNDÁRIO e diz o que pula — o plano do Dev Lead.
                  <>
                    <Button
                      variant="secondary"
                      loading={ativandoExecucao}
                      onClick={handleActivateExecution}
                      data-testid="ativar-execucao-no-handoff"
                    >
                      {t('handoff.ativarExecucao')}
                    </Button>
                    <span className={styles.timelineLink} data-testid="aviso-ativar-sem-plano">
                      {t('handoff.ativarSemPlanoAviso')}
                    </span>
                  </>
                )}
                <Link
                  to="/projects/$projectId"
                  params={{ projectId }}
                  search={{ tab: 'executores' }}
                  className={styles.timelineLink}
                >
                  {t('handoff.acompanheExecucao')}
                  <ChevronRightIcon size={11} />
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className={styles.handoffDivider} key={event.id}>
            <span className={styles.handoffPill}>
              {origem}
              <ChevronRightIcon size={13} />
              {t('handoff.passouOBastaoAo')}
              <span className={styles.handoffAgent} style={corDoAgente(toAgent)}>
                {nomeDoAgente(toAgent)}
              </span>
            </span>
          </div>
        ),
      });
    } else if (
      event.type === 'handoff.accepted' &&
      (event.payload as { automatico?: boolean } | null)?.automatico === true
    ) {
      // RN-660 (ADR 0186): o SISTEMA aceitou o handoff do PO ao Arquiteto,
      // sem clique. O aceite humano não aparece no fio (o clique já foi
      // visto por quem clicou); este aparece, porque ninguém clicou e o fio
      // é o único lugar onde a pessoa descobre por que o Arquiteto entrou.
      const payload = event.payload as {
        toAgent?: string;
        criterio?: { regras?: number };
      };
      empurrar({
        desfecho: true,
        node: (
          <div
            className={styles.handoffDivider}
            key={event.id}
            data-testid="handoff-aceite-automatico"
          >
            <span className={styles.handoffPill}>
              {t('handoff.aceiteAutomatico', {
                agente: nomeDoAgente(payload.toAgent),
                regras: payload.criterio?.regras ?? 0,
              })}
            </span>
          </div>
        ),
      });
    } else if (event.type === 'handoff.auto_accept_failed') {
      const payload = event.payload as { toAgent?: string; error?: string };
      empurrar({
        desfecho: true,
        node: (
          <div
            className={styles.handoffDivider}
            key={event.id}
            data-testid="handoff-aceite-automatico-falhou"
          >
            <span className={styles.handoffPill}>
              {t('handoff.aceiteAutomaticoFalhou', {
                agente: nomeDoAgente(payload.toAgent),
                erro: payload.error ?? '',
              })}
            </span>
          </div>
        ),
      });
    } else if (
      event.type === 'backlog.epic_created' ||
      event.type === 'backlog.story_created'
    ) {
      // O PO narra o que criou (RN-124) — sem isto, criar épico/história
      // não deixava rastro NENHUM no fio: só aparecia na aba Backlog, pra
      // quem já soubesse ir olhar lá.
      //
      // RN-157: virou AVISO COMPACTO, no mesmo formato de
      // `.handoffDivider`/`.handoffPill` que a passagem de bastão já usa —
      // não a bolha completa (`.message`/`.bubble`, avatar 32px, mesmo
      // peso visual de uma resposta de agente de verdade). Criar um
      // épico/história é uma notificação de que algo mudou EM OUTRO
      // LUGAR (a aba Backlog), com um link pra lá — não uma fala do
      // agente. `agentId` continua populado: ao contrário do divisor de
      // handoff, isto não marca uma TRANSIÇÃO entre agentes, é uma ação
      // do PO dentro do próprio turno dele, e segue elegível ao colapso
      // por agente (RN-138).
      const payload = event.payload as { title?: unknown };
      const titulo = typeof payload?.title === 'string' ? payload.title : t('compartilhado.semTitulo');
      const verboKey =
        event.type === 'backlog.epic_created' ? 'backlog.criouEpico' : 'backlog.criouHistoria';
      empurrar({
        agentId: event.actor.kind === 'agent' ? event.actor.id : undefined,
        node: (
          <div className={styles.handoffDivider} key={event.id}>
            <span className={styles.handoffPill}>
              <StackIcon size={13} />
              <span className={styles.handoffAgent} style={corDoAgente(event.actor.id)}>
                {nomeDoAgente(event.actor.id)}
              </span>
              {t(verboKey)} &quot;{titulo}&quot;
            </span>
            <Link
              to="/projects/$projectId"
              params={{ projectId }}
              search={{ tab: 'backlog' }}
              className={styles.timelineLink}
            >
              {t('compartilhado.verNoBacklog')}
              <ChevronRightIcon size={11} />
            </Link>
          </div>
        ),
      });
    } else if (event.type === 'backlog.story_promotion_proposed') {
      // Promoção inline (RN-126) — a decisão que RN-048 já resolve na aba
      // Backlog ganha um segundo lugar: o fio da própria sessão do PO, onde
      // a história nasceu. Mesmo mecanismo (`promoteStories`/`returnStory`),
      // sem endpoint novo.
      //
      // "Pendente" não é mais decidido por scan de janela (RN-XXX): vem do
      // `pendingStoryIds` calculado acima a partir de `useBacklog`, com
      // fallback pra janela só quando a story não está no backlog
      // carregado. Card e carrossel colapsam pro MESMO nó
      // (`construirNoDaLeva`, 1 ou 2+ pendentes) — só a story ÂNCORA (a
      // proposta pendente mais antiga ainda na janela) o materializa;
      // qualquer outra proposta pendente na mesma leva só faz `continue`,
      // porque já está representada dentro dele.
      const payload = event.payload as { storyId?: unknown; title?: unknown };
      const storyId = typeof payload?.storyId === 'string' ? payload.storyId : undefined;
      const titulo = typeof payload?.title === 'string' ? payload.title : t('compartilhado.semTitulo');
      const pendente = storyId ? pendingStoryIds.has(storyId) : false;

      if (pendente) {
        if (event.seq === primeiraDaLevaNaJanela) {
          empurrar({ node: construirNoDaLeva() });
        }
        continue;
      }

      empurrar({
        node: (
          <div className={styles.handoffDivider} key={event.id}>
            <span className={styles.handoffPill}>
              <StackIcon size={13} />
              {t('historia.estevePendente', { titulo })}
            </span>
          </div>
        ),
      });
    } else if (event.type === 'backlog.story_promotion_returned') {
      // Narração simétrica ao card acima (RN-126) — mesma frase que
      // `activity.ts` já usa no log colapsado da sidebar, reaproveitada
      // aqui em vez de reinventada.
      const payload = event.payload as { title?: unknown; reason?: unknown };
      const titulo = typeof payload?.title === 'string' ? payload.title : t('historia.tituloFallback');
      const motivo = typeof payload?.reason === 'string' ? payload.reason : t('historia.semMotivo');
      empurrar({
        node: (
          <div
            className={styles.message}
            key={event.id}
            style={{ ['--msg-color' as string]: 'var(--danger)' } as CSSProperties}
          >
            <span className={styles.avatar}>
              <StackIcon size={15} />
            </span>
            <div className={styles.messageBody}>
              <div className={styles.messageHeader}>
                <span className={styles.messageName}>
                  {rotuloDoAutor(autorDaMensagem(event.actor, autoria))}
                </span>
                <span className={styles.messageMeta}>{t('historia.devolveuAoPo')}</span>
              </div>
              <div className={styles.bubble}>
                &quot;{titulo}&quot;: {motivo}
              </div>
            </div>
          </div>
        ),
      });
    } else if (event.type === 'agent.response') {
      const payload = event.payload as {
        content?: unknown;
        text?: unknown;
        modelName?: unknown;
        passos?: unknown;
      };
      // AT-395 (RN-698, decisão do dono de 03/10): o `content` é só o FECHO do
      // turno; o texto das voltas anteriores vem em `passos` e entra como
      // narrações do MESMO turno+autor ANTES do fecho — é o colapso de
      // "Passos do turno" que já existe que as recolhe, sem segundo controle.
      // Os passos não contam no corte do fio (RN-644): a mensagem é o fecho.
      const passos = Array.isArray(payload?.passos)
        ? payload.passos.filter((p): p is string => typeof p === 'string' && p !== '')
        : [];
      const text =
        typeof payload?.content === 'string'
          ? payload.content
          : typeof payload?.text === 'string'
            ? payload.text
            : '';
      // Nome do modelo que gerou a resposta (achado do problema 2,
      // RN-146) — evento GRAVADO antes desta mudança não tem a chave, e
      // `payload.modelName` também pode chegar `null` (turno cuja api não
      // resolveu modelo nenhum antes de falhar). Os dois degradam para o
      // rótulo de desconhecido, nunca para `undefined`/`null` na tela.
      const modelName =
        typeof payload?.modelName === 'string' && payload.modelName !== ''
          ? payload.modelName
          : undefined;
      const bolha = (text: string, key: string) => (
          <div className={styles.message} key={key} style={corDoAgente(event.actor.id)}>
            <span className={styles.avatar}>
              <ModelIcon size={15} />
            </span>
            <div className={styles.messageBody}>
              <div className={styles.messageHeader}>
                <span className={styles.messageName}>{nomeDoAgente(event.actor.id)}</span>
                {/* RN-175: o modelo ao lado do nome, como CHIP legível e não
                    como a palavra solta "modelo" em 10px cinza — que era o
                    que o relato viu e que se lê como se o modelo se chamasse
                    "modelo". Sem o dado (evento anterior à RN-146/175, ou
                    turno que falhou antes de resolver o binding) o chip diz
                    que ele não foi REGISTRADO, que é a verdade: adivinhá-lo
                    pelo binding atual do agente seria atribuir a uma resposta
                    antiga um modelo que talvez nem existisse quando ela foi
                    gerada. */}
                <span
                  className={[styles.messageModelo, !modelName && styles.messageModeloAusente]
                    .filter(Boolean)
                    .join(' ')}
                  title={
                    modelName
                      ? t('mensagens.modeloGerador', { modelName })
                      : t('mensagens.modeloNaoGravado')
                  }
                >
                  <ModelIcon size={11} />
                  {modelName ?? t('mensagens.modeloNaoRegistrado')}
                </span>
              </div>
              {/* Resposta vazia é evento ANTIGO: até a RN-059, falha de
                  turno era gravada como `agent.response` com conteúdo "" —
                  e a tela mostrava um balão em branco, indistinguível de um
                  agente que não teve o que dizer. Os eventos já gravados não
                  se apagam, então a tela os NOMEIA. */}
              {text === '' ? (
                <div className={[styles.bubble, styles.bubbleVazio].join(' ')}>
                  {t('mensagens.respostaVazia')}
                </div>
              ) : (
                // RN-158: Markdown leve (negrito, cabeçalho, lista, fence de
                // código com realce) — antes `#`/`**`/```` ``` ```` apareciam
                // literais no balão. Só `agent.response`: `chat.message` é
                // texto DIGITADO pelo usuário, não saída de LLM.
                <div className={styles.bubble}>
                  <MarkdownMessage text={text} />
                </div>
              )}
              {/* RN-749: a resposta cortada pelo teto oferece a continuação
                  num clique — antes a pessoa tinha de adivinhar "continue". */}
              {key === event.id &&
                isActive &&
                continuarRespostaCortada &&
                event.actor.kind === 'agent' &&
                respostaCortada(text) && (
                  <div>
                    <Button
                      variant="ghost"
                      data-testid="continuar-resposta-cortada"
                      onClick={() => continuarRespostaCortada(event.actor.id)}
                    >
                      {t('mensagens.continuarCortada')}
                    </Button>
                  </div>
                )}
            </div>
          </div>
      );
      passos.forEach((passo, i) =>
        empurrar({
          agentId: event.actor.kind === 'agent' ? event.actor.id : undefined,
          agentResponse: true,
          node: bolha(passo, `${event.id}-passo-${i}`),
        }),
      );
      empurrar({
        mensagem: true, // RN-644: conta no corte do fio
        agentId: event.actor.kind === 'agent' ? event.actor.id : undefined,
        // `agruparNarracoesDoTurno` lê este marcador pra saber que ESTA
        // entrada, e só ela, participa do colapso de "Passos do turno".
        agentResponse: true,
        node: bolha(text, event.id),
      });
    } else if (event.type === 'agent.error') {
      // O agente FALA a falha, no mesmo fio. Antes o motivo ia só por
      // broadcast (efêmero) e o log guardava uma resposta vazia — quem
      // abrisse a sessão depois via um balão em branco e nada mais.
      const { mensagem, origem } = lerFalhaDeTurno(event.payload);
      empurrar({
        agentId: event.actor.kind === 'agent' ? event.actor.id : undefined,
        node: (
          <div
            className={styles.message}
            key={event.id}
            style={{ ['--msg-color' as string]: 'var(--danger)' } as CSSProperties}
            // Seletor ESTRUTURAL do E2E (`e2e/testes/turno-pelo-canal.spec.ts`,
            // AT-338): a bolha de falha e a origem dela, sem ler o texto, que
            // muda com o idioma da conta.
            data-testid="falha-de-turno"
            data-origem={origem}
          >
            <span className={styles.avatar}>
              <AlertCircleIcon size={15} />
            </span>
            <div className={styles.messageBody}>
              <div className={styles.messageHeader}>
                <span className={styles.messageName}>{nomeDoAgente(event.actor.id)}</span>
                {/* A ORIGEM fica visível: é ela que diz se o próximo passo é
                    trocar a chave, esperar o provider ou abrir um bug. */}
                <span className={styles.messageMeta}>{t('mensagens.falhaOrigem', { origem })}</span>
              </div>
              <div className={[styles.bubble, styles.bubbleFalha].join(' ')}>
                {mensagem}
              </div>
              {/* AT-393: o próximo gesto, só com o que o evento traz (ator e
                  origem) — o turno parou e uma mensagem nova o retoma. */}
              {event.actor.kind === 'agent' && (
                <div className={styles.messageMeta} data-testid="falha-proximo-passo">
                  {t('mensagens.falhaProximoPasso', {
                    agente: nomeDoAgente(event.actor.id),
                    origem,
                  })}
                </div>
              )}
            </div>
          </div>
        ),
      });
    } else if (event.type === 'toolloop.limit_reached') {
      // RN-698 (AT-354): o teto de iterações era invisível no fio — o PO
      // parava em 12/12 e a última coisa à mostra era um pedaço de resposta.
      // Mesma bolha de falha do `agent.error`, origem `modelo` (o teto só se
      // esgota quando o modelo segue pedindo ferramenta sem convergir, RN-166).
      const max = (event.payload as { max_iterations?: unknown } | null)?.max_iterations;
      empurrar({
        agentId: event.actor.kind === 'agent' ? event.actor.id : undefined,
        node: (
          <div
            className={styles.message}
            key={event.id}
            style={{ ['--msg-color' as string]: 'var(--danger)' } as CSSProperties}
            data-testid="falha-de-turno"
            data-origem="modelo"
          >
            <span className={styles.avatar}>
              <AlertCircleIcon size={15} />
            </span>
            <div className={styles.messageBody}>
              <div className={styles.messageHeader}>
                <span className={styles.messageName}>{nomeDoAgente(event.actor.id)}</span>
                <span className={styles.messageMeta}>
                  {t('mensagens.falhaOrigem', { origem: 'modelo' })}
                </span>
              </div>
              <div className={[styles.bubble, styles.bubbleFalha].join(' ')}>
                {t('mensagens.tetoDeIteracoes', { max: typeof max === 'number' ? max : '?' })}
              </div>
            </div>
          </div>
        ),
      });
    } else if (cicloEstacionado(event)) {
      // RN-724 (ADR 0207): o ciclo de gate parado há mais de 2 h estacionou;
      // o gesto humano que o retoma mora aqui, sob o aviso.
      const ciclo = cicloEstacionado(event)!;
      empurrar({
        node: (
          <div className={styles.message} key={event.id} data-testid="gate-estacionado">
            <span className={styles.avatar}>
              <AlertCircleIcon size={15} />
            </span>
            <div className={styles.messageBody}>
              <div className={styles.bubble}>
                {t('gateEstacionado.aviso', { gate: ciclo.gate, taskId: ciclo.taskId })}
              </div>
              <RetomarGateEstacionado
                projectId={projectId}
                taskId={ciclo.taskId}
                gate={ciclo.gate}
                podeDecidir={podeDecidir}
              />
            </div>
          </div>
        ),
      });
    } else if (event.type.startsWith('delegation.')) {
      // RN-181 — a área trabalha por dentro e o fio ficava mudo.
      //
      // Quando QA ou Infra delega a subagentes e consolida o veredito, os
      // três desfechos (`completed`/`failed`/`dispensed`) só existiam no
      // painel de log: quem acompanha a sessão via o gate abrir e fechar sem
      // nenhum sinal de que houve uma segunda tentativa por baixo. O
      // contrato externo da área NÃO muda (ADR 0038) — o fio não passa a
      // endereçar subagente, só a NARRAR o que o lead já registrou.
      //
      // Aviso compacto, no formato da RN-157, e não bolha: é notificação de
      // algo que aconteceu dentro da área, não uma fala. E a FRASE sai de
      // `classifyEvent` — a mesma do painel —, porque duas redações do mesmo
      // evento divergem na primeira mudança de payload.
      const display = classifyEvent(event);
      empurrar({
        agentId: event.actor.kind === 'agent' ? event.actor.id : undefined,
        node: (
          <div className={styles.handoffDivider} key={event.id}>
            {/* A frase de `classifyEvent` JÁ nomeia o subagente e a área —
                prefixar o lead produziria "QA Lead QA Automação concluiu a
                delegação (qa)". */}
            <span
              className={styles.handoffPill}
              style={
                display.bad
                  ? ({ color: 'var(--danger)' } as CSSProperties)
                  : undefined
              }
            >
              <display.icon size={13} />
              {display.text}
            </span>
          </div>
        ),
      });
    }
  }

  for (const action of actions) {
    // AT-266: o "Mergear" sob o card da PR aberta. Só quando a execução
    // gravou o id da PR e ainda não há proposta de merge viva para ela.
    const prAberta = prAbertaDaAcao(action, events);
    const mergear =
      prAberta && !jaHaMergeDaPr(actions, prAberta.pullRequestId) ? (
        <MergearNoChat
          projectId={projectId}
          sessionId={sessionId}
          pr={prAberta}
          podeDecidir={podeDecidir}
          // AT-249 (RN-663): o gate que ainda falta, pela tarefa que a
          // `pr_open` carrega — aviso, o botão segue ativo.
          gatePendente={gatePendenteNoMerge(
            tarefaDaAcao(action, backlogQuery.data),
          )}
        />
      ) : null;
    // RN-155: NUNCA `action.seq` (bigserial global da tabela inteira,
    // incomparável com `event.seq`) — ver `ordemDaAcaoNaTimeline`.
    const ordem = ordemDaAcaoNaTimeline(action, events);
    items.push({
      seq: ordem,
      autor: `${action.actor.kind}:${action.actor.id}`,
      turno: turnoDoSeq(aberturas, ordem),
      // RN-172: a decisão que o agente pede é o DESFECHO do turno dele. O
      // eixo continua o da RN-155 (o `seq` do `proposed_action.created`),
      // que é honesto — a ação NASCE no meio do turno; o que muda é onde
      // ela é MOSTRADA, porque decidir é a última coisa que o turno pede.
      desfecho: true,
      agentId: action.actor.kind === 'agent' ? action.actor.id : undefined,
      // RN-177: a ação não é evento, mas o EVENTO que a representa no log é
      // `proposed_action.created` — classificar por ele mantém as duas
      // telas dizendo a mesma coisa sobre o mesmo fato.
      origem: origemDoEvento({
        type: 'proposed_action.created',
        actor: action.actor,
      }),
      // Sem `meta` com o modelo (achado I). O card recebia o modelo ATUAL da
      // sessão, então trocar o binding reescrevia retroativamente o rótulo de
      // TODA ação antiga — inclusive das que rodaram com outro modelo. Não há
      // fonte verdadeira: `proposed_actions` não guarda o modelo, e
      // `token_usage` não se liga à ação. Quem propôs já está no card, em
      // negrito, e é o AGENTE — que é o que não muda.
      node: (
        // AT-322: o card é o mesmo das outras superfícies; quem o centraliza
        // com teto de 560px no fio é este contêiner (RN-173).
        <div key={action.id} className={styles.acaoNoFio}>
        <ApprovalCard
          action={action}
          decisaoDaPolitica={decisaoDaPoliticaDaAcao(action.id, events)}
          // AT-256: devolve a promessa (o card segura os botões e diz a frase
          // da api) e refaz a lista MESMO na recusa — um 409 quer dizer que a
          // ação já saiu de `pending`, e a lista é quem troca o card pela
          // linha de desfecho. Sem poll novo: é UMA invalidação por clique.
          onApprove={() =>
            approveAction(projectId, sessionId, action.id).finally(invalidateActions)
          }
          onDeny={() => denyAction(projectId, sessionId, action.id).finally(invalidateActions)}
          onAlwaysAllow={() =>
            approveAlwaysAction(projectId, sessionId, action.id)
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ['permissions', projectId] });
              })
              .finally(invalidateActions)
          }
          onActivateAutoMode={
            podeAtivarAutoMode && action.actor.kind === 'agent'
              ? () => handleActivateAutoMode(action.actor.id)
              : undefined
          }
        />
        {mergear}
        </div>
      ),
    });
  }

  // Um único eixo numérico agora (RN-155): `event.seq` pros eventos, e a
  // posição resolvida por `ordemDaAcaoNaTimeline` pras ações — nunca mais
  // `action.seq` cru misturado com `event.seq`.
  //
  // O `sort` continua sendo a ORDEM DO LOG, e a regra de APRESENTAÇÃO da
  // RN-172 vem depois, numa passada separada e legível: quem lê daqui a um
  // ano vê que a timeline é ordenada pelo event log e que handoff/aprovação
  // são reposicionados por uma decisão de produto explícita — não vê um
  // comparador com três termos que ninguém sabe mais justificar.
  //
  // `agruparNarracoesDoTurno` entra DEPOIS de `afundarDesfechos` — colapsa
  // `agent.response` consecutivas do MESMO turno+autor, sem mexer na ordem
  // que a passada anterior já decidiu.
  return agruparNarracoesDoTurno(afundarDesfechos(items.sort((a, b) => a.seq - b.seq)), {
    titulo: t('turno.passosDoTurno'),
    trailing: (count) => t('turno.passosCount', { count }),
  });
}

/** A tarefa que a `pr_open` abriu (`storyTaskId` no payload), se o backlog carregado a tem. */
function tarefaDaAcao(acao: ProposedAction, epics: Epic[] | undefined): Task | undefined {
  const taskId = (acao.payload as { storyTaskId?: unknown } | null)?.storyTaskId;
  if (typeof taskId !== 'string') return undefined;
  for (const epic of epics ?? []) {
    for (const story of epic.stories) {
      const task = story.tasks.find((t) => t.id === taskId);
      if (task) return task;
    }
  }
  return undefined;
}
