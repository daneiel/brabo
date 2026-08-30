/**
 * O REGISTRO das seções da aba Configurações — a lista que o sumário ancorado
 * lê e a que `router.tsx` valida o deep-link `?section=` contra.
 *
 * Existe pelo mesmo motivo que `routes/project-tabs.ts` existe para as abas:
 * enquanto a ordem das seções morava só no JSX do barrel, "a seção existe",
 * "o sumário a lista" e "a URL aceita a chave" eram três decisões
 * independentes, e nada obrigava as três a concordarem. Uma chave aceita pelo
 * `validateSearch` sem seção correspondente rolaria para lugar nenhum,
 * silenciosa.
 *
 * ## A ordem é a do BARREL, e o agrupamento é uma LEITURA dela
 *
 * `SECOES_DE_CONFIGURACOES` está na MESMA ordem em que
 * `ProjectSettingsTab.tsx` compõe as 17 seções — e tem de continuar assim: o
 * scroll-spy decide a seção vigente pela PRIMEIRA folha visível nesta ordem, e
 * uma lista fora de ordem faria o sumário marcar uma seção enquanto a tela
 * mostra outra.
 *
 * Os quatro grupos (`projeto`, `modelos`, `pessoas`, `avancado`) caem
 * CONTÍGUOS sobre essa ordem — nenhuma seção mudou de lugar para caber num
 * grupo. Isso é deliberado: agrupar é uma leitura da ordem que já existia,
 * não uma reorganização da aba. Reordenar seção é mudança de produto, e não é
 * o que esta mudança faz.
 *
 * ## O título tem UMA fonte
 *
 * `ns` + `titulo` apontam para a MESMA chave de i18n que o `<h2>` da seção
 * renderiza. Não há string de sumário escrita à parte, então rótulo do sumário
 * e título da seção não têm como divergir. Duas seções tiram o título do
 * namespace `models` e não de `settings` porque delegam para componentes
 * compartilhados (`ModelCatalogSection`, `CredentialSpendSection`), que também
 * aparecem em outras abas.
 */

export const GRUPOS_DO_SUMARIO = ['projeto', 'modelos', 'pessoas', 'avancado'] as const;
export type GrupoDoSumario = (typeof GRUPOS_DO_SUMARIO)[number];

export interface DescricaoDeSecao {
  /** O valor que aparece em `?section=` e a raiz do `id` no DOM. */
  chave: string;
  grupo: GrupoDoSumario;
  /** Namespace de i18n do título — o mesmo que a seção usa. */
  ns: 'settings' | 'models';
  /** Chave do título — a mesma que o `<h2>` da seção renderiza. */
  titulo: string;
}

export const SECOES_DE_CONFIGURACOES = [
  { chave: 'repository', grupo: 'projeto', ns: 'settings', titulo: 'repository.title' },
  { chave: 'execution', grupo: 'projeto', ns: 'settings', titulo: 'execution.title' },
  { chave: 'execution-mode', grupo: 'projeto', ns: 'settings', titulo: 'executionMode.title' },
  { chave: 'parallelism', grupo: 'projeto', ns: 'settings', titulo: 'parallelism.title' },
  { chave: 'budget', grupo: 'projeto', ns: 'settings', titulo: 'budget.title' },
  { chave: 'promotion', grupo: 'projeto', ns: 'settings', titulo: 'promotion.title' },
  { chave: 'best-models', grupo: 'modelos', ns: 'settings', titulo: 'bestModels.title' },
  { chave: 'models', grupo: 'modelos', ns: 'settings', titulo: 'modelsSection.title' },
  { chave: 'area-models', grupo: 'modelos', ns: 'settings', titulo: 'areaModels.title' },
  { chave: 'model-catalog', grupo: 'modelos', ns: 'models', titulo: 'catalog.title' },
  { chave: 'members', grupo: 'pessoas', ns: 'settings', titulo: 'members.title' },
  { chave: 'access-tokens', grupo: 'pessoas', ns: 'settings', titulo: 'personalAccessTokens.title' },
  { chave: 'proficiency', grupo: 'pessoas', ns: 'settings', titulo: 'proficiency.title' },
  { chave: 'instructions', grupo: 'avancado', ns: 'settings', titulo: 'instructionVersions.title' },
  { chave: 'approval-matrix', grupo: 'avancado', ns: 'settings', titulo: 'matrix.title' },
  { chave: 'credentials', grupo: 'avancado', ns: 'settings', titulo: 'credentials.title' },
  { chave: 'key-spend', grupo: 'avancado', ns: 'models', titulo: 'spend.title' },
] as const satisfies readonly DescricaoDeSecao[];

export type ChaveDeSecao = (typeof SECOES_DE_CONFIGURACOES)[number]['chave'];

const CHAVES: readonly string[] = SECOES_DE_CONFIGURACOES.map((s) => s.chave);

/** Posição na ordem de render — o critério de ordenação do sumário e do spy. */
export function ordemDaSecao(chave: ChaveDeSecao): number {
  return CHAVES.indexOf(chave);
}

/**
 * O `id` do elemento no DOM. Prefixado porque `id` é espaço GLOBAL do
 * documento e chaves curtas como `members`/`budget` colidiriam com qualquer
 * outro `id` que uma seção venha a cravar dentro do próprio conteúdo.
 */
export function idDaSecao(chave: ChaveDeSecao): string {
  return `secao-${chave}`;
}

/** A volta de `idDaSecao` — o observador só tem o elemento em mãos. */
export function chaveDoId(id: string): ChaveDeSecao | undefined {
  const chave = id.startsWith('secao-') ? id.slice('secao-'.length) : id;
  return ehChaveDeSecao(chave) ? chave : undefined;
}

export function ehChaveDeSecao(valor: unknown): valor is ChaveDeSecao {
  return typeof valor === 'string' && CHAVES.includes(valor);
}

/**
 * O que `validateSearch` aceita. Chave desconhecida vira `undefined` — a aba
 * abre no topo, como abriria sem parâmetro nenhum, em vez de guardar um alvo
 * que nunca vai existir.
 */
export function resolverChaveDeSecao(valor: unknown): ChaveDeSecao | undefined {
  return ehChaveDeSecao(valor) ? valor : undefined;
}
