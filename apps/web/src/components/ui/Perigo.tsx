import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import ajuda from './Ajuda.module.css';
import styles from './Perigo.module.css';
import { Button } from '@/components/ui/Button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from '@/components/shadcn/popover';

interface PerigoProps {
  /** O que o aviso trata; entra no nome acessível "Atenção: {assunto}". */
  assunto: string;
  /** O aviso inteiro (ADR 0243): o risco é anunciado pelo ícone, o texto mora aqui. */
  children: ReactNode;
}

/**
 * O botão de perigo (ADR 0243): irmão do `Ajuda`, mesma base (Popover com
 * `openOnHover`), mas com o ícone `TriangleAlert` na cor de perigo. Carrega a
 * consequência irreversível de UMA ação; outro uso exige outro ADR.
 */
export function Perigo({ assunto, children }: PerigoProps) {
  const { t } = useTranslation('ui');
  return (
    <span className={ajuda.ajuda}>
      <Popover>
        <PopoverTrigger
          openOnHover
          render={<Button variant="ghost" size="sm" icon aria-label={t('perigo.rotulo', { assunto })} />}
        >
          <TriangleAlert aria-hidden="true" className={styles.perigo} />
        </PopoverTrigger>
        <PopoverContent>
          <PopoverDescription>{children}</PopoverDescription>
        </PopoverContent>
      </Popover>
    </span>
  );
}
