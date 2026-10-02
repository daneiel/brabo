/**
 * Tira a marcação de Markdown de um texto que será mostrado como PRÉVIA de
 * uma linha (a faixa do turno, RN-712): `**`, `##`, `---`, tabelas `|---|`,
 * crases e marcadores de lista viram texto corrido. Não é parser: é a régua
 * mínima para a faixa não exibir sintaxe crua enquanto o turno escreve.
 */
export function textoPlanoDoMarkdown(texto: string): string {
  return texto
    .split('\n')
    .filter((linha) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(linha))
    .filter((linha) => !/^\s*([-*_])\s*(\1\s*){2,}$/.test(linha))
    .filter((linha) => !/^\s*```/.test(linha))
    .map((linha) =>
      linha
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .replace(/\s*\|\s*/g, ' · ')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(\*|_)(\S.*?\S|\S)\1/g, '$2')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .trim(),
    )
    .filter((linha) => linha !== '')
    .join(' ');
}
