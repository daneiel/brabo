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
  // Circuit breaker por dev agent (Fase 12b — RN-047). `null` usa o default
  // do domínio (3).
  maxConsecutiveBlocked: number | null;
  // Quem promove história a `ready` (Fase 12c — RN-048). `manual` é o default
  // de projeto novo; os projetos que existiam antes da fase ficaram em `auto`,
  // que é o comportamento anterior.
  storyPromotion: StoryPromotionMode;
  // ONDE o comando executa (RN-169/RN-421 — ADR 0072/0104). `container`: a
  // pasta gerenciada pelo produto, que é o default e o comportamento de
  // sempre. `mounted`: a pasta do usuário em `workspacePath`, montada por
  // bind-mount. `runner`: a pasta do usuário confirmada por um runner
  // conectado (ver `workspaceVerifiedAt`).
  executionMode: ExecutionMode;
  // Caminho absoluto da pasta do usuário; `null` no modo `container`.
  workspacePath: string | null;
  // Quando o runner confirmou o caminho pela primeira vez (RN-423). `null` =
  // não verificado — só ganha sentido em `executionMode: 'runner'`.
  workspaceVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StoryPromotionMode = 'manual' | 'auto';

/**
 * ONDE o comando de um projeto EXECUTA (RN-169/RN-421 — ADR 0072/0104).
 * Espelha o enum `project_execution_mode` da api.
 *
 * `container` é a pasta gerenciada pelo produto em PROJECT_WORKSPACES_ROOT —
 * o default e o comportamento de sempre. `mounted` (antigo `local`) é uma
 * pasta do usuário que só funciona montada dentro dos containers da api e do
 * engine. `runner` é uma pasta do usuário sem bind-mount, confirmada por um
 * CLI (`brabo-runner`) rodando na máquina dela.
 *
 * Cuidado com o homônimo: nenhum destes valores tem relação com o
 * `GitProviderName` `'local'`, que fala de onde o REPOSITÓRIO vive.
 */
export type ExecutionMode = 'container' | 'mounted' | 'runner';

/** Uma área de agente e seu teto de paralelismo (FASE 14d, ADR 0053). */
export interface AgentArea {
  id: string;
  projectId: string;
  key: string;
  leadAgentId: string;
  /** Quantos agentes o lead sobe na SESSÃO sem pedir autorização. */
  maxParallel: number;
  members: string[];
}

/**
 * O desfecho de um pedido de paralelismo (RN-083).
 *
 * `estado` é o discriminador — não infira pela presença do `actionId`. Em
 * `aguardando_autorizacao` NADA subiu: existe uma ação esperando você.
 */
export interface ParallelizationRequest {
  estado: 'executado' | 'aguardando_autorizacao' | 'recusado';
  actionId?: string;
  ativosNaSessao?: number;
  maxParallel?: number;
  motivo?: string;
}

/**
 * O resultado de um lote de promoção (Fase 12c — RN-048). NÃO é
 * all-or-nothing: `failed` pode vir preenchido numa resposta de sucesso.
 */
export interface PromoteStoriesResult {
  promoted: string[];
  failed: { storyId: string; reason: string }[];
}

export interface WorkspaceSummary {
  activeProjects: number;
  agentCount: number;
  spentMicros: number;
}

export interface ProjectBlockedStatus {
  projectId: string;
  blockedTaskCount: number;
}

/**
 * Tudo que UM card do dashboard desenha, vindo do resumo do workspace
 * (RN-090) — a grade inteira numa requisição em vez de sete por card.
 *
 * `roster` são FATOS, não a roster montada: quem é lead, que ícone cada
 * agente tem e como os membros viram um chip continua sendo decisão do web
 * (`lib/agents.ts` + `rosterFromFacts` em `lib/agent-status.ts`).
 */
export interface ProjectCardSummary {
  projectId: string;
  provider: GitProviderName;
  provisioningStatus: ProvisioningStatus | null;
  budget: { limitMicros: number; spentMicros: number } | null;
  latestSessionId: string | null;
  latestSeq: number;
  lastEvent: SessionEvent | null;
  storiesAwaitingPromotion: number;
  /**
   * `proposed_actions` pendentes no projeto INTEIRO, todas as sessões
   * (RN-151) — o que a sidebar mostra como badge do projeto.
   */
  pendingApprovalsCount: number;
  /**
   * Agentes ONLINE agora — trabalhando ou com pendência esperando decisão
   * (RN-409). Nunca tamanho de equipe/presença histórica.
   */
  onlineAgentCount: number;
  roster: {
    executionActivated: boolean;
    moduleNames: string[];
    gatesEverOpened: boolean;
    delegatedSubagents: string[];
    infraActive: boolean;
    /** ADR 0087 — mesmo critério de `infraActive`. */
    uxDesignerActive: boolean;
    /** Staff (docs/fluxo.yml, ADR 0088) — mesmo critério de `infraActive`. */
    staffActive: boolean;
  };
}

