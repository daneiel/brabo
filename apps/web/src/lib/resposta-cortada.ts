/**
 * A resposta do agente veio cortada pelo teto de saída? (RN-749, AT-434)
 *
 * O engine acrescenta ao fecho cortado UMA linha fixa, no idioma do turno
 * (`Engine.Harness.RespostaCortada.linha/1`, RN-737) — as duas frases abaixo
 * são o contrato com ele, e a tela as reconhece no FIM do texto para oferecer
 * "Continuar de onde parou".
 */
export const LINHAS_DE_RESPOSTA_CORTADA = [
  'Resposta cortada pelo limite de tamanho.',
  'Response cut off by the length limit.',
] as const;

export function respostaCortada(texto: string): boolean {
  const fim = texto.trimEnd();
  return LINHAS_DE_RESPOSTA_CORTADA.some((linha) => fim.endsWith(linha));
}
