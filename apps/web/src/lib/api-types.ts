// Tipos espelhando as entidades reais da api (ver apps/api/src/domain/**),
// mantidos aqui em vez de importados diretamente (apps/web não referencia
// código server-side; packages/shared cobre só os tipos genuinamente
// compartilhados hoje, como HealthStatus/GitProviderName).

export type Role = 'owner' | 'maintainer' | 'developer' | 'viewer';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceWithRole {
  workspace: Workspace;
  role: Role;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberWithUser {
  userId: string;
  role: Role;
  name: string | null;
  email: string;
}

export type PermissionListName = 'allow' | 'deny' | 'ask';

export interface PermissionsFile {
  allow: string[];
  deny: string[];
  ask: string[];
}

export type PermissionPolicy = 'auto_approve' | 'require_approval' | 'deny';

export interface AgentAutonomyRule {
  agentId: string;
  actionType: ActionType;
  mode: PermissionPolicy;
}

export type SessionStatus =
  | 'created'
  | 'active'
  | 'closing'
  | 'closed'
  | 'closed_abnormally';

export interface Session {
  id: string;
  projectId: string;
  createdBy: string;
  status: SessionStatus;
  nextSeq: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export type ActorKind = 'user' | 'agent' | 'system';

export interface Actor {
  kind: ActorKind;
  id: string;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  seq: number;
  type: string;
  actor: Actor;
  payload: unknown;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: number | null;
}

export type ActionType =
  | 'terminal'
  | 'git_commit'
  | 'git_push'
  | 'pr_open'
  | 'spend';

export type ActionStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'auto_approved'
  | 'executed'
  | 'failed';

export interface TerminalExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  rawBytes: number;
  estimatedTokensRaw: number;
  compressedBytes: number | null;
  estimatedTokensCompressed: number | null;
}

export interface ProposedAction {
  id: string;
  projectId: string;
  sessionId: string;
  seq: number;
  actionType: ActionType;
  payload: Record<string, unknown>;
  status: ActionStatus;
  resolvedPolicy: PermissionPolicy;
  actor: Actor;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  executionResult: TerminalExecutionResult | null;
  createdAt: string;
  updatedAt: string;
}

export type LLMProviderName = 'ollama' | 'anthropic' | 'openai';
export type ModelCategory = 'local' | 'cloud';

export interface Model {
  id: string;
  provider: LLMProviderName;
  name: string;
  displayName: string;
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
  contextWindow: number | null;
  isActive: boolean;
}

export type ModelsByCategory = Record<ModelCategory, Record<string, Model[]>>;

export type ModelBindingScope = 'workspace' | 'project' | 'agent' | 'session';

export interface ModelBinding {
  id: string;
  scope: ModelBindingScope;
  scopeId: string;
  modelId: string;
}

export interface ResolvedBinding {
  modelId: string;
  origin: ModelBindingScope;
}

// user_credentials guarda tanto chaves de LLM quanto tokens de git do
// usuário (github/gitlab) — o endpoint de listagem mistura os dois.
export type CredentialProviderName = LLMProviderName | 'github' | 'gitlab';

export interface UserCredentialMetadata {
  id: string;
  provider: CredentialProviderName;
  createdAt: string;
  updatedAt: string;
}

export type BudgetPolicy = 'block' | 'allow';

export interface Budget {
  id: string;
  projectId: string | null;
  sessionId: string | null;
  limitMicros: number;
  spentMicros: number;
  policy: BudgetPolicy;
  lastThresholdNotified: number;
}

export type GitProviderName = 'local' | 'github' | 'gitlab';

export interface ProvisionedRepository {
  id: string;
  projectId: string;
  provider: GitProviderName;
  externalId: string;
  url: string;
  defaultBranch: string;
  visibility: 'public' | 'private';
  provisionedBy: string;
  createdAt: string;
  updatedAt: string;
}

// --- Bootstrap de Gitflow — espelha
// apps/api/src/domain/git/repo-bootstrap.entity.ts +
// get-repo-bootstrap-status.use-case.ts. A ordem aqui NÃO é a de execução
// (ver BOOTSTRAP_STEPS em lib/bootstrap.ts pra ordem real). ---
export type BootstrapStepName =
  | 'commit_pr_template'
  | 'commit_branching_policy'
  | 'create_dev_branch'
  | 'create_qa_branch'
  | 'create_rc_branch'
  | 'protect_branches';

export type BootstrapStepStatus = 'pending' | 'running' | 'done' | 'failed';

export type ProvisioningStatus =
  | 'provisioning'
  | 'provisioned'
  | 'provision_failed';

export interface RepoBootstrapStatus {
  status: ProvisioningStatus | null;
  sessionId: string | null;
  failedStep: BootstrapStepName | null;
  lastError: string | null;
  attempts: number;
}

export interface ProvisionRepositoryResult {
  repository: ProvisionedRepository;
  bootstrap: { step: BootstrapStepName; status: BootstrapStepStatus };
}

// --- Chat SSE — espelha ChatSseEvent de
// apps/api/src/application/use-cases/llm/send-chat-message.use-case.ts ---
export type ChatSseEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      inputTokens: number;
      outputTokens: number;
      costMicros: number;
      estimated: boolean;
    }
  | { type: 'error'; message: string }
  | { type: 'metering_failed'; message: string };

