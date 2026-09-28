import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  acceptHandoff,
  activateExecution,
  cancelAgentTurn,
  confirmArchitectureReadiness,
  confirmReadiness,
  getProject,
  getRepository,
  getSession,
  getSessionBudget,
  getSessionModelBinding,
  listModels,
  mensagemDaApi,
  promoteStories,
  renameSession,
  requestManualHandoff,
  returnStory,
  sendAgentMessage,
  setAgentAutonomy,
  startAgent,
  transitionSession,
  validateNecessity,
} from '../lib/api-client';
import { streamChatMessage } from '../lib/chat-stream';
import { useTurnoDoAgente } from '../lib/session-turno';
import { mensagemDaRecusaDoAgente } from '../lib/recusa-do-agente';
import {
  useBacklog,
  useCurrentWorkspaceWithRole,
  useSessionEvents,
  useSessionEvent,
  usePendingActions,
  useHandoffs,
} from '../lib/hooks';
import { pollQueParaNoErro } from '../lib/query-policy';
import {
  INTERVALO_DO_ORCAMENTO_COM_CANAL_MS,
  intervaloDaSessao,
  useCanalDaSessaoVivo,
} from '../lib/canal-vivo';
import { emailDaSessao } from '../lib/auth';
import { AGENTS } from '../lib/agents';
import { AGENT_AUTONOMY_ALL_ACTIONS } from '../lib/api-types';
import { useToast } from '../components/ui/ToastProvider';
import { TurnActivityStrip } from '../components/TurnActivityStrip';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Textarea } from '../components/ui/Textarea';
import { hashtagDaSessao, rotuloDaSessao } from '../lib/session-label';
import { TIPOS_DE_SESSAO } from '../lib/session-kind';
import styles from './SessionPage.module.css';
import {
  aberturasDeTurno,
  afundarDesfechos,
  ordemDaAcaoNaTimeline,
  turnoDoSeq,
  type TimelineEntry,
} from '../lib/session-timeline';
import { ehRecusaDeSessaoEncerrada } from '../lib/sessao-encerrada';
import { ContextAside } from './ContextAside';
import { useSessionReadiness } from '../lib/session-readiness';
import { agruparNarracoesDoTurno, agruparTimelinePorAgente, dividirFio } from './session-fio';
import { montarTimeline } from './session-timeline-montagem';
import { SessionTopbar } from './SessionTopbar';
import { SessionFio } from './SessionFio';
import { SessionComposer } from './SessionComposer';
import { derivarHandoffsDaSessao } from '../lib/session-handoffs';

interface SessionPageProps {
  projectId: string;
  sessionId: string;
  /** Evidência do Psicólogo (Fase 4b) — abre o log e rola até o evento. */
  highlightEvent?: string;
}

/**
 * `aberturasDeTurno`, `turnoDoSeq`, `afundarDesfechos`, `pontoDaSessao` e
 * `ordemDaAcaoNaTimeline` — junto com o tipo `TimelineEntry` que várias delas
 * usam — moraram aqui até a extração mecânica de `../lib/session-timeline`
 * (PR 1 da decomposição de `SessionPage.tsx`, ADR 0122): são puras, sem JSX
 * nem referência a `styles`, e por isso a primeira fatia a sair. Reexportadas
 * abaixo porque `SessionPage.ordenacao-e-avisos.test.tsx` as importa
 * DIRETAMENTE de `./SessionPage` — mesmo símbolo, novo módulo dono.
 * `agruparNarracoesDoTurno` ficou aqui no ADR 0122 (produz JSX e lê
 * `styles.narracoes*`) e saiu no PR 1 do ADR 0176 para `./session-fio`, um
 * `.tsx` em `routes/` — reexportada pelo mesmo motivo das outras.
 */
export {
  aberturasDeTurno,
  afundarDesfechos,
  agruparNarracoesDoTurno,
  ordemDaAcaoNaTimeline,
  turnoDoSeq,
};

/**
 * `scrollIntoView` com guarda de existência (achado 10) — jsdom (ambiente de
 * teste) não implementa o método; chamá-lo direto quebra qualquer teste que
 * monte a tela com eventos na lista. Nos navegadores de verdade o método
 * sempre existe, então a guarda nunca muda o comportamento visível.
 */
function rolarParaOFim(el: HTMLElement | null) {
  el?.scrollIntoView?.({ block: 'end' });
}

