import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getCodeBlame, getCodeFile, mensagemDaApi } from '../../lib/api-client';
import type { CodeBlameLine } from '../../lib/api-types';
import { Skeleton } from '../../components/ui/Skeleton';
import { FileIcon, UserIcon, XIcon } from '../../components/ui/icons';
import { highlightFile, linguagemPorCaminho, type TokenKind } from './highlight';
import {
  buildMinimapData,
  desenharMinimapa,
  linhaNoOffsetY,
  resolverCoresDoMinimapa,
  type MinimapLine,
} from './minimap';
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
 * Altura de UMA linha renderizada, em pixels — tem de casar com
 * `.linhaCodigo { height: 21px }` em `CodeEditor.module.css` (o valor que o
 * handoff também usa). É a base de TODA a matemática de virtualização: como
 * a altura é fixa, "quais linhas estão visíveis" é uma divisão, não uma
 * medição por linha.
 */
const ALTURA_LINHA = 21;

/** Linhas extras renderizadas acima/abaixo da janela visível, para scroll rápido não mostrar vazio por um frame. */
const OVERSCAN = 20;

/**
 * Quantas linhas manter na janela quando a altura do contêiner ainda não foi
 * medida (`containerHeight === 0` — 1º render, ou jsdom sem `ResizeObserver`
 * em teste). Generoso o bastante para não truncar os arquivos pequenos que
 * os testes usam, pequeno o bastante para nunca ser "renderiza tudo" de
 * verdade num arquivo grande.
 */
const LINHAS_SEM_MEDICAO = 40;

/**
 * Abas do editor + breadcrumb + área de código, com realce de sintaxe
 * (`highlight.ts`, sem dependência nova).
 *
 * **Virtualização de linha** (RN-239/240): só as linhas dentro da janela
 * visível (mais `OVERSCAN` de margem) viram nó de DOM — o resto vira dois
 * espaçadores (`.espacador`) que reservam a altura sem existir como linha.
 * Decisão de NÃO usar biblioteca (`react-window`/`react-virtual`): a altura
 * de linha é FIXA (21px, monoespaçado), o que reduz "qual linha está visível"
 * a uma divisão inteira sobre `scrollTop` — o problema que essas libs
 * resolvem de verdade é altura VARIÁVEL por item, que não é o nosso caso.
 * Mesmo espírito de `highlight.ts`: zero dependência nova quando o problema
 * real é mais simples que a ferramenta genérica.
 *
 * A rolagem HORIZONTAL tem uma consequência honesta desta escolha: a largura
 * do conteúdo (`width: max-content` em `.linhaCodigo`) é determinada pelas
 * linhas RENDERIZADAS, não pela mais longa do arquivo inteiro — então a barra
 * de rolagem horizontal pode mudar de tamanho ao rolar verticalmente, se a
 * linha mais longa do arquivo estiver fora da janela atual. Medir a linha mais
 * longa do arquivo inteiro só para fixar uma largura exigiria o mesmo
 * passe O(n) que a virtualização existe para evitar — pendência aceita, não
 * um bug.
 *
 * **Minimapa** (RN-241/242) só entra depois de a virtualização estar de pé —
 * ele reaproveita a MESMA tokenização (`highlightFile`, chamada uma vez só)
 * que a virtualização usa, então não paga um segundo passe sobre o arquivo.
 * Ver `minimap.ts` para por que o desenho é em `<canvas>` (um nó de DOM,
 * nunca um por linha).
 *
 * Blame (fundação da FASE 26b, `GET .../code/blame`, RN-110) é anotação
 * SOB DEMANDA: o toggle só dispara `getCodeBlame` quando ligado, nunca em
 * toda leitura de arquivo — arquivo grande sob `GIT_BLAME_LINE_LIMIT` (2000
 * linhas no backend) já é uma chamada cara o bastante para não pagá-la de
 * graça (RN-113). Linhas consecutivas do MESMO commit mostram autor/sha só
 * na primeira da sequência, para não repetir o mesmo texto dezenas de vezes.
 * A busca de "linha anterior" olha o MAPA de blame inteiro, não a janela
 * virtualizada — o agrupamento não pode depender do que está renderizado.
 */
