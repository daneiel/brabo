import type { ButtonHTMLAttributes } from 'react';
import styles from './Chip.module.css';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  /** Ligado/desligado. Vira `aria-pressed` — o chip é um botão de alternar. */
  pressed: boolean;
  /**
   * Cor da borda quando ligado. `violet` é o escopo de busca do RAG, que é
   * assunto de agente/IA; o resto é `accent`.
   */
  tone?: 'accent' | 'violet';
}

/**
 * O chip de FILTRO do design system (AT-287): pílula mono de 12px que liga e
 * desliga um recorte da lista ao lado.
 *
 * `Badge` é o par NÃO interativo (um `<span>` sem papel nem foco, e o teste
 * dele fixa isso); este é o interativo. Antes a mesma pílula existia copiada,
 * byte a byte, em três módulos (`.pill`/`.pillAtivo` das abas Sessões, Chat e
 * RAG), e cada cópia podia derivar da outra na primeira correção feita de um
 * lado só.
 */
export function Chip({ pressed, tone = 'accent', className, type, ...rest }: ChipProps) {
  const classes = [styles.chip, pressed && styles.pressed, tone === 'violet' && styles.violet, className]
    .filter(Boolean)
    .join(' ');
  return <button type={type ?? 'button'} className={classes} aria-pressed={pressed} {...rest} />;
}
