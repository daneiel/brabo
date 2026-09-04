import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getCodeDiff,
  getCodePullRequests,
  isContainerImageGateError,
  mensagemDaApi,
} from '../../lib/api-client';
import { ContainerImageGateNotice } from '../../components/ContainerImageGate';
import { Disclosure } from '../../components/ui/Disclosure';
import { ArrowLeftIcon, PrIcon } from '../../components/ui/icons';
import type { CodeDiffFile, CodePullRequestState, CodePullRequestSummary } from '../../lib/api-types';
import styles from './CodeDiffPanel.module.css';

const CHAVE_STATUS: Record<CodeDiffFile['status'], string> = {
  added: 'diff.fileStatus.added',
  modified: 'diff.fileStatus.modified',
  removed: 'diff.fileStatus.removed',
  renamed: 'diff.fileStatus.renamed',
};

const CHAVE_ESTADO_PR: Record<CodePullRequestState, string> = {
  open: 'diff.prState.open',
  merged: 'diff.prState.merged',
  closed: 'diff.prState.closed',
};

const FILTROS: Array<{ chave: CodePullRequestState | 'all'; chaveRotulo: string }> = [
  { chave: 'open', chaveRotulo: 'diff.filters.open' },
  { chave: 'merged', chaveRotulo: 'diff.filters.merged' },
  { chave: 'closed', chaveRotulo: 'diff.filters.closed' },
  { chave: 'all', chaveRotulo: 'diff.filters.all' },
];

export interface PrListAndDiffProps {
  projectId: string;
  /**
   * Conteúdo extra por ITEM da lista — o botão "Merge" e o card de decisão
   * inline que a aba PRs (Onda 2) precisa. `undefined` mantém este
   * componente pixel a pixel igual ao que `CodeDiffPanel` (o painel inferior
   * da aba Código) sempre mostrou: SEM merge, sem cruzamento com
   * `proposed_action`, só listagem + diff.
   *
   * Renderizado como IRMÃO do botão que abre o diff, nunca dentro dele — um
   * `<button>` de Merge aninhado no `<button>` da linha seria HTML inválido
   * (e um clique nele também dispararia o clique da linha).
   */
  renderItemExtra?: (pr: CodePullRequestSummary) => ReactNode;
}

/**
 * Lista navegável de PRs (FASE seguinte à 26b) por cima do diff já
 * existente. `GET /projects/:id/code/pull-requests` via `getCodePullRequests`
 * resolve id/título/autor/estado/branches; clicar num item abre o mesmo fluxo
 * de diff por ID que já funcionava (`getCodeDiff`). Quem já sabe o id (ex.:
 * veio de Aprovações) pode colar direto, sem passar pela lista.
 *
 * Extraído de `CodeDiffPanel.tsx` (Onda 2 do programa de abas agrupadas):
 * este é o componente com a lógica de verdade; `CodeDiffPanel` virou um
 * wrapper fino no mesmo lugar de sempre (painel inferior da aba Código), e a
 * aba PRs nova o consome com `renderItemExtra` para o botão de merge.
 *
 * ## O gate do container (RN-105) não é erro transitório (achado de uso)
 *
 * `getCodePullRequests`/`getCodeDiff` passam pelo MESMO funil que a árvore e
 * o arquivo (`ReadProjectCodeUseCase.alvo`) e por isso podem devolver o
 * mesmo 409 enquanto o Arquiteto não decide a imagem do container — mas,
 * diferente da aba Code (que PERGUNTA antes, em `ProjectCodeTab.tsx`), este
 * componente também é consumido de dentro da aba PRs (project-wide,
 * sem gate pré-checado) e portanto só descobre o bloqueio quando a query
 * já falhou. `isContainerImageGateError` (`lib/api-client.ts`) distingue
 * esse 409 de um erro de verdade e troca o banner genérico de "Tentar de
 * novo" pela MESMA apresentação que a aba Code usa
 * (`ContainerImageGateNotice`) — retentativa é a afordância errada para um
 * estado que só se resolve quando o Arquiteto decide, nunca clicando de
 * novo.
 */
