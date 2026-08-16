import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRagCoverage, mensagemDaApi, reindexRag, searchRag } from '../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import type { RagChunkScope } from '../lib/api-types';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { RagCitationCard } from '../components/rag/RagCitationCard';
import { RagCoveragePanel } from '../components/rag/RagCoveragePanel';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/ToastProvider';
import { AlertIcon, SearchIcon } from '../components/ui/icons';
import styles from './ProjectRagTab.module.css';

const ESCOPOS: { chave: RagChunkScope; rotulo: string }[] = [
  { chave: 'docs', rotulo: 'Docs' },
  { chave: 'adr', rotulo: 'ADR' },
  { chave: 'session', rotulo: 'Sessões' },
];

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
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const podeReindexar = comPapel?.role === 'owner' || comPapel?.role === 'maintainer';

  const [termo, setTermo] = useState('');
  const [buscado, setBuscado] = useState<string | null>(null);
  const [escopos, setEscopos] = useState<Set<RagChunkScope>>(new Set());

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
        title: 'Reindexação concluída',
        message: `${relatorio.docs.docsChunks + relatorio.docs.adrChunks} chunk(s) de docs/ADR · ${relatorio.sessions.indexed} de ${relatorio.sessions.total} sessão(ões)${relatorio.embeddingAvailable ? '' : ' · embedding indisponível, indexado só com o sinal léxico'}`,
        tone: relatorio.embeddingAvailable ? 'success' : 'warning',
      });
    },
    onError: (erro) =>
      showToast({
        title: 'Reindexação falhou',
        message: mensagemDaApi(erro, 'A api não respondeu. O índice não foi alterado.'),
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
          <h2 className={styles.titulo}>Chat RAG</h2>
          <p className={styles.subtitulo}>
            Busca híbrida (vetor + léxico) sobre docs/ADR do repositório e as
            conversas registradas neste projeto — nunca código-fonte, nunca
            Pull Request.
          </p>
        </div>
        {podeReindexar && (
          <Button
            variant="secondary"
            onClick={() => reindexMutation.mutate()}
            loading={reindexMutation.isPending}
          >
            {reindexMutation.isPending ? 'Reindexando…' : 'Reindexar agora'}
          </Button>
        )}
      </div>

      {coverageQuery.isError && (
        <ErroDeCarregamento
          titulo="Não consegui carregar a cobertura do índice."
          erro={coverageQuery.error}
          onTentarDeNovo={() => void coverageQuery.refetch()}
        />
      )}
      {coverageQuery.isLoading && <div className={styles.estado}>Carregando cobertura…</div>}
      {coverageQuery.data && <RagCoveragePanel coverage={coverageQuery.data} />}

      <form className={styles.formulario} onSubmit={submeter}>
        <div className={styles.linhaBusca}>
          <input
            className={styles.input}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar no índice (mín. 2 caracteres)"
            aria-label="Termo de busca"
          />
          <Button type="submit" disabled={termo.trim().length < 2}>
            <SearchIcon size={14} /> Buscar
          </Button>
        </div>
        <div className={styles.escoposFiltro} role="group" aria-label="Filtrar por escopo">
          {ESCOPOS.map((e) => (
            <button
              key={e.chave}
              type="button"
              className={escopos.has(e.chave) ? `${styles.pill} ${styles.pillAtivo}` : styles.pill}
              aria-pressed={escopos.has(e.chave)}
              onClick={() => alternarEscopo(e.chave)}
            >
              {e.rotulo}
            </button>
          ))}
          <span className={styles.escoposNota}>
            {escopos.size === 0 ? 'todos os escopos' : `${escopos.size} escopo(s) marcado(s)`}
          </span>
        </div>
      </form>

      <div className={styles.resultados}>
        {!buscado && <div className={styles.estado}>Digite um termo e busque no índice do projeto.</div>}

        {buscado && searchQuery.isLoading && <div className={styles.estado}>Buscando…</div>}

        {buscado && searchQuery.isError && (
          <ErroDeCarregamento
            titulo="Não consegui buscar agora."
            erro={searchQuery.error}
            onTentarDeNovo={() => void searchQuery.refetch()}
          />
        )}

        {buscado && searchQuery.data && (
          <>
            {!searchQuery.data.vectorAvailable && (
              <div className={styles.avisoVetor} role="status">
                <AlertIcon size={14} />
                Busca só por palavra-chave — embedding indisponível
                {searchQuery.data.vectorUnavailableReason && `: ${searchQuery.data.vectorUnavailableReason}`}
              </div>
            )}

            {searchQuery.data.hits.length === 0 ? (
              <div className={styles.estado}>Nenhum resultado para “{searchQuery.data.query}”.</div>
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
