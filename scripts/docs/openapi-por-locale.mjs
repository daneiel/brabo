#!/usr/bin/env node
/**
 * A página da API (Redoc) por locale (ADR 0220, AT-565). A fonte das
 * descrições continua sendo o texto dos decorators da api; cada locale tem um
 * CATÁLOGO em `website/i18n/<locale>/openapi-textos.json`, chaveado pelo sha1
 * (12 hex) do texto da fonte: `{ "<hash>": { "fonte": "...", "traducao": "..." } }`.
 *
 * Funções PURAS (o config do site e o `generate.mjs` as chamam) e um comando:
 * `node scripts/docs/openapi-por-locale.mjs <locale>` acrescenta ao catálogo
 * as chaves que faltam, com `traducao: ""`, para a rodada de tradução.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const LOCALES_DA_API = ['pt-BR', 'en', 'ru', 'zh-Hans'];

export const hashDoTexto = (t) => createHash('sha1').update(t).digest('hex').slice(0, 12);

const crases = (t) => (t.match(/`[^`]*`/g) ?? []).length;

/**
 * Heurística do `en` (ADR 0220): o texto está em pt-BR se tem diacrítico do
 * português ou uma palavra funcional que o inglês não usa. Só esses o `en`
 * precisa traduzir; o resto da fonte já é inglês.
 */
export const estaEmPortugues = (t) => /[ãõçáéíóúâêôà]|\b(não|para|uma|quando|com|que)\b/i.test(t);

const tagsUsadas = (spec) => {
  const s = new Set((spec.tags ?? []).map((t) => t.name));
  for (const p of Object.values(spec.paths ?? {})) for (const op of Object.values(p)) for (const t of op?.tags ?? []) s.add(t);
  return [...s];
};

/** Percorre `description`/`summary` em qualquer nível e o nome das tags. */
function visitar(spec, f) {
  const andar = (o) => {
    if (Array.isArray(o)) return o.forEach(andar);
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if ((k === 'description' || k === 'summary') && typeof v === 'string') {
        if (v.trim()) o[k] = f(v);
      } else andar(v);
    }
  };
  andar(spec);
}

/** Textos distintos da fonte, com hash — o que as lanes de tradução usam. */
export function textosDaFonte(spec) {
  const vistos = new Map();
  visitar(structuredClone(spec), (t) => (vistos.set(hashDoTexto(t), t), t));
  for (const t of tagsUsadas(spec)) vistos.set(hashDoTexto(t), t);
  return vistos;
}

/** Entrada que o catálogo não pode ter: hash que não bate com a fonte ou trechos de código diferentes. */
export const entradaInvalida = (hash, e) =>
  typeof e?.fonte !== 'string' ||
  typeof e?.traducao !== 'string' ||
  hashDoTexto(e.fonte) !== hash ||
  (e.traducao !== '' && crases(e.traducao) !== crases(e.fonte));

/** Os textos que o locale precisa traduzir (o `en` só os que estão em pt-BR). */
export const precisaDeTraducao = (locale, texto) => locale !== 'en' || estaEmPortugues(texto);

/**
 * Aplica o catálogo: devolve a spec traduzida (nova), os hashes faltando
 * (sem tradução válida — o texto fica o da fonte), as órfãs (hash que a spec
 * não tem mais) e as inválidas (que também caem na fonte).
 */
export function aplicar(spec, catalogo) {
  const fonte = textosDaFonte(spec);
  const ok = (h) => catalogo[h] && !entradaInvalida(h, catalogo[h]) && catalogo[h].traducao !== '';
  const faltando = [...fonte.keys()].filter((h) => !ok(h));
  const orfas = Object.keys(catalogo).filter((h) => !fonte.has(h));
  const invalidas = Object.keys(catalogo).filter((h) => entradaInvalida(h, catalogo[h]));
  const traduzir = (t) => (ok(hashDoTexto(t)) ? catalogo[hashDoTexto(t)].traducao : t);
  const saida = structuredClone(spec);
  visitar(saida, traduzir);
  // O NOME da tag não muda (a âncora `#tag/<nome>` fica); só o rótulo exibido.
  const existentes = new Map((saida.tags ?? []).map((t) => [t.name, t]));
  saida.tags = tagsUsadas(spec).map((name) => ({ ...existentes.get(name), name, 'x-displayName': traduzir(name) }));
  return { spec: saida, faltando, orfas, invalidas };
}

/** `N de M` por locale: M = textos que precisam de tradução nele, N = os traduzidos. */
export function medirApi(spec, catalogos) {
  const fonte = textosDaFonte(spec);
  const out = {};
  for (const loc of LOCALES_DA_API) {
    const cat = catalogos[loc] ?? {};
    const precisam = [...fonte].filter(([, t]) => precisaDeTraducao(loc, t));
    const traduzidos = precisam.filter(([h]) => cat[h] && !entradaInvalida(h, cat[h]) && cat[h].traducao !== '').length;
    out[loc] = { traduzidos, total: precisam.length };
  }
  return out;
}

