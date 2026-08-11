import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCodeBlame, getCodeFile, mensagemDaApi } from '../../lib/api-client';
import type { CodeBlameLine } from '../../lib/api-types';
import { Skeleton } from '../../components/ui/Skeleton';
import { FileIcon, UserIcon, XIcon } from '../../components/ui/icons';
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
 *
 * Blame (fundação da FASE 26b, `GET .../code/blame`, RN-110) é anotação
 * SOB DEMANDA: o toggle só dispara `getCodeBlame` quando ligado, nunca em
 * toda leitura de arquivo — arquivo grande sob `GIT_BLAME_LINE_LIMIT` (2000
 * linhas no backend) já é uma chamada cara o bastante para não pagá-la de
 * graça (RN-113). Linhas consecutivas do MESMO commit mostram autor/sha só
 * na primeira da sequência, para não repetir o mesmo texto dezenas de vezes.
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

  const [blameOn, setBlameOn] = useState(false);
  const blameQuery = useQuery({
    queryKey: ['code-blame', projectId, gitRef, activePath],
    queryFn: () => getCodeBlame(projectId, { ref: gitRef, path: activePath! }),
    enabled: Boolean(blameOn && activePath && gitRef),
  });
  const blamePorLinha = useMemo(() => {
    const mapa = new Map<number, CodeBlameLine>();
    for (const linha of blameQuery.data?.lines ?? []) mapa.set(linha.line, linha);
    return mapa;
  }, [blameQuery.data]);

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
          <div className={styles.breadcrumbCaminho}>
            {activePath.split('/').map((segmento, i, arr) => (
              <span key={i} className={styles.breadcrumbSegmento}>
                {segmento}
                {i < arr.length - 1 && <span className={styles.breadcrumbSep}>/</span>}
              </span>
            ))}
          </div>
          <button
            type="button"
            className={[styles.blameToggle, blameOn && styles.blameToggleAtivo]
              .filter(Boolean)
              .join(' ')}
            aria-pressed={blameOn}
            onClick={() => setBlameOn((v) => !v)}
            title="Anotar cada linha com o commit, autor e data que a tocou por último"
          >
            <UserIcon size={13} />
            Blame
          </button>
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

            {blameOn && blameQuery.isLoading && (
              <div className={styles.blameEstado}>Carregando anotações de autoria…</div>
            )}

            {blameOn && blameQuery.isError && (
              <div className={styles.blameErro} role="alert">
                <span>
                  {mensagemDaApi(blameQuery.error, 'Não consegui carregar o blame deste arquivo.')}
                </span>
                <button
                  type="button"
                  className={styles.blameTentar}
                  onClick={() => void blameQuery.refetch()}
                >
                  Tentar de novo
                </button>
              </div>
            )}

            {blameOn && blameQuery.data && blameQuery.data.lines.length === 0 && (
              <div className={styles.blameEstado}>Sem anotações de autoria para este arquivo.</div>
            )}

            {blameOn && blameQuery.data && blameQuery.data.truncated && (
              <div className={styles.aviso}>
                Anotação de autoria cortada em {blameQuery.data.lines.length} linhas — arquivo maior
                que o teto de blame.
              </div>
            )}

            <CodigoComRealce
              content={fileQuery.data.content}
              lang={linguagemPorCaminho(activePath)}
              blame={blameOn ? blamePorLinha : null}
            />
          </>
        )}
      </div>
    </div>
  );
}

function CodigoComRealce({
  content,
  lang,
  blame,
}: {
  content: string;
  lang: string;
  /** `null` = blame desligado. Mapa vazio é estado válido (arquivo sem linhas anotadas). */
  blame: Map<number, CodeBlameLine> | null;
}) {
  const linhas = highlightFile(content, lang);
  return (
    <pre className={styles.pre}>
      <code>
        {linhas.map((tokens, i) => {
          const numero = i + 1;
          const anotacao = blame?.get(numero) ?? null;
          const anterior = blame?.get(numero - 1) ?? null;
          const inicioDeBloco = !anterior || anterior.commitSha !== anotacao?.commitSha;
          return (
            <div key={i} className={styles.linhaCodigo}>
              {blame && (
                <span
                  className={[styles.gutterBlame, inicioDeBloco && styles.gutterBlameInicio]
                    .filter(Boolean)
                    .join(' ')}
                  title={anotacao ? tituloBlame(anotacao) : 'Sem anotação de autoria para esta linha'}
                >
                  {anotacao && inicioDeBloco
                    ? `${anotacao.author} · ${anotacao.commitSha.slice(0, 7)}`
                    : ''}
                </span>
              )}
              <span className={styles.gutter}>{numero}</span>
              <span className={styles.linhaTexto}>
                {tokens.map((tok, j) => (
                  <span key={j} className={CLASSE_POR_TOKEN[tok.kind]}>
                    {tok.text}
                  </span>
                ))}
                {tokens.length === 0 && ' '}
              </span>
            </div>
          );
        })}
      </code>
    </pre>
  );
}

function tituloBlame(linha: CodeBlameLine): string {
  const data = new Date(linha.authorDate);
  const dataFormatada = Number.isNaN(data.getTime())
    ? linha.authorDate
    : data.toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
  return `${linha.author} · ${dataFormatada} · ${linha.commitSha.slice(0, 7)} · ${linha.summary}`;
}
