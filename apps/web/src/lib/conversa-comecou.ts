/**
 * RN-693 (AT-353) — a pergunta "a conversa começou?" que decide o convite do
 * fio. Até aqui era `events.length > 0`, e o PRÓPRIO clique "Iniciar ideação"
 * gravava o primeiro evento (`agent.activated`, depois `agent.status`): o
 * convite sumia antes de o Criativo dizer qualquer coisa, e o fio ficava
 * vazio ~25 s. Eventos de CICLO DE VIDA do agente não são conversa; qualquer
 * outro evento continua contando (a sessão do git-bootstrap e a de execução
 * não têm `chat.message`, e o convite não pode cobri-las — RN-131).
 */
export const EVENTOS_QUE_NAO_SAO_CONVERSA: ReadonlySet<string> = new Set([
  'agent.activated',
  'agent.status',
]);

export function conversaComecou(events: ReadonlyArray<{ type: string }>): boolean {
  return events.some((e) => !EVENTOS_QUE_NAO_SAO_CONVERSA.has(e.type));
}

/**
 * Atributos que tiram um campo de texto livre do alcance do autofill do
 * navegador E dos gerenciadores de senha (1Password, LastPass, Bitwarden,
 * Dashlane) — `autocomplete="off"` sozinho é ignorado por eles.
 *
 * RN-740 (AT-425): `aria-autocomplete="none"` declara à árvore acessível que o
 * campo não oferece sugestão (heurísticas de extensão leem o ARIA), e
 * `data-protonpass-ignore` é o atributo que o Proton Pass documenta. Nenhum
 * dos dois foi medido contra a extensão real: a prova fica para o TP-01.
 */
export const SEM_AUTOFILL = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
  'aria-autocomplete': 'none',
  'data-protonpass-ignore': 'true',
} as const;
