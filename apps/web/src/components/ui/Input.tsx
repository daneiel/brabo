import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import styles from './Input.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  icon?: ReactNode;
  /** Rótulo visível, associado ao campo por id. */
  label?: string;
  /** Mensagem de erro sob o campo. Também marca o input como inválido. */
  error?: string | null;
  /** Texto de apoio, mostrado quando não há erro. */
  hint?: string;
}

/**
 * `label` e `error` entraram na Fase 7a, com as telas de auth.
 *
 * Antes o `Input` era só a caixa, e cada tela montava rótulo e erro à mão. Um
 * formulário de login sem `<label for>` é inacessível de um jeito que não
 * aparece em nenhum teste de fluxo — leitor de tela e clique no rótulo
 * simplesmente não funcionam. Como o `id` precisa ser único e estável, ele sai
 * de `useId()` em vez de ser inventado pelo chamador.
 */
export function Input({
  mono,
  icon,
  label,
  error,
  hint,
  className,
  id,
  ...rest
}: InputProps) {
  const gerado = useId();
  const inputId = id ?? gerado;
  const descricaoId = `${inputId}-desc`;

  const classes = [
    styles.input,
    mono && styles.mono,
    icon && styles.withIcon,
    error && styles.invalid,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const campo = (
    <input
      id={inputId}
      className={classes}
      aria-invalid={error ? true : undefined}
      aria-describedby={error || hint ? descricaoId : undefined}
      {...rest}
    />
  );

  const corpo = icon ? (
    <div className={styles.wrapper}>
      <span className={styles.icon}>{icon}</span>
      {campo}
    </div>
  ) : (
    campo
  );

  if (!label && !error && !hint) return corpo;

  return (
    <div className={styles.campo}>
      {label && (
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>
      )}
      {corpo}
      {error ? (
        <span id={descricaoId} className={styles.erro} role="alert">
          {error}
        </span>
      ) : (
        hint && (
          <span id={descricaoId} className={styles.hint}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}
