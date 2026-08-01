export type ServiceName = "api" | "engine";

export interface HealthStatus {
  service: ServiceName;
  status: "ok" | "error";
  timestamp: string;
  details?: Record<string, unknown>;
}

// --- LLM ---

export const LLM_PROVIDER_NAMES = ["ollama", "anthropic", "openai"] as const;

export type LLMProviderName = (typeof LLM_PROVIDER_NAMES)[number];

/**
 * Taxonomia normalizada de falha de provider (Fase 9a — ADR 0041). Espelha o
 * que o lado git fez no ADR 0002: quem consome um erro de LLM decide pelo
 * `code`, nunca por substring da mensagem do vendor — que muda sem aviso e é
 * diferente em cada um dos providers.
 */
export type LLMErrorCode =
  /** Chave ausente, inválida ou sem permissão pro modelo (401/403). */
  | "auth"
  /** Cota ou throughput estourado (429). */
  | "rate_limit"
  /** O modelo pedido não existe nesse provider (404). */
  | "model_not_found"
  /** O prompt não cabe na janela do modelo (413, ou 400 com o marcador). */
  | "context_length"
  /** O provider ficou MUDO além do teto de inatividade. */
  | "timeout"
  /** Nem chegou a falar com o provider (DNS, recusa de conexão, TLS). */
  | "connection"
  /** Falhou do lado de lá por motivo que não se encaixa nos anteriores. */
  | "upstream";

/**
 * O que o provider sabe fazer, independente do modelo escolhido — o TETO.
 * Um modelo pode ser mais pobre que o provider (ver as colunas
 * `supports_*` de `models`), nunca mais rico.
 */
export interface LLMProviderCapabilities {
  readonly streaming: boolean;
  readonly toolCalling: boolean;
  /**
   * O provider sabe LISTAR o próprio catálogo (Fase 9c). Quem não sabe não
   * expõe `listModels` — o sync pula em vez de chamar e tratar o 404, do mesmo
   * jeito que o contrato de git provider degrada por capability desde a Fase 2.
   */
  readonly listModels: boolean;
}

/**
 * Uma linha do catálogo REMOTO do provider (Fase 9c).
 *
 * Só `name` é obrigatório: cada catálogo informa um subconjunto diferente — o
 * `/v1/models` da OpenAI devolve praticamente só o id, enquanto um hub devolve
 * preço e janela junto. Campo ausente significa "o provider não disse", nunca
 * "o valor é zero", e por isso o sync não sobrescreve o que já está gravado.
 */
export interface ModeloDoCatalogo {
  readonly name: string;
  readonly displayName?: string;
  readonly contextLength?: number;
  readonly supportsToolCalling?: boolean;
  readonly inputPricePerMillionMicros?: number;
  readonly outputPricePerMillionMicros?: number;
  /** Só um hub preenche: quem de fato serve o modelo por baixo. */
  readonly upstreamProvider?: string;
}

export type ModelCategory = "local" | "cloud";

export type ChatRole = "user" | "assistant" | "system" | "tool";

// Tool call que o modelo pediu (Fase 3a — ToolLoop). `arguments` já
// desserializado; o engine despacha para a ferramenta registrada por `name`.
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// Definição de uma ferramenta oferecida ao modelo. `parameters` é um JSON
// Schema (o Ollama repassa isso no campo `tools`).
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Só em mensagens `assistant` que pediram ferramentas. */
  toolCalls?: ToolCall[];
  /** Só em mensagens `tool` (resultado): a qual tool call responde. */
  toolCallId?: string;
  /** Nome da ferramenta em mensagens `tool`. */
  name?: string;
}

export interface ChatOptions {
  model: string;
  maxTokens?: number;
  /** Credencial decriptada — nunca persistida/logada por quem consome isto. */
  apiKey?: string;
  /** Override do host do Ollama (senão usa OLLAMA_HOST/default do provider). */
  host?: string;
  /** Ferramentas oferecidas ao modelo (tool calling). */
  tools?: ToolDef[];
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
  /**
   * Quem REALMENTE serviu a chamada, quando o provider é um hub e informa isso
   * (Fase 9b). Num hub, "openrouter" é a porta de entrada, não o custo real —
   * sem este campo o metering não distingue qual provedor subjacente atendeu.
   * `undefined` quando o provider não é hub ou não informou.
   */
  upstreamProvider?: string;
}

export interface ChatErrorChunk {
  type: "error";
  message: string;
  /**
   * Obrigatório de propósito: com campo opcional, um provider novo esquece de
   * classificar e o erro dele volta a ser string opaca sem ninguém perceber.
   */
  code: LLMErrorCode;
}

// Ferramentas pedidas pelo modelo — no Ollama vêm na mensagem final (não
// streamado), então é um chunk único, não incremental.
export interface ChatToolCallsChunk {
  type: "tool_calls";
  toolCalls: ToolCall[];
}

export type ChatStreamChunk =
  | ChatTextDeltaChunk
  | ChatUsageChunk
  | ChatErrorChunk
  | ChatToolCallsChunk;

// --- Git ---

export type GitProviderName = "local" | "github" | "gitlab";

// --- Git Provider Contract (Fase 2) ---
//
// Contrato normalizado, independente de provider — nenhum tipo aqui pode
// vazar o shape de Octokit/Gitbeaker. Os 3 providers (Local/Github/Gitlab)
// implementam o contrato por completo — ver docs/adr/0001 (histórico da
// decisão de shape) e docs/adr/0005 (a 9ª operação, `getFileContent`,
// acrescentada na sessão do bootstrap de Gitflow).

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

export interface CommentOnPullRequestInput {
  externalId: string;
  pullRequestId: string;
  body: string;
  accessToken?: string;
}

export interface GetFileContentInput {
  externalId: string;
  branch: string;
  path: string;
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
  /** `null` se o arquivo não existe naquela branch (ou a branch não existe). */
  getFileContent(input: GetFileContentInput): Promise<string | null>;
  // 10ª operação (Fase 4a — gates de PR): comenta o parecer de QA/SecOps na
  // PR. Respeita `capabilities.pullRequests` como as demais operações de PR.
  commentOnPullRequest(input: CommentOnPullRequestInput): Promise<void>;
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
