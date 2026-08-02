import { renovarSessao, tokenAtual } from './auth';
import { runtimeConfig } from './runtime-config';
import { childSpan, logger, newTraceContext } from './logger';
import type { LlmCredentialProvider } from './models';
import type {
  AgentAutonomyRule,
  AgentTokenUsage,
  ActionType,
  Architecture,
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
  SyncModelCatalogResult,
  Page,
  PermissionPolicy,
  PermissionsFile,
  Project,
  ProjectBlockedStatus,
  ProjectMemberWithUser,
  ProposedAction,
  ProvisionedRepository,
  ProvisionRepositoryResult,
  AdoptRepositoryResult,
  BootstrapPlanEstado,
  RepoBootstrapStatus,
  ResolvedBinding,
  Role,
  Session,
  SessionEvent,
  UserCredentialMetadata,
  Workspace,
  WorkspaceSummary,
  WorkspaceWithRole,
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
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
export const createProject = (
  workspaceId: string,
  input: { name: string; slug: string },
) => post<Project>(`/workspaces/${workspaceId}/projects`, input);
export const getProject = (projectId: string) =>
  get<Project>(`/projects/${projectId}`);

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
export const acceptParallelization = (
  projectId: string,
  sessionId: string,
  module: string,
) =>
  post<{ ok: true }>(
    `/projects/${projectId}/sessions/${sessionId}/execution/parallelize`,
    { module },
  );
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

export const listModels = () => get<ModelsByCategory>('/models');

// --- Curadoria de catálogo (Fase 9c) ---
//
// Ancoradas no workspace porque o RolesGuard resolve o papel a partir de
// `:workspaceId`/`:projectId`; o catálogo em si é global.

export const listModelCatalog = (workspaceId: string) =>
  get<ModelsByCategory>(`/workspaces/${workspaceId}/models/catalog`);

export const setModelsActive = (
  workspaceId: string,
  input: { modelIds: string[]; isActive: boolean },
) => post<Model[]>(`/workspaces/${workspaceId}/models/activate`, input);

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
export const setSessionBudget = (
  projectId: string,
  sessionId: string,
  input: { limitUsd: number; policy: BudgetPolicy },
) => put<Budget>(`/projects/${projectId}/sessions/${sessionId}/budget`, input);

export type { ModelBindingScope };
