import type * as React from 'react';
import { ArrowDownIcon } from 'lucide-react';
import { Button } from '@/components/shadcn/button';

/**
 * Botão "ir ao fim" (AT-683, v5): aparece só quando a pessoa rolou para cima
 * e o fio parou de seguir (`useRolagemDoFio`, sem `use-stick-to-bottom`, que
 * não está no lockfile). Pega carona num wrapper sticky de altura zero.
 */
export function ConversationScrollButton({
  visivel,
  rotulo,
  onClick,
}: {
  visivel: boolean;
  rotulo: string;
  onClick: () => void;
}) {
  if (!visivel) return null;
  return (
    <div data-slot="conversation-scroll-button" className="sticky bottom-3 flex h-0 justify-center">
      <Button type="button" variant="outline" size="sm" className="-translate-y-full rounded-full" onClick={onClick}>
        <ArrowDownIcon />
        {rotulo}
      </Button>
    </div>
  );
}

/**
 * Padrão ConversationEmptyState do AI Elements (AT-674 L2): o estado do fio
 * sem mensagem. Só apresentação. Sem filho, não renderiza nada. Superfície = a do `Card` da casa.
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
