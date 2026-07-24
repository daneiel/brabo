import { getToken } from './keycloak';
import type {
  AgentAutonomyRule,
  ActionType,
  Architecture,
InfraArtifact,
  Budget,
  BudgetPolicy,
  CoverageReport,
  Epic,
  ExecutionActivation,
  Handoff,
  ModelBindingScope,
  ModelsByCategory,
  Page,
  PermissionPolicy,
  PermissionsFile,
  Project,
  ProjectMemberWithUser,
  ProposedAction,
  ProvisionedRepository,
  ProvisionRepositoryResult,
  RepoBootstrapStatus,
  ResolvedBinding,
  Role,
  Session,
  SessionEvent,
  UserCredentialMetadata,
  Workspace,
  WorkspaceWithRole,
} from './api-types';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`api error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

function qs(params: Record<string, string | number | undefined>): string {
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
  opts: { afterSeq?: number; limit?: number } = {},
) =>
  get<Page<SessionEvent>>(
    `/projects/${projectId}/sessions/${sessionId}/events${qs(opts)}`,
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
export const upsertCredential = (input: {
  provider: 'anthropic' | 'openai';
  apiKey: string;
}) => post<UserCredentialMetadata>('/users/me/credentials', input);
export const deleteCredential = (provider: 'anthropic' | 'openai') =>
  del<{ ok: true }>(`/users/me/credentials/${provider}`);

export const getProjectBudget = (projectId: string) =>
  get<Budget | null>(`/projects/${projectId}/budget`);
export const setProjectBudget = (
  projectId: string,
  input: { limitUsd: number; policy: BudgetPolicy },
) => put<Budget>(`/projects/${projectId}/budget`, input);
export const getSessionBudget = (projectId: string, sessionId: string) =>
  get<Budget | null>(`/projects/${projectId}/sessions/${sessionId}/budget`);
export const setSessionBudget = (
  projectId: string,
  sessionId: string,
  input: { limitUsd: number; policy: BudgetPolicy },
) => put<Budget>(`/projects/${projectId}/sessions/${sessionId}/budget`, input);

export type { ModelBindingScope };
