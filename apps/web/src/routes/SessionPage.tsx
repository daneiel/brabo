import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
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
  requestManualHandoff,
  returnStory,
  sendAgentMessage,
  setAgentAutonomy,
  setSessionModelBinding,
  startAgent,
  transitionSession,
  validateNecessity,
} from '../lib/api-client';
import { streamChatMessage } from '../lib/chat-stream';
import { useTurnoDoAgente } from '../lib/session-turno';
import {
  useBacklog,
  useCurrentWorkspaceWithRole,
  useSessionEvents,
  useSessionEvent,
  usePendingActions,
  useHandoffs,
} from '../lib/hooks';
import { pollQueParaNoErro } from '../lib/query-policy';
import { emailDaSessao } from '../lib/auth';
import { AGENTS, addressableAgents, corDoAgente, nomeDoAgente } from '../lib/agents';
import {
  agruparPorOrigem,
  classifyEvent,
  origemDoEvento,
  ROTULO_DA_ORIGEM,
  type OrigemDeEvento,
} from '../lib/activity';
import {
  AGENT_AUTONOMY_ALL_ACTIONS,
  type StructuredQuestion,
  type StructuredQuestionAnsweredPayload,
  type StructuredQuestionPayload,
} from '../lib/api-types';
import { useToast } from '../components/ui/ToastProvider';
import { TokenMeter } from '../components/TokenMeter';
import { ModelPicker } from '../components/ModelPicker';
import { ApprovalCard } from '../components/ApprovalCard';
import { TurnActivityStrip } from '../components/TurnActivityStrip';
import { AvatarDoAgente } from '../components/ui/AvatarDoAgente';
import { MarkdownMessage } from '../components/ui/MarkdownMessage';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Carousel, type CarouselSlide } from '../components/ui/Carousel';
import { Disclosure } from '../components/ui/Disclosure';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
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
import {
  aberturasDeTurno,
  afundarDesfechos,
  ordemDaAcaoNaTimeline,
  pontoDaSessao,
  turnoDoSeq,
  type TimelineEntry,
} from '../lib/session-timeline';
import { StorySlide } from './StorySlide';
import { StructuredQuestionCard } from './StructuredQuestionCard';
import { ContextAside } from './ContextAside';
import { AGENTES_DE_CHAT, useSessionReadiness } from '../lib/session-readiness';

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
 * `agruparNarracoesDoTurno`, logo abaixo, FICA: produz JSX (`<Disclosure>`) e
 * lê `styles.narracoes*`, então mover junto inventaria o primeiro `.tsx` sob
 * `lib/` — precedente que este PR não decide sozinho.
 */
export { aberturasDeTurno, afundarDesfechos, ordemDaAcaoNaTimeline, turnoDoSeq };

/**
 * Colapsa `agent.response` CONSECUTIVAS do mesmo turno+autor num `Disclosure`
 * compacto ("Passos do turno · N"), deixando só a ÚLTIMA intacta e fora dele —
 * a faixa de atividade (`TurnActivityStrip`) já narra o CAMINHO até a
 * resposta em tempo real; isto é o mesmo princípio aplicado ao HISTÓRICO, para
 * um turno que produziu várias respostas seguidas (ex.: o modelo "pensa em
 * voz alta" entre chamadas de ferramenta) não virar N bolhas iguais empilhadas
 * no fio.
 *
 * Roda DEPOIS de `afundarDesfechos` na composição (nunca antes: a ordem de
 * apresentação já precisa estar resolvida) e reusa os MESMOS dois campos que
 * `afundarDesfechos` já lê — `turno` e `autor` — pra decidir a partição:
 * turnos ou autores diferentes NUNCA se misturam no mesmo grupo. Só entradas
 * com `agentResponse: true` participam; qualquer outro tipo quebra a
 * sequência corrente (mesma régua de "fronteira" que `afundarDesfechos` usa
 * pra desfecho) e passa direto, sem ser tocado.
 *
 * Função AGNÓSTICA a agente — nenhuma lista de nomes de agente aqui dentro,
 * só `turno`/`autor`/o marcador de tipo. `titulo`/`trailing` chegam já
 * resolvidos (quem chama passa o `t()` da sessão) pra este módulo continuar
 * testável como função pura, sem precisar montar `I18nextProvider`.
 */
