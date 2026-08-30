import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getContainerState, getProject } from '../lib/api-client';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { ContainerImageGateNotice } from '../components/ContainerImageGate';
import { Skeleton } from '../components/ui/Skeleton';
import { CodeShell } from './code/CodeShell';
import styles from './ProjectCodeTab.module.css';

/**
 * A aba Code — só leitura (FASE 26).
 *
 * ## O gate (RN-107, item 1 da fase)
 *
 * A api já recusa as sete rotas de leitura (FASE 26b) com 409 enquanto o
 * Arquiteto não decide a imagem do container (RN-105) — mas deixar a tela
 * descobrir isso só quando a PRIMEIRA árvore falhar mostraria o editor vazio
 * por um instante e um erro genérico depois. Em vez disso a aba pergunta
 * primeiro (`GET /projects/:id/container`) e mostra um QUARTO estado,
 * distinto dos três da RN-088: "bloqueado por decisão pendente" não é
 * carregando, não é erro (a api respondeu certo) e não é vazio (não é
 * ausência de dado — é uma decisão que ainda não existe). A apresentação
 * deste estado é `ContainerImageGateNotice` (`components/ContainerImageGate.tsx`)
 * — extraída daqui para a aba PRs (`code/PrListAndDiff.tsx`) reusar a mesma
 * cara quando o mesmo 409 vaza de `getCodePullRequests`/`getCodeDiff`.
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
 * ## A sidebar não recolhe mais sozinha (ADR 0126)
 *
 * Até a revisão da RN-201 esta aba chamava `useAutoCollapseSidebar()` para
 * dar largura ao editor. Com o trilho vertical do projeto sempre presente,
 * isso encostaria a trilha de ícones do Shell no trilho do projeto — dois
 * trilhos verticais adjacentes, permanentes, justo aqui. O preço é real e
 * está declarado no ADR: esta aba nasce com 492px de moldura à esquerda
 * (264 + 180 + 48), contra ~110px antes. Recolher continua possível — pelo
 * botão da sidebar, e aí é escolha do usuário, persistida.
 *
 * ## Congelamento
 *
 * Nenhuma escrita mora aqui nem em `code/*`. O que a árvore, a busca, o diff,
 * o blame, a lista de PRs e as branches mostram vem só das sete rotas de
 * `code.controller.ts`; salvar um arquivo é fase seguinte — vira
 * `proposed_action`, como todo efeito externo.
 */
export function ProjectCodeTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('code');

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  // `false` enquanto `projectQuery.data` ainda não chegou — `undefined !==
  // 'container'` seria `true` e abriria o shell ANTES de saber o modo real
  // (bug achado pelo teste de "carregando" desta mesma tela).
  const modoLocal = projectQuery.data
    ? projectQuery.data.executionMode !== 'container'
    : false;

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
          titulo={t('projectCodeTab.loadProjectError')}
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
          titulo={t('projectCodeTab.checkGateError')}
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
        <ContainerImageGateNotice />
      </div>
    );
  }

  return <CodeShell projectId={projectId} />;
}
