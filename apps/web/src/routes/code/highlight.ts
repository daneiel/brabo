/**
 * Realce de sintaxe da aba Code — FASE 26, item 35.
 *
 * **Sem dependência nova**, e a justificativa é literal: 0 bytes de bundle
 * contra os ~15-90 KB de Prism/highlight.js/Shiki para cobrir o que a aba
 * precisa (ler, não escrever). Está documentada também no PR.
 *
 * É heurística por REGEX, não um parser: casos ambíguos (regex literal,
 * template literal aninhado, string dentro de comentário mal formado) podem
 * colorir errado. Aceitável para leitura — a aba nunca escreve, então um
 * token mal pintado não tem efeito além do visual.
 *
 * Suporta comentário de bloco (estilo C) com um bit de estado entre linhas —
 * o mínimo para JS/TS/CSS não vazarem cor de comentário pro resto do arquivo.
 * Python/Elixir não têm comentário de bloco (usam `#`), então não precisam
 * do estado.
 */

export type TokenKind =
  | 'keyword'
  | 'function'
  | 'string'
  | 'number'
  | 'comment'
  | 'type'
  | 'operator'
  | 'text';

export interface HighlightToken {
  text: string;
  kind: TokenKind;
}

const PALAVRAS_BASE = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'class', 'extends',
  'implements', 'new', 'try', 'catch', 'finally', 'throw', 'import',
  'export', 'from', 'as', 'default', 'async', 'await', 'yield', 'typeof',
  'instanceof', 'in', 'of', 'void', 'delete', 'true', 'false', 'null',
  'undefined', 'this', 'super', 'static', 'get', 'set',
];

const PALAVRAS_TS = [
  ...PALAVRAS_BASE,
  'interface', 'type', 'enum', 'namespace', 'declare', 'readonly', 'public',
  'private', 'protected', 'abstract', 'satisfies', 'keyof', 'infer',
];

const PALAVRAS_PY = [
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue',
  'class', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise',
  'with', 'lambda', 'yield', 'async', 'await', 'pass', 'global', 'nonlocal',
  'del', 'True', 'False', 'None', 'self', 'and', 'or', 'not', 'in', 'is',
];

const PALAVRAS_EX = [
  'def', 'defp', 'defmodule', 'defmacro', 'do', 'end', 'if', 'else',
  'unless', 'case', 'cond', 'fn', 'when', 'import', 'alias', 'require',
  'use', 'true', 'false', 'nil', 'and', 'or', 'not', 'in', 'rescue',
  'catch', 'after', 'with',
];

const PALAVRAS_POR_LINGUAGEM: Record<string, readonly string[]> = {
  ts: PALAVRAS_TS,
  tsx: PALAVRAS_TS,
  js: PALAVRAS_BASE,
  jsx: PALAVRAS_BASE,
  mjs: PALAVRAS_BASE,
  cjs: PALAVRAS_BASE,
  py: PALAVRAS_PY,
  ex: PALAVRAS_EX,
  exs: PALAVRAS_EX,
};

const TIPOS = new Set([
  'string', 'number', 'boolean', 'void', 'any', 'unknown', 'never',
  'object', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Promise',
  'Map', 'Set', 'Record', 'Partial', 'Readonly', 'int', 'float', 'bool',
  'str', 'dict', 'list', 'tuple',
]);

/** Comentário de LINHA por extensão. `null` = a linguagem não tem, ou é dado (json). */
const COMENTARIO_DE_LINHA: Record<string, string | null> = {
  json: null,
  ts: '//', tsx: '//', js: '//', jsx: '//', mjs: '//', cjs: '//',
  css: null, scss: '//',
  py: '#', ex: '#', exs: '#', sh: '#', bash: '#', yml: '#', yaml: '#',
  rb: '#', toml: '#',
};

const SUPORTA_COMENTARIO_DE_BLOCO = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'scss', 'c', 'h', 'java',
  'go', 'rs',
]);

