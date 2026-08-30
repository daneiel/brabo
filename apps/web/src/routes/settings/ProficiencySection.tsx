import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  deleteMyProficiency,
  getProjectEvent,
  optInProficiency,
  runAnamnese,
  mensagemDaApi,
} from '../../lib/api-client';
import { useProficiency } from '../../lib/hooks';
import type { ProficiencyLevel, ProficiencyProfile } from '../../lib/api-types';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

const LEVEL_TONE: Record<ProficiencyLevel, BadgeTone> = {
  iniciante: 'muted',
  intermediario: 'warning',
  avancado: 'success',
};

/**
 * Perfil de proficiência (Fase 4b — Anamnese): competência, nível e "os
 * porquês" com evidências clicáveis que navegam até o evento na sessão.
 * O usuário pode apagar o PRÓPRIO perfil — o que também registra o
 * opt-out (senão a rodada seguinte re-derivaria tudo).
 */
// Exportada para o teste, como ExecutionSection e PromotionSection.
export function ProficiencySection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { data: profiles } = useProficiency(projectId);
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [emVoo, setEmVoo] = useState(false);
  // A Anamnese pode estar pausada GLOBALMENTE (decisão do usuário em
  // 2026-08-10, não bug — ver docs/explanation/backlog.md). Não há hoje um
  // jeito de saber isso ANTES de clicar (o estado é do engine, não vem em
  // nenhuma leitura desta tela); "Rodar agora" descobre no primeiro clique e
  // o botão fica desabilitado dali em diante, com a explicação PERSISTENTE
  // na tela — não só um toast que some (RN-088: nunca falha silenciosa ou
  // confusa).
  const [anamneseDesativada, setAnamneseDesativada] = useState(false);

  const all = profiles ?? [];
  const byUser = new Map<string, typeof all>();
  for (const p of all) {
    byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);
  }

  async function handleDelete() {
    setConfirmandoDelete(false);
    setEmVoo(true);
    try {
      await deleteMyProficiency(projectId);
      await queryClient.invalidateQueries({ queryKey: ['proficiency', projectId] });
      showToast({
        title: t('proficiency.toast.deleted'),
        message: t('proficiency.toast.deletedMessage'),
        tone: 'success',
      });
    } catch {
      showToast({
        title: t('proficiency.toast.deleteErrorTitle'),
        message: t('proficiency.toast.deleteErrorMessage'),
        tone: 'danger',
      });
    } finally {
      setEmVoo(false);
    }
  }

  async function handleOptIn() {
    setEmVoo(true);
    try {
      await optInProficiency(projectId);
      // Sem invalidar, a lista só voltava a aparecer no poll seguinte.
      await queryClient.invalidateQueries({ queryKey: ['proficiency', projectId] });
      showToast({
        title: t('proficiency.toast.reactivated'),
        message: t('proficiency.toast.reactivatedMessage'),
        tone: 'success',
      });
    } catch {
      showToast({
        title: t('proficiency.toast.reactivateErrorTitle'),
        message: t('proficiency.toast.reactivateErrorMessage'),
        tone: 'danger',
      });
    } finally {
      setEmVoo(false);
    }
  }

  async function handleRunNow() {
    setEmVoo(true);
    try {
      await runAnamnese(projectId);
      showToast({
        title: t('proficiency.toast.queued'),
        message: t('proficiency.toast.queuedMessage'),
        tone: 'success',
      });
    } catch (erro) {
      if (erro instanceof ApiError && erro.status === 503) {
        // Distinto de "projeto sem sessão" (409) — a api já manda a frase
        // pronta em `body.message` (ServiceUnavailableException do
        // RunAnamneseUseCase).
        setAnamneseDesativada(true);
        showToast({
          title: t('proficiency.toast.pausedTitle'),
          message: mensagemDaApi(erro, t('proficiency.toast.pausedFallback')),
          tone: 'warning',
        });
      } else {
        showToast({
          title: t('proficiency.toast.genericErrorTitle'),
          message: t('proficiency.toast.genericErrorMessage'),
          tone: 'danger',
        });
      }
    } finally {
      setEmVoo(false);
    }
  }

  // A janela da Anamnese é de PROJETO e atravessa várias sessões, então a
  // sessão do evento precisa ser RESOLVIDA — usar a sessão mais recente caía
  // em "evento não encontrado nesta sessão" para toda evidência antiga.
  async function goToEvidence(eventId: string) {
    try {
      const event = await getProjectEvent(projectId, eventId);
      navigate({
        to: '/projects/$projectId/sessions/$sessionId',
        params: { projectId, sessionId: event.sessionId },
        search: { highlightEvent: eventId },
      });
    } catch {
      showToast({
        title: t('proficiency.toast.evidenceUnavailableTitle'),
        message: t('proficiency.toast.evidenceUnavailableMessage'),
        tone: 'danger',
      });
    }
  }

  return (
    <SecaoDeConfiguracoes chave="proficiency">
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('proficiency.title')}</h2>
        <span className={styles.eyebrow}>{t('proficiency.eyebrow')}</span>
      </div>
      <div className={styles.subtitle} style={{ marginBottom: 12 }}>
        {t('proficiency.subtitle')}
      </div>

      {all.length === 0 ? (
        <div className={styles.subtitle}>{t('proficiency.emptyMessage')}</div>
      ) : (
        [...byUser.entries()].map(([userId, group]) => (
          <div key={userId} className={styles.profileGroup}>
            <div className={styles.profileUser}>{identidadeDe(group)}</div>
            {group.map((profile) => (
              <div key={profile.id}>
                <div className={styles.profileRow}>
                  <span className={styles.profileCompetency}>
                    {profile.competency}
                  </span>
                  <Badge tone={LEVEL_TONE[profile.level] ?? 'muted'}>
                    {profile.level}
                  </Badge>
                  <span className={styles.profileWhy}>{profile.rationale}</span>
                </div>
                <div className={styles.evidenceChips}>
                  {profile.evidenceEventIds.map((eventId) => (
                    <button
                      key={eventId}
                      type="button"
                      className={styles.evidenceChip}
                      onClick={() => goToEvidence(eventId)}
                    >
                      {eventId.slice(-8)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        <Button
          variant="danger"
          disabled={emVoo}
          onClick={() => setConfirmandoDelete(true)}
        >
          {t('proficiency.deleteButton')}
        </Button>
        <Button variant="ghost" disabled={emVoo} onClick={handleOptIn}>
          {t('proficiency.reactivateButton')}
        </Button>
        <Button
          variant="secondary"
          disabled={emVoo || anamneseDesativada}
          onClick={handleRunNow}
          title={anamneseDesativada ? t('proficiency.runNowDisabledTitle') : undefined}
        >
          {t('proficiency.runNowButton')}
        </Button>
      </div>

      {/* Pausa GLOBAL (não é o opt-out por membro acima) — decisão do
          usuário em 2026-08-10, aguardando refinamento futuro. Fica visível
          de propósito, não só um toast que some (RN-088). */}
      {anamneseDesativada && (
        <div className={styles.subtitle} style={{ marginTop: 8 }}>
          {t('proficiency.pausedNotice')}
        </div>
      )}

      {/* Apagar é irreversível (e grava opt-out) — um clique cru era demais
          para uma ação que não tem como desfazer o que foi apagado. */}
      {confirmandoDelete && (
        <Modal
          title={t('proficiency.modal.title')}
          onClose={() => setConfirmandoDelete(false)}
        >
          <div className={styles.subtitle}>{t('proficiency.modal.body')}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button variant="danger" onClick={handleDelete}>
              {t('proficiency.modal.confirm')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmandoDelete(false)}>
              {t('proficiency.modal.cancel')}
            </Button>
          </div>
        </Modal>
      )}
    </SecaoDeConfiguracoes>
  );
}

// E-mail é como o resto do app identifica pessoa; o `userId` é UUID e ninguém
// se reconhece nele. Fallback pro nome e, em último caso, pro id — o perfil
// sobrevive à remoção do membro, e aí não há e-mail pra mostrar.
function identidadeDe(group: ProficiencyProfile[]): string {
  const primeiro = group[0];
  return primeiro?.userEmail ?? primeiro?.userName ?? primeiro?.userId ?? '—';
}
