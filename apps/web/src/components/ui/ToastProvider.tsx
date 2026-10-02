import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { XIcon } from './icons';
import styles from './Toast.module.css';

export type ToastTone = 'success' | 'warning' | 'danger' | 'accent';

interface ToastEntry {
  id: number;
  title: string;
  message?: string;
  tone: ToastTone;
  acao?: AcaoDoToast;
}

/** Um link de ação no toast — o "e agora?" de um desfecho (AT-372). */
export interface AcaoDoToast {
  rotulo: string;
  aoClicar: () => void;
}

interface ToastOptions {
  title: string;
  message?: string;
  tone?: ToastTone;
  durationMs?: number;
  acao?: AcaoDoToast;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_VAR: Record<ToastTone, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('ui');
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ title, message, tone = 'accent', durationMs = 5000, acao }: ToastOptions) => {
      const id = nextId++;
      setToasts((current) => [...current, { id, title, message, tone, acao }]);
      window.setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.stack}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={styles.toast}
            style={{ ['--tone-color' as string]: TONE_VAR[toast.tone] }}
          >
            <span className={styles.dot} />
            <div className={styles.content}>
              <div className={styles.title}>{toast.title}</div>
              {toast.message && <div className={styles.message}>{toast.message}</div>}
              {toast.acao && (
                <button
                  type="button"
                  className={styles.acao}
                  onClick={() => {
                    toast.acao?.aoClicar();
                    dismiss(toast.id);
                  }}
                >
                  {toast.acao.rotulo}
                </button>
              )}
            </div>
            <button
              type="button"
              className={styles.close}
              onClick={() => dismiss(toast.id)}
              aria-label={t('toast.closeLabel')}
            >
              <XIcon size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast precisa estar dentro de ToastProvider');
  return ctx;
}
