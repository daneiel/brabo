import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptHandoff,
  activateExecution,
  approveAction,
  approveAlwaysAction,
  cancelAgentTurn,
  confirmArchitectureReadiness,
  confirmReadiness,
  denyAction,
  getProject,
  getSession,
  getSessionBudget,
  getSessionModelBinding,
  listModels,
  mensagemDaApi,
  promoteStories,
  renameSession,
  returnStory,
  sendAgentMessage,
  setSessionModelBinding,
  startAgent,
  transitionSession,
} from '../lib/api-client';
import { streamChatMessage } from '../lib/chat-stream';
import { connectSessionHeartbeat } from '../lib/session-channel';
import { useSessionEvents, useSessionEvent, usePendingActions, useHandoffs } from '../lib/hooks';
import { pollQueParaNoErro } from '../lib/query-policy';
import { emailDaSessao } from '../lib/auth';
import { AGENTS } from '../lib/agents';
import type {
  BusinessRulePayload,
  ProposedAction,
  SessionEvent,
  SessionStatus,
} from '../lib/api-types';
import { useToast } from '../components/ui/ToastProvider';
import { TokenMeter } from '../components/TokenMeter';
import { ModelPicker } from '../components/ModelPicker';
import { ApprovalCard } from '../components/ApprovalCard';
import { ActivityFeed } from '../components/ActivityFeed';
import { EventItem } from '../components/EventItem';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Disclosure } from '../components/ui/Disclosure';
import { Modal } from '../components/ui/Modal';
import { Textarea } from '../components/ui/Textarea';
import { lerFalhaDeTurno } from '../lib/session-falha';
import {
  LIMITE_DO_NOME,
  hashtagDaSessao,
  rotuloDaSessao,
} from '../lib/session-label';
import { TIPOS_DE_SESSAO } from '../lib/session-kind';
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  BulbIcon,
  ChevronRightIcon,
  LayoutSidebarIcon,
  ModelIcon,
  StackIcon,
  StopSquareIcon,
  UserIcon,
} from '../components/ui/icons';
import styles from './SessionPage.module.css';

interface SessionPageProps {
  projectId: string;
  sessionId: string;
  /** Evidência do Psicólogo (Fase 4b) — abre o log e rola até o evento. */
  highlightEvent?: string;
}

interface TimelineEntry {
  seq: number;
  node: ReactNode;
  /**
   * Autor-agente desta entrada (colapso por agente, RN-138) — só populado
   * para entradas que representam FALA/AÇÃO de um agente específico
   * (`agent.response`, `agent.error`, épico/história criados pelo PO, card
   * de aprovação). Ausente em entrada de usuário e em divisores/cards que
   * marcam uma TRANSIÇÃO (handoff, promoção de história): são pontos de
   * corte por natureza, e por isso sempre quebram um agrupamento em vez de
   * participar dele.
   */
  agentId?: string;
}

/**
 * O ponto de estado da barra de topo, derivado da máquina de estados da sessão
 * (`created → active → closing → closed | closed_abnormally`).
 *
 * Uma entrada por estado, sem `default` embutido: estado novo na máquina passa
 * a exigir uma decisão aqui em vez de herdar calado a aparência de "ao vivo".
 */
const PONTO_DA_SESSAO: Record<
  SessionStatus,
  { classe: 'pulsing' | 'statusDotParado' | 'statusDotFalha'; rotulo: string }
> = {
  created: { classe: 'statusDotParado', rotulo: 'ainda não ativada' },
  active: { classe: 'pulsing', rotulo: 'ativa' },
  closing: { classe: 'statusDotParado', rotulo: 'encerrando' },
  closed: { classe: 'statusDotParado', rotulo: 'encerrada' },
  closed_abnormally: { classe: 'statusDotFalha', rotulo: 'encerrada anormalmente' },
};

export function pontoDaSessao(status: SessionStatus | undefined) {
  // Sem sessão carregada ainda não é "encerrada": é desconhecido, e o ponto
  // fica apagado até o dado chegar.
  return status ? PONTO_DA_SESSAO[status] : { classe: 'statusDotParado' as const, rotulo: 'carregando' };
}

/**
 * Agentes que participam do fluxo de CHAT do composer (achado 9-fix) —
 * quem tem rota de `message` wireada no engine, não só `start`.
 *
 * Conferido em `agent_command_controller.ex`: há cláusula própria pra
 * po/dev-lead/arquiteto, e a última cláusula (sem guarda de agente) trata
 * qualquer outro valor — incluindo `"infra"` — como se fosse o Criativo.
 * Infra Lead nunca teve `message` wireada, só `start`; incluí-lo aqui faria
 * o composer mandar mensagens que o engine rotearia em silêncio pro agente
 * errado. Ele é propositivo (CLAUDE.md Fase 4), não conversacional pelo
 * composer.
 */
const AGENTES_DE_CHAT = ['criativo', 'po', 'arquiteto', 'dev-lead'] as const;

/**
 * `scrollIntoView` com guarda de existência (achado 10) — jsdom (ambiente de
 * teste) não implementa o método; chamá-lo direto quebra qualquer teste que
 * monte a tela com eventos na lista. Nos navegadores de verdade o método
 * sempre existe, então a guarda nunca muda o comportamento visível.
 */
function rolarParaOFim(el: HTMLElement | null) {
  el?.scrollIntoView?.({ block: 'end' });
}

/** Nome de exibição do agente; degrada para o id quando ele não está no roster. */
function nomeDoAgente(id: string | undefined): string {
  if (!id) return 'agente';
  return AGENTS[id as keyof typeof AGENTS]?.name ?? id;
}

/**
 * Cor do agente — a mesma do card, do avatar e da marca de handoff.
 *
 * O fallback é `--accent` porque nem todo ator é agente do roster: no chat sem
 * agente ativo quem responde é o MODELO, e `actor.id` é o slug dele.
 */
function corDoAgente(id: string | undefined): CSSProperties {
  const cor = id ? AGENTS[id as keyof typeof AGENTS]?.color : undefined;
  return { ['--msg-color' as string]: cor ?? 'var(--accent)' } as CSSProperties;
}

/**
 * O avatar do agente — mesma caixa `.avatar` que toda mensagem expandida já
 * usa (achado do problema 3: o cabeçalho do grupo colapsado tinha só o nome,
 * sem o ícone que identifica visualmente quem está falando).
 *
 * O ícone é o do ROSTER (`AGENTS[id].icon`), a mesma fonte que já identifica
 * "quem está falando" no indicador de streaming (`agenteExibido.icon`) — e
 * não o ícone por TIPO de evento que cada entrada expandida usa (`ModelIcon`
 * em `agent.response`, `StackIcon` em `backlog.*_created`, `AlertCircleIcon`
 * em `agent.error`). Um grupo colapsado mistura esses tipos: o cabeçalho
 * representa o AGENTE, não a última entrada dele, e só o ícone do roster é
 * estável para isso. Sem `id`, ou agente fora do roster, degrada para
 * `ModelIcon` — nunca para uma caixa vazia.
 */
function AvatarDoAgente({ id }: { id: string | undefined }) {
  const Icon =
    (id ? AGENTS[id as keyof typeof AGENTS]?.icon : undefined) ?? ModelIcon;
  return (
    <span className={styles.avatar}>
      <Icon size={15} />
    </span>
  );
}

