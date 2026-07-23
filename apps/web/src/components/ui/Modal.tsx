import type { MouseEvent, ReactNode } from 'react';
import { XIcon } from './icons';
import styles from './Modal.module.css';

interface ModalProps {
  title: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, icon, onClose, children }: ModalProps) {
  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.card}>
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