export function agruparNarracoesDoTurno(
  entradas: TimelineEntry[],
  rotulos: { titulo: string; trailing: (count: number) => string },
): TimelineEntry[] {
  const resultado: TimelineEntry[] = [];
  let grupo: TimelineEntry[] = [];

  function fecharGrupo() {
    if (grupo.length === 0) return;
    if (grupo.length === 1) {
      resultado.push(grupo[0]);
      grupo = [];
      return;
    }
    const compactadas = grupo.slice(0, -1);
    const ultima = grupo[grupo.length - 1];
    const primeira = compactadas[0];
    resultado.push({
      ...primeira,
      node: (
        <Disclosure
          key={`narracoes-${primeira.seq}`}
          titulo={rotulos.titulo}
          trailing={rotulos.trailing(compactadas.length)}
          classNameCabecalho={styles.narracoesCabecalho}
          className={styles.narracoesGrupo}
        >
          <div className={styles.narracoesRegiao}>
            {compactadas.map((e) => (
              <div key={e.seq}>{e.node}</div>
            ))}
          </div>
        </Disclosure>
      ),
    });
    resultado.push(ultima);
    grupo = [];
  }

  for (const entrada of entradas) {
    // `turno === 0` é o PRÓLOGO (`turnoDoSeq`: "antes da primeira abertura"),
    // nunca um turno de verdade — não há o que narrar como "passos DO turno"
    // ali. Excluir o prólogo também é o que preserva o comportamento de
    // fixtures antigas (`SessionPage.painel-e-agrupamento.test.tsx`,
    // `SessionPage.handoff-devlead-e-colapso.test.tsx`) que empilham vários
    // `agent.response` sem nenhum evento de usuário entre eles só pra testar
    // OUTRO mecanismo (RN-138, RN-177) — sem fronteira de turno nenhuma,
    // agrupá-los aqui coincidiria por acidente com o que aquele mecanismo já
    // resolve, produzindo Disclosure dentro de Disclosure.
    if (!entrada.agentResponse || entrada.turno === 0) {
      fecharGrupo();
      resultado.push(entrada);
      continue;
    }
    const anterior = grupo[grupo.length - 1];
    if (anterior && (anterior.turno !== entrada.turno || anterior.autor !== entrada.autor)) {
      fecharGrupo();
    }
    grupo.push(entrada);
  }
  fecharGrupo();

  return resultado;
}

/**
 * Quantas entradas do fio ficam ABERTAS antes de o resto virar histórico
 * recolhido por origem (RN-177). Mesmo número do painel de log, e pelo mesmo
 * pedido: "mantém as últimas 5 mensagens".
 */
