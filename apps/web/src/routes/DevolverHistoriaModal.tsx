import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Textarea } from '../components/ui/Textarea';

/**
 * O modal de motivo da devolução de uma história ao PO (RN-126), aberto pelo
 * card inline ou pelo carrossel do fio da Sessão.
 *
 * Moveu de `SessionPage.tsx` no PR 8 do programa do ADR 0176 junto com o hook
 * `usePromocaoDeHistorias`, sem mudar uma linha do JSX.
 */
export interface DevolverHistoriaModalProps {
  recusandoStory: { id: string; title: string } | null;
  setRecusandoStory: Dispatch<SetStateAction<{ id: string; title: string } | null>>;
  motivoRecusa: string;
  setMotivoRecusa: Dispatch<SetStateAction<string>>;
  enviandoRecusa: boolean;
  handleReturnStory: () => Promise<void>;
}

export function DevolverHistoriaModal({
  recusandoStory,
  setRecusandoStory,
  motivoRecusa,
  setMotivoRecusa,
  enviandoRecusa,
  handleReturnStory,
}: DevolverHistoriaModalProps) {
  const { t } = useTranslation('sessionPage');
  return (
    <>
      {/* Modal de motivo da devolução (RN-126) — mesmo padrão de
          `PromotionQueue` em ProjectBacklogTab.tsx, disparado a partir do
          card inline em vez da aba Backlog. */}
      {recusandoStory && (
        <Modal
          title={t('modal.devolverTitulo', { titulo: recusandoStory.title })}
          onClose={() => setRecusandoStory(null)}
        >
          <Textarea
            label={t('modal.motivo')}
            value={motivoRecusa}
            onChange={(e) => setMotivoRecusa(e.target.value)}
            hint={t('modal.motivoDica')}
            placeholder={t('modal.motivoPlaceholder')}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="danger"
              loading={enviandoRecusa}
              disabled={motivoRecusa.trim() === ''}
              onClick={handleReturnStory}
            >
              {t('modal.devolverAoPo')}
            </Button>
            <Button variant="ghost" onClick={() => setRecusandoStory(null)}>
              {t('modal.cancelar')}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
