import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useHypotheses, usePsychologistAnalyses } from '../lib/hooks';
import {
  acceptHypothesis,
  ApiError,
  dismissHypothesis,
  mensagemDaApi,
  reanalyzeSession,
} from '../lib/api-client';
import { areaFor } from '../lib/agents';
import { formatMicros } from '../lib/execution';
import { idCurtoDaSessao } from '../lib/session-label';
import { HypothesisCard } from '../components/HypothesisCard';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/ToastProvider';
// Mesmo módulo de estilo da Visão geral, de propósito: a seção saiu de lá
// inteira (achado #15) e precisa continuar idêntica. Duplicar as classes só
// para ter arquivo próprio abriria a porta para as duas versões divergirem.
import styles from './ProjectOverviewTab.module.css';

/**
 * Aba Insights — hipóteses do Psicólogo (Fase 4b) agrupadas por agente alvo,
 * com confiança, evidências navegáveis e ações aceitar/descartar. Escopo de
 * PROJETO (não da sessão aberta): hipóteses acumulam a cada sessão encerrada,
 * e a navegação de evidência leva à sessão ANALISADA.
 *
 * Morava no fim da Visão geral, embaixo do painel do time, da execução e da
 * arquitetura — quatro assuntos numa coluna só, na aba que abre por padrão.
 * Era o achado #15 do primeiro dogfooding: a fila de decisões do Psicólogo
 * ficava fora da tela, sem contador, num lugar onde ninguém a procurava. Aqui
 * ela tem aba própria e badge de quantas esperam decisão, ao lado das outras
 * duas filas de decisão do projeto (backlog e aprovações).
 */
