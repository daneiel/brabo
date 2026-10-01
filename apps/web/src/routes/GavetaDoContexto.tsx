import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { XIcon } from '../components/ui/icons';
import styles from './SessionPage.module.css';

/**
 * O painel de contexto no layout móvel é uma GAVETA sobre o fio (AT-328), no
 * mesmo molde da gaveta de navegação do `Shell` (RN-643): diálogo modal, fundo
 * escurecido que fecha ao toque, um X com nome acessível, Esc fecha e o foco
 * volta para quem abriu. No desktop ela não existe — o painel continua ao lado
 * do fio, sem invólucro nenhum.
 */
export function GavetaDoContexto({
  movel,
  aoFechar,
  children,
}: {
  movel: boolean;
  aoFechar: () => void;
  children: ReactNode;
}) {
  if (!movel) return <>{children}</>;
  return <Gaveta aoFechar={aoFechar}>{children}</Gaveta>;
}

function Gaveta({ aoFechar, children }: { aoFechar: () => void; children: ReactNode }) {
  const { t } = useTranslation('sessionPage');
  const gavetaRef = useRef<HTMLDivElement>(null);
  // Quem monta passa uma arrow nova a cada render; o efeito de foco roda UMA
  // vez por abertura, então lê a mais recente por ref.
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    aoFecharRef.current = aoFechar;
  });

  useEffect(() => {
    const quemAbriu = document.activeElement as HTMLElement | null;
    gavetaRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') aoFecharRef.current();
    }
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      quemAbriu?.focus?.();
    };
  }, []);

  return (
    <>
      <div
        className={styles.fundoDaGavetaDoContexto}
        data-testid="fundo-da-gaveta-do-contexto"
        onClick={aoFechar}
      />
      <div
        ref={gavetaRef}
        className={styles.gavetaDoContexto}
        role="dialog"
        aria-modal="true"
        aria-label={t('aside.titulo')}
      >
        <Button
          type="button"
          icon
          variant="ghost"
          className={styles.fecharGavetaDoContexto}
          onClick={aoFechar}
          aria-label={t('topbar.fecharPainel')}
        >
          <XIcon size={17} />
        </Button>
        {children}
      </div>
    </>
  );
}
