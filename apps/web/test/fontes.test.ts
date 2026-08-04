import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * As três fontes do design system carregam DE VERDADE (ADR 0036).
 *
 * A regressão que este arquivo existe para pegar já aconteceu, e passou meses em
 * produção sem ninguém ver: `index.html` puxava Space Grotesk, Archivo e IBM
 * Plex Mono do Google Fonts, e a CSP do nginx
 * (`style-src 'self' 'unsafe-inline'; font-src 'self' data:`) bloqueava tanto a
 * folha quanto os arquivos. As três caíam em fonte de sistema. Como
 * `--font-heading` e `--font-body` compartilham o fallback `sans-serif`, a
 * distinção tipográfica entre título e corpo simplesmente não existia — e
 * `font-synthesis: none` impedia até o peso 700 de ser sintetizado.
 *
 * Era invisível em `pnpm dev`, onde não há nginx. Por isso o teste é aqui, no
 * nível dos ARQUIVOS: sob jsdom não há como provar fonte renderizada
 * (`getComputedStyle` não resolve `var()` de um `@import`, e não existe motor de
 * texto), então afirmar sobre pixel seria teatro. O que se prova é o que de fato
 * quebrou: que todo `url()` declarado tem arquivo no disco, e que nada volta a
 * apontar para um CDN que a CSP recusa.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_WEB = resolve(AQUI, '..');

// As `@font-face` moram em `src/fonts.css` desde que o design-sync passou a
// montar o bundle a partir do `index.css` — um `url('/fonts/…')` derruba o
// esbuild. O `index.css` segue com tokens, reset e keyframes.
const indexCss = readFileSync(resolve(RAIZ_WEB, 'src/fonts.css'), 'utf8');
const indexHtml = readFileSync(resolve(RAIZ_WEB, 'index.html'), 'utf8');

/** Os blocos `@font-face` do index.css, um objeto por bloco. */
function blocosDeFontFace(css: string) {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, corpo]) => ({
    familia: /font-family:\s*'([^']+)'/.exec(corpo)?.[1],
    peso: /font-weight:\s*([^;]+);/.exec(corpo)?.[1].trim(),
    display: /font-display:\s*([^;]+);/.exec(corpo)?.[1].trim(),
    url: /url\('([^']+)'\)/.exec(corpo)?.[1],
    formato: /format\('([^']+)'\)/.exec(corpo)?.[1],
    range: /unicode-range:/.test(corpo),
  }));
}

const blocos = blocosDeFontFace(indexCss);

describe('fontes auto-hospedadas', () => {
  it('declara @font-face para as três famílias', () => {
    const familias = new Set(blocos.map((b) => b.familia));
    expect(familias).toEqual(
      new Set(['Space Grotesk', 'Archivo', 'IBM Plex Mono']),
    );
  });

  it('todo url() tem arquivo no disco', () => {
    // O coração do teste. Um `@font-face` apontando para arquivo inexistente
    // falha exatamente como o CDN bloqueado falhava: silenciosamente, com
    // fallback de sistema.
    expect(blocos.length).toBeGreaterThan(0);

    const ausentes = blocos
      .map((b) => b.url!)
      .filter((url) => !existsSync(resolve(RAIZ_WEB, 'public', url.slice(1))));

    expect(ausentes).toEqual([]);
  });

  it('todos os arquivos são woff2 de verdade', () => {
    // Assinatura `wOF2`. Um arquivo truncado no download, ou um HTML de erro
    // salvo com extensão .woff2, passaria no teste de existência.
    for (const { url, formato } of blocos) {
      expect(formato).toBe('woff2');
      const bytes = readFileSync(resolve(RAIZ_WEB, 'public', url!.slice(1)));
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
    }
  });

  it('cada bloco tem font-display: swap e unicode-range', () => {
    // `swap` para o texto aparecer antes da fonte; `unicode-range` para o
    // browser só baixar o subset que a página usa.
    for (const b of blocos) {
      expect(b.display).toBe('swap');
      expect(b.range).toBe(true);
    }
  });

  it('Space Grotesk e Archivo declaram FAIXA de peso; IBM Plex Mono, peso único', () => {
    // Verificado decodificando a tabela de diretório do woff2: as duas
    // primeiras têm `fvar` (são variáveis, um arquivo cobre a faixa), a terceira
    // não. Declarar faixa numa fonte estática renderizaria todos os pesos iguais
    // — em silêncio, por causa do `font-synthesis: none`.
    const peso = (familia: string) =>
      new Set(blocos.filter((b) => b.familia === familia).map((b) => b.peso));

    expect(peso('Space Grotesk')).toEqual(new Set(['500 700']));
    expect(peso('Archivo')).toEqual(new Set(['400 600']));
    expect(peso('IBM Plex Mono')).toEqual(new Set(['400', '500']));
  });
});

describe('nada volta a depender de CDN de fonte', () => {
  it.each(['fonts.googleapis.com', 'fonts.gstatic.com'])(
    'index.html não referencia %s',
    (host) => {
      // A CSP do nginx recusa os dois. Voltar a referenciá-los reintroduz
      // exatamente o defeito, e de novo só em produção.
      const semComentarios = indexHtml.replace(/<!--[\s\S]*?-->/g, '');
      expect(semComentarios).not.toContain(host);
    },
  );

  it('index.css não usa @import de fonte remota', () => {
    const remotos = [...indexCss.matchAll(/@import\s+(?:url\()?['"]?(https?:[^'")\s]+)/g)];
    expect(remotos.map((m) => m[1])).toEqual([]);
  });

  it('todo src de @font-face é caminho local', () => {
    for (const { url } of blocos) {
      expect(url).toMatch(/^\/fonts\//);
    }
  });

  /**
   * A folha só vale se a app a carregar. Separar as `@font-face` do
   * `index.css` foi o que quebrou este teste uma vez; sem esta asserção, um
   * import esquecido no `main.tsx` deixaria as três famílias declaradas e
   * nunca aplicadas — o mesmo sintoma do ADR 0036, por outra porta.
   */
  it('o main.tsx importa a folha de fontes', () => {
    const main = readFileSync(resolve(RAIZ_WEB, 'src/main.tsx'), 'utf8');
    expect(main).toContain("import './fonts.css'");
  });
});
