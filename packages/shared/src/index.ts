export type ServiceName = "api" | "engine";

export interface HealthStatus {
  service: ServiceName;
  status: "ok" | "error";
  timestamp: string;
  details?: Record<string, unknown>;
}

// --- LLM ---

/**
 * `packages/shared` é 100% TIPO — nada aqui pode sobreviver ao `tsc`.
 *
 * O `main` do pacote aponta pro `.ts` cru, e a imagem de produção da api roda
 * o compilado com `node main.js`: um `export const` daqui vira um `require`
 * de verdade em runtime, e o Node morre com
 * `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` ao achar um `.ts` dentro de
 * `node_modules` — o container não sobe. O `Dockerfile.prod` da api conta com
 * este invariante ("por isso ele NÃO aparece no estágio final"), e
 * `packages-shared-so-tipos.spec.ts` na api o mantém honesto.
 *
 * Precisa da LISTA em runtime? Ela mora no consumidor —
 * `apps/api/src/domain/llm/llm-provider-names.ts` guarda a da api, amarrada a
 * este tipo por checagem de exaustividade nos dois sentidos.
 */
export type LLMProviderName =
  | "ollama"
  | "anthropic"
  | "openai"
  | "openrouter"
  | "nvidia-nim"
  | "together"
  | "deepinfra"
  | "bitdeer"
  | "vultr";

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
/**
 * Para que um workspace usa um modelo — a curadoria por uso (ADR 0051).
 *
 * Vocabulário FECHADO: texto livre daria `code`, `coding` e `código` no mesmo
 * filtro em uma semana. Vive aqui, e não só na api, porque a tela de curadoria
 * precisa do mesmo vocabulário — as listas em runtime ficam de cada lado
 * (`domain/llm/model-uses.ts` e `web/src/lib/models.ts`), pela mesma razão de
 * `LLMProviderName`: este pacote é 100% tipo.
 *
 * NÃO é capability: nenhum catálogo de provider publica "bom para código", e
 * declarar isso como capability seria palpite vestido de dado (ADR 0041).
 */
export type UsoDeModelo =
  | "codigo"
  | "documentacao"
  | "analise"
  | "imagem"
  | "conversa";

