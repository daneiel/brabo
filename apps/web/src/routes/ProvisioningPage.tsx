import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GitProviderName } from '../lib/api-types';
import {
  acknowledgeProtectionFailure,
  getBootstrapStatus,
  getProject,
  getRepository,
  provisionRepository,
} from '../lib/api-client';
import { useSessionEvents } from '../lib/hooks';
import { BOOTSTRAP_STEPS, deriveStepStates } from '../lib/bootstrap';
import { BootstrapSteps } from '../components/BootstrapSteps';
import { Button } from '../components/ui/Button';
import { AlertIcon, CheckIcon } from '../components/ui/icons';
import styles from './ProvisioningPage.module.css';

interface ProvisioningPageProps {
  projectId: string;
  provider: GitProviderName;
}

export function ProvisioningPage({ projectId, provider }: ProvisioningPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const firedRef = useRef(false);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const repoQuery = useQuery({
    queryKey: ['repository', projectId],
    queryFn: () => getRepository(projectId),
  });

  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap', projectId],
    queryFn: () => getBootstrapStatus(projectId),
    // Para de pollar só quando converge; enquanto provisioning/null/failed
    // continua (assim o "Tentar novamente" retoma o progresso ao vivo).
    refetchInterval: (query) =>
      query.state.data?.status === 'provisioned' ? false : 1000,
  });

  const status = bootstrapQuery.data?.status ?? null;
  const sessionId = bootstrapQuery.data?.sessionId ?? undefined;
  const failedStep = bootstrapQuery.data?.failedStep ?? null;
  const lastError = bootstrapQuery.data?.lastError ?? null;

  const eventsQuery = useSessionEvents(projectId, sessionId, 1000);
  const events = eventsQuery.data?.items ?? [];
  const stepStates = deriveStepStates(events);

  const startProvision = useCallback(() => {
    const slug = projectQuery.data?.slug;
    if (!slug) return;
    const visibility = repoQuery.data?.visibility ?? 'private';
    provisionRepository(projectId, provider, { name: slug, visibility })
      .catch(() => {
        // A falha aparece via bootstrapQuery (status provision_failed) —
        // o provision roda o bootstrap inteiro de forma síncrona no backend.
      })
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ['bootstrap', projectId] });
        void queryClient.invalidateQueries({ queryKey: ['repository', projectId] });
      });
  }, [projectId, provider, projectQuery.data?.slug, repoQuery.data?.visibility, queryClient]);

  // Dispara o provision UMA vez ao montar (assim que o slug do projeto
  // carrega); o retry chama startProvision direto.
  useEffect(() => {
    if (firedRef.current) return;
    if (!projectQuery.data) return;
    firedRef.current = true;
    startProvision();
  }, [projectQuery.data, startProvision]);

  function handleRetry() {
    startProvision();
  }

  // A saída do beco sem saída (achado D). Só aparece quando o passo que falhou
  // é a PROTEÇÃO: ela é a última, e a única cujo fracasso deixa um repositório
  // utilizável. Falhar antes disso significa não ter onde trabalhar, e oferecer
  // "seguir" ali seria uma segunda mentira.
  const podeSeguirSemProtecao =
    status === 'provision_failed' && failedStep === 'protect_branches';

  function handleAcknowledge() {
    acknowledgeProtectionFailure(projectId)
      .then(() =>
        navigate({ to: '/projects/$projectId', params: { projectId } }),
      )
      .catch(() => {
        void queryClient.invalidateQueries({
          queryKey: ['bootstrap', projectId],
        });
      });
  }

  const failedStepLabel = failedStep
    ? BOOTSTRAP_STEPS.find((s) => s.name === failedStep)?.label ?? failedStep
    : null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Provisionando repositório</h1>
        <p className={styles.subtitle}>
          {projectQuery.data ? projectQuery.data.name : 'Projeto'} · bootstrap de
          Gitflow
        </p>
      </div>

      {status === 'provisioned' && (
        <div className={[styles.banner, styles.bannerOk].join(' ')}>
          <CheckIcon size={16} />
          <span>Repositório provisionado com sucesso.</span>
        </div>
      )}

      {status === 'provision_failed' && (
        <div className={[styles.banner, styles.bannerFail].join(' ')}>
          <AlertIcon size={16} />
          <div>
            <div className={styles.bannerTitle}>
              Falhou em: {failedStepLabel}
            </div>
            {lastError && <div className={styles.bannerError}>{lastError}</div>}
            {podeSeguirSemProtecao && (
              <div className={styles.bannerError}>
                Proteger branches costuma falhar em repositório privado no plano
                gratuito. Você pode seguir sem ela — a trava de merge do Brabo
                não depende da proteção do provider e continua valendo.
              </div>
            )}
          </div>
        </div>
      )}

      {status === null && (
        <div className={styles.starting}>Iniciando provisionamento…</div>
      )}

      <BootstrapSteps stepStates={stepStates} failedStep={failedStep} />

      <div className={styles.actions}>
        {status === 'provisioned' ? (
          <Button
            variant="success"
            onClick={() =>
              navigate({
                to: '/projects/$projectId',
                params: { projectId },
              })
            }
          >
            Ir para o projeto
          </Button>
        ) : status === 'provision_failed' ? (
          <>
            <Button onClick={handleRetry}>Tentar novamente</Button>
            {podeSeguirSemProtecao && (
              <Button variant="success" onClick={handleAcknowledge}>
                Seguir sem proteger as branches
              </Button>
            )}
          </>
        ) : (
          <span className={styles.working}>Trabalhando…</span>
        )}
      </div>
    </div>
  );
}