export function CodeEditor({
  projectId,
  gitRef,
  openTabs,
  activePath,
  onSelectTab,
  onCloseTab,
}: CodeEditorProps) {
  const { t } = useTranslation('code');
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

  const linhas = useMemo(() => {
    if (!fileQuery.data) return [];
    return highlightFile(fileQuery.data.content, linguagemPorCaminho(activePath ?? ''));
  }, [fileQuery.data, activePath]);

  const minimapDados = useMemo(() => buildMinimapData(linhas), [linhas]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Reseta a janela ao trocar de arquivo — senão a linha 4000 do arquivo
  // anterior decidiria a janela inicial do novo, que pode ter 10 linhas.
  useEffect(() => {
    setScrollTop(0);
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [activePath]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    // `ResizeObserver`: jsdom não implementa (mesma guarda de SessionPage.tsx,
    // RN-173) — a medição inicial de `clientHeight` acima já cobre o caso sem
    // ele, e o observer só melhora quando o painel MUDA de tamanho depois.
    let observador: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observador = new ResizeObserver(() => setContainerHeight(el.clientHeight));
      observador.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', onScroll);
      observador?.disconnect();
    };
  }, [activePath]);

  const totalLinhas = linhas.length;
  const janela = useMemo(() => {
    const linhasNaTela =
      containerHeight > 0 ? Math.ceil(containerHeight / ALTURA_LINHA) : LINHAS_SEM_MEDICAO;
    const inicioBruto = Math.floor(scrollTop / ALTURA_LINHA) - OVERSCAN;
    const inicio = Math.max(0, inicioBruto);
    const fim = Math.min(totalLinhas, inicio + linhasNaTela + OVERSCAN * 2);
    return { inicio, fim };
  }, [scrollTop, containerHeight, totalLinhas]);

  const irParaLinha = (linha: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const alvo = Math.max(0, linha * ALTURA_LINHA - el.clientHeight / 2);
    el.scrollTop = alvo;
    setScrollTop(alvo);
  };

  return (
    <div className={styles.editor}>
      {openTabs.length > 0 && (
        <div className={styles.abas} role="tablist" aria-label={t('editor.openTabsAriaLabel')}>
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
                aria-label={t('editor.closeFileAriaLabel', { path })}
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
            title={t('editor.blameButtonTitle')}
          >
            <UserIcon size={13} />
            {t('editor.blameButton')}
          </button>
        </div>
      )}

      <div className={styles.corpo}>
        <div
          className={[styles.conteudo, activePath && fileQuery.data && styles.conteudoComMinimapa]
            .filter(Boolean)
            .join(' ')}
          ref={scrollRef}
          data-testid="editor-scroll"
        >
          {!activePath && (
            <div className={styles.vazio}>{t('editor.emptyState')}</div>
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
              {mensagemDaApi(fileQuery.error, t('editor.loadFileErrorFallback'))}
            </div>
          )}

          {activePath && fileQuery.data && (
            <>
              {fileQuery.data.truncated && (
                <div className={styles.aviso}>
                  {t('editor.truncatedFile', { bytes: fileQuery.data.bytes })}
                </div>
              )}

              {blameOn && blameQuery.isLoading && (
                <div className={styles.blameEstado}>{t('editor.blameLoading')}</div>
              )}

              {blameOn && blameQuery.isError && (
                <div className={styles.blameErro} role="alert">
                  <span>
                    {mensagemDaApi(blameQuery.error, t('editor.blameErrorFallback'))}
                  </span>
                  <button
                    type="button"
                    className={styles.blameTentar}
                    onClick={() => void blameQuery.refetch()}
                  >
                    {t('shared.retry')}
                  </button>
                </div>
              )}

              {blameOn && blameQuery.data && blameQuery.data.lines.length === 0 && (
                <div className={styles.blameEstado}>{t('editor.blameEmpty')}</div>
              )}

              {blameOn && blameQuery.data && blameQuery.data.truncated && (
                <div className={styles.aviso}>
                  {t('editor.blameTruncated', { lines: blameQuery.data.lines.length })}
                </div>
              )}

              <CodigoComRealce
                linhas={linhas}
                janela={janela}
                blame={blameOn ? blamePorLinha : null}
              />
            </>
          )}
        </div>

        {activePath && fileQuery.data && totalLinhas > 0 && (
          <Minimap dados={minimapDados} totalLinhas={totalLinhas} onNavigate={irParaLinha} />
        )}
      </div>
    </div>
  );
}

