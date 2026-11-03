import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleQuestionMark } from 'lucide-react';
import styles from './Ajuda.module.css';
import { Button } from '@/components/ui/Button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from '@/components/shadcn/popover';

interface AjudaProps {
  /** Sobre o que é a ajuda; entra no nome acessível "Ajuda: {assunto}". */
  assunto: string;
  /** O texto explicativo (AT-712). Motivo de controle inerte e consequência irreversível NÃO vão aqui. */
  children: ReactNode;
}

/**
 * O botão "?" (AT-712): texto explicativo longo sob demanda. Popover do kit com
 * `openOnHover` (o Base UI manda Popover, não Tooltip, para infotip): abre no
 * clique, Enter, Espaço e hover, fecha com Esc devolvendo o foco, e o texto é o
 * `aria-describedby` do popup. Fica ao lado do título, nunca em controle inerte.
 */
export function Ajuda({ assunto, children }: AjudaProps) {
  const { t } = useTranslation('ui');
  return (
    <span className={styles.ajuda}>
    <Popover>
      <PopoverTrigger
        openOnHover
        render={<Button variant="ghost" size="sm" icon aria-label={t('ajuda.rotulo', { assunto })} />}
      >
        <CircleQuestionMark aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent>
        <PopoverDescription>{children}</PopoverDescription>
      </PopoverContent>
    </Popover>
    </span>
  );
}
