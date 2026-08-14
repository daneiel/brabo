/**
 * Markdown leve do chat (RN-158) — parser PRÓPRIO por regex, mesma filosofia
 * de `routes/code/highlight.ts` ("0 bytes de bundle" contra uma lib de
 * Markdown de verdade): heurística, não um parser completo da spec
 * CommonMark. Cobre o que `agent.response` produz na prática — negrito,
 * itálico, código inline, cabeçalho, lista e fence de código — e degrada
 * para texto simples no que não reconhece, nunca para uma exceção.
 *
 * **Segurança**: o texto vem de um LLM, tratado como conteúdo NÃO confiável.
 * Este módulo só devolve uma árvore de DADOS (`MdBlock[]`) — nenhuma string
 * de HTML, nenhum `dangerouslySetInnerHTML`. Quem converte a árvore em React
 * (`components/ui/MarkdownMessage.tsx`) monta elementos diretamente; o React
 * escapa todo texto por padrão, e a única superfície de risco real — o
 * `href` de um link — é filtrada aqui mesmo, por `urlSegura`, antes de a
 * árvore sair do parser.
 */

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string };

/** Alinhamento declarado na linha separadora de uma tabela (`:---`, `:-:`,
 *  `---:`). Sem os dois-pontos, `left` — o mesmo default do CommonMark. */
export type MdAlinhamento = 'left' | 'center' | 'right';

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; inline: MdInline[] }
  | { type: 'paragraph'; inline: MdInline[] }
  | { type: 'list'; ordered: boolean; items: MdInline[][] }
  | { type: 'code'; lang: string; content: string }
  /**
   * Tabela GFM (RN-176). `header` tem uma entrada por COLUNA e é ela que
   * define quantas colunas a tabela tem — toda linha de `rows` é normalizada
   * para esse tamanho no parser, então quem renderiza nunca precisa checar
   * comprimento (linha curta ganha célula vazia, linha longa perde o excesso).
   */
  | {
      type: 'table';
      header: MdInline[][];
      aligns: MdAlinhamento[];
      rows: MdInline[][][];
    };

/**
 * Esquemas aceitos para um link virar `<a>` clicável — `http(s)` e caminho
 * relativo (`/…`) ou âncora (`#…`). Qualquer outro (`javascript:`, `data:`,
 * `vbscript:`…) degrada para o TEXTO do link, nunca vira `href`: é o que
 * fecha a única porta de XSS que um parser de Markdown costuma abrir.
 */
export function urlSegura(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('#');
}

