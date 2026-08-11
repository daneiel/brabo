import { useNavigate } from '@tanstack/react-router';
import type { PsychologistHypothesis } from '../lib/api-types';
import { AGENTS } from '../lib/agents';
import { descreverHipotese } from '../lib/aprovacoes';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Disclosure } from './ui/Disclosure';
import { HypothesisIcon } from './ui/icons';
import styles from './HypothesisCard.module.css';

interface HypothesisCardProps {
  hypothesis: PsychologistHypothesis;
  projectId: string;
  onAccept: () => void;
  onDismiss: () => void;
}

/**
 * Card de uma hipótese do Psicólogo (Fase 4b): confiança, observação/
 * sugestão, análise de término (quando a sessão caiu de forma anormal) e
 * as evidências CLICÁVEIS — cada chip navega até o evento na sessão
 * ANALISADA (que pode não ser a sessão aberta agora).
 *
 * A FASE 19 pôs a hipótese na mesma língua da aprovação: a FRASE de
 * `lib/aprovacoes.ts` diz o que acontece se você aceitar, e o resto —
 * observação, sugestão, término, evidências — desce para um colapso. O default
 * segue a regra dos outros dois lugares: abre o que ainda espera decisão. Aqui
 * isso é `status === 'proposed'`, o análogo de `pending`; hipótese já decidida
 * nasce fechada, como o ramo do agente que já terminou (FASE 14b).
 */
export function HypothesisCard({
  hypothesis,
  projectId,
  onAccept,
  onDismiss,
}: HypothesisCardProps) {
  const navigate = useNavigate();
  const decided = hypothesis.status !== 'proposed';
  const { frase } = descreverHipotese(hypothesis);

  function goToEvidence(eventId: string) {
    navigate({
      to: '/projects/$projectId/sessions/$sessionId',
      params: { projectId, sessionId: hypothesis.sessionId },
      search: { highlightEvent: eventId },
    });
  }

  return (
    <div className={[styles.card, decided && styles.decided].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>
          <HypothesisIcon size={14} />
        </span>
        {decided ? (
          <Badge tone={hypothesis.status === 'accepted' ? 'success' : 'muted'}>
            {hypothesis.status === 'accepted' ? 'aceita' : 'descartada'}
          </Badge>
        ) : (
          <Badge tone="accent">proposta</Badge>
        )}
        {/* Alvo ESPECÍFICO da hipótese — sempre visível no card, mesmo
            quando `InsightsSection` agrupa por ÁREA (Fase 8d): sem isto,
            um grupo "QA" esconderia se a hipótese mira a Automação ou a
            Performance/Segurança. */}
        <Badge tone="muted">{AGENTS[hypothesis.agenteAlvo as keyof typeof AGENTS]?.name ?? hypothesis.agenteAlvo}</Badge>
        <span className={styles.confidence}>
          {hypothesis.confiancaPercent}% de confiança
        </span>
      </div>

      <div className={styles.hipotese}>{hypothesis.hipotese}</div>

      {/* O que acontece se você aceitar — a mesma pergunta que a frase do
          ApprovalCard responde, do mesmo módulo. */}
      <p className={styles.frase}>{frase}</p>

      <Disclosure
        titulo="No que o Psicólogo se baseou"
        padraoAberto={!decided}
        className={styles.detalhes}
        trailing={`${hypothesis.evidenceEventIds.length} evidência(s)`}
      >
        <div>
          <div className={styles.label}>Observação</div>
          <div className={styles.body}>{hypothesis.observacao}</div>
        </div>

        <div>
          <div className={styles.label}>Sugestão</div>
          <div className={styles.body}>{hypothesis.sugestao}</div>
        </div>

        {hypothesis.terminationAnalysis && (
          <div className={styles.termination}>
            <div className={styles.label}>
              Término anormal · {hypothesis.terminationAnalysis.causa}
            </div>
            <div className={styles.body}>
              {hypothesis.terminationAnalysis.analise}
            </div>
            <div className={styles.body}>
              Estado no momento: {hypothesis.terminationAnalysis.estadoDaSessao}
            </div>
          </div>
        )}

        <div>
          <div className={styles.label}>Evidências</div>
          <div className={styles.evidence}>
            {hypothesis.evidenceEventIds.map((eventId) => (
              <button
                key={eventId}
                type="button"
                className={styles.chip}
                onClick={() => goToEvidence(eventId)}
              >
                {eventId.slice(-8)}
              </button>
            ))}
          </div>
        </div>
      </Disclosure>

      {!decided && (
        <div className={styles.actions}>
          <Button variant="success" onClick={onAccept}>
            Aceitar
          </Button>
          <Button variant="secondary" onClick={onDismiss}>
            Descartar
          </Button>
        </div>
      )}
    </div>
  );
}
