#!/usr/bin/env node
/**
 * Checador de links e guardas do site novo (AT-662, lane A5):
 *   node scripts/docs/site/links.mjs [<dir-do-build>]   (padrão: build/docs-site)
 *
 *  - todo href/src relativo aponta para arquivo que existe no build;
 *  - todo `#fragmento` existe como id="…" (ou name="…") na página de destino;
 *  - nada de fora carrega: sem http(s):// em <script src>, <link href> ou @import de CSS
 *    (links de navegação externos em <a> ficam de fora).
 * Só lê o HTML estático; não abre navegador.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pendências CONHECIDAS, declaradas: destinos que ainda não existem. Sai quando a A3 (referência da API) entrar. */
export const PENDENTES = ['reference/api'];

/** RNs que as traduções ainda não trazem (defasagem de tradução, não link quebrado do gerador); só valem fora do pt-BR. Saem quando o lote de tradução as cobrir. */
export const RNS_SEM_TRADUCAO = ['rn-907', 'rn-914', 'rn-915', 'rn-917', 'rn-918', 'rn-924', 'rn-928', 'rn-929', 'rn-930', 'rn-950', 'rn-952'];

const arquivosDe = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? arquivosDe(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

const idsDe = (html) => new Set([...html.matchAll(/\s(?:id|name)="([^"]*)"/g)].map((m) => m[1]));
const decodificar = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"');

export function verificarLinks(dir, { pendentes = PENDENTES, rnsPendentes = RNS_SEM_TRADUCAO } = {}) {
  const htmls = arquivosDe(dir).filter((f) => f.endsWith('.html'));
  const cache = new Map();
  const idsDoArquivo = (f) => {
    if (!cache.has(f)) cache.set(f, idsDe(readFileSync(f, 'utf8')));
    return cache.get(f);
  };
  const r = { paginas: htmls.length, links: 0, ancoras: 0, erros: [], pendentes: [] };
  for (const arq of htmls) {
    const rel = path.relative(dir, arq);
    const html = readFileSync(arq, 'utf8');
    for (const m of html.matchAll(/<(?:a|link|script|img)\b[^>]*?\s(?:href|src)="([^"]*)"/g)) {
      const ref = decodificar(m[1]);
      if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue; // externo/mailto/data: é de outra guarda
      const [caminho, frag] = ref.replace(/\?[^#]*/, '').split('#');
      let alvo = caminho ? path.resolve(path.dirname(arq), caminho) : arq;
      if (existsSync(alvo) && statSync(alvo).isDirectory()) alvo = path.join(alvo, 'index.html');
      r.links++;
      const relAlvo = path.relative(dir, alvo).replace(/^(?:en|ru|zh-Hans)\//, '');
      if (!existsSync(alvo)) {
        const pend = pendentes.some((p) => relAlvo === p || relAlvo.startsWith(`${p}/`) || relAlvo.startsWith(`${p}.`));
        (pend ? r.pendentes : r.erros).push(`${rel}: link quebrado -> ${ref}`);
        continue;
      }
      if (frag && alvo.endsWith('.html')) {
        r.ancoras++;
        const f = decodeURIComponent(frag);
        if (!idsDoArquivo(alvo).has(f)) {
          const traduzido = /^(?:en|ru|zh-Hans)\//.test(rel);
          (traduzido && rnsPendentes.includes(f) ? r.pendentes : r.erros).push(`${rel}: âncora quebrada -> ${ref}`);
        }
      }
    }
  }
  return r;
}

/** Tudo que o navegador BUSCA sozinho e não pode vir de fora. */
export function carregaDeFora(dir) {
  const achados = [];
  const ext = /^(?:https?:)?\/\//i;
  const importa = /@import\s+(?:url\()?['"]?((?:https?:)?\/\/[^'")\s]+)/g;
  for (const arq of arquivosDe(dir)) {
    const rel = path.relative(dir, arq);
    if (arq.endsWith('.html')) {
      const h = readFileSync(arq, 'utf8');
      for (const m of h.matchAll(/<script\b[^>]*?\ssrc="([^"]*)"/g)) if (ext.test(m[1])) achados.push(`${rel}: <script src> ${m[1]}`);
      for (const m of h.matchAll(/<link\b[^>]*?\shref="([^"]*)"/g)) if (ext.test(m[1])) achados.push(`${rel}: <link href> ${m[1]}`);
      for (const m of h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) for (const i of m[1].matchAll(importa)) achados.push(`${rel}: @import ${i[1]}`);
    } else if (arq.endsWith('.css')) {
      for (const i of readFileSync(arq, 'utf8').matchAll(importa)) achados.push(`${rel}: @import ${i[1]}`);
    }
  }
  return achados;
}

function main() {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const dir = path.resolve(process.argv[2] ?? path.join(raiz, 'build/docs-site'));
  if (!existsSync(dir)) { console.error(`links: o build não existe em ${dir} — rode \`pnpm docs:site\`.`); process.exit(2); }
  const r = verificarLinks(dir);
  if (r.paginas === 0) { console.error(`links: CEGO — nenhum .html em ${dir}.`); process.exit(2); }
  const fora = carregaDeFora(dir);
  console.log(`links: ${r.paginas} páginas, ${r.links} links, ${r.ancoras} âncoras verificados.`);
  if (r.pendentes.length) console.log(`links: ${r.pendentes.length} pendência(s) DECLARADA(S) (${PENDENTES.join(', ')} até a A3; RNs sem tradução: ${RNS_SEM_TRADUCAO.join(', ')}).`);
  for (const e of [...r.erros, ...fora]) console.error(`  ${e}`);
  if (r.erros.length || fora.length) { console.error(`links: ${r.erros.length} link(s)/âncora(s) quebrados, ${fora.length} recurso(s) de fora.`); process.exit(1); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
