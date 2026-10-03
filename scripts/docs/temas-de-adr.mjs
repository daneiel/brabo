/**
 * O tema de cada ADR, e o índice agrupado por ele (ADR 0202, AT-137).
 *
 * Por que existe: o índice de ADR era agrupado por FASE, e a fase parou de
 * ajudar — 113 ADRs moravam sob o cabeçalho único `## Phase 12`. A decisão do
 * dono (01/10) foi agrupar por TEMA com o tema FORA do ADR: ADR aceito nunca é
 * editado, nem para ganhar frontmatter, então o mapeamento ADR → tema mora em
 * `docs/adr/temas.yml`, ao lado do índice. Este módulo é a parte que confere.
 *
 * Irmão de `verificarIndiceAdr` (que todo ADR está linkado) e não substituto:
 * aquele pergunta "está no índice?", este pergunta "está no tema certo?".
 *
 * O que reprova:
 *
 *   - LISTA     `temas:` com id ou título repetido, ou id fora de kebab-case.
 *   - SEM-TEMA  ADR em `docs/adr/` sem entrada em `adrs:`.
 *   - TEMA      entrada em `adrs:` cujo tema não está em `temas:`.
 *   - FANTASMA  entrada em `adrs:` para ADR que não existe.
 *   - VAZIO     tema da lista sem nenhum ADR — tema que ninguém usa é
 *               taxonomia inventada.
 *   - SECAO     no índice, a seção `## <titulo> {#tema-<id>}` de um tema
 *               ausente, com título diferente do da lista, fora da ordem da
 *               lista, ou seção `{#tema-x}` de tema que não existe.
 *   - LINHA     no índice, linha de ADR (`| [NNNN](…) |`) sob a seção de outro
 *               tema, fora de qualquer seção de tema, repetida, ou fora da
 *               ordem numérica dentro da seção.
 *
 * E o check cego: YAML ilegível, `temas:` ou `adrs:` vazios, ou nenhuma seção
 * de tema no índice é `CEGO` e reprova — uma aferição que não achou o que
 * aferir fica verde para sempre.
 *
 * Função pura sobre TEXTO e uma lista de nomes de arquivo: o spec ao lado
 * prova cada regra por mutação, sem disco.
 */

import { parse } from 'yaml';

export const TEMAS = 'docs/adr/temas.yml';
export const INDICE = 'docs/adr/index.md';

