import type {
  LLMProviderName,
  Model,
  ModelComCuradoria,
  ModelCategory,
  UsoDeModelo,
} from './api-types';

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

export interface GrupoDeModelos<M extends Model = Model> {
  kind: ProviderKind;
  rotulo: string;
  /**
   * Os providers que compõem o grupo, em ordem de tamanho.
   *
   * "Hubs" sozinho não diz de QUEM é o catálogo — e é uma informação que muda
   * tudo, porque preço, disponibilidade e credencial pertencem ao hub, não ao
   * fabricante do modelo. Com isto a tela escreve "Hubs · OpenRouter" em vez de
   * fazer o usuário deduzir.
   */
  provedores: LLMProviderName[];
  modelos: M[];
  /**
   * Só no `hub`: os mesmos `modelos`, repartidos por quem os SERVE por baixo.
   *
   * Um hub devolve o catálogo de dezenas de fabricantes numa lista só — o
   * OpenRouter traz 338 —, e uma lista plana desse tamanho não é navegável:
   * achar o Claude ali é rolagem, não escolha. O provedor upstream sai do
   * PREFIXO do id (`anthropic/claude-…`, `openai/gpt-4o`), que é como o hub
   * namespaceia o catálogo inteiro.
   *
   * `undefined` nos outros grupos: numa API direta o dono do modelo já é o
   * provider, e repetir isso seria um nível de aninhamento sem informação.
   */
  subgrupos?: SubgrupoDeModelos<M>[];
}

export interface SubgrupoDeModelos<M extends Model = Model> {
  /** O prefixo do id, que é o slug do fabricante no hub. */
  upstream: string;
  rotulo: string;
  modelos: M[];
}

/**
 * O fabricante por trás de um modelo de hub, lido do prefixo do id.
 *
 * Modelo sem `/` no nome não é erro: alguns hubs expõem modelos próprios sem
 * namespace. Eles caem num grupo à parte em vez de sumir.
 */
export function upstreamDoModelo(nome: string): string {
  const barra = nome.indexOf('/');
  return barra > 0 ? nome.slice(0, barra) : 'outros';
}

/**
 * Rótulo do fabricante. Sem `Record` exaustivo aqui, ao contrário de
 * `ROTULO_DO_PROVIDER`: a lista é do HUB, muda quando ele quiser, e travar o
 * typecheck num slug que o OpenRouter inventou amanhã pararia o build por um
 * dado que não é nosso. Quem não está no mapa aparece com o próprio slug.
 */
const ROTULO_DO_UPSTREAM: Record<string, string> = {
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'google': 'Google',
  'meta-llama': 'Meta',
  'mistralai': 'Mistral',
  'deepseek': 'DeepSeek',
  'qwen': 'Qwen',
  'x-ai': 'xAI',
  'amazon': 'Amazon',
  'microsoft': 'Microsoft',
  'cohere': 'Cohere',
  'nvidia': 'NVIDIA',
  'moonshotai': 'Moonshot',
  'perplexity': 'Perplexity',
  'outros': 'Sem fabricante declarado',
};

export function rotuloDoUpstream(upstream: string): string {
  return ROTULO_DO_UPSTREAM[upstream] ?? upstream;
}

/**
 * As facetas de capability que o catálogo PROVA — o eixo pelo qual se procura um
 * modelo quando o catálogo tem 338 linhas.
 *
 * Só entra faceta que algum provider declara e o sync grava. "Melhor para
 * código", "melhor para documentação" e vídeo ficaram de fora de propósito:
 * nenhum catálogo publica isso, e uma faceta derivada do nome do modelo seria
 * palpite vestido de dado (ADR 0041). Essa parte é curadoria de quem opera, não
 * capability — mora nos favoritos, não aqui.
 */
export type Faceta = 'toolCalling' | 'vision' | 'reasoning' | 'imagem';

export const FACETAS: readonly {
  id: Faceta;
  rotulo: string;
  /** Por que ligar este filtro — o que muda no que sobra na lista. */
  ajuda: string;
  aceita: (m: Model) => boolean;
}[] = [
  {
    id: 'toolCalling',
    rotulo: 'tool calling',
    ajuda: 'Só os que um agente consegue usar (RN-040).',
    aceita: (m) => m.supportsToolCalling,
  },
  {
    id: 'vision',
    rotulo: 'lê imagem',
    ajuda: 'Aceita imagem na ENTRADA — print, diagrama, PDF renderizado.',
    aceita: (m) => m.supportsVision === true,
  },
  {
    id: 'reasoning',
    rotulo: 'thinking',
    ajuda: 'Expõe raciocínio explícito antes da resposta.',
    aceita: (m) => m.supportsReasoning === true,
  },
  {
    id: 'imagem',
    rotulo: 'gera imagem',
    ajuda: 'PRODUZ imagem — eixo diferente de saber lê-la.',
    aceita: (m) => m.generatesImage === true,
  },
];

