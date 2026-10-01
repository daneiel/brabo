/**
 * A contagem do auto-teste de PTY (`--self-test-pty`, `rodarAutoTestePty` em
 * `index.ts`), fora de `index.ts` para ser testável sem importar o CLI.
 *
 * O ConPTY do Windows intercala sequências de controle no que redesenha
 * (AT-343), então a contagem é feita sem elas. Tirar sequência de controle não
 * afrouxa a prova: o marcador continua tendo de aparecer INTEIRO.
 */

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
// Montadas por `RegExp` a partir de ESC/BEL porque o lint recusa caractere de
// controle em literal de regex — e aqui ele é o assunto.
const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

/** Remove as sequências CSI (`ESC [ ... letra`) e OSC (`ESC ] ... BEL|ST`). */
export function semSequenciasDeControle(texto: string): string {
  return texto.replace(OSC, '').replace(CSI, '');
}

export function ocorrenciasDoMarcador(saida: string, marcador: string): number {
  return semSequenciasDeControle(saida).split(marcador).length - 1;
}

