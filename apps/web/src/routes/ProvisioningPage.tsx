import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GitProviderName } from '../lib/api-types';
import {
  acknowledgeProtectionFailure,
  getBootstrapStatus,
  getProject,
  getRepository,
  mensagemDaApi,
  provisionRepository,
} from '../lib/api-client';
import { useSessionEvents } from '../lib/hooks';
import { BOOTSTRAP_STEPS, deriveStepStates } from '../lib/bootstrap';
import { BootstrapSteps } from '../components/BootstrapSteps';
import { Button } from '../components/ui/Button';
import { AlertIcon, CheckIcon } from '../components/ui/icons';
import styles from './ProvisioningPage.module.css';

/**
 * Teto da espera, e o mesmo desenho da `EsperaDoRunner` (RN-474): sonda com
 * intervalo, teto, e três estados que não colapsam.
 *
 * Sem ele esta tela pollava de segundo em segundo PARA SEMPRE quando o
 * provisionamento não convergia — e, no caso em que o POST falhava antes de
 * existir linha de bootstrap, ela nem tinha o que mostrar: `status` ficava
 * `null`, o texto era "Iniciando provisionamento…" e não havia botão nenhum.
 *
 * Três minutos é o mesmo número da `EsperaDoRunner`, e pelo mesmo motivo:
 * cobre um provider lento sem virar espera infinita.
 */
const TETO_MS = 180_000;

interface ProvisioningPageProps {
  projectId: string;
  provider: GitProviderName;
}

