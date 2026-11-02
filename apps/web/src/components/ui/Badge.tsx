import type { HTMLAttributes } from 'react';
import { Badge as BadgeBase, BadgeDot } from '@/components/shadcn/badge';
import { Shimmer } from './Shimmer';

/**
 * `neutral` é o `muted` com texto `--text-secondary`: para badge cujo texto é
 * CONTEÚDO a ser lido (nome de branch, dependência), e não rótulo de estado —
 * `--text-muted` sobre `--surface-2` é dívida de contraste registrada.
 * `agent` pinta com a `--agent-color` herdada de quem envolve o badge (o card
 * do agente a define no `style`) — a cor é do AGENTE, não um estado.
 */
export type BadgeTone = 'success' | 'warning' | 'danger' | 'accent' | 'muted' | 'neutral' | 'agent';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
  pulse?: boolean;
  /** Retângulo (radius menor) em vez de pílula — usado em tabelas densas. */
  square?: boolean;
  /**
   * `sm` (default) é o badge mono de 10px (`--fs-label`); `md` é o de 11px
   * (`--fs-meta`), para o rótulo que carrega um VALOR a ser lido — nome de
   * branch, repositório, economia de token — e não só um estado.
   */
  size?: 'sm' | 'md';
  /**
   * O rótulo diz que algo está EM CURSO (provisionando, encerrando): o texto
   * ganha o `Shimmer` (ADR 0210). Só vale com rótulo em texto puro.
   */
  emCurso?: boolean;
}

/** Adaptador do `badge` do shadcn (AT-646): o visual mora em `shadcn/badge.tsx`. */
export function Badge({
  tone = 'muted',
  dot,
  pulse,
  square,
  size = 'sm',
  emCurso,
  children,
  ...rest
}: BadgeProps) {
  return (
    <BadgeBase
      variant={tone}
      size={size}
      square={!!square}
      data-tone={tone}
      data-size={size}
      data-square={square ? 'true' : undefined}
      data-pulse={pulse ? 'true' : undefined}
      {...rest}
    >
      {dot && <BadgeDot pulse={pulse} />}
      {emCurso && typeof children === 'string' ? <Shimmer>{children}</Shimmer> : children}
    </BadgeBase>
  );
}