/**
 * Os 18 rótulos que o Redoc 2.4.0 aceita em `LabelsConfig`; o resto do texto
 * fixo dele fica em inglês (ADR 0220).
 */
export const ROTULOS_DO_REDOC = {
  'pt-BR': {
    enum: 'Valores',
    enumSingleValue: 'Valor',
    enumArray: 'Itens',
    default: 'Padrão',
    deprecated: 'Obsoleto',
    example: 'Exemplo',
    examples: 'Exemplos',
    recursive: 'Recursivo',
    arrayOf: 'Lista de ',
    webhook: 'Evento',
    const: 'Valor',
    noResultsFound: 'Nenhum resultado',
    download: 'Baixar',
    downloadSpecification: 'Baixar a especificação OpenAPI',
    responses: 'Respostas',
    callbackResponses: 'Respostas do callback',
    requestSamples: 'Exemplos de requisição',
    responseSamples: 'Exemplos de resposta',
  },
  en: {
    enum: 'Enum',
    enumSingleValue: 'Value',
    enumArray: 'Items',
    default: 'Default',
    deprecated: 'Deprecated',
    example: 'Example',
    examples: 'Examples',
    recursive: 'Recursive',
    arrayOf: 'Array of ',
    webhook: 'Event',
    const: 'Value',
    noResultsFound: 'No results found',
    download: 'Download',
    downloadSpecification: 'Download OpenAPI specification',
    responses: 'Responses',
    callbackResponses: 'Callback responses',
    requestSamples: 'Request samples',
    responseSamples: 'Response samples',
  },
  ru: {
    enum: 'Перечисление',
    enumSingleValue: 'Значение',
    enumArray: 'Элементы',
    default: 'По умолчанию',
    deprecated: 'Устарело',
    example: 'Пример',
    examples: 'Примеры',
    recursive: 'Рекурсивно',
    arrayOf: 'Массив из ',
    webhook: 'Событие',
    const: 'Значение',
    noResultsFound: 'Ничего не найдено',
    download: 'Скачать',
    downloadSpecification: 'Скачать спецификацию OpenAPI',
    responses: 'Ответы',
    callbackResponses: 'Ответы callback',
    requestSamples: 'Примеры запросов',
    responseSamples: 'Примеры ответов',
  },
  'zh-Hans': {
    enum: '枚举',
    enumSingleValue: '值',
    enumArray: '项',
    default: '默认值',
    deprecated: '已弃用',
    example: '示例',
    examples: '示例',
    recursive: '递归',
    arrayOf: '数组：',
    webhook: '事件',
    const: '值',
    noResultsFound: '未找到结果',
    download: '下载',
    downloadSpecification: '下载 OpenAPI 规范',
    responses: '响应',
    callbackResponses: '回调响应',
    requestSamples: '请求示例',
    responseSamples: '响应示例',
  },
};

/** Rótulo faltando ou sobrando num locale, contra o `en`. Vazio = em dia. */
export const rotulosFaltando = (rotulos) => {
  const base = Object.keys(rotulos.en);
  return LOCALES_DA_API.flatMap((l) => [
    ...base.filter((k) => typeof rotulos[l]?.[k] !== 'string').map((k) => `${l}.${k}`),
    ...Object.keys(rotulos[l] ?? {}).filter((k) => !base.includes(k)).map((k) => `${l}.${k} (sobra)`),
  ]);
};

export const caminhoDoCatalogo = (raiz, locale) => join(raiz, 'website/i18n', locale, 'openapi-textos.json');

export const lerCatalogo = (raiz, locale) => {
  const p = caminhoDoCatalogo(raiz, locale);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
};

// Comando: acrescenta as chaves que faltam ao catálogo do locale, com `traducao: ""`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const locale = process.argv[2];
  if (!LOCALES_DA_API.includes(locale)) {
    console.error(`uso: pnpm docs:openapi-textos <${LOCALES_DA_API.join('|')}>`);
    process.exit(2);
  }
  const raiz = join(import.meta.dirname, '../..');
  const spec = JSON.parse(readFileSync(join(raiz, 'docs/reference/openapi.json'), 'utf8'));
  const cat = lerCatalogo(raiz, locale);
  let n = 0;
  for (const [h, t] of textosDaFonte(spec)) {
    if (cat[h] || !precisaDeTraducao(locale, t)) continue;
    cat[h] = { fonte: t, traducao: '' };
    n++;
  }
  writeFileSync(caminhoDoCatalogo(raiz, locale), JSON.stringify(cat, null, 2) + '\n');
  console.log(`${locale}: ${n} chaves novas com traducao "" em ${caminhoDoCatalogo(raiz, locale)}`);
}
