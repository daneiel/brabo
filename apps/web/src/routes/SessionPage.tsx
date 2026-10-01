import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
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
  renameSession,
  sendAgentMessage,
  startAgent,
  transitionSession,
  reopenSession,
} from '../lib/api-client';
import { streamChatMessage } from '../lib/chat-stream';
import { PendenciasDeOutrasSessoes } from '../components/PendenciasDeOutrasSessoes';
import { roleAtLeast } from '../lib/roles';
import { useRetomarTurnoDoLog, useTurnoDoAgente } from '../lib/session-turno';
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
import { useAutoriaDaSessao } from '../lib/autoria-da-sessao';
import { AGENTS } from '../lib/agents';
import { useToast } from '../components/ui/ToastProvider';
import { TurnActivityStripDoStore } from '../components/TurnActivityStrip';
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
import { chaveDoIdiomaDaSessao } from '../lib/idioma-da-resposta';
import { SessionFio } from './SessionFio';
import { SessionComposer } from './SessionComposer';
import {
  DESTINATARIO_DA_SESSAO_CRIATIVA,
  useAtivadosNaSessaoInteira,
  useAtivosNoProjeto,
  useDestinatarioDoChat,
} from '../lib/session-destinatario';
import { derivarHandoffsDaSessao } from '../lib/session-handoffs';
import { useRolagemDoFio } from '../lib/session-rolagem';
import { usePromocaoDeHistorias } from '../lib/session-promocao';
import { useAcoesDeHandoff } from '../lib/session-acoes-de-handoff';
import { DevolverHistoriaModal } from './DevolverHistoriaModal';
import { GavetaDoContexto } from './GavetaDoContexto';
import { usePainelDeContexto } from '../lib/painel-de-contexto';
import { useLayoutMovel } from '../lib/layout-movel';

/**
 * O vazio ESTÁVEL (AT-301): `?? []` cria um array novo a cada render, e todo
 * `useMemo` que depende dele recalcula sempre — o memo vira custo sem ganho.
 * Tipado como `never[]` para servir às três listas; congelado porque nenhum
 * consumidor pode empurrar nele.
 */
const VAZIO: never[] = Object.freeze([]) as unknown as never[];

interface SessionPageProps {
  projectId: string;
  sessionId: string;
  /** Evidência do Psicólogo (Fase 4b) — abre o log e rola até o evento. */
  highlightEvent?: string;
  /**
   * Leva a tela a outra sessão do projeto (RN-634): depois de "Ativar
   * execução", a sessão de execução que a api criou. Vem da rota (o
   * `navigate` do router), e sem ela a tela só avisa.
   */
  irParaSessao?: (sessionId: string) => void;
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

export function SessionPage({
  projectId,
  sessionId,
  highlightEvent,
  irParaSessao,
}: SessionPageProps) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  // O access token carrega o e-mail; o nome não vem mais em claim nenhuma
  // (Fase 7a). Para o rótulo de autoria da própria mensagem, o e-mail serve —
  // e o fallback cobre o instante entre o boot e a primeira renovação.
  const user = { name: emailDaSessao() };
  // RN-652: o autor de cada fala do fio sai do ATOR do evento, resolvido
  // contra quem vê e os membros do projeto — `user` acima é só o rótulo da
  // mensagem OTIMISTA, que é sempre de quem vê.
  const autoria = useAutoriaDaSessao(projectId);

