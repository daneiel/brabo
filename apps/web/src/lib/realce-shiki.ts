/**
 * Único ponto de contato com o `shiki` (AT-657, RN-972, ADR 0234): `import()`
 * dinâmico, motor de regex em JS (sem WASM) e gramática sob demanda, no molde
 * de `mermaid-render.ts`. Devolve o MESMO `HighlightToken[][]` do realce por
 * regex (`routes/code/highlight.ts`), então virtualização e minimapa não mudam.
 * `null` = linguagem sem gramática ou falha: o chamador fica com a regex.
 */
import type { HighlightToken, TokenKind } from '../routes/code/highlight';
import { COR_POR_PAPEL, temaShikiBrabo } from './tema-shiki-brabo';

const GRAMATICA = {
  bash: () => import('shiki/langs/bash.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  elixir: () => import('shiki/langs/elixir.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
} as const;

const ALIAS: Record<string, keyof typeof GRAMATICA> = {
  sh: 'bash', shell: 'bash', zsh: 'bash',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', ex: 'elixir', exs: 'elixir', yml: 'yaml', md: 'markdown',
};

export function linguagemDoShiki(lang: string): keyof typeof GRAMATICA | null {
  const l = lang.trim().toLowerCase();
  const nome = ALIAS[l] ?? l;
  return Object.hasOwn(GRAMATICA, nome) ? (nome as keyof typeof GRAMATICA) : null;
}

const KIND_POR_COR = new Map<string, TokenKind>(
  Object.entries(COR_POR_PAPEL).map(([kind, cor]) => [cor, kind as TokenKind]),
);

type Realcador = import('shiki/core').HighlighterCore;
let realcador: Promise<Realcador> | null = null;

function carregarNucleo(): Promise<Realcador> {
  realcador ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(
    ([core, motor]) =>
      core.createHighlighterCore({
        themes: [temaShikiBrabo as never],
        langs: [],
        engine: motor.createJavaScriptRegexEngine({ forgiving: true }),
      }),
  );
  return realcador;
}

export async function carregarRealce(
  content: string,
  lang: string,
): Promise<HighlightToken[][] | null> {
  const nome = linguagemDoShiki(lang);
  if (!nome) return null;
  try {
    const hl = await carregarNucleo();
    if (!hl.getLoadedLanguages().includes(nome)) await hl.loadLanguage(GRAMATICA[nome]());
    const { tokens } = hl.codeToTokens(content, { lang: nome, theme: 'brabo' });
    return tokens.map((linha) =>
      linha.map((t) => ({ text: t.content, kind: KIND_POR_COR.get(t.color ?? '') ?? 'text' })),
    );
  } catch {
    realcador = null;
    return null;
  }
}