/** A extensão do caminho, minúscula — é o que decide o dialeto. */
export function linguagemPorCaminho(path: string): string {
  const semDiretorio = path.split('/').pop() ?? path;
  const ponto = semDiretorio.lastIndexOf('.');
  return ponto === -1 ? '' : semDiretorio.slice(ponto + 1).toLowerCase();
}

const TOKEN_RE =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\d+(?:\.\d+)?)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+)|(.)/;

export interface ResultadoDeLinha {
  tokens: HighlightToken[];
  /** Estado a passar para `highlightLine` da PRÓXIMA linha. */
  comentarioDeBloco: boolean;
}

/**
 * Tokeniza UMA linha. `emComentarioDeBloco` é o estado que a linha anterior
 * devolveu — a linha 1 do arquivo sempre começa com `false`.
 */
export function highlightLine(
  line: string,
  lang: string,
  emComentarioDeBloco = false,
): ResultadoDeLinha {
  const tokens: HighlightToken[] = [];
  const keywords = new Set(PALAVRAS_POR_LINGUAGEM[lang] ?? PALAVRAS_BASE);
  const comentarioDeLinha =
    lang in COMENTARIO_DE_LINHA ? COMENTARIO_DE_LINHA[lang] : '//';
  const suportaBloco = SUPORTA_COMENTARIO_DE_BLOCO.has(lang);

  let resto = line;
  let dentroDeBloco = emComentarioDeBloco;

  while (resto.length > 0) {
    if (dentroDeBloco) {
      const fim = resto.indexOf('*/');
      if (fim === -1) {
        tokens.push({ text: resto, kind: 'comment' });
        resto = '';
        break;
      }
      tokens.push({ text: resto.slice(0, fim + 2), kind: 'comment' });
      resto = resto.slice(fim + 2);
      dentroDeBloco = false;
      continue;
    }

    if (suportaBloco && resto.startsWith('/*')) {
      const fim = resto.indexOf('*/', 2);
      if (fim === -1) {
        tokens.push({ text: resto, kind: 'comment' });
        dentroDeBloco = true;
        resto = '';
        break;
      }
      tokens.push({ text: resto.slice(0, fim + 2), kind: 'comment' });
      resto = resto.slice(fim + 2);
      continue;
    }

    if (comentarioDeLinha && resto.startsWith(comentarioDeLinha)) {
      tokens.push({ text: resto, kind: 'comment' });
      resto = '';
      break;
    }

    const m = TOKEN_RE.exec(resto);
    if (!m) {
      tokens.push({ text: resto, kind: 'text' });
      break;
    }
    const consumido = m[0];
    resto = resto.slice(consumido.length);

    if (m[1]) {
      tokens.push({ text: consumido, kind: 'string' });
    } else if (m[2]) {
      tokens.push({ text: consumido, kind: 'number' });
    } else if (m[3]) {
      if (keywords.has(consumido)) tokens.push({ text: consumido, kind: 'keyword' });
      else if (TIPOS.has(consumido)) tokens.push({ text: consumido, kind: 'type' });
      else if (resto.startsWith('(')) tokens.push({ text: consumido, kind: 'function' });
      else tokens.push({ text: consumido, kind: 'text' });
    } else if (m[4]) {
      tokens.push({ text: consumido, kind: 'text' });
    } else {
      tokens.push({ text: consumido, kind: 'operator' });
    }
  }

  return { tokens, comentarioDeBloco: dentroDeBloco };
}

/** Tokeniza o arquivo inteiro, linha a linha, carregando o estado de bloco. */
export function highlightFile(content: string, lang: string): HighlightToken[][] {
  const linhas = content.split('\n');
  const resultado: HighlightToken[][] = [];
  let emBloco = false;
  for (const linha of linhas) {
    const { tokens, comentarioDeBloco } = highlightLine(linha, lang, emBloco);
    resultado.push(tokens);
    emBloco = comentarioDeBloco;
  }
  return resultado;
}
