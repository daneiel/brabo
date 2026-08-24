import i18n from './i18n';

/**
 * A LINGUAGEM da faixa de atividade da sessão — o que dizer enquanto o
 * modelo está no meio de um turno, chamando ferramenta.
 *
 * Mesmo desenho de `apps/web/src/lib/aprovacoes.ts` (FASE 19, RN-096): um
 * dicionário ferramenta → frase, com fallback que nunca quebra para
 * ferramenta que o web ainda não conhece. Duas diferenças, e as duas têm
 * motivo:
 *
 * - **A frase mora em i18n, não em constante de módulo.** `aprovacoes.ts` é
 *   anterior à fundação de i18n (RN-425) e nunca foi revisitado; este
 *   dicionário nasce depois dela, então entra pelo padrão atual —
 *   `apps/web/src/locales/{en,pt-BR}/toolNarration.json`, resolvido por
 *   `i18n.t()` DENTRO da função (não em constante de módulo), o mesmo
 *   padrão de `lib/session-falha.ts`, para reagir ao idioma vigente em cada
 *   chamada mesmo sendo módulo não-React.
 * - **Não há verbo separado da frase.** A faixa de atividade não é uma
 *   decisão que o usuário aprova ou recusa — é só narração ("Escrevendo uma
 *   história"), então uma frase por ferramenta basta; não existe o par
 *   verbo+frase que `ApprovalCard` precisa para compor "Dev API **quer
 *   executar comando**".
 *
 * `campos` existe como parâmetro pronto para o dia em que uma frase precisar
 * interpolar um valor (ex.: o título de uma história) — nenhuma das
 * ferramentas de hoje usa: não adicione interpolação sem um caso real
 * (YAGNI).
 */

const NS = 'toolNarration';

/**
 * As 19 ferramentas dos seis agentes conversacionais (Criativo, PO,
 * Arquiteto, Dev Lead, UX Designer, Staff) que têm frase própria em
 * `toolNarration.json`. `confirm_readiness`/`confirm_architecture` NÃO
 * entram: são rota HTTP/`GenServer.call` disparada por clique do usuário,
 * nunca uma tool call do modelo.
 */
export const FERRAMENTAS_CONHECIDAS = [
  'listar_regras_de_negocio',
  'listar_backlog',
  'listar_metricas_de_produto',
  'create_epic',
  'create_story',
  'create_task',
  'ask_structured_questions',
  'offer_handoff',
  'emit_artifact',
  'create_module_map',
  'assign_story_modules',
  'choose_project_image',
  'create_c4_diagram',
  'propose_adr',
  'emit_insight',
  'propose_execution_plan',
  'assess_implementability',
  'propose_prototype',
  'propose_rfc',
] as const;

export type FerramentaConhecida = (typeof FERRAMENTAS_CONHECIDAS)[number];

/**
 * A frase da ferramenta, ou um fallback legível quando o web ainda não a
 * conhece — nunca quebra, nunca devolve o nome técnico cru sem contexto.
 */
export function fraseDaFerramenta(tool: string, campos?: Record<string, string>): string {
  const chave = `tools.${tool}`;
  if (i18n.exists(chave, { ns: NS })) {
    return i18n.t(chave, { ns: NS, ...campos });
  }
  return i18n.t('fallback', { ns: NS, tool, ...campos });
}
