import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  parseInline,
  parseMarkdown,
  fecharMarcadoresAbertos,
  normalizarLinguagemDoFence,
  type MdAlinhamento,
  type MdBlock,
  type MdInline,
} from '../../lib/markdown';
import { highlightFile, type TokenKind } from '../../routes/code/highlight';
import { carregarRealce } from '../../lib/realce-shiki';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
} from '../shadcn/code-block';
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

/** RN-712: bloco de código acima disto nasce RECOLHIDO — um docker-compose de
 *  80 linhas despejado no fio empurrava a conversa para fora da tela. */
const LIMITE_DE_LINHAS_DO_BLOCO = 20;
/** Quantas linhas o bloco recolhido ainda mostra. */
const LINHAS_DO_BLOCO_RECOLHIDO = 8;

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
  const { t } = useTranslation('ui');
  const linguagem = normalizarLinguagemDoFence(lang);
  const terminal = LINGUAGENS_DE_TERMINAL.has(linguagem);
  const linhasFonte = content.split('\n');
  const porRegex = highlightFile(content, linguagem);
  // Regex enquanto o shiki carrega e para linguagem sem gramática (RN-972).
  const [doShiki, setDoShiki] = useState<{ content: string; linhas: typeof porRegex } | null>(null);
  useEffect(() => {
    let vivo = true;
    void carregarRealce(content, linguagem).then((linhas) => {
      if (vivo && linhas) setDoShiki({ content, linhas });
    });
    return () => {
      vivo = false;
    };
  }, [content, linguagem]);
  const linhasRealcadas = doShiki?.content === content ? doShiki.linhas : porRegex;
  const longo = linhasFonte.length > LIMITE_DE_LINHAS_DO_BLOCO;
  const [aberto, setAberto] = useState(false);
  const visiveis =
    longo && !aberto ? linhasRealcadas.slice(0, LINHAS_DO_BLOCO_RECOLHIDO) : linhasRealcadas;

  return (
    <CodeBlock className={[styles.fence, terminal && styles.fenceTerminal].filter(Boolean).join(' ')}>
      <CodeBlockHeader className={styles.fenceCabecalho}>
        <span>{lang.trim() || t('markdownMessage.codeFence.defaultLanguage')}</span>
        <CodeBlockActions>
          <CodeBlockCopyButton code={content} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <pre className={styles.fencePre}>
        <code>
          {visiveis.map((tokens, i) => (
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
      {longo && (
        <button
          type="button"
          className={styles.fenceAlternar}
          aria-expanded={aberto}
          onClick={() => setAberto((a) => !a)}
        >
          {aberto
            ? t('markdownMessage.codeFence.recolher')
            : t('markdownMessage.codeFence.mostrarLinhas', { count: linhasFonte.length })}
        </button>
      )}
    </CodeBlock>
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
  const { t } = useTranslation('ui');
  const columns: TableColumn<{ celulas: MdInline[][]; indice: number }>[] = header.map(
    (celula, c) => ({
      key: String(c),
      // `label` do `Table` é `string` por contrato, então o cabeçalho perde
      // a formatação inline (`**Módulo**` vira `Módulo`) em vez de ganhar uma
      // prop nova no componente compartilhado — o cabeçalho de tabela já é
      // desenhado em mono/maiúsculas pelo design system, e negrito dentro
      // dele não teria efeito visível nenhum.
      label: textoSimples(celula),
      // AT-455: piso POR COLUNA. Com `1fr` e o `max-content` no contêiner, cada
      // coluna crescia até a célula mais longa SEM quebra (medido: 2 236px
      // num balão de 708px) e a última coluna ficava fora da vista.
      width: 'minmax(12rem, 1fr)',
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
        emptyMessage={t('markdownMessage.table.emptyMessage')}
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
      if (block.level === 3) {
        return (
          <h3 key={key} className={styles.titulo3}>
            {renderInline(block.inline)}
          </h3>
        );
      }
      return (
        <h4 key={key} className={styles.titulo4}>
          {renderInline(block.inline)}
        </h4>
      );
    case 'hr':
      return <hr key={key} className={styles.regua} />;
    case 'blockquote':
      return (
        <blockquote key={key} className={styles.citacao}>
          {block.blocks.map((b, j) => renderBlock(b, j))}
        </blockquote>
      );
    case 'paragraph':
      return (
        <p key={key} className={styles.paragrafo}>
          {renderInline(block.inline)}
        </p>
      );
    case 'list': {
      const Lista = block.ordered ? 'ol' : 'ul';
      return (
        <Lista key={key} className={styles.lista}>
          {block.items.map((item, j) => {
            const tarefa = block.tarefas?.[j] ?? null;
            const filho = block.filhos?.[j] ?? null;
            const SubLista = filho?.ordered ? 'ol' : 'ul';
            return (
              <li key={j} className={tarefa !== null ? styles.itemTarefa : undefined}>
                {tarefa !== null && (
                  // Só visual (RN-837): a caixa não é controle, não muda nada.
                  <input
                    type="checkbox"
                    className={styles.caixaTarefa}
                    checked={tarefa}
                    readOnly
                    disabled
                    tabIndex={-1}
                  />
                )}
                {renderInline(item)}
                {filho && (
                  <SubLista className={styles.lista}>
                    {filho.items.map((sub, k) => (
                      <li key={k}>{renderInline(sub)}</li>
                    ))}
                  </SubLista>
                )}
              </li>
            );
          })}
        </Lista>
      );
    }
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
/**
 * Markdown INLINE só (negrito, itálico, código, link) — para rótulos curtos,
 * como os do formulário estruturado (AT-393), onde blocos não cabem. Reusa o
 * MESMO `parseInline`/`renderInline` do fio, nunca um segundo renderizador.
 */
export function MarkdownInline({ text }: { text: string }) {
  return <>{renderInline(parseInline(text))}</>;
}

/** `emCurso` (RN-837): o texto é um prefixo de stream — fecha os marcadores
 *  abertos antes de parsear. O texto final passa sem isso. */
export function MarkdownMessage({ text, emCurso = false }: { text: string; emCurso?: boolean }) {
  const blocos = parseMarkdown(emCurso ? fecharMarcadoresAbertos(text) : text);
  return <div className={styles.markdown}>{blocos.map((b, i) => renderBlock(b, i))}</div>;
}
