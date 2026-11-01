import type { ReactNode } from 'react';
import { Button } from '@/components/shadcn/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/shadcn/item';

type Props = {
  titulo: ReactNode;
  descricao?: ReactNode;
  rotuloAprovar?: string;
  rotuloRecusar?: string;
  onAprovar?: () => void;
  onRecusar?: () => void;
  /** Decisão em voo: os botões ficam inertes (RN-096 segue no ApprovalCard). */
  desabilitado?: boolean;
  /** Substitui os 2 botões padrão; `null` não mostra ação nenhuma (já decidido). */
  acoes?: ReactNode;
  /** Detalhe em largura cheia abaixo do título e das ações. */
  children?: ReactNode;
  className?: string;
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
  acoes,
  children,
  className,
}: Props) {
  const padrao = (
    <>
      <Button type="button" variant="outline" size="sm" disabled={desabilitado} onClick={onRecusar}>
        {rotuloRecusar}
      </Button>
      <Button type="button" size="sm" disabled={desabilitado} onClick={onAprovar}>
        {rotuloAprovar}
      </Button>
    </>
  );
  const botoes = acoes === undefined ? padrao : acoes;
  return (
    <Item variant="outline" className={className} data-confirmacao="">
      <ItemContent>
        <ItemTitle className="line-clamp-none w-full flex-col items-stretch gap-0">{titulo}</ItemTitle>
        {descricao && <ItemDescription>{descricao}</ItemDescription>}
      </ItemContent>
      {botoes !== null && <ItemActions className="flex-wrap">{botoes}</ItemActions>}
      {children && <div className="basis-full">{children}</div>}
    </Item>
  );
}