  // "Auto mode" (RN-153) exige `maintainer` no endpoint que grava a curinga —
  // mesma aproximação de `ProjectApprovalsTab.tsx`/`ProjectSettingsTab.tsx`
  // (papel de WORKSPACE; não existe hoje um papel de PROJETO no cliente).
  const { data: workspaceComPapel } = useCurrentWorkspaceWithRole();
  const podeAtivarAutoMode =
    workspaceComPapel?.role === 'owner' || workspaceComPapel?.role === 'maintainer';
  // AT-265/266: decidir ação e propor merge pedem `developer` no ENDPOINT
  // (RN-102) — `roleAtLeast`, nunca lista à mão. O papel lido é o de WORKSPACE:
  // a tela não busca `project_members`, e a lacuna (RN-471) fica declarada.
  const podeDecidir = roleAtLeast(workspaceComPapel?.role, 'developer');
  // ADR 0184 (RN-650): reabrir pede `developer` no endpoint, o de encerrar.
  // Mesmo papel de WORKSPACE (a lacuna da RN-471 já declarada acima).
  const podeReabrir = roleAtLeast(workspaceComPapel?.role, 'developer');
  const [reabrindo, setReabrindo] = useState(false);
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

  // AT-328: no móvel o painel nasce fechado e abre como gaveta sobre o fio.
  const movel = useLayoutMovel();
  const [asideOpen, setAsideOpen] = usePainelDeContexto(movel, !!highlightEvent);
  // Log completo de eventos — fechado por padrão, mas abre sozinho quando
  // a navegação traz um `highlightEvent` (chip de evidência do Psicólogo).
  const [logOpen, setLogOpen] = useState(!!highlightEvent);
  const [draft, setDraft] = useState('');
  // Renomear (RN-098). `null` fora de edição — e não string vazia — porque
  // vazio é um nome que se está digitando, e nenhum campo aberto é outro
  // estado.
  const [rascunhoDoNome, setRascunhoDoNome] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
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
    streamingStore,
    streamingAgent,
    turnoViaCanal,
    statusAgent,
    pensandoVisivel,
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

  // A promoção de histórias pelo fio (RN-126/RN-148) mora em
  // `../lib/session-promocao` desde o PR 8 do ADR 0176.
  const {
    promovendoStoryId,
    recusandoStory,
    setRecusandoStory,
    motivoRecusa,
    setMotivoRecusa,
    enviandoRecusa,
    promovendoTodas,
    handlePromoteStory,
    handlePromoteAll,
    handleReturnStory,
  } = usePromocaoDeHistorias({
    projectId,
    sessionId,
    queryClient,
    showToast,
    t,
    iniciarTurnoDoAgente,
    acompanharTurnoPeloLog,
    finalizarTurnoDoAgente,
  });

  // As ações de handoff e execução que não são turno de conversa (RN-440, RN-161, RN-137, RN-153) moram em `../lib/session-acoes-de-handoff`
  // desde o PR 9 do ADR 0176.
  const {
    ativandoExecucao,
    manualHandoffTarget,
    setManualHandoffTarget,
    enviandoHandoffManual,
    handleRequestManualHandoff,
    handleAcceptHandoff,
    handleActivateExecution,
    handleActivateAutoMode,
  } = useAcoesDeHandoff({
    projectId,
    sessionId,
    queryClient,
    showToast,
    t,
    podeFundirHandoffComExecucao,
    iniciarTurnoDoAgente,
    turnoAgentRef,
    setTurnoViaCanal,
    irParaSessao,
  });

  // Achados 2/7: o poll pausa ENQUANTO um turno está em streaming — buscar
  // eventos já persistidos no meio do turno duplicava a bolha (o dado novo
  // renderiza ao lado do estado otimista/streaming que ainda está na tela).
  // O fim do turno (`finalizarTurnoDoAgente`, nos dois caminhos: canal e rede
  // de segurança do `handleSend`) já invalida esta query explicitamente —
  // pausar o TIMER não perde dado, só evita buscar de novo o que a
  // invalidação busca de qualquer forma.
  const eventsQuery = useSessionEvents(projectId, sessionId, 3000, streaming);
  const events = eventsQuery.data?.items ?? VAZIO;
  // AT-268: reabrir a sessão com um turno em curso — a faixa e o composer
  // travado voltam do log, em vez de nascerem do zero e do 409.
  useRetomarTurnoDoLog({
    sessionId,
    sessionStatus: session?.status,
    eventos: eventsQuery.data?.items,
    turnoViaCanal,
    iniciarTurnoDoAgente,
    acompanharTurnoPeloLog,
  });

