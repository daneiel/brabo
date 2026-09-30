import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

/**
 * Espaço interno do card, na escala `--space-*`. `none` é o card que RECORTA e
 * deixa cada região ter o próprio padding e divisória (o `ApprovalCard`: corpo
 * de terminal e de diff encostado nas bordas, como o handoff desenha).
 */
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  /**
   * `lg` (12px, `--r-lg`) é o card do handoff; `md` (8px, `--r-md`) é o card
   * DENSO que mora dentro de uma grade ou de um fio — módulo, pergunta
   * estruturada.
   */
  radius?: 'md' | 'lg';
  /** `overflow: hidden` — para quem pinta região colada na borda. */
  recorta?: boolean;
}

const PADDING: Record<CardPadding, string> = {
  none: styles.padNone,
  sm: styles.padSm,
  md: styles.padMd,
  lg: styles.padLg,
};

/**
 * O contêiner de superfície do design system (AT-286): `--surface-1`, borda
 * `--border`, raio da família `--r-*`. Antes cada módulo escrevia o mesmo trio
 * de declarações com raio e padding próprios (8, 12 e 14px de raio; 12, 16 e
 * 24px de padding), e a mesma "caixa" saía diferente de tela para tela.
 *
 * Só apresentação: o card não decide layout de fora (margem, largura, grade) —
 * quem o posiciona passa `className`, e o `style` passa adiante (é por ele que
 * `--msg-color` chega à pergunta estruturada).
 */
export function Card({
  padding = 'md',
  radius = 'lg',
  recorta,
  className,
  children,
  ...rest
}: CardProps) {
  const classes = [
    styles.card,
    PADDING[padding],
    radius === 'md' && styles.radiusMd,
    recorta && styles.recorta,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
