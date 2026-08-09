import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptHandoff,
  approveAction,
  approveAlwaysAction,
  confirmReadiness,
  denyAction,
  getProject,
  getSession,
  getSessionBudget,
  getSessionModelBinding,
  listModels,
  renameSession,
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
  ChevronRightIcon,
  LayoutSidebarIcon,
  ModelIcon,
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
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null);
  // Renomear (RN-098). `null` fora de edição — e não string vazia — porque
  // vazio é um nome que se está digitando, e nenhum campo aberto é outro
  // estado.
  const [rascunhoDoNome, setRascunhoDoNome] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) });
  const { data: session } = useQuery({
    queryKey: ['session', projectId, sessionId],
    queryFn: () => getSession(projectId, sessionId),
    refetchInterval: pollQueParaNoErro(5000),
  });

  const eventsQuery = useSessionEvents(projectId, sessionId, 3000);
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

  const handoffsQuery = useHandoffs(projectId, sessionId, 3000);
  const handoffs = handoffsQuery.data ?? [];

  // Um agente está ativo se houve um agent.activated pra ele nesta sessão.
  const activeFor = (agent: string) =>
    events.some(
      (e) =>
        e.type === 'agent.activated' &&
        (e.payload as { agent?: string })?.agent === agent,
    );
  const criativoActive = useMemo(() => activeFor('criativo'), [events]);
  const poActive = useMemo(() => activeFor('po'), [events]);
  const arquitetoActive = useMemo(() => activeFor('arquiteto'), [events]);
  // O agente que recebe as mensagens do composer (o mais avançado do fluxo
  // ativo tem precedência).
  const activeAgent = arquitetoActive
    ? 'arquiteto'
    : poActive
      ? 'po'
      : criativoActive
        ? 'criativo'
        : null;
  // Primeiro handoff oferecido ainda não aceito → botão de aceitar (qualquer
  // agente: po, arquiteto…).
  const offeredHandoff = handoffs.find(
    (h) => h.status === 'offered' && !activeFor(h.toAgent),
  );

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
      },
      onAgentDone: () => {
        streamingRef.current = false;
        setStreaming(false);
        setStreamingText('');
        setStreamingAgent(null);
        setOptimisticUser(null);
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
        queryClient.invalidateQueries({ queryKey: ['session-handoffs', projectId, sessionId] });
        queryClient.invalidateQueries({ queryKey: ['session-budget', projectId, sessionId] });
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
  }, [session?.status, sessionId, projectId, queryClient]);

  const { data: modelsByCategory } = useQuery({
    // A chave carrega o projeto porque a lista é do WORKSPACE dele (ADR 0049):
    // um cache global devolveria a curadoria de outro workspace.
    queryKey: ['models', projectId],
    queryFn: () => listModels(projectId),
  });
  const { data: resolvedBinding } = useQuery({
    queryKey: ['session-model-binding', projectId, sessionId],
    queryFn: () => getSessionModelBinding(projectId, sessionId),
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

  // A CONVERSA começou? (achado G) — e não "o fio está vazio", que era a
  // condição anterior. Num projeto CRIADO o fio já nasce com os cards do
  // bootstrap, então o convite do Criativo nunca aparecia justamente para quem
  // mais precisa dele: quem acabou de provisionar um repositório e não sabe
  // que a vez é sua. Card de bootstrap não é conversa.
  const conversaComecou = events.some(
    (e) => e.type === 'chat.message' || e.type === 'agent.response',
  );

  // A prontidão já foi declarada? (achado L) O handoff que sai do Criativo é a
  // consequência dela — existindo, o botão não tem mais o que oferecer.
  const prontidaoJaDeclarada = handoffs.some((h) => h.fromAgent === 'criativo');

  const invalidateActions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['session-actions', projectId, sessionId] });
  }, [queryClient, projectId, sessionId]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const items: TimelineEntry[] = [];
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
        items.push({
          seq: event.seq,
          node: (
            <div className={styles.handoffDivider} key={event.id}>
              <span className={styles.handoffPill}>
                <span className={styles.handoffAgent} style={corDoAgente(event.actor.id)}>
                  {nomeDoAgente(event.actor.id)}
                </span>
                <ChevronRightIcon size={13} />
                passou o bastão ao
                <span className={styles.handoffAgent} style={corDoAgente(payload?.toAgent)}>
                  {nomeDoAgente(payload?.toAgent)}
                </span>
              </span>
            </div>
          ),
        });
      } else if (event.type === 'agent.response') {
        const payload = event.payload as { content?: unknown; text?: unknown };
        const text =
          typeof payload?.content === 'string'
            ? payload.content
            : typeof payload?.text === 'string'
              ? payload.text
              : '';
        items.push({
          seq: event.seq,
          node: (
            <div className={styles.message} key={event.id} style={corDoAgente(event.actor.id)}>
              <span className={styles.avatar}>
                <ModelIcon size={15} />
              </span>
              <div className={styles.messageBody}>
                <div className={styles.messageHeader}>
                  <span className={styles.messageName}>{nomeDoAgente(event.actor.id)}</span>
                  <span className={styles.messageMeta}>modelo</span>
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
  }, [events, actions, projectId, sessionId, user.name, queryClient, invalidateActions]);

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
    } catch {
      setStreaming(false);
      showToast({ title: 'Erro', message: 'Não foi possível confirmar prontidão', tone: 'danger' });
    }
  }

  async function handleAcceptHandoff(handoffId: string) {
    try {
      await acceptHandoff(projectId, sessionId, handoffId);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-handoffs', projectId, sessionId] });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível aceitar o handoff', tone: 'danger' });
    }
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || streaming || session?.status !== 'active') return;

    setDraft('');
    setOptimisticUser(text);
    setStreaming(true);
    setStreamingText('');

    // Sessão com um agente ativo (Criativo ou PO): o turno roda no engine
    // (harness); os deltas e o fim chegam pelo canal Phoenix. Senão, chat
    // humano stateless via SSE.
    if (activeAgent) {
      try {
        await sendAgentMessage(projectId, sessionId, activeAgent, text);
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
  const isActive = session?.status === 'active';
  // O convite ocupa o fio inteiro enquanto a conversa não começou. Vira
  // variável na FASE 24 porque a topbar passou a DEPENDER dele: as duas
  // condições precisam ser a mesma pergunta, ou "Iniciar ideação" aparece
  // duas vezes — ou nenhuma.
  const conviteVisivel =
    !conversaComecou && !optimisticUser && !streaming && !!session;
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
            `onClick` que navega, porque voltar ao dashboard é um destino —
            abrir em outra aba e ver o alvo na barra de status são de graça. */}
        <Link
          to="/"
          className={styles.voltar}
          aria-label="Voltar ao dashboard"
          title="Voltar ao dashboard"
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
            que é o caso em que o convite não está mais lá. */}
        {isActive && sessaoCriativa && !criativoActive && !conviteVisivel && (
          <Button onClick={handleStartIdeation}>Iniciar ideação</Button>
        )}
        {isActive && offeredHandoff && (
          <Button variant="success" onClick={() => handleAcceptHandoff(offeredHandoff.id)}>
            Aceitar handoff e iniciar {offeredHandoff.toAgent}
          </Button>
        )}
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
          <div className={styles.messages}>
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

              {timeline.map((entry) => (
                <div key={entry.seq}>{entry.node}</div>
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

              {streaming && (
                <div
                  className={styles.message}
                  style={
                    {
                      ['--msg-color' as string]:
                        agenteFalando?.color ?? 'var(--accent)',
                    } as CSSProperties
                  }
                >
                  <span className={styles.avatar}>
                    {agenteFalando ? <agenteFalando.icon size={15} /> : <ModelIcon size={15} />}
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
                      */}
                      <span className={styles.messageName}>
                        {agenteFalando?.name ?? 'agente'}
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
              {/*
                Some depois que o Criativo passou a bola (achado L). O botão
                dependia só de o Criativo estar ativo, e continuava oferecendo
                "Estou pronto para produzir" DEPOIS do handoff — convidando a
                declarar de novo uma prontidão que já foi declarada, e cuja
                consequência (o handoff para o PO) já está na tela.
              */}
              {criativoActive && !prontidaoJaDeclarada && (
                <Button variant="success" onClick={handleReadiness} disabled={streaming}>
                  Estou pronto para produzir
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
        <div className={styles.asideHeader}>Regras de negócio</div>
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
