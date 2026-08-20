import type { MouseEvent, ReactNode } from 'react';
import { XIcon } from './icons';
import styles from './Modal.module.css';

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

export function Modal({ title, icon, onClose, children, size = 'default' }: ModalProps) {
  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={[styles.card, size === 'full' && styles.cardFull].filter(Boolean).join(' ')}>
        <div className={styles.header}>
          <div className={styles.title}>
            {icon}
            {title}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Fechar">
            <XIcon size={16} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
