#!/usr/bin/env node
/**
 * Guarda de renderização da referência de API.
 *
 *   node scripts/docs/api-render-check.mjs [<dir-do-build>]
 *
 * Sem argumento, usa `website/build`. Roda DEPOIS de `pnpm docs:build`.
 *
 * Build verde nunca provou que a página renderiza (a lição do ADR 0033, que
 * custou as releases v1.0.0 e v1.0.1). Desde o ADR 0206 a referência é UMA
 * página Redoc (redocusaurus) com SSR em `reference/api`, e esta guarda afirma
 * sobre o HTML ESTÁTICO, nos dois idiomas:
 *
 *   - a página existe;
 *   - traz o título da spec (`info.title` de `docs/reference/openapi.json`);
 *   - traz, renderada no servidor, UMA seção por operação da spec — o Redoc
 *     emite `data-section-id=tag/<tag>/operation/<id>` para cada uma.
 *
 * ESCOPO, declarado: não abre navegador. Falha de HIDRATAÇÃO do Redoc não é
 * pega aqui; o que é pego é a página sumir, vir vazia ou perder operações.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR_BUILD = resolve(RAIZ, process.argv[2] ?? 'website/build');
const SPEC = JSON.parse(readFileSync(join(RAIZ, 'docs/reference/openapi.json'), 'utf8'));

const METODOS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const esperadas = Object.values(SPEC.paths).reduce(
  (n, item) => n + Object.keys(item).filter((m) => METODOS.has(m)).length,
  0,
);

let falhas = 0;
for (const rel of ['reference/api.html', 'pt-BR/reference/api.html']) {
  const arquivo = join(DIR_BUILD, rel);
  if (!existsSync(arquivo)) {
    console.error(`[api-render] ${rel} não existe no build — a rota /reference/api/ sumiu.`);
    falhas++;
    continue;
  }
  const html = readFileSync(arquivo, 'utf8');
  const temTitulo = html.includes(SPEC.info.title);
  const operacoes = new Set(
    html.match(/data-section-id="?tag\/[^\s">]*\/operation\/[^\s">]+/g) ?? [],
  ).size;
  if (!temTitulo || operacoes < esperadas) {
    console.error(
      `[api-render] ${rel}: título "${SPEC.info.title}" ${temTitulo ? 'presente' : 'AUSENTE'}, ` +
        `${operacoes} de ${esperadas} operações renderizadas no servidor.`,
    );
    falhas++;
  } else {
    console.log(`  ok        ${rel} (${operacoes} operações)`);
  }
}
process.exit(falhas ? 1 : 0);