export function SessionPage({
  projectId,
  sessionId,
  highlightEvent,
}: SessionPageProps) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  // O access token carrega o e-mail; o nome não vem mais em claim nenhuma
  // (Fase 7a). Para o rótulo de autoria da própria mensagem, o e-mail serve —
  // e o fallback cobre o instante entre o boot e a primeira renovação.
  const user = { name: emailDaSessao() };

  // "Auto mode" (RN-153) exige `maintainer` no endpoint que grava a curinga —
  // mesma aproximação de `ProjectApprovalsTab.tsx`/`ProjectSettingsTab.tsx`
  // (papel de WORKSPACE; não existe hoje um papel de PROJETO no cliente).
  const { data: workspaceComPapel } = useCurrentWorkspaceWithRole();
  const podeAtivarAutoMode =
    workspaceComPapel?.role === 'owner' || workspaceComPapel?.role === 'maintainer';
  // RN-161: MESMO papel EFETIVO que `POST .../execution/activate` já exige
  // no backend (`RequireRole('maintainer')`, ver `ExecutionController`) —
  // decide se aceitar o handoff pro Dev Lead encadeia a ativação sozinho
  // (ver `handleAcceptHandoff`) ou se o segundo clique em "Ativar execução"
  // continua necessário. Quem só é `developer` não perde nada: continua
  // podendo aceitar o handoff, só não ganha o atalho — ativar exige
  // `maintainer`/`owner` de qualquer forma, então encadear para um
  // `developer` só produziria uma chamada fadada a 403.
  const podeFundirHandoffComExecucao =
    workspaceComPapel?.role === 'owner' || workspaceComPapel?.role === 'maintainer';

  const [asideOpen, setAsideOpen] = useState(true);
  // Log completo de eventos — fechado por padrão, mas abre sozinho quando
  // a navegação traz um `highlightEvent` (chip de evidência do Psicólogo).
  const [logOpen, setLogOpen] = useState(!!highlightEvent);
  const [draft, setDraft] = useState('');
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
  // Carrossel de histórias (RN-148) — "Aprovar todas" promove o LOTE inteiro
  // numa chamada só (`promoteStories` já é lote por natureza); estado
  // separado de `promovendoStoryId` porque as duas ações podem existir na
  // mesma tela (um slide promovendo sozinho enquanto o lote não foi
  // acionado) e cada botão desabilita só o que é dele.
  const [promovendoTodas, setPromovendoTodas] = useState(false);
  // Ativação inline da execução, a partir do card de aceite do handoff pro
  // Dev Lead (achado do problema 2) — mesmo padrão de `promovendoStoryId`.
  const [ativandoExecucao, setAtivandoExecucao] = useState(false);
  // Gate `necessidade-validada` (RN-406) — diferente de `streaming`
  // (`handleReadiness`/`handleArchitectureReadiness`), esta confirmação NÃO
  // é um turno do engine: é só um POST que grava o evento, mesmo padrão de
  // `ativandoExecucao`.
  const [validandoNecessidade, setValidandoNecessidade] = useState(false);
  // Handoff manual a agente à escolha (ADR 0109/RN-440) — o seletor some
  // depois do envio (some junto com `offeredHandoff` ao ser aceito), então
  // não precisa lembrar a escolha entre um handoff e outro.
  const [manualHandoffTarget, setManualHandoffTarget] = useState('');
  const [enviandoHandoffManual, setEnviandoHandoffManual] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  // Achado 10: sentinela no fim da lista de mensagens — a sessão abre nela,
  // em vez de abrir no TOPO (mais antigas primeiro), que era o comportamento
  // sem NENHUM scroll automático.
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // O CONTEÚDO do fio (RN-173) — o que muda de altura. O container rola, mas
  // não é ele que cresce; observar o container não veria nada.
  const messagesInnerRef = useRef<HTMLDivElement | null>(null);
  const abriuNoFimRef = useRef(false);

  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) });
  // RN-579: com o canal da sessão VIVO, os polls desta tela viram fallback
  // longo e quem diz quando buscar é o aviso do canal (`canal-vivo.ts`). A
  // transição de status da sessão é da api e não tem aviso — é o fallback
  // que a traz; as transições feitas AQUI já invalidam a chave na hora.
  const canalVivo = useCanalDaSessaoVivo(sessionId);
  // RN-582 (ADR 0165): o atalho "Ativar execução" do card do handoff ao Dev
  // Lead só existe com repositório — sem ele a api responde 409. Só a
  // ausência CONFIRMADA esconde o atalho ("não sei" não vira "não tem"), e a
  // mesma `queryKey` das outras telas evita requisição a mais.
  const repositorioQuery = useQuery({
    queryKey: ['repository', projectId],
    queryFn: () => getRepository(projectId),
  });
  const semRepositorio = repositorioQuery.isSuccess && repositorioQuery.data === null;
  const { data: session } = useQuery({
    queryKey: ['session', projectId, sessionId],
    queryFn: () => getSession(projectId, sessionId),
    refetchInterval: pollQueParaNoErro(intervaloDaSessao(5000, canalVivo)),
  });
  // Extraído para cima do bloco de rótulo/hashtag/tipo (onde vivia antes): o
  // card de handoff inline no fio (RN-125) precisa da mesma pergunta antes
  // de a timeline ser montada, e computá-la duas vezes criaria duas fontes
  // da mesma verdade.
  const isActive = session?.status === 'active';

  // O cluster de estado do canal de turno — deixado de fora, de propósito,
  // da decomposição em 5 PRs (ADR 0122): "controle de fluxo entrelaçado, não
  // um move mecânico". ADR 0124 é a ADR própria, numerada à parte, que
  // aquele texto previu. Ver `lib/session-turno.ts` para o desenho completo
  // do hook (por que `cancelarTurnoOtimista` cobre só duas das cinco formas
  // de desfazer o arme, por que o efeito do canal Phoenix move inteiro).
  const {
    streaming,
    streamingText,
    streamingAgent,
    turnoViaCanal,
    statusAgent,
    pensandoVisivel,
    atividadeDoTurno,
    optimisticUser,
    iniciarTurnoDoAgente,
    finalizarTurnoDoAgente,
    cancelarTurnoOtimista,
    acompanharTurnoPeloLog,
    setStreaming,
    setStreamingText,
    setOptimisticUser,
    setTurnoViaCanal,
    turnoAgentRef,
  } = useTurnoDoAgente(projectId, sessionId, session?.status, queryClient);

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

  // Conteúdo novo acompanha o fim SE o usuário já estava lá — não arranca o
  // scroll de quem subiu pra reler o histórico. A guarda dos 120px é
  // DELIBERADA e continua intacta: ela é a diferença entre "o chat me segue"
  // e "o chat me arrasta".
  const acompanharOFim = useCallback(() => {
    if (!abriuNoFimRef.current) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const pertoDoFim =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (pertoDoFim) rolarParaOFim(messagesEndRef.current);
  }, []);

  // RN-173: as dependências eram só `[events.length, streamingText]`, e por
  // isso TUDO que cresce o fio sem um evento novo passava despercebido — um
  // `ApprovalCard` chegando pelo poll de `usePendingActions` (que é uma query
  // SEPARADA) empurrava a conversa para fora da tela sem rolar nada. `actions`
  // entra aqui pelo mesmo motivo que `events`: é uma das duas fontes da
  // timeline.
  useEffect(() => {
    acompanharOFim();
  }, [events.length, actions.length, streamingText, acompanharOFim]);

  // A outra metade do mesmo problema, e a que NENHUMA lista de dependências
  // resolve: altura que muda sem estado novo no `SessionPage` — abrir/fechar
  // um `Disclosure` (o colapso por agente da RN-138, os "Detalhes" do próprio
  // card de aprovação), o Markdown reflowando, um diagrama renderizando
  // depois. Quem sabe disso é o LAYOUT, não o React, então quem pergunta é um
  // `ResizeObserver` — sobre o CONTEÚDO, com a MESMA guarda dos 120px.
  //
  // A guarda de existência é a mesma razão de `rolarParaOFim`: jsdom não
  // implementa `ResizeObserver`, e num navegador de verdade ele sempre existe
  // — a guarda nunca muda o comportamento visível.
  useEffect(() => {
    const alvo = messagesInnerRef.current;
    if (!alvo || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(() => acompanharOFim());
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [acompanharOFim]);

  const handoffsQuery = useHandoffs(projectId, sessionId, 3000);
  const handoffs = handoffsQuery.data ?? [];

  // As seis derivações de "prontidão" (RN-160/RN-161) — `criativoActive`,
  // `arquitetoActive`, `hasBusinessRule`, `hasPromotedStory`,
  // `hasProductBrief` e `activeAgent` — moraram aqui até a extração do hook
  // `useSessionReadiness` (PR 5/5 da decomposição de `SessionPage.tsx`, ADR
  // 0122): mesma lógica, mesmas dependências, só re-hospedadas atrás de um
  // contrato de parâmetros explícito (`../lib/session-readiness.ts`).
  const backlogQuery = useBacklog(projectId, undefined, sessionId);
  const {
    criativoActive,
    arquitetoActive,
    hasBusinessRule,
    hasPromotedStory,
    hasProductBrief,
    activeAgent,
  } = useSessionReadiness(events, backlogQuery.data);

  // As derivações de handoff (RN-136, RN-499, achado L, RN-406) moram em
  // `../lib/session-handoffs` desde o PR 6 do ADR 0176 — puras, calculadas
  // a cada render como antes.
  const {
    activeFor,
    offeredHandoff,
    handoffDaInfraOferecido,
    prontidaoJaDeclarada,
    arquiteturaJaDeclarada,
    necessidadeJaValidada,
  } = derivarHandoffsDaSessao(events, handoffs);

  // `iniciarTurnoDoAgente`, `finalizarTurnoDoAgente`, `cancelarTurnoOtimista`
  // e o efeito do canal Phoenix (que armava/desarmava este mesmo cluster de
  // estado) moraram aqui até a extração do hook `useTurnoDoAgente` (ADR
  // 0124) — ver `lib/session-turno.ts` para o desenho completo, incluindo
  // por que `cancelarTurnoOtimista` cobre só duas das cinco formas de
  // desfazer o arme encontradas no arquivo.

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
  // `null` (sessão sem teto próprio) é o estado normal, e volta 304 desde a
  // RN-579 (`etag-do-corpo-vazio.ts` na api). Gasto de token não tem evento
  // próprio: quem antecipa é o `agent.done` e a atividade dos agentes.
  const { data: budget } = useQuery({
    queryKey: ['session-budget', projectId, sessionId],
    queryFn: () => getSessionBudget(projectId, sessionId),
    refetchInterval: pollQueParaNoErro(
      intervaloDaSessao(5000, canalVivo, INTERVALO_DO_ORCAMENTO_COM_CANAL_MS),
    ),
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

  // O efeito que arma/desarma o timer de 5s do indicador de "pensando"
  // (RN-131) morou aqui até a extração do hook `useTurnoDoAgente` (ADR
  // 0124) — é função pura de `streaming`/`statusAgent`/`atividadeDoTurno`,
  // todos internos ao cluster de turno, então move junto.

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

  const invalidateActions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['session-actions', projectId, sessionId] });
  }, [queryClient, projectId, sessionId]);

  // A montagem mora em `./session-timeline-montagem` desde o PR 2 do ADR
  // 0176. A lista de dependências abaixo é a MESMA de antes, byte a byte.
  const timeline = useMemo<TimelineEntry[]>(
    () =>
      montarTimeline({
        events,
        actions,
        backlogQuery,
        projectId,
        sessionId,
        t,
        user,
        queryClient,
        invalidateActions,
        offeredHandoff,
        isActive,
        semRepositorio,
        promovendoStoryId,
        promovendoTodas,
        ativandoExecucao,
        podeAtivarAutoMode,
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
      }),
    [
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
      promovendoTodas,
      ativandoExecucao,
      podeAtivarAutoMode,
      iniciarTurnoDoAgente,
      finalizarTurnoDoAgente,
      acompanharTurnoPeloLog,
      backlogQuery.data,
    ],
  );

  // O colapso por agente que passou o bastão (RN-138) e o corte do fio
  // (RN-177) moram em `./session-fio` desde o PR 1 do ADR 0176 — mesmas
  // dependências de antes, só o corpo mudou de arquivo.
  const timelineAgrupada = useMemo(
    () => agruparTimelinePorAgente(timeline, handoffs, actions, t),
    [timeline, handoffs, actions],
  );

  const fio = useMemo(() => dividirFio(timelineAgrupada), [timelineAgrupada]);

  // "Ativar sessão" chama o engine por baixo (a api cria a sessão
  // supervisionada), e por isso falha por motivo que não é do domínio: engine
  // fora do ar, url errada, 500. Sem o `catch`, o clique não mudava NADA na
  // tela — mesmo desfecho de `handleActivateExecution` antes dele ganhar toast.
  async function handleActivate() {
    try {
      await transitionSession(projectId, sessionId, 'active');
      await queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('toasts.erroAtivarSessao')),
        tone: 'danger',
      });
    }
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
      showToast({ title: t('toasts.erro'), message: t('toasts.erroRenomear'), tone: 'danger' });
    }
  }

  async function handleStartIdeation() {
    try {
      await startAgent(projectId, sessionId, 'criativo');
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
    } catch {
      showToast({ title: t('toasts.erro'), message: t('toasts.erroIniciarIdeacao'), tone: 'danger' });
    }
  }

  /**
   * AT-154 (RN-581): a api recusou conversa porque a sessão já é terminal. A
   * tela diz isso e refaz a leitura da sessão — é o `status` novo que faz o
   * composer sumir, como já some em `closed`. Não promete "Reabrir": a ação
   * não existe ainda (AT-071). Devolve `true` quando era essa recusa.
   */
  function avisarSessaoEncerrada(erro: unknown): boolean {
    if (!ehRecusaDeSessaoEncerrada(erro)) return false;
    showToast({
      title: t('toasts.erro'),
      message: t('toasts.sessaoEncerrada'),
      tone: 'danger',
    });
    queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
    queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
    return true;
  }

  async function handleReadiness() {
    try {
      iniciarTurnoDoAgente('criativo');
      await confirmReadiness(projectId, sessionId);
      // ADR 0163 (RN-578): resolver é o ACEITE, não o fim do turno — o
      // product_brief + handoff chegam depois, pelo canal (`agent.done`) e
      // pelo log. Até lá esta linha era `finalizarTurnoDoAgente()` (a rede de
      // segurança da RN-131), e a chamada só resolvia com o turno pronto.
      acompanharTurnoPeloLog('criativo');
    } catch (erro) {
      cancelarTurnoOtimista();
      if (avisarSessaoEncerrada(erro)) return;
      // A recusa do agente (409 turno em curso, 422 sem regra de negócio) traz
      // a frase dele; a mensagem genérica fica para o que não tem frase.
      showToast({
        title: t('toasts.erro'),
        message: mensagemDaRecusaDoAgente(erro, t('toasts.erroConfirmarProntidao')),
        tone: 'danger',
      });
    }
  }

  /**
   * Mirror de `handleReadiness`, para o Arquiteto (achado do problema 1):
   * dispara `OfferInfraHandoffUseCase`, que oferece o handoff ao Infra e ao
   * Dev Lead na MESMA confirmação (FASE 14d) — o Arquiteto narra a arquitetura
   * pronta no fio, e os dois handoffs nascem em seguida. Desde o ADR 0163 a
   * chamada resolve no ACEITE, e o fim do turno de fechamento chega pelo
   * canal e pelo log (`acompanharTurnoPeloLog`).
   */
  async function handleArchitectureReadiness() {
    try {
      iniciarTurnoDoAgente('arquiteto');
      await confirmArchitectureReadiness(projectId, sessionId);
      acompanharTurnoPeloLog('arquiteto');
    } catch (erro) {
      cancelarTurnoOtimista();
      if (avisarSessaoEncerrada(erro)) return;
      showToast({
        title: t('toasts.erro'),
        message: mensagemDaRecusaDoAgente(erro, t('toasts.erroConfirmarArquitetura')),
        tone: 'danger',
      });
    }
  }

  /**
   * Gate `necessidade-validada` (RN-406, ADR 0095) — o usuário confirma que
   * o `product_brief` que o Criativo consolidou reflete de verdade a
   * necessidade de negócio. Diferente de `handleReadiness`/
   * `handleArchitectureReadiness`, NÃO é um `GenServer.call` síncrono no
   * engine (o handoff Criativo→PO já aconteceu dentro do próprio
   * `confirm_readiness`): é só um POST que grava `necessity.validated`, sem
   * turno pra esperar — por isso não usa `streaming`, e sim um loading
   * próprio (`validandoNecessidade`), mesmo padrão de `handleActivateExecution`.
   */
  async function handleValidateNecessity() {
    if (validandoNecessidade) return;
    setValidandoNecessidade(true);
    try {
      await validateNecessity(projectId, sessionId);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      showToast({ title: t('toasts.necessidadeValidada'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('toasts.erroValidarNecessidade')),
        tone: 'danger',
      });
    } finally {
      setValidandoNecessidade(false);
    }
  }

  // Handoff manual a agente à escolha (ADR 0109/RN-440): não é um turno do
  // engine (mesmo padrão de `handleValidateNecessity`, não de `handleSend`),
  // então não liga `streaming`/`iniciarTurnoDoAgente`. O card de aceite
  // existente (`offeredHandoff`) pega o handoff novo sozinho no próximo poll
  // de `useHandoffs` (3s) — sem isso a invalidação já cobriria o mesmo
  // resultado mais rápido, mas o handoff em si só passa a existir depois
  // deste POST responder.
  async function handleRequestManualHandoff() {
    if (!manualHandoffTarget || enviandoHandoffManual) return;
    setEnviandoHandoffManual(true);
    try {
      await requestManualHandoff(projectId, sessionId, manualHandoffTarget);
      await queryClient.invalidateQueries({
        queryKey: ['session-handoffs', projectId, sessionId],
      });
      setManualHandoffTarget('');
      showToast({ title: t('toasts.handoffManualEnviado'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('toasts.erroHandoffManual')),
        tone: 'danger',
      });
    } finally {
      setEnviandoHandoffManual(false);
    }
  }

  async function handleAcceptHandoff(handoffId: string, toAgent: string) {
    // Fixado ANTES do `await` (achado B): o kickoff do agente no engine é um
    // `GenServer.cast` assíncrono, e o `agent.status` "working" pode chegar
    // pelo canal antes mesmo desta chamada resolver. Sem o ref pronto agora,
    // o handler perderia a corrida e o indicador nasceria sem saber quem é.
    iniciarTurnoDoAgente(toAgent, { comStatus: false });
    try {
      await acceptHandoff(projectId, sessionId, handoffId);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      // O aceite ao Arquiteto (e ao Dev Lead, segunda porta) provisiona o
      // repositório (RN-582) — as telas que perguntam por ele precisam saber.
      queryClient.invalidateQueries({ queryKey: ['repository', projectId] });
      queryClient.invalidateQueries({ queryKey: ['session-handoffs', projectId, sessionId] });
      // RN-161: fusão condicional por papel EFETIVO. `maintainer`/`owner` já
      // pode ativar a execução (mesma exigência do backend em
      // `POST .../execution/activate`) — encadear aqui poupa o segundo
      // clique em "Ativar execução". `handleActivateExecution` trata o
      // próprio erro (toast + `mensagemDaApi`) e não relança, então um
      // 403/409 dela nunca cai neste `catch` como "não foi possível aceitar
      // o handoff", que seria a frase ERRADA (o aceite já tinha funcionado).
      // Quem só é `developer` mantém o fluxo de hoje: aceitar sem encadear,
      // com "Ativar execução" continuando disponível como segundo botão
      // enquanto o card seguir na tela.
      if (toAgent === 'dev-lead' && podeFundirHandoffComExecucao) {
        await handleActivateExecution();
      }
    } catch {
      turnoAgentRef.current = null;
      setTurnoViaCanal(false);
      showToast({ title: t('toasts.erro'), message: t('toasts.erroAceitarHandoff'), tone: 'danger' });
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
      showToast({ title: t('toasts.execucaoAtivada'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('toasts.erroAtivarExecucao')),
        tone: 'danger',
      });
    } finally {
      setAtivandoExecucao(false);
    }
  }

  // "Auto mode" (RN-153) — grava a curinga `actionType: "*"` de
  // `agent_autonomy` pro agente que propôs a ação do card. NÃO aprova a ação
  // em si (isso é o botão Aprovar); liga a autonomia pras PRÓXIMAS. Mesma
  // `queryKey` (`agent-autonomy`) que a Visão Geral/Executores leem pro
  // toggle do card do agente — é ele que serve de "desligar" depois.
  async function handleActivateAutoMode(agentId: string) {
    try {
      await setAgentAutonomy(projectId, {
        agentId,
        actionType: AGENT_AUTONOMY_ALL_ACTIONS,
        mode: 'auto_approve',
      });
      await queryClient.invalidateQueries({ queryKey: ['agent-autonomy', projectId] });
      showToast({ title: t('toasts.modoAutomaticoLigado'), message: agentId, tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('toasts.erroModoAutomatico')),
        message: agentId,
        tone: 'danger',
      });
    }
  }

  // Promoção inline (RN-126) — mesmos `promoteStories`/`returnStory` que
  // `PromotionQueue` já chama; só o gatilho muda, do botão na aba Backlog
  // pro card no fio. `promoteStories` é sempre lote (mesmo pra uma história),
  // e a resposta traz `failed` com o motivo do domínio quando recusa — o
  // toast reaproveita essa informação em vez de um "erro" genérico.
  async function handlePromoteStory(storyId: string) {
    if (promovendoStoryId || promovendoTodas) return;
    setPromovendoStoryId(storyId);
    try {
      const r = await promoteStories(projectId, [storyId]);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      if (r.failed.length > 0) {
        showToast({
          title: t('toasts.erroPromover'),
          message: r.failed[0]?.reason,
          tone: 'danger',
        });
      } else {
        showToast({ title: t('toasts.historiaPromovida'), tone: 'success' });
      }
    } catch {
      showToast({ title: t('toasts.erro'), message: t('toasts.erroPromoverHistoria'), tone: 'danger' });
    } finally {
      setPromovendoStoryId(null);
    }
  }

  // "Aprovar todas" do carrossel (RN-148) — uma chamada só de `promoteStories`
  // com o LOTE inteiro, em vez de N chamadas em série. A resposta tem a mesma
  // forma da unitária (`promoted`/`failed`), e o toast soma: sucesso total,
  // parcial (com o motivo da primeira falha) ou falha total.
  async function handlePromoteAll(storyIds: string[]) {
    if (promovendoStoryId || promovendoTodas || storyIds.length === 0) return;
    setPromovendoTodas(true);
    try {
      const r = await promoteStories(projectId, storyIds);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      if (r.failed.length === 0) {
        showToast({
          title: t('toasts.historiasPromovidas', { count: r.promoted.length }),
          tone: 'success',
        });
      } else if (r.promoted.length > 0) {
        showToast({
          title: t('toasts.promovidasParcial', { promovidas: r.promoted.length, total: storyIds.length }),
          message: r.failed[0]?.reason,
          tone: 'warning',
        });
      } else {
        showToast({
          title: t('toasts.erroPromover'),
          message: r.failed[0]?.reason,
          tone: 'danger',
        });
      }
    } catch {
      showToast({ title: t('toasts.erro'), message: t('toasts.erroPromoverHistorias'), tone: 'danger' });
    } finally {
      setPromovendoTodas(false);
    }
  }

  async function handleReturnStory() {
    if (!recusandoStory || motivoRecusa.trim() === '' || enviandoRecusa) return;
    setEnviandoRecusa(true);
    // RN-174: devolver NÃO é só gravar a recusa — `ReturnStoryUseCase` chama
    // `reviseStory`, que é um `handle_call({:revise, …})` no `po_server`, e
    // esta chamada só resolve depois de o PO rodar o turno INTEIRO (reescrever
    // a história). Sem armar o indicador, a tela ficava muda esse tempo todo.
    //
    // Quem reescreve é SEMPRE o PO (`reviseStory` → `po_server`), não o
    // `activeAgent` do momento — é por ele que o log é lido depois do aceite.
    iniciarTurnoDoAgente('po');
    try {
      await returnStory(projectId, recusandoStory.id, motivoRecusa.trim());
      setRecusandoStory(null);
      setMotivoRecusa('');
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      showToast({ title: t('toasts.historiaDevolvida'), tone: 'success' });
      // ADR 0163 (RN-578): resolver é o ACEITE. Se o PO não estava de pé, a
      // api engoliu a notificação e nenhum `working` novo foi gravado — o
      // `idle` antigo é o mais recente, e a leitura do log fecha na hora.
      acompanharTurnoPeloLog('po');
    } catch {
      showToast({ title: t('toasts.erro'), message: t('toasts.erroDevolverHistoria'), tone: 'danger' });
      // Um erro que deixasse `streaming` ligado travaria o composer até o
      // próximo turno.
      finalizarTurnoDoAgente();
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
        showToast({ title: t('toasts.erro'), message: t('toasts.erroIniciarIdeacao'), tone: 'danger' });
        return;
      }
    }

    // Sessão com um agente ativo (Criativo, PO, Arquiteto, Dev Lead…): o
    // turno roda no engine (harness); os deltas e o fim chegam pelo canal
    // Phoenix. Senão (sessão consultiva), chat humano stateless via SSE.
    if (agentParaEnviar) {
      // A faixa de atividade (`turnoViaCanal`) liga AQUI, e não no `try` —
      // `statusAgent` dá nome ao avatar da faixa mesmo antes de o primeiro
      // `agent.status`/`agent.delta` do canal chegar (o mesmo argumento de
      // `iniciarTurnoDoAgente`). `streaming`/`streamingText` já foram ligados
      // acima, antes de `agentParaEnviar` ser conhecido — os dois também
      // fazem parte do arme, mas religá-los aqui é reset pro mesmo valor,
      // sem efeito observável.
      iniciarTurnoDoAgente(agentParaEnviar);
      try {
        await sendAgentMessage(projectId, sessionId, agentParaEnviar, text);
        // ADR 0163 (RN-578): resolver é o ACEITE — o turno segue no engine e
        // o fim chega pelo canal (`agent.done`) ou, se o canal perdeu o
        // broadcast (join ainda não concluído, RN-108), pela leitura da cauda
        // do log. Até o ADR 0163 esta chamada só resolvia com o turno pronto
        // e era ela a rede de segurança: aqui havia `finalizarTurnoDoAgente()`.
        acompanharTurnoPeloLog(agentParaEnviar);
      } catch (erro) {
        cancelarTurnoOtimista();
        setOptimisticUser(null);
        // AT-154: a sessão fechou por baixo — devolve o texto, que já saiu do
        // campo, e diz por quê em vez do erro genérico.
        if (avisarSessaoEncerrada(erro)) {
          setDraft((atual) => atual || text);
          return;
        }
        // 409 com o agente ainda no meio de um turno traz a frase do engine
        // ("ficou registrada, mas não foi lida") — antes era aceita e sumia.
        showToast({
          title: t('toasts.erro'),
          message: mensagemDaRecusaDoAgente(erro, t('toasts.erroEnviarMensagem')),
          tone: 'danger',
        });
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
          showToast({ title: t('toasts.erroNoChat'), message: evt.message, tone: 'danger' });
        } else if (evt.type === 'metering_failed') {
          showToast({ title: t('toasts.aviso'), message: evt.message, tone: 'warning' });
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
      showToast({ title: t('toasts.erro'), message: t('toasts.erroCancelarTurno'), tone: 'danger' });
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
      <SessionTopbar
        projectId={projectId}
        sessionId={sessionId}
        session={session}
        rascunhoDoNome={rascunhoDoNome}
        setRascunhoDoNome={setRascunhoDoNome}
        handleRename={handleRename}
        hashtag={hashtag}
        rotulo={rotulo}
        metaDaSessao={metaDaSessao}
        tipo={tipo}
        modelsByCategory={modelsByCategory}
        resolvedBinding={resolvedBinding}
        budget={budget}
        queryClient={queryClient}
        isActive={isActive}
        sessaoCriativa={sessaoCriativa}
        criativoActive={criativoActive}
        conviteVisivel={conviteVisivel}
        handleStartIdeation={handleStartIdeation}
        handleClose={handleClose}
        asideOpen={asideOpen}
        setAsideOpen={setAsideOpen}
      />

      <div className={styles.body}>
        <div className={styles.chatColumn}>
          <div className={styles.messages} ref={scrollContainerRef}>
            <div className={styles.messagesInner} ref={messagesInnerRef}>
              <SessionFio
                conviteVisivel={conviteVisivel}
                sessaoCriativa={sessaoCriativa}
                criativoActive={criativoActive}
                isActive={isActive}
                handleStartIdeation={handleStartIdeation}
                setDraft={setDraft}
                fio={fio}
                optimisticUser={optimisticUser}
                user={user}
                turnoViaCanal={turnoViaCanal}
                streamingText={streamingText}
                pensandoVisivel={pensandoVisivel}
                streaming={streaming}
                statusAgent={statusAgent}
                agenteExibido={agenteExibido}
              />
              {/* Sentinela do achado 10 — alvo do scroll de abertura e do
                  "acompanha o fim" enquanto o usuário está perto dele. */}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* A faixa de atividade do turno — narra em tempo real o que um
              agente conversacional está fazendo, FORA da área que rola (o
              fio já rola pra ela sozinho quando o card final chega, via a
              invalidação que `finalizarTurnoDoAgente` dispara). Só existe
              turno de agente via `turnoViaCanal`: o chat consultivo sem
              agente ativo continua na bolha antiga, dentro do fio. */}
          {turnoViaCanal && (
            <TurnActivityStrip
              estado={atividadeDoTurno}
              agente={streamingAgent ?? statusAgent}
              pensandoVisivel={pensandoVisivel}
            />
          )}

          <SessionComposer
            isActive={isActive}
            handoffDaInfraOferecido={handoffDaInfraOferecido}
            handleAcceptHandoff={handleAcceptHandoff}
            manualHandoffTarget={manualHandoffTarget}
            setManualHandoffTarget={setManualHandoffTarget}
            enviandoHandoffManual={enviandoHandoffManual}
            activeFor={activeFor}
            handleRequestManualHandoff={handleRequestManualHandoff}
            session={session}
            draft={draft}
            setDraft={setDraft}
            handleComposerKeyDown={handleComposerKeyDown}
            streaming={streaming}
            handleSend={handleSend}
            handleCancel={handleCancel}
            criativoActive={criativoActive}
            prontidaoJaDeclarada={prontidaoJaDeclarada}
            handleReadiness={handleReadiness}
            hasBusinessRule={hasBusinessRule}
            arquitetoActive={arquitetoActive}
            arquiteturaJaDeclarada={arquiteturaJaDeclarada}
            handleArchitectureReadiness={handleArchitectureReadiness}
            hasPromotedStory={hasPromotedStory}
            necessidadeJaValidada={necessidadeJaValidada}
            validandoNecessidade={validandoNecessidade}
            handleValidateNecessity={handleValidateNecessity}
            hasProductBrief={hasProductBrief}
            handleActivate={handleActivate}
          />
        </div>

        {asideOpen && (
          <ContextAside
            projectId={projectId}
            sessionId={sessionId}
            actions={actionsQuery.data?.items ?? []}
            // O MESMO pausa-poll do fio (achados 2/7): o painel lê a mesma
            // query, e um segundo observador com timer próprio ressuscitaria
            // o poll que o turno em streaming pausa.
            pausarPoll={streaming}
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
          title={t('modal.devolverTitulo', { titulo: recusandoStory.title })}
          onClose={() => setRecusandoStory(null)}
        >
          <Textarea
            label={t('modal.motivo')}
            value={motivoRecusa}
            onChange={(e) => setMotivoRecusa(e.target.value)}
            hint={t('modal.motivoDica')}
            placeholder={t('modal.motivoPlaceholder')}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="danger"
              loading={enviandoRecusa}
              disabled={motivoRecusa.trim() === ''}
              onClick={handleReturnStory}
            >
              {t('modal.devolverAoPo')}
            </Button>
            <Button variant="ghost" onClick={() => setRecusandoStory(null)}>
              {t('modal.cancelar')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
