import { autorDaMensagem, type ContextoDeAutoria } from './autor-da-mensagem';

/**
 * A bolha OTIMISTA da mensagem do usuário e a do log são a MESMA mensagem
 * (RN-728, AT-409). Até aqui as duas conviviam no fio enquanto o turno corria
 * — a otimista só saía no fim do turno —, e cada uma nomeava o autor por um
 * caminho (a otimista pelo e-mail do token, a do log pela linha de membro).
 *
 * As duas regras daqui:
 * - a otimista SAI assim que o `chat.message` com o `mensagemId` que a api
 *   devolveu no aceite está no log — casamento por id, nunca por texto;
 * - o nome dela sai de `autorDaMensagem`, o MESMO caminho da bolha do log.
 */
export function otimistaJaNoLog(
  eventos: readonly { id: string; type: string }[],
  mensagemId: string | null,
): boolean {
  if (!mensagemId) return false;
  return eventos.some((e) => e.type === 'chat.message' && e.id === mensagemId);
}

export function nomeDaMensagemOtimista(autoria: ContextoDeAutoria): string | null {
  if (autoria.meuId === null) return autoria.meuEmail;
  const autor = autorDaMensagem({ kind: 'user', id: autoria.meuId }, autoria);
  return autor.tipo === 'voce' ? autor.nome : autoria.meuEmail;
}
