/**
 * O que a tela mostra quando um turno de agente falha.
 *
 * O engine grava `agent.error` com `mensagem` e `origem` (RN-059). Esta função
 * existe para o caso em que ele NÃO grava: evento antigo, gravado antes desta
 * mudança, ou payload truncado. Cair em branco de novo seria repetir o defeito
 * que a mudança inteira existe para matar — então há sempre uma frase, e a
 * origem desconhecida se chama `indeterminada`, nunca uma das quatro por chute
 * (ADR 0020).
 */
export interface FalhaDeTurno {
  mensagem: string;
  origem: string;
}

const SEM_MENSAGEM =
  'O turno falhou e o motivo não foi registrado. Tente de novo; se repetir, o log de eventos tem o payload bruto.';

export function lerFalhaDeTurno(payload: unknown): FalhaDeTurno {
  const p = (payload ?? {}) as { mensagem?: unknown; origem?: unknown };

  const mensagem =
    typeof p.mensagem === 'string' && p.mensagem.trim() !== ''
      ? p.mensagem
      : SEM_MENSAGEM;

  const origem =
    typeof p.origem === 'string' && p.origem.trim() !== ''
      ? p.origem
      : 'indeterminada';

  return { mensagem, origem };
}
