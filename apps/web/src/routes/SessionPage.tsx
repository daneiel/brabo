import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
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
  sendAgentMessage,
  setSessionModelBinding,
  startAgent,
  transitionSession,
} from '../lib/api-client';
import { streamChatMessage } from '../lib/chat-stream';
import { connectSessionHeartbeat } from '../lib/session-channel';
import { useSessionEvents, usePendingActions, useHandoffs } from '../lib/hooks';
import { currentUser } from '../lib/keycloak';
import type {
  BusinessRulePayload,
  ProposedAction,
  SessionEvent,
} from '../lib/api-types';
import { useToast } from '../components/ui/ToastProvider';
import { TokenMeter } from '../components/TokenMeter';
import { ModelPicker } from '../components/ModelPicker';
import { ApprovalCard } from '../components/ApprovalCard';
import { Button } from '../components/ui/Button';
import { LayoutSidebarIcon, ModelIcon, UserIcon } from '../components/ui/icons';
import styles from './SessionPage.module.css';

interface SessionPageProps {
  projectId: string;
  sessionId: string;
}

interface TimelineEntry {
  seq: number;
  node: ReactNode;
}

export function SessionPage({ projectId, sessionId }: SessionPageProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const user = currentUser();

  const [asideOpen, setAsideOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) });
  const { data: session } = useQuery({
    queryKey: ['session', projectId, sessionId],
    queryFn: () => getSession(projectId, sessionId),
    refetchInterval: 5000,
  });

  const eventsQuery = useSessionEvents(projectId, sessionId, 3000);
  const events = eventsQuery.data?.items ?? [];
  const actionsQuery = usePendingActions(projectId, sessionId, 3000);
  const actions = actionsQuery.data?.items ?? [];

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
    const disconnect = connectSessionHeartbeat(sessionId, {
      onAgentDelta: (text) => {
        setStreaming(true);
        setStreamingText((t) => t + text);
      },
      onAgentDone: () => {
        setStreaming(false);
        setStreamingText('');
        setOptimisticUser(null);
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
        queryClient.invalidateQueries({ queryKey: ['session-handoffs', projectId, sessionId] });
        queryClient.invalidateQueries({ queryKey: ['session-budget', projectId, sessionId] });
      },
      // Fase 4a — painel do time ao vivo: qualquer evento persistido
      // (Dev/QA/SecOps/Infra) antecipa o refetch do polling — reaproveita o
      // parsing/cache já existente (useSessionEvents), só antecipa quando o
      // dado muda em vez de esperar o intervalo do poll.
      onEvent: () => {
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      },
    });
    return disconnect;
  }, [session?.status, sessionId, projectId, queryClient]);

  const { data: modelsByCategory } = useQuery({ queryKey: ['models'], queryFn: listModels });
  const { data: resolvedBinding } = useQuery({
    queryKey: ['session-model-binding', projectId, sessionId],
    queryFn: () => getSessionModelBinding(projectId, sessionId),
  });
  const { data: budget } = useQuery({
    queryKey: ['session-budget', projectId, sessionId],
    queryFn: () => getSessionBudget(projectId, sessionId),
    refetchInterval: 5000,
  });

  const allModels = modelsByCategory ? [...Object.values(modelsByCategory.local).flat(), ...Object.values(modelsByCategory.cloud).flat()] : [];
  const selectedModel = allModels.find((m) => m.id === resolvedBinding?.modelId);

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
            <div className={styles.message} key={event.id}>
              <span className={[styles.avatar, styles.user].join(' ')}>
                <UserIcon size={15} />
              </span>
              <div className={styles.messageBody}>
                <div className={styles.messageHeader}>
                  <span className={styles.messageName} style={{ ['--msg-color' as string]: 'var(--accent)' }}>
                    {user.name ?? 'Você'}
                  </span>
                </div>
                <div className={styles.bubble}>{text}</div>
              </div>
            </div>
          ),
        });
      } else if (event.type === 'handoff.offered') {
        const payload = event.payload as { toAgent?: string };
        items.push({
          seq: event.seq,
          node: (
            <div className={styles.handoffDivider} key={event.id}>
              <span className={styles.handoffPill}>
                handoff → {payload?.toAgent ?? 'PO'}
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
            <div className={styles.message} key={event.id}>
              <span className={styles.avatar} style={{ ['--msg-color' as string]: 'var(--accent)' } as CSSProperties}>
                <ModelIcon size={15} />
              </span>
              <div className={styles.messageBody}>
                <div className={styles.messageHeader}>
                  <span className={styles.messageName} style={{ ['--msg-color' as string]: 'var(--accent)' }}>
                    {event.actor.id}
                  </span>
                  <span className={styles.messageMeta}>modelo</span>
                </div>
                <div className={styles.bubble}>{text}</div>
              </div>
            </div>
          ),
        });
      }
    }

    for (const action of actions) {
      items.push({
        seq: action.seq,
        node: (
          <ApprovalCard
            key={action.id}
            action={action}
            variant="chat"
            meta={selectedModel ? `${selectedModel.displayName} · sessão` : undefined}
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
  }, [events, actions, selectedModel, projectId, sessionId, user.name, queryClient, invalidateActions]);

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

  const shortId = sessionId.slice(0, 8);
  const isActive = session?.status === 'active';

  return (
    <div className={styles.wrapper}>
      <div className={styles.topbar}>
        <span className={[styles.statusDot, isActive && styles.pulsing].filter(Boolean).join(' ')} />
        <div className={styles.titleBlock}>
          <div className={styles.title}>Sessão #{shortId}</div>
          <div className={styles.meta}>
            {project?.name ?? '…'} · #{shortId} · {session ? new Date(session.createdAt).toLocaleTimeString('pt-BR') : ''}
          </div>
        </div>
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
        {isActive && !criativoActive && (
          <Button variant="secondary" onClick={handleStartIdeation}>
            Iniciar ideação
          </Button>
        )}
        {isActive && offeredHandoff && (
          <Button variant="success" onClick={() => handleAcceptHandoff(offeredHandoff.id)}>
            Aceitar handoff e iniciar {offeredHandoff.toAgent}
          </Button>
        )}
        <Button variant="ghost" onClick={handleClose} disabled={!session || session.status === 'closed'}>
          Encerrar
        </Button>
        <button type="button" className={styles.toggleAside} onClick={() => setAsideOpen((v) => !v)} aria-label="Alternar painel de contexto">
          <LayoutSidebarIcon size={16} />
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.chatColumn}>
          <div className={styles.messages}>
            <div className={styles.messagesInner}>
              {timeline.map((entry) => (
                <div key={entry.seq}>{entry.node}</div>
              ))}

              {optimisticUser && (
                <div className={styles.message}>
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
                <div className={styles.message}>
                  <span className={styles.avatar} style={{ ['--msg-color' as string]: 'var(--accent)' } as CSSProperties}>
                    <ModelIcon size={15} />
                  </span>
                  <div className={styles.messageBody}>
                    <div className={styles.messageHeader}>
                      <span className={styles.messageName}>{selectedModel?.displayName ?? 'modelo'}</span>
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
              {criativoActive && (
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

        {asideOpen && <ContextAside actions={actionsQuery.data?.items ?? []} events={events} />}
      </div>
    </div>
  );
}

function ContextAside({ actions, events }: { actions: ProposedAction[]; events: SessionEvent[] }) {
  const prActions = actions.filter((a) => a.actionType === 'pr_open');
  const businessRules = events.filter((e) => e.type === 'artifact.business_rule');
  const filesTouched = actions
    .filter((a) => a.actionType === 'git_commit' || a.actionType === 'git_push')
    .flatMap((a) => {
      const files = (a.payload as { files?: { path: string; additions: number; deletions: number }[] }).files;
      return files ?? [];
    });

  return (
    <aside className={styles.aside}>
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
              <span className={styles.fileLetter} style={{ color: 'var(--warning)' }}>
                M
              </span>
              {file.path}
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                +{file.additions} −{file.deletions}
              </span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
