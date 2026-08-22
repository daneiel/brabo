import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  getMySpend,
  getProject,
  getProjectBudget,
  getWorkspaceSpendReport,
} from '../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import { hashtagDaSessao } from '../lib/session-label';
import { numberFmt } from '../lib/currency';
import { ROTULO_DO_PROVIDER } from '../lib/models';
import type { LLMProviderName } from '../lib/api-types';
import {
  alertaDeOrcamento,
  rotuloDoAtor,
  tokensDe,
  type SpendLinha,
} from '../lib/spend';
import {
  BarrasPorDia,
  Destaque,
  Ranking,
  type LinhaDeRanking,
} from '../components/SpendCharts';
import { TokenMeter } from '../components/TokenMeter';
import {
  CredentialSpendSection,
  formatarUsd,
} from '../components/CredentialSpendSection';
import styles from './ProjectSpendTab.module.css';

/** Janela do relatório. Um mês é o ciclo em que uma fatura de LLM fecha. */
const DIAS = 30;

/**
 * A aba de Gastos — o mesmo gasto, para duas audiências (FASE 22, ADR 0063).
 *
 * O que ela mostra depende de QUEM olha, e não é preferência de layout:
 *
 * - o **owner** vê a conta do workspace inteiro. Onde o dinheiro foi (modelo,
 *   projeto, ator, dia) e, na seção que já existia, de que CHAVE saiu — a
 *   pergunta da fatura, que a RN-060 reserva a ele;
 * - o **membro** vê o que ELE consumiu neste projeto, em tokens e custo
 *   estimado. Sem provider e sem credencial: a chave que roda é a do owner
 *   (RN-058), e uma fatia de fatura alheia não é o que ele está perguntando.
 *
 * As duas leituras convivem porque nunca respondem a mesma coisa. O owner vê
 * as duas por ser a única pessoa que pode ver as duas.
 */
export function ProjectSpendTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('spend');
  const papel = useCurrentWorkspaceWithRole();

  // Ramificar antes de o papel chegar não é só um piscar de tela: `comPapel`
  // indefinido cairia na visão do membro e DISPARARIA a requisição dela, para
  // depois trocar tudo. Enquanto o papel é desconhecido não há pergunta a
  // fazer — e os três estados valem aqui também (RN-088).
  return (
    <div className={styles.pagina}>
      {papel.isLoading && (
        <div className={styles.estado}>{t('shared.loading')}</div>
      )}

      {papel.isError && (
        <div className={styles.estadoErro} role="alert">
          <span>{t('role.error')}</span>
          <button
            type="button"
            className={styles.botao}
            onClick={() => papel.refetch()}
          >
            {t('shared.retry')}
          </button>
        </div>
      )}

      {/* O orçamento é do PROJETO, não da audiência — mostra para as duas
          quando o papel alcança (`maintainer`+). Fica silencioso em erro
          (403 de quem não é maintainer no projeto): pedir 403 de propósito
          é o mesmo ruído que a RN-060 já evita para a fatura do owner, e é o
          mesmo padrão do `TokenMeter` compacto em `ProjectPage.tsx`. */}
      {papel.data && <OrcamentoDoProjeto projectId={projectId} />}

      {papel.data &&
        (papel.data.role === 'owner' ? (
          <GastoDoWorkspace projectId={projectId} />
        ) : (
          <MeuConsumo projectId={projectId} />
        ))}
    </div>
  );
}

/**
 * O bloco "por projeto" (RN-212) — `TokenMeter` PLUGADO, não reimplementado.
 * `tokenThreshold` (`TokenMeter.tsx`) já faz 70/90 virar cor; este bloco só
 * alimenta o componente com o orçamento REAL do projeto.
 *
 * Três leituras, e SILENCIOSA na terceira: carregando (nada, evita piscar
 * antes do papel resolver a audiência de baixo), sem orçamento definido
 * (`data === null` — nota text, sem CTA: esta aba não navega para
 * Configurações), e erro — que aqui é quase sempre 403 de quem não é
 * `maintainer` no PROJETO (papel de WORKSPACE não implica papel de projeto),
 * e por isso não vira banner: seria alarme falso pra maioria dos membros.
 */