const ID = /^[a-z][a-z0-9-]*$/;
const SECAO_DE_TEMA = /^##\s+(.+?)\s+\{#tema-([^}\s]+)\}\s*$/;
const LINHA_DE_ADR = /^\|\s*\[(\d{4})\]\(/;

/**
 * @param {{ temasYml: string, arquivosAdr: string[], indice: string }} entrada
 *   `arquivosAdr` são nomes como `0001-x.md` (sem diretório).
 * @returns {{ cego: string|null, problemas: {regra: string, motivo: string}[],
 *   temas: number, adrs: number }}
 */
export function conferirTemas({ temasYml, arquivosAdr, indice }) {
  const problemas = [];
  const falha = (regra, motivo) => problemas.push({ regra, motivo });
  const cego = (motivo) => ({ cego: motivo, problemas: [], temas: 0, adrs: 0 });

  let doc;
  try {
    doc = parse(temasYml);
  } catch (e) {
    return cego(`${TEMAS} não é YAML válido: ${e.message}`);
  }
  const lista = Array.isArray(doc?.temas) ? doc.temas : [];
  const mapa = doc?.adrs && typeof doc.adrs === 'object' ? doc.adrs : {};
  if (lista.length === 0) return cego(`${TEMAS} não tem lista \`temas:\``);
  if (Object.keys(mapa).length === 0) return cego(`${TEMAS} não tem mapa \`adrs:\``);

  // ---- a lista
  const tituloDe = new Map();
  const titulos = new Set();
  for (const t of lista) {
    const id = t?.id;
    const titulo = typeof t?.titulo === 'string' ? t.titulo.trim() : '';
    if (typeof id !== 'string' || !ID.test(id)) {
      falha('LISTA', `tema com id inválido: ${JSON.stringify(id)}`);
      continue;
    }
    if (!titulo) falha('LISTA', `tema \`${id}\` sem título`);
    if (tituloDe.has(id)) falha('LISTA', `tema \`${id}\` repetido`);
    if (titulo && titulos.has(titulo)) falha('LISTA', `título repetido: "${titulo}"`);
    tituloDe.set(id, titulo);
    titulos.add(titulo);
  }

  // ---- o mapa contra os arquivos
  const existentes = new Set(
    arquivosAdr.map((f) => f.slice(0, 4)).filter((n) => /^\d{4}$/.test(n)),
  );
  const temaDe = new Map();
  for (const [numero, tema] of Object.entries(mapa)) {
    const n = String(numero).padStart(4, '0');
    if (!existentes.has(n)) falha('FANTASMA', `${TEMAS} dá tema ao ADR ${n}, que não existe em docs/adr/`);
    if (!tituloDe.has(tema)) falha('TEMA', `ADR ${n} tem tema \`${tema}\`, que não está em \`temas:\``);
    temaDe.set(n, tema);
  }
  for (const n of [...existentes].sort()) {
    if (!temaDe.has(n)) falha('SEM-TEMA', `ADR ${n} não tem tema em ${TEMAS}`);
  }
  const usados = new Set(temaDe.values());
  for (const id of tituloDe.keys()) {
    if (!usados.has(id)) falha('VAZIO', `tema \`${id}\` não tem nenhum ADR`);
  }

  // ---- o índice
  const linhas = indice.split('\n');
  const secoes = [];
  let atual = null;
  const vistos = new Map();
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const s = l.match(SECAO_DE_TEMA);
    if (s) {
      atual = { id: s[2], titulo: s[1].trim(), linha: i + 1, ultimo: null };
      secoes.push(atual);
      continue;
    }
    if (/^##\s/.test(l)) {
      atual = null;
      continue;
    }
    const a = l.match(LINHA_DE_ADR);
    if (!a) continue;
    const n = a[1];
    const onde = `${INDICE}:${i + 1}`;
    if (vistos.has(n)) {
      falha('LINHA', `${onde} — ADR ${n} aparece de novo (primeira em :${vistos.get(n)})`);
      continue;
    }
    vistos.set(n, i + 1);
    if (!atual) {
      falha('LINHA', `${onde} — ADR ${n} está fora de qualquer seção de tema`);
      continue;
    }
    const esperado = temaDe.get(n);
    if (esperado && esperado !== atual.id) {
      falha('LINHA', `${onde} — ADR ${n} está em \`${atual.id}\`, mas o tema dele é \`${esperado}\``);
    }
    if (atual.ultimo && n < atual.ultimo) {
      falha('LINHA', `${onde} — ADR ${n} vem depois do ${atual.ultimo} na seção \`${atual.id}\` (ordem numérica)`);
    }
    atual.ultimo = n;
  }

  if (secoes.length === 0) {
    return cego(`${INDICE} não tem nenhuma seção \`## <título> {#tema-<id>}\``);
  }

  const ordem = [...tituloDe.keys()];
  const idsDasSecoes = secoes.map((s) => s.id);
  for (const s of secoes) {
    if (!tituloDe.has(s.id)) {
      falha('SECAO', `${INDICE}:${s.linha} — seção \`tema-${s.id}\` de tema que não está em \`temas:\``);
    } else if (tituloDe.get(s.id) !== s.titulo) {
      falha('SECAO', `${INDICE}:${s.linha} — seção \`tema-${s.id}\` diz "${s.titulo}", a lista diz "${tituloDe.get(s.id)}"`);
    }
  }
  for (const id of ordem) {
    const vezes = idsDasSecoes.filter((x) => x === id).length;
    if (vezes === 0) falha('SECAO', `${INDICE} não tem a seção do tema \`${id}\``);
    if (vezes > 1) falha('SECAO', `${INDICE} tem ${vezes} seções do tema \`${id}\``);
  }
  const conhecidas = idsDasSecoes.filter((id) => tituloDe.has(id));
  const naOrdem = ordem.filter((id) => conhecidas.includes(id));
  if (new Set(conhecidas).size === conhecidas.length && conhecidas.join() !== naOrdem.join()) {
    falha('SECAO', `${INDICE} — as seções estão fora da ordem de ${TEMAS} (${conhecidas.join(', ')})`);
  }

  return { cego: null, problemas, temas: tituloDe.size, adrs: temaDe.size };
}

/**
 * Lane que acrescenta ADR às vezes escreve `"0209": tema` na COLUNA 0 — o YAML
 * a lê como chave de topo, e o ADR fica SEM-TEMA. Recuo é derivável (é o das
 * outras entradas de `adrs:`), então o `pnpm docs:generate` o acerta (AT-399).
 * Só mexe em linhas DEPOIS de `adrs:`.
 */
export function corrigirRecuo(yml) {
  const linhas = yml.split('\n');
  const inicio = linhas.findIndex((l) => /^adrs:\s*$/.test(l));
  if (inicio < 0) return yml;
  const recuo =
    linhas
      .slice(inicio + 1)
      .map((l) => /^(\s+)"?\d{4}"?:/.exec(l))
      .find(Boolean)?.[1] ?? '  ';
  for (let i = inicio + 1; i < linhas.length; i++) {
    if (/^"?\d{4}"?:/.test(linhas[i])) linhas[i] = recuo + linhas[i];
  }
  return linhas.join('\n');
}
