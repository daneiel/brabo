import { useQuery } from '@tanstack/react-query';
import { getCodeFile, mensagemDaApi } from '../../lib/api-client';
import { Skeleton } from '../../components/ui/Skeleton';
import { FileIcon, XIcon } from '../../components/ui/icons';
import { highlightFile, linguagemPorCaminho, type TokenKind } from './highlight';
import styles from './CodeEditor.module.css';

interface CodeEditorProps {
  projectId: string;
  /** Não `ref`: reservado pelo React mesmo em componente de função. Ver CodeExplorer.tsx. */
  gitRef: string;
  openTabs: string[];
  activePath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
}

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

/**
 * Abas do editor + breadcrumb + área de código, com realce de sintaxe
 * (`highlight.ts`, sem dependência nova). Sem virtualização de linha —
 * pendência declarada da FASE 26 (o próprio handoff chama a aba de código a
 * parte mais custosa do programa); o teto de bytes da leitura
 * (`GIT_BLOB_MAX_BYTES`, 512 KB) limita o pior caso.
 */
export function CodeEditor({
  projectId,
  gitRef,
  openTabs,
  activePath,
  onSelectTab,
  onCloseTab,
}: CodeEditorProps) {
  const fileQuery = useQuery({
    queryKey: ['code-file', projectId, gitRef, activePath],
    queryFn: () => getCodeFile(projectId, { ref: gitRef, path: activePath! }),
    enabled: Boolean(activePath && gitRef),
  });

  return (
    <div className={styles.editor}>
      {openTabs.length > 0 && (
        <div className={styles.abas} role="tablist" aria-label="Arquivos abertos">
          {openTabs.map((path) => (
            <div
              key={path}
              role="tab"
              aria-selected={path === activePath}
              className={[styles.aba, path === activePath && styles.abaAtiva]
                .filter(Boolean)
                .join(' ')}
            >
              <button type="button" className={styles.abaBotao} onClick={() => onSelectTab(path)}>
                <FileIcon size={12} />
                <span className={styles.abaNome}>{path.split('/').pop()}</span>
              </button>
              <button
                type="button"
                className={styles.abaFechar}
                aria-label={`Fechar ${path}`}
                onClick={() => onCloseTab(path)}
              >
                <XIcon size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {activePath && (
        <div className={styles.breadcrumb}>
          {activePath.split('/').map((segmento, i, arr) => (
            <span key={i} className={styles.breadcrumbSegmento}>
              {segmento}
              {i < arr.length - 1 && <span className={styles.breadcrumbSep}>/</span>}
            </span>
          ))}
        </div>
      )}

      <div className={styles.conteudo}>
        {!activePath && (
          <div className={styles.vazio}>
            Selecione um arquivo no explorador, ou busque um trecho na aba Buscar.
          </div>
        )}

        {activePath && fileQuery.isLoading && (
          <div className={styles.carregando}>
            <Skeleton width="60%" height={13} />
            <Skeleton width="80%" height={13} />
            <Skeleton width="40%" height={13} />
            <Skeleton width="70%" height={13} />
          </div>
        )}

        {activePath && fileQuery.isError && (
          <div className={styles.erro} role="alert">
            {mensagemDaApi(fileQuery.error, 'Não consegui abrir este arquivo.')}
          </div>
        )}

        {activePath && fileQuery.data && (
          <>
            {fileQuery.data.truncated && (
              <div className={styles.aviso}>
                Arquivo maior que o teto de leitura — mostrando só o início ({fileQuery.data.bytes} bytes).
              </div>
            )}
            <CodigoComRealce
              content={fileQuery.data.content}
              lang={linguagemPorCaminho(activePath)}
            />
          </>
        )}
      </div>
    </div>
  );
}

function CodigoComRealce({ content, lang }: { content: string; lang: string }) {
  const linhas = highlightFile(content, lang);
  return (
    <pre className={styles.pre}>
      <code>
        {linhas.map((tokens, i) => (
          <div key={i} className={styles.linhaCodigo}>
            <span className={styles.gutter}>{i + 1}</span>
            <span className={styles.linhaTexto}>
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
  );
}
