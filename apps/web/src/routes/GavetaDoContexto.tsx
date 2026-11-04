import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetClose, SheetContent } from '../components/shadcn/sheet';
import { Button } from '../components/ui/Button';
import { XIcon } from '../components/ui/icons';
import styles from './SessionPage.module.css';

/**
 * O painel de contexto no layout móvel é uma GAVETA sobre o fio (AT-328), no
 * mesmo molde da gaveta de navegação do `Shell` (RN-643): `Sheet` do kit (diálogo modal, fundo
 * escurecido que fecha ao toque), um X com nome acessível, Esc fecha e o foco
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
  // Sheet do kit: foco preso, Esc, fundo e devolução do foco vêm dele.
  return (
    <Sheet open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={styles.gavetaDoContexto}
        aria-label={t('aside.titulo')}
        aria-modal="true"
      >
        <SheetClose
          render={
            <Button icon variant="ghost" className={styles.fecharGavetaDoContexto} />
          }
          aria-label={t('topbar.fecharPainel')}
        >
          <XIcon size={17} />
        </SheetClose>
        {children}
      </SheetContent>
    </Sheet>
  );
}
