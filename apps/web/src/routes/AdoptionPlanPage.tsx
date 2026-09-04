import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GitProviderName } from '../lib/api-types';
import {
  ApiError,
  adoptRepository,
  approveBootstrapPlan,
  getBootstrapPlan,
  getBootstrapStatus,
  getProject,
  skipBootstrapPlan,
} from '../lib/api-client';
import { useSessionEvents } from '../lib/hooks';
import { agruparPlano, divergencias, planoVazio } from '../lib/adoption';
import { deriveStepStates } from '../lib/bootstrap';
import { BootstrapSteps } from '../components/BootstrapSteps';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import styles from './ProvisioningPage.module.css';

interface AdoptionPlanPageProps {
  projectId: string;
  provider: GitProviderName;
  externalId: string;
}

/**
 * O PLANO de adoção e as duas decisões (Fase 12a).
 *
 * Reusa `BootstrapSteps`/`deriveStepStates` DIRETO em vez de navegar
 * para a `ProvisioningPage` depois de aprovar: aquela dispara
 * `provisionRepository` ao montar, o que CRIARIA um repositório — o
 * oposto do que a adoção existe para fazer.
 */
export function AdoptionPlanPage({
  projectId,
  provider,
  externalId,
}: AdoptionPlanPageProps) {
  const { t } = useTranslation('adoptionPlan');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const firedRef = useRef(false);
  const [decidindo, setDecidindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });

  const planQuery = useQuery({
    queryKey: ['bootstrap-plan', projectId],
    queryFn: () => getBootstrapPlan(projectId),
  });

  const decision = planQuery.data?.decision ?? null;

  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap', projectId],
    queryFn: () => getBootstrapStatus(projectId),
    // Só interessa acompanhar depois de aprovar — antes disso, por
    // desenho, nada está rodando.
    enabled: decision === 'approved',
    refetchInterval: (query) =>
      query.state.data?.status === 'provisioned' ? false : 1000,
  });

  const sessionId = bootstrapQuery.data?.sessionId ?? undefined;
  const eventsQuery = useSessionEvents(
    projectId,
    decision === 'approved' ? sessionId : undefined,
    1000,
  );
  const stepStates = deriveStepStates(eventsQuery.data?.items ?? []);

  // Adota UMA vez ao montar — é a chamada que valida o acesso e gera o
  // plano. Não muta nada no repositório.
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    adoptRepository(projectId, provider, { externalId })
      .catch((e: unknown) => {
        setErro(
          e instanceof ApiError ? e.message : t('genericAdoptError'),
        );
      })
      .finally(() => {
        void queryClient.invalidateQueries({
          queryKey: ['bootstrap-plan', projectId],
        });
        void queryClient.invalidateQueries({
          queryKey: ['repository', projectId],
        });
      });
  }, [projectId, provider, externalId, queryClient]);

  async function decidir(qual: 'approve' | 'skip') {
    const generatedAt = planQuery.data?.plan?.generatedAt;
    if (!generatedAt) return;
    setDecidindo(true);
    setErro(null);
    try {
      const acao = qual === 'approve' ? approveBootstrapPlan : skipBootstrapPlan;
      await acao(projectId, { planGeneratedAt: generatedAt });
      await queryClient.invalidateQueries({
        queryKey: ['bootstrap-plan', projectId],
      });
      await queryClient.invalidateQueries({ queryKey: ['bootstrap', projectId] });
    } catch (e: unknown) {
      setErro(
        e instanceof ApiError && e.status === 409
          ? t('planChangedError')
          : t('decisionError'),
      );
    } finally {
      setDecidindo(false);
    }
  }

  const plan = planQuery.data?.plan ?? null;
  const grupos = plan ? agruparPlano(plan) : [];
  const avisos = plan ? divergencias(plan) : [];
  const nadaAFazer = plan ? planoVazio(plan) : false;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.subtitle}>
          {projectQuery.data ? projectQuery.data.name : t('fallbackProjectName')} ·{' '}
          <code>{externalId}</code>
        </p>
      </div>

      {erro && <Alert tone="danger" role="alert">{erro}</Alert>}

      {!plan && !erro && (
        <div className={styles.starting}>{t('readingRepo')}</div>
      )}

      {plan && decision === null && (
        <>
          <Alert tone="accent">
            {t('introBefore')}
            <strong>{t('introStrong')}</strong>
            {t('introAfter')}
          </Alert>

          {nadaAFazer ? (
            <p className={styles.starting}>{t('nothingToDo')}</p>
          ) : (
            grupos.map((g) => (
              <section key={g.secao} className={styles.planSection}>
                <h2 className={styles.planTitle}>{g.titulo}</h2>
                <ul className={styles.planList}>
                  {g.itens.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))
          )}

          {avisos.length > 0 && (
            <section className={styles.planSection}>
              <h2 className={styles.planTitle}>{t('divergencesTitle')}</h2>
              <ul className={styles.planList}>
                {avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </section>
          )}

          <div className={styles.actions}>
            <Button
              variant="success"
              onClick={() => void decidir('approve')}
              disabled={decidindo || nadaAFazer}
            >
              {t('approvePlan')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void decidir('skip')}
              disabled={decidindo}
            >
              {t('adoptAsIs')}
            </Button>
          </div>
        </>
      )}

      {decision === 'as_is' && (
        <>
          <Alert tone="success">{t('adoptedAsIsAlert')}</Alert>
          <div className={styles.actions}>
            <Button
              variant="success"
              onClick={() =>
                navigate({ to: '/projects/$projectId', params: { projectId } })
              }
            >
              {t('goToProject')}
            </Button>
          </div>
        </>
      )}

      {decision === 'approved' && (
        <>
          <BootstrapSteps
            stepStates={stepStates}
            failedStep={bootstrapQuery.data?.failedStep ?? null}
          />
          <div className={styles.actions}>
            {bootstrapQuery.data?.status === 'provisioned' ? (
              <Button
                variant="success"
                onClick={() =>
                  navigate({ to: '/projects/$projectId', params: { projectId } })
                }
              >
                {t('goToProject')}
              </Button>
            ) : (
              <span className={styles.working}>{t('applyingPlan')}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
