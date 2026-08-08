import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useHypotheses, usePsychologistAnalyses } from '../lib/hooks';
import {
  acceptHypothesis,
  dismissHypothesis,
  reanalyzeSession,
} from '../lib/api-client';
import { areaFor } from '../lib/agents';
import { formatMicros } from '../lib/execution';
import { idCurtoDaSessao } from '../lib/session-label';
import { HypothesisCard } from '../components/HypothesisCard';
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
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: hypotheses } = useHypotheses(projectId);
  const { data: analyses } = usePsychologistAnalyses(projectId);

  const all = hypotheses ?? [];
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
        title: 'Erro',
        message: `Não foi possível ${action === 'accept' ? 'aceitar' : 'descartar'} a hipótese`,
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
        title: 'Reanálise enfileirada',
        message: 'O Psicólogo vai analisar esta sessão de novo.',
      });
    } catch {
      showToast({
        title: 'Erro',
        message: 'Não foi possível enfileirar a reanálise',
        tone: 'danger',
      });
    }
  }

  return (
    <div className={styles.arch}>
      <div className={styles.sectionHeader}>Insights</div>
      {all.length === 0 ? (
        <div className={styles.sectionSub}>
          Sem hipóteses ainda — o Psicólogo analisa cada sessão encerrada.
        </div>
      ) : (
        <>
          <div className={styles.sectionSub}>
            {all.length} hipótese(s) · {pending.length} aguardando decisão
          </div>

          {/* Faixa de análises: é aqui que o custo distinto entre triagem
              leve e pesada fica visível — some do metering por sessão. */}
          {runs.length > 0 && (
            <div className={styles.analysisStrip}>
              {runs.map((run) => (
                <div key={run.id} className={styles.analysisRow}>
                  <Badge tone={run.tier === 'pesada' ? 'accent' : 'muted'}>
                    triagem {run.tier}
                  </Badge>
                  <Link
                    to="/projects/$projectId/sessions/$sessionId"
                    params={{ projectId, sessionId: run.sessionId }}
                    className={styles.analysisSession}
                  >
                    sessão {idCurtoDaSessao(run.sessionId)}
                  </Link>
                  <span className={styles.analysisMeta}>
                    {run.eventCountAtAnalysis} evento(s) · {run.hypothesisCount}{' '}
                    hipótese(s)
                  </span>
                  <span className={styles.analysisCost}>
                    {formatMicros(run.costMicros)}
                  </span>
                  <button
                    type="button"
                    className={styles.analysisReanalyze}
                    onClick={() => reanalyze(run.sessionId)}
                    title="Roda a análise de novo e gasta orçamento; a anterior fica no histórico"
                  >
                    Reanalisar
                  </button>
                </div>
              ))}
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
