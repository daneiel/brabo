import { renovarSessao, tokenAtual } from './auth';
import { runtimeConfig } from './runtime-config';
import { childSpan, logger, newTraceContext } from './logger';
import type { LlmCredentialProvider } from './models';
import type { MySpend, WorkspaceSpendReport } from './spend';
import type {
  AgentAutonomyRule,
  AgentAutonomyActionType,
  CredentialSpend,
  UsoDeModelo,
  AgentTokenUsage,
  ActionType,
  Architecture,
  StoryPromotionMode,
  AgentArea,
  ParallelizationRequest,
  InfraArtifact,
  PsychologistHypothesis,
  PsychologistAnalysis,
  PsychologistStatus,
  ProficiencyProfile,
  AgentInstructionVersion,
  Budget,
  BudgetPolicy,
  CicloDeVidaDoContainer,
  ContainerOverviewItem,
  CodeBlame,
  CodeBranchDetailList,
  CodeDiff,
  CodeFile,
  CodePullRequestList,
  CodePullRequestState,
  CodeSearchResult,
  CodeTree,
  CoverageReport,
  Epic,
  EstadoDoContainer,
  ExecutionActivation,
  Handoff,
  Model,
  ModelBindingScope,
  ModelPriceChange,
  ModelsByCategory,
  ModelComCuradoria,
  CatalogoPorCategoria,
  SyncModelCatalogResult,
  Page,
  PermissionPolicy,
  PermissionsFile,
  Project,
  ProjectBlockedStatus,
  ProjectCardSummary,
  ProjectMemberWithUser,
  ProjectUnreadEvents,
  ProposedAction,
  ProvisionedRepository,
  ProvisionRepositoryResult,
  AdoptRepositoryResult,
  BootstrapPlanEstado,
  RepoBootstrapStatus,
  ResolvedBinding,
  PromoteStoriesResult,
  Role,
  Session,
  SessionEvent,
  SessionKind,
  SocketTicket,
  SocketTicketScope,
  TerminalTicket,
  CredentialProviderName,
  CredentialTestResult,
  UnreadCursor,
  UserCredentialMetadata,
  UserLocale,
  UserPreferences,
  PersonalAccessTokenSummary,
  PersonalAccessTokenIssued,
  PersonalAccessTokenAdminSummary,
  RunnerDeviceKeySummary,
  Workspace,
  WorkspaceSummary,
  WorkspaceWithRole,
  RegistroDeGates,
  ExecutionMode,
} from './api-types';