function CodigoComRealce({
  linhas,
  janela,
  blame,
}: {
  linhas: ReturnType<typeof highlightFile>;
  janela: { inicio: number; fim: number };
  /** `null` = blame desligado. Mapa vazio é estado válido (arquivo sem linhas anotadas). */
  blame: Map<number, CodeBlameLine> | null;
}) {
  const { t } = useTranslation('code');
  const total = linhas.length;
  const linhasVisiveis: { numero: number; tokens: ReturnType<typeof highlightFile>[number] }[] = [];
  for (let i = janela.inicio; i < janela.fim; i++) {
    linhasVisiveis.push({ numero: i + 1, tokens: linhas[i] });
  }

  return (
    <pre className={styles.pre}>
      <code>
        {janela.inicio > 0 && (
          <div
            aria-hidden="true"
            data-testid="espacador-topo"
            style={{ height: janela.inicio * ALTURA_LINHA }}
          />
        )}
        {linhasVisiveis.map(({ numero, tokens }) => {
          const anotacao = blame?.get(numero) ?? null;
          const anterior = blame?.get(numero - 1) ?? null;
          const inicioDeBloco = !anterior || anterior.commitSha !== anotacao?.commitSha;
          return (
            <div key={numero} data-line-row={numero} className={styles.linhaCodigo}>
              {blame && (
                <span
                  className={[styles.gutterBlame, inicioDeBloco && styles.gutterBlameInicio]
                    .filter(Boolean)
                    .join(' ')}
                  title={anotacao ? tituloBlame(anotacao, t) : t('editor.blameNoLine')}
                >
                  {anotacao && inicioDeBloco
                    ? t('editor.blameLineLabel', {
                        author: anotacao.author,
                        sha: anotacao.commitSha.slice(0, 7),
                      })
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
                {tokens.length === 0 && ' '}
              </span>
            </div>
          );
        })}
        {janela.fim < total && (
          <div
            aria-hidden="true"
            data-testid="espacador-fundo"
            style={{ height: (total - janela.fim) * ALTURA_LINHA }}
          />
        )}
      </code>
    </pre>
  );
}

const CANVAS_LARGURA = 64;

/**
 * Overlay de 64px (RN-241) — um `<canvas>` só, nunca um nó por linha (ver
 * `minimap.ts`). Clicável: converte o Y do clique em linha do arquivo e pede
 * para o editor rolar até lá (RN-242).
 */
function Minimap({
  dados,
  totalLinhas,
  onNavigate,
}: {
  dados: MinimapLine[];
  totalLinhas: number;
  onNavigate: (linha: number) => void;
}) {
  const { t } = useTranslation('code');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [altura, setAltura] = useState(0);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    setAltura(el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(() => setAltura(el.clientHeight));
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || altura <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_LARGURA * dpr;
    canvas.height = altura * dpr;
    // jsdom não implementa canvas 2D sem o pacote `canvas` (não instalado —
    // zero dependência nova vale também para dev-dependency de teste): em
    // teste `getContext` devolve `null`, e o minimapa degrada para "overlay
    // vazio, clicável mesmo assim" em vez de quebrar.
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const cores = resolverCoresDoMinimapa(canvas);
    desenharMinimapa(ctx, dados, { width: CANVAS_LARGURA, height: altura }, cores);
  }, [dados, altura]);

  return (
    <div
      ref={wrapperRef}
      className={styles.minimapa}
      role="button"
      tabIndex={0}
      aria-label={t('editor.minimapAriaLabel')}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const linha = linhaNoOffsetY(e.clientY - rect.top, rect.height, totalLinhas);
        onNavigate(linha);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onNavigate(0);
      }}
    >
      <canvas ref={canvasRef} className={styles.minimapaCanvas} />
    </div>
  );
}

function tituloBlame(linha: CodeBlameLine, t: TFunction): string {
  const data = new Date(linha.authorDate);
  const dataFormatada = Number.isNaN(data.getTime())
    ? linha.authorDate
    : data.toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
  return t('editor.blameTooltip', {
    author: linha.author,
    date: dataFormatada,
    sha: linha.commitSha.slice(0, 7),
    summary: linha.summary,
  });
}
