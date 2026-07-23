import type { HTMLAttributes } from 'react';
import styles from './Badge.module.css';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'accent' | 'muted';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
  pulse?: boolean;
  /** Retângulo (radius menor) em vez de pílula — usado em tabelas densas. */
  square?: boolean;
}

export function Badge({
  tone = 'muted',
  dot,
  pulse,
  square,
  className,
  children,
  ...rest
}: BadgeProps) {
  const classes = [
    styles.badge,
    styles[tone],
    pulse && styles.pulse,
    square && styles.pill,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} {...rest}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  );
}
