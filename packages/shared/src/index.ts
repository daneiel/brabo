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