const FIO_RECENTES_ABERTAS = 5;

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
  const backlogQuery = useBacklog(projectId);
  const {
    criativoActive,
    arquitetoActive,
    hasBusinessRule,
    hasPromotedStory,
    hasProductBrief,
    activeAgent,
  } = useSessionReadiness(events, backlogQuery.data);

  // Um agente está ativo se houve um agent.activated pra ele nesta sessão.
  // Isto é EXISTÊNCIA histórica ("já entrou alguma vez"), não "é ele quem
  // fala AGORA". Cópia local de uma linha da mesma checagem que o hook usa
  // internamente pra `criativoActive`/`arquitetoActive` (`session-
  // readiness.ts`) — o único consumidor que sobra aqui é `offeredHandoff`,
  // logo abaixo, que não faz parte da extração do hook.
  const activeFor = (agent: string) =>
    events.some(
      (e) =>
        e.type === 'agent.activated' &&
        (e.payload as { agent?: string })?.agent === agent,
    );

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

  // A prontidão já foi declarada? (achado L) O handoff que sai do Criativo é a
  // consequência dela — existindo, o botão não tem mais o que oferecer.
  const prontidaoJaDeclarada = handoffs.some((h) => h.fromAgent === 'criativo');
  // Espelho de `prontidaoJaDeclarada`, para o Arquiteto (problema 1):
  // `OfferInfraHandoffUseCase` oferece o handoff ao Infra (e ao Dev Lead) na
  // MESMA confirmação — a existência de QUALQUER handoff saindo do Arquiteto
  // já prova que a confirmação aconteceu.
  const arquiteturaJaDeclarada = handoffs.some((h) => h.fromAgent === 'arquiteto');

  // A necessidade já foi validada? (RN-406) Diferente dos dois gates acima,
  // esta confirmação NÃO produz handoff — é só o registro
  // `necessity.validated` no event log, então a fonte é o próprio `events`.
  const necessidadeJaValidada = events.some((e) => e.type === 'necessity.validated');

  const invalidateActions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['session-actions', projectId, sessionId] });
  }, [queryClient, projectId, sessionId]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const items: TimelineEntry[] = [];
    // As fronteiras de turno (RN-172), calculadas UMA vez para a sessão
    // inteira — é o que impede um desfecho de escorregar para o turno de
    // baixo.
    const aberturas = aberturasDeTurno(events);
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

    for (const event of events) {
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

      if (event.type === 'chat.message') {
        const text = typeof (event.payload as { text?: unknown })?.text === 'string' ? (event.payload as { text: string }).text : '';
        empurrar({
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
                  <span className={styles.messageName}>{user.name ?? t('compartilhado.voce')}</span>
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
        const isOfertaAtual = isActive && event.seq === offeredHandoffEventSeq;
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
                <span className={styles.handoffAgent} style={corDoAgente(event.actor.id)}>
                  {nomeDoAgente(event.actor.id)}
                </span>
                <ChevronRightIcon size={13} />
                {t('handoff.passouOBastaoAo')}
                <span className={styles.handoffAgent} style={corDoAgente(toAgent)}>
                  {nomeDoAgente(toAgent)}
                </span>
              </span>
              <Button
                variant="success"
                onClick={() => handleAcceptHandoff(offeredHandoff!.id, offeredHandoff!.toAgent)}
              >
                {t('handoff.aceitarEIniciar', { agente: offeredHandoff!.toAgent })}
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
                    {t('handoff.ativarExecucao')}
                  </Button>
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
                <span className={styles.handoffAgent} style={corDoAgente(event.actor.id)}>
                  {nomeDoAgente(event.actor.id)}
                </span>
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
                  <span className={styles.messageName}>{user.name ?? t('compartilhado.voce')}</span>
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
        // rótulo de desconhecido, nunca para `undefined`/`null` na tela.
        const modelName =
          typeof payload?.modelName === 'string' && payload.modelName !== ''
            ? payload.modelName
            : undefined;
        empurrar({
          agentId: event.actor.kind === 'agent' ? event.actor.id : undefined,
          // `agruparNarracoesDoTurno` lê este marcador pra saber que ESTA
          // entrada, e só ela, participa do colapso de "Passos do turno".
          agentResponse: true,
          node: (
            <div className={styles.message} key={event.id} style={corDoAgente(event.actor.id)}>
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
              </div>
            </div>
          ),
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
            onActivateAutoMode={
              podeAtivarAutoMode && action.actor.kind === 'agent'
                ? () => handleActivateAutoMode(action.actor.id)
                : undefined
            }
          />
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
    promovendoTodas,
    ativandoExecucao,
    podeAtivarAutoMode,
    iniciarTurnoDoAgente,
    finalizarTurnoDoAgente,
    backlogQuery.data,
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

    const resultado: { key: string; node: ReactNode; origem: OrigemDeEvento }[] = [];
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
          // Um colapso por agente é, por construção, fala de agente — mesmo
          // quando o que ele contém veio de origens diferentes.
          origem: 'agente',
          node: (
            <div style={corDoAgente(agentId)}>
              <Disclosure
                titulo={
                  <span className={styles.agentGroupTitulo}>
                    <AvatarDoAgente id={agentId} />
                    {nomeDoAgente(agentId)}
                  </span>
                }
                trailing={t('artefatos.mensagensCount', { count: grupo.length })}
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
          resultado.push({ key: String(e.seq), node: e.node, origem: e.origem });
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
        resultado.push({ key: String(entry.seq), node: entry.node, origem: entry.origem });
      }
    }
    fecharCorrente();

    return resultado;
  }, [timeline, handoffs, actions]);

  /**
   * RN-177 no FIO: as últimas {@link FIO_RECENTES_ABERTAS} entradas ficam
   * abertas e tudo que veio antes vira histórico recolhido POR ORIGEM.
   *
   * O fio é CRESCENTE (o mais novo em baixo, junto do composer), então aqui o
   * histórico fica no TOPO — é a mesma regra do painel de log com o eixo
   * invertido, e não uma segunda decisão.
   *
   * O corte é sobre a lista JÁ agrupada por agente (RN-138): quem conta é o
   * que o usuário vê, e um colapso de doze mensagens é UMA entrada na tela.
   * Contar entradas cruas faria "as últimas 5" esconderem a conversa inteira
   * atrás de um agrupamento.
   */
  const fio = useMemo(() => {
    if (timelineAgrupada.length <= FIO_RECENTES_ABERTAS) {
      return { historico: [], recentes: timelineAgrupada };
    }
    const corte = timelineAgrupada.length - FIO_RECENTES_ABERTAS;
    return {
      historico: agruparPorOrigem(
        timelineAgrupada.slice(0, corte),
        (item) => item.origem,
      ),
      recentes: timelineAgrupada.slice(corte),
    };
  }, [timelineAgrupada]);

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

  async function handleReadiness() {
    try {
      iniciarTurnoDoAgente('criativo');
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
      cancelarTurnoOtimista();
      showToast({ title: t('toasts.erro'), message: t('toasts.erroConfirmarProntidao'), tone: 'danger' });
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
      iniciarTurnoDoAgente('arquiteto');
      await confirmArchitectureReadiness(projectId, sessionId);
      finalizarTurnoDoAgente();
    } catch {
      cancelarTurnoOtimista();
      showToast({
        title: t('toasts.erro'),
        message: t('toasts.erroConfirmarArquitetura'),
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
    iniciarTurnoDoAgente(activeAgent);
    try {
      await returnStory(projectId, recusandoStory.id, motivoRecusa.trim());
      setRecusandoStory(null);
      setMotivoRecusa('');
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      showToast({ title: t('toasts.historiaDevolvida'), tone: 'success' });
    } catch {
      showToast({ title: t('toasts.erro'), message: t('toasts.erroDevolverHistoria'), tone: 'danger' });
    } finally {
      setEnviandoRecusa(false);
      // Idempotente e nos DOIS caminhos: um erro que deixasse `streaming`
      // ligado travaria o composer até o próximo turno.
      finalizarTurnoDoAgente();
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
        cancelarTurnoOtimista();
        setOptimisticUser(null);
        showToast({ title: t('toasts.erro'), message: t('toasts.erroEnviarMensagem'), tone: 'danger' });
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
          aria-label={t('topbar.voltarAoProjeto')}
          title={t('topbar.voltarAoProjeto')}
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
          aria-label={t('status.ariaLabel', { status: t(pontoDaSessao(session?.status).rotuloKey) })}
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
              aria-label={t('topbar.nomeDaSessao')}
              placeholder={t('topbar.semNomeFicaHashtag', { hashtag })}
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
              title={t('topbar.tituloRenomear', { rotulo })}
              onClick={() => setRascunhoDoNome(session?.name ?? '')}
              disabled={!session}
            >
              {t('topbar.tituloSessao', { rotulo })}
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
        {/* SEM `filtroDeAgentesPadrao`, ao contrário dos seletores de agente e
            de área nas Configurações — e a omissão é decisão, não esquecimento.
            Este picker grava no escopo `session`, e `assertModelFitsBindingScope`
            deixa `session` livre de propósito (RN-040): quem `exigeToolCalling`
            é o TURNO, não o escopo — `RunLlmTurnUseCase` só liga a exigência
            quando há ferramenta na chamada. Marcar o filtro aqui esconderia
            modelo que a api aceita, que é o inverso do defeito que ligá-lo nas
            outras duas telas conserta. */}
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
              {t('topbar.trazCriativo')}
            </span>
            <Button
              onClick={handleStartIdeation}
              title={t('topbar.iniciarIdeacaoTitulo')}
            >
              {t('topbar.iniciarIdeacao')}
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
          {t('topbar.encerrar')}
        </Button>
        <button
          type="button"
          className={[styles.toggleAside, asideOpen && styles.toggleAsideOn]
            .filter(Boolean)
            .join(' ')}
          onClick={() => setAsideOpen((v) => !v)}
          aria-pressed={asideOpen}
          aria-label={t('topbar.alternarPainel')}
        >
          <LayoutSidebarIcon size={17} />
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.chatColumn}>
          <div className={styles.messages} ref={scrollContainerRef}>
            <div className={styles.messagesInner} ref={messagesInnerRef}>
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
                    <h2 className={styles.conviteTitulo}>{t('convite.criativa.titulo')}</h2>
                    <p className={styles.conviteTexto}>
                      <Trans
                        i18nKey="convite.criativa.texto"
                        ns="sessionPage"
                        components={{ b: <strong /> }}
                      />
                    </p>
                    {/* A AÇÃO, e não uma seta apontando para ela (FASE 24).
                        Ativar o Criativo continua sendo um clique explícito:
                        é a partir dele que a chave do owner passa a ser
                        gasta (RN-058), e ninguém entra na sessão sozinho. */}
                    {!criativoActive && (
                      <div className={styles.conviteAcao}>
                        <Button onClick={handleStartIdeation} disabled={!isActive}>
                          {t('convite.criativa.iniciarIdeacao')}
                        </Button>
                        <span className={styles.conviteAcaoNota}>
                          {t('convite.criativa.iniciarIdeacaoNota')}
                        </span>
                      </div>
                    )}
                    <p className={styles.conviteTexto}>
                      {t('convite.criativa.exemploIntro')}
                    </p>
                    <button
                      type="button"
                      className={styles.conviteExemplo}
                      onClick={() =>
                        setDraft(t('convite.criativa.exemplo'))
                      }
                    >
                      “{t('convite.criativa.exemplo')}”
                    </button>
                    <p className={styles.conviteRodape}>
                      <Trans
                        i18nKey="convite.criativa.rodape"
                        ns="sessionPage"
                        components={{ b: <strong /> }}
                      />
                    </p>
                  </div>
                ) : (
                  <div className={styles.convite}>
                    <h2 className={styles.conviteTitulo}>{t('convite.consultiva.titulo')}</h2>
                    <p className={styles.conviteTexto}>
                      <Trans
                        i18nKey="convite.consultiva.texto"
                        ns="sessionPage"
                        components={{ b: <strong /> }}
                      />
                    </p>
                    <p className={styles.conviteRodape}>
                      <Trans
                        i18nKey="convite.consultiva.rodape"
                        ns="sessionPage"
                        components={{ b: <strong /> }}
                      />
                    </p>
                  </div>
                )
              )}

              {/* RN-177 — o histórico recolhido POR ORIGEM, no topo do fio,
                  porque o fio é crescente. Nasce FECHADO: a conversa que
                  importa é a recente, e abrir tudo é o estado de hoje, que é
                  justamente o que o pedido apontou como ilegível numa sessão
                  longa. Cada origem é um `Disclosure` próprio — assim voltar a
                  ler só o que o usuário disse não obriga a reabrir também
                  todo o log de domínio. */}
              {fio.historico.length > 0 && (
                <div className={styles.fioHistorico}>
                  {fio.historico.map(({ origem, itens }) => (
                    <Disclosure
                      key={origem}
                      titulo={ROTULO_DA_ORIGEM[origem]}
                      trailing={itens.length}
                      classNameCabecalho={styles.fioHistoricoCabecalho}
                    >
                      <div className={styles.fioHistoricoRegiao}>
                        {itens.map((entry) => (
                          <div key={entry.key}>{entry.node}</div>
                        ))}
                      </div>
                    </Disclosure>
                  ))}
                </div>
              )}

              {fio.recentes.map((entry) => (
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
                      <span className={styles.messageName}>{user.name ?? t('compartilhado.voce')}</span>
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
                  já passou o prazo", nunca só "tem texto".

                  `!turnoViaCanal`: esta bolha ficou EXCLUSIVA do chat
                  consultivo sem agente ativo (SSE, `streamChatMessage`) — um
                  turno de agente conversacional narra pela faixa de
                  atividade (`TurnActivityStrip`, logo abaixo do fio), nunca
                  pelos dois ao mesmo tempo. */}
              {!turnoViaCanal && (streamingText || (pensandoVisivel && (streaming || statusAgent))) && (
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

                        RN-156: "Reunindo informações..." só antes de haver
                        texto — é o que deixa explícito que o silêncio é
                        trabalho em curso, não ausência de resposta (achado
                        B). Frase fixa, sem o nome do agente interpolado: o
                        nome já aparece no cabeçalho assim que o streaming
                        real começa, e repeti-lo aqui não ajudava a leitura.
                      */}
                      <span className={styles.messageName}>
                        {streamingText
                          ? (agenteExibido?.name ?? t('compartilhado.agenteGenerico'))
                          : t('mensagens.reunindoInformacoes')}
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

          {/*
            Handoff manual a agente à escolha (ADR 0109/RN-440): a cadeia
            fixa (Criativo→PO→Arquiteto→Dev Lead…) continua sendo o caminho
            normal — este seletor existe para o caso que ela não cobre, o
            Staff (ADR 0088) e agora também `ux-designer` sendo o exemplo
            real: agentes com código pronto no engine, sem NENHUM jeito de
            um humano chegar até eles pela tela. Fica FORA do `.composer`
            de propósito — não é uma ação de conversa, é redirecionamento.
            `activeFor` (não `AGENTES_DE_CHAT`) filtra quem já entrou nesta
            sessão alguma vez, pro mesmo agente não ser oferecido duas
            vezes.
          */}
          {isActive && (
            <div className={styles.manualHandoffRow}>
              <Select
                aria-label={t('handoff.manualLabel')}
                value={manualHandoffTarget}
                disabled={enviandoHandoffManual}
                onChange={(e) => setManualHandoffTarget(e.target.value)}
              >
                <option value="">{t('handoff.manualPlaceholder')}</option>
                {addressableAgents()
                  .filter((agente) => !activeFor(agente))
                  .map((agente) => (
                    <option key={agente} value={agente}>
                      {nomeDoAgente(agente)}
                    </option>
                  ))}
              </Select>
              <Button
                variant="secondary"
                loading={enviandoHandoffManual}
                disabled={!manualHandoffTarget}
                onClick={handleRequestManualHandoff}
              >
                {t('handoff.manualBotao')}
              </Button>
            </div>
          )}

          {session?.status === 'active' ? (
            <div className={styles.composer}>
              <textarea
                className={styles.textarea}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={t('composer.placeholder')}
                disabled={streaming}
              />
              <Button onClick={handleSend} disabled={streaming || !draft.trim()}>
                {t('composer.enviar')}
              </Button>
              {/* RN-122: só existe (habilitado) enquanto há turno em curso —
                  fora disso não há o que parar. */}
              {streaming && (
                <Button variant="danger" onClick={handleCancel}>
                  {t('composer.parar')}
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
                      ? t('composer.prontoParaProduzirDesabilitado')
                      : undefined
                  }
                >
                  {t('composer.prontoParaProduzir')}
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
                  disabled={streaming || !hasPromotedStory}
                  title={
                    !hasPromotedStory
                      ? t('composer.confirmarArquiteturaDesabilitado')
                      : undefined
                  }
                >
                  {t('composer.confirmarArquitetura')}
                </Button>
              )}
              {/*
                Gate `necessidade-validada` (RN-406, ADR 0095): confirmação
                humana SEPARADA de "Estou pronto para produzir" — este botão
                só existe para não deixar o Criativo (o modelo) se
                autovalidar (`modelo-de-time.md`, anti-padrão registrado).
                Habilita só DEPOIS que o product_brief já existe (não dá pra
                "validar" algo que ainda não foi consolidado) e some assim
                que já foi validada.
              */}
              {criativoActive && !necessidadeJaValidada && (
                <Button
                  variant="success"
                  loading={validandoNecessidade}
                  onClick={handleValidateNecessity}
                  disabled={streaming || !hasProductBrief}
                  title={
                    !hasProductBrief
                      ? t('composer.confirmarNecessidadeDesabilitado')
                      : undefined
                  }
                >
                  {t('composer.confirmarNecessidade')}
                </Button>
              )}
            </div>
          ) : (
            <div className={styles.activatePrompt}>
              {session?.status === 'created' ? (
                <>
                  {t('ativacao.naoAtivada')}
                  <Button onClick={handleActivate}>{t('ativacao.ativarSessao')}</Button>
                </>
              ) : (
                <span>{t('ativacao.statusGenerico', { status: session?.status })}</span>
              )}
            </div>
          )}
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