export interface ModeloDoCatalogo {
  readonly name: string;
  readonly displayName?: string;
  readonly contextLength?: number;
  readonly supportsToolCalling?: boolean;
  /**
   * Aceita IMAGEM na entrada. Campo opcional porque quase nenhum provider
   * publica isso: quem não declara não vira `false` no catálogo — vira
   * "não sabemos", e o sync preserva o que já estava lá (ADR 0041).
   */
  readonly supportsVision?: boolean;
  /** Aceita raciocínio explícito (`reasoning`/thinking) como parâmetro. */
  readonly supportsReasoning?: boolean;
  /** PRODUZ imagem — eixo diferente de aceitar imagem na entrada. */
  readonly generatesImage?: boolean;
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
// acrescentada na sessão do bootstrap de Gitflow). A 10ª (`commentOnPull
// Request`) veio com os gates da Fase 4a; a 11ª e a 12ª (`listTree` e
// `getPullRequestDiff`) com a aba Code da FASE 26. A 13ª, 14ª e 15ª
// (`blame`, `listPullRequests` e `listBranchesDetailed`) vieram da FASE 26b —
// a FUNDAÇÃO das três pendências declaradas da aba Code (blame, dropdown de
// branch rico e lista de PRs), entregue só nesta camada: a UI é onda
// seguinte, em três agentes separados.

export interface GitProviderCapabilities {
  readonly protectBranch: boolean;
  readonly pullRequests: boolean;
  /** `listTree` — a 11ª operação (aba Code, FASE 26). */
  readonly listTree: boolean;
  /** `getPullRequestDiff` — a 12ª operação (aba Code, FASE 26). */
  readonly pullRequestDiff: boolean;
  /** `blame` — a 13ª operação (aba Code, FASE 26b). */
  readonly blame: boolean;
  /** `listPullRequests` — a 14ª operação (aba Code, FASE 26b). */
  readonly pullRequestsList: boolean;
  /** `listBranchesDetailed` — a 15ª operação (aba Code, FASE 26b). */
  readonly branchesDetailed: boolean;
}

// Os TETOS das duas operações de leitura (FASE 26 item 34: "buscar em
// repositório grande GASTA") não moram aqui: `packages/shared` é 100% tipo,
// e um `export const` sobrevive ao `tsc` e quebra o boot da api em produção
// (ver apps/api/test/packages-shared-so-tipos.spec.ts). Eles ficam no
// consumidor, em apps/api/src/domain/git/git-read-limits.ts — o mesmo
// caminho que `llm-provider-names.ts` já seguia. Quem cortou avisa por
// `truncated`, que É parte do contrato.

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

/**
 * PR/MR aberta associada a uma branch, como a 15ª operação a enxerga — sem
 * título nem autor, que já vêm inteiros de `listPullRequests` quando quem
 * navega precisa deles. Aqui é só o suficiente pra um badge na branch.
 */
export interface GitBranchPullRequestRef {
  number: number;
  state: "open" | "merged" | "closed";
}

/**
 * Uma branch com o que o dropdown rico da aba Code precisa além do que
 * `GitBranch` já tem (FASE 26b, item 2 — `listBranchesDetailed`, a 15ª
 * operação).
 *
 * NÃO estende `GitBranch` por acidente de shape: é decisão. `ahead`/`behind`
 * e `pullRequest` custam uma chamada extra ao provider POR BRANCH (duas no
 * GitLab, que não tem um endpoint que devolva os dois lados de uma vez como
 * o GitHub) — encostar esse custo em `listBranches`, que o bootstrap chama
 * sem precisar de nada disso, transformaria toda adoção/criação de branch
 * numa varredura cara. As duas operações convivem no contrato: `listBranches`
 * pro bootstrap, `listBranchesDetailed` pra aba Code.
 */
export interface GitBranchDetail extends GitBranch {
  /**
   * Commits à frente da branch DEFAULT do repositório. `null` só quando o
   * provider não consegue computar (nunca para as branches que o contrato
   * promete — é degradação honesta, não o caso comum).
   */
  ahead: number | null;
  /** Commits atrás da branch default. */
  behind: number | null;
  /** PR aberta com esta branch como ORIGEM, se houver. `null` sem uma. */
  pullRequest: GitBranchPullRequestRef | null;
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

/**
 * Resumo de UMA PR/MR, o suficiente para popular uma lista clicável que leva
 * ao diff já existente por id (`getPullRequestDiff`) — 14ª operação
 * (`listPullRequests`, FASE 26b, item 3: a lista navegável que faltava).
 *
 * Não é `GitPullRequest` com campos a mais: título e autor não existem lá
 * porque abrir/mesclar PR nunca precisou deles. Um tipo próprio evita que a
 * escrita ganhe campos que só a leitura usa.
 */
export interface GitPullRequestSummary {
  id: string;
  number: number;
  title: string;
  url: string;
  /** Login/username de quem abriu. `null` quando o provider não informa. */
  author: string | null;
  state: "open" | "merged" | "closed";
  sourceBranch: string;
  targetBranch: string;
  /** ISO 8601. `null` quando o provider não informa. */
  updatedAt: string | null;
}

export interface GitPullRequestList {
  items: GitPullRequestSummary[];
  /** `true` quando a lista foi cortada no teto de PRs por chamada. */
  truncated: boolean;
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

// --- Árvore e diff (FASE 26 — aba Code, só leitura) ---

/**
 * Uma entrada de UM nível da árvore. `listTree` é deliberadamente NÃO
 * recursivo: a aba Code navega sob demanda, e pedir a árvore inteira de um
 * repositório grande é exatamente o amplificador de tráfego que a fase
 * proíbe. Quem quiser o conteúdo de um arquivo chama `getFileContent`.
 */
export interface GitTreeEntry {
  /** Caminho completo a partir da raiz do repositório. */
  path: string;
  /** Último segmento de `path` — o que a árvore mostra. */
  name: string;
  type: "file" | "dir";
  /** Bytes; `null` para diretório e quando o provider não informa. */
  size: number | null;
}

export interface GitTree {
  ref: string;
  /** Diretório listado; `""` é a raiz. */
  path: string;
  entries: GitTreeEntry[];
  /** `true` quando a listagem foi cortada em `GIT_TREE_ENTRY_LIMIT`. */
  truncated: boolean;
}

export interface ListTreeInput {
  externalId: string;
  /** Branch, tag ou sha. */
  ref: string;
  /** Diretório a listar; ausente ou `""` é a raiz. */
  path?: string;
  accessToken?: string;
}

export type GitDiffFileStatus = "added" | "modified" | "removed" | "renamed";

export interface GitPullRequestDiffFile {
  /** Caminho DEPOIS da mudança (para `removed`, o caminho que sumiu). */
  path: string;
  /** Caminho anterior; só preenchido quando `status` é `renamed`. */
  previousPath: string | null;
  status: GitDiffFileStatus;
  additions: number;
  deletions: number;
  /**
   * Diff unificado do arquivo. `null` quando o provider não o entrega —
   * arquivo binário, ou patch grande demais para a resposta. Distinguir
   * `null` (não veio) de `""` (veio vazio) é o que impede a tela de dizer
   * "sem mudanças" para um binário alterado.
   */
  patch: string | null;
}

export interface GitPullRequestDiff {
  pullRequestId: string;
  files: GitPullRequestDiffFile[];
  /** `true` quando a lista foi cortada em `GIT_DIFF_FILE_LIMIT`. */
  truncated: boolean;
}

export interface GetPullRequestDiffInput {
  externalId: string;
  pullRequestId: string;
  accessToken?: string;
}

// --- Blame, PRs navegáveis e branch rica (FASE 26b — aba Code, fundação) ---
//
// A UI das três pendências declaradas da FASE 26 é a onda SEGUINTE, em três
// agentes separados sem risco de colisão — esta sessão entrega só o que eles
// vão consumir: os tipos, os providers, o caso de uso e a rota HTTP.

/** UMA linha anotada de um arquivo, na ordem em que aparece nele. */
export interface GitBlameLine {
  /** 1-based, como toda linha de editor. */
  line: number;
  commitSha: string;
  /** Nome de quem autorou o commit — não login/username, que nem todo provider dá por linha. */
  author: string;
  /** ISO 8601. */
  authorDate: string;
  /** Primeira linha da mensagem do commit — contexto pro hover, sem o corpo inteiro. */
  summary: string;
}

export interface GitBlame {
  ref: string;
  path: string;
  lines: GitBlameLine[];
  /** `true` quando o arquivo passou do teto de linhas anotadas. */
  truncated: boolean;
}

export interface BlameInput {
  externalId: string;
  /** Branch, tag ou sha. */
  ref: string;
  path: string;
  accessToken?: string;
}

export interface ListPullRequestsInput {
  externalId: string;
  /** Ausente lista todos os estados. */
  state?: "open" | "merged" | "closed";
  accessToken?: string;
}

export interface ListBranchesDetailedInput {
  externalId: string;
  /**
   * Branch DEFAULT do repositório — referência para `ahead`/`behind` de cada
   * entrada. Quem chama já sabe (é o mesmo `GitRepo.defaultBranch`), e pedir
   * de novo ao provider seria uma chamada a mais só pra redescobrir o que o
   * chamador já tinha.
   */
  defaultBranch: string;
  accessToken?: string;
}

export interface GitBranchDetailList {
  items: GitBranchDetail[];
  /** `true` quando a lista foi cortada no teto de branches enriquecidas. */
  truncated: boolean;
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
  /**
   * 11ª operação (FASE 26 — aba Code): UM nível da árvore em `ref`.
   *
   * `null` quando não há árvore ali — ref inexistente, caminho inexistente,
   * ou caminho que resolve para um ARQUIVO. É o mesmo contrato de ausência
   * de `getFileContent`, deliberadamente: as duas são leituras da aba Code e
   * dois vocabulários de "não existe" fariam a tela tratar o mesmo caso de
   * duas formas.
   *
   * Rejeita com `GitNotSupportedError` quando `capabilities.listTree` é
   * `false`.
   */
  listTree(input: ListTreeInput): Promise<GitTree | null>;
  /**
   * 12ª operação (FASE 26 — aba Code): o diff de uma PR, normalizado.
   *
   * `null` quando a PR não existe. Rejeita com `GitNotSupportedError`
   * quando `capabilities.pullRequestDiff` é `false`.
   */
  getPullRequestDiff(
    input: GetPullRequestDiffInput,
  ): Promise<GitPullRequestDiff | null>;
  /**
   * 13ª operação (FASE 26b — aba Code): anota cada linha de um arquivo com o
   * commit que a tocou por último.
   *
   * `null` quando o arquivo não existe naquela ref (mesmo vocabulário de
   * `getFileContent`/`listTree`). Rejeita com `GitNotSupportedError` quando
   * `capabilities.blame` é `false`.
   */
  blame(input: BlameInput): Promise<GitBlame | null>;
  /**
   * 14ª operação (FASE 26b — aba Code): lista de PRs/MRs do repositório, o
   * suficiente pra popular uma lista clicável — o diff de cada uma continua
   * vindo de `getPullRequestDiff`, por id.
   *
   * Rejeita com `GitNotSupportedError` quando `capabilities.pullRequestsList`
   * é `false`.
   */
  listPullRequests(input: ListPullRequestsInput): Promise<GitPullRequestList>;
  /**
   * 15ª operação (FASE 26b — aba Code): branches com `ahead`/`behind` contra
   * a default e a PR aberta associada, quando houver — o dropdown rico que
   * `listBranches` (bootstrap) nunca precisou ser.
   *
   * Rejeita com `GitNotSupportedError` quando `capabilities.branchesDetailed`
   * é `false`.
   */
  listBranchesDetailed(
    input: ListBranchesDetailedInput,
  ): Promise<GitBranchDetailList>;
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