export function ProvisioningPage({ projectId, provider }: ProvisioningPageProps) {
  const { t } = useTranslation('provisioning');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const firedRef = useRef(false);
  /**
   * O que o POST respondeu quando recusou.
   *
   * Antes isto era um `.catch(() => {})` de corpo vazio, com um comentário
   * afirmando que "a falha aparece via bootstrapQuery (status
   * provision_failed)". A afirmação é FALSA justamente nos dois casos que
   * acontecem de verdade: `createRepo` falhando (a linha de bootstrap nunca
   * chega a existir) e `step.check` falhando (a linha existia mas ficava
   * `pending`). A tela engolia o motivo e girava.
   */
  const [erroDoProvision, setErroDoProvision] = useState<string | null>(null);
  // A rodada da espera — incrementá-la rearma o teto, como em `EsperaDoRunner`.
  const [rodada, setRodada] = useState(0);
  const [expirou, setExpirou] = useState(false);

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
      query.state.data?.status === 'provisioned' || expirou ? false : 1000,
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
    if (!slug) return false;
    const visibility = repoQuery.data?.visibility ?? 'private';
    // Uma tentativa nova zera o desfecho da anterior: manter o erro velho na
    // tela enquanto a nova roda faria a página afirmar sobre o que ainda não
    // aconteceu.
    setErroDoProvision(null);
    setExpirou(false);
    setRodada((r) => r + 1);
    provisionRepository(projectId, provider, { name: slug, visibility })
      .catch((erro: unknown) => {
        // O motivo VAI PARA A TELA. `mensagemDaApi` extrai a frase do corpo —
        // e é ela que nomeia o que aconteceu ("permissão negada:
        // /data/git-repos/<slug>.git", por exemplo). O `bootstrapQuery`
        // sozinho não alcança este caso: quando `createRepo` falha, a linha de
        // bootstrap nunca chega a ser criada.
        setErroDoProvision(mensagemDaApi(erro, t('provisioningPage.genericError')));
      })
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ['bootstrap', projectId] });
        void queryClient.invalidateQueries({ queryKey: ['repository', projectId] });
      });
    return true;
  }, [projectId, provider, projectQuery.data?.slug, repoQuery.data?.visibility, queryClient, t]);

  // Dispara o provision UMA vez ao montar (assim que o slug do projeto
  // carrega); o retry chama startProvision direto.
  //
  // O `firedRef` é marcado DEPOIS do disparo, e só quando ele de fato saiu:
  // marcá-lo antes queimava a única chance quando `startProvision` desistia
  // por ainda não ter `slug` — nada mais dispararia, e a tela ficava
  // esperando um POST que nunca foi feito.
  useEffect(() => {
    if (firedRef.current) return;
    if (!projectQuery.data) return;
    if (startProvision()) firedRef.current = true;
  }, [projectQuery.data, startProvision]);

  // O teto da espera. Rearmado a cada rodada (o disparo e o "procurar de
  // novo" incrementam `rodada`), e desligado assim que converge — um timer
  // sobrevivente reacenderia "não convergiu" sobre uma tela já bem-sucedida.
  useEffect(() => {
    if (status === 'provisioned') return;
    const id = setTimeout(() => setExpirou(true), TETO_MS);
    return () => clearTimeout(id);
  }, [rodada, status]);

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

  const failedStepDef = failedStep
    ? BOOTSTRAP_STEPS.find((s) => s.name === failedStep)
    : null;
  const failedStepLabel = failedStepDef ? t(failedStepDef.labelKey) : failedStep;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('provisioningPage.title')}</h1>
        <p className={styles.subtitle}>
          {t('provisioningPage.subtitle', {
            name: projectQuery.data
              ? projectQuery.data.name
              : t('provisioningPage.fallbackProjectName'),
          })}
        </p>
      </div>

      {status === 'provisioned' && (
        <div className={[styles.banner, styles.bannerOk].join(' ')}>
          <CheckIcon size={16} />
          <span>{t('provisioningPage.successBanner')}</span>
        </div>
      )}

      {status === 'provision_failed' && (
        <div className={[styles.banner, styles.bannerFail].join(' ')}>
          <AlertIcon size={16} />
          <div>
            <div className={styles.bannerTitle}>
              {/* Sem passo, título sem passo. `failedStep` é `null` quando o
                  que falhou foi a CRIAÇÃO do repositório — nenhum dos seis
                  passos do Gitflow chegou a ser tentado, e "Falhou em: null"
                  seria a tela inventando um passo para preencher a frase. */}
              {failedStepLabel
                ? t('provisioningPage.failedBannerTitle', { step: failedStepLabel })
                : t('provisioningPage.failedBannerTitleNoStep')}
            </div>
            {lastError && <div className={styles.bannerError}>{lastError}</div>}
            {podeSeguirSemProtecao && (
              <div className={styles.bannerError}>
                {t('provisioningPage.protectionFailureNote')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* O erro do POST, que antes era engolido. Vem ANTES do "Iniciando…":
          quando ele existe, não há nada iniciando. */}
      {erroDoProvision && status !== 'provision_failed' && (
        <div className={[styles.banner, styles.bannerFail].join(' ')}>
          <AlertIcon size={16} />
          <div>
            <div className={styles.bannerTitle}>
              {t('provisioningPage.failedBannerTitleNoStep')}
            </div>
            <div className={styles.bannerError}>{erroDoProvision}</div>
          </div>
        </div>
      )}

      {/* Teto estourado sem convergir e sem erro: a tela diz o que sabe e o
          que NÃO sabe, em vez de girar. Mesma régua da RN-474. */}
      {expirou && !erroDoProvision && status !== 'provisioned' && (
        <div className={[styles.banner, styles.bannerFail].join(' ')}>
          <AlertIcon size={16} />
          <div>
            <div className={styles.bannerTitle}>
              {t('provisioningPage.timedOut', { minutes: TETO_MS / 60_000 })}
            </div>
            <div className={styles.bannerError}>
              {t('provisioningPage.timedOutDetail')}
            </div>
          </div>
        </div>
      )}

      {status === null && !erroDoProvision && !expirou && (
        <div className={styles.starting}>{t('provisioningPage.starting')}</div>
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
            {t('provisioningPage.goToProject')}
          </Button>
        ) : status === 'provision_failed' || erroDoProvision ? (
          // O retry deixa de depender SÓ de `provision_failed`. Era essa
          // dependência que deixava a tela sem saída quando o POST falhava
          // antes de existir linha de bootstrap: sem status de falha, nenhum
          // botão era renderizado e a única ação possível era recarregar.
          <>
            <Button onClick={handleRetry}>{t('provisioningPage.retry')}</Button>
            {podeSeguirSemProtecao && (
              <Button variant="success" onClick={handleAcknowledge}>
                {t('provisioningPage.proceedWithoutProtection')}
              </Button>
            )}
          </>
        ) : expirou ? (
          // Teto estourado: "procurar de novo" REARMA a espera sem disparar
          // outro POST — o provisionamento pode estar rodando ainda, e um
          // segundo POST criaria uma sessão de bootstrap a mais.
          <Button
            onClick={() => {
              setExpirou(false);
              setRodada((r) => r + 1);
            }}
          >
            {t('provisioningPage.watchAgain')}
          </Button>
        ) : (
          <span className={styles.working}>{t('provisioningPage.working')}</span>
        )}
      </div>
    </div>
  );
}