  // O evento CITADO buscado pelo id. A listagem traz só os últimos 200 e o
  // feed corta ruído de máquina, então sem esta busca o chip de evidência
  // podia navegar pra um log onde o evento simplesmente não aparece.
  const citedEventQuery = useSessionEvent(projectId, sessionId, highlightEvent);
  const citedEvent = citedEventQuery.data;
  const actionsQuery = usePendingActions(projectId, sessionId, 3000);
  const actions = actionsQuery.data?.items ?? VAZIO;

  // A rolagem do fio (achado 10, Fase 4b, RN-173) mora em
  // `../lib/session-rolagem` desde o PR 7 do ADR 0176 — os mesmos refs e
  // efeitos, chamados neste mesmo ponto.
  const { messagesEndRef, scrollContainerRef, messagesInnerRef } = useRolagemDoFio({
    highlightEvent,
    logOpen,
    events,
    actions,
    streamingStore,
  });

  const handoffsQuery = useHandoffs(projectId, sessionId, 3000);
  const handoffs = handoffsQuery.data ?? VAZIO;
  // Quem já foi ativado na sessão PEDIDA, de fontes sem janela (RN-630,
  // RN-631): o resumo quando esta é a sessão mais recente, os handoffs desta
  // sessão e o gasto por agente dela. Somado à janela pelo destinatário do
  // composer e pelas ofertas de handoff.
  const ativadosNaSessaoInteira = useAtivadosNaSessaoInteira(
    workspaceComPapel?.workspace.id,
    projectId,
    sessionId,
    handoffs,
  );
  // RN-633 (AT-294): quem já roda na sessão MAIS RECENTE do projeto (a de
  // execução, depois de ativada) — a oferta a ele não é acionável aqui.
  const ativosNoProjeto = useAtivosNoProjeto(workspaceComPapel?.workspace.id, projectId);

  // As derivações de "prontidão" (RN-160/RN-161) — `criativoActive`,
  // `arquitetoActive`, `hasBusinessRule` e `hasPromotedStory` — moraram aqui até a extração do hook
  // `useSessionReadiness` (PR 5/5 da decomposição de `SessionPage.tsx`, ADR
  // 0122): mesma lógica, mesmas dependências, só re-hospedadas atrás de um
  // contrato de parâmetros explícito (`../lib/session-readiness.ts`).
  const backlogQuery = useBacklog(projectId, undefined, sessionId);
  const {
    criativoActive,
    arquitetoActive,
    hasBusinessRule,
    hasPromotedStory,
  } = useSessionReadiness(events, backlogQuery.data);

  // O destinatário da mensagem do composer é ESCOLHIDO, nunca derivado do log
  // (RN-631, AT-251): as opções são os agentes que conversam e já estão na
  // sessão, e com duas ou mais sem escolha o envio trava e a tela pede uma.
  const {
    opcoes: opcoesDeDestinatario,
    destinatario,
    precisaEscolher: precisaEscolherDestinatario,
    escolher: escolherDestinatario,
  } = useDestinatarioDoChat({
    sessionId,
    events,
    handoffs,
    kind: session?.kind,
    ativadosNaSessaoInteira,
  });

  // Aceitar um handoff nesta tela é o gesto de chamar aquele agente: o
  // destinatário passa a ser ele. Aceite feito por outro caminho (outra aba,
  // outro usuário) só acrescenta a opção — não troca a escolha de ninguém.
  async function aceitarHandoff(handoffId: string, toAgent: string) {
    if (await handleAcceptHandoff(handoffId, toAgent)) escolherDestinatario(toAgent);
  }

