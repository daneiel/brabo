// Busca do site de docs (AT-662, lane A4). Substring normalizada, sem stemming e
// sem realce no destino (decisão do dono, 04/11). A página da API fica FORA do
// índice (mantém a busca do Redoc): a A1 não a passa em `paginas`.
//
// CONTRATO para o build.mjs (A1), por locale:
//   const { json, bytes } = indiceDoLocale(paginas)   // paginas: [{slug, titulo, texto}]
//   gravar `assets/busca-<locale>.json` (ou: await gravarIndice(dirDoLocale, locale, paginas))
//   layout({ ..., extraScripts: tagDeBusca({ locale, base }) })
// Copie também `assets/busca.js` para a saída. `base` é o caminho RELATIVO da
// página até a raiz do locale ("", "../", ...); o link do resultado é
// `base + slug + ".html"`. O índice só é baixado quando a pessoa foca o campo
// `[data-busca]`; resultados vão em `[data-busca-lista]`. Nada vem de fora.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Teto: 4000 caracteres de texto por página (~4 KB). Com ~280 páginas por locale
// o índice fica perto de 1 MB (contra ~25 MB do Docusaurus). Corta o fim da página.
export const TETO_DE_TEXTO = 4000;

export const normalizar = (s) =>
  String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function indiceDoLocale(paginas) {
  const itens = paginas.map((p) => ({
    u: p.slug,
    t: p.titulo,
    x: normalizar(`${p.titulo} ${p.texto}`).slice(0, TETO_DE_TEXTO),
  }));
  const json = JSON.stringify(itens);
  return { json, bytes: Buffer.byteLength(json) };
}

export async function gravarIndice(dir, locale, paginas) {
  await mkdir(join(dir, 'assets'), { recursive: true });
  const { json, bytes } = indiceDoLocale(paginas);
  await writeFile(join(dir, 'assets', `busca-${locale}.json`), json);
  return bytes;
}

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function tagDeBusca({ locale, base }) {
  return `<script defer src="${attr(base)}assets/busca.js" data-indice="${attr(base)}assets/busca-${attr(locale)}.json" data-base="${attr(base)}"></script>`;
}
