import type { ComponentProps } from 'react';
import { Toggle } from '@/components/shadcn/toggle';

interface ChipProps extends Omit<ComponentProps<typeof Toggle>, 'pressed' | 'variant' | 'size'> {
  /** Ligado/desligado. Vira `aria-pressed` — o chip é um botão de alternar. */
  pressed: boolean;
  /**
   * Cor da borda quando ligado. `violet` é o escopo de busca do RAG, que é
   * assunto de agente/IA; o resto é `accent`. Sai em `data-tone`.
   */
  tone?: 'accent' | 'violet';
}

/**
 * O chip de FILTRO do design system (AT-287): pílula mono de 12px que liga e
 * desliga um recorte da lista ao lado. Adaptador do `Toggle` do shadcn
 * (AT-646); `pressed` é sempre controlado por quem chama (o clique chega em
 * `onClick`).
 *
 * `Badge` é o par NÃO interativo (um `<span>` sem papel nem foco, e o teste
 * dele fixa isso); este é o interativo.
 */
export function Chip({ pressed, tone = 'accent', ...rest }: ChipProps) {
  return <Toggle variant="chip" size="chip" pressed={pressed} data-tone={tone} {...rest} />;
}