export function ProjectInsightsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('insights');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const hypothesesQuery = useHypotheses(projectId);
  const { data: analyses } = usePsychologistAnalyses(projectId);
  // O Psicólogo pode estar pausado GLOBALMENTE (decisão do usuário em
  // 2026-08-10, não bug — ver docs/explanation/backlog.md). Não há hoje um
  // jeito de saber isso ANTES de clicar (o estado é do engine, não vem em
  // nenhuma leitura desta tela); "Reanalisar" descobre no primeiro clique e
  // os botões ficam desabilitados dali em diante, com a explicação
  // PERSISTENTE na tela — não só um toast que some (RN-088: nunca falha
  // silenciosa ou confusa). Mesmo padrão de `ProficiencySection` (Anamnese).
  const [psicologoDesativado, setPsicologoDesativado] = useState(false);

  const all = hypothesesQuery.data ?? [];
  const pending = all.filter((h) => h.status === 'proposed');
  const runs = analyses ?? [];

  // Agrupa por ÁREA quando o alvo é um subagente conhecido (Fase 8d, ADR
  // 0038) — hipóteses de `qa-automacao` e `qa-performance-seguranca` caem
  // no MESMO grupo "QA", em vez de duas seções soltas que escondem que são
  // a mesma área. Alvo sem área (dev-api, po, ...) continua agrupado pelo
  // próprio nome, como sempre. Preserva a ordem de chegada dos grupos.
  const byAgent = new Map<string, typeof all>();
  for (const h of all) {
    const chave = areaFor(h.agenteAlvo)?.label ?? h.agenteAlvo;
    byAgent.set(chave, [...(byAgent.get(chave) ?? []), h]);
  }

  async function decide(
    hypothesisId: string,
    action: 'accept' | 'dismiss',
  ) {
    try {
      if (action === 'accept') {
        await acceptHypothesis(projectId, hypothesisId);
      } else {
        await dismissHypothesis(projectId, hypothesisId);
      }
      await queryClient.invalidateQueries({ queryKey: ['hypotheses', projectId] });
    } catch {
      showToast({
        title: t('projectInsightsTab.toasts.genericErrorTitle'),
        message:
          action === 'accept'
            ? t('projectInsightsTab.toasts.acceptError')
            : t('projectInsightsTab.toasts.dismissError'),
        tone: 'danger',
      });
    }
  }

  // Reprocessamento explícito: substitui a análise anterior (que fica
  // `superseded`, nunca apagada). Gasta orçamento de verdade, daí o aviso
  // no título e o papel `maintainer` exigido pela api.
  async function reanalyze(sessionId: string) {
    try {
      await reanalyzeSession(projectId, sessionId);
      showToast({
        title: t('projectInsightsTab.toasts.reanalyzeQueuedTitle'),
        message: t('projectInsightsTab.toasts.reanalyzeQueuedMessage'),
      });
    } catch (erro) {
      if (erro instanceof ApiError && erro.status === 503) {
        // Distinto de qualquer outra falha — a api já manda a frase pronta
        // em `body.message` (ServiceUnavailableException do
        // ReanalyzeSessionUseCase).
        setPsicologoDesativado(true);
        showToast({
          title: t('projectInsightsTab.toasts.psychologistPausedTitle'),
          message: mensagemDaApi(
            erro,
            t('projectInsightsTab.toasts.psychologistPausedFallback'),
          ),
          tone: 'warning',
        });
      } else {
        showToast({
          title: t('projectInsightsTab.toasts.genericErrorTitle'),
          message: t('projectInsightsTab.toasts.reanalyzeError'),
          tone: 'danger',
        });
      }
    }
  }

  return (
    <div className={styles.arch}>
      <div className={styles.sectionHeader}>{t('projectInsightsTab.header')}</div>
      {/* Os três estados da RN-088, com o ERRO antes do vazio: `data ?? []`
          seguido de `length === 0` fazia a api respondendo 429 dizer "sem
          hipóteses ainda", que é indistinguível de um projeto que o Psicólogo
          nunca analisou. */}
      {hypothesesQuery.isError ? (
        <ErroDeCarregamento
          titulo={t('projectInsightsTab.errorTitle')}
          erro={hypothesesQuery.error}
          onTentarDeNovo={() => void hypothesesQuery.refetch()}
        />
      ) : hypothesesQuery.data === undefined ? (
        <div className={styles.sectionSub}>{t('projectInsightsTab.loading')}</div>
      ) : all.length === 0 ? (
        <div className={styles.sectionSub}>{t('projectInsightsTab.empty')}</div>
      ) : (
        <>
          <div className={styles.sectionSub}>
            {t('projectInsightsTab.summary', {
              total: all.length,
              pending: pending.length,
            })}
          </div>

          {/* Faixa de análises: é aqui que o custo distinto entre triagem
              leve e pesada fica visível — some do metering por sessão. */}
          {runs.length > 0 && (
            <div className={styles.analysisStrip}>
              {runs.map((run) => (
                <div key={run.id} className={styles.analysisRow}>
                  <Badge tone={run.tier === 'pesada' ? 'accent' : 'muted'}>
                    {t('projectInsightsTab.analysisStrip.tier', { tier: run.tier })}
                  </Badge>
                  <Link
                    to="/projects/$projectId/sessions/$sessionId"
                    params={{ projectId, sessionId: run.sessionId }}
                    className={styles.analysisSession}
                  >
                    {t('projectInsightsTab.analysisStrip.sessionLabel', {
                      id: idCurtoDaSessao(run.sessionId),
                    })}
                  </Link>
                  <span className={styles.analysisMeta}>
                    {t('projectInsightsTab.analysisStrip.meta', {
                      events: run.eventCountAtAnalysis,
                      hypotheses: run.hypothesisCount,
                    })}
                  </span>
                  <span className={styles.analysisCost}>
                    {formatMicros(run.costMicros)}
                  </span>
                  <button
                    type="button"
                    className={styles.analysisReanalyze}
                    onClick={() => reanalyze(run.sessionId)}
                    disabled={psicologoDesativado}
                    title={
                      psicologoDesativado
                        ? t('projectInsightsTab.analysisStrip.reanalyzeTitleDisabled')
                        : t('projectInsightsTab.analysisStrip.reanalyzeTitleEnabled')
                    }
                  >
                    {t('projectInsightsTab.analysisStrip.reanalyzeButton')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Pausa GLOBAL — decisão do usuário em 2026-08-10, aguardando
              refinamento futuro. Fica visível de propósito, não só um toast
              que some (RN-088). */}
          {psicologoDesativado && (
            <div className={styles.sectionSub} style={{ marginTop: 8 }}>
              {t('projectInsightsTab.pausedNotice')}
            </div>
          )}

          {[...byAgent.entries()].map(([agenteAlvo, group]) => (
            <div key={agenteAlvo}>
              <div className={styles.archLabel}>
                {agenteAlvo}
                <Badge tone="muted">{group.length}</Badge>
              </div>
              <div className={styles.moduleGrid}>
                {group.map((hypothesis) => (
                  <HypothesisCard
                    key={hypothesis.id}
                    hypothesis={hypothesis}
                    projectId={projectId}
                    onAccept={() => decide(hypothesis.id, 'accept')}
                    onDismiss={() => decide(hypothesis.id, 'dismiss')}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
