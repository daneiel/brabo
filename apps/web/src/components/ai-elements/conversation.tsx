import type * as React from 'react';

/**
 * Padrão ConversationEmptyState do AI Elements (AT-674 L2): o estado do fio
 * sem mensagem. Só apresentação, sem `use-stick-to-bottom` — a RN-951 manda
 * o fio acompanhar a última mensagem, e o botão "ir ao fim" nunca teria
 * função. Sem filho, não renderiza nada. Superfície = a do `Card` da casa.
 */
export function ConversationEmptyState({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  if (children == null || children === false) return null;
  return (
    <div
      data-slot="conversation-empty-state"
      className={[
        'flex flex-col gap-3 border border-[color:var(--border)] bg-card p-[var(--space-4)] text-card-foreground rounded-[var(--r-lg)]',
        className ?? '',
      ].join(' ')}
      {...props}
    >
      {children}
    </div>
  );
}
