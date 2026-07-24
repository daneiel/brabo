import { useState } from 'react';
import type {
  CoverageMatrixRow,
  ProposedAction,
  Task,
} from '../lib/api-types';
import { Badge } from './ui/Badge';
import { Table, type TableColumn } from './ui/Table';
import { AlertIcon, CheckIcon, ClockIcon, PrIcon } from './ui/icons';
import styles from './PrGateTimeline.module.css';

export interface GateVerdict {
  seq: number;
  gate: 'qa' | 'secops';
  veredito: 'approved' | 'changes_requested';
  resumo: string;
  itens: string[];
  coverageMatrix?: CoverageMatrixRow[];
}

interface PrGateTimelineProps {
  task: Task;
  prAction?: ProposedAction;
  verdicts: GateVerdict[];
}

type GateStepState = 'done' | 'current' | 'blocked' | 'pending';

const STEPS: { key: 'dev' | 'qa' | 'secops' | 'user'; label: string }[] = [
  { key: 'dev', label: 'Dev' },
  { key: 'qa', label: 'QA' },
  { key: 'secops', label: 'SecOps' },
  { key: 'user', label: 'Você' },
];

function lastGate(verdicts: GateVerdict[]): 'qa' | 'secops' | null {
  return verdicts.length > 0 ? verdicts[verdicts.length - 1].gate : null;
}

function stepState(
  step: (typeof STEPS)[number]['key'],
  task: Task,
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
export function PrGateTimeline({ task, prAction, verdicts }: PrGateTimelineProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

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
            ver PR
          </a>
        )}
        {task.blocked && <Badge tone="danger">bloqueada</Badge>}
      </div>

      <div className={styles.steps}>
        {STEPS.map((step, i) => {
          const state = stepState(step.key, task, verdicts);
          return (
            <div key={step.key} className={styles.stepWrap}>
              <div className={[styles.step, styles[state]].join(' ')}>
                <span className={styles.marker}>
                  <StepIcon state={state} />
                </span>
                <span className={styles.stepLabel}>{step.label}</span>
              </div>
              {i < STEPS.length - 1 && <span className={styles.connector} />}
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
  const gateLabel = verdict.gate === 'qa' ? 'QA' : 'SecOps';
  const approved = verdict.veredito === 'approved';

  const columns: TableColumn<CoverageMatrixRow>[] = [
    { key: 'rule', label: 'Regra', width: '2fr', render: (r) => r.rule },
    {
      key: 'tests',
      label: 'Testes',
      width: '2fr',
      render: (r) => r.tests.join(', ') || '—',
    },
    {
      key: 'covered',
      label: 'Cobertura',
      width: '110px',
      render: (r) => (
        <Badge tone={r.covered ? 'success' : 'danger'}>
          {r.covered ? 'coberta' : 'sem teste'}
        </Badge>
      ),
    },
  ];

  return (
    <div className={styles.verdictCard}>
      <button type="button" className={styles.verdictHeader} onClick={onToggle}>
        <Badge tone={approved ? 'success' : 'danger'}>
          {gateLabel}: {approved ? 'aprovado' : 'mudanças solicitadas'}
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
        </div>
      )}
    </div>
  );
}