// O grupo da URL aceita UM nível de parênteses balanceados
// (`\([^()]*\)` aninhado) — sem isso, uma URL com `(`/`)` (comum em link de
// Wikipedia, e também no exemplo malicioso `javascript:alert(1)` que o teste
// de XSS usa) cortava no primeiro `)` e sobrava um `)` solto como texto
// depois do link.
const INLINE_RE =
  /\*\*((?:[^*]|\*(?!\*))+?)\*\*|\*([^*\n]+?)\*|_([^_\n]+?)_|`([^`\n]+?)`|\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))+)\)/;

/**
 * Tokeniza o texto de UM bloco (parágrafo, item de lista, cabeçalho) em
 * negrito/itálico/código/link/texto. Sem recursão: o conteúdo de um negrito
 * não é reprocessado por itálico/link — cobre o que `agent.response` produz
 * de fato, sem o custo de um parser de precedência completo.
 */
export function parseInline(text: string): MdInline[] {
  const nodes: MdInline[] = [];
  let resto = text;

  while (resto.length > 0) {
    const m = INLINE_RE.exec(resto);
    if (!m) {
      nodes.push({ kind: 'text', text: resto });
      break;
    }
    if (m.index > 0) {
      nodes.push({ kind: 'text', text: resto.slice(0, m.index) });
    }

    if (m[1] !== undefined) {
      nodes.push({ kind: 'bold', text: m[1] });
    } else if (m[2] !== undefined) {
      nodes.push({ kind: 'italic', text: m[2] });
    } else if (m[3] !== undefined) {
      nodes.push({ kind: 'italic', text: m[3] });
    } else if (m[4] !== undefined) {
      nodes.push({ kind: 'code', text: m[4] });
    } else if (m[5] !== undefined && m[6] !== undefined) {
      const url = m[6];
      // Esquema não seguro: o texto do link sobrevive, o `href` não — nunca
      // renderiza a sintaxe crua `[texto](url)` de volta pra tela.
      nodes.push(urlSegura(url) ? { kind: 'link', text: m[5], url } : { kind: 'text', text: m[5] });
    }

    resto = resto.slice(m.index + m[0].length);
  }

  return nodes;
}

const FENCE_RE = /^```\s*([\w+-]*)\s*$/;
const FENCE_FIM_RE = /^```\s*$/;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
/**
 * A linha SEPARADORA é o que distingue uma tabela de um parágrafo cheio de
 * `|` (uma alternativa em prosa, uma saída de terminal colada no chat). Ela é
 * obrigatória, como no GFM: sem ela, o bloco continua sendo parágrafo — que é
 * exatamente o comportamento de antes desta mudança, e nada regride.
 */
const TABELA_SEPARADOR_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const TABELA_LINHA_RE = /\|/;

/**
 * Quebra uma linha de tabela em células. As barras das PONTAS são moldura, não
 * separador: `| a | b |` tem duas células, não quatro. `\|` escapado NÃO
 * separa — é o único jeito de escrever uma barra dentro de uma célula, e um
 * `module_map` com `depends_on: a \| b` é caso plausível.
 */
export function celulasDaLinha(linha: string): string[] {
  const partes: string[] = [];
  let atual = '';
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '\\' && linha[i + 1] === '|') {
      atual += '|';
      i += 1;
      continue;
    }
    if (c === '|') {
      partes.push(atual);
      atual = '';
      continue;
    }
    atual += c;
  }
  partes.push(atual);
  // Moldura das pontas: só o PRIMEIRO e o ÚLTIMO pedaço, e só quando vazios.
  if (partes.length > 0 && partes[0].trim() === '') partes.shift();
  if (partes.length > 0 && partes[partes.length - 1].trim() === '') partes.pop();
  return partes.map((p) => p.trim());
}

function alinhamentoDaCelula(celula: string): MdAlinhamento {
  const t = celula.trim();
  const inicia = t.startsWith(':');
  const termina = t.endsWith(':');
  if (inicia && termina) return 'center';
  if (termina) return 'right';
  return 'left';
}

/**
 * Parser de blocos: cabeçalho (`#`/`##`/`###`), lista (`-`/`1.`), fence de
 * código (```` ```linguagem ````) e parágrafo — o resto. Uma passada só,
 * linha a linha; nunca lança — fence sem fechamento consome até o fim do
 * texto (degrada para "o resto virou código", nunca quebra a renderização).
 */
export function parseMarkdown(source: string): MdBlock[] {
  const linhas = source.split('\n');
  const blocos: MdBlock[] = [];

  let paragrafoBuf: string[] = [];
  let listaBuf: { ordered: boolean; items: string[] } | null = null;

  function fecharParagrafo() {
    if (paragrafoBuf.length === 0) return;
    blocos.push({ type: 'paragraph', inline: parseInline(paragrafoBuf.join('\n')) });
    paragrafoBuf = [];
  }
  function fecharLista() {
    if (!listaBuf) return;
    blocos.push({
      type: 'list',
      ordered: listaBuf.ordered,
      items: listaBuf.items.map(parseInline),
    });
    listaBuf = null;
  }

  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i];

    const fence = FENCE_RE.exec(linha);
    if (fence) {
      fecharParagrafo();
      fecharLista();
      const lang = fence[1].toLowerCase();
      const conteudo: string[] = [];
      i++;
      while (i < linhas.length && !FENCE_FIM_RE.test(linhas[i])) {
        conteudo.push(linhas[i]);
        i++;
      }
      // `i` aponta pro fecho (```) ou passou do fim — os dois casos avançam
      // igual; sem fecho, o bloco vira "todo o resto do texto", nunca erro.
      blocos.push({ type: 'code', lang, content: conteudo.join('\n') });
      i++;
      continue;
    }

    if (linha.trim() === '') {
      fecharParagrafo();
      fecharLista();
      i++;
      continue;
    }

    const heading = HEADING_RE.exec(linha);
    if (heading) {
      fecharParagrafo();
      fecharLista();
      blocos.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        inline: parseInline(heading[2]),
      });
      i++;
      continue;
    }

    // Tabela (RN-176): cabeçalho + separador. O olhar para a linha SEGUINTE é
    // o que evita transformar prosa com `|` em tabela — e é por isso que a
    // detecção mora aqui e não em `parseInline`.
    if (
      TABELA_LINHA_RE.test(linha) &&
      i + 1 < linhas.length &&
      TABELA_SEPARADOR_RE.test(linhas[i + 1]) &&
      TABELA_LINHA_RE.test(linhas[i + 1])
    ) {
      fecharParagrafo();
      fecharLista();
      const cabecalho = celulasDaLinha(linha);
      const aligns = celulasDaLinha(linhas[i + 1]).map(alinhamentoDaCelula);
      i += 2;
      const corpo: MdInline[][][] = [];
      while (i < linhas.length && linhas[i].trim() !== '' && TABELA_LINHA_RE.test(linhas[i])) {
        const celulas = celulasDaLinha(linhas[i]);
        // Normaliza para o número de colunas do CABEÇALHO: é ele que manda,
        // e assim quem renderiza nunca lida com linha torta.
        corpo.push(
          cabecalho.map((_, c) => parseInline(celulas[c] ?? '')),
        );
        i += 1;
      }
      blocos.push({
        type: 'table',
        header: cabecalho.map(parseInline),
        aligns: cabecalho.map((_, c) => aligns[c] ?? 'left'),
        rows: corpo,
      });
      continue;
    }

    const ul = UL_RE.exec(linha);
    if (ul) {
      fecharParagrafo();
      if (listaBuf && listaBuf.ordered) fecharLista();
      if (!listaBuf) listaBuf = { ordered: false, items: [] };
      listaBuf.items.push(ul[1]);
      i++;
      continue;
    }

    const ol = OL_RE.exec(linha);
    if (ol) {
      fecharParagrafo();
      if (listaBuf && !listaBuf.ordered) fecharLista();
      if (!listaBuf) listaBuf = { ordered: true, items: [] };
      listaBuf.items.push(ol[1]);
      i++;
      continue;
    }

    fecharLista();
    paragrafoBuf.push(linha);
    i++;
  }

  fecharParagrafo();
  fecharLista();
  return blocos;
}

/** Aliases comuns de linguagem na info string do fence → chave que
 *  `routes/code/highlight.ts` reconhece. Sem entrada aqui, a própria
 *  linguagem (minúscula) segue direto — `highlightFile` já degrada uma
 *  linguagem desconhecida (inclusive vazia) para o vocabulário de JS. */
const LANG_ALIASES: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  shell: 'sh',
  zsh: 'sh',
  console: 'sh',
  python: 'py',
  elixir: 'ex',
};

export function normalizarLinguagemDoFence(lang: string): string {
  const l = lang.trim().toLowerCase();
  return LANG_ALIASES[l] ?? l;
}
