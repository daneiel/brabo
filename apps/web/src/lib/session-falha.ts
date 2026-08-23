import i18n from './i18n';

/**
 * O que a tela mostra quando um turno de agente falha.
 *
 * O engine grava `agent.error` com `mensagem` e `origem` (RN-059). Esta função
 * existe para o caso em que ele NÃO grava: evento antigo, gravado antes desta
 * mudança, ou payload truncado. Cair em branco de novo seria repetir o defeito
 * que a mudança inteira existe para matar — então há sempre uma frase, e a
 * origem desconhecida se chama `indeterminada`, nunca uma das quatro por chute
 * (ADR 0020).
 *
 * As duas frases-padrão (sem mensagem / origem indeterminada) resolvem via
 * `i18n.t()` DENTRO da função — não em constante de módulo — para reagir ao
 * idioma vigente em cada chamada, mesmo sendo módulo não-React.
 */
export interface FalhaDeTurno {
  mensagem: string;
  origem: string;
}

export function lerFalhaDeTurno(payload: unknown): FalhaDeTurno {
  const p = (payload ?? {}) as { mensagem?: unknown; origem?: unknown };

  const mensagem =
    typeof p.mensagem === 'string' && p.mensagem.trim() !== ''
      ? p.mensagem
      : i18n.t('sessionFailure.noMessage', { ns: 'sessions' });

  const origem =
    typeof p.origem === 'string' && p.origem.trim() !== ''
      ? p.origem
      : i18n.t('sessionFailure.unknownOrigin', { ns: 'sessions' });

  return { mensagem, origem };
}
