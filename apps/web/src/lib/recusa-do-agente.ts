/**
 * A frase da RECUSA de um agente a um comando que dispara turno (ADR 0163,
 * RN-578): 409 com o agente ainda no meio de um turno (ou com plano pendente
 * em Aprovações) e 422 sem regra de negócio para consolidar. Desde o ADR 0163
 * essas recusas deixaram de ser 202 calado, e a frase é do engine — é ela que
 * diz à pessoa que a mensagem ficou registrada e NÃO foi lida.
 *
 * Qualquer outra falha (rede, 500) devolve `padrao` — diferente de
 * `mensagemDaApi`, que devolveria o `message` cru de um `TypeError` de rede.
 *
 * A checagem é ESTRUTURAL (`status` + `body.message`), e não
 * `instanceof ApiError`, de propósito: este módulo não importa
 * `api-client.ts`, que é o módulo que as suítes de tela substituem por um
 * mock de fábrica — e um mock sem esta função quebraria justamente o caminho
 * de falha que elas existem para provar.
 */
export function mensagemDaRecusaDoAgente(erro: unknown, padrao: string): string {
  if (typeof erro !== 'object' || erro === null) return padrao;
  const { status, body } = erro as { status?: unknown; body?: unknown };
  if (status !== 409 && status !== 422) return padrao;
  const message = (body as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message.trim() !== '' ? message : padrao;
}
