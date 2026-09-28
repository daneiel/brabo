/**
 * O 409 de conversa em sessão encerrada (RN-581, AT-154) e a régua de "sessão
 * terminal" da tela.
 *
 * A api recusa evento de CONVERSA numa sessão `closed`/`closed_abnormally` com
 * 409 e `reason: "sessao_encerrada"` (`ConversaEmSessaoEncerradaError.REASON`).
 * O reconhecimento é pelo CÓDIGO nomeado, nunca pelo texto da mensagem (que é
 * da api, em pt-BR, e um dia diverge) e nunca só pelo 409 — 409 também é
 * "turno em andamento" e "aguardando aprovação", e esses têm frase própria.
 *
 * A checagem é ESTRUTURAL, e não `instanceof ApiError`, pelo mesmo motivo de
 * `recusa-do-agente.ts`: as suítes de tela substituem `api-client.ts` por um
 * mock de fábrica, e uma função ali quebraria o caminho de falha.
 */
export const REASON_SESSAO_ENCERRADA = 'sessao_encerrada';

export function ehRecusaDeSessaoEncerrada(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;
  const { status, body } = erro as { status?: unknown; body?: unknown };
  if (status !== 409) return false;
  return (body as { reason?: unknown } | null | undefined)?.reason === REASON_SESSAO_ENCERRADA;
}

/**
 * Estados TERMINAIS da sessão — o espelho de `isTerminal`
 * (`apps/api/src/domain/sessions/session-state-machine.ts`). O web não importa
 * o domínio da api; a lista é dois valores e o teste a fixa.
 */
export function sessaoEhTerminal(status: string | undefined): boolean {
  return status === 'closed' || status === 'closed_abnormally';
}
