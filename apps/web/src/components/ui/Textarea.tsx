import type { TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import styles from './Textarea.module.css';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Rótulo visível, associado ao campo por id. */
  label?: string;
  /** Mensagem de erro sob o campo. Também marca o campo como inválido. */
  error?: string | null;
  /** Texto de apoio, mostrado quando não há erro. */
  hint?: string;
}

/**
 * Campo de texto multilinha — o primeiro do produto (Fase 12c), nascido do
 * motivo da recusa de promoção de história.
 *
 * Espelha o `Input` de propósito: mesma API (`label`/`error`/`hint`), mesmo
 * `useId()` para o `htmlFor` (o chamador não inventa id), mesmo envelope
 * opcional, mesma composição de classe. Quem já sabe usar um sabe usar o
 * outro, e a folha de estilo é literalmente a mesma via `composes`.
 *
 * Até aqui o único `<textarea>` do app era cru, dentro do `SessionPage` — sem
 * rótulo associado e sem estado de erro. Este componente não o substitui (o
 * campo de chat tem anatomia própria, com envio por Enter), mas é o que
 * qualquer campo multilinha de formulário deve usar.
 */
export function Textarea({
  label,
  error,
  hint,
  className,
  id,
  ...rest
}: TextareaProps) {
  const gerado = useId();
  const campoId = id ?? gerado;
  const descricaoId = `${campoId}-desc`;

  const classes = [styles.textarea, error && styles.invalid, className]
    .filter(Boolean)
    .join(' ');

  const campo = (
    <textarea
      id={campoId}
      className={classes}
      aria-invalid={error ? true : undefined}
      aria-describedby={error || hint ? descricaoId : undefined}
      {...rest}
    />
  );

  if (!label && !error && !hint) return campo;

  return (
    <div className={styles.campo}>
      {label && (
        <label className={styles.label} htmlFor={campoId}>
          {label}
        </label>
      )}
      {campo}
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
