import type React from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import { Textarea as CampoTextarea } from '@/components/shadcn/textarea';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/shadcn/field';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Rótulo visível, associado ao campo por id. */
  label?: React.ReactNode;
  /** Mensagem de erro sob o campo. Também marca o campo como inválido. */
  error?: string | null;
  /** Texto de apoio, mostrado quando não há erro. */
  hint?: string;
}

/**
 * Campo de texto multilinha. Espelha o `Input`: mesma API (`label`/`error`/
 * `hint`), mesmo `useId()` para o `htmlFor`. O visual mora em
 * `shadcn/textarea.tsx` e `shadcn/field.tsx`.
 */
export function Textarea({ label, error, hint, id, ...rest }: TextareaProps) {
  const gerado = useId();
  const campoId = id ?? gerado;
  const descricaoId = `${campoId}-desc`;

  const campo = (
    <CampoTextarea
      id={campoId}
      aria-invalid={error ? true : undefined}
      aria-describedby={error || hint ? descricaoId : undefined}
      {...rest}
    />
  );

  if (!label && !error && !hint) return campo;

  return (
    <Field>
      {label && <FieldLabel htmlFor={campoId}>{label}</FieldLabel>}
      {campo}
      {error ? (
        <FieldError id={descricaoId}>{error}</FieldError>
      ) : (
        hint && <FieldDescription id={descricaoId}>{hint}</FieldDescription>
      )}
    </Field>
  );
}
