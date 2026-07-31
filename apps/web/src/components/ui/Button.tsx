import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'success';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /**
   * Ação em andamento: mostra o spinner, desabilita o botão e anuncia
   * `aria-busy` (ADR 0036).
   *
   * Antes cada tela fazia isso à mão — `disabled={enviando}` mais troca do
   * texto. Funcionava para quem vê, e não para quem não vê: sem `aria-busy` o
   * leitor de tela só percebia que o botão ficou desabilitado, sem dizer que
   * havia trabalho em curso.
   *
   * O `children` continua sendo do chamador, de propósito. O rótulo em
   * andamento é conteúdo ("Autenticando…", "Criando…", "Enviando…"), e é a tela
   * que sabe qual verbo cabe.
   */
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  fullWidth,
  loading,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    fullWidth && styles.fullWidth,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={classes}
      // `loading` implica `disabled`: um botão que já disparou não pode disparar
      // de novo. `disabled` explícito continua valendo por si.
      disabled={disabled ?? loading}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}