// --- Agentes conversacionais / handoffs (Fase 3b) ---

export type HandoffStatus = 'offered' | 'accepted' | 'completed' | 'rejected';

export interface Handoff {
  id: string;
  sessionId: string;
  projectId: string;
  fromAgent: string;
  toAgent: string;
  artifactId: string | null;
  status: HandoffStatus;
  createdAt: string;
  updatedAt: string;
}

// Payload do session_event `artifact.business_rule` emitido pelo Criativo.
export interface BusinessRulePayload {
  title: string;
  description: string;
  origin: unknown[];
}

// Payload do session_event `artifact.product_brief`.
export interface ProductBriefPayload {
  title: string;
  summary: string;
  rules: unknown[];
}

// --- Backlog (Fase 3b — PO) ---

export type StoryStatus = 'draft' | 'ready' | 'in_progress' | 'done';

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

// --- Gates de PR (Fase 4a — QA/SecOps) ---

export type PrGateStatus = 'awaiting_qa' | 'awaiting_secops' | 'awaiting_user';

export interface Task {
  id: string;
  storyId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedTo: string | null;
  blocked: boolean;
  blockedReason: string | null;
  gateStatus: PrGateStatus | null;
  gateCorrectionCount: number;
  createdAt: string;
  updatedAt: string;
}

// Artefato de infra (Fase 4a — InfraAgent): PR de Dockerfiles/compose/CI
// gated pelos MESMOS QA/SecOps do dev, sem task/story por trás.
export interface InfraArtifact {
  id: string;
  projectId: string;
  sessionId: string;
  title: string;
  prActionId: string;
  gateStatus: PrGateStatus;
  gateCorrectionCount: number;
  blocked: boolean;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoverageMatrixRow {
  rule: string;
  tests: string[];
  covered: boolean;
}

// Payload do session_event `artifact.qa_verdict` (QAAgent).
export interface QaVerdictPayload {
  taskId: string;
  veredito: 'approved' | 'changes_requested';
  resumo: string;
  itens: string[];
  coverageMatrix: CoverageMatrixRow[];
}

// Payload do session_event `artifact.secops_verdict` (SecOpsAgent).
export interface SecOpsVerdictPayload {
  taskId: string;
  veredito: 'approved' | 'changes_requested';
  resumo: string;
  itens: string[];
}

export interface Story {
  id: string;
  epicId: string;
  projectId: string;
  sessionId: string;
  title: string;
  description: string;
  rf: string[];
  rnf: string[];
  businessRuleIds: string[];
  dod: string[];
  dor: string[];
  status: StoryStatus;
  createdAt: string;
  updatedAt: string;
  tasks: Task[];
}

export interface Epic {
  id: string;
  projectId: string;
  sessionId: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  stories: Story[];
}

export interface RuleCoverage {
  ruleId: string;
  title: string;
  coveredByStoryIds: string[];
  covered: boolean;
}

export interface CoverageReport {
  rules: RuleCoverage[];
  uncoveredCount: number;
}

// --- Arquitetura (Fase 3b — Arquiteto) ---

export interface Module {
  name: string;
  stack: string;
  responsibility: string;
  dependsOn: string[];
}

export interface ModuleMap {
  id: string;
  projectId: string;
  sessionId: string;
  modules: Module[];
  version: number;
  createdAt: string;
}

export interface AdrRef {
  actionId: string;
  title: string;
  status: string;
  pullRequestUrl: string | null;
}

export interface ArchitecturePendency {
  storyId: string;
  title: string;
  status: StoryStatus;
  reason: 'no_module' | 'missing_module';
  missing: string[];
}

export interface Architecture {
  moduleMap: ModuleMap | null;
  adrs: AdrRef[];
  pendencies: ArchitecturePendency[];
}

// --- Execução (Fase 4a — dev agents) ---

export interface ExecutionActivation {
  sessionId: string;
  modules: string[];
}
