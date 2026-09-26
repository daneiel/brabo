/**
 * Âncoras de RN — todo cabeçalho `### RN-NNN` carrega `{#rn-NNN}`, com o
 * MESMO número.
 *
 * Por que existe (AT-230): a âncora é o CONTRATO dos links de fora (CLAUDE.md,
 * "Documentação é parte da definição de pronto") — ela não muda quando a RN
 * muda de arquivo nem quando o título é reescrito. Em `84beec3a1` havia 451
 * cabeçalhos e 449 âncoras: RN-305 e RN-306 nasceram sem, e nada reprovou. O
 * `docs:build` não pega: sem a âncora explícita o Docusaurus gera o id pelo
 * TEXTO do título, a página compila, e o que quebra é o link `#rn-305` que
 * alguém escrever depois — ou, pior, um título reescrito que muda o id sem
 * ninguém ver. A contagem em prosa também não pega: ela conta cabeçalhos,
 * não âncoras.
 *
 * Duas reprovações, por cabeçalho:
 *   - SEM ÂNCORA  — o cabeçalho não termina em `{#...}`;
 *   - DIVERGE     — termina, mas não é `{#rn-NNN}` com os MESMOS dígitos do
 *                   cabeçalho (zero à esquerda incluído: `RN-001` → `rn-001`).
 *
 * Cabeçalho é qualquer nível (`#` a `######`) que COMEÇA em `RN-<dígitos>`:
 * um `####` fora do padrão também tem de ser alcançável por link. Bloco de
 * código cercado NÃO é tratado à parte, de propósito: a contagem de RNs de
 * `generate.mjs` também não trata, e os arquivos de RN têm linhas que começam
 * com crases sem serem cerca (```` ```sh ```` em `autenticacao.md`) — um
 * rastreador de cerca ingênuo desligou 55 cabeçalhos ali na primeira medição.
 */

const CABECALHO = /^#{1,6}[ \t]+RN-(\d+)\b(.*)$/;
const ANCORA_NO_FIM = /\{#([^}\s]+)\}\s*$/;

/**
 * Confere os cabeçalhos de RN de UM texto.
 * @returns {{cabecalhos: number, problemas: {linha: number, rn: string, motivo: string}[]}}
 */
export function conferirAncoras(texto) {
  const problemas = [];
  let cabecalhos = 0;

  texto.split('\n').forEach((linha, i) => {
    const cabecalho = CABECALHO.exec(linha);
    if (cabecalho === null) return;
    cabecalhos++;

    const [, numero, resto] = cabecalho;
    const rn = `RN-${numero}`;
    const ancora = ANCORA_NO_FIM.exec(resto);
    if (ancora === null) {
      problemas.push({ linha: i + 1, rn, motivo: `sem âncora — falta \`{#rn-${numero}}\`` });
    } else if (ancora[1] !== `rn-${numero}`) {
      problemas.push({ linha: i + 1, rn, motivo: `âncora \`{#${ancora[1]}}\` diverge — deveria ser \`{#rn-${numero}}\`` });
    }
  });

  return { cabecalhos, problemas };
}

const TRADUCAO_PT_BR = 'website/i18n/pt-BR/docusaurus-plugin-content-docs/current';

/**
 * Os arquivos de RN, pelo GLOB (um quarto arquivo entra sozinho, como na
 * contagem de `generate.mjs`) — os de `docs/` E os traduzidos em pt-BR.
 *
 * O pt-BR entra porque ele é PÁGINA PUBLICADA com os mesmos links: o site
 * `pt-BR` serve `business-rules#rn-305` pelo arquivo traduzido, e ali a
 * âncora faltava do mesmo jeito (a tradução copiou o cabeçalho sem ela). A
 * regra é por CABEÇALHO, então vale igual numa tradução parcial: o que não foi
 * traduzido cai por fallback na página em inglês, que já é conferida.
 *
 * @param {(glob: string) => string[]} arquivos `git ls-files <glob>`
 */
export function arquivosDeRn(arquivos) {
  return [
    ...arquivos('docs/business-rules.md'),
    ...arquivos('docs/business-rules/*.md'),
    ...arquivos(`${TRADUCAO_PT_BR}/business-rules.md`),
    ...arquivos(`${TRADUCAO_PT_BR}/business-rules/*.md`),
  ];
}

/**
 * Confere uma lista de arquivos.
 * @param {string[]} arquivos caminhos relativos à raiz
 * @param {(caminho: string) => string} ler
 * @returns {{cabecalhos: number, problemas: {arquivo: string, linha: number, rn: string, motivo: string}[]}}
 */
export function aferirAncoras(arquivos, ler) {
  const resultado = { cabecalhos: 0, problemas: [] };
  for (const arquivo of arquivos) {
    const { cabecalhos, problemas } = conferirAncoras(ler(arquivo));
    resultado.cabecalhos += cabecalhos;
    for (const p of problemas) resultado.problemas.push({ arquivo, ...p });
  }
  return resultado;
}