function OrcamentoDoProjeto({ projectId }: { projectId: string }) {
  const { t } = useTranslation('spend');
  const budget = useQuery({
    queryKey: ['budget', projectId],
    queryFn: () => getProjectBudget(projectId),
  });

  if (budget.isLoading || budget.isError) return null;
  if (!budget.data) {
    return <p className={styles.nota}>{t('budget.notSet')}</p>;
  }

  const alerta = alertaDeOrcamento(budget.data);

  return (
    <div className={styles.orcamentoProjeto}>
      <TokenMeter
        unitLabel="USD"
        used={budget.data.spentMicros / 1_000_000}
        limit={budget.data.limitMicros / 1_000_000}
        costBRL={0}
        costUSD={budget.data.spentMicros / 1_000_000}
      />
      {alerta && (
        <div
          className={
            alerta.nivel === 'danger' ? styles.alertaDanger : styles.alertaWarning
          }
          role="alert"
        >
          {alerta.mensagem}
        </div>
      )}
    </div>
  );
}

/** A audiência do owner. */
function GastoDoWorkspace({ projectId }: { projectId: string }) {
  const { t } = useTranslation('spend');
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const workspaceId = project?.workspaceId;

  const relatorio = useQuery({
    queryKey: ['workspace-spend', workspaceId, DIAS],
    queryFn: () => getWorkspaceSpendReport(workspaceId!, DIAS),
    enabled: Boolean(workspaceId),
  });

  return (
    <>
      <header className={styles.cabecalho}>
        <h2 className={styles.titulo}>{t('workspace.title')}</h2>
        <p className={styles.subtitulo}>
          <Trans
            i18nKey="workspace.subtitle"
            ns="spend"
            values={{ dias: DIAS }}
            components={{ strong: <strong /> }}
          />
        </p>
      </header>

      {/* Os três estados, e o erro ANTES do vazio (RN-088). */}
      {relatorio.isLoading && (
        <div className={styles.estado}>{t('shared.summing')}</div>
      )}

      {relatorio.isError && (
        <div className={styles.estadoErro} role="alert">
          <span>{t('workspace.error')}</span>
          <button
            type="button"
            className={styles.botao}
            onClick={() => relatorio.refetch()}
          >
            {t('shared.retry')}
          </button>
        </div>
      )}

      {relatorio.data && (
        <>
          <div className={styles.destaques}>
            <Destaque
              rotulo={t('workspace.totalLabel', { dias: DIAS })}
              valor={formatarUsd(relatorio.data.totalMicros)}
              detalhe={t('workspace.callsDetail', {
                count: numberFmt.format(relatorio.data.chamadas),
              })}
            />
            <Destaque
              rotulo={t('workspace.tokensLabel')}
              valor={numberFmt.format(
                relatorio.data.inputTokens + relatorio.data.outputTokens,
              )}
              detalhe={t('shared.tokensDetail', {
                input: numberFmt.format(relatorio.data.inputTokens),
                output: numberFmt.format(relatorio.data.outputTokens),
              })}
            />
          </div>

          <div className={styles.faixa}>
            <BarrasPorDia
              serie={relatorio.data.porDia}
              titulo={t('workspace.dailySpendTitle')}
            />
          </div>

          <div className={styles.grade}>
            <Ranking
              titulo={t('workspace.byModelTitle')}
              linhas={comoRanking(relatorio.data.porModelo, (l) => l.chave, t)}
              vazio={t('workspace.byModelEmpty')}
            />
            {/* O eixo que o ADR 0076 reabriu (RN-186/RN-211) — mesma peça das
                outras três, sem cor por provider (ver `lib/spend.ts` sobre por
                que uma paleta categórica de 9 cores não passa na validação da
                skill de dataviz). */}
            <Ranking
              titulo={t('workspace.byProviderTitle')}
              linhas={comoRanking(
                relatorio.data.porProvider,
                rotuloDoProvider,
                t,
              )}
              vazio={t('workspace.byProviderEmpty')}
            />
            <Ranking
              titulo={t('workspace.byProjectTitle')}
              linhas={comoRanking(
                relatorio.data.porProjeto,
                (l) => l.rotulo ?? l.chave,
                t,
              )}
              vazio={t('workspace.byProjectEmpty')}
            />
            <Ranking
              titulo={t('workspace.byActorTitle')}
              linhas={comoRanking(relatorio.data.porAtor, rotuloDoAtor, t)}
              vazio={t('workspace.byActorEmpty')}
            />
          </div>
        </>
      )}

      {/* A pergunta da FATURA, que é outra: por credencial, e só do owner
          (RN-060). Reaproveitada inteira em vez de reescrita aqui. */}
      {project && <CredentialSpendSection workspaceId={project.workspaceId} />}
    </>
  );
}

