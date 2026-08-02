import type { LLMProviderName, Model, ModelsByCategory } from './api-types';

/**
 * Como o modelo CHEGA até a chamada (Fase 9c) — outra pergunta que a categoria
 * `local`/`cloud`, que só diz se custa dinheiro.
 *
 * - `local`: roda na máquina, não gasta nada;
 * - `direct`: API do próprio dono do modelo;
 * - `hub`: um roteador que serve modelos de terceiros. Custo e disponibilidade
 *   dependem de quem está por baixo, e é por isso que o metering guarda
 *   `upstream_provider` — misturar hub com API direta no seletor esconderia
 *   exatamente essa diferença.
 */
export type ProviderKind = 'local' | 'direct' | 'hub';

/**
 * Enquanto os providers da Fase 9b não entram, `hub` não tem nenhum membro — e
 * é assim que a lista deve ficar: um grupo vazio some da UI sozinho, e um hub
 * novo só precisa entrar aqui.
 */
const HUBS: readonly string[] = ['openrouter'];

export function providerKind(provider: LLMProviderName | string): ProviderKind {
  if (provider === 'ollama') return 'local';
  return HUBS.includes(provider) ? 'hub' : 'direct';
}

export const ROTULO_DO_GRUPO: Record<ProviderKind, string> = {
  local: 'Local',
  direct: 'APIs diretas',
  hub: 'Hubs',
};

/** A ordem em que os grupos aparecem: do mais barato ao mais indireto. */
export const ORDEM_DOS_GRUPOS: readonly ProviderKind[] = [
  'local',
  'direct',
  'hub',
];

export interface GrupoDeModelos {
  kind: ProviderKind;
  rotulo: string;
  modelos: Model[];
}

export interface AgruparOpcoes {
  /** Só modelos com tool calling — o filtro "aptos para agentes" (RN-040). */
  somenteAptosParaAgentes?: boolean;
}

/**
 * Achata o `Record<categoria, Record<provider, Model[]>>` do servidor e
 * reagrupa por `ProviderKind`. Grupo sem membro não entra na lista.
 *
 * O modelo `unavailable` NÃO é filtrado: ele continua aparecendo, marcado — se
 * sumisse, o binding que aponta para ele viraria um mistério na tela.
 */
export function agruparModelos(
  models: ModelsByCategory,
  opcoes: AgruparOpcoes = {},
): GrupoDeModelos[] {
  const todos = [
    ...Object.values(models.local ?? {}).flat(),
    ...Object.values(models.cloud ?? {}).flat(),
  ].filter((m) => !opcoes.somenteAptosParaAgentes || m.supportsToolCalling);

  return ORDEM_DOS_GRUPOS.map((kind) => ({
    kind,
    rotulo: ROTULO_DO_GRUPO[kind],
    modelos: todos.filter((m) => providerKind(m.provider) === kind),
  })).filter((grupo) => grupo.modelos.length > 0);
}

/**
 * O rótulo humano de cada provider. `Record` EXAUSTIVO de propósito: um
 * provider novo em `LLMProviderName` (a Fase 9b traz seis) quebra o typecheck
 * aqui até ganhar rótulo, em vez de aparecer na tela pelo slug.
 */
export const ROTULO_DO_PROVIDER: Record<LLMProviderName, string> = {
  ollama: 'Ollama (local)',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  'nvidia-nim': 'NVIDIA NIM',
  together: 'Together AI',
  deepinfra: 'DeepInfra',
  bitdeer: 'Bitdeer',
  vultr: 'Vultr',
};

/** Provider que exige chave: todos menos os locais, que rodam na máquina. */
export type LlmCredentialProvider = Exclude<LLMProviderName, 'ollama'>;

export interface CredencialDeLlm {
  id: LlmCredentialProvider;
  label: string;
  kind: Exclude<ProviderKind, 'local'>;
}

/**
 * Os providers que PRECISAM de chave, derivados da mesma tabela de rótulos em
 * vez de digitados à parte — era a lista fixa aqui que fazia um provider novo
 * exigir editar o componente de credenciais.
 */
export const CREDENCIAIS_DE_LLM: CredencialDeLlm[] = (
  Object.keys(ROTULO_DO_PROVIDER) as LLMProviderName[]
)
  .map((id) => ({ id, label: ROTULO_DO_PROVIDER[id], kind: providerKind(id) }))
  .filter((c): c is CredencialDeLlm => c.kind !== 'local');

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

/**
 * Entrada e saída SEPARADAS, e não a média das duas.
 *
 * A média escondia a assimetria: um modelo de 3 USD de entrada e 15 de saída
 * aparecia como "9", que não é o preço de nada — e a conta de um turno real,
 * que consome muito mais entrada que saída, não sai desse número.
 */
export function formatarPreco(model: Model): string {
  if (model.provider === 'ollama') return 'grátis';
  const entrada = usd.format(model.inputPricePerMillionMicros / 1_000_000);
  const saida = usd.format(model.outputPricePerMillionMicros / 1_000_000);
  return `${entrada} / ${saida} por 1M`;
}

export function formatarJanela(model: Model): string | null {
  if (!model.contextWindow) return null;
  return model.contextWindow >= 1000
    ? `${Math.round(model.contextWindow / 1000)}k ctx`
    : `${model.contextWindow} ctx`;
}
