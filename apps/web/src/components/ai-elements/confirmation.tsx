import type { ReactNode } from 'react';
import { Button } from '@/components/shadcn/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/shadcn/item';

type Props = {
  titulo: ReactNode;
  descricao?: ReactNode;
  rotuloAprovar: string;
  rotuloRecusar: string;
  onAprovar: () => void;
  onRecusar: () => void;
  /** Decisão em voo: os botões ficam inertes (RN-096 segue no ApprovalCard). */
  desabilitado?: boolean;
};

/** Padrão Confirmation: SÓ layout. Frase, papel e tetos são do chamador (`lib/aprovacoes.ts`). */
export function Confirmacao({
  titulo,
  descricao,
  rotuloAprovar,
  rotuloRecusar,
  onAprovar,
  onRecusar,
  desabilitado,
}: Props) {
  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{titulo}</ItemTitle>
        {descricao && <ItemDescription>{descricao}</ItemDescription>}
      </ItemContent>
      <ItemActions>
        <Button type="button" variant="outline" size="sm" disabled={desabilitado} onClick={onRecusar}>
          {rotuloRecusar}
        </Button>
        <Button type="button" size="sm" disabled={desabilitado} onClick={onAprovar}>
          {rotuloAprovar}
        </Button>
      </ItemActions>
    </Item>
  );
}
