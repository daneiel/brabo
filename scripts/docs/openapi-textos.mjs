#!/usr/bin/env node
/**
 * `pnpm docs:openapi-textos <locale>` (ADR 0220): acrescenta ao catálogo do
 * locale as chaves que faltam, com `traducao: ""`, para a rodada de tradução.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { caminhoDoCatalogo, lerCatalogo, LOCALES_DA_API, precisaDeTraducao, textosDaFonte } from './openapi-por-locale.mjs';

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