export const API_URL = runtimeConfig.apiUrl;

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  /**
   * `trace_id` da requisição que falhou (Fase 5, item 6).
   *
   * Carregado no erro para que a UI possa exibi-lo: é o que transforma "deu
   * erro" num relato acionável — com o id, quem investiga vai direto ao span no
   * Grafana em vez de procurar por horário.
   */
  readonly traceId?: string;

  constructor(status: number, body: unknown, traceId?: string) {
    super(`api error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.traceId = traceId;
  }
}

/**
 * A frase que a api mandou, pronta para ir a um toast.
 *
 * `ApiError.message` é sempre `api error 422` — bom para log, inútil para
 * quem está olhando a tela. O que interessa está em `body.message`, e antes
 * disto cada `catch` teria de reescrever a mesma extração (ou, como acontecia
 * na seção de credenciais, não escrever `catch` nenhum e engolir a mensagem).
 */
export function mensagemDaApi(erro: unknown, padrao = 'Erro inesperado'): string {
  if (erro instanceof ApiError) {
    const body = erro.body as { message?: unknown } | null;
    if (typeof body?.message === 'string') return body.message;
    if (Array.isArray(body?.message)) return body.message.join('; ');
    return `A api respondeu ${erro.status}.`;
  }
  return erro instanceof Error ? erro.message : padrao;
}

/**
 * `true` quando `erro` é o portão do container (RN-105) — o Arquiteto ainda
 * não decidiu qual imagem sobe para o projeto. `ReadProjectCodeUseCase.alvo`
 * é o funil ÚNICO por onde as sete leituras de código passam (árvore,
 * arquivo, busca, diff, blame, lista de PRs, branches), e o 409 que ele
 * levanta (`portaoDoContainer`) é a ÚNICA causa de `ConflictException` nesse
 * caso de uso — o status sozinho já basta para identificar o estado, sem
 * casar texto de mensagem (que muda de idioma e um dia diverge).
 *
 * Achado de uso: a aba PRs chamava `getCodePullRequests`/`getCodeDiff` sem
 * saber disto, e mostrava esse 409 como erro transitório genérico com
 * "Tentar de novo" — a mesma classe de erro que `ContainerImageGateNotice`
 * (`components/ContainerImageGate.tsx`) resolve para a aba Code.
 */
export function isContainerImageGateError(erro: unknown): boolean {
  return erro instanceof ApiError && erro.status === 409;
}

/**
 * Uma tentativa: monta os cabeçalhos com o token que houver agora.
 *
 * O access token vem de `auth.ts` (memória, 15 min). Se não houver nenhum, a
 * chamada segue sem `Authorization` e a api responde 401 — que é o gatilho do
 * caminho de renovação abaixo, e não um caso de erro.
 */
function tentar(
  path: string,
  traceparent: string,
  init?: RequestInit,
): Promise<Response> {
  const token = tokenAtual();

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      traceparent,
      ...init?.headers,
    },
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Uma trace por requisição, gerada aqui (Fase 5, item 6). A api adota este
  // `traceparent` como parent — é o propagador W3C padrão — então a ação do
  // usuário e o trabalho de servidor que ela dispara ficam na mesma árvore.
  const traceCtx = newTraceContext();
  const metodo = (init?.method ?? 'GET').toUpperCase();
  const inicio = performance.now();

  let res: Response;
  try {
    res = await tentar(path, traceCtx.traceparent, init);

    // 401 → renova UMA vez e repete. A renovação é single-flight (ver auth.ts):
    // várias chamadas que levem 401 ao mesmo tempo compartilham a mesma
    // promessa, e é isso que impede o refresh de ser apresentado duas vezes —
    // que o servidor leria como reuso de token e puniria revogando a família.
    //
    // Uma tentativa só, de propósito: se o token novo também levar 401, o
    // problema não é a validade da sessão, e repetir viraria laço.
    if (res.status === 401) {
      const novo = await renovarSessao();
      if (novo) {
        // Span NOVA na mesma trace (ADR 0035): reusar o `traceparent` fazia as
        // duas tentativas declararem o mesmo pai, e o Tempo as colapsava num nó
        // só — escondendo justamente que houve refresh no meio.
        res = await tentar(path, childSpan(traceCtx).traceparent, init);
      }
    }
  } catch (erro) {
    // Falha de REDE (DNS, offline, CORS, api fora do ar): o `fetch` rejeita e
    // esta função nunca chegava a logar nada. O erro subia para o
    // `QueryCache.onError`, sem `trace_id` e sem rota — ou seja, o modo de falha
    // mais comum em desenvolvimento era o menos diagnosticável.
    logger.errorWithTrace('api inalcançável', traceCtx.traceId, {
      path,
      method: metodo,
      duration_ms: Math.round(performance.now() - inicio),
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    throw erro;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // Loga com o trace_id ANTES de levantar: é este id que leva do erro na tela
    // ao span de servidor no Grafana. Sem ele, um 500 no browser e o span que o
    // causou são dois fatos sem relação.
    logger.errorWithTrace('requisição à api falhou', traceCtx.traceId, {
      path,
      status: res.status,
      method: metodo,
      duration_ms: Math.round(performance.now() - inicio),
    });
    throw new ApiError(res.status, body, traceCtx.traceId);
  }
  // Corpo VAZIO é resposta legítima, não erro de parsing.
  //
  // Só o 204 era tratado aqui, e `res.json()` estourava um `SyntaxError` cru
  // em tudo o mais. Acontece que um handler do Nest que devolve `null` responde
  // **200 com corpo vazio** — e `null` é o que o domínio diz o tempo todo:
  // "este projeto não tem orçamento", "este agente não tem binding", "este
  // projeto não tem repositório". Seis funções deste arquivo já declaravam
  // `| null` no retorno; era só o transporte que não sabia receber.
  //
  // O sintoma era desproporcional à causa: o `SyntaxError` subia até o
  // `QueryCache.onError` e derrubava a query inteira, então a tela de
  // configurações perdia a lista de modelos por causa de um agente sem binding.
  //
  // Devolve `null`, não `undefined`, e a diferença não é cosmética: o
  // TanStack Query REJEITA uma `queryFn` que resolve `undefined`
  // (`Error: [...] data is undefined`), então devolver `undefined` aqui só
  // trocaria o `SyntaxError` por outro erro — foi o que aconteceu na primeira
  // versão deste conserto. `null` é o que os tipos do cliente já declaram
  // (`Budget | null`, `ResolvedBinding | null`) e o que o Nest quis dizer.
  const texto = await res.text();
  return (texto ? JSON.parse(texto) : null) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

function qs(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

// --- Workspaces / Projects ---

export const listWorkspaces = () => get<WorkspaceWithRole[]>('/workspaces');
export const createWorkspace = (input: { name: string; slug: string }) =>
  post<Workspace>('/workspaces', input);
export const getWorkspace = (workspaceId: string) =>
  get<Workspace>(`/workspaces/${workspaceId}`);

export const listProjects = (workspaceId: string) =>
  get<Project[]>(`/workspaces/${workspaceId}/projects`);
export const getWorkspaceSummary = (workspaceId: string) =>
  get<WorkspaceSummary>(`/workspaces/${workspaceId}/summary`);
export const getProjectsStatus = (workspaceId: string) =>
  get<ProjectBlockedStatus[]>(`/workspaces/${workspaceId}/projects-status`);
export const getProjectsSummary = (workspaceId: string) =>
  get<ProjectCardSummary[]>(`/workspaces/${workspaceId}/projects-summary`);
/**
 * Os eventos não lidos de VÁRIOS projetos numa chamada (RN-091) — o conteúdo
 * da gaveta do sino.
 *
 * `POST` sem mutar nada, e a api responde 200 justamente por isso. O corte de
 * leitura é um `seq` por projeto que só este navegador conhece (`read-state`),
 * então ele precisa viajar no PEDIDO; são dezenas de pares, e query string
 * dessa altura quebra em proxy além de pôr id de projeto do usuário em log de
 * acesso. Mapa vazio devolve vazio.
 */
export const getUnreadEvents = (
  workspaceId: string,
  cursors: UnreadCursor[],
) =>
  post<ProjectUnreadEvents[]>(`/workspaces/${workspaceId}/unread-events`, {
    cursors,
  });
// `executionMode`/`workspacePath` (ADR 0072/0104): onde o comando do projeto
// executa. Omitidos, a api usa `container` — o comportamento de sempre. Com
// `mounted`, o caminho é OBRIGATÓRIO e a api RECUSA a criação (400) quando
// ele não existe ou não é gravável de dentro do container, com a instrução
// de como montar (RN-422). Com `runner`, só o FORMATO do caminho é validado
// agora — a existência é confirmada depois, pelo runner (RN-423).
export const createProject = (
  workspaceId: string,
  input: {
    name: string;
    slug: string;
    executionMode?: ExecutionMode;
    workspacePath?: string;
  },
) => post<Project>(`/workspaces/${workspaceId}/projects`, input);
export const getProject = (projectId: string) =>
  get<Project>(`/projects/${projectId}`);
// `maxConsecutiveBlocked` (Fase 12b): vale a partir da PRÓXIMA ativação da
// execução — não afeta dev agents já rodando.
// `storyPromotion` (Fase 12c): vale para as PRÓXIMAS histórias criadas; as que
// já estão propostas continuam aguardando promoção mesmo se o modo virar
// `auto`, porque a proposta já existe e ignorá-la esconderia trabalho do PO.
// Os dois são opcionais — a tela salva um campo por vez.
export const updateProject = (
  projectId: string,
  input: {
    maxConsecutiveBlocked?: number;
    storyPromotion?: StoryPromotionMode;
  },
) => patch<Project>(`/projects/${projectId}`, input);

/**
 * Converte o `execution_mode` de um projeto EXISTENTE (RN-447..450, ADR
 * 0111) — rota DEDICADA, separada de `updateProject`: a api orquestra a
 * migração do `permissions.json`, o encerramento do ciclo de vida do
 * container (saindo de `container`) e recusa com 409 se algum dev agent do
 * projeto estiver trabalhando ou travado agora.
 */
export const convertProjectExecutionMode = (
  projectId: string,
  input: { executionMode: ExecutionMode; workspacePath?: string },
) => put<Project>(`/projects/${projectId}/execution-mode`, input);

export const listProjectMembers = (projectId: string) =>
  get<ProjectMemberWithUser[]>(`/projects/${projectId}/members`);
export const addProjectMember = (
  projectId: string,
  input: { userId: string; role: Role },
) => post<void>(`/projects/${projectId}/members`, input);
export const removeProjectMember = (projectId: string, userId: string) =>
  del<void>(`/projects/${projectId}/members/${userId}`);

/** Personal Access Tokens do runner (`brb_…`, ADR 0105) — próprios do usuário logado. */
export const listPersonalAccessTokens = (projectId: string) =>
  get<PersonalAccessTokenSummary[]>(`/projects/${projectId}/personal-access-tokens`);
export const issuePersonalAccessToken = (
  projectId: string,
  input: { name: string; expiresInDays?: number },
) =>
  post<PersonalAccessTokenIssued>(
    `/projects/${projectId}/personal-access-tokens`,
    input,
  );
export const revokePersonalAccessToken = (projectId: string, tokenId: string) =>
  del<void>(`/projects/${projectId}/personal-access-tokens/${tokenId}`);

/** Visão de `maintainer` (RN-427) — todos os tokens do projeto, de qualquer usuário. */
export const listAllPersonalAccessTokens = (projectId: string) =>
  get<PersonalAccessTokenAdminSummary[]>(
    `/projects/${projectId}/personal-access-tokens/all`,
  );
export const revokePersonalAccessTokenAsMaintainer = (
  projectId: string,
  tokenId: string,
) =>
  del<void>(`/projects/${projectId}/personal-access-tokens/${tokenId}/admin`);

/**
 * Chave de dispositivo do runner (par Ed25519 gerado NO NAVEGADOR — ver
 * `lib/runner-bootstrap.ts`). Substitui o PAT digitado à mão no fluxo de
 * onboarding: só a chave PÚBLICA viaja até aqui, nunca a privada.
 */
export const registerRunnerDeviceKey = (
  projectId: string,
  input: { name: string; publicKeyJwk: string },
) =>
  post<RunnerDeviceKeySummary>(
    `/projects/${projectId}/runner-device-keys`,
    input,
  );
export const revokeRunnerDeviceKey = (projectId: string, deviceKeyId: string) =>
  del<void>(`/projects/${projectId}/runner-device-keys/${deviceKeyId}`);

export const getProjectPermissions = (projectId: string) =>
  get<PermissionsFile>(`/projects/${projectId}/permissions`);
export const setProjectPermissions = (projectId: string, file: PermissionsFile) =>
  put<PermissionsFile>(`/projects/${projectId}/permissions`, file);

export const listAgentAutonomy = (projectId: string) =>
  get<AgentAutonomyRule[]>(`/projects/${projectId}/agent-autonomy`);
export const setAgentAutonomy = (
  projectId: string,
  input: { agentId: string; actionType: AgentAutonomyActionType; mode: PermissionPolicy },
) => put<void>(`/projects/${projectId}/agent-autonomy`, input);

// --- Git ---

export const startGitConnect = (projectId: string, provider: 'github' | 'gitlab') =>
  get<{ authorizeUrl: string }>(`/projects/${projectId}/git/${provider}/connect`);
export const provisionRepository = (
  projectId: string,
  provider: 'local' | 'github' | 'gitlab',
  input: { name: string; visibility: 'public' | 'private'; namespace?: string },
) =>
  post<ProvisionRepositoryResult>(
    `/projects/${projectId}/git/${provider}/repository`,
    input,
  );
export const getRepository = (projectId: string) =>
  get<ProvisionedRepository | null>(`/projects/${projectId}/git/repository`);
export const getBootstrapStatus = (projectId: string) =>
  get<RepoBootstrapStatus>(`/projects/${projectId}/git/bootstrap`);

/**
 * "Sei que as branches não ficaram protegidas, e quero seguir" (achado D).
 *
 * Só vale para a falha em `protect_branches` — a api recusa qualquer outra, e
 * a recusa diz por quê. Ver `acknowledge-protection-failure.use-case.ts`.
 */
export const acknowledgeProtectionFailure = (projectId: string) =>
  post<{ status: string | null }>(
    `/projects/${projectId}/git/bootstrap/acknowledge-protection-failure`,
    {},
  );

// Adoção (Fase 12a): `adopt` NÃO cria nada e NÃO executa nada — devolve o
// plano (dry-run). Só `approvePlan` roda o bootstrap; `skipPlan` dispensa.
export const adoptRepository = (
  projectId: string,
  provider: 'local' | 'github' | 'gitlab',
  input: { externalId: string },
) =>
  post<AdoptRepositoryResult>(
    `/projects/${projectId}/git/${provider}/repository/adopt`,
    input,
  );
export const getBootstrapPlan = (projectId: string) =>
  get<BootstrapPlanEstado>(`/projects/${projectId}/git/bootstrap/plan`);
export const approveBootstrapPlan = (
  projectId: string,
  input: { planGeneratedAt: string },
) =>
  post<ProvisionRepositoryResult>(
    `/projects/${projectId}/git/bootstrap/plan/approve`,
    input,
  );
export const skipBootstrapPlan = (
  projectId: string,
  input: { planGeneratedAt: string },
) =>
  post<ProvisionRepositoryResult>(
    `/projects/${projectId}/git/bootstrap/plan/skip`,
    input,
  );
// Cadastra um PAT de git do usuário — o backend TESTA a conexão antes de
// persistir (422 = token inválido); nunca reexibe o token.
export const registerGitCredential = (input: {
  provider: 'github' | 'gitlab';
  token: string;
}) => post<UserCredentialMetadata>('/users/me/git-credentials', input);

// --- Container do projeto (FASE 25a) ---

export const getContainerState = (projectId: string) =>
  get<EstadoDoContainer>(`/projects/${projectId}/container`);

// O ciclo de vida (provisioning/running/stopped/failed/removed), distinto da
// decisão de imagem acima (ADR 0081/0083, RN-267). `null` é honesto: nenhum
// orquestrador real transiciona `project_containers` hoje.
export const getContainerLifecycle = (projectId: string) =>
  get<CicloDeVidaDoContainer | null>(`/projects/${projectId}/container/lifecycle`);

// --- Página global de containers (ADR 0136, RN-495) ---
//
// Cross-projeto, do WORKSPACE inteiro — ao lado (não dentro) das rotas de
// container por projeto acima.

export const getContainersOverview = (workspaceId: string) =>
  get<ContainerOverviewItem[]>(`/workspaces/${workspaceId}/containers`);

// --- Aba Code, só leitura (FASE 26) ---
//
// As quatro rotas de `apps/api/src/interfaces/http/git/code.controller.ts`.
// `role:viewer`, 400 quando o caminho sai do escopo do projeto (RN-095), 409
// enquanto o container não tem imagem decidida (RN-105), 501 quando o
// provider não declara a capability.

export const getCodeTree = (
  projectId: string,
  opts: { ref?: string; path?: string } = {},
) => get<CodeTree>(`/projects/${projectId}/code/tree${qs(opts)}`);

export const getCodeFile = (
  projectId: string,
  opts: { path: string; ref?: string },
) => get<CodeFile>(`/projects/${projectId}/code/file${qs(opts)}`);

export const searchCode = (
  projectId: string,
  opts: { q: string; ref?: string; path?: string },
) => get<CodeSearchResult>(`/projects/${projectId}/code/search${qs(opts)}`);

export const getCodeDiff = (projectId: string, pullRequestId: string) =>
  get<CodeDiff>(
    `/projects/${projectId}/code/pull-requests/${pullRequestId}/diff`,
  );

// --- Fundação de blame, PRs navegáveis e branch rica (FASE 26b) ---
//
// As três rotas novas de `code.controller.ts` — mesmo `role:viewer`, mesmos
// 400/404/409/501 das quatro de cima. Sem tela consumindo ainda; a UI é onda
// seguinte, em três agentes separados.

export const getCodeBlame = (
  projectId: string,
  opts: { path: string; ref?: string },
) => get<CodeBlame>(`/projects/${projectId}/code/blame${qs(opts)}`);

export const getCodePullRequests = (
  projectId: string,
  opts: { state?: CodePullRequestState } = {},
) =>
  get<CodePullRequestList>(
    `/projects/${projectId}/code/pull-requests${qs(opts)}`,
  );

export const getCodeBranches = (projectId: string) =>
  get<CodeBranchDetailList>(`/projects/${projectId}/code/branches`);

// --- Sessions ---

// O corpo é OBRIGATÓRIO desde a FASE 20: o tipo da sessão é escolha de quem a
// abre (RN-097), e um parâmetro opcional aqui devolveria a escolha ao esquecimento.
export const createSession = (
  projectId: string,
  body: { kind: SessionKind; name?: string },
) => post<Session>(`/projects/${projectId}/sessions`, body);
/** `null` tira o nome e a sessão volta a se identificar só pela hashtag (RN-098). */
export const renameSession = (
  projectId: string,
  sessionId: string,
  name: string | null,
) => patch<Session>(`/projects/${projectId}/sessions/${sessionId}`, { name });
export const listSessions = (projectId: string) =>
  get<Session[]>(`/projects/${projectId}/sessions`);
export const getSession = (projectId: string, sessionId: string) =>
  get<Session>(`/projects/${projectId}/sessions/${sessionId}`);
export const transitionSession = (
  projectId: string,
  sessionId: string,
  status: 'active' | 'closing' | 'closed' | 'closed_abnormally',
) => post<Session>(`/projects/${projectId}/sessions/${sessionId}/transition`, { status });
export const listSessionEvents = (
  projectId: string,
  sessionId: string,
  opts: { afterSeq?: number; limit?: number; latest?: boolean } = {},
) =>
  get<Page<SessionEvent>>(
    `/projects/${projectId}/sessions/${sessionId}/events${qs(opts)}`,
  );
// Um evento pelo id — a listagem é paginada (últimos N) e o feed esconde
// ruído de máquina, então evidência de hipótese precisa deste caminho pra
// ser navegável de verdade.
export const getSessionEvent = (
  projectId: string,
  sessionId: string,
  eventId: string,
) =>
  get<SessionEvent>(
    `/projects/${projectId}/sessions/${sessionId}/events/${eventId}`,
  );
/**
 * Ticket opaco de uso único pra autenticar o socket Phoenix da sessão
 * (RN-108). TTL de 30s — `session-channel.ts` chama isto antes de TODA
 * `socket.connect()`, inclusive em reconexão automática, nunca reusa um
 * ticket velho.
 */
export const createSocketTicket = (
  projectId: string,
  sessionId: string,
  scope: SocketTicketScope,
) =>
  post<SocketTicket>(
    `/projects/${projectId}/sessions/${sessionId}/socket-ticket`,
    { scope },
  );

/**
 * Ticket de uso único pro canal `terminal:<projectId>` — runner local +
 * PTY interativo (a aba Terminal da FASE 26). Rota própria (`role: viewer`+),
 * não escopada a sessão: o terminal é do PROJETO, não de uma conversa com
 * agente. `terminal-channel.ts` chama isto antes de todo `socket.connect()`,
 * mesmo desenho do `createSocketTicket` acima (RN-108) — ticket é de uso
 * único, nunca reusado numa reconexão.
 */
export const getTerminalTicket = (projectId: string) =>
  post<TerminalTicket>(`/projects/${projectId}/terminal-ticket`);

// --- Agentes conversacionais / handoffs (Fase 3b) ---

export const startAgent = (projectId: string, sessionId: string, agent: string) =>
  post<{ agent: string; status: string }>(
    `/projects/${projectId}/sessions/${sessionId}/agents/${agent}/start`,
  );
export const sendAgentMessage = (
  projectId: string,
  sessionId: string,
  agent: string,
  text: string,
) =>
  post<{ ok: true }>(
    `/projects/${projectId}/sessions/${sessionId}/agents/${agent}/message`,
    { text },
  );
// RN-122: o botão "Parar" do composer — mata a chamada ao LLM em curso no
// engine (Task.shutdown, brutal_kill), cortando a conexão no meio pra
// economizar token de verdade. Idempotente: sem turno em curso, é aceito sem
// efeito.
export const cancelAgentTurn = (
  projectId: string,
  sessionId: string,
  agent: string,
) =>
  post<{ ok: true }>(
    `/projects/${projectId}/sessions/${sessionId}/agents/${agent}/cancel`,
  );
export const confirmReadiness = (projectId: string, sessionId: string) =>
  post<{ ok: true }>(`/projects/${projectId}/sessions/${sessionId}/readiness`);
// Mirror de `confirmReadiness`, mas do Arquiteto (achado do problema 1):
// dispara `OfferInfraHandoffUseCase`, que oferece o handoff ao Infra E ao Dev
// Lead na MESMA confirmação (FASE 14d). Endpoint dedicado — não reaproveita
// `readiness`, que é do Criativo.
export const confirmArchitectureReadiness = (
  projectId: string,
  sessionId: string,
) =>
  post<{ ok: true }>(
    `/projects/${projectId}/sessions/${sessionId}/agents/arquiteto/handoff-infra`,
  );
// Gate `necessidade-validada` (RN-406, ADR 0095) — confirmação humana de
// que o `product_brief` do Criativo reflete a necessidade de negócio.
// Endpoint dedicado: não reaproveita `confirmReadiness` (que só exige
// regra capturada, RN-142) nem o aceite do handoff pelo PO (estrutural,
// sem julgar conteúdo).
export const validateNecessity = (projectId: string, sessionId: string) =>
  post<{ ok: true }>(
    `/projects/${projectId}/sessions/${sessionId}/agents/criativo/validate-necessity`,
  );
// RN-162: submissão do formulário de `chat.structured_question` — grava
// `chat.structured_question_answered` e reenvia as respostas ao `agent` (o
// que fez as perguntas) pelo mesmo caminho de `sendAgentMessage`. Um
// conjunto de perguntas só pode ser respondido uma vez (409 na segunda).
export const answerStructuredQuestion = (
  projectId: string,
  sessionId: string,
  agent: string,
  questionSetId: string,
  answers: Record<string, string>,
) =>
  post<{ ok: true }>(
    `/projects/${projectId}/sessions/${sessionId}/agents/${agent}/structured-question/${questionSetId}/answer`,
    { answers },
  );
export const listHandoffs = (projectId: string, sessionId: string) =>
  get<Handoff[]>(`/projects/${projectId}/sessions/${sessionId}/handoffs`);
export const acceptHandoff = (
  projectId: string,
  sessionId: string,
  handoffId: string,
) =>
  post<Handoff>(
    `/projects/${projectId}/sessions/${sessionId}/handoffs/${handoffId}/accept`,
  );
// Handoff manual a agente à escolha (ADR 0109/RN-440): `toAgent` tem de
// estar no catálogo `addressableAgents()` do backend — lead de área ou
// agente conversacional solo. Nasce `offered`, do mesmo jeito que um
// handoff automático; `acceptHandoff` acima continua sendo o único caminho
// de aceite.
export const requestManualHandoff = (
  projectId: string,
  sessionId: string,
  toAgent: string,
) =>
  post<Handoff>(`/projects/${projectId}/sessions/${sessionId}/handoffs`, {
    toAgent,
  });

// --- Backlog (Fase 3b) ---

export const listBacklog = (projectId: string) =>
  get<Epic[]>(`/projects/${projectId}/backlog`);

// Promoção e recusa (Fase 12c — RN-048): as duas ÚNICAS escritas de backlog
// que são do usuário e não de um agente.
//
// `promoteStories` é sempre lote, mesmo para uma história — e não rejeita
// quando parte falha: quem não passou volta em `failed` com o motivo, e quem
// passou está promovido. Tratar a resposta como sucesso/erro binário perde
// exatamente a informação que ela existe para dar.
export const promoteStories = (projectId: string, storyIds: string[]) =>
  post<PromoteStoriesResult>(`/projects/${projectId}/stories/promote`, {
    storyIds,
  });
export const returnStory = (
  projectId: string,
  storyId: string,
  reason: string,
) =>
  post<{ ok: true }>(`/projects/${projectId}/stories/${storyId}/return`, {
    reason,
  });
export const getCoverage = (projectId: string) =>
  get<CoverageReport>(`/projects/${projectId}/coverage`);
export const getArchitecture = (projectId: string) =>
  get<Architecture>(`/projects/${projectId}/architecture`);
export const listInfraArtifacts = (projectId: string) =>
  get<InfraArtifact[]>(`/projects/${projectId}/infra-artifacts`);

// --- Psicólogo (Fase 4b) ---

export const listHypotheses = (projectId: string) =>
  get<PsychologistHypothesis[]>(`/projects/${projectId}/hypotheses`);
export const acceptHypothesis = (projectId: string, hypothesisId: string) =>
  post<PsychologistHypothesis>(
    `/projects/${projectId}/hypotheses/${hypothesisId}/accept`,
  );
export const dismissHypothesis = (projectId: string, hypothesisId: string) =>
  post<PsychologistHypothesis>(
    `/projects/${projectId}/hypotheses/${hypothesisId}/dismiss`,
  );
export const listPsychologistAnalyses = (projectId: string) =>
  get<PsychologistAnalysis[]>(`/projects/${projectId}/psychologist/analyses`);
// Leitura pura (RN-454) — ver reanalyzeSession abaixo, que é o que faz
// efeito (cria job) e o `/reanalyze` que devolve 503 quando desativado.
export const getPsychologistStatus = (projectId: string) =>
  get<PsychologistStatus>(`/projects/${projectId}/psychologist/status`);
// --- Anamnese (Fase 4b) ---

// Um evento pelo id resolvendo a SESSÃO dele. A janela da Anamnese é de
// projeto, então a evidência de um perfil pode ser de qualquer sessão — sem
// resolver, o chip navegava pra sessão mais recente e não achava o evento.
export const getProjectEvent = (projectId: string, eventId: string) =>
  get<SessionEvent>(`/projects/${projectId}/events/${eventId}`);
export const runAnamnese = (projectId: string) =>
  post<{ ok: true }>(`/projects/${projectId}/anamnese/run`);

export const listProficiency = (projectId: string) =>
  get<ProficiencyProfile[]>(`/projects/${projectId}/proficiency`);
export const deleteMyProficiency = (projectId: string) =>
  del<{ deleted: number; optedOut: true }>(
    `/projects/${projectId}/proficiency/me`,
  );
export const optInProficiency = (projectId: string) =>
  post<{ optedOut: false }>(`/projects/${projectId}/proficiency/me/opt-in`);
// Histórico de TODOS os agentes que têm versão no projeto. A UI não pode
// adivinhar os slugs: dev agent é instanciado por módulo (`dev-api`) e não
// está no roster estático.
export const listProjectInstructionVersions = (projectId: string) =>
  get<{ agent: string; versions: AgentInstructionVersion[] }[]>(
    `/projects/${projectId}/instruction-versions`,
  );
export const listInstructionVersions = (projectId: string, agent: string) =>
  get<AgentInstructionVersion[]>(
    `/projects/${projectId}/agents/${agent}/instruction-versions`,
  );
export const rollbackInstruction = (
  projectId: string,
  agent: string,
  version: number,
) =>
  post<{ agent: string; restoredFrom: number; toVersion: number }>(
    `/projects/${projectId}/agents/${agent}/instruction-versions/${version}/rollback`,
  );

export const reanalyzeSession = (projectId: string, sessionId: string) =>
  post<{ ok: true }>(
    `/projects/${projectId}/sessions/${sessionId}/psychologist/reanalyze`,
  );

// --- Execução (Fase 4a) ---

/**
 * `originSessionId` (RN-135, PR #266) é a sessão de CHAT de onde partiu o
 * clique — a api fecha ela ao final, se não tiver handoff/ação/turno
 * pendente. Omitido (chamador da Visão Geral, sem sessão de chat no
 * contexto) preserva o comportamento de sempre: nenhuma sessão fecha.
 */
export const activateExecution = (projectId: string, originSessionId?: string) =>
  post<ExecutionActivation>(`/projects/${projectId}/execution/activate`, {
    originSessionId,
  });
/**
 * A sessão de execução VIGENTE do projeto (RN-139) — `active` com
 * `execution.activated` gravado — ou `null`. NUNCA a sessão mais recente do
 * projeto: é o que `ProjectExecutorsTab` usava antes (`useLatestSession`) e
 * que passa a olhar silenciosamente qualquer sessão nova (ex. uma ideação)
 * criada depois da execução, ficando vazia de eventos de dev/QA.
 */
export const getActiveExecutionSession = (projectId: string) =>
  get<Session | null>(`/projects/${projectId}/execution/session`);
/**
 * Pede mais um dev agent para um módulo (RN-083).
 *
 * Não é mais "aceitar": o pedido passa pelo teto da área. Dentro dele o agente
 * sobe na hora; acima dele volta `aguardando_autorizacao` e NADA subiu — quem
 * chama precisa dizer isso ao usuário, senão a tela mente que subiu.
 */
export const requestParallelization = (
  projectId: string,
  sessionId: string,
  module: string,
) =>
  post<ParallelizationRequest>(
    `/projects/${projectId}/sessions/${sessionId}/execution/parallelize`,
    { module },
  );

export const listAgentAreas = (projectId: string) =>
  get<AgentArea[]>(`/projects/${projectId}/agent-areas`);

export const setAreaMaxParallel = (
  projectId: string,
  key: string,
  maxParallel: number,
) =>
  patch<AgentArea>(`/projects/${projectId}/agent-areas/${key}/max-parallel`, {
    maxParallel,
  });

/**
 * `limitUsd: null` limpa o teto (ADR 0110) — a conversão dólar→micro-USD é
 * feita no servidor, mesma convenção de `setProjectBudget`/`setSessionBudget`.
 */
export const setAreaBudget = (
  projectId: string,
  key: string,
  limitUsd: number | null,
) =>
  put<AgentArea>(`/projects/${projectId}/agent-areas/${key}/budget`, {
    limitUsd,
  });
// Libera uma task que o dev agent devolveu bloqueada, depois de o usuário ler
// o diagnóstico. Enquanto `blocked`, ela é excluída do claim atômico — sem
// isto uma task impossível ficaria parada pra sempre.
export const unblockTask = (
  projectId: string,
  sessionId: string,
  taskId: string,
) =>
  post<{ ok: true }>(
    `/projects/${projectId}/sessions/${sessionId}/tasks/${taskId}/unblock`,
  );
// Rearma um dev agent travado pelo circuit breaker (Fase 12b — RN-047) — a
// única saída de idle_tripped.
export const rearmDevAgent = (
  projectId: string,
  sessionId: string,
  agentId: string,
) =>
  post<{ ok: true }>(
    `/projects/${projectId}/sessions/${sessionId}/agents/${agentId}/rearm`,
  );

// --- Proposed actions ---

export const proposeAction = (
  projectId: string,
  sessionId: string,
  input: { actionType: ActionType; actor: { kind: 'user' | 'agent' | 'system'; id: string }; payload: Record<string, unknown> },
) => post<ProposedAction>(`/projects/${projectId}/sessions/${sessionId}/actions`, input);
export const listActions = (
  projectId: string,
  sessionId: string,
  opts: { afterSeq?: number; limit?: number } = {},
) =>
  get<Page<ProposedAction>>(
    `/projects/${projectId}/sessions/${sessionId}/actions${qs(opts)}`,
  );
export const approveAction = (projectId: string, sessionId: string, actionId: string) =>
  post<ProposedAction>(
    `/projects/${projectId}/sessions/${sessionId}/actions/${actionId}/approve`,
  );
export const approveAlwaysAction = (
  projectId: string,
  sessionId: string,
  actionId: string,
) =>
  post<ProposedAction>(
    `/projects/${projectId}/sessions/${sessionId}/actions/${actionId}/approve_always`,
  );
export const denyAction = (
  projectId: string,
  sessionId: string,
  actionId: string,
  reason?: string,
) =>
  post<ProposedAction>(
    `/projects/${projectId}/sessions/${sessionId}/actions/${actionId}/deny`,
    { reason },
  );

// Ações PENDENTES do PROJETO inteiro, em qualquer sessão (Onda 2 — aba PRs).
// Ao lado de `listActions` (escopado por SESSÃO): esta é a consulta que a
// aba PRs usa para achar a `proposed_action` correspondente a um PR (ex.: um
// `git_merge` pendente) sem depender de qual sessão a propôs — o bug de raiz
// que escondia revisão de sessão antiga em `ProjectApprovalsTab`. Só
// `status=pending` é suportado hoje.
export const getProjectPendingActions = (
  projectId: string,
  opts: { actionType?: ActionType } = {},
) =>
  get<ProposedAction[]>(
    `/projects/${projectId}/actions${qs({ status: 'pending', actionType: opts.actionType })}`,
  );

// --- LLM: modelos, bindings, credenciais, budgets ---

// Pende do PROJETO desde o ADR 0049: a curadoria é por workspace, e o
// workspace sai do projeto no servidor. As três telas que chamam isto já
// estavam dentro de um projeto — nenhuma tinha workspace na mão.
export const listModels = (projectId: string) =>
  get<ModelsByCategory>(`/projects/${projectId}/models`);

// --- Curadoria de catálogo (Fase 9c) ---
//
// Ancoradas no workspace porque a curadoria É por workspace desde o ADR 0049
// — não só porque o RolesGuard resolve o papel a partir de `:workspaceId`.
// O catálogo em si (nome, preço, capabilities) continua global.

export const listModelCatalog = (workspaceId: string) =>
  get<CatalogoPorCategoria>(`/workspaces/${workspaceId}/models/catalog`);

export const setModelsActive = (
  workspaceId: string,
  input: { modelIds: string[]; isActive: boolean },
) =>
  post<ModelComCuradoria[]>(
    `/workspaces/${workspaceId}/models/activate`,
    input,
  );

/**
 * A curadoria por USO — substitui a lista, não soma (ADR 0051). Lista vazia é
 * como se desmarca tudo, e por isso não há rota de "remover uso".
 */
/**
 * Gasto das chaves do owner. A rota exige `owner` no workspace (RN-060) — a
 * tela só a chama quando o papel confere, para não pedir um 403 de propósito.
 */
export const getCredentialSpend = (workspaceId: string, meses?: number) =>
  get<CredentialSpend>(
    `/workspaces/${workspaceId}/credential-spend${meses ? `?meses=${meses}` : ''}`,
  );

export const setModelUses = (
  workspaceId: string,
  input: { modelIds: string[]; uses: UsoDeModelo[] },
) => post<ModelComCuradoria[]>(`/workspaces/${workspaceId}/models/uses`, input);

export const syncModelCatalog = (workspaceId: string) =>
  post<SyncModelCatalogResult>(`/workspaces/${workspaceId}/models/sync`, {});

export const updateModelPricing = (
  workspaceId: string,
  modelId: string,
  input: {
    inputPricePerMillionMicros: number;
    outputPricePerMillionMicros: number;
  },
) =>
  patch<Model>(`/workspaces/${workspaceId}/models/${modelId}/pricing`, input);

export const listModelPriceChanges = (workspaceId: string, modelId: string) =>
  get<ModelPriceChange[]>(
    `/workspaces/${workspaceId}/models/${modelId}/price-changes`,
  );

export const getWorkspaceModelBinding = (workspaceId: string) =>
  get<{ modelId: string } | null>(`/workspaces/${workspaceId}/model-binding`);
export const setWorkspaceModelBinding = (workspaceId: string, modelId: string) =>
  put<void>(`/workspaces/${workspaceId}/model-binding`, { modelId });

export const getProjectModelBinding = (projectId: string) =>
  get<{ modelId: string } | null>(`/projects/${projectId}/model-binding`);
export const setProjectModelBinding = (projectId: string, modelId: string) =>
  put<void>(`/projects/${projectId}/model-binding`, { modelId });

// `agentId` é o agente REALMENTE ativo na sessão (ex.: depois de um handoff
// pro PO/Arquiteto/Dev Lead) — sem ele, a api só enxerga sessão→projeto→
// workspace e cai no fallback fixo do Criativo (`herdarModeloDeStart`),
// mostrando o modelo errado na topbar assim que outro agente assume.
export const getSessionModelBinding = (
  projectId: string,
  sessionId: string,
  agentId?: string,
) =>
  get<ResolvedBinding>(
    `/projects/${projectId}/sessions/${sessionId}/model-binding${qs({ agentId })}`,
  );
export const setSessionModelBinding = (
  projectId: string,
  sessionId: string,
  modelId: string,
) =>
  put<void>(
    `/projects/${projectId}/sessions/${sessionId}/model-binding`,
    { modelId },
  );

export const getAgentModelBinding = (projectId: string, agentSlug: string) =>
  get<ResolvedBinding | null>(`/projects/${projectId}/agent-bindings/${agentSlug}`);
export const setAgentModelBinding = (
  projectId: string,
  agentSlug: string,
  modelId: string,
) => put<void>(`/projects/${projectId}/agent-bindings/${agentSlug}`, { modelId });
/**
 * "Voltar a herdar" (ADR 0064, RN-102) — APAGA o binding do agente, nunca
 * grava nele o modelo da área. Copiar pareceria igual na tela e viraria uma
 * cópia que diverge sozinha na próxima mudança da área.
 */
export const clearAgentModelBinding = (projectId: string, agentSlug: string) =>
  del<void>(`/projects/${projectId}/agent-bindings/${agentSlug}`);

export const getAreaModelBinding = (projectId: string, areaKey: string) =>
  get<ResolvedBinding | null>(`/projects/${projectId}/area-bindings/${areaKey}`);
export const setAreaModelBinding = (
  projectId: string,
  areaKey: string,
  modelId: string,
) => put<void>(`/projects/${projectId}/area-bindings/${areaKey}`, { modelId });
export const clearAreaModelBinding = (projectId: string, areaKey: string) =>
  del<void>(`/projects/${projectId}/area-bindings/${areaKey}`);

// Preferências do próprio usuário (fundação de i18n, Onda 6a). A leitura
// aqui é redundante com `locale` no corpo de `/auth/login` e `/auth/refresh`
// (ver `lib/auth.ts`) — de propósito: serve só para reafirmar o valor sem
// esperar o próximo refresh, nunca como fonte primária.
export const getMyPreferences = () =>
  get<UserPreferences>('/users/me/preferences');
export const updateMyPreferences = (input: { locale: UserLocale }) =>
  patch<UserPreferences>('/users/me/preferences', input);

export const listCredentials = () =>
  get<UserCredentialMetadata[]>('/users/me/credentials');
// `LlmCredentialProvider`, e não o par fechado que estava aqui: um provider
// novo (Fase 9b) entra pelo tipo compartilhado, sem editar esta linha.
export const upsertCredential = (input: {
  provider: LlmCredentialProvider;
  apiKey: string;
}) => post<UserCredentialMetadata>('/users/me/credentials', input);
export const deleteCredential = (provider: LlmCredentialProvider) =>
  del<{ ok: true }>(`/users/me/credentials/${provider}`);
// Verificação da credencial JÁ gravada (ADR 0050): a chave nunca sai da api,
// só o veredito volta. `recusado` chega como 200 com motivo, não como erro.
export const testCredential = (provider: CredentialProviderName) =>
  post<CredentialTestResult>(`/users/me/credentials/${provider}/test`);

export const getProjectBudget = (projectId: string) =>
  get<Budget | null>(`/projects/${projectId}/budget`);
export const setProjectBudget = (
  projectId: string,
  input: { limitUsd: number; policy: BudgetPolicy },
) => put<Budget>(`/projects/${projectId}/budget`, input);
export const getSessionBudget = (projectId: string, sessionId: string) =>
  get<Budget | null>(`/projects/${projectId}/sessions/${sessionId}/budget`);
export const getSessionTokenUsage = (projectId: string, sessionId: string) =>
  get<AgentTokenUsage[]>(
    `/projects/${projectId}/sessions/${sessionId}/token-usage`,
  );
// Custo por agente no projeto, janela deslizante de 30 dias — a coluna
// "EST. MÊS" e o card de custo do time da tela de Configurações. Agente que
// nunca rodou NÃO vem na lista: a tela mostra traço, que é diferente de zero.
export const getProjectAgentCosts = (projectId: string) =>
  get<AgentTokenUsage[]>(`/projects/${projectId}/agent-costs`);
export const setSessionBudget = (
  projectId: string,
  sessionId: string,
  input: { limitUsd: number; policy: BudgetPolicy },
) => put<Budget>(`/projects/${projectId}/sessions/${sessionId}/budget`, input);

/**
 * O registro de gates ATIVOS (FASE 15b).
 *
 * Global, sem `projectId`: os mesmos gates valem para todo projeto, e
 * pendurá-lo num sugeriria o contrário.
 */
export const getRegistroDeGates = () => get<RegistroDeGates>('/gates');

export type { ModelBindingScope };

/**
 * As duas audiências do gasto (FASE 22, ADR 0063, RN-101).
 *
 * Chamadas separadas porque as perguntas são separadas, e porque quem pode
 * fazer cada uma é outra pessoa: a de workspace exige `owner`, a de projeto
 * basta ser membro. A tela nunca dispara a primeira sem o papel — pedir um 403
 * de propósito é ruído no log de segurança.
 */
export const getWorkspaceSpendReport = (workspaceId: string, dias?: number) =>
  get<WorkspaceSpendReport>(
    `/workspaces/${workspaceId}/spend-report${dias ? `?dias=${dias}` : ''}`,
  );

export const getMySpend = (projectId: string, dias?: number) =>
  get<MySpend>(
    `/projects/${projectId}/spend/me${dias ? `?dias=${dias}` : ''}`,
  );

// ---------------------------------------------------------------------------
// APÊNDICE DA FRENTE D0 (ADR 0076). Escrito no fim pelo mesmo motivo do
// apêndice de `api-types.ts`: a onda tem outras frentes editando este arquivo.
// A integração recolhe isto para cima, dentro de `getWorkspaceSpendReport`.
// ---------------------------------------------------------------------------

/**
 * A MESMA rota de `getWorkspaceSpendReport`, com o tipo já ciente dos três
 * blocos novos (provider, owner e agente — RN-186/RN-188).
 *
 * Não há função nova do lado do membro, e não é esquecimento: `getMySpend`
 * continua sem qualquer parâmetro de dimensão. Uma função que aceitasse
 * "dimensão" na visão do membro seria a porta que o ADR 0063 mandou não abrir,
 * e a api recusaria de qualquer forma — a rota dela não lê esse parâmetro.
 */
export const getWorkspaceSpendReportComProvider = (
  workspaceId: string,
  dias?: number,
) =>
  get<
    WorkspaceSpendReport & import('./api-types').WorkspaceSpendPorProvider
  >(`/workspaces/${workspaceId}/spend-report${dias ? `?dias=${dias}` : ''}`);

// ---------------------------------------------------------------------------
// APÊNDICE DA FRENTE G3 (PROGRAMA 28, Onda 5) — a tela do Chat RAG.
//
// As três rotas de `rag.controller.ts` (RN-231..238, ADR 0080). Escrito no
// FIM do arquivo pelo mesmo motivo do apêndice da frente D0 — outras frentes
// da Onda 5 editam este arquivo em paralelo. Tipos importados INLINE (sem
// entrar na lista grande do topo) pela mesma razão.
//
// `search` e `coverage` são `role:viewer`; `reindex` é `role:maintainer`
// (RN-238) — a tela gate o botão, mas quem garante é a api.
// ---------------------------------------------------------------------------

export const searchRag = (
  projectId: string,
  body: {
    query: string;
    scopes?: import('./api-types').RagChunkScope[];
    limit?: number;
  },
) => post<import('./api-types').RagSearchResult>(`/projects/${projectId}/rag/search`, body);

// O voto sobre um trecho (RN-480) — `viewer`, o MESMO papel de `search`: quem
// pode ler o resultado é quem pode julgá-lo. Votar de novo no mesmo trecho da
// mesma busca SOBRESCREVE o próprio voto (unique por ator), nunca soma um
// segundo — a métrica mede acerto, não entusiasmo.
export const sendRagFeedback = (
  projectId: string,
  body: {
    searchId: string;
    chunkId: string;
    verdict: import('./api-types').RagVerdict;
  },
) =>
  post<import('./api-types').RagFeedbackReport>(
    `/projects/${projectId}/rag/feedback`,
    body,
  );

export const getRagCoverage = (projectId: string) =>
  get<import('./api-types').RagCoverage>(`/projects/${projectId}/rag/coverage`);

export const reindexRag = (projectId: string) =>
  post<import('./api-types').RagReindexReport>(`/projects/${projectId}/rag/reindex`);

// A pasta local anexada (RN-455, ADR 0113) — texto já lido pelo NAVEGADOR,
// nunca um caminho de host. `maintainer`, mesma régua de `reindex`.
export const attachLocalFolder = (
  projectId: string,
  body: import('./api-types').AttachLocalFolderRequest,
) =>
  post<import('./api-types').AttachLocalFolderReport>(
    `/projects/${projectId}/rag/local`,
    body,
  );

// --- Hugging Face Hub → pull para o Ollama ---
//
// Ancoradas no workspace, mesmo padrão da curadoria de catálogo acima:
// `maintainer` é o papel que o `RolesGuard` resolve a partir de `:workspaceId`.
// `repoId` vai no CORPO do POST de criação, nunca em segmento de path — o
// formato real do Hub (`<publisher>/<modelo>`) contém `/`, que quebraria o
// casamento de rota (mesma razão de `getCodeFile` para caminho de arquivo).

export const searchHuggingFaceModels = (
  workspaceId: string,
  params: { q: string; includeCommunity?: boolean },
) =>
  get<import('./api-types').HuggingFaceModel[]>(
    `/workspaces/${workspaceId}/huggingface/models${qs({
      q: params.q,
      includeCommunity: params.includeCommunity || undefined,
    })}`,
  );

export const requestModelPull = (
  workspaceId: string,
  body: { repoId: string; estimatedSizeBytes?: number },
) =>
  post<import('./api-types').ModelPullRequest>(
    `/workspaces/${workspaceId}/huggingface/pull-requests`,
    body,
  );

// Roda o pull inteiro SINCRONAMENTE no servidor (sem fila própria na api
// ainda) — a chamada pode demorar minutos e um proxy no meio pode fechar a
// conexão antes do fim. `getModelPullRequest` (poll) é a fonte de verdade
// de status, independente de esta promise resolver ou rejeitar.
export const confirmModelPull = (workspaceId: string, id: string) =>
  post<import('./api-types').ModelPullRequest>(
    `/workspaces/${workspaceId}/huggingface/pull-requests/${id}/confirm`,
  );

export const getModelPullRequest = (workspaceId: string, id: string) =>
  get<import('./api-types').ModelPullRequest>(
    `/workspaces/${workspaceId}/huggingface/pull-requests/${id}`,
  );
