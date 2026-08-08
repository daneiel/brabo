import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'success';

export type ButtonSize = 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /**
   * Altura do botão. `md` (default) é o botão denso do produto, na faixa de
   * 28–36px que o handoff usa em barra de topo, tabela e diálogo; `lg` é o
   * botão de 44px que ele especifica para a AÇÃO PRINCIPAL de uma tela inteira
   * — hoje, o submit das quatro telas de auth.
   *
   * É prop separada de `fullWidth` de propósito, ainda que hoje as duas andem
   * juntas: largura e altura respondem a perguntas diferentes, e amarrar 44px a
   * `fullWidth` significaria que o primeiro botão largo fora de auth herda uma
   * altura que ninguém pediu.
   */
  size?: ButtonSize;
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
  size = 'md',
  loading,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    size === 'lg' && styles.lg,
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