export function PrListAndDiff({ projectId, renderItemExtra }: PrListAndDiffProps) {
  const { t } = useTranslation('code');
  const [filtro, setFiltro] = useState<CodePullRequestState | 'all'>('open');
  const [idDigitado, setIdDigitado] = useState('');
  const [selecionada, setSelecionada] = useState<CodePullRequestSummary | null>(null);
  const [prIdManual, setPrIdManual] = useState<string | null>(null);

  const prId = selecionada?.id ?? prIdManual;

  const listaQuery = useQuery({
    queryKey: ['code-pull-requests', projectId, filtro],
    queryFn: () => getCodePullRequests(projectId, filtro === 'all' ? {} : { state: filtro }),
    enabled: !prId,
  });

  const diffQuery = useQuery({
    queryKey: ['code-diff', projectId, prId],
    queryFn: () => getCodeDiff(projectId, prId!),
    enabled: Boolean(prId),
  });

  function voltarParaLista() {
    setSelecionada(null);
    setPrIdManual(null);
    setIdDigitado('');
  }

  if (prId) {
    return (
      <div className={styles.painel}>
        <div className={styles.cabecalhoDiff}>
          <button type="button" className={styles.botaoVoltar} onClick={voltarParaLista}>
            <ArrowLeftIcon size={14} />
            {t('diff.backToList')}
          </button>
          {selecionada && (
            <span className={styles.tituloDiff}>
              <span className={styles.tituloDiffTexto}>
                #{selecionada.number} {selecionada.title}
              </span>
              <span className={styles.branches}>
                {selecionada.sourceBranch} → {selecionada.targetBranch}
              </span>
            </span>
          )}
        </div>

        {diffQuery.isLoading && <div className={styles.estado}>{t('diff.loadingDiff')}</div>}

        {diffQuery.isError &&
          (isContainerImageGateError(diffQuery.error) ? (
            <ContainerImageGateNotice />
          ) : (
            <div className={styles.estadoErro} role="alert">
              <span>{mensagemDaApi(diffQuery.error, t('diff.diffErrorFallback'))}</span>
              <button type="button" className={styles.botaoTentar} onClick={() => void diffQuery.refetch()}>
                {t('shared.retry')}
              </button>
            </div>
          ))}

        {diffQuery.data && diffQuery.data.files.length === 0 && (
          <div className={styles.estado}>{t('diff.noFiles')}</div>
        )}

        {diffQuery.data && diffQuery.data.files.length > 0 && (
          <div className={styles.lista}>
            {diffQuery.data.files.map((arquivo) => (
              <Disclosure
                key={`${arquivo.path}:${arquivo.status}`}
                titulo={
                  <span className={styles.tituloArquivo}>
                    <span className={styles.caminho}>{arquivo.path}</span>
                    <span className={styles.selo}>{t(CHAVE_STATUS[arquivo.status])}</span>
                  </span>
                }
                trailing={
                  <span className={styles.contadores}>
                    <span className={styles.add}>+{arquivo.additions}</span>{' '}
                    <span className={styles.del}>−{arquivo.deletions}</span>
                  </span>
                }
              >
                <ConteudoDoPatch arquivo={arquivo} />
              </Disclosure>
            ))}
            {diffQuery.data.truncated && (
              <div className={styles.truncado}>{t('diff.truncatedFiles')}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.painel}>
      <div className={styles.filtros} role="tablist" aria-label="Filtrar por estado">
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            type="button"
            role="tab"
            aria-selected={filtro === f.chave}
            className={[styles.filtro, filtro === f.chave && styles.filtroAtivo].filter(Boolean).join(' ')}
            onClick={() => setFiltro(f.chave)}
          >
            {t(f.chaveRotulo)}
          </button>
        ))}
      </div>

      {listaQuery.isLoading && <div className={styles.estado}>{t('diff.loadingPrs')}</div>}

      {listaQuery.isError &&
        (isContainerImageGateError(listaQuery.error) ? (
          <ContainerImageGateNotice />
        ) : (
          <div className={styles.estadoErro} role="alert">
            <span>{mensagemDaApi(listaQuery.error, t('diff.prListErrorFallback'))}</span>
            <button type="button" className={styles.botaoTentar} onClick={() => void listaQuery.refetch()}>
              {t('shared.retry')}
            </button>
          </div>
        ))}

      {listaQuery.data && listaQuery.data.items.length === 0 && (
        <div className={styles.estado}>
          {filtro !== 'all'
            ? t('diff.noPrsWithState', { state: t(CHAVE_ESTADO_PR[filtro]) })
            : t('diff.noPrsAny')}
        </div>
      )}

      {listaQuery.data && listaQuery.data.items.length > 0 && (
        <ul className={styles.listaPr}>
          {listaQuery.data.items.map((pr) => (
            <li key={pr.id}>
              <div className={styles.itemPrLinha}>
                <button
                  type="button"
                  className={styles.itemPr}
                  aria-label={t('diff.openPrAriaLabel', { number: pr.number, title: pr.title })}
                  onClick={() => setSelecionada(pr)}
                >
                  <PrIcon size={15} className={styles[`estadoIcone_${pr.state}`]} />
                  <span className={styles.itemPrCorpo}>
                    <span className={styles.itemPrTitulo}>
                      #{pr.number} {pr.title}
                    </span>
                    <span className={styles.itemPrMeta}>
                      {pr.author ?? t('diff.unknownAuthor')} · {pr.sourceBranch} → {pr.targetBranch}
                      {pr.updatedAt && ` · ${new Date(pr.updatedAt).toLocaleDateString('pt-BR')}`}
                    </span>
                  </span>
                  <span className={[styles.itemPrEstado, styles[`estadoSelo_${pr.state}`]].join(' ')}>
                    {t(CHAVE_ESTADO_PR[pr.state])}
                  </span>
                </button>
                {renderItemExtra && (
                  <div className={styles.itemPrExtra}>{renderItemExtra(pr)}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {listaQuery.data?.truncated && (
        <div className={styles.truncado}>{t('diff.truncatedList')}</div>
      )}

      <form
        className={styles.formularioManual}
        onSubmit={(e) => {
          e.preventDefault();
          if (idDigitado.trim()) setPrIdManual(idDigitado.trim());
        }}
      >
        <label className={styles.label} htmlFor="diff-pr-id">
          {t('diff.idLabel')}
        </label>
        <input
          id="diff-pr-id"
          className={styles.input}
          value={idDigitado}
          onChange={(e) => setIdDigitado(e.target.value)}
          placeholder={t('diff.idPlaceholder')}
        />
        <button type="submit" className={styles.botao}>
          {t('diff.viewDiffButton')}
        </button>
      </form>
    </div>
  );
}

function ConteudoDoPatch({ arquivo }: { arquivo: CodeDiffFile }) {
  const { t } = useTranslation('code');
  // `null` é "o provider não entregou o texto" (binário, ou patch grande
  // demais) — distinto de `''`, que é "veio vazio" de verdade. Tratar os
  // dois igual faria a tela dizer "sem mudanças" num binário alterado.
  if (arquivo.patch === null) {
    return <div className={styles.semTexto}>{t('diff.noPatchText')}</div>;
  }
  if (arquivo.patch === '') {
    return <div className={styles.semTexto}>{t('diff.emptyPatchText')}</div>;
  }
  return (
    <pre className={styles.patch}>
      {arquivo.patch.split('\n').map((linha, i) => (
        <div
          key={i}
          className={[
            styles.linhaPatch,
            linha.startsWith('+') && !linha.startsWith('+++') && styles.linhaAdd,
            linha.startsWith('-') && !linha.startsWith('---') && styles.linhaDel,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {linha || ' '}
        </div>
      ))}
    </pre>
  );
}