  // As derivações de handoff (RN-136, RN-499, achado L, RN-406) moram em
  // `../lib/session-handoffs` desde o PR 6 do ADR 0176 — puras. Sob `useMemo`
  // desde a AT-301 (varrem eventos e handoffs, e a página re-renderiza por
  // motivos que não mudam nenhum dos dois) e desde a RN-631 (`ofertasAcionaveis`
  // é uma lista nova a cada chamada e entra na montagem da timeline abaixo).
  const {
    activeFor,
    ofertasAcionaveis,
    ofertasForaDaJanela,
    handoffDaInfraOferecido,
    prontidaoJaDeclarada,
    arquiteturaJaDeclarada,
  } = useMemo(
    () => derivarHandoffsDaSessao(events, handoffs, ativadosNaSessaoInteira, ativosNoProjeto),
    [events, handoffs, ativadosNaSessaoInteira, ativosNoProjeto],
  );

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
  // Achado 1: `agentId` viaja na query pra a cascata rodar pro agente a
  // quem a conversa se dirige — o destinatário do composer, RN-631
  // (sessão→agente→área→projeto→workspace, ver
  // `RunLlmTurnUseCase`) — sem ele a api só enxerga sessão→projeto→workspace
  // (mais o fallback fixo pro Criativo) e a topbar continuava mostrando o
  // modelo do Criativo depois de um handoff pro PO/Arquiteto/Dev Lead.
  // `destinatario` entra na queryKey pra a troca de destinatário refazer a
  // busca em vez de servir o binding do agente anterior do cache.
  const { data: resolvedBinding } = useQuery({
    queryKey: ['session-model-binding', projectId, sessionId, destinatario],
    queryFn: () => getSessionModelBinding(projectId, sessionId, destinatario ?? undefined),
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
        handleAcceptHandoff: aceitarHandoff,
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
      autoria,
      queryClient,
      invalidateActions,
      ofertasAcionaveis,
      isActive,
      promovendoStoryId,
      promovendoTodas,
      ativandoExecucao,
      podeAtivarAutoMode,
      podeDecidir,
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

  // A recusa da api (409 de sessão com execução, 403) vira toast com a frase
  // dela; a tela não repete a régua de execução, que só a api sabe inteira.
  async function handleReopen() {
    setReabrindo(true);
    try {
      await reopenSession(projectId, sessionId);
      await queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
      queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
    } catch (erro) {
      showToast({ title: mensagemDaApi(erro, t('toasts.erroReabrirSessao')), tone: 'danger' });
    } finally {
      setReabrindo(false);
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
      // ADR 0185: o clique fechou a necessidade (RN-657) e aceita, em nome
      // de quem clicou, o handoff ao PO que o turno oferecer (RN-658). É o
      // gesto de chamar o PO — o mesmo que aceitar pelo card (RN-631) —, então
      // o destinatário passa a ser ele; enquanto o PO não entra, a escolha
      // não vale e o Criativo, opção única, segue recebendo.
      escolherDestinatario('po');
      showToast({ title: t('toasts.prontoRegistrado'), tone: 'success' });
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
   * dispara `OfferInfraHandoffUseCase`, que oferece o handoff ao Infra — o
   * Arquiteto narra a arquitetura pronta no fio, e o handoff nasce em seguida;
   * o do Dev Lead sai da Infra, com o container `running` (RN-672). Desde o ADR 0163 a
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

  async function handleSend() {
    const text = draft.trim();
    if (!text || streaming || session?.status !== 'active') return;
    // RN-631: duas ou mais opções e nenhuma escolhida — não há a quem mandar.
    // O botão já está travado; isto cobre o Enter.
    if (precisaEscolherDestinatario) return;

    setDraft('');
    setOptimisticUser(text);
    setStreaming(true);
    setStreamingText('');

    // O destinatário escolhido (RN-631) — ou a opção única, que o composer
    // nomeia antes do envio.
    //
    // Achado 3: sessão CRIATIVA sem o Criativo ativo ainda — a primeira
    // mensagem TAMBÉM o ativa (decisão do usuário: ninguém deveria precisar
    // de um clique separado em "Iniciar ideação" antes de falar). Ativa e
    // ESPERA terminar antes de mandar a mensagem pelo caminho real
    // (`sendAgentMessage`) — nunca pelo SSE genérico mais abaixo, que não
    // tem histórico, system prompt nem a tool `emit_artifact`, e por isso
    // não registra regra de negócio nenhuma.
    //
    // "Sem o Criativo ativo" é a MESMA pergunta de antes da RN-631 — nenhum
    // agente entrou (o Criativo é a opção única, vinda só do `kind`) —, e não
    // só `!criativoActive`, que lê a janela: numa sessão longa a ativação dele
    // sai dos 200 eventos e a mensagem o reativaria com outros já em cena.
    const agentParaEnviar = destinatario;
    if (
      agentParaEnviar === DESTINATARIO_DA_SESSAO_CRIATIVA &&
      !criativoActive &&
      opcoesDeDestinatario.length === 1
    ) {
      try {
        await startAgent(projectId, sessionId, 'criativo');
        await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
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
        // RN-624: a mensagem é evidência nova — a barra relê o idioma e a
        // pergunta da detecção, se houver.
        void queryClient.invalidateQueries({ queryKey: chaveDoIdiomaDaSessao(projectId, sessionId) });
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

    // O agente DO TURNO em curso — fixado por quem o disparou
    // (`iniciarTurnoDoAgente`) ou dito pelo canal —, e só na falta dele o
    // destinatário do composer (RN-631). Parar pela escolha do seletor,
    // trocada no meio do turno de outro agente, pararia o errado.
    const agentAlvo =
      turnoAgentRef.current ?? streamingAgent ?? statusAgent ?? destinatario;

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
                streamingStore={streamingStore}
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
          {/* AT-265: as pendências que os agentes propuseram em OUTRAS sessões do
              projeto (a de execução), decididas aqui — atalho, RN-467. AT-298:
              em QUALQUER estado da sessão — encerrada e técnica inclusive. A
              decisão é sobre a ação da OUTRA sessão, não conversa nesta, e
              quem abre uma sessão encerrada para ver o histórico era
              justamente quem não via que havia algo esperando por ele. */}
          <PendenciasDeOutrasSessoes
            projectId={projectId}
            sessionId={sessionId}
            podeDecidir={podeDecidir}
          />

          {turnoViaCanal && (
            <TurnActivityStripDoStore
              store={streamingStore}
              agente={streamingAgent ?? statusAgent}
              pensandoVisivel={pensandoVisivel}
            />
          )}

          <SessionComposer
            isActive={isActive}
            handoffDaInfraOferecido={handoffDaInfraOferecido}
            ofertasForaDaJanela={ofertasForaDaJanela}
            handleAcceptHandoff={aceitarHandoff}
            opcoesDeDestinatario={opcoesDeDestinatario}
            destinatario={destinatario}
            precisaEscolherDestinatario={precisaEscolherDestinatario}
            escolherDestinatario={escolherDestinatario}
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
            handleActivate={handleActivate}
            podeReabrir={podeReabrir}
            reabrindo={reabrindo}
            handleReopen={handleReopen}
          />
        </div>

        {asideOpen && (
          <GavetaDoContexto movel={movel} aoFechar={() => setAsideOpen(false)}>
            <ContextAside
              projectId={projectId}
              sessionId={sessionId}
              actions={actions}
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
          </GavetaDoContexto>
        )}
      </div>

      <DevolverHistoriaModal
        recusandoStory={recusandoStory}
        setRecusandoStory={setRecusandoStory}
        motivoRecusa={motivoRecusa}
        setMotivoRecusa={setMotivoRecusa}
        enviandoRecusa={enviandoRecusa}
        handleReturnStory={handleReturnStory}
      />
    </div>
  );
}