/** A audiência do membro. */
function MeuConsumo({ projectId }: { projectId: string }) {
  const { t } = useTranslation('spend');
  const meu = useQuery({
    queryKey: ['my-spend', projectId, DIAS],
    queryFn: () => getMySpend(projectId, DIAS),
  });

  return (
    <>
      <header className={styles.cabecalho}>
        <h2 className={styles.titulo}>{t('member.title')}</h2>
        <p className={styles.subtitulo}>
          <Trans
            i18nKey="member.subtitle"
            ns="spend"
            values={{ dias: DIAS }}
            components={{ strong: <strong /> }}
          />
        </p>
      </header>

      {meu.isLoading && (
        <div className={styles.estado}>{t('shared.summing')}</div>
      )}

      {meu.isError && (
        <div className={styles.estadoErro} role="alert">
          <span>{t('member.error')}</span>
          <button
            type="button"
            className={styles.botao}
            onClick={() => meu.refetch()}
          >
            {t('shared.retry')}
          </button>
        </div>
      )}

      {meu.data && (
        <>
          <div className={styles.destaques}>
            <Destaque
              rotulo={t('member.estimatedLabel', { dias: DIAS })}
              valor={formatarUsd(meu.data.totalMicros)}
              detalhe={t('member.callsDetail', {
                count: numberFmt.format(meu.data.chamadas),
              })}
            />
            <Destaque
              rotulo={t('member.tokensLabel')}
              valor={numberFmt.format(
                meu.data.inputTokens + meu.data.outputTokens,
              )}
              detalhe={t('shared.tokensDetail', {
                input: numberFmt.format(meu.data.inputTokens),
                output: numberFmt.format(meu.data.outputTokens),
              })}
            />
          </div>

          <div className={styles.faixa}>
            <BarrasPorDia
              serie={meu.data.porDia}
              titulo={t('member.dailySpendTitle')}
            />
          </div>

          <Ranking
            titulo={t('member.bySessionTitle')}
            linhas={comoRanking(
              meu.data.porSessao,
              (l) => hashtagDaSessao(l.chave),
              t,
            )}
            vazio={t('member.bySessionEmpty')}
          />

          <p className={styles.nota}>{t('member.note')}</p>
        </>
      )}
    </>
  );
}

/**
 * `t` entra por parâmetro porque esta função é chamada durante o render de
 * `GastoDoWorkspace`/`MeuConsumo`, mas não é ela própria um componente — não
 * pode chamar `useTranslation` diretamente (regra dos hooks).
 */
function comoRanking(
  linhas: SpendLinha[],
  rotulo: (linha: SpendLinha) => string,
  t: (chave: string, opcoes?: Record<string, unknown>) => string,
): LinhaDeRanking[] {
  return linhas.map((linha) => ({
    chave: linha.chave,
    rotulo: rotulo(linha),
    costMicros: linha.costMicros,
    detalhe: t('shared.rankingDetail', {
      tokens: numberFmt.format(tokensDe(linha)),
      calls: linha.chamadas,
    }),
  }));
}

/**
 * O rótulo humano do provider — a MESMA tabela que `CredentialSpendSection`
 * já usa, nunca uma segunda cópia. `chave` na dimensão `provider` é o slug
 * puro (`token-usage-repository.port.ts`: `rotulo` só existe pra `project`).
 */
function rotuloDoProvider(linha: SpendLinha): string {
  return ROTULO_DO_PROVIDER[linha.chave as LLMProviderName] ?? linha.chave;
}

// ---------------------------------------------------------------------------
// KPI de economia com modelos locais — CORTE DECLARADO (RN-214).
//
// `TokenMeter` já tem `savingsBRL`/`savingsPct` prontos para receber o
// número, e não são alimentados aqui de propósito. O card do handoff
// (design_handoff_brabo) mostra algo como "economia de R$ 42 rodando
// qwen2.5-coder local em vez de um modelo pago" — e isso exige um preço
// CONTRAFACTUAL: quanto teria custado a MESMA chamada num modelo pago
// específico. Esse número não existe em lugar nenhum do produto hoje:
//   - o catálogo (ADR 0042) tem preço do modelo REALMENTE usado, congelado
//     em `token_usage` no instante da chamada (RN-044) — não tem um preço
//     "e se fosse outro modelo" para a MESMA chamada local;
//   - não há mapeamento declarado "modelo local X ~ modelo pago Y" em
//     lugar nenhum do domínio — inventá-lo aqui seria abrir uma tabela de
//     equivalência de qualidade sem base, a mesma classe de "nota vestida
//     de dado" que o RN-210 recusou para ranking de capacidade.
// Sem baseline real e versionado, o número seria inventado — a mesma
// classe de erro que a Onda 2/frente H2 já recusou para "recomendado"
// (RN-210) e que esta frente recusou para cor de provider (acima).
// Pendência registrada no backlog para quando existir preço contrafactual
// defensável (ex.: preço do catálogo do modelo pago mais barato que cobre
// a MESMA capacidade, congelado por decisão explícita — não calculado on
// the fly a cada render).
// ---------------------------------------------------------------------------
