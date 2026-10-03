import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getProject, getProjectBudget, getRepository } from '../lib/api-client';
import { useLatestSession } from '../lib/hooks';
import {
  publicarAbaAtiva,
  ouvirPedidosDeAba,
  useContagensDoProjeto,
} from '../lib/contagens-do-projeto';
import { setLastSeenSeq } from '../lib/read-state';
import { TokenMeter } from '../components/TokenMeter';
import { PainelPrecisaDeVoce } from '../components/PainelPrecisaDeVoce';
import { montarFilas } from '../lib/precisa-de-voce';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { Skeleton } from '../components/ui/Skeleton';
import { CarregandoRota } from '../components/CarregandoRota';
import { useLayoutMovel } from '../lib/layout-movel';
import { BranchIcon, GitHubIcon, GitLabIcon, LocalRepoIcon } from '../components/ui/icons';
import { ABA_PADRAO, abaPorChave, ehChaveDeAba, type ChaveDeAba } from './project-tabs';
import { ContextoDeSecaoInicial } from './settings/secao-inicial';
import type { ChaveDeSecao } from './settings/sumario';
import { Badge } from '../components/ui/Badge';
import styles from './ProjectPage.module.css';

const PROVIDER_ICON = { github: GitHubIcon, gitlab: GitLabIcon, local: LocalRepoIcon } as const;

/** O chip ao lado do nome diz o que o repositório É (handoff, seção 4). */
const VISIBILIDADE_KEY = { public: 'visibility.public', private: 'visibility.private' } as const;

interface ProjectPageProps {
  projectId: string;
  initialTab?: ChaveDeAba;
  /**
   * A seção de Configurações a que o deep-link `?section=` aponta. Chega por
   * CONTEXTO até a aba, e não por prop do painel: o registro de abas declara
   * um prop só para as doze (`project-tabs.ts`), e alargá-lo por causa de uma
   * faria a moldura voltar a carregar dado específico de uma aba.
   */
  initialSection?: ChaveDeSecao;
}

export function ProjectPage({ projectId, initialTab, initialSection }: ProjectPageProps) {
  const { t } = useTranslation('projectPage');
  const [tab, setTab] = useState<ChaveDeAba>(initialTab ?? ABA_PADRAO);
  const [painelAberto, setPainelAberto] = useState(false);
  // Layout móvel (RN-643): só os respiros encolhem — as abas moram na gaveta
  // da sidebar desde o ADR 0211.
  const movel = useLayoutMovel();

  // `initialTab` só valia no MOUNT (o nome já diz): um link `?tab=` clicado
  // de DENTRO de um `ProjectPage` já montado (ex.: "Ver arquitetura
  // completa" na Visão geral, Onda 3) muda a URL mas não remonta esta
  // página — mesma rota, só a busca muda — e o `useState` acima ignora
  // atualização de valor inicial. Sem este efeito o clique reescrevia a URL
  // e não movia a régua nenhum milímetro. `latestSession`/promoção (efeito
  // logo abaixo) continuam olhando só o `tab` resolvido, não `initialTab`.
  //
  // ADR 0211: a troca de aba vem da sidebar, que navega pelo router — e o
  // link do PROJETO (sem `?tab=`) volta à aba padrão, em vez de deixar a
  // moldura presa na última aba aberta.
  useEffect(() => {
    setTab(initialTab ?? ABA_PADRAO);
  }, [initialTab]);

  // A sidebar marca a aba que ESTA moldura mostra (ADR 0211) — inclusive
  // quando quem trocou foi o painel "precisa de você", sem passar pelo router.
  useEffect(() => {
    publicarAbaAtiva({ projectId, tab });
  }, [projectId, tab]);
  useEffect(() => () => publicarAbaAtiva(null), []);
  // E o inverso: a sidebar PEDE a aba clicada antes de navegar, então o
  // clique na aba que a URL já tem (depois de um salto pelo painel, que não
  // passa pelo router) ainda troca a moldura.
  useEffect(
    () =>
      ouvirPedidosDeAba((pedido) => {
        if (pedido.projectId === projectId && ehChaveDeAba(pedido.tab)) setTab(pedido.tab);
      }),
    [projectId],
  );

  const projectQuery = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) });
  const project = projectQuery.data;
  const { data: repository } = useQuery({ queryKey: ['repository', projectId], queryFn: () => getRepository(projectId) });
  const { data: budget } = useQuery({ queryKey: ['budget', projectId], queryFn: () => getProjectBudget(projectId) });

  const { latest: latestSession } = useLatestSession(projectId);
  // As cinco filas de decisão, lidas pelo MESMO hook que a sidebar usa para os
  // contadores das abas (ADR 0211) — mesmas `queryKey`s, deduplicadas. Aqui
  // elas viram as cinco FILAS do painel "precisa de você" (RN-467), SEPARADAS:
  // sem soma nem no painel nem no chip.
  const filasDoProjeto = useContagensDoProjeto(projectId);
  const filasPrecisaDeVoce = montarFilas({
    acoesPendentes: filasDoProjeto.pendentesDoProjeto,
    merges: filasDoProjeto.merges,
    epicos: filasDoProjeto.epicos,
    pendenciasDeArquitetura: filasDoProjeto.pendenciasDeArquitetura,
    hipoteses: filasDoProjeto.hipoteses,
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

  return (
    <div className={[styles.wrapper, movel && styles.movel].filter(Boolean).join(' ')}>
      {/* O cabeçalho é uma faixa `surface-1` com uma única divisória embaixo
          (handoff, seção 4), e agora atravessa a largura inteira: a navegação
          saiu de dentro dele (ADR 0126) e mora na sidebar (ADR 0211). */}
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
                  <Badge square size="md" className={styles.repoChip}>
                    {repository.provider} · {t(VISIBILIDADE_KEY[repository.visibility])}
                  </Badge>
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
              onIrParaAba={(destino) => {
                setTab(destino satisfies ChaveDeAba);
                // O endereço acompanha a aba (AT-394), para recarregar abrir
                // onde se estava.
                try {
                  const url = new URL(window.location.href);
                  url.searchParams.set('tab', destino);
                  url.searchParams.delete('section');
                  window.history.replaceState(window.history.state, '', url);
                } catch {
                  // sem `window` (teste/SSR): só a troca local
                }
              }}
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
        {/* Quem manda no respiro é o REGISTRO, não um `tab === 'overview'`
            escrito aqui: a Visão geral desenha as próprias regiões até a borda
            (o feed é um trilho com divisória à esquerda, não um card solto). */}
        <div className={[styles.body, aba.semRespiro && styles.bodyRente].filter(Boolean).join(' ')}>
          <ContextoDeSecaoInicial.Provider value={initialSection}>
            {/* Cada painel é um chunk próprio (AT-300): o `Suspense` fica AQUI,
                em volta só do painel, para que trocar de aba nunca apague o
                cabeçalho enquanto o chunk chega. */}
            <Suspense fallback={<CarregandoRota />}>
              <PainelDaAba projectId={projectId} />
            </Suspense>
          </ContextoDeSecaoInicial.Provider>
        </div>
      </div>
    </div>
  );
}
