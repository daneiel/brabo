import type { ReactNode } from 'react';
import {
  parseMarkdown,
  normalizarLinguagemDoFence,
  type MdAlinhamento,
  type MdBlock,
  type MdInline,
} from '../../lib/markdown';
import { highlightFile, type TokenKind } from '../../routes/code/highlight';
import { Table, type TableColumn } from './Table';
import styles from './MarkdownMessage.module.css';

const CLASSE_POR_TOKEN: Record<TokenKind, string> = {
  keyword: styles.tkKeyword,
  function: styles.tkFunction,
  string: styles.tkString,
  number: styles.tkNumber,
  comment: styles.tkComment,
  type: styles.tkType,
  operator: styles.tkOperator,
  text: styles.tkText,
};

/** Linguagens cuja info string do fence pinta o bloco como TERMINAL — mesma
 *  estética de `$ comando` que `ApprovalCard` já usa pra ação `terminal`
 *  (RN-158): fundo `--code-bg`, prompt `$` por linha não vazia. */
const LINGUAGENS_DE_TERMINAL = new Set(['sh', 'bash']);

function renderInline(nodes: MdInline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        // Texto puro sem wrapper: string solta num array de children é
        // válida em React e não precisa de `key`.
        return n.text;
      case 'bold':
        return <strong key={i}>{n.text}</strong>;
      case 'italic':
        return <em key={i}>{n.text}</em>;
      case 'code':
        return (
          <code key={i} className={styles.codigoInline}>
            {n.text}
          </code>
        );
      case 'link':
        // Esquema já filtrado por `urlSegura` no parser — o que chega aqui
        // sempre é http(s) ou relativo. `noopener` porque o alvo é conteúdo
        // de um LLM, nunca um link em que o produto confia.
        return (
          <a key={i} href={n.url} target="_blank" rel="noreferrer noopener">
            {n.text}
          </a>
        );
      default:
        return null;
    }
  });
}

/** O TEXTO de uma sequência inline, sem formatação — usado onde o destino só
 *  aceita `string` (o `label` de coluna do `Table`). */
function textoSimples(nodes: MdInline[]): string {
  return nodes.map((n) => n.text).join('');
}

function CodeFence({ lang, content }: { lang: string; content: string }) {
  const linguagem = normalizarLinguagemDoFence(lang);
  const terminal = LINGUAGENS_DE_TERMINAL.has(linguagem);
  const linhasFonte = content.split('\n');
  const linhasRealcadas = highlightFile(content, linguagem);

  return (
    <div className={[styles.fence, terminal && styles.fenceTerminal].filter(Boolean).join(' ')}>
      <div className={styles.fenceCabecalho}>
        <span>{lang.trim() || 'texto'}</span>
      </div>
      <pre className={styles.fencePre}>
        <code>
          {linhasRealcadas.map((tokens, i) => (
            <div key={i} className={styles.fenceLinha}>
              {terminal && (
                <span className={styles.fencePrompt} aria-hidden="true">
                  {linhasFonte[i]?.trim() ? '$' : ''}
                </span>
              )}
              <span className={styles.fenceTexto}>
                {tokens.map((tok, j) => (
                  <span key={j} className={CLASSE_POR_TOKEN[tok.kind]}>
                    {tok.text}
                  </span>
                ))}
                {tokens.length === 0 && ' '}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

/**
 * Tabela GFM dentro do balão (RN-176) — o `Table` do design system, o MESMO
 * componente das telas de Configurações/Gastos/Executores, e não uma
 * `<table>` própria: "como o Brabo desenha uma tabela" é uma decisão só.
 *
 * A largura é o problema real da tabela no fio — o balão tem ~700px e um
 * `module_map` costuma ter 4 colunas —, então o `Table` (grid de `1fr`) vive
 * dentro de um contêiner que ROLA na horizontal, com piso de largura por
 * coluna. Espremer a coluna até a palavra quebrar letra a letra seria o
 * mesmo defeito que o usuário relatou, com outra forma.
 */
function TabelaMarkdown({
  header,
  aligns,
  rows,
}: {
  header: MdInline[][];
  aligns: MdAlinhamento[];
  rows: MdInline[][][];
}) {
  const columns: TableColumn<{ celulas: MdInline[][]; indice: number }>[] = header.map(
    (celula, c) => ({
      key: String(c),
      // `label` do `Table` é `string` por contrato, então o cabeçalho perde
      // a formatação inline (`**Módulo**` vira `Módulo`) em vez de ganhar uma
      // prop nova no componente compartilhado — o cabeçalho de tabela já é
      // desenhado em mono/maiúsculas pelo design system, e negrito dentro
      // dele não teria efeito visível nenhum.
      label: textoSimples(celula),
      render: (row) => (
        <span className={styles.tabelaCelula} style={{ textAlign: aligns[c] }}>
          {renderInline(row.celulas[c] ?? [])}
        </span>
      ),
    }),
  );

  return (
    <div className={styles.tabelaScroll}>
      <Table
        columns={columns}
        rows={rows.map((celulas, i) => ({ celulas, indice: i }))}
        rowKey={(row) => String(row.indice)}
        emptyMessage="Tabela sem linhas."
      />
    </div>
  );
}

function renderBlock(block: MdBlock, key: number): ReactNode {
  switch (block.type) {
    case 'heading':
      if (block.level === 1) {
        return (
          <h1 key={key} className={styles.titulo1}>
            {renderInline(block.inline)}
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2 key={key} className={styles.titulo2}>
            {renderInline(block.inline)}
          </h2>
        );
      }
      return (
        <h3 key={key} className={styles.titulo3}>
          {renderInline(block.inline)}
        </h3>
      );
    case 'paragraph':
      return (
        <p key={key} className={styles.paragrafo}>
          {renderInline(block.inline)}
        </p>
      );
    case 'list':
      return block.ordered ? (
        <ol key={key} className={styles.lista}>
          {block.items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className={styles.lista}>
          {block.items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'code':
      return <CodeFence key={key} lang={block.lang} content={block.content} />;
    case 'table':
      return (
        <TabelaMarkdown
          key={key}
          header={block.header}
          aligns={block.aligns}
          rows={block.rows}
        />
      );
    default:
      return null;
  }
}

/**
 * Markdown leve de `agent.response` (RN-158) — sem lib nova, mesma filosofia
 * de `routes/code/highlight.ts`. Nunca usa `dangerouslySetInnerHTML`: cada
 * bloco vira elemento React de verdade, e o React escapa todo texto por
 * padrão — a única superfície de risco (o `href` de um link) já foi filtrada
 * em `lib/markdown.ts`, antes de chegar aqui.
 *
 * Pensado pra ir DENTRO de `.bubble` (`ChatBubble.module.css`): não define
 * fundo, borda nem padding do balão — só a tipografia do conteúdo.
 */
export function MarkdownMessage({ text }: { text: string }) {
  const blocos = parseMarkdown(text);
  return <div className={styles.markdown}>{blocos.map((b, i) => renderBlock(b, i))}</div>;
}
