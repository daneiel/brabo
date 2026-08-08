import { renovarSessao, tokenAtual } from './auth';
import { runtimeConfig } from './runtime-config';
import { childSpan, logger, newTraceContext } from './logger';
import type { LlmCredentialProvider } from './models';
import type {
  AgentAutonomyRule,
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
  ProficiencyProfile,
  AgentInstructionVersion,
  Budget,
  BudgetPolicy,
  CoverageReport,
  Epic,
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
  CredentialProviderName,
  CredentialTestResult,
  UserCredentialMetadata,
  Workspace,
  WorkspaceSummary,
  WorkspaceWithRole,
  RegistroDeGates,
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
export const createProject = (
  workspaceId: string,
  input: { name: string; slug: string },
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

export const listProjectMembers = (projectId: string) =>
  get<ProjectMemberWithUser[]>(`/projects/${projectId}/members`);
export const addProjectMember = (
  projectId: string,
  input: { userId: string; role: Role },
) => post<void>(`/projects/${projectId}/members`, input);
export const removeProjectMember = (projectId: string, userId: string) =>
  del<void>(`/projects/${projectId}/members/${userId}`);

export const getProjectPermissions = (projectId: string) =>
  get<PermissionsFile>(`/projects/${projectId}/permissions`);
export const setProjectPermissions = (projectId: string, file: PermissionsFile) =>
  put<PermissionsFile>(`/projects/${projectId}/permissions`, file);

export const listAgentAutonomy = (projectId: string) =>
  get<AgentAutonomyRule[]>(`/projects/${projectId}/agent-autonomy`);
export const setAgentAutonomy = (
  projectId: string,
  input: { agentId: string; actionType: ActionType; mode: PermissionPolicy },
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

// --- Sessions ---

export const createSession = (projectId: string) =>
  post<Session>(`/projects/${projectId}/sessions`);
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
export const confirmReadiness = (projectId: string, sessionId: string) =>
  post<{ ok: true }>(`/projects/${projectId}/sessions/${sessionId}/readiness`);
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

export const activateExecution = (projectId: string) =>
  post<ExecutionActivation>(`/projects/${projectId}/execution/activate`);
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

export const getSessionModelBinding = (projectId: string, sessionId: string) =>
  get<ResolvedBinding>(
    `/projects/${projectId}/sessions/${sessionId}/model-binding`,
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