export function SessionPage({
  projectId,
  sessionId,
  highlightEvent,
}: SessionPageProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  // O access token carrega o e-mail; o nome não vem mais em claim nenhuma
  // (Fase 7a). Para o rótulo de autoria da própria mensagem, o e-mail serve —
  // e o fallback cobre o instante entre o boot e a primeira renovação.
  const user = { name: emailDaSessao() };

  const [asideOpen, setAsideOpen] = useState(true);
  // Log completo de eventos — fechado por padrão, mas abre sozinho quando
  // a navegação traz um `highlightEvent` (chip de evidência do Psicólogo).
  const [logOpen, setLogOpen] = useState(!!highlightEvent);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  // QUEM está falando (achado C). O delta passou a carregar o agente; sem ele
  // a tela rotulava a bolha com o nome do MODELO, que é detalhe de execução.
  const [streamingAgent, setStreamingAgent] = useState<string | null>(null);
  // Espelho do `streaming` para os handlers do canal: eles são registrados uma
  // vez e enxergariam sempre o valor inicial do state.
  const streamingRef = useRef(false);
  // Achado B: o engine avisa "comecei a trabalhar" (`agent.status` "working")
  // bem antes do primeiro delta — handoff aceito dispara um kickoff
  // ASSÍNCRONO (`GenServer.cast`) no engine, ao contrário de handleSend/
  // handleReadiness, que são síncronos e já ligam `streaming` na hora. Sem
  // isto, entre aceitar o handoff e o agente responder a tela não mostra
  // nada — só o silêncio, que é indistinguível de "não vai acontecer nada".
  //
  // `turnoAgentRef` guarda QUEM está prestes a responder, fixado no clique
  // que disparou o turno (`handleAcceptHandoff`) — não no roster derivado dos
  // eventos (`activeAgent`), que só reflete o `agent.activated` persistido
  // depois de um round-trip e podia perder a corrida com o broadcast do
  // canal, que é bem mais rápido.
  const turnoAgentRef = useRef<string | null>(null);
  // Agente identificado pelo `agent.status` "working" enquanto NENHUM delta
  // chegou ainda pra este turno. `null` assim que o primeiro delta chega (o
  // bloco de streaming já cobre) ou o turno termina.
  const [statusAgent, setStatusAgent] = useState<string | null>(null);
  // Indicador de "pensando" (bolha com os 3 pontinhos, RN-131) — só liga
  // depois de 5s SEM nenhum texto chegar, e não no instante em que o turno
  // começa. Antes ele piscava em toda mensagem, mesmo nas que respondiam em
  // menos de um segundo — ruído visual pra maioria dos turnos, que é o efeito
  // contrário do que um indicador de espera deveria ter. Ver o efeito que
  // arma/desarma o timer, logo abaixo de `agenteExibido`.
  const [pensandoVisivel, setPensandoVisivel] = useState(false);
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null);
  // Renomear (RN-098). `null` fora de edição — e não string vazia — porque
  // vazio é um nome que se está digitando, e nenhum campo aberto é outro
  // estado.
  const [rascunhoDoNome, setRascunhoDoNome] = useState<string | null>(null);
  // Promoção inline de história (RN-126) — o mesmo mecanismo de
  // `PromotionQueue` (ProjectBacklogTab.tsx), só que disparado a partir do
  // card no fio em vez da aba Backlog. `promovendoStoryId` é o id em voo (só
  // um por vez, como o resto da tela); `recusandoStory` abre o modal de
  // motivo, espelhando o padrão do backlog.
  const [promovendoStoryId, setPromovendoStoryId] = useState<string | null>(null);
  const [recusandoStory, setRecusandoStory] = useState<{ id: string; title: string } | null>(null);
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const [enviandoRecusa, setEnviandoRecusa] = useState(false);
  // Ativação inline da execução, a partir do card de aceite do handoff pro
  // Dev Lead (achado do problema 2) — mesmo padrão de `promovendoStoryId`.
  const [ativandoExecucao, setAtivandoExecucao] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  // Achado 10: sentinela no fim da lista de mensagens — a sessão abre nela,
  // em vez de abrir no TOPO (mais antigas primeiro), que era o comportamento
  // sem NENHUM scroll automático.
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const abriuNoFimRef = useRef(false);

  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) });
  const { data: session } = useQuery({
    queryKey: ['session', projectId, sessionId],
    queryFn: () => getSession(projectId, sessionId),
    refetchInterval: pollQueParaNoErro(5000),
  });
  // Extraído para cima do bloco de rótulo/hashtag/tipo (onde vivia antes): o
  // card de handoff inline no fio (RN-125) precisa da mesma pergunta antes
  // de a timeline ser montada, e computá-la duas vezes criaria duas fontes
  // da mesma verdade.
  const isActive = session?.status === 'active';

  // Achados 2/7: o poll pausa ENQUANTO um turno está em streaming — buscar
  // eventos já persistidos no meio do turno duplicava a bolha (o dado novo
  // renderiza ao lado do estado otimista/streaming que ainda está na tela).
  // O fim do turno (`finalizarTurnoDoAgente`, nos dois caminhos: canal e rede
  // de segurança do `handleSend`) já invalida esta query explicitamente —
  // pausar o TIMER não perde dado, só evita buscar de novo o que a
  // invalidação busca de qualquer forma.
  const eventsQuery = useSessionEvents(projectId, sessionId, 3000, streaming);
  const events = eventsQuery.data?.items ?? [];

  // O evento CITADO buscado pelo id. A listagem traz só os últimos 200 e o
  // feed corta ruído de máquina, então sem esta busca o chip de evidência
  // podia navegar pra um log onde o evento simplesmente não aparece.
  const citedEventQuery = useSessionEvent(projectId, sessionId, highlightEvent);
  const citedEvent = citedEventQuery.data;
  const actionsQuery = usePendingActions(projectId, sessionId, 3000);
  const actions = actionsQuery.data?.items ?? [];

  // Navegação de evidência (Fase 4b): rola até o evento assim que ele
  // existir no DOM — depende do log estar aberto E dos eventos já terem
  // chegado pelo poll, daí a dependência em `events.length`.
  useEffect(() => {
    if (!highlightEvent || !logOpen) return;
    document
      .getElementById(`event-${highlightEvent}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightEvent, logOpen, events.length]);

  // Achado 10: a sessão abre sempre na ÚLTIMA mensagem. Roda uma vez, assim
  // que a primeira leva de eventos chega — a navegação de evidência do
  // Psicólogo (efeito acima) tem prioridade quando existe `highlightEvent`,
  // e por isso este nem tenta rolar nesse caso.
  useEffect(() => {
    if (highlightEvent || abriuNoFimRef.current || events.length === 0) return;
    rolarParaOFim(messagesEndRef.current);
    abriuNoFimRef.current = true;
  }, [highlightEvent, events.length]);

  // Mensagem nova (evento persistido ou delta de streaming) acompanha o fim
  // SE o usuário já estava lá — não arranca o scroll de quem subiu pra reler
  // o histórico. Só entra em jogo depois da abertura inicial.
  useEffect(() => {
    if (!abriuNoFimRef.current) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const pertoDoFim =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (pertoDoFim) rolarParaOFim(messagesEndRef.current);
  }, [events.length, streamingText]);

  const handoffsQuery = useHandoffs(projectId, sessionId, 3000);
  const handoffs = handoffsQuery.data ?? [];

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

  // Handoff oferecido ainda não aceito → botão de aceitar, restrito a quem
  // CONVERSA nesta tela (RN-136). `handoffs` vem ordenado por `createdAt`
  // ASC (mais antigo primeiro — ver `DrizzleHandoffRepository#findBySession`),
  // e `OfferInfraHandoffUseCase` oferece o handoff pro Infra ANTES do Dev
  // Lead, na MESMA confirmação (FASE 14d) — um `.find()` sem este filtro
  // resolvia sempre pro mais antigo ainda pendente, e como Infra nunca é
  // aceito por AQUI (ele não é conversacional, nem está em
  // `AGENTES_DE_CHAT`), o card do Dev Lead só virava acionável DEPOIS de
  // alguém aceitar o de Infra num lugar que esta tela não mostra — na
  // prática, nunca. O handoff pro Infra continua NARRADO no fio (o
  // `handoff.offered` dele vira divisor mudo, já que nunca é "a oferta
  // atual"); só o card ACIONÁVEL é que fica restrito a quem sabe responder
  // aqui.
  const offeredHandoff = handoffs.find(
    (h) =>
      h.status === 'offered' &&
      !activeFor(h.toAgent) &&
      (AGENTES_DE_CHAT as readonly string[]).includes(h.toAgent),
  );

  // Reconciliação de fim de turno do `activeAgent` — o que `onAgentDone` (canal)
  // faz, extraído pra também servir de REDE DE SEGURANÇA em `handleSend` (ver
  // abaixo). Idempotente: chamar duas vezes pro mesmo turno (canal E fallback)
  // só reseta estado que já estava resetado e invalida query que já está fresca.
  const finalizarTurnoDoAgente = useCallback(() => {
    streamingRef.current = false;
    setStreaming(false);
    setStreamingText('');
    setStreamingAgent(null);
    setOptimisticUser(null);
    // Fim do turno também encerra o indicador de "comecei a trabalhar"
    // (achado B) — senão ele sobrevive a um turno que nunca chegou a
    // streamar texto nenhum (só ferramentas, por exemplo).
    turnoAgentRef.current = null;
    setStatusAgent(null);
    queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
    queryClient.invalidateQueries({ queryKey: ['session-handoffs', projectId, sessionId] });
    queryClient.invalidateQueries({ queryKey: ['session-budget', projectId, sessionId] });
  }, [queryClient, projectId, sessionId]);

  // Canal Phoenix: recebe os deltas do Criativo (streaming token-a-token) e o
  // fim do turno. A persistência (agent.response + artefatos) chega pelo poll.
  useEffect(() => {
    if (session?.status !== 'active') return;
    const disconnect = connectSessionHeartbeat(projectId, sessionId, {
      onAgentDelta: (text, agent) => {
        streamingRef.current = true;
        setStreaming(true);
        setStreamingText((t) => t + text);
        if (agent) setStreamingAgent(agent);
        // O delta é o streaming de verdade — o indicador de "comecei a
        // trabalhar" (achado B) já cumpriu o papel dele.
        setStatusAgent(null);
      },
      onAgentDone: finalizarTurnoDoAgente,
      // Achado B: `agent.status` "working" chega bem antes do primeiro
      // delta quando o turno é disparado por um kickoff ASSÍNCRONO no engine
      // (handoff aceito, `GenServer.cast`) — ao contrário de handleSend/
      // handleReadiness, que já ligam `streaming` na hora por serem
      // síncronos. Só vira indicador se NENHUM delta chegou ainda pra este
      // turno (`streamingRef`); senão o bloco de streaming já cobre.
      onAgentStatus: (payload) => {
        if (payload.status === 'working') {
          if (!streamingRef.current) setStatusAgent(turnoAgentRef.current);
        } else {
          setStatusAgent(null);
        }
      },
      // Fase 4a — painel do time ao vivo: qualquer evento persistido
      // (Dev/QA/SecOps/Infra) antecipa o refetch do polling — reaproveita o
      // parsing/cache já existente (useSessionEvents), só antecipa quando o
      // dado muda em vez de esperar o intervalo do poll.
      // Enquanto um turno conversacional está streamando, NÃO antecipa o
      // refetch: a bolha ao vivo é uma prévia do `agent.response` que está para
      // ser persistido, e trazer o evento antes de `agent.done` põe as duas na
      // tela ao mesmo tempo — a duplicação do achado C. `onAgentDone` invalida
      // logo em seguida, então nada se perde; só deixa de aparecer duas vezes.
      onEvent: () => {
        if (streamingRef.current) return;
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      },
    });
    return disconnect;
  }, [session?.status, sessionId, projectId, queryClient, finalizarTurnoDoAgente]);

  const { data: modelsByCategory } = useQuery({
    // A chave carrega o projeto porque a lista é do WORKSPACE dele (ADR 0049):
    // um cache global devolveria a curadoria de outro workspace.
    queryKey: ['models', projectId],
    queryFn: () => listModels(projectId),
  });
  // Achado 1: `agentId` viaja na query pra a cascata rodar pro agente
  // REALMENTE ativo (sessão→agente→área→projeto→workspace, ver
  // `RunLlmTurnUseCase`) — sem ele a api só enxerga sessão→projeto→workspace
  // (mais o fallback fixo pro Criativo) e a topbar continuava mostrando o
  // modelo do Criativo depois de um handoff pro PO/Arquiteto/Dev Lead.
  // `activeAgent` entra na queryKey pra a troca de agente ativo refazer a
  // busca em vez de servir o binding do agente anterior do cache.
  const { data: resolvedBinding } = useQuery({
    queryKey: ['session-model-binding', projectId, sessionId, activeAgent],
    queryFn: () => getSessionModelBinding(projectId, sessionId, activeAgent ?? undefined),
  });
  const { data: budget } = useQuery({
    queryKey: ['session-budget', projectId, sessionId],
    queryFn: () => getSessionBudget(projectId, sessionId),
    refetchInterval: pollQueParaNoErro(5000),
  });

  // O agente que está streamando agora, quando o delta disse quem é (achado C).
  const agenteFalando = streamingAgent
    ? AGENTS[streamingAgent as keyof typeof AGENTS]
    : undefined;
  // O agente exibido no indicador — delta tem prioridade (é o dado mais
  // recente); na ausência dele, o `agent.status` "working" (achado B), que
  // pode ter chegado sem streamingAgent nenhum ainda. Degrada para "agente"
  // genérico nos dois casos — nunca para o nome do modelo.
  const agenteExibido =
    agenteFalando ??
    (statusAgent ? AGENTS[statusAgent as keyof typeof AGENTS] : undefined);

  // Arma/desarma o timer de 5s do indicador de "pensando" (RN-131). Só conta
  // o tempo enquanto há turno em curso (`streaming`/`statusAgent`) E nenhum
  // texto chegou ainda — os dois viram `false` de novo assim que qualquer um
  // dos dois deixa de valer: texto chegando (streaming REAL não espera nada,
  // aparece na hora) ou o turno terminando antes dos 5s (a resposta foi
  // rápida, e o indicador nunca deveria ter existido). O timer é cancelado no
  // cleanup do próprio efeito sempre que uma dessas dependências muda, então
  // nunca liga `pensandoVisivel` depois do fato.
  useEffect(() => {
    if (!(streaming || statusAgent) || streamingText) {
      setPensandoVisivel(false);
      return;
    }
    const timer = setTimeout(() => setPensandoVisivel(true), 5000);
    return () => clearTimeout(timer);
  }, [streaming, statusAgent, streamingText]);

  // A CONVERSA começou? (achado G, revisto por investigação AO VIVO — RN-131)
  // O critério ERA "existe `chat.message`/`agent.response`", pra não confundir
  // os cards do bootstrap do git com conversa — mas isso tinha o efeito
  // contrário do pretendido: uma sessão criada pelo `git-bootstrap` (5 ações
  // de commit/branch já aprovadas, ZERO chat.message) continuava com o
  // convite por cima, e o mesmo acontecia — pior — na sessão que a ativação
  // de execução usa, com dezenas de eventos reais (`tool.call`, `tool.result`,
  // eventos de task) e nenhum `chat.message`/`agent.response`: o convite
  // cobria o histórico de execução inteiro. A pergunta certa não é "existe
  // MENSAGEM", é "esta sessão tem QUALQUER evento" — sessão nova é a única
  // que não tem nenhum.
  const conversaComecou = events.length > 0;

  // A prontidão já foi declarada? (achado L) O handoff que sai do Criativo é a
  // consequência dela — existindo, o botão não tem mais o que oferecer.
  const prontidaoJaDeclarada = handoffs.some((h) => h.fromAgent === 'criativo');
  // Espelho de `prontidaoJaDeclarada`, para o Arquiteto (problema 1):
  // `OfferInfraHandoffUseCase` oferece o handoff ao Infra (e ao Dev Lead) na
  // MESMA confirmação — a existência de QUALQUER handoff saindo do Arquiteto
  // já prova que a confirmação aconteceu.
  const arquiteturaJaDeclarada = handoffs.some((h) => h.fromAgent === 'arquiteto');

  const invalidateActions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['session-actions', projectId, sessionId] });
  }, [queryClient, projectId, sessionId]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const items: TimelineEntry[] = [];
    // O evento que representa a oferta de handoff ATUAL (ainda não aceita) —
    // o `handoff.offered` mais RECENTE com o mesmo par fromAgent/toAgent de
    // `offeredHandoff` (RN-125). O payload do evento não carrega o id do
    // handoff, então o par + "mais recente" é o jeito de achar QUAL entrada
    // da timeline vira o card acionável, sem reabrir um convite de aceite
    // que uma oferta mais antiga pro mesmo par já tenha resolvido.
    const offeredHandoffEventSeq = offeredHandoff
      ? events.reduce((maisRecente, e) => {
          const paraOMesmoPar =
            e.type === 'handoff.offered' &&
            e.actor.id === offeredHandoff.fromAgent &&
            (e.payload as { toAgent?: string })?.toAgent === offeredHandoff.toAgent;
          return paraOMesmoPar ? Math.max(maisRecente, e.seq) : maisRecente;
        }, -1)
      : -1;
    for (const event of events) {
      if (event.type === 'chat.message') {
        const text = typeof (event.payload as { text?: unknown })?.text === 'string' ? (event.payload as { text: string }).text : '';
        items.push({
          seq: event.seq,
          node: (
            <div
              className={styles.message}
              key={event.id}
              style={{ ['--msg-color' as string]: 'var(--accent)' } as CSSProperties}
            >
              <span className={[styles.avatar, styles.user].join(' ')}>
                <UserIcon size={15} />
              </span>
              <div className={styles.messageBody}>
                <div className={styles.messageHeader}>
                  <span className={styles.messageName}>{user.name ?? 'Você'}</span>
                </div>
                <div className={styles.bubble}>{text}</div>
              </div>
            </div>
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
        const isOfertaAtual = isActive && event.seq === offeredHandoffEventSeq;
        items.push({
          seq: event.seq,
          node: isOfertaAtual ? (
            <div className={styles.handoffCard} key={event.id}>
              <span className={styles.handoffPill}>
                <span className={styles.handoffAgent} style={corDoAgente(event.actor.id)}>
                  {nomeDoAgente(event.actor.id)}
                </span>
                <ChevronRightIcon size={13} />
                passou o bastão ao
                <span className={styles.handoffAgent} style={corDoAgente(toAgent)}>
                  {nomeDoAgente(toAgent)}
                </span>
              </span>
              <Button
                variant="success"
                onClick={() => handleAcceptHandoff(offeredHandoff!.id, offeredHandoff!.toAgent)}
              >
                Aceitar handoff e iniciar {offeredHandoff!.toAgent}
              </Button>
              {/* Handoff pro Dev Lead é o início da EXECUÇÃO — quem aceita
                  precisa saber onde acompanhar depois (RN-125). As outras
                  ofertas (PO, Arquiteto…) continuam na própria sessão, então
                  não ganham o link: não há "onde mais olhar" pra elas. */}
              {toAgent === 'dev-lead' && (
                <>
                  {/* Atalho pra quem já sabe o que quer (RN-137): ativa a
                      execução direto daqui, sem passar pela conversa com o
                      Dev Lead — mesma `activateExecution` da Visão Geral. */}
                  <Button
                    variant="primary"
                    loading={ativandoExecucao}
                    onClick={handleActivateExecution}
                  >
                    Ativar execução
                  </Button>
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId }}
                    search={{ tab: 'executores' }}
                    className={styles.timelineLink}
                  >
                    Acompanhe a execução em Executores
                    <ChevronRightIcon size={11} />
                  </Link>
                </>
              )}
            </div>
          ) : (
            <div className={styles.handoffDivider} key={event.id}>
              <span className={styles.handoffPill}>
                <span className={styles.handoffAgent} style={corDoAgente(event.actor.id)}>
                  {nomeDoAgente(event.actor.id)}
                </span>
                <ChevronRightIcon size={13} />
                passou o bastão ao
                <span className={styles.handoffAgent} style={corDoAgente(toAgent)}>
                  {nomeDoAgente(toAgent)}
                </span>
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
        // quem já soubesse ir olhar lá. Mesmo corpo de `.message`/`.bubble`
        // das outras entradas do agente — só o conteúdo (título + link) é
        // novo.
        const payload = event.payload as { title?: unknown };
        const titulo = typeof payload?.title === 'string' ? payload.title : '(sem título)';
        const rotuloDoTipo =
          event.type === 'backlog.epic_created' ? 'Épico criado' : 'História criada';
        items.push({
          seq: event.seq,
          agentId: event.actor.kind === 'agent' ? event.actor.id : undefined,
          node: (
            <div className={styles.message} key={event.id} style={corDoAgente(event.actor.id)}>
              <span className={styles.avatar}>
                <StackIcon size={15} />
              </span>
              <div className={styles.messageBody}>
                <div className={styles.messageHeader}>
                  <span className={styles.messageName}>{nomeDoAgente(event.actor.id)}</span>
                  <span className={styles.messageMeta}>{rotuloDoTipo}</span>
                </div>
                <div className={styles.bubble}>
                  {titulo}
                  <div>
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId }}
                      search={{ tab: 'backlog' }}
                      className={styles.timelineLink}
                    >
                      Ver no Backlog
                      <ChevronRightIcon size={11} />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ),
        });
      } else if (event.type === 'backlog.story_promotion_proposed') {
        // Promoção inline (RN-126) — a decisão que RN-048 já resolve na aba
        // Backlog ganha um segundo lugar: o fio da própria sessão do PO, onde
        // a história nasceu. Mesmo mecanismo (`promoteStories`/`returnStory`),
        // sem endpoint novo. O card fica ACIONÁVEL só enquanto NENHUM evento
        // posterior já decidiu o destino desta história — promovida
        // (`backlog.story_transitioned`, que `PromoteStoriesUseCase` emite via
        // `TransitionStoryUseCase`) ou devolvida
        // (`backlog.story_promotion_returned`). Sem esta checagem, promover ou
        // devolver deixaria os mesmos dois botões plantados no fio, oferecendo
        // a mesma decisão de novo sobre uma história que já saiu da fila.
        const payload = event.payload as { storyId?: unknown; title?: unknown };
        const storyId = typeof payload?.storyId === 'string' ? payload.storyId : undefined;
        const titulo = typeof payload?.title === 'string' ? payload.title : '(sem título)';
        const resolvida =
          !storyId ||
          events.some(
            (e) =>
              e.seq > event.seq &&
              ((e.type === 'backlog.story_transitioned' &&
                (e.payload as { storyId?: unknown })?.storyId === storyId) ||
                (e.type === 'backlog.story_promotion_returned' &&
                  (e.payload as { storyId?: unknown })?.storyId === storyId)),
          );
        items.push({
          seq: event.seq,
          node:
            !resolvida && storyId ? (
              <div className={styles.handoffCard} key={event.id}>
                <span className={styles.handoffPill}>
                  <StackIcon size={13} />
                  história &quot;{titulo}&quot; pronta, aguardando sua promoção
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    variant="success"
                    disabled={promovendoStoryId === storyId}
                    loading={promovendoStoryId === storyId}
                    onClick={() => handlePromoteStory(storyId)}
                  >
                    Promover
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={promovendoStoryId === storyId}
                    onClick={() => {
                      setRecusandoStory({ id: storyId, title: titulo });
                      setMotivoRecusa('');
                    }}
                  >
                    Devolver
                  </Button>
                </div>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId }}
                  search={{ tab: 'backlog' }}
                  className={styles.timelineLink}
                >
                  Ver no Backlog
                  <ChevronRightIcon size={11} />
                </Link>
              </div>
            ) : (
              <div className={styles.handoffDivider} key={event.id}>
                <span className={styles.handoffPill}>
                  <StackIcon size={13} />
                  história &quot;{titulo}&quot; esteve aguardando sua promoção
                </span>
              </div>
            ),
        });
      } else if (event.type === 'backlog.story_promotion_returned') {
        // Narração simétrica ao card acima (RN-126) — mesma frase que
        // `activity.ts` já usa no log colapsado da sidebar, reaproveitada
        // aqui em vez de reinventada.
        const payload = event.payload as { title?: unknown; reason?: unknown };
        const titulo = typeof payload?.title === 'string' ? payload.title : 'uma história';
        const motivo = typeof payload?.reason === 'string' ? payload.reason : 'sem motivo';
        items.push({
          seq: event.seq,
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
                  <span className={styles.messageName}>{user.name ?? 'Você'}</span>
                  <span className={styles.messageMeta}>devolveu ao PO</span>
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
        };
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
        // rótulo genérico "modelo", nunca para `undefined`/`null` na tela.
        const modelName =
          typeof payload?.modelName === 'string' && payload.modelName !== ''
            ? payload.modelName
            : undefined;
        items.push({
          seq: event.seq,
          agentId: event.actor.kind === 'agent' ? event.actor.id : undefined,
          node: (
            <div className={styles.message} key={event.id} style={corDoAgente(event.actor.id)}>
              <span className={styles.avatar}>
                <ModelIcon size={15} />
              </span>
              <div className={styles.messageBody}>
                <div className={styles.messageHeader}>
                  <span className={styles.messageName}>{nomeDoAgente(event.actor.id)}</span>
                  <span className={styles.messageMeta}>{modelName ?? 'modelo'}</span>
                </div>
                {/* Resposta vazia é evento ANTIGO: até a RN-059, falha de
                    turno era gravada como `agent.response` com conteúdo "" —
                    e a tela mostrava um balão em branco, indistinguível de um
                    agente que não teve o que dizer. Os eventos já gravados não
                    se apagam, então a tela os NOMEIA. */}
                {text === '' ? (
                  <div className={[styles.bubble, styles.bubbleVazio].join(' ')}>
                    Resposta vazia — evento anterior à RN-059, quando falha de
                    turno era gravada como resposta em branco. O motivo real
                    não foi registrado.
                  </div>
                ) : (
                  <div className={styles.bubble}>{text}</div>
                )}
              </div>
            </div>
          ),
        });
      } else if (event.type === 'agent.error') {
        // O agente FALA a falha, no mesmo fio. Antes o motivo ia só por
        // broadcast (efêmero) e o log guardava uma resposta vazia — quem
        // abrisse a sessão depois via um balão em branco e nada mais.
        const { mensagem, origem } = lerFalhaDeTurno(event.payload);
        items.push({
          seq: event.seq,
          agentId: event.actor.kind === 'agent' ? event.actor.id : undefined,
          node: (
            <div
              className={styles.message}
              key={event.id}
              style={{ ['--msg-color' as string]: 'var(--danger)' } as CSSProperties}
            >
              <span className={styles.avatar}>
                <AlertCircleIcon size={15} />
              </span>
              <div className={styles.messageBody}>
                <div className={styles.messageHeader}>
                  <span className={styles.messageName}>{nomeDoAgente(event.actor.id)}</span>
                  {/* A ORIGEM fica visível: é ela que diz se o próximo passo é
                      trocar a chave, esperar o provider ou abrir um bug. */}
                  <span className={styles.messageMeta}>falha · origem {origem}</span>
                </div>
                <div className={[styles.bubble, styles.bubbleFalha].join(' ')}>
                  {mensagem}
                </div>
              </div>
            </div>
          ),
        });
      }
    }

    for (const action of actions) {
      items.push({
        seq: action.seq,
        agentId: action.actor.kind === 'agent' ? action.actor.id : undefined,
        // Sem `meta` com o modelo (achado I). O card recebia o modelo ATUAL da
        // sessão, então trocar o binding reescrevia retroativamente o rótulo de
        // TODA ação antiga — inclusive das que rodaram com outro modelo. Não há
        // fonte verdadeira: `proposed_actions` não guarda o modelo, e
        // `token_usage` não se liga à ação. Quem propôs já está no card, em
        // negrito, e é o AGENTE — que é o que não muda.
        node: (
          <ApprovalCard
            key={action.id}
            action={action}
            variant="chat"
            onApprove={() => approveAction(projectId, sessionId, action.id).then(invalidateActions)}
            onDeny={() => denyAction(projectId, sessionId, action.id).then(invalidateActions)}
            onAlwaysAllow={() =>
              approveAlwaysAction(projectId, sessionId, action.id).then(() => {
                invalidateActions();
                queryClient.invalidateQueries({ queryKey: ['permissions', projectId] });
              })
            }
          />
        ),
      });
    }

    return items.sort((a, b) => a.seq - b.seq);
  }, [
    events,
    actions,
    projectId,
    sessionId,
    user.name,
    queryClient,
    invalidateActions,
    offeredHandoff,
    isActive,
    promovendoStoryId,
    ativandoExecucao,
  ]);

  // Colapso de mensagens por agente depois que ele passa o bastão (RN-138) —
  // segunda passagem sobre `timeline`, agrupando entradas CONSECUTIVAS do
  // MESMO `agentId`. Um agente só é elegível quando (a) ele já ofereceu um
  // handoff ACEITO (bastão passado — `handoffs`, não o event log: o status
  // já É a mesma verdade, e sem round-trip por evento) e (b) nenhuma ação
  // dele segue `pending` (a corrida de aprovação não pode ficar escondida
  // atrás de um clique). Entradas sem `agentId` (usuário, divisores/cards de
  // transição) sempre quebram a sequência corrente, exatamente como uma
  // troca de agente quebra.
  const timelineAgrupada = useMemo(() => {
    const passaramBastao = new Set(
      handoffs.filter((h) => h.status === 'accepted').map((h) => h.fromAgent),
    );
    const comAcaoPendente = new Set(
      actions.filter((a) => a.status === 'pending').map((a) => a.actor.id),
    );
    const colapsavel = (agentId: string) =>
      passaramBastao.has(agentId) && !comAcaoPendente.has(agentId);

    const resultado: { key: string; node: ReactNode }[] = [];
    let corrente: TimelineEntry[] = [];

    function fecharCorrente() {
      if (corrente.length === 0) return;
      const agentId = corrente[0].agentId;
      // Só vira cabeçalho colapsável com 2+ entradas — uma sozinha não ganha
      // nada em virar "Fulano · 1 mensagem" no lugar da própria mensagem.
      if (agentId && corrente.length >= 2 && colapsavel(agentId)) {
        const grupo = corrente;
        resultado.push({
          key: `grupo-${agentId}-${grupo[0].seq}`,
          node: (
            <div style={corDoAgente(agentId)}>
              <Disclosure
                titulo={
                  <span className={styles.agentGroupTitulo}>
                    <AvatarDoAgente id={agentId} />
                    {nomeDoAgente(agentId)}
                  </span>
                }
                trailing={`${grupo.length} mensagens`}
                classNameCabecalho={styles.agentGroupCabecalho}
                className={styles.agentGroup}
              >
                <div className={styles.agentGroupRegiao}>
                  {grupo.map((e) => (
                    <div key={e.seq}>{e.node}</div>
                  ))}
                </div>
              </Disclosure>
            </div>
          ),
        });
      } else {
        for (const e of corrente) {
          resultado.push({ key: String(e.seq), node: e.node });
        }
      }
      corrente = [];
    }

    for (const entry of timeline) {
      if (entry.agentId && corrente[0]?.agentId === entry.agentId) {
        corrente.push(entry);
        continue;
      }
      fecharCorrente();
      if (entry.agentId) {
        corrente = [entry];
      } else {
        resultado.push({ key: String(entry.seq), node: entry.node });
      }
    }
    fecharCorrente();

    return resultado;
  }, [timeline, handoffs, actions]);

  async function handleActivate() {
    await transitionSession(projectId, sessionId, 'active');
    queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
  }

  async function handleClose() {
    await transitionSession(projectId, sessionId, 'closing');
    await transitionSession(projectId, sessionId, 'closed');
    queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
    queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
  }

  async function handleRename() {
    if (rascunhoDoNome === null) return;
    // Em branco APAGA o nome: `null` no corpo é o caminho de desfazer, e a
    // sessão volta a se identificar só pela hashtag.
    const nome = rascunhoDoNome.trim() || null;
    setRascunhoDoNome(null);
    try {
      await renameSession(projectId, sessionId, nome);
      await queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
      // A lista da aba Sessões mostra o mesmo rótulo — sem isto, o nome novo
      // só apareceria lá no próximo carregamento da tela.
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível renomear a sessão', tone: 'danger' });
    }
  }

  async function handleStartIdeation() {
    try {
      await startAgent(projectId, sessionId, 'criativo');
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível iniciar a ideação', tone: 'danger' });
    }
  }

  async function handleReadiness() {
    try {
      setStreaming(true);
      setStreamingText('');
      await confirmReadiness(projectId, sessionId);
      // O product_brief + handoff chegam via o canal (agent.done) + poll.
      //
      // Rede de segurança (RN-131), espelhando `handleSend` (ver o comentário
      // lá): `confirmReadiness` também é um `GenServer.call` síncrono no
      // engine (até 120s), e o canal Phoenix pode não ter terminado de
      // conectar (ticket + join, RN-108) quando o turno acaba — o broadcast
      // de `agent.done` se perde e, sem isto, a bolha do agente ficava presa
      // vazia pra sempre, já que só `onAgentDone` resetava
      // `streaming`/`streamingText`/`statusAgent` no caminho de sucesso.
      // Resolver esta chamada é sinal de fim de turno tão confiável quanto
      // `agent.done`, e `finalizarTurnoDoAgente` é idempotente — chamar de
      // novo quando o canal também entrega o evento não tem efeito.
      finalizarTurnoDoAgente();
    } catch {
      setStreaming(false);
      showToast({ title: 'Erro', message: 'Não foi possível confirmar prontidão', tone: 'danger' });
    }
  }

  /**
   * Mirror de `handleReadiness`, para o Arquiteto (achado do problema 1):
   * dispara `OfferInfraHandoffUseCase`, que oferece o handoff ao Infra e ao
   * Dev Lead na MESMA confirmação (FASE 14d) — o Arquiteto narra a arquitetura
   * pronta no fio, e os dois handoffs nascem em seguida. Mesma rede de
   * segurança do `handleReadiness`: `confirmArchitectureReadiness` também é
   * um `GenServer.call` síncrono no engine, e o canal Phoenix pode não ter
   * terminado de conectar quando o turno acaba — resolver esta chamada é
   * sinal de fim de turno tão confiável quanto `agent.done`, e
   * `finalizarTurnoDoAgente` é idempotente.
   */
  async function handleArchitectureReadiness() {
    try {
      setStreaming(true);
      setStreamingText('');
      await confirmArchitectureReadiness(projectId, sessionId);
      finalizarTurnoDoAgente();
    } catch {
      setStreaming(false);
      showToast({
        title: 'Erro',
        message: 'Não foi possível confirmar a arquitetura',
        tone: 'danger',
      });
    }
  }

  async function handleAcceptHandoff(handoffId: string, toAgent: string) {
    // Fixado ANTES do `await` (achado B): o kickoff do agente no engine é um
    // `GenServer.cast` assíncrono, e o `agent.status` "working" pode chegar
    // pelo canal antes mesmo desta chamada resolver. Sem o ref pronto agora,
    // o handler perderia a corrida e o indicador nasceria sem saber quem é.
    turnoAgentRef.current = toAgent;
    try {
      await acceptHandoff(projectId, sessionId, handoffId);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-handoffs', projectId, sessionId] });
    } catch {
      turnoAgentRef.current = null;
      showToast({ title: 'Erro', message: 'Não foi possível aceitar o handoff', tone: 'danger' });
    }
  }

  /**
   * Atalho de ativação da execução, embutido no próprio card de aceite do
   * handoff pro Dev Lead (RN-137) — MESMA `activateExecution` que a Visão
   * Geral já chama, e não uma rota nova.
   *
   * `sessionId` viaja como `originSessionId` (RN-135/PR #266): sem ele a
   * sessão de chat que trouxe o Dev Lead ficava `active` para sempre, mesmo
   * com a execução (numa sessão SEPARADA) já tendo decolado sozinha por
   * este atalho.
   *
   * Autorização: `POST .../execution/activate` continua exigindo
   * `maintainer` no backend — DELIBERADAMENTE não alinhada ao `developer`
   * que basta pra aceitar o handoff. Quem ativa vira `session.createdBy` da
   * sessão de execução, e `ProposeActionUseCase` resolve o papel EFETIVO
   * dos `git_commit`/`git_push`/`pr_open` dos dev agents a partir dele (ver
   * o comentário em `ExecutionController#activate`) — soltar a exigência
   * aqui inverteria essa resolução em silêncio: as PRs que a execução abre
   * passariam de `auto_approve` para `require_approval` sempre que quem
   * clicou for `developer`, e ninguém decidiu isso explicitamente. Quem não
   * é maintainer recebe a frase real da api (`mensagemDaApi`, "Papel
   * insuficiente para esta ação"), não um erro genérico.
   *
   * module_map: sem gate próprio aqui. Quando este card existe, o
   * Arquiteto já o definiu — é o artefato que precede a oferta do handoff
   * pro Dev Lead —, então replicar o `disabled={!hasModuleMap}` da Visão
   * Geral travaria o botão à toa; o caso raro cai no catch abaixo.
   */
  async function handleActivateExecution() {
    if (ativandoExecucao) return;
    setAtivandoExecucao(true);
    try {
      await activateExecution(projectId, sessionId);
      await queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
      queryClient.invalidateQueries({ queryKey: ['session-handoffs', projectId, sessionId] });
      showToast({ title: 'Execução ativada', tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, 'Não foi possível ativar a execução'),
        tone: 'danger',
      });
    } finally {
      setAtivandoExecucao(false);
    }
  }

  // Promoção inline (RN-126) — mesmos `promoteStories`/`returnStory` que
  // `PromotionQueue` já chama; só o gatilho muda, do botão na aba Backlog
  // pro card no fio. `promoteStories` é sempre lote (mesmo pra uma história),
  // e a resposta traz `failed` com o motivo do domínio quando recusa — o
  // toast reaproveita essa informação em vez de um "erro" genérico.
  async function handlePromoteStory(storyId: string) {
    if (promovendoStoryId) return;
    setPromovendoStoryId(storyId);
    try {
      const r = await promoteStories(projectId, [storyId]);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      if (r.failed.length > 0) {
        showToast({
          title: 'Não foi possível promover',
          message: r.failed[0]?.reason,
          tone: 'danger',
        });
      } else {
        showToast({ title: 'História promovida', tone: 'success' });
      }
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível promover a história', tone: 'danger' });
    } finally {
      setPromovendoStoryId(null);
    }
  }

  async function handleReturnStory() {
    if (!recusandoStory || motivoRecusa.trim() === '' || enviandoRecusa) return;
    setEnviandoRecusa(true);
    try {
      await returnStory(projectId, recusandoStory.id, motivoRecusa.trim());
      setRecusandoStory(null);
      setMotivoRecusa('');
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      showToast({ title: 'História devolvida ao PO', tone: 'success' });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível devolver a história', tone: 'danger' });
    } finally {
      setEnviandoRecusa(false);
    }
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || streaming || session?.status !== 'active') return;

    setDraft('');
    setOptimisticUser(text);
    setStreaming(true);
    setStreamingText('');

    // Achado 3: sessão CRIATIVA sem o Criativo ativo ainda — a primeira
    // mensagem TAMBÉM o ativa (decisão do usuário: ninguém deveria precisar
    // de um clique separado em "Iniciar ideação" antes de falar). Ativa e
    // ESPERA terminar antes de mandar a mensagem pelo caminho real
    // (`sendAgentMessage`) — nunca pelo SSE genérico mais abaixo, que não
    // tem histórico, system prompt nem a tool `emit_artifact`, e por isso
    // não registra regra de negócio nenhuma.
    let agentParaEnviar = activeAgent;
    if (!agentParaEnviar && session?.kind === 'criativa') {
      try {
        await startAgent(projectId, sessionId, 'criativo');
        await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
        agentParaEnviar = 'criativo';
      } catch {
        setStreaming(false);
        setOptimisticUser(null);
        showToast({ title: 'Erro', message: 'Não foi possível iniciar a ideação', tone: 'danger' });
        return;
      }
    }

    // Sessão com um agente ativo (Criativo, PO, Arquiteto, Dev Lead…): o
    // turno roda no engine (harness); os deltas e o fim chegam pelo canal
    // Phoenix. Senão (sessão consultiva), chat humano stateless via SSE.
    if (agentParaEnviar) {
      try {
        await sendAgentMessage(projectId, sessionId, agentParaEnviar, text);
        // Rede de segurança contra o canal perder o `agent.done` (achado da
        // duplicata + botão preso): a conexão do canal (ticket + join, RN-108)
        // é assíncrona e pode não ter terminado quando o turno acaba — nesse
        // caso o broadcast de fim de turno não tem ninguém ouvindo do outro
        // lado e se perde pra sempre, e como só `onAgentDone` resetava
        // `streaming`/`optimisticUser` no caminho de sucesso, o cliente ficava
        // preso: a mensagem otimista nunca some (daí a duplicata quando o
        // evento persistido chega por outra via) e o convite/botão de
        // "Iniciar ideação" nunca voltam a refletir o estado real.
        //
        // Esta chamada só RESOLVE depois que o engine termina o turno inteiro
        // — a rota é síncrona no engine (`GenServer.call` com timeout de
        // 120s em `CriativoServer.user_message`/2, ver
        // `agent_command_controller.ex`), então "resolveu" é sinal tão
        // confiável de "turno acabou" quanto `agent.done`. Na maioria das
        // vezes `onAgentDone` chega primeiro (empurrado direto pelo canal,
        // sem o salto extra de volta pela api) e este reset roda de novo sem
        // efeito — é por isso que `finalizarTurnoDoAgente` é seguro de
        // chamar duas vezes.
        finalizarTurnoDoAgente();
      } catch {
        setStreaming(false);
        setOptimisticUser(null);
        showToast({ title: 'Erro', message: 'Não foi possível enviar a mensagem', tone: 'danger' });
      }
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const evt of streamChatMessage(projectId, sessionId, text, controller.signal)) {
        if (evt.type === 'delta') {
          setStreamingText((t) => t + evt.text);
        } else if (evt.type === 'error') {
          showToast({ title: 'Erro no chat', message: evt.message, tone: 'danger' });
        } else if (evt.type === 'metering_failed') {
          showToast({ title: 'Aviso', message: evt.message, tone: 'warning' });
        }
      }
    } finally {
      setStreaming(false);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      setStreamingText('');
      setOptimisticUser(null);
      queryClient.invalidateQueries({ queryKey: ['session-budget', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-actions', projectId, sessionId] });
    }
  }

  // Botão "Parar" do composer (RN-122): interrompe DE VERDADE o turno em
  // curso no engine — mata a Task que segura a chamada ao LLM, cortando a
  // conexão no meio pra economizar token, não só para de renderizar aqui.
  // Só faz sentido enquanto `streaming` é true (ver o `disabled` do botão).
  async function handleCancel() {
    if (!streaming) return;

    // O mesmo agente que `handleSend` teria mandado a mensagem: o ativo, ou
    // 'criativo' quando a sessão é criativa e ainda não tem ninguém ativo
    // (a primeira mensagem também ativa o Criativo).
    const agentAlvo = activeAgent ?? (session?.kind === 'criativa' ? 'criativo' : null);

    if (!agentAlvo) {
      // Chat consultivo sem agente (SSE genérico da api) — cancelamento é
      // client-side, pelo mesmo AbortController que `handleSend` já usa
      // nesse caminho.
      abortRef.current?.abort();
      return;
    }

    try {
      await cancelAgentTurn(projectId, sessionId, agentAlvo);
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível cancelar o turno', tone: 'danger' });
      return;
    }

    // `finalizarTurnoDoAgente` é idempotente (mesmo padrão de `handleSend`):
    // o canal também vai reconciliar via `onAgentDone`/`agent.error`, mas
    // chamar aqui reseta a tela na hora em vez de esperar o round-trip do
    // `GenServer.call` original (que só desbloqueia quando o engine
    // termina de processar o cancelamento).
    finalizarTurnoDoAgente();
  }

  function handleComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // O rótulo composto: nome + hashtag, degradando para a hashtag sozinha
  // quando a sessão não tem nome (RN-098). A hashtag nunca sai.
  const rotulo = rotuloDaSessao(sessionId, session?.name);
  const hashtag = hashtagDaSessao(sessionId);
  const tipo = session ? TIPOS_DE_SESSAO[session.kind] : undefined;
  // Enquanto a sessão não carregou, NÃO é consultiva: é desconhecida. Tratar a
  // ausência como "consultiva" faria o botão de ideação piscar fora e dentro.
  const sessaoCriativa = session?.kind === 'criativa';
  // `isActive` mora lá em cima, junto de `session` — ver o comentário lá.
  // O convite ocupa o fio inteiro enquanto a conversa não começou. Vira
  // variável na FASE 24 porque a topbar passou a DEPENDER dele: as duas
  // condições precisam ser a mesma pergunta, ou "Iniciar ideação" aparece
  // duas vezes — ou nenhuma.
  //
  // `!eventsQuery.isPending` (RN-131) fecha uma race de carregamento: em
  // cache frio (reload de página), `session` pode chegar enquanto `events`
  // ainda é `[]` — o default de `eventsQuery.data?.items`, indistinguível de
  // "sessão realmente vazia" até o primeiro fetch resolver. Sem este gate, o
  // convite pisca por cima de uma sessão com histórico grande até os eventos
  // chegarem.
  const conviteVisivel =
    !conversaComecou && !optimisticUser && !streaming && !!session && !eventsQuery.isPending;
  const metaDaSessao = [
    project?.name ?? '…',
    hashtag,
    session ? new Date(session.createdAt).toLocaleTimeString('pt-BR') : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={styles.wrapper}>
      <div className={styles.topbar}>
        {/* A SAÍDA da tela (FASE 20). Até aqui `SessionPage` não importava
            `Link` nem `useNavigate`: entrar numa sessão era um beco, e o único
            caminho de volta era o botão do navegador. É `Link`, e não um
            `onClick` que navega, porque voltar ao PROJETO é um destino —
            abrir em outra aba e ver o alvo na barra de status são de graça.
            Volta ao PROJETO, não ao dashboard raiz: a sessão sempre nasce
            dentro de um projeto, e é lá que quem sai dela quer estar. */}
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className={styles.voltar}
          aria-label="Voltar ao projeto"
          title="Voltar ao projeto"
        >
          <ArrowLeftIcon size={17} />
        </Link>
        {/* O ponto DIZ o estado da sessão. Era verde sempre — só o pulso
            mudava —, então uma sessão encerrada exibia o mesmo sinal de "ao
            vivo" de uma em curso. E era mudo para quem não vê cor: agora tem
            rótulo. */}
        <span
          className={[styles.statusDot, styles[pontoDaSessao(session?.status).classe]]
            .filter(Boolean)
            .join(' ')}
          role="status"
          aria-label={`Sessão ${pontoDaSessao(session?.status).rotulo}`}
        />
        {/* Título e metadados em UMA linha cada, como o desenho — e por isso
            com reticências quando a barra aperta. `title` porque texto
            truncado sem forma de ler o resto é informação perdida. */}
        <div className={styles.titleBlock}>
          {rascunhoDoNome !== null ? (
            /* Renomear no LUGAR do título, e não num diálogo: o campo ocupa a
               posição exata do texto que ele muda. Enter confirma, Esc
               desiste — as duas teclas que já valem no composer logo abaixo. */
            <input
              className={styles.tituloEditavel}
              value={rascunhoDoNome}
              autoFocus
              maxLength={LIMITE_DO_NOME}
              aria-label="Nome da sessão"
              placeholder={`Sem nome — a sessão fica ${hashtag}`}
              onChange={(e) => setRascunhoDoNome(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setRascunhoDoNome(null);
              }}
            />
          ) : (
            <button
              type="button"
              className={styles.title}
              title={`Sessão ${rotulo} — clique para renomear`}
              onClick={() => setRascunhoDoNome(session?.name ?? '')}
              disabled={!session}
            >
              Sessão {rotulo}
            </button>
          )}
          <div className={styles.meta} title={metaDaSessao}>
            {metaDaSessao}
          </div>
        </div>
        {/* O tipo, VISÍVEL e imutável (RN-097). É ele que diz por que esta
            sessão tem — ou não tem — o botão de iniciar a ideação. */}
        {tipo && (
          <Badge tone={tipo.tom} title={tipo.explicacao}>
            {tipo.rotulo}
          </Badge>
        )}
        <div className={styles.spacer} />
        {modelsByCategory && (
          <ModelPicker
            variant="topbar"
            models={modelsByCategory}
            selectedModelId={resolvedBinding?.modelId}
            onSelect={(model) =>
              setSessionModelBinding(projectId, sessionId, model.id).then(() =>
                queryClient.invalidateQueries({ queryKey: ['session-model-binding', projectId, sessionId] }),
              )
            }
          />
        )}
        {budget && (
          <TokenMeter
            variant="live"
            unitLabel="USD"
            used={budget.spentMicros / 1_000_000}
            limit={budget.limitMicros / 1_000_000}
            costBRL={0}
            costUSD={budget.spentMicros / 1_000_000}
          />
        )}
        {/* O botão existe SÓ na sessão criativa (RN-097). Antes ele aparecia em
            qualquer sessão, e era a única maneira de chegar ao Criativo —
            descobrir isso depois de a sessão existir foi o que o usuário
            relatou como pouco claro. Agora a escolha aconteceu na criação, e a
            sessão consultiva não oferece o que ela não faz.

            FASE 24: e ele some da topbar enquanto o CONVITE está na tela, onde
            a mesma ação agora é oferecida (RN-104). O convite antes APONTAVA
            para cá — "use Iniciar ideação, no alto da tela" —, que é a versão
            literal do problema que originou a FASE 20: a ação num lugar e a
            explicação em outro. Uma ação, um lugar de cada vez; a topbar segue
            sendo a saída para quem já digitou algo e nunca chamou o Criativo,
            que é o caso em que o convite não está mais lá.

            E quando chega aqui SEM o convite ter aparecido nunca — quem
            manda uma mensagem antes de clicar em "Iniciar ideação" nunca vê
            o texto do convite, porque `conviteVisivel` depende de
            `!conversaComecou`, que não volta a `false` — o botão sozinho não
            dizia o que fazia. A pista (ícone + nota do Criativo, mesma cor
            da bolha dele no fio, e `title` pro hover) fica ao lado dele. */}
        {isActive && sessaoCriativa && !criativoActive && !conviteVisivel && (
          <span className={styles.iniciarIdeacaoComPista}>
            <BulbIcon
              size={14}
              className={styles.iniciarIdeacaoIcone}
              aria-hidden="true"
            />
            <span className={styles.iniciarIdeacaoDica}>
              traz o Criativo pra conversa
            </span>
            <Button
              onClick={handleStartIdeation}
              title="Traz o Criativo para conduzir a ideação desta sessão — ele ainda não entrou"
            >
              Iniciar ideação
            </Button>
          </span>
        )}
        {/* O botão de aceitar handoff SAIU daqui (RN-125): mora dentro do
            fio agora, embutido no PRÓPRIO card que já anunciava "X passou o
            bastão ao Y" — contextual, no lugar onde a passagem aconteceu, em
            vez de um botão solto na topbar sem relação visual com o evento
            que o originou. Manter os dois puxaria dois botões com o MESMO
            texto visíveis ao mesmo tempo na tela. */}
        {/* Encerrar é destrutivo e o desenho o marca como tal: contorno em
            `danger`, não um botão fantasma indistinguível dos outros. */}
        <Button variant="danger" onClick={handleClose} disabled={!session || session.status === 'closed'}>
          <StopSquareIcon size={15} />
          Encerrar
        </Button>
        <button
          type="button"
          className={[styles.toggleAside, asideOpen && styles.toggleAsideOn]
            .filter(Boolean)
            .join(' ')}
          onClick={() => setAsideOpen((v) => !v)}
          aria-pressed={asideOpen}
          aria-label="Alternar painel de contexto"
        >
          <LayoutSidebarIcon size={17} />
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.chatColumn}>
          <div className={styles.messages} ref={scrollContainerRef}>
            <div className={styles.messagesInner}>
              {/* O Criativo é ativado e NÃO fala primeiro: ele espera a sua
                  mensagem. Sem isto a tela ficava em branco depois de "Iniciar
                  ideação", e quem chega não tem como saber que a vez é dele.
                  Convite em vez de turno automático: informa sem gastar token. */}
              {/* O convite fala do tipo que a sessão É (RN-097). Ele era um só,
                  e prometia o Criativo em toda sessão — inclusive nas que
                  nunca o teriam. */}
              {conviteVisivel && (
                sessaoCriativa ? (
                  <div className={styles.convite}>
                    <h2 className={styles.conviteTitulo}>A vez é sua</h2>
                    <p className={styles.conviteTexto}>
                      Esta é uma sessão <strong>criativa</strong>. O{' '}
                      <strong>Criativo</strong> conduz a ideação: ele faz
                      perguntas sobre o produto e registra as{' '}
                      <strong>regras de negócio</strong> que saírem da conversa.
                      Ele não decide tecnologia nem escreve código — isso é do
                      Arquiteto e dos devs, mais adiante.
                    </p>
                    {/* A AÇÃO, e não uma seta apontando para ela (FASE 24).
                        Ativar o Criativo continua sendo um clique explícito:
                        é a partir dele que a chave do owner passa a ser
                        gasta (RN-058), e ninguém entra na sessão sozinho. */}
                    {!criativoActive && (
                      <div className={styles.conviteAcao}>
                        <Button onClick={handleStartIdeation} disabled={!isActive}>
                          Iniciar ideação
                        </Button>
                        <span className={styles.conviteAcaoNota}>
                          Ele ainda não entrou — é este clique que o traz.
                        </span>
                      </div>
                    )}
                    <p className={styles.conviteTexto}>
                      Comece contando o que você quer construir e para quem. Por
                      exemplo:
                    </p>
                    <button
                      type="button"
                      className={styles.conviteExemplo}
                      onClick={() =>
                        setDraft(
                          'Quero uma API que responda uma saudação para quem chamar. É para eu validar o fluxo de ponta a ponta.',
                        )
                      }
                    >
                      “Quero uma API que responda uma saudação para quem chamar. É
                      para eu validar o fluxo de ponta a ponta.”
                    </button>
                    <p className={styles.conviteRodape}>
                      Quando as regras estiverem completas, use{' '}
                      <strong>Estou pronto para produzir</strong> — é o que gera o
                      brief e passa a bola ao PO.
                    </p>
                  </div>
                ) : (
                  <div className={styles.convite}>
                    <h2 className={styles.conviteTitulo}>Sessão consultiva</h2>
                    <p className={styles.conviteTexto}>
                      Aqui é conversa com o modelo: pergunte, peça contexto,
                      tire dúvidas. <strong>Nenhum agente é ativado</strong>, o
                      Criativo não entra e esta sessão não vai para execução.
                    </p>
                    <p className={styles.conviteRodape}>
                      Quando for para <strong>produzir</strong>, abra uma sessão{' '}
                      <strong>criativa</strong> na aba Sessões do projeto — o
                      tipo é escolhido na criação e não muda depois.
                    </p>
                  </div>
                )
              )}

              {timelineAgrupada.map((entry) => (
                <div key={entry.key}>{entry.node}</div>
              ))}

              {optimisticUser && (
                <div
                  className={styles.message}
                  style={{ ['--msg-color' as string]: 'var(--accent)' } as CSSProperties}
                >
                  <span className={[styles.avatar, styles.user].join(' ')}>
                    <UserIcon size={15} />
                  </span>
                  <div className={styles.messageBody}>
                    <div className={styles.messageHeader}>
                      <span className={styles.messageName}>{user.name ?? 'Você'}</span>
                    </div>
                    <div className={styles.bubble}>{optimisticUser}</div>
                  </div>
                </div>
              )}

              {/* `statusAgent` cobre o intervalo entre o `agent.status`
                  "working" (achado B) e o primeiro delta — sem ele, aceitar
                  um handoff cujo kickoff é assíncrono no engine não mostrava
                  nada até o agente terminar de pensar. Reaproveita o MESMO
                  indicador do streaming por delta; `agenteExibido` escolhe a
                  fonte mais recente entre os dois.

                  RN-131: a bolha só aparece SEM texto depois de 5s
                  (`pensandoVisivel`, armado pelo efeito acima) — texto de
                  verdade (`streamingText`) sempre aparece na hora, nunca
                  espera o timer. É por isso que a condição é "tem texto OU
                  já passou o prazo", nunca só "tem texto". */}
              {(streamingText || (pensandoVisivel && (streaming || statusAgent))) && (
                <div
                  className={styles.message}
                  style={
                    {
                      ['--msg-color' as string]:
                        agenteExibido?.color ?? 'var(--accent)',
                    } as CSSProperties
                  }
                >
                  <span className={styles.avatar}>
                    {agenteExibido ? <agenteExibido.icon size={15} /> : <ModelIcon size={15} />}
                  </span>
                  <div className={styles.messageBody}>
                    <div className={styles.messageHeader}>
                      {/*
                        Quem fala é o AGENTE (achado C). O modelo é detalhe de
                        execução e aparecia aqui como se fosse o interlocutor —
                        depois trocava para o agente quando o evento persistido
                        chegava, o que também mudava o nome na cara do usuário.
                        Sem o agente no delta, degrada para "agente" genérico,
                        nunca para o nome do modelo.

                        "está escrevendo…" só antes de haver texto — é o que
                        deixa explícito que o silêncio é trabalho em curso, não
                        ausência de resposta (achado B).
                      */}
                      <span className={styles.messageName}>
                        {streamingText
                          ? (agenteExibido?.name ?? 'agente')
                          : `${agenteExibido?.name ?? 'Agente'} está escrevendo…`}
                      </span>
                    </div>
                    {streamingText ? (
                      <div className={styles.bubble}>{streamingText}</div>
                    ) : (
                      <div className={styles.typing}>
                        <span className={styles.typingDot} />
                        <span className={styles.typingDot} />
                        <span className={styles.typingDot} />
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Sentinela do achado 10 — alvo do scroll de abertura e do
                  "acompanha o fim" enquanto o usuário está perto dele. */}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {session?.status === 'active' ? (
            <div className={styles.composer}>
              <textarea
                className={styles.textarea}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)"
                disabled={streaming}
              />
              <Button onClick={handleSend} disabled={streaming || !draft.trim()}>
                Enviar
              </Button>
              {/* RN-122: só existe (habilitado) enquanto há turno em curso —
                  fora disso não há o que parar. */}
              {streaming && (
                <Button variant="danger" onClick={handleCancel}>
                  Parar
                </Button>
              )}
              {/*
                Some depois que o Criativo passou a bola (achado L). O botão
                dependia só de o Criativo estar ativo, e continuava oferecendo
                "Estou pronto para produzir" DEPOIS do handoff — convidando a
                declarar de novo uma prontidão que já foi declarada, e cuja
                consequência (o handoff para o PO) já está na tela.
              */}
              {criativoActive && !prontidaoJaDeclarada && (
                <Button
                  variant="success"
                  onClick={handleReadiness}
                  disabled={streaming || !hasBusinessRule}
                  title={
                    !hasBusinessRule
                      ? 'Registre pelo menos uma regra de negócio com o Criativo antes de confirmar prontidão'
                      : undefined
                  }
                >
                  Estou pronto para produzir
                </Button>
              )}
              {/*
                Mirror do botão acima, para o Arquiteto (achado do problema 1)
                — some depois que ele já ofereceu o handoff, pelo mesmo motivo
                que o do Criativo some depois de `prontidaoJaDeclarada`.
              */}
              {arquitetoActive && !arquiteturaJaDeclarada && (
                <Button
                  variant="success"
                  onClick={handleArchitectureReadiness}
                  disabled={streaming}
                >
                  Confirmar arquitetura pronta
                </Button>
              )}
            </div>
          ) : (
            <div className={styles.activatePrompt}>
              {session?.status === 'created' ? (
                <>
                  Sessão ainda não ativada.
                  <Button onClick={handleActivate}>Ativar sessão</Button>
                </>
              ) : (
                <span>Sessão {session?.status} — não é possível enviar mensagens.</span>
              )}
            </div>
          )}
        </div>

        {asideOpen && (
          <ContextAside
            actions={actionsQuery.data?.items ?? []}
            events={events}
            logOpen={logOpen}
            onToggleLog={() => setLogOpen((open) => !open)}
            highlightEvent={highlightEvent}
            citedEvent={citedEvent}
            citedEventMissing={citedEventQuery.isError}
          />
        )}
      </div>

      {/* Modal de motivo da devolução (RN-126) — mesmo padrão de
          `PromotionQueue` em ProjectBacklogTab.tsx, disparado a partir do
          card inline em vez da aba Backlog. */}
      {recusandoStory && (
        <Modal
          title={`Devolver "${recusandoStory.title}" ao PO?`}
          onClose={() => setRecusandoStory(null)}
        >
          <Textarea
            label="Motivo"
            value={motivoRecusa}
            onChange={(e) => setMotivoRecusa(e.target.value)}
            hint="Vai como mensagem fixada na sessão do PO. Diga o que falta — é com isto que ele reescreve a história."
            placeholder="Ex.: os critérios de aceite não cobrem a recusa do pagamento."
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="danger"
              loading={enviandoRecusa}
              disabled={motivoRecusa.trim() === ''}
              onClick={handleReturnStory}
            >
              Devolver ao PO
            </Button>
            <Button variant="ghost" onClick={() => setRecusandoStory(null)}>
              Cancelar
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ContextAside({
  actions,
  events,
  logOpen,
  onToggleLog,
  highlightEvent,
  citedEvent,
  citedEventMissing,
}: {
  actions: ProposedAction[];
  events: SessionEvent[];
  logOpen: boolean;
  onToggleLog: () => void;
  highlightEvent?: string;
  citedEvent?: SessionEvent;
  citedEventMissing?: boolean;
}) {
  const prActions = actions.filter((a) => a.actionType === 'pr_open');
  const businessRules = events.filter((e) => e.type === 'artifact.business_rule');
  // Opções do filtro "por agente" do feed (Fase 8d — a prop existia desde
  // sempre em ActivityFeed, mas nenhum dos dois call sites a passava, então
  // o filtro nunca funcionou). Deriva dos atores REAIS desta sessão — pega
  // subagentes de área automaticamente, sem precisar buscar module_map/
  // handoffs só pra montar a lista (que `deriveAgentRoster` exigiria).
  const agentOptions = Array.from(new Set(events.map((e) => e.actor.id))).map((id) => ({
    id,
    label: AGENTS[id as keyof typeof AGENTS]?.name ?? id,
  }));
  const filesTouched = actions
    .filter((a) => a.actionType === 'git_commit' || a.actionType === 'git_push')
    .flatMap((a) => {
      const files = (a.payload as { files?: { path: string; additions: number; deletions: number }[] }).files;
      return files ?? [];
    });

  return (
    <aside className={styles.aside}>
      {/* O trilho se nomeia (handoff, seção 5). Sem isto, quem abre o painel vê
          quatro rótulos mono soltos e nenhuma pista do que os junta. */}
      <div className={styles.asideTitleBar}>
        <h2 className={styles.asideTitle}>Contexto da sessão</h2>
      </div>

      <div className={styles.asideSection}>
        {/* Contador exposto com o MESMO padrão do Log de eventos (`Disclosure`
            + `trailing`) — antes o cabeçalho era um `div` mudo e o rodapé
            estático do convite ("Quando as regras estiverem completas…")
            não tinha como saber quantas já existiam. Sem threshold: o ganho
            é mostrar o número real, não decidir por um mínimo. */}
        <Disclosure
          titulo="Regras de negócio"
          trailing={businessRules.length}
          padraoAberto
          classNameCabecalho={styles.asideHeader}
        >
          {businessRules.length === 0 ? (
            <div className={styles.asideEmpty}>Nada ainda.</div>
          ) : (
            businessRules.map((e) => {
              const rule = e.payload as BusinessRulePayload;
              return (
                <div key={e.id} className={styles.ruleCard}>
                  <div className={styles.ruleTitle}>{rule.title}</div>
                  <div className={styles.ruleDescription}>{rule.description}</div>
                  <div className={styles.ruleOrigin}>
                    origem: {Array.isArray(rule.origin) ? rule.origin.length : 0} ref(s)
                  </div>
                </div>
              );
            })
          )}
        </Disclosure>
      </div>

      <div className={styles.asideSection}>
        <div className={styles.asideHeader}>Artefatos gerados</div>
        {prActions.length === 0 ? (
          <div className={styles.asideEmpty}>Nada ainda.</div>
        ) : (
          prActions.map((a) => (
            <div key={a.id} className={styles.asideItem}>
              {(a.payload as { title?: string }).title ?? 'Pull request'}
            </div>
          ))
        )}
      </div>

      <div className={styles.asideSection}>
        <div className={styles.asideHeader}>Arquivos tocados</div>
        {filesTouched.length === 0 ? (
          <div className={styles.asideEmpty}>Nada ainda.</div>
        ) : (
          filesTouched.map((file) => (
            <div key={file.path} className={styles.asideItem}>
              <span className={styles.fileLetter}>M</span>
              <span className={styles.filePath}>{file.path}</span>
              <span className={styles.fileAdd}>+{file.additions}</span>
              <span className={styles.fileDel}>−{file.deletions}</span>
            </div>
          ))
        )}
      </div>

      {/* Log completo de eventos — o alvo da navegação de evidência do
          Psicólogo (Fase 4b). Colapsável pra não competir com o chat.

          Migrado para o `Disclosure` do design system na FASE 20, a fase que
          abre este arquivo. O colapso ad-hoc daqui era um `button` com
          `aria-expanded` e um `−`/`+` de texto, sem `aria-controls` e sem
          região nomeada: o leitor de tela anunciava um botão expandido sem
          dizer o que ele expandia. A contagem virou `trailing`, que fica dentro
          do alvo de clique — a linha inteira alterna, como nas outras seis. */}
      <div className={styles.asideSection}>
        <Disclosure
          titulo="Log de eventos"
          trailing={events.length}
          aberto={logOpen}
          onAlternar={onToggleLog}
          classNameCabecalho={styles.asideHeader}
        >
          {/* Evento citado FIXADO no topo: garante que a evidência chega
              no evento independente de paginação e dos filtros do feed. */}
          {highlightEvent && citedEvent && (
            <div className={styles.citedEvent}>
              <div className={styles.citedEventLabel}>
                Evento citado
              </div>
              <EventItem event={citedEvent} highlighted />
            </div>
          )}
          {highlightEvent && citedEventMissing && (
            <div className={styles.asideEmpty}>
              O evento citado não foi encontrado nesta sessão.
            </div>
          )}
          <ActivityFeed
            events={events}
            agentOptions={agentOptions}
            highlightEventId={highlightEvent}
          />
        </Disclosure>
      </div>
    </aside>
  );
}
