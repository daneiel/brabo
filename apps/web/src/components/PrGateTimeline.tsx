import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CoverageMatrixRow,
  ProposedAction,
  PrGateStatus,
  RegistroDeGates,
} from '../lib/api-types';
import { Badge } from './ui/Badge';
import { Table, type TableColumn } from './ui/Table';
import { AlertIcon, CheckIcon, ClockIcon, PrIcon } from './ui/icons';
import styles from './PrGateTimeline.module.css';

export interface GateSubVerdict {
  agentId: string;
  label: string;
  veredito: 'approved' | 'changes_requested';
  resumo: string;
  itens: string[];
}

export interface GateDispensedDelegation {
  agentId: string;
  label: string;
  justification: string;
}

export interface GateVerdict {
  seq: number;
  gate: 'qa' | 'secops';
  veredito: 'approved' | 'changes_requested';
  resumo: string;
  itens: string[];
  coverageMatrix?: CoverageMatrixRow[];
  // Rastreabilidade da área de QA (Fase 8b/8d): o parecer de CADA
  // subespecialidade que rodou, e a que foi dispensada (com justificativa —
  // nunca silêncio). `itens` acima já vem prefixado por `[label]`
  // (`QaLead.consolidar/1`); os sub-blocos são o detalhe completo por trás
  // do prefixo.
  subVerdicts?: GateSubVerdict[];
  dispensed?: GateDispensedDelegation[];
}

// Só os campos que o componente realmente usa — assim tanto `Task` quanto
// `InfraArtifact` (PR de infra, Fase 4a — sem story/worktree por trás)
// satisfazem estruturalmente, sem acoplar o componente ao domínio de backlog.
export interface GateSubject {
  title: string;
  blocked: boolean;
  blockedReason: string | null;
  gateStatus: PrGateStatus | null;
}

interface PrGateTimelineProps {
  task: GateSubject;
  prAction?: ProposedAction;
  verdicts: GateVerdict[];
  /**
   * O registro de gates. Opcional de propósito: a esteira é informativa, e
   * escondê-la enquanto a requisição não volta seria pior que mostrá-la sem
   * a curadoria do registro.
   */
  registro?: RegistroDeGates;
}

type GateStepState = 'done' | 'current' | 'blocked' | 'pending';

type StepKey = 'dev' | 'qa' | 'secops' | 'user';

/**
 * Chave i18n do rótulo de cada etapa. NÃO é a lista de etapas — essa vem do
 * registro (`GET /gates`, ADR 0054). Aqui só mora como a etapa se CHAMA para
 * o usuário, que é decisão de tela e não de política. `etapasDaEsteira`
 * devolve a CHAVE (não o texto): quem renderiza resolve com `t()`.
 */
const ROTULOS: Record<StepKey, string> = {
  dev: 'prGateTimeline.steps.dev',
  qa: 'prGateTimeline.steps.qa',
  secops: 'prGateTimeline.steps.secops',
  user: 'prGateTimeline.steps.user',
};

/** Qual etapa da tela cada gate do registro representa. */
const ETAPA_DO_GATE: Record<string, StepKey> = {
  'qa-verificada': 'qa',
  'secops-segura': 'secops',
  'merge-protegida': 'user',
};

/**
 * As etapas da esteira de PR, DERIVADAS do registro (FASE 15b).
 *
 * `dev` sempre abre a linha: não é gate, é quem produz o que os gates julgam.
 * As demais saem dos gates de `fluxo: pr` que o registro traz como ativos — e
 * é por isso que um gate desativado, ou um que ainda não existe
 * (`status: planned`), some da tela sozinho em vez de virar uma etapa morta
 * que ninguém lembra de tirar.
 *
 * Sem registro (ainda carregando, ou a chamada falhou), cai na lista completa:
 * a esteira é informativa, e escondê-la por causa de uma requisição seria
 * pior que mostrá-la sem a curadoria do registro.
 */
export function etapasDaEsteira(
  registro: RegistroDeGates | undefined,
): { key: StepKey; label: string }[] {
  const chaves: StepKey[] =
    registro == null
      ? ['dev', 'qa', 'secops', 'user']
      : [
          'dev',
          ...registro.gates
            .filter((g) => g.fluxo === 'pr')
            .map((g) => ETAPA_DO_GATE[g.id])
            .filter((k): k is StepKey => k != null),
        ];

  // `Set` porque QA e SecOps de infra compartilham a mesma etapa de tela, e a
  // ordem do registro é a ordem da esteira.
  return [...new Set(chaves)].map((key) => ({ key, label: ROTULOS[key] }));
}

function lastGate(verdicts: GateVerdict[]): 'qa' | 'secops' | null {
  return verdicts.length > 0 ? verdicts[verdicts.length - 1].gate : null;
}

function stepState(
  step: StepKey,
  task: GateSubject,
  verdicts: GateVerdict[],
): GateStepState {
  if (step === 'dev') return 'done';
  if (task.blocked) {
    return lastGate(verdicts) === step ? 'blocked' : 'pending';
  }
  if (step === 'qa') {
    if (task.gateStatus === 'awaiting_qa') return 'current';
    if (task.gateStatus === 'awaiting_secops' || task.gateStatus === 'awaiting_user') {
      return 'done';
    }
    return 'pending';
  }
  if (step === 'secops') {
    if (task.gateStatus === 'awaiting_secops') return 'current';
    if (task.gateStatus === 'awaiting_user') return 'done';
    return 'pending';
  }
  return task.gateStatus === 'awaiting_user' ? 'current' : 'pending';
}

