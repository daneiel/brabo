import { useEffect, useRef, useState } from 'react';
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
          e instanceof ApiError
            ? e.message
            : 'Não foi possível ler o repositório agora.',
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
          ? 'O plano mudou desde que esta tela carregou. Recarregue para decidir sobre o plano atual.'
          : 'Não foi possível registrar a decisão agora.',
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
        <h1 className={styles.title}>Adotar repositório existente</h1>
        <p className={styles.subtitle}>
          {projectQuery.data ? projectQuery.data.name : 'Projeto'} ·{' '}
          <code>{externalId}</code>
        </p>
      </div>

      {erro && <Alert tone="danger" role="alert">{erro}</Alert>}

      {!plan && !erro && (
        <div className={styles.starting}>Lendo o repositório…</div>
      )}

      {plan && decision === null && (
        <>
          <Alert tone="accent">
            Nada foi alterado no repositório. Isto é o que o bootstrap{' '}
            <strong>faria</strong> — nenhuma proteção existente é sobrescrita
            sem a sua aprovação.
          </Alert>

          {nadaAFazer ? (
            <p className={styles.starting}>
              O repositório já está como o template espera. Não há nada a
              aplicar.
            </p>
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
              <h2 className={styles.planTitle}>Divergências</h2>
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
              Aprovar plano
            </Button>
            <Button
              variant="ghost"
              onClick={() => void decidir('skip')}
              disabled={decidindo}
            >
              Adotar como está
            </Button>
          </div>
        </>
      )}

      {decision === 'as_is' && (
        <>
          <Alert tone="success">
            Repositório adotado como está. O bootstrap foi dispensado — nada foi
            alterado.
          </Alert>
          <div className={styles.actions}>
            <Button
              variant="success"
              onClick={() =>
                navigate({ to: '/projects/$projectId', params: { projectId } })
              }
            >
              Ir para o projeto
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
                Ir para o projeto
              </Button>
            ) : (
              <span className={styles.working}>Aplicando o plano…</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
