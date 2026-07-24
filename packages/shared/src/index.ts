export type ServiceName = "api" | "engine";

export interface HealthStatus {
  service: ServiceName;
  status: "ok" | "error";
  timestamp: string;
  details?: Record<string, unknown>;
}

// --- LLM ---

export type LLMProviderName = "ollama" | "anthropic" | "openai";

export type ModelCategory = "local" | "cloud";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  model: string;
  maxTokens?: number;
  /** Credencial decriptada — nunca persistida/logada por quem consome isto. */
  apiKey?: string;
  /** Override do host do Ollama (senão usa OLLAMA_HOST/default do provider). */
  host?: string;
}

export interface ChatTextDeltaChunk {
  type: "text_delta";
  text: string;
}

export interface ChatUsageChunk {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

export interface ChatErrorChunk {
  type: "error";
  message: string;
}

export type ChatStreamChunk = ChatTextDeltaChunk | ChatUsageChunk | ChatErrorChunk;

// --- Git ---

export type GitProviderName = "local" | "github" | "gitlab";

// --- Git Provider Contract (Fase 2) ---
//
// Contrato normalizado, independente de provider — nenhum tipo aqui pode
// vazar o shape de Octokit/Gitbeaker. `GitProviderContract` é deliberadamente
// um tipo separado da `GitProvider` (abstract class de DI do Nest em
// apps/api, que hoje só tem `createRepository`) — ver docs/adr/0001. Só
// `LocalGitProvider` implementa este contrato por enquanto.

export interface GitProviderCapabilities {
  readonly protectBranch: boolean;
  readonly pullRequests: boolean;
}

export interface GitRepo {
  externalId: string;
  name: string;
  url: string;
  defaultBranch: string;
  visibility: "public" | "private";
}

export interface GitBranch {
  name: string;
  commitSha: string;
  protected: boolean;
}

export interface GitCommitResult {
  sha: string;
  branch: string;
}

export interface GitFileChange {
  path: string;
  content: string;
}

export interface GitPullRequest {
  id: string;
  number: number;
  url: string;
  sourceBranch: string;
  targetBranch: string;
  state: "open" | "merged" | "closed";
}

export interface CreateRepoInput {
  name: string;
  visibility: "public" | "private";
  namespace?: string;
  accessToken?: string;
}

export interface GetRepoInput {
  externalId: string;
  accessToken?: string;
}

export interface CreateBranchInput {
  externalId: string;
  branchName: string;
  fromRef: string;
  accessToken?: string;
}

export interface ProtectBranchInput {
  externalId: string;
  branchName: string;
  accessToken?: string;
}

export interface CommitFilesInput {
  externalId: string;
  branch: string;
  message: string;
  files: GitFileChange[];
  accessToken?: string;
}

export interface ListBranchesInput {
  externalId: string;
  accessToken?: string;
}

export interface OpenPullRequestInput {
  externalId: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  body?: string;
  accessToken?: string;
}

export interface MergePullRequestInput {
  externalId: string;
  pullRequestId: string;
  accessToken?: string;
}

export interface GitProviderContract {
  readonly name: GitProviderName;
  readonly capabilities: GitProviderCapabilities;
  createRepo(input: CreateRepoInput): Promise<GitRepo>;
  getRepo(input: GetRepoInput): Promise<GitRepo>;
  createBranch(input: CreateBranchInput): Promise<GitBranch>;
  protectBranch(input: ProtectBranchInput): Promise<void>;
  commitFiles(input: CommitFilesInput): Promise<GitCommitResult>;
  listBranches(input: ListBranchesInput): Promise<GitBranch[]>;
  openPullRequest(input: OpenPullRequestInput): Promise<GitPullRequest>;
  mergePullRequest(input: MergePullRequestInput): Promise<GitPullRequest>;
}

// --- Credenciais de git do usuário (Fase 2, sessão 2) ---
//
// Só github/gitlab têm token de usuário (PAT) — 'local' não precisa de
// credencial nenhuma. Ver docs/adr/0004-git-credential-registration.md.

export type GitCredentialProviderName = Extract<GitProviderName, "github" | "gitlab">;

// user_credentials guarda tanto chaves de LLM quanto tokens de git do
// usuário, sob o mesmo mecanismo de envelope encryption — ver
// docs/adr/0004-git-credential-registration.md.
export type CredentialProviderName = LLMProviderName | GitCredentialProviderName;
