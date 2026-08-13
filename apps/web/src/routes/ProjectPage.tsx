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
import { BranchIcon, GitHubIcon, GitLabIcon, LocalRepoIcon } from '../components/ui/icons';
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

/** O chip ao lado do nome diz o que o repositório É, em pt-BR (handoff, seção 4). */
const VISIBILIDADE = { public: 'público', private: 'privado' } as const;

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
  const aba = abaPorChave(tab);
  const PainelDaAba = aba.component;

  return (
    <div className={styles.wrapper}>
      {/* A régua vive DENTRO do cabeçalho, e o cabeçalho é uma faixa
          `surface-1` com uma única divisória embaixo (handoff, seção 4). Eram
          dois blocos com `border-bottom` cada um, e a régua no fundo da
          página: duas linhas de 1px separadas por 40px de nada. */}
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.headerLeft}>
            <span className={styles.providerIcon}>
              <ProviderIcon size={19} />
            </span>
            <div className={styles.identity}>
              <div className={styles.titleRow}>
                <h1 className={styles.name}>{project.name}</h1>
                {repository && (
                  <span className={styles.repoChip}>
                    {repository.provider} · {VISIBILIDADE[repository.visibility]}
                  </span>
                )}
              </div>
              <div className={styles.meta}>
                {repository ? (
                  <>
                    <BranchIcon size={13} />
                    <span className={styles.metaStrong}>{repository.defaultBranch}</span>
                    {/* Fase 12a: adotado é fato permanente do projeto, e
                        saber que o repo veio de fora muda como se lê tudo
                        o mais (a política de branches é dele, não nossa). */}
                    {repository.origin === 'adopted' && (
                      <>
                        <span className={styles.metaSep} />
                        <span>adotado</span>
                      </>
                    )}
                  </>
                ) : (
                  'repositório não provisionado'
                )}
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
      </header>

      {/* Quem manda no respiro é o REGISTRO, não um `tab === 'overview'`
          escrito aqui: a Visão geral desenha as próprias regiões até a borda
          (o feed é um trilho com divisória à esquerda, não um card solto). */}
      <div className={[styles.body, aba.semRespiro && styles.bodyRente].filter(Boolean).join(' ')}>
        <PainelDaAba projectId={projectId} />
      </div>
    </div>
  );
}
