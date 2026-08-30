import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getProject, getProjectBudget, getRepository } from '../lib/api-client';
import {
  useArchitecture,
  useBacklog,
  useHypotheses,
  useLatestSession,
  usePendingActions,
  useProjectPendingActions,
} from '../lib/hooks';
import { setLastSeenSeq } from '../lib/read-state';
import { TokenMeter } from '../components/TokenMeter';
import { PainelPrecisaDeVoce } from '../components/PainelPrecisaDeVoce';
import { montarFilas } from '../lib/precisa-de-voce';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { Skeleton } from '../components/ui/Skeleton';
import { ProjectRail, type ItemDoTrilho } from './ProjectRail';
import { BranchIcon, GitHubIcon, GitLabIcon, LocalRepoIcon } from '../components/ui/icons';
import { aguardandoPromocao } from './ProjectBacklogTab';
import {
  ABA_PADRAO,
  abaPorChave,
  GRUPOS_DO_PROJETO,
  type ChaveDeAba,
  type ContagensDeAba,
} from './project-tabs';
import styles from './ProjectPage.module.css';

const PROVIDER_ICON = { github: GitHubIcon, gitlab: GitLabIcon, local: LocalRepoIcon } as const;

/** O chip ao lado do nome diz o que o repositório É (handoff, seção 4). */
const VISIBILIDADE_KEY = { public: 'visibility.public', private: 'visibility.private' } as const;

interface ProjectPageProps {
  projectId: string;
  initialTab?: ChaveDeAba;
}

export function ProjectPage({ projectId, initialTab }: ProjectPageProps) {
  const { t } = useTranslation('projectPage');
  const [tab, setTab] = useState<ChaveDeAba>(initialTab ?? ABA_PADRAO);
  const [painelAberto, setPainelAberto] = useState(false);

  // `initialTab` só valia no MOUNT (o nome já diz): um link `?tab=` clicado
  // de DENTRO de um `ProjectPage` já montado (ex.: "Ver arquitetura
  // completa" na Visão geral, Onda 3) muda a URL mas não remonta esta
  // página — mesma rota, só a busca muda — e o `useState` acima ignora
  // atualização de valor inicial. Sem este efeito o clique reescrevia a URL
  // e não movia a régua nenhum milímetro. `latestSession`/promoção (efeito
  // logo abaixo) continuam olhando só o `tab` resolvido, não `initialTab`.
  useEffect(() => {
    if (initialTab) setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

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

  // Onda 3 do PROGRAMA de abas agrupadas: `arquiteturaPendente` deixou de
  // ser o placeholder fixo em `0`. A escolha NÃO é "diagrama ainda não
  // gerado" — isso é trabalho do Arquiteto, não uma fila de decisão do
  // usuário, e um selo ali seria ruído (mesma régua das outras três
  // contagens: o selo é sempre "algo espera SUA decisão"). O dado real que
  // já existe e É acionável é `architecture.pendencies` — as pendências de
  // validação cruzada entre história e módulo (mesmo campo que
  // `ArchitectureContent`/`ProjectArchitectureTab.tsx` já lista com badge
  // "Pendências de validação cruzada").
  const architectureQuery = useArchitecture(projectId);
  const arquiteturaPendente = architectureQuery.data?.pendencies.length ?? 0;

  // Onda 2 do PROGRAMA de abas agrupadas: `prsPendentes` deixou de ser o
  // placeholder fixo em `0`. O dado é PROJECT-WIDE de propósito (mesma
  // consulta que `ProjectPrsTab` usa) — `git_merge` pendente em qualquer
  // sessão, não só a mais recente, é a mesma correção que resolve o bug de
  // visibilidade da aba.
  const mergeActionsQuery = useProjectPendingActions(projectId, 'git_merge');
  const prsPendentes = mergeActionsQuery.data?.length ?? 0;

  const contagens: ContagensDeAba = {
    promocoesPendentes,
    aprovacoesPendentes: pendingCount,
    hipotesesPendentes,
    prsPendentes,
    arquiteturaPendente,
  };

  // As MESMAS cinco consultas acima, agora vistas como cinco FILAS num painel
  // só (chip "Precisa de você", no topo). Nenhuma requisição a mais: os cinco
  // hooks já rodam aqui para os contadores do trilho, e o painel lê o que eles
  // devolveram. As cinco continuam SEPARADAS — não há soma nem no painel nem
  // no chip, pelo mesmo motivo que os contadores do trilho seguem separados
  // (ADR 0126): somar apaga qual fila está pedindo atenção.
  const filasPrecisaDeVoce = montarFilas({
    acoesDaSessao: pendingActionsQuery.data?.items,
    merges: mergeActionsQuery.data,
    epicos: backlogQuery.data,
    pendenciasDeArquitetura: architectureQuery.data?.pendencies,
    hipoteses: hypothesesQuery.data,
  });

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
          titulo={t('loadErrorTitle')}
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

  // A estrutura (grupo/solta) sai de `GRUPOS_DO_PROJETO`; resolver `count`
  // contra `contagens` continua sendo trabalho DESTA página, mesma divisão
  // que já existia para `ABAS_DO_PROJETO` — o registro nunca viu um evento
  // de domínio, só sabe de ONDE tirar o número.
  const itensDoTrilho: ItemDoTrilho[] = GRUPOS_DO_PROJETO.map((item) =>
    item.tipo === 'grupo'
      ? {
          tipo: 'grupo' as const,
          chave: item.chave,
          label: item.label,
          abas: item.abas.map((filha) => ({
            key: filha.key,
            label: filha.label,
            count: filha.count?.(contagens),
          })),
        }
      : {
          tipo: 'aba' as const,
          aba: {
            key: item.aba.key,
            label: item.aba.label,
            count: item.aba.count?.(contagens),
          },
        },
  );

  return (
    <div className={styles.wrapper}>
      {/* O cabeçalho é uma faixa `surface-1` com uma única divisória embaixo
          (handoff, seção 4), e agora atravessa a largura inteira: a navegação
          saiu de dentro dele para o trilho vertical à esquerda (ADR 0126). */}
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
                    {repository.provider} · {t(VISIBILIDADE_KEY[repository.visibility])}
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
                        <span>{t('adopted')}</span>
                      </>
                    )}
                  </>
                ) : (
                  t('repositoryNotProvisioned')
                )}
              </div>
            </div>
          </div>

          <div className={styles.headerRight}>
            <PainelPrecisaDeVoce
              projectId={projectId}
              filas={filasPrecisaDeVoce}
              open={painelAberto}
              onOpenChange={setPainelAberto}
              // O painel não conhece `ChaveDeAba` de propósito (ver
              // `lib/precisa-de-voce.ts`); é aqui, onde o tipo já está em mãos,
              // que o destino vira aba de verdade.
              onIrParaAba={(destino) => setTab(destino satisfies ChaveDeAba)}
            />

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
        </div>

      </header>

      <div className={styles.corpo}>
        <ProjectRail
          active={tab}
          onChange={(key) => setTab(key as ChaveDeAba)}
          itens={itensDoTrilho}
        />

        {/* Quem manda no respiro é o REGISTRO, não um `tab === 'overview'`
            escrito aqui: a Visão geral desenha as próprias regiões até a borda
            (o feed é um trilho com divisória à esquerda, não um card solto). */}
        <div className={[styles.body, aba.semRespiro && styles.bodyRente].filter(Boolean).join(' ')}>
          <PainelDaAba projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
