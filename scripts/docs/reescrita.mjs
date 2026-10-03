/**
 * Reescrita dos números DERIVÁVEIS da prosa (AT-399, decisão do dono 03/10).
 *
 * As contagens de ADR/RN, o "próximo ADR" e as refs `caminho:N` eram só
 * VERIFICADAS: o `docs:check` apontava e alguém corrigia à mão. Com PRs em
 * paralelo isso falhava a cada merge (8 de 30 execuções em 3 h), porque cada
 * um escrevia o número que via na própria base. Agora o `pnpm docs:generate`
 * (modo escrita) reescreve o que a fonte determina; o `--check` continua
 * reprovando o arquivo commitado desatualizado, como já faz com os gerados.
 *
 * Funções puras sobre TEXTO — o spec ao lado prova cada uma por mutação.
 */

/**
 * Troca o grupo 1 do primeiro casamento de `padrao` por `valor`.
 * Devolve o texto intocado quando o padrão não casa (quem decide CEGO é o
 * chamador) ou quando o valor já é o certo.
 */
export function substituirGrupo(texto, padrao, valor) {
  const flags = padrao.flags.replace('g', '');
  const comIndices = new RegExp(padrao.source, flags.includes('d') ? flags : `${flags}d`);
  const achado = comIndices.exec(texto);
  if (achado === null || achado[1] === valor) return texto;
  const [inicio, fim] = achado.indices[1];
  return texto.slice(0, inicio) + valor + texto.slice(fim);
}

/** A frase do "próximo ADR" no índice. */
export const PROXIMO_ADR = /the next one is \*\*(\d{4})\*\*/;

/**
 * Merge de dois PRs que acrescentam ADR deixa DUAS linhas "the next one is"
 * (cada lado trocou o número). Fica a primeira; o número dela é acertado
 * depois pela contagem.
 */
export function deduplicarProximoAdr(texto) {
  let visto = false;
  return texto
    .split('\n')
    .filter((linha) => {
      if (!PROXIMO_ADR.test(linha)) return true;
      if (visto) return false;
      visto = true;
      return true;
    })
    .join('\n');
}
