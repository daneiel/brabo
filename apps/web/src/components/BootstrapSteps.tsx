import { useTranslation } from 'react-i18next';
import type { BootstrapStepName } from '../lib/api-types';
import { BOOTSTRAP_STEPS, type StepUi } from '../lib/bootstrap';
import { AlertIcon, CheckIcon, ClockIcon } from './ui/icons';
import styles from './BootstrapSteps.module.css';

interface BootstrapStepsProps {
  stepStates: Record<BootstrapStepName, StepUi>;
  failedStep?: BootstrapStepName | null;
}

/**
 * Checklist presentacional dos 6 passos do bootstrap — props in, sem rede,
 * testável. Cada passo mostra um ícone/estado (pendente/rodando/ok/skip/
 * falha). O container (ProvisioningPage) computa `stepStates` via
 * deriveStepStates(events).
 */
export function BootstrapSteps({ stepStates, failedStep }: BootstrapStepsProps) {
  const { t } = useTranslation('provisioning');
  return (
    <ol className={styles.list} data-testid="bootstrap-steps">
      {BOOTSTRAP_STEPS.map((step) => {
        const ui = stepStates[step.name] ?? { state: 'pendente' };
        const isFailed = ui.state === 'falha' || failedStep === step.name;
        const state = isFailed ? 'falha' : ui.state;
        const stateLabel = t(`bootstrapSteps.stateLabel.${state}`);
        return (
          <li
            key={step.name}
            className={styles.item}
            data-step={step.name}
            data-state={state}
          >
            <span className={[styles.marker, styles[state]].join(' ')}>
              <StepIcon state={state} />
            </span>
            <span className={styles.label}>{t(step.labelKey)}</span>
            <span className={styles.state}>
              {ui.note ? `${stateLabel} · ${ui.note}` : stateLabel}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({ state }: { state: StepUi['state'] }) {
  if (state === 'ok') return <CheckIcon size={13} />;
  if (state === 'falha') return <AlertIcon size={13} />;
  if (state === 'skip') return <CheckIcon size={13} />;
  return <ClockIcon size={13} />;
}