/**
 * Onde a leitura de um projeto parou, do ponto de vista DESTE navegador —
 * o que a gaveta do sino manda no corpo para receber os não lidos de todos os
 * projetos numa chamada (RN-091).
 */
export interface UnreadCursor {
  projectId: string;
  afterSeq: number;
}

export interface ProjectUnreadEvents {
  projectId: string;
  sessionId: string;
  events: SessionEvent[];
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

/**
 * Curinga de `agent_autonomy.action_type` — "auto mode" (RN-153): autonomia
 * pra QUALQUER tipo de ação do agente, não um tipo específico. NÃO é um
 * `ActionType` (não é avaliado por `decide()`; é resolvido antes, no
 * repositório) — por isso fica fora da união e não entra em
 * `aprovacoes.test.ts`, que lê só `ACTION_TYPES` do backend.
 */
export const AGENT_AUTONOMY_ALL_ACTIONS = '*' as const;
export type AgentAutonomyActionType = ActionType | typeof AGENT_AUTONOMY_ALL_ACTIONS;

export interface AgentAutonomyRule {
  agentId: string;
  actionType: AgentAutonomyActionType;
  mode: PermissionPolicy;
}

export type SessionStatus =
  | 'created'
  | 'active'
  | 'closing'
  | 'closed'
  | 'closed_abnormally';

/**
 * A INTENÇÃO com que a sessão foi aberta (FASE 20, RN-097).
 *
 * `consultiva` é só conversa. `criativa` é a que produz: abre a ideação com o
 * Criativo e é a única que entra em execução. É escolhida na criação e não
 * muda — não confundir com o ESTADO de execução, que continua sendo o evento
 * `execution.activated` no log.
 */
export type SessionKind = 'consultiva' | 'criativa';

/**
 * Escopo do ticket opaco de uso único que autentica `connect/3` do socket
 * Phoenix da sessão (RN-108). Hoje o web só pede `heartbeat` — `terminal` é
 * FASE 25 (terminal interativo), mas o valor já existe no backend.
 */
export type SocketTicketScope = 'heartbeat' | 'terminal';

export interface SocketTicket {
  ticket: string;
  /** ISO 8601. TTL de 30s — reconexão sem buscar um ticket novo vai falhar. */
  expiresAt: string;
}

/**
 * Ticket do canal `terminal:<projectId>` (runner local + PTY interativo,
 * frente paralela em engine/api). Formato PRÓPRIO, diferente de
 * `SocketTicket`: não é escopado a uma sessão, e `engineWsUrl` viaja no
 * corpo em vez de derivado de `runtimeConfig` — o canal conecta num socket
 * NOVO (`/runner`, distinto de `/socket`), então o cliente não presume a
 * URL, usa a que o servidor devolveu.
 */
export interface TerminalTicket {
  ticket: string;
  engineWsUrl: string;
}

export interface Session {
  id: string;
  projectId: string;
  createdBy: string;
  status: SessionStatus;
  kind: SessionKind;
  /** Nome amigável (RN-098), ou `null`. Nunca substitui a hashtag do id. */
  name: string | null;
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

// Os 15 do backend (`apps/api/src/domain/actions/decide.ts`), na mesma ordem.
//
// Esta união já foi um subconjunto — só os que a UI renderiza de forma
// dedicada —, com a nota de que "os demais caem no fallback genérico do
// ApprovalCard". Esse fallback não existia: o `ACTION_ICON[actionType]` do
// ApprovalCard devolvia `undefined` e derrubava a tela inteira da sessão.
// Como o bootstrap de Gitflow propõe `git_repo_create`, `git_branch_create` e
// `git_branch_protect`, TODO projeto criado num provider ficava com a sessão
// impossível de abrir — e o tipo estreito impedia o compilador de ver isso.
//
// Com a união completa os mapas do ApprovalCard voltam a ser exaustivos, e é o
// compilador que cobra a entrada de qualquer tipo novo.
//
// E a união VOLTOU a ficar defasada: `parallelize` e `raise_max_parallel`
// entraram no backend com a FASE 14d e ninguém as trouxe para cá, porque o
// compilador só cobra o que ele consegue ver — a lista do backend é um arquivo
// que o web não importa. Por isso o teste da FASE 19
// (`aprovacoes.test.ts`) lê `ACTION_TYPES` do decide.ts e reprova quando os
// dois lados divergem, em vez de confiar numa lista escrita à mão.
export type ActionType =
  | 'terminal'
  | 'git_commit'
  | 'git_push'
  | 'pr_open'
  | 'spend'
  | 'git_repo_create'
  | 'git_branch_create'
  | 'git_branch_protect'
  | 'write_file'
  | 'open_adr_pr'
  | 'git_merge'
  | 'open_infra_pr'
  | 'instruction_patch'
  | 'parallelize'
  | 'raise_max_parallel'
  | 'propose_execution_plan'
  | 'assess_implementability';

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

/**
 * Para que o workspace usa um modelo (ADR 0051) — curadoria, não capability.
 * Espelha `UsoDeModelo` do domínio da api, como o resto deste arquivo espelha
 * as entidades reais; o rótulo humano de cada um vive em `lib/models.ts`, num
 * `Record` exaustivo que quebra o build se um uso novo ficar sem tradução.
 */
export type UsoDeModelo =
  | 'codigo'
  | 'documentacao'
  | 'analise'
  | 'imagem'
  | 'conversa';

export type LLMProviderName =
  | 'ollama'
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'nvidia-nim'
  | 'together'
  | 'deepinfra'
  | 'bitdeer'
  | 'vultr';
export type ModelCategory = 'local' | 'cloud';

/** Realidade REMOTA observada pelo sync de catálogo (Fase 9c). */
export type ModelAvailability = 'available' | 'unavailable';

export interface Model {
  id: string;
  provider: LLMProviderName;
  name: string;
  displayName: string;
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
  contextWindow: number | null;
  /**
   * Capabilities DO MODELO (Fase 9a). Sem `supportsToolCalling` o modelo é
   * chat-only e não pode ser vinculado a um agente (RN-040).
   */
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  /**
   * As facetas de modalidade e raciocínio. `false` aqui quer dizer "o provider
   * não declarou" — não "o modelo não faz" (ADR 0041). É por isso que a tela as
   * usa como filtro POSITIVO e nunca escreve "não lê imagem".
   */
  supportsVision: boolean;
  supportsReasoning: boolean;
  generatesImage: boolean;
  /** Preço digitado da doc do provider, não sincronizado (Fase 9b). */
  manualPricing: boolean;
  /**
   * Eixo INDEPENDENTE da curadoria: um modelo pode estar ativo num workspace
   * e indisponível no provider ao mesmo tempo. `unavailable` nunca é deletado
   * — bindings e histórico de custo apontam para ele.
   */
  availability: ModelAvailability;
  lastSeenAt: string | null;
}

/**
 * O modelo COM a curadoria de um workspace (ADR 0049). `isActive` não é
 * atributo do modelo: é a decisão de um workspace sobre ele, e o mesmo modelo
 * sai ligado aqui e desligado no vizinho. Só a tela de curadoria recebe isto
 * — o seletor recebe `Model`, porque a lista dele já É a dos ativos.
 */
export interface ModelComCuradoria extends Model {
  isActive: boolean;
  /**
   * Para que ESTE workspace usa o modelo (ADR 0051). Eixo independente de
   * `isActive`: marcar uso não liga o modelo no seletor. Lista vazia é
   * "ninguém opinou", não "não serve".
   */
  uses: UsoDeModelo[];
}

export type ModelsByCategory = Record<ModelCategory, Record<string, Model[]>>;
export type CatalogoPorCategoria = Record<
  ModelCategory,
  Record<string, ModelComCuradoria[]>
>;

/** Uma mudança de preço, append-only (Fase 9c, RN-044). */
export interface ModelPriceChange {
  id: string;
  modelId: string;
  inputBeforeMicros: number;
  inputAfterMicros: number;
  outputBeforeMicros: number;
  outputAfterMicros: number;
  source: 'manual' | 'sync';
  /** `null` quando veio do sync — não há pessoa por trás. */
  changedBy: string | null;
  createdAt: string;
}

/** O relatório do sync, um item por provider — nenhum some da lista. */
export interface ResultadoDoSync {
  provider: LLMProviderName;
  descobertos: number;
  reencontrados: number;
  indisponibilizados: number;
  pulado?: 'sem_capability' | 'sem_credencial' | 'falha';
  /** Vocabulário de origem do ADR 0020. Só com `pulado: 'falha'`. */
  origemDaFalha?: 'infra' | 'modelo';
  detalhe?: string;
}

export interface SyncModelCatalogResult {
  porProvider: ResultadoDoSync[];
}

// `area` entrou na FASE 23 (ADR 0064) entre `project` e `agent`: é o padrão
// que lead e subagentes de uma área compartilham, e o agente pode divergir.
export type ModelBindingScope =
  | 'workspace'
  | 'project'
  | 'area'
  | 'agent'
  | 'session';

export interface ModelBinding {
  id: string;
  scope: ModelBindingScope;
  scopeId: string;
  modelId: string;
}

export interface SkippedBinding {
  scope: ModelBindingScope;
  modelId: string;
  reason: 'unavailable' | 'sem_tool_calling';
}

export interface ResolvedBinding {
  modelId: string;
  origin: ModelBindingScope;
  /**
   * Escopos mais específicos que a cascata descartou antes de chegar em
   * `origin` (Fase 9c). Vazio no caminho normal; é o que permite a UI dizer
   * "o modelo do agente sumiu, caiu para o do projeto" em vez de trocar o
   * modelo em silêncio.
   */
  skipped: SkippedBinding[];
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

/**
 * O veredito de `POST /users/me/credentials/{provider}/test` (ADR 0050).
 *
 * `nao_suportado` é um estado de primeira classe, não um "não sei": os
 * providers sem endpoint de teste verificado (`ollama`, `anthropic`, `openai`)
 * caem aqui, e a tela precisa dizer isso em vez de exibir um "ok" que ninguém
 * verificou.
 */
export interface CredentialTestResult {
  resultado: 'ok' | 'recusado' | 'nao_suportado';
  motivo?: string;
}

/**
 * Personal Access Token do runner (`brb_…`, ADR 0105) — nunca carrega o
 * token bruto. Escopado a um projeto e a um usuário (o dono).
 */
export interface PersonalAccessTokenSummary {
  id: string;
  name: string;
  projectId: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** Só a resposta de EMISSÃO carrega o bruto — ela não se repete. */
export interface PersonalAccessTokenIssued extends PersonalAccessTokenSummary {
  token: string;
}

/**
 * Visão de `maintainer` (RN-427) — os mesmos campos, mais o DONO do token.
 * Só a rota `/personal-access-tokens/all` devolve isto.
 */
export interface PersonalAccessTokenAdminSummary extends PersonalAccessTokenSummary {
  userId: string;
  userEmail: string;
}

export type BudgetPolicy = 'block' | 'allow';

// Custo por AGENTE numa sessão (Fase 4a — painel do time). Espelha
// AgentTokenUsage do port da api.
export interface AgentTokenUsage {
  actorId: string;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
}

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

/** Criado pelo Brabo, ou adotado de fora (Fase 12a, RN-046). */
export type RepoOrigin = 'created' | 'adopted';

export interface ProvisionedRepository {
  id: string;
  projectId: string;
  provider: GitProviderName;
  externalId: string;
  url: string;
  defaultBranch: string;
  visibility: 'public' | 'private';
  origin: RepoOrigin;
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
  // Aposentado com o degrau `rc` (ADR 0030, achado #3): o bootstrap não o
  // executa mais, mas projetos bootstrapados antes têm eventos e cursor com
  // este valor, e a api continua podendo devolvê-lo. Ele não aparece na lista
  // de passos do painel (`lib/bootstrap.ts`), que mostra o que o bootstrap FAZ.
  | 'create_rc_branch'
  | 'protect_branches';

export type BootstrapStepStatus = 'pending' | 'running' | 'done' | 'failed';

export type ProvisioningStatus =
  | 'provisioning'
  | 'provisioned'
  | 'provision_failed'
  /** Repo adotado com plano gerado e ainda não decidido — nada roda. */
  | 'awaiting_plan_decision';

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

// --- Adoção de repositório existente (Fase 12a) — espelha
// apps/api/src/domain/git/repo-bootstrap.entity.ts ---

export interface BootstrapPlanStep {
  step: BootstrapStepName;
  actionType: string;
  payload: Record<string, unknown>;
}

export type BootstrapDiagnosticKind =
  | 'missing_branch'
  | 'unprotected_branch'
  | 'missing_file'
  | 'extra_branch'
  | 'capability_unsupported';

export interface BootstrapDiagnostic {
  kind: BootstrapDiagnosticKind;
  detail: Record<string, unknown>;
}

export interface BootstrapPlan {
  generatedAt: string;
  steps: BootstrapPlanStep[];
  diagnostics: BootstrapDiagnostic[];
}

export type BootstrapPlanDecision = 'approved' | 'as_is';

export interface BootstrapPlanEstado {
  plan: BootstrapPlan | null;
  decision: BootstrapPlanDecision | null;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface AdoptRepositoryResult {
  repository: ProvisionedRepository;
  plan: BootstrapPlan;
  alreadyAdopted: boolean;
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

// RN-162: o Criativo pode pedir VÁRIAS respostas de uma vez, num formulário,
// pela ferramenta `ask_structured_questions` — em vez de texto livre que o
// usuário teria que responder item por item. `type` decide o input
// renderizado; `options` só é usado quando `type` é `select`.
export type StructuredQuestionType = 'text' | 'textarea' | 'select';

export interface StructuredQuestion {
  id: string;
  label: string;
  type: StructuredQuestionType;
  options: string[];
  /**
   * RN-171 — a pergunta de lista aceita resposta FORA da lista. Só existe em
   * `select` (em `text`/`textarea` o campo já é texto livre), e o engine a
   * grava com default `true` (`ask_structured_questions.ex`): lista fechada é
   * declaração deliberada, não esquecimento.
   *
   * Opcional aqui, e não obrigatório, porque evento GRAVADO antes da RN-171
   * não tem a chave — e ausente vale `true` pelo mesmo motivo que no engine.
   */
  allowOther?: boolean;
}

// Payload do session_event `chat.structured_question`.
export interface StructuredQuestionPayload {
  questions: StructuredQuestion[];
}

// Payload do session_event `chat.structured_question_answered`.
export interface StructuredQuestionAnsweredPayload {
  questionSetId: string;
  answers: Record<string, string>;
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

// --- Psicólogo (Fase 4b) ---

export type HypothesisStatus = 'proposed' | 'accepted' | 'dismissed';

export interface HypothesisTerminationAnalysis {
  causa: string;
  estadoDaSessao: string;
  analise: string;
}

export interface PsychologistHypothesis {
  id: string;
  projectId: string;
  // Sessão ANALISADA — pode não ser a sessão aberta agora; é pra ela que
  // a navegação de evidência aponta.
  sessionId: string;
  analysisId: string;
  agenteAlvo: string;
  observacao: string;
  hipotese: string;
  sugestao: string;
  confiancaPercent: number;
  evidenceEventIds: string[];
  terminationAnalysis: HypothesisTerminationAnalysis | null;
  status: HypothesisStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PsychologistAnalysisTier = 'leve' | 'pesada';

/**
 * Uma análise current do Psicólogo, com o CUSTO real somado do metering.
 * É o que torna "custos distintos entre triagem leve e pesada" visível na
 * seção Insights — o custo é por sessão analisada (token_usage grava por
 * sessão + ator), então numa sessão reanalisada é o acumulado.
 */
export interface PsychologistAnalysis {
  id: string;
  projectId: string;
  sessionId: string;
  tier: PsychologistAnalysisTier;
  triggeredBy: 'auto' | 'manual';
  supersedes: string | null;
  superseded: boolean;
  supersededAt: string | null;
  eventCountAtAnalysis: number;
  costMicros: number;
  hypothesisCount: number;
  createdAt: string;
}

// --- Anamnese (Fase 4b) ---

export type ProficiencyLevel = 'iniciante' | 'intermediario' | 'avancado';

export interface ProficiencyProfile {
  id: string;
  projectId: string;
  userId: string;
  // Identidade humana de quem o perfil descreve — null quando a pessoa já não
  // é membro (o perfil sobrevive à remoção). A UI mostra e-mail, não UUID.
  userName: string | null;
  userEmail: string | null;
  competency: string;
  level: ProficiencyLevel;
  // "os porquês" do nível.
  rationale: string;
  evidenceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type DiffLineKind = 'add' | 'del' | 'ctx';

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  lineNo?: number;
}

export interface AgentInstructionVersion {
  id: string;
  version: number;
  content: string;
  createdBy: string | null;
  sourceActionId: string | null;
  // Hipótese do Psicólogo que originou — rastreabilidade
  // hipótese→patch→versão.
  sourceHypothesisId: string | null;
  note: string | null;
  createdAt: string;
  isCurrent: boolean;
  diff: { lines: DiffLine[]; additions: number; deletions: number };
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

// Desfecho de UMA delegação de área (Fase 8b QA, Fase 8c Infra — ADR 0038).
// Espelha `apps/api/src/domain/agents/delegation.entity.ts`. `taskId` é
// `null` pra áreas sem task de backlog por trás (Infra — a delegação é
// sobre a sessão).
export type DelegationStatus = 'completed' | 'failed' | 'dispensed';
export type FailureOrigin = 'infra' | 'modelo' | 'codigo' | 'politica';

export interface Delegation {
  id: string;
  projectId: string;
  sessionId: string;
  taskId: string | null;
  area: string;
  leadAgent: string;
  subagent: string;
  status: DelegationStatus;
  parecerArtifactId: string | null;
  failureOrigin: FailureOrigin | null;
  failureReason: string | null;
  justification: string | null;
  createdAt: string;
}

// Payload dos session_events `delegation.completed`/`.failed`/`.dispensed`
// (Fase 8b/8c) — o que `RecordDelegationUseCase` grava no log, narrado no
// feed e usado pra montar os sub-pareceres da timeline de PR (Fase 8d).
export interface DelegationEventPayload {
  delegationId: string;
  taskId: string | null;
  area: string;
  subagent: string;
  parecerArtifactId: string | null;
  failureOrigin: FailureOrigin | null;
  failureReason: string | null;
  justification: string | null;
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
  // Fase 12c (RN-048). Convive com `status: 'draft'` — é uma PROPOSTA, não um
  // estado: o PO terminou a história e ela aguarda a decisão do usuário.
  // Enquanto isso nenhuma tarefa dela é pegável.
  proposedReady: boolean;
  // O motivo da última recusa, e quando. Ficam gravados mesmo depois de o PO
  // recriar a história corrigida — a recusa é fato, não estado transitório.
  returnedReason: string | null;
  returnedAt: string | null;
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

// --- Diagrama C4 (Context + Container, modelo de Simon Brown) ---

export interface C4Ator {
  name: string;
  type: 'person' | 'external_system';
  description: string;
}

export interface C4Diagrama {
  systemName: string;
  systemDescription: string;
  actors: C4Ator[];
  /** Sintaxe Mermaid `C4Context` — o sistema e os atores externos. */
  contextDiagram: string;
  /** Sintaxe Mermaid `C4Container` — os módulos do module_map vigente e as dependências. */
  containerDiagram: string;
}

export interface EstadoDoC4Diagrama {
  status: 'sem_diagrama' | 'gerado';
  diagrama: C4Diagrama | null;
  version: number;
  eventId: string | null;
  createdAt: string | null;
}

export interface Architecture {
  moduleMap: ModuleMap | null;
  adrs: AdrRef[];
  pendencies: ArchitecturePendency[];
  c4Diagram: EstadoDoC4Diagrama;
}

// --- Execução (Fase 4a — dev agents) ---

export interface ExecutionActivation {
  sessionId: string;
  modules: string[];
}

/**
 * Gasto das chaves do owner (RN-060). Nunca traz segredo — só quanto cada
 * provider consumiu, separando o que saiu por AGENTE do que saiu por pessoa,
 * porque desde a RN-058 as duas coisas saem da MESMA chave.
 */
export interface CredentialSpendPorMes {
  mes: string;
  costMicros: number;
  chamadas: number;
}

export interface CredentialSpendPorProvider {
  provider: string;
  /** A credencial existe hoje. `false` é gasto de chave já removida. */
  temCredencial: boolean;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
  costMicrosAgentes: number;
  costMicrosPessoas: number;
  porMes: CredentialSpendPorMes[];
}

export interface CredentialSpend {
  workspaceId: string;
  ownerId: string;
  meses: number;
  totalMicros: number;
  porProvider: CredentialSpendPorProvider[];
}

/**
 * O registro de gates (ADR 0054), como a tela o consome — FASE 15b.
 *
 * Só os campos que a tela usa. O registro carrega mais (`evidencia`,
 * `verificacao`), e trazê-los para cá convidaria a tela a depender do que
 * serve à MEDIÇÃO, não a ela.
 */
export interface GateResumo {
  id: string;
  fluxo: string;
  dono: string;
  entrada: string[];
  entregavel: string | string[];
  aprovacaoHumana: boolean;
  severidade: string;
}

export interface RegistroDeGates {
  version: number;
  gates: GateResumo[];
}

// --- Container do projeto (FASE 25a) — espelha
// apps/api/src/domain/containers/project-container.ts +
// interfaces/http/containers/dto/containers.response.dto.ts ---

export type PosturaDeRede = 'none' | 'egress';

export interface RecursosDoContainer {
  cpus: number;
  memoryMb: number;
  pidsLimit: number;
}

export interface DecisaoDeImagem {
  image: string;
  rationale: string;
  network: PosturaDeRede;
  resources: RecursosDoContainer;
}

/**
 * `sem_decisao` é o portão da RN-105: enquanto o Arquiteto não decide a
 * imagem, o container do projeto não sobe e a aba Code não libera.
 */
export interface EstadoDoContainer {
  status: 'sem_decisao' | 'decidido';
  decisao: DecisaoDeImagem | null;
  version: number;
  eventId: string | null;
  decidedAt: string | null;
}

/**
 * O ciclo de vida do container (ADR 0081/0083, RN-243..248/RN-267) —
 * distinto de `EstadoDoContainer`, que é a DECISÃO de imagem. `null` é o
 * estado honesto de "nunca provisionado": nenhum orquestrador real
 * transiciona `project_containers` hoje.
 */
export type ContainerLifecycleStatus =
  | 'provisioning'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'removed';

export interface CicloDeVidaDoContainer {
  status: ContainerLifecycleStatus;
  imageVersion: number;
  resources: RecursosDoContainer;
  failureReason: string | null;
  createdAt: string;
  statusChangedAt: string;
}

// --- Aba Code, só leitura (FASE 26) — espelha
// apps/api/src/application/use-cases/git/read-project-code.use-case.ts +
// interfaces/http/git/dto/code.response.dto.ts ---

export interface CodeTreeEntry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  /** `null` para diretório e quando o provider não informa. */
  size: number | null;
}

export interface CodeTree {
  ref: string;
  /** Diretório listado; `''` é a raiz. */
  path: string;
  entries: CodeTreeEntry[];
  /** A listagem foi cortada no teto de entradas por nível. */
  truncated: boolean;
}

export interface CodeFile {
  ref: string;
  path: string;
  /** UTF-8. Binário não é servido por esta rota. */
  content: string;
  /** O arquivo passou do teto de bytes e `content` é o começo dele. */
  truncated: boolean;
  /** Bytes DEVOLVIDOS, não os do arquivo — o corte já aconteceu. */
  bytes: number;
}

export interface CodeSearchMatch {
  path: string;
  /** 1-based, como todo editor mostra. */
  line: number;
  text: string;
}

export interface CodeSearchResult {
  ref: string;
  path: string;
  query: string;
  matches: CodeSearchMatch[];
  /** Arquivos efetivamente abertos — o custo real da busca. */
  filesScanned: number;
  /** A varredura parou por orçamento antes de acabar a árvore. */
  truncated: boolean;
}

export type CodeDiffFileStatus = 'added' | 'modified' | 'removed' | 'renamed';

export interface CodeDiffFile {
  /** Caminho DEPOIS da mudança (para `removed`, o que sumiu). */
  path: string;
  /** Só preenchido quando `status` é `renamed`. */
  previousPath: string | null;
  status: CodeDiffFileStatus;
  additions: number;
  deletions: number;
  /**
   * `null` quando o provider não entrega o texto (binário, ou patch grande
   * demais) — distinto de `''`, que é "veio vazio". A tela nunca trata os
   * dois como a mesma coisa.
   */
  patch: string | null;
}

export interface CodeDiff {
  pullRequestId: string;
  files: CodeDiffFile[];
  /** A lista foi cortada no teto de arquivos por diff. */
  truncated: boolean;
}

// --- Fundação de blame, PRs navegáveis e branch rica (FASE 26b) ---
//
// API pronta, sem UI consumindo ainda — as três pendências declaradas da aba
// Code (ver CodeShell.tsx e CodeDiffPanel.tsx) viram tela na onda seguinte,
// em três agentes separados.

export interface CodeBlameLine {
  /** 1-based, como todo editor mostra. */
  line: number;
  commitSha: string;
  author: string;
  /** ISO 8601. */
  authorDate: string;
  /** Primeira linha da mensagem do commit. */
  summary: string;
}

export interface CodeBlame {
  ref: string;
  path: string;
  lines: CodeBlameLine[];
  /** O arquivo passou do teto de linhas anotadas por chamada. */
  truncated: boolean;
}

export type CodePullRequestState = 'open' | 'merged' | 'closed';

export interface CodePullRequestSummary {
  id: string;
  number: number;
  title: string;
  url: string;
  /** Login/username de quem abriu. `null` quando o provider não informa. */
  author: string | null;
  state: CodePullRequestState;
  sourceBranch: string;
  targetBranch: string;
  /** ISO 8601. `null` quando o provider não informa. */
  updatedAt: string | null;
}

export interface CodePullRequestList {
  items: CodePullRequestSummary[];
  /** A lista foi cortada no teto de PRs por chamada. */
  truncated: boolean;
}

export interface CodeBranchPullRequestRef {
  number: number;
  state: CodePullRequestState;
}

/**
 * Dev agent/módulo dono de uma branch `feature/task-XXXXXXXX` (RN-152).
 * `agentId` é o `dev-<modulo>`/`dev-<modulo>-2` que a produziu; `moduleId` é
 * o nome do módulo, do `module_map` vigente do projeto.
 */
export interface CodeBranchProducedBy {
  agentId: string;
  moduleId: string;
}

export interface CodeBranchDetail {
  name: string;
  commitSha: string;
  protected: boolean;
  /** Commits à frente da branch default. `null` quando não computável. */
  ahead: number | null;
  /** Commits atrás da branch default. */
  behind: number | null;
  /** PR aberta com esta branch como origem, se houver. */
  pullRequest: CodeBranchPullRequestRef | null;
  /**
   * Dev agent/módulo dono, quando o nome bate com `feature/task-XXXXXXXX` e
   * a task/módulo ainda são resolvíveis. `null` pra branch manual do usuário
   * ou pra `main`/`dev`/`qa`.
   */
  producedBy: CodeBranchProducedBy | null;
}

export interface CodeBranchDetailList {
  items: CodeBranchDetail[];
  /** A lista foi cortada no teto de branches enriquecidas. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// APÊNDICE DA FRENTE D0 (ADR 0076) — gasto por provider, owner e agente.
//
// Escrito no FIM do arquivo, e não junto dos tipos de gasto, porque esta onda
// roda em paralelo com outras que editam este mesmo arquivo: apêndice não
// conflita, edição no meio conflita. A frente de integração recolhe isto para
// onde ele mora de verdade (`lib/spend.ts`, que a TELA de Gastos consome).
//
// Só a camada de API. A tela é da Onda 3 e não foi tocada.
// ---------------------------------------------------------------------------

/**
 * Os três blocos que `GET /workspaces/:id/spend-report` ganhou.
 *
 * `porProvider` fala de CREDENCIAL, e é por isso que ele só existe na resposta
 * da rota de `owner` (RN-060/RN-186). `MySpend`, a do membro, não ganhou campo
 * nenhum — a assimetria é o desenho, não uma pendência.
 */
export interface WorkspaceSpendPorProvider {
  /** Por PROVIDER. Chave = nome do provider; `rotulo` e `actorKind` são `null`. */
  porProvider: import('./spend').SpendLinha[];
  /**
   * As linhas de PESSOA (`actorKind === 'user'`) — o bloco que o handoff chama
   * de "Por owner", porque pela RN-058 é a chave do owner que todas elas
   * gastam. Quem é o dono continua sendo `ownerId`.
   */
  porOwner: import('./spend').SpendLinha[];
  /** As linhas de AGENTE (`actorKind === 'agent'`). */
  porAgente: import('./spend').SpendLinha[];
}

// ---------------------------------------------------------------------------
// APÊNDICE DA FRENTE G3 (PROGRAMA 28, Onda 5) — a tela do Chat RAG.
//
// Espelha 1:1 o contrato HTTP de `rag.controller.ts`/`rag.response.dto.ts`
// (RN-231..238, ADR 0080), escrito no FIM do arquivo pelo mesmo motivo do
// apêndice da frente D0: outras frentes da Onda 5 editam este arquivo em
// paralelo, e um bloco novo no fim é o que menos colide.
// ---------------------------------------------------------------------------

/** Os três escopos honestos do índice (RN-219/232): nunca código-fonte, nunca PR. */
export type RagChunkScope = 'docs' | 'adr' | 'session';

/**
 * União discriminada por `kind` — o mesmo motivo do `ChunkOrigin` do
 * servidor: quem consome nunca deveria checar dois campos opcionais para
 * saber qual é o `null`.
 */
export type RagChunkOrigin =
  | {
      kind: 'file';
      sourcePath: string;
      /** Trilha de headings da seção de onde o trecho veio, quando há uma. */
      headingPath?: string[];
      title?: string;
    }
  | {
      kind: 'session';
      sessionId: string;
      /** O evento de origem — o mesmo id que `highlightEvent` navega até. */
      eventId?: string;
      title?: string;
    };

export interface RagSearchHit {
  chunkId: string;
  scope: RagChunkScope;
  content: string;
  /** Combinado (0.6 vetor + 0.4 léxico), já acima do limiar de 0.2 (RN-234). */
  score: number;
  /** Similaridade de cosseno, 0..1. `null` quando o sinal não achou o chunk. */
  vectorScore: number | null;
  /** `ts_rank` normalizado, 0..1. `null` quando o termo não casou lexicalmente. */
  lexicalScore: number | null;
  origin: RagChunkOrigin;
}

export interface RagSearchResult {
  query: string;
  hits: RagSearchHit[];
  /**
   * `false` quando o provider de embedding não respondeu (RN-233) — a busca
   * rodou só com o sinal léxico. A tela avisa; nunca esconde.
   */
  vectorAvailable: boolean;
  vectorUnavailableReason?: string;
}

export interface RagFileCoverage {
  filesInRepo: number;
  filesIndexed: number;
  truncated: boolean;
}

export interface RagSessionCoverage {
  sessionsInProject: number;
  sessionsIndexed: number;
}

/**
 * Contagem REAL, nunca "reindexado há Xmin" (RN-237) — não existe coluna de
 * timestamp de indexação por escopo, e um número chutado mentiria.
 */
export interface RagCoverage {
  docs: RagFileCoverage;
  adr: RagFileCoverage;
  session: RagSessionCoverage;
  chunksTotal: number;
  chunksWithoutVector: number;
}

export interface RagIndexEmbeddingReport {
  available: boolean;
  embedded: number;
  skipped: number;
  reason?: string;
}

export interface RagIndexDocsReport {
  filesScanned: number;
  docsChunks: number;
  adrChunks: number;
  truncated: boolean;
  embedding: RagIndexEmbeddingReport;
}

export interface RagReindexSessionsReport {
  total: number;
  indexed: number;
  chunksCreated: number;
}

/** A resposta de `POST .../rag/reindex` — full rebuild idempotente (RN-236). */
export interface RagReindexReport {
  docs: RagIndexDocsReport;
  sessions: RagReindexSessionsReport;
  embeddingAvailable: boolean;
  embeddingReason?: string;
}
