/**
 * Minimapa da aba Code — PROGRAMA 28, Onda 4, frente E2 (RN-239..242).
 *
 * O handoff (`design_handoff_brabo/README.md:273`) pede overlay de 64px,
 * `position: relative` no container e scroller absoluto — a parte NOVA
 * dele, porque a virtualização (`CodeEditor.tsx`) já resolve o resto.
 *
 * **Sem tokenizer novo**: este módulo NÃO tokeniza nada — ele resume a saída
 * que `highlight.ts` já produziu (`HighlightToken[][]` de `highlightFile`),
 * a MESMA que a virtualização usa para colorir as linhas visíveis. Tokenizar
 * de novo só para o minimapa seria pagar o custo de leitura do arquivo pela
 * segunda vez — exatamente o que a ordem virtualização-antes-de-minimapa
 * existe para evitar (ver comentário em `CodeEditor.tsx`).
 *
 * O desenho é em CANVAS, não em `<div>` por linha: um nó de DOM só, qualquer
 * que seja o tamanho do arquivo. Um minimapa com um elemento por linha
 * dobraria de novo a contagem de nós que a virtualização acabou de cortar.
 */

import type { HighlightToken, TokenKind } from './highlight';

export interface MinimapLine {
  /** 0 = linha sem conteúdo visível (só espaço). Senão, 0..1, já escalado e limitado. */
  width: number;
  kind: TokenKind | 'empty';
}

const LARGURA_MIN = 0.12;
const LARGURA_MAX = 1;
/** Comprimento de linha (em caracteres) que já satura a barra do minimapa. */
const COMPRIMENTO_DE_SATURACAO = 80;

/**
 * Resume cada linha já tokenizada num par largura/tipo dominante — sem
 * reprocessar texto. Dominante é o tipo com mais CARACTERES na linha (não o
 * mais frequente em número de tokens), para um operador de 1 caractere não
 * pintar a linha inteira da cor dele.
 */
export function buildMinimapData(linhas: HighlightToken[][]): MinimapLine[] {
  return linhas.map((tokens) => {
    let total = 0;
    const porTipo = new Map<TokenKind, number>();
    for (const tok of tokens) {
      if (tok.text.trim().length === 0) continue;
      total += tok.text.length;
      porTipo.set(tok.kind, (porTipo.get(tok.kind) ?? 0) + tok.text.length);
    }
    if (total === 0) return { width: 0, kind: 'empty' };

    let dominante: TokenKind = 'text';
    let max = -1;
    for (const [kind, len] of porTipo) {
      if (len > max) {
        max = len;
        dominante = kind;
      }
    }
    const width = Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, total / COMPRIMENTO_DE_SATURACAO));
    return { width, kind: dominante };
  });
}

export type CoresDoMinimapa = Record<TokenKind | 'empty', string>;

/**
 * Lê as cores do tema ATIVO via `getComputedStyle`, nunca hardcoded — os
 * mesmos `--syntax-*` que `CodeEditor.module.css` usa para as linhas reais
 * (`design/tokens.css`), então claro/escuro (RN-182..185) resolvem sozinhos.
 * Fallback cinza só entra se a variável não existir (tema desconhecido).
 */
export function resolverCoresDoMinimapa(elemento: Element): CoresDoMinimapa {
  const estilo = getComputedStyle(elemento);
  const ler = (nome: string, fallback: string) => {
    const valor = estilo.getPropertyValue(nome).trim();
    return valor.length > 0 ? valor : fallback;
  };
  return {
    keyword: ler('--syntax-keyword', '#8a8a8a'),
    function: ler('--syntax-function', '#8a8a8a'),
    string: ler('--syntax-string', '#8a8a8a'),
    number: ler('--syntax-number', '#8a8a8a'),
    comment: ler('--syntax-comment', '#6b6b6b'),
    type: ler('--syntax-type', '#8a8a8a'),
    operator: ler('--syntax-operator', '#8a8a8a'),
    text: ler('--border-strong', '#8a8a8a'),
    empty: 'transparent',
  };
}

/** Desenha o resumo num canvas já dimensionado (em pixels CSS, não de device). */
export function desenharMinimapa(
  ctx: CanvasRenderingContext2D,
  linhas: readonly MinimapLine[],
  dims: { width: number; height: number },
  cores: CoresDoMinimapa,
): void {
  ctx.clearRect(0, 0, dims.width, dims.height);
  if (linhas.length === 0 || dims.height <= 0) return;

  const alturaLinha = dims.height / linhas.length;
  const larguraUtil = dims.width - 8;
  linhas.forEach((linha, i) => {
    if (linha.kind === 'empty') return;
    ctx.fillStyle = cores[linha.kind];
    const y = i * alturaLinha;
    const w = Math.max(2, linha.width * larguraUtil);
    ctx.fillRect(4, y, w, Math.max(1, alturaLinha - 0.4));
  });
}

/**
 * Converte um clique no minimapa (offset Y dentro do overlay) na linha do
 * arquivo a que ele corresponde — proporcional, já que o desenho comprime
 * TODAS as linhas na altura disponível.
 */
export function linhaNoOffsetY(offsetY: number, alturaTotal: number, totalLinhas: number): number {
  if (totalLinhas <= 0 || alturaTotal <= 0) return 0;
  const proporcao = Math.min(1, Math.max(0, offsetY / alturaTotal));
  return Math.min(totalLinhas - 1, Math.floor(proporcao * totalLinhas));
}
