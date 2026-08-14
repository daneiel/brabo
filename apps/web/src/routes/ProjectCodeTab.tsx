import { useQuery } from '@tanstack/react-query';
import { getContainerState, getProject } from '../lib/api-client';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { Skeleton } from '../components/ui/Skeleton';
import { LockIcon } from '../components/ui/icons';
import { CodeShell } from './code/CodeShell';
import styles from './ProjectCodeTab.module.css';

/**
 * A aba Code — só leitura (FASE 26).
 *
 * ## O gate (RN-107, item 1 da fase)
 *
 * A api já recusa as quatro rotas de leitura com 409 enquanto o Arquiteto não
 * decide a imagem do container (RN-105) — mas deixar a tela descobrir isso só
 * quando a PRIMEIRA árvore falhar mostraria o editor vazio por um instante e
 * um erro genérico depois. Em vez disso a aba pergunta primeiro
 * (`GET /projects/:id/container`) e mostra um QUARTO estado, distinto dos três
 * da RN-088: "bloqueado por decisão pendente" não é carregando, não é erro (a
 * api respondeu certo) e não é vazio (não é ausência de dado — é uma decisão
 * que ainda não existe).
 *
 * ## O modo Local não passa pelo gate (RN-169, ADR 0072)
 *
 * Projeto no modo `local` não sobe container, então a decisão do Arquiteto
 * nunca vai acontecer e a api já libera a leitura para ele. A tela precisa
 * concordar: sem isto, a aba ficaria eternamente na tela de bloqueio de uma
 * decisão que não existe — o mesmo defeito do lado do servidor, com outra
 * cara. A pergunta é feita ao MESMO `queryKey: ['project', projectId]` que a
 * tela de projeto já usa, então não custa requisição nova.
 *
 * ## Congelamento
 *
 * Nenhuma escrita mora aqui nem em `code/*`. O que a árvore, a busca e o diff
 * mostram vem só das quatro rotas de `code.controller.ts`; salvar um arquivo é
 * fase seguinte — vira `proposed_action`, como todo efeito externo.
 */
export function ProjectCodeTab({ projectId }: { projectId: string }) {
  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const modoLocal = projectQuery.data?.workspaceMode === 'local';

  const containerQuery = useQuery({
    queryKey: ['container', projectId],
    queryFn: () => getContainerState(projectId),
    // Só reconsulta sozinha enquanto BLOQUEADA — depois de decidida, a imagem
    // não muda sem uma ação humana nova, e ficar reconsultando um estado
    // estável seria só tráfego (a mesma família de defeito da PÓS-FASE 15).
    refetchInterval: (query) =>
      query.state.data?.status === 'sem_decisao' ? 15_000 : false,
    // Projeto Local não tem o que perguntar: não há container a decidir.
    enabled: projectQuery.isSuccess && !modoLocal,
  });

  // A leitura já está liberada — o gate inteiro abaixo é sobre o container.
  if (modoLocal) return <CodeShell projectId={projectId} />;

  if (projectQuery.isError) {
    return (
      <div className={styles.estadoPagina}>
        <ErroDeCarregamento
          titulo="Não consegui carregar este projeto."
          erro={projectQuery.error}
          onTentarDeNovo={() => void projectQuery.refetch()}
        />
      </div>
    );
  }

  if (containerQuery.isError) {
    return (
      <div className={styles.estadoPagina}>
        <ErroDeCarregamento
          titulo="Não consegui verificar se a aba Code está liberada."
          erro={containerQuery.error}
          onTentarDeNovo={() => void containerQuery.refetch()}
        />
      </div>
    );
  }

  if (!projectQuery.data || !containerQuery.data) {
    return (
      <div className={styles.estadoPagina}>
        <Skeleton width={280} height={20} />
        <Skeleton width={200} height={14} />
      </div>
    );
  }

  if (containerQuery.data.status === 'sem_decisao') {
    return (
      <div className={styles.estadoPagina}>
        <div className={styles.bloqueado} role="status">
          <span className={styles.bloqueadoIcone} aria-hidden="true">
            <LockIcon size={22} />
          </span>
          <h2 className={styles.bloqueadoTitulo}>
            A aba Code ainda não está liberada
          </h2>
          <p className={styles.bloqueadoTexto}>
            O Arquiteto ainda não decidiu qual imagem de container sobe para
            este projeto. Sem essa decisão o container não sobe, e é ele que
            isola a execução — não há onde rodar o código que esta aba
            mostraria.
          </p>
          <p className={styles.bloqueadoNota}>
            Assim que o Arquiteto emitir a decisão de imagem, esta aba libera
            sozinha — não é preciso recarregar a página manualmente.
          </p>
        </div>
      </div>
    );
  }

  return <CodeShell projectId={projectId} />;
}
