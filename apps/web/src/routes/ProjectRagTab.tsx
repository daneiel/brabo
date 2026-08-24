import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRagCoverage, mensagemDaApi, reindexRag, searchRag } from '../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import type { RagChunkScope } from '../lib/api-types';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { RagCitationCard } from '../components/rag/RagCitationCard';
import { RagCoveragePanel } from '../components/rag/RagCoveragePanel';
import { AttachLocalFolderModal } from '../components/rag/AttachLocalFolderModal';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/ToastProvider';
import { AlertIcon, FolderIcon, SearchIcon } from '../components/ui/icons';
import styles from './ProjectRagTab.module.css';

const ORDEM_DOS_ESCOPOS: RagChunkScope[] = ['docs', 'adr', 'session', 'local'];

const CHAVE_DO_ESCOPO: Record<RagChunkScope, string> = {
  docs: 'rag.scopes.docs',
  adr: 'rag.scopes.adr',
  session: 'rag.scopes.session',
  local: 'rag.scopes.local',
};

/**
 * A tela do Chat RAG (PROGRAMA 28, Onda 5, frente G3) — busca híbrida sobre o
 * índice de `docs/`, `docs/adr/` e conversas registradas (RN-231..238,
 * ADR 0080).
 *
 * ## Degradação honesta (RN-252)
 *
 * Duas peças do backend já degradam sem fingir: `vectorAvailable: false` na
 * busca (RN-233 — o provider de embedding não respondeu, e a busca rodou só
 * com o sinal léxico) e a cobertura sem NENHUM "reindexado há Xmin" (RN-237 —
 * não existe essa coluna, e um número chutado mentiria). Esta tela é onde as
 * duas viram texto visível: um aviso acima dos resultados quando o vetor
 * faltou, e um painel de cobertura que só mostra contagem real.
 *
 * ## O que NÃO é esta tela
 *
 * Não é a aba `sessions` ("Chat") — aquela é conversa com um agente ativado;
 * esta é busca sobre o que já foi indexado, sem agente nenhum no meio
 * (RN-202/ADR 0078 continuam valendo para a outra aba).
 */
