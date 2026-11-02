import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogIconClose,
  DialogTitle,
} from '@/components/shadcn/dialog';
import { XIcon } from './icons';

interface ModalProps {
  title: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /**
   * `default` (implícito) é o card de 520px de sempre — diálogo de
   * confirmação/formulário curto. `full` é o primeiro lightbox do design
   * system (ONDA 3 — aba Arquitetura, ampliar o diagrama C4): o card cresce
   * para quase a viewport inteira, e é o CHAMADOR quem decide qual tamanho
   * o conteúdo pede — `Modal` continua sem saber o que está dentro dele.
   */
  size?: 'default' | 'full';
}

/**
 * Adaptador do `Dialog` do shadcn (AT-646). Quem monta o `Modal` já o quer
 * aberto, então `open` é fixo e o Base UI só AVISA o fechamento (Esc, clique
 * no overlay, botão X) por `onClose`. Esc e a prisão/devolução do foco vêm
 * dele. O tamanho sai em `data-size`.
 */
export function Modal({ title, icon, onClose, children, size = 'default' }: ModalProps) {
  const { t } = useTranslation('ui');
  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) onClose();
      }}
    >
      <DialogContent data-size={size} showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {icon}
            {title}
          </DialogTitle>
          <DialogIconClose aria-label={t('modal.closeLabel')}>
            <XIcon size={16} />
          </DialogIconClose>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}