/**
 * O rótulo humano de cada uso. `Record` EXAUSTIVO: uso novo no tipo quebra o
 * typecheck aqui até ganhar tradução, em vez de aparecer na tela pelo slug.
 */
export const ROTULO_DO_USO: Record<UsoDeModelo, string> = {
  codigo: 'código',
  documentacao: 'documentação',
  analise: 'análise',
  imagem: 'imagem',
  conversa: 'conversa',
};

export const USOS_DE_MODELO = Object.keys(ROTULO_DO_USO) as UsoDeModelo[];

export interface AgruparOpcoes {
  /** Só modelos com tool calling — o filtro "aptos para agentes" (RN-040). */
  somenteAptosParaAgentes?: boolean;
  /**
   * Facetas exigidas, em CONJUNÇÃO: marcar "lê imagem" e "thinking" pede um
   * modelo que faça as duas. Disjunção devolveria a lista quase inteira e não
   * responderia à pergunta que se faz na tela ("qual serve para esta tarefa?").
   */
  facetas?: readonly Faceta[];
  /**
   * Usos exigidos, também em conjunção — "o modelo que marcamos para código E
   * para análise". Só faz sentido com `ModelComCuradoria`: uso é curadoria de
   * workspace, e o seletor (que recebe `Model`) não a carrega.
   */
  usos?: readonly UsoDeModelo[];
}

/** Uso é curadoria: só o catálogo com curadoria anexada pode ser filtrado por ele. */
function usosDe(modelo: Model): UsoDeModelo[] {
  return (modelo as Partial<ModelComCuradoria>).uses ?? [];
}

/**
 * Achata o `Record<categoria, Record<provider, Model[]>>` do servidor e
 * reagrupa por `ProviderKind`. Grupo sem membro não entra na lista.
 *
 * O modelo `unavailable` NÃO é filtrado: ele continua aparecendo, marcado — se
 * sumisse, o binding que aponta para ele viraria um mistério na tela.
 */
// Genérica no tipo do modelo porque as duas telas passam coisas diferentes: o
// seletor manda `Model` e a curadoria manda `ModelComCuradoria` (ADR 0049). O
// agrupamento só olha `provider` e `supportsToolCalling` — que os dois têm —,
// então fixar `Model` aqui só serviria para a curadoria perder o `isActive` na
// saída.
export function agruparModelos<M extends Model>(
  models: Record<ModelCategory, Record<string, M[]>>,
  opcoes: AgruparOpcoes = {},
): GrupoDeModelos<M>[] {
  const todos = [
    ...Object.values(models.local ?? {}).flat(),
    ...Object.values(models.cloud ?? {}).flat(),
  ]
    .filter((m) => !opcoes.somenteAptosParaAgentes || m.supportsToolCalling)
    .filter((m) =>
      (opcoes.facetas ?? []).every(
        (id) => FACETAS.find((f) => f.id === id)?.aceita(m) ?? true,
      ),
    )
    .filter((m) => (opcoes.usos ?? []).every((u) => usosDe(m).includes(u)));

  return ORDEM_DOS_GRUPOS.map((kind) => {
    const modelos = todos.filter((m) => providerKind(m.provider) === kind);
    return {
      kind,
      rotulo: ROTULO_DO_GRUPO[kind],
      provedores: provedoresDe(modelos),
      modelos,
      ...(kind === 'hub' ? { subgrupos: repartirPorUpstream(modelos) } : {}),
    };
  }).filter((grupo) => grupo.modelos.length > 0);
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

/**
 * Reparte os modelos de um hub por fabricante, do maior grupo para o menor —
 * quem serve mais modelos é quem o usuário mais procura. Empate desempata por
 * rótulo, para a ordem não dançar entre dois syncs.
 */
function repartirPorUpstream<M extends Model>(modelos: M[]): SubgrupoDeModelos<M>[] {
  const porUpstream = new Map<string, M[]>();
  for (const modelo of modelos) {
    const upstream = upstreamDoModelo(modelo.name);
    porUpstream.set(upstream, [...(porUpstream.get(upstream) ?? []), modelo]);
  }

  return [...porUpstream.entries()]
    .map(([upstream, lista]) => ({
      upstream,
      rotulo: rotuloDoUpstream(upstream),
      modelos: lista,
    }))
    .sort(
      (a, b) =>
        b.modelos.length - a.modelos.length || a.rotulo.localeCompare(b.rotulo),
    );
}

/** Os providers presentes num grupo, do que mais serve para o que menos serve. */
function provedoresDe(modelos: Model[]): LLMProviderName[] {
  const contagem = new Map<LLMProviderName, number>();
  for (const m of modelos) {
    contagem.set(m.provider, (contagem.get(m.provider) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([provider]) => provider);
}
