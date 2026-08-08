import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProject, getProjectBudget, getRepository } from '../lib/api-client';
import {
  useBacklog,
  useHypotheses,
  useLatestSession,
  usePendingActions,
} from '../lib/hooks';
import { setLastSeenSeq } from '../lib/read-state';
import { TokenMeter } from '../components/TokenMeter';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { Skeleton } from '../components/ui/Skeleton';
import { Tabs } from '../components/ui/Tabs';
import { GitHubIcon, GitLabIcon, LocalRepoIcon } from '../components/ui/icons';
import { aguardandoPromocao } from './ProjectBacklogTab';
import {
  ABAS_DO_PROJETO,
  ABA_PADRAO,
  abaPorChave,
  type ChaveDeAba,
  type ContagensDeAba,
} from './project-tabs';
import styles from './ProjectPage.module.css';

const PROVIDER_ICON = { github: GitHubIcon, gitlab: GitLabIcon, local: LocalRepoIcon } as const;

interface ProjectPageProps {
  projectId: string;
  initialTab?: ChaveDeAba;
}

export function ProjectPage({ projectId, initialTab }: ProjectPageProps) {
  const [tab, setTab] = useState<ChaveDeAba>(initialTab ?? ABA_PADRAO);

  const projectQuery = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) });
  const project = projectQuery.data;
  const { data: repository } = useQuery({ queryKey: ['repository', projectId], queryFn: () => getRepository(projectId) });
  const { data: budget } = useQuery({ queryKey: ['budget', projectId], queryFn: () => getProjectBudget(projectId) });

  const { latest: latestSession } = useLatestSession(projectId);
  const pendingActionsQuery = usePendingActions(projectId, latestSession?.id);
  const pendingCount = pendingActionsQuery.data?.items.filter((a) => a.status === 'pending').length ?? 0;

  // Histórias esperando promoção do usuário (Fase 12c — RN-048). Contador
  // próprio, ao lado do de aprovações: são duas filas de decisão diferentes,
  // e somá-las esconderia qual delas está pedindo atenção.
  const backlogQuery = useBacklog(projectId);
  const promocoesPendentes = aguardandoPromocao(backlogQuery.data).length;

  // Terceira fila de decisão do projeto: hipóteses do Psicólogo esperando
  // aceitar/descartar. Ficavam no fim da Visão geral, sem contador nenhum —
  // achado #15. Contador próprio pelo mesmo motivo do de promoções: somar
  // filas diferentes esconde qual delas está pedindo atenção.
  const hypothesesQuery = useHypotheses(projectId);
  const hipotesesPendentes = (hypothesesQuery.data ?? []).filter(
    (h) => h.status === 'proposed',
  ).length;

  const contagens: ContagensDeAba = {
    promocoesPendentes,
    aprovacoesPendentes: pendingCount,
    hipotesesPendentes,
  };

  useEffect(() => {
    // Literal de propósito: quem marca o projeto como lido é a Visão geral —
    // não "a aba padrão, seja ela qual for".
    if (tab === 'overview' && latestSession) {
      setLastSeenSeq(projectId, latestSession.nextSeq - 1);
    }
  }, [tab, latestSession, projectId]);

  // Falha de carga DIZ o que houve, e a frase é a da api (RN-088).
  //
  // Era `if (!project) return null` — uma linha que tratava "a api recusou"
  // igual a "ainda não chegou". Com a api limitando por 429, a tela inteira
  // ficava BRANCA: sem mensagem, sem erro, sem esqueleto, e o motivo só no
  // console. É a RN-059 do outro lado do fio: falha nunca vira vazio.
  if (projectQuery.isError) {
    return (
      <div className={styles.falha}>
        <ErroDeCarregamento
          titulo="Não foi possível abrir este projeto."
          erro={projectQuery.error}
          onTentarDeNovo={() => void projectQuery.refetch()}
        />
      </div>
    );
  }

  // Só aqui é carregamento de verdade: pediu, não errou, ainda não voltou.
  if (!project) {
    return (
      <div className={styles.falha}>
        <Skeleton width={260} height={20} />
      </div>
    );
  }

  const ProviderIcon = PROVIDER_ICON[repository?.provider ?? 'local'];
  // O painel sai do registro, não de uma cadeia de `&&`: era ali que uma aba
  // nova entrava na régua e no `?tab=` sem nunca renderizar nada.
  const PainelDaAba = abaPorChave(tab).component;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.providerIcon}>
            <ProviderIcon size={18} />
          </span>
          <div>
            <div className={styles.titleRow}>
              <span className={styles.name}>{project.name}</span>
            </div>
            <div className={styles.meta}>
              {repository
                ? [
                    repository.provider,
                    repository.visibility,
                    repository.defaultBranch,
                    // Fase 12a: adotado é fato permanente do projeto, e
                    // saber que o repo veio de fora muda como se lê tudo
                    // o mais (a política de branches é dele, não nossa).
                    repository.origin === 'adopted' ? 'adotado' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'repositório não provisionado'}
            </div>
          </div>
        </div>

        {budget && (
          <TokenMeter
            variant="compact"
            unitLabel="USD"
            used={budget.spentMicros / 1_000_000}
            limit={budget.limitMicros / 1_000_000}
            costBRL={0}
            costUSD={budget.spentMicros / 1_000_000}
          />
        )}
      </div>

      <div className={styles.tabsRow}>
        <Tabs
          active={tab}
          onChange={(key) => setTab(key as ChaveDeAba)}
          items={ABAS_DO_PROJETO.map((aba) => ({
            key: aba.key,
            label: aba.label,
            count: aba.count?.(contagens),
          }))}
        />
      </div>

      <div className={styles.body}>
        <PainelDaAba projectId={projectId} />
      </div>
    </div>
  );
}