export function ProjectRagTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('sessions');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const podeReindexar = comPapel?.role === 'owner' || comPapel?.role === 'maintainer';

  const [termo, setTermo] = useState('');
  const [buscado, setBuscado] = useState<string | null>(null);
  const [escopos, setEscopos] = useState<Set<RagChunkScope>>(new Set());
  const [anexandoPasta, setAnexandoPasta] = useState(false);

  const coverageQuery = useQuery({
    queryKey: ['rag-coverage', projectId],
    queryFn: () => getRagCoverage(projectId),
  });

  const searchQuery = useQuery({
    queryKey: ['rag-search', projectId, buscado, [...escopos].sort().join(',')],
    queryFn: () =>
      searchRag(projectId, {
        query: buscado!,
        scopes: escopos.size > 0 ? [...escopos] : undefined,
      }),
    enabled: Boolean(buscado),
  });

  const reindexMutation = useMutation({
    mutationFn: () => reindexRag(projectId),
    onSuccess: (relatorio) => {
      void queryClient.invalidateQueries({ queryKey: ['rag-coverage', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['rag-search', projectId] });
      showToast({
        title: t('rag.reindexSuccessTitle'),
        message: t('rag.reindexSuccessMessage', {
          docsAdrChunks: relatorio.docs.docsChunks + relatorio.docs.adrChunks,
          indexed: relatorio.sessions.indexed,
          total: relatorio.sessions.total,
          embeddingSuffix: relatorio.embeddingAvailable
            ? ''
            : t('rag.embeddingUnavailableSuffix'),
        }),
        tone: relatorio.embeddingAvailable ? 'success' : 'warning',
      });
    },
    onError: (erro) =>
      showToast({
        title: t('rag.reindexErrorTitle'),
        message: mensagemDaApi(erro, t('rag.reindexErrorDefaultMessage')),
        tone: 'danger',
      }),
  });

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    const limpo = termo.trim();
    if (limpo.length >= 2) setBuscado(limpo);
  }

  function alternarEscopo(chave: RagChunkScope) {
    setEscopos((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(chave)) proximo.add(chave);
      return proximo;
    });
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <div>
          <h2 className={styles.titulo}>{t('rag.title')}</h2>
          <p className={styles.subtitulo}>{t('rag.subtitle')}</p>
        </div>
        {podeReindexar && (
          <div className={styles.acoesCabecalho}>
            <Button variant="secondary" onClick={() => setAnexandoPasta(true)}>
              <FolderIcon size={14} /> {t('rag.attachLocalFolder.button')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => reindexMutation.mutate()}
              loading={reindexMutation.isPending}
            >
              {reindexMutation.isPending ? t('rag.reindexButton.loading') : t('rag.reindexButton.idle')}
            </Button>
          </div>
        )}
      </div>

      {anexandoPasta && (
        <AttachLocalFolderModal
          projectId={projectId}
          onClose={() => setAnexandoPasta(false)}
          onAttached={() => {
            setAnexandoPasta(false);
            void queryClient.invalidateQueries({ queryKey: ['rag-coverage', projectId] });
            void queryClient.invalidateQueries({ queryKey: ['rag-search', projectId] });
          }}
        />
      )}

      {coverageQuery.isError && (
        <ErroDeCarregamento
          titulo={t('rag.coverageError')}
          erro={coverageQuery.error}
          onTentarDeNovo={() => void coverageQuery.refetch()}
        />
      )}
      {coverageQuery.isLoading && <div className={styles.estado}>{t('rag.loadingCoverage')}</div>}
      {coverageQuery.data && <RagCoveragePanel coverage={coverageQuery.data} />}

      <form className={styles.formulario} onSubmit={submeter}>
        <div className={styles.linhaBusca}>
          <input
            className={styles.input}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder={t('rag.searchPlaceholder')}
            aria-label={t('rag.searchAriaLabel')}
          />
          <Button type="submit" disabled={termo.trim().length < 2}>
            <SearchIcon size={14} /> {t('rag.searchButton')}
          </Button>
        </div>
        <div className={styles.escoposFiltro} role="group" aria-label={t('rag.scopeFilterAriaLabel')}>
          {ORDEM_DOS_ESCOPOS.map((chave) => (
            <button
              key={chave}
              type="button"
              className={escopos.has(chave) ? `${styles.pill} ${styles.pillAtivo}` : styles.pill}
              aria-pressed={escopos.has(chave)}
              onClick={() => alternarEscopo(chave)}
            >
              {t(CHAVE_DO_ESCOPO[chave])}
            </button>
          ))}
          <span className={styles.escoposNota}>
            {escopos.size === 0
              ? t('rag.allScopes')
              : t('rag.scopesMarked', { count: escopos.size })}
          </span>
        </div>
      </form>

      <div className={styles.resultados}>
        {!buscado && <div className={styles.estado}>{t('rag.emptyPrompt')}</div>}

        {buscado && searchQuery.isLoading && <div className={styles.estado}>{t('rag.searching')}</div>}

        {buscado && searchQuery.isError && (
          <ErroDeCarregamento
            titulo={t('rag.searchError')}
            erro={searchQuery.error}
            onTentarDeNovo={() => void searchQuery.refetch()}
          />
        )}

        {buscado && searchQuery.data && (
          <>
            {!searchQuery.data.vectorAvailable && (
              <div className={styles.avisoVetor} role="status">
                <AlertIcon size={14} />
                {t('rag.vectorUnavailable')}
                {searchQuery.data.vectorUnavailableReason && `: ${searchQuery.data.vectorUnavailableReason}`}
              </div>
            )}

            {searchQuery.data.hits.length === 0 ? (
              <div className={styles.estado}>{t('rag.noResults', { query: searchQuery.data.query })}</div>
            ) : (
              <div className={styles.listaResultados}>
                {searchQuery.data.hits.map((hit) => (
                  <RagCitationCard key={hit.chunkId} hit={hit} projectId={projectId} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
