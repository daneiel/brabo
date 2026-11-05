/**
 * As RNs vistas de TODAS as raízes de doc (AT-693): uma função só diz quais
 * arquivos hospedam RN, em vez de três listas fixas (contagem, âncoras, refs).
 * Arquivo sem cabeçalho `### RN-` (índice, stubs) está na lista mas não conta.
 */
import { lerRaizesDeDoc } from './raizes-de-doc.mjs';

/** Os locales traduzidos (ADR 0216): pt-BR é a fonte, em `<raiz>/`. */
export const LOCALES_TRADUZIDOS = ['en', 'ru', 'zh-Hans'];

const CABECALHO = /^### RN-(\d+)\b(.*)$/gm;

/**
 * Os arquivos de RN (fonte pt-BR e traduções) de cada raiz existente.
 * @param {(glob: string) => string[]} arquivos `git ls-files <glob>`
 * @param {{raiz: string}[]} raizes
 */
export function arquivosDeRn(arquivos, raizes = lerRaizesDeDoc()) {
  const bases = raizes.flatMap(({ raiz }) => [raiz, ...LOCALES_TRADUZIDOS.map((l) => `${raiz}/i18n/${l}`)]);
  return bases.flatMap((b) => [...arquivos(`${b}/business-rules.md`), ...arquivos(`${b}/business-rules/*.md`)]);
}

const ehTraducao = (arquivo) => arquivo.includes('/i18n/');

/** Cabeçalhos `### RN-NNN` de um texto: `[{numero, titulo}]`. */
export function rnsDoTexto(texto) {
  return [...texto.matchAll(CABECALHO)].map(([, numero, resto]) => ({
    numero: Number(numero),
    titulo: resto.replace(/\s*\{#[^}]*\}\s*$/, '').replace(/^\s*[—-]\s*/, '').trim(),
  }));
}

/** Só a fonte pt-BR: `[{numero, titulo, arquivo}]`. */
export function rnsDaFonte(arquivos, ler) {
  return arquivos
    .filter((a) => !ehTraducao(a))
    .flatMap((arquivo) => rnsDoTexto(ler(arquivo)).map((r) => ({ ...r, arquivo })));
}

export const contarRegras = (arquivos, ler) => rnsDaFonte(arquivos, ler).length;

/** O maior número de RN de todas as raízes (o próximo é este + 1). */
export const maiorRn = (arquivos, ler) => Math.max(0, ...rnsDaFonte(arquivos, ler).map((r) => r.numero));

/** O mesmo número em mais de um lugar (fonte pt-BR): `[{numero, arquivos}]`. */
export function numerosDuplicados(arquivos, ler) {
  const onde = new Map();
  for (const r of rnsDaFonte(arquivos, ler)) onde.set(r.numero, [...(onde.get(r.numero) ?? []), r.arquivo]);
  return [...onde].filter(([, a]) => a.length > 1).map(([numero, a]) => ({ numero, arquivos: a }));
}

/** Coordenadas da união: tira o `<raiz>/` (`apps/api/docs/business-rules/api.md` → `business-rules/api.md`). */
export function paginaNaUniao(arquivo, raizes = lerRaizesDeDoc()) {
  const r = raizes.find((x) => arquivo.startsWith(`${x.raiz}/`));
  return r ? arquivo.slice(r.raiz.length + 1) : arquivo;
}

/**
 * O bloco do índice: uma linha por RN, com a âncora `rn-NNN` e o link para a
 * página hospedeira. `rns`: `[{numero, titulo, pagina}]`.
 */
export function gerarIndiceDeRn(rns) {
  const linhas = [...rns]
    .sort((a, b) => a.numero - b.numero)
    .map((r) => {
      const n = String(r.numero).padStart(3, '0');
      return `- <a id="rn-${n}"></a>[RN-${n}](${r.pagina}#rn-${n}) — ${r.titulo}`;
    });
  return ['<!-- BEGIN:GENERATED:indice-de-rn -->', ...linhas, '<!-- END:GENERATED:indice-de-rn -->'].join('\n');
}