function StepIcon({ state }: { state: GateStepState }) {
  if (state === 'done') return <CheckIcon size={13} />;
  if (state === 'blocked') return <AlertIcon size={13} />;
  return <ClockIcon size={13} />;
}

/**
 * Linha do tempo de uma PR de dev agent (Fase 4a): stepper dev→qa→secops→você
 * + os pareceres (session_events `artifact.qa_verdict`/`artifact.secops_verdict`)
 * expansíveis, com a coverage_matrix do QA renderizada quando presente.
 */
export function PrGateTimeline({
  task,
  prAction,
  verdicts,
  registro,
}: PrGateTimelineProps) {
  const { t } = useTranslation('approvals');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const steps = etapasDaEsteira(registro);

  function toggle(seq: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }

  const executionResult = prAction?.executionResult as
    | { pullRequestUrl?: string }
    | null
    | undefined;
  const prUrl = executionResult?.pullRequestUrl;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <PrIcon size={16} />
        <span className={styles.title}>{task.title}</span>
        {prUrl && (
          <a href={prUrl} target="_blank" rel="noreferrer" className={styles.prLink}>
            {t('prGateTimeline.viewPr')}
          </a>
        )}
        {task.blocked && <Badge tone="danger">{t('prGateTimeline.blocked')}</Badge>}
      </div>

      <div className={styles.steps}>
        {steps.map((step, i) => {
          const state = stepState(step.key, task, verdicts);
          return (
            <div key={step.key} className={styles.stepWrap}>
              <div className={[styles.step, styles[state]].join(' ')}>
                <span className={styles.marker}>
                  <StepIcon state={state} />
                </span>
                <span className={styles.stepLabel}>{t(step.label)}</span>
              </div>
              {i < steps.length - 1 && <span className={styles.connector} />}
            </div>
          );
        })}
      </div>

      {task.blocked && task.blockedReason && (
        <div className={styles.blockedReason}>{task.blockedReason}</div>
      )}

      {verdicts.length > 0 && (
        <div className={styles.verdicts}>
          {verdicts.map((v) => (
            <VerdictCard
              key={v.seq}
              verdict={v}
              expanded={expanded.has(v.seq)}
              onToggle={() => toggle(v.seq)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VerdictCard({
  verdict,
  expanded,
  onToggle,
}: {
  verdict: GateVerdict;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('approvals');
  const gateLabel = verdict.gate === 'qa' ? t('prGateTimeline.steps.qa') : t('prGateTimeline.steps.secops');
  const approved = verdict.veredito === 'approved';

  const columns: TableColumn<CoverageMatrixRow>[] = [
    { key: 'rule', label: t('prGateTimeline.coverage.rule'), width: '2fr', render: (r) => r.rule },
    {
      key: 'tests',
      label: t('prGateTimeline.coverage.tests'),
      width: '2fr',
      render: (r) => r.tests.join(', ') || '—',
    },
    {
      key: 'covered',
      label: t('prGateTimeline.coverage.covered'),
      width: '110px',
      render: (r) => (
        <Badge tone={r.covered ? 'success' : 'danger'}>
          {r.covered ? t('prGateTimeline.coverage.coveredYes') : t('prGateTimeline.coverage.coveredNo')}
        </Badge>
      ),
    },
  ];

  return (
    <div className={styles.verdictCard}>
      <button type="button" className={styles.verdictHeader} onClick={onToggle}>
        <Badge tone={approved ? 'success' : 'danger'}>
          {gateLabel}:{' '}
          {approved ? t('prGateTimeline.verdict.approved') : t('prGateTimeline.verdict.changesRequested')}
        </Badge>
        <span className={styles.verdictSummary}>{verdict.resumo}</span>
      </button>
      {expanded && (
        <div className={styles.verdictBody}>
          {verdict.itens.length > 0 && (
            <ul className={styles.itemList}>
              {verdict.itens.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
          {verdict.coverageMatrix && verdict.coverageMatrix.length > 0 && (
            <Table
              columns={columns}
              rows={verdict.coverageMatrix}
              rowKey={(r) => r.rule}
            />
          )}
          {verdict.subVerdicts && verdict.subVerdicts.length > 0 && (
            <div className={styles.subVerdicts}>
              {verdict.subVerdicts.map((sv) => (
                <div key={sv.agentId} className={styles.subVerdictCard}>
                  <div className={styles.subVerdictHeader}>
                    <Badge tone={sv.veredito === 'approved' ? 'success' : 'danger'}>
                      {sv.label}:{' '}
                      {sv.veredito === 'approved'
                        ? t('prGateTimeline.verdict.approved')
                        : t('prGateTimeline.verdict.changesRequested')}
                    </Badge>
                    <span className={styles.verdictSummary}>{sv.resumo}</span>
                  </div>
                  {sv.itens.length > 0 && (
                    <ul className={styles.itemList}>
                      {sv.itens.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
          {verdict.dispensed && verdict.dispensed.length > 0 && (
            <div className={styles.subVerdicts}>
              {verdict.dispensed.map((d) => (
                <div key={d.agentId} className={styles.subVerdictCard}>
                  <div className={styles.subVerdictHeader}>
                    <Badge tone="muted">
                    {d.label}: {t('prGateTimeline.verdict.dispensed')}
                  </Badge>
                    <span className={styles.verdictSummary}>{d.justification}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
