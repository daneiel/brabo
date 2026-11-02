import type { HTMLAttributes } from 'react';
import { Card as CardBase } from '@/components/shadcn/card';

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

/**
 * O contêiner de superfície do design system (AT-286): `--surface-1`, borda
 * `--border`, raio da família `--r-*`. Adaptador do `card` do shadcn (AT-646):
 * o visual mora em `shadcn/card.tsx` e o adaptador expõe `data-padding`,
 * `data-radius` e `data-recorta`.
 *
 * Só apresentação: o card não decide layout de fora (margem, largura, grade) —
 * quem o posiciona passa `className`, e o `style` passa adiante (é por ele que
 * `--msg-color` chega à pergunta estruturada).
 */
export function Card({ padding = 'md', radius = 'lg', recorta, children, ...rest }: CardProps) {
  return (
    <CardBase padding={padding} radius={radius} recorta={!!recorta} {...rest}>
      {children}
    </CardBase>
  );
}
